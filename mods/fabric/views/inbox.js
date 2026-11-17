// Posteingang: was auf den Menschen wartet, neueste oben. Die Zahl steht als Badge am Kopf.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

function inboxRow(app, cx, t, entry, index) {
  const kind = model.INBOX_WORDS[entry.kind] ?? entry.kind ?? "Hinweis";
  const color = entry.kind === "attention" ? t.blocked : entry.kind === "review" ? t.done : t.accent;
  return v_flex()
    .id(`fabric-inbox-${entry.ticket}-${index}`)
    .w_full()
    .px(S.l)
    .py(S.s)
    .gap(3)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .on_click((_event, cx) => {
      app.select(entry.ticket, cx);
      app.showStack("fabric-tickets");
    })
    .child(
      h_flex()
        .gap(S.s)
        .items_center()
        .child(ui.chip(t, kind, color))
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(entry.ticket ?? ""))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(model.relativeTime(entry.at))),
    )
    .child(
      h_flex()
        .gap(S.s)
        .text_size(T.xs)
        .text_color(t.muted)
        .child(div().flex_none().child(entry.from ?? ""))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(model.oneLine(entry.text, 160))),
    );
}

export function renderInbox(app, cx, t) {
  const inbox = model.sortInbox(app.index?.inbox);
  const rows = [
    ui.header(t, "Posteingang", [ui.badge(t, inbox.length, inbox.length ? t.accent : t.dim)]),
  ];
  const note = ui.notice(t, app.flash?.text, app.flash?.level);
  if (note) rows.push(note);

  if (!app.index) {
    rows.push(ui.emptyState(t, app.loadError ?? model.EMPTY_HINT));
  } else if (!inbox.length) {
    rows.push(ui.emptyState(t, "Der Posteingang ist leer."));
  } else {
    rows.push(
      v_flex()
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .children(inbox.map((entry, index) => inboxRow(app, cx, t, entry, index))),
    );
  }
  return ui.page(t, rows);
}
