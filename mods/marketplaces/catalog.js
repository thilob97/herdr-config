// A marketplace's catalog (.claude-plugin/marketplace.json and friends): from a
// host's local clone when one exists, else from GitHub through `gh`, else from
// Copilot's own browse listing. Contents (skills, commands, agents) are counted
// from the clone's git tree or GitHub's, one listing per marketplace.

import { readTextFile } from "herdr";
import { run, join, errorText } from "./hosts.js";

const CATALOGS = [".claude-plugin/marketplace.json", ".omp-plugin/marketplace.json", ".github/plugin/marketplace.json"];

// sources: [{ m, clone, catalogFile, repo, copilotBin }] in preference order.
// local: this computer's machine context, where `gh` runs.
export async function loadCatalog(name, sources, local) {
  const errors = [];
  for (const s of sources) {
    if (!s.clone && !s.catalogFile) continue;
    const files = s.catalogFile ? [s.catalogFile] : CATALOGS.map((f) => join(s.m, s.clone, ...f.split("/")));
    for (const file of files) {
      const text = await readTextFile(file, { on: s.m.name }).catch(() => null);
      if (!text) continue;
      try {
        const cat = shape(JSON.parse(text), name);
        cat.from = `Klon von ${s.host}${s.m.name ? ` auf ${s.m.name}` : ""}`;
        cat.repo = s.repo ?? null;
        const paths = s.clone ? await gitTree(s.m, s.clone) : null;
        if (paths) count(cat, paths);
        else if (s.repo) await githubCounts(cat, local, s.repo);
        return cat;
      } catch (e) {
        errors.push(`${file}: ${errorText(e)}`);
      }
    }
  }
  const repo = sources.find((s) => s.repo)?.repo;
  if (repo) {
    for (const file of CATALOGS) {
      const r = await run(local, ["gh", "api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/${file}`]).catch((e) => ({ code: -1, stderr: errorText(e), stdout: "" }));
      if (r.code !== 0) { errors.push(`gh ${file}: ${(r.stderr || r.stdout).trim().split(/\r?\n/)[0]}`); continue; }
      try {
        const cat = shape(JSON.parse(r.stdout), name);
        cat.from = "GitHub (gh api)";
        cat.repo = repo;
        await githubCounts(cat, local, repo);
        return cat;
      } catch (e) {
        errors.push(`gh ${file}: ${errorText(e)}`);
      }
    }
  }
  const cop = sources.find((s) => s.copilotBin);
  if (cop) {
    const r = await run(cop.m, [cop.copilotBin, "plugin", "marketplace", "browse", name, "--json"]).catch(() => null);
    if (r?.code === 0) {
      try {
        const list = JSON.parse(r.stdout.slice(r.stdout.search(/[[{]/)));
        return { name, description: null, from: "Copilot-Browse (nur Namen)", repo: repo ?? null, plugins: list.map((p) => ({ name: p.name, description: p.description ?? "", version: null, category: null, keywords: [], counts: null, sourcePath: null })) };
      } catch {}
    }
  }
  throw new Error(errors.length ? errors.slice(-3).join("\n") : "Kein lokaler Klon und keine GitHub-Quelle, aus der der Katalog zu lesen wäre.");
}

function shape(json, name) {
  if (!json || !Array.isArray(json.plugins)) throw new Error("kein Marketplace-Katalog (keine plugins-Liste)");
  const root = String(json.metadata?.pluginRoot ?? json.pluginRoot ?? "").replace(/^\.\//, "").replace(/\/$/, "");
  const plugins = json.plugins.filter((p) => p && typeof p.name === "string").map((p) => {
    let sourcePath = null;
    if (typeof p.source === "string") {
      const src = p.source.replace(/\/$/, "");
      sourcePath = src.startsWith("./") ? src.slice(2) : root ? `${root}/${src}` : src;
    }
    return {
      name: p.name,
      description: String(p.description ?? ""),
      version: p.version ?? null,
      category: p.category ?? null,
      keywords: Array.isArray(p.keywords) ? p.keywords : Array.isArray(p.tags) ? p.tags : [],
      counts: null,
      sourcePath,
      external: typeof p.source === "object" ? p.source?.repo ?? p.source?.url ?? p.source?.source ?? "external" : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { name: json.name ?? name, description: json.metadata?.description ?? json.description ?? null, plugins };
}

async function gitTree(m, clone) {
  const r = await run(m, ["git", "-C", clone, "ls-tree", "-r", "--name-only", "HEAD"], { timeout: 30000 }).catch(() => null);
  return r?.code === 0 ? r.stdout.split(/\r?\n/) : null;
}

async function githubCounts(cat, local, repo) {
  const r = await run(local, ["gh", "api", `repos/${repo}/git/trees/HEAD?recursive=1`, "--jq", ".tree[].path"], { timeout: 30000 }).catch(() => null);
  if (r?.code === 0) count(cat, r.stdout.split(/\r?\n/));
}

// skills/<name>/SKILL.md, commands/**/*.md and agents/*.md under each plugin's folder.
function count(cat, paths) {
  const byPlugin = new Map(cat.plugins.filter((p) => p.sourcePath).map((p) => [`${p.sourcePath}/`, p]));
  for (const p of byPlugin.values()) p.counts = { skills: 0, commands: 0, agents: 0 };
  for (const path of paths) {
    const slash = path.search(/\/(skills|commands|agents)\//);
    if (slash < 0) continue;
    const p = byPlugin.get(path.slice(0, slash + 1));
    if (!p) continue;
    const rest = path.slice(slash + 1);
    if (/^skills\/[^/]+\/SKILL\.md$/i.test(rest)) p.counts.skills++;
    else if (/^commands\/.+\.md$/i.test(rest)) p.counts.commands++;
    else if (/^agents\/[^/]+\.md$/i.test(rest)) p.counts.agents++;
  }
}
