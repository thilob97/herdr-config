// Quests' local tickets (data/quests/tickets/<id>.md), as bin/hub writes them:
// `---` frontmatter of `key: value` lines, then the markdown body.
import * as fs from "fs/promises";
import { appHome, shared, setShared } from "herdr";

export const ticketsDir = () => `${appHome()}/data/quests/tickets`;
const FIELDS = ["title", "status", "repo", "labels", "due", "machine", "agent", "branch", "base", "worktree", "terminal",
  "source", "checks", "evidence", "merged", "pr", "assignee", "blocked_by", "tags", "waiting", "by", "updated"];

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
  t.status = status;
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  t.updated = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  await fs.writeFile(path, serialize(t));
}

// The orchestrator's summary section that `hub review` appends; it ends where the
// ticket's `## Verlauf` begins.
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

// The orchestrator's tickets as shared("orchestra.tickets") carries them: no body, but its
// summary, its Verlauf, an open question to the human, `checks` (pass|fail|null) and
// `evidence` (paths), newest first.
export async function published() {
  return (await list()).filter((t) => t.by === "orchestrator")
    .map(({ body, checks, evidence, ...t }) => ({
      ...t, summary: summaryOf({ body }), verlauf: verlaufOf({ body }), question: questionOf({ body, waiting: t.waiting }),
      checks: checks || null,
      evidence: (evidence ?? "").split(",").map((p) => p.trim()).filter(Boolean),
    }))
    .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
}

// Publishes them when they changed; returns the list.
export async function publish() {
  const slim = await published();
  if (JSON.stringify(slim) !== JSON.stringify(shared("orchestra.tickets") ?? [])) setShared("orchestra.tickets", slim);
  return slim;
}
