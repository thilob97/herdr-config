// Inbox: every agent that waits for you, on every space and machine. Blocked
// first, then finished, oldest first; working agents fold below. The selected
// agent's screen shows on the right, and a reply goes to it without leaving
// where you are. ↑/↓ select, ↵ go to it, r reply, v review (finished), Esc close.
// "Since" comes from the status bar, which records when each agent's status changed
// (shared "attention.since"); without it, the order falls back to agents()' seq.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, run, hc, theme, props, closeOverlay, openOverlay, shared } from "herdr";

const RANK = { blocked: 0, done: 1, working: 2 };
const WORD = { blocked: "wartet", done: "fertig", working: "arbeitet" };
const PREVIEW_LINES = 22;
const REFRESH = 2500;

// Titles and screens carry Nerd Font icons and emoji the UI font can't draw.
const plain = (s) => (s ?? "").replace(/[\uE000-\uF8FF\u{10000}-\u{10FFFF}]\s*/gu, "");
const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : null);
function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 60 ? "gerade" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}
function icon(p, size, color) {
  if (!p?.icon) return div().size(size).flex_none();
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Inbox extends View {
  init(_props, cx) {
    this.address = null;         // the selected agent, kept across reorders
    this.previews = {};          // address → { at, lines, error }
    this.loading = new Set();
    this.sent = null;            // { address, ok, text }
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.reply = InputState.new({ placeholder: "Antwort an den Agent… (↵ senden)" });
    this.reply.on("submit", (_e, cx) => this.send(cx));
    cx.timer.after(50, () => this.handle.focus());
    cx.timer.every(REFRESH, (cx) => { if (this.address) this.load(this.address, cx, true); });
  }

  rows() {
    const since = shared("attention.since") ?? {};
    const at = (a) => since[a.address]?.status === a.status ? since[a.address].at : null;
    return agents()
      .filter((a) => a.status in RANK)
      .map((a) => ({ a, since: at(a) }))
      .sort((x, y) => RANK[x.a.status] - RANK[y.a.status] || (x.since ?? x.a.seq) - (y.since ?? y.a.seq));
  }

  load(address, cx, force) {
    const have = this.previews[address];
    if (this.loading.has(address) || (!force && have && Date.now() - have.at < REFRESH)) return;
    this.loading.add(address);
    cx.spawn(async (cx) => {
      const slot = { at: Date.now(), lines: [], error: null };
      try {
        const r = await hc(["read", address, "--lines", "40"]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
        const lines = plain(r.stdout).replace(/\s+$/, "").split("\n").map((l) => l.replace(/\s+$/, ""));
        slot.lines = lines.slice(-PREVIEW_LINES);
      } catch (e) { slot.error = String(e?.message ?? e).slice(0, 200); }
      this.loading.delete(address);
      this.previews[address] = slot;
      cx.notify();
    });
  }

  close() { closeOverlay(props().overlay); }

  go(a) {
    if (!a) return;
    this.close();
    run("pane.focus", { pane: a.pane });
  }

  review(a) {
    if (!a) return;
    this.close();
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680, props: { terminal: a.address } });
  }

  send(cx) {
    const text = this.reply.value().trim();
    const a = agents().find((x) => x.address === this.address);
    if (!text || !a) return;
    // A blocked agent shows a question or dialog: typing into it is the answer.
    const args = ["send", a.address, text, ...(a.status === "blocked" ? ["--force"] : [])];
    this.sent = { address: a.address, ok: null, text: "sende…" };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(args);
        this.sent = r.code === 0
          ? { address: a.address, ok: true, text: "gesendet" }
          : { address: a.address, ok: false, text: (r.stderr || r.stdout).trim().split("\n").pop().slice(0, 160) };
        if (r.code === 0) this.reply.set_value("");
      } catch (e) { this.sent = { address: a.address, ok: false, text: String(e?.message ?? e) }; }
      this.load(a.address, cx, true);
      this.handle.focus();
      cx.notify();
    });
  }

  select(rows, i, cx) {
    if (!rows.length) return;
    const n = (i + rows.length) % rows.length;
    this.address = rows[n].a.address;
    this.reveal = true; // render scrolls to it: section headings shift child indexes
    this.load(this.address, cx, false);
    cx.notify();
  }

  key(e, cx, rows, sel) {
    const i = rows.findIndex((r) => r.a.address === this.address);
    const k = e.key;
    if (k === "down" || k === "j") this.select(rows, i + 1, cx);
    else if (k === "up" || k === "k") this.select(rows, i - 1, cx);
    else if (k === "enter") this.go(sel?.a);
    else if (k === "r" || k === "tab") { if (sel) this.reply.focus(); }
    else if (k === "v") { if (sel?.a.status === "done") this.review(sel.a); }
    else if (k === "escape") this.close();
    else return;
    cx.stop_propagation();
  }

  // ---------- view ----------

  status(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    return st === "blocked"
      ? div().relative().size(11).flex_none().flex().items_center().justify_center()
        .child(div().absolute().inset_0().rounded(6).bg(t.blocked + "55").loop("opacity", { from: 0, to: 1, period: 900 }))
        .child(div().size(7).rounded(4).bg(t.blocked))
      : div().size(11).flex_none().flex().items_center().justify_center().child(div().size(7).rounded(4).bg(t[st] ?? t.dim));
  }

  row(t, r, on, cx, rows, i) {
    const a = r.a, m = machineOf(a.address);
    const title = plain(a.title).trim() || a.program?.name || a.address;
    return v_flex().id(`ib-${a.address}`).mx(4).px(10).py(7).gap(3).rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(a.status === "working", (el) => el.opacity(0.7))
      .on_click((e, cx) => { if (e.click_count === 2) this.go(a); else { this.select(rows, i, cx); this.handle.focus(); } })
      .child(h_flex().gap(7).items_center()
        .child(this.status(t, a.status))
        .child(icon(a.program, 13, t.muted))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).when(on, (d) => d.font_semibold()).child(a.program?.name ?? "Agent"))
        .child(div().flex_none().text_size(11).text_color(t[a.status] ?? t.dim).child(`${WORD[a.status]}${r.since ? ` · ${ago(r.since)}` : ""}`)))
      .child(div().pl(18).truncate().text_size(11).text_color(t.muted).child(title))
      .child(div().pl(18).truncate().text_size(10.5).text_color(t.dim).child(`${m ? `${m} · ` : ""}${a.space_name} · Tab ${a.tab_name}`));
  }

  section(t, label, n) {
    return h_flex().px(14).pt(10).pb(3).gap(6).text_size(10.5).font_semibold().text_color(t.dim)
      .child(label.toUpperCase()).child(div().text_color(t.dim).child(String(n)));
  }

  button(t, id, label, hint, action, strong) {
    return h_flex().id(id).h(26).px(9).gap(6).flex_none().items_center().rounded(6).cursor_pointer()
      .text_size(11.5).bg(strong ? t.solid : t.raised).text_color(strong ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(label)
      .when(Boolean(hint), (el) => el.child(div().text_size(10.5).opacity(0.6).child(hint)));
  }

  detail(t, sel, cx) {
    if (!sel) return v_flex().flex_1().items_center().justify_center().text_color(t.dim).child("Wähle links einen Agent.");
    const a = sel.a, p = this.previews[a.address];
    const sent = this.sent?.address === a.address ? this.sent : null;
    return v_flex().flex_1().min_w(0).min_h(0).gap(10)
      .child(h_flex().gap(8).items_center()
        .child(this.status(t, a.status))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground)
          .child(`${a.program?.name ?? "Agent"} · ${a.space_name} / ${a.tab_name}`))
        .child(div().text_size(10.5).text_color(t.dim).child(a.address)))
      .child(v_flex().id("ib-screen").flex_1().min_h(0).p(10).rounded(8).bg(t.background).border(1).border_color(t.border)
        .overflow_y_scrollbar().text_size(11).text_color(t.muted)
        .when(!p, (el) => el.child(div().text_color(t.dim).child("lese Bildschirm…")))
        .when(Boolean(p?.error), (el) => el.child(div().text_color(t.blocked).child(p.error)))
        .when(Boolean(p && !p.error), (el) => el.children(p.lines.map((l, i) => div().id(`ln-${i}`).whitespace_nowrap().overflow_hidden().child(l || " ")))))
      .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().rounded(8).border(1).border_color(t.input).bg(t.background)
        .child(div().text_color(t.dim).child("›"))
        .child(Input.new(this.reply).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .child(h_flex().gap(6).items_center()
        .child(this.button(t, "ib-go", "Zum Agent", "↵", () => this.go(a), true))
        .child(this.button(t, "ib-send", "Senden", "r", (cx) => (this.reply.value().trim() ? this.send(cx) : this.reply.focus()), false))
        .when(a.status === "done", (el) => el.child(this.button(t, "ib-review", "Review", "v", () => this.review(a), false)))
        .child(div().flex_1())
        .when(Boolean(sent), (el) => el.child(div().text_size(11).text_color(sent.ok === false ? t.blocked : sent.ok ? t.done : t.dim).truncate().child(sent.text)))
        .when(a.status === "blocked" && !sent, (el) => el.child(div().text_size(10.5).text_color(t.dim).child("Antwort beantwortet seinen Dialog"))));
  }

  render(cx) {
    const t = theme();
    const rows = this.rows();
    let i = rows.findIndex((r) => r.a.address === this.address);
    if (i < 0 && rows.length) { i = 0; this.address = rows[0].a.address; this.load(this.address, cx, false); }
    const sel = i >= 0 ? rows[i] : null;
    const count = (s) => rows.filter((r) => r.a.status === s).length;
    const waiting = rows.filter((r) => r.a.status !== "working").length;

    const list = v_flex().id("ib-list").w(300).flex_none().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).pb(6);
    let last = null, child = 0;
    rows.forEach((r, n) => {
      const group = r.a.status;
      if (group !== last) {
        list.child(this.section(t, { blocked: "Wartet auf dich", done: "Fertig", working: "Arbeitet" }[group], count(group)));
        last = group;
        child++;
      }
      if (n === i && this.reveal) { this.scroll.scroll_to_item(child); this.reveal = false; }
      list.child(this.row(t, r, n === i, cx, rows, n));
      child++;
    });

    return v_flex().id("inbox").track_focus(this.handle).size_full().min_h(0).p(16).gap(12).bg(t.popover).text_size(12.5)
      .on_key_down((e, cx) => this.key(e, cx, rows, sel))
      .child(h_flex().items_center().gap(10)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Inbox"))
        .child(div().text_size(11.5).text_color(t.muted)
          .child(waiting ? [count("blocked") && `${count("blocked")} wartet`, count("done") && `${count("done")} fertig`].filter(Boolean).join(" · ") : "alles ruhig"))
        .child(div().flex_1())
        .child(div().text_size(10.5).text_color(t.dim).child("↑↓ wählen · ↵ hin · r antworten · v review"))
        .child(div().id("ib-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
      .child(rows.length
        ? h_flex().h(520).flex_none().min_h(0).gap(12).items_start()
          .child(list.h_full().border_r(1).border_color(t.border))
          .child(this.detail(t, sel, cx).h_full())
        : v_flex().flex_1().items_center().justify_center().gap(6)
          .child(div().text_size(14).text_color(t.foreground).child("Niemand wartet auf dich"))
          .child(div().text_size(11.5).text_color(t.dim).child("Agents, die fragen oder fertig sind, erscheinen hier.")));
  }
}
