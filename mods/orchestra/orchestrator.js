// The orchestrator: one hidden agent terminal named "orchestrator" (no Herdr
// space; the Team panel is its home, peek opens it). It works in
// ~/.herdr/orchestrator, whose AGENTS.md/CLAUDE.md are copied from
// mods/orchestra/orchestrator.md at every start, with bin/hub on its PATH.
// Team agents it starts with `hub dispatch` are its hc children.
import { terminals, exec, hc, home, appHome, knownAgents, shared, setShared } from "herdr";

export const NAME = "orchestrator";
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export const find = () => terminals().find((x) => x.name === NAME && x.state === "live") ?? null;
export const agentKey = () => shared("orchestra.agent") ?? "omp";

export async function start() {
  const ws = `${home()}/.herdr/orchestrator`, mod = `${appHome()}/mods/orchestra`;
  const prep = await exec("sh", ["-c", `mkdir -p ${q(ws)} && cp ${q(`${mod}/orchestrator.md`)} ${q(`${ws}/AGENTS.md`)} && cp ${q(`${mod}/orchestrator.md`)} ${q(`${ws}/CLAUDE.md`)} && printf %s "\${SHELL:-/bin/sh}"`]);
  if (prep.code !== 0) throw new Error((prep.stderr || prep.stdout).trim() || "Arbeitsordner nicht anlegbar");
  const shell = prep.stdout.trim() || "/bin/sh";
  const known = await knownAgents().catch(() => []);
  const run = known.find((a) => a.key === agentKey() && a.installed)?.run ?? [agentKey()];
  // A login shell (the user's PATH), hub in front; a shell stays when the agent exits.
  const argv = [shell, "-lic", `export PATH=${q(`${mod}/bin`)}:"$PATH"; "$@"; exec "$0" -li`, shell, ...run];
  const r = await hc(["run", "--bg", "--json", "--keep", "--no-parent", "--name", NAME, "--cwd", ws, "--label", "hub.role=orchestrator", "--", ...argv]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
  return JSON.parse(r.stdout).address;
}

// Ends it and waits (briefly) until it has exited, so its name is free again.
export async function stop() {
  await hc(["kill", NAME]);
  await hc(["wait", NAME, "--timeout", "5"]).catch(() => null);
}

export async function send(text) {
  const o = find();
  if (!o) throw new Error("Orchestrator läuft nicht");
  const r = await hc(["send", NAME, text, ...(o.status === "blocked" ? ["--force"] : [])]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
}

const plain = (s) => s.replace(/[\uE000-\uF8FF\u{10000}-\u{10FFFF}]\s*/gu, "");

// The last lines of its screen (no history: while it works, hc marks history
// reads incomplete), trailing blanks and hc's own markers dropped.
export async function screen(lines) {
  const r = await hc(["read", NAME, "--lines", "0"]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
  return plain(r.stdout).replace(/\s+$/, "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => !l.startsWith("[hc]")).slice(-lines);
}

// What a person wants to see of its screen: the step it is on (the spinner
// line while it works) and its last message (the last paragraph of plain text:
// no tool boxes, no logo or tips, no prompt and status line, no startup notes).
const BOX = /^\s*[│╭╰╮╯├┤─━┃┌└]/;
const NOISE = /^(Connected to MCP servers|Updated to v|Tip:|Loaded |Welcome)/;
export function digest(lines) {
  const keep = lines.filter((l) => !/^\s{12,}\S/.test(l) && !/▶|~\/\.herdr\/orchestrator/.test(l));
  let step = null;
  const spin = keep.map((l) => /^\s*[⎋⠀-⣿◐◓◑◒⟳]\s+(.+?)\s*$/.exec(l)).filter(Boolean).pop();
  if (spin && !/>\s/.test(spin[1])) step = spin[1].replace(/…$/, "");
  const message = [];
  for (let i = keep.length - 1; i >= 0; i--) {
    const l = keep[i], text = l.trim();
    if (!text) { if (message.length) break; continue; }
    if (BOX.test(l) || NOISE.test(text) || /^[⎋⠀-⣿]/.test(text) || /^π\b/.test(text)) { if (message.length) break; continue; }
    message.unshift(text);
  }
  return { step, message: message.slice(-6) };
}

export function setAutostart(on) { setShared("orchestra.autostart", on); }
export const autostart = () => shared("orchestra.autostart") !== false;
