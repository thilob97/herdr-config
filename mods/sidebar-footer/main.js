// The sidebar's head (logo, search, rail toggle) and, with props.footer, its foot:
// one row of icon buttons for configuration (settings, marketplaces, MCP servers,
// machines, keys). On the rail only settings and "…" fit; "…" opens the others.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, openOverlay, closeOverlay } from "herdr";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4;
const GAP_M = 8;
const H_BTN = 26;
const H_BTN_S = 22;
const H_ROW = 28;
const T_M = 12;
const T_L = 13;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const icon = (name) => (name.includes("/") ? name : `mods/sidebar-footer/${name}.svg`);

// The foot's buttons; the first one stays on the rail, the others go behind "…".
const TOOLS = [
  { id: "settings", icon: "settings", label: "Einstellungen", key: "⌘,", action: () => run("app.settings") },
  { id: "marketplaces", icon: "store", label: "Marketplaces", key: "⌃⇧M", action: () => run("mod.open", { name: "marketplaces" }) },
  { id: "mcp-servers", icon: "plug", label: "MCP-Server", key: "⌃⇧Y", action: () => run("mod.open", { name: "mcp-servers" }) },
  { id: "machine", icon: "server", label: "Maschine hinzufügen", key: null, action: () => run("mod.open", { name: "machine-add" }) },
  { id: "cheatsheet", icon: "mods/cheatsheet/icon.svg", label: "Tastenkürzel", key: "⌘/", action: () => run("mod.open", { name: "cheatsheet" }) },
  { id: "calm", icon: "circle-check", label: "Ruhige Anzeige", key: "⌘⇧A", toggle: true, action: () => run("tabs-graph.calm") },
];
// Calm display: on unless shared "ui.calm" says otherwise (tabs-graph.calm toggles it).
const calmOn = () => shared("ui.calm") ?? true;
const tip = (tool, ready) => `${tool.label}${tool.key ? ` (${tool.key})` : ""}${tool.toggle ? (calmOn() ? " · an" : " · aus") : ""}${ready ? " · Update bereit" : ""}`;

export default class WorkspaceChrome extends View {
  // An icon button: 26 in the head, 22 in the foot; icon 14 in both.
  button(id, size, iconName, tooltip, action) {
    const t = theme();
    return div().id(id).relative().size(size).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tooltip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action)
      .child(svg(icon(iconName)).size(14));
  }

  // The rail's "…": the tools that don't fit, as a menu.
  moreMenu(t) {
    const overlay = props().overlay;
    return v_flex().id("footer-more").w_full().p(GAP_XS).gap(2).bg(t.popover).text_size(T_M).text_color(t.foreground)
      .children(TOOLS.slice(1).map((tool) => h_flex().id(`more-${tool.id}`).h(H_ROW).px(GAP_M).gap(GAP_M).items_center().rounded(6)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => { closeOverlay(overlay); tool.action(); })
        .child(svg(icon(tool.icon)).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().truncate().child(tool.label))
        .when(Boolean(tool.key), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(tool.key)))
        .when(Boolean(tool.toggle), (el) => el.child(div().size(12).flex_none().flex().items_center().justify_center()
          .when(calmOn(), (i) => i.child(svg(icon("check")).size(12).text_color(t.foreground)))))));
  }

  footer(t, collapsed) {
    const ready = Boolean(updates().app.ready);
    const shown = collapsed ? TOOLS.slice(0, 1) : TOOLS;
    return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(GAP_M).gap(GAP_XS).items_center()
      .when(collapsed, (el) => el.px(0).justify_center())
      .children(shown.map((tool) => {
        const b = this.button(`footer-${tool.id}`, H_BTN_S, tool.icon, tip(tool, tool.id === "settings" && ready), tool.action);
        // Settings carries the dot of an update that's ready; calm a dot while it is on.
        const dot = (tool.id === "settings" && ready) || (tool.toggle && calmOn());
        return dot ? b.child(div().absolute().top(3).right(3).size(6).rounded_full().bg(t.accent)) : b;
      }))
      .when(collapsed, (el) => el.child(this.button("footer-more", H_BTN_S, "more", "Marketplaces, MCP-Server, Maschinen, Tastenkürzel",
        () => openOverlay({ mod: "sidebar-footer", kind: "popup", width: 240, height: 5 * (H_ROW + 2) + 2 * GAP_XS, props: { more: true } }))));
  }

  render() {
    const t = theme();
    if (props()?.more) return this.moreMenu(t);
    const collapsed = narrow();
    if (props()?.footer) return this.footer(t, collapsed);
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(GAP_M).gap(GAP_XS).items_center().text_size(T_L)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, (el) => el.pl(76))
      .when(!collapsed, (el) => el.child(h_flex().flex_1().gap(GAP_M).items_center()
        .child(image("frame/welcome/herdr.png").size(20).rounded(4))
        .child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, (el) => el.child(this.button("search", H_BTN, "search", "Gehe zu … (Tab, Space, Agent) (⌘P)", () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), (el) => el.child(this.button("sidebar-toggle", H_BTN, "sidebar", collapsed ? "Sidebar aufklappen" : "Sidebar einklappen", toggleSidebar)));
  }
}
