// MCP servers of the three agent hosts on one machine: where each keeps them, how to
// read them and how to change them, on this computer or another machine (`on`).
// A machine context `m` is { name: null | "wsl", win: boolean, home: string }.
// Windows runs the found binary directly; Unix machines go through a login
// shell (`bash -lc`) because herdr-core's plain exec PATH lacks ~/.local/bin.
// (Machine probing and running as in the Marketplaces window: a mod can't import another's files.)
//
// Claude Code: ~/.claude.json (mcpServers = user, projects[<root>].mcpServers = local),
//   <root>/.mcp.json (project); `claude mcp add-json|remove --scope`, `claude mcp list` checks health.
// omp:         ~/.omp/agent/mcp.json (user, plus the disabledServers denylist), <root>/.omp/mcp.json
//   (project), <root>/.mcp.json (fallback); no CLI: the files are edited.
// Copilot CLI: ~/.copilot/mcp-config.json (user), <root>/.mcp.json or .github/mcp.json (workspace),
//   plugins, builtin; `copilot mcp list --json|add|remove|enable|disable`.

import { exec, home, readTextFile, writeTextFile } from "herdr";

export const HOSTS = [
  { key: "claude", name: "Claude Code", short: "Claude", icon: "icons/claude.svg", bin: "claude" },
  { key: "omp", name: "omp", short: "omp", icon: "icons/pi.svg", bin: "omp" },
  { key: "copilot", name: "Copilot CLI", short: "Copilot", icon: "icons/copilot.svg", bin: "copilot" },
];
export const hostInfo = (key) => HOSTS.find((h) => h.key === key);

const READ = 60000;
const OMP_SCHEMA = "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";
const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const dirOf = (path) => path.replace(/[\\/][^\\/]*$/, "");
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const localIsWindows = () => /^[A-Za-z]:[\\/]/.test(home());
export const errorText = (e) => String(e?.message ?? e ?? "failed").trim();
const join = (m, dir, ...parts) => {
  const sep = m.win ? "\\" : "/";
  const base = m.win ? dir.replace(/\//g, "\\") : dir;
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
};

// Runs argv on the machine. Resolves with { code, stdout, stderr }.
function run(m, argv, { cwd, timeout = READ } = {}) {
  if (m.win) return exec(argv[0], argv.slice(1), { cwd: cwd || undefined, timeout });
  return exec("bash", ["-lc", argv.map(q).join(" ")], { on: m.name, cwd: cwd || undefined, timeout });
}

// Which host CLIs this machine has, and its home.
export async function probe(m) {
  const bins = {};
  if (m.win) {
    // `where` exits 1 when any name is missing but still prints the ones it found.
    const r = await exec("where", HOSTS.map((h) => h.bin), { timeout: 15000 });
    const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const h of HOSTS) {
      const found = lines.filter((l) => l.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "").toLowerCase() === h.bin);
      const path = found.find((l) => /\.exe$/i.test(l)) ?? found.find((l) => /\.(cmd|bat)$/i.test(l));
      bins[h.key] = path ? { path } : { missing: `${h.name} is not installed here` };
    }
    return { home: home(), bins };
  }
  const script = `for b in ${HOSTS.map((h) => h.bin).join(" ")}; do printf '%s=%s\\n' "$b" "$(command -v "$b" 2>/dev/null)"; done; printf 'HOME=%s\\n' "$HOME"`;
  const r = await exec("bash", ["-lc", script], { on: m.name, timeout: 20000 });
  const vars = Object.fromEntries(r.stdout.split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
  if (!vars.HOME) throw new Error(r.stderr.trim() || `bash exited ${r.code}`);
  for (const h of HOSTS) {
    const path = vars[h.bin];
    // WSL sees Windows' PATH: a /mnt/c shim is the Windows install, not one of this machine's.
    if (path && !path.startsWith("/mnt/")) bins[h.key] = { path };
    else bins[h.key] = { missing: path ? `only the Windows ${h.name} is visible (${path})` : `${h.name} is not installed here` };
  }
  return { home: vars.HOME, bins };
}

// The project an agent works in: its git root, else its folder.
export async function projectRoot(m, cwd) {
  const r = await run(m, ["git", "rev-parse", "--show-toplevel"], { cwd, timeout: 15000 }).catch(() => null);
  const root = r?.code === 0 ? r.stdout.trim() : "";
  return root ? { root: m.win ? root.replace(/\//g, "\\") : root, git: true } : { root: cwd, git: false };
}

async function must(m, argv, opts) {
  const r = await run(m, argv, opts);
  if (r.code !== 0) throw new Error((r.stderr.trim() || r.stdout.trim() || `${argv[0]} exited ${r.code}`).slice(0, 2000));
  return r;
}

// A JSON file's text (null when absent) and data; invalid JSON fails instead of reading as empty,
// so an edit never replaces a file it couldn't parse.
// shortcut: readTextFile reads up to 1 MiB; a bigger ~/.claude.json fails to read, then read it by exec.
async function readJson(m, path) {
  const text = await readTextFile(path, { on: m.name }).catch(() => null);
  if (text == null || !text.trim()) return { text, data: null };
  try { return { text, data: JSON.parse(text) }; } catch { throw new Error(`${path} isn't valid JSON.`); }
}

function parseJson(text) {
  const i = text.search(/[[{]/);
  if (i < 0) throw new Error("no JSON in output");
  return JSON.parse(text.slice(i));
}

// One server as the window shows it. `def` is the full definition, secrets included, kept for
// Copy to…; it is never drawn. Null when its values aren't known (masked, plugin, connector).
function entry(name, raw, scope, { file = null, def = raw, enabled = raw.enabled !== false, note = null } = {}) {
  const url = raw.url ?? null;
  let transport = String(raw.type ?? (url ? "http" : "stdio")).toLowerCase();
  if (transport === "local") transport = "stdio";
  return {
    name, scope, file, note, enabled, transport, url,
    command: raw.command ?? null, args: Array.isArray(raw.args) ? raw.args : [],
    envKeys: Object.keys(raw.env ?? {}), headerKeys: Object.keys(raw.headers ?? {}),
    def: def ? portable(def, transport) : null,
  };
}

// What every host's config accepts: { type, command, args, env, cwd } or { type, url, headers }.
function portable(raw, transport) {
  if (transport === "stdio") {
    const d = { type: "stdio", command: raw.command, args: Array.isArray(raw.args) ? raw.args : [] };
    if (raw.env && Object.keys(raw.env).length) d.env = raw.env;
    if (raw.cwd) d.cwd = raw.cwd;
    return d;
  }
  const d = { type: transport, url: raw.url };
  if (raw.headers && Object.keys(raw.headers).length) d.headers = raw.headers;
  return d;
}

const fromMap = (map, scope, opts) => Object.entries(map ?? {}).filter(([, raw]) => raw && typeof raw === "object").map(([name, raw]) => entry(name, raw, scope, typeof opts === "function" ? opts(name, raw) : opts));
const byName = (list) => Object.fromEntries(list.map((s) => [s.name, s]));
const ompUser = (m) => join(m, m.home, ".omp", "agent", "mcp.json");
const claudeProject = (cj, root) => Object.entries(cj?.projects ?? {}).find(([p]) => norm(p) === norm(root))?.[1] ?? null;

// User-level servers of one host: { name: server }.
export async function readUser(m, key, bin) {
  if (key === "claude") {
    const path = join(m, m.home, ".claude.json");
    const { data } = await readJson(m, path);
    return byName(fromMap(data?.mcpServers, "user", { file: path }));
  }
  if (key === "omp") {
    const path = ompUser(m);
    const { data } = await readJson(m, path);
    const off = new Set(data?.disabledServers ?? []);
    return byName(fromMap(data?.mcpServers, "user", (name, raw) => ({ file: path, enabled: raw.enabled !== false && !off.has(name) })));
  }
  return copilotList(m, bin, m.home, () => true);
}

// Copilot's own listing (enabled state, plugin and builtin servers) with definitions from the
// files: the listing masks env and header values.
async function copilotList(m, bin, cwd, keep, files = {}) {
  const userFile = join(m, m.home, ".copilot", "mcp-config.json");
  const [r, user] = await Promise.all([must(m, [bin, "mcp", "list", "--json"], { cwd }), readJson(m, userFile)]);
  const list = parseJson(r.stdout).mcpServers ?? {};
  const out = {};
  for (const [name, raw] of Object.entries(list)) {
    const scope = String(raw.source ?? "user");
    if (!keep(scope)) continue;
    const own = scope === "user" ? { file: userFile, def: user.data?.mcpServers?.[name] ?? null } : files[name] ?? { file: null, def: null };
    out[name] = entry(name, raw, scope, { ...own, enabled: raw.enabled !== false });
  }
  return out;
}

// Servers a project adds for one host in `root`: { name: server }.
export async function readProject(m, key, bin, root) {
  const mcpJson = join(m, root, ".mcp.json");
  const workspace = await readJson(m, mcpJson);
  if (key === "claude") {
    const path = join(m, m.home, ".claude.json");
    const { data } = await readJson(m, path);
    const p = claudeProject(data, root);
    const on = new Set(p?.enabledMcpjsonServers ?? []);
    const off = new Set(p?.disabledMcpjsonServers ?? []);
    return byName([
      ...fromMap(workspace.data?.mcpServers, "project", (name) => ({
        file: mcpJson, enabled: !off.has(name), note: off.has(name) ? "rejected in Claude Code" : on.has(name) || p?.enableAllProjectMcpServers ? null : "awaits approval in Claude Code",
      })),
      ...fromMap(p?.mcpServers, "local", { file: path }),
    ]);
  }
  if (key === "omp") {
    const path = join(m, root, ".omp", "mcp.json");
    const [own, user] = await Promise.all([readJson(m, path), readJson(m, ompUser(m))]);
    const off = new Set(user.data?.disabledServers ?? []);
    const enabled = (name, raw) => raw.enabled !== false && !off.has(name);
    // omp's project file wins over the fallback .mcp.json.
    return byName([
      ...fromMap(workspace.data?.mcpServers, "workspace", (name, raw) => ({ file: mcpJson, enabled: enabled(name, raw) })),
      ...fromMap(own.data?.mcpServers, "project", (name, raw) => ({ file: path, enabled: enabled(name, raw) })),
    ]);
  }
  const github = join(m, root, ".github", "mcp.json");
  const gh = await readJson(m, github);
  const files = {};
  for (const [file, d] of [[github, gh.data], [mcpJson, workspace.data]]) for (const [name, def] of Object.entries(d?.mcpServers ?? {})) files[name] = { file, def };
  return copilotList(m, bin, root, (scope) => scope === "workspace", files);
}

// Claude Code's health check (`claude mcp list`, seconds per server): { status: { name: { mark, text } },
// extra: { name: server } } for servers no file here names (plugins, claude.ai connectors).
export async function claudeHealth(m, bin, cwd, known) {
  const r = await must(m, [bin, "mcp", "list"], { cwd, timeout: 90000 });
  const status = {};
  const extra = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const x = line.match(/^(.*?): (.*) - (.+)$/);
    if (!x) continue;
    const [, name, target, text] = x;
    const mark = /✔|connected/i.test(text) ? "✓" : /✗|failed/i.test(text) ? "✗" : /⏸|pending/i.test(text) ? "⏸" : "!";
    status[name] = { mark, text: text.replace(/^[✔✗!⏸]\s*/u, "") };
    if (known.has(name)) continue;
    const scope = name.startsWith("plugin:") ? "plugin" : name.startsWith("claude.ai ") ? "claude.ai" : "local";
    const url = /^https?:\/\//.test(target) ? target.replace(/\s*\((HTTP|SSE)\)$/i, "") : null;
    const words = url ? [] : target.split(/\s+/);
    extra[name] = entry(name, url ? { type: /\(SSE\)$/i.test(target) ? "sse" : "http", url } : { command: words[0], args: words.slice(1) }, scope, { def: null });
  }
  return { status, extra };
}

// Edits a JSON file in place: same indentation, other keys kept, refused when it changed since read.
async function editJson(m, path, mutate) {
  const { text, data } = await readJson(m, path);
  const next = data ?? {};
  mutate(next);
  const indent = text?.match(/\n([ \t]+)"/)?.[1] ?? 2;
  const out = `${JSON.stringify(next, null, indent)}\n`;
  if (m.win) {
    try {
      await writeTextFile(path, out, text);
    } catch (e) {
      if (text != null) throw e;
      await exec("cmd", ["/d", "/c", "mkdir", dirOf(path)], { timeout: 10000 }).catch(() => null);
      await writeTextFile(path, out, null);
    }
    return;
  }
  // Written in place (not moved over) so the file keeps its permissions: it may hold tokens.
  const script = '[ "$(cat "$3" 2>/dev/null)" = "$(printf %s "$4")" ] || { echo "$3 changed meanwhile; try again." >&2; exit 3; }; mkdir -p "$1" && printf "%s" "$2" > "$3"';
  await must(m, ["sh", "-c", script, "sh", dirOf(path), out, path, text ?? ""]);
}

const putServer = (name, def, schema) => (d) => {
  if (d.mcpServers?.[name]) throw new Error(`${name} is already there.`);
  if (schema) d.$schema ??= OMP_SCHEMA;
  d.mcpServers = { ...(d.mcpServers ?? {}), [name]: def };
};
const dropServer = (name) => (d) => {
  if (!d.mcpServers?.[name]) throw new Error(`${name} isn't in this file any more.`);
  delete d.mcpServers[name];
};

// Adds a server (portable `def`) at "user" or "project" scope; project needs `root`.
export async function addServer(m, key, bin, scope, name, def, root) {
  if (key === "claude") return must(m, [bin, "mcp", "add-json", name, JSON.stringify(def), "--scope", scope], { cwd: scope === "user" ? m.home : root });
  if (key === "omp") return editJson(m, scope === "user" ? ompUser(m) : join(m, root, ".omp", "mcp.json"), putServer(name, def, true));
  // Copilot CLI adds to its user config only; a workspace server goes into .mcp.json.
  if (scope !== "user") return editJson(m, join(m, root, ".mcp.json"), putServer(name, def, false));
  const flags = [
    ...(def.type === "stdio" ? [] : ["--transport", def.type]),
    ...Object.entries(def.env ?? {}).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    ...Object.entries(def.headers ?? {}).flatMap(([k, v]) => ["--header", `${k}: ${v}`]),
  ];
  return must(m, [bin, "mcp", "add", ...flags, name, ...(def.type === "stdio" ? ["--", def.command, ...def.args] : [def.url])], { cwd: m.home });
}

// Why a server can't be removed here, or null.
export function removeBlock(key, s) {
  if (s.scope === "plugin") return "Comes from a plugin: uninstall the plugin instead.";
  if (s.scope === "builtin") return "Built into Copilot CLI.";
  if (s.scope === "claude.ai") return "A claude.ai connector: manage it at claude.ai.";
  if (!s.file && !(key === "claude" && s.scope === "local")) return "Its config file is unknown.";
  return null;
}

export async function removeServer(m, key, bin, s, root) {
  if (key === "claude") return must(m, [bin, "mcp", "remove", s.name, "--scope", s.scope], { cwd: s.scope === "user" ? m.home : root });
  if (key === "copilot" && s.scope === "user") return must(m, [bin, "mcp", "remove", s.name], { cwd: m.home });
  return editJson(m, s.file, dropServer(s.name));
}

// Whether the window can switch servers on and off: Copilot CLI by its CLI, omp by its files.
// Claude Code has no command for it (only /mcp inside a session).
export const canToggle = (key) => key !== "claude";

export async function toggleServer(m, key, bin, s, on) {
  if (key === "copilot") return must(m, [bin, "mcp", on ? "enable" : "disable", s.name], { cwd: m.home });
  // omp: `enabled` on a definition in its own files; the user denylist for the fallback .mcp.json.
  const own = s.scope !== "workspace";
  if (on) {
    const { data } = await readJson(m, ompUser(m));
    if ((data?.disabledServers ?? []).includes(s.name)) await editJson(m, ompUser(m), (d) => { d.disabledServers = d.disabledServers.filter((n) => n !== s.name); });
    if (own) await editJson(m, s.file, (d) => { if (d.mcpServers?.[s.name]) delete d.mcpServers[s.name].enabled; });
    return;
  }
  if (own) return editJson(m, s.file, (d) => { if (d.mcpServers?.[s.name]) d.mcpServers[s.name].enabled = false; });
  return editJson(m, ompUser(m), (d) => { d.$schema ??= OMP_SCHEMA; d.disabledServers = [...new Set([...(d.disabledServers ?? []), s.name])]; });
}
