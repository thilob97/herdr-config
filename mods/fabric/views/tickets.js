// Tickets-Ansicht: ein Satz, die Liste nach Stufe und das Detail eines Tickets.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const EMPTY_HINT = model.EMPTY_HINT;
const T = ui.FONT;
const S = ui.SPACE;

function newTicketRow(app, cx, t) {
  const busy = app.busy === "new";
  return v_flex()
    .flex_none()
    .w_full()
    .px(S.l)
    .py(S.m)
    .gap(S.s)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex()
        .gap(S.s)
        .items_center()
        .child(div().flex_1().min_w(0).child(ui.input(t, app.newInput, { focused: app.newInputFocused })))
        .child(ui.button(t, {
          id: "fabric-new",
          label: busy ? "legt an …" : "Anlegen",
          primary: true,
          disabled: Boolean(app.busy),
          onClick: (cx) => app.create(cx),
        })),
    )
    .child(ui.hint(t, "Ein Satz genügt. Repo ist die Git-Wurzel des fokussierten Terminals."));
}

function ticketRow(app, cx, t, ticket) {
  const color = ui.statusColor(t, ticket.status);
  const comments = ticket.comment_count ?? 0;
  return h_flex()
    .id(`fabric-ticket-${ticket.id}`)
    .w_full()
    .px(S.l)
    .py(6)
    .gap(S.m)
    .items_center()
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .on_click((_event, cx) => app.select(ticket.id, cx))
    .child(div().flex_none().size(7).rounded(4).bg(color))
    .child(div().flex_none().w(34).text_size(T.xs).text_color(t.dim).child(ticket.id))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(1)
        .child(div().truncate().text_size(T.m).font_medium().text_color(t.foreground).child(ticket.title || "Ohne Titel"))
        .child(
          h_flex()
            .gap(5)
            .text_size(T.xs)
            .text_color(t.dim)
            .when(Boolean(ticket.assignee), (el) => el.child(div().child(ticket.assignee)).child(div().child("·")))
            .when(comments > 0, (el) => el
              .child(div().child(`${comments} Kommentar${comments === 1 ? "" : "e"}`))
              .child(div().child("·")))
            .child(div().child(model.relativeTime(ticket.updated_at))),
        ),
    )
    .child(div().flex_none().text_size(T.l).text_color(t.dim).child("›"));
}

function ticketList(app, cx, t) {
  if (!app.index) {
    return ui.emptyState(t, app.loadError ?? EMPTY_HINT);
  }
  if (!app.tickets.length) return ui.emptyState(t, EMPTY_HINT);

  const rows = [];
  for (const stage of model.groupByStage(app.tickets)) {
    const folded = stage.key === "done" && !app.doneOpen;
    rows.push(ui.stageRow(t, {
      id: `fabric-stage-${stage.key}`,
      label: stage.label,
      count: stage.tickets.length,
      open: !folded,
      onClick: stage.key === "done"
        ? (cx) => { app.doneOpen = !app.doneOpen; cx.notify(); }
        : null,
    }));
    if (!folded) for (const ticket of stage.tickets) rows.push(ticketRow(app, cx, t, ticket));
  }
  return v_flex()
    .flex_1()
    .min_h(0)
    .overflow_y_scrollbar()
    .py(S.s)
    .children(rows);
}

function headChips(t, ticket) {
  const chips = [];
  chips.push(ui.chip(t, model.statusWord(ticket.status), ui.statusColor(t, ticket.status)));
  if (ticket.assignee) chips.push(ui.chip(t, `→ ${ticket.assignee}`, t.muted));
  if (ticket.checks?.state) {
    chips.push(ui.chip(t, `Checks ${model.CHECK_WORDS[ticket.checks.state] ?? ticket.checks.state}`, ticket.checks.state === "pass" ? t.done : t.blocked));
  }
  if (ticket.verdict?.state) {
    chips.push(ui.chip(t, `Urteil ${model.VERDICT_WORDS[ticket.verdict.state] ?? ticket.verdict.state}`, ticket.verdict.state === "pass" ? t.done : t.blocked));
  }
  if (ticket.waiting?.includes("mensch")) chips.push(ui.chip(t, "wartet auf dich", t.accent));
  return h_flex().gap(5).flex_wrap().children(chips);
}

function commentText(t, ticket, comment, index) {
  const markdown = model.mentionSegments(comment.text ?? "")
    .map((part) => (part.mention ? `**${part.text}**` : part.text))
    .join("")
    .replace(/\n/g, "  \n");
  return TextView.markdown(`fabric-comment-${ticket.id}-${comment.n ?? index}`, markdown)
    .flex_1()
    .text_size(T.s)
    .text_color(t.foreground)
    .selectable(true);
}

function historyRows(app, t, ticket) {
  const rows = [];
  for (const [index, row] of model.history(ticket, app.events).entries()) {
    if (row.kind === "wake") {
      rows.push(
        div()
          .id(`fabric-wake-${ticket.id}-${index}`)
          .w_full()
          .px(S.l)
          .py(2)
          .text_size(T.xs)
          .text_color(t.dim)
          .child(model.wakeLine(row.event)),
      );
      continue;
    }
    const comment = row.comment;
    rows.push(
      v_flex()
        .id(`fabric-entry-${ticket.id}-${comment.n ?? index}`)
        .w_full()
        .px(S.l)
        .py(5)
        .gap(3)
        .child(
          h_flex()
            .gap(S.s)
            .text_size(T.xs)
            .child(div().font_semibold().text_color(t.muted).child(comment.author || "unbekannt"))
            .child(div().text_color(t.dim).child(model.relativeTime(comment.at))),
        )
        .child(commentText(t, ticket, comment, index)),
    );
  }
  return rows;
}

function detail(app, cx, t) {
  if (!app.ticket) {
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(
        h_flex()
          .flex_none()
          .px(S.l)
          .py(6)
          .child(ui.button(t, {
            id: "fabric-back",
            label: "‹ Alle Tickets",
            onClick: (cx) => app.back(cx),
          })),
      )
      .child(ui.emptyState(t, app.ticketError ?? "Das Ticket wird geladen …"));
  }

  const ticket = app.ticket;
  const review = ticket.status === "review";
  const busy = Boolean(app.busy);

  return v_flex()
    .flex_1()
    .min_h(0)
    .child(
      h_flex()
        .flex_none()
        .w_full()
        .px(S.m)
        .py(5)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(ui.button(t, {
          id: "fabric-back",
          label: "‹ Alle Tickets",
          onClick: (cx) => app.back(cx),
        })),
    )
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .child(
          v_flex()
            .w_full()
            .p(S.l)
            .gap(6)
            .border_b(1)
            .border_color(t.border)
            .child(
              h_flex()
                .gap(S.s)
                .items_center()
                .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(ticket.id))
                .child(div().flex_1().min_w(0).text_size(T.l).font_semibold().child(ticket.title || "Ohne Titel")),
            )
            .child(headChips(t, ticket))
            .when(Boolean(ticket.branch), (el) =>
              el.child(div().text_size(T.xs).text_color(t.dim).child(`Zweig ${ticket.branch}`)))
            .when(Boolean(ticket.repo), (el) =>
              el.child(div().text_size(T.xs).text_color(t.dim).truncate().child(ticket.repo))),
        )
        .when(Boolean(ticket.body), (el) =>
          el.child(
            div()
              .w_full()
              .p(S.l)
              .border_b(1)
              .border_color(t.border)
              .child(
                TextView.markdown(`fabric-body-${ticket.id}`, ticket.body)
                  .text_size(T.s)
                  .text_color(t.foreground)
                  .selectable(true),
              ),
          ))
        .child(
          v_flex()
            .w_full()
            .py(S.s)
            .child(div().px(S.l).py(3).text_size(T.xs).text_color(t.dim).child("Verlauf"))
            .children(historyRows(app, t, ticket)),
        ),
    )
    .child(
      v_flex()
        .flex_none()
        .w_full()
        .p(S.m)
        .gap(S.s)
        .border_t(1)
        .border_color(t.border)
        .child(ui.input(t, app.commentInput, { focused: app.commentFocused }))
        .child(
          h_flex()
            .gap(S.s)
            .items_center()
            .child(ui.button(t, {
              id: "fabric-comment",
              label: app.busy === `comment:${ticket.id}` ? "schreibt …" : "Kommentieren",
              disabled: busy,
              onClick: (cx) => app.comment(cx),
            }))
            .when(review, (el) => el
              .child(ui.button(t, {
                id: "fabric-accept",
                label: app.busy === `accept:${ticket.id}` ? "nimmt ab …" : "Abnehmen",
                primary: true,
                disabled: busy,
                onClick: (cx) => app.accept(cx),
              }))
              .child(ui.button(t, {
                id: "fabric-reject",
                label: app.busy === `reject:${ticket.id}` ? "gibt zurück …" : "Zurück mit Feedback",
                disabled: busy,
                onClick: (cx) => app.reject(cx),
              })))
            .child(div().flex_1())
            .child(ui.hint(t, review ? "" : "@name weckt")),
        )
        .when(review, (el) =>
          el.child(ui.hint(t, "„Zurück mit Feedback“ schickt den Text aus dem Kommentarfeld als Feedback."))),
    );
}

export function renderTickets(app, cx, t) {
  const rows = [ui.header(t, "Tickets"), newTicketRow(app, cx, t)];
  const note = ui.notice(t, app.flash?.text, app.flash?.level);
  if (note) rows.push(note);
  rows.push(app.index && app.openId ? detail(app, cx, t) : ticketList(app, cx, t));
  return ui.page(t, rows);
}
