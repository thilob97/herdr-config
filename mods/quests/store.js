// The quests mod's own files, all under data/quests/ in the app home (git-ignored: data/ is never tracked):
// settings.json (with the source credentials), started.json (quests started from here) and
// tickets/*.md (plain local tickets, markdown with a small frontmatter).

import * as fs from "fs/promises";
import { appHome } from "herdr";

export const dir = () => `${appHome().replace(/\\/g, "/")}/data/quests`;
const ticketsDir = () => `${dir()}/tickets`;

export const TEMPLATE = `Quest: {title}
Source: {source} {id} {url}

{body}

---
You work in {folder} on the git branch \`{branch}\` (create it from the current HEAD if it doesn't exist yet).
Implement the ticket above: read the relevant code first, make focused changes, run the project's checks, commit in small steps on that branch and do not push. When you are done, summarize what changed and what is still open.`;

export const DEFAULTS = {
  dryRun: false,
  template: TEMPLATE,
  github: { enabled: true, repos: "", mine: false },
  asana: { enabled: false, token: "", api: "https://app.asana.com/api/1.0", workspace: "", projects: "" },
  trilium: { enabled: false, token: "", url: "", query: "#quest" },
  plain: { enabled: true },
};

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJson(path, value) {
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(path, JSON.stringify(value, null, 2));
}

export async function loadSettings() {
  const s = await readJson(`${dir()}/settings.json`, {});
  const out = { ...DEFAULTS, ...s };
  for (const k of ["github", "asana", "trilium", "plain"]) out[k] = { ...DEFAULTS[k], ...(s[k] ?? {}) };
  return out;
}

export const saveSettings = (s) => writeJson(`${dir()}/settings.json`, s);

// Replaces every saved secret in a text (error messages, logs) before it is shown.
export function mask(text, settings) {
  let out = String(text ?? "");
  for (const secret of [settings?.asana?.token, settings?.trilium?.token]) if (secret && secret.length > 3) out = out.split(secret).join("••••");
  return out;
}

export const loadStarted = () => readJson(`${dir()}/started.json`, []);

export async function addStarted(record) {
  const list = await loadStarted();
  list.push(record);
  await writeJson(`${dir()}/started.json`, list);
}

export async function forgetStarted(at) {
  await writeJson(`${dir()}/started.json`, (await loadStarted()).filter((r) => r.at !== at));
}

export const slug = (s, max = 48) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");

// Fills {name} placeholders; unknown ones stay as written.
export const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? "") : m));

// ---- Plain tickets: tickets/<id>.md, `---` frontmatter of `key: value` lines, then the markdown body.

const FIELDS = ["title", "status", "repo", "labels", "due"];
const EXTRA = ["machine", "agent", "agent_cmd", "assignee", "blocked_by", "tags", "waiting", "branch", "base", "worktree", "terminal", "source", "checks", "evidence", "merged", "pr", "by", "updated"];

export function parseTicket(id, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {};
  for (const line of (m?.[1] ?? "").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return {
    source: "plain", id, title: meta.title || id, body: m ? text.slice(m[0].length) : text,
    url: `${ticketsDir()}/${id}.md`, status: meta.status || "todo", repo: meta.repo || "", assignee: meta.assignee || meta.agent || "",
    labels: (meta.labels || "").split(",").map((l) => l.trim()).filter(Boolean), due: meta.due || null, project: meta.repo || "",
    extra: Object.fromEntries(EXTRA.filter((k) => meta[k]).map((k) => [k, meta[k]])),
  };
}

export function serializeTicket(t) {
  const one = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
  const meta = { ...t, labels: (t.labels ?? []).join(", ") };
  // The orchestrator's fields (bin/hub in the orchestra mod) stay as they were.
  const extra = Object.entries(t.extra ?? {}).filter(([k, v]) => EXTRA.includes(k) && v).map(([k, v]) => `${k}: ${one(v)}`);
  return `---\n${[...FIELDS.map((k) => `${k}: ${one(meta[k])}`), ...extra].join("\n")}\n---\n${t.body ?? ""}`;
}

export async function listPlain() {
  let names;
  try { names = await fs.readdir(ticketsDir()); } catch { return []; }
  const out = [];
  for (const n of names.filter((n) => n.endsWith(".md"))) {
    const id = n.slice(0, -3);
    try { out.push(parseTicket(id, await fs.readFile(`${ticketsDir()}/${n}`, "utf8"))); } catch {}
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export async function readPlain(id) {
  return parseTicket(id, await fs.readFile(`${ticketsDir()}/${id}.md`, "utf8"));
}

// Saves a plain ticket; a new one (no id) gets a file name from its title. Returns the id.
export async function savePlain(id, t) {
  await fs.mkdir(ticketsDir(), { recursive: true });
  if (!id) {
    const base = slug(t.title) || "ticket";
    id = base;
    for (let n = 2; await fs.exists(`${ticketsDir()}/${id}.md`); n++) id = `${base}-${n}`;
  }
  await fs.writeFile(`${ticketsDir()}/${id}.md`, serializeTicket(t));
  return id;
}

export const deletePlain = (id) => fs.unlink(`${ticketsDir()}/${id}.md`);

export async function setPlainStatus(id, status) {
  const t = await readPlain(id);
  await savePlain(id, { ...t, status });
}
