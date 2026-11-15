// The orchestrator: one agent terminal per Herdr space, the factory of that space.
// `hub orchestrator start` starts it (cwd ~/.herdr/orchestrator, whose AGENTS.md is
// copied from mods/orchestra/orchestrator.md, labels hub.role=orchestrator and
// hub.space=<space id>), so the app and the command line take the same path.
import { terminals, exec, hc, appHome, spaces, focused, shared, setShared } from "herdr";

export const NAME = "orchestrator";
export const agentKey = () => shared("orchestra.agent") ?? "omp";

/** The space this window shows: the active one, else the focused terminal's. */
export function spaceId() {
  return spaces().find((s) => s.active)?.id ?? focused()?.space ?? "";
}

/** The orchestrator of the current space — never another factory's. */
export const find = () => {
  const sid = spaceId();
  const live = terminals().filter((x) => x.state === "live");
  const role = (x) => x.labels?.["hub.role"] === "orchestrator" || x.name === NAME;
  if (sid) return live.find((x) => (x.labels?.["hub.space"] === sid || x.labels?.["herdr.space"] === sid) && role(x)) ?? null;
  // A home without space labels keeps the one orchestrator it has.
  return live.find((x) => !x.labels?.["hub.space"] && role(x)) ?? null;
};

export async function start() {
  // `hub orchestrator start` druckt immer JSON; ein `--json` kennt es nicht.
  const argv = ["orchestrator", "start", "--agent", agentKey()];
  const sid = spaceId();
  if (sid) argv.push("--space", sid);
  const r = await exec(`${appHome()}/mods/orchestra/bin/hub`, argv);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || "Orchestrator nicht startbar");
  try {
    return JSON.parse(r.stdout).terminal ?? "";
  } catch {
    return "";
  }
}

// Ends it and waits (briefly) until it has exited, so its name is free again.
export async function stop() {
  const o = find();
  if (!o) return;
  await hc(["kill", o.address]);
  await hc(["wait", o.address, "--timeout", "5"]).catch(() => null);
}

export async function send(text) {
  const o = find();
  if (!o) throw new Error("Orchestrator läuft nicht");
  const r = await hc(["send", o.address, text, ...(o.status === "blocked" ? ["--force"] : [])]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
}

const plain = (s) => s.replace(/[\uE000-\uF8FF\u{10000}-\u{10FFFF}]\s*/gu, "");

// The last lines of its screen (no history: while it works, hc marks history
// reads incomplete), trailing blanks and hc's own markers dropped.
export async function screen(lines) {
  const o = find();
  if (!o) throw new Error("Orchestrator läuft nicht");
  const r = await hc(["read", o.address, "--lines", "0"]);
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
    // Blank lines separate paragraphs of the same message: skip them, stop at tool boxes.
    if (!text) continue;
    if (BOX.test(l) || NOISE.test(text) || /^[⎋⠀-⣿]/.test(text) || /^π\b/.test(text)) { if (message.length) break; continue; }
    message.unshift(text);
  }
  return { step, message: message.slice(-5) };
}

export function setAutostart(on) { setShared("orchestra.autostart", on); }
export const autostart = () => shared("orchestra.autostart") !== false;
