// Inbox: the one place where everything waiting for you lands, on every space and
// machine, in this order: Rückfragen (blocked agents, and the orchestrator when it
// asks), Abnahmen (the orchestrator's tickets in review: Prüfen opens the review
// window on the ticket), Fertig (finished agents), then the working ones, dimmed.
// The selected entry shows on the right: an agent's or the orchestrator's screen
// with a reply field, or a ticket's summary, gates and evidence.
// ↑/↓ select, ↵ go to it / Prüfen, r reply, v review (finished agent), Esc close.
// "Since" comes from the status bar, which records when each agent's status changed
// (shared "attention.since"); without it, the order falls back to agents()' seq.
// The count in the title is the tab bar's Inbox count (spec 7.3).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, terminals, run, hc, exec, theme, props, closeOverlay, openOverlay, shared } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M, T_L, T_XL } from "./ui.js";

const ORCH = "orchestrator";
const GROUPS = [
  { key: "ask", label: "Rückfragen", color: (t) => t.blocked },
  { key: "review", label: "Abnahmen", color: (t) => t.blocked },
  { key: "done", label: "Fertig", color: (t) => t.done },
  { key: "work", label: "Arbeitet", color: (t) => t.working },
];
const PREVIEW_LINES = 22;
const REFRESH = 2500;

const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : null);
const baseName = (p) => p.replace(/\/+$/, "").split("/").pop() || p;
const errorLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop().slice(0, 160);
function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 60 ? "gerade" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

// Spec 7.3, literally: the same number as the tab bar's Inbox badge.
export function inboxCount() {
  const all = agents();
  const orchestratorBlocked = terminals().some((x) => x.name === ORCH && x.state === "live" && x.status === "blocked");
  const blocked = all.filter((a) => a.status === "blocked").length + (orchestratorBlocked ? 1 : 0);
  const review = (shared("orchestra.tickets") ?? []).filter((t) => t.status === "review").length;
  const done = all.filter((a) => a.status === "done").length;
  return { blocked, review, done };
}

export default class Inbox extends View {
  init(_props, cx) {
    this.key = null;             // the selected entry, kept across reorders
    this.previews = {};          // address → { at, lines, error }
    this.loading = new Set();
    this.sent = null;            // { key, ok, text }
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    // One field per addressee, so the placeholder says who gets the answer.
    this.replies = {
      agent: InputState.new({ placeholder: "Antwort an den Agent… (↵ senden)" }),
      orch: InputState.new({ placeholder: "Antwort an den Orchestrator… (↵ senden)" }),
    };
    for (const input of Object.values(this.replies)) input.on("submit", (_e, cx) => this.send(cx));
    cx.timer.after(50, () => this.handle.focus());
    cx.timer.every(REFRESH, (cx) => { const e = this.entry(); if (e?.address) this.load(e.address, cx, true); });
  }

  // Everything in the inbox, grouped and ordered: oldest first within a group.
  entries() {
    const since = shared("attention.since") ?? {};
    const at = (a) => (since[a.address]?.status === a.status ? since[a.address].at : null);
    const group = { blocked: "ask", done: "done", working: "work" };
    const list = agents().filter((a) => a.status in group)
      .map((a) => ({ kind: "agent", key: a.address, address: a.address, group: group[a.status], a, since: at(a), order: at(a) ?? a.seq }));
    const o = terminals().find((x) => x.name === ORCH && x.state === "live");
    if (o?.status === "blocked" && !list.some((e) => e.address === o.address)) {
      list.push({ kind: "orch", key: "orch", address: ORCH, group: "ask", o, since: null, order: -1 });
    }
    for (const tk of (shared("orchestra.tickets") ?? []).filter((x) => x.status === "review")) {
      list.push({ kind: "ticket", key: `ticket:${tk.id}`, group: "review", tk, order: tk.updated ?? "" });
    }
    const rank = Object.fromEntries(GROUPS.map((g, i) => [g.key, i]));
    return list.sort((x, y) => rank[x.group] - rank[y.group] || (x.order < y.order ? -1 : x.order > y.order ? 1 : 0));
  }

  entry() { return this.entries().find((e) => e.key === this.key) ?? null; }

  load(address, cx, force) {
    const have = this.previews[address];
    if (this.loading.has(address) || (!force && have && Date.now() - have.at < REFRESH)) return;
    this.loading.add(address);
    cx.spawn(async (cx) => {
      const slot = { at: Date.now(), lines: [], error: null };
      try {
        const r = await hc(["read", address, "--lines", "40"]);
        if (r.code !== 0) throw new Error(errorLine(r));
        const lines = ui.plain(r.stdout).replace(/\s+$/, "").split("\n").map((l) => l.replace(/\s+$/, ""));
        slot.lines = lines.slice(-PREVIEW_LINES);
      } catch (e) { slot.error = String(e?.message ?? e).slice(0, 200); }
      this.loading.delete(address);
      this.previews[address] = slot;
      cx.notify();
    });
  }

  close() { closeOverlay(props().overlay); }

  // ↵ on an entry: go to the agent, peek at the orchestrator, check the ticket.
  activate(e) {
    if (!e) return;
    if (e.kind === "ticket") return this.check(e.tk);
    this.close();
    if (e.kind === "orch") run("terminal.peek", { terminal: e.o.address });
    else ui.focusAgent(e.address);
  }

  check(tk) {
    this.close();
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
      props: { ticket: tk.id, terminal: tk.terminal || null, folder: tk.worktree || tk.repo, on: tk.machine || null } });
  }

  review(e) {
    if (e?.kind !== "agent") return;
    this.close();
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680, props: { terminal: e.address } });
  }

  send(cx) {
    const e = this.entry(), input = this.replies[e?.kind];
    const text = input?.value().trim();
    if (!text || !e || e.kind === "ticket") return;
    // A blocked agent shows a question or dialog: typing into it is the answer.
    const blocked = e.kind === "orch" || e.a?.status === "blocked";
    const args = ["send", e.address, text, ...(blocked ? ["--force"] : [])];
    this.sent = { key: e.key, ok: null, text: "sende …" };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(args);
        this.sent = r.code === 0 ? { key: e.key, ok: true, text: "gesendet" } : { key: e.key, ok: false, text: errorLine(r) };
        if (r.code === 0) input.set_value("");
      } catch (err) { this.sent = { key: e.key, ok: false, text: String(err?.message ?? err) }; }
      this.load(e.address, cx, true);
      this.handle.focus();
      cx.notify();
    });
  }

  select(list, i, cx) {
    if (!list.length) return;
    const e = list[(i + list.length) % list.length];
    this.key = e.key;
    this.reveal = true; // render scrolls to it: section headings shift child indexes
    if (e.address) this.load(e.address, cx, false);
    cx.notify();
  }

  onKey(ev, cx, list, sel) {
    const i = list.findIndex((e) => e.key === this.key);
    const k = ev.key;
    if (k === "down" || k === "j") this.select(list, i + 1, cx);
    else if (k === "up" || k === "k") this.select(list, i - 1, cx);
    else if (k === "enter") this.activate(sel);
    else if (k === "r" || k === "tab") { this.replies[sel?.kind]?.focus(); }
    else if (k === "v") { if (sel?.kind === "agent" && sel.a.status === "done") this.review(sel); }
    else if (k === "escape") this.close();
    else return;
    cx.stop_propagation();
  }

  // ---------- view ----------

  avatar(t, e) {
    if (e.kind === "orch") return svg("mods/orchestra/icon.svg").size(16).flex_none().text_color(t.muted);
    if (e.kind === "ticket") return svg("mods/review/icon.svg").size(16).flex_none().text_color(t.muted);
    const who = ui.identity(e.address), p = who.program;
    if (who.avatar) return image(who.avatar).w(16).h(16).flex_none();
    if (p?.icon) return p.tint ? svg(p.icon).size(16).flex_none().text_color(t.muted) : image(p.icon).w(16).h(16).flex_none();
    return div().size(16).flex_none();
  }

  // Two-line list row (h 44): who/what and its state; where, below.
  row(t, e, on, list, i) {
    let status, name, title, meta, right;
    if (e.kind === "agent") {
      const a = e.a, m = machineOf(a.address);
      status = a.status;
      name = ui.identity(a.address).name;
      title = ui.plain(a.title) || a.program?.name || "";
      meta = `${m ? `${m} · ` : ""}${a.space_name} · Tab ${a.tab_name}`;
      right = div().flex_none().text_size(T_S).text_color(ui.statusColor(t, a.status)).child(`${ui.STATUS_WORD[a.status]}${e.since ? ` · ${ago(e.since)}` : ""}`);
    } else if (e.kind === "orch") {
      status = "blocked"; name = "Orchestrator"; title = "fragt dich"; meta = "Rückfrage des Orchestrators";
      right = div().flex_none().text_size(T_S).text_color(t.blocked).child("wartet");
    } else {
      const tk = e.tk;
      status = "blocked"; name = null; title = tk.title;
      meta = [tk.branch || tk.repo?.split("/").pop(), tk.machine].filter(Boolean).join(" · ");
      right = h_flex().flex_none().gap(ui.GAP_XS).children(ui.gateChips(t, tk).slice(0, 1));
    }
    return v_flex().id(`ib-${e.key}`).h(ui.H_ROW2).flex_none().px(8).justify_center().gap(2).rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(e.group === "work", (el) => el.opacity(0.6))
      .on_click((ev, cx) => { if (ev.click_count === 2) this.activate(e); else { this.select(list, i, cx); this.handle.focus(); } })
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(ui.statusIcon(t, status))
        .child(this.avatar(t, e))
        .when(Boolean(name), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(T_M).text_color(t.foreground).when(on, (d) => d.font_semibold()).child(name)))
        .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(name ? t.muted : t.foreground).child(title))
        .child(right))
      .child(div().pl(40).truncate().text_size(T_S).text_color(t.dim).child(meta));
  }

  screen(t, address) {
    const p = this.previews[address];
    return v_flex().id("ib-screen").flex_1().min_h(0).p(10).rounded(8).bg(t.background).border_1().border_color(t.border)
      .overflow_y_scrollbar().text_size(T_S).text_color(t.muted)
      .when(!p, (el) => el.child(ui.loading(t, "lese Bildschirm …")))
      .when(Boolean(p?.error), (el) => el.child(div().text_color(t.blocked).child(p.error)))
      .when(Boolean(p && !p.error), (el) => el.children(p.lines.map((l, i) => div().id(`ln-${i}`).whitespace_nowrap().overflow_hidden().child(l || " "))));
  }

  replyField(t, e) {
    const sent = this.sent?.key === e.key ? this.sent : null;
    return v_flex().flex_none().gap(ui.GAP_S)
      .child(ui.inputBox(t, `ib-reply-${e.kind}`, Input.new(this.replies[e.kind]), {
        send: ui.sendButton(t, "ib-send", "mods/orchestra/icons/send.svg", "Senden (↵)", (cx) => this.send(cx)),
      }))
      .child(div().h(16).text_size(T_XS).text_color(sent ? (sent.ok === false ? t.blocked : sent.ok ? t.done : t.dim) : t.dim).truncate()
        .child(sent ? sent.text : e.kind === "orch" || e.a?.status === "blocked" ? "Die Antwort beantwortet die offene Frage." : " "));
  }

  detail(t, e) {
    if (!e) return v_flex().flex_1().child(ui.empty(t, "Wähle links einen Eintrag."));
    if (e.kind === "ticket") {
      const tk = e.tk, evidence = tk.evidence ?? [];
      return v_flex().flex_1().min_w(0).min_h(0).gap(ui.GAP_L)
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(ui.statusIcon(t, "blocked"))
          .child(div().flex_1().min_w(0).truncate().text_size(T_L).font_semibold().text_color(t.foreground).child(tk.title)))
        .child(h_flex().flex_wrap().gap(ui.GAP_S).items_center()
          .when(Boolean(tk.terminal), (el) => el.child(ui.identityChip(t, "ib-tk-who", tk.terminal)))
          .child(div().text_size(T_S).text_color(t.dim).child(tk.branch || tk.repo || ""))
          .children(ui.gateChips(t, tk)))
        .child(v_flex().id("ib-summary").flex_1().min_h(0).overflow_y_scrollbar().gap(ui.GAP_S)
          .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Zusammenfassung"))
          .child(div().text_size(T_M).text_color(tk.summary ? t.foreground : t.dim).child(tk.summary || "Keine Zusammenfassung des Orchestrators."))
          .child(div().pt(ui.GAP_S).text_size(T_S).font_medium().text_color(t.muted).child("Nachweise"))
          .when(!evidence.length, (el) => el.child(div().text_size(T_S).text_color(t.dim).child("keine angegeben")))
          .children(evidence.map((p, i) => (tk.machine
            ? div().text_size(T_S).text_color(t.dim).child(`${p} (auf ${tk.machine})`)
            : ui.link(t, `ib-ev-${i}`, p, () => exec("open", [p]).catch(() => null), { tip: "Öffnen" })))))
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(ui.button(t, "ib-check", "Prüfen", () => this.check(tk), { kind: "primary", tip: "Review-Fenster: Zusammenfassung, Nachweise, Diff; dort Mergen, PR oder Abnehmen (↵)" }))
          .child(div().text_size(T_XS).text_color(t.dim).child("↵")));
    }
    if (e.kind === "orch") {
      return v_flex().flex_1().min_w(0).min_h(0).gap(ui.GAP_L)
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(svg("mods/orchestra/icon.svg").size(14).text_color(t.foreground))
          .child(div().flex_1().min_w(0).truncate().text_size(T_L).font_semibold().text_color(t.foreground).child("Orchestrator"))
          .child(ui.statusChip(t, "blocked")))
        .child(this.screen(t, e.address))
        .child(this.replyField(t, e))
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(ui.button(t, "ib-go", "Terminal öffnen", () => this.activate(e), { tip: "Terminal des Orchestrators öffnen (↵)" })));
    }
    const a = e.a;
    return v_flex().flex_1().min_w(0).min_h(0).gap(ui.GAP_L)
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(ui.identityChip(t, "ib-who", a.address))
        .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.muted).child(`${a.space_name} / ${a.tab_name}`))
        .child(div().flex_none().text_size(T_XS).text_color(t.dim).child(a.address)))
      .child(this.screen(t, a.address))
      .child(this.replyField(t, e))
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(ui.button(t, "ib-go", "Zum Agent", () => this.activate(e), { kind: "primary", tip: "Zum Agent gehen (↵)" }))
        .when(a.status === "done", (el) => el.child(ui.button(t, "ib-review", "Review", () => this.review(e), { tip: "Änderungen des Agents prüfen (v)" }))));
  }

  render(cx) {
    const t = theme();
    const list = this.entries();
    let i = list.findIndex((e) => e.key === this.key);
    if (i < 0 && list.length) { i = 0; this.key = list[0].key; if (list[0].address) this.load(list[0].address, cx, false); }
    const sel = i >= 0 ? list[i] : null;
    const { blocked, review, done } = inboxCount();
    const waits = blocked + review;
    const meta = waits ? `${waits} ${waits === 1 ? "wartet" : "warten"} auf dich` : done ? `${done} fertig` : "alles ruhig";

    const col = v_flex().id("ib-list").w(320).flex_none().h_full().min_h(0).pr(ui.GAP_M).overflow_y_scrollbar().track_scroll(this.scroll)
      .border_r(1).border_color(t.border);
    let child = 0;
    for (const g of GROUPS) {
      const items = list.filter((e) => e.group === g.key);
      if (!items.length) continue;
      col.child(ui.sectionHeader(t, g.label, { count: items.length, color: g.key === "work" ? t.muted : g.color(t), px: 8 }));
      child++;
      for (const e of items) {
        const n = list.indexOf(e);
        if (n === i && this.reveal) { this.scroll.scroll_to_item(child); this.reveal = false; }
        col.child(this.row(t, e, n === i, list, n));
        child++;
      }
    }

    // A popup is as tall as its content, at most its mod.json height (0.75 of the window):
    // asking for more than any window has makes the list and the detail fill exactly that.
    return v_flex().id("inbox").track_focus(this.handle).w_full().h(4000).min_h(0).p(ui.GAP_XL).gap(ui.GAP_L).bg(t.popover).text_size(T_M)
      .on_key_down((ev, cx) => this.onKey(ev, cx, list, sel))
      .child(h_flex().h(28).flex_none().gap(ui.GAP_M).items_center()
        .child(div().flex_none().text_size(T_XL).font_semibold().text_color(t.foreground).child("Inbox"))
        .when(waits > 0, (el) => el.child(ui.counterBadge(t, waits, t.blocked)))
        .when(!waits && done > 0, (el) => el.child(ui.counterBadge(t, done, t.done)))
        .child(div().flex_none().text_size(T_S).text_color(t.muted).child(meta))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T_XS).text_color(t.dim).child("↑↓ wählen · ↵ hin/prüfen · r antworten · v Review"))
        .child(div().id("ib-esc").flex_none().h(ui.H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(t.dim)
          .cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Schließen (Esc)").on_click(() => this.close()).child("Esc")))
      .child(list.length
        ? h_flex().flex_1().min_h(0).gap(ui.GAP_L).items_start()
          .child(col)
          .child(this.detail(t, sel).h_full())
        : ui.empty(t, "Nichts wartet auf dich. Rückfragen, Abnahmen und fertige Agents erscheinen hier.", { icon: "mods/inbox/icon.svg" }));
  }
}
