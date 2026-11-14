// Auftrag: the one way in for new work (tab bar "Auftrag", ⌘⇧N, Quests).
// props { mode?: "team" | "self", ticket? } (spec 7.4); without a mode it asks the
// team when an orchestrator runs, else starts by hand.
// - "Ans Team": a text to the orchestrator (hc send orchestrator; --force while it
//   waits on a question). It plans tickets, dispatches them and brings them back
//   checked, through the inbox.
// - "Selbst starten": one or more agents (fan out: one per picked agent) in a space,
//   as a new tab there or each in its own git worktree (own space, like the shipped
//   worktree mod), with a first message from a template in
//   mods/launcher/templates/*.md (frontmatter: name, tab). {folder}, {branch},
//   {branchnote} and {space} are filled in at start. Started agents can become a
//   watched team: shared "orchestra.groups", shown by the Team panel and watched by
//   the status bar (it says when the whole team is finished).
// props.ticket { id, title, url, source, body, repo } fills both modes in. From Quests
// it also carries `quest` (the full Quests ticket) and Quests' own texts (team,
// message, tab, branch, space, writeback); what was started then goes back to Quests
// through shared "quests.handover" (see HANDOVER), which records it, makes a local
// ticket the orchestrator's and writes back to the source.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { spaces, focused, exec, hc, knownAgents, notify, props, closeOverlay, theme, shared, setShared, home, appHome, readTextFile, terminals, run } from "herdr";
import * as fs from "fs/promises";
import { place, git, repoOf, homeOn, slug } from "./git.js";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M } from "./ui.js";

const WC = "mods/workspace-chrome";
const TEMPLATES = () => `${appHome()}/mods/launcher/templates`;
const ORCH = "orchestrator";
// Results for Quests: [{ at, mode: "team" | "self", quest, writeback, terminal?, starts?: [{ branch,
// worktree, folder, machine, space, tab, terminal, agent }] }]. Quests takes entries out and handles them.
const HANDOVER = "quests.handover";

function parseTemplate(file, text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { id: file, name: meta.name || file.replace(/\.md$/, ""), tab: meta.tab || "", body: (m ? text.slice(m[0].length) : text).trim() };
}

const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const fill = (text, vars) => text.replace(/\{(folder|branch|branchnote|space)\}/g, (_m, k) => vars[k] ?? "");
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");
const orchestrator = () => terminals().find((x) => x.name === ORCH && x.state === "live") ?? null;

// What the team gets for a ticket when the caller brought no text of its own.
const teamText = (tk) => `${[`Neuer Auftrag: „${tk.title}“`, tk.url && `Quelle: ${tk.url}`, tk.repo && `Checkout: ${tk.repo}`].filter(Boolean).join("\n")}\n\n${
  (tk.body ?? "").trim() || "(keine Beschreibung)"}`;

export default class Launcher extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.ticket = p.ticket ?? null;
    this.mode = p.mode === "team" || p.mode === "self" ? p.mode : orchestrator() ? "team" : "self";
    this.templates = [];
    this.template = null;
    this.agents = null;     // installed agents on the space's machine
    this.picked = new Set(["omp"]);
    this.where = "tab";     // "tab" | "worktree"
    this.repo = undefined;  // undefined: reading, null: no git
    this.team = !this.ticket;
    this.writeback = Boolean(this.ticket?.writeback);
    this.busy = false;
    this.error = "";
    this.token = 0;
    this.ask = TextareaState.new({ rows: 14, placeholder: "Was soll das Team bauen? Ziel, Kontext und woran du erkennst, dass es fertig ist …" });
    this.branch = InputState.new({ placeholder: "Branch, z. B. feat/login-fix" });
    this.folder = InputState.new({ placeholder: "Ordner" });
    this.name = InputState.new({ placeholder: "Tab-Name" });
    this.custom = InputState.new({ placeholder: "Kommando, z. B. claude --model opus" });
    this.task = TextareaState.new({ rows: 12, placeholder: "Erste Nachricht an den Agent …" });
    this.focus = ui.focusFields();
    for (const [id, state] of [["ln-ask", this.ask], ["ln-task", this.task], ["ln-branch", this.branch], ["ln-folder", this.folder],
      ["ln-name", this.name], ["ln-custom", this.custom]]) this.focus.track(state, id);
    if (this.ticket) {
      this.ask.set_value(this.ticket.team ?? teamText(this.ticket));
      this.fromTicket();
    }
    this.pick(cx, this.ticketSpace() ?? spaces().find((s) => s.id === focused()?.space)?.id ?? spaces()[0]?.id);
    cx.spawn(async (cx) => {
      try {
        const files = (await fs.readdir(TEMPLATES())).filter((f) => f.endsWith(".md")).sort();
        this.templates = await Promise.all(files.map(async (f) => parseTemplate(f, await readTextFile(`${TEMPLATES()}/${f}`))));
      } catch (e) { this.error = `Vorlagen nicht lesbar: ${errorText(e)}`; }
      cx.notify();
    });
    cx.timer.after(300, () => (this.mode === "team" ? this.ask : this.task).focus());
  }

  // The space a ticket belongs to: the caller's pick, else the one whose checkout is its repo.
  ticketSpace() {
    const tk = this.ticket;
    if (!tk) return null;
    if (tk.space && spaces().some((s) => s.id === tk.space)) return tk.space;
    const hint = String(tk.repo ?? "").trim().toLowerCase().replace(/\/+$/, "");
    if (!hint) return null;
    return spaces().find((s) => {
      const at = String(place(s) ?? "").toLowerCase().replace(/\/+$/, "");
      return at === hint || s.name.toLowerCase() === hint || at.endsWith(`/${hint}`);
    })?.id ?? null;
  }

  space() { return spaces().find((s) => s.id === this.spaceId) ?? null; }

  pick(cx, id) {
    const s = spaces().find((x) => x.id === id);
    const token = ++this.token;
    this.spaceId = s?.id ?? null;
    this.repo = s ? undefined : null;
    this.agents = null;
    if (!s) return;
    const on = s.machine ?? null;
    const folder = place(s) ?? "";
    this.folder.set_value(folder);
    cx.spawn(async (cx) => {
      const [repo, list] = await Promise.all([folder ? repoOf(folder, on).catch(() => null) : null, knownAgents({ on }).catch(() => [])]);
      if (token !== this.token) return;
      this.repo = repo;
      this.agents = list.filter((a) => a.installed);
      for (const k of [...this.picked]) if (k !== "custom" && !this.agents.some((a) => a.key === k)) this.picked.delete(k);
      if (!this.picked.size) this.picked.add(this.agents.find((a) => a.key === "omp")?.key ?? this.agents[0]?.key ?? "custom");
      // A ticket gets its own branch by default, as Quests always did.
      if (repo && this.ticket) this.where = "worktree";
      if (!repo && this.where === "worktree") this.where = "tab";
      cx.notify();
    });
    cx.notify();
  }

  // A ticket's own first message, tab name and branch (the "Ticket" entry in place of "Leer").
  fromTicket() {
    const tk = this.ticket;
    this.task.set_value(tk.message ?? [tk.title, (tk.body ?? "").trim(), tk.url].filter(Boolean).join("\n\n"));
    this.name.set_value((tk.tab ?? tk.title ?? "").slice(0, 40));
    this.branch.set_value(tk.branch ?? `feat/${slug(tk.title) || "auftrag"}`);
  }

  useTemplate(tp, cx) {
    this.template = tp?.id ?? null;
    if (!tp && this.ticket) { this.fromTicket(); cx.notify(); return; }
    this.task.set_value(tp?.body ?? "");
    this.name.set_value(tp?.tab ?? "");
    this.branch.set_value(tp ? `agent/${slug(tp.tab || tp.name)}-${stamp()}` : "");
    cx.notify();
  }

  toggleAgent(key, cx) {
    if (this.picked.has(key)) { if (this.picked.size > 1) this.picked.delete(key); }
    else this.picked.add(key);
    cx.notify();
  }

  // [{ key, name, argv }] for every picked agent.
  launches() {
    return [...this.picked].map((key) => {
      if (key === "custom") {
        const argv = this.custom.value().trim().split(/\s+/).filter(Boolean);
        return { key: slug(argv[0] ?? "cmd"), name: argv[0] ?? "Kommando", argv };
      }
      const a = this.agents?.find((x) => x.key === key);
      return { key, name: a?.name ?? key, argv: a?.run ?? [] };
    });
  }

  handOver(entry) {
    if (!this.ticket?.quest) return;
    setShared(HANDOVER, [...(shared(HANDOVER) ?? []), { at: Date.now(), quest: this.ticket.quest, writeback: this.writeback, ...entry }]);
  }

  go(cx, fn) {
    if (this.busy) return;
    this.busy = true; this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try { await fn(); closeOverlay(props().overlay); }
      catch (e) { this.error = errorText(e); }
      this.busy = false;
      cx.notify();
    });
  }

  sendTeam(cx) {
    const text = this.ask.value().trim();
    if (!text) return;
    this.go(cx, async () => {
      const o = orchestrator();
      if (!o) throw new Error("Der Orchestrator läuft nicht. Starte ihn im Team-Panel.");
      const r = await hc(["send", ORCH, text, ...(o.status === "blocked" ? ["--force"] : [])]);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || "Senden fehlgeschlagen");
      if (this.ticket?.quest) this.handOver({ mode: "team", terminal: o.address });
      else {
        // Until a ticket exists, the Inbox says the order is with the orchestrator (B, optional gap).
        const list = shared("quests.pending") ?? [];
        setShared("quests.pending", [...list.slice(-4),
          { key: `auftrag:${Date.now()}`, id: "", url: "", source: "text", title: text.split("\n")[0].slice(0, 80), at: Date.now() }]);
        notify({ title: "Auftrag an das Team", body: text.split("\n")[0].slice(0, 200), level: "success", timeout: 6000, action: { name: "tabs-graph.panel-team" } });
      }
    });
  }

  async start() {
    const s = this.space();
    if (!s) throw new Error("Wähle einen Space.");
    if (this.repo === undefined) throw new Error("Lese noch das Repository des Space …");
    const list = this.launches();
    if (list.some((l) => !l.argv.length)) throw new Error("Wähle einen Agent oder gib ein Kommando ein.");
    const on = s.machine ?? null;
    const worktree = this.where === "worktree" && Boolean(this.repo);
    const base = this.branch.value().trim();
    if (worktree && !base) throw new Error("Gib einen Branch-Namen ein.");
    const tabBase = this.name.value().trim() || this.templates.find((t) => t.id === this.template)?.tab || "agent";
    const text = this.task.value();
    const made = [];
    for (const l of list) {
      let folder = this.folder.value().trim() || place(s) || "";
      let branch = null;
      if (worktree) {
        branch = list.length > 1 ? `${base}-${l.key}` : base;
        if (!(await git(this.repo.top, ["check-ref-format", "--branch", branch], on)).ok) throw new Error(`„${branch}“ ist kein gültiger Branch-Name.`);
        folder = `${await homeOn(on, home())}/.herdr/worktrees/${this.repo.name}/${slug(branch.replace(/\//g, "-"))}`;
        const exists = (await git(this.repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], on)).ok;
        const r = await git(this.repo.top, exists ? ["worktree", "add", folder, branch] : ["worktree", "add", "-b", branch, folder, "HEAD"], on, 600000);
        if (!r.ok) throw new Error(r.err || "git worktree add fehlgeschlagen.");
      }
      const task = fill(text, { folder, branch: branch ?? "", branchnote: branch ? ` auf Branch ${branch}` : "", space: s.name }).trim();
      const name = (list.length > 1 ? `${tabBase} · ${l.name}` : tabBase).slice(0, 40);
      // herdr-app do prints the ids it made; a worktree gets its own space, unnamed so it follows the checkout.
      const [cmd, args] = worktree
        ? ["space.new", { folder, machine: on ?? "", tab: name, argv: l.argv, ...(task ? { task } : {}) }]
        : ["tab.new", { space: s.id, name, argv: l.argv, ...(task ? { task } : {}), ...(folder ? { folder } : {}) }];
      const r = await exec("herdr-app", ["do", cmd, JSON.stringify(args)], { timeout: 60000 });
      let out = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || !out?.terminal) throw new Error(`${l.name}: ${out?.error ?? ((r.stderr || r.stdout).trim() || `${cmd} fehlgeschlagen`)}`);
      const address = on && !out.terminal.includes("/") ? `${on}/${out.terminal}` : out.terminal;
      made.push({ address, name: l.name, branch, folder, space: out.space ?? s.id, tab: out.tab ?? null });
    }
    if (this.team && made.length) {
      const groups = shared("orchestra.groups") ?? [];
      const id = `g${Date.now().toString(36)}`;
      setShared("orchestra.groups", [...groups, { id, name: tabBase, members: made.map((m) => m.address), at: Date.now(), watch: true, notified: false }]);
    }
    if (this.ticket?.quest) {
      this.handOver({ mode: "self", starts: made.map((m) => ({ branch: m.branch ?? base, worktree: Boolean(m.branch), folder: m.folder, machine: on,
        space: m.space, tab: m.tab, terminal: m.address, agent: m.name })) });
      return;
    }
    notify({
      title: made.length > 1 ? `${made.length} Agents gestartet: ${tabBase}` : `${made[0].name} gestartet: ${tabBase}`,
      body: made.map((m) => `${m.name}${m.branch ? ` · ${m.branch}` : ""}`).join("\n"),
      level: "success", timeout: 8000, action: { name: "space.select", args: { id: made[0].space } },
    });
  }

  // ---------- view ----------

  label(t, text) {
    return div().h(20).flex_none().flex().items_center().text_size(T_S).font_medium().text_color(t.muted).child(text);
  }

  // A pick among several (agents): selected like a list row, otherwise a secondary chip.
  chip(t, id, text, on, action) {
    return div().id(id).flex_none().px(8).h(ui.H_BTN_S).flex().items_center().rounded(6).text_size(T_M)
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted)
      .cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => action(cx))
      .when(on, (el) => el.child(svg(`${WC}/check.svg`).size(12).mr(ui.GAP_XS).text_color(t.foreground)))
      .child(text);
  }

  check(t, id, on, text, action) {
    return h_flex().id(id).flex_none().gap(ui.GAP_M).items_center().cursor_pointer().on_click((_e, cx) => action(cx))
      .child(div().size(14).flex_none().rounded(4).border_1().border_color(on ? t.solid : t.input).bg(on ? t.solid : t.background)
        .flex().items_center().justify_center().when(on, (el) => el.child(svg(`${WC}/check.svg`).size(10).text_color(t.solid_foreground))))
      .child(div().text_size(T_M).text_color(t.muted).child(text));
  }

  listRow(t, id, on, title, sub, action) {
    return v_flex().id(id).h(ui.H_ROW2).flex_none().px(8).justify_center().rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => action(cx))
      .child(div().truncate().text_size(T_M).text_color(on ? t.foreground : t.muted).child(title))
      .when(Boolean(sub), (el) => el.child(div().truncate().text_size(T_S).text_color(t.dim).child(sub)));
  }

  area(t, state, focused = false) {
    return Textarea.new(state).flex_1().min_h(120).w_full().px(10).py(6).rounded(6).border_1().border_color(focused ? t.accent : t.input).bg(t.background).text_size(T_M).text_color(t.foreground);
  }

  footer(t, left, button) {
    return h_flex().h(ui.H_BTN).flex_none().gap(ui.GAP_M).items_center()
      .child(this.error ? div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.blocked).tooltip(this.error).child(this.error) : left ?? div().flex_1())
      .when(this.busy, (el) => el.child(ui.loading(t, this.mode === "team" ? "sende …" : "starte …")))
      .child(button);
  }

  teamBody(t) {
    const o = orchestrator();
    const hint = o
      ? `Der Orchestrator plant Tickets, verteilt sie ans Team und bringt die Arbeit geprüft zu dir (Inbox).${o.status === "blocked" ? " Er wartet gerade auf eine Antwort: dein Text beantwortet seine Frage." : ""}`
      : "Kein Orchestrator läuft. Starte ihn im Team-Panel (Orchestrator-Karte) oder starte selbst.";
    return v_flex().flex_1().min_h(0).gap(ui.GAP_M)
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(div().flex_1().min_w(0).text_size(T_S).text_color(o ? t.dim : t.blocked).child(hint))
        .when(!o, (el) => el.child(ui.link(t, "ln-team-panel", "Team-Panel öffnen", () => { closeOverlay(props().overlay); run("tabs-graph.panel-team"); }))))
      .child(this.area(t, this.ask, this.focus.has("ln-ask")))
      .child(this.footer(t, null,
        ui.button(t, "ln-send", "An das Team", (cx) => this.sendTeam(cx), { kind: "primary", enabled: Boolean(o) && !this.busy,
          tip: "Per hc send an den Orchestrator" })));
  }

  selfBody(t) {
    const s = this.space();
    const r = this.repo;
    const n = this.picked.size;
    const repoLine = !s ? "" : r === undefined ? "lese Repository …" : r === null ? "kein Git-Repository: kein Worktree möglich" : `${r.name} · ${r.top}`;
    const left = v_flex().w(260).flex_none().h_full().min_h(0).gap(ui.GAP_S)
      .child(this.label(t, "Vorlage"))
      .child(v_flex().id("ln-templates").flex_1().min_h(80).overflow_y_scrollbar().gap(2)
        .child(this.listRow(t, "tp-none", this.template === null, this.ticket ? "Ticket" : "Leer", this.ticket ? this.ticket.title : "eigene Nachricht", (cx) => this.useTemplate(null, cx)))
        .children(this.templates.map((tp) => this.listRow(t, `tp-${tp.id}`, this.template === tp.id, tp.name, tp.body.split("\n")[0], (cx) => this.useTemplate(tp, cx)))))
      .child(this.label(t, "Space · Maschine"))
      .child(v_flex().id("ln-spaces").flex_1().min_h(80).overflow_y_scrollbar().gap(2)
        .children(spaces().map((x) => this.listRow(t, `sp-${x.id}`, x.id === this.spaceId, x.name, `${x.machine ?? "dieser Rechner"} · ${place(x) ?? ""}`, (cx) => this.pick(cx, x.id)))));

    const right = v_flex().flex_1().min_w(0).h_full().min_h(0).gap(ui.GAP_S)
      .child(this.label(t, `Agents${n > 1 ? ` · ${n} parallel` : ""}`))
      .child(h_flex().flex_wrap().gap(ui.GAP_S)
        .when(this.agents === null && Boolean(s), (el) => el.child(ui.loading(t, "suche installierte Agents …")))
        .children((this.agents ?? []).map((a) => this.chip(t, `ag-${a.key}`, a.name, this.picked.has(a.key), (cx) => this.toggleAgent(a.key, cx))))
        .child(this.chip(t, "ag-custom", "Kommando …", this.picked.has("custom"), (cx) => this.toggleAgent("custom", cx))))
      .when(this.picked.has("custom"), (el) => el.child(ui.inputBox(t, "ln-custom", Input.new(this.custom), { focused: this.focus.has("ln-custom") })))
      .child(h_flex().pt(ui.GAP_XS).gap(ui.GAP_M).items_center()
        .child(this.label(t, "Wo"))
        .child(ui.segment(t, "ln-where", [
          { value: "tab", label: "Neuer Tab im Space" },
          { value: "worktree", label: n > 1 ? "Je ein Worktree" : "Eigener Worktree", tip: r ? "Eigener Git-Worktree unter ~/.herdr/worktrees mit eigenem Space" : "Der Space ist kein Git-Repository" },
        ], this.where, (v, cx) => { if (v === "tab" || r) { this.where = v; cx.notify(); } })))
      .child(div().truncate().text_size(T_S).text_color(r === null ? t.blocked : t.dim).child(repoLine))
      .child(this.where === "worktree"
        ? h_flex().gap(ui.GAP_M).items_center().child(div().flex_1().child(ui.inputBox(t, "ln-branch", Input.new(this.branch), { focused: this.focus.has("ln-branch") })))
          .when(n > 1, (el) => el.child(div().text_size(T_S).text_color(t.dim).child("+ -<agent>")))
        : ui.inputBox(t, "ln-folder", Input.new(this.folder), { focused: this.focus.has("ln-folder") }))
      .child(this.label(t, "Tab-Name"))
      .child(ui.inputBox(t, "ln-name", Input.new(this.name), { focused: this.focus.has("ln-name") }))
      .child(this.label(t, "Erste Nachricht · {folder} {branch} {branchnote} {space} werden ersetzt"))
      .child(this.area(t, this.task, this.focus.has("ln-task")))
      .child(h_flex().gap(ui.GAP_L).items_center().flex_wrap()
        .child(this.check(t, "ln-team", this.team, "Als Team beobachten", (cx) => { this.team = !this.team; cx.notify(); }))
        .when(Boolean(this.ticket?.writeback), (el) => el.child(this.check(t, "ln-wb", this.writeback, this.ticket.writeback, (cx) => { this.writeback = !this.writeback; cx.notify(); }))))
      .child(this.footer(t, null, ui.button(t, "ln-start", n > 1 ? `${n} Agents starten` : "Agent starten", (cx) => this.go(cx, () => this.start()),
        { kind: "primary", enabled: !this.busy && Boolean(s) })));

    return h_flex().flex_1().min_h(0).gap(ui.GAP_XL).items_start().child(left).child(right);
  }

  render() {
    const t = theme();
    const tk = this.ticket;
    const close = () => closeOverlay(props().overlay);
    const switchTo = (v, cx) => { this.mode = v; this.error = ""; (v === "team" ? this.ask : this.task).focus(); cx.notify(); };
    return v_flex().id("launcher").size_full().min_h(0).p(ui.GAP_XL).gap(ui.GAP_L).bg(t.popover).text_size(T_M).text_color(t.foreground)
      .child(ui.dialogHeader(t, "Auftrag", close, { hints: "⌘⇧N" }))
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(ui.segment(t, "ln-mode", [
          { value: "team", label: "Ans Team", tip: "Der Orchestrator plant, verteilt und bringt es geprüft zurück" },
          { value: "self", label: "Selbst starten", tip: "Agents direkt starten: Vorlage, Space, Tab oder Worktree" },
        ], this.mode, switchTo))
        .child(div().flex_1())
        .when(Boolean(tk), (el) => el.child(div().flex_none().max_w(420).truncate().text_size(T_S).text_color(t.muted)
          .tooltip(tk.url || tk.title).child(`Ticket: ${tk.title}`))))
      .child(this.mode === "team" ? this.teamBody(t) : this.selfBody(t));
  }
}
