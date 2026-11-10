// MCP servers: which MCP servers Claude Code, omp and Copilot CLI have on every reachable
// machine, as a matrix of server × machine/host. Removes, enables or disables them, copies a
// definition from one host or machine to another, and adds new ones at user scope; in Project
// mode, for one running agent's host and repository, at project scope. Changes take effect when
// an agent restarts or reloads: the window says so, it never types into a running agent. Data is
// read on open, on Refresh and after a change; Refresh also runs Claude Code's health check.
// Env and header values are never drawn: only their names.
// Opened as a window (mod.open, or openOverlay with props { agent: address }).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { agents, panes, machines, theme, props, closeOverlay, notify, home } from "herdr";
import { HOSTS, hostInfo, probe, projectRoot, localIsWindows, errorText, readUser, readProject, claudeHealth, addServer, removeServer, removeBlock, canToggle, toggleServer } from "./hosts.js";

const CELL = 96;
const ROW = 50;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const TRANSPORTS = ["stdio", "http", "sse"];

const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : null);
function hostOf(a) {
  const k = `${a.app ?? ""} ${a.program?.key ?? ""}`.toLowerCase();
  if (k.includes("claude")) return "claude";
  if (/\bomp\b/.test(k)) return "omp";
  if (k.includes("copilot")) return "copilot";
  return null;
}
const programIcon = (p, size, color) => (!p?.icon ? null : p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).size(size).flex_none());
const agentLabel = (a) => [a.space_name, a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : null].filter(Boolean).join(" · ") || a.title || a.address;

// Shown commands and URLs hide what looks like a secret: --token x, KEY=x, ?query, user:pass@.
const SECRET = /key|token|secret|passw|auth|bearer|credential/i;
const maskArgs = (args) => args.map((a, i) => {
  const eq = a.indexOf("=");
  if (eq > 0 && SECRET.test(a.slice(0, eq))) return `${a.slice(0, eq)}=•••`;
  return i > 0 && args[i - 1].startsWith("-") && SECRET.test(args[i - 1]) ? "•••" : a;
});
const maskUrl = (u) => u.replace(/\/\/[^/@\s]+@/, "//•••@").replace(/\?.+$/, "?•••");
const target = (s) => (s.url ? maskUrl(s.url) : [s.command ?? "", ...maskArgs(s.args)].join(" "));
// "a b" 'c d' e → [a b, c d, e]
const words = (line) => (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^(["'])([\s\S]*)\1$/, "$2"));

export default class McpServers extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.busy = new Set();
    this.hints = new Set();
    this.gen = 0;
    this.projectToken = 0;
    this.agent = props()?.agent ?? null;
    this.mode = this.agent ? "project" : localStorage.getItem("mode") === "project" ? "project" : "user";
    if (this.mode === "project" && !this.agent) this.agent = this.agentChoices().find((c) => c.host)?.a.address ?? null;
    this.addName = InputState.new({ placeholder: "name" });
    this.addCmd = InputState.new({ placeholder: "command and arguments, e.g. npx -y @upstash/context7-mcp" });
    this.addUrl = InputState.new({ placeholder: "https://example.com/mcp" });
    this.addKv = TextareaState.new({ placeholder: "Optional, one per line: KEY=value (env for stdio) or Header: value (http/sse)", rows: 2 });
    for (const s of [this.addName, this.addCmd, this.addUrl]) s.on("submit", (_e, cx) => this.addGo(cx));
    this.adding = null;
    this.confirm = null;
    this.project = null;
    this.refresh(cx, false);
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

  // health: also run Claude Code's health check (seconds per server), on Refresh only.
  refresh(cx, health) {
    const gen = ++this.gen;
    this.machines = new Map(this.liveMachines().map((m) => [m.name ?? "", this.blank(m)]));
    cx.spawn(async (cx) => {
      await Promise.all([...this.machines.values()].filter((M) => M.state === "loading").map((M) => this.probeMachine(cx, M, health)));
      if (gen === this.gen && this.mode === "project") await this.loadProject(cx, { health });
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
          await this.probeMachine(cx, fresh, false);
          if (gen === this.gen && this.mode === "project" && (this.project?.mkey ?? null) === key) await this.loadProject(cx);
        });
      } else if (m.layout === "unavailable" && M && M.state !== "unreachable" && M.state !== "loading") {
        M.state = "unreachable";
      } else if (!M) {
        this.machines.set(key, this.blank(m));
      }
    }
  }

  async probeMachine(cx, M, health) {
    M.state = "loading";
    try {
      const p = await probe(M);
      M.home = p.home;
      for (const h of HOSTS) {
        const b = p.bins[h.key];
        M.hosts[h.key] = { bin: b.path ?? null, missing: b.missing ?? null, loading: Boolean(b.path), error: null, servers: {}, health: null, checking: false, healthError: null };
      }
      M.state = "ready";
    } catch (e) {
      M.state = "error";
      M.error = errorText(e);
      cx.notify();
      return;
    }
    cx.notify();
    // In Project mode the agent's project read checks health there instead.
    await Promise.all(HOSTS.map((h) => (M.hosts[h.key].bin ? this.readHostInto(cx, M, h.key, health && this.mode === "user") : null)));
  }

  async readHostInto(cx, M, key, health = false) {
    const H = M.hosts[key];
    if (!H?.bin) return;
    H.loading = true;
    cx.notify();
    try {
      H.servers = await readUser(M, key, H.bin);
      H.error = null;
    } catch (e) {
      H.error = errorText(e);
    }
    H.loading = false;
    cx.notify();
    if (!health || key !== "claude" || H.error) return;
    H.checking = true;
    cx.notify();
    try {
      H.health = await claudeHealth(M, H.bin, M.home, new Set(Object.keys(H.servers)));
      H.healthError = null;
    } catch (e) {
      H.healthError = errorText(e);
    }
    H.checking = false;
    cx.notify();
  }

  readyMachines() {
    return [...this.machines.values()].filter((M) => M.state === "ready");
  }

  agentChoices() {
    const cwds = new Map(panes().map((p) => [p.pane, p.cwd]));
    return agents().map((a) => ({ a, host: hostOf(a), mkey: machineOf(a.address) ?? "", cwd: cwds.get(a.pane) ?? null }));
  }

  async loadProject(cx, { quiet = false, health = false } = {}) {
    const token = ++this.projectToken;
    const c = this.agentChoices().find((x) => x.a.address === this.agent);
    if (!c) {
      this.project = this.agent ? { error: "This agent isn't running any more.", servers: {} } : null;
      cx.notify();
      return;
    }
    const prev = this.project?.address === c.a.address ? this.project : null;
    const P = {
      address: c.a.address, host: c.host, mkey: c.mkey, cwd: c.cwd, root: prev?.root ?? null, git: prev?.git ?? false,
      loading: true, error: null, servers: quiet && prev ? prev.servers : {}, health: prev?.health ?? null, checking: false,
    };
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
      const servers = await readProject(M, c.host, H.bin, root);
      if (token !== this.projectToken) return;
      P.servers = servers;
      P.loading = false;
      cx.notify();
      if (!health || c.host !== "claude") return;
      P.checking = true;
      cx.notify();
      try {
        P.health = await claudeHealth(M, H.bin, root, new Set([...Object.keys(servers), ...Object.keys(H.servers)]));
      } catch (e) {
        notify({ title: "Claude Code health check failed", body: errorText(e).slice(0, 900), level: "error", timeout: 15000 });
      }
      P.checking = false;
      cx.notify();
    } catch (e) {
      fail(errorText(e));
    }
  }

  selectAgent(cx, address) {
    this.agent = address;
    this.project = null;
    this.adding = null;
    cx.spawn(async (cx) => this.loadProject(cx));
    cx.notify();
  }

  setMode(cx, mode) {
    this.mode = mode;
    this.adding = null;
    localStorage.setItem("mode", mode);
    if (mode === "project") {
      if (!this.agent) this.agent = this.agentChoices().find((c) => c.host)?.a.address ?? null;
      cx.spawn(async (cx) => this.loadProject(cx));
    }
    cx.notify();
  }

  // ---- the matrix's model ----------------------------------------------------

  userColumns() {
    return this.readyMachines().flatMap((M) => HOSTS.map((h) => ({ M, h, scope: "user" })));
  }

  columns() {
    if (this.mode === "user") return this.userColumns();
    const P = this.project;
    const M = P && this.machines.get(P.mkey);
    if (!P?.host || !M || M.state !== "ready" || !M.hosts[P.host]?.bin || (!P.root && !P.loading)) return [];
    return [{ M, h: hostInfo(P.host), scope: "project" }, { M, h: hostInfo(P.host), scope: "user" }];
  }

  // { name: server } in one column; user columns add what Claude Code's health check found
  // (plugins, claude.ai connectors).
  serversOf(col) {
    if (col.scope === "project") return this.project?.servers ?? {};
    const H = col.M.hosts[col.h.key];
    if (!H) return {};
    const health = this.mode === "project" && col.M.key === this.project?.mkey && col.h.key === this.project?.host ? this.project.health : H.health;
    return { ...(health?.extra ?? {}), ...H.servers };
  }

  statusFor(col, name) {
    const P = this.project;
    const health = this.mode === "project" && P?.host === col.h.key && P.mkey === col.M.key ? P.health : col.M.hosts[col.h.key]?.health;
    return health?.status?.[name] ?? null;
  }

  // Where to copy a server from: a definition with known values, this machine's first.
  sourceFor(name, col) {
    const cols = this.mode === "project" ? [...this.columns().filter((c) => c.scope === "project"), ...this.userColumns()] : this.userColumns();
    const found = cols
      .filter((c) => !(c.M === col.M && c.h.key === col.h.key && c.scope === col.scope))
      .map((c) => ({ col: c, S: this.serversOf(c)[name] }))
      .filter((x) => x.S?.def);
    return found.find((x) => x.col.M === col.M) ?? found[0] ?? null;
  }

  rootFor(col) {
    return this.mode === "project" ? this.project?.root : col.M.home;
  }

  // ---- actions --------------------------------------------------------------

  // One change: a busy marker on its cell, the CLI's own error as a toast, a fresh read of that
  // host afterwards, and the restart hint for its running agents.
  act(cx, busyKey, label, M, hostKey, fn) {
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
      if (this.mode === "project") await this.loadProject(cx, { quiet: true });
      if (ok) this.hints.add(`${M.key}|${hostKey}`);
      this.busy.delete(busyKey);
      cx.notify();
    });
  }

  ask(cx, title, detail, label, go, { danger = true, warn = null } = {}) {
    this.confirm = { title, detail, label, go, danger, warn };
    this.handle.focus();
    cx.notify();
  }

  busyKey(col, name) {
    return `${col.M.key}|${col.h.key}|${name}|${col.scope}`;
  }

  removeAsk(cx, col, S) {
    const { M, h } = col;
    const shared = S.file && /[\\/]\.mcp\.json$/.test(S.file) && !/[\\/]\.omp[\\/]/.test(S.file);
    const where = h.key === "claude" && S.scope !== "project" ? `Claude Code's ${S.scope} scope (claude mcp remove)` : S.file ?? `${h.name}'s ${S.scope} scope`;
    this.ask(cx, `Remove ${S.name} from ${h.name} on ${M.label}?`,
      `Removes it from ${where}.${shared ? " Claude Code, Copilot CLI and omp all read this file." : ""}`, "Remove",
      (cx) => this.act(cx, this.busyKey(col, S.name), `Removing ${S.name}`, M, h.key, () => removeServer(M, h.key, M.hosts[h.key].bin, S, this.rootFor(col))));
  }

  toggle(cx, col, S) {
    const { M, h } = col;
    const on = !S.enabled;
    this.act(cx, this.busyKey(col, S.name), `${on ? "Enabling" : "Disabling"} ${S.name}`, M, h.key, () => toggleServer(M, h.key, M.hosts[h.key].bin, S, on));
  }

  copyAsk(cx, name, src, col) {
    const { M, h } = col;
    const def = src.S.def;
    const scope = col.scope === "project" ? "project" : "user";
    const vals = Object.keys(def.env ?? def.headers ?? {}).length;
    const warn = def.type === "stdio" && src.col.M !== M
      ? `It starts "${def.command}" on ${M.label}: that command may not exist there${src.col.M.win !== M.win ? " (Windows and Linux commands and paths differ)" : ""}.`
      : null;
    const detail = [
      `Adds ${name} (${def.type}) to ${h.name} on ${M.label}, ${scope === "project" ? `project ${this.project.root}` : "user scope"}.`,
      vals ? `Its ${vals} ${def.env ? "environment variable" : "header"}${vals > 1 ? "s are" : " is"} copied with ${vals > 1 ? "their values" : "its value"}.` : null,
    ].filter(Boolean).join(" ");
    const from = `${src.col.h.name} on ${src.col.M.label}${src.col.scope === "project" ? " (project)" : ""}`;
    this.ask(cx, `Copy ${name} from ${from}?`, detail, "Copy",
      (cx) => this.act(cx, this.busyKey(col, name), `Copying ${name} to ${h.name} on ${M.label}`, M, h.key,
        () => addServer(M, h.key, M.hosts[h.key].bin, scope, name, def, this.rootFor(col))),
      { danger: false, warn });
  }

  // Every reachable machine × installed host the add form can write to.
  targets() {
    if (this.mode === "project") {
      const P = this.project;
      const M = P?.host && this.machines.get(P.mkey);
      return M?.hosts[P.host]?.bin && P.root ? [{ id: `${M.key}|${P.host}`, M, key: P.host }] : [];
    }
    return this.readyMachines().flatMap((M) => HOSTS.filter((h) => M.hosts[h.key]?.bin).map((h) => ({ id: `${M.key}|${h.key}`, M, key: h.key })));
  }

  openAdd(cx) {
    const project = this.mode === "project";
    // On this PC by default: a stdio command typed for one machine may not exist on the others.
    this.adding = { transport: "stdio", scope: project ? "project" : "user", targets: new Set(this.targets().filter((x) => project || x.M.name == null).map((x) => x.id)), busy: false, error: null };
    this.addName.focus();
    cx.notify();
  }

  // The form's definition, or a message saying what's wrong (never echoing a value).
  addDef() {
    const A = this.adding;
    const name = this.addName.value().trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) return { error: "Name: letters, digits, '.', '_' and '-' only." };
    const pairs = {};
    const lines = this.addKv.value().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const x = lines[i].match(/^\s*([^\s=:]+)\s*[=:]\s*(.*?)\s*$/);
      if (!x) return { error: `Line ${i + 1} isn't KEY=value or Header: value.` };
      pairs[x[1]] = x[2];
    }
    const has = Object.keys(pairs).length > 0;
    if (A.transport === "stdio") {
      const argv = words(this.addCmd.value().trim());
      if (!argv.length) return { error: "Enter the command that starts the server." };
      return { name, def: { type: "stdio", command: argv[0], args: argv.slice(1), ...(has ? { env: pairs } : {}) } };
    }
    const url = this.addUrl.value().trim();
    if (!/^https?:\/\/\S+$/.test(url)) return { error: "Enter the server's http(s) URL." };
    return { name, def: { type: A.transport, url, ...(has ? { headers: pairs } : {}) } };
  }

  addGo(cx) {
    const A = this.adding;
    if (!A || A.busy) return;
    const { name, def, error } = this.addDef();
    if (error) { A.error = error; cx.notify(); return; }
    const targets = this.targets().filter((x) => A.targets.has(x.id));
    if (!targets.length) { A.error = "Pick at least one host."; cx.notify(); return; }
    A.busy = true;
    A.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const failures = [];
      // One machine's hosts one after another; machines in parallel.
      const byMachine = new Map();
      for (const x of targets) byMachine.set(x.M.key, [...(byMachine.get(x.M.key) ?? []), x]);
      await Promise.all([...byMachine.values()].map(async (list) => {
        for (const { M, key } of list) {
          try {
            await addServer(M, key, M.hosts[key].bin, A.scope, name, def, A.scope === "project" ? this.project?.root : M.home);
            this.hints.add(`${M.key}|${key}`);
          } catch (e) {
            failures.push(`${hostInfo(key).name} on ${M.label}: ${errorText(e)}`);
          }
          await this.readHostInto(cx, M, key);
        }
      }));
      if (this.mode === "project") await this.loadProject(cx, { quiet: true });
      if (failures.length) notify({ title: `Adding ${name} failed`, body: failures.join("\n\n").slice(0, 1200), level: "error", timeout: 20000 });
      if (failures.length < targets.length) {
        this.adding = null;
        for (const s of [this.addName, this.addCmd, this.addUrl, this.addKv]) s.set_value("");
      } else {
        A.busy = false;
        A.error = failures[0];
      }
      cx.notify();
    });
  }

  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  // ---- view -----------------------------------------------------------------

  render(cx) {
    const t = theme();
    this.syncMachines(cx);
    const cols = this.columns();
    const P = this.project;
    const loading = [...this.machines.values()].some((M) => M.state === "loading" || Object.values(M.hosts).some((H) => H.loading || H.checking))
      || Boolean(P?.loading || P?.checking);
    return v_flex()
      .id("mc-root")
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
      .children(this.hintRows(t))
      .when(this.mode === "project", (el) => el.child(this.agentBar(t)))
      .when(Boolean(this.adding), (el) => el.child(this.addPanel(t)))
      .child(this.matrix(t, cols, loading))
      .when(Boolean(this.confirm), (el) => el.child(this.confirmLayer(t)));
  }

  // Controls stop the press so it doesn't drag the window.
  control(id, base = div()) {
    return base.id(id).cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  }

  button(t, id, label, onClick, { icon, primary, disabled, tip } = {}) {
    return this.control(id).flex().flex_none().items_center().gap(6).h(26).px(10).rounded(7).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).text_size(12)
      .when(Boolean(disabled), (el) => el.opacity(0.5))
      .when(!disabled, (el) => el.hover((s) => s.opacity(0.88)).on_click(onClick))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .when(Boolean(icon), (el) => el.child(svg(icon).size(13).flex_none()))
      .when(Boolean(label), (el) => el.child(label));
  }

  segment(t, id, options, value, onPick) {
    return h_flex().p(2).gap(2).rounded(8).bg(t.background).border_1().border_color(t.border)
      .children(options.map(([key, label, disabled]) => this.control(`${id}-${key}`).h(22).px(9).flex().items_center().rounded(6).text_size(11.5)
        .bg(value === key ? t.selected : t.raised + "00").text_color(value === key ? t.foreground : t.muted)
        .when(Boolean(disabled), (el) => el.opacity(0.4))
        .when(!disabled, (el) => el.hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => onPick(cx, key)))
        .child(label)));
  }

  spinner(t, size = 12) {
    return svg(SPINNER).size(size).flex_none().text_color(t.dim).spin(900);
  }

  titleBar(t, loading) {
    const off = [...this.machines.values()].filter((M) => M.state === "unreachable" || M.state === "error");
    const healthErr = this.readyMachines().filter((M) => M.hosts.claude?.healthError).map((M) => `${M.label}: ${M.hosts.claude.healthError}`);
    return h_flex().flex_none().h(44).px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/sidebar-footer/plug.svg").size(16).flex_none().text_color(t.accent))
      .child(div().text_size(14).font_semibold().child("MCP servers"))
      .child(this.segment(t, "mode", [["user", "User scope"], ["project", "Project"]], this.mode, (cx, mode) => this.setMode(cx, mode)))
      .child(div().flex_1())
      .when(off.length > 0, (el) => el.child(div().id("mc-off").text_size(11).text_color(t.dim)
        .tooltip(off.map((M) => `${M.label}: ${M.error ?? "unreachable"}`).join("\n"))
        .child(`${off.map((M) => M.label).join(", ")} unreachable`)))
      .when(healthErr.length > 0, (el) => el.child(div().id("mc-health-err").text_size(11).text_color(t.blocked).tooltip(healthErr.join("\n")).child("health check failed")))
      .when(loading, (el) => el.child(this.spinner(t)))
      .child(this.button(t, "mc-add", "Add", (_e, cx) => (this.adding ? ((this.adding = null), cx.notify()) : this.openAdd(cx)), { icon: "mods/workspace-chrome/plus.svg" }))
      .child(this.button(t, "mc-refresh", null, (_e, cx) => this.refresh(cx, true), { icon: "mods/git-graph/icons/refresh.svg", tip: "Read everything again and check Claude Code's servers (takes a few seconds)" }))
      .child(this.control("mc-close").p(4).rounded(6).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => this.close()).child(svg("mods/workspace-chrome/x.svg").size(14)));
  }

  hintRows(t) {
    const live = agents();
    return [...this.hints].flatMap((key) => {
      const [mkey, hostKey] = key.split("|");
      const running = live.filter((a) => hostOf(a) === hostKey && (machineOf(a.address) ?? "") === mkey);
      if (!running.length) return [];
      const names = running.map(agentLabel).slice(0, 4).join(", ") + (running.length > 4 ? ` +${running.length - 4}` : "");
      const how = hostKey === "omp" ? " (or /mcp reload)" : "";
      return [h_flex().id(`hint-${key}`).flex_none().mx(14).mt(8).px(10).py(6).gap(8).items_center().rounded(7)
        .bg(t.working + "1c").border_1().border_color(t.working + "66").text_size(11.5)
        .child(div().text_color(t.working).child("↻"))
        .child(div().flex_1().min_w(0).truncate()
          .child(`Active after restarting ${hostInfo(hostKey).name}${how} on ${mkey || "This PC"} — running: ${names}`))
        .child(this.control(`hint-x-${key}`).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.hints.delete(key); cx.notify(); }).child("×"))];
    });
  }

  agentBar(t) {
    const choices = this.agentChoices();
    const P = this.project;
    const sel = choices.find((c) => c.a.address === this.agent);
    const info = !sel ? (choices.length ? "Pick an agent: its host and repository get project-scope servers." : "No agents running.")
      : P?.error ? P.error
      : [`${hostInfo(sel.host)?.name ?? "?"} on ${sel.mkey || "This PC"}`, P?.root ? `${P.root}${P.git ? "" : " (no git repo: its folder)"}` : sel.cwd ?? ""].filter(Boolean).join(" · ");
    const note = sel?.host === "claude" ? "project: .mcp.json · local: ~/.claude.json"
      : sel?.host === "omp" ? "project: .omp/mcp.json · workspace: .mcp.json"
      : sel?.host === "copilot" ? "workspace: .mcp.json or .github/mcp.json" : null;
    return v_flex().flex_none().px(14).py(8).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().id("mc-agents").flex_wrap().gap(6).children(choices.map((c) => {
        const on = c.a.address === this.agent;
        const pic = programIcon(c.a.program, 13, t.foreground);
        return this.control(`mc-ag-${c.a.address}`).flex().flex_none().items_center().gap(6).h(26).px(9).rounded(7).border_1()
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

  field(t, state, flex = true) {
    return h_flex().when(flex, (el) => el.flex_1()).min_w(0).h(28).px(8).rounded(7).bg(t.background).border_1().border_color(t.input).items_center()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).flex_1().h_full().text_size(12.5).text_color(t.foreground));
  }

  addPanel(t) {
    const A = this.adding;
    const targets = this.targets();
    const project = this.mode === "project";
    return v_flex().flex_none().px(14).py(10).gap(8).bg(t.surface).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(12).text_color(t.muted).child("Add MCP server"))
        .child(this.field(t, this.addName, false).w(170))
        .child(this.segment(t, "mc-tr", TRANSPORTS.map((x) => [x, x]), A.transport, (cx, x) => { A.transport = x; cx.notify(); }))
        .child(div().flex_1())
        .child(A.busy ? h_flex().gap(6).items_center().child(this.spinner(t)).child(div().text_color(t.dim).child("Adding…"))
          : this.button(t, "mc-add-go", "Add", (_e, cx) => this.addGo(cx), { primary: true }))
        .child(this.button(t, "mc-add-cancel", "Cancel", (_e, cx) => { this.adding = null; cx.notify(); })))
      .child(this.field(t, A.transport === "stdio" ? this.addCmd : this.addUrl))
      .child(div().h(48).px(8).py(4).rounded(7).bg(t.background).border_1().border_color(t.input)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Textarea.new(this.addKv).size_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().flex_wrap().gap(6).items_center()
        .child(div().text_size(11).text_color(t.dim).child("to"))
        .children(targets.map((x) => {
          const on = A.targets.has(x.id);
          return this.control(`mc-tg-${x.id}`).flex().items_center().gap(6).h(24).px(8).rounded(6).border_1()
            .border_color(on ? t.accent : t.border).text_color(on ? t.foreground : t.dim).text_size(11.5)
            .on_click((_e, cx) => { on ? A.targets.delete(x.id) : A.targets.add(x.id); cx.notify(); })
            .child(div().size(12).rounded(3).border_1().border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent)))
            .child(svg(hostInfo(x.key).icon).size(12).flex_none())
            .child(`${hostInfo(x.key).short} · ${x.M.label}`);
        }))
        .when(!targets.length, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(project ? "Pick a running agent first." : "No host found.")))
        .child(div().flex_1())
        .child(this.segment(t, "mc-scope", [["user", "User"], ["project", "Project", !project]], A.scope, (cx, s) => { A.scope = s; cx.notify(); })))
      .when(Boolean(A.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(A.error)));
  }

  matrix(t, cols, loading) {
    const names = new Map();
    for (const c of cols) for (const [name, S] of Object.entries(this.serversOf(c))) {
      const x = names.get(name) ?? { name, S, n: 0 };
      x.n++;
      names.set(name, x);
    }
    const rows = [...names.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const groups = [];
    for (const c of cols) {
      if (this.mode === "user" && groups.at(-1)?.M === c.M) groups.at(-1).n++;
      else groups.push({ M: c.M, n: 1 });
    }
    const header = h_flex().flex_none().h(46).px(12).items_end().pb(6).border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
      .child(div().flex_1().min_w(0).child(`${rows.length} server${rows.length === 1 ? "" : "s"}`))
      .children(this.mode === "user"
        ? groups.map((g) => v_flex().w(CELL * g.n).flex_none().gap(4)
          .child(div().mx(4).pb(2).border_b(1).border_color(t.border).text_color(t.muted).font_medium().text_center().child(g.M.label))
          .child(h_flex().children(HOSTS.map((h) => {
            const H = g.M.hosts[h.key];
            return h_flex().id(`mc-col-${g.M.key}-${h.key}`).w(CELL).flex_none().gap(4).items_center().justify_center()
              .text_color(H?.bin ? t.muted : t.dim + "88").tooltip(H?.bin ? `${h.name}: ${H.bin}` : H?.missing ?? h.name)
              .child(svg(h.icon).size(11).flex_none()).child(h.short);
          }))))
        : cols.map((c) => h_flex().id(`mc-col-${c.scope}`).w(CELL).flex_none().gap(4).items_center().justify_center().text_color(t.muted)
          .tooltip(c.scope === "project" ? `${c.h.name}, project ${this.project?.root ?? ""}` : `${c.h.name} user scope on ${c.M.label}`)
          .child(svg(c.h.icon).size(11).flex_none()).child(c.scope === "project" ? "Project" : "User")));
    const note = !cols.length ? (this.mode === "project" ? null : loading ? "Reading hosts…" : "No reachable machine with an agent host.")
      : !rows.length && !loading ? "No MCP server configured." : null;
    return v_flex().flex_1().min_h(0)
      .child(header)
      .child(v_flex().id("mc-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .when(Boolean(note), (el) => el.child(h_flex().px(14).pt(12).gap(10).items_center().text_size(12).text_color(t.dim).child(note)
          .when(!rows.length && cols.length > 0 && !this.adding, (el) => el.child(this.button(t, "mc-empty-add", "Add server", (_e, cx) => this.openAdd(cx), { primary: true })))))
        .children(rows.map((x) => this.row(t, x, cols))));
  }

  row(t, x, cols) {
    const S = x.S;
    return h_flex().id(`mc-row-${x.name}`).flex_none().h(ROW).px(12).items_center().border_b(1).border_color(t.border + "88").hover((s) => s.bg(t.hover + "66"))
      .child(v_flex().flex_1().min_w(0).gap(2).pr(8)
        .child(div().truncate().font_semibold().child(x.name))
        .child(div().truncate().text_size(11).text_color(t.dim).child(`${S.transport} · ${target(S)}`)))
      .children(cols.map((col) => this.cell(t, col, x.name)));
  }

  describe(S, col, st, block, toggle) {
    return [
      `${S.name} · ${col.h.name} on ${col.M.label}`,
      `${S.transport} · ${S.scope}${S.enabled ? "" : " · disabled"}${S.note ? ` · ${S.note}` : ""}`,
      target(S),
      S.envKeys.length ? `env: ${S.envKeys.map((k) => `${k}=•••`).join(", ")}` : null,
      S.headerKeys.length ? `headers: ${S.headerKeys.map((k) => `${k}: •••`).join(", ")}` : null,
      st ? `status: ${st.text}` : col.h.key === "claude" ? "status: Refresh checks it" : null,
      S.file ? `in ${S.file}` : null,
      block ?? "Click to remove",
      toggle ? null : "Claude Code can't switch a server off from outside: use /mcp in a session.",
    ].filter(Boolean).join("\n");
  }

  cell(t, col, name) {
    const { M, h, scope } = col;
    const H = M.hosts[h.key];
    const cid = `${scope}-${M.key}-${h.key}-${name}`;
    const box = div().w(CELL).h_full().flex_none().flex().items_center().justify_center();
    if (!H?.bin) return box.child(div().id(`mc-c-${cid}`).text_color(t.dim + "88").tooltip(H?.missing ?? `${h.name} not available`).child("—"));
    if (H.error) return box.child(div().id(`mc-c-${cid}`).text_color(t.blocked).tooltip(`${h.name} on ${M.label}: ${H.error}`).child("!"));
    const P = this.project;
    const S = this.serversOf(col)[name];
    if (this.busy.has(this.busyKey(col, name)) || (!S && (H.loading || (scope === "project" && P?.loading)))) return box.child(this.spinner(t));
    if (!S) {
      const src = scope === "project" && !P?.root ? null : this.sourceFor(name, col);
      if (!src) return box.child(div().text_color(t.dim + "88").child("·"));
      const from = `${src.col.h.name} on ${src.col.M.label}${src.col.scope === "project" ? " (project)" : ""}`;
      return box.child(this.control(`mc-c-${cid}`).h(22).px(8).flex().items_center().rounded(11).border_1().border_color(t.border).text_size(11)
        .text_color(t.dim).hover((s) => s.border_color(t.accent).text_color(t.foreground))
        .tooltip(`Not in ${h.name} on ${M.label}${scope === "project" ? " (project)" : ""}. Click to copy it from ${from}.`)
        .on_click((_e, cx) => this.copyAsk(cx, name, src, col))
        .child("+ copy"));
    }
    const on = S.enabled;
    const st = this.statusFor(col, name);
    const color = !on ? t.dim : st?.mark === "✗" ? t.blocked : st?.mark === "!" || st?.mark === "⏸" || S.note ? t.working : t.ansi2;
    const block = removeBlock(h.key, S);
    const toggle = canToggle(h.key);
    const tid = `mc-t-${cid}`;
    return box.child(h_flex().h(34).rounded(9).border_1().border_color(color + (on ? "aa" : "66")).bg(color + (on ? "1e" : "0c")).items_center().overflow_hidden()
      .child(this.control(`mc-c-${cid}`, v_flex()).h_full().pl(8).pr(4).justify_center().text_color(on ? t.foreground : t.dim)
        .tooltip(this.describe(S, col, st, block, toggle))
        .when(!block, (el) => el.hover((s) => s.text_color(t.blocked)).on_click((_e, cx) => this.removeAsk(cx, col, S)))
        .child(div().text_size(11).child(`${S.transport}${st ? ` ${st.mark}` : ""}`))
        .child(div().text_size(9.5).text_color(t.dim).child(S.scope)))
      .child((toggle ? this.control(tid) : div().id(tid)).h_full().pl(2).pr(7).flex().items_center()
        .tooltip(toggle ? (on ? "Disable" : "Enable") : (on ? "Enabled" : "Disabled"))
        .when(toggle, (el) => el.on_click((_e, cx) => this.toggle(cx, col, S)))
        .child(div().size(8).rounded(4).border_1().border_color(color).when(on, (el) => el.bg(color)))));
  }

  confirmLayer(t) {
    const C = this.confirm;
    const done = (cx) => { this.confirm = null; cx.notify(); };
    return div().id("mc-confirm").absolute().inset_0().bg(t.background + "b0").flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(v_flex().w(440).p(18).gap(10).rounded(10).bg(t.popover).border_1().border_color(t.input).shadow_lg()
        .child(div().text_size(14.5).font_semibold().child(C.title))
        .when(Boolean(C.detail), (el) => el.child(div().text_size(12).text_color(t.muted).child(C.detail)))
        .when(Boolean(C.warn), (el) => el.child(div().px(10).py(6).rounded(7).bg(t.working + "1c").border_1().border_color(t.working + "66")
          .text_size(12).text_color(t.foreground).child(`⚠ ${C.warn}`)))
        .child(h_flex().pt(6).gap(8).justify_end()
          .child(this.button(t, "mc-no", "Cancel", (_e, cx) => done(cx)))
          .child(this.control("mc-yes").flex().items_center().h(26).px(12).rounded(7).bg(C.danger ? t.blocked : t.solid)
            .text_color(C.danger ? t.background : t.solid_foreground).text_size(12).font_medium()
            .hover((s) => s.opacity(0.88))
            .on_click((_e, cx) => { const go = C.go; this.confirm = null; go(cx); cx.notify(); })
            .child(C.label))));
  }
}
