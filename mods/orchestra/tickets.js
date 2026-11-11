// Quests' local tickets (data/quests/tickets/<id>.md), as bin/hub writes them:
// `---` frontmatter of `key: value` lines, then the markdown body.
import * as fs from "fs/promises";
import { appHome } from "herdr";

export const ticketsDir = () => `${appHome()}/data/quests/tickets`;
const FIELDS = ["title", "status", "repo", "labels", "due", "machine", "agent", "branch", "base", "worktree", "terminal",
  "source", "merged", "pr", "by", "updated"];

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

// The orchestrator's summary section that `hub review` appends.
export const summaryOf = (t) => /\n## Zusammenfassung \(Orchestrator\)\n([\s\S]*)$/.exec(t.body ?? "")?.[1]?.trim() ?? "";
