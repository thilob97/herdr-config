// Quests' local tickets (data/quests/tickets/<id>.md), as bin/hub writes them:
// `---` frontmatter of `key: value` lines, then the markdown body.
import * as fs from "fs/promises";
import { appHome, shared, setShared } from "herdr";

export const ticketsDir = () => `${appHome()}/data/quests/tickets`;
const FIELDS = ["title", "status", "repo", "labels", "due", "machine", "owner", "agent", "agent_cmd", "harness", "branch", "base", "base_head", "worktree", "terminal",
  "space", "tab", "source", "type", "size", "priority", "triaged",
  "preflight", "preflight_at", "preflight_head", "preflight_duration",
  "checks", "checks_head", "checks_at", "checks_duration", "checks_exit", "checks_cmd", "verify", "evidence",
  "merged", "pr", "ci", "ci_head", "ci_at", "ci_url", "ci_details",
  "review", "review_head", "review_at", "review_summary", "review_rounds", "reviewer", "reviewer_name", "review_terminal",
  "assignee", "blocked_by", "tags", "waiting", "by", "updated", "created", "status_at", "status_log"];

// Keep in step with STATUSES in bin/hub: only these five states are real tickets; any
// other value would hide the ticket from the board, team panel and stages.
export const STATUSES = ["todo", "doing", "review", "done", "blocked"];

export function parse(id, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const t = { id, body: m ? text.slice(m[0].length) : text };
  for (const line of (m?.[1] ?? "").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) t[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  t.status ||= "todo";
  t.title ||= id;
  return t;
}

export function serialize(t) {
  const one = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
  const head = FIELDS.filter((k) => ["title", "status", "repo", "labels", "due"].includes(k) || t[k]).map((k) => `${k}: ${one(t[k])}`);
  return `---\n${head.join("\n")}\n---\n${t.body ?? ""}`;
}

export async function list() {
  let names;
  try { names = await fs.readdir(ticketsDir()); } catch { return []; }
  const out = [];
  for (const n of names.filter((x) => x.endsWith(".md"))) {
    try { out.push(parse(n.slice(0, -3), await fs.readFile(`${ticketsDir()}/${n}`, "utf8"))); } catch {}
  }
  return out;
}

export async function setStatus(id, status) {
  const path = `${ticketsDir()}/${id}.md`;
  const t = parse(id, await fs.readFile(path, "utf8"));
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  // The same status log `hub` keeps: `hub stats` counts lead time and rework from it.
  const log = String(t.status_log ?? "").split("|").filter(Boolean);
  if (status !== t.status || !log.length) {
    t.status = status;
    t.status_at = stamp;
    if (log.at(-1)?.split("@")[0] !== status) t.status_log = [...log, `${status}@${stamp}`].join("|");
  }
  t.updated = stamp;
  await fs.writeFile(path, serialize(t));
}

// The orchestrator's summary section that `hub review` appends; it ends where the next
// `##` section begins (## Prüfung or the ticket's `## Verlauf`).
export const summaryOf = (t) => /\n## Zusammenfassung \(Orchestrator\)\n([\s\S]*?)(?=\n## |$)/.exec(t.body ?? "")?.[1]?.trim() ?? "";

// `hub ticket comment` lines under `## Verlauf`: `- 2026-11-14 22:04 · rolle · text`,
// oldest first. The section ends at the next `##` heading.
const ENTRY = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · ([^·]+?) · (.*)$/;
export function verlaufOf(t) {
  const body = t?.body ?? "";
  const m = /^## Verlauf[ \t]*$/m.exec(body);
  if (!m) return [];
  const tail = body.slice(m.index + m[0].length).split(/^## /m)[0];
  return tail.split(/\r?\n/).map((l) => ENTRY.exec(l.trim())).filter(Boolean)
    .map((x) => ({ ts: x[1], role: x[2].trim(), text: x[3].trim() }));
}
export const mentionsOf = (text) => [...new Set([...String(text ?? "").matchAll(/@([A-Za-z0-9][A-Za-z0-9_.-]*)/g)].map((m) => m[1]))];

// An open question to the human: the last comment is from someone else and tags
// `@mensch` (or the ticket waits for `mensch` in `waiting`).
export function questionOf(t) {
  const last = verlaufOf(t).at(-1);
  if (!last || last.role === "mensch") return null;
  const waiting = String(t?.waiting ?? "").split(",").map((s) => s.trim());
  return mentionsOf(last.text).includes("mensch") || waiting.includes("mensch") ? last : null;
}

// The head line of ## Prüfung, as fields. The body survives a Quests edit that drops
// the extra frontmatter, so the gate and the chips fall back to it.
const metaFields = (meta) => {
  const parts = String(meta ?? "").split(" · ").map((s) => s.trim()).filter(Boolean);
  const out = {};
  if (/^\d{4}-\d{2}-\d{2}/.test(parts[0] ?? "")) out.at = parts.shift();
  if (parts[0] === "pass" || parts[0] === "fail") out.checks = parts.shift();
  if (/^\d+(?:\.\d+)?\s*s$/.test(parts[0] ?? "")) out.duration = parts.shift().replace(/\s*s$/, "");
  if ((parts[0] ?? "").startsWith("exit ")) out.exit = parts.shift().slice(5).trim();
  if ((parts[0] ?? "").startsWith("HEAD ")) out.head = parts.shift().slice(5).trim();
  if (parts.length) out.cmd = parts.join(" · ");
  return out;
};

// The ## Prüfung section `hub verify` writes: its meta line and the captured output
// (the last 20 lines, in a fence).
export function verifyOf(t) {
  const body = t.body ?? "";
  const m = /^## Prüfung[ \t]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(body);
  if (!m || !m[1].trim()) return null;
  const lines = m[1].replace(/\n+$/, "").split("\n");
  const meta = /^-\s*(.*)$/.exec(lines[0] ?? "")?.[1] ?? "";
  const tail = [];
  let fenced = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) tail.push(line);
  }
  return { meta, tail, fields: metaFields(meta) };
}

// The ## Review section the reviewer's station writes: its meta line
// (`- <at> · pass|fail · Runde n · HEAD <x> · <reviewer>`) and the summary below.
export function reviewOf(t) {
  const body = t.body ?? "";
  const m = /^## Review[ \t]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(body);
  if (!m || !m[1].trim()) return null;
  const lines = m[1].replace(/\n+$/, "").split("\n");
  const meta = /^-\s*(.*)$/.exec(lines[0] ?? "")?.[1] ?? "";
  const parts = meta.split(" · ").map((s) => s.trim()).filter(Boolean);
  const out = {};
  if (/^\d{4}-\d{2}-\d{2}/.test(parts[0] ?? "")) out.at = parts.shift();
  if (parts[0] === "pass" || parts[0] === "fail") out.verdict = parts.shift();
  if ((parts[0] ?? "").startsWith("Runde ")) out.rounds = parts.shift().slice(6).trim();
  if ((parts[0] ?? "").startsWith("HEAD ")) out.head = parts.shift().slice(5).trim();
  if (parts.length) out.reviewer = parts.join(" · ");
  return { meta, summary: lines.slice(1).join("\n").trim(), fields: out };
}

// The last CI comment `hub ci` wrote into ## Verlauf (`--from ci`), for the review window.
export const ciCommentOf = (t) => {
  const all = [...String(t.body ?? "").matchAll(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · ci · (.*)$/gm)];
  return all.length ? all[all.length - 1][1].trim() : "";
};

// The orchestrator's tickets as shared("orchestra.tickets") carries them: no body, but its
// summary, its Verlauf, an open question to the human, `checks` (pass|fail|null), the
// check's run (HEAD, duration, exit, command) with its output tail in `verify`, the CI
// result (`ci`, `ci_at`, `ci_details`, last CI comment) and `evidence` (paths), newest first.
//
// Each ticket also carries its repo's lessons (the human's and the orchestrator's, see
// bin/hub: <repo>/.herdr/lessons.md) and the lesson proposal waiting for the human
// (lessons-pending.md). Both are local-only: a repo on another machine has no path here,
// so the panel shows no count for it.
const LESSON_LINE = /^- (\d{4}-\d{2}-\d{2}) · ([^·]+?) · ([^·]+?) · (.*)$/;
export function parseLessons(text) {
  return String(text ?? "").split(/\r?\n/).map((l) => LESSON_LINE.exec(l.trim())).filter(Boolean)
    .map((m) => ({ date: m[1], ticket: m[2].trim(), source: m[3].trim(), text: m[4].trim() }))
    .filter((l) => l.text);
}
async function readLessons(repo) {
  if (!repo) return null;
  try { if (!(await fs.exists(repo))) return null; } catch { return null; }
  try { return parseLessons(await fs.readFile(`${repo}/.herdr/lessons.md`, "utf8")); } catch { return []; }
}
async function readProposal(repo, id) {
  if (!repo) return null;
  try {
    return parseLessons(await fs.readFile(`${repo}/.herdr/lessons-pending.md`, "utf8")).filter((l) => l.ticket === id).at(-1) ?? null;
  } catch { return null; }
}

export async function published() {
  const rows = (await list()).filter((t) => t.by === "orchestrator")
    .map(({ body, checks, evidence, ...t }) => {
      const verify = verifyOf({ body }), v = verify?.fields ?? {};
      for (const [k, val] of Object.entries({ checks_head: v.head, checks_at: v.at, checks_duration: v.duration,
        checks_exit: v.exit, checks_cmd: v.cmd })) if (!t[k] && val) t[k] = val;
      const review = reviewOf({ body }), r = review?.fields ?? {};
      for (const [k, val] of Object.entries({ review: r.verdict, review_at: r.at, review_head: r.head,
        review_rounds: r.rounds, reviewer: r.reviewer })) if (!t[k] && val) t[k] = val;
      return {
        ...t, summary: summaryOf({ body }), verlauf: verlaufOf({ body }), question: questionOf({ body, waiting: t.waiting }),
        checks: checks || v.checks || null, verify,
        review_summary: t.review_summary || review?.summary || "",
        evidence: (evidence ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        ci_comment: ciCommentOf({ body }),
      };
    })
    .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
  const cache = new Map();
  const lessonsOf = (repo) => {
    if (!cache.has(repo)) cache.set(repo, readLessons(repo));
    return cache.get(repo);
  };
  for (const t of rows) {
    const lessons = await lessonsOf(t.repo ?? "");
    if (lessons) t.lessons = lessons;
    const proposal = await readProposal(t.repo ?? "", t.id);
    if (proposal) t.lessonProposal = proposal;
  }
  return rows;
}

// Publishes them when they changed; returns the list.
export async function publish() {
  const slim = await published();
  if (JSON.stringify(slim) !== JSON.stringify(shared("orchestra.tickets") ?? [])) setShared("orchestra.tickets", slim);
  return slim;
}
