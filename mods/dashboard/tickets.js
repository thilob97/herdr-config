// The orchestrator's tickets as the Start screen draws them, read straight from
// data/quests/tickets/<id>.md — the files the Team panel's daemon publishes as
// shared("orchestra.tickets"). The dashboard layout has no daemon, so without this
// reader the screen kept the copy it first saw; it re-reads the files every 5 s.
// A mod owns no module outside its folder, so this carries only the fields the
// dashboard draws (stage, agent, worktree, checks, Verlauf), not the whole ticket.
import * as fs from "fs/promises";
import { appHome } from "herdr";

export const ticketsDir = () => `${appHome()}/data/quests/tickets`;

// Frontmatter (`key: value`) and body, as bin/hub writes them.
function parse(id, text) {
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

// `hub ticket comment` lines under ## Verlauf, oldest first (same shape as
// mods/orchestra/tickets.js: the section ends at the next `##` heading).
const ENTRY = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · ([^·]+?) · (.*)$/;
export function verlaufOf(body) {
  const text = String(body ?? "");
  const m = /^## Verlauf[ \t]*$/m.exec(text);
  if (!m) return [];
  const tail = text.slice(m.index + m[0].length).split(/^## /m)[0];
  return tail.split(/\r?\n/).map((l) => ENTRY.exec(l.trim())).filter(Boolean)
    .map((x) => ({ ts: x[1], role: x[2].trim(), text: x[3].trim() }));
}

// The latest recorded run under ## Nachtschicht (`hub night` appends one block after a
// run): "- begin → end · n gestartet, m übersprungen". No status file exists, so this
// record is the only place the dashboard can learn about the night shift.
const NIGHT_RUN = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) → (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (\d+) gestartet, (\d+) übersprungen/mg;
export function nightOf(body) {
  let last = null;
  for (const m of String(body ?? "").matchAll(NIGHT_RUN)) {
    last = { begin: m[1], end: m[2], started: Number(m[3]), skipped: Number(m[4]) };
  }
  return last;
}

/** The factory's tickets, newest first. Null when the folder cannot be read. */
export async function read() {
  let names;
  try { names = await fs.readdir(ticketsDir()); } catch { return null; }
  const out = [];
  for (const n of names.filter((x) => x.endsWith(".md"))) {
    try {
      const t = parse(n.slice(0, -3), await fs.readFile(`${ticketsDir()}/${n}`, "utf8"));
      if (t.by !== "orchestrator") continue; // the same filter as tickets.publish()
      t.verlauf = verlaufOf(t.body);
      t.night = nightOf(t.body);
      delete t.body;
      out.push(t);
    } catch {}
  }
  return out.sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")));
}
