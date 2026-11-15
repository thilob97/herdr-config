// Team: the stations of the agent factory. The header shows the pipeline
// (Geplant › In Arbeit › Prüfung › Fertig, click jumps to the section); below it
// the orchestrator's compact card, then the tickets by stage (Prüfung first: it
// waits for you), the watched teams (shared "orchestra.groups", made from the
// sidebar's selection or the launcher) and the finished tickets, folded. Agents
// themselves show in the sidebar; here they appear only as identity chips.
// With props { role: "daemon" } (a 0px block in the elric layout) this mod only
// runs the orchestrator's watcher.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, theme, shared, setShared, props } from "herdr";
import { HubDaemon, HubSection, STAGES, stageOf } from "./hubview.js";
import * as ui from "./ui.js";
import { T_XS, T_S, T_L } from "./ui.js";

export default class Orchestra extends View {
  init(_props, cx) {
    if (props()?.role === "daemon") { this.daemon = new HubDaemon(cx); return; }
    this.hub = new HubSection(cx);
    this.showDone = false;
    this.scroll = ScrollHandle.new();
    this.jump = null;
    this.width = 0;
    // Statuses move on their own: redraw once a minute.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  groups() { return shared("orchestra.groups") ?? []; }
  setGroups(list) { setShared("orchestra.groups", list); }

  // ---------- view ----------

  // The pipeline as a segment: display and jump only. Counts stay two characters
  // (`99+`). When the panel is too narrow for the labels, the bar shows counters only
  // (`12 · 1 · 1 · 1`): no stage ever falls away, each counter names its stage in the
  // tooltip (B5, dritter Durchgang).
  stages(t, counts) {
    const count = (n) => (n > 99 ? "99+" : String(n));
    const all = STAGES.map((s) => ({ ...s, n: counts[s.key] ?? 0 }));
    const est = (s) => s.label.length * 6.6 + count(s.n).length * 6.6 + 12;
    const room = Math.max(120, (this.width || 368) - 14 * 2 - 32 - 8);
    const full = all.reduce((w, s) => w + est(s), 0) + (all.length - 1) * 10 <= room;
    const sep = (x) => div().flex_none().text_size(T_S).text_color(t.dim).child(x);
    const parts = [];
    all.forEach((s, i) => {
      const waits = s.key === "review" && s.n > 0;
      if (i) parts.push(sep(full ? "›" : "·"));
      parts.push(div().id(`stage-${s.key}`).flex_none().h(22).px(full ? 4 : 6).gap(ui.GAP_XS).flex().items_center().rounded(6).text_size(T_S)
        .text_color(waits ? t.blocked : s.n ? t.muted : t.dim)
        .tooltip(waits ? `${s.label}: ${s.n} wartet auf dich` : `${s.label}: ${s.n}`)
        .when(s.n > 0, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover).text_color(waits ? t.blocked : t.foreground))
          .on_click((_e, cx) => { this.jump = s.key; if (s.key === "done") this.showDone = true; cx.notify(); }))
        .when(full, (el) => el.child(s.label))
        .child(div().font_medium().child(count(s.n))));
    });
    return h_flex().id("stages").flex_none().min_w(0).h(ui.H_BTN).p(2).gap(0).items_center().overflow_hidden().rounded(8).bg(t.background).border_1().border_color(t.border).children(parts);
  }

  groupCard(t, g) {
    const live = new Map(agents().map((a) => [a.address, a.status]));
    const members = g.members.map((a) => ({ a, st: live.get(a) ?? null }));
    const active = members.filter((m) => m.st === "working" || m.st === "blocked").length;
    const waiting = members.filter((m) => m.st === "blocked").length;
    const finished = active === 0;
    const patch = (p) => this.setGroups(this.groups().map((x) => (x.id === g.id ? { ...x, ...p } : x)));
    return ui.card(t, `grp-${g.id}`)
      .child(h_flex().h(ui.H_BTN_S).gap(ui.GAP_S).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T_L).font_semibold().text_color(t.foreground).child(g.name))
        .child(div().flex_none().text_size(T_XS).text_color(finished ? t.done : waiting ? t.blocked : t.muted)
          .child(finished ? "alle fertig" : `${members.length - active}/${members.length} fertig${waiting ? ` · ${waiting} wartet` : ""}`))
        .child(ui.iconButton(t, `grp-watch-${g.id}`, `mods/workspace-chrome/${g.watch ? "pin" : "pin-off"}.svg`,
          g.watch ? "Wird beobachtet: Meldung, wenn alle fertig sind (klicken: aus)" : "Beobachten: Meldung, wenn alle fertig sind",
          () => patch({ watch: !g.watch, notified: false }), { small: true, active: g.watch }))
        .child(ui.iconButton(t, `grp-x-${g.id}`, "mods/workspace-chrome/x.svg", "Team auflösen (die Agents laufen weiter)",
          () => this.setGroups(this.groups().filter((x) => x.id !== g.id)), { small: true })))
      // One segment per member in its status color: progress and who is still busy at a glance.
      .child(h_flex().h(4).gap(2).children(members.map((m) => div().flex_1().h(4).rounded(4)
        .bg(m.st === "blocked" ? t.blocked : m.st === "working" ? t.working : t.done))))
      .child(h_flex().flex_wrap().gap(ui.GAP_XS).children(members.map((m) => ui.identityChip(t, `gm-${g.id}-${m.a}`, m.a))));
  }

  render(cx) {
    if (this.daemon) { this.daemon.watch(cx); return div(); }
    const t = theme();
    this.hub.sync(cx);
    const all = this.hub.all();
    const by = { todo: [], doing: [], review: [], done: [] };
    for (const tk of all) by[stageOf(tk)].push(tk);
    const counts = Object.fromEntries(STAGES.map((s) => [s.key, by[s.key].length]));
    const groups = this.groups();

    // Sections as direct children of the scroll area, so a stage click can scroll to its header.
    const body = v_flex().id("or-body").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).px(ui.INSET_PANEL).pt(ui.GAP_L).pb(ui.GAP_L).gap(ui.GAP_S);
    const at = {};
    let n = 0;
    const add = (el, key) => { if (key) at[key] = n; body.child(el); n++; };
    add(this.hub.statsRow(t));
    add(this.hub.card(t));
    if (!all.length) {
      add(div().h(200).flex_none().child(ui.empty(t, "Noch keine Tickets. Gib dem Team einen Auftrag (⌘⇧N).", { icon: "mods/orchestra/icons/tray.svg" })));
    } else {
      // Every stage stays visible: an empty one says so instead of disappearing (B6).
      add(ui.sectionHeader(t, "Prüfung", { count: by.review.length, color: t.blocked,
        right: by.review.length ? div().text_size(T_S).text_color(t.blocked).child("wartet auf dich") : null }), "review");
      if (!by.review.length) add(ui.empty(t, "Nichts in Prüfung.", { row: true }));
      // One primary button per area: the oldest ticket waiting for you (B7).
      const oldest = by.review[by.review.length - 1];
      for (const tk of by.review) add(this.hub.ticketRow(t, tk, { primary: tk === oldest }));
      add(ui.sectionHeader(t, "In Arbeit", { count: by.doing.length, color: t.working }), "doing");
      if (!by.doing.length) add(ui.empty(t, "Nichts in Arbeit.", { row: true }));
      for (const tk of by.doing) add(this.hub.ticketRow(t, tk));
      add(this.hub.budgetChips(t));
      add(ui.sectionHeader(t, "Geplant", { count: by.todo.length }), "todo");
      if (!by.todo.length) add(ui.empty(t, "Nichts geplant.", { row: true }));
      for (const tk of by.todo) add(this.hub.ticketRow(t, tk));
    }
    if (groups.length) {
      add(ui.sectionHeader(t, "Teams", { count: groups.length }));
      for (const g of groups) add(this.groupCard(t, g));
    }
    if (all.length) {
      add(ui.sectionHeader(t, "Fertig", { count: by.done.length, id: "sec-done", open: this.showDone,
        onClick: (cx) => { this.showDone = !this.showDone; cx.notify(); } }), "done");
      if (this.showDone) {
        if (!by.done.length) add(ui.empty(t, "Nichts fertig.", { row: true }));
        for (const tk of by.done) add(this.hub.ticketRow(t, tk));
      }
    }
    if (this.jump && at[this.jump] != null) { this.scroll.scroll_to_item(at[this.jump]); this.jump = null; }

    return v_flex().id("orchestra").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .on_size_change((size, cx) => { const w = Math.round(size.width); if (w !== this.width) { this.width = w; cx.notify(); } })
      .child(ui.panelHeader(t, "Team", [ui.spaceChip(t), this.hub.freshChip(t), this.stages(t, counts)].filter(Boolean)))
      .child(body);
  }
}
