// omp: the limits omp's /usage shows, read from omp's own records
// (helpers/omp-usage.sh, ~/.omp/agent/agent.db usage_history). One provider per
// account kind omp knows; the account omp read most recently wins.
import { makeWindow, okReport, errorReport } from "../lib/report.js";

const SOURCE = "omp /usage";
const HOUR = 3600, DAY = 24 * HOUR;
// omp's window labels → bar label, panel label, length.
const WINDOWS = [
  [/^5 ?h/, "5h", "5-hour", 5 * HOUR],
  [/^1 ?d|^dai/, "day", "Daily", DAY],
  [/^7 ?d|^week/, "wk", "Weekly", 7 * DAY],
  [/^30 ?d|^month/, "mo", "Monthly", 30 * DAY],
];

// A label naming a model group keeps it: "Usage (OpenAI)" → OpenAI, "Gemini gemini-2.5-pro" → gemini-2.5-pro.
function groupOf(label) {
  const m = /\(([^)]+)\)/.exec(label ?? "");
  if (m) return m[1];
  return /^gemini /i.test(label ?? "") ? label.replace(/^gemini /i, "") : null;
}

function windowOf(row) {
  const w = String(row.window_label ?? "").toLowerCase();
  const known = WINDOWS.find(([re]) => re.test(w));
  const group = groupOf(row.label);
  const short = known?.[1] ?? null;
  const long = known?.[2] ?? null;
  const resetsAt = row.resets_at ? row.resets_at / 1000 : null;
  return makeWindow({
    id: `${group ?? ""}:${short ?? (w || "limit")}`,
    short: [group, short].filter(Boolean).join(" ") || row.label,
    long: [group, long].filter(Boolean).join(" · ") || row.label,
    percent: (row.used_fraction ?? 0) * 100,
    resetsAt,
    durationSec: known?.[3] ?? null,
  });
}

export function parse(text, now) {
  let rows;
  try { rows = JSON.parse(text || "[]"); } catch { return errorReport(SOURCE, "Couldn't read omp's usage records", now); }
  if (!Array.isArray(rows) || !rows.length) return errorReport(SOURCE, "No readings from omp", now);
  const account = rows[0].account_key; // newest first
  const seen = new Set();
  const windows = [];
  let observed = 0;
  for (const r of rows) {
    if (r.account_key !== account) continue;
    const w = windowOf(r);
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    windows.push(w);
    observed = Math.max(observed, Math.floor((r.recorded_at ?? 0) / 1000));
  }
  windows.sort((a, b) => (a.durationSec ?? Infinity) - (b.durationSec ?? Infinity));
  return okReport(SOURCE, now, windows, null, observed || now);
}

const omp = (provider, id, name, icon, tint = false) => ({ id, name, icon, tint, helper: "helpers/omp-usage.sh", args: [provider], parse });

// tint: one-colour icons, as Herdr's program table marks them.
export default [
  omp("anthropic", "claude", "Claude", "icons/claude.svg"),
  omp("openai-codex", "codex", "Codex", "icons/codex.svg"),
  omp("google-antigravity", "antigravity", "Antigravity", "icons/antigravity.svg"),
  omp("google-gemini-cli", "gemini", "Gemini CLI", "icons/gemini.svg", true),
  omp("opencode-go", "opencode-go", "OpenCode Go", "icons/opencode.svg", true),
];
