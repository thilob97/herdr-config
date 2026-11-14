// Ticket sources (GitHub issues, Asana tasks, Trilium notes, plain local tickets), one ticket shape for all:
// { source, id, title, body (markdown), url, status, assignee, labels, due, project } (+ repo/number for GitHub),
// and the writeback after a quest starts.

import { exec, spaces, panes } from "herdr";
import * as store from "./store.js";

export const SOURCES = [
  { key: "github", label: "GitHub" },
  { key: "asana", label: "Asana" },
  { key: "trilium", label: "Trilium" },
  { key: "plain", label: "Lokal" },
];
export const label = (key) => SOURCES.find((s) => s.key === key)?.label ?? key;

// The pipeline stage, whatever the source calls it: todo / doing / review / done (as the Team panel).
export function stage(t) {
  const s = String(t.status ?? "").toLowerCase();
  if (/done|closed|complete|erledigt/.test(s)) return "done";
  if (/review|prüf|pruef|abnahme/.test(s)) return "review";
  if (/doing|progress|started|arbeit/.test(s)) return "doing";
  return "todo";
}

const split = (s) => String(s ?? "").split(/[\s,]+/).filter(Boolean);
export const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");

// ---- git and places, as the shipped worktree mod does it

// Where a space is now: its first terminal's live folder, else where it was made.
export function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

export async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

// "owner/name" of every space whose folder has a GitHub origin: [{ repo, space }].
export async function spaceRepos() {
  const all = panes();
  const found = await Promise.all(spaces().map(async (s) => {
    const at = place(s, all);
    if (!at) return null;
    const r = await git(at, ["remote", "get-url", "origin"], s.machine, 10000).catch(() => null);
    const m = r?.ok && /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(r.out);
    return m ? { repo: m[1], space: s.id } : null;
  }));
  return found.filter(Boolean);
}

// ---- loading: each returns { tickets, error?, repos? }

async function github(cfg) {
  const repos = await spaceRepos();
  const names = [...new Set([...split(cfg.repos), ...repos.map((r) => r.repo)])];
  const errors = [];
  const lists = await Promise.all(names.map(async (repo) => {
    const args = ["issue", "list", "--repo", repo, "--state", "open", "--limit", "50", ...(cfg.mine ? ["--assignee", "@me"] : []),
      "--json", "number,title,body,url,state,labels,assignees,milestone"];
    try {
      const r = await exec("gh", args, { timeout: 30000 });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || `gh exited with ${r.code}`);
      return JSON.parse(r.stdout).map((i) => ({
        source: "github", id: `${repo}#${i.number}`, repo, number: i.number, title: i.title, body: i.body ?? "", url: i.url,
        status: String(i.state ?? "open").toLowerCase(), assignee: (i.assignees ?? []).map((a) => a.login).join(", "),
        labels: (i.labels ?? []).map((l) => l.name), due: i.milestone?.dueOn?.slice(0, 10) ?? null, project: repo,
      }));
    } catch (e) { errors.push(`${repo}: ${errorText(e)}`); return []; }
  }));
  return { tickets: lists.flat(), repos, error: errors.join("\n") || null, note: names.length ? null : "Kein Repository: trag eins in den Einstellungen ein oder öffne einen Space in einem GitHub-Checkout." };
}

const asanaBase = (cfg) => (cfg.api || store.DEFAULTS.asana.api).replace(/\/+$/, "");

async function asanaCall(cfg, path, body) {
  const r = await fetch(`${asanaBase(cfg)}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(j?.errors?.[0]?.message ?? `Asana antwortet mit HTTP ${r.status}`);
  return j?.data;
}

const ASANA_FIELDS = "name,notes,permalink_url,completed,assignee.name,due_on,tags.name,projects.name,memberships.section.name";

async function asana(cfg) {
  if (!cfg.token) throw new Error("Kein Asana-Token: trag eins in den Einstellungen ein.");
  const projects = split(cfg.projects);
  let lists;
  if (projects.length) {
    lists = await Promise.all(projects.map((p) => asanaCall(cfg, `/projects/${encodeURIComponent(p)}/tasks?completed_since=now&limit=100&opt_fields=${ASANA_FIELDS}`)));
  } else {
    const ws = cfg.workspace || (await asanaCall(cfg, "/users/me?opt_fields=workspaces.name"))?.workspaces?.[0]?.gid;
    if (!ws) throw new Error("Kein Asana-Workspace gefunden.");
    lists = [await asanaCall(cfg, `/tasks?assignee=me&workspace=${encodeURIComponent(ws)}&completed_since=now&limit=100&opt_fields=${ASANA_FIELDS}`)];
  }
  const seen = new Map();
  for (const t of lists.flat()) if (t?.gid) seen.set(t.gid, t);
  return {
    tickets: [...seen.values()].map((t) => ({
      source: "asana", id: t.gid, title: t.name ?? "", body: t.notes ?? "", url: t.permalink_url ?? "",
      status: t.completed ? "done" : t.memberships?.find((m) => m.section)?.section?.name ?? "open",
      assignee: t.assignee?.name ?? "", labels: (t.tags ?? []).map((x) => x.name), due: t.due_on ?? null,
      project: (t.projects ?? []).map((p) => p.name).join(", "),
    })),
  };
}

const triliumBase = (cfg) => String(cfg.url ?? "").replace(/\/+$/, "").replace(/\/etapi$/, "");

async function triliumCall(cfg, path, method = "GET", body) {
  const r = await fetch(`${triliumBase(cfg)}/etapi${path}`, {
    method,
    headers: { Authorization: cfg.token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) {
    let m = null;
    try { m = JSON.parse(text).message; } catch {}
    throw new Error(m ?? `Trilium antwortet mit HTTP ${r.status}`);
  }
  return text;
}

// shortcut: tags only, no real HTML→markdown; good enough for an agent's first message, use a converter if notes get rich.
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<\/(p|div|h\d|li|tr|pre|blockquote)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "- ")
    .replace(/<h(\d)[^>]*>/gi, (_m, n) => "#".repeat(Number(n)) + " ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// Labels the ticket fields already show (or the writeback owns) stay out of its label chips.
const OWN_LABELS = ["questStatus", "questBranch", "quest", "assignee", "due", "project"];

async function trilium(cfg) {
  if (!cfg.url) throw new Error("Keine Trilium-URL: trag sie in den Einstellungen ein.");
  if (!cfg.token) throw new Error("Kein Trilium-ETAPI-Token: trag eins in den Einstellungen ein.");
  const found = JSON.parse(await triliumCall(cfg, `/notes?search=${encodeURIComponent(cfg.query || "#quest")}&limit=100`));
  // shortcut: one content request per note (≤100); fetch lazily on selection if lists get big.
  const tickets = await Promise.all((found.results ?? []).map(async (n) => {
    const labels = (n.attributes ?? []).filter((a) => a.type === "label");
    const value = (name) => labels.find((a) => a.name === name)?.value || null;
    const html = n.type === "text" || n.type === "code" ? await triliumCall(cfg, `/notes/${encodeURIComponent(n.noteId)}/content`).catch(() => "") : "";
    return {
      source: "trilium", id: n.noteId, title: n.title ?? n.noteId, body: n.type === "code" ? html : htmlToText(html),
      url: `${triliumBase(cfg)}/#root/${n.noteId}`, status: value("questStatus") ?? "todo", assignee: value("assignee") ?? "",
      labels: labels.filter((a) => !OWN_LABELS.includes(a.name)).map((a) => (a.value ? `${a.name}=${a.value}` : a.name)),
      due: value("due"), project: value("project") ?? "",
    };
  }));
  return { tickets };
}

export async function load(key, settings) {
  const cfg = settings[key];
  if (key === "github") return github(cfg);
  if (key === "asana") return asana(cfg);
  if (key === "trilium") return trilium(cfg);
  return { tickets: await store.listPlain() };
}

// ---- writeback after a start: returns one line per step done (or, in dry run, what would be done).

export async function writeback(t, q, settings) {
  const dry = settings.dryRun;
  const text = `Quest started in Herdr: branch \`${q.branch}\`${q.worktree ? " (new worktree)" : ""} on ${q.machine ?? "this PC"}, agent ${q.agent}.`;
  const out = [];
  if (t.source === "github") {
    const steps = [
      ["issue", "comment", String(t.number), "--repo", t.repo, "--body", text],
      ["issue", "edit", String(t.number), "--repo", t.repo, "--add-assignee", "@me"],
    ];
    if (dry) {
      // A read-only call proves the issue is reachable with this gh login.
      const v = await exec("gh", ["issue", "view", String(t.number), "--repo", t.repo, "--json", "number,state"], { timeout: 30000 });
      if (v.code !== 0) throw new Error((v.stderr || v.stdout).trim() || "gh issue view fehlgeschlagen");
      return [`gh issue view ok (${v.stdout.trim()})`, ...steps.map((a) => `würde ausführen: gh ${a.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ")}`)];
    }
    for (const a of steps) {
      const r = await exec("gh", a, { timeout: 30000 });
      if (r.code !== 0) throw new Error(`gh ${a[1]}: ${(r.stderr || r.stdout).trim()}`);
      out.push(`gh issue ${a[1]} ✓`);
    }
  } else if (t.source === "asana") {
    if (dry) return [`würde senden: POST ${asanaBase(settings.asana)}/tasks/${t.id}/stories: ${text}`];
    await asanaCall(settings.asana, `/tasks/${encodeURIComponent(t.id)}/stories`, { data: { text } });
    out.push("Asana-Kommentar ✓");
  } else if (t.source === "trilium") {
    const cfg = settings.trilium;
    const labels = [["questStatus", "doing"], ["questBranch", q.branch]];
    if (dry) return labels.map(([n, v]) => `würde Label ${n}=${v} an ${t.id} setzen`);
    const note = JSON.parse(await triliumCall(cfg, `/notes/${encodeURIComponent(t.id)}`));
    for (const [name, value] of labels) {
      const have = (note.attributes ?? []).find((a) => a.type === "label" && a.name === name && a.noteId === t.id);
      if (have) await triliumCall(cfg, `/attributes/${encodeURIComponent(have.attributeId)}`, "PATCH", { value });
      else await triliumCall(cfg, "/attributes", "POST", { noteId: t.id, type: "label", name, value, isInheritable: false });
      out.push(`label ${name}=${value} ✓`);
    }
  } else if (t.source === "plain") {
    if (dry) return ["würde den Status auf doing setzen"];
    await store.setPlainStatus(t.id, "doing");
    out.push("status doing ✓");
  }
  return out;
}
