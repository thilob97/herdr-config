// Start-Dashboard: the factory at a glance on one calm screen, without sidebar,
// tab bar or status bar. Three areas: "Wartet auf dich" (tickets in review,
// questions from agents, an open-questions card), "Fabrik" (the pipeline, the
// oldest tickets in work with duration and cost, the money) and "Auftrag" (send
// to the orchestrator). Rows open their place; ↑↓ choose, ↵ opens, g w goes to
// the workspace, Esc clears the choice. Every number comes from the same sources
// Team, Inbox and the status bar read: shared("orchestra.tickets"), agents(),
// shared("orchestra.costs") and shared("orchestra.budget").

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { agents, terminals, run, hc, exec, theme, shared, setShared, openOverlay, knownAgents, appHome, home } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M, T_L, T_XL, usd } from "./ui.js";

const ORCH = "orchestrator";
const MAXW = 1200;
const PAD = 24;
const REFRESH = 3000;
const DOING_MAX = 5;
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

export default class Dashboard extends View {
  init(_props, cx) {
    this.key = null;            // the chosen row, kept across reorders
    this.questions = {};        // address → { at, text, error }
    this.reading = new Set();
    this.answers = new Map();   // address → InputState (a blocked agent's answer)
    this.answerNote = {};       // address → { ok: true|false|null, text }
    this.seen = new Map();      // "address:status" → when this screen first saw it
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

  // What waits for you, in the order the screen shows it: tickets ready to check
  // first, then the agents (and the orchestrator) with a question.
  waiting() {
    const out = this.tickets().filter((tk) => tk.status === "review")
      .map((tk) => ({ kind: "ticket", key: `ticket:${tk.id}`, tk }));
    const o = this.orchestrator();
    for (const a of agents().filter((x) => x.status === "blocked")) {
      if (out.some((e) => e.address === a.address)) continue;
      out.push({ kind: "agent", key: `agent:${a.address}`, address: a.address });
    }
    if (o?.status === "blocked" && !agents().some((a) => a.address === o.address)) {
      out.push({ kind: "agent", key: `agent:${o.address}`, address: o.address });
    }
    return out;
  }

  // The 3–5 rows that matter: a blocked agent first, then the longest in work.
  doing() {
    const all = agents();
    const st = (tk) => all.find((a) => a.address === tk.terminal)?.status ?? "idle";
    return this.tickets().filter((tk) => stageOf(tk) === "doing")
      .sort((x, y) => (STATUS_RANK[st(x)] ?? 9) - (STATUS_RANK[st(y)] ?? 9)
        || String(x.updated ?? "").localeCompare(String(y.updated ?? "")))
      .slice(0, DOING_MAX);
  }

  rows() {
    const out = this.waiting();
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
    for (const e of this.waiting()) {
      if (e.kind !== "agent" || this.answers.has(e.address)) continue;
      const input = InputState.new({ placeholder: `Antwort an ${ui.identity(e.address).name}…` });
      input.on("submit", (_ev, cx) => this.answer(e.address, cx));
      this.focus.track(input, `dash-answer-${rid(e.address)}`);
      this.answers.set(e.address, input);
    }
    cx.notify();
  }

  loadQuestions(cx) {
    for (const e of this.waiting()) {
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
          const last = [...lines].reverse().find((l) => l.includes("?")) ?? lines[lines.length - 1] ?? "";
          slot.text = last.slice(0, 240) || "Keine Frage auf dem Bildschirm.";
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
    if (e.kind === "ticket") return this.openReview(e.tk);
    if (e.kind === "doing") { if (e.tk.terminal) ui.focusAgent(e.tk.terminal); return; }
    ui.focusAgent(e.address); // an agent without a pane opens as a peek
  }

  openReview(tk) {
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
      props: { ticket: tk.id, terminal: tk.terminal || null, folder: tk.worktree || tk.repo, on: tk.machine || null } });
  }

  // The workspace is layout elric; the review stage also brings its Team panel.
  workspace(team) {
    run("layout.switch", { name: "elric" });
    if (team) { run("layout.select", { stack: "panel-body", child: "team" }); run("layout.show", { id: "panel" }); }
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
      .child(div().flex_none().text_size(T_S).text_color(t.muted).child(this.clockText()))
      .child(ui.button(t, "dash-workspace", "Workspace", () => this.workspace(false),
        { small: true, tip: "Zum Layout elric (Workspace, g w)" }));
  }

  // A ticket ready to check: title, the agent's identity, its gates, "Prüfen".
  reviewRow(t, tk, primary, on) {
    return h_flex().id(`dash-review-${rid(tk.id)}`).h(ui.H_ROW2).flex_none().px(ui.INSET_CARD).gap(ui.GAP_M).items_center().rounded(6)
      .bg(on ? t.selected : t.surface).border_1().border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.key = `ticket:${tk.id}`; this.handle.focus(); this.openReview(tk); cx.stop_propagation(); })
      .child(ui.statusIcon(t, "blocked"))
      .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(t.foreground).child(tk.title))
      .when(Boolean(tk.terminal), (el) => el.child(div().flex_none().max_w(150).child(ui.identityChip(t, `dash-who-${rid(tk.id)}`, tk.terminal))))
      .children(ui.gateChips(t, tk))
      .child(ui.button(t, `dash-check-${rid(tk.id)}`, "Prüfen", () => this.openReview(tk),
        { kind: primary ? "primary" : "secondary", small: true, tip: "Review-Fenster: Zusammenfassung, Nachweise, Diff; dort Mergen, PR oder Abnehmen" }));
  }

  // A blocked agent (or the orchestrator): who, the last question, an answer field.
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
        .child(ui.statusChip(t, "blocked"))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T_XS).text_color(t.muted).child(ago(this.since(e.address, "blocked")))))
      .child(div().max_h(36).overflow_hidden().text_size(T_S).text_color(slot?.error ? t.blocked : t.muted).child(text))
      .when(Boolean(input), (el) => el.child(ui.inputBox(t, `dash-answer-${rid(e.address)}`, Input.new(input), {
        focused: this.focus.has(`dash-answer-${rid(e.address)}`),
        send: ui.sendButton(t, `dash-answer-send-${rid(e.address)}`, SEND_ICON, "Antwort senden (↵)", (cx) => this.answer(e.address, cx)),
      })))
      .when(Boolean(note), (el) => el.child(div().text_size(T_XS).text_color(note.ok === false ? t.blocked : note.ok ? t.done : t.muted).child(note.text)));
  }

  // The orchestrator's addition: questions from ticket histories. The tickets
  // surface that publishes them is not merged yet, so the card says so quietly.
  openQuestions(t) {
    return ui.card(t, "dash-ticket-questions").gap(ui.GAP_XS)
      .child(h_flex().h(20).flex_none().gap(ui.GAP_S).items_center()
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Offene Fragen"))
        .child(div().flex_none().text_size(T_XS).text_color(t.muted).child("0")))
      .child(div().text_size(T_S).text_color(t.muted).child("Noch keine offenen Fragen in Tickets."));
  }

  waitingSection(t, reviews, waits) {
    const count = reviews.length + waits.filter((e) => e.kind === "agent").length;
    return v_flex().flex_none().gap(ui.GAP_S)
      .child(ui.sectionHeader(t, "Wartet auf dich", { count, color: count ? t.blocked : t.muted }))
      .when(!count, (el) => el.child(ui.empty(t, "Nichts wartet auf dich. Die Fabrik läuft ruhig.", { row: true })))
      .children(reviews.map((tk, i) => this.reviewRow(t, tk, i === 0, this.key === `ticket:${tk.id}`)))
      .children(waits.filter((e) => e.kind === "agent").map((e) => this.questionCard(t, e)))
      .child(this.openQuestions(t));
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
        .on_click((_e, cx) => { cx.stop_propagation(); this.workspace(s.key === "review"); })
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
    const dur = tk.terminal ? ago(this.since(tk.terminal, st)) : "";
    return h_flex().id(`dash-doing-${rid(tk.id)}`).h(40).flex_none().px(ui.INSET_CARD).gap(ui.GAP_M).items_center().rounded(6)
      .bg(on ? t.selected : t.surface).border_1().border_color(t.border)
      .when(Boolean(tk.terminal), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Klicken: zum Agent").on_click((_e, cx) => { cx.stop_propagation(); this.key = `doing:${tk.id}`; this.handle.focus(); ui.focusAgent(tk.terminal); }))
      .child(ui.statusIcon(t, st))
      .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(t.foreground).child(tk.title))
      .when(Boolean(tk.terminal), (el) => el.child(div().flex_none().max_w(150).child(ui.identityChip(t, `dash-doing-who-${rid(tk.id)}`, tk.terminal, { status: st }))))
      .child(div().w(64).flex_none().justify_end().text_size(T_XS).text_color(t.muted).child(dur || "—"))
      .child(div().w(56).flex_none().justify_end().text_size(T_XS).text_color(t.muted)
        .tooltip("Kosten dieses Tickets (nur omp meldet Kosten)").child(cost != null ? usd(cost) : "—"));
  }

  money(t) {
    const c = this.costs();
    const today = c.teamCost ?? (Number(c.orchestrator ?? 0) + Object.values(c.tickets ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0));
    const budget = this.teamBudget();
    const over = budget != null && today > budget;
    return v_flex().w(176).flex_none().gap(2).items_end()
      .child(div().text_size(T_XS).text_color(t.muted).child("Kosten heute"))
      .child(div().text_size(T_L).font_semibold().text_color(over ? t.blocked : t.foreground)
        .tooltip("Kosten der offenen Tickets und des Orchestrators (shared orchestra.costs)").child(usd(today)))
      .child(div().text_size(T_S).text_color(t.muted).child(`Team-Budget ${usd(budget)}`));
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
        .child(this.money(t)));
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
          { kind: o ? "primary" : "secondary", icon: SEND_ICON, enabled: Boolean(o) && !this.sending, tip: "Auftrag an den Orchestrator senden (⌘↵)" })))
      .child(div().text_size(T_XS).text_color(t.muted).child("↵ öffnen · ⌘⇧0 Dashboard · ⌘⇧N Auftrag"));
  }

  render(cx) {
    const t = theme();
    const list = this.rows();
    if (this.key && !list.some((e) => e.key === this.key)) this.key = null;
    const counts = { todo: 0, doing: 0, review: 0, done: 0 };
    for (const tk of this.tickets()) counts[stageOf(tk)]++;
    const reviews = this.tickets().filter((tk) => tk.status === "review");
    const waits = this.waiting();
    const doing = this.doing();
    return v_flex().id("dashboard").track_focus(this.handle).size_full().min_h(0).text_size(T_M).text_color(t.foreground)
      .on_key_down((ev, cx) => this.onKey(ev, cx))
      .child(h_flex().size_full().min_h(0).justify_center().items_start().p(PAD)
        .child(v_flex().id("dash-card").w_full().max_w(MAXW).h_full().min_h(0).rounded(10).overflow_hidden()
          .bg(t.background).border_1().border_color(t.border)
          .child(v_flex().id("dash-body").flex_1().min_h(0).overflow_y_scrollbar().p(20).gap(ui.GAP_L)
            .child(this.header(t))
            .child(this.waitingSection(t, reviews, waits))
            .child(this.factorySection(t, counts, doing))
            .child(this.orderSection(t)))));
  }
}
