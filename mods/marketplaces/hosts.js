// The three agent hosts and how each one's CLI lists, installs and removes
// marketplace plugins, on this computer or another machine (`on`).
// A machine context `m` is { name: null | "wsl", win: boolean, home: string }.
// Windows runs the found binary directly; Unix machines go through a login
// shell (`bash -lc`) because herdr-core's plain exec PATH lacks ~/.local/bin.

import { exec, home, readTextFile, writeTextFile } from "herdr";

export const HOSTS = [
  { key: "claude", name: "Claude Code", short: "Claude", icon: "icons/claude.svg", bin: "claude", project: "cli" },
  { key: "omp", name: "omp", short: "omp", icon: "icons/pi.svg", bin: "omp", project: "cli" },
  { key: "copilot", name: "Copilot CLI", short: "Copilot", icon: "icons/copilot.svg", bin: "copilot", project: "settings" },
];
export const hostInfo = (key) => HOSTS.find((h) => h.key === key);

// Installs and marketplace adds clone repositories: give them room.
const LONG = 240000;
const READ = 60000;

export const localIsWindows = () => /^[A-Za-z]:[\\/]/.test(home());
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const errorText = (e) => String(e?.message ?? e ?? "failed").trim();
// A path compared across tools: Windows gives C:/x, C:\x and c:\x for one folder.
export const samePath = (a, b) => Boolean(a && b) && norm(a) === norm(b);
const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
export const join = (m, dir, ...parts) => {
  const sep = m.win ? "\\" : "/";
  const base = m.win ? dir.replace(/\//g, "\\") : dir;
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
};
const dirOf = (m, path) => path.replace(m.win ? /[\\/][^\\/]*$/ : /\/[^/]*$/, "");

// Runs argv on the machine. Resolves with { code, stdout, stderr }.
export function run(m, argv, { cwd, timeout = READ } = {}) {
  if (m.win) return exec(argv[0], argv.slice(1), { cwd: cwd || undefined, timeout });
  return exec("bash", ["-lc", argv.map(q).join(" ")], { on: m.name, cwd: cwd || undefined, timeout });
}

// Runs and fails with the program's own words when it exits nonzero.
async function must(m, argv, opts) {
  const r = await run(m, argv, opts);
  if (r.code !== 0) throw new Error((r.stderr.trim() || r.stdout.trim() || `${argv[0]} exited ${r.code}`).slice(0, 2000));
  return r;
}

// JSON from a CLI that may print a notice line before it.
function parseJson(text) {
  const i = text.search(/[[{]/);
  if (i < 0) throw new Error("no JSON in output");
  return JSON.parse(text.slice(i));
}

async function readJson(m, path) {
  const text = await readTextFile(path, { on: m.name }).catch(() => null);
  if (text == null || !text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
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
      bins[h.key] = path ? { path } : { missing: `${h.name} ist hier nicht installiert` };
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
    else bins[h.key] = { missing: path ? `nur das Windows-${h.name} ist sichtbar (${path})` : `${h.name} ist hier nicht installiert` };
  }
  return { home: vars.HOME, bins };
}

// User-scope state of one host: configured marketplaces and installed plugins.
// Marketplace: { name, repo, source, clone, catalogFile, isDefault }.
// installed: { "name@marketplace": { version, enabled } }.
export async function readHost(m, key, bin) {
  if (key === "claude") {
    const [ml, pl] = await Promise.all([
      must(m, [bin, "plugin", "marketplace", "list", "--json"]),
      must(m, [bin, "plugin", "list", "--json"], { cwd: m.home }),
    ]);
    const marketplaces = parseJson(ml.stdout).map((x) => ({
      name: x.name, repo: x.repo ?? null, source: x.repo ?? x.url ?? x.path ?? String(x.source ?? ""),
      clone: x.installLocation ?? null, catalogFile: null,
    }));
    const installed = {};
    for (const p of parseJson(pl.stdout)) if (p.scope === "user") installed[p.id] = { version: p.version ?? null, enabled: p.enabled !== false };
    return { marketplaces, installed };
  }
  if (key === "omp") {
    const [reg, pl] = await Promise.all([
      readJson(m, join(m, m.home, ".omp", "marketplaces.json")),
      must(m, [bin, "plugin", "list", "--json"], { cwd: m.home }),
    ]);
    let marketplaces;
    if (Array.isArray(reg?.marketplaces)) {
      marketplaces = reg.marketplaces.map((x) => ({
        name: x.name, repo: x.sourceType === "github" ? x.sourceUri : null, source: x.sourceUri ?? "",
        catalogFile: x.catalogPath ?? null, clone: x.catalogPath ? dirOf(m, x.catalogPath) : null,
      }));
    } else {
      // No registry file where omp keeps it by default (XDG, profiles): its text listing.
      const r = await must(m, [bin, "plugin", "marketplace", "list"]);
      marketplaces = r.stdout.split(/\r?\n/).map((l) => l.match(/^\s{2}(\S+)\s+(\S+)\s*$/)).filter(Boolean)
        .map(([, name, source]) => ({ name, source, repo: /^[\w.-]+\/[\w.-]+$/.test(source) ? source : null, clone: null, catalogFile: null }));
    }
    const installed = {};
    const json = parseJson(pl.stdout);
    for (const p of json.marketplace ?? []) {
      const e = (p.entries ?? []).find((x) => x.scope === "user");
      if (e) installed[p.id] = { version: e.version ?? null, enabled: e.enabled !== false };
    }
    // Extensions installed straight from npm (`omp install <pkg>`), outside any marketplace.
    const npm = {};
    for (const p of json.npm ?? []) npm[p.name] = { version: p.version ?? null, enabled: p.enabled !== false };
    return { marketplaces, installed, npm };
  }
  const [ml, pl] = await Promise.all([
    must(m, [bin, "plugin", "marketplace", "list", "--json"]),
    must(m, [bin, "plugin", "list", "--json"], { cwd: m.home }),
  ]);
  const marketplaces = parseJson(ml.stdout).map((x) => {
    const repo = String(x.source ?? "").match(/^GitHub:\s*(\S+)/)?.[1] ?? null;
    return { name: x.name, repo, source: repo ?? String(x.source ?? ""), clone: null, catalogFile: null, isDefault: Boolean(x.isDefault) };
  });
  const installed = {};
  for (const p of parseJson(pl.stdout)) {
    if (p.source === "installed" && p.marketplace) installed[`${p.name}@${p.marketplace}`] = { version: p.version ?? null, enabled: p.enabled !== false };
  }
  return { marketplaces, installed };
}

const scopeFlag = (key, scope) => (key === "omp" ? [`--scope=${scope}`] : key === "claude" ? ["--scope", scope] : []);

// Plugin actions at user scope (all hosts) or project scope (claude, omp: cwd is the project).
// known: the host already has the marketplace; repo: where to add it from when not.
export async function pluginAction(m, key, bin, op, { id, scope = "user", cwd, known, repo }) {
  const [name, market] = id.split("@");
  if (op === "install" && !known) {
    if (!repo) throw new Error(`${hostInfo(key).name} doesn't have the marketplace ${market}, and its source is unknown.`);
    // Claude adds a missing marketplace (user settings) as part of the install.
    if (key === "claude") return must(m, [bin, "plugin", "install", name, "--marketplace", repo, ...scopeFlag(key, scope)], { cwd, timeout: LONG });
    await must(m, [bin, "plugin", "marketplace", "add", repo], { timeout: LONG });
  }
  const args = op === "install" ? ["plugin", "install", id] : ["plugin", op, id];
  if (op === "install" && key === "omp") {
    try {
      return await must(m, [bin, ...args, ...scopeFlag(key, scope)], { cwd, timeout: LONG });
    } catch (e) {
      const pkg = errorText(e).match(/conflicts with installed package "([^"]+)"/)?.[1];
      if (pkg) throw new Error(`omp already has ${pkg} as an npm package. Switch it to the marketplace version instead (click its "npm" cell).`);
      throw e;
    }
  }
  return must(m, [bin, ...args, ...scopeFlag(key, scope)], { cwd, timeout: op === "install" ? LONG : READ });
}

export async function marketplaceAction(m, key, bin, op, { source, name, force }) {
  if (op === "add") return must(m, [bin, "plugin", "marketplace", "add", source, ...(key === "claude" ? ["--scope", "user"] : [])], { timeout: LONG });
  if (op === "update") return must(m, [bin, "plugin", "marketplace", "update", name], { timeout: LONG });
  return must(m, [bin, "plugin", "marketplace", "remove", name, ...(key === "copilot" && force ? ["--force"] : [])], { timeout: READ });
}

// An npm package that omp has for a marketplace plugin: same name, or <scope>/<name>.
export const npmFor = (npm, plugin) => Object.keys(npm ?? {}).find((pkg) => pkg === plugin || pkg.endsWith(`/${plugin}`)) ?? null;

// Replace omp's npm copy of a plugin with the marketplace one: remove the package, then install.
export async function switchToMarketplace(m, bin, pkg, opts) {
  await must(m, [bin, "plugin", "uninstall", pkg], { timeout: READ });
  return pluginAction(m, "omp", bin, "install", opts);
}

// The project an agent works in: its git root, else its folder.
export async function projectRoot(m, cwd) {
  const r = await run(m, ["git", "rev-parse", "--show-toplevel"], { cwd, timeout: 15000 }).catch(() => null);
  const root = r?.code === 0 ? r.stdout.trim() : "";
  return root ? { root: m.win ? root.replace(/\//g, "\\") : root, git: true } : { root: cwd, git: false };
}

// Project-scope state for one host in `root`: { "name@mkt": { status: "enabled" | "disabled", version?, scope, declared? } }.
export async function readProject(m, key, bin, root) {
  const state = {};
  if (key === "claude" || key === "copilot") {
    // Claude Code and Copilot CLI both read the repository's .claude/settings.json.
    const files = key === "claude" ? [["project", "settings.json"], ["local", "settings.local.json"]] : [["project", "settings.json"]];
    for (const [scope, file] of files) {
      const s = await readJson(m, join(m, root, ".claude", file));
      for (const [id, on] of Object.entries(s?.enabledPlugins ?? {})) state[id] = { status: on ? "enabled" : "disabled", scope, declared: true };
    }
  }
  if (key === "claude") {
    const r = await must(m, [bin, "plugin", "list", "--json"], { cwd: root });
    for (const p of parseJson(r.stdout)) {
      if ((p.scope !== "project" && p.scope !== "local") || !samePath(p.projectPath, root)) continue;
      state[p.id] = { status: p.enabled === false ? "disabled" : "enabled", version: p.version ?? null, scope: p.scope };
    }
  }
  if (key === "omp") {
    const r = await must(m, [bin, "plugin", "list", "--json"], { cwd: root });
    for (const p of parseJson(r.stdout).marketplace ?? []) {
      const e = (p.entries ?? []).find((x) => x.scope === "project");
      if (e) state[p.id] = { status: e.enabled === false ? "disabled" : "enabled", version: e.version ?? null, scope: "project" };
    }
  }
  return state;
}

// Copilot CLI has no project scope flag: set (true / false) or drop (null) a plugin in the
// repository's .claude/settings.json, as the marketplace README documents
// (extraKnownMarketplaces + enabledPlugins). Other keys stay as they were.
export async function editProjectSettings(m, root, id, repo, value) {
  const dir = join(m, root, ".claude");
  const path = join(m, dir, "settings.json");
  const before = await readTextFile(path, { on: m.name }).catch(() => null);
  let data = {};
  if (before != null && before.trim()) {
    try { data = JSON.parse(before); } catch { throw new Error(`${path} isn't valid JSON; fix it first.`); }
  }
  const market = id.split("@")[1];
  if (value != null) {
    data.enabledPlugins = { ...(data.enabledPlugins ?? {}), [id]: value };
    if (value && repo && !data.extraKnownMarketplaces?.[market]) {
      data.extraKnownMarketplaces = { ...(data.extraKnownMarketplaces ?? {}), [market]: { source: { source: "github", repo } } };
    }
  } else if (data.enabledPlugins) {
    delete data.enabledPlugins[id];
  }
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (m.win) {
    try {
      await writeTextFile(path, text, before);
    } catch (e) {
      if (before != null) throw e;
      await exec("cmd", ["/d", "/c", "mkdir", dir], { timeout: 10000 }).catch(() => null);
      await writeTextFile(path, text, null);
    }
    return;
  }
  await must(m, ["sh", "-c", 'mkdir -p "$1" && printf "%s" "$2" > "$3"', "sh", dir, text, path]);
}
