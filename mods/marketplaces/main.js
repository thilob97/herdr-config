// Marketplaces: agent plugin marketplaces (Claude Code, omp, Copilot CLI) on every
// reachable machine. Lists each host's configured marketplaces, shows a
// marketplace's catalog as a matrix of plugins × machine/host, and installs,
// removes, enables or disables plugins at user scope; in Project mode, for one
// running agent's host and repository, at project scope. Changes only take
// effect when an agent restarts or reloads: the window says so, it never types
// into a running agent. Data is read on open and on Refresh; nothing polls.
// Opened as a window (mod.open, or openOverlay with props { agent: address }).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, panes, machines, theme, props, closeOverlay, notify, home } from "herdr";
import { HOSTS, hostInfo, probe, readHost, pluginAction, marketplaceAction, projectRoot, readProject, editProjectSettings, localIsWindows, errorText, npmFor, switchToMarketplace } from "./hosts.js";
import { loadCatalog } from "./catalog.js";

const CELL = 84;
const ROW = 62;
const MAX_ROWS = 120;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const ICON = (n) => `mods/git-graph/icons/${n}.svg`;

const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : null);
// Which plugin host an agent is: its own report (`app`), else its program.
function hostOf(a) {
  const k = `${a.app ?? ""} ${a.program?.key ?? ""}`.toLowerCase();
  if (k.includes("claude")) return "claude";
  if (/\bomp\b/.test(k)) return "omp";
  if (k.includes("copilot")) return "copilot";
  return null;
}
const programIcon = (p, size, color) => (!p?.icon ? null : p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).size(size).flex_none());
const agentLabel = (a) => [a.space_name, a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : null].filter(Boolean).join(" · ") || a.title || a.address;

export default class Marketplaces extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.busy = new Set();
    this.hints = new Set();
    this.gen = 0;
    this.projectToken = 0;
    this.agent = props()?.agent ?? null;
    this.mode = this.agent ? "project" : localStorage.getItem("mode") === "project" ? "project" : "user";
    this.selected = localStorage.getItem("selected");
    this.filter = InputState.new({ placeholder: "Filter plugins" });
    this.filter.on("change", (_e, cx) => cx.notify());
    this.addInput = InputState.new({ placeholder: "owner/repo or git URL" });
    this.addInput.on("submit", (_e, cx) => this.addMarketplace(cx));
    this.adding = null;
    this.confirm = null;
    this.project = null;
    this.refresh(cx);
  }

  // ---- data ---------------------------------------------------------------

  liveMachines() {
    const list = machines().filter((m) => m && m.name !== undefined);
    if (!list.some((m) => m.name == null)) list.unshift({ name: null, layout: "ready" });
    return list.sort((a, b) => (a.name == null ? -1 : b.name == null ? 1 : a.name.localeCompare(b.name)));
  }

  blank(m) {
    const local = m.name == null;
    return {
      name: m.name, key: m.name ?? "", label: m.name ?? "This PC", win: local && localIsWindows(), home: local ? home() : null,
      state: m.layout === "unavailable" ? "unreachable" : m.layout === "ready" ? "loading" : "waiting", hosts: {}, error: null,
    };
  }

  refresh(cx) {
    const gen = ++this.gen;
    this.machines = new Map(this.liveMachines().map((m) => [m.name ?? "", this.blank(m)]));
    this.catalogs = new Map();
    cx.spawn(async (cx) => {
      await Promise.all([...this.machines.values()].filter((M) => M.state === "loading").map((M) => this.probeMachine(cx, M)));
      if (gen !== this.gen) return;
      await Promise.all([this.loadCatalogs(cx), this.mode === "project" ? this.loadProject(cx) : null]);
    });
    cx.notify();
  }

  // A machine that came online (or went away) after the window opened.
  syncMachines(cx) {
    for (const m of this.liveMachines()) {
      const key = m.name ?? "";
      const M = this.machines.get(key);
      if (m.layout === "ready" && (!M || M.state === "waiting" || M.state === "unreachable")) {
        const fresh = this.blank(m);
        this.machines.set(key, fresh);
        const gen = this.gen;
        cx.spawn(async (cx) => {
          await this.probeMachine(cx, fresh);
          if (gen !== this.gen) return;
          await this.loadCatalogs(cx);
          if (this.mode === "project" && (this.project?.mkey ?? null) === key) await this.loadProject(cx);
        });
      } else if (m.layout === "unavailable" && M && M.state !== "unreachable" && M.state !== "loading") {
        M.state = "unreachable";
      } else if (!M) {
        this.machines.set(key, this.blank(m));
      }
    }
  }

  async probeMachine(cx, M) {
    M.state = "loading";
    try {
      const p = await probe(M);
      M.home = p.home;
      for (const h of HOSTS) {
        const b = p.bins[h.key];
        M.hosts[h.key] = { bin: b.path ?? null, missing: b.missing ?? null, loading: Boolean(b.path), error: null, marketplaces: [], installed: {}, npm: {} };
      }
      M.state = "ready";
    } catch (e) {
      M.state = "error";
      M.error = errorText(e);
      cx.notify();
      return;
    }
    cx.notify();
    await Promise.all(HOSTS.map((h) => (M.hosts[h.key].bin ? this.readHostInto(cx, M, h.key) : null)));
  }

  async readHostInto(cx, M, key) {
    const H = M.hosts[key];
    if (!H?.bin) return;
    H.loading = true;
    cx.notify();
    try {
      Object.assign(H, await readHost(M, key, H.bin), { error: null });
    } catch (e) {
      H.error = errorText(e);
    }
    H.loading = false;
    cx.notify();
  }

  readyMachines() {
    return [...this.machines.values()].filter((M) => M.state === "ready");
  }

  // Every marketplace any host has, with where it is configured.
  marketList() {
    const map = new Map();
    for (const M of this.readyMachines()) {
      for (const h of HOSTS) {
        for (const e of M.hosts[h.key]?.marketplaces ?? []) {
          const x = map.get(e.name) ?? { name: e.name, repo: null, source: null, where: [] };
          x.repo ??= e.repo;
          x.source ??= e.source || null;
          x.where.push({ M, key: h.key, e });
          map.set(e.name, x);
        }
      }
    }
    for (const x of map.values()) x.repo ??= this.catalogs.get(x.name)?.repo ?? null;
    return [...map.values()].sort((a, b) => b.where.length - a.where.length || a.name.localeCompare(b.name));
  }

  // Catalog sources: this computer's clones first, then other machines', then GitHub.
  sourcesFor(x) {
    return [...x.where]
      .sort((a, b) => (a.M.name == null ? 0 : 1) - (b.M.name == null ? 0 : 1))
      .map((w) => ({ m: w.M, host: hostInfo(w.key).short, clone: w.e.clone, catalogFile: w.e.catalogFile, repo: w.e.repo ?? x.repo, copilotBin: w.key === "copilot" ? w.M.hosts.copilot.bin : null }));
  }

  localContext() {
    return this.machines.get("") ?? { name: null, key: "", label: "This PC", win: localIsWindows(), home: home() };
  }

  async loadCatalogs(cx) {
    const gen = this.gen;
    await Promise.all(this.marketList().map(async (x) => {
      if (this.catalogs.has(x.name)) return;
      this.catalogs.set(x.name, { loading: true, plugins: [] });
      cx.notify();
      let cat;
      try { cat = await loadCatalog(x.name, this.sourcesFor(x), this.localContext()); } catch (e) { cat = { error: errorText(e), plugins: [] }; }
      if (gen !== this.gen) return;
      this.catalogs.set(x.name, cat);
      cx.notify();
    }));
  }

  // Running agents the window can work with, and the selected one's facts.
  agentChoices() {
    const cwds = new Map(panes().map((p) => [p.pane, p.cwd]));
    return agents().map((a) => ({ a, host: hostOf(a), mkey: machineOf(a.address) ?? "", cwd: cwds.get(a.pane) ?? null }));
  }

  async loadProject(cx, quiet = false) {
    const token = ++this.projectToken;
    const c = this.agentChoices().find((x) => x.a.address === this.agent);
    if (!c) {
      this.project = this.agent ? { error: "This agent isn't running any more.", state: {} } : null;
      cx.notify();
      return;
    }
    const prev = this.project?.address === c.a.address ? this.project : null;
    const P = { address: c.a.address, host: c.host, mkey: c.mkey, cwd: c.cwd, root: prev?.root ?? null, git: prev?.git ?? false, loading: true, error: null, state: quiet && prev ? prev.state : {} };
    this.project = P;
    cx.notify();
    const M = this.machines.get(c.mkey);
    const fail = (error) => { if (token === this.projectToken) { P.error = error; P.loading = false; cx.notify(); } };
    if (!c.host) return fail("Not a Claude Code, omp or Copilot CLI agent.");
    if (!M || M.state !== "ready") return fail(M?.state === "loading" || M?.state === "waiting" ? "Still reading this machine…" : `${c.mkey || "This PC"} isn't reachable.`);
    const H = M.hosts[c.host];
    if (!H?.bin) return fail(H?.missing ?? `${hostInfo(c.host).name} isn't installed on ${M.label}.`);
    if (!c.cwd) return fail("Herdr doesn't know this agent's folder.");
    try {
      const { root, git } = await projectRoot(M, c.cwd);
      if (token !== this.projectToken) return;
      P.root = root;
      P.git = git;
      cx.notify();
      const state = await readProject(M, c.host, H.bin, root);
      if (token !== this.projectToken) return;
      P.state = state;
      P.loading = false;
      cx.notify();
    } catch (e) {
      fail(errorText(e));
    }
  }

  selectAgent(cx, address) {
    this.agent = address;
    this.project = null;
    cx.spawn(async (cx) => this.loadProject(cx));
    cx.notify();
  }

  setMode(cx, mode) {
    this.mode = mode;
    localStorage.setItem("mode", mode);
    if (mode === "project") {
      if (!this.agent) this.agent = this.agentChoices().find((c) => c.host)?.a.address ?? null;
      cx.spawn(async (cx) => this.loadProject(cx));
    }
    cx.notify();
  }

  // ---- actions --------------------------------------------------------------

  // One change: a busy marker on its cell, the CLI's own error as a toast, a fresh
  // read of that host afterwards, and the restart hint for its running agents.
  act(cx, busyKey, label, M, hostKey, fn, { project = false } = {}) {
    if (this.busy.has(busyKey)) return;
    this.busy.add(busyKey);
    cx.notify();
    cx.spawn(async (cx) => {
      let ok = true;
      try {
        await fn();
      } catch (e) {
        ok = false;
        notify({ title: `${label} failed`, body: errorText(e).slice(0, 900), level: "error", timeout: 20000 });
      }
      await this.readHostInto(cx, M, hostKey);
      if (project) await this.loadProject(cx, true);
      if (ok) this.hints.add(`${M.key}|${hostKey}`);
      this.busy.delete(busyKey);
      await this.loadCatalogs(cx);
      cx.notify();
    });
  }

  ask(cx, title, detail, label, go) {
    this.confirm = { title, detail, label, go };
    this.handle.focus();
    cx.notify();
  }

  // A user-scope cell was clicked.
  userCell(cx, M, hostKey, id, mk, inst) {
    const H = M.hosts[hostKey];
    const name = hostInfo(hostKey).name;
    const busyKey = `${M.key}|${hostKey}|${id}|user`;
    if (inst) {
      this.ask(cx, `Uninstall ${id}?`, `Removes it from ${name} on ${M.label} (user scope).`, "Uninstall",
        (cx) => this.act(cx, busyKey, `Uninstalling ${id}`, M, hostKey, () => pluginAction(M, hostKey, H.bin, "uninstall", { id, scope: "user" }), { project: this.mode === "project" }));
      return;
    }
    const known = H.marketplaces.some((x) => x.name === mk.name);
    this.act(cx, busyKey, `Installing ${id}`, M, hostKey, () => pluginAction(M, hostKey, H.bin, "install", { id, scope: "user", cwd: M.home, known, repo: mk.repo }), { project: this.mode === "project" });
  }

  // omp has this plugin as a plain npm package: offer to swap it for the marketplace one.
  npmCell(cx, M, id, mk, pkg) {
    const H = M.hosts.omp;
    const v = H.npm[pkg]?.version;
    const known = H.marketplaces.some((x) => x.name === mk.name);
    this.ask(cx, `Switch ${pkg} to ${id}?`,
      `omp on ${M.label} has ${pkg}${v ? ` v${v}` : ""} from npm. This uninstalls the npm package and installs ${id} from the ${mk.name} marketplace, so it updates with the marketplace.`,
      "Switch",
      (cx) => this.act(cx, `${M.key}|omp|${id}|user`, `Switching ${pkg} to ${id}`, M, "omp",
        () => switchToMarketplace(M, H.bin, pkg, { id, scope: "user", cwd: M.home, known, repo: mk.repo }), { project: this.mode === "project" }));
  }

  userToggle(cx, M, hostKey, id, inst) {
    const H = M.hosts[hostKey];
    const op = inst.enabled ? "disable" : "enable";
    this.act(cx, `${M.key}|${hostKey}|${id}|user`, `${op === "enable" ? "Enabling" : "Disabling"} ${id}`, M, hostKey, () => pluginAction(M, hostKey, H.bin, op, { id, scope: "user", cwd: M.home }), { project: this.mode === "project" });
  }

  // A project-scope cell was clicked: install/enable, or remove.
  projectCell(cx, M, hostKey, id, mk, st) {
    const P = this.project;
    const H = M.hosts[hostKey];
    const busyKey = `${M.key}|${hostKey}|${id}|project`;
    const root = P.root;
    const known = H.marketplaces.some((x) => x.name === mk.name);
    const viaFile = hostKey === "copilot" || (hostKey === "claude" && st?.declared && !st.version);
    if (!st || st.status === "disabled") {
      const run = !st
        ? () => (hostKey === "copilot" ? editProjectSettings(M, root, id, mk.repo, true) : pluginAction(M, hostKey, H.bin, "install", { id, scope: "project", cwd: root, known, repo: mk.repo }))
        : () => (viaFile ? editProjectSettings(M, root, id, mk.repo, true) : pluginAction(M, hostKey, H.bin, "enable", { id, scope: st.scope ?? "project", cwd: root }));
      this.act(cx, busyKey, `Enabling ${id} in ${root}`, M, hostKey, run, { project: true });
      return;
    }
    const where = viaFile ? `${root}/.claude/settings.json` : `${hostInfo(hostKey).name}'s ${st.scope ?? "project"} scope in ${root}`;
    this.ask(cx, `Remove ${id} from this project?`, `Removes it from ${where}.${hostKey === "copilot" ? " Claude Code reads the same file." : ""}`, "Remove",
      (cx) => this.act(cx, busyKey, `Removing ${id}`, M, hostKey,
        () => (viaFile ? editProjectSettings(M, root, id, mk.repo, null) : pluginAction(M, hostKey, H.bin, "uninstall", { id, scope: st.scope ?? "project", cwd: root })), { project: true }));
  }

  projectToggle(cx, M, hostKey, id, mk, st) {
    const H = M.hosts[hostKey];
    const root = this.project.root;
    const on = st.status !== "enabled";
    const viaFile = hostKey === "copilot" || (hostKey === "claude" && st.declared && !st.version);
    this.act(cx, `${M.key}|${hostKey}|${id}|project`, `${on ? "Enabling" : "Disabling"} ${id}`, M, hostKey,
      () => (viaFile ? editProjectSettings(M, root, id, mk.repo, on) : pluginAction(M, hostKey, H.bin, on ? "enable" : "disable", { id, scope: st.scope ?? "project", cwd: root })), { project: true });
  }

  // Every reachable machine × installed host, for adding a marketplace.
  targets() {
    return this.readyMachines().flatMap((M) => HOSTS.filter((h) => M.hosts[h.key]?.bin).map((h) => ({ id: `${M.key}|${h.key}`, M, key: h.key })));
  }

  openAdd(cx) {
    this.adding = { targets: new Set(this.targets().map((x) => x.id)), busy: false, error: null };
    this.addInput.focus();
    cx.notify();
  }

  addMarketplace(cx) {
    const A = this.adding;
    if (!A || A.busy) return;
    const source = this.addInput.value().trim().replace(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?\/?$/, "$1");
    if (!source || /\s/.test(source)) { A.error = "Enter a GitHub owner/repo or a git URL."; cx.notify(); return; }
    const targets = this.targets().filter((x) => A.targets.has(x.id));
    if (!targets.length) { A.error = "Pick at least one host."; cx.notify(); return; }
    A.busy = true;
    A.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const before = new Set(this.marketList().map((x) => x.name));
      const failures = [];
      // One machine's hosts one after another (they may share git credentials prompts); machines in parallel.
      const byMachine = new Map();
      for (const t of targets) byMachine.set(t.M.key, [...(byMachine.get(t.M.key) ?? []), t]);
      await Promise.all([...byMachine.values()].map(async (list) => {
        for (const { M, key } of list) {
          try {
            await marketplaceAction(M, key, M.hosts[key].bin, "add", { source });
            this.hints.add(`${M.key}|${key}`);
          } catch (e) {
            failures.push(`${hostInfo(key).name} on ${M.label}: ${errorText(e)}`);
          }
          await this.readHostInto(cx, M, key);
        }
      }));
      const added = this.marketList().find((x) => !before.has(x.name));
      if (added) this.select(added.name);
      if (failures.length) notify({ title: "Adding the marketplace failed", body: failures.join("\n\n").slice(0, 1200), level: "error", timeout: 20000 });
      if (failures.length < targets.length) {
        this.adding = null;
        this.addInput.set_value("");
      } else {
        A.busy = false;
        A.error = failures[0];
      }
      await this.loadCatalogs(cx);
      cx.notify();
    });
  }

  addTo(cx, M, key, mk) {
    const source = mk.repo ?? mk.source;
    this.act(cx, `mk|${M.key}|${key}|${mk.name}`, `Adding ${mk.name} to ${hostInfo(key).name} on ${M.label}`, M, key, () => marketplaceAction(M, key, M.hosts[key].bin, "add", { source }));
  }

  removeFrom(cx, M, key, mk) {
    const H = M.hosts[key];
    const plugins = Object.keys(H.installed).filter((id) => id.endsWith(`@${mk.name}`));
    const n = plugins.length;
    const detail = key === "copilot" && n ? `Copilot CLI also uninstalls its ${n} installed plugin${n > 1 ? "s" : ""} (${plugins.join(", ")}).`
      : key === "omp" ? "omp keeps plugins already installed from it."
      : n ? `${n} plugin${n > 1 ? "s" : ""} from it ${n > 1 ? "are" : "is"} installed in Claude Code here.` : "";
    this.ask(cx, `Remove ${mk.name} from ${hostInfo(key).name} on ${M.label}?`, detail, "Remove",
      (cx) => this.act(cx, `mk|${M.key}|${key}|${mk.name}`, `Removing ${mk.name}`, M, key, () => marketplaceAction(M, key, H.bin, "remove", { name: mk.name, force: key === "copilot" && n > 0 })));
  }

  updateMarket(cx, mk) {
    const key = `update|${mk.name}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    cx.notify();
    cx.spawn(async (cx) => {
      const failures = [];
      await Promise.all(mk.where.map(async (w) => {
        try { await marketplaceAction(w.M, w.key, w.M.hosts[w.key].bin, "update", { name: mk.name }); } catch (e) { failures.push(`${hostInfo(w.key).name} on ${w.M.label}: ${errorText(e)}`); }
        await this.readHostInto(cx, w.M, w.key);
      }));
      if (failures.length) notify({ title: `Updating ${mk.name} failed`, body: failures.join("\n\n").slice(0, 1200), level: "error", timeout: 20000 });
      this.catalogs.delete(mk.name);
      this.busy.delete(key);
      await this.loadCatalogs(cx);
      cx.notify();
    });
  }

  select(name) {
    this.selected = name;
    localStorage.setItem("selected", name);
  }

  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  // ---- view -----------------------------------------------------------------

  render(cx) {
    const t = theme();
    this.syncMachines(cx);
    const markets = this.marketList();
    // A remembered marketplace may not be read yet: show the first meanwhile, keep the choice.
    const mk = markets.find((x) => x.name === this.selected) ?? markets[0] ?? null;
    this.current = mk?.name ?? null;
    const loading = [...this.machines.values()].some((M) => M.state === "loading" || Object.values(M.hosts).some((H) => H.loading));
    return v_flex()
      .id("mk-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.confirm) this.confirm = null;
        else if (this.adding) this.adding = null;
        else this.close();
        cx.stop_propagation();
        cx.notify();
      })
      .relative()
      .size_full()
      .min_h(0)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(12.5)
      .child(this.titleBar(t, loading))
      .child(this.marketStrip(t, markets))
      .when(Boolean(this.adding), (el) => el.child(this.addPanel(t)))
      .when(Boolean(mk), (el) => el.child(this.marketBar(t, mk)))
      .children(this.hintRows(t))
      .when(this.mode === "project", (el) => el.child(this.agentBar(t)))
      .child(mk ? this.matrix(t, mk) : this.empty(t, loading))
      .when(Boolean(this.confirm), (el) => el.child(this.confirmLayer(t)));
  }

  // Controls stop the press so it doesn't drag the window.
  control(id) {
    return div().id(id).cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  }

  button(t, id, label, onClick, { icon, primary, danger, disabled, tip } = {}) {
    const fg = primary ? t.solid_foreground : danger ? t.blocked : t.foreground;
    return this.control(id).flex().flex_none().items_center().gap(6).h(26).px(10).rounded(7).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(fg).text_size(12)
      .when(Boolean(disabled), (el) => el.opacity(0.5))
      .when(!disabled, (el) => el.hover((s) => s.opacity(0.88)).on_click(onClick))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .when(Boolean(icon), (el) => el.child(svg(icon).size(13).flex_none()))
      .when(Boolean(label), (el) => el.child(label));
  }

  spinner(t, size = 12) {
    return svg(SPINNER).size(size).flex_none().text_color(t.dim).spin(900);
  }

  titleBar(t, loading) {
    const seg = (mode, label) => this.control(`mode-${mode}`).h(24).px(10).flex().items_center().rounded(6).text_size(12)
      .bg(this.mode === mode ? t.selected : t.raised + "00").text_color(this.mode === mode ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.setMode(cx, mode)).child(label);
    const off = [...this.machines.values()].filter((M) => M.state === "unreachable" || M.state === "error");
    return h_flex().flex_none().h(44).px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/workspace-chrome/layers.svg").size(16).flex_none().text_color(t.accent))
      .child(div().text_size(14).font_semibold().child("Marketplaces"))
      .child(h_flex().p(2).gap(2).rounded(8).bg(t.background).border_1().border_color(t.border)
        .child(seg("user", "User scope"))
        .child(seg("project", "Project")))
      .child(div().flex_1())
      .when(off.length > 0, (el) => el.child(div().id("mk-off").text_size(11).text_color(t.dim)
        .tooltip(off.map((M) => `${M.label}: ${M.error ?? "unreachable"}`).join("\n"))
        .child(`${off.map((M) => M.label).join(", ")} unreachable`)))
      .when(loading, (el) => el.child(this.spinner(t)))
      .child(this.button(t, "mk-refresh", null, (_e, cx) => this.refresh(cx), { icon: ICON("refresh"), tip: "Read everything again" }))
      .child(this.control("mk-close").p(4).rounded(6).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => this.close()).child(svg("mods/workspace-chrome/x.svg").size(14)));
  }

  marketStrip(t, markets) {
    return h_flex().id("mk-strip").flex_none().flex_wrap().px(12).py(7).gap(6).items_center().border_b(1).border_color(t.border)
      .children(markets.map((x) => {
        const on = x.name === this.current;
        const cat = this.catalogs.get(x.name);
        return this.control(`mk-tab-${x.name}`).flex().flex_none().items_center().gap(6).h(26).px(10).rounded(7).border_1()
          .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.background)
          .hover((s) => s.border_color(t.input))
          .tooltip(`${x.repo ?? x.source ?? x.name}\nConfigured in ${x.where.length} host${x.where.length > 1 ? "s" : ""}`)
          .on_click((_e, cx) => { this.select(x.name); cx.notify(); })
          .child(div().font_medium().child(x.name))
          .child(div().text_size(10.5).text_color(t.dim).child(cat?.plugins?.length ? String(cat.plugins.length) : ""))
          .child(h_flex().gap(2).children(HOSTS.filter((h) => x.where.some((w) => w.key === h.key)).map((h) => svg(h.icon).size(10).flex_none().text_color(t.muted))));
      }))
      .child(this.control("mk-add").flex().flex_none().items_center().gap(5).h(26).px(10).rounded(7).border_1().border_color(t.border)
        .text_color(t.muted).hover((s) => s.text_color(t.foreground).border_color(t.input))
        .on_click((_e, cx) => (this.adding ? ((this.adding = null), cx.notify()) : this.openAdd(cx)))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).child("Add"));
  }

  addPanel(t) {
    const A = this.adding;
    const targets = this.targets();
    return v_flex().flex_none().px(14).py(10).gap(8).bg(t.surface).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(12).text_color(t.muted).child("Add marketplace"))
        .child(h_flex().flex_1().h(28).px(8).rounded(7).bg(t.background).border_1().border_color(t.accent).items_center()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.addInput).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
        .child(A.busy ? h_flex().gap(6).items_center().child(this.spinner(t)).child(div().text_color(t.dim).child("Adding…"))
          : this.button(t, "mk-add-go", "Add", (_e, cx) => this.addMarketplace(cx), { primary: true }))
        .child(this.button(t, "mk-add-cancel", "Cancel", (_e, cx) => { this.adding = null; cx.notify(); })))
      .child(h_flex().flex_wrap().gap(6).items_center()
        .child(div().text_size(11).text_color(t.dim).child("to"))
        .children(targets.map((x) => {
          const on = A.targets.has(x.id);
          return this.control(`mk-tg-${x.id}`).flex().items_center().gap(6).h(24).px(8).rounded(6).border_1()
            .border_color(on ? t.accent : t.border).text_color(on ? t.foreground : t.dim).text_size(11.5)
            .on_click((_e, cx) => { on ? A.targets.delete(x.id) : A.targets.add(x.id); cx.notify(); })
            .child(div().size(12).rounded(3).border_1().border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent)))
            .child(svg(hostInfo(x.key).icon).size(12).flex_none())
            .child(`${hostInfo(x.key).short} · ${x.M.label}`);
        })))
      .when(Boolean(A.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(A.error)));
  }

  marketBar(t, mk) {
    const cat = this.catalogs.get(mk.name);
    const chips = this.readyMachines().flatMap((M) => HOSTS.filter((h) => M.hosts[h.key]?.bin).map((h) => {
      const has = mk.where.some((w) => w.M === M && w.key === h.key);
      const busy = this.busy.has(`mk|${M.key}|${h.key}|${mk.name}`);
      const src = mk.repo ?? mk.source;
      return this.control(`mk-host-${M.key}-${h.key}`).flex().flex_none().items_center().gap(5).h(22).px(7).rounded(6).border_1()
        .border_color(has ? t.ansi2 + "88" : t.border).bg(has ? t.ansi2 + "18" : t.background + "00")
        .text_size(11).text_color(has ? t.foreground : t.dim)
        .hover((s) => s.border_color(has ? t.blocked : t.input))
        .tooltip(has ? `Configured in ${h.name} on ${M.label}. Click to remove.` : src ? `Not in ${h.name} on ${M.label}. Click to add ${src}.` : "Source unknown")
        .on_click((_e, cx) => (busy ? null : has ? this.removeFrom(cx, M, h.key, mk) : src ? this.addTo(cx, M, h.key, mk) : null))
        .child(busy ? this.spinner(t, 11) : svg(h.icon).size(11).flex_none())
        .child(`${h.short} · ${M.label}`)
        .child(div().text_color(has ? t.ansi2 : t.dim).child(has ? "✓" : "+"));
    }));
    const updating = this.busy.has(`update|${mk.name}`);
    return v_flex().flex_none().px(14).pt(10).pb(8).gap(7).border_b(1).border_color(t.border)
      .child(h_flex().gap(10).items_center()
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().gap(8).items_center().min_w(0)
            .child(div().text_size(13.5).font_semibold().child(mk.name))
            .child(div().truncate().text_size(11.5).text_color(t.muted).child(mk.repo ?? mk.source ?? "")))
          .child(div().truncate().text_size(11).text_color(t.dim)
            .child(cat?.loading ? "Reading catalog…" : cat?.error ? "Catalog not readable" : [cat?.description, cat?.from ? `catalog from ${cat.from}` : null].filter(Boolean).join(" · "))))
        .child(h_flex().w(180).flex_none().h(26).px(8).gap(6).rounded(7).bg(t.background).border_1().border_color(t.input).items_center()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(svg("mods/workspace-chrome/search.svg").size(12).flex_none().text_color(t.dim))
          .child(Input.new(this.filter).flex_1().h_full().text_size(12).text_color(t.foreground)))
        .child(this.button(t, "mk-update", updating ? "Updating…" : "Update", (_e, cx) => this.updateMarket(cx, mk),
          { icon: ICON("fetch"), disabled: updating || !mk.where.length, tip: "Re-fetch this catalog in every host that has it" })))
      .child(h_flex().flex_wrap().gap(5).items_center().children(chips));
  }

  hintRows(t) {
    const live = agents();
    return [...this.hints].flatMap((key) => {
      const [mkey, hostKey] = key.split("|");
      const running = live.filter((a) => hostOf(a) === hostKey && (machineOf(a.address) ?? "") === mkey);
      if (!running.length) return [];
      const where = mkey || "This PC";
      const names = running.map(agentLabel).slice(0, 4).join(", ") + (running.length > 4 ? ` +${running.length - 4}` : "");
      return [h_flex().id(`hint-${key}`).flex_none().mx(14).mt(8).px(10).py(6).gap(8).items_center().rounded(7)
        .bg(t.working + "1c").border_1().border_color(t.working + "66").text_size(11.5)
        .child(div().text_color(t.working).child("↻"))
        .child(div().flex_1().min_w(0).truncate()
          .child(`Active after restarting/reloading ${hostInfo(hostKey).name} on ${where} — running: ${names}`))
        .child(this.control(`hint-x-${key}`).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.hints.delete(key); cx.notify(); }).child("×"))];
    });
  }

  agentBar(t) {
    const choices = this.agentChoices();
    const P = this.project;
    const sel = choices.find((c) => c.a.address === this.agent);
    const info = !sel ? (choices.length ? "Pick an agent: its host and repository get project-scope plugins." : "No agents running.")
      : P?.error ? P.error
      : [`${hostInfo(sel.host)?.name ?? "?"} on ${sel.mkey || "This PC"}`, P?.root ? `${P.root}${P.git ? "" : " (no git repo: its folder)"}` : sel.cwd ?? ""].filter(Boolean).join(" · ");
    const note = sel?.host === "copilot" ? "Copilot CLI has no project scope flag: this edits .claude/settings.json (read by Claude Code too)."
      : sel?.host === "claude" ? "claude plugin … --scope project (writes .claude/settings.json)" : sel?.host === "omp" ? "omp plugin … --scope=project (.omp/plugins)" : null;
    return v_flex().flex_none().px(14).py(8).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().id("mk-agents").flex_wrap().gap(6).children(choices.map((c) => {
        const on = c.a.address === this.agent;
        const pic = programIcon(c.a.program, 13, t.foreground);
        return this.control(`mk-ag-${c.a.address}`).flex().flex_none().items_center().gap(6).h(26).px(9).rounded(7).border_1()
          .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.background)
          .when(!c.host, (el) => el.opacity(0.5))
          .tooltip(`${c.a.program?.name ?? c.a.app ?? "agent"} · ${c.a.address}\n${c.cwd ?? ""}`)
          .on_click((_e, cx) => this.selectAgent(cx, c.a.address))
          .when(Boolean(pic), (el) => el.child(pic))
          .child(div().max_w(180).truncate().child(agentLabel(c.a)))
          .when(Boolean(c.mkey), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(c.mkey)));
      })))
      .child(h_flex().gap(8).items_center().text_size(11.5)
        .when(Boolean(P?.loading), (el) => el.child(this.spinner(t, 11)))
        .child(div().flex_1().min_w(0).truncate().text_color(P?.error ? t.blocked : t.muted).child(info))
        .when(Boolean(note), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(note))));
  }

  columns() {
    if (this.mode === "project") {
      const P = this.project;
      const M = P && this.machines.get(P.mkey);
      if (!P?.host || !M || M.state !== "ready" || !M.hosts[P.host]?.bin || (!P.root && !P.loading)) return [];
      return [{ M, h: hostInfo(P.host), scope: "project" }, { M, h: hostInfo(P.host), scope: "user" }];
    }
    return this.readyMachines().flatMap((M) => HOSTS.map((h) => ({ M, h, scope: "user" })));
  }

  // The catalog's plugins, plus ones some host still has installed that it no longer lists.
  plugins(mk) {
    const cat = this.catalogs.get(mk.name);
    const list = [...(cat?.plugins ?? [])];
    const names = new Set(list.map((p) => p.name));
    const extra = new Set();
    for (const M of this.readyMachines()) for (const h of HOSTS) for (const id of Object.keys(M.hosts[h.key]?.installed ?? {})) if (id.endsWith(`@${mk.name}`)) extra.add(id.slice(0, -mk.name.length - 1));
    for (const id of Object.keys(this.mode === "project" ? this.project?.state ?? {} : {})) if (id.endsWith(`@${mk.name}`)) extra.add(id.slice(0, -mk.name.length - 1));
    for (const name of extra) if (!names.has(name)) list.push({ name, description: cat?.loading ? "" : "Installed, but not in this catalog", version: null, category: null, keywords: [], counts: null, orphan: true });
    const q = this.filter.value().trim().toLowerCase();
    return q ? list.filter((p) => `${p.name} ${p.description} ${p.category ?? ""} ${p.keywords.join(" ")}`.toLowerCase().includes(q)) : list;
  }

  matrix(t, mk) {
    const cols = this.columns();
    const list = this.plugins(mk);
    const cat = this.catalogs.get(mk.name);
    const groups = [];
    for (const c of cols) {
      const label = this.mode === "project" ? (c.scope === "project" ? "Project" : "User") : c.M.label;
      if (this.mode === "user" && groups.at(-1)?.M === c.M) groups.at(-1).n++;
      else groups.push({ M: c.M, label, n: 1 });
    }
    const header = h_flex().flex_none().h(46).px(12).items_end().pb(6).gap(0).border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
      .child(div().flex_1().min_w(0).child(`${list.length} plugin${list.length === 1 ? "" : "s"}`))
      .children(this.mode === "user"
        ? groups.map((g) => v_flex().w(CELL * g.n).flex_none().gap(4)
          .child(div().mx(4).pb(2).border_b(1).border_color(t.border).text_color(t.muted).font_medium().text_center().child(g.label))
          .child(h_flex().children(HOSTS.map((h) => {
            const H = g.M.hosts[h.key];
            return h_flex().id(`mk-col-${g.M.key}-${h.key}`).w(CELL).flex_none().gap(4).items_center().justify_center()
              .text_color(H?.bin ? t.muted : t.dim + "88").tooltip(H?.bin ? `${h.name}: ${H.bin}` : H?.missing ?? h.name)
              .child(svg(h.icon).size(11).flex_none()).child(h.short);
          }))))
        : cols.map((c) => h_flex().id(`mk-col-${c.scope}`).w(CELL).flex_none().gap(4).items_center().justify_center().text_color(t.muted)
          .tooltip(c.scope === "project" ? `${c.h.name} project scope` : `${c.h.name} user scope on ${c.M.label}`)
          .child(svg(c.h.icon).size(11).flex_none()).child(c.scope === "project" ? "Project" : "User")));
    const shown = list.slice(0, MAX_ROWS);
    const note = cat?.loading && !list.length ? "Reading catalog…"
      : cat?.error && !list.length ? `Catalog not readable: ${cat.error}`
      : !list.length ? (this.filter.value().trim() ? "No plugin matches." : "No plugins.")
      : !cols.length ? (this.mode === "project" ? null : "No reachable machine with a plugin host.") : null;
    // Rows carry their own click targets, which a virtual list's renderer can't register:
    // a plain scroll area, at most MAX_ROWS rows (the filter narrows bigger catalogs).
    return v_flex().flex_1().min_h(0)
      .child(header)
      .child(v_flex().id("mk-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .when(Boolean(note), (el) => el.child(div().px(14).pt(10).text_size(12).text_color(cat?.error ? t.blocked : t.dim).child(note)))
        .children(shown.map((p) => this.row(t, p, mk, cols)))
        .when(list.length > shown.length, (el) => el.child(div().px(14).py(10).text_size(11.5).text_color(t.dim)
          .child(`Showing ${shown.length} of ${list.length}: type in the filter to find the others.`))));
  }

  row(t, p, mk, cols) {
    const c = p.counts;
    const counts = c ? [c.skills && `${c.skills} skill${c.skills > 1 ? "s" : ""}`, c.commands && `${c.commands} command${c.commands > 1 ? "s" : ""}`, c.agents && `${c.agents} agent${c.agents > 1 ? "s" : ""}`].filter(Boolean) : [];
    const meta = [...counts, p.external ? `source: ${p.external}` : null, ...p.keywords.slice(0, 6).map((k) => `#${k}`)].filter(Boolean).join(" · ");
    return h_flex().id(`mk-row-${p.name}`).flex_none().h(ROW).px(12).items_center().border_b(1).border_color(t.border + "88").hover((s) => s.bg(t.hover + "66"))
      .child(v_flex().flex_1().min_w(0).gap(2).pr(8)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().flex_none().font_semibold().text_color(p.orphan ? t.muted : t.foreground).child(p.name))
          .when(Boolean(p.version), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`v${p.version}`)))
          .when(Boolean(p.category), (el) => el.child(div().flex_none().px(5).h(15).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).flex().items_center().child(p.category))))
        .child(div().id(`mk-desc-${p.name}`).truncate().text_size(11.5).text_color(p.orphan ? t.dim : t.muted).when(Boolean(p.description), (el) => el.tooltip(p.description)).child(p.description || " "))
        .child(div().truncate().text_size(10.5).text_color(t.dim).child(meta || " ")))
      .children(cols.map((col) => this.cell(t, col, p, mk)));
  }

  cell(t, col, p, mk) {
    const { M, h, scope } = col;
    const H = M.hosts[h.key];
    const id = `${p.name}@${mk.name}`;
    const cid = `${scope}-${M.key}-${h.key}-${p.name}`;
    const box = div().w(CELL).h_full().flex_none().flex().items_center().justify_center();
    if (!H?.bin) return box.child(div().id(`mk-c-${cid}`).text_color(t.dim + "88").tooltip(H?.missing ?? `${h.name} not available`).child("—"));
    if (H.error) return box.child(div().id(`mk-c-${cid}`).text_color(t.blocked).tooltip(`${h.name} on ${M.label}: ${H.error}`).child("!"));
    const P = this.project;
    const busy = this.busy.has(`${M.key}|${h.key}|${id}|${scope}`);
    if (busy || H.loading || (scope === "project" && (P?.loading && !P.state?.[id]))) return box.child(this.spinner(t));
    if (scope === "project" && (!P?.root || P.error)) return box.child(div().text_color(t.dim).child("·"));
    const inst = scope === "user" ? H.installed[id] : null;
    const st = scope === "project" ? P.state[id] : inst ? { status: inst.enabled ? "enabled" : "disabled", version: inst.version } : null;
    const known = H.marketplaces.some((x) => x.name === mk.name);
    const where = scope === "project" ? `${h.name}, project ${P.root}` : `${h.name} on ${M.label}`;
    if (!st && scope === "user" && h.key === "omp") {
      const pkg = npmFor(H.npm, p.name);
      if (pkg) {
        const n = H.npm[pkg];
        const color = n.enabled ? t.working : t.dim;
        return box.child(this.control(`mk-c-${cid}`).h(22).px(8).flex().items_center().rounded(11).border_1()
          .border_color(color + "aa").bg(color + "1a").text_size(11).text_color(n.enabled ? t.foreground : t.dim)
          .tooltip(`Installed in omp on ${M.label} as npm package ${pkg}${n.version ? ` v${n.version}` : ""}${n.enabled ? "" : " (disabled)"}, not from ${mk.name}. Click to switch to the marketplace version.`)
          .hover((s) => s.border_color(t.accent))
          .on_click((_e, cx) => this.npmCell(cx, M, id, mk, pkg))
          .child(n.version ? `npm ${n.version}` : "npm"));
      }
    }
    if (!st) {
      const can = known || Boolean(mk.repo);
      if (p.orphan) return box.child(div().text_color(t.dim + "88").child("·"));
      return box.child(this.control(`mk-c-${cid}`).h(22).px(8).flex().items_center().rounded(11).border_1().border_color(t.border).text_size(11)
        .text_color(t.dim).when(!can, (el) => el.opacity(0.4))
        .tooltip(!can ? `${h.name} on ${M.label} doesn't have ${mk.name} and its source is unknown` : `${scope === "project" ? "Enable" : "Install"} in ${where}${known ? "" : ` (adds ${mk.repo} first)`}`)
        .when(can, (el) => el.hover((s) => s.border_color(t.accent).text_color(t.foreground))
          .on_click((_e, cx) => (scope === "project" ? this.projectCell(cx, M, h.key, id, mk, null) : this.userCell(cx, M, h.key, id, mk, null))))
        .child(scope === "project" ? "Enable" : known ? "Install" : "+ Install"));
    }
    const on = st.status === "enabled";
    const color = on ? t.ansi2 : t.dim;
    const label = scope === "project" && st.scope === "local" ? "local" : st.version ? `v${st.version}` : on ? "on" : "off";
    const tip = `${on ? "Enabled" : "Disabled"} in ${where}${st.version ? ` · v${st.version}` : ""}${st.declared && !st.version ? " (declared in .claude/settings.json)" : ""}. Click to ${scope === "project" ? "remove" : "uninstall"}.`;
    return box.child(h_flex().h(22).rounded(11).border_1().border_color(color + (on ? "aa" : "66")).bg(color + (on ? "1e" : "0c")).items_center().overflow_hidden()
      .child(this.control(`mk-c-${cid}`).h_full().pl(8).pr(4).flex().items_center().text_size(11).text_color(on ? t.foreground : t.dim)
        .tooltip(tip).hover((s) => s.text_color(t.blocked))
        .on_click((_e, cx) => (scope === "project" ? this.projectCell(cx, M, h.key, id, mk, st) : this.userCell(cx, M, h.key, id, mk, inst)))
        .child(label))
      .child(this.control(`mk-t-${cid}`).h_full().pl(2).pr(7).flex().items_center()
        .tooltip(on ? "Disable" : "Enable")
        .on_click((_e, cx) => (scope === "project" ? this.projectToggle(cx, M, h.key, id, mk, st) : this.userToggle(cx, M, h.key, id, inst)))
        .child(div().size(8).rounded(4).border_1().border_color(color).when(on, (el) => el.bg(color)))));
  }

  empty(t, loading) {
    return v_flex().flex_1().items_center().justify_center().gap(8).text_color(t.dim)
      .when(loading, (el) => el.child(this.spinner(t, 16)).child("Reading hosts…"))
      .when(!loading, (el) => el.child("No marketplace configured in any host yet.").child(this.button(t, "mk-empty-add", "Add marketplace", (_e, cx) => this.openAdd(cx), { primary: true })));
  }

  confirmLayer(t) {
    const C = this.confirm;
    const done = (cx) => { this.confirm = null; cx.notify(); };
    return div().id("mk-confirm").absolute().inset_0().bg(t.background + "b0").flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(v_flex().w(420).p(18).gap(10).rounded(10).bg(t.popover).border_1().border_color(t.input).shadow_lg()
        .child(div().text_size(14.5).font_semibold().child(C.title))
        .when(Boolean(C.detail), (el) => el.child(div().text_size(12).text_color(t.muted).child(C.detail)))
        .child(h_flex().pt(6).gap(8).justify_end()
          .child(this.button(t, "mk-no", "Cancel", (_e, cx) => done(cx)))
          .child(this.control("mk-yes").flex().items_center().h(26).px(12).rounded(7).bg(t.blocked).text_color(t.background).text_size(12).font_medium()
            .hover((s) => s.opacity(0.88))
            .on_click((_e, cx) => { const go = C.go; this.confirm = null; go(cx); cx.notify(); })
            .child(C.label))));
  }
}
