import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, shared, run, openOverlay, theme, window, layout, settings, nextCommand } from "herdr";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4, GAP_S = 6, GAP_M = 8;
const H_BTN = 26, H_ROW_TAB = 28, H_SEG_ITEM = 22, H_BADGE = 16;
const T_XS = 10.5, T_S = 11, T_M = 12;

// Panel group by factory role: Fabrik (Quests, Team) ‖ Werkzeuge. Keys stay ⌘⌥1 … ⌘⌥7.
const FABRIK = [
  { id: "quests", label: "Quests", icon: "mods/quests/icon.svg", key: 6, tip: "Quests: alle Signale und Tickets" },
  { id: "team", label: "Team", icon: "mods/orchestra/icon.svg", key: 7, tip: "Team: Pipeline der Tickets" },
];
const WERKZEUGE = [
  { id: "changes", label: "Changes", icon: "mods/changes/changes.svg", key: 1, tip: "Changes: Arbeitskopie" },
  { id: "graph", label: "Git", icon: "mods/git-graph/icons/graph.svg", key: 2, tip: "Git: Historie und Zweige" },
  { id: "filetree", label: "Tree", icon: "mods/filetree/folder.svg", key: 3, tip: "Tree: Dateien" },
  { id: "blueprint", label: "Blueprint", icon: "mods/blueprint/icon.svg", key: 4, tip: "Blueprint: Diagramme" },
  { id: "docker", label: "Docker", icon: "mods/docker/icon.svg", key: 5, tip: "Docker: Container" },
];
const PANELS = [...WERKZEUGE, ...FABRIK].map(p => p.id);

// Status indicator (5.6): one look everywhere, box 12×12.
function statusMark(t, status) {
  const box = div().size(12).flex_none().flex().items_center().justify_center();
  if (status === "working") return box.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900));
  if (status === "blocked") return box.relative()
    .child(div().absolute().size(12).rounded_full().bg(t.blocked + "55").loop("opacity", { from: 0, to: 1, period: 900 }))
    .child(div().size(7).rounded_full().bg(t.blocked));
  if (status === "done") return box.child(div().size(7).rounded_full().bg(t.done));
  if (status === "idle") return box.child(div().size(7).rounded_full().border(1.5).border_color(t.idle));
  return null;
}

// Inbox count (contract 7.3): what waits for the person, else what finished.
function inboxCount() {
  const list = agents();
  const orch = terminals().find(x => x.name === "orchestrator" && x.state === "live" && x.status === "blocked");
  const blocked = list.filter(a => a.status === "blocked").length + (orch && !list.some(a => a.address === orch.address) ? 1 : 0);
  const review = (shared("orchestra.tickets") ?? []).filter(x => x.status === "review").length;
  const done = list.filter(a => a.status === "done").length;
  return blocked + review > 0 ? { n: blocked + review, color: "blocked" } : done > 0 ? { n: done, color: "done" } : null;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Keys: tabs-graph.panel toggles the side panel, tabs-graph.panel-<id> toggles one panel.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "panel") this.togglePanel(null);
        else if (c.startsWith("panel-") && PANELS.includes(c.slice(6))) this.togglePanel(c.slice(6));
      }
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

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    // Icon button (5.6): 26×26, icon 14, dim; tooltip required.
    const iconButton = (id, icon, tip, action) => div().id(id).size(H_BTN).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop).on_click(action).child(icon);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(H_ROW_TAB).px(10).gap(GAP_S).rounded(6).items_center().flex_none().text_size(T_M)
        .border_1().border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(c.active ? t.raised : t.hover).text_color(t.foreground))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).flex_none().text_color(t.muted) : image(program.icon).size(14).flex_none()))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status && c.status !== "idle", el => el.child(statusMark(t, c.status)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).size(16).flex_none().flex().items_center().justify_center().rounded(4)
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
    // Segment, icon variant (5.6): entries 22×22, the open panel also says its name.
    const segEntry = p => {
      const on = panel && !panel.hidden && body?.active === p.id;
      return h_flex().id(`panel-${p.id}`).h(H_SEG_ITEM).when(on, el => el.px(8)).when(!on, el => el.w(H_SEG_ITEM))
        .justify_center().gap(GAP_XS).flex_none().items_center().rounded(6).text_size(T_S)
        .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(on ? t.selected : t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .tooltip(`${p.tip} (⌘⌥${p.key})`)
        .on_click(() => this.togglePanel(p.id))
        .child(svg(p.icon).size(14).flex_none()).when(on, el => el.child(p.label));
    };
    const segment = (id, list) => h_flex().id(id).h(H_BTN).p(2).gap(2).flex_none().items_center().rounded(8)
      .bg(t.background).border_1().border_color(t.border).children(list.map(segEntry));
    // Primary button (5.6): the one way in for new work.
    const auftrag = h_flex().id("hub-auftrag").h(H_BTN).px(10).gap(GAP_S).flex_none().items_center().rounded(6)
      .bg(t.solid).text_color(t.solid_foreground).text_size(T_M).font_medium().hover(s => s.opacity(0.85))
      .tooltip("Auftrag: neue Arbeit ans Team oder selbst starten (⌘⇧N)")
      .on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "launcher" }))
      .child(svg("mods/launcher/icon.svg").size(14).flex_none()).child("Auftrag");
    // Bar button (5.6) with the inbox count (7.3), the only waiting number outside the inbox.
    const count = inboxCount();
    const inbox = h_flex().id("hub-inbox").h(H_BTN).px(8).gap(GAP_S).flex_none().items_center().rounded(6)
      .text_size(T_M).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Inbox: was auf dich wartet (⌘⇧J, nächster wartender Agent: ⌘J)")
      .on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "inbox" }))
      .child(svg("mods/inbox/icon.svg").size(14).flex_none()).child("Inbox")
      .when(Boolean(count), el => el.child(div().h(H_BADGE).px(5).flex().items_center().rounded(8).bg(t[count.color])
        .text_size(T_XS).font_semibold().text_color(t.background).child(String(count.n))));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(GAP_M).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // Tabs, then "+" right behind the last one (opens a tab, like a browser); the rest of the bar drags the window.
      .child(h_flex().id("tab-scroll").flex_shrink_1().min_w(0).h_full().items_center().gap(GAP_XS).overflow_x_scrollbar()
        .children(shown.map(item))
        .child(iconButton("tab-new", svg("mods/workspace-chrome/plus.svg").size(14), "Neuer Tab: Terminal oder Agent (⌘T)",
          () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))))
      .child(div().flex_1().min_w(0))
      .child(auftrag)
      .child(inbox)
      .child(iconButton("hub-review", svg("mods/review/icon.svg").size(14), "Review des fokussierten Terminals (⌘⇧R)", () => run("mod.open", { name: "review" })))
      .child(segment("panels-fabrik", FABRIK))
      .child(segment("panels-werkzeuge", WERKZEUGE))
      .when(w?.buttons, el => el.child(h_flex().flex_none().gap(GAP_XS)
        .child(iconButton("minimize", w.platform === "windows" ? svg("mods/tabs-graph/win-min.svg").size(14) : "−", "Minimieren", () => run("window.minimize")))
        .child(iconButton("maximize", w.platform === "windows" ? svg(`mods/tabs-graph/${w.maximized ? "win-restore" : "win-max"}.svg`).size(14) : "□", "Maximieren", () => run("window.maximize")))
        .child(iconButton("close-window", w.platform === "windows" ? svg("mods/tabs-graph/win-close.svg").size(14) : svg("mods/pane/close.svg").size(14), "Fenster schließen", () => run("window.close")))));
  }
}
