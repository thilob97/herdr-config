// Tastenkürzel: every binding from keys.json (live through keys()), in German,
// grouped by what it is for. Same action on several keys = one row; numbered
// selects (⌘1…⌘9) fold into one. Bindings scoped to a layout or the terminal
// carry a tag. Type to filter; Esc closes. Unknown actions show as written.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, props, closeOverlay, theme, window } from "herdr";
import { GROUPS, commandOf, buildRows, groupChip } from "./rows.js";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4, GAP_S = 6, GAP_M = 8, GAP_L = 12, GAP_XL = 16;
const INSET_CARD = 10, H_SECTION = 28, H_ROW = 28, H_INPUT = 30, H_CHIP = 18;
const T_XS = 10.5, T_S = 11, T_M = 12, T_XL = 15;

export default class Cheatsheet extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Filtern … (Taste oder Beschreibung)" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().toLowerCase(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
  }

  rows(mac) { return buildRows(keys(), mac, this.filter); }

  // A group as a card (5.6) with a section head; keys as chips.
  // The key column is as wide as its widest row (mono 10.5 ≈ 6.3 px per glyph plus the chip's
  // 6 px padding), so descriptions keep one line; a long description ends in "…" with a tooltip.
  // The section scope sits once in the head, not on every row.
  card(t, name, rows, scopeLabel, perRowScope) {
    const chipW = (k) => Math.round(6.3 * [...k].length) + 12;
    const natural = rows.map((r) => r.keys.reduce((s, k) => s + chipW(k), 0) + GAP_XS * Math.max(0, r.keys.length - 1));
    const colW = Math.min(150, Math.max(0, ...natural));
    return v_flex().w_full().px(INSET_CARD).pb(GAP_S).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(h_flex().h(H_SECTION).items_center().gap(GAP_S).text_size(T_S).font_medium().text_color(t.muted)
        .child(name)
        .when(Boolean(scopeLabel), (el) => el.child(div().h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised)
          .text_size(T_XS).text_color(t.muted).child(scopeLabel))))
      .children(rows.map((r, i) => h_flex().id(`cs-${name}-${i}`).min_h(H_ROW).gap(GAP_M).items_center()
        .child(h_flex().when(colW > 0, (el) => el.w(colW)).flex_shrink(0).max_w(150).gap(GAP_XS).flex_wrap()
          .children(r.keys.map((k) => div().h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised)
            .text_size(T_XS).text_color(t.foreground).child(k))))
        .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(t.foreground).tooltip(r.desc).child(r.desc))
        .when(perRowScope && r.tags.length > 0, (el) => el.child(div().flex_none().h(H_CHIP).px(6).flex().items_center().rounded(4)
          .bg(t.raised).text_size(T_XS).text_color(t.muted).child(r.tags.join(" · "))))));
  }

  render() {
    const t = theme();
    const mac = window()?.platform === "macos";
    const left = this.rows(mac);
    const groups = [];
    for (const [name, test] of GROUPS) {
      const mine = left.filter((r) => !r.taken && test(commandOf(r.action)));
      mine.forEach((r) => { r.taken = true; });
      // The group's chip only when every row is limited to the same scope; otherwise
      // each limited row says its own.
      if (mine.length) { const chip = groupChip(mine); groups.push([name, mine, chip.label, chip.perRow]); }
    }
    // Two columns, each group to the shorter one.
    const cols = [[], []], height = [0, 0];
    for (const g of groups) { const c = height[0] <= height[1] ? 0 : 1; cols[c].push(g); height[c] += g[1].length + 2; }
    const close = () => closeOverlay(props().overlay);
    // Dialog (5.6): p 16, gap 12, a 28 px title row, content fills the height.
    return v_flex().id("cheatsheet").size_full().min_h(0).p(GAP_XL).gap(GAP_L).bg(t.popover).text_size(T_M)
      .on_key_down((e) => { if (e.key === "escape") close(); })
      .child(h_flex().h(28).flex_none().items_center().gap(GAP_M)
        .child(div().text_size(T_XL).font_semibold().text_color(t.foreground).child("Tastenkürzel"))
        .child(div().text_size(T_S).text_color(t.muted).child("aus keys.json, live"))
        .child(div().flex_1())
        .child(div().text_size(T_XS).text_color(t.muted).child("tippen filtert"))
        .child(div().id("cs-esc").h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Schließen (Esc)").on_click(close).child("Esc")))
      .child(h_flex().h(H_INPUT).flex_none().px(10).gap(GAP_S).items_center().rounded(6).border_1().border_color(this.typing ? t.accent : t.input).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(12).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(T_M).text_color(t.foreground)))
      .child(div().id("cs-scroll").flex_1().min_h(0).overflow_y_scrollbar()
        .child(groups.length
          ? h_flex().w_full().gap(GAP_L).items_start()
            .children(cols.map((col, i) => v_flex().id(`cs-col-${i}`).flex_1().min_w(0).gap(GAP_L)
              .children(col.map(([name, rows, scopeLabel, perRow]) => this.card(t, name, rows, scopeLabel, perRow)))))
          : h_flex().h(H_ROW).items_center().text_size(T_S).text_color(t.dim).child("Keine Taste passt zum Filter.")));
  }
}
