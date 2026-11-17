// Zeitverlauf: eine Spalte pro Akteur, Zeit von neu (oben) nach alt (unten), Wecken als Pfeil.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LEGEND = ["comment", "wake", "status", "verdict"];

function legend(app, t) {
  const kinds = LEGEND.filter((kind) => app.events.some((event) => event?.kind === kind));
  if (!kinds.length) return null;
  return h_flex().gap(S.m).items_center().flex_wrap()
    .children(kinds.map((kind) => h_flex().gap(S.xs).items_center()
      .child(ui.dot(t, ui.kindColor(t, kind)))
      .child(div().text_size(T.xs).text_color(t.dim).child(model.eventWord(kind)))));
}

function columnHead(t, lane, colorOf) {
  const strong = lane.name === "orchestrator" || lane.name === "mensch";
  return v_flex().flex_1().min_w(0).items_center().justify_center().gap(S.xs)
    .child(ui.avatar(t, lane.name, colorOf(lane.name), ui.SIZE.avatar))
    .child(div().font_medium().text_size(T.xs).text_center().truncate().w_full()
      .text_color(strong ? t.foreground : t.muted).child(lane.label))
    .when(Boolean(lane.role), (el) => el.child(div().text_size(T.xs).text_center().truncate().w_full()
      .text_color(t.dim).child(lane.role)));
}

function headerRow(t, lanes, colorOf) {
  return h_flex().w_full().items_center().h(ui.SIZE.timelineHead).py(S.xs).px(S.m)
    .border_b(1).border_color(t.border)
    .child(div().flex_none().w(ui.SIZE.timelineRail))
    .children(lanes.map((lane) => columnHead(t, lane, colorOf)));
}

function timeRail(t, geometry, graphHeight) {
  const rows = geometry.rows;
  const step = Math.max(1, Math.ceil(rows / 10));
  const picks = [];
  for (let index = 0; index < geometry.times.length; index += step) picks.push(index);
  if (picks[picks.length - 1] !== geometry.times.length - 1) picks.push(geometry.times.length - 1);
  const fraction = (index) => (rows === 1 ? 0.5 : index / (rows - 1));
  return div().flex_none().relative().w(ui.SIZE.timelineRail).h(graphHeight)
    .children(picks.map((index) => div().absolute().top(`${ui.plotY(fraction(index))}%`)
      .left_0().right_0().pr(S.xs).mt(-6).text_size(T.xs).text_color(t.dim)
      .child(model.clockTime(geometry.times[index]))));
}

function separators(t, lanes) {
  return div().absolute().inset_0()
    .child(h_flex().size_full()
      .children(lanes.map((_lane, index) => index === 0
        ? div().flex_1()
        : div().flex_1().border_l(1).border_color(t.border))));
}

function dot(app, t, point, slot, shift) {
  const offset = ui.SIZE.dot / 2;
  return div()
    .id(`fabric-point-${point.lane}-${point.at}-${point.kind}-${slot}`)
    .absolute()
    .left(`${ui.columnX(point.x)}%`)
    .top(`${ui.plotY(point.y)}%`)
    .ml(-offset + shift)
    .mt(-offset)
    .size(ui.SIZE.dot)
    .rounded(ui.SIZE.dot / 2)
    .bg(ui.kindColor(t, point.kind))
    .cursor_pointer()
    .tooltip(`${point.ticket} · ${model.eventWord(point.kind)} · ${point.actor} · ${model.relativeTime(point.at)}`)
    .on_hover((hovered, cx) => {
      app.hoverPoint = hovered ? point : app.hoverPoint === point ? null : app.hoverPoint;
      cx.notify();
    })
    .when(Boolean(point.ticket), (el) => el.on_click((_event, cx) => {
      cx.stop_propagation();
      app.select(point.ticket, cx);
      app.openInWindow({ page: "ticket", id: point.ticket }, cx);
    }));
}

function dotShifts(points) {
  const groups = new Map();
  for (const point of points) {
    const key = `${point.lane}:${point.at}`;
    const group = groups.get(key);
    if (group) group.push(point);
    else groups.set(key, [point]);
  }
  const shiftOf = new Map();
  const slotOf = new Map();
  for (const group of groups.values()) {
    const width = ui.SIZE.dot + S.xs;
    const count = group.length;
    group.forEach((point, index) => {
      shiftOf.set(point, (index - (count - 1) / 2) * width);
      slotOf.set(point, index);
    });
  }
  return { shiftOf, slotOf };
}

function graph(app, t, geometry, graphHeight) {
  const { lanes, points, arrows } = geometry;
  const { shiftOf, slotOf } = dotShifts(points);
  const arrowLayer = ui.wakeArrows(t, arrows, graphHeight);
  return div().relative().flex_1().min_w(0).h(graphHeight).children([
    separators(t, lanes),
    ...(arrowLayer ? [arrowLayer] : []),
    ...points.map((point) => dot(app, t, point, slotOf.get(point) ?? 0, shiftOf.get(point) ?? 0)),
  ]);
}

function hoverLine(app, t) {
  const point = app.hoverPoint;
  if (!point) return ui.hint(t, "Klick auf einen Punkt öffnet das Ticket im Fenster.");
  const pieces = [point.ticket, model.eventWord(point.kind), point.actor, model.relativeTime(point.at)].filter(Boolean);
  return h_flex().gap(S.s).text_size(T.xs).text_color(t.muted)
    .child(div().font_medium().text_color(t.foreground).child(pieces.join(" · ")))
    .child(div().flex_1().truncate().text_color(t.dim).child(model.oneLine(point.event?.text ?? "", 120)));
}

export function renderTimelinePanel(app, cx, t) {
  const colorOf = (name) => app.agentColor(name);
  const geometry = model.timeline(app.events, app.index?.roster ?? []);
  const rows = [
    ui.header(t, "Zeitverlauf", [
      div().text_size(T.xs).text_color(t.dim).child(`${app.events.length} Ereignisse`),
      ui.iconButton(t, {
        id: "fabric-timeline-open",
        icon: "external",
        tooltip: "Im Fenster öffnen (⌘⇧F)",
        onClick: (cx) => app.openInWindow({ page: "board" }, cx),
      }),
    ], { iconName: "clock" }),
  ];
  const note = ui.notice(t, app.flash?.text, app.flash?.level);
  if (note) rows.push(note);
  if (!app.index) {
    rows.push(ui.emptyState(t, { title: "Zeitverlauf", text: app.loadError ?? model.EMPTY_HINT }));
    return ui.page(t, rows);
  }
  if (!app.events.length) {
    rows.push(ui.emptyState(t, { title: "Noch keine Ereignisse", text: "Sobald Tickets arbeiten, erscheint hier der Fluss." }));
    return ui.page(t, rows);
  }
  const keys = legend(app, t);
  const graphHeight = Math.max(ui.SIZE.timelineMin, geometry.rows * ui.SIZE.timelineRow);
  rows.push(
    h_flex().flex_none().w_full().px(S.m).pt(S.m).justify_end()
      .child(div().text_size(T.xs).text_color(t.dim).child("neuer ↑ / älter ↓")),
    headerRow(t, geometry.lanes, colorOf),
    v_flex().flex_1().min_h(0).overflow_y_scrollbar().px(S.m).py(S.m)
      .child(h_flex().w_full().items_stretch()
        .child(timeRail(t, geometry, graphHeight))
        .child(graph(app, t, geometry, graphHeight))),
    v_flex().flex_none().px(S.m).pb(S.m).gap(S.s)
      .when(Boolean(keys), (el) => el.child(keys))
      .child(hoverLine(app, t)),
  );
  return ui.page(t, rows);
}
