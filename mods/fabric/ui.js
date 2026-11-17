// Token und Bausteine des Fabric-Mods. Jede Ansicht baut aus diesen Teilen;
// Farben kommen ausschließlich aus theme(), Abstände und Größen aus diesem Modul.

import { div, PathBuilder, Background, svg } from "gpui-kit";
import {
  h_flex, v_flex, Input, NumberInput, Textarea, Editor, TextView, Checkbox, Switch,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Popup, Scrollbar,
} from "gpui-base";
import { theme } from "herdr";
import * as model from "./model.js";

// ---------- Token ----------

export const FONT = { xs: 11, s: 12, m: 13, l: 15, xl: 18 };
export const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
export const RADIUS = { s: 6, m: 8, l: 12 };
export const SIZE = {
  row: 30,
  rowTall: 44,
  header: 46,
  button: 28,
  input: 30,
  chip: 20,
  lane: 30,
  dot: 8,
  avatar: 24,
  nav: 34,
  sidebar: 208,
};

export const ICON = (name) => `mods/fabric/icons/${name}.svg`;

/** Farben des laufenden Themes. */
export const colors = () => theme();

// ---------- Farben nach Bedeutung ----------

export function statusColor(t, status) {
  switch (status) {
    case "draft": return t.dim;
    case "todo": return t.muted;
    case "doing": return t.working;
    case "review": return t.accent;
    case "done": return t.done;
    case "dropped": return t.dim;
    default: return t.dim;
  }
}

/** Roster-Farbe c1–c6 → Theme-Farbe. */
export function roleColor(t, key) {
  const index = /^c([1-6])$/.exec(String(key ?? ""));
  if (!index) return t.accent;
  return t[`ansi${index[1]}`] ?? t.accent;
}

export function kindColor(t, kind) {
  switch (kind) {
    case "wake": return t.accent;
    case "comment": return t.muted;
    case "status": return t.working;
    case "verdict":
    case "accept": return t.done;
    case "reject":
    case "drop": return t.blocked;
    case "dispatch":
    case "assigned": return t.accent;
    case "orchestrator": return t.foreground;
    default: return t.dim;
  }
}

export function levelColor(t, level) {
  if (level === "error") return t.blocked;
  if (level === "ok" || level === "success") return t.done;
  if (level === "warn" || level === "warning") return t.working;
  return t.accent;
}

/** Farbschlüssel aus `model.sessionStatus`/`model.sessionChips` → Theme-Farbe. */
export function sessionColor(t, key) {
  switch (key) {
    case "working": return t.working;
    case "blocked": return t.blocked;
    case "done": return t.done;
    case "muted": return t.muted;
    default: return t.dim;
  }
}

export function inboxColor(t, kind) {
  if (kind === "attention") return t.blocked;
  if (kind === "review") return t.done;
  return t.accent;
}

// ---------- Kleine Bausteine ----------

export function icon(name, size = 14) {
  return svg(ICON(name)).size(size);
}

export function spinner(t, size = 12) {
  return div().flex_none().text_color(t.muted).child(svg(ICON("spinner")).size(size).spin(900));
}

/** Jede Taste, die eine Aktion auslöst, steht auch am Knopf. */
export function withKey(label, key) {
  return key ? `${label} (${key})` : label;
}

function still(el) {
  return el.on_mouse_down("left", (_event, cx) => cx.stop_propagation());
}

export function page(t, children) {
  return v_flex()
    .size_full()
    .min_h(0)
    .bg(t.surface)
    .text_color(t.foreground)
    .text_size(FONT.m)
    .children(children);
}

export function header(t, title, right = [], { iconName = null, subtitle = null } = {}) {
  return h_flex()
    .flex_none()
    .w_full()
    .h(SIZE.header)
    .px(SPACE.l)
    .gap(SPACE.s)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .when(Boolean(iconName), (el) => el.child(div().flex_none().text_color(t.muted).child(icon(iconName, 15))))
    .child(
      v_flex()
        .flex_none()
        .gap(0)
        .child(div().text_size(FONT.l).font_semibold().child(title))
        .when(Boolean(subtitle), (el) => el.child(div().text_size(FONT.xs).text_color(t.dim).child(subtitle))),
    )
    .child(div().flex_1())
    .children(right);
}

export function sectionTitle(t, title, right = [], hint = null) {
  return h_flex()
    .w_full()
    .items_center()
    .gap(SPACE.s)
    .child(div().text_size(FONT.s).font_semibold().text_color(t.muted).child(title))
    .when(Boolean(hint), (el) => el.child(div().text_size(FONT.xs).text_color(t.dim).child(hint)))
    .child(div().flex_1())
    .children(right);
}

export function badge(t, count, color = null) {
  const tint = color ?? t.accent;
  return div()
    .flex_none()
    .px(7)
    .h(18)
    .flex()
    .items_center()
    .rounded(9)
    .bg(tint + "26")
    .text_size(FONT.xs)
    .font_semibold()
    .text_color(tint)
    .child(String(count));
}

export function dot(t, color) {
  return div().flex_none().size(SIZE.dot).rounded(SIZE.dot / 2).bg(color);
}

export function pill(t, { label, color, tooltip = null, onClick = null, id = null }) {
  let el = h_flex()
    .flex_none()
    .h(22)
    .px(8)
    .gap(5)
    .items_center()
    .rounded(11)
    .bg((color ?? t.muted) + "1f")
    .text_size(FONT.xs)
    .text_color(color ?? t.muted)
    .whitespace_nowrap()
    .child(dot(t, color ?? t.muted))
    .child(label);
  if (tooltip) el = el.tooltip(tooltip);
  if (onClick) {
    el = still(el).cursor_pointer().hover((style) => style.opacity(0.82))
      .on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); });
  }
  return id ? el.id(id) : el;
}

export function chip(t, text, color = null, id = null, { tooltip = null, onClick = null } = {}) {
  let el = h_flex()
    .flex_none()
    .px(6)
    .h(SIZE.chip)
    .gap(4)
    .items_center()
    .rounded(RADIUS.s)
    .bg((color ?? t.muted) + "1e")
    .text_size(FONT.xs)
    .text_color(color ?? t.muted)
    .whitespace_nowrap()
    .child(text);
  if (tooltip) el = el.tooltip(tooltip);
  if (onClick) {
    el = still(el).cursor_pointer().hover((s) => s.opacity(0.8))
      .on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); });
  }
  return id ? el.id(id) : el;
}

export function avatar(t, name, colorKey = "c1", size = SIZE.avatar) {
  const color = roleColor(t, colorKey);
  return h_flex()
    .flex_none()
    .size(size)
    .rounded(size / 2)
    .items_center()
    .justify_center()
    .bg(color + "2b")
    .text_color(color)
    .text_size(Math.max(9, Math.round(size * 0.4)))
    .font_semibold()
    .child(model.initials(name))
    .tooltip(String(name || "unbekannt"));
}

export function hint(t, text) {
  if (!text) return null;
  return div().text_size(FONT.xs).text_color(t.dim).whitespace_normal().child(text);
}

export function keyHint(t, key) {
  return div()
    .flex_none()
    .px(5)
    .h(18)
    .flex()
    .items_center()
    .rounded(4)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .text_size(FONT.xs)
    .text_color(t.dim)
    .child(key);
}

export function emptyState(t, { title = "Nichts da", text = "", action = null } = {}) {
  return v_flex()
    .size_full()
    .min_h(0)
    .items_center()
    .justify_center()
    .p(SPACE.xl)
    .gap(SPACE.s)
    .child(div().text_size(FONT.l).text_color(t.muted).child(title))
    .when(Boolean(text), (el) => el.child(div().text_size(FONT.s).text_color(t.dim).text_center().whitespace_normal().child(text)))
    .when(Boolean(action), (el) => el.child(div().pt(SPACE.s).child(action)));
}

export function loading(t, text = "Lade …") {
  return v_flex()
    .size_full()
    .items_center()
    .justify_center()
    .gap(SPACE.s)
    .child(spinner(t, 16))
    .child(div().text_size(FONT.s).text_color(t.dim).child(text));
}

export function notice(t, message, level = "error") {
  if (!message) return null;
  const color = levelColor(t, level);
  return h_flex()
    .flex_none()
    .w_full()
    .px(SPACE.l)
    .py(SPACE.s)
    .gap(SPACE.s)
    .items_start()
    .bg(color + "1c")
    .border_b(1)
    .border_color(t.border)
    .child(div().flex_none().mt(1).size(6).rounded(3).bg(color))
    .child(div().flex_1().min_w(0).whitespace_normal().text_size(FONT.s).text_color(color).child(message));
}

export function button(t, {
  id, label, icon: iconName = null, primary = false, danger = false, disabled = false,
  reason = "", tooltip = "", busy = false, small = false, onClick = null, fill = false,
}) {
  const blocked = disabled || busy;
  let el = h_flex()
    .id(id)
    .flex_none()
    .h(small ? 24 : SIZE.button)
    .px(small ? 8 : 10)
    .gap(5)
    .items_center()
    .justify_center()
    .rounded(RADIUS.m)
    .border_1()
    .border_color(primary ? t.solid : danger ? t.blocked + "66" : t.input)
    .bg(primary ? t.solid : danger ? t.blocked + "18" : t.raised)
    .text_color(primary ? t.solid_foreground : danger ? t.blocked : t.foreground)
    .text_size(FONT.s)
    .font_medium()
    .when(fill, (node) => node.w_full())
    .when(blocked, (node) => node.opacity(0.5))
    .when(!blocked, (node) => node.cursor_pointer().hover((s) => s.opacity(0.86)))
    .when(!blocked && onClick, (node) => still(node).on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); }))
    .when(blocked, (node) => still(node));
  if (busy) el = el.child(spinner(t, 12));
  else if (iconName) el = el.child(div().flex_none().child(icon(iconName, small ? 12 : 13)));
  if (label) el = el.child(div().when(!fill, (node) => node.flex_none()).whitespace_nowrap().child(label));
  const tip = blocked && reason ? reason : tooltip;
  el = el.when(Boolean(tip), (node) => node.tooltip(tip));
  if (tooltip) el = el.accessibility_label(tooltip);
  return el;
}

export function iconButton(t, {
  id, icon: iconName, tooltip, onClick = null, disabled = false, active = false, size = SIZE.button, iconSize = 14,
}) {
  let el = h_flex()
    .id(id)
    .flex_none()
    .size(size)
    .items_center()
    .justify_center()
    .rounded(RADIUS.m)
    .bg(active ? t.selected : t.surface + "00")
    .text_color(active ? t.foreground : t.muted)
    .when(disabled, (node) => node.opacity(0.4))
    .when(!disabled, (node) => node.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .when(!disabled && onClick, (node) => still(node).on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); }))
    .child(icon(iconName, iconSize));
  if (tooltip) el = el.tooltip(tooltip).accessibility_label(tooltip);
  return el;
}

export function input(t, state, { focused = false } = {}) {
  const field = Input.new(state)
    .w_full()
    .h(SIZE.input)
    .px(9)
    .rounded(RADIUS.m)
    .border_1()
    .border_color(focused ? t.accent : t.input)
    .bg(t.background)
    .text_size(FONT.s)
    .text_color(t.foreground);
  return still(div().w_full().min_w(0).child(field));
}

export function textarea(t, state, { focused = false, height = 92 } = {}) {
  const field = Textarea.new(state)
    .w_full()
    .h(height)
    .p(8)
    .rounded(RADIUS.m)
    .border_1()
    .border_color(focused ? t.accent : t.input)
    .bg(t.background)
    .text_size(FONT.s)
    .text_color(t.foreground);
  return still(div().w_full().min_w(0).child(field));
}

export function editor(t, state, { height = 260, fill = false } = {}) {
  return still(div()
    .w_full()
    .when(fill, (el) => el.flex_1().min_h(0))
    .when(!fill, (el) => el.h(height))
    .min_h(0)
    .overflow_hidden()
    .rounded(RADIUS.m)
    .border_1()
    .border_color(t.input)
    .bg(t.background)
    .child(Editor.new(state).size_full()));
}

export function numberInput(t, state) {
  const step = (glyph, label) => h_flex()
    .w(28)
    .h(SIZE.input - 2)
    .items_center()
    .justify_center()
    .rounded(RADIUS.s)
    .bg(t.raised)
    .text_color(t.muted)
    .text_size(FONT.m)
    .font_semibold()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .accessibility_label(label)
    .child(glyph);
  const field = NumberInput.new(state)
    .w_full()
    .h(SIZE.input)
    .rounded(RADIUS.m)
    .border_1()
    .border_color(t.input)
    .bg(t.background)
    .text_size(FONT.s)
    .text_color(t.foreground)
    .decrement_button(step("−", "verringern"))
    .increment_button(step("+", "erhöhen"));
  return still(div().w_full().min_w(0).child(field));
}

export function checkbox(t, { id, checked, label, onChange, disabled = false, tooltip = "" }) {
  let el = h_flex()
    .id(id)
    .flex_none()
    .h(SIZE.row)
    .gap(SPACE.s)
    .items_center()
    .when(!disabled, (node) => node.cursor_pointer())
    .when(disabled, (node) => node.opacity(0.5));
  const box = h_flex()
    .flex_none()
    .size(16)
    .items_center()
    .justify_center()
    .rounded(4)
    .border_1()
    .border_color(checked ? t.accent : t.input)
    .bg(checked ? t.accent : t.background)
    .when(checked, (node) => node.text_color(t.accent_foreground).child(icon("check", 11)));
  el = el.child(box).child(div().text_size(FONT.s).text_color(disabled ? t.dim : t.foreground).child(label));
  el = still(el).on_click((_event, cx) => {
    cx.stop_propagation();
    if (!disabled) onChange(!checked);
  });
  if (tooltip) el = el.tooltip(tooltip);
  return el;
}

export function switchRow(t, { id, checked, label, detail = null, onChange, disabled = false }) {
  const track = h_flex()
    .flex_none()
    .w(34)
    .h(19)
    .rounded(10)
    .items_center()
    .bg(checked ? t.accent : t.input)
    .child(div()
      .size(15)
      .rounded(8)
      .bg(t.solid_foreground)
      .ml(checked ? 17 : 2));
  return still(h_flex()
    .id(id)
    .w_full()
    .min_h(SIZE.row)
    .gap(SPACE.m)
    .items_center()
    .when(!disabled, (node) => node.cursor_pointer())
    .when(disabled, (node) => node.opacity(0.5))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      if (!disabled) onChange(!checked);
    })
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(div().text_size(FONT.s).text_color(t.foreground).child(label))
      .when(Boolean(detail), (node) => node.child(div().text_size(FONT.xs).text_color(t.dim).whitespace_normal().child(detail))))
    .child(track));
}

/** Ein beschriftetes Feld im Eigenschaftenbereich. */
export function field(t, label, control, { hint: hintText = null, right = null } = {}) {
  return v_flex()
    .w_full()
    .gap(5)
    .child(h_flex().w_full().items_center()
      .child(div().text_size(FONT.xs).text_color(t.dim).child(label))
      .child(div().flex_1())
      .when(Boolean(right), (el) => el.children(right)))
    .child(control)
    .when(Boolean(hintText), (el) => el.child(hint(t, hintText)));
}

export function card(t, children, { padding = SPACE.m, gap = SPACE.s, hover = false, onClick = null, id = null } = {}) {
  let el = v_flex()
    .w_full()
    .p(padding)
    .gap(gap)
    .rounded(RADIUS.l)
    .border_1()
    .border_color(t.border)
    .bg(t.raised);
  if (id) el = el.id(id);
  if (hover) el = el.cursor_pointer().hover((style) => style.bg(t.hover).border_color(t.input));
  if (onClick) el = still(el).on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); });
  return el.children(children);
}

// ---------- Filterleiste ----------

export function filterBar(t, {
  assignees = [], repos = [], assignee = "all", repo = "all", dropped = false,
  menu = null, onMenu, onAssignee, onRepo, onDropped, onReset,
  active = false, droppedLabel = "Verworfen", iconName = "filter", scrollHandle = null,
}) {
  const select = (id, value, options, onPick, width) => {
    const prefix = id.includes("assignee") ? "Zuständig" : "Repo";
    const labelled = options.map((option) => ({ ...option, label: `${prefix}: ${option.label}` }));
    return moduleDropdown(t, {
      id,
      value: labelled.find((option) => option.value === value)?.label ?? `${prefix}: Alle`,
      placeholder: `${prefix}: Alle`,
      options: labelled.map((option) => ({ ...option, selected: option.value === value })),
      open: menu === id,
      width,
      scrollHandle,
      onToggle: () => onMenu(id),
      onPick: (next) => { onMenu(null); onPick(next); },
    });
  };
  return h_flex()
    .flex_none()
    .w_full()
    .px(SPACE.l)
    .py(SPACE.s)
    .gap(SPACE.s)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(div().flex_none().text_color(t.dim).child(icon(iconName, 12)))
    .child(div().w(150).child(select("fabric-filter-assignee", assignee, assignees, onAssignee, 160)))
    .child(div().w(170).child(select("fabric-filter-repo", repo, repos, onRepo, 230)))
    .child(checkbox(t, {
      id: "fabric-filter-dropped",
      checked: dropped,
      label: droppedLabel,
      tooltip: "Verworfene Tickets einblenden",
      onChange: onDropped,
    }))
    .child(div().flex_1())
    .when(active, (el) => el.child(button(t, {
      id: "fabric-filter-reset",
      label: "Filter zurücksetzen",
      small: true,
      onClick: onReset,
    })));
}

/** Gemeinsame Filterleiste für Board und Tickets-Tabelle. */
export function fabricFilters(t, { app, cx, droppedKey = "showDropped" }) {
  const options = model.filterOptions(app.tickets);
  const active = app.assigneeFilter !== "all" || app.repoFilter !== "all"
    || Boolean(app[droppedKey]) || Boolean(app.search.value().trim());
  return filterBar(t, {
    assignees: options.assignees,
    repos: options.repos,
    assignee: app.assigneeFilter,
    repo: app.repoFilter,
    dropped: Boolean(app[droppedKey]),
    menu: app.menu,
    scrollHandle: app.dropdownScroll,
    onMenu: (id) => { app.menu = id; cx.notify(); },
    onAssignee: (value) => { app.assigneeFilter = value; cx.notify(); },
    onRepo: (value) => { app.repoFilter = value; cx.notify(); },
    onDropped: (value) => { app[droppedKey] = value; cx.notify(); },
    active,
    onReset: (cx2) => {
      app.search.set_value("");
      app.assigneeFilter = "all";
      app.repoFilter = "all";
      app[droppedKey] = false;
      (cx2 ?? cx).notify();
    },
  });
}

/** Kommentartext als reiner Text, nur Erwähnungen hervorgehoben. */
export function mentionMarkdown(text) {
  return model.plainMentionMarkdown(text);
}

/** Wort und Farbe des Orchestrators, live oder aus dem gespeicherten Stand. */
export function orchestratorStatus(t, state) {
  return {
    word: model.orchestratorWord(state),
    color: sessionColor(t, model.orchestratorColorKey(state)),
  };
}

// ---------- Auswahl (Popup statt Select, damit der Zustand im View bleibt) ----------

export function dropdown(t, {
  id, value, placeholder = "Auswählen…", options = [], open = false, disabled = false,
  width = 190, onToggle, onPick, empty = "Keine Auswahl", align = "bottom_left",
  iconOnly = false, iconName = "dots", tooltip = null, scrollHandle = null,
}) {
  const trigger = iconOnly
    ? h_flex()
      .id(`${id}-trigger`)
      .size(22)
      .items_center()
      .justify_center()
      .rounded(RADIUS.s)
      .text_color(open ? t.foreground : t.dim)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .when(disabled, (el) => el.opacity(0.5))
      .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
      .child(icon(iconName, 13))
    : h_flex()
      .id(`${id}-trigger`)
      .w_full()
      .h(SIZE.input)
      .px(9)
      .gap(SPACE.s)
      .items_center()
      .rounded(RADIUS.m)
      .border_1()
      .border_color(open ? t.accent : t.input)
      .bg(t.background)
      .text_size(FONT.s)
      .text_color(value ? t.foreground : t.dim)
      .when(disabled, (el) => el.opacity(0.5))
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.border_color(t.muted)))
      .child(div().flex_1().min_w(0).truncate().child(value || placeholder))
      .child(div().flex_none().text_color(t.dim).child(icon("chevron-down", 11)));
  const withClick = still(trigger).on_click((_event, cx) => {
    cx.stop_propagation();
    if (disabled) return;
    if (!open && scrollHandle) {
      const selected = options.findIndex((option) => option.selected);
      if (selected >= 0) scrollHandle.scroll_to_item(selected);
    }
    onToggle();
  });

  const listId = `${id}-list`;
  // Nur das offene Menü bauen: geschlossene Dropdowns erzeugen keine
  // Optionszeilen. Sonst entstehen bei jedem Render alle Menüs aller
  // Dropdowns (Board: eine pro Karte) und werden sofort verworfen.
  const menu = () => v_flex()
    .relative()
    .w(width)
    .max_h(320)
    .rounded(RADIUS.m)
    .border_1()
    .border_color(t.border)
    .bg(t.popover)
    .child(
      v_flex()
        .id(listId)
        .w_full()
        .max_h(320)
        .overflow_y_scroll()
        .p(SPACE.xs)
        .gap(1)
        .when(Boolean(scrollHandle), (el) => el.track_scroll(scrollHandle))
        .children(options.length ? options.map((option) =>
          h_flex()
            .id(`${id}-option-${option.value}`)
            .w_full()
            .min_h(28)
            .px(7)
            .gap(SPACE.s)
            .items_center()
            .rounded(RADIUS.s)
            .bg(option.selected ? t.selected : t.surface + "00")
            .text_size(FONT.s)
            .text_color(option.warn ? t.blocked : option.disabled ? t.dim : t.foreground)
            .when(!option.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
            .when(Boolean(option.detail), (el) => el.child(div()
              .flex_none().text_size(FONT.xs)
              .text_color(option.warn ? t.blocked : t.dim).child(option.detail)))
            .child(div().flex_1().min_w(0).truncate().child(option.label))
            .when(option.selected, (el) => el.child(div().flex_none().text_color(t.accent).child(icon("check", 12))))
            .when(!option.disabled, (el) => still(el).on_click((_event, cx) => {
              cx.stop_propagation();
              onPick(option.value);
            }))) : [
          div().px(8).py(6).text_size(FONT.s).text_color(t.dim).child(empty),
        ]),
    )
    .child(Scrollbar.vertical(listId).absolute().inset_0());

  return Popup.new(id, withClick).anchor(align).when(open, (el) => el.content(menu()));
}

const moduleDropdown = dropdown;

// ---------- Flächen ----------

export function backdrop(t, { onClick = null, dim = true } = {}) {
  let el = div().absolute().inset_0().when(dim, (node) => node.bg(t.background + "b8"));
  if (onClick) el = still(el).on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); });
  return el;
}

export function modal(t, { title, detail = "", actions = [], width = 440 }, children = []) {
  return v_flex()
    .absolute()
    .inset_0()
    .items_center()
    .justify_center()
    .child(backdrop(t))
    .child(
      v_flex()
        .relative()
        .w(width)
        .max_w("92%")
        .p(SPACE.xl)
        .gap(SPACE.m)
        .rounded(RADIUS.l)
        .border_1()
        .border_color(t.border)
        .bg(t.popover)
        .child(div().text_size(FONT.l).font_semibold().child(title))
        .when(Boolean(detail), (el) => el.child(div().text_size(FONT.s).text_color(t.muted).whitespace_normal().child(detail)))
        .children(Array.isArray(children) ? children : [children])
        .when(Boolean(actions.length), (el) => el.child(h_flex().w_full().justify_end().gap(SPACE.s).children(actions))),
    );
}

export function drawer(t, offer = {}, children = []) {
  const { title, subtitle = null, onClose, footer = [], width = 380, tooltip = "Schließen (Esc)" } = offer;
  return h_flex()
    .relative()
    .flex_none()
    .w(width)
    .max_w("60%")
    .h_full()
    .border_l(1)
    .border_color(t.border)
    .bg(t.surface)
    .overflow_hidden()
    .child(v_flex().size_full().min_h(0).overflow_hidden()
      .child(header(t, title, [
        iconButton(t, { id: `${title}-close`, icon: "close", tooltip, onClick: onClose }),
      ], { subtitle }))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(SPACE.l).gap(SPACE.m).children(Array.isArray(children) ? children : [children]))
      .when(Boolean(footer.length), (el) => el.child(
        h_flex().flex_none().w_full().gap(SPACE.s).justify_end().p(SPACE.m)
          .border_t(1).border_color(t.border).children(footer),
      )));
}

export function popoverPanel(t, children, width = 360) {
  return v_flex()
    .w(width)
    .max_h(420)
    .overflow_y_scrollbar()
    .rounded(RADIUS.l)
    .border_1()
    .border_color(t.border)
    .bg(t.popover)
    .children(children);
}

// ---------- Markdown ----------

export function markdown(id, text, { size = FONT.s, selectable = true } = {}) {
  return TextView.markdown(id, String(text ?? ""))
    .w_full()
    .text_size(size)
    .text_color(theme().foreground)
    .whitespace_normal()
    .selectable(selectable);
}

// ---------- Tabellen ----------

export function table(t, { id, columns, rows, sort, onSort, renderCell, onRow }) {
  const headerRow = TableRow.new(`${id}-headrow`, 1)
    .flex()
    .w_full()
    .h(30)
    .px(SPACE.m)
    .gap(SPACE.s)
    .items_center()
    .bg(t.chrome)
    .border_b(1)
    .border_color(t.border)
    .children(columns.map((column, index) => {
      const active = sort?.key === column.key;
      const dir = active ? (sort.dir === "asc" ? " ↑" : " ↓") : "";
      return TableHead.new(`${id}-head-${column.key}`, index + 1)
        .when(column.width, (el) => el.w(column.width))
        .when(!column.width, (el) => el.flex_1().min_w(0))
        .flex()
        .flex_none()
        .h_full()
        .gap(3)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .text_size(FONT.xs)
        .text_color(active ? t.foreground : t.dim)
        .on_click((_event, cx) => { cx.stop_propagation(); onSort(model.nextSort(sort, column.key)); })
        .child(div().truncate().child(`${column.label}${dir}`));
    }));

  const bodyRows = rows.map((row, rowIndex) => TableRow.new(row.id, rowIndex + 1)
    .flex()
    .w_full()
    .min_h(36)
    .px(SPACE.m)
    .gap(SPACE.s)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .when(Boolean(row.__selected), (el) => el.bg(t.selected))
    .on_click((_event, cx) => { cx.stop_propagation(); onRow(row, cx); })
    .children(columns.map((column, index) => TableCell.new(`${row.id}-${column.key}`, index + 1)
      .when(column.width, (el) => el.w(column.width))
      .when(!column.width, (el) => el.flex_1().min_w(0))
      .flex()
      .flex_none()
      .items_center()
      .text_size(FONT.s)
      .child(renderCell(row, column, index === columns.length - 1)))));

  return Table.new(id)
    .accessibility_label(id)
    .row_count(rows.length + 1)
    .column_count(columns.length)
    .w_full()
    .flex_none()
    .child(TableHeader.new(`${id}-header`).w_full().child(headerRow))
    .child(TableBody.new(`${id}-body`).w_full().children(bodyRows));
}

// ---------- Navigation ----------

export function navItem(t, { id, icon: iconName, label, active, onClick, badge = null }) {
  return still(h_flex()
    .id(id)
    .w_full()
    .h(SIZE.nav)
    .px(10)
    .gap(9)
    .items_center()
    .rounded(RADIUS.m)
    .bg(active ? t.selected : t.surface + "00")
    .text_color(active ? t.foreground : t.muted)
    .text_size(FONT.s)
    .font_medium()
    .cursor_pointer()
    .hover((s) => s.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(div().flex_none().when(active, (el) => el.text_color(t.accent)).child(icon(iconName, 15)))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(badge !== null, (el) => el.child(badge)));
}

export function tabs(t, { id, items, value, onPick }) {
  return h_flex()
    .id(id)
    .flex_none()
    .gap(2)
    .p(2)
    .rounded(RADIUS.m)
    .bg(t.chrome)
    .children(items.map((item) => h_flex()
      .id(`${id}-${item.value}`)
      .h(24)
      .px(9)
      .items_center()
      .rounded(RADIUS.s)
      .bg(item.value === value ? t.raised : t.surface + "00")
      .text_color(item.value === value ? t.foreground : t.dim)
      .text_size(FONT.s)
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_event, cx) => { cx.stop_propagation(); onPick(item.value); })
      .child(item.label)));
}

export function stageRow(t, { label, count, open = true, onClick = null, id = null }) {
  const row = h_flex()
    .w_full()
    .h(26)
    .px(SPACE.l)
    .gap(SPACE.s)
    .items_center()
    .when(Boolean(onClick), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
    .child(div().flex_none().text_size(FONT.xs).text_color(t.dim).child(open ? "▾" : "▸"))
    .child(div().flex_none().text_size(FONT.xs).font_semibold().text_color(t.muted).child(label))
    .child(div().flex_none().text_size(FONT.xs).text_color(t.dim).child(String(count)));
  const withId = id ? row.id(id) : row;
  return onClick ? still(withId).on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); }) : withId;
}

// ---------- Timeline ----------

export const PLOT_INSET = 3;
export const plotX = (fraction) => PLOT_INSET + fraction * (100 - 2 * PLOT_INSET);

export function wakeArrows(t, arrows, laneCount) {
  if (!arrows?.length || laneCount < 1) return null;
  const builder = PathBuilder.stroke(1.2);
  for (const arrow of arrows) {
    const x = plotX(arrow.x);
    const y1 = arrow.y1 * 100;
    const y2 = arrow.y2 * 100;
    builder.move_to(`${x}%`, `${y1}%`).line_to(`${x}%`, `${y2}%`);
    const back = arrow.to > arrow.from ? -1 : 1;
    const dy = (back * 3.5) / laneCount;
    builder.move_to(`${x}%`, `${y2}%`).line_to(`${x - 0.5}%`, `${y2 + dy}%`);
    builder.move_to(`${x}%`, `${y2}%`).line_to(`${x + 0.5}%`, `${y2 + dy}%`);
  }
  return window
    .paint_path(builder.build(), Background.solid(t.accent + "99"))
    .absolute()
    .top(0)
    .left(0)
    .size_full();
}
