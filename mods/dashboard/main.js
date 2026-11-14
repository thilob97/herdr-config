// Start-Dashboard: the factory at a glance on one calm screen, without sidebar,
// tab bar or status bar. Four areas: "Wartet auf dich" (tickets in review, open
// ticket questions, questions from agents), "Team" (who works on what: identity,
// status, space/tab, ticket, duration, cost, teams as group rows) with "Letzte
// Aktivität" beside it, "Fabrik" (the pipeline, the oldest tickets in work and
// the cost card) and "Auftrag" (send to the orchestrator). Rows open their place;
// ↑↓ choose, ↵ opens, g w goes to the workspace, Esc clears the choice. Every
// number comes from the same sources Team, Inbox and the status bar read:
// shared("orchestra.tickets"), agents(), shared("orchestra.costs"),
// shared("orchestra.budget"), shared("orchestra.groups") and attention.since.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { agents, terminals, spaces, run, hc, exec, theme, shared, setShared, openOverlay, knownAgents, appHome, home } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M, T_L, T_XL, usd } from "./ui.js";

const ORCH = "orchestrator";
const MAXW = 1200;
const PAD = 16;
// What waits changes with the agents, not with every frame: five seconds is enough
// for the screen and keeps `hc read` off the terminals. Spec: no faster than 5 s.
const REFRESH = 5000;
const DOING_MAX = 5;
// Team rows keep these columns aligned; the two middle ones share what is left.
const COL_WHO = 132, COL_STATUS = 68, COL_TIME = 40, COL_COST = 46;
const SEND_ICON = "mods/orchestra/icons/send.svg";

// Same quoting as mods/orchestra/orchestrator.js, whose start this copies.
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const errorLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop().slice(0, 160);
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");
const rid = (s) => String(s).replace(/[^a-zA-Z0-9_.-]+/g, "-");
const pad2 = (n) => String(n).padStart(2, "0");
const WEEKDAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTH = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 60 ? "gerade" : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`;
}

// Ticket timestamps are "JJJJ-MM-TT HH:MM" (local), `updated` and each Verlauf line.
function at(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(ts ?? ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
}

const CHEVRON = "mods/workspace-chrome/chevron-right.svg";

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
    this.showDone = false;      // finished agents folded into one row at the team's end
    this.sending = false;
    this.starting = false;
    this.note = null;           // { ok: true|false|null, text }
    this.armed = null;          // "g" waits for "w"
    this.handle = cx.focus_handle();
    this.order = TextareaState.new({ rows: 3, placeholder: "Was soll das Team bauen?" });
    this.order.on("submit", (_e, cx) => this.send(cx)); // ⌘↵ (plain ↵ stays a newline)
    this.focus = ui.focusFields();
    this.focus.track(this.order, "dash-order");
    cx.timer.after(50, () => this.handle.focus());
    cx.timer.after(100, (cx) => { this.sync(cx); this.loadQuestions(cx); cx.notify(); });
    cx.timer.every(REFRESH, (cx) => { this.sync(cx); this.loadQuestions(cx); cx.notify(); });
    cx.timer.every(20000, (cx) => cx.notify()); // the clock
  }

  // ---------- data ----------

  orchestrator() { return terminals().find((x) => x.name === ORCH && x.state === "live") ?? null; }
  tickets() { return shared("orchestra.tickets") ?? []; }
  costs() { return shared("orchestra.costs") ?? {}; }
  teamBudget() { return { team: 20, ...(shared("orchestra.budget") ?? {}) }.team; }
  teams() { return shared("orchestra.groups") ?? []; }

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

  // Since when the agent is in this state: the status bar keeps it for every mod,
  // the local first sight fills the gap right after a start.
  attentionAt(a) {
    const st = this.statusOf(a);
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
    const blocked = new Set(this.waitsOnMe().filter((e) => e.kind === "agent").map((e) => e.address));
    for (const address of this.answers.keys()) if (!blocked.has(address)) this.answers.delete(address);
    for (const e of this.waitsOnMe()) {
      if (e.kind !== "agent" || this.answers.has(e.address)) continue;
      const input = InputState.new({ placeholder: `Antwort an ${ui.identity(e.address).name}…` });
      input.on("submit", (_ev, cx) => this.answer(e.address, cx));
      this.focus.track(input, `dash-answer-${rid(e.address)}`);
      this.answers.set(e.address, input);
    }
    cx.notify();
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

  header(t) {
    return h_flex().h(28).flex_none().gap(ui.GAP_M).items_center()
      .child(image("frame/welcome/herdr.png").size(20).rounded(4).flex_none())
      .child(div().flex_none().text_size(T_XL).font_semibold().text_color(t.foreground).child("Herdr"))
      .child(div().flex_1())
      .child(div().flex_none().text_size(T_XS).text_color(t.dim).child("⌘⇧0 Workspace"))
      .child(div().flex_none().text_size(T_S).text_color(t.muted).child(this.clockText()))
      .child(ui.button(t, "dash-workspace", "Workspace", () => this.workspace(false),
        { small: true, tip: "Zum Layout elric (Workspace, ⌘⇧0 oder g w)" }));
  }

  // A ticket ready to check: the author's identity, the title (two lines at most),
  // its gates, the age and "Prüfen".
  reviewRow(t, tk, primary, on) {
    const who = tk.terminal ?? (tk.by === ORCH ? this.orchestrator()?.address ?? null : null);
    const age = ago(at(tk.updated));
    return h_flex().id(`dash-review-${rid(tk.id)}`).min_h(ui.H_ROW2).flex_none().py(4).px(ui.INSET_CARD).gap(ui.GAP_M).items_center().rounded(6)
      .bg(on ? t.selected : t.surface).border_1().border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.key = `ticket:${tk.id}`; this.handle.focus(); this.openReview(tk); cx.stop_propagation(); })
      .when(Boolean(who), (el) => el.child(h_flex().flex_none().max_w(150).child(ui.identityChip(t, `dash-who-${rid(tk.id)}`, who))))
      .child(div().flex_1().min_w(0).max_h(30).overflow_hidden().text_size(T_S).text_color(t.foreground).child(tk.title))
      .children(ui.gateChips(t, tk))
      .when(Boolean(age), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.muted).child(age)))
      .child(ui.button(t, `dash-check-${rid(tk.id)}`, "Prüfen", () => this.openReview(tk),
        { kind: primary ? "primary" : "secondary", small: true, tip: "Review-Fenster: Zusammenfassung, Nachweise, Diff; dort Mergen, PR oder Abnehmen" }));
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
      .children(reviews.map((e, i) => this.reviewRow(t, e.tk, i === 0, this.key === e.key)))
      .children(asks.map((e) => this.questionCard(t, e)))
      .children(questions.map((e) => this.questionRow(t, e, this.key === e.key)));
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
    return h_flex().id(`dash-doing-${rid(tk.id)}`).h(40).flex_none().px(ui.INSET_CARD).gap(ui.GAP_M).items_center().rounded(6)
      .bg(on ? t.selected : t.surface).border_1().border_color(t.border)
      .when(Boolean(tk.terminal), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Klicken: zum Agent").on_click((_e, cx) => { cx.stop_propagation(); this.key = `doing:${tk.id}`; this.handle.focus(); this.openAgent(tk.terminal); }))
      .child(ui.statusIcon(t, st))
      .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(t.foreground).child(tk.title))
      .when(Boolean(tk.terminal), (el) => el.child(div().flex_none().max_w(150).child(ui.identityChip(t, `dash-doing-who-${rid(tk.id)}`, tk.terminal, { status: st }))))
      .child(div().w(64).flex_none().justify_end().text_size(T_XS).text_color(t.muted).child(dur || "—"))
      .child(div().w(56).flex_none().justify_end().text_size(T_XS).text_color(t.muted)
        .tooltip("Kosten dieses Tickets (nur omp meldet Kosten)").child(cost != null ? usd(cost) : "—"));
  }

  // ---------- team ----------

  // The row above the groups: what each column says, in T_XS like other meta.
  teamColumns(t) {
    return h_flex().h(16).flex_none().px(ui.GAP_S).gap(ui.GAP_S).items_center().text_size(T_XS).text_color(t.dim)
      .child(div().w(COL_WHO).flex_none().child("Agent"))
      .child(div().w(COL_STATUS).flex_none().child("Status"))
      .child(div().flex_1().min_w(0).child("Space / Tab"))
      .child(div().flex_1().min_w(0).child("Ticket"))
      .child(div().w(COL_TIME).flex_none().justify_end().child("Dauer"))
      .child(div().w(COL_COST).flex_none().justify_end().child("Kosten"));
  }

  // A group head like the Team panel's (name, count, the most urgent state); a
  // watched team first, the rest by space.
  teamGroupHead(t, g) {
    const rank = { blocked: 0, working: 1, idle: 2, done: 3 };
    const top = g.members.reduce((m, a) => { const st = this.statusOf(a); return (rank[st] ?? 9) < (rank[m] ?? 9) ? st : m; }, "idle");
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
    const tk = this.openTicket(a.address);
    const key = tk ? `${tk.id}|${a.address}` : "";
    const alone = tk ? this.tickets().filter((x) => x.id === tk.id && x.terminal).length <= 1 : false;
    const cost = tk ? this.costs().perTerminal?.[key] ?? (alone ? this.costs().tickets?.[tk.id] : null) : null;
    const since = this.attentionAt(a);
    const st = this.statusOf(a);
    const word = ui.STATUS_WORD[st] ?? st;
    const pic = who.avatar ? image(who.avatar).w(16).h(16).flex_none()
      : who.program?.icon ? (who.program.tint ? svg(who.program.icon).size(16).flex_none().text_color(t.muted)
        : image(who.program.icon).w(16).h(16).flex_none()) : null;
    const where = this.where(a);
    const tip = [who.name, word, where, tk ? `Ticket ${tk.id}: ${tk.title}` : null].filter(Boolean).join(" · ");
    return h_flex().id(`dash-team-${rid(a.address)}`).h(ui.H_ROW).flex_none().px(ui.GAP_S).gap(ui.GAP_S).items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(`${tip}\nKlicken: Workspace, Tab des Agents`)
      .on_click((_e, cx) => { cx.stop_propagation(); this.openAgent(a.address); })
      .child(div().w(COL_WHO).flex_none().min_w(0)
        .child(h_flex().h(22).max_w(COL_WHO).px(6).gap(ui.GAP_XS).items_center().rounded(6).bg(t.raised)
          .when(Boolean(pic), (el) => el.child(pic))
          .child(div().min_w(0).truncate().text_size(T_S).text_color(t.foreground).child(who.name))))
      .child(h_flex().w(COL_STATUS).flex_none().gap(ui.GAP_XS).items_center()
        .child(ui.statusIcon(t, st))
        .child(div().min_w(0).truncate().text_size(T_XS).text_color(t.muted).child(word)))
      .child(div().flex_1().min_w(0).truncate().text_size(T_XS).text_color(t.muted).child(where || "—"))
      .child(div().flex_1().min_w(0).truncate().text_size(T_XS).text_color(tk ? t.muted : t.dim)
        .when(Boolean(tk), (el) => el.tooltip(tk.title)).child(tk ? `${tk.id} · ${tk.title}` : "—"))
      .child(div().w(COL_TIME).flex_none().justify_end().text_size(T_XS).text_color(t.muted).child(since ? ago(since) : "—"))
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

  // The money as its own card right of the tickets in work: today, the team
  // budget and per ticket, the same numbers as the status bar and Team panel.
  // A click opens the Team panel in the Workspace.
  costsCard(t) {
    const c = this.costs();
    const today = c.teamCost ?? 0;
    const budget = this.teamBudget();
    const over = budget != null && today > budget;
    const pct = budget > 0 ? Math.min(100, Math.max(0, (today / budget) * 100)) : 0;
    const open = this.tickets().filter((tk) => tk.status !== "done")
      .map((tk) => ({ tk, n: c.tickets?.[tk.id] }))
      .sort((x, y) => (y.n ?? -1) - (x.n ?? -1));
    const booked = open.filter((r) => r.n != null).slice(0, 3);
    const shown = booked.length ? booked : open.slice(0, 3);
    const more = open.length - shown.length;
    return ui.card(t, "dash-costs").w(210).p(8).gap(3).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip("Team-Panel im Workspace öffnen")
      .on_click((_e, cx) => { cx.stop_propagation(); this.workspace(true, cx); })
      .child(h_flex().h(14).gap(ui.GAP_S).items_center()
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Kosten"))
        .child(div().flex_1())
        .child(svg(CHEVRON).size(12).flex_none().text_color(t.dim)))
      .child(h_flex().gap(ui.GAP_S).items_end()
        .child(div().text_size(T_L).font_semibold().text_color(over ? t.blocked : t.foreground).child(usd(today)))
        .child(div().text_size(T_XS).text_color(t.muted).child("heute")))
      .child(div().h(2).w_full().flex_none().rounded_full().bg(t.border)
        .child(div().h(2).rounded_full().w(`${pct}%`).bg(over ? t.blocked : t.done)))
      .child(h_flex().gap(ui.GAP_S).items_center().text_size(T_XS).text_color(t.muted)
        .child("Team-Budget")
        .child(div().flex_1())
        .child(div().text_color(over ? t.blocked : t.foreground).child(usd(budget))))
      .child(div().text_size(T_XS).text_color(t.dim).child("pro Ticket"))
      .when(!shown.length, (el) => el.child(div().text_size(T_XS).text_color(t.dim).child("Noch keine offenen Tickets.")))
      .children(shown.map(({ tk, n }) => h_flex().id(`dash-cost-${rid(tk.id)}`).h(15).flex_none().gap(ui.GAP_S).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T_XS).text_color(t.muted).tooltip(tk.title).child(tk.id))
        .child(div().flex_none().text_size(T_XS).text_color(n != null ? t.foreground : t.dim).child(n != null ? usd(n) : "—"))))
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
          .child(v_flex().id("dash-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(ui.GAP_L)
            .child(this.header(t))
            .child(this.waitingSection(t, waits))
            .child(h_flex().gap(ui.GAP_L).items_start()
              .child(this.teamSection(t))
              .child(this.activitySection(t)))
            .child(this.factorySection(t, counts, doing))
            .child(this.orderSection(t)))));
  }
}
