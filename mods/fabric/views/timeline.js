// Zeitverlauf: eine Spur pro Akteur, Punkte nach Zeit, Wecken als Pfeil zur Zielspur.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LANE = ui.SIZE.lane;
const LABEL = 96;
const LEGEND = ["comment", "wake", "status", "verdict"];

function legend(app, t) {
  const kinds = LEGEND.filter((kind) => app.events.some((event) => event?.kind === kind));
  if (!kinds.length) return null;
  return h_flex().gap(S.m).items_center().flex_wrap()
    .children(kinds.map((kind) => h_flex().gap(4).items_center()
      .child(ui.dot(t, ui.kindColor(t, kind)))
      .child(div().text_size(T.xs).text_color(t.dim).child(model.eventWord(kind)))));
}

function laneLabel(t, lane) {
  const strong = lane.name === "orchestrator" || lane.name === "mensch";
  return v_flex().flex_none().w(LABEL).h(LANE).justify_center().gap(0).pr(S.s)
    .child(div().truncate().text_size(T.s).text_color(strong ? t.foreground : t.muted).font_medium().child(lane.label))
    .when(Boolean(lane.role), (el) => el.child(div().truncate().text_size(T.xs).text_color(t.dim).child(lane.role)));
}

function laneRow(app, cx, t, lane, points) {
  const dots = points.map((point, offset) => {
    const id = `fabric-point-${lane.index}-${point.at}-${point.kind}-${offset}`;
    return div()
      .id(id)
      .absolute()
      .left(`${ui.plotX(point.x)}%`)
      .top(11 + ((offset % 3) - 1) * 3)
      .ml(-(ui.SIZE.dot / 2))
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
  });
  return v_flex().id(`fabric-lane-${lane.index}`).relative().w_full().h(LANE)
    .border_b(1).border_color(t.border).children(dots);
}

function plot(app, cx, t, geometry) {
  const { lanes, points, arrows } = geometry;
  const lanePoints = lanes.map(() => []);
  for (const point of points) lanePoints[point.lane]?.push(point);
  const arrowLayer = ui.wakeArrows(t, arrows, lanes.length);
  return h_flex().w_full().items_start()
    .child(v_flex().flex_none().children(lanes.map((lane) => laneLabel(t, lane))))
    .child(
      v_flex().flex_1().min_w(0).relative().h(lanes.length * LANE).children([
        ...(arrowLayer ? [arrowLayer] : []),
        ...lanes.map((lane) => laneRow(app, cx, t, lane, lanePoints[lane.index])),
      ]),
    );
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
  rows.push(
    v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.m).gap(S.m)
      .child(h_flex().w_full().items_center()
        .child(div().w(LABEL).flex_none().text_size(T.xs).text_color(t.dim).child("Akteur"))
        .child(div().flex_1())
        .child(div().text_size(T.xs).text_color(t.dim).child("älter → neuer")))
      .child(plot(app, cx, t, geometry))
      .child(h_flex().w_full()
        .child(div().w(LABEL).flex_none())
        .child(div().flex_1().text_size(T.xs).text_color(t.dim).child(model.clockTime(geometry.start)))
        .child(div().text_size(T.xs).text_color(t.dim).child(model.clockTime(geometry.end))))
      .when(Boolean(keys), (el) => el.child(keys))
      .child(hoverLine(app, t)),
  );
  return ui.page(t, rows);
}
