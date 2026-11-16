// Sub-agent history (data/agent-cards/subagents.jsonl): a line when omp starts a
// sub-agent, another when it disappears, so a timeline still knows the run after its
// terminal is gone. Text rules only; main.js does the app's file calls.

const HISTORY_MAX = 3000;
const HISTORY_KEEP = 1500;

// The old text plus the new lines; past HISTORY_MAX only the newest HISTORY_KEEP stay.
export function appendHistory(text, lines, max = HISTORY_MAX, keep = HISTORY_KEEP) {
  const rows = String(text ?? "").split("\n").filter((l) => l.trim());
  for (const line of lines) rows.push(JSON.stringify(line));
  return `${(rows.length > max ? rows.slice(-keep) : rows).join("\n")}\n`;
}

// Every sub-agent under a terminal, including the ones a sub-agent started itself.
// `parent` is the terminal for a sub-agent omp started, the parent sub-agent's id
// below that, so a timeline can nest the levels it was handed.
function walkSubs(list, terminal, parent, out = [], ids = new Set()) {
  for (const s of list ?? []) {
    if (!s?.id || ids.has(s.id)) continue;
    ids.add(s.id);
    out.push({ s, parent, terminal });
    walkSubs(s?.children, terminal, s.id, out, ids);
  }
  return out;
}

// Birth lines for ids first seen in this snapshot, end lines for ids gone from it.
// `seen` is the last snapshot's id -> {parent, terminal}; the result carries the next.
export function subagentEvents(seen, omp, at) {
  const current = new Map();
  for (const [terminal, info] of omp) {
    for (const { s, parent } of walkSubs(info.subagents, terminal, terminal)) {
      if (!current.has(s.id)) current.set(s.id, { parent, terminal, s, model: info.model ?? null });
    }
  }
  const lines = [];
  for (const [id, { parent, terminal, s, model }] of current) {
    if (seen.has(id)) continue;
    lines.push({ at, terminal, parent, id, title: s.description || s.agent || "", program: s.agent || "task", model });
  }
  for (const [id, { parent, terminal }] of seen) {
    if (!current.has(id)) lines.push({ at, terminal, parent, id, kind: "end" });
  }
  return { seen: new Map([...current].map(([id, v]) => [id, { parent: v.parent, terminal: v.terminal }])), lines };
}

// One id writes one birth line and one end line; the end needs its own key.
const keyOf = (row) => (row?.kind === "end" ? `${row.id}\u0000end` : row?.id);

// The ids the file already holds; an id is written once, so a restart adds nothing.
function historyIds(text) {
  const ids = new Set();
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const key = keyOf(row);
      if (typeof key === "string" && key) ids.add(key);
    } catch {}
  }
  return ids;
}

// Only the lines whose id is still missing from the file.
export function unseen(text, lines) {
  const ids = historyIds(text);
  return lines.filter((l) => !ids.has(keyOf(l)));
}
