import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, theme, window, layout, settings, nextCommand } from "herdr";

const PANELS = ["changes", "graph", "filetree", "blueprint", "docker", "quests", "team"];

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
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = PANELS;
    this.syncPanel(space, panel, body, enabled);
    // Panels as one quiet segmented group: icons, the open one also says its name.
    const panelButton = (id, label, icon, key) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(24).px(on ? 8 : 0).when(!on, el => el.w(26)).justify_center().gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(on ? t.selected : t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .tooltip(`${label} (⌘⌥${key})`)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).when(on, el => el.child(label));
    };
    // Agent hub: the inbox (with how many wait) and the review of the focused terminal.
    const needs = agents().filter(a => a.status === "blocked").length, done = agents().filter(a => a.status === "done").length;
    const hubButton = (id, label, icon, tip, action, count, color) => h_flex().id(id).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop).on_click(action)
      .child(svg(icon).size(14)).child(label)
      .when(count > 0, el => el.child(div().px(5).h(16).flex().items_center().rounded(8).bg(color).text_size(10.5).font_semibold().text_color(t.background).child(String(count))));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .child(hubButton("hub-launch", "Starten", "mods/launcher/icon.svg", "Agent starten: Vorlage, Agents, Worktree (⌘⇧N)", () => run("mod.open", { name: "launcher" }), 0, null))
      .child(hubButton("hub-inbox", "Inbox", "mods/inbox/icon.svg", "Inbox: wartende Agents (⌘⇧J, nächster: ⌘J)", () => run("mod.open", { name: "inbox" }), needs || done, needs ? t.blocked : t.done))
      .child(hubButton("hub-review", "Review", "mods/review/icon.svg", "Review des fokussierten Terminals (⌘⇧R)", () => run("mod.open", { name: "review" }), 0, null))
      .child(h_flex().id("panel-group").ml(4).p(2).gap(1).flex_none().items_center().rounded(8).bg(t.background).border_1().border_color(t.border)
        .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg", 1)))
        .child(panelButton("graph", "Git", "mods/git-graph/icons/graph.svg", 2))
        .child(panelButton("filetree", "Tree", "mods/filetree/folder.svg", 3))
        .child(panelButton("blueprint", "Blueprint", "mods/blueprint/icon.svg", 4))
        .child(panelButton("docker", "Docker", "mods/docker/icon.svg", 5))
        .child(panelButton("quests", "Quests", "mods/quests/icon.svg", 6))
        .child(panelButton("team", "Team", "mods/orchestra/icon.svg", 7)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-graph/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-graph/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-graph/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
