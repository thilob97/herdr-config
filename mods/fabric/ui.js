// Token und Bausteine des Fabric-Mods. Jede Ansicht baut aus diesen Teilen;
// Farben kommen ausschließlich aus theme().

import { div, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { theme } from "herdr";

// ---------- Token ----------

export const FONT = { xs: 10.5, s: 11.5, m: 12.5, l: 14, xl: 16 };
export const SPACE = { xs: 4, s: 6, m: 8, l: 12, xl: 16 };
export const SIZE = {
  row: 28,
  rowTall: 42,
  header: 40,
  button: 26,
  input: 30,
  chip: 18,
  lane: 30,
  dot: 8,
  radius: 7,
};

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
    case "orchestrator": return t.solid;
    default: return t.dim;
  }
}

export function levelColor(t, level) {
  if (level === "error") return t.blocked;
  if (level === "ok") return t.done;
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

// ---------- Rahmen und Text ----------

/** Ganzes Panel: Fläche, Schrift, Innenabstand. */
export function page(t, children) {
  return v_flex()
    .size_full()
    .min_h(0)
    .bg(t.surface)
    .text_color(t.foreground)
    .text_size(FONT.m)
    .children(children);
}

export function header(t, title, right = []) {
  return h_flex()
    .flex_none()
    .w_full()
    .h(SIZE.header)
    .px(SPACE.l)
    .gap(SPACE.s)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(div().flex_none().text_size(FONT.l).font_semibold().child(title))
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

export function chip(t, text, color = null, id = null, { tooltip = null, onClick = null } = {}) {
  let el = div()
    .flex_none()
    .px(6)
    .h(SIZE.chip)
    .flex()
    .items_center()
    .rounded(4)
    .bg((color ?? t.muted) + "22")
    .text_size(FONT.xs)
    .text_color(color ?? t.muted)
    .child(text);
  if (tooltip) el = el.tooltip(tooltip);
  if (onClick) {
    el = el
      .cursor_pointer()
      .hover((s) => s.opacity(0.8))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        onClick(cx);
      });
  }
  return id ? el.id(id) : el;
}

export function hint(t, text) {
  return div().text_size(FONT.s).text_color(t.dim).child(text);
}

export function emptyState(t, text) {
  return v_flex()
    .size_full()
    .items_center()
    .justify_center()
    .p(SPACE.xl)
    .gap(SPACE.s)
    .child(div().text_size(FONT.l).text_color(t.muted).child("Nichts da"))
    .child(div().text_size(FONT.s).text_color(t.dim).text_center().child(text));
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

export function button(t, { id, label, primary = false, disabled = false, onClick }) {
  return h_flex()
    .id(id)
    .flex_none()
    .h(SIZE.button)
    .px(10)
    .items_center()
    .rounded(SIZE.radius)
    .border_1()
    .border_color(primary ? t.solid : t.input)
    .bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground)
    .text_size(FONT.s)
    .font_medium()
    .when(disabled, (el) => el.opacity(0.45))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.86)))
    .when(!disabled, (el) => el.on_click((_event, cx) => {
      cx.stop_propagation();
      onClick(cx);
    }))
    .child(label);
}

export function input(t, state, { focused = false } = {}) {
  return Input.new(state)
    .h(SIZE.input)
    .px(9)
    .rounded(SIZE.radius)
    .border_1()
    .border_color(focused ? t.accent : t.input)
    .bg(t.background)
    .text_size(FONT.s)
    .text_color(t.foreground);
}

export function stageRow(t, { label, count, open = true, onClick = null, id = null }) {
  const row = h_flex()
    .w_full()
    .h(24)
    .px(SPACE.l)
    .gap(SPACE.s)
    .items_center()
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .child(div().flex_none().text_size(FONT.xs).text_color(t.dim).child(open ? "▾" : "▸"))
    .child(div().flex_none().text_size(FONT.s).font_semibold().text_color(t.muted).child(label))
    .child(div().flex_none().text_size(FONT.xs).text_color(t.dim).child(String(count)));
  const withId = id ? row.id(id) : row;
  return onClick ? withId.on_click((_event, cx) => onClick(cx)) : withId;
}

/** Punkte halten Abstand zum Rand: Anteil 0..1 → Prozent im Zeitband. */
export const PLOT_INSET = 3;
export const plotX = (fraction) => PLOT_INSET + fraction * (100 - 2 * PLOT_INSET);

/** Senkrechter Zeitstrahl: ein Pfeil je `wake` von Spur zu Spur. */
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
