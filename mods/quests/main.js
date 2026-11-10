// Quests: tickets from GitHub issues, Asana, Trilium and local markdown files. Starting one makes a git
// worktree + branch on the space's machine, opens an agent with the ticket as its first message, and
// tells the source (comment / label / status). props.view picks the face: "panel" (elric's side panel),
// "page" (the quests layout's three columns), "bar" (that layout's title bar), and the dialogs
// "start" {ticket, space}, "settings" and "edit" {id?} (a local ticket).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { props, theme, run, spaces, agents, notify, openOverlay, closeOverlay, shared, setShared, knownAgents, exec, home, window as host } from "herdr";
import * as store from "./store.js";
import { SOURCES, label, stage, load, writeback, place, repoOf, homeOn, git, errorText } from "./sources.js";

const ICON = "mods/quests/icon.svg";
const WC = "mods/workspace-chrome";
const SPINNER = `${WC}/spinner.svg`;
// Copies (panel, page, dialogs) tell each other to re-read the files: { at, scope: "local" | "all" }. No data in it.
const REV = "quests.rev";
const bump = (scope) => setShared(REV, { at: Date.now(), scope });
// The page's selected ticket key ("github:owner/repo#1"); the panel's start dialog hands tickets over with it.
const SEL = "quests.selected";
const keyOf = (t) => `${t.source}:${t.id}`;
const stop = (_e, cx) => cx.stop_propagation();

// ---- small pieces

function btn(t, id, text, onClick, { primary, danger, icon, disabled, tip } = {}) {
  return h_flex().id(id).flex_none().items_center().gap(6).h(26).px(10).rounded(7).border_1()
    .border_color(primary ? t.solid : danger ? t.blocked + "90" : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : danger ? t.blocked : t.foreground).text_size(12)
    .on_mouse_down("left", stop)
    .when(Boolean(disabled), (el) => el.opacity(0.45))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .when(Boolean(icon), (el) => el.child(svg(icon).size(13)))
    .child(text);
}

function iconBtn(t, id, icon, tip, onClick) {
  return div().id(id).flex_none().p(3).rounded(5).text_color(t.dim).cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .child(svg(icon).size(14));
}

function toggle(t, id, on, text, onClick, disabled = false) {
  return h_flex().id(id).gap(8).items_center().cursor_pointer().when(disabled, (el) => el.opacity(0.45))
    .on_click((_e, cx) => { if (!disabled) onClick(cx); })
    .child(h_flex().flex_none().w(28).h(16).p(2).rounded(8).bg(on ? t.solid : t.border).when(on, (el) => el.justify_end())
      .child(div().size(12).rounded(6).bg(on ? t.solid_foreground : t.muted)))
    .child(div().flex_1().min_w(0).text_size(12).text_color(on ? t.foreground : t.muted).child(text));
}

const chip = (t, id, text, color) => div().id(id).flex_none().max_w(120).truncate().px(5).h(16).flex().items_center().rounded(4)
  .bg(t.raised).border(1).border_color(t.border).text_size(10).text_color(color ?? t.muted).child(text);

const field = (t, text, el) => v_flex().gap(4).child(div().text_size(11).text_color(t.dim).child(text)).child(el);

const styled = (t, el) => el.h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground);

const spinner = (t, color) => svg(SPINNER).size(12).flex_none().text_color(color ?? t.working).spin(900);

// The state dot: a halo breathes around it while the agent works, faster when it needs the person.
function dot(color, anim) {
  const core = div().size(7).rounded(4).bg(color);
  if (!anim) return div().size(13).flex_none().flex().items_center().justify_center().child(core.opacity(0.7));
  return div().relative().size(13).flex_none().flex().items_center().justify_center()
    .child(div().absolute().inset_0().rounded(7).bg(color + "55").loop("opacity", { from: 0, to: 1, period: anim === "pulse" ? 800 : 2200 }))
    .child(core);
}

// A started quest now: its agent's status, or just whether its tab is still there.
function liveState(rec) {
  if (!rec) return null;
  const a = agents().find((x) => x.address === rec.terminal);
  return { status: a?.status ?? null, alive: Boolean(a) || spaces().some((s) => s.tabs.some((c) => c.id === rec.tab)) };
}

function lastRecord(list, key) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].key === key) return list[i];
  return null;
}

function openRecord(rec, fromPage) {
  if (fromPage) run("layout.switch", { name: "elric" });
  run("space.select", { id: rec.space });
  run("tab.select", { id: rec.tab });
}

// feat/… unless the labels say it's a fix; GitHub issues carry their number.
function branchFor(tk) {
  const fix = tk.labels.some((l) => /bug|fix|defect|hotfix/i.test(l));
  return `${fix ? "fix" : "feat"}/${tk.source === "github" ? `${tk.number}-` : ""}${store.slug(tk.title, 40) || "quest"}`;
}

const WRITEBACK = {
  github: "Comment on the issue and assign me",
  asana: "Comment on the Asana task",
  trilium: "Set labels questStatus=doing and questBranch on the note",
  plain: "Set the ticket's status to doing",
};

// ---- the start form: target space, branch, worktree, agent, first message, writeback

// Text states need a live host call (init or an event), never a background task: the page makes
// one set in init (inputs()) and every form it builds later reuses it.
const inputs = () => ({
  branch: InputState.new({ placeholder: "branch name" }),
  message: TextareaState.new({ rows: 10 }),
  custom: InputState.new({ placeholder: "command, e.g. claude --model opus" }),
});

class StartForm {
  constructor(ticket, spaceId, cx, onDone, states = inputs()) {
    this.ticket = ticket;
    this.onDone = onDone;
    ({ branch: this.branch, message: this.message, custom: this.custom } = states);
    states.owner = this; // a newer form on the same states wins over this one's late message
    this.branch.set_value(branchFor(ticket));
    this.message.set_value("");
    this.worktree = true;
    this.writeback = true;
    this.agent = "omp";
    this.agents = null;
    this.busy = false;
    this.error = "";
    this.token = 0;
    this.settings = null;
    cx.spawn(async (cx) => {
      const settings = await store.loadSettings();
      if (states.owner !== this) return;
      this.settings = settings;
      const tk = this.ticket;
      // {branch} and {folder} stay until start: they're only known then.
      this.message.set_value(store.fill(this.settings.template, {
        title: tk.title, body: tk.body?.trim() || "(no description)", url: tk.source === "plain" ? "" : tk.url,
        source: label(tk.source), id: tk.source === "github" ? `#${tk.number} in ${tk.repo}` : tk.id, labels: tk.labels.join(", "),
      }));
      cx.notify();
    });
    this.pick(cx, spaceId ?? spaces().find((s) => s.active)?.id);
  }

  pick(cx, id) {
    const s = spaces().find((x) => x.id === id);
    const token = ++this.token;
    this.space = s?.id ?? null;
    this.repo = s ? undefined : null;
    this.agents = null;
    if (!s) return;
    const on = s.machine ?? null;
    const folder = place(s);
    cx.spawn(async (cx) => {
      const [repo, list] = await Promise.all([folder ? repoOf(folder, on).catch(() => null) : null, knownAgents({ on }).catch(() => [])]);
      if (token !== this.token) return;
      this.repo = repo;
      this.agents = list.filter((a) => a.installed);
      if (this.agent !== "custom" && !this.agents.some((a) => a.key === this.agent)) this.agent = this.agents.find((a) => a.key === "omp")?.key ?? this.agents[0]?.key ?? "custom";
      cx.notify();
    });
    cx.notify();
  }

  argv() {
    // shortcut: whitespace split, no quoting; a wrapper script covers arguments with spaces.
    if (this.agent === "custom") return this.custom.value().trim().split(/\s+/).filter(Boolean);
    return this.agents?.find((a) => a.key === this.agent)?.run ?? [];
  }

  start(cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try { await this.run(); } catch (e) { this.error = store.mask(errorText(e), this.settings); }
      this.busy = false;
      cx.notify();
    });
  }

  async run() {
    const tk = this.ticket;
    const s = spaces().find((x) => x.id === this.space);
    if (!s) throw new Error("Pick a space to work in.");
    if (this.repo === undefined) throw new Error("Still reading that space's repository.");
    const settings = (this.settings = await store.loadSettings());
    const branch = this.branch.value().trim();
    if (!branch) throw new Error("Type a branch name.");
    const argv = this.argv();
    if (!argv.length) throw new Error("Pick an agent (or type a command).");
    const on = s.machine ?? null;
    const worktree = this.worktree && Boolean(this.repo);
    let folder = place(s) || "";
    if (this.repo && !(await git(this.repo.top, ["check-ref-format", "--branch", branch], on)).ok) throw new Error(`"${branch}" isn't a valid branch name.`);
    if (worktree) {
      // Same place and naming as the shipped worktree mod, so the sidebar nests it under its repo.
      folder = `${await homeOn(on, home())}/.herdr/worktrees/${this.repo.name}/${branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}`;
      const exists = (await git(this.repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], on)).ok;
      const r = await git(this.repo.top, exists ? ["worktree", "add", folder, branch] : ["worktree", "add", "-b", branch, folder, "HEAD"], on, 600000);
      if (!r.ok) throw new Error(r.err || "git worktree add failed.");
    }
    const task = store.fill(this.message.value(), { branch, folder: folder || "the space's folder" });
    const name = `${tk.source === "github" ? `#${tk.number} ` : ""}${tk.title}`.slice(0, 40);
    // herdr-app do prints the ids it made (run() returns none); a worktree gets its own space, unnamed so it follows the checkout.
    const [cmd, args] = worktree
      ? ["space.new", { folder, machine: on ?? "", tab: name, argv, task }]
      : ["tab.new", { space: s.id, name, argv, task, ...(folder ? { folder } : {}) }];
    const r = await exec("herdr-app", ["do", cmd, JSON.stringify(args)], { timeout: 60000 });
    let made = null;
    try { made = JSON.parse(r.stdout); } catch {}
    if (r.code !== 0 || !made?.terminal) throw new Error(made?.error ?? ((r.stderr || r.stdout).trim() || `${cmd} failed`));
    const agentName = this.agent === "custom" ? argv[0] : this.agents.find((a) => a.key === this.agent)?.name ?? this.agent;
    const rec = {
      key: keyOf(tk), source: tk.source, id: tk.id, title: tk.title, url: tk.url, branch, worktree, folder, machine: on,
      space: made.space ?? s.id, tab: made.tab, terminal: made.terminal, agent: agentName, at: Date.now(),
    };
    await store.addStarted(rec);
    let lines = [];
    if (this.writeback) {
      try { lines = await writeback(tk, rec, settings); }
      catch (e) { notify({ title: "Quest started, writeback failed", body: store.mask(errorText(e), settings).slice(0, 600), level: "warning", timeout: 15000 }); }
    }
    bump("local");
    notify({
      title: `Quest started: ${tk.title}`.slice(0, 90), body: [`${branch} · ${agentName}`, ...lines].join("\n").slice(0, 900),
      level: "success", timeout: 12000, action: { name: "space.select", args: { id: rec.space } },
    });
    this.onDone?.();
  }

  render(t) {
    const all = spaces();
    const r = this.repo;
    const spaceRow = (s) => {
      const on = s.id === this.space;
      return h_flex().id(`sp-${s.id}`).flex_none().h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .bg(on ? t.selected : t.background).border(1).border_color(on ? t.solid : t.background)
        .hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.pick(cx, s.id))
        .child(svg(`${WC}/server.svg`).size(11).flex_none().text_color(s.machine ? t.working : t.dim))
        .child(div().flex_none().max_w(150).truncate().text_size(12).text_color(on ? t.foreground : t.muted).child(s.name))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${s.machine ?? "this PC"} · ${place(s) ?? ""}`));
    };
    const agentChip = (key, text) => {
      const on = this.agent === key;
      return div().id(`ag-${key}`).flex_none().px(9).h(24).flex().items_center().rounded(6).text_size(12).cursor_pointer()
        .bg(on ? t.selected : t.raised).border(1).border_color(on ? t.solid : t.border).text_color(on ? t.foreground : t.muted)
        .hover((st) => st.text_color(t.foreground)).on_click((_e, cx) => { this.agent = key; cx.notify(); }).child(text);
    };
    const repoLine = r === undefined ? "Reading the repository…" : r === null ? "Not a git repository: no worktree, the agent starts in the space's folder." : `${r.name} · ${r.top}`;
    const dry = this.settings?.dryRun;
    return v_flex().gap(12)
      .child(field(t, "Work in (space and its machine)", v_flex().id("q-spaces").max_h(150).overflow_y_scrollbar().gap(2).children(all.map(spaceRow))))
      .child(h_flex().gap(6).items_center().text_size(11.5).text_color(r === null ? t.blocked : t.dim)
        .when(r === undefined && Boolean(this.space), (el) => el.child(spinner(t, t.dim)))
        .child(div().flex_1().min_w(0).truncate().child(repoLine)))
      .child(field(t, "Branch", styled(t, Input.new(this.branch))))
      .child(toggle(t, "q-wt", this.worktree && r !== null, r ? `New worktree in ~/.herdr/worktrees/${r.name}/ (own space)` : "New worktree", (cx) => { this.worktree = !this.worktree; cx.notify(); }, !r))
      .child(field(t, "Agent", v_flex().gap(6)
        .child(h_flex().flex_wrap().gap(6)
          .when(this.agents === null && Boolean(this.space), (el) => el.child(spinner(t, t.dim)))
          .children((this.agents ?? []).map((a) => agentChip(a.key, a.name)))
          .child(agentChip("custom", "Command…")))
        .when(this.agent === "custom", (el) => el.child(styled(t, Input.new(this.custom))))))
      .child(field(t, "First message ({branch} and {folder} are filled in at start)",
        Textarea.new(this.message).h(190).px(8).py(6).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground)))
      .child(toggle(t, "q-wb", this.writeback, `${WRITEBACK[this.ticket.source]}${dry ? " (dry run)" : ""}`, (cx) => { this.writeback = !this.writeback; cx.notify(); }))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).items_center().justify_end()
        .when(this.busy, (el) => el.child(spinner(t)).child(div().text_size(11.5).text_color(t.dim).child("Starting…")))
        .child(btn(t, "q-go", "Start quest", (cx) => this.start(cx), { primary: true, disabled: this.busy || !this.space, icon: "mods/docker/play.svg" })));
  }
}

// ---- panel and page: the tickets of every enabled source

class Board {
  constructor(view, cx) {
    this.view = view;
    this.settings = null;
    this.src = {}; // source key -> { tickets, error, note, loading }
    this.started = [];
    this.repos = [];
    this.filter = "";
    this.only = localStorage.getItem("only") || null;
    this.stage = localStorage.getItem("stage") || "open";
    this.folded = new Set();
    this.hovered = null;
    // The page comes back fresh after every layout switch, and the panel can hand it a ticket: shared selection.
    this.selected = view === "page" ? shared(SEL) ?? null : null;
    this.form = null;
    this.gen = 0;
    this.input = InputState.new({ placeholder: "Filter quests…" });
    this.states = view === "page" ? inputs() : null;
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().trim().toLowerCase(); cx.notify(); });
    this.rev = shared(REV)?.at ?? 0;
    this.reload(cx, true);
  }

  reload(cx, remote) {
    const gen = ++this.gen;
    cx.spawn(async (cx) => {
      const settings = await store.loadSettings();
      const started = await store.loadStarted();
      if (gen !== this.gen) return;
      this.settings = settings;
      this.started = started;
      cx.notify();
      await Promise.all(SOURCES.map(async ({ key }) => {
        if (!settings[key].enabled) { delete this.src[key]; return; }
        if (!remote && key !== "plain" && this.src[key]) return;
        this.src[key] = { ...(this.src[key] ?? { tickets: [] }), loading: true };
        cx.notify();
        let next;
        try {
          const r = await load(key, settings);
          if (r.repos) this.repos = r.repos;
          next = { tickets: r.tickets, error: r.error ? store.mask(r.error, settings) : null, note: r.note ?? null, loading: false };
        } catch (e) { next = { tickets: [], error: store.mask(errorText(e), settings), loading: false }; }
        if (gen !== this.gen) return;
        this.src[key] = next;
        this.ensureForm(cx);
        cx.notify();
      }));
    });
  }

  all() { return SOURCES.flatMap((s) => this.src[s.key]?.tickets ?? []); }

  record(tk) { return lastRecord(this.started, keyOf(tk)); }

  matches(tk) {
    const st = stage(tk);
    if (this.stage === "open" && st === "done") return false;
    if (this.stage === "doing" && st !== "doing" && !liveState(this.record(tk))?.alive) return false;
    if (!this.filter) return true;
    return [tk.title, tk.id, tk.project, tk.assignee, ...tk.labels].some((s) => String(s ?? "").toLowerCase().includes(this.filter));
  }

  // The space to start in: the one whose checkout is the issue's repo, else the one a hint names.
  suggest(tk) {
    if (tk.source === "github") return this.repos.find((r) => r.repo.toLowerCase() === tk.repo.toLowerCase())?.space ?? null;
    const hint = String(tk.repo || tk.project || "").trim().toLowerCase().replace(/\\/g, "/");
    if (!hint) return null;
    return spaces().find((s) => {
      const at = String(place(s) ?? "").toLowerCase().replace(/\\/g, "/");
      return s.name.toLowerCase() === hint || at === hint || at.endsWith(`/${hint}`);
    })?.id ?? null;
  }

  start(tk, cx) {
    if (this.view === "page") return this.select(tk, cx);
    openOverlay({ mod: "quests", kind: "dialog", width: 640, height: 0.9, props: { view: "start", ticket: tk, space: this.suggest(tk) } });
  }

  select(tk, cx) {
    if (this.selected === keyOf(tk)) return;
    this.selected = keyOf(tk);
    setShared(SEL, this.selected);
    this.ensureForm(cx);
    cx.notify();
  }

  // The page's start form follows the selected ticket (and that ticket's fresh data after a reload).
  ensureForm(cx) {
    const tk = this.all().find((x) => keyOf(x) === this.selected);
    if (this.view !== "page" || !tk) return;
    if (this.form && keyOf(this.form.ticket) === this.selected) this.form.ticket = tk;
    else this.form = new StartForm(tk, this.suggest(tk), cx, null, this.states);
  }

  sync(cx) {
    const rev = shared(REV);
    if (rev && rev.at !== this.rev) { this.rev = rev.at; this.reload(cx, rev.scope === "all"); }
    const sel = this.view === "page" ? shared(SEL) ?? null : this.selected;
    if (sel !== this.selected) { this.selected = sel; cx.spawn(async (cx) => { this.ensureForm(cx); cx.notify(); }); }
  }

  look(t, tk, rec) {
    const live = liveState(rec);
    if (live?.status) return { color: t[live.status] ?? t.solid, anim: live.status === "blocked" ? "pulse" : live.status === "working" ? "bob" : null, live, text: live.status };
    if (live?.alive) return { color: t.solid, anim: null, live, text: "running" };
    const st = stage(tk);
    return { color: st === "done" ? t.done : st === "doing" ? t.solid : t.dim, anim: null, live, text: rec ? "ended" : tk.status };
  }

  card(t, tk) {
    const k = keyOf(tk);
    const rec = this.record(tk);
    const l = this.look(t, tk, rec);
    const sel = this.view === "page" && this.selected === k;
    const hov = this.hovered === k;
    const meta = [tk.source === "github" ? `#${tk.number}` : null, tk.project, tk.due && `due ${tk.due}`, tk.assignee].filter(Boolean).join(" · ");
    const right = hov && l.live?.alive ? btn(t, `open-${k}`, "Open", () => openRecord(rec, this.view === "page"))
      : hov && this.view === "panel" ? btn(t, `start-${k}`, "Start", (cx) => this.start(tk, cx), { primary: true })
      : h_flex().flex_none().gap(4).items_center().when(Boolean(l.live?.alive), (el) => el.child(dot(l.color, l.anim)))
        .child(div().text_size(10.5).text_color(l.live?.alive ? l.color : t.dim).child(l.text));
    return div().id(`q-${k}`).relative().mb(6).flex_none().rounded(10).overflow_hidden().cursor_pointer()
      .bg(sel ? t.selected : t.surface).border(1).border_color(sel ? t.solid : t.border)
      .hover((s) => s.bg(sel ? t.selected : t.hover).border_color(sel ? t.solid : t.input))
      .on_hover((on, cx) => { if (on) this.hovered = k; else if (this.hovered === k) this.hovered = null; cx.notify(); })
      .on_click((_e, cx) => this.start(tk, cx))
      .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(l.color))
      .child(v_flex().pl(12).pr(10).py(8).gap(3)
        .child(h_flex().gap(8).items_center().min_h(22)
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12.5).text_color(stage(tk) === "done" ? t.muted : t.foreground).child(tk.title))
          .child(right))
        .child(h_flex().gap(5).items_center().min_w(0).text_size(11).text_color(t.dim)
          .child(div().flex_shrink(1).min_w(0).truncate().child(meta || label(tk.source)))
          .children(tk.labels.slice(0, 3).map((x, i) => chip(t, `${k}-l${i}`, x))))
        .when(Boolean(rec), (el) => el.child(h_flex().gap(5).items_center().min_w(0).text_size(10.5).text_color(t.muted)
          .child(svg(`${WC}/git-branch.svg`).size(11).flex_none())
          .child(div().flex_1().min_w(0).truncate().child(`${rec.branch} · ${rec.machine ?? "this PC"} · ${rec.agent}`)))));
  }

  list(t) {
    const out = [];
    for (const { key } of SOURCES) {
      const S = this.src[key];
      if (!S || (this.only && this.only !== key)) continue;
      const shown = S.tickets.filter((tk) => this.matches(tk));
      const open = !this.folded.has(key);
      out.push(h_flex().id(`g-${key}`).px(6).pt(8).h(30).flex_none().gap(6).items_center().text_size(11).font_medium().text_color(t.dim)
        .cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { open ? this.folded.add(key) : this.folded.delete(key); cx.notify(); })
        .child(svg(`${WC}/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .child(div().text_color(t.muted).child(label(key)))
        .child(div().child(String(shown.length)))
        .child(div().flex_1())
        .when(Boolean(S.loading), (el) => el.child(spinner(t)))
        .when(key === "plain", (el) => el.child(iconBtn(t, "g-plain-new", `${WC}/plus.svg`, "New local ticket", () => openEdit()))));
      if (!open) continue;
      if (S.error) {
        out.push(h_flex().id(`err-${key}`).mx(2).mb(6).px(10).py(7).gap(8).items_center().rounded(10).border(1).border_color(t.blocked + "60").bg(t.surface)
          .text_size(11.5).text_color(t.muted).tooltip(S.error)
          .child(div().size(7).flex_none().rounded(4).border(1.5).border_color(t.blocked))
          .child(div().flex_1().min_w(0).truncate().child(S.error.split("\n")[0])));
      }
      out.push(...shown.map((tk) => this.card(t, tk)));
      if (!shown.length && !S.loading && !S.error) {
        out.push(div().px(8).pb(4).text_size(11.5).text_color(t.dim).child(S.note ?? (S.tickets.length ? "Nothing matches." : "No open tickets.")));
      }
    }
    if (!out.length) out.push(div().px(8).py(10).text_size(12).text_color(t.dim).child(this.settings ? "No source enabled: open the settings." : "Loading…"));
    return out;
  }

  stageSeg(t) {
    const seg = (value, text) => div().id(`st-${value}`).px(8).h(20).flex().items_center().rounded(5).text_size(11).cursor_pointer()
      .bg(this.stage === value ? t.selected : t.background).text_color(this.stage === value ? t.foreground : t.dim)
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.stage = value; localStorage.setItem("stage", value); cx.notify(); })
      .child(text);
    return h_flex().flex_none().p(2).gap(2).rounded(7).border(1).border_color(t.border).bg(t.background)
      .child(seg("open", "Open")).child(seg("doing", "Doing")).child(seg("all", "All"));
  }

  header(t, title) {
    return h_flex().px(14).h(40).flex_none().gap(6).items_center().border_b(1).border_color(t.border)
      .child(svg(ICON).size(15).flex_none().text_color(t.accent))
      .child(div().flex_1().text_size(12.5).font_semibold().child(title))
      .child(iconBtn(t, "h-new", `${WC}/plus.svg`, "New local ticket", () => openEdit()))
      .child(iconBtn(t, "h-refresh", "mods/docker/restart.svg", "Refresh", (cx) => this.reload(cx, true)))
      .child(iconBtn(t, "h-settings", `${WC}/settings.svg`, "Sources and tokens", () => openSettings()))
      .when(this.view === "panel", (el) => el.child(iconBtn(t, "h-page", `${WC}/panel-right.svg`, "Open the Quests page", () => run("layout.switch", { name: "quests" }))));
  }

  filterRow(t) {
    return h_flex().px(10).pt(8).pb(4).gap(6).flex_none().items_center()
      .child(styled(t, Input.new(this.input)).flex_1())
      .child(this.stageSeg(t));
  }

  render(cx) {
    this.sync(cx);
    const t = theme();
    const box = (id) => v_flex().id(id).min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border);
    const listCol = v_flex().id("q-list").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar().children(this.list(t));
    if (this.view === "panel") {
      return box("quests").size_full().text_color(t.foreground).text_size(13)
        .child(this.header(t, "Quests")).child(this.filterRow(t)).child(listCol);
    }
    return h_flex().id("quests-page").size_full().min_h(0).gap(8).text_color(t.foreground).text_size(13)
      .child(box("q-left").w(240).flex_none().h_full().child(this.sourcesCol(t)))
      .child(box("q-mid").flex_1().min_w(280).h_full().child(this.header(t, "Tickets")).child(this.filterRow(t)).child(listCol))
      .child(box("q-right").w(500).flex_none().h_full().child(this.detail(t)));
  }

  sourcesCol(t) {
    const row = (key, text, S, enabled) => {
      const on = this.only === key;
      const count = key ? (S?.tickets.length ?? 0) : this.all().length;
      return h_flex().id(`src-${key ?? "all"}`).h(30).px(10).gap(8).items_center().rounded(7).cursor_pointer()
        .bg(on ? t.selected : t.background).hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click((_e, cx) => {
          if (key && !enabled) return openSettings();
          this.only = key; localStorage.setItem("only", key ?? ""); cx.notify();
        })
        .child(div().size(7).flex_none().rounded(4).bg(!key || enabled ? (S?.error ? t.blocked : t.done) : t.border))
        .child(div().flex_1().text_size(12.5).text_color(on ? t.foreground : enabled || !key ? t.muted : t.dim).child(text))
        .when(Boolean(S?.loading), (el) => el.child(spinner(t)))
        .child(div().text_size(11).text_color(t.dim).child(key && !enabled ? "off" : String(count)));
    };
    const recent = this.started.slice(-12).reverse();
    return v_flex().size_full().min_h(0)
      .child(h_flex().px(14).h(40).flex_none().gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(12.5).font_semibold().child("Sources")))
      .child(v_flex().p(8).gap(2).flex_none()
        .child(row(null, "All sources", null, true))
        .children(SOURCES.map((s) => row(s.key, s.label, this.src[s.key], Boolean(this.settings?.[s.key]?.enabled)))))
      .child(v_flex().px(10).py(6).gap(8).flex_none()
        .child(btn(t, "l-new", "New local ticket", () => openEdit(), { icon: `${WC}/plus.svg` }))
        .child(btn(t, "l-settings", "Sources & tokens", () => openSettings(), { icon: `${WC}/settings.svg` })))
      .child(div().px(14).pt(12).pb(4).text_size(11).font_medium().text_color(t.dim).child("Started"))
      .child(v_flex().id("l-started").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar()
        .when(!recent.length, (el) => el.child(div().px(6).text_size(11.5).text_color(t.dim).child("Nothing started yet.")))
        .children(recent.map((rec) => {
          const live = liveState(rec);
          const color = live?.status ? t[live.status] : live?.alive ? t.solid : t.dim;
          return h_flex().id(`r-${rec.at}`).h(34).px(6).gap(8).items_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
            .tooltip(live?.alive ? "Show its tab" : "Its tab is gone")
            .on_click(() => { if (live?.alive) openRecord(rec, true); })
            .child(live?.alive ? dot(color, live.status === "blocked" ? "pulse" : live.status === "working" ? "bob" : null) : dot(t.border, null))
            .child(v_flex().flex_1().min_w(0)
              .child(div().truncate().text_size(12).text_color(live?.alive ? t.foreground : t.dim).child(rec.title))
              .child(div().truncate().text_size(10.5).text_color(t.dim).child(`${rec.branch} · ${live?.status ?? (live?.alive ? "running" : "ended")}`)));
        })));
  }

  detail(t) {
    const tk = this.form && keyOf(this.form.ticket) === this.selected ? this.form.ticket : null;
    if (!tk || !this.form) {
      return v_flex().size_full().items_center().justify_center().gap(8).text_color(t.dim)
        .child(svg(ICON).size(28).text_color(t.border)).child("Pick a ticket to see it and start it.");
    }
    const k = keyOf(tk);
    const recs = this.started.filter((r) => r.key === k).reverse();
    const meta = [label(tk.source), tk.source === "github" ? `#${tk.number} · ${tk.repo}` : tk.source === "plain" ? `${tk.id}.md` : tk.id,
      tk.status, tk.assignee, tk.due && `due ${tk.due}`, tk.source !== "github" && tk.project].filter(Boolean);
    return v_flex().id("q-detail").size_full().min_h(0).overflow_y_scrollbar().p(14).gap(12)
      .child(h_flex().gap(8).items_start()
        .child(div().flex_1().min_w(0).text_size(15).font_semibold().child(tk.title))
        .when(tk.source === "plain", (el) => el.child(btn(t, "d-edit", "Edit", () => openEdit(tk.id), { icon: `${WC}/square-pen.svg` })))
        .when(tk.source !== "plain" && Boolean(tk.url), (el) => el.child(btn(t, "d-url", "Open", (cx) => cx.open_url(tk.url), { tip: tk.url }))))
      .child(h_flex().flex_wrap().gap(5).items_center().text_size(11.5).text_color(t.dim)
        .child(div().child(meta.join(" · ")))
        .children(tk.labels.map((x, i) => chip(t, `d-l${i}`, x))))
      .child(div().rounded(8).bg(t.surface).border_1().border_color(t.border).px(12).py(8).text_size(12.5)
        .child(tk.body?.trim() ? TextView.markdown(`md-${k}`, tk.body).selectable(true) : div().text_color(t.dim).child("No description.")))
      .children(recs.map((rec) => {
        const l = this.look(t, tk, rec);
        return h_flex().id(`dr-${rec.at}`).gap(8).items_center().px(10).h(32).rounded(8).border(1).border_color(t.border).bg(t.surface).text_size(11.5)
          .child(l.live?.alive ? dot(l.color, l.anim) : dot(t.border, null))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`${rec.branch} · ${rec.machine ?? "this PC"} · ${rec.agent} · ${l.text}`))
          .when(Boolean(l.live?.alive), (el) => el.child(btn(t, `dr-open-${rec.at}`, "Open", () => openRecord(rec, true))))
          .child(iconBtn(t, `dr-x-${rec.at}`, `${WC}/x.svg`, "Forget this start (the worktree and tab stay)", (cx) => cx.spawn(async () => { await store.forgetStarted(rec.at); bump("local"); })));
      }))
      .child(div().pt(4).text_size(13).font_semibold().child(recs.length ? "Start again" : "Start quest"))
      .child(this.form.render(t));
  }
}

const openEdit = (id) => openOverlay({ mod: "quests", kind: "dialog", width: 620, height: 0.85, props: { view: "edit", id: id ?? null } });
const openSettings = () => openOverlay({ mod: "quests", kind: "dialog", width: 620, height: 0.9, props: { view: "settings" } });

// ---- dialogs

function dialog(t, id, title, body, footer) {
  return v_flex().id(id).size_full().bg(t.popover).text_color(t.foreground).text_size(13)
    .child(h_flex().px(16).h(44).flex_none().gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg(ICON).size(15).flex_none().text_color(t.accent))
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_semibold().child(title)))
    .child(v_flex().id(`${id}-body`).flex_1().min_h(0).overflow_y_scrollbar().px(16).py(12).gap(12).child(body))
    .when(Boolean(footer), (el) => el.child(h_flex().px(16).h(50).flex_none().gap(8).items_center().justify_end().border_t(1).border_color(t.border).child(footer)));
}

const closeSelf = () => closeOverlay(props().overlay);

class StartDialog {
  constructor(cx) {
    const p = props();
    this.form = new StartForm(p.ticket, p.space, cx, closeSelf);
  }
  render() {
    const t = theme();
    const tk = this.form.ticket;
    return dialog(t, "q-start", `Start: ${tk.title}`, v_flex().gap(12)
      .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child([label(tk.source), tk.source === "github" ? `#${tk.number} · ${tk.repo}` : tk.id, tk.status].join(" · ")))
        .when(tk.source !== "plain" && Boolean(tk.url), (el) => el.child(btn(t, "s-url", "Open", (cx) => cx.open_url(tk.url), { tip: tk.url })))
        .child(btn(t, "s-page", "On page", () => { setShared(SEL, keyOf(tk)); closeSelf(); run("layout.switch", { name: "quests" }); }, { tip: "Show this ticket on the Quests page" })))
      .when(Boolean(tk.body?.trim()), (el) => el.child(div().id("s-body").max_h(150).overflow_y_scrollbar().rounded(8).bg(t.surface).border_1().border_color(t.border).px(12).py(8).text_size(12)
        .child(TextView.markdown("s-md", tk.body).selectable(true))))
      .child(this.form.render(t)));
  }
}

class Settings {
  constructor(cx) {
    this.s = null;
    this.error = "";
    this.clear = new Set();
    const I = (placeholder) => InputState.new({ placeholder });
    this.in = {
      ghRepos: I("owner/repo another/repo"), asanaToken: I("personal access token"), asanaApi: I(store.DEFAULTS.asana.api),
      asanaWs: I("workspace gid (empty: your first)"), asanaProjects: I("project gids (empty: tasks assigned to me)"),
      triliumUrl: I("http://localhost:8080"), triliumToken: I("ETAPI token"), triliumQuery: I("#quest"),
    };
    this.in.asanaToken.set_masked(true);
    this.in.triliumToken.set_masked(true);
    this.template = TextareaState.new({ rows: 8 });
    cx.spawn(async (cx) => {
      const s = (this.s = await store.loadSettings());
      this.in.ghRepos.set_value(s.github.repos);
      this.in.asanaApi.set_value(s.asana.api);
      this.in.asanaWs.set_value(s.asana.workspace);
      this.in.asanaProjects.set_value(s.asana.projects);
      this.in.triliumUrl.set_value(s.trilium.url);
      this.in.triliumQuery.set_value(s.trilium.query);
      this.template.set_value(s.template);
      cx.notify();
    });
  }

  save(cx) {
    const s = this.s;
    if (!s) return;
    const v = (k) => this.in[k].value().trim();
    // Typed replaces, empty keeps, Clear removes; the saved token never comes back into an input.
    const token = (k, src) => v(k) || (this.clear.has(src) ? "" : s[src].token);
    const url = (x) => !x || /^https?:\/\/[^\s]+$/.test(x);
    if (!url(v("asanaApi")) || !url(v("triliumUrl"))) { this.error = "URLs start with http:// or https://."; cx.notify(); return; }
    const next = {
      ...s, template: this.template.value().trim() || store.TEMPLATE,
      github: { ...s.github, repos: v("ghRepos") },
      asana: { ...s.asana, token: token("asanaToken", "asana"), api: v("asanaApi") || store.DEFAULTS.asana.api, workspace: v("asanaWs"), projects: v("asanaProjects") },
      trilium: { ...s.trilium, token: token("triliumToken", "trilium"), url: v("triliumUrl"), query: v("triliumQuery") || "#quest" },
    };
    cx.spawn(async (cx) => {
      try { await store.saveSettings(next); bump("all"); closeSelf(); }
      catch (e) { this.error = errorText(e); cx.notify(); }
    });
  }

  render() {
    const t = theme();
    const s = this.s;
    if (!s) return dialog(t, "q-settings", "Quest sources", div().text_color(t.dim).child("Loading…"));
    const flip = (obj, k) => (cx) => { obj[k] = !obj[k]; cx.notify(); };
    const input = (k) => styled(t, Input.new(this.in[k]));
    const tokenField = (k, src, text) => {
      const saved = Boolean(s[src].token) && !this.clear.has(src);
      return field(t, `${text}${saved ? " · saved, type to replace" : ""}`, h_flex().gap(6).items_center()
        .child(input(k).flex_1())
        .when(saved, (el) => el.child(btn(t, `clear-${src}`, "Clear", (cx) => { this.clear.add(src); this.in[k].set_value(""); cx.notify(); }, { danger: true }))));
    };
    const section = (id, text, enabled, flipIt, body) => v_flex().id(id).gap(10).p(12).rounded(10).bg(t.surface).border_1().border_color(t.border)
      .child(h_flex().items_center().child(div().flex_1().text_size(13).font_semibold().child(text)).child(toggle(t, `${id}-on`, enabled, enabled ? "on" : "off", flipIt)))
      .when(enabled, (el) => el.child(body));
    const body = v_flex().gap(12)
      .child(div().text_size(11.5).text_color(t.dim).child(`Stored only on this PC in ${store.dir()}/settings.json (git-ignored). Tokens are never shown again.`))
      .child(section("s-gh", "GitHub issues (gh CLI)", s.github.enabled, flip(s.github, "enabled"), v_flex().gap(10)
        .child(field(t, "Extra repositories (your spaces' GitHub checkouts are always included)", input("ghRepos")))
        .child(toggle(t, "s-gh-mine", s.github.mine, "Only issues assigned to me", flip(s.github, "mine")))))
      .child(section("s-asana", "Asana", s.asana.enabled, flip(s.asana, "enabled"), v_flex().gap(10)
        .child(tokenField("asanaToken", "asana", "Personal access token"))
        .child(field(t, "Workspace", input("asanaWs")))
        .child(field(t, "Projects", input("asanaProjects")))
        .child(field(t, "API URL", input("asanaApi")))))
      .child(section("s-tri", "Trilium (ETAPI)", s.trilium.enabled, flip(s.trilium, "enabled"), v_flex().gap(10)
        .child(field(t, "Server URL", input("triliumUrl")))
        .child(tokenField("triliumToken", "trilium", "ETAPI token"))
        .child(field(t, "Search (notes that are quests)", input("triliumQuery")))))
      .child(section("s-plain", "Local tickets (markdown files)", s.plain.enabled, flip(s.plain, "enabled"),
        div().text_size(11.5).text_color(t.dim).child(`${store.dir()}/tickets/*.md`)))
      .child(v_flex().gap(10).p(12).rounded(10).bg(t.surface).border_1().border_color(t.border)
        .child(div().text_size(13).font_semibold().child("Starting"))
        .child(toggle(t, "s-dry", s.dryRun, "Dry run writeback: show what would be written, change nothing", flip(s, "dryRun")))
        .child(field(t, "First message template: {title} {body} {url} {source} {id} {labels}, and {branch} {folder} at start",
          Textarea.new(this.template).h(170).px(8).py(6).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).text_size(12).child(this.error)));
    return dialog(t, "q-settings", "Quest sources", body, h_flex().gap(8)
      .child(btn(t, "s-cancel", "Cancel", closeSelf))
      .child(btn(t, "s-save", "Save", (cx) => this.save(cx), { primary: true })));
  }
}

class Edit {
  constructor(cx) {
    this.id = props()?.id ?? null;
    this.status = "todo";
    this.error = "";
    this.asking = false;
    this.ready = !this.id;
    this.title = InputState.new({ placeholder: "What needs doing" });
    this.repo = InputState.new({ placeholder: "space name, repo folder name or path (optional)" });
    this.labels = InputState.new({ placeholder: "bug, ui (optional)" });
    this.due = InputState.new({ placeholder: "YYYY-MM-DD (optional)" });
    this.body = TextareaState.new({ rows: 12, placeholder: "Markdown: what, why, acceptance…" });
    if (this.id) {
      cx.spawn(async (cx) => {
        try {
          const tk = await store.readPlain(this.id);
          this.title.set_value(tk.title);
          this.repo.set_value(tk.repo);
          this.labels.set_value(tk.labels.join(", "));
          this.due.set_value(tk.due ?? "");
          this.body.set_value(tk.body);
          this.status = stage(tk);
          this.ready = true;
        } catch (e) { this.error = errorText(e); }
        cx.notify();
      });
    } else this.title.focus();
  }

  save(cx) {
    const title = this.title.value().trim();
    if (!title) { this.error = "Give it a title."; cx.notify(); return; }
    const t = {
      title, status: this.status, repo: this.repo.value().trim(), due: this.due.value().trim(),
      labels: this.labels.value().split(",").map((l) => l.trim()).filter(Boolean), body: this.body.value(),
    };
    cx.spawn(async (cx) => {
      try { await store.savePlain(this.id, t); bump("local"); closeSelf(); }
      catch (e) { this.error = errorText(e); cx.notify(); }
    });
  }

  remove(cx) {
    cx.spawn(async (cx) => {
      try { await store.deletePlain(this.id); bump("local"); closeSelf(); }
      catch (e) { this.error = errorText(e); cx.notify(); }
    });
  }

  render() {
    const t = theme();
    const seg = (value) => div().id(`e-${value}`).px(10).h(24).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(this.status === value ? t.selected : t.background).border(1).border_color(this.status === value ? t.solid : t.border)
      .text_color(this.status === value ? t.foreground : t.muted)
      .on_click((_e, cx) => { this.status = value; cx.notify(); }).child(value);
    const body = v_flex().gap(12)
      .child(field(t, "Title", styled(t, Input.new(this.title))))
      .child(field(t, "Status", h_flex().gap(6).child(seg("todo")).child(seg("doing")).child(seg("done"))))
      .child(field(t, "Repository hint", styled(t, Input.new(this.repo))))
      .child(h_flex().gap(10)
        .child(div().flex_1().child(field(t, "Labels", styled(t, Input.new(this.labels)))))
        .child(div().w(170).child(field(t, "Due", styled(t, Input.new(this.due))))))
      .child(field(t, "Description", Textarea.new(this.body).h(220).px(8).py(6).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).text_size(12).child(this.error)));
    const footer = h_flex().gap(8).flex_1().items_center()
      .when(Boolean(this.id) && !this.asking, (el) => el.child(btn(t, "e-del", "Delete", (cx) => { this.asking = true; cx.notify(); }, { danger: true, icon: "mods/docker/trash.svg" })))
      .when(this.asking, (el) => el.child(div().text_size(12).text_color(t.blocked).child("Delete this ticket file?"))
        .child(btn(t, "e-del-yes", "Delete", (cx) => this.remove(cx), { danger: true }))
        .child(btn(t, "e-del-no", "Keep", (cx) => { this.asking = false; cx.notify(); })))
      .child(div().flex_1())
      .child(btn(t, "e-cancel", "Cancel", closeSelf))
      .child(btn(t, "e-save", "Save", (cx) => this.save(cx), { primary: true, disabled: !this.ready }));
    return dialog(t, "q-edit", this.id ? "Edit local ticket" : "New local ticket", body, footer);
  }
}

// The quests layout's title bar: Back to elric and, where the system draws none, the window buttons.
class Bar {
  render() {
    const t = theme();
    const w = host();
    const win = (id, icon, cmd) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(() => run(cmd)).child(svg(icon).size(16));
    return h_flex().size_full().px(12).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(svg(ICON).size(15).flex_none().text_color(t.accent))
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Quests"))
      .child(div().text_size(11.5).text_color(t.dim).child("pick a ticket · start a branch and an agent"))
      .child(div().flex_1())
      .child(btn(t, "bar-back", "Back to Elric", () => run("layout.switch", { name: "elric" }), { icon: `${WC}/chevron-left.svg` }))
      .when(Boolean(w?.buttons), (el) => el
        .child(win("minimize", "mods/tabs-graph/win-min.svg", "window.minimize"))
        .child(win("maximize", `mods/tabs-graph/${w.maximized ? "win-restore" : "win-max"}.svg`, "window.maximize"))
        .child(win("close-window", "mods/tabs-graph/win-close.svg", "window.close")));
  }
}

export default class Quests extends View {
  init(_props, cx) {
    const view = props()?.view ?? "panel";
    this.screen = view === "bar" ? new Bar()
      : view === "start" ? new StartDialog(cx)
      : view === "settings" ? new Settings(cx)
      : view === "edit" ? new Edit(cx)
      : new Board(view === "page" ? "page" : "panel", cx);
  }

  render(cx) {
    return this.screen.render(cx);
  }
}
