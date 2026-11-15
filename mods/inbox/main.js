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
import { agents, terminals, run, hc, exec, theme, props, closeOverlay, openOverlay, shared, appHome } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M, T_L, T_XL } from "./ui.js";

const ORCH = "orchestrator";
const PENDING = "quests.pending";
const hubBin = () => `${appHome()}/mods/orchestra/bin/hub`;
const tsMs = (ts) => { const d = new Date(String(ts ?? "").replace(" ", "T")); return Number.isNaN(d.getTime()) ? null : d.getTime(); };
const GROUPS = [
  { key: "ask", label: "Rückfragen", color: (t) => t.blocked },
  { key: "review", label: "Abnahmen", color: (t) => t.blocked },
  { key: "done", label: "Fertig", color: (t) => t.done },
  { key: "work", label: "Arbeitet", color: (t) => t.working },
];
const PREVIEW_LINES = 22;
const REFRESH = 2500;
// As tall as no window is: the popup then takes its mod.json height (0.75 of the window)
// and the list and detail fill it exactly.
const FILL = 4000;

const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : null);
const baseName = (p) => p.replace(/\/+$/, "").split("/").pop() || p;
const errorLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop().slice(0, 160);

// Labels wie auf der Board-Karte (mods/board/card.js): höchstens zwei Chips, alle Labels
// im Tooltip; die Chips tragen den vollen Text und schrumpfen selbst. Herdr kennt kein
// Modul über Mod-Ordner hinweg, deshalb steht die Logik hier wortgleich.
const PRIO = /^(p[0-3]|prio[-:]?[0-3]|kritisch|hoch|urgent)$/i;
const splitList = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map((s) => String(s).trim()).filter(Boolean);
function labelChips(t, tk) {
  const ordered = [...new Set([...splitList(tk.labels), ...splitList(tk.tags)])].filter((l) => !PRIO.test(l));
  if (!ordered.length) return [];
  const all = ordered.join(", ");
  const shown = ordered.slice(0, ordered.length > 2 ? 1 : 2);
  const out = shown.map((l) => ({ text: l, color: t.muted, tip: all }));
  if (ordered.length > shown.length) out.push({ text: `+${ordered.length - shown.length}`, color: t.dim, tip: all, fixed: true });
  return out;
}
const labelPill = (t, text, color, { tip, shrink = false } = {}) => h_flex().flex_none().h(16).px(2).items_center().rounded(4)
  .when(shrink, (el) => el.flex_shrink_1().min_w(0)).when(Boolean(tip), (el) => el.tooltip(tip))
  .bg(color + "26").text_size(T_XS).font_medium().text_color(color)
  .child(shrink ? div().min_w(0).truncate().child(text) : text);

// Titel auf zwei Zeilen mit „…" an einer Wortgrenze (Kopie aus mods/board/card.js).
const clampTitle = (s, per = 34) => {
  const text = String(s ?? "").replace(/\s+/g, " ").trim();
  const budget = Math.max(8, Math.floor(per));
  const words = text.split(" ").filter(Boolean);
  const lines = [];
  let i = 0;
  for (let li = 0; li < 2 && i < words.length; li++) {
    const room = li === 1 ? Math.max(1, budget - 1) : budget;
    if (words[i].length > room) {
      lines.push(`${words[i].slice(0, Math.max(1, room - 1))}…`);
      return lines.join(" ");
    }
    let line = words[i++];
    while (i < words.length && `${line} ${words[i]}`.length <= room) line += ` ${words[i++]}`;
    lines.push(line);
  }
  if (i >= words.length) return lines.join(" ");
  return `${lines.join(" ")}…`;
};

// Ein Terminal-Titel beginnt oft mit einem Programm-Glyph und Steuerzeichen („π ", „✳ ").
// Nur der Anfang fällt weg; der Titel selbst bleibt, wie das Terminal ihn schreibt.
const TITLE_LEAD = /^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufe00-\ufe0f\ufeff\u{e000}-\u{f8ff}\u{1f000}-\u{1faff}\p{So}\p{Sk}]+/u;
const TITLE_GLYPH = /^(?:π|✳|✻|✽|✢|✶|⏺|●|◐|◑|◒|◓|◆|◇|▲|△|■|□)+/u;
function cleanTitle(s) {
  let text = String(s ?? "");
  for (let i = 0; i < 4; i++) {
    const next = text.replace(TITLE_LEAD, "").replace(TITLE_GLYPH, "");
    if (next === text) break;
    text = next;
  }
  return text.trim();
}

// The sidebar's state for a card: its own or the most urgent of its sub-agents (terminals
// it started and omp's task sub-agents), so "Arbeitet" counts one number there and here (N8).
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const SUB_STATUS = { running: "working", pending: "idle", completed: "done", failed: "blocked", cancelled: "blocked", aborted: "blocked" };
const moreUrgent = (x, y) => ((RANK[y] ?? 0) > (RANK[x] ?? 0) ? y : x);
function effectiveStatus(a, terms, subs) {
  // As the sidebar ranks children: a finished sub-agent counts as idle, an error as waiting.
  const kid = (t) => (t.status === "error" ? "blocked" : t.status === "done" ? "idle" : t.status ?? "idle");
  let st = a.status ?? "idle";
  const walk = (addr) => {
    for (const k of terms.filter((x) => x.parent === addr && x.state !== "finished")) { st = moreUrgent(st, kid(k)); walk(k.address); }
    for (const s of subs[addr] ?? []) st = moreUrgent(st, s.status === "completed" ? "idle" : SUB_STATUS[s.status] ?? "idle");
  };
  walk(a.address);
  return st;
}
// A sub-agent with a pane is nested under its parent's card, not a row of its own.
function nested(all, address) {
  const seen = new Set();
  for (let p = all.find((x) => x.address === address)?.parent; p && !seen.has(p); p = all.find((x) => x.address === p)?.parent) {
    seen.add(p);
    if (all.some((x) => x.address === p)) return true;
  }
  return false;
}

// Spec 7.3, literally: the same number as the tab bar's Inbox badge, but for the factory
// of this window's workspace. A dispatched agent lives in a throwaway space; its ticket
// names the workspace. `total` counts the whole home, for the tooltip.
export function inboxCount() {
  const sp = ui.activeSpace();
  const counts = (space) => {
    const tks = ui.teamTickets();
    const own = space ? ui.workspaceId(space.id, tks) : "";
    const all = agents();
    const scoped = (a) => { const ws = ui.agentWorkspace(a, tks); return !own || !ws || ws === own; };
    const orchestratorBlocked = terminals().some((x) => x.name === ORCH && x.state === "live" && x.status === "blocked"
      && (!own || ui.workspaceId(x.labels?.["hub.space"] || x.labels?.["herdr.space"] || "", tks) === own));
    return {
      blocked: all.filter((a) => a.status === "blocked" && scoped(a)).length + (orchestratorBlocked ? 1 : 0),
      review: tks.filter((t) => t.status === "review" && (!space || ui.inScope(t, tks))).length,
      done: all.filter((a) => a.status === "done" && scoped(a)).length,
    };
  };
  return { ...counts(sp), total: counts(null) };
}

/** The head's equation, one term per group: blocked agents and the orchestrator,
 *  questions from tickets, review tickets, finished and working agents (with their
 *  handover lines). Built from the list itself, so it adds up to its length. */
export function inboxNote(list) {
  const count = (f) => (list ?? []).filter(f).length;
  const ask = count((e) => e.group === "ask" && e.kind !== "question");
  const questions = count((e) => e.kind === "question");
  const review = count((e) => e.group === "review");
  const done = count((e) => e.group === "done");
  const work = count((e) => e.group === "work");
  const total = (list ?? []).length;
  return { ask, questions, review, done, work, total,
    text: `Inbox ${ask} Rückfragen + ${questions} Fragen + ${review} Abnahmen + ${done} fertig + ${work} in Arbeit/unterwegs = ${total} Zeilen` };
}

export default class Inbox extends View {
  init(_props, cx) {
    this.key = null;             // the selected entry, kept across reorders
    this.previews = {};          // address → { at, lines, error }
    this.loading = new Set();
    this.sent = null;            // { key, ok, text }
    this.answered = new Set();   // ticket ids answered here, until the shared data catches up
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    // One field per addressee, so the placeholder says who gets the answer.
    this.replies = {
      agent: InputState.new({ placeholder: "Antwort an den Agent… (↵ senden)" }),
      orch: InputState.new({ placeholder: "Antwort an den Orchestrator… (↵ senden)" }),
      question: InputState.new({ placeholder: "Antwort ins Ticket (an @agent)… (↵ senden)" }),
    };
    for (const input of Object.values(this.replies)) input.on("submit", (_e, cx) => this.send(cx));
    this.focus = ui.focusFields();
    this.focus.track(this.replies.agent, "ib-reply-agent");
    this.focus.track(this.replies.orch, "ib-reply-orch");
    this.focus.track(this.replies.question, "ib-reply-question");
    cx.timer.after(50, () => this.handle.focus());
    cx.timer.every(REFRESH, (cx) => { const e = this.entry(); if (e?.address) this.load(e.address, cx, true); });
  }

  // Everything in the inbox, grouped and ordered: oldest first within a group. Only the
  // factory of this window's workspace: agents, the orchestrator and the tickets of other
  // spaces stay out (ui.inScope keeps old tickets without `space`). A dispatched agent
  // lives in a throwaway space; `ui.agentWorkspace` maps it to its ticket's workspace.
  entries() {
    const sp = ui.activeSpace();
    const tks = ui.teamTickets();
    const own = sp ? ui.workspaceId(sp.id, tks) : "";
    const since = shared("attention.since") ?? {};
    const at = (a) => (since[a.address]?.status === a.status ? since[a.address].at : null);
    const group = { blocked: "ask", done: "done", working: "work" };
    const all = agents(), terms = terminals(), subs = shared("omp.subagents") ?? {};
    const mine = (a) => { const ws = ui.agentWorkspace(a, tks); return !own || !ws || ws === own; };
    const list = all.filter((a) => !nested(terms, a.address) && mine(a))
      .map((a) => ({ a, st: effectiveStatus(a, terms, subs) }))
      .filter(({ st }) => st in group)
      .map(({ a, st }) => ({ kind: "agent", key: a.address, address: a.address, group: group[st], a, st, since: at({ ...a, status: st }), order: at(a) ?? a.seq }));
    const o = terminals().find((x) => x.name === ORCH && x.state === "live"
      && (!own || ui.workspaceId(x.labels?.["hub.space"] || x.labels?.["herdr.space"] || "", tks) === own));
    if (o?.status === "blocked" && !list.some((e) => e.address === o.address)) {
      list.push({ kind: "orch", key: "orch", address: o.address, group: "ask", o, since: null, order: -1 });
    }
    for (const tk of tks.filter((x) => x.status === "review" && ui.inScope(x, tks))) {
      list.push({ kind: "ticket", key: `ticket:${tk.id}`, group: "review", tk, order: tk.updated ?? "" });
    }
    // Open questions to the human live in the ticket: one row per ticket, answered there.
    for (const tk of tks.filter((x) => x.question && x.status !== "done" && !this.answered.has(x.id) && ui.inScope(x, tks))) {
      list.push({ kind: "question", key: `q:${tk.id}`, group: "ask", tk, q: tk.question, order: tk.updated ?? "" });
    }
    for (const p of (shared(PENDING) ?? [])) {
      // A handover line lives at most 15 minutes: after that the crew had its chance.
      if (Date.now() - (p.at ?? 0) > 15 * 60000) continue;
      // An Auftrag belongs to the workspace it was sent from; old lines without a
      // space stay visible, like old tickets in ui.inScope.
      if (own && p.space && p.space !== own) continue;
      list.push({ kind: "pending", key: `pending:${p.key}`, group: "work", p, order: p.at ?? "" });
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
    if (e.kind === "question") return this.check(e.tk);
    if (e.kind === "ticket") return this.check(e.tk);
    if (e.kind === "pending") { this.close(); run("tabs-graph.panel-team"); return; }
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
    // A question waits in the ticket: the answer is a comment there, not a terminal keystroke.
    if (e.kind === "question") {
      this.sent = { key: e.key, ok: null, text: "schreibe ins Ticket …" };
      cx.notify();
      cx.spawn(async (cx) => {
        try {
          const r = await exec(hubBin(), ["ticket", "comment", e.tk.id, "--from", "mensch", text], { timeout: 30000 });
          const ok = r.code === 0;
          if (ok) { input.set_value(""); this.answered.add(e.tk.id); }
          this.sent = { key: e.key, ok, text: ok ? `Kommentar im Ticket ${e.tk.id}` : errorLine(r) };
        } catch (err) { this.sent = { key: e.key, ok: false, text: String(err?.message ?? err) }; }
        this.handle.focus();
        cx.notify();
      });
      return;
    }
    // A blocked agent shows a question or dialog: typing into it is the answer.
    const blocked = e.kind === "orch" || e.st === "blocked" || e.a?.status === "blocked";
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
    else if (k === "v") { if (sel?.kind === "agent" && (sel.st ?? sel.a.status) === "done") this.review(sel); }
    else if (k === "escape") this.close();
    else return;
    cx.stop_propagation();
  }

  // ---------- view ----------

  avatar(t, e) {
    if (e.kind === "orch" || e.kind === "pending") return svg("mods/orchestra/icon.svg").size(16).flex_none().text_color(t.muted);
    if (e.kind === "ticket") return svg("mods/review/icon.svg").size(16).flex_none().text_color(t.muted);
    const who = ui.identity(e.address), p = who.program;
    if (who.avatar) return image(who.avatar).w(16).h(16).flex_none();
    if (p?.icon) return p.tint ? svg(p.icon).size(16).flex_none().text_color(t.muted) : image(p.icon).w(16).h(16).flex_none();
    return div().size(16).flex_none();
  }

  // Drei Zeilen, höchstens 72 px: wer/was mit Zustand und Labels; darunter der Titel
  // auf zwei Zeilen (Wortgrenze, „…", Tooltip mit dem ganzen Text); darunter wo und
  // die Gates. Labels schrumpfen wie auf der Board-Karte, die Metazeile selbst nicht
  // unter 44 px — so bleibt kein „h…" stehen.
  row(t, e, on, list, i) {
    let status, name, title, meta, right, named = true, labels = [];
    if (e.kind === "agent") {
      const a = e.a, m = machineOf(a.address), who = ui.identity(a.address);
      status = e.st ?? a.status;
      // Identität wie überall: veröffentlichter Name, sonst das Programm-Kürzel
      // (`omp` klein und gedämpft). Der Programmname („Oh My Pi") ist keine Identität.
      name = who.name;
      named = who.named;
      title = cleanTitle(ui.plain(a.title));
      meta = `${m ? `${m} · ` : ""}${a.space_name} · Tab ${a.tab_name}`;
      right = div().flex_none().text_size(T_S).text_color(ui.statusColor(t, status)).child(`${ui.STATUS_WORD[status]}${e.since ? ` · ${ui.ageMs(e.since)}` : ""}`);
    } else if (e.kind === "orch") {
      status = "blocked"; name = "Orchestrator"; title = "fragt dich"; meta = "Rückfrage des Orchestrators";
      right = div().flex_none().text_size(T_S).text_color(t.blocked).child("wartet");
    } else if (e.kind === "pending") {
      status = "working"; name = null; title = e.p.title; meta = "beim Orchestrator · unterwegs, bis ein Ticket da ist";
      right = div().flex_none().text_size(T_S).text_color(t.working).child("unterwegs");
    } else if (e.kind === "question") {
      status = "blocked"; name = null; title = e.tk.title; labels = labelChips(t, e.tk);
      meta = `Ticket ${e.tk.id} · Frage von ${e.q.role}`;
      right = div().flex_none().text_size(T_S).text_color(t.blocked).child(ui.ageMs(tsMs(e.q.ts)) || "offen");
    } else {
      const tk = e.tk;
      status = "blocked"; name = null; title = tk.title; labels = labelChips(t, tk);
      meta = [tk.branch || tk.repo?.split("/").pop(), tk.machine].filter(Boolean).join(" · ");
      right = null;
    }
    const fullTitle = String(title ?? "");
    // Bei Abnahme-Zeilen steht die Metazeile (Branch/Rechner) in Zeile 1 rechts: die
    // Gate-Chips brauchen die ganze dritte Zeile, sonst schneidet der letzte Chip ab.
    const metaRight = e.kind === "ticket" && meta
      ? div().flex_none().max_w(110).truncate().text_size(T_S).text_color(t.muted).tooltip(meta).child(meta)
      : null;
    return v_flex().id(`ib-${e.key}`).flex_none().min_h(ui.H_ROW2).px(8).justify_center().gap(2).rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(e.group === "work", (el) => el.opacity(0.75))
      .on_click((ev, cx) => { if (ev.click_count === 2) this.activate(e); else { this.select(list, i, cx); this.handle.focus(); } })
      .child(h_flex().gap(ui.GAP_M).items_center().min_w(0)
        .child(ui.statusIcon(t, status))
        .child(this.avatar(t, e))
        .when(Boolean(name), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(named ? T_M : T_S)
          .text_color(named ? t.foreground : t.dim).when(on && named, (d) => d.font_semibold()).child(name)))
        .when(labels.length > 0, (el) => el.child(h_flex().flex_shrink_1().min_w(0).gap(2).items_center().overflow_hidden()
          .children(labels.map((l) => labelPill(t, l.text, l.color, { tip: l.tip, shrink: !l.fixed })))))
        .child(div().flex_1())
        .when(Boolean(right || metaRight), (el) => el.child(right ?? metaRight)))
      .when(Boolean(fullTitle), (el) => el.child(div().id(`ib-title-${e.key}`).w_full().pl(40).max_h(30).overflow_hidden()
        .text_size(T_M).line_height(1.2).text_color(name ? t.muted : t.foreground)
        .tooltip(fullTitle).child(clampTitle(fullTitle))))
      .child(h_flex().pl(40).min_w(0).gap(ui.GAP_S).items_center()
        .when(Boolean(meta) && e.kind !== "ticket", (el) => el.child(div().flex_shrink_1().min_w(44).max_w(120).truncate().text_size(T_S)
          .text_color(on ? t.foreground : t.muted).tooltip(meta).child(meta)))
        .child(div().flex_1())
        .when(e.kind === "ticket", (el) => el.child(h_flex().flex_none().gap(ui.GAP_XS).children(ui.gateChips(t, e.tk)))));
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
        focused: this.focus.has(`ib-reply-${e.kind}`),
        send: ui.sendButton(t, "ib-send", "mods/orchestra/icons/send.svg", "Senden (↵)", (cx) => this.send(cx)),
      }))
      .child(div().h(16).text_size(T_XS).text_color(sent ? (sent.ok === false ? t.blocked : sent.ok ? t.done : t.dim) : t.dim).truncate()
        .child(sent ? sent.text : e.kind === "question" ? "Der Kommentar geht in den Verlauf des Tickets."
          : e.kind === "orch" || e.st === "blocked" || e.a?.status === "blocked" ? "Die Antwort beantwortet die offene Frage." : " "));
  }

  detail(t, e) {
    if (!e) return v_flex().flex_1().child(ui.empty(t, "Wähle links einen Eintrag."));
    if (e.kind === "question") {
      const tk = e.tk;
      return v_flex().flex_1().min_w(0).min_h(0).gap(ui.GAP_L)
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(ui.statusIcon(t, "blocked"))
          .child(div().flex_1().min_w(0).truncate().text_size(T_L).font_semibold().text_color(t.foreground).child(tk.title)))
        .child(div().text_size(T_S).text_color(t.muted)
          .child(`Ticket ${tk.id} · Frage von ${e.q.role}${e.q.ts ? ` · ${e.q.ts}` : ""}`))
        .child(div().id("ib-question").flex_1().min_h(0).overflow_y_scrollbar().p(10).rounded(8).bg(t.background)
          .border_1().border_color(t.border).text_size(T_M).text_color(t.foreground).child(e.q.text))
        .child(this.replyField(t, e))
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(ui.button(t, "ib-ticket-open", "Ticket öffnen", () => this.check(tk),
            { kind: "primary", tip: "Review-Fenster mit Verlauf, Nachweisen und Antwortfeld (↵)" }))
          .child(div().text_size(T_XS).text_color(t.dim).child("Die Antwort landet als Kommentar im Ticket.")));
    }
    if (e.kind === "ticket") {
      const tk = e.tk, evidence = tk.evidence ?? [];
      return v_flex().flex_1().min_w(0).min_h(0).gap(ui.GAP_L)
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(ui.statusIcon(t, "blocked"))
          .child(div().flex_1().min_w(0).truncate().text_size(T_L).font_semibold().text_color(t.foreground).child(tk.title)))
        .child(h_flex().flex_wrap().gap(ui.GAP_S).items_center()
          .when(Boolean(tk.terminal), (el) => el.child(ui.identityChip(t, "ib-tk-who", tk.terminal)))
          // Nur das letzte Verzeichnis; der volle Pfad steht im Tooltip.
          .child(div().flex_none().max_w(180).truncate().text_size(T_S).text_color(t.dim)
            .tooltip(tk.repo || tk.branch || "")
            .child(tk.branch || (tk.repo ? baseName(tk.repo) : "")))
          .children(ui.gateChips(t, tk)))
        .child(v_flex().id("ib-summary").flex_1().min_h(0).overflow_y_scrollbar().gap(ui.GAP_S)
          .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Zusammenfassung"))
          .child(div().text_size(T_M).text_color(tk.summary ? t.foreground : t.dim).child(tk.summary || "Keine Zusammenfassung des Orchestrators."))
          .child(div().pt(ui.GAP_S).text_size(T_S).font_medium().text_color(t.muted).child("Nachweise"))
          .when(!evidence.length, (el) => el.child(div().text_size(T_S).text_color(t.muted).child("keine angegeben")))
          .children(evidence.map((p, i) => (tk.machine
            ? div().text_size(T_S).text_color(t.dim).child(`${p} (auf ${tk.machine})`)
            : ui.link(t, `ib-ev-${i}`, p, () => exec("open", [p]).catch(() => null), { tip: "Öffnen" })))))
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(ui.button(t, "ib-check", "Prüfen", () => this.check(tk), { kind: "primary", tip: "Review-Fenster: Zusammenfassung, Nachweise, Diff; dort Mergen, PR oder Abnehmen (↵)" }))
          .child(div().text_size(T_XS).text_color(t.dim).child("↵")));
    }
    if (e.kind === "pending") {
      return v_flex().flex_1().min_w(0).min_h(0).gap(ui.GAP_L)
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(svg("mods/orchestra/icon.svg").size(14).text_color(t.foreground))
          .child(div().flex_1().min_w(0).truncate().text_size(T_L).font_semibold().text_color(t.foreground).child(e.p.title)))
        .child(div().text_size(T_S).text_color(t.muted).child("Der Auftrag ist beim Orchestrator. Sobald er ein Ticket anlegt, erscheint es hier unter Abnahmen."))
        .child(h_flex().gap(ui.GAP_M).items_center()
          .child(ui.button(t, "ib-team", "Team-Panel öffnen", () => { this.close(); run("tabs-graph.panel-team"); }, { kind: "primary", tip: "Die Pipeline, in der das Ticket erscheint" })));
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
        .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.muted).child(`${a.space_name} / ${a.tab_name}`)))
      .child(this.screen(t, a.address))
      .child(this.replyField(t, e))
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(ui.button(t, "ib-go", "Zum Agent", () => this.activate(e), { kind: "primary", tip: "Zum Agent gehen (↵)" }))
        .when((e.st ?? a.status) === "done", (el) => el.child(ui.button(t, "ib-review", "Review", () => this.review(e), { tip: "Änderungen des Agents prüfen (v)" }))));
  }

  render(cx) {
    const t = theme();
    const list = this.entries();
    let i = list.findIndex((e) => e.key === this.key);
    if (i < 0 && list.length) { i = 0; this.key = list[0].key; if (list[0].address) this.load(list[0].address, cx, false); }
    const sel = i >= 0 ? list[i] : null;
    const { blocked, review, done, total } = inboxCount();
    const waits = blocked + review;
    const note = inboxNote(list);
    const questions = note.questions;
    const scope = ui.spaceChip(t);

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
    return v_flex().id("inbox").track_focus(this.handle).w_full().h(FILL).min_h(0).p(ui.GAP_XL).gap(ui.GAP_L).bg(t.popover).text_size(T_M)
      .on_key_down((ev, cx) => this.onKey(ev, cx, list, sel))
      .child(h_flex().h(28).flex_none().gap(ui.GAP_M).items_center()
        .child(div().flex_none().text_size(T_XL).font_semibold().text_color(t.foreground).child("Inbox"))
        .when(Boolean(scope), (el) => el.child(scope))
        .when(waits > 0, (el) => el.child(div().id("ib-waits").tooltip(`Diesem Workspace: ${waits} wartend · gesamt ${total.blocked + total.review}`)
          .child(ui.counterBadge(t, waits, t.blocked))))
        .when(!waits && done > 0, (el) => el.child(div().id("ib-done").tooltip(`Diesem Workspace: ${done} fertig · gesamt ${total.done}`)
          .child(ui.counterBadge(t, done, t.done))))
        .when(questions > 0, (el) => el.child(div().id("ib-verlauf-note").flex_none().text_size(T_XS).text_color(t.dim)
          .tooltip(note.text)
          .child(`+ ${questions} Verlauf`)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T_XS).text_color(t.muted).child("↑↓ wählen · ↵ öffnen · r antworten · v Review"))
        .child(div().id("ib-esc").flex_none().h(ui.H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(t.dim)
          .cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Schließen (Esc)").on_click(() => this.close()).child("Esc")))
      .child(list.length
        ? h_flex().flex_1().min_h(0).gap(ui.GAP_L).items_start()
          .child(col)
          .child(this.detail(t, sel).h_full())
        : ui.empty(t, "Nichts wartet auf dich. Rückfragen, Abnahmen und fertige Agents erscheinen hier.", { icon: "mods/inbox/icon.svg" }));
  }
}
