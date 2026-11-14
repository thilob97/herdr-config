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
const HERE = "Dieser Computer";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4, GAP_S = 6, GAP_M = 8, GAP_L = 12, GAP_XL = 16;
const INSET_PANEL = 14;
const H_HEADER = 42, H_BTN = 26, H_BTN_S = 22, H_INPUT = 30, H_ROW = 28;
const T_XS = 10.5, T_S = 11, T_M = 12, T_L = 13, T_XL = 15;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Theme colour + alpha suffix (5.4); a theme colour that is already translucent stays as it is.
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + a : c);

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
    this.addName = InputState.new({ placeholder: "Name" });
    this.addCmd = InputState.new({ placeholder: "Befehl und Argumente, z. B. npx -y @upstash/context7-mcp" });
    this.addUrl = InputState.new({ placeholder: "https://example.com/mcp" });
    this.addKv = TextareaState.new({ placeholder: "Optional, eins pro Zeile: KEY=value (env für stdio) oder Header: value (http/sse)", rows: 2 });
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
      name: m.name, key: m.name ?? "", label: m.name ?? HERE, win: local && localIsWindows(), home: local ? home() : null,
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
      this.project = this.agent ? { error: "Dieser Agent läuft nicht mehr.", servers: {} } : null;
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
        notify({ title: "Gesundheitscheck von Claude Code fehlgeschlagen", body: errorText(e).slice(0, 900), level: "error", timeout: 15000 });
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
        notify({ title: `${label} fehlgeschlagen`, body: errorText(e).slice(0, 900), level: "error", timeout: 20000 });
      }
      await this.readHostInto(cx, M, hostKey);
      if (this.mode === "project") await this.loadProject(cx, { quiet: true });
      if (ok) this.hints.add(`${M.key}|${hostKey}`);
      this.busy.delete(busyKey);
      cx.notify();
    });
  }

  ask(cx, title, detail, label, go, { warn = null } = {}) {
    this.confirm = { title, detail, label, go, warn };
    this.handle.focus();
    cx.notify();
  }

  busyKey(col, name) {
    return `${col.M.key}|${col.h.key}|${name}|${col.scope}`;
  }

  removeAsk(cx, col, S) {
    const { M, h } = col;
    const shared = S.file && /[\\/]\.mcp\.json$/.test(S.file) && !/[\\/]\.omp[\\/]/.test(S.file);
    const where = h.key === "claude" && S.scope !== "project" ? `Claude Codes Scope ${S.scope} (claude mcp remove)` : S.file ?? `${h.name}, Scope ${S.scope}`;
    this.ask(cx, `${S.name} aus ${h.name} auf ${M.label} entfernen?`,
      `Entfernt ihn aus ${where}.${shared ? " Claude Code, Copilot CLI und omp lesen alle diese Datei." : ""}`, "Entfernen",
      (cx) => this.act(cx, this.busyKey(col, S.name), `${S.name} entfernen`, M, h.key, () => removeServer(M, h.key, M.hosts[h.key].bin, S, this.rootFor(col))));
  }

  toggle(cx, col, S) {
    const { M, h } = col;
    const on = !S.enabled;
    this.act(cx, this.busyKey(col, S.name), `${S.name} ${on ? "einschalten" : "ausschalten"}`, M, h.key, () => toggleServer(M, h.key, M.hosts[h.key].bin, S, on));
  }

  copyAsk(cx, name, src, col) {
    const { M, h } = col;
    const def = src.S.def;
    const scope = col.scope === "project" ? "project" : "user";
    const vals = Object.keys(def.env ?? def.headers ?? {}).length;
    const warn = def.type === "stdio" && src.col.M !== M
      ? `Er startet "${def.command}" auf ${M.label}: den Befehl gibt es dort vielleicht nicht${src.col.M.win !== M.win ? " (Befehle und Pfade unter Windows und Linux unterscheiden sich)" : ""}.`
      : null;
    const detail = [
      `Fügt ${name} (${def.type}) zu ${h.name} auf ${M.label} hinzu, ${scope === "project" ? `Projekt ${this.project.root}` : "Benutzer-Scope"}.`,
      vals ? `${plural(vals, def.env ? "Umgebungsvariable wird" : "Header wird", def.env ? "Umgebungsvariablen werden" : "Header werden")} mit Wert kopiert.` : null,
    ].filter(Boolean).join(" ");
    const from = `${src.col.h.name} auf ${src.col.M.label}${src.col.scope === "project" ? " (Projekt)" : ""}`;
    this.ask(cx, `${name} von ${from} kopieren?`, detail, "Kopieren",
      (cx) => this.act(cx, this.busyKey(col, name), `${name} nach ${h.name} auf ${M.label} kopieren`, M, h.key,
        () => addServer(M, h.key, M.hosts[h.key].bin, scope, name, def, this.rootFor(col))),
      { warn });
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
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) return { error: "Name: nur Buchstaben, Ziffern, '.', '_' und '-'." };
    const pairs = {};
    const lines = this.addKv.value().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const x = lines[i].match(/^\s*([^\s=:]+)\s*[=:]\s*(.*?)\s*$/);
      if (!x) return { error: `Zeile ${i + 1} ist weder KEY=value noch Header: value.` };
      pairs[x[1]] = x[2];
    }
    const has = Object.keys(pairs).length > 0;
    if (A.transport === "stdio") {
      const argv = words(this.addCmd.value().trim());
      if (!argv.length) return { error: "Gib den Befehl ein, der den Server startet." };
      return { name, def: { type: "stdio", command: argv[0], args: argv.slice(1), ...(has ? { env: pairs } : {}) } };
    }
    const url = this.addUrl.value().trim();
    if (!/^https?:\/\/\S+$/.test(url)) return { error: "Gib die http(s)-URL des Servers ein." };
    return { name, def: { type: A.transport, url, ...(has ? { headers: pairs } : {}) } };
  }

  addGo(cx) {
    const A = this.adding;
    if (!A || A.busy) return;
    const { name, def, error } = this.addDef();
    if (error) { A.error = error; cx.notify(); return; }
    const targets = this.targets().filter((x) => A.targets.has(x.id));
    if (!targets.length) { A.error = "Wähle mindestens einen Host."; cx.notify(); return; }
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
            failures.push(`${hostInfo(key).name} auf ${M.label}: ${errorText(e)}`);
          }
          await this.readHostInto(cx, M, key);
        }
      }));
      if (this.mode === "project") await this.loadProject(cx, { quiet: true });
      if (failures.length) notify({ title: `${name} hinzufügen fehlgeschlagen`, body: failures.join("\n\n").slice(0, 1200), level: "error", timeout: 20000 });
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
      .text_size(T_M)
      // The body waits on its own ("lädt …" in its note): one spinner, not two.
      .child(this.titleBar(t, loading && !(this.mode === "user" && !cols.length)))
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

  // Segment (5.6): container h 26, entries h 22, T_S.
  segment(t, id, options, value, onPick, tip) {
    return h_flex().id(id).h(H_BTN).p(2).gap(2).items_center().rounded(8).bg(t.background).border_1().border_color(t.border)
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .children(options.map(([key, label, disabled]) => this.control(`${id}-${key}`).h(H_BTN_S).px(8).flex().items_center().rounded(6).text_size(T_S)
        .bg(value === key ? t.selected : t.background).text_color(value === key ? t.foreground : t.muted)
        .when(Boolean(disabled), (el) => el.opacity(0.4))
        .when(!disabled, (el) => el.hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => onPick(cx, key)))
        .child(label)));
  }

  spinner(t, size = 12) {
    return svg(SPINNER).size(size).flex_none().text_color(t.dim).spin(900);
  }

  // A checkbox (radius 4): solid when on.
  check(t, on) {
    return div().size(12).flex_none().rounded(4).border_1().border_color(on ? t.solid : t.input).when(on, (el) => el.bg(t.solid));
  }

  // Window title row (5.6): like a panel head, chrome background, Close last.
  titleBar(t, showLoading) {
    const off = [...this.machines.values()].filter((M) => M.state === "unreachable" || M.state === "error");
    const healthErr = this.readyMachines().filter((M) => M.hosts.claude?.healthError).map((M) => `${M.label}: ${M.hosts.claude.healthError}`);
    return h_flex().flex_none().h(H_HEADER).px(INSET_PANEL).gap(GAP_M).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().text_size(T_L).font_semibold().child("MCP-Server"))
      .child(this.segment(t, "mode", [["user", "Benutzer"], ["project", "Projekt"]], this.mode, (cx, mode) => this.setMode(cx, mode),
        "Scope: für den Benutzer oder für das Projekt eines Agents"))
      .child(div().flex_1())
      .when(off.length > 0, (el) => el.child(div().id("mc-off").text_size(T_S).text_color(t.muted)
        .tooltip(off.map((M) => `${M.label}: ${M.error ?? "nicht erreichbar"}`).join("\n"))
        .child(`${off.map((M) => M.label).join(", ")} nicht erreichbar`)))
      .when(healthErr.length > 0, (el) => el.child(div().id("mc-health-err").text_size(T_S).text_color(t.blocked).tooltip(healthErr.join("\n")).child("Gesundheitscheck fehlgeschlagen")))
      .when(showLoading, (el) => el.child(this.spinner(t)))
      // Same as the Marketplaces window: adding is an icon button in the title row.
      .child(this.button(t, "mc-add", null, (_e, cx) => (this.adding ? ((this.adding = null), cx.notify()) : this.openAdd(cx)), { icon: "mods/workspace-chrome/plus.svg", tip: "MCP-Server hinzufügen" }))
      .child(this.button(t, "mc-refresh", null, (_e, cx) => this.refresh(cx, true), { icon: "mods/git-graph/icons/refresh.svg", tip: "Alles neu einlesen und die Server von Claude Code prüfen (dauert ein paar Sekunden)" }))
      .child(this.button(t, "mc-close", null, () => this.close(), { icon: "mods/pane/close.svg", tip: "Schließen (Esc)" }));
  }

  hintRows(t) {
    const live = agents();
    return [...this.hints].flatMap((key) => {
      const [mkey, hostKey] = key.split("|");
      const running = live.filter((a) => hostOf(a) === hostKey && (machineOf(a.address) ?? "") === mkey);
      if (!running.length) return [];
      const names = running.map(agentLabel).slice(0, 4).join(", ") + (running.length > 4 ? ` +${running.length - 4}` : "");
      const how = hostKey === "omp" ? " (oder /mcp reload)" : "";
      return [h_flex().id(`hint-${key}`).flex_none().mx(INSET_PANEL).mt(GAP_M).pl(10).pr(GAP_XS).py(GAP_XS).gap(GAP_M).items_center().rounded(8)
        .bg(t.working + "26").text_size(T_S)
        .child(div().text_color(t.working).child("↻"))
        .child(div().flex_1().min_w(0).truncate()
          .child(`Wirkt erst nach Neustart von ${hostInfo(hostKey).name}${how} auf ${mkey || HERE}. Laufend: ${names}`))
        .child(this.button(t, `hint-x-${key}`, null, (_e, cx) => { this.hints.delete(key); cx.notify(); }, { icon: "mods/pane/close.svg", tip: "Ausblenden", small: true }))];
    });
  }

  agentBar(t) {
    const choices = this.agentChoices();
    const P = this.project;
    const sel = choices.find((c) => c.a.address === this.agent);
    const info = !sel ? (choices.length ? "Wähle einen Agent: sein Host und Repository bekommen Server im Projekt-Scope." : "Keine Agents laufen.")
      : P?.error ? P.error
      : [`${hostInfo(sel.host)?.name ?? "?"} auf ${sel.mkey || HERE}`, P?.root ? `${P.root}${P.git ? "" : " (kein Git-Repository: sein Ordner)"}` : sel.cwd ?? ""].filter(Boolean).join(" · ");
    const note = sel?.host === "claude" ? "Projekt: .mcp.json · lokal: ~/.claude.json"
      : sel?.host === "omp" ? "Projekt: .omp/mcp.json · Workspace: .mcp.json"
      : sel?.host === "copilot" ? "Workspace: .mcp.json oder .github/mcp.json" : null;
    return v_flex().flex_none().px(INSET_PANEL).py(GAP_M).gap(GAP_S).border_b(1).border_color(t.border)
      .child(h_flex().id("mc-agents").flex_wrap().gap(GAP_S).children(choices.map((c) => {
        const on = c.a.address === this.agent;
        const pic = programIcon(c.a.program, 16, t.foreground);
        // Identity chip (5.6).
        return this.control(`mc-ag-${c.a.address}`).flex().flex_none().items_center().gap(GAP_XS).h(H_BTN_S).px(GAP_S).rounded(6)
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

  // Input field (5.6): h 30, px 10, radius 6, background, input border.
  field(t, state, flex = true) {
    return h_flex().when(flex, (el) => el.flex_1()).min_w(0).h(H_INPUT).px(10).rounded(6).bg(t.background).border_1().border_color(t.input).items_center()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).flex_1().h_full().text_size(T_M).text_color(t.foreground));
  }

  addPanel(t) {
    const A = this.adding;
    const targets = this.targets();
    const project = this.mode === "project";
    return v_flex().flex_none().px(INSET_PANEL).py(GAP_M).gap(GAP_M).bg(t.surface).border_b(1).border_color(t.border)
      .child(h_flex().gap(GAP_M).items_center()
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("MCP-Server hinzufügen"))
        .child(this.field(t, this.addName, false).w(170))
        .child(this.segment(t, "mc-tr", TRANSPORTS.map((x) => [x, x]), A.transport, (cx, x) => { A.transport = x; cx.notify(); }, "Transport"))
        .child(div().flex_1())
        .child(A.busy ? h_flex().gap(GAP_S).items_center().text_size(T_S).child(this.spinner(t)).child(div().text_color(t.dim).child("fügt hinzu …"))
          : this.button(t, "mc-add-go", "Hinzufügen", (_e, cx) => this.addGo(cx), { primary: true }))
        .child(this.button(t, "mc-add-cancel", "Abbrechen", (_e, cx) => { this.adding = null; cx.notify(); })))
      .child(this.field(t, A.transport === "stdio" ? this.addCmd : this.addUrl))
      .child(div().h(48).px(10).py(GAP_XS).rounded(6).bg(t.background).border_1().border_color(t.input)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Textarea.new(this.addKv).size_full().text_size(T_M).text_color(t.foreground)))
      .child(h_flex().flex_wrap().gap(GAP_S).items_center()
        .child(div().text_size(T_S).text_color(t.muted).child("in"))
        .children(targets.map((x) => {
          const on = A.targets.has(x.id);
          return this.control(`mc-tg-${x.id}`).flex().items_center().gap(GAP_S).h(H_BTN_S).px(8).rounded(6)
            .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.dim).text_size(T_S).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { on ? A.targets.delete(x.id) : A.targets.add(x.id); cx.notify(); })
            .child(this.check(t, on))
            .child(svg(hostInfo(x.key).icon).size(12).flex_none())
            .child(`${hostInfo(x.key).short} · ${x.M.label}`);
        }))
        .when(!targets.length, (el) => el.child(div().text_size(T_S).text_color(t.dim).child(project ? "Wähle zuerst einen laufenden Agent." : "Keine Maschine mit einem Agent.")))
        .child(div().flex_1())
        .child(this.segment(t, "mc-scope", [["user", "Benutzer"], ["project", "Projekt", !project]], A.scope, (cx, s) => { A.scope = s; cx.notify(); }, "Scope")))
      .when(Boolean(A.error), (el) => el.child(div().text_size(T_S).text_color(t.blocked).child(A.error)));
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
    const header = h_flex().flex_none().h(46).px(INSET_PANEL).items_end().pb(GAP_S).border_b(1).border_color(t.border).text_size(T_S).text_color(t.muted)
      .child(div().flex_1().min_w(0).child(plural(rows.length, "Server", "Server")))
      .children(this.mode === "user"
        ? groups.map((g) => v_flex().w(CELL * g.n).flex_none().gap(GAP_XS)
          .child(div().mx(GAP_XS).pb(2).border_b(1).border_color(t.border).text_color(t.muted).font_medium().text_center().child(g.M.label))
          .child(h_flex().children(HOSTS.map((h) => {
            const H = g.M.hosts[h.key];
            return h_flex().id(`mc-col-${g.M.key}-${h.key}`).w(CELL).flex_none().gap(GAP_XS).items_center().justify_center()
              .text_color(H?.bin ? t.muted : tint(t.dim, "88")).tooltip(H?.bin ? `${h.name}: ${H.bin}` : H?.missing ?? h.name)
              .child(svg(h.icon).size(12).flex_none()).child(h.short);
          }))))
        : cols.map((c) => h_flex().id(`mc-col-${c.scope}`).w(CELL).flex_none().gap(GAP_XS).items_center().justify_center().text_color(t.muted)
          .tooltip(c.scope === "project" ? `${c.h.name}, Projekt ${this.project?.root ?? ""}` : `${c.h.name}, Benutzer-Scope auf ${c.M.label}`)
          .child(svg(c.h.icon).size(12).flex_none()).child(c.scope === "project" ? "Projekt" : "Benutzer")));
    const note = !cols.length ? (this.mode === "project" ? null : loading ? "lädt …" : "Keine erreichbare Maschine mit einem Agent-Host.")
      : !rows.length && !loading ? "Kein MCP-Server eingerichtet." : null;
    return v_flex().flex_1().min_h(0)
      .child(header)
      .child(v_flex().id("mc-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .when(Boolean(note), (el) => el.child(h_flex().h(H_ROW).px(INSET_PANEL).mt(GAP_S).gap(GAP_M).items_center().text_size(T_S).text_color(t.dim).child(note)
          .when(!rows.length && cols.length > 0 && !this.adding, (el) => el.child(this.control("mc-empty-add").text_size(T_S).text_color(t.muted)
            .hover((s) => s.text_color(t.foreground)).tooltip("MCP-Server hinzufügen")
            .on_click((_e, cx) => this.openAdd(cx)).child("Server hinzufügen")))))
        .children(rows.map((x) => this.row(t, x, cols))));
  }

  row(t, x, cols) {
    const S = x.S;
    return h_flex().id(`mc-row-${x.name}`).flex_none().h(ROW).px(INSET_PANEL).items_center().border_b(1).border_color(tint(t.border, "88")).hover((s) => s.bg(t.hover))
      .child(v_flex().flex_1().min_w(0).gap(2).pr(GAP_M)
        .child(div().truncate().font_semibold().child(x.name))
        .child(div().truncate().text_size(T_S).text_color(t.muted).child(`${S.transport} · ${target(S)}`)))
      .children(cols.map((col) => this.cell(t, col, x.name)));
  }

  describe(S, col, st, block, toggle) {
    return [
      `${S.name} · ${col.h.name} auf ${col.M.label}`,
      `${S.transport} · ${S.scope}${S.enabled ? "" : " · aus"}${S.note ? ` · ${S.note}` : ""}`,
      target(S),
      S.envKeys.length ? `env: ${S.envKeys.map((k) => `${k}=•••`).join(", ")}` : null,
      S.headerKeys.length ? `Header: ${S.headerKeys.map((k) => `${k}: •••`).join(", ")}` : null,
      st ? `Status: ${st.text}` : col.h.key === "claude" ? "Status: Neu einlesen prüft ihn" : null,
      S.file ? `in ${S.file}` : null,
      block ?? "Klick entfernt ihn",
      toggle ? null : "Claude Code kann einen Server nicht von außen ausschalten: /mcp in einer Session benutzen.",
    ].filter(Boolean).join("\n");
  }

  cell(t, col, name) {
    const { M, h, scope } = col;
    const H = M.hosts[h.key];
    const cid = `${scope}-${M.key}-${h.key}-${name}`;
    const box = div().w(CELL).h_full().flex_none().flex().items_center().justify_center();
    if (!H?.bin) return box.child(div().id(`mc-c-${cid}`).text_color(tint(t.dim, "88")).tooltip(H?.missing ?? `${h.name} nicht verfügbar`).child("—"));
    if (H.error) return box.child(div().id(`mc-c-${cid}`).text_color(t.blocked).tooltip(`${h.name} auf ${M.label}: ${H.error}`).child("!"));
    const P = this.project;
    const S = this.serversOf(col)[name];
    if (this.busy.has(this.busyKey(col, name)) || (!S && (H.loading || (scope === "project" && P?.loading)))) return box.child(this.spinner(t));
    if (!S) {
      const src = scope === "project" && !P?.root ? null : this.sourceFor(name, col);
      if (!src) return box.child(div().text_color(tint(t.dim, "88")).child("·"));
      const from = `${src.col.h.name} auf ${src.col.M.label}${src.col.scope === "project" ? " (Projekt)" : ""}`;
      return box.child(this.control(`mc-c-${cid}`).h(H_BTN_S).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).text_size(T_S)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(`Nicht in ${h.name} auf ${M.label}${scope === "project" ? " (Projekt)" : ""}. Klick kopiert ihn von ${from}.`)
        .on_click((_e, cx) => this.copyAsk(cx, name, src, col))
        .child("+ kopieren"));
    }
    const on = S.enabled;
    const st = this.statusFor(col, name);
    const color = !on ? t.dim : st?.mark === "✗" ? t.blocked : st?.mark === "!" || st?.mark === "⏸" || S.note ? t.working : t.done;
    const block = removeBlock(h.key, S);
    const toggle = canToggle(h.key);
    const tid = `mc-t-${cid}`;
    return box.child(h_flex().h(34).rounded(6).bg(on ? color + "26" : t.raised).items_center().overflow_hidden()
      .child(this.control(`mc-c-${cid}`, v_flex()).h_full().pl(8).pr(GAP_XS).justify_center().text_color(on ? t.foreground : t.dim)
        .tooltip(this.describe(S, col, st, block, toggle))
        .when(!block, (el) => el.hover((s) => s.text_color(t.blocked)).on_click((_e, cx) => this.removeAsk(cx, col, S)))
        .child(div().text_size(T_S).child(`${S.transport}${st ? ` ${st.mark}` : ""}`))
        .child(div().text_size(T_XS).text_color(t.dim).child(S.scope)))
      .child((toggle ? this.control(tid) : div().id(tid)).h_full().pl(2).pr(GAP_S).flex().items_center()
        .tooltip(toggle ? (on ? "Ausschalten" : "Einschalten") : (on ? "An" : "Aus"))
        .when(toggle, (el) => el.on_click((_e, cx) => this.toggle(cx, col, S)))
        .child(div().size(7).rounded_full().border_1().border_color(color).when(on, (el) => el.bg(color)))));
  }

  // Confirmation (5.6 dialog): title, detail, an optional warning, Abbrechen and the one primary action.
  confirmLayer(t) {
    const C = this.confirm;
    const done = (cx) => { this.confirm = null; cx.notify(); };
    return div().id("mc-confirm").absolute().inset_0().bg(tint(t.background, "88")).flex().items_center().justify_center()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(v_flex().w(440).p(GAP_XL).gap(GAP_L).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_lg()
        .child(div().text_size(T_XL).font_semibold().child(C.title))
        .when(Boolean(C.detail), (el) => el.child(div().text_size(T_M).text_color(t.muted).child(C.detail)))
        .when(Boolean(C.warn), (el) => el.child(div().px(10).py(GAP_S).rounded(8).bg(t.working + "26")
          .text_size(T_M).text_color(t.foreground).child(`⚠ ${C.warn}`)))
        .child(h_flex().gap(GAP_M).justify_end()
          .child(this.button(t, "mc-no", "Abbrechen", (_e, cx) => done(cx)))
          .child(this.button(t, "mc-yes", C.label, (_e, cx) => { const go = C.go; this.confirm = null; go(cx); cx.notify(); }, { primary: true }))));
  }
}
