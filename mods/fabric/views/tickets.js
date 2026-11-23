// Panel Tickets: Schnellzugriff mit Liste, kompaktem Detail und Abnahme.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { run, terminals, agents } from "herdr";
import * as model from "../model.js";
import * as ui from "../ui.js";
import { renderDialogs } from "./dialogs.js";

const T = ui.FONT;
const S = ui.SPACE;

function newTicketRow(app, cx, t) {
  const busy = app.busy === "new";
  return v_flex()
    .flex_none()
    .w_full()
    .px(S.m)
    .py(S.s)
    .gap(S.xs)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex().gap(S.xs).items_center()
        .child(div().flex_1().min_w(0).child(ui.input(t, app.newInput, { focused: app.fieldFocused })))
        .child(ui.iconButton(t, {
          id: "fabric-panel-new-submit",
          icon: "plus",
          tooltip: "Entwurf anlegen",
          disabled: Boolean(app.busy),
          onClick: (cx) => app.createFromPanel(cx),
        })),
    )
    .when(app.mentionOpen("quick"), (el) => el.child(app.mentionView("quick", t)))
    .child(ui.hint(t, busy ? "Legt an …" : "Ein Satz genügt – als Entwurf ohne Wecken."))
    .when(Boolean(app.errorFor("new")), (el) =>
      el.child(ui.notice(t, app.errorFor("new").text, app.errorFor("new").level)));
}

function ticketRow(app, cx, t, ticket) {
  const comments = ticket.comment_count ?? 0;
  return h_flex()
    .id(`fabric-panel-ticket-${ticket.id}`)
    .w_full()
    .px(S.m)
    .py(S.s)
    .gap(S.s)
    .items_center()
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .when(app.openId === ticket.id, (el) => el.bg(t.selected))
    .on_click((_event, cx) => { cx.stop_propagation(); app.select(ticket.id, cx); })
    .child(ui.dot(t, ui.statusColor(t, ticket.status)))
    .child(div().w(34).flex_none().text_size(T.xs).text_color(t.dim).child(ticket.id))
    .child(
      v_flex().flex_1().min_w(0).gap(S.xs)
        .child(div().truncate().text_size(T.s).font_medium()
          .text_color(t.foreground).child(ticket.title || "Ohne Titel"))
        .child(h_flex().gap(S.s).text_size(T.xs).text_color(t.dim)
          .when(Boolean(ticket.assignee), (el) => el.child(div().child(ticket.assignee)).child(div().child("·")))
          .when(comments > 0, (el) => el.child(div().child(`${comments}`)).child(div().child("·")))
          .child(div().child(model.relativeTime(ticket.updated_at)))
          .when(Boolean(ticket.stall), (el) => el.child(
            ui.chip(t, model.stallLabel(ticket.stall), t.accent, null, {
              tooltip: model.stallReason(ticket.stall),
            })))),
    )
    .child(div().flex_none().text_size(T.l).text_color(t.dim).child("›"));
}

function ticketList(app, cx, t) {
  if (!app.index) {
    return v_flex().size_full().min_h(0)
      .when(Boolean(app.loadError), (el) => el.child(ui.notice(t, app.loadError)))
      .child(ui.emptyState(t, { title: "Tickets", text: model.EMPTY_HINT }));
  }
  if (!app.tickets.length) return ui.emptyState(t, { title: "Noch keine Tickets", text: model.EMPTY_HINT });
  const rows = [];
  for (const stage of model.groupByStage(app.tickets)) {
    const open = !(stage.key === "done" && !app.doneOpen);
    rows.push(ui.stageRow(t, {
      id: `fabric-panel-stage-${stage.key}`,
      label: stage.label,
      count: stage.tickets.length,
      open,
      onClick: stage.key === "done"
        ? (cx) => { app.doneOpen = !app.doneOpen; cx.notify(); }
        : null,
    }));
    if (open) for (const ticket of stage.tickets) rows.push(ticketRow(app, cx, t, ticket));
  }
  return v_flex().flex_1().min_h(0).overflow_y_scrollbar().py(S.xs).children(rows);
}

function headChips(app, t, ticket) {
  const chips = [
    ui.chip(t, model.statusWord(ticket.status), ui.statusColor(t, ticket.status)),
  ];
  if (ticket.assignee) chips.push(ui.avatar(t, ticket.assignee, app.agentColor(ticket.assignee), 18));
  for (const [index, session] of model.sessionChips(ticket.sessions, terminals(), agents(), ticket.id).entries()) {
    chips.push(ui.chip(t, `${session.agent} · ${session.word}`, ui.sessionColor(t, session.color),
      `fabric-panel-session-${ticket.id}-${index}`, {
        tooltip: session.tooltip,
        onClick: session.ended ? null : () => run("terminal.peek", { terminal: session.terminal }),
      }));
  }
  if (ticket.checks?.state) {
    chips.push(ui.chip(t, `Checks ${model.CHECK_WORDS[ticket.checks.state] ?? ticket.checks.state}`,
      ticket.checks.state === "pass" ? t.done : t.blocked));
  }
  if (ticket.verdict?.state) {
    chips.push(ui.chip(t, `Urteil ${model.VERDICT_WORDS[ticket.verdict.state] ?? ticket.verdict.state}`,
      ticket.verdict.state === "pass" ? t.done : t.blocked));
  }
  if (ticket.waiting?.includes("mensch")) chips.push(ui.chip(t, "wartet auf dich", t.accent));
  if (ticket.stall) {
    chips.push(ui.chip(t, model.stallLabel(ticket.stall), t.accent, null, {
      tooltip: model.stallReason(ticket.stall),
    }));
  }
  const meta = [];
  if (ticket.checks?.state) meta.push(`Checks ${model.CHECK_WORDS[ticket.checks.state] ?? ticket.checks.state}`);
  if (ticket.verdict?.state) meta.push(`Urteil ${model.VERDICT_WORDS[ticket.verdict.state] ?? ticket.verdict.state}`);
  return h_flex().gap(S.xs).flex_wrap().items_center()
    .children(chips)
    .when(meta.length > 0, (el) => el.child(div().text_size(T.xs).text_color(t.dim).whitespace_nowrap()
      .child(meta.join(" · "))));
}

function detail(app, cx, t) {
  if (!app.ticket) {
    return v_flex().flex_1().min_h(0)
      .child(
        h_flex().flex_none().px(S.s).py(S.xs)
          .child(ui.button(t, {
            id: "fabric-panel-back",
            label: "Alle Tickets",
            icon: "chevron-left",
            small: true,
            tooltip: "Zurück zur Liste",
            onClick: (cx) => app.back(cx),
          })),
      )
      .when(Boolean(app.ticketError), (el) => el.child(ui.notice(t, app.ticketError)))
      .child(ui.emptyState(t, {
        title: app.ticketError ? "Nicht lesbar" : "Ticket",
        text: app.ticketError ? "Das Ticket konnte nicht geladen werden." : "Das Ticket wird geladen …",
      }));
  }
  const ticket = app.ticket;
  const review = ticket.status === "review";
  const gate = model.changesGate(app.changes, app.changesSeenHead);
  const text = app.commentInput.value();
  const pending = app.mentionOpen("comment") ? app.mentions : null;
  return v_flex()
    .flex_1()
    .min_h(0)
    .child(
      h_flex().flex_none().w_full().px(S.s).py(S.xs).gap(S.xs).items_center()
        .child(ui.button(t, {
          id: "fabric-panel-back",
          label: "Alle Tickets",
          icon: "chevron-left",
          small: true,
          tooltip: "Zurück zur Liste",
          onClick: (cx) => app.back(cx),
        }))
        .child(div().flex_1())
        .child(ui.iconButton(t, {
          id: "fabric-panel-open-window",
          icon: "external",
          tooltip: "Im Fenster öffnen",
          onClick: (cx) => app.openInWindow({ page: "ticket", id: ticket.id }, cx),
        })),
    )
    .child(
      v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .child(
          v_flex().w_full().p(S.m).gap(S.s).border_b(1).border_color(t.border)
            .child(h_flex().gap(S.s).items_center()
              .child(div().text_size(T.xs).text_color(t.dim).child(ticket.id))
              .child(div().flex_1().min_w(0).truncate().text_size(T.m).font_semibold().child(ticket.title || "Ohne Titel")))
            .child(headChips(app, t, ticket))
            .when(Boolean(ticket.branch), (el) => el.child(ui.hint(t, ticket.branch))),
        )
        .when(Boolean(ticket.body), (el) => el.child(
          div().w_full().p(S.m).border_b(1).border_color(t.border)
            .child(TextView.markdown(`fabric-panel-body-${ticket.id}`, model.stripImages(ticket.body))
              .w_full().text_size(T.s).text_color(t.foreground).whitespace_normal().selectable(true)),
        ))
        .child(
          v_flex().w_full().py(S.s).gap(S.xs)
            .child(div().px(S.m).text_size(T.xs).text_color(t.dim).child("Verlauf"))
            .children(model.history(ticket, app.events).slice(-6).map((row, index) => {
              if (row.kind === "wake") {
                return div().px(S.m).py(S.xs).text_size(T.xs).text_color(t.dim).child(model.wakeLine(row.event));
              }
              const comment = row.comment;
              return v_flex().w_full().px(S.m).py(S.xs).gap(S.xs)
                .child(h_flex().gap(S.s).items_center()
                  .child(ui.avatar(t, comment.author, app.agentColor(comment.author), 18))
                  .child(div().text_size(T.xs).font_semibold().text_color(t.muted).child(comment.author))
                  .child(div().text_size(T.xs).text_color(t.dim).child(model.relativeTime(comment.at))
                    .tooltip(model.absoluteTime(comment.at))))
                .child(div().pl(S.xl).child(TextView.markdown(
                  `fabric-panel-comment-${comment.n ?? index}`,
                  ui.mentionMarkdown(comment.text),
                ).w_full().text_size(T.s).text_color(t.foreground).whitespace_normal().selectable(true)));
            })),
        ),
    )
    .child(
      v_flex().flex_none().w_full().p(S.m).gap(S.s).border_t(1).border_color(t.border)
        .child(ui.textarea(t, app.commentInput, { focused: app.fieldFocused, height: 64 }))
        .when(app.mentionOpen("comment"), (el) => el.child(app.mentionView("comment", t)))
        .child(ui.hint(t, model.wakeSummary(text, app.agentNames(), "mensch", pending)))
        .when(Boolean(app.errorFor("comment") || app.errorFor("reject") || app.errorFor("accept")), (el) => {
          const problem = app.errorFor("comment") || app.errorFor("reject") || app.errorFor("accept");
          return el.child(ui.notice(t, problem.text, problem.level));
        })
        .child(
          h_flex().w_full().gap(S.xs).items_center()
            .child(ui.button(t, {
              id: "fabric-panel-comment-send",
              label: "Senden",
              icon: "send",
              small: true,
              primary: true,
              busy: app.busy === "comment",
              disabled: Boolean(app.busy) || !text.trim(),
              tooltip: "Kommentar senden (⌘⏎)",
              onClick: (cx) => app.comment(cx),
            }))
            .child(div().flex_1())
            .when(review, (el) => el
              .child(ui.button(t, {
                id: "fabric-panel-accept",
                label: "Abnehmen",
                icon: "check",
                small: true,
                primary: true,
                busy: app.busy === "accept",
                disabled: Boolean(app.busy) || !gate.enabled,
                reason: gate.reason,
                tooltip: gate.enabled ? "Abnehmen – fragt vor dem Merge nach" : gate.reason,
                onClick: (cx) => app.openAcceptModal(cx),
              }))
              .child(ui.button(t, {
                id: "fabric-panel-reject",
                label: "Zurück mit Feedback",
                icon: "undo",
                small: true,
                busy: app.busy === "reject",
                disabled: Boolean(app.busy) || !text.trim(),
                tooltip: "Mit dem Kommentar als Feedback zurückgeben",
                onClick: (cx) => app.reject(cx),
              }))),
        ),
    );
}

export function renderTicketsPanel(app, cx, t) {
  const rows = [
    ui.header(t, "Tickets", [
      ui.badge(t, app.tickets.length, t.muted),
      ui.iconButton(t, {
        id: "fabric-panel-new",
        icon: "plus",
        tooltip: "Neues Ticket (⌘⇧N)",
        onClick: (cx) => app.requestNewTicket(cx),
      }),
      ui.iconButton(t, {
        id: "fabric-panel-open-tickets",
        icon: "external",
        tooltip: "Im Fenster öffnen (⌘⇧F)",
        onClick: (cx) => app.openInWindow({ page: app.openId ? "ticket" : "tickets", id: app.openId ?? undefined }, cx),
      }),
    ], { iconName: "tickets" }),
  ];
  const note = ui.notice(t, app.flash?.text, app.flash?.level);
  if (note) rows.push(note);
  if (!app.openId) rows.push(newTicketRow(app, cx, t));
  rows.push(app.openId ? detail(app, cx, t) : ticketList(app, cx, t));
  let page = app.mentionActions(ui.page(t, rows).relative());
  if (app.modal) page = page.child(renderDialogs(app, cx, t));
  return page;
}
