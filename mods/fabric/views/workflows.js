// Workflows: Definitionen und Läufe links, rechts der Graph mit Knotenstatus,
// Ausgabe des gewählten Knotens und Pause/Abbruch für den Lauf.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LIST = 260;
const RUN_ENDED = new Set(["done", "failed", "cancelled", "dry"]);

function nodeColor(t, status) {
  switch (status) {
    case "done": return t.done;
    case "running": return t.accent;
    case "failed": return t.blocked;
    case "skipped": return t.dim;
    default: return t.muted;
  }
}

function runColor(t, status) {
  switch (status) {
    case "running": return t.accent;
    case "paused": return t.working;
    case "done": return t.done;
    case "failed": return t.blocked;
    case "cancelled": return t.dim;
    default: return t.muted;
  }
}

function workflowRow(app, cx, t, flow, runCount) {
  const active = flow.name === app.flowName;
  const nodes = Array.isArray(flow.nodes) ? flow.nodes.length : 0;
  const edges = Array.isArray(flow.edges) ? flow.edges.length : 0;
  return v_flex()
    .id(`fabric-flow-${flow.name}`)
    .w_full()
    .p(S.s)
    .gap(2)
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + "00")
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); app.selectFlow(flow.name, cx); })
    .child(
      h_flex().w_full().min_w(0).gap(5).items_center()
        .child(div().flex_none().text_color(active ? t.accent : t.dim).child(ui.icon("play", 12)))
        .child(div().flex_1().min_w(0).truncate().text_size(T.s)
          .text_color(active ? t.foreground : t.muted).child(flow.name))
        .when(active, (el) => el.child(ui.dot(t, t.accent))),
    )
    .child(div().pl(17).text_size(T.xs).text_color(t.dim)
      .child(`${nodes} Knoten · ${edges} Kanten · ${runCount} Lauf${runCount === 1 ? "" : "e"}`));
}

function runRow(app, cx, t, run, flows) {
  const active = run.id === app.flowRunId;
  const color = runColor(t, run.status);
  const flow = flows.find((row) => row.name === run.workflow);
  const node = (flow?.nodes ?? []).find((row) => row.id === run.current);
  const current = node?.label ?? run.current ?? "—";
  return v_flex()
    .id(`fabric-flow-run-${run.id}`)
    .w_full()
    .p(S.s)
    .gap(2)
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + "00")
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); app.selectFlowRun(run.id, cx); })
    .child(
      h_flex().w_full().min_w(0).gap(6).items_center()
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(`#${run.id}`))
        .child(ui.chip(t, model.flowRunWord(run.status), color))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(model.relativeTime(run.updated_at ?? run.started_at))
          .tooltip(model.absoluteTime(run.updated_at ?? run.started_at))),
    )
    .child(
      h_flex().w_full().min_w(0).gap(4).items_center().pl(2)
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child("Knoten"))
        .child(div().flex_1().min_w(0).truncate().text_size(T.xs)
          .text_color(active ? t.muted : t.dim).child(current)
          .tooltip(`Aktueller Knoten: ${run.current || "—"}`))
        .when(Boolean(run.reason), (el) => el.child(div().flex_none().max_w(84).truncate()
          .text_size(T.xs).text_color(color).child(run.reason).tooltip(run.reason))),
    );
}

function leftPane(app, cx, t, flows, runs) {
  const selected = flows.find((flow) => flow.name === app.flowName) ?? null;
  return v_flex()
    .w(LIST)
    .min_w(LIST)
    .h_full()
    .min_h(0)
    .border_r(1)
    .border_color(t.border)
    .child(div().px(S.m).py(S.s).text_size(T.xs).text_color(t.dim)
      .child(`${flows.length} Workflow${flows.length === 1 ? "" : "s"}`))
    .child(
      app.flows
        ? v_flex().flex_none().max_h(320).min_h(0).overflow_y_scrollbar().p(S.xs).gap(2)
          .children(flows.map((flow) => workflowRow(app, cx, t, flow,
            (app.flowRuns ?? []).filter((run) => run.workflow === flow.name).length)))
        : div().px(S.m).pb(S.s).text_size(T.xs).text_color(t.dim).child("wird geladen …"),
    )
    .child(div().w_full().border_t(1).border_color(t.border))
    .child(div().px(S.m).py(6)
      .child(ui.sectionTitle(t, "Läufe", [
        ui.badge(t, runs.length, selected ? t.accent : t.muted),
      ], selected?.name ?? null)))
    .child(
      !selected
        ? div().px(S.m).pb(S.s).text_size(T.xs).text_color(t.dim).child("Kein Workflow gewählt")
        : runs.length === 0
          ? div().px(S.m).pb(S.s).text_size(T.xs).text_color(t.dim).child("Noch kein Lauf")
          : v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.xs).gap(2)
            .children(runs.map((run) => runRow(app, cx, t, run, flows))),
    );
}

function head(app, cx, t, definition, run) {
  const ended = !run || RUN_ENDED.has(run.status);
  const busy = Boolean(app.busy);
  return v_flex()
    .flex_none()
    .w_full()
    .gap(4)
    .px(S.m)
    .py(S.s)
    .border_b(1)
    .border_color(t.border)
    .bg(t.surface)
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T.l).font_semibold()
          .text_color(t.foreground).child(definition?.name ?? "Workflows")
          .tooltip(definition?.name ?? "Workflows"))
        .when(Boolean(run), (el) => el.child(
          ui.chip(t, model.flowRunWord(run.status), runColor(t, run.status)),
        ))
        .when(Boolean(run), (el) => el.child(ui.button(t, {
          id: "fabric-flow-pause",
          label: "Pause",
          icon: "clock",
          small: true,
          busy: app.busy === "flow-pause",
          disabled: busy || run.status !== "running",
          reason: run.status !== "running" ? "Nur laufende Läufe lassen sich pausieren" : "",
          tooltip: "Lauf pausieren",
          onClick: (cx) => app.pauseFlowRun(cx),
        })))
        .when(Boolean(run), (el) => el.child(ui.button(t, {
          id: "fabric-flow-cancel",
          label: "Abbruch",
          icon: "stop",
          small: true,
          danger: true,
          busy: app.busy === "flow-cancel",
          disabled: busy || ended,
          reason: ended ? "Der Lauf ist bereits beendet" : "",
          tooltip: "Lauf abbrechen",
          onClick: (cx) => app.cancelFlowRun(cx),
        }))),
    )
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center()
        .when(Boolean(run), (el) => el.child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(`Lauf ${run.id} · ${model.flowRunWord(run.status)} · ${model.relativeTime(run.updated_at ?? run.started_at)}`)
          .tooltip(model.absoluteTime(run.updated_at ?? run.started_at))))
        .when(Boolean(run?.reason), (el) => el.child(div().flex_1().min_w(0).truncate()
          .text_size(T.xs).text_color(run.status === "failed" ? t.blocked : t.muted)
          .child(run.reason).tooltip(run.reason)))
        .when(!run, (el) => el.child(div().flex_1().min_w(0).text_size(T.xs).text_color(t.dim)
          .child("Kein Lauf für diesen Workflow"))),
    );
}

/** Zwei waagerechte und ein senkrechtes Segment; `mid` ist die x-Koordinate des Knies. */
function edgeTaken(definition, edge, states, steps) {
  if (!["done", "running"].includes(states[edge.from])) return false;
  if (!edge.when) return true;
  const step = steps[edge.from] ?? null;
  const node = (definition.nodes ?? []).find((row) => row.id === edge.from);
  const status = String(step?.status ?? "");
  if (node?.type === "condition") return String(edge.when) === status;
  if (node?.type === "action") {
    const when = status === "done" ? "pass" : status === "fail" ? "fail" : "";
    return String(edge.when) === when;
  }
  if (node?.type === "agent") return String(edge.when) === String(step?.data?.status ?? "");
  return true;
}

function edgeLines(t, definition, edge, states, steps) {
  const x1 = Number(edge.x1 ?? 0);
  const y1 = Number(edge.y1 ?? 0);
  const x2 = Number(edge.x2 ?? 0);
  const y2 = Number(edge.y2 ?? 0);
  const mid = Number.isFinite(Number(edge.mid)) ? Number(edge.mid) : (x1 + x2) / 2;
  const taken = edgeTaken(definition, edge, states, steps);
  const color = taken ? t.accent : t.border;
  const vertical = Boolean(edge.vertical);
  const segments = vertical
    ? [
      { left: x1, top: Math.min(y1, mid), w: 1, h: Math.abs(mid - y1) },
      { left: Math.min(x1, x2), top: mid, w: Math.abs(x2 - x1), h: 1 },
      { left: x2, top: Math.min(mid, y2), w: 1, h: Math.abs(y2 - mid) },
    ]
    : [
      { left: Math.min(x1, mid), top: y1, w: Math.abs(mid - x1), h: 1 },
      { left: mid, top: Math.min(y1, y2), w: 1, h: Math.abs(y2 - y1) },
      { left: Math.min(mid, x2), top: y2, w: Math.abs(x2 - mid), h: 1 },
    ];
  const lines = segments
    .filter((segment) => segment.w > 0 && segment.h > 0)
    .map((segment, index) => div()
      .id(`fabric-flow-edge-${edge.from}-${edge.to}-${index}`)
      .absolute()
      .left(segment.left)
      .top(segment.top)
      .w(segment.w)
      .h(segment.h)
      .bg(color));
  if (!edge.when) return lines;
  lines.push(div()
    .id(`fabric-flow-edge-label-${edge.from}-${edge.to}`)
    .absolute()
    .left(vertical ? (x1 + x2) / 2 - 8 : mid - 14)
    .top(vertical ? mid - 16 : (y1 + y2) / 2 - 8)
    .px(4)
    .max_w(120)
    .truncate()
    .text_size(T.xs)
    .text_color(taken ? t.accent : t.muted)
    .bg(t.background)
    .child(String(edge.when))
    .tooltip(String(edge.when)));
  return lines;
}

function clickNode(app, run, node, cx) {
  if (node.type === "agent") {
    const step = model.flowNodeSteps(run)[node.id] ?? null;
    const ticket = model.flowNodeTicket(step);
    if (ticket != null && ticket !== "") {
      app.navigate("ticket", { id: ticket }, cx);
      return;
    }
  }
  app.flowNode = app.flowNode === node.id ? null : node.id;
  cx.notify();
}

function nodeCard(app, cx, t, node, status, run) {
  const color = nodeColor(t, status);
  const selected = app.flowNode === node.id;
  return v_flex()
    .id(`fabric-flow-node-${node.id}`)
    .absolute()
    .left(node.x)
    .top(node.y)
    .w(node.w)
    .h(node.h)
    .gap(1)
    .p(5)
    .rounded(ui.RADIUS.m)
    .border_1()
    .border_color(selected ? t.accent : color)
    .bg(selected ? t.selected : color + "14")
    .cursor_pointer()
    .hover((style) => style.opacity(0.9))
    .on_click((_event, cx) => { cx.stop_propagation(); clickNode(app, run, node, cx); })
    .child(
      h_flex().w_full().min_w(0).gap(4).items_center()
        .child(div().flex_none().text_size(T.xs).font_semibold().text_color(color)
          .child(model.flowKindWord(node.type)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(10).text_color(color)
          .child(model.flowStatusWord(status))),
    )
    .child(div().w_full().min_w(0).truncate().text_size(T.s).font_semibold()
      .text_color(t.foreground).child(node.label || node.id).tooltip(node.label || node.id))
    .when(Boolean(node.detail), (el) => el.child(div().w_full().min_w(0).truncate()
      .text_size(T.xs).text_color(t.dim).child(String(node.detail)).tooltip(String(node.detail))));
}

function graph(app, cx, t, definition, run) {
  // Von oben nach unten: ein Lauf bleibt auch im schmalen Fenster ohne
  // waagerechtes Scrollen vollständig sichtbar; Zweige stehen nebeneinander.
  const layout = model.flowLayout(definition, {
    vertical: true,
    nodeWidth: 170,
    nodeHeight: 72,
    gapX: 16,
    gapY: 12,
    padding: 16,
  });
  const states = model.flowNodeStates(definition, run);
  const steps = model.flowNodeSteps(run);
  const nodes = layout.nodes ?? [];
  if (!nodes.length) {
    return ui.emptyState(t, { title: "Leerer Workflow", text: "Die Definition enthält keine Knoten." });
  }
  return v_flex()
    .flex_1()
    .min_h(0)
    .overflow_x_scrollbar()
    .overflow_y_scrollbar()
    .p(S.m)
    .child(
      div()
        .relative()
        .flex_none()
        .w(layout.width)
        .h(layout.height)
        .children((layout.edges ?? []).flatMap((edge) => edgeLines(t, definition, edge, states, steps)))
        .children(nodes.map((node) => nodeCard(
          app, cx, t, node, states[node.id] ?? "waiting", run,
        ))),
    );
}

function outputLines(t, output) {
  const text = output === undefined ? "Keine Ausgabe." : JSON.stringify(output, null, 2);
  return String(text ?? "null").split("\n").map((line, index) => div()
    .id(`fabric-flow-output-line-${index}`)
    .flex_none()
    .whitespace_nowrap()
    .font_family("monospace")
    .text_size(T.xs)
    .text_color(t.muted)
    .child(line === "" ? " " : line));
}

function outputPanel(app, cx, t, definition, run) {
  const id = app.flowNode;
  if (!id) return div();
  const node = (definition.nodes ?? []).find((row) => row.id === id);
  if (!node) return div();
  const step = model.flowNodeSteps(run)[id] ?? null;
  const state = model.flowNodeStates(definition, run)[id];
  const hasOutput = Boolean(run.outputs) && Object.prototype.hasOwnProperty.call(run.outputs, id);
  const output = hasOutput ? run.outputs[id] : undefined;
  const reason = model.flowNodeReason(step);
  const ticket = node.type === "agent" ? model.flowNodeTicket(step) : null;

  return v_flex()
    .flex_none()
    .w(340)
    .h_full()
    .min_h(0)
    .border_l(1)
    .border_color(t.border)
    .bg(t.surface)
    .child(
      h_flex().w_full().min_w(0).gap(6).items_center().px(S.m).py(6)
        .child(div().flex_none().text_size(T.s).font_semibold().child("Ausgabe"))
        .child(ui.chip(t, node.id, t.dim, null, { tooltip: node.id }))
        .child(ui.chip(t, model.flowKindWord(node.type), t.muted))
        .child(ui.chip(t, model.flowStatusWord(state), nodeColor(t, state)))
        .when(Boolean(ticket), (el) => el.child(ui.chip(t, String(ticket), t.accent, null,
          { tooltip: `Ticket ${ticket}` })))
        .child(div().flex_1())
        .child(ui.iconButton(t, {
          id: "fabric-flow-node-close",
          icon: "close",
          size: 22,
          iconSize: 12,
          tooltip: "Ausgabe schließen",
          onClick: (cx) => { app.flowNode = null; cx.notify(); },
        })),
    )
    .when(Boolean(reason), (el) => el.child(div().w_full().px(S.m).pb(4)
      .text_size(T.xs).text_color(t.dim).whitespace_normal().child(reason)))
    .child(
      div()
        .w_full()
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .px(S.m)
        .pb(S.s)
        .child(v_flex().gap(0).items_start().children(outputLines(t, output))),
    );
}

function detail(app, cx, t, definition, run) {
  if (!definition) {
    if (!app.flows) {
      return app.flowError
        ? ui.emptyState(t, { title: "Workflows nicht lesbar", text: "Details stehen oben." })
        : ui.loading(t, "Workflows werden geladen …");
    }
    return ui.emptyState(t, {
      title: "Keine Workflows",
      text: "`fab flow list --json` liefert noch keine Definitionen.",
    });
  }
  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
    .min_h(0)
    .child(head(app, cx, t, definition, run))
    .when(Boolean(run), (el) => el.child(
      h_flex()
        .flex_1()
        .min_h(0)
        .items_stretch()
        .child(graph(app, cx, t, definition, run))
        .child(outputPanel(app, cx, t, definition, run)),
    ))
    .when(!run, (el) => el.child(ui.emptyState(t, {
      title: "Kein Lauf",
      text: "Für diesen Workflow gibt es noch keinen Lauf. `fab flow run <name>` startet einen.",
    })));
}

export function renderWorkflowsPage(app, cx, t) {
  const flows = app.flows ?? [];
  const definition = flows.find((flow) => flow.name === app.flowName) ?? null;
  const runs = (app.flowRuns ?? []).filter((run) => run.workflow === app.flowName);
  const run = runs.find((row) => row.id === app.flowRunId) ?? null;
  const active = runs.filter((row) => row.status === "running" || row.status === "paused").length;

  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, "Workflows", [
      ...(app.compact ? [] : [
        div().text_size(T.xs).text_color(t.dim)
          .child(`${flows.length} Workflows · ${active} aktiv`),
      ]),
      ui.iconButton(t, {
        id: "fabric-workflows-refresh",
        icon: "restart",
        tooltip: "Workflows und Läufe neu laden",
        disabled: Boolean(app.busy),
        onClick: (cx) => app.reloadFlows(cx),
      }),
    ], { iconName: "play", subtitle: "Definitionen, Läufe und Knotenstatus", compact: app.compact }))
    .when(Boolean(app.flowError), (el) => el.child(ui.notice(t, app.flowError)))
    .when(Boolean(app.flowRunsError), (el) => el.child(ui.notice(t, app.flowRunsError)))
    .when(Boolean(app.errorFor("flow-pause")), (el) => el.child(
      ui.notice(t, app.errorFor("flow-pause").text, app.errorFor("flow-pause").level),
    ))
    .when(Boolean(app.errorFor("flow-cancel")), (el) => el.child(
      ui.notice(t, app.errorFor("flow-cancel").text, app.errorFor("flow-cancel").level),
    ))
    .when(Boolean(app.flash?.text), (el) => el.child(ui.notice(t, app.flash.text, app.flash.level)))
    .child(
      h_flex()
        .flex_1()
        .min_h(0)
        .items_stretch()
        .child(leftPane(app, cx, t, flows, runs))
        .child(detail(app, cx, t, definition, run)),
    );
}
