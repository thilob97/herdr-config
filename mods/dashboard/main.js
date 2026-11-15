// Start-Dashboard: the factory at a glance on one calm screen, without sidebar,
// tab bar or status bar. Four areas: "Wartet auf dich" (tickets in review, open
// ticket questions, questions from agents), "Team" (who works on what: identity,
// status, space/tab, ticket, duration, cost, teams as group rows) with "Letzte
// Aktivität" beside it, "Fabrik" (the pipeline, the oldest tickets in work and
// the cost card) and "Auftrag" (send to the orchestrator). Rows open their place;
// ↑↓ choose, ↵ opens, g w goes to the workspace, Esc clears the choice. Every
// number comes from the same sources Team, Inbox and the status bar read: the
// ticket files (data/quests/tickets, re-read every 5 s), agents(),
// shared("orchestra.costs"), shared("orchestra.budget"), shared("orchestra.groups"),
// the status bar's omp helper for "Heute" and attention.since. A ticket owned by
// another orchestrator carries a small "von <owner>" chip in its row (tooltip
// "anderer Orchestrator"); the orchestrator's own tickets do not.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { agents, terminals, spaces, run, hc, exec, theme, shared, setShared, openOverlay, knownAgents, appHome, home, machines, readTextFile } from "herdr";
import * as ui from "./ui.js";
import * as tickets from "./tickets.js";
import { T_XS, T_S, T_M, T_L, T_XL, usd } from "./ui.js";

const ORCH = "orchestrator";
const MAXW = 1200;
const PAD = 16;
// What waits changes with the agents, not with every frame: five seconds is enough
// for the screen and keeps `hc read` off the terminals. Spec: no faster than 5 s.
const REFRESH = 5000;
// The status bar's omp usage helper is the one calculator for today's provider spend;
// reading the same helper keeps "$x heute" identical on both surfaces. It syncs omp's
// stats.db, so the dashboard asks no more often than the status bar (two minutes).
const SPEND_REFRESH = 120000;
const SPEND_HELPER = () => `${appHome()}/mods/status-bar/helpers/usage.py`;
const DOING_MAX = 5;
// Team rows keep these columns aligned; the two middle ones share what is left.
// Status is the state dot only (its word lives in the tooltip), so every value starts
// under the same head as its column.
const COL_WHO = 132, COL_STATUS = 16, COL_TIME = 64, COL_COST = 72;
const SEND_ICON = "mods/orchestra/icons/send.svg";
const HUB = () => `${appHome()}/mods/orchestra/bin/hub`;
// A stall is a ticket that sits too long in one station; `hub stalls` owns the
// thresholds (doing 45 min, review 2 h, todo 1 d), the dashboard only shows them.
const STALL_REFRESH = 10000;

// Same quoting as mods/orchestra/orchestrator.js, whose start this copies.
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const errorLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop().slice(0, 160);
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");
// Datenfrische: der Punkt im Kopf zeigt, wie alt die Zahlen sind. Kein eigener Timer:
// die bestehenden Leser (5/10/30 s) stempeln hier; grün < 10 s, gelb > 30 s, rot Fehler.
const FRESH_MS = 10000, STALE_MS = 30000;
const shortAge = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h`;
};

// Today (calendar day, local time) in dollars, summed over the machines the status bar
// reads: the same helper, the same DB, so both screens carry one number. Null when no
// machine answered — then the card says "—" instead of inventing a zero.
async function todayCost() {
  const path = SPEND_HELPER();
  const list = [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
  const got = await Promise.all(list.map(async (on) => {
    try {
      let argv = [path, "costs"];
      if (on) {
        const src = await readTextFile(path);
        if (src == null) return null;
        argv = ["-c", src, "costs"];
      }
      const r = await exec("python3", argv, { on, timeout: 150000 });
      return r.code === 0 ? Number(JSON.parse(r.stdout || "{}").today) : null;
    } catch { return null; }
  }));
  const values = got.filter((n) => Number.isFinite(n));
  return values.length ? values.reduce((sum, n) => sum + n, 0) : null;
}

const rid = (s) => String(s).replace(/[^a-zA-Z0-9_.-]+/g, "-");
const pad2 = (n) => String(n).padStart(2, "0");
const WEEKDAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTH = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
// Age in one language everywhere ("gerade", "42 min", "2 h", "> 1 Tag", "3 T") — the
// board's stage age (ui.dur) with days spelled out: a lone "d" reads as a unit nobody
// can size. A value over 24 h is a lower bound, so the first day says "> 1 Tag".
function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "gerade";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d < 2 ? "> 1 Tag" : `${d} T`;
}

// Ticket timestamps are "JJJJ-MM-TT HH:MM" (local), `updated` and each Verlauf line.
function at(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(ts ?? ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
}

// Ticket age from the board's fallback (status_at, then updated, then created), so a
// ticket without status_at still has an age instead of a dash.
const ticketAge = (tk) => {
  const ms = at(tk.status_at || tk.updated || tk.created);
  return ms ? ago(ms) : "";
};

const CHEVRON = "mods/workspace-chrome/chevron-right.svg";

// Duration as `hub stats` prints it ("42 min", "1 h 05", "—").
const span = (min) => {
  if (min == null) return "—";
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};

// The pipeline as the Team panel orders it (hubview.js STAGES, copied: a mod owns
// no module outside its folder).
const STAGES = [
  { key: "todo", label: "Geplant" },
  { key: "doing", label: "In Arbeit" },
  { key: "review", label: "Prüfung" },
  { key: "done", label: "Fertig" },
];
const stageOf = (tk) => (["todo", "review", "done"].includes(tk.status) ? tk.status : "doing");
const STATUS_RANK = { blocked: 0, working: 1, idle: 2, done: 3 };
// The sidebar's state rule, copied from inbox/main.js: a card's state is its own or the
// most urgent of its sub-agents (terminals it started and omp's task sub-agents), so
// the Team block says "arbeitet" when the sidebar and Inbox do (R3-11).
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const SUB_STATUS = { running: "working", pending: "idle", completed: "done", failed: "blocked", cancelled: "blocked", aborted: "blocked" };
const moreUrgent = (x, y) => ((RANK[y] ?? 0) > (RANK[x] ?? 0) ? y : x);
function effectiveStatus(a, terms, subs) {
  const kid = (t) => (t.status === "error" ? "blocked" : t.status === "done" ? "idle" : t.status ?? "idle");
  let st = a.status ?? "idle";
  const walk = (addr) => {
    for (const k of terms.filter((x) => x.parent === addr && x.state !== "finished")) { st = moreUrgent(st, kid(k)); walk(k.address); }
    for (const s of subs[addr] ?? []) st = moreUrgent(st, s.status === "completed" ? "idle" : SUB_STATUS[s.status] ?? "idle");
  };
  walk(a.address);
  return st;
}

// ---------- Wartet-Regel ----------
// A completion report is never a question, even when a "?" sits inside it: agents end
// with "Fertig …", "done", "Commit …, kein Push" or an exit line. These words are the
// ones such a report starts with; the report's headline is its first or last line, so a
// question that merely mentions a green check is not swallowed by it.
const COMPLETION_START = /^(fertig|erledigt|abgeschlossen|gemergt|done|finished|complete[d]?|commit(?:ted)?\b|exit\b)/i;
const COMPLETION_PHRASE = /\b(?:kein push|nicht gepusht|exit \d+)\b/i;
// A question opens with one of these words or ends with "?".
const QUESTION_START = /^(wer|was|wann|wo(?:hin|her|mit|für|rum|bei|ran)?|warum|wieso|weshalb|wie|welche[rsmn]?|kann(?:st)?|können|darf(?:st)?|soll(?:st)?|muss|müssen|ist|sind|hat|hast|haben|gibt|brauchst|brauchen|möchtest|willst|passt|einverstanden|ok(?:ay)?|stimmt)\b/i;

function isCompletionReport(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "", last = lines.at(-1) ?? "";
  return COMPLETION_START.test(first) || COMPLETION_START.test(last) || COMPLETION_PHRASE.test(first);
}

// The last line is what the agent asks; an entry that is a completion report is not a
// question, however many "?" its prose carries (ticket dashboard-4).
function isQuestionText(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  if (!last || isCompletionReport(text)) return false;
  return /[?]["'”’)\]]*$/.test(last) || QUESTION_START.test(last);
}

export default class Dashboard extends View {
  init(_props, cx) {
    this.key = null;            // the chosen row, kept across reorders
    this.questions = {};        // address → { at, text, error }
    this.reading = new Set();
    this.answers = new Map();   // address → InputState (a blocked agent's answer)
    this.answerNote = {};       // address → { ok: true|false|null, text }
    this.seen = new Map();      // "address:status" → when this screen first saw it
    this.tks = null;            // tickets read from disk; null until the first read
    this.tksJson = null;        // the last read, to notify only on change
    this.readingTks = false;
    this.liveSig = null;        // agents/costs signature of the last 5-s pass
    this.stalls = null;         // `hub stalls --json`; null until the first read
    this.stallsJson = null;
    this.readingStalls = false;
    this.stallNote = null;      // { ok, text } after a nudge
    this.today = null;          // today's omp spend, as the status bar shows it
    this.readingSpend = false;
    this.showDone = false;      // finished agents folded into one row at the team's end
    this.sending = false;
    this.starting = false;
    this.statsBusy = false;
    // at: letzter Erfolg (ms), err: erster Fehlertext seit diesem Erfolg.
    this.fresh = { tickets: { at: 0, err: null }, stalls: { at: 0, err: null }, stats: { at: 0, err: null } };
    this.note = null;           // { ok: true|false|null, text }
    this.armed = null;          // "g" waits for "w"
    this.handle = cx.focus_handle();
    this.order = TextareaState.new({ rows: 3, placeholder: "Was soll das Team bauen?" });
    this.order.on("submit", (_e, cx) => this.send(cx)); // ⌘↵ (plain ↵ stays a newline)
    this.focus = ui.focusFields();
    this.focus.track(this.order, "dash-order");
    cx.timer.after(50, () => this.handle.focus());
    cx.timer.after(100, (cx) => { this.refreshTickets(cx); this.sync(cx); this.loadQuestions(cx); this.readStalls(cx); });
    cx.timer.after(200, (cx) => this.fetchStats(cx));
    cx.timer.after(600, (cx) => this.fetchToday(cx));
    cx.timer.every(REFRESH, (cx) => { this.refreshTickets(cx); this.sync(cx); this.loadQuestions(cx); this.watchLive(cx); });
    cx.timer.every(STALL_REFRESH, (cx) => this.readStalls(cx));
    cx.timer.every(SPEND_REFRESH, (cx) => this.fetchToday(cx));
    cx.timer.every(30000, (cx) => this.fetchStats(cx));
    cx.timer.every(20000, (cx) => cx.notify()); // the clock
  }

  // ---------- data ----------

  orchestrator() { return terminals().find((x) => x.name === ORCH && x.state === "live") ?? null; }
  // A ticket belongs to another orchestrator when its `owner` names a different
  // terminal; hub writes this orchestrator's own terminal there, `hub status` hides
  // own and `mensch` the same way. Without a live orchestrator there is nothing to
  // compare against, so no chip (own tickets must never look foreign).
  foreignOwner(tk) {
    const owner = String(tk?.owner ?? "").trim();
    const me = this.orchestrator()?.address;
    return owner && me && owner !== me && owner !== "mensch" ? owner : null;
  }

  ownerChip(t, tk, id) {
    const owner = this.foreignOwner(tk);
    return owner ? ui.chip(t, `von ${owner}`, t.muted, { tip: "anderer Orchestrator", id }) : null;
  }
  // Fresh from disk (the dashboard layout runs no orchestra daemon); shared is only the
  // first paint before that read lands, so the screen is never empty for a moment.
  tickets() { return this.tks ?? shared("orchestra.tickets") ?? []; }
  costs() { return shared("orchestra.costs") ?? {}; }
  stats() { return shared("orchestra.stats") ?? null; }

  /** Ein Leseversuch ist durch: Erfolg stempelt den Zeitpunkt und löscht den Fehler;
   *  ein Fehlschlag merkt den ersten Fehlertext. true = der Punkt im Kopf ändert sich. */
  markFresh(key, err = null) {
    const f = this.fresh[key];
    const was = Boolean(f.err) || (f.at > 0 && Date.now() - f.at > STALE_MS);
    if (err == null) { f.at = Date.now(); f.err = null; }
    else if (!f.err) f.err = errorText(err).slice(0, 160);
    return was !== (Boolean(f.err) || (f.at > 0 && Date.now() - f.at > STALE_MS));
  }

  // Ticket files every five seconds; a changed snapshot is the only reason to redraw.
  refreshTickets(cx) {
    if (this.readingTks) return;
    this.readingTks = true;
    cx.spawn(async (cx) => {
      try {
        const list = await tickets.read();
        if (!list) { if (this.markFresh("tickets", "Ticket-Ordner nicht lesbar")) cx.notify(); return; }
        if (this.markFresh("tickets")) cx.notify();
        const json = JSON.stringify(list);
        if (json === this.tksJson) return;
        this.tksJson = json;
        this.tks = list;
        cx.notify();
      } catch (e) { if (this.markFresh("tickets", e)) cx.notify(); }
      finally { this.readingTks = false; }
    });
  }

  // Today's spend comes from omp's stats.db (the status bar's helper), not from the
  // team budget: that is a different number with a different meaning.
  fetchToday(cx) {
    if (this.readingSpend) return;
    this.readingSpend = true;
    cx.spawn(async (cx) => {
      const next = await todayCost().catch(() => null);
      this.readingSpend = false;
      if (next === this.today) return;
      this.today = next;
      cx.notify();
    });
  }

  // Agents and costs change without a ticket file changing; redraw them at the same
  // five-second pace, but only when their signature actually moved.
  watchLive(cx) {
    const o = this.orchestrator();
    const sig = JSON.stringify([agents().map((a) => [a.address, this.effective(a), a.tab ?? "", a.pane ?? ""]),
      o?.address ?? null, o?.status ?? null, this.costs().at ?? 0, this.waitsOnMe().length]);
    if (sig === this.liveSig) return;
    this.liveSig = sig;
    cx.notify();
  }

  // `hub stats` is the one calculator — the Team panel's head line runs the same command,
  // so both screens carry the same median, rework and cost.
  fetchStats(cx) {
    if (this.statsBusy) return;
    this.statsBusy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(`${appHome()}/mods/orchestra/bin/hub`, ["stats", "--json", "--days", "14"], { timeout: 20000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop());
        const next = JSON.parse(r.stdout || "{}");
        if (this.markFresh("stats")) cx.notify();
        if (JSON.stringify({ ...next, at: 0 }) !== JSON.stringify({ ...(this.stats() ?? {}), at: 0 })) {
          setShared("orchestra.stats", next);
          cx.notify();
        }
      } catch (e) { if (this.markFresh("stats", e)) cx.notify(); }
      finally { this.statsBusy = false; }
    });
  }
  teamBudget() { return { team: 20, ...(shared("orchestra.budget") ?? {}) }.team; }
  teams() { return shared("orchestra.groups") ?? []; }

  // `hub stalls --json` every 10 s. The row order (In Arbeit, Prüfung, Geplant) and
  // the thresholds are hub's; a failed read keeps the last rows instead of blanking.
  readStalls(cx) {
    if (this.readingStalls) return;
    this.readingStalls = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["stalls", "--json"], { timeout: 15000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop());
        const next = JSON.parse(r.stdout || "[]");
        if (this.markFresh("stalls")) cx.notify();
        const json = JSON.stringify(next);
        if (json === this.stallsJson) return;
        this.stallsJson = json;
        this.stalls = next;
        cx.notify();
      } catch (e) { if (this.markFresh("stalls", e)) cx.notify(); }
      finally { this.readingStalls = false; }
    });
  }

  // The latest ## Nachtschicht record across the tickets (`hub night` writes it after
  // a run); no record means the shift is off.
  nightRecord() {
    let best = null;
    for (const tk of this.tickets()) {
      const n = tk.night;
      if (n && (!best || n.end > best.end)) best = n;
    }
    return best;
  }

  // "läuft bis 06:00 · 3 gestartet" while the recorded window is still open, else the
  // last completed window, else "aus".
  nightText() {
    const n = this.nightRecord();
    if (!n) return { text: "Nachtschicht: aus", tip: "hub night startet die Warteschlange, wenn niemand da ist" };
    const now = new Date();
    const p = (x) => String(x).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
    const time = n.end.slice(11);
    const text = n.end > stamp
      ? `Nachtschicht: läuft bis ${time} · ${n.started} gestartet`
      : `Nachtschicht: zuletzt bis ${time} · ${n.started} gestartet`;
    return { text, tip: `Letzter Lauf ${n.begin} → ${n.end} · ${n.started} gestartet, ${n.skipped} übersprungen (Tickets, ## Nachtschicht)` };
  }

  // The ticket an agent is working on.
  openTicket(address) { return this.tickets().find((tk) => tk.terminal === address && tk.status !== "done") ?? null; }

  // The agent a Verlauf role names. `hub ticket comment --from` writes the name the
  // person knows: the identity name (`shared "agents.identity"`), the terminal title or
  // the address; older comments say only the program ("omp"). The ticket's own agent
  // wins when several match. No match = the agent is not provably still working, so
  // its message does not wait (rule 3).
  agentOfRole(role, tk) {
    const name = String(role ?? "").trim();
    if (!name || ["mensch", "hub", "orchestrator", "ci"].includes(name)) return null;
    const hits = agents().filter((a) => a.address === name || a.title === name
      || ui.identity(a.address).name === name || a.app === name || a.program?.key === name);
    return hits.find((a) => a.address === tk?.terminal) ?? (hits.length === 1 ? hits[0] : null);
  }

  // Rule 3: the ticket is not done, its last Verlauf entry comes from an agent that is
  // still working or blocked, nothing answered after it, and the entry is a real
  // question. A finished agent's report never waits, even with a "?" in the text.
  ticketQuestion(tk) {
    if (!tk || tk.status === "done" || tk.status === "review") return null;
    const last = (tk.verlauf ?? []).at(-1);
    if (!last) return null;
    const a = this.agentOfRole(last.role, tk);
    if (!a) return null;
    const st = this.statusOf(a);
    if (st !== "working" && st !== "blocked") return null;
    return isQuestionText(last.text) ? { ...last, address: a.address } : null;
  }

  // Space and tab as the Team panel names them; an automatic tab number says nothing.
  where(a) {
    const tab = spaces().flatMap((s) => s.tabs ?? []).find((x) => x.id === a.tab);
    const name = tab?.name && !/^\d+$/.test(tab.name) ? tab.name : a.title ?? "";
    return [a.space_name, name].filter(Boolean).join(" / ");
  }

  // What the terminal itself reported. `agents()` turns a finished `done` into `idle`
  // once a client looked; the team still needs to know it is finished (and folds it),
  // and the word "fertig" is what the person saw.
  statusOf(a) {
    const t = terminals().find((x) => x.address === a.address);
    return t?.status ?? a.status;
  }

  // The status the Team block shows: the agent's own, or a working/blocked child's.
  effective(a) { return effectiveStatus(a, terminals(), shared("omp.subagents") ?? {}); }

  // Since when the agent is in this state: the status bar keeps it for every mod,
  // the local first sight fills the gap right after a start.
  attentionAt(a) {
    const st = this.effective(a);
    const s = (shared("attention.since") ?? {})[a.address];
    if (s && (s.status === st || (st === "idle" && s.status === "done"))) return s.at;
    return this.since(a.address, st);
  }

  // Agents in their teams (shared "orchestra.groups", as the Team panel groups them),
  // the rest by space so no row floats without a group head.
  teamGroups(list = agents()) {
    const by = new Map(list.map((a) => [a.address, a]));
    const claimed = new Set();
    const groups = [];
    for (const g of this.teams()) {
      const members = (g.members ?? []).map((x) => by.get(x)).filter(Boolean);
      if (!members.length) continue;
      for (const a of members) claimed.add(a.address);
      groups.push({ id: `team-${g.id ?? g.name}`, label: g.name ?? "Team", team: true, members });
    }
    for (const a of list) {
      if (claimed.has(a.address)) continue;
      const id = `space-${a.space ?? a.space_name ?? ""}`;
      const last = groups.at(-1);
      if (last && !last.team && last.id === id) last.members.push(a);
      else groups.push({ id, label: a.space_name || "Ohne Space", team: false, members: [a] });
    }
    return groups;
  }

  // Wartet auf dich — the one rule (ticket dashboard-4). A row appears only when
  //  1. an agent is blocked (its question with an answer field), or
  //  2. a ticket is in review (title, gates, "Prüfen"), or
  //  3. a ticket is not done and its last Verlauf entry is an unanswered question from
  //     an agent that is still working or blocked.
  // Done agents and done tickets never wait; a completion report in the text ("Fertig",
  // "Commit …, kein Push") is not a question even when a "?" is inside it. Those reports
  // stay in "Letzte Aktivität" (the ticket's newest Verlauf line is an event there).
  // A ticket already covered by its review row or its blocked agent is not repeated.
  waitsOnMe() {
    const out = this.tickets().filter((tk) => tk.status === "review")
      .map((tk) => ({ kind: "ticket", key: `ticket:${tk.id}`, tk }));
    // 1. Blocked agents; the orchestrator too, as the Inbox counts it.
    const list = agents();
    const blocked = list.filter((x) => this.statusOf(x) === "blocked");
    const o = this.orchestrator();
    if (o?.status === "blocked" && !list.some((a) => a.address === o.address)) blocked.push(o);
    for (const a of blocked) {
      if (out.some((e) => e.address === a.address)) continue;
      out.push({ kind: "agent", key: `agent:${a.address}`, address: a.address, a });
    }
    // 3. An agent's open question in the ticket Verlauf (one row per matter).
    for (const tk of this.tickets()) {
      const v = this.ticketQuestion(tk);
      if (!v) continue;
      if (out.some((e) => e.tk?.id === tk.id || e.address === v.address)) continue;
      out.push({ kind: "ask", key: `ask:${tk.id}`, tk, v, address: v.address });
    }
    return out;
  }

  // The 3–5 rows that matter: a blocked agent first, then the longest in work.
  doing() {
    const all = agents();
    const st = (tk) => { const a = all.find((x) => x.address === tk.terminal); return a ? this.statusOf(a) : "idle"; };
    return this.tickets().filter((tk) => stageOf(tk) === "doing")
      .sort((x, y) => (STATUS_RANK[st(x)] ?? 9) - (STATUS_RANK[st(y)] ?? 9)
        || String(x.updated ?? "").localeCompare(String(y.updated ?? "")))
      .slice(0, DOING_MAX);
  }

  rows() {
    const out = this.waitsOnMe();
    for (const tk of this.doing()) out.push({ kind: "doing", key: `doing:${tk.id}`, tk });
    return out;
  }

  since(address, status) {
    const key = `${address}:${status}`;
    if (!this.seen.has(key)) this.seen.set(key, Date.now());
    return this.seen.get(key);
  }

  // One field per blocked agent, created here (never in render: InputState needs
  // a live host call). The question is the agent's last line with a "?".
  sync(cx) {
    let changed = false;
    const blocked = new Set(this.waitsOnMe().filter((e) => e.kind === "agent").map((e) => e.address));
    for (const address of this.answers.keys()) if (!blocked.has(address)) { this.answers.delete(address); changed = true; }
    for (const e of this.waitsOnMe()) {
      if (e.kind !== "agent" || this.answers.has(e.address)) continue;
      const input = InputState.new({ placeholder: `Antwort an ${ui.identity(e.address).name}…` });
      input.on("submit", (_ev, cx) => this.answer(e.address, cx));
      this.focus.track(input, `dash-answer-${rid(e.address)}`);
      this.answers.set(e.address, input);
      changed = true;
    }
    if (changed) cx.notify();
  }

  loadQuestions(cx) {
    for (const e of this.waitsOnMe()) {
      if (e.kind !== "agent") continue;
      const have = this.questions[e.address];
      if (this.reading.has(e.address) || (have && Date.now() - have.at < REFRESH)) continue;
      const address = e.address;
      this.reading.add(address);
      cx.spawn(async (cx) => {
        const slot = { at: Date.now(), text: "", error: null };
        try {
          const r = await hc(["read", address, "--lines", "40"]);
          if (r.code !== 0) throw new Error(errorLine(r));
          const lines = ui.plain(r.stdout).replace(/\s+$/, "").split("\n")
            .map((l) => l.replace(/\s+$/, "").trim())
            .filter((l) => l && !l.startsWith("[hc]"));
          // Only a line with a "?" is a question; anything else on a blocked screen
          // (a report, a menu) would read as raw output.
          const last = [...lines].reverse().find((l) => l.includes("?")) ?? "";
          slot.text = last.slice(0, 240) || "Wartet auf eine Antwort.";
        } catch (err) { slot.error = errorText(err).slice(0, 200); }
        this.reading.delete(address);
        this.questions[address] = slot;
        cx.notify();
      });
    }
  }

  // ---------- actions ----------

  open(e) {
    if (!e) return;
    if (e.kind === "ticket" || e.kind === "ask") return this.openReview(e.tk);
    if (e.kind === "doing") { if (e.tk.terminal) this.openAgent(e.tk.terminal); return; }
    ui.focusAgent(e.address); // an agent without a pane opens as a peek
  }

  openReview(tk) {
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
      props: { ticket: tk.id, terminal: tk.terminal || null, folder: tk.worktree || tk.repo, on: tk.machine || null } });
  }

  // The workspace is layout elric; the review stage also brings its Team panel.
  // The panel commands wait for the layout to load, or the switch discards them.
  workspace(team, cx) {
    run("layout.switch", { name: "elric" });
    if (!team) return;
    const open = () => {
      run("layout.select", { stack: "panel-body", child: "team" });
      run("layout.show", { id: "panel" });
    };
    if (cx?.timer) cx.timer.after(250, open);
    else open();
  }

  // To an agent: the Workspace layout, its tab and pane (the Team panel's click).
  openAgent(address) {
    run("layout.switch", { name: "elric" });
    const a = agents().find((x) => x.address === address);
    if (a?.tab) run("tab.select", { id: a.tab });
    if (a?.pane) run("pane.focus", { pane: a.pane });
    else run("terminal.peek", { terminal: address });
  }

  // The last events: one per ticket (its newest Verlauf line — a finished agent's
  // "Fertig …" report lands here instead of in "Wartet auf dich"), else its state,
  // blocked agents and budget stops, newest first.
  activity() {
    const out = [];
    const push = (time, text) => { if (time || text) out.push({ time, text }); };
    for (const tk of this.tickets()) {
      const last = (tk.verlauf ?? []).at(-1);
      if (last) push(at(last.ts), `Ticket ${tk.id} · ${last.role}: ${last.text}`);
      else {
        const time = at(tk.updated);
        const name = tk.terminal ? ui.identity(tk.terminal).name : "Orchestrator";
        const stage = stageOf(tk);
        push(time, stage === "review" ? `${name} hat Ticket ${tk.id} nach Prüfung geschoben`
          : stage === "doing" ? `${name} arbeitet an Ticket ${tk.id}`
            : stage === "done" ? `Ticket ${tk.id} ist fertig`
              : `Ticket ${tk.id} ist geplant`);
      }
    }
    const seen = shared("attention.since") ?? {};
    for (const a of agents()) {
      if (this.statusOf(a) === "blocked") push(seen[a.address]?.at, `${ui.identity(a.address).name} wartet auf dich`);
    }
    const c = this.costs();
    for (const [id, on] of Object.entries(c.stopped ?? {})) {
      if (on) push(c.at, id === "__team" ? "Team-Budget erreicht" : `Budget für Ticket ${id} erreicht`);
    }
    return out.sort((x, y) => y.time - x.time).slice(0, 5);
  }

  select(list, i, cx) {
    if (!list.length) return;
    this.key = list[(i + list.length) % list.length].key;
    cx.notify();
  }

  onKey(ev, cx) {
    const list = this.rows();
    const i = list.findIndex((e) => e.key === this.key);
    const k = ev.key;
    if (this.armed === "g") {
      this.armed = null;
      if (k === "w") { this.workspace(false); cx.stop_propagation(); return; }
    }
    if (ev.keystroke === "cmd-enter" || ev.keystroke === "ctrl-enter") this.send(cx);
    else if (k === "down" || k === "j") this.select(list, i + 1, cx);
    else if (k === "up" || k === "k") this.select(list, i - 1, cx);
    else if (k === "enter") { if (i >= 0) this.open(list[i]); }
    else if (k === "r") { const sel = i >= 0 ? list[i] : null; if (sel?.kind === "agent") this.answers.get(sel.address)?.focus(); }
    else if (k === "g") {
      this.armed = "g"; // g w: workspace
      cx.notify();
      cx.timer.after(1200, (cx) => { if (this.armed === "g") { this.armed = null; cx.notify(); } });
    } else if (k === "escape") { this.armed = null; this.key = null; this.handle.focus(); cx.notify(); }
    else return;
    cx.stop_propagation();
  }

  answer(address, cx) {
    const input = this.answers.get(address), text = input?.value().trim();
    if (!text) return;
    this.answerNote[address] = { ok: null, text: "sende …" };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["send", address, text, "--force"]); // it is blocked: the answer is the dialog
        if (r.code !== 0) throw new Error(errorLine(r));
        input.set_value("");
        this.answerNote[address] = { ok: true, text: "Antwort gesendet." };
        delete this.questions[address]; // read the next screen now
      } catch (err) { this.answerNote[address] = { ok: false, text: errorText(err) }; }
      this.handle.focus();
      cx.notify();
    });
  }

  // "Nachfragen" on a stall calls `hub nudge`: a message to the live agent plus a
  // Verlauf comment when it is gone. The row stays until the ticket moves.
  nudge(row, cx) {
    this.stallNote = { ok: null, text: `${row.id}: frage nach …` };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["nudge", row.id], { timeout: 30000 });
        if (r.code !== 0) throw new Error(errorLine(r));
        this.stallNote = { ok: true, text: `${row.id}: nachgefragt.` };
        this.readStalls(cx);
      } catch (err) { this.stallNote = { ok: false, text: errorText(err) }; }
      cx.notify();
    });
  }

  send(cx) {
    const text = this.order.value().trim();
    if (!text || this.sending) return;
    const o = this.orchestrator();
    if (!o) { this.note = { ok: false, text: "Kein Orchestrator läuft. Starte ihn, damit er Aufträge annimmt." }; cx.notify(); return; }
    this.sending = true;
    this.note = { ok: null, text: "sende …" };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["send", ORCH, text, ...(o.status === "blocked" ? ["--force"] : [])]);
        if (r.code !== 0) throw new Error(errorLine(r));
        this.order.set_value("");
        this.note = { ok: true, text: "Auftrag ist beim Orchestrator." };
        // As the Auftrag dialog does: until a ticket exists, the Inbox shows it is under way.
        const list = shared("quests.pending") ?? [];
        setShared("quests.pending", [...list.slice(-4),
          { key: `auftrag:${Date.now()}`, id: "", url: "", source: "text", title: text.split("\n")[0].slice(0, 80), at: Date.now() }]);
      } catch (err) { this.note = { ok: false, text: errorText(err) }; }
      this.sending = false;
      this.handle.focus();
      cx.notify();
    });
  }

  start(cx) {
    if (this.starting) return;
    this.starting = true;
    this.note = { ok: null, text: "starte …" };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.startOrchestrator();
        this.note = { ok: true, text: "Orchestrator läuft. Gib ihm einen Auftrag." };
      } catch (err) { this.note = { ok: false, text: errorText(err) }; }
      this.starting = false;
      cx.notify();
    });
  }

  // Copied from mods/orchestra/orchestrator.js: one hidden terminal named
  // "orchestrator", hub in front, its rules copied from the orchestra mod.
  async startOrchestrator() {
    const ws = `${home()}/.herdr/orchestrator`, mod = `${appHome()}/mods/orchestra`;
    const prep = await exec("sh", ["-c", `mkdir -p ${q(ws)} && cp ${q(`${mod}/orchestrator.md`)} ${q(`${ws}/AGENTS.md`)} && cp ${q(`${mod}/orchestrator.md`)} ${q(`${ws}/CLAUDE.md`)} && printf %s "\${SHELL:-/bin/sh}"`]);
    if (prep.code !== 0) throw new Error((prep.stderr || prep.stdout).trim() || "Arbeitsordner nicht anlegbar");
    const shell = prep.stdout.trim() || "/bin/sh";
    const known = await knownAgents().catch(() => []);
    const key = shared("orchestra.agent") ?? "omp";
    const program = known.find((a) => a.key === key && a.installed)?.run ?? [key];
    const argv = [shell, "-lic", `export PATH=${q(`${mod}/bin`)}:"$PATH"; "$@"; exec "$0" -li`, shell, ...program];
    const r = await hc(["run", "--bg", "--json", "--keep", "--no-parent", "--name", ORCH, "--cwd", ws,
      "--label", "hub.role=orchestrator", "--", ...argv]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
    setShared("orchestra.autostart", true);
  }

  // ---------- view ----------

  clockText() {
    const d = new Date();
    return `${WEEKDAY[d.getDay()]}, ${d.getDate()}. ${MONTH[d.getMonth()]} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /** Frische der Dashboard-Zahlen als Punkt: grün < 10 s (Tickets), gelb > 30 s, rot bei
   *  einem Lesefehler, sonst blass (noch kein Wert oder 10–30 s). Der Tooltip nennt
   *  jede Quelle mit Alter und dem ersten Fehlertext. */
  freshDot(t) {
    const now = Date.now();
    const srcs = [["Tickets", this.fresh.tickets], ["Stillstände", this.fresh.stalls], ["Messwerte", this.fresh.stats]];
    const anyErr = srcs.some(([, f]) => f.err);
    const age = (f) => (f.at ? now - f.at : null);
    const tk = this.fresh.tickets;
    // Themes without success/warning (the app's default) fall back instead of failing.
    const color = anyErr ? t.blocked
      : tk.at && age(tk) < FRESH_MS ? t.success ?? t.done
        : age(tk) == null ? t.dim
          : age(tk) > STALE_MS ? t.warning ?? t.unknown ?? t.muted : t.dim;
    const tip = srcs.map(([label, f]) =>
      `${label}: ${f.at ? `vor ${shortAge(age(f))}` : "noch kein Erfolg"}${f.err ? ` · ${f.err}` : ""}`).join("\n");
    return div().id("dash-fresh").size(7).flex_none().rounded_full().bg(color).tooltip(tip);
  }

  header(t) {
    return h_flex().h(28).flex_none().gap(ui.GAP_M).items_center()
      .child(image("frame/welcome/herdr.png").size(20).rounded(4).flex_none())
      .child(div().flex_none().text_size(T_XL).font_semibold().text_color(t.foreground).child("Herdr"))
      .child(div().flex_1())
      .child(this.freshDot(t))
      .child(div().flex_none().text_size(T_XS).text_color(t.dim).child("⌘⇧0 Workspace"))
      .child(div().flex_none().text_size(T_S).text_color(t.muted).child(this.clockText()))
      .child(ui.button(t, "dash-workspace", "Workspace", () => this.workspace(false),
        { small: true, tip: "Zum Layout elric (Workspace, ⌘⇧0 oder g w)" }));
  }

  // A ticket ready to check: the author's identity, the title (two lines at most),
  // its gates, the age and "Prüfen".
  reviewRow(t, tk, on) {
    const who = tk.terminal ?? null;
    const age = ticketAge(tk);
    const owner = this.ownerChip(t, tk, `dash-owner-review-${rid(tk.id)}`);
    return h_flex().id(`dash-review-${rid(tk.id)}`).min_h(ui.H_ROW2).flex_none().py(4).px(ui.INSET_CARD).gap(ui.GAP_M).items_center().rounded(6)
      .bg(on ? t.selected : t.surface).border_1().border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.key = `ticket:${tk.id}`; this.handle.focus(); this.openReview(tk); cx.stop_propagation(); })
      .when(Boolean(who), (el) => el.child(h_flex().flex_none().max_w(150).child(ui.identityChip(t, `dash-who-${rid(tk.id)}`, who))))
      .child(div().flex_1().min_w(0).max_h(30).overflow_hidden().text_size(T_S).text_color(t.foreground).child(tk.title))
      .when(Boolean(owner), (el) => el.child(owner))
      .children(ui.gateChips(t, tk))
      .when(Boolean(age), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.muted).child(age)))
      .child(ui.button(t, `dash-check-${rid(tk.id)}`, "Prüfen", () => this.openReview(tk),
        { kind: "secondary", small: true, tip: "Review-Fenster: Zusammenfassung, Nachweise, Diff; dort Mergen, PR oder Abnehmen" }));
  }

  // A blocked agent (or the orchestrator): who, the question (two lines at most), the
  // age and the answer field. No report is a question: without a "?" the screen says
  // only that the agent waits.
  questionCard(t, e) {
    const slot = this.questions[e.address];
    const input = this.answers.get(e.address);
    const note = this.answerNote[e.address];
    const on = this.key === e.key;
    const text = slot?.error ? slot.error : slot?.text ?? "lese Bildschirm …";
    return ui.card(t, `dash-question-${rid(e.address)}`)
      .when(on, (el) => el.bg(t.selected))
      .on_click((_ev, cx) => { this.key = e.key; this.handle.focus(); cx.notify(); })
      .child(h_flex().gap(ui.GAP_S).items_center()
        .child(ui.identityChip(t, `dash-q-who-${rid(e.address)}`, e.address))
        .child(div().flex_1().min_w(0).max_h(30).overflow_hidden().text_size(T_S)
          .text_color(slot?.error ? t.blocked : t.foreground).child(text))
        .child(div().flex_none().text_size(T_XS).text_color(t.muted).child(ago(this.attentionAt(e.a ?? { address: e.address, status: "blocked" })))))
      .when(Boolean(input), (el) => el.child(ui.inputBox(t, `dash-answer-${rid(e.address)}`, Input.new(input), {
        focused: this.focus.has(`dash-answer-${rid(e.address)}`),
        send: ui.sendButton(t, `dash-answer-send-${rid(e.address)}`, SEND_ICON, "Antwort senden (↵)", (cx) => this.answer(e.address, cx)),
      })))
      .when(Boolean(note), (el) => el.child(div().text_size(T_XS).text_color(note.ok === false ? t.blocked : note.ok ? t.done : t.muted).child(note.text)));
  }

  // An agent's question left in the ticket Verlauf and not answered, compact as the
  // other rows: identity chip · ticket id · question (two lines) · age. A link row to
  // the ticket (the answer is a comment there), not an answer field here.
  questionRow(t, e, on) {
    const { tk, v } = e;
    const age = ago(at(v.ts));
    return h_flex().id(`dash-ticket-question-${rid(tk.id)}`).min_h(ui.H_ROW).flex_none().py(4).px(ui.INSET_CARD).gap(ui.GAP_S).items_center().rounded(6)
      .bg(on ? t.selected : t.surface).border_1().border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(`${tk.title}\n${v.text}\nKlicken: Ticket öffnen`)
      .on_click((_e, cx) => { cx.stop_propagation(); this.key = `ask:${tk.id}`; this.handle.focus(); this.openReview(tk); })
      .child(ui.identityChip(t, `dash-ticket-q-who-${rid(tk.id)}`, e.address))
      .child(div().flex_none().text_size(T_XS).text_color(t.muted).child(tk.id))
      .child(div().flex_1().min_w(0).max_h(30).overflow_hidden().text_size(T_S).text_color(t.foreground).child(v.text))
      .when(Boolean(age), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.muted).child(age)));
  }

  // The header count is the number of rows. Review tickets and blocked agents are
  // exactly the Inbox count (Rückfragen + Abnahmen, spec 7.3); a question from the
  // Verlauf adds a row, and the header names that difference so the two numbers never
  // disagree silently.
  waitingSection(t, waits) {
    const reviews = waits.filter((e) => e.kind === "ticket");
    const asks = waits.filter((e) => e.kind === "agent");
    const questions = waits.filter((e) => e.kind === "ask");
    const count = waits.length;
    const inbox = reviews.length + asks.length;
    const diff = questions.length;
    const note = diff
      ? div().id("dash-waits-diff").flex_none().text_size(T_XS).text_color(t.dim)
        .tooltip(`Inbox ${inbox} (Rückfragen + Abnahmen) + ${diff} Frage${diff === 1 ? "" : "n"} aus dem Ticket-Verlauf = ${count} Zeilen`)
        .child(`Inbox ${inbox} + ${diff} Verlauf`)
      : null;
    return v_flex().flex_none().gap(ui.GAP_S)
      .child(ui.sectionHeader(t, "Wartet auf dich", { count, color: count ? t.blocked : t.muted, right: note }))
      .when(!count, (el) => el.child(ui.empty(t, "Nichts wartet auf dich, keine offenen Fragen.", { row: true })))
      .children(reviews.map((e) => this.reviewRow(t, e.tk, this.key === e.key)))
      .children(asks.map((e) => this.questionCard(t, e)))
      .children(questions.map((e) => this.questionRow(t, e, this.key === e.key)));
  }

  // Tickets that sit too long in one station: ticket · stage · age · agent, with
  // "Nachfragen" (`hub nudge`) and the way to the full Team panel. One quiet line when
  // nothing is stuck; no primary button here (the screen's primary is "Senden").
  stallsSection(t, waits = []) {
    const all = this.stalls ?? [];
    // Ein Ticket, das oben unter „Wartet auf dich" steht, erscheint hier nicht noch einmal.
    const waiting = new Set(waits.map((e) => e.tk?.id).filter(Boolean));
    const rows = all.filter((r) => !waiting.has(r.id));
    const stageColor = (key) => (key === "review" ? t.blocked : key === "doing" ? t.working : t.muted);
    const note = this.stallNote;
    return ui.card(t, "dash-stalls").gap(ui.GAP_XS)
      .child(h_flex().h(ui.H_SECTION).flex_none().gap(ui.GAP_S).items_center()
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Stockt"))
        .when(rows.length > 0, (el) => el.child(div().text_size(T_S).text_color(t.blocked).child(String(rows.length))))
        .child(div().flex_1())
        .child(ui.link(t, "dash-stalls-all", "Alle anzeigen", () => this.workspace(true),
          { tip: "Team-Panel im Workspace: alle hängenden Tickets" })))
      .when(!rows.length, (el) => el.child(ui.empty(t,
        all.length ? "Alles, was hängt, steht schon oben." : "Nichts hängt. Alle Stationen bewegen sich.", { row: true })))
      .children(rows.slice(0, 6).map((r) => h_flex().id(`dash-stall-${rid(r.id)}`).h(ui.H_ROW).flex_none().gap(ui.GAP_S).items_center()
        .child(div().w(170).flex_none().truncate().text_size(T_XS).text_color(t.muted).tooltip(r.title).child(r.id))
        .child(ui.chip(t, r.stage_label, stageColor(r.stage)))
        .child(div().w(78).flex_none().text_size(T_XS).text_color(t.muted).child(`seit ${r.age}`))
        .child(div().flex_1().min_w(0).truncate().text_size(T_XS).text_color(t.muted).child(r.agent || "—"))
        .child(ui.button(t, `dash-stall-nudge-${rid(r.id)}`, "Nachfragen", (cx) => this.nudge(r, cx),
          { small: true, tip: `${r.nudge}: den Agenten nach dem Stand fragen; ohne lebenden Agenten nur ein Kommentar` }))))
      .when(rows.length > 6, (el) => el.child(div().text_size(T_XS).text_color(t.dim).child(`+${rows.length - 6} weitere`)))
      .when(Boolean(note), (el) => el.child(div().text_size(T_XS)
        .text_color(note.ok === false ? t.blocked : note.ok ? t.done : t.muted).child(note.text)));
  }

  stages(t, counts) {
    const count = (n) => (n > 99 ? "99+" : String(n));
    const parts = [];
    STAGES.forEach((s, i) => {
      const n = counts[s.key] ?? 0;
      const waits = s.key === "review" && n > 0;
      if (i) parts.push(div().flex_none().px(2).text_size(T_S).text_color(t.muted).child("›"));
      parts.push(div().id(`dash-stage-${s.key}`).flex_none().h(22).px(6).gap(ui.GAP_XS).flex().items_center().rounded(6).text_size(T_S)
        .text_color(waits ? t.blocked : n ? t.foreground : t.muted)
        .cursor_pointer().hover((x) => x.bg(t.hover))
        .tooltip(waits ? `${s.label}: ${n} wartet auf dich`
          : `${s.label}: ${n}. Klicken: ${s.key === "review" ? "Team-Panel im Workspace" : "Workspace"}`)
        .on_click((_e, cx) => { cx.stop_propagation(); this.workspace(s.key === "review", cx); })
        .child(s.label)
        .child(div().font_semibold().text_color(waits ? t.blocked : n ? t.foreground : t.muted).child(count(n))));
    });
    return h_flex().id("dash-stages").flex_none().h(ui.H_BTN).p(2).items_center().rounded(8)
      .bg(t.background).border_1().border_color(t.border).children(parts);
  }

  doingRow(t, tk, on) {
    const live = tk.terminal ? agents().find((a) => a.address === tk.terminal) : null;
    const st = live?.status ?? "idle";
    const cost = this.costs().tickets?.[tk.id];
    const dur = live ? ago(this.attentionAt(live)) : "";
    const owner = this.ownerChip(t, tk, `dash-owner-doing-${rid(tk.id)}`);
    return h_flex().id(`dash-doing-${rid(tk.id)}`).h(ui.H_ROW2).flex_none().px(ui.INSET_CARD).gap(ui.GAP_M).items_center().rounded(6)
      .bg(on ? t.selected : t.surface).border_1().border_color(t.border)
      .when(Boolean(tk.terminal), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Klicken: zum Agent").on_click((_e, cx) => { cx.stop_propagation(); this.key = `doing:${tk.id}`; this.handle.focus(); this.openAgent(tk.terminal); }))
      .child(ui.statusIcon(t, st))
      .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(t.foreground).child(tk.title))
      .when(Boolean(owner), (el) => el.child(owner))
      .when(Boolean(tk.terminal), (el) => el.child(div().flex_none().max_w(150).child(ui.identityChip(t, `dash-doing-who-${rid(tk.id)}`, tk.terminal, { status: st }))))
      .child(div().w(64).flex_none().justify_end().text_size(T_XS).text_color(t.muted).child(dur || "—"))
      .child(div().w(56).flex_none().justify_end().text_size(T_XS).text_color(t.muted)
        .tooltip("Kosten dieses Tickets (nur omp meldet Kosten)").child(cost != null ? usd(cost) : "—"));
  }

  // ---------- team ----------

  // The row above the groups: what each column says, in T_XS like other meta.
  teamColumns(t) {
    return h_flex().h(ui.H_CHIP).flex_none().px(ui.GAP_S).gap(ui.GAP_S).items_center().text_size(T_XS).text_color(t.dim)
      .child(div().w(COL_WHO).flex_none().child("Agent"))
      .child(h_flex().w(COL_STATUS).flex_none().items_center().tooltip("Status").child(div().size(6).flex_none().rounded_full().bg(t.dim)))
      .child(div().flex_1().min_w(0).child("Space / Tab"))
      .child(div().flex_1().min_w(0).child("Ticket"))
      .child(div().w(COL_TIME).flex_none().pr(ui.GAP_S).justify_end().tooltip("Seit wann der Agent in diesem Zustand ist: Wechsel aus der Statusleiste, sonst erste Sicht des Dashboards").child("Seit"))
      .child(div().w(COL_COST).flex_none().justify_end().child("Kosten"));
  }

  // A group head like the Team panel's (name, count, the most urgent state); a
  // watched team first, the rest by space.
  teamGroupHead(t, g) {
    const rank = { blocked: 0, working: 1, idle: 2, done: 3 };
    const top = g.members.reduce((m, a) => { const st = this.effective(a); return (rank[st] ?? 9) < (rank[m] ?? 9) ? st : m; }, "idle");
    return h_flex().h(ui.H_SECTION).flex_none().px(ui.GAP_S).gap(ui.GAP_S).items_center().text_size(T_S).font_medium()
      .child(div().flex_none().max_w(320).truncate().text_color(g.team ? t.foreground : t.muted).child(g.label))
      .child(div().flex_none().text_color(t.dim).child(String(g.members.length)))
      .child(div().flex_1())
      .when(top !== "idle", (el) => el.child(ui.statusIcon(t, top)));
  }

  // One agent: identity, state, space/tab, ticket, how long, what it cost. The
  // chip is passive here; the whole row goes to the agent in the Workspace.
  teamRow(t, a) {
    const who = ui.identity(a.address);
    // Identität nur aus shared("agents.identity") (wie Team-Panel und Karten): ohne
    // veröffentlichten Namen steht das Programm-Kürzel klein und gedämpft (`omp`) —
    // ein Programm ist kein Agent.
    const named = (shared("agents.identity") ?? {})[a.address]?.name ?? null;
    const progKey = named ? null : String(a.program?.key ?? a.app ?? "").trim().toLowerCase() || null;
    const label = named ?? progKey ?? who.name;
    const tk = this.openTicket(a.address);
    const key = tk ? `${tk.id}|${a.address}` : "";
    const alone = tk ? this.tickets().filter((x) => x.id === tk.id && x.terminal).length <= 1 : false;
    const cost = tk ? this.costs().perTerminal?.[key] ?? (alone ? this.costs().tickets?.[tk.id] : null) : null;
    const since = this.attentionAt(a);
    const st = this.effective(a);
    const word = ui.STATUS_WORD[st] ?? st;
    const pic = named && who.avatar ? image(who.avatar).w(16).h(16).flex_none()
      : who.program?.icon ? (who.program.tint ? svg(who.program.icon).size(16).flex_none().text_color(t.muted)
        : image(who.program.icon).w(16).h(16).flex_none()) : null;
    const where = this.where(a);
    const tip = [label, named ? null : "Programm, keine veröffentlichte Identität", word, where,
      tk ? `Ticket ${tk.id}: ${tk.title}` : null].filter(Boolean).join(" · ");
    return h_flex().id(`dash-team-${rid(a.address)}`).h(ui.H_ROW).flex_none().px(ui.GAP_S).gap(ui.GAP_S).items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(`${tip}\nKlicken: Workspace, Tab des Agents`)
      .on_click((_e, cx) => { cx.stop_propagation(); this.openAgent(a.address); })
      .child(div().w(COL_WHO).flex_none().min_w(0)
        .child(h_flex().h(22).max_w(COL_WHO).px(6).gap(ui.GAP_XS).items_center().rounded(6).bg(t.raised)
          .when(Boolean(pic), (el) => el.child(pic))
          .child(div().min_w(0).truncate().text_size(T_S).text_color(named ? t.foreground : t.dim).child(label))))
      .child(h_flex().w(COL_STATUS).flex_none().items_center()
        .tooltip(`${word} · ${since ? ago(since) : "noch nicht beobachtet"}`)
        .child(div().size(7).flex_none().rounded_full().bg(ui.statusColor(t, st))))
      .child(div().flex_1().min_w(0).truncate().text_size(T_XS).text_color(t.muted).child(where || "—"))
      .child(div().flex_1().min_w(0).truncate().text_size(T_XS).text_color(tk ? t.muted : t.dim)
        .when(Boolean(tk), (el) => el.tooltip(tk.title)).child(tk ? `${tk.id} · ${tk.title}` : "—"))
      .child(div().w(COL_TIME).flex_none().pr(ui.GAP_S).justify_end().text_size(T_XS).text_color(t.muted)
        .tooltip(`Status seit ${word}: ${since ? ago(since) : "noch nicht beobachtet"} (Statusleiste; nach einem Neustart erste Sicht dieses Fensters)`)
        .child(since ? ago(since) : "—"))
      .child(div().w(COL_COST).flex_none().justify_end().text_size(T_XS).text_color(t.muted)
        .tooltip("Kosten dieses Agents an seinem Ticket (nur omp meldet Kosten)").child(cost != null ? usd(cost) : "—"));
  }

  // A done agent has finished its turn; whether its pane still shows the last screen
  // or the terminal is gone, it does not work anymore and does not belong between the
  // active rows.
  ended(a) { return this.statusOf(a) === "done"; }

  teamSection(t) {
    const all = agents();
    const list = all.filter((a) => !this.ended(a));
    const done = all.filter((a) => this.ended(a));
    return v_flex().flex_1().min_w(0).gap(ui.GAP_XS)
      .child(ui.sectionHeader(t, "Team", { count: all.length }))
      .when(!list.length, (el) => el.child(ui.empty(t, done.length
        ? "Keine Agents arbeiten gerade." : "Keine Agents laufen. Das Team erscheint, sobald einer meldet.", { row: true })))
      .when(Boolean(list.length), (el) => el.child(this.teamColumns(t))
        .children(this.teamGroups(list).flatMap((g) => [this.teamGroupHead(t, g), ...g.members.map((a) => this.teamRow(t, a))])))
      // Finished agents fold into one row at the end; groups only exist for working ones.
      .when(Boolean(done.length), (el) => el.child(ui.sectionHeader(t, `${done.length} beendet`, {
        id: "dash-done-head", open: this.showDone,
        onClick: (cx) => { this.showDone = !this.showDone; cx.notify(); },
      }).tooltip(this.showDone ? "Beendete Agents ausblenden" : "Beendete Agents zeigen"))
        .when(this.showDone, (r) => r.children(done.map((a) => this.teamRow(t, a)))));
  }

  // The last events from the ticket Verlauf, the agents and the budget, newest
  // first; at most five so the screen keeps its calm.
  activitySection(t) {
    const events = this.activity();
    return v_flex().w(250).flex_none().gap(ui.GAP_XS)
      .child(ui.sectionHeader(t, "Letzte Aktivität", {}))
      .when(!events.length, (el) => el.child(ui.empty(t, "Noch keine Ereignisse.", { row: true })))
      .children(events.map((e, i) => h_flex().id(`dash-activity-${i}`).h(22).flex_none().gap(ui.GAP_S).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.muted).tooltip(e.text).child(e.text))
        .when(Boolean(e.time), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.dim).child(ago(e.time))))));
  }

  // "Fabrik heute": the four numbers of the Team panel's head line and the last seven
  // days as text bars — no chart framework. A click opens the Team panel for the split.
  fabrikCard(t) {
    const s = this.stats(), d = s?.today;
    const night = this.nightText();
    const hist = (s?.history ?? []).slice(-7);
    const peak = Math.max(0, ...hist.map((h) => Number(h.done) || 0));
    // Echte Balken mit Höhe statt einer Zeile aus Schriftzeichen (die UI-Schrift kennt
    // die Block-Glyphen nicht und zeichnete nur Striche).
    const week = peak > 0
      ? h_flex().id("dash-week").h(28).flex_none().gap(2).items_end()
        .children(hist.map((h, i) => div().id(`dash-day-${i}`).w(14).flex_none()
          .h(Math.max(2, Math.round(((Number(h.done) || 0) / peak) * 26))).rounded(4)
          .bg(i === hist.length - 1 ? t.done : t.muted + "88")
          .tooltip(`${h.date}: ${h.done} erledigt · ${h.rework} Nacharbeit · Median ${span(h.median_min)}`)))
      : div().id("dash-week-empty").text_size(T_XS).text_color(t.dim).child("7 Tage · keine Daten");
    const metric = (label, value, color) => h_flex().flex_none().gap(3).items_end()
      .child(div().text_size(T_L).font_semibold().text_color(color ?? t.foreground).child(value))
      .child(div().text_size(T_XS).text_color(t.muted).child(label));
    return ui.card(t, "dash-fabrik").w(310).p(8).gap(3).cursor_pointer().hover((x) => x.bg(t.hover))
      .tooltip("Team-Panel im Workspace öffnen: Stationen und Repos aufschlüsseln")
      .on_click((_e, cx) => { cx.stop_propagation(); this.workspace(true, cx); })
      .child(h_flex().h(14).gap(ui.GAP_S).items_center()
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Fabrik heute"))
        .child(div().flex_1())
        .child(svg(CHEVRON).size(12).flex_none().text_color(t.dim)))
      .when(!d, (el) => el.child(div().text_size(T_XS).text_color(t.dim).child("Noch keine Messwerte.")))
      .when(Boolean(d), (el) => el
        .child(h_flex().gap(ui.GAP_M).items_end()
          .child(metric("erledigt", String(d.done)))
          .child(metric("Median", span(d.median_min))))
        .child(h_flex().gap(ui.GAP_M).items_end()
          .child(metric("Nacharbeit", String(d.rework), d.rework ? t.blocked : undefined))
          .child(metric("Ticket-Kosten", usd(d.cost))))
        .child(week)
        .when(peak > 0, (el) => el.child(div().text_size(T_XS).text_color(t.dim).child("7 Tage · erledigt")))
        .child(div().id("dash-night").w_full().truncate().text_size(T_XS).text_color(t.dim).tooltip(night.tip).child(night.text)));
  }

  // The money as its own card right of the tickets in work. Two named numbers, each
  // from the surface that owns it: "Heute" is the calendar day from omp's stats.db
  // (the status bar's "$x heute"), "Team offen" is the team budget's spend on open
  // tickets plus the orchestrator (the Team panel's head "Team $x / $y"). The card's
  // tooltip says both meanings at once. Per ticket below, as before. A click opens the
  // Team panel in the Workspace.
  costsCard(t) {
    const c = this.costs();
    const team = c.teamCost ?? 0;
    const budget = this.teamBudget();
    const over = budget != null && team > budget;
    const pct = budget > 0 ? Math.min(100, Math.max(0, (team / budget) * 100)) : 0;
    const open = this.tickets().filter((tk) => tk.status !== "done")
      .map((tk) => ({ tk, n: c.tickets?.[tk.id] }))
      .filter((r) => r.n != null)
      .sort((x, y) => y.n - x.n);
    // Nur Tickets mit gebuchten Kosten: keine Zeile „pro Ticket … —".
    const shown = open.slice(0, 3);
    const more = open.length - shown.length;
    return ui.card(t, "dash-costs").w(210).p(8).gap(3).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip("Heute: Kalendertag aller Sitzungen · Team offen: offene Tickets + Orchestrator / Budget")
      .on_click((_e, cx) => { cx.stop_propagation(); this.workspace(true, cx); })
      .child(h_flex().h(14).gap(ui.GAP_S).items_center()
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Kosten"))
        .child(div().flex_1())
        .child(svg(CHEVRON).size(12).flex_none().text_color(t.dim)))
      .child(h_flex().h(16).gap(ui.GAP_S).items_center()
        .child(div().flex_1().text_size(T_XS).text_color(t.muted).tooltip("Kalendertag, wie die Statusleiste: alle omp-Sitzungen").child("Heute"))
        .child(div().text_size(T_L).font_semibold().text_color(t.foreground).child(this.today == null ? "—" : usd(this.today))))
      .child(h_flex().h(16).gap(ui.GAP_S).items_center()
        .child(div().flex_1().text_size(T_XS).text_color(t.muted).tooltip("Kosten offener Tickets + Orchestrator / Team-Budget, wie der Team-Panel-Kopf").child("Team offen"))
        .child(div().text_size(T_XS).text_color(over ? t.blocked : t.foreground).child(`${usd(team)} / ${usd(budget)}`)))
      .child(div().h(2).w_full().flex_none().rounded_full().bg(t.border)
        .child(div().h(2).rounded_full().w(`${pct}%`).bg(over ? t.blocked : t.done)))
      .when(shown.length > 0, (el) => el
        .child(div().text_size(T_XS).text_color(t.dim).child("pro Ticket"))
        .children(shown.map(({ tk, n }) => h_flex().id(`dash-cost-${rid(tk.id)}`).h(ui.H_CHIP).flex_none().gap(ui.GAP_S).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(T_XS).text_color(t.muted).tooltip(tk.title).child(tk.id))
          .child(div().flex_none().text_size(T_XS).text_color(t.foreground).child(usd(n))))))
      .when(more > 0, (el) => el.child(div().text_size(T_XS).text_color(t.dim).child(`+${more} weitere`)));
  }

  factorySection(t, counts, doing) {
    return v_flex().flex_none().gap(ui.GAP_S)
      .child(ui.sectionHeader(t, "Fabrik", {}))
      .child(this.stages(t, counts))
      .child(h_flex().gap(ui.GAP_L).items_start()
        .child(v_flex().flex_1().min_w(0).gap(ui.GAP_S)
          .when(!doing.length, (el) => el.child(ui.empty(t,
            this.tickets().length ? "Nichts in Arbeit." : "Noch keine Tickets. Gib dem Team unten einen Auftrag.", { row: true })))
          .children(doing.map((tk) => this.doingRow(t, tk, this.key === `doing:${tk.id}`))))
        .child(this.fabrikCard(t))
        .child(this.costsCard(t)));
  }

  orderSection(t) {
    const o = this.orchestrator();
    const note = this.note;
    return v_flex().flex_none().gap(ui.GAP_S)
      .child(ui.sectionHeader(t, "Auftrag", {}))
      .child(Textarea.new(this.order).flex_none().h(66).w_full().px(10).py(6).rounded(6).border_1()
        .border_color(this.focus.has("dash-order") ? t.accent : t.input).bg(t.background).text_size(T_M).text_color(t.foreground))
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(note ? (note.ok === false ? t.blocked : note.ok ? t.done : t.muted) : t.muted)
          .tooltip(note?.text ?? "")
          .child(note?.text ?? (o ? "Der Orchestrator plant Tickets und verteilt sie ans Team." : "Kein Orchestrator läuft. Ohne ihn nimmt niemand Aufträge an.")))
        .when(!o, (el) => el.child(ui.button(t, "dash-start", this.starting ? "Startet …" : "Orchestrator starten", (cx) => this.start(cx),
          { kind: "primary", small: true, enabled: !this.starting, tip: "Startet den Orchestrator, nicht die Arbeit; die kommt über den Auftrag" })))
        .child(ui.button(t, "dash-send", "Senden", (cx) => this.send(cx),
          { kind: o ? "primary" : "secondary", icon: SEND_ICON, enabled: Boolean(o) && !this.sending, tip: "Auftrag an den Orchestrator senden (⌘↵)" })));
  }

  render(cx) {
    const t = theme();
    const list = this.rows();
    if (this.key && !list.some((e) => e.key === this.key)) this.key = null;
    const counts = { todo: 0, doing: 0, review: 0, done: 0 };
    for (const tk of this.tickets()) counts[stageOf(tk)]++;
    const waits = this.waitsOnMe();
    const doing = this.doing();
    return v_flex().id("dashboard").track_focus(this.handle).size_full().min_h(0).text_size(T_M).text_color(t.foreground)
      .on_key_down((ev, cx) => this.onKey(ev, cx))
      .child(h_flex().size_full().min_h(0).justify_center().items_start().p(PAD)
        .child(v_flex().id("dash-card").w_full().max_w(MAXW).h_full().min_h(0).rounded(10).overflow_hidden()
          .bg(t.background).border_1().border_color(t.border)
          .child(v_flex().id("dash-body").flex_1().min_h(0).overflow_y_scrollbar()
            // Above the toast surface: the toast sits 36 px off the window bottom and its
            // card is ~47 px tall, so the last row (Auftrag/Senden) keeps 80 px below it (R3-14).
            .px(16).pt(16).pb(80).gap(ui.GAP_L)
            .child(this.header(t))
            .child(this.waitingSection(t, waits))
            .child(this.stallsSection(t, waits))
            .child(h_flex().gap(ui.GAP_L).items_start()
              .child(this.teamSection(t))
              .child(this.activitySection(t)))
            .child(this.factorySection(t, counts, doing))
            .child(this.orderSection(t)))));
  }
}
