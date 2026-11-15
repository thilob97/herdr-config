// Fabrik-Graph: die Fabrik des aktiven Workspace als Baum von oben nach unten.
// Oben der Orchestrator (Krone, „verteilt …“), darunter seine Agents in eigenen
// Spalten über die Panelbreite: eine kompakte Zeile aus Avatar in Agent-Farbe,
// Name und Status-Chip, darunter der Ticket-Chip mit Kürzel und Status-Punkt.
// Sub-Agents hängen eingerückt unter ihrem Parent. Kanten sind orthogonal:
// Dispatch Orchestrator→Agent, Parent Agent→Sub-Agent, und Ticket→Blocker aus
// `blocked_by` (gestrichelt nur, wenn der Blocker erledigt ist; liegt er
// außerhalb des Scopes, sagt der Chip „wartet auf …“).
//
// Daten: `hub timeline --json --all` alle 15 s (Scope hier wie in den Panels:
// ui.inScope für Tickets, Agent-Space→Workspace über ui.workspaceId) und
// `shared("orchestra.tickets")` für Status, Titel und blocked_by. Ruhig
// (shared "ui.calm"): keine Animation, laufende Karten tragen nur Farbe/Rand.
// Das Panel ist Block `factory` in elric; als Fenster öffnet es
// `mod.open:graph` (mod.json overlay).
import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, appHome, shared, setShared, theme, settings, props, openOverlay, closeOverlay, run, nextCommand, layout, terminals, updates } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, GAP_XS, GAP_S, INSET_PANEL } from "./ui.js";
import { layoutGraph } from "./layout.js";

const HUB = () => `${appHome()}/mods/orchestra/bin/hub`;
const REFRESH = 15000;
// Zeitfenster wie die Timeline; „Alles“ zeigt die ganze Aufzeichnung.
const SPANS = { "1h": 3600, "24h": 86400, "7d": 604800, all: null };
const WINDOWS = [
  { value: "1h", label: "1 h", tip: "die letzte Stunde" },
  { value: "24h", label: "24 h", tip: "die letzten 24 Stunden" },
  { value: "7d", label: "7 Tage", tip: "die letzten 7 Tage" },
  { value: "all", label: "Alles", tip: "seit dem Beginn der Aufzeichnung" },
];
const FILTERS = [
  { value: "all", label: "Alle", tip: "alle Agents im Zeitfenster" },
  { value: "working", label: "läuft", tip: "nur was gerade arbeitet" },
  { value: "blocked", label: "wartet", tip: "nur was wartet" },
  { value: "done", label: "fertig", tip: "nur was fertig ist" },
];
// Eine Farbe je Agent, stabil über den Lauf: der Avatar trägt sie am Rand.
const COLORS = (t) => [t.accent, t.ansi2, t.ansi5, t.ansi3, t.ansi6, t.ansi4, t.ansi1, t.ansi12, t.ansi10, t.ansi13];

// Herdr ab 0.1.12 zoomt `paint_path` selbst (wie `git-graph`: `pathScale()`
// liefert dann 1); davor lagen die Linien in Layout-Einheiten und brauchten den
// Zoom. Ohne diese Unterscheidung laufen Kanten 20 % neben den Karten.
let listsZoom;
const pathScale = () => listsZoom ??= (() => {
  try {
    const v = updates()?.app?.version;
    if (!v) return Number(settings().zoom) > 0 ? Number(settings().zoom) : 1;
    const [a, b, c] = String(v).split(".").map(Number);
    return a > 0 || b > 1 || (b === 1 && c >= 12) ? 1 : (Number(settings().zoom) > 0 ? Number(settings().zoom) : 1);
  } catch { return 1; }
})();

const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "").replace(/^hub: /, "");
const lastLine = (r) => (r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop().slice(0, 240);

/** Sekunden aus Sekunden, Millisekunden oder einem ISO-/Datumsstring; null ohne Wert. */
function sec(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 1e12 ? v / 1000 : v;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
  const d = Date.parse(v);
  return Number.isFinite(d) ? d / 1000 : null;
}

const normSub = (s) => ({
  id: String(s?.id ?? s?.name ?? ""),
  title: String(s?.title ?? s?.description ?? s?.id ?? "Sub-Agent"),
  started: sec(s?.started) ?? sec(s?.at),
  ended: sec(s?.ended),
});
const normEvent = (e) => ({ at: sec(e?.at) ?? sec(e?.time) });
const normLane = (l) => ({
  id: String(l?.id ?? l?.terminal ?? l?.label ?? ""),
  label: String(l?.label ?? l?.name ?? l?.id ?? "?"),
  kind: ["orchestrator", "reviewer", "subagent"].includes(l?.kind) ? l.kind : "agent",
  parent: l?.parent ?? null,
  ticket: l?.ticket || null,
  terminal: l?.terminal || null,
  start: sec(l?.start),
  end: sec(l?.end),
  status: ["working", "blocked", "done", "idle"].includes(l?.status) ? l.status : null,
  cost: Number.isFinite(Number(l?.cost)) ? Number(l.cost) : null,
  space: String(l?.space ?? ""),
  events: (Array.isArray(l?.events) ? l.events : []).map(normEvent).filter((e) => e.at != null),
  subagents: (Array.isArray(l?.subagents) ? l.subagents : []).map(normSub).filter((s) => s.id),
});

export default class FactoryGraph extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.data = null;
    this.received = 0;
    this.loaded = false;
    this.error = null;
    this.lastOk = null;
    this.reading = false;
    this.width = 0;
    this.hover = null;
    this.space = ui.activeSpace()?.id ?? "";
    this.filter = FILTERS.some((f) => f.value === localStorage.getItem("graph.filter"))
      ? localStorage.getItem("graph.filter") : "all";
    this.window = WINDOWS.some((w) => w.value === localStorage.getItem("graph.window"))
      ? localStorage.getItem("graph.window") : "all";
    this.read(cx);
    // Dieselbe Kadenz wie die Timeline: kein zusätzliches Pollen unter 5 s.
    cx.timer.every(REFRESH, (cx) => this.read(cx));
    // Der Tab-Knopf öffnet das Panel auch aus einem anderen Panel heraus; die
    // Filter sind zusätzlich als Kommando erreichbar (`graph.filter-done`,
    // `graph.window-24h`) — für keys.json und das Testfenster.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (!props()?.overlay && c === "panel") { this.showPanel(cx); continue; }
        const f = /^filter-(all|working|blocked|done)$/.exec(c);
        if (f) { this.filter = f[1]; localStorage.setItem("graph.filter", f[1]); cx.notify(); continue; }
        const w = /^window-(1h|24h|7d|all)$/.exec(c);
        if (w) { this.window = w[1]; localStorage.setItem("graph.window", w[1]); cx.notify(); }
      }
    });
    cx.timer.after(50, () => this.handle.focus());
  }

  // ---------- Daten ----------

  /** Scope der Fabrik dieses Workspace, wie die Panels: ein Agent-Space zählt als
   *  der Workspace seines Tickets; Alt-Lanes ohne `space` bleiben sichtbar. */
  inWorkspace(space) {
    const sp = ui.activeSpace();
    if (!sp) return true;
    const sid = String(space ?? "").trim();
    return !sid || ui.workspaceId(sid) === ui.workspaceId(sp.id);
  }

  tickets() {
    return (shared("orchestra.tickets") ?? []).filter((tk) => tk?.id && ui.inScope(tk));
  }

  read(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        // `--all` holt die Lanes aller Fabriken; der Scope gehört an das Fenster,
        // nicht an den Space, aus dem der App-Prozess zufällig läuft.
        const r = await exec(HUB(), ["timeline", "--json", "--all"], { timeout: 15000 });
        if (r.code === 0) {
          const d = JSON.parse(r.stdout || "{}");
          this.data = {
            now: sec(d.now) ?? Date.now() / 1000,
            lanes: (Array.isArray(d.lanes) ? d.lanes : []).map(normLane).filter((l) => l.id && this.inWorkspace(l.space)),
          };
          this.received = Date.now() / 1000;
          this.loaded = true;
          this.error = null;
          this.lastOk = Date.now();
        } else {
          const msg = lastLine(r);
          this.error = /invalid choice|unrecognized arguments/.test(msg)
            ? "hub timeline fehlt noch — die Datenquelle entsteht parallel." : msg;
        }
      } catch (e) {
        this.error = errorText(e);
      } finally {
        this.reading = false;
        cx.notify();
      }
    });
  }

  now() {
    if (!this.data) return Date.now() / 1000;
    return this.data.now + Math.max(0, Date.now() / 1000 - this.received);
  }

  // ---------- Aktionen ----------

  /** `hub timeline` meldet für ein laufendes Terminal den Zustand „live“, nicht den
   *  Status seines Agents (die Timeline fällt dann auf arbeitet/fertig zurück).
   *  Hier zählt der echte Status aus terminals(): arbeitet/wartet/fertig/ruhig. */
  laneStatus(lane) {
    if (["working", "blocked", "done", "idle"].includes(lane.status)) return lane.status;
    const t = terminals().find((x) => x.address === lane.terminal);
    return ["working", "blocked", "done", "idle"].includes(t?.status) ? t.status : lane.status;
  }

  openLane(node) {
    if (node.terminal) ui.focusAgent(node.terminal);
    else if (node.ticket) this.openTicket(node.ticket);
  }

  openTicket(id) {
    if (!id) return;
    const tk = this.tickets().find((x) => x.id === id);
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
      props: { ticket: id, terminal: tk?.terminal || null, folder: tk?.worktree || tk?.repo, on: tk?.machine || null } });
  }

  /** Orchestrator dieses Workspace starten — derselbe Weg wie das Team-Panel. */
  start(cx) {
    const sp = ui.activeSpace();
    if (!sp) { this.error = "Kein aktiver Space: der Orchestrator braucht einen Workspace."; cx.notify(); return; }
    setShared("orchestra.autostart", true);
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["orchestrator", "start", "--agent", shared("orchestra.agent") ?? "omp", "--space", sp.id]);
        if (r.code !== 0) this.error = lastLine(r);
        else this.read(cx);
      } catch (e) {
        this.error = errorText(e);
      }
      cx.notify();
    });
  }

  /** Der Tab-Knopf ruft `factory.panel`; das Panel zeigt und selektiert den Block. */
  showPanel(cx) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body"), me = find(root, "factory");
    if (!panel || !body || !me) { cx.notify(); return; }
    if (body.active !== "factory") run("layout.select", { stack: "panel-body", child: "factory" });
    if (panel.hidden) run("layout.show", { id: "panel" });
  }

  // ---------- Zeichnen ----------

  /** Orthogonaler Kantenzug mit gerundeten Ecken; Koordinaten wie in `git-graph`
   *  mit dem Zoom multipliziert, weil `paint_path` nicht mitzoomt. */
  polyline(p, points, z) {
    const pts = points.map(([x, y]) => [x * z, y * z]);
    if (!pts.length) return p;
    p = p.move_to(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
      const d1 = Math.hypot(cx - px, cy - py) || 1, d2 = Math.hypot(nx - cx, ny - cy) || 1;
      const r = Math.min(6 * z, d1 / 2, d2 / 2);
      const ax = cx + (px - cx) / d1 * r, ay = cy + (py - cy) / d1 * r;
      const bx = cx + (nx - cx) / d2 * r, by = cy + (ny - cy) / d2 * r;
      p = p.line_to(ax, ay)
        .cubic_bezier_to(bx, by, ax + (cx - ax) * 0.55, ay + (cy - ay) * 0.55, bx + (cx - bx) * 0.55, by + (cy - by) * 0.55);
    }
    const last = pts[pts.length - 1];
    return p.line_to(last[0], last[1]);
  }

  path(t, edge, hot) {
    const z = pathScale();
    const width = (edge.kind === "ticket" || edge.faint ? 1 : 1.5) * z;
    let p = PathBuilder.stroke(width);
    if (edge.dashed) p = p.dash_array([3 * z, 3 * z]);
    p = this.polyline(p, edge.points, z);
    // Pfeilspitze aus der Richtung des letzten Segments: sie zeigt beim Baum auf
    // das Kind, beim Ticket-Pfeil auf den Blocker.
    const [x2, y2] = edge.points[edge.points.length - 1];
    const [x1, y1] = edge.points[edge.points.length - 2] ?? edge.points[0];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, back = 6, wing = 3.2;
    p = p.move_to((x2 - ux * back + nx * wing) * z, (y2 - uy * back + ny * wing) * z)
      .line_to(x2 * z, y2 * z)
      .line_to((x2 - ux * back - nx * wing) * z, (y2 - uy * back - ny * wing) * z);
    const color = hot ? t.accent : edge.faint ? t.border : edge.kind === "ticket" ? t.dim : t.muted;
    return { path: p.build(), color };
  }

  avatar(t, node, color) {
    const who = ui.identity(node.terminal), size = node.narrow ? 16 : 18;
    if (who.named && who.avatar) {
      return image(who.avatar).w(size).h(size).flex_none().rounded_full().border(2).border_color(color);
    }
    const initial = (who.name || node.label || "?").trim().slice(0, 1).toUpperCase() || "?";
    return div().size(size).flex_none().rounded_full().border(1).border_color(color).bg(color + "26")
      .flex().items_center().justify_center().text_size(T_XS).font_semibold().text_color(color).child(initial);
  }

  /** Kompakte Karte: Avatar, Name, Status-Chip. Der Orchestrator ist die Wurzel
   *  mit Krone und „verteilt …“; schmale Panels stapeln Name und Status. */
  card(t, node, color) {
    const who = ui.identity(node.terminal);
    const hot = this.hover === node.id;
    const border = hot ? t.accent : node.kind === "orchestrator" ? t.accent + "66" : undefined;
    const name = who.named ? who.name : node.label;
    const tip = [node.label, node.ticket, ui.STATUS_WORD[node.status]].filter(Boolean).join(" · ");
    const el = div().id(node.id).relative().absolute().left(node.x).top(node.y).w(node.w).h(node.h)
      .rounded(8).bg(t.surface).border_1().border_color(border ?? t.border).cursor_pointer().tooltip(tip)
      .on_hover((on, cx) => {
        const next = on ? node.id : this.hover === node.id ? null : this.hover;
        if (next !== this.hover) { this.hover = next; cx.notify(); }
      })
      .on_click((_e, cx) => { cx.stop_propagation(); this.openLane(node); });
    const avatar = this.avatar(t, node, color);
    const title = div().flex_1().min_w(0).truncate().text_size(node.narrow ? T_XS : T_S).font_semibold()
      .text_color(node.kind === "subagent" ? t.muted : t.foreground).tooltip(tip).child(name);
    const status = ui.statusChip(t, node.status);
    if (node.kind === "orchestrator") {
      return el.px(10).py(4).flex().flex_col().justify_center().gap(1)
        .child(h_flex().w_full().gap(GAP_S).items_center().min_w(0)
          .child(div().flex_none().tooltip("Orchestrator dieses Workspace")
            .child(svg("mods/orchestra/orchestrator.svg").size(12).flex_none().text_color(t.accent)))
          .child(avatar).child(title).child(status))
        .child(div().w_full().min_w(0).truncate().text_size(T_XS).text_color(t.dim).child(node.subtitle ?? ""));
    }
    // Eine Zeile, auch im schmalen Panel: Avatar, Name (gekürzt), Status-Chip.
    return el.px(node.narrow ? 6 : 7).flex().items_center().gap(node.narrow ? 3 : GAP_XS).min_w(0)
      .child(avatar).child(title).child(status);
  }

  /** Der Ticket-Chip ist eine eigene Zeile direkt unter der Karte: Kürzel und
   *  Status-Punkt. Er ist der Knoten der blocked_by-Pfeile. */
  chip(t, chip, tickets) {
    const tk = tickets.find((x) => x.id === chip.ticket);
    const stage = { todo: t.dim, doing: t.accent, review: t.ansi5, done: t.success };
    const color = chip.waits.length ? t.blocked : stage[chip.status] ?? t.muted;
    const tip = [chip.ticket, tk?.title, ui.STAGE_WORD[chip.status], chip.waits.length ? `wartet auf ${chip.waits.map((w) => w.short).join(", ")}` : null]
      .filter(Boolean).join(" · ");
    return h_flex().id(chip.id).absolute().left(chip.x).top(chip.y).w(chip.w).h(chip.h).px(6).gap(GAP_XS).items_center()
      .rounded(4).bg(color + "22").text_color(color).text_size(T_XS).font_medium().cursor_pointer().tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_hover((on, cx) => {
        // Der Chip gehört zur Karte: beide heben dieselben Pfeile hervor.
        const next = on ? chip.node : this.hover === chip.node ? null : this.hover;
        if (next !== this.hover) { this.hover = next; cx.notify(); }
      })
      .on_click((_e, cx) => { cx.stopPropagation?.(); this.openTicket(chip.ticket); })
      .child(div().size(5).flex_none().rounded_full().bg(color))
      .child(div().min_w(0).truncate().child(chip.label));
  }

  board(t, g, tickets) {
    const colors = COLORS(t);
    const colorOf = new Map();
    for (const node of g.nodes) if (!colorOf.has(node.laneId)) colorOf.set(node.laneId, colors[colorOf.size % colors.length]);
    const hoverChips = new Set(g.ticketNodes.filter((c) => c.node === this.hover).map((c) => c.id));
    const layers = g.edges.map((edge) => {
      const hot = Boolean(this.hover) && (edge.to === this.hover || edge.from === this.hover
        || hoverChips.has(edge.from) || hoverChips.has(edge.to));
      const { path, color } = this.path(t, edge, hot);
      return div().absolute().left(0).top(0).w(g.width).h(g.height).child(window.paint_path(path, color));
    });
    // Reihenfolge: Linien hinten, Karten, Ticket-Chips obenauf.
    const cards = g.nodes.map((node) => this.card(t, node, colorOf.get(node.laneId)));
    const chips = g.ticketNodes.map((c) => this.chip(t, c, tickets));
    return div().id("fg-scroll").flex_1().min_h(0).overflow_scrollbar()
      .child(div().id("fg-canvas").relative().w(g.width).h(g.height)
        .children(layers).children(cards).children(chips));
  }

  toolbar(t) {
    const note = this.error
      ? div().id("fg-note").flex_shrink_1().min_w(0).truncate().text_size(T_XS).text_color(t.dim)
        .tooltip(this.error).child(this.error)
      : !this.loaded ? ui.loading(t) : null;
    return h_flex().id("fg-toolbar").flex_none().px(INSET_PANEL).py(6).gap(GAP_S).flex_wrap().items_center()
      .child(ui.segment(t, "fg-filter", FILTERS, this.filter, (v, cx) => {
        this.filter = v;
        localStorage.setItem("graph.filter", v);
        cx.notify();
      }))
      .child(ui.segment(t, "fg-window", WINDOWS, this.window, (v, cx) => {
        this.window = v;
        localStorage.setItem("graph.window", v);
        cx.notify();
      }))
      .child(div().flex_1())
      .when(Boolean(note), (el) => el.child(note));
  }

  emptyState(t, cx) {
    const lanes = this.data?.lanes ?? [];
    if (!lanes.length) {
      return ui.empty(t, "Noch keiner in diesem Workspace", {
        icon: "mods/orchestra/icon.svg",
        action: ui.button(t, "fg-start", "Orchestrator starten", (c) => this.start(c), {
          kind: "primary", small: true,
          tip: `hub orchestrator start --space ${ui.activeSpace()?.id ?? "<space>"}: der Orchestrator dieses Workspace`,
        }),
      });
    }
    return ui.empty(t, "Kein Agent in diesem Filter.", {
      icon: "mods/graph/icon.svg",
      action: ui.link(t, "fg-clear", "Alle anzeigen", (c) => {
        this.filter = "all";
        this.window = "all";
        localStorage.setItem("graph.filter", "all");
        localStorage.setItem("graph.window", "all");
        c.notify();
      }),
    });
  }

  render(cx) {
    const t = theme();
    // Space-Wechsel (spaces() zeichnet neu): den neuen Workspace sofort lesen.
    const sid = ui.activeSpace()?.id ?? "";
    if (sid !== this.space) { this.space = sid; this.read(cx); }
    const now = this.now();
    const span = SPANS[this.window] ?? null;
    const tickets = this.tickets();
    const lanes = (this.data?.lanes ?? []).map((l) => ({ ...l, status: this.laneStatus(l) }));
    const g = layoutGraph({ lanes, tickets, now, windowStart: span ? now - span : null, filter: this.filter,
      width: this.width || 400 });
    const agents = g.nodes.filter((n) => n.kind !== "orchestrator").length;
    const scope = ui.spaceChip(t);
    const meta = `${agents} Agent${agents === 1 ? "" : "en"} · ${g.ticketNodes.length} Tickets`;
    const header = props()?.overlay
      ? ui.windowHeader(t, "Fabrik-Graph", [scope].filter(Boolean), () => closeOverlay(props().overlay), { meta, metaTip: "Agents und Tickets der Fabrik dieses Workspace" })
      : ui.panelHeader(t, "Fabrik-Graph", [scope].filter(Boolean), { count: meta });

    const content = !this.loaded && !this.error
      ? v_flex().flex_1().min_h(0).child(ui.loading(t))
      : g.nodes.length
        ? this.board(t, g, tickets)
        : v_flex().id("fg-empty").flex_1().min_h(0).child(this.emptyState(t, cx));

    return v_flex().id("factory-graph").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .on_size_change((size, cx) => {
        const w = Math.round(size.width / (settings().zoom || 1));
        if (Math.abs(w - this.width) > 2) { this.width = w; cx.notify(); }
      })
      .child(header)
      .child(this.toolbar(t))
      .child(content);
  }
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
