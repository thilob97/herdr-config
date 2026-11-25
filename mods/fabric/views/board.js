// Board: fünf Stufen als Spalten, Karten mit Zustand, Checks und Urteil.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

function waitTotal(ticket) {
  return (ticket?.waits?.stages ?? [])
    .reduce((sum, stage) => sum + (Number.isFinite(stage?.ms) ? stage.ms : 0), 0);
}

// Kartenfuß: Branch, Kosten und Liegezeit als eine graue Metazeile.
function metaLine(t, ticket) {
  const cost = model.ticketCost(ticket);
  const ms = waitTotal(ticket);
  const parts = [];
  const tips = [];
  if (ticket.branch) {
    parts.push(ticket.branch);
    tips.push(`Branch ${ticket.branch}`);
  }
  if (cost.total > 0) {
    parts.push(`Kosten ${model.formatCost(cost.total)}`);
    const limit = Number.isFinite(ticket.max_cost) ? ` · Limit ${model.formatCost(ticket.max_cost)}` : "";
    tips.push(`Kosten ${model.formatCost(cost.total)} · heute ${model.formatCost(cost.today)}${limit}`);
  }
  if (ms > 0) {
    parts.push(`Liegezeit ${model.formatDuration(ms)}`);
    const stages = (ticket.waits?.stages ?? [])
      .map((stage) => `${stage.label} ${model.formatDuration(stage.ms)}${stage.open ? " (offen)" : ""}`)
      .join(" · ");
    tips.push(`Liegezeit ${model.formatDuration(ms)} · ${stages}`);
  }
  if (!parts.length) return null;
  return div()
    .id(`fabric-card-meta-${ticket.id}`)
    .w_full()
    .text_size(T.xs)
    .text_color(t.dim)
    .truncate()
    .child(parts.join(" · "))
    .tooltip(tips.join("\n"));
}

function miniState(app, t, ticket, key, state, label) {
  if (!state) return null;
  const color = state === "pass" ? t.done : t.blocked;
  return h_flex()
    .flex_none()
    .gap(S.xs)
    .items_center()
    .child(div().size(6).rounded(3).bg(color))
    .child(div().text_size(T.xs).text_color(t.dim).child(`${label} ${model[key][state] ?? state}`));
}

function cardMenu(app, cx, t, ticket) {
  const id = `fabric-card-menu-${ticket.id}`;
  const open = ticket.status !== "done" && ticket.status !== "dropped";
  const options = [
    ...model.statusOptions(ticket.status)
      .filter((option) => option.key !== ticket.status && !option.drop)
      .map((option) => ({ value: option.key, label: option.label, selected: false })),
    ...(open ? [{ value: "__drop", label: "Verwerfen…", selected: false }] : []),
  ];
  return ui.dropdown(t, {
    id,
    iconOnly: true,
    iconName: "dots",
    tooltip: "Status ändern",
    value: "",
    width: 200,
    align: "bottom_right",
    scrollHandle: app.dropdownScroll,
    options,
    open: app.menu === id,
    onToggle: () => { app.menu = app.menu === id ? null : id; cx.notify(); },
    onPick: (value) => {
      app.menu = null;
      if (value === "__drop") app.openDropModal(cx, ticket);
      else app.setStatusOf(ticket.id, value, cx);
    },
  });
}

function titleBlock(app, t, ticket) {
  const full = ticket.title || "Ohne Titel";
  const widths = app.boardTitleWidth ?? (app.boardTitleWidth = {});
  const width = widths[ticket.id];
  const box = v_flex()
    .w_full()
    .gap(0)
    .tooltip(full)
    .on_size_change((size, cx) => {
      if (widths[ticket.id] !== size.width) {
        widths[ticket.id] = size.width;
        cx.notify();
      }
    });
  if (!width) {
    return box
      .text_size(T.s)
      .font_medium()
      .line_height(1.3)
      .whitespace_normal()
      .max_h(32)
      .overflow_hidden()
      .child(full);
  }
  return box.children(model.titleLines(full, width).lines.map((line) => div()
    .w_full()
    .text_size(T.s)
    .font_medium()
    .line_height(1.3)
    .truncate()
    .child(line)));
}

function card(app, cx, t, ticket) {
  const comments = ticket.comment_count ?? 0;
  const waiting = ticket.waiting?.includes("mensch") || ticket.status === "review";
  const selected = app.cursorId === ticket.id;
  const meta = metaLine(t, ticket);
  const badge = model.pipelineBadge(app.pipelineRuns ?? [], ticket.id);
  return v_flex()
    .id(`fabric-card-${ticket.id}`)
    .w_full()
    .p(S.m)
    .gap(S.s)
    .rounded(ui.RADIUS.m)
    .border_1()
    .border_color(selected ? t.accent : t.border)
    .bg(t.raised)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover).border_color(t.input))
    .when(selected, (el) => el.bg(t.selected))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      app.navigate("ticket", { id: ticket.id }, cx);
    })
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(ticket.id))
        .when(Boolean(waiting), (el) => el.child(ui.chip(t, "wartet auf dich", t.accent, null, {
          tooltip: "wartet auf dich",
          shrink: true,
        })))
        .when(Boolean(ticket.stall), (el) => el.child(
          ui.chip(t, model.stallLabel(ticket.stall), t.accent, `fabric-card-stall-${ticket.id}`, {
            tooltip: model.stallReason(ticket.stall),
            shrink: true,
          })))
        .child(div().flex_1().min_w(0))
        .child(div().flex_none().child(cardMenu(app, cx, t, ticket))),
    )
    .child(titleBlock(app, t, ticket))
    .child(
      h_flex().w_full().gap(S.s).items_center()
        // Zuständiger links (kürzt sich), Kommentarzahl und Zeit rechts fest:
        // Ohne `overflow_hidden` lief der linke Block bei schmalen Karten in
        // die Zeitangabe („10vor 5 min“).
        .child(
          h_flex().flex_1().min_w(0).overflow_hidden().gap(S.xs).items_center()
            .when(Boolean(ticket.assignee), (el) => el
              .child(div().flex_none().child(ui.avatar(t, ticket.assignee, app.agentColor(ticket.assignee), 18)))
              .child(div().flex_1().min_w(0).text_size(T.xs).text_color(t.muted).truncate().child(ticket.assignee)
                .tooltip(ticket.assignee)))
            .when(!ticket.assignee, (el) => el
              .child(div().flex_1().min_w(0).text_size(T.xs).text_color(t.dim).truncate().child("Nicht zugewiesen"))),
        )
        .when(comments > 0, (el) => el
          .child(h_flex().flex_none().gap(S.xs).items_center()
            .child(div().text_color(t.dim).child(ui.icon("lines", 11)))
            .child(div().text_size(T.xs).text_color(t.dim).child(String(comments)))))
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(model.relativeTime(ticket.updated_at))),
    )
    .child(
      h_flex().w_full().gap(S.s).items_center().flex_wrap()
        .when(Boolean(ticket.checks), (el) => el.child(miniState(app, t, ticket, "CHECK_WORDS", ticket.checks, "Checks")))
        .when(Boolean(ticket.verdict), (el) => el.child(miniState(app, t, ticket, "VERDICT_WORDS", ticket.verdict, "Urteil")))
        .when(Boolean(badge), (el) => el.child(ui.pill(t, {
          id: `fabric-card-pipeline-${ticket.id}`,
          label: `Lauf ${badge.word}`,
          color: ui.pipelineColor(t, badge.state),
          tooltip: `Letzter Lauf #${badge.run.id} · ${model.pipelineTriggerWord(badge.run.trigger)} · ${model.pipelineDuration(badge.run.duration_ms)} · ${model.relativeTime(badge.run.started_at)}`,
          onClick: (cx) => app.navigate("pipelines", { run: badge.run.id }, cx),
        }))),
    )
    .when(Boolean(meta), (el) => el.child(meta));
}

function filterBar(app, cx, t) {
  return ui.fabricFilters(t, { app, cx, droppedKey: "showDropped" });
}

function columnHead(t, col) {
  const attention = col.attention;
  const cost = model.costTotals(col.tickets).total;
  const total = col.total ?? col.count;
  const countLabel = total > col.count ? `${col.count} von ${total}` : String(col.count);
  return h_flex()
    .flex_none()
    .w_full()
    .h(28)
    .px(S.xs)
    .gap(S.xs)
    .items_center()
    .rounded(ui.RADIUS.s)
    .when(attention, (el) => el.bg(t.accent + ui.ALPHA.faint))
    .child(ui.dot(t, attention ? t.accent : ui.statusColor(t, col.key)))
    .child(div().text_size(T.xs).font_semibold().text_color(attention ? t.accent : t.muted).child(col.label))
    .child(div().flex_none().text_size(T.xs).text_color(attention ? t.accent : t.dim).child(countLabel)
      .when(total > col.count, (el) => el.tooltip(`Zeigt ${col.count} von ${total} Tickets`)))
    .child(div().flex_1())
    .when(cost > 0, (el) => el.child(div().flex_none().text_size(T.xs).text_color(t.dim)
      .child(model.formatCost(cost)).tooltip("Summe der sichtbaren Tickets")))
    .when(attention, (el) => el.child(ui.chip(t, "wartet", t.accent, null, { shrink: true })));
}

function column(app, cx, t, col) {
  return v_flex()
    .flex_1()
    .min_w(150)
    .min_h(0)
    .gap(S.s)
    .child(columnHead(t, col))
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .gap(S.s)
        .pb(S.s)
        .when(col.tickets.length === 0, (el) => el.child(
          div().w_full().py(S.l).text_center().text_size(T.xs).text_color(t.dim).child("leer"),
        ))
        .children(col.tickets.map((ticket) => card(app, cx, t, ticket))),
    );
}

function compactColumn(app, cx, t, col) {
  return v_flex()
    .w_full()
    .gap(S.s)
    .child(columnHead(t, col))
    .when(col.tickets.length === 0, (el) => el.child(
      div().w_full().py(S.m).text_center().text_size(T.xs).text_color(t.dim).child("leer"),
    ))
    .children(col.tickets.map((ticket) => card(app, cx, t, ticket)));
}

export function renderBoard(app, cx, t) {
  const columns = model.boardColumns(app.tickets, app.filters());
  const total = columns.reduce((sum, col) => sum + (col.total ?? col.count), 0);
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("board"), [
      div().text_size(T.xs).text_color(t.dim).child(`${total} Ticket${total === 1 ? "" : "s"}`),
    ], { iconName: "board", subtitle: "Entwurf bis Fertig, Prüfung im Blick", compact: app.compact }))
    .child(filterBar(app, cx, t))
    .when(Boolean(app.loadError), (el) => el.child(ui.notice(t, app.loadError)))
    .when(Boolean(app.flash?.text), (el) => el.child(ui.notice(t, app.flash.text, app.flash.level)))
    .when(Boolean(app.errorFor("status") || app.errorFor("drop")), (el) => {
      const problem = app.errorFor("status") || app.errorFor("drop");
      return el.child(ui.notice(t, problem.text, problem.level));
    })
    .child(
      !app.index
        ? (app.loadError
          ? ui.emptyState(t, { title: "Tickets nicht lesbar", text: "Die Index-Datei konnte nicht gelesen werden." })
          : ui.loading(t, "Tickets werden geladen …"))
        : total === 0
          ? ui.emptyState(t, {
            title: "Keine Tickets in dieser Auswahl",
            text: model.EMPTY_HINT,
            action: ui.button(t, {
              id: "fabric-board-new",
              label: "Neues Ticket",
              primary: true,
              onClick: (cx) => app.openNewTicket(cx),
            }),
          })
          : (app.compact
            ? v_flex()
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .px(S.m)
              .pt(S.s)
              .pb(S.m)
              .gap(S.l)
              .children(columns.map((col) => compactColumn(app, cx, t, col)))
            : h_flex()
              .flex_1()
              .min_h(0)
              .px(S.m)
              .pt(S.s)
              .gap(S.s)
              .items_stretch()
              .children(columns.map((col) => column(app, cx, t, col)))),
    );
}
