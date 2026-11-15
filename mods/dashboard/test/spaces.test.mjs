// Die reine Regel der Bereichswahl (mods/dashboard/spaces.js): Auswahl, Farben,
// Zuordnung eines Tickets, Summe mehrerer `hub stats`.
//   node --test mods/dashboard/test/spaces.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { pickOf, effective, toggle, seriesOf, ticketSpace, mergeStats, median, OWN, SOME, ALL,
  workspaceRows, workspaceOf, agentWorkspace } from "../spaces.js";

const SPACES = [
  { id: "spa", name: "Alpha", folder: "/repos/alpha" },
  { id: "spb", name: "Beta", folder: "/repos/beta" },
];

test("ohne Wahl gilt 'Dieser Workspace'", () => {
  assert.deepEqual(pickOf(undefined), { mode: OWN, ids: [] });
  assert.deepEqual(pickOf({ mode: "quatsch", ids: ["spa"] }), { mode: OWN, ids: [] });
  assert.deepEqual(pickOf({ mode: SOME, ids: [] }), { mode: OWN, ids: [] });
});

test("die Auswahl zeigt genau ihre Spaces", () => {
  assert.deepEqual([...effective({ mode: OWN, ids: [] }, "spb", ["spa", "spb"])], ["spb"]);
  assert.deepEqual([...effective({ mode: SOME, ids: ["spa"] }, "spb", ["spa", "spb"])], ["spa"]);
  assert.deepEqual([...effective({ mode: ALL, ids: [] }, "spb", ["spa", "spb"])], ["spa", "spb"]);
});

test("ohne eigenen Space zeigt 'Dieser Workspace' alles statt nichts", () => {
  assert.deepEqual([...effective({ mode: OWN, ids: [] }, "", ["spa", "spb"])], ["spa", "spb"]);
  assert.equal(effective({ mode: OWN, ids: [] }, "", []).size, 0);
});

test("ein Chip schaltet an und aus; leer fällt auf den eigenen Space zurück", () => {
  const ids = ["spa", "spb", "spc"];
  // Aus "Dieser Workspace" (spb) wird mit spa eine Überlagerung.
  assert.deepEqual(toggle({ mode: OWN, ids: [] }, "spa", "spb", ids), { mode: SOME, ids: ["spa", "spb"] });
  // Alle an = "Alle".
  assert.deepEqual(toggle({ mode: SOME, ids: ["spa", "spb"] }, "spc", "spb", ids), { mode: ALL, ids: [] });
  // Den letzten abwählen heißt wieder "Dieser Workspace", nie eine leere Fläche.
  assert.deepEqual(toggle({ mode: SOME, ids: ["spa"] }, "spa", "spb", ids), { mode: OWN, ids: [] });
  // Aus "Alle" heraus einen abwählen: die übrigen bleiben gewählt.
  assert.deepEqual(toggle({ mode: ALL, ids: [] }, "spa", "spb", ids), { mode: SOME, ids: ["spb", "spc"] });
});

test("jeder Space behält seine Farbe, zwei Spaces nie dieselbe", () => {
  const a = seriesOf(["spa", "spb"]);
  assert.notEqual(a.get("spa"), a.get("spb"));
  // Reihenfolge und Doppelte ändern nichts.
  assert.deepEqual([...seriesOf(["spb", "spa", "spa"])], [...a]);
  // Ein dritter Space lässt die beiden ersten unberührt (eigener Platz frei).
  const b = seriesOf(["spa", "spb", "spc"]);
  assert.equal(b.get("spa"), a.get("spa"));
  assert.equal(b.get("spb"), a.get("spb"));
  // Sieben Spaces: die Reihe wiederholt sich erst dann.
  assert.equal(seriesOf(["s1", "s2", "s3", "s4", "s5", "s6", "s7"]).size, 7);
});

test("ein Ticket gehört dem Space, den sein space_name nennt", () => {
  assert.equal(ticketSpace({ space: "spa", space_name: "Alpha", repo: "/repos/beta/x" }, SPACES), "spa");
});

test("ein Alt-Ticket gehört dem Space, dessen Ordner sein repo enthält", () => {
  // Ohne space_name zählt der alte `space` nicht (er war der Agent-Space).
  assert.equal(ticketSpace({ space: "spz", repo: "/repos/beta/work" }, SPACES), "spb");
  // Der längste passende Ordner gewinnt.
  const nested = [...SPACES, { id: "spc", name: "Beta-UI", folder: "/repos/beta/ui" }];
  assert.equal(ticketSpace({ repo: "/repos/beta/ui/sub" }, nested), "spc");
  // Kein Ordner, kein Space: "ohne Workspace".
  assert.equal(ticketSpace({ repo: "/woanders" }, SPACES), "");
  // Ein Ticket einer anderen Maschine zählt nicht für einen lokalen Space.
  assert.equal(ticketSpace({ repo: "/repos/beta", machine: "vm" }, SPACES), "");
});

test("Median wie hub: eine Nachkommastelle, null ohne Wert", () => {
  assert.equal(median([]), null);
  assert.equal(median([3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([10, 2, 4]), 4);
});

const stats = (space, { done, cost, tickets }) => ({
  space, space_name: space,
  at: 1, today: { date: "2026-11-15", done, median_min: 30, rework: 0, cost },
  history: [{ date: "2026-11-15", done, rework: 0, cost }],
  summary: { tickets: tickets.length, done, rework: 0, cost },
  tickets,
});

test("ein einzelner Space kommt unverändert von hub", () => {
  const one = stats("spa", { done: 1, cost: 2, tickets: [] });
  assert.equal(mergeStats([one]), one);
  assert.equal(mergeStats([]), null);
});

test("überlagert addieren Zähler und Kosten, der Median ist der der vereinigten Tickets", () => {
  // `hub stats` schreibt `done_at` in Sekunden (Ticket-Stempel), nicht Millisekunden.
  const at = (h) => new Date(2026, 10, 15, h, 0).getTime() / 1000;
  const a = stats("spa", { done: 1, cost: 1.5, tickets: [
    { id: "t1", status: "done", done_at: at(9), lead_min: 30 },
  ] });
  const b = stats("spb", { done: 2, cost: 0.25, tickets: [
    { id: "t2", status: "done", done_at: at(10), lead_min: 90 },
  ] });
  const out = mergeStats([a, b]);
  assert.equal(out.today.done, 3);
  assert.equal(out.today.cost, 1.75);
  // Median der Leads 30 und 90 (die dritte Zeile in `today.done` kam aus hubs Zähler,
  // gehört aber nicht zu `tickets` — deshalb hier nur die zwei Zeilen).
  assert.equal(out.today.median_min, 60);
  assert.equal(out.history[0].done, 3);
  assert.equal(out.history[0].cost, 1.75);
  assert.equal(out.history[0].median_min, 60);
  assert.equal(out.tickets.length, 2);
});

test("Tickets von gestern zählen nicht in den Median von heute", () => {
  const at = (d, h) => new Date(2026, 10, d, h, 0).getTime() / 1000;
  const a = stats("spa", { done: 1, cost: 1, tickets: [
    { id: "t1", status: "done", done_at: at(15, 9), lead_min: 30 },
  ] });
  const b = stats("spb", { done: 1, cost: 1, tickets: [
    { id: "t2", status: "done", done_at: at(14, 9), lead_min: 90 },
  ] });
  assert.equal(mergeStats([a, b]).today.median_min, 30);
});

// ---------- Agent-Spaces (Workspace-Fabrik 4) ----------

const ROWS = [
  { id: "spa", name: "Alpha", folder: "/repos/alpha", kind: "workspace" },
  { id: "spb", name: "Beta", folder: "/repos/beta", kind: "workspace" },
  { id: "spag", name: "feat-agent", folder: "/wt/agent", kind: "agent", workspace: "spa" },
  { id: "", name: "ohne Workspace", folder: "", kind: "workspace" },
];

test("Chips und Workspaces-Karte zeigen nur kind workspace", () => {
  assert.deepEqual(workspaceRows(ROWS).map((r) => r.id), ["spa", "spb", ""]);
  assert.deepEqual(workspaceRows(null), []);
  // Ein Alt-Home ohne `kind` bleibt ein Workspace.
  assert.deepEqual(workspaceRows([{ id: "spx" }]).map((r) => r.id), ["spx"]);
});

test("ein Agent-Space nennt seinen Workspace, ein Workspace sich selbst", () => {
  assert.equal(workspaceOf(ROWS, "spag"), "spa");
  assert.equal(workspaceOf(ROWS, "spb"), "spb");
  assert.equal(workspaceOf(ROWS, "spa"), "spa");
  assert.equal(workspaceOf(ROWS, ""), "");
  assert.equal(workspaceOf(null, "spa"), "spa");
});

test("Agents zählen zum Workspace ihres Tickets, nicht zum Agent-Space", () => {
  const tickets = [
    { id: "t1", status: "doing", space: "spa", space_name: "Alpha", repo: "/repos/alpha/wt",
      terminal: "t-a", agent_space: "spag" },
    { id: "t2", status: "done", space: "spb", space_name: "Beta", repo: "/repos/beta",
      terminal: "t-done", agent_space: "spag" },
  ];
  // Selbst ein erledigtes Ticket bindet seinen Agenten an den Workspace.
  assert.equal(agentWorkspace({ address: "t-a", space: "spag" }, tickets, ROWS, "spb"), "spa");
  assert.equal(agentWorkspace({ address: "t-done", space: "spag" }, tickets, ROWS, "spa"), "spb");
  // Ohne Ticket zählt die Kennung; ein Agent-Space wird zu seinem Workspace.
  assert.equal(agentWorkspace({ address: "t-x", space: "spag" }, tickets, ROWS, "spb"), "spa");
  assert.equal(agentWorkspace({ address: "t-y", space: "spb" }, tickets, ROWS, "spa"), "spb");
  // Ohne Space und ohne Ticket bleibt der eigene Workspace.
  assert.equal(agentWorkspace({ address: "t-z" }, tickets, ROWS, "spb"), "spb");
});
