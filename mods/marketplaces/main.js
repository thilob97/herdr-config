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
const HERE = "Dieser Computer";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4, GAP_S = 6, GAP_M = 8, GAP_L = 12, GAP_XL = 16;
const INSET_PANEL = 14;
const H_HEADER = 42, H_BTN = 26, H_BTN_S = 22, H_INPUT = 30, H_CHIP = 18;
const T_XS = 10.5, T_S = 11, T_M = 12, T_L = 13, T_XL = 15;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Theme colour + alpha suffix (5.4); a theme colour that is already translucent stays as it is.
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + a : c);

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
    this.filter = InputState.new({ placeholder: "Plugins filtern …" });
    this.filter.on("change", (_e, cx) => cx.notify());
    this.addInput = InputState.new({ placeholder: "owner/repo oder Git-URL" });
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
      name: m.name, key: m.name ?? "", label: m.name ?? HERE, win: local && localIsWindows(), home: local ? home() : null,
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
    return this.machines.get("") ?? { name: null, key: "", label: HERE, win: localIsWindows(), home: home() };
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
    if (!c.host) return fail("Kein Agent von Claude Code, omp oder Copilot CLI.");
    if (!M || M.state !== "ready") return fail(M?.state === "loading" || M?.state === "waiting" ? "Diese Maschine wird noch gelesen …" : `${c.mkey || HERE} ist nicht erreichbar.`);
    const H = M.hosts[c.host];
    if (!H?.bin) return fail(H?.missing ?? `${hostInfo(c.host).name} ist auf ${M.label} nicht installiert.`);
    if (!c.cwd) return fail("Herdr kennt den Ordner dieses Agents nicht.");
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
        notify({ title: `${label} fehlgeschlagen`, body: errorText(e).slice(0, 900), level: "error", timeout: 20000 });
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
      this.ask(cx, `${id} deinstallieren?`, `Entfernt es aus ${name} auf ${M.label} (Benutzer-Scope).`, "Deinstallieren",
        (cx) => this.act(cx, busyKey, `${id} deinstallieren`, M, hostKey, () => pluginAction(M, hostKey, H.bin, "uninstall", { id, scope: "user" }), { project: this.mode === "project" }));
      return;
    }
    const known = H.marketplaces.some((x) => x.name === mk.name);
    this.act(cx, busyKey, `${id} installieren`, M, hostKey, () => pluginAction(M, hostKey, H.bin, "install", { id, scope: "user", cwd: M.home, known, repo: mk.repo }), { project: this.mode === "project" });
  }

  // omp has this plugin as a plain npm package: offer to swap it for the marketplace one.
  npmCell(cx, M, id, mk, pkg) {
    const H = M.hosts.omp;
    const v = H.npm[pkg]?.version;
    const known = H.marketplaces.some((x) => x.name === mk.name);
    this.ask(cx, `${pkg} auf ${id} umstellen?`,
      `omp auf ${M.label} hat ${pkg}${v ? ` v${v}` : ""} aus npm. Das deinstalliert das npm-Paket und installiert ${id} aus dem Marketplace ${mk.name}, damit es mit dem Marketplace aktualisiert wird.`,
      "Umstellen",
      (cx) => this.act(cx, `${M.key}|omp|${id}|user`, `${pkg} auf ${id} umstellen`, M, "omp",
        () => switchToMarketplace(M, H.bin, pkg, { id, scope: "user", cwd: M.home, known, repo: mk.repo }), { project: this.mode === "project" }));
  }

  userToggle(cx, M, hostKey, id, inst) {
    const H = M.hosts[hostKey];
    const op = inst.enabled ? "disable" : "enable";
    this.act(cx, `${M.key}|${hostKey}|${id}|user`, `${id} ${op === "enable" ? "einschalten" : "ausschalten"}`, M, hostKey, () => pluginAction(M, hostKey, H.bin, op, { id, scope: "user", cwd: M.home }), { project: this.mode === "project" });
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
      this.act(cx, busyKey, `${id} in ${root} einschalten`, M, hostKey, run, { project: true });
      return;
    }
    const where = viaFile ? `${root}/.claude/settings.json` : `${hostInfo(hostKey).name}, Scope ${st.scope ?? "project"} in ${root}`;
    this.ask(cx, `${id} aus diesem Projekt entfernen?`, `Entfernt es aus ${where}.${hostKey === "copilot" ? " Claude Code liest dieselbe Datei." : ""}`, "Entfernen",
      (cx) => this.act(cx, busyKey, `${id} entfernen`, M, hostKey,
        () => (viaFile ? editProjectSettings(M, root, id, mk.repo, null) : pluginAction(M, hostKey, H.bin, "uninstall", { id, scope: st.scope ?? "project", cwd: root })), { project: true }));
  }

  projectToggle(cx, M, hostKey, id, mk, st) {
    const H = M.hosts[hostKey];
    const root = this.project.root;
    const on = st.status !== "enabled";
    const viaFile = hostKey === "copilot" || (hostKey === "claude" && st.declared && !st.version);
    this.act(cx, `${M.key}|${hostKey}|${id}|project`, `${id} ${on ? "einschalten" : "ausschalten"}`, M, hostKey,
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
    if (!source || /\s/.test(source)) { A.error = "Gib ein GitHub-owner/repo oder eine Git-URL ein."; cx.notify(); return; }
    const targets = this.targets().filter((x) => A.targets.has(x.id));
    if (!targets.length) { A.error = "Wähle mindestens einen Host."; cx.notify(); return; }
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
            failures.push(`${hostInfo(key).name} auf ${M.label}: ${errorText(e)}`);
          }
          await this.readHostInto(cx, M, key);
        }
      }));
      const added = this.marketList().find((x) => !before.has(x.name));
      if (added) this.select(added.name);
      if (failures.length) notify({ title: "Marketplace hinzufügen fehlgeschlagen", body: failures.join("\n\n").slice(0, 1200), level: "error", timeout: 20000 });
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
    this.act(cx, `mk|${M.key}|${key}|${mk.name}`, `${mk.name} zu ${hostInfo(key).name} auf ${M.label} hinzufügen`, M, key, () => marketplaceAction(M, key, M.hosts[key].bin, "add", { source }));
  }

  removeFrom(cx, M, key, mk) {
    const H = M.hosts[key];
    const plugins = Object.keys(H.installed).filter((id) => id.endsWith(`@${mk.name}`));
    const n = plugins.length;
    const detail = key === "copilot" && n ? `Copilot CLI deinstalliert dabei auch ${plural(n, "installiertes Plugin", "installierte Plugins")} (${plugins.join(", ")}).`
      : key === "omp" ? "omp behält Plugins, die schon daraus installiert sind."
      : n ? `${plural(n, "Plugin", "Plugins")} daraus ${n > 1 ? "sind" : "ist"} hier in Claude Code installiert.` : "";
    this.ask(cx, `${mk.name} aus ${hostInfo(key).name} auf ${M.label} entfernen?`, detail, "Entfernen",
      (cx) => this.act(cx, `mk|${M.key}|${key}|${mk.name}`, `${mk.name} entfernen`, M, key, () => marketplaceAction(M, key, H.bin, "remove", { name: mk.name, force: key === "copilot" && n > 0 })));
  }

  updateMarket(cx, mk) {
    const key = `update|${mk.name}`;
    if (this.busy.has(key)) return;
    this.busy.add(key);
    cx.notify();
    cx.spawn(async (cx) => {
      const failures = [];
      await Promise.all(mk.where.map(async (w) => {
        try { await marketplaceAction(w.M, w.key, w.M.hosts[w.key].bin, "update", { name: mk.name }); } catch (e) { failures.push(`${hostInfo(w.key).name} auf ${w.M.label}: ${errorText(e)}`); }
        await this.readHostInto(cx, w.M, w.key);
      }));
      if (failures.length) notify({ title: `${mk.name} aktualisieren fehlgeschlagen`, body: failures.join("\n\n").slice(0, 1200), level: "error", timeout: 20000 });
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
      .text_size(T_M)
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

  // Primary / secondary button (5.6): h 26 (22 in rows), px 10, radius 6, T_M medium; or an icon button.
  button(t, id, label, onClick, { icon, primary, disabled, tip, small } = {}) {
    const h = small ? H_BTN_S : H_BTN;
    const iconOnly = Boolean(icon) && !label;
    const fg = disabled ? t.dim : primary ? t.solid_foreground : iconOnly ? t.dim : t.foreground;
    return this.control(id).flex().flex_none().items_center().justify_center().gap(GAP_S).h(h).when(iconOnly, (el) => el.w(h)).when(!iconOnly, (el) => el.px(10)).rounded(6)
      .when(!iconOnly || primary, (el) => el.bg(disabled ? t.raised : primary ? t.solid : t.raised)).text_color(fg).text_size(T_M).font_medium()
      .when(!disabled, (el) => el.hover((s) => (primary ? s.opacity(0.85) : s.bg(t.hover).text_color(t.foreground))).on_click(onClick))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .when(Boolean(icon), (el) => el.child(svg(icon).size(small ? 12 : 14).flex_none()))
      .when(Boolean(label), (el) => el.child(label));
  }

  spinner(t, size = 12) {
    return svg(SPINNER).size(size).flex_none().text_color(t.dim).spin(900);
  }

  // Window title row (5.6): like a panel head, chrome background, Close last.
  titleBar(t, loading) {
    const seg = (mode, label) => this.control(`mode-${mode}`).h(H_BTN_S).px(8).flex().items_center().rounded(6).text_size(T_S)
      .bg(this.mode === mode ? t.selected : t.background).text_color(this.mode === mode ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.setMode(cx, mode)).child(label);
    const off = [...this.machines.values()].filter((M) => M.state === "unreachable" || M.state === "error");
    return h_flex().flex_none().h(H_HEADER).px(INSET_PANEL).gap(GAP_M).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().text_size(T_L).font_semibold().child("Marketplaces"))
      .child(h_flex().id("mk-scope").h(H_BTN).p(2).gap(2).items_center().rounded(8).bg(t.background).border_1().border_color(t.border)
        .tooltip("Scope: für den Benutzer oder für das Projekt eines Agents")
        .child(seg("user", "Benutzer"))
        .child(seg("project", "Projekt")))
      .child(div().flex_1())
      .when(off.length > 0, (el) => el.child(div().id("mk-off").text_size(T_S).text_color(t.dim)
        .tooltip(off.map((M) => `${M.label}: ${M.error ?? "nicht erreichbar"}`).join("\n"))
        .child(`${off.map((M) => M.label).join(", ")} nicht erreichbar`)))
      .when(loading, (el) => el.child(this.spinner(t)))
      .child(this.button(t, "mk-refresh", null, (_e, cx) => this.refresh(cx), { icon: ICON("refresh"), tip: "Alles neu einlesen" }))
      .child(this.button(t, "mk-close", null, () => this.close(), { icon: "mods/pane/close.svg", tip: "Schließen (Esc)" }));
  }

  marketStrip(t, markets) {
    return h_flex().id("mk-strip").flex_none().flex_wrap().px(INSET_PANEL).py(GAP_M).gap(GAP_S).items_center().border_b(1).border_color(t.border)
      .children(markets.map((x) => {
        const on = x.name === this.current;
        const cat = this.catalogs.get(x.name);
        return this.control(`mk-tab-${x.name}`).flex().flex_none().items_center().gap(GAP_S).h(H_BTN).px(10).rounded(6)
          .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted)
          .hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
          .tooltip(`${x.repo ?? x.source ?? x.name}\nIn ${plural(x.where.length, "Host", "Hosts")} eingerichtet`)
          .on_click((_e, cx) => { this.select(x.name); cx.notify(); })
          .child(div().font_medium().child(x.name))
          .child(div().text_size(T_XS).text_color(t.dim).child(cat?.plugins?.length ? String(cat.plugins.length) : ""))
          .child(h_flex().gap(2).children(HOSTS.filter((h) => x.where.some((w) => w.key === h.key)).map((h) => svg(h.icon).size(12).flex_none().text_color(t.muted))));
      }))
      .child(this.button(t, "mk-add", "Hinzufügen", (_e, cx) => (this.adding ? ((this.adding = null), cx.notify()) : this.openAdd(cx)),
        { icon: "mods/workspace-chrome/plus.svg", tip: "Marketplace hinzufügen" }));
  }

  // A checkbox (radius 4): solid when on.
  check(t, on) {
    return div().size(12).flex_none().rounded(4).border_1().border_color(on ? t.solid : t.input).when(on, (el) => el.bg(t.solid));
  }

  addPanel(t) {
    const A = this.adding;
    const targets = this.targets();
    return v_flex().flex_none().px(INSET_PANEL).py(GAP_M).gap(GAP_M).bg(t.surface).border_b(1).border_color(t.border)
      .child(h_flex().gap(GAP_M).items_center()
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Marketplace hinzufügen"))
        .child(h_flex().flex_1().h(H_INPUT).px(10).rounded(6).bg(t.background).border_1().border_color(t.accent).items_center()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.addInput).flex_1().h_full().text_size(T_M).text_color(t.foreground)))
        .child(A.busy ? h_flex().gap(GAP_S).items_center().text_size(T_S).child(this.spinner(t)).child(div().text_color(t.dim).child("fügt hinzu …"))
          : this.button(t, "mk-add-go", "Hinzufügen", (_e, cx) => this.addMarketplace(cx), { primary: true }))
        .child(this.button(t, "mk-add-cancel", "Abbrechen", (_e, cx) => { this.adding = null; cx.notify(); })))
      .child(h_flex().flex_wrap().gap(GAP_S).items_center()
        .child(div().text_size(T_S).text_color(t.dim).child("in"))
        .children(targets.map((x) => {
          const on = A.targets.has(x.id);
          return this.control(`mk-tg-${x.id}`).flex().items_center().gap(GAP_S).h(H_BTN_S).px(8).rounded(6)
            .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.dim).text_size(T_S).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { on ? A.targets.delete(x.id) : A.targets.add(x.id); cx.notify(); })
            .child(this.check(t, on))
            .child(svg(hostInfo(x.key).icon).size(12).flex_none())
            .child(`${hostInfo(x.key).short} · ${x.M.label}`);
        })))
      .when(Boolean(A.error), (el) => el.child(div().text_size(T_S).text_color(t.blocked).child(A.error)));
  }

  marketBar(t, mk) {
    const cat = this.catalogs.get(mk.name);
    const chips = this.readyMachines().flatMap((M) => HOSTS.filter((h) => M.hosts[h.key]?.bin).map((h) => {
      const has = mk.where.some((w) => w.M === M && w.key === h.key);
      const busy = this.busy.has(`mk|${M.key}|${h.key}|${mk.name}`);
      const src = mk.repo ?? mk.source;
      return this.control(`mk-host-${M.key}-${h.key}`).flex().flex_none().items_center().gap(GAP_XS).h(H_BTN_S).px(GAP_S).rounded(6)
        .bg(has ? t.done + "26" : t.raised).text_size(T_S).text_color(has ? t.foreground : t.dim)
        .hover((s) => s.text_color(has ? t.blocked : t.foreground))
        .tooltip(has ? `In ${h.name} auf ${M.label} eingerichtet. Klick entfernt ihn.` : src ? `Nicht in ${h.name} auf ${M.label}. Klick fügt ${src} hinzu.` : "Quelle unbekannt")
        .on_click((_e, cx) => (busy ? null : has ? this.removeFrom(cx, M, h.key, mk) : src ? this.addTo(cx, M, h.key, mk) : null))
        .child(busy ? this.spinner(t) : svg(h.icon).size(12).flex_none())
        .child(`${h.short} · ${M.label}`)
        .child(div().text_color(has ? t.done : t.dim).child(has ? "✓" : "+"));
    }));
    const updating = this.busy.has(`update|${mk.name}`);
    return v_flex().flex_none().px(INSET_PANEL).py(GAP_M).gap(GAP_M).border_b(1).border_color(t.border)
      .child(h_flex().gap(GAP_M).items_center()
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().gap(GAP_M).items_center().min_w(0)
            .child(div().text_size(T_L).font_semibold().child(mk.name))
            .child(div().truncate().text_size(T_S).text_color(t.muted).child(mk.repo ?? mk.source ?? "")))
          .child(div().truncate().text_size(T_S).text_color(t.dim)
            .child(cat?.loading ? "Katalog lädt …" : cat?.error ? "Katalog nicht lesbar" : [cat?.description, cat?.from ? `Katalog aus ${cat.from}` : null].filter(Boolean).join(" · "))))
        .child(h_flex().w(180).flex_none().h(H_INPUT).px(10).gap(GAP_S).rounded(6).bg(t.background).border_1().border_color(t.input).items_center()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(svg("mods/workspace-chrome/search.svg").size(12).flex_none().text_color(t.dim))
          .child(Input.new(this.filter).flex_1().h_full().text_size(T_M).text_color(t.foreground)))
        .child(this.button(t, "mk-update", updating ? "aktualisiert …" : "Aktualisieren", (_e, cx) => this.updateMarket(cx, mk),
          { icon: ICON("fetch"), disabled: updating || !mk.where.length, tip: "Diesen Katalog in jedem Host neu holen, der ihn hat" })))
      .child(h_flex().flex_wrap().gap(GAP_S).items_center().children(chips));
  }

  hintRows(t) {
    const live = agents();
    return [...this.hints].flatMap((key) => {
      const [mkey, hostKey] = key.split("|");
      const running = live.filter((a) => hostOf(a) === hostKey && (machineOf(a.address) ?? "") === mkey);
      if (!running.length) return [];
      const where = mkey || HERE;
      const names = running.map(agentLabel).slice(0, 4).join(", ") + (running.length > 4 ? ` +${running.length - 4}` : "");
      return [h_flex().id(`hint-${key}`).flex_none().mx(INSET_PANEL).mt(GAP_M).pl(10).pr(GAP_XS).py(GAP_XS).gap(GAP_M).items_center().rounded(8)
        .bg(t.working + "26").text_size(T_S)
        .child(div().text_color(t.working).child("↻"))
        .child(div().flex_1().min_w(0).truncate()
          .child(`Wirkt erst nach Neustart oder Neuladen von ${hostInfo(hostKey).name} auf ${where}. Laufend: ${names}`))
        .child(this.button(t, `hint-x-${key}`, null, (_e, cx) => { this.hints.delete(key); cx.notify(); }, { icon: "mods/pane/close.svg", tip: "Ausblenden", small: true }))];
    });
  }

  agentBar(t) {
    const choices = this.agentChoices();
    const P = this.project;
    const sel = choices.find((c) => c.a.address === this.agent);
    const info = !sel ? (choices.length ? "Wähle einen Agent: sein Host und Repository bekommen Plugins im Projekt-Scope." : "Keine Agents laufen.")
      : P?.error ? P.error
      : [`${hostInfo(sel.host)?.name ?? "?"} auf ${sel.mkey || HERE}`, P?.root ? `${P.root}${P.git ? "" : " (kein Git-Repository: sein Ordner)"}` : sel.cwd ?? ""].filter(Boolean).join(" · ");
    const note = sel?.host === "copilot" ? "Copilot CLI hat keinen Projekt-Scope: das ändert .claude/settings.json (liest auch Claude Code)."
      : sel?.host === "claude" ? "claude plugin … --scope project (schreibt .claude/settings.json)" : sel?.host === "omp" ? "omp plugin … --scope=project (.omp/plugins)" : null;
    return v_flex().flex_none().px(INSET_PANEL).py(GAP_M).gap(GAP_S).border_b(1).border_color(t.border)
      .child(h_flex().id("mk-agents").flex_wrap().gap(GAP_S).children(choices.map((c) => {
        const on = c.a.address === this.agent;
        const pic = programIcon(c.a.program, 16, t.foreground);
        // Identity chip (5.6).
        return this.control(`mk-ag-${c.a.address}`).flex().flex_none().items_center().gap(GAP_XS).h(H_BTN_S).px(GAP_S).rounded(6)
          .bg(on ? t.selected : t.raised).text_size(T_S).text_color(t.foreground).hover((s) => s.bg(on ? t.selected : t.hover))
          .when(!c.host, (el) => el.opacity(0.5))
          .tooltip(`${c.a.program?.name ?? c.a.app ?? "Agent"} · ${c.a.address}\n${c.cwd ?? ""}`)
          .on_click((_e, cx) => this.selectAgent(cx, c.a.address))
          .when(Boolean(pic), (el) => el.child(pic))
          .child(div().max_w(180).truncate().child(agentLabel(c.a)))
          .when(Boolean(c.mkey), (el) => el.child(div().text_size(T_XS).text_color(t.dim).child(c.mkey)));
      })))
      .child(h_flex().gap(GAP_M).items_center().text_size(T_S)
        .when(Boolean(P?.loading), (el) => el.child(this.spinner(t)))
        .child(div().flex_1().min_w(0).truncate().text_color(P?.error ? t.blocked : t.muted).child(info))
        .when(Boolean(note), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.dim).child(note))));
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
    for (const name of extra) if (!names.has(name)) list.push({ name, description: cat?.loading ? "" : "Installiert, aber nicht in diesem Katalog", version: null, category: null, keywords: [], counts: null, orphan: true });
    const q = this.filter.value().trim().toLowerCase();
    return q ? list.filter((p) => `${p.name} ${p.description} ${p.category ?? ""} ${p.keywords.join(" ")}`.toLowerCase().includes(q)) : list;
  }

  matrix(t, mk) {
    const cols = this.columns();
    const list = this.plugins(mk);
    const cat = this.catalogs.get(mk.name);
    const groups = [];
    for (const c of cols) {
      const label = this.mode === "project" ? (c.scope === "project" ? "Projekt" : "Benutzer") : c.M.label;
      if (this.mode === "user" && groups.at(-1)?.M === c.M) groups.at(-1).n++;
      else groups.push({ M: c.M, label, n: 1 });
    }
    const header = h_flex().flex_none().h(46).px(INSET_PANEL).items_end().pb(GAP_S).gap(0).border_b(1).border_color(t.border).text_size(T_S).text_color(t.dim)
      .child(div().flex_1().min_w(0).child(plural(list.length, "Plugin", "Plugins")))
      .children(this.mode === "user"
        ? groups.map((g) => v_flex().w(CELL * g.n).flex_none().gap(GAP_XS)
          .child(div().mx(GAP_XS).pb(2).border_b(1).border_color(t.border).text_color(t.muted).font_medium().text_center().child(g.label))
          .child(h_flex().children(HOSTS.map((h) => {
            const H = g.M.hosts[h.key];
            return h_flex().id(`mk-col-${g.M.key}-${h.key}`).w(CELL).flex_none().gap(GAP_XS).items_center().justify_center()
              .text_color(H?.bin ? t.muted : tint(t.dim, "88")).tooltip(H?.bin ? `${h.name}: ${H.bin}` : H?.missing ?? h.name)
              .child(svg(h.icon).size(12).flex_none()).child(h.short);
          }))))
        : cols.map((c) => h_flex().id(`mk-col-${c.scope}`).w(CELL).flex_none().gap(GAP_XS).items_center().justify_center().text_color(t.muted)
          .tooltip(c.scope === "project" ? `${c.h.name}, Projekt-Scope` : `${c.h.name}, Benutzer-Scope auf ${c.M.label}`)
          .child(svg(c.h.icon).size(12).flex_none()).child(c.scope === "project" ? "Projekt" : "Benutzer")));
    const shown = list.slice(0, MAX_ROWS);
    const note = cat?.loading && !list.length ? "Katalog lädt …"
      : cat?.error && !list.length ? `Katalog nicht lesbar: ${cat.error}`
      : !list.length ? (this.filter.value().trim() ? "Kein Plugin passt." : "Keine Plugins.")
      : !cols.length ? (this.mode === "project" ? null : "Keine erreichbare Maschine mit einem Plugin-Host.") : null;
    // Rows carry their own click targets, which a virtual list's renderer can't register:
    // a plain scroll area, at most MAX_ROWS rows (the filter narrows bigger catalogs).
    return v_flex().flex_1().min_h(0)
      .child(header)
      .child(v_flex().id("mk-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .when(Boolean(note), (el) => el.child(h_flex().h(28).px(INSET_PANEL).items_center().text_size(T_S).text_color(cat?.error ? t.blocked : t.dim).child(note)))
        .children(shown.map((p) => this.row(t, p, mk, cols)))
        .when(list.length > shown.length, (el) => el.child(div().px(INSET_PANEL).py(10).text_size(T_S).text_color(t.dim)
          .child(`${shown.length} von ${list.length}: tippe in den Filter, um die anderen zu finden.`))));
  }

  row(t, p, mk, cols) {
    const c = p.counts;
    const counts = c ? [c.skills && plural(c.skills, "Skill", "Skills"), c.commands && plural(c.commands, "Befehl", "Befehle"), c.agents && plural(c.agents, "Agent", "Agents")].filter(Boolean) : [];
    const meta = [...counts, p.external ? `Quelle: ${p.external}` : null, ...p.keywords.slice(0, 6).map((k) => `#${k}`)].filter(Boolean).join(" · ");
    return h_flex().id(`mk-row-${p.name}`).flex_none().h(ROW).px(INSET_PANEL).items_center().border_b(1).border_color(tint(t.border, "88")).hover((s) => s.bg(t.hover))
      .child(v_flex().flex_1().min_w(0).gap(2).pr(GAP_M)
        .child(h_flex().gap(GAP_S).items_center().min_w(0)
          .child(div().flex_none().font_semibold().text_color(p.orphan ? t.muted : t.foreground).child(p.name))
          .when(Boolean(p.version), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.dim).child(`v${p.version}`)))
          .when(Boolean(p.category), (el) => el.child(div().flex_none().px(6).h(H_CHIP).rounded(4).bg(t.raised).text_size(T_XS).text_color(t.muted).flex().items_center().child(p.category))))
        .child(div().id(`mk-desc-${p.name}`).truncate().text_size(T_S).text_color(p.orphan ? t.dim : t.muted).when(Boolean(p.description), (el) => el.tooltip(p.description)).child(p.description || " "))
        .child(div().truncate().text_size(T_XS).text_color(t.dim).child(meta || " ")))
      .children(cols.map((col) => this.cell(t, col, p, mk)));
  }

  cell(t, col, p, mk) {
    const { M, h, scope } = col;
    const H = M.hosts[h.key];
    const id = `${p.name}@${mk.name}`;
    const cid = `${scope}-${M.key}-${h.key}-${p.name}`;
    const box = div().w(CELL).h_full().flex_none().flex().items_center().justify_center();
    const pill = (pid) => this.control(pid).h(H_BTN_S).px(8).flex().items_center().rounded(6).text_size(T_S);
    if (!H?.bin) return box.child(div().id(`mk-c-${cid}`).text_color(tint(t.dim, "88")).tooltip(H?.missing ?? `${h.name} nicht verfügbar`).child("—"));
    if (H.error) return box.child(div().id(`mk-c-${cid}`).text_color(t.blocked).tooltip(`${h.name} auf ${M.label}: ${H.error}`).child("!"));
    const P = this.project;
    const busy = this.busy.has(`${M.key}|${h.key}|${id}|${scope}`);
    if (busy || H.loading || (scope === "project" && (P?.loading && !P.state?.[id]))) return box.child(this.spinner(t));
    if (scope === "project" && (!P?.root || P.error)) return box.child(div().text_color(t.dim).child("·"));
    const inst = scope === "user" ? H.installed[id] : null;
    const st = scope === "project" ? P.state[id] : inst ? { status: inst.enabled ? "enabled" : "disabled", version: inst.version } : null;
    const known = H.marketplaces.some((x) => x.name === mk.name);
    const where = scope === "project" ? `${h.name}, Projekt ${P.root}` : `${h.name} auf ${M.label}`;
    if (!st && scope === "user" && h.key === "omp") {
      const pkg = npmFor(H.npm, p.name);
      if (pkg) {
        const n = H.npm[pkg];
        return box.child(pill(`mk-c-${cid}`).bg(n.enabled ? t.working + "26" : t.raised).text_color(n.enabled ? t.foreground : t.dim)
          .tooltip(`In omp auf ${M.label} als npm-Paket ${pkg}${n.version ? ` v${n.version}` : ""}${n.enabled ? "" : " (aus)"} installiert, nicht aus ${mk.name}. Klick stellt auf die Marketplace-Version um.`)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.npmCell(cx, M, id, mk, pkg))
          .child(n.version ? `npm ${n.version}` : "npm"));
      }
    }
    if (!st) {
      const can = known || Boolean(mk.repo);
      if (p.orphan) return box.child(div().text_color(tint(t.dim, "88")).child("·"));
      return box.child(pill(`mk-c-${cid}`).border_1().border_color(t.border).text_color(t.dim).when(!can, (el) => el.opacity(0.4))
        .tooltip(!can ? `${h.name} auf ${M.label} hat ${mk.name} nicht, und die Quelle ist unbekannt` : `${scope === "project" ? "Einschalten" : "Installieren"} in ${where}${known ? "" : ` (fügt zuerst ${mk.repo} hinzu)`}`)
        .when(can, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => (scope === "project" ? this.projectCell(cx, M, h.key, id, mk, null) : this.userCell(cx, M, h.key, id, mk, null))))
        .child(scope === "project" ? "Einschalten" : known ? "Installieren" : "+ Installieren"));
    }
    const on = st.status === "enabled";
    const color = on ? t.done : t.dim;
    const label = scope === "project" && st.scope === "local" ? "lokal" : st.version ? `v${st.version}` : on ? "an" : "aus";
    const tip = `${on ? "An" : "Aus"} in ${where}${st.version ? ` · v${st.version}` : ""}${st.declared && !st.version ? " (in .claude/settings.json eingetragen)" : ""}. Klick ${scope === "project" ? "entfernt" : "deinstalliert"} es.`;
    return box.child(h_flex().h(H_BTN_S).rounded(6).bg(on ? t.done + "26" : t.raised).items_center().overflow_hidden()
      .child(this.control(`mk-c-${cid}`).h_full().pl(8).pr(GAP_XS).flex().items_center().text_size(T_S).text_color(on ? t.foreground : t.dim)
        .tooltip(tip).hover((s) => s.text_color(t.blocked))
        .on_click((_e, cx) => (scope === "project" ? this.projectCell(cx, M, h.key, id, mk, st) : this.userCell(cx, M, h.key, id, mk, inst)))
        .child(label))
      .child(this.control(`mk-t-${cid}`).h_full().pl(2).pr(GAP_S).flex().items_center()
        .tooltip(on ? "Ausschalten" : "Einschalten")
        .on_click((_e, cx) => (scope === "project" ? this.projectToggle(cx, M, h.key, id, mk, st) : this.userToggle(cx, M, h.key, id, inst)))
        .child(div().size(7).rounded_full().border_1().border_color(color).when(on, (el) => el.bg(color)))));
  }

  // Empty state (5.6): icon 16 and one sentence, dim, and the way out; while reading a spinner.
  empty(t, loading) {
    return v_flex().flex_1().items_center().justify_center().gap(GAP_M).text_size(T_S).text_color(t.dim)
      .when(loading, (el) => el.child(this.spinner(t)).child("lädt …"))
      .when(!loading, (el) => el.child(svg("mods/workspace-chrome/layers.svg").size(16).text_color(t.dim))
        .child("Noch kein Marketplace in einem Host eingerichtet.")
        .child(this.button(t, "mk-empty-add", "Marketplace hinzufügen", (_e, cx) => this.openAdd(cx), { primary: true })));
  }

  // Confirmation (5.6 dialog): title, detail, Abbrechen and the one primary action.
  confirmLayer(t) {
    const C = this.confirm;
    const done = (cx) => { this.confirm = null; cx.notify(); };
    return div().id("mk-confirm").absolute().inset_0().bg(tint(t.background, "88")).flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(v_flex().w(420).p(GAP_XL).gap(GAP_L).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_lg()
        .child(div().text_size(T_XL).font_semibold().child(C.title))
        .when(Boolean(C.detail), (el) => el.child(div().text_size(T_M).text_color(t.muted).child(C.detail)))
        .child(h_flex().gap(GAP_M).justify_end()
          .child(this.button(t, "mk-no", "Abbrechen", (_e, cx) => done(cx)))
          .child(this.button(t, "mk-yes", C.label, (_e, cx) => { const go = C.go; this.confirm = null; go(cx); cx.notify(); }, { primary: true }))));
  }
}
