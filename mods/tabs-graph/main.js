import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, shared, setShared, run, openOverlay, theme, window, layout, settings, nextCommand, appHome, readTextFile, notify } from "herdr";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4, GAP_S = 6, GAP_M = 8;
const H_BTN = 26, H_BTN_S = 22, H_ROW_TAB = 28, H_SEG_ITEM = 22, H_BADGE = 16;
const T_XS = 10.5, T_S = 11, T_M = 12;
// Room the strip leaves for "+" (26), the overflow chip (40) and their gaps.
const RESERVED = 26 + 40 + 2 * 4;

// Two kinds of factory view (UX 12): the wide overviews open as popup windows over the
// work, the vertical companions dock into the right side panel beside the terminal.
const POPUPS = [
  { id: "board", label: "Board", icon: "mods/board/icon.svg", fallback: "mods/tabs-graph/board.svg", chord: "⌘⌥8", popup: true, tip: "Board als Popup-Fenster öffnen" },
  { id: "timeline", label: "Timeline", icon: "mods/timeline/icon.svg", chord: "⌘⌥0", popup: true, tip: "Timeline als Popup-Fenster öffnen" },
  { id: "quests", label: "Quests", icon: "mods/quests/icon.svg", chord: "⌘⌥6", popup: true, tip: "Quests als Popup-Fenster öffnen" },
  { id: "teams", label: "Team-Hub", icon: "mods/teams/icon.svg", fallback: "mods/tabs-graph/teams.svg", chord: "⌘⌥9", popup: true, tip: "Team-Hub als Popup-Fenster öffnen" },
];
// Side panel companions: the factory's vertical views, then the tools. Exactly one is
// open at a time; only that one also shows its name.
const SIDEPANELS = [
  { id: "team", label: "Team", icon: "mods/orchestra/icon.svg", chord: "⌘⌥⇧7", tip: "Team-Pipeline im Sidepanel" },
  { id: "factory", label: "Graph", icon: "mods/graph/icon.svg", chord: "⌘⌥7", tip: "Fabrik-Graph im Sidepanel" },
  { id: "inbox", label: "Inbox", icon: "mods/inbox/icon.svg", tip: "Inbox im Sidepanel" },
];
const WERKZEUGE = [
  { id: "changes", label: "Changes", icon: "mods/changes/changes.svg", key: 1, tip: "Changes: Arbeitskopie" },
  { id: "graph", label: "Git", icon: "mods/git-graph/icons/graph.svg", key: 2, tip: "Git: Historie und Zweige" },
  { id: "filetree", label: "Tree", icon: "mods/filetree/folder.svg", key: 3, tip: "Tree: Dateien" },
  { id: "blueprint", label: "Blueprint", icon: "mods/blueprint/icon.svg", key: 4, tip: "Blueprint: Diagramme" },
  { id: "docker", label: "Docker", icon: "mods/docker/icon.svg", key: 5, tip: "Docker: Container" },
];
const PANELS = [...SIDEPANELS, ...WERKZEUGE].map(p => p.id);
const ICONS = [...POPUPS, ...SIDEPANELS, ...WERKZEUGE];

// Status indicator (5.6): one look everywhere, box 12×12. Calm (shared "ui.calm",
// default on) shows the same mark without spinner or pulse; ⌘⇧A toggles (calm).
const calm = () => shared("ui.calm") ?? true;
function statusMark(t, status) {
  const box = div().size(12).flex_none().flex().items_center().justify_center();
  if (status === "working") return calm()
    ? box.child(div().size(7).rounded_full().bg(t.working))
    : box.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900));
  if (status === "blocked") return calm()
    ? box.child(div().size(7).rounded_full().border(1.5).border_color(t.blocked))
    : box.relative()
      .child(div().absolute().size(12).rounded_full().bg(t.blocked + "55").loop("opacity", { from: 0, to: 1, period: 900 }))
      .child(div().size(7).rounded_full().bg(t.blocked));
  if (status === "done") return box.child(div().size(7).rounded_full().bg(t.done));
  if (status === "idle") return box.child(div().size(7).rounded_full().border(1.5).border_color(t.idle));
  return null;
}

// Der aktive Workspace und seine Tickets: dieselbe Regel wie `ui.inScope` in den Panels.
// Dieses Modul hält seine Tokens selbst, deshalb steht der kleine Helfer hier.
const activeSpace = () => spaces().find((s) => s.active) ?? null;

// Agent-Space → Workspace, wie `ui.workspaceId`: der Wegwerf-Space eines Tickets zählt
// als der Workspace seines Tickets (`agent_space`; ältere Auslieferungen nennen ihn
// über ein Terminal mit `hub.ticket`). Ein Space, den ein Ticket als Workspace nennt,
// bleibt Workspace; jeder andere bleibt sein eigener.
function workspaceId(sid, tks, terms) {
  const id = String(sid ?? "").trim();
  if (!id || tks.some((t) => String(t?.space ?? "").trim() === id && String(t?.space_name ?? "").trim())) return id;
  const home = (t) => String(t?.space ?? "").trim();
  const mine = tks.find((t) => String(t?.agent_space ?? "").trim() === id);
  if (mine) return home(mine) && home(mine) !== id ? home(mine) : id;
  for (const x of terms) {
    if ((x.space ?? x.labels?.["herdr.space"]) !== id) continue;
    const tk = tks.find((t) => t?.id === x.labels?.["hub.ticket"]);
    if (tk && home(tk) && home(tk) !== id) return home(tk);
  }
  return id;
}

function inScope(tk, sp, tks, terms) {
  if (!sp) return true;
  const at = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const sid = String(tk?.space ?? "").trim();
  if (!sid || sid === sp.id) return true;
  if (workspaceId(sid, tks, terms) === workspaceId(sp.id, tks, terms)) return true;
  if (String(tk?.space_name ?? "").trim()) return false;
  const repo = at(tk?.repo), folder = at(sp.folder);
  return !repo || !folder ? true : repo === folder || repo.startsWith(`${folder}/`);
}

// Inbox count (contract 7.3): what waits for the person in this workspace's factory,
// else what finished. `total` is the whole home, for the tooltip. The ticket list and
// the terminals are read once: every `shared()`/`terminals()` call copies the whole
// list, and the scope check runs per waiting ticket and per agent.
function inboxCount() {
  const tks = shared("orchestra.tickets") ?? [];
  const terms = terminals();
  const sp = activeSpace();
  const mineWs = sp ? workspaceId(sp.id, tks, terms) : "";
  const count = (sp, ws) => {
    const list = agents();
    const scoped = (a) => !sp || !a.space || workspaceId(a.space, tks, terms) === ws;
    const o = terms.find((x) => x.state === "live" && x.status === "blocked"
      && isOrchestrator(x)
      && (!sp || x.labels?.["hub.space"] === sp.id || x.labels?.["herdr.space"] === sp.id));
    const blocked = list.filter((a) => a.status === "blocked" && scoped(a)).length + (o && !list.some((a) => a.address === o.address) ? 1 : 0);
    const review = tks.filter((x) => x.status === "review" && inScope(x, sp, tks, terms)).length;
    const done = list.filter((a) => a.status === "done" && scoped(a)).length;
    return blocked + review > 0 ? { n: blocked + review, color: "blocked" } : done > 0 ? { n: done, color: "done" } : null;
  };
  const mine = count(sp, mineWs);
  return mine ? { ...mine, total: count(null, "") } : null;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The workspace's orchestration mark (docs/ui/notes-ORCH-MARK.md): one live terminal
// carries it, label hub.role=orchestrator else the name "orchestrator"/"orchestrator-<space>";
// its tab and space come from the panes. Identical in tabs-graph, space-folders, agent-cards.
const ORCH_ICON = "mods/orchestra/orchestrator.svg";
const ORCH_TIP = "Orchestrator dieses Workspace";
// Orchestrator: label hub.role=orchestrator, sonst der Name `orchestrator` bzw.
// `orchestrator-<space>` — dieselbe Regel wie `ui.isOrchestrator` in
// mods/orchestra/ui.js (dieser Klon hat keine ui.js-Kopie).
const isOrchestrator = (x) => x.labels?.["hub.role"] === "orchestrator"
  || x.name === "orchestrator" || String(x.name ?? "").startsWith("orchestrator-");
function orchestration() {
  const live = terminals().filter((x) => x.state === "live" && isOrchestrator(x));
  const tabOf = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p.tab]));
  const tabs = new Set(live.map((x) => tabOf.get(x.address)).filter(Boolean));
  const spaceIds = new Set(spaces().filter((s) => (s.tabs ?? []).some((tb) => tabs.has(tb.id))).map((s) => s.id));
  return { addresses: new Set(live.map((x) => x.address)), tabs, spaces: spaceIds };
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    // Measured widths (real px, from on_size_change): how many tabs the strip can't show.
    this.tabW = {};
    this.stripW = 0;
    this.hidden = 0;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // A panel icon exists only once its package ships; the local placeholder keeps the
    // button readable until then (one check per lookup, the result stays).
    this.icons = {};
    cx.spawn(async () => {
      const found = {};
      for (const p of ICONS) {
        if (!p.fallback) continue;
        let text = null;
        try { text = await readTextFile(`${appHome()}/${p.icon}`); } catch { text = null; }
        found[p.id] = text ? p.icon : p.fallback;
      }
      this.icons = found;
      cx.notify();
    });
    // Keys: tabs-graph.panel toggles the side panel, tabs-graph.panel-<id> toggles one panel.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "panel") this.togglePanel(null);
        else if (c === "calm") this.toggleCalm();
        else if (c.startsWith("panel-") && PANELS.includes(c.slice(6))) this.togglePanel(c.slice(6));
      }
    });
  }

  toggleCalm() {
    const on = !calm();
    setShared("ui.calm", on);
    notify({
      title: on ? "Ruhige Anzeige an" : "Ruhige Anzeige aus",
      body: on ? "Keine Spinner und Pulse" : "Animationen laufen wieder",
      level: "info",
      timeout: 2000,
    });
  }

  togglePanel(id) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel) return;
    const open = !panel.hidden;
    if (id === null) run(open ? "layout.hide" : "layout.show", { id: "panel" });
    else if (open && body?.active === id) run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // How many tabs the strip can't show at once: their measured widths against its width.
  // Independent of the scroll offset, so "+n" stays true after scrolling.
  overflowCount() {
    const ids = this.shownIds ?? [], strip = this.stripW ?? 0;
    if (!strip) return 0;
    let x = 0, n = 0;
    for (const id of ids) {
      const w = this.tabW[id];
      if (w == null) return n;
      if (x + w > strip + 0.5) n++;
      x += w + GAP_XS;
    }
    return n;
  }

  // Only a changed count needs a render: measuring happens while laying out.
  recount(cx) {
    if (this.overflowCount() !== this.hidden) cx.notify();
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const allTabs = space?.tabs ?? [];
    const orch = orchestration();
    // The orchestrator's tab is pinned left (notes-ORCH-MARK.md): display order only,
    // the model keeps its positions.
    const shown = [...allTabs.filter(c => orch.tabs.has(c.id)), ...allTabs.filter(c => !orch.tabs.has(c.id))];
    this.shownIds = shown.map(c => c.id);
    this.hidden = this.overflowCount();
    const stop = (_e, cx) => cx.stop_propagation();
    // Icon button (5.6): 26×26, icon 14, dim; tooltip required.
    const iconButton = (id, icon, tip, action) => div().id(id).size(H_BTN).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop).on_click(action).child(icon);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const isOrch = orch.tabs.has(c.id);
      return h_flex().id(`tab-${c.id}`).h(H_ROW_TAB).px(10).gap(GAP_S).rounded(6).items_center().flex_none().text_size(T_M)
        .on_size_change((s, cx) => {
          if (this.tabW[c.id] === s.width) return;
          this.tabW[c.id] = s.width;
          this.recount(cx);
        })
        .border_1().border_color(isOrch ? t.accent : c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(c.active ? t.raised : t.hover).text_color(t.foreground))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          // The orchestrator's tab stays left; dragging it selects only.
          if (from !== null && from !== i && !isOrch && !orch.tabs.has(shown[from]?.id)) run("tab.move", { id: shown[from].id, index: allTabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(isOrch, el => el.child(div().flex_none().tooltip(ORCH_TIP).child(svg(ORCH_ICON).size(14).flex_none().text_color(t.accent))))
        .when(!isOrch && Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).flex_none().text_color(t.muted) : image(program.icon).size(14).flex_none()))
        .child(div().max_w(170).truncate().tooltip(c.zoomed ? `${name} (gezoomt)` : name).child(c.zoomed ? `${name} Z` : name))
        .when(c.status && c.status !== "idle", el => el.child(statusMark(t, c.status)))
        // No close on the orchestrator's tab: it is the workspace's mark, not a terminal to drop.
        .when(c.active && !isOrch, el => el.child(div().id(`close-${c.id}`).size(16).flex_none().flex().items_center().justify_center().rounded(4)
          .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("Tab schließen (⌘W)")
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
          .child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    this.syncPanel(space, panel, body, PANELS);
    // Two capsules (5.6, icon entries): the wide factory overviews as popups, the side
    // panel companions as one rail. Entries are 22×22; only the open side panel also
    // says its name — names would cost the tab strip ~470 px.
    const segEntry = p => {
      const on = !p.popup && panel && !panel.hidden && body?.active === p.id;
      const tip = p.chord ? `${p.tip} (${p.chord})` : p.key ? `${p.tip} (⌘⌥${p.key})` : p.tip;
      return h_flex().id(`panel-${p.id}`).h(H_SEG_ITEM).when(on, el => el.px(8)).when(!on, el => el.w(H_SEG_ITEM))
        .justify_center().gap(GAP_XS).flex_none().items_center().rounded(6).text_size(T_S)
        .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(on ? t.selected : t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .tooltip(tip)
        .on_click(() => (p.popup ? run("mod.open", { name: p.id }) : this.togglePanel(p.id)))
        .child(svg(this.icons[p.id] ?? p.icon).size(14).flex_none()).when(on, el => el.child(p.label));
    };
    const segment = (id, list) => h_flex().id(id).h(H_BTN).p(2).gap(2).flex_none().items_center().rounded(8)
      .bg(t.background).border_1().border_color(t.border).children(list.map(segEntry));
    // Group 1: Board, Timeline, Quests and Team-Hub hover as popup windows over the work.
    const popupsFabrik = segment("popups-fabrik", POPUPS)
      .tooltip("Breite Übersichten als Popup-Fenster: Board, Timeline, Quests, Team-Hub");
    // Group 2: one side panel rail — factory companions (Team, Graph, Inbox), a 1px
    // divider, then the tools (Changes, Git, Tree, Blueprint, Docker).
    const panelsSidepanel = h_flex().id("panels-sidepanel").h(H_BTN).p(2).gap(2).flex_none().items_center().rounded(8)
      .bg(t.background).border_1().border_color(t.border)
      .tooltip("Sidepanel: Team, Graph und Inbox neben dem Terminal, danach die Werkzeuge")
      .children(SIDEPANELS.map(segEntry))
      .child(div().w(1).h(16).flex_none().bg(t.border))
      .children(WERKZEUGE.map(segEntry));
    // The dashboard is reachable without knowing the chord: same segment shape as the
    // panel groups, never primary. The dashboard carries the reverse ("Workspace").
    const dashboard = h_flex().id("hub-dashboard").h(H_BTN).px(8).gap(GAP_S).flex_none().items_center().rounded(8)
      .bg(t.background).border_1().border_color(t.border).text_size(T_S).text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("Dashboard: Startbildschirm (⌘⇧0)")
      .on_mouse_down("left", stop).on_click(() => run("layout.switch", { name: "dashboard" }))
      .child(svg("mods/dashboard/icon.svg").size(14).flex_none()).child("Dashboard");
    // Primary button (5.6): the one way in for new work.
    const auftrag = h_flex().id("hub-auftrag").h(H_BTN).px(10).gap(GAP_S).flex_none().items_center().rounded(6)
      .bg(t.solid).text_color(t.solid_foreground).text_size(T_M).font_medium().hover(s => s.opacity(0.85))
      .tooltip("Auftrag: neue Arbeit ans Team oder selbst starten (⌘⇧N)")
      .on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "launcher" }))
      .child(svg("mods/launcher/icon.svg").size(14).flex_none()).child("Auftrag");
    // Bar button (5.6) with the inbox count (7.3), the only waiting number outside the
    // inbox: this workspace's factory; the tooltip names the whole home.
    const count = inboxCount();
    const sp = activeSpace();
    const total = count?.total?.n ?? null;
    const inbox = h_flex().id("hub-inbox").h(H_BTN).px(8).gap(GAP_S).flex_none().items_center().rounded(6)
      .text_size(T_M).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(count
        ? `Inbox${sp ? ` · ${sp.name}` : ""}: ${count.n} warten in diesem Workspace${total != null && total !== count.n ? ` · gesamt ${total}` : ""} (⌘⇧J, nächster wartender Agent: ⌘J)`
        : "Inbox: was auf dich wartet (⌘⇧J, nächster wartender Agent: ⌘J)")
      .on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "inbox" }))
      .child(svg("mods/inbox/icon.svg").size(14).flex_none()).child("Inbox")
      .when(Boolean(count), el => el.child(div().h(H_BADGE).px(5).flex().items_center().rounded(8).bg(t[count.color])
        .text_size(T_XS).font_semibold().text_color(t.background).child(String(count.n))));
    // The fixed right side, measured so the strip knows what it may take.
    const winButtons = w?.buttons ? [iconButton("minimize", w.platform === "windows" ? svg("mods/tabs-graph/win-min.svg").size(14) : "−", "Minimieren", () => run("window.minimize")),
      iconButton("maximize", w.platform === "windows" ? svg(`mods/tabs-graph/${w.maximized ? "win-restore" : "win-max"}.svg`).size(14) : "□", "Maximieren", () => run("window.maximize")),
      iconButton("close-window", w.platform === "windows" ? svg("mods/tabs-graph/win-close.svg").size(14) : svg("mods/pane/close.svg").size(14), "Fenster schließen", () => run("window.close"))] : [];
    const right = h_flex().id("tab-right").flex_none().gap(GAP_M).items_center()
      .on_size_change((s, cx) => {
        if (Math.abs((this.rightW ?? 0) - s.width) < 1) return;
        this.rightW = s.width;
        cx.notify();
      })
      .children([dashboard, auftrag, inbox,
        iconButton("hub-review", svg("mods/review/icon.svg").size(14), "Review des fokussierten Terminals (⌘⇧R)", () => run("mod.open", { name: "review" })),
        popupsFabrik, panelsSidepanel])
      .when(winButtons.length > 0, el => el.child(h_flex().flex_none().gap(GAP_XS).children(winButtons)));
    const zoom = settings().zoom || 1;
    // Room for the strip: the bar minus everything right of it (measured, real px ÷ zoom).
    // A cap keeps the strip from eating the fixed buttons when its tabs don't fit.
    const stripMax = (this.barW ?? 0) > 0
      ? Math.max(120, (this.barW - (this.rightW ?? 0)) / zoom - RESERVED - lightsPadding - 10 - 2 * GAP_M)
      : 0;
    // Only whole tabs show (a tile cut mid-word reads as broken); the rest count into "+n".
    // Measured in real px, like the tab widths; back to layout px for max_w.
    const wholeTabs = (() => {
      const avail = stripMax * zoom;
      if (!(avail > 0)) return 0;
      let x = 0;
      for (const id of this.shownIds ?? []) {
        const w = this.tabW[id];
        if (w == null) return 0; // not measured yet: no cap this frame
        if (x + w > avail + 0.5) break;
        x += w + GAP_XS * zoom;
      }
      return x > 0 ? x / zoom : 0;
    })();
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(GAP_M).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_size_change((s, cx) => {
        // Real px here; dividing by the zoom gives the layout px the rest of the bar uses.
        if (Math.abs((this.barW ?? 0) - s.width) < 20) return;
        this.barW = s.width;
        cx.notify();
      })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // Tabs scroll in their own strip; "+" and the overflow count stay beside it, so they are
      // reachable with any number of tabs (the rest of the bar drags the window).
      .child(h_flex().flex_shrink_1().min_w(0).h_full().items_center().gap(GAP_XS)
        .child(h_flex().id("tab-scroll").flex_shrink_1().min_w(0).h_full().items_center().gap(GAP_XS).overflow_x_scrollbar()
          .when(wholeTabs > 0 ? wholeTabs < stripMax : stripMax > 0, el => el.max_w(Math.floor(wholeTabs > 0 ? wholeTabs : stripMax)))
          .on_size_change((s, cx) => {
            if (this.stripW === s.width) return;
            this.stripW = s.width;
            this.recount(cx);
          })
          .children(shown.map(item)))
        .when(this.hidden > 0, el => el.child(h_flex().id("tab-more").h(H_BTN_S).px(6).flex_none().items_center().rounded(6)
          .bg(t.raised).text_size(T_XS).font_medium().text_color(t.muted).cursor_pointer()
          .tooltip(`${this.hidden} Tab${this.hidden === 1 ? "" : "s"} passen nicht in die Leiste: scrollen oder ⌘⇧] (nächster Tab)`)
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", stop).on_click(() => run("tab.next")).child(`+${this.hidden}`)))
        .child(iconButton("tab-new", svg("mods/workspace-chrome/plus.svg").size(14), "Neuer Tab: Terminal oder Agent (⌘T)",
          () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))))
      .child(div().flex_1().min_w(0))
      // Everything right of the strip: measured so the strip knows what it may take.
      .child(right);
  }
}
