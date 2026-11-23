// Workflows: Definitionen und Läufe links, rechts der Graph mit Knotenstatus,
// Ausgabe des gewählten Knotens und Pause/Abbrechen für den Lauf. Der Builder
// zeigt denselben Graphen bearbeitbar: Palette, Plan und Eigenschaften-Prüfung.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const RUN_ENDED = new Set(["done", "failed", "cancelled", "dry"]);

// Beschriftungen des visuellen Builders kommen aus den Modellwörtern; die
// Modelltypen bleiben englisch.
const BUILDER = {
  nodeWidth: 160,
  nodeHeight: 88,
  gapX: S.m,
  gapY: S.xl + S.xs,
  padding: S.l,
};

/** Typlisten des Modells (Strings oder Objekte) in Wert/Beschriftung übersetzen. */
function builderTypes(raw, fallback, word) {
  let list = raw;
  if (list && !Array.isArray(list) && typeof list === "object") {
    list = Object.entries(list).map(([value, label]) => ({ value, label }));
  }
  if (!Array.isArray(list) || list.length === 0) list = fallback;
  return list.map((row) => {
    if (typeof row === "string" || typeof row === "number") {
      const value = String(row);
      return { value, label: word(value) };
    }
    const value = String(row?.type ?? row?.value ?? row?.id ?? "");
    return { value, label: row?.label ?? word(value) ?? value };
  }).filter((row) => row.value);
}

function builderNodeTypes() {
  return builderTypes(model.FLOW_NODE_TYPES,
    ["trigger", "agent", "action", "condition", "approval", "end"], model.flowKindWord);
}

function builderTriggerTypes() {
  return builderTypes(model.FLOW_TRIGGER_TYPES,
    ["manual", "cron", "ticket_done", "github_issue", "main_red"], model.flowTriggerWord);
}

function builderActionTypes() {
  return builderTypes(model.FLOW_ACTION_TYPES,
    ["shell", "fab", "notify"], model.flowActionWord);
}


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
  // Ein neuer, ungespeicherter Entwurf gehört noch zu keinem Eintrag.
  const active = flow.name === app.flowName
    && !(app.flowMode === "builder" && app.flowBuilder?.fresh);
  const nodes = Array.isArray(flow.nodes) ? flow.nodes.length : 0;
  const edges = Array.isArray(flow.edges) ? flow.edges.length : 0;
  return v_flex()
    .id(`fabric-flow-${flow.name}`)
    .w_full()
    .p(S.s)
    .gap(S.xs)
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + ui.ALPHA.clear)
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); app.selectFlow(flow.name, cx); })
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center()
        .child(div().flex_none().text_color(active ? t.accent : t.dim).child(ui.icon("play", 12)))
        .child(div().flex_1().min_w(0).truncate().text_size(T.s)
          .text_color(active ? t.foreground : t.muted).child(flow.name))
        .when(active, (el) => el.child(ui.dot(t, t.accent))),
    )
    .child(div().pl(S.xl).text_size(T.xs).text_color(t.dim)
      .child(`${nodes} Knoten · ${edges} Kanten · ${runCount} ${runCount === 1 ? "Lauf" : "Läufe"}`));
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
    .gap(S.xs)
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + ui.ALPHA.clear)
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); app.selectFlowRun(run.id, cx); })
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center()
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(`#${run.id}`))
        .child(ui.chip(t, model.flowRunWord(run.status), color))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(model.relativeTime(run.updated_at ?? run.started_at))
          .tooltip(model.absoluteTime(run.updated_at ?? run.started_at))),
    )
    .child(
      h_flex().w_full().min_w(0).gap(S.xs).items_center().pl(S.xs)
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child("Knoten"))
        .child(div().flex_1().min_w(0).truncate().text_size(T.xs)
          .text_color(active ? t.muted : t.dim).child(current)
          .tooltip(`Aktueller Knoten: ${run.current || "—"}`))
        .when(Boolean(run.reason), (el) => el.child(div().flex_none().max_w(84).truncate()
          .text_size(T.xs).text_color(color).child(run.reason).tooltip(run.reason))),
    );
}

// Feste Höhe je Zeilenzahl: ein scrollbarer Block ohne eigene Höhe nimmt
// sonst den ganzen Rest der Spalte und verdeckt „Läufe“ samt Leerzustand.
function paneListHeight(count) {
  // Zeile: 44 hohe Zeile plus Innenabstand und Lücke; oben und unten 4.
  return Math.min(320, count * (ui.SIZE.rowTall + S.s + S.xs) + S.xs * 2);
}

function paneList(count, rows) {
  return div().w_full().flex_none().h(paneListHeight(count)).min_h(0).overflow_hidden()
    .child(v_flex().size_full().overflow_y_scrollbar().p(S.xs).gap(S.xs).children(rows));
}

function leftPane(app, cx, t, flows, runs) {
  const selected = flows.find((flow) => flow.name === app.flowName) ?? null;
  return v_flex()
    .w(ui.SIZE.listPane)
    .min_w(ui.SIZE.listPane)
    .h_full()
    .min_h(0)
    .border_r(1)
    .border_color(t.border)
    .child(div().px(S.m).py(S.s).text_size(T.xs).text_color(t.dim)
      .child(`${flows.length} Workflow${flows.length === 1 ? "" : "s"}`))
    .child(
      app.flows
        ? v_flex().flex_none().max_h(320).min_h(0).overflow_y_scrollbar().p(S.xs).gap(S.xs)
          .children(flows.map((flow) => workflowRow(app, cx, t, flow,
            (app.flowRuns ?? []).filter((run) => run.workflow === flow.name).length)))
        : div().px(S.m).pb(S.s).text_size(T.xs).text_color(t.dim).child("wird geladen …"),
    )
    .child(div().w_full().border_t(1).border_color(t.border))
    .child(div().px(S.m).py(S.s)
      .child(ui.sectionTitle(t, "Läufe", [
        ui.badge(t, runs.length, selected ? t.accent : t.muted),
      ], selected?.name ?? null)))
    .child(
      !selected
        ? ui.emptyState(t, { title: "Kein Workflow gewählt", compact: true })
        : runs.length === 0
          ? ui.emptyState(t, { title: "Noch kein Lauf", compact: true })
          : paneList(runs.length, runs.map((run) => runRow(app, cx, t, run, flows))),
    );
}

function head(app, cx, t, definition, run) {
  const builder = app.flowBuilder;
  const mode = app.flowMode === "builder" ? "builder" : "run";
  const title = mode === "builder"
    ? (builder?.draft?.name || "Neuer Workflow")
    : (definition?.name ?? builder?.draft?.name ?? "Workflows");
  const ended = !run || RUN_ENDED.has(run.status);
  const busy = Boolean(app.busy);
  const runLine = run
    ? `Lauf ${run.id} · ${model.flowRunWord(run.status)} · ${model.relativeTime(run.updated_at ?? run.started_at)}`
    : "";
  const subtitle = mode === "builder"
    ? (builder?.connectFrom
      ? `Verbindung von „${builder.connectFrom}“: Zielknoten anklicken.`
      : "Palette: Baustein anklicken, um ihn zu platzieren. Knoten anklicken zum Bearbeiten.")
    : run
      ? (run.reason ? `${runLine} · ${run.reason}` : runLine)
      : "Kein Lauf für diesen Workflow";
  return ui.detailHeader(t, title, [
    ...(mode === "run" && run
      ? [ui.chip(t, model.flowRunWord(run.status), runColor(t, run.status))]
      : []),
    ...(mode === "builder" && builder?.dirty
      ? [ui.chip(t, "ungespeichert", t.working)]
      : []),
    ui.tabs(t, {
      id: "fabric-flow-mode",
      value: mode,
      items: [{ value: "run", label: "Lauf" }, { value: "builder", label: "Builder" }],
      onPick: (value) => app.setFlowMode(value, cx),
    }),
    ui.button(t, {
      id: "fabric-flow-new",
      label: "Neu",
      icon: "plus",
      small: true,
      tooltip: "Neuen Workflow bauen",
      onClick: (cx) => app.newFlowBuilder(cx),
    }),
    ...(mode === "builder" && builder?.connectFrom
      ? [ui.button(t, {
        id: "fabric-flow-builder-connect-cancel",
        label: "Verbindung abbrechen",
        small: true,
        onClick: (cx) => app.flowBuilderStartConnect(builder.connectFrom, cx),
      })]
      : []),
    ...(mode === "builder"
      ? [ui.button(t, {
        id: "fabric-flow-builder-select-none",
        label: "Workflow",
        small: true,
        tooltip: "Workflow-Eigenschaften und Prüfung anzeigen",
        onClick: (cx) => app.flowBuilderSelectClear(cx),
      })]
      : []),
    ...(mode === "run" && run
      ? [
        ui.button(t, {
          id: "fabric-flow-pause",
          label: "Pause",
          icon: "clock",
          small: true,
          busy: app.busy === "flow-pause",
          disabled: busy || run.status !== "running",
          reason: run.status !== "running" ? "Nur laufende Läufe lassen sich pausieren" : "",
          tooltip: "Lauf pausieren",
          onClick: (cx) => app.pauseFlowRun(cx),
        }),
        ui.button(t, {
          id: "fabric-flow-cancel",
          label: "Abbrechen",
          icon: "stop",
          small: true,
          danger: true,
          busy: app.busy === "flow-cancel",
          disabled: busy || ended,
          reason: ended ? "Der Lauf ist bereits beendet" : "",
          tooltip: "Lauf abbrechen",
          onClick: (cx) => app.cancelFlowRun(cx),
        }),
      ]
      : []),
  ], { subtitle });
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
    .top(vertical ? mid - 9 : (y1 + y2) / 2 - 9)
    .h(18)
    .px(S.xs)
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
    .gap(S.xs)
    .p(S.s)
    .rounded(ui.RADIUS.m)
    .border_1()
    .border_color(selected ? t.accent : color)
    .bg(selected ? t.selected : color + ui.ALPHA.faint)
    .cursor_pointer()
    .hover((style) => style.opacity(0.9))
    .on_click((_event, cx) => { cx.stop_propagation(); clickNode(app, run, node, cx); })
    .child(
      h_flex().w_full().min_w(0).gap(S.xs).items_center()
        .child(div().flex_none().text_size(T.xs).font_semibold().text_color(color)
          .child(model.flowKindWord(node.type)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T.xs).text_color(color)
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
  // Die Schichtlücke trägt ein 18-px-Kantenlabel ohne Überlappung.
  const layout = model.flowLayout(definition, {
    vertical: true,
    nodeWidth: 160,
    nodeHeight: 72,
    gapX: S.m,
    gapY: S.xl + S.xs,
    padding: S.l,
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

// ---------- Visueller Builder ----------

function builderTypesOptions(options, current, placeholder = "Auswählen…") {
  const rows = options.map((option) => ({
    value: option.value,
    label: option.label,
    selected: option.value === current,
  }));
  const selected = rows.find((row) => row.selected);
  return { rows, display: selected?.label ?? placeholder };
}

function builderDropdown(app, cx, t, key, value, options, onPick, placeholder) {
  const builder = app.flowBuilder;
  if (!builder) return div();
  const open = builder.dropdown === key;
  const { rows, display } = builderTypesOptions(options, value, placeholder);
  return ui.dropdown(t, {
    id: `fabric-flow-builder-${key}`,
    value: display,
    options: rows,
    open,
    width: 300,
    onToggle: (cx) => {
      builder.dropdown = open ? null : key;
      cx.notify();
    },
    onPick: (next, cx) => {
      builder.dropdown = null;
      onPick(next, cx);
    },
  });
}

function builderInput(app, t, name, { placeholder = "" } = {}) {
  const builder = app.flowBuilder;
  const state = builder?.form?.fields?.[name];
  if (!state) {
    return div().text_size(T.xs).text_color(t.blocked).child("Feld nicht verfügbar.");
  }
  return ui.input(t, state, { focused: builder.focusField === name });
}

function builderTextarea(app, t, name, { height = 92 } = {}) {
  const builder = app.flowBuilder;
  const state = builder?.form?.fields?.[name];
  if (!state) {
    return div().text_size(T.xs).text_color(t.blocked).child("Feld nicht verfügbar.");
  }
  return ui.textarea(t, state, { focused: builder.focusField === name, height });
}

function builderPalette(app, cx, t) {
  return v_flex()
    .flex_none()
    .w_full()
    .gap(S.s)
    .px(S.m)
    .py(S.s)
    .border_b(1)
    .border_color(t.border)
    .bg(t.surface)
    .child(
      h_flex().w_full().items_center().gap(S.s)
        .child(div().text_size(T.xs).font_semibold().text_color(t.muted).child("Bausteine"))
        .child(div().flex_1())
        .child(div().text_size(T.xs).text_color(t.dim).child("anklicken, um zu platzieren")),
    )
    .child(
      h_flex().w_full().gap(S.s).items_center().flex_wrap()
        .children(builderNodeTypes().map((type) => h_flex()
          .id(`fabric-flow-palette-${type.value}`)
          .flex_none()
          .h(26)
          .px(S.s)
          .gap(S.xs)
          .items_center()
          .rounded(ui.RADIUS.m)
          .border_1()
          .border_color(t.input)
          .bg(t.raised)
          .text_size(T.xs)
          .text_color(t.muted)
          .cursor_pointer()
          .hover((style) => style.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_event, cx) => {
            // Der Druck gehört dem Baustein: sonst zieht der Fensterrahmen das
            // ganze Fabric-Fenster. Das Loslassen über dem Baustein kommt im
            // Fenster nicht an, deshalb platziert schon der Druck.
            cx.stop_propagation();
            app.flowBuilderPlace(type.value, cx);
          })
          .child(ui.icon("plus", 11))
          .child(div().whitespace_nowrap().child(type.label)))),
    );
}

function builderEdgeIndex(builder, edge, position) {
  if (Number.isFinite(Number(edge.index))) return Number(edge.index);
  const edges = builder.draft?.edges ?? [];
  const found = edges.findIndex((row) => row.from === edge.from && row.to === edge.to
    && (row.when ?? null) === (edge.when ?? null));
  return found >= 0 ? found : position;
}

function builderEdge(app, cx, t, edge, index, selected) {
  const x1 = Number(edge.x1 ?? 0);
  const y1 = Number(edge.y1 ?? 0);
  const x2 = Number(edge.x2 ?? 0);
  const y2 = Number(edge.y2 ?? 0);
  const mid = Number.isFinite(Number(edge.mid)) ? Number(edge.mid) : (y1 + y2) / 2;
  const color = selected ? t.accent : t.border;
  const segments = [
    { left: x1, top: Math.min(y1, mid), w: 1, h: Math.abs(mid - y1) },
    { left: Math.min(x1, x2), top: mid, w: Math.abs(x2 - x1), h: 1 },
    { left: x2, top: Math.min(mid, y2), w: 1, h: Math.abs(y2 - mid) },
  ];
  const lines = segments
    .filter((segment) => segment.w > 0 && segment.h > 0)
    .map((segment, position) => div()
      .id(`fabric-flow-builder-edge-${index}-${position}`)
      .absolute()
      .left(segment.left)
      .top(segment.top)
      .w(segment.w)
      .h(segment.h)
      .bg(color));
  const loops = Number(edge.max_loops);
  const text = edge.when ? String(edge.when) : "→";
  const label = Number.isFinite(loops) && loops > 0 ? `${text} · ×${loops}` : text;
  lines.push(h_flex()
    .id(`fabric-flow-builder-edge-label-${index}`)
    .absolute()
    .left((x1 + x2) / 2 - 18)
    .top(mid - 9)
    .h(18)
    .px(S.s)
    .items_center()
    .rounded(ui.RADIUS.s)
    .border_1()
    .border_color(selected ? t.accent : t.border)
    .bg(t.background)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      app.flowBuilderSelectEdge(index, cx);
    })
    .child(div().text_size(T.xs).text_color(selected ? t.accent : t.muted)
      .whitespace_nowrap().child(label))
    .tooltip(`${edge.from} → ${edge.to}`));
  return lines;
}

function builderNodeCard(app, cx, t, node, selected) {
  const builder = app.flowBuilder;
  const connecting = builder?.connectFrom === node.id;
  const color = selected ? t.accent : connecting ? t.working : t.border;
  return v_flex()
    .id(`fabric-flow-builder-node-${node.id}`)
    .absolute()
    .left(node.x)
    .top(node.y)
    .w(node.w)
    .h(node.h)
    .gap(S.xs)
    .p(S.s)
    .rounded(ui.RADIUS.m)
    .border_1()
    .border_color(color)
    .bg(selected ? t.selected : t.raised)
    .cursor_pointer()
    .hover((style) => style.opacity(0.92))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      app.flowBuilderClickNode(node.id, cx);
    })
    .child(
      h_flex().w_full().min_w(0).gap(S.xs).items_center()
        .child(div().flex_none().text_size(T.xs).font_semibold()
          .text_color(selected ? t.accent : t.muted)
          .child(model.flowKindWord(node.type)))
        .child(div().flex_1())
        .child(ui.iconButton(t, {
          id: `fabric-flow-builder-link-${node.id}`,
          icon: "link",
          size: 18,
          iconSize: 11,
          active: connecting,
          tooltip: connecting ? "Verbindung abbrechen" : "Verbindung von diesem Knoten starten",
          onClick: (cx) => app.flowBuilderStartConnect(node.id, cx),
        })),
    )
    .child(div().w_full().min_w(0).truncate().text_size(T.s).font_semibold()
      .text_color(t.foreground).child(node.label || node.id).tooltip(node.label || node.id))
    .child(
      h_flex().w_full().min_w(0).gap(S.xs).items_center()
        .child(ui.chip(t, node.id, t.dim, `fabric-flow-builder-id-${node.id}`, { tooltip: node.id }))
        .when(Boolean(node.detail), (el) => el.child(div().flex_1().min_w(0).truncate()
          .text_size(T.xs).text_color(t.dim).child(String(node.detail))
          .tooltip(String(node.detail)))),
    );
}

function builderCanvas(app, cx, t) {
  const builder = app.flowBuilder;
  const layout = model.flowLayout(builder.draft, {
    vertical: true,
    nodeWidth: BUILDER.nodeWidth,
    nodeHeight: BUILDER.nodeHeight,
    gapX: BUILDER.gapX,
    gapY: BUILDER.gapY,
    padding: BUILDER.padding,
  });
  const selected = builder.selected;
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
        .children((layout.edges ?? []).flatMap((edge, position) => {
          const index = builderEdgeIndex(builder, edge, position);
          const isSelected = selected?.kind === "edge" && selected.index === index;
          // Das Layout trägt die Geometrie; `max_loops` steht in der Definition.
          const source = builder.draft.edges?.[index] ?? {};
          return builderEdge(app, cx, t, { ...edge, max_loops: source.max_loops }, index, isSelected);
        }))
        .children((layout.nodes ?? []).map((node) => builderNodeCard(
          app, cx, t, node, selected?.kind === "node" && selected.id === node.id,
        ))),
    );
}

function builderPlaceholders(app, cx, t, node) {
  const builder = app.flowBuilder;
  const placeholders = model.flowPlaceholders(builder.draft, node.id) ?? [];
  return v_flex()
    .w_full()
    .gap(S.xs)
    .child(div().text_size(T.xs).text_color(t.dim).child("Platzhalter"))
    .when(placeholders.length === 0, (el) => el.child(
      ui.hint(t, "Keine Platzhalter aus vorherigen Schritten."),
    ))
    .when(placeholders.length > 0, (el) => el.child(
      h_flex().w_full().gap(S.xs).items_center().flex_wrap()
        .children(placeholders.map((entry, position) => ui.chip(
          t, entry.text, t.accent,
          `fabric-flow-builder-placeholder-${node.id}-${position}`,
          {
            tooltip: `${entry.node}.${entry.field}`,
            onClick: (cx) => app.flowBuilderInsertPlaceholder(entry.text, cx),
          },
        ))),
    ))
    .when(Boolean(builder.placeholderHint), (el) => el.child(
      ui.hint(t, "Zuerst ein Textfeld fokussieren, dann den Platzhalter einsetzen."),
    ));
}

function builderOutgoing(app, cx, t, node) {
  const builder = app.flowBuilder;
  const outgoing = model.flowOutgoing(builder.draft, node.id) ?? [];
  return v_flex()
    .w_full()
    .gap(S.xs)
    .child(div().text_size(T.xs).text_color(t.dim)
      .child(`Ausgänge (${outgoing.length})`))
    .when(outgoing.length === 0, (el) => el.child(
      ui.hint(t, "Noch keine Kante. Über das Link-Symbol einen Zielknoten anklicken."),
    ))
    .children(outgoing.map((entry) => {
      const edge = entry.edge ?? {};
      const selected = builder.selected?.kind === "edge" && builder.selected.index === entry.index;
      return h_flex()
        .id(`fabric-flow-builder-outgoing-${node.id}-${entry.index}`)
        .w_full()
        .p(S.s)
        .gap(S.s)
        .items_center()
        .rounded(ui.RADIUS.s)
        .bg(selected ? t.selected : t.surface + ui.ALPHA.clear)
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click((_event, cx) => {
          cx.stop_propagation();
          app.flowBuilderSelectEdge(entry.index, cx);
        })
        .child(div().flex_none().text_size(T.xs).text_color(t.accent).child("→"))
        .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.muted)
          .child(String(edge.to ?? "")).tooltip(String(edge.to ?? "")))
        .when(Boolean(edge.when), (el) => el.child(ui.chip(t, String(edge.when), t.muted)))
        .when(Number(edge.max_loops) > 0, (el) => el.child(
          ui.chip(t, `max ×${Number(edge.max_loops)}`, t.working),
        ))
        .child(ui.iconButton(t, {
          id: `fabric-flow-builder-outgoing-delete-${node.id}-${entry.index}`,
          icon: "trash",
          size: 20,
          iconSize: 11,
          tooltip: "Kante löschen",
          onClick: (cx) => app.flowBuilderDeleteEdge(entry.index, cx),
        }));
    }));
}

function builderNodeInspector(app, cx, t, node) {
  const builder = app.flowBuilder;
  const fields = builder.form?.fields ?? {};
  const parts = [
    h_flex().w_full().min_w(0).gap(S.s).items_center()
      .child(ui.chip(t, model.flowKindWord(node.type) || node.type || "Knoten", t.accent))
      .child(ui.chip(t, node.id, t.dim, null, { tooltip: node.id }))
      .child(div().flex_1()),
  ];
  if (node.type === "trigger") {
    parts.push(ui.field(t, "Auslöser",
      builderDropdown(app, cx, t, "trigger", node.trigger, builderTriggerTypes(),
        (value, cx) => app.flowBuilderSetTrigger(value, cx))));
    if (node.trigger === "cron") {
      parts.push(ui.field(t, "Alle Minuten", fields.every_minutes
        ? ui.numberInput(t, fields.every_minutes)
        : div().text_size(T.xs).text_color(t.blocked).child("Feld nicht verfügbar."),
      { hint: "cron braucht eine positive Minutenzahl." }));
    }
  } else if (node.type === "agent") {
    parts.push(ui.field(t, "Team/Agent",
      builderInput(app, t, "agent", { placeholder: "Team oder Agent" })));
    parts.push(ui.field(t, "Titel",
      builderInput(app, t, "title", { placeholder: "Titel des Tickets" })));
    parts.push(ui.field(t, "Prompt",
      builderTextarea(app, t, "prompt", { height: 120 })));
    parts.push(ui.field(t, "Vorlage",
      builderInput(app, t, "template", { placeholder: "Vorlage (optional)" })));
  } else if (node.type === "action") {
    parts.push(ui.field(t, "Aktion",
      builderDropdown(app, cx, t, "action", node.action, builderActionTypes(),
        (value, cx) => app.flowBuilderSetAction(value, cx))));
    if (node.action === "notify") {
      parts.push(ui.field(t, "Text",
        builderTextarea(app, t, "text", { height: 72 })));
    } else if (node.action === "shell" || node.action === "fab") {
      parts.push(ui.field(t, "Befehl",
        builderTextarea(app, t, "command", { height: 72 }),
        { hint: "Platzhalter werden vor dem Ausführen ersetzt." }));
    }
  } else if (node.type === "condition") {
    parts.push(ui.field(t, "Ausdruck",
      builderTextarea(app, t, "expr", { height: 84 }),
      { hint: "Vergleich wie {{knoten.feld}} == done." }));
  } else if (node.type === "approval") {
    parts.push(ui.field(t, "Text",
      builderTextarea(app, t, "text", { height: 84 }),
      { hint: "Der Lauf pausiert an dieser Freigabe." }));
  } else if (node.type === "end") {
    parts.push(ui.hint(t, "Ende beendet den Lauf."));
  }
  parts.push(builderPlaceholders(app, cx, t, node));
  parts.push(builderOutgoing(app, cx, t, node));
  parts.push(ui.button(t, {
    id: `fabric-flow-builder-node-delete-${node.id}`,
    label: "Knoten löschen",
    icon: "trash",
    danger: true,
    small: true,
    onClick: (cx) => app.flowBuilderDeleteNode(cx),
  }));
  return v_flex().w_full().gap(S.s).children(parts);
}

function builderEdgeInspector(app, cx, t) {
  const builder = app.flowBuilder;
  const edge = (builder.draft.edges ?? [])[builder.selected.index] ?? null;
  if (!edge) return ui.hint(t, "Die Kante existiert nicht mehr.");
  const whenOptions = [
    { value: "", label: "ohne Bedingung" },
    ...(model.flowEdgeWhenOptions(builder.draft, edge.from) ?? [])
      .map((value) => ({ value: String(value), label: String(value) })),
  ];
  return v_flex().w_full().gap(S.s)
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center()
        .child(ui.chip(t, "Kante", t.accent))
        .child(ui.chip(t, edge.from, t.dim, null, { tooltip: edge.from }))
        .child(div().flex_none().text_size(T.xs).text_color(t.accent).child("→"))
        .child(ui.chip(t, edge.to, t.dim, null, { tooltip: edge.to }))
        .child(div().flex_1()),
    )
    .child(ui.field(t, "Bedingung",
      builderDropdown(app, cx, t, "edge-when", edge.when ? String(edge.when) : "",
        whenOptions, (value, cx) => app.flowBuilderSetEdgeWhen(value, cx),
        "ohne Bedingung")))
    .child(ui.field(t, "Schleifenlimit",
      builderInput(app, t, "max_loops", { placeholder: "kein Limit" }),
      { hint: "Leer = kein Limit. Nur nötig, wenn die Kante einen Zyklus schließt." }))
    .child(ui.button(t, {
      id: "fabric-flow-builder-edge-delete",
      label: "Kante löschen",
      icon: "trash",
      danger: true,
      small: true,
      onClick: (cx) => app.flowBuilderDeleteEdge(builder.selected.index, cx),
    }));
}

function builderFlowInspector(app, cx, t) {
  const builder = app.flowBuilder;
  const nodes = Array.isArray(builder.draft.nodes) ? builder.draft.nodes.length : 0;
  const edges = Array.isArray(builder.draft.edges) ? builder.draft.edges.length : 0;
  return v_flex().w_full().gap(S.s)
    .when(builder.fresh, (el) => el.child(ui.field(t, "Name",
      builderInput(app, t, "name", { placeholder: "Workflow-Name" }))))
    .when(!builder.fresh, (el) => el.child(ui.field(t, "Name",
      div().w_full().h(ui.SIZE.input).px(S.m).flex().items_center().rounded(ui.RADIUS.m)
        .border_1().border_color(t.input).bg(t.raised)
        .text_size(T.s).text_color(t.foreground)
        .child(div().min_w(0).truncate().child(String(builder.draft.name ?? ""))))))
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(ui.badge(t, nodes, t.muted))
      .child(div().text_size(T.xs).text_color(t.dim).child("Knoten"))
      .child(ui.badge(t, edges, t.muted))
      .child(div().text_size(T.xs).text_color(t.dim).child("Kanten")))
    .child(ui.hint(t, "Knoten anklicken, um Typfelder und Platzhalter zu bearbeiten. "
      + "Das Link-Symbol am Knoten startet eine Verbindung."))
    .child(ui.hint(t, "Gespeichert wird als JSON über `fab flow add` bzw. `fab flow edit`."));
}

function builderCheck(app, cx, t) {
  const builder = app.flowBuilder;
  const errors = builder.errors ?? [];
  const blocked = errors.length > 0;
  const saving = builder.saving || app.busy === "flow-save";
  const busy = saving || Boolean(app.busy);
  return v_flex()
    .w_full()
    .gap(S.s)
    .pt(S.s)
    .border_t(1)
    .border_color(t.border)
    .child(ui.sectionTitle(t, "Prüfung", [
      ui.badge(t, errors.length, blocked ? t.blocked : t.done),
    ], null))
    .when(!blocked, (el) => el.child(
      div().text_size(T.xs).text_color(t.done).child("Grün: bereit zum Speichern."),
    ))
    .when(blocked, (el) => el.child(v_flex().w_full().gap(S.xs).children(errors.map((text, index) =>
      div().id(`fabric-flow-builder-error-${index}`).w_full().whitespace_normal()
        .text_size(T.xs).text_color(t.blocked).child(`• ${text}`)))))
    .when(blocked, (el) => el.child(
      div().text_size(T.xs).text_color(t.blocked).whitespace_normal()
        .child("Speichern gesperrt: erst die Fehler in der Prüfung beheben."),
    ))
    .child(ui.button(t, {
      id: "fabric-flow-builder-save",
      label: "Speichern",
      icon: "save",
      primary: true,
      fill: true,
      busy: saving,
      disabled: blocked || busy,
      reason: blocked ? "Erst die Fehler in der Prüfung beheben." : "Speichert gerade …",
      tooltip: "Workflow schreiben",
      onClick: (cx) => app.saveFlowBuilder(cx),
    }))
    .child(ui.button(t, {
      id: "fabric-flow-builder-discard",
      label: "Verwerfen",
      icon: "undo",
      fill: true,
      disabled: Boolean(app.busy),
      tooltip: "Änderungen am Builder verwerfen",
      onClick: (cx) => app.flowBuilderDiscard(cx),
    }))
    .when(Boolean(app.errorFor("flow-save")), (el) => el.child(
      ui.notice(t, app.errorFor("flow-save").text, app.errorFor("flow-save").level),
    ));
}

function builderInspector(app, cx, t) {
  const builder = app.flowBuilder;
  const selected = builder.selected;
  const node = selected?.kind === "node"
    ? (builder.draft.nodes ?? []).find((row) => row.id === selected.id) ?? null
    : null;
  return v_flex()
    .w(ui.SIZE.inspector)
    .min_w(ui.SIZE.inspector)
    .h_full()
    .min_h(0)
    .border_l(1)
    .border_color(t.border)
    .bg(t.surface)
    .overflow_y_scrollbar()
    .p(S.m)
    .gap(S.s)
    .child(ui.sectionTitle(t, node ? (model.flowKindWord(node.type) || "Knoten") : "Eigenschaften", [],
      selected?.kind === "edge" ? "Kante" : null))
    .when(selected?.kind === "node" && Boolean(node), (el) => el.child(
      builderNodeInspector(app, cx, t, node),
    ))
    .when(selected?.kind === "edge", (el) => el.child(
      builderEdgeInspector(app, cx, t),
    ))
    .when(!selected, (el) => el.child(builderFlowInspector(app, cx, t)))
    .child(builderCheck(app, cx, t));
}

function pendingNotice(app, cx, t) {
  if (!app.flowPendingName) return null;
  return ui.notice(t,
    `Builder hat ungespeicherte Änderungen… „${app.flowPendingName}“ wurde noch nicht geöffnet.`,
    "warning", {
      actions: [ui.button(t, {
        id: "fabric-flow-builder-pending-discard",
        label: "Verwerfen",
        icon: "undo",
        small: true,
        onClick: (cx) => app.flowBuilderDiscardPending(cx),
      })],
    });
}

function builderDetail(app, cx, t, definition, run) {
  const builder = app.flowBuilder;
  const body = builder
    ? h_flex()
      .flex_1()
      .min_h(0)
      .items_stretch()
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .min_h(0)
          .child(builderPalette(app, cx, t))
          .child(builderCanvas(app, cx, t)),
      )
      .child(builderInspector(app, cx, t))
    : ui.emptyState(t, {
      title: "Builder",
      text: "Der Builder ist noch nicht geöffnet.",
      action: ui.button(t, {
        id: "fabric-flow-builder-open",
        label: "Builder öffnen",
        icon: "lines",
        onClick: (cx) => app.openFlowBuilder(app.flowName, cx),
      }),
    });
  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
    .min_h(0)
    .child(head(app, cx, t, definition, run))
    .when(Boolean(app.flowPendingName), (el) => el.child(pendingNotice(app, cx, t)))
    .child(body);
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
    .w(ui.SIZE.inspector)
    .h_full()
    .min_h(0)
    .border_l(1)
    .border_color(t.border)
    .bg(t.surface)
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center().px(S.m).py(S.s)
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
    .when(Boolean(reason), (el) => el.child(div().w_full().px(S.m).pb(S.xs)
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
  if (app.flowMode === "builder" && (app.flowBuilder || app.flows)) {
    return builderDetail(app, cx, t, definition, run);
  }
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
    .when(Boolean(app.flowPendingName), (el) => el.child(pendingNotice(app, cx, t)))
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
    .child(ui.header(t, model.pageWord("workflows"), [
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
    .when(Boolean(app.errorFor("flow-save")), (el) => el.child(
      ui.notice(t, app.errorFor("flow-save").text, app.errorFor("flow-save").level),
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
