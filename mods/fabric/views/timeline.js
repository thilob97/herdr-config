// Zeitverlauf: ein chronologischer Feed, neueste oben; eine Zeile je Ereignis,
// nach Tagen gruppiert. Ereignisarten unterscheiden sich über Satz, Farbe und Punkt.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LEGEND = ["comment", "wake", "status", "verdict"];

function legend(t, rows) {
  const shown = new Set(rows.map((row) => row.kind));
  const kinds = LEGEND.filter((kind) => shown.has(kind));
  if (!kinds.length) return null;
  return h_flex().gap(S.m).items_center().flex_wrap()
    .children(kinds.map((kind) => h_flex().gap(S.xs).items_center()
      .child(ui.dot(t, ui.kindColor(t, kind)))
      .child(div().text_size(T.xs).text_color(t.dim).child(model.eventWord(kind)))));
}

function scopeBar(app, cx, t, selected) {
  const all = app.timelineAll || !selected;
  const pick = (value) => (pickCx) => {
    app.timelineAll = value;
    pickCx.notify();
  };
  return h_flex().flex_none().w_full().items_center().gap(S.xs).px(S.m).pt(S.s).flex_wrap()
    .child(ui.chip(t, "Alle", all ? t.accent : null, "fabric-timeline-all", {
      tooltip: "Ereignisse aller Tickets",
      onClick: pick(true),
    }))
    .when(Boolean(selected), (el) => el.child(ui.chip(t, selected, all ? null : t.accent, "fabric-timeline-scope", {
      tooltip: "Nur dieses Ticket",
      onClick: pick(false),
    })))
    .child(div().flex_1())
    .child(div().flex_none().text_size(T.xs).text_color(t.dim).child("neueste oben"));
}

function dayHead(t, day) {
  return h_flex().w_full().items_center().gap(S.s).px(S.m).pt(S.m).pb(2)
    .child(div().flex_none().text_size(T.xs).font_semibold().text_color(t.dim).child(day.label))
    .child(div().flex_1().h(1).bg(t.border));
}

function eventRow(app, cx, t, row, key) {
  const kind = ui.kindColor(t, row.kind);
  const full = String(row.detail ?? "");
  const detail = model.oneLine(full, 180);
  const open = Boolean(row.ticket);
  return h_flex()
    .id(`fabric-timeline-${key}`)
    .w_full()
    .items_stretch()
    .gap(S.s)
    .px(S.m)
    .py(5)
    .when(open, (el) => el
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click((_event, clickCx) => {
        clickCx.stop_propagation();
        app.select(row.ticket, clickCx);
        app.openInWindow({ page: "ticket", id: row.ticket }, clickCx);
      }))
    .tooltip([
      model.absoluteTime(row.at),
      `${row.actor} ${row.verb}`,
      detail,
    ].filter(Boolean).join(" · "))
    .child(v_flex().flex_none().w(22).items_center()
      .child(div().relative().size(22)
        .child(ui.avatar(t, row.actor, app.agentColor(row.actor), 22))
        .child(div().absolute().right(-3).bottom(-3).size(9).rounded(5)
          .bg(kind).border_2().border_color(t.surface)))
      .child(div().w(1).flex_1().bg(t.border)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().w_full().min_w(0).gap(S.xs).items_center()
        .child(div().flex_none().max_w(96).truncate().text_size(T.s).font_semibold()
          .text_color(t.foreground).child(row.actor || "—"))
        .child(div().flex_1().min_w(0).truncate().text_size(T.s).text_color(t.muted).child(row.verb))
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(model.clockTime(row.at)).tooltip(model.absoluteTime(row.at))))
      .child(h_flex().w_full().min_w(0).gap(S.xs).items_center()
        .when(open, (el) => el.child(div().flex_none().text_size(T.xs).font_medium()
          .text_color(t.accent).child(row.ticket)))
        .when(Boolean(detail), (el) => el.child(div().flex_1().min_w(0).truncate()
          .text_size(T.xs).text_color(row.kind === "comment" ? t.muted : t.dim)
          .child(detail).tooltip(full)))));
}

export function renderTimelinePanel(app, cx, t) {
  const selected = app.selectedId();
  const all = app.timelineAll || !selected;
  const feed = model.timelineFeed(app.events, { ticket: all ? null : selected });
  const rows = [
    ui.header(t, "Zeitverlauf", [
      div().text_size(T.xs).text_color(t.dim)
        .child(`${feed.total} Ereignis${feed.total === 1 ? "" : "se"}`),
      ui.iconButton(t, {
        id: "fabric-timeline-open",
        icon: "external",
        tooltip: "Im Fenster öffnen (⌘⇧F)",
        onClick: (clickCx) => app.openInWindow({ page: "board" }, clickCx),
      }),
    ], { iconName: "clock" }),
  ];
  const note = ui.notice(t, app.flash?.text, app.flash?.level);
  if (note) rows.push(note);
  if (!app.index) {
    rows.push(ui.emptyState(t, { title: "Zeitverlauf", text: app.loadError ?? model.EMPTY_HINT }));
    return ui.page(t, rows);
  }

  const scope = scopeBar(app, cx, t, selected);
  if (!feed.total) {
    const action = all
      ? null
      : ui.chip(t, "Alle Ereignisse", t.accent, "fabric-timeline-all", {
        onClick: (clickCx) => { app.timelineAll = true; clickCx.notify(); },
      });
    rows.push(scope);
    rows.push(ui.emptyState(t, {
      title: all ? "Noch keine Ereignisse" : `Kein Verlauf für ${selected}`,
      text: all
        ? "Sobald Tickets arbeiten, erscheint hier der Fluss."
        : "Dieses Ticket hat noch keine Ereignisse.",
      action,
    }));
    return ui.page(t, rows);
  }

  const flat = feed.days.flatMap((day) => day.rows);
  const keys = legend(t, flat);
  rows.push(
    scope,
    v_flex().flex_1().min_h(0).overflow_y_scrollbar()
      .children(feed.days.map((day) => v_flex().w_full()
        .child(dayHead(t, day))
        .children(day.rows.map((row, index) => eventRow(app, cx, t, row, `${day.key}-${index}`))))),
    v_flex().flex_none().px(S.m).py(S.s).gap(S.s)
      .when(Boolean(keys), (el) => el.child(keys))
      .child(ui.hint(t, "Klick auf eine Zeile öffnet das Ticket im Fenster.")),
  );
  return ui.page(t, rows);
}
