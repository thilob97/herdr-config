// Posteingang: was auf den Menschen wartet. Klick öffnet das Ticket im Fenster.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

function inboxRow(app, cx, t, entry, index) {
  const kind = model.INBOX_WORDS[entry.kind] ?? entry.kind ?? "Hinweis";
  const color = ui.inboxColor(t, entry.kind);
  const retry = model.inboxRetry(entry);
  return v_flex()
    .id(`fabric-inbox-${entry.ticket}-${index}`)
    .w_full()
    .px(S.m)
    .py(S.s)
    .gap(S.xs)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      app.openInWindow({ page: "ticket", id: entry.ticket }, cx);
    })
    .child(
      h_flex().gap(S.s).items_center()
        .child(ui.chip(t, kind, color))
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(entry.ticket ?? ""))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(model.relativeTime(entry.at)).tooltip(model.absoluteTime(entry.at))),
    )
    .child(
      h_flex().gap(S.s).text_size(T.xs).text_color(t.muted)
        .child(div().flex_none().child(entry.from ?? ""))
        .child(div().flex_1().min_w(0).text_color(t.foreground).truncate()
          .child(TextView.markdown(
            `fabric-inbox-text-${entry.ticket}-${index}`,
            model.plainMentionMarkdown(model.oneLine(entry.text, 160)),
          ).text_size(T.xs).text_color(t.foreground).whitespace_nowrap())
          .tooltip(entry.text ?? ""))
        .when(Boolean(retry), (el) => el.child(ui.button(t, {
          id: `fabric-inbox-retry-${entry.ticket}-${index}`,
          label: "Erneut starten",
          small: true,
          tooltip: "Den Agenten erneut starten und den Hinweis bei Erfolg entfernen",
          onClick: (cx) => app.retryAgent(entry, cx),
        }))),
    )
    .when(Boolean(retry), (el) => el.child(
      div().text_size(T.xs).text_color(t.muted)
        .child(`${entry.agent} · ${model.oneLine(entry.reason || "Grund unbekannt", 120)}`),
    ));
}

export function renderInboxPanel(app, cx, t) {
  const inbox = model.sortInbox(app.index?.inbox);
  const cards = model.inboxCards(app.index?.inbox ?? [], app.events);
  const openCount = cards.filter((card) => card.status === "open").length;
  const rest = inbox.filter((entry) => entry.kind !== "decision" && entry.kind !== "lesson");
  const rows = [
    ui.header(t, model.pageWord("inbox"), [
      ui.badge(t, inbox.length, inbox.length ? t.accent : t.dim),
      ui.iconButton(t, {
        id: "fabric-inbox-open",
        icon: "external",
        tooltip: "Im Fenster öffnen (⌘⇧F)",
        onClick: (cx) => app.openInWindow({ page: "board" }, cx),
      }),
      ui.iconButton(t, {
        id: "fabric-inbox-new",
        icon: "plus",
        tooltip: "Neues Ticket (⌘⇧N)",
        onClick: (cx) => app.requestNewTicket(cx),
      }),
    ], { iconName: "inbox" }),
  ];
  const note = ui.notice(t, app.flash?.text, app.flash?.level);
  if (note) rows.push(note);
  const loadNote = ui.notice(t, app.loadError);
  if (loadNote) rows.push(loadNote);

  if (!app.index) {
    if (!app.loadError) {
      rows.push(ui.emptyState(t, {
        title: "Posteingang",
        text: model.EMPTY_HINT,
        compact: true,
      }));
    }
  } else if (!cards.length && !rest.length) {
    rows.push(ui.emptyState(t, {
      title: "Nichts zu tun",
      text: "Fragen, Prüfungen und Aufmerksamkeit erscheinen hier.",
      action: ui.button(t, {
        id: "fabric-inbox-board",
        label: "Zum Board",
        icon: "board",
        onClick: (cx) => app.openInWindow({ page: "board" }, cx),
      }),
      compact: true,
    }));
  } else {
    rows.push(
      v_flex().flex_1().min_h(0).overflow_y_scrollbar().py(S.xs)
        .when(cards.length, (el) => el.child(
          v_flex().w_full().px(S.s).pb(S.xs).gap(S.s)
            .child(ui.sectionTitle(t, "Zu entscheiden", [
              ui.badge(t, openCount, openCount ? t.working : t.dim),
            ]))
            .children(cards.map((card) => ui.proposalCard(t, card, {
              compact: false,
              busy: app.busy === "proposal",
              onAccept: (cx) => app.applyProposal(card, "accept", cx),
              onReject: (cx) => app.applyProposal(card, "reject", cx),
              onOpenTicket: (cx) => app.openInWindow({ page: "ticket", id: card.ticket }, cx),
            }))),
        ))
        .children(rest.map((entry, index) => inboxRow(app, cx, t, entry, index))),
    );
  }
  return ui.page(t, rows);
}
