// The "Wartet auf dich" rule from ticket dashboard-4, against demo data.
//   node --test mods/dashboard/test/waits.test.mjs
// main.js imports the app's modules; the rule itself is plain data, so the loader
// below maps those imports to small stubs and the test calls the rule directly.

import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataUrl = (body) => "data:text/javascript," + encodeURIComponent(body);

const APP = dataUrl(`
export class View {}
const none = () => null;
export const div = none, svg = none, image = none, v_flex = none, h_flex = none;
export class InputState { static new() { return {}; } }
export class TextareaState { static new() { return {}; } }
export const Input = {}, Textarea = {};
export const agents = () => globalThis.__dashAgents ?? [];
export const terminals = () => globalThis.__dashTerminals ?? [];
export const spaces = () => [];
export const panes = () => globalThis.__dashPanes ?? [];
export const run = none;
export const hc = async () => ({ code: 1, stdout: "", stderr: "" });
export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
export const theme = () => ({});
export const shared = (k) => (globalThis.__dashShared ?? {})[k] ?? null;
export const setShared = none;
export const openOverlay = none;
export const knownAgents = async () => [];
export const appHome = () => "/tmp";
export const home = () => "/tmp";
export const machines = () => [];
export const readTextFile = async () => null;
`);

const REWRITE = new Set(["gpui-kit", "gpui-base", "herdr"]);
registerHooks({
  resolve(spec, context, next) {
    if (REWRITE.has(spec)) return { url: APP, shortCircuit: true };
    return next(spec, context);
  },
});

const { default: Dashboard } = await import(pathToFileURL(join(here, "..", "main.js")).href);

// Demo agents: one working, one finished; the blocked one only where a test wants it.
const BLOCKED = { address: "t3", title: "Claude", status: "blocked", app: "claude", program: { name: "Claude", key: "claude" } };
const AGENTS = [
  { address: "t1", title: "Echo", status: "working", app: "omp", program: { name: "Echo", key: "omp" } },
  { address: "t2", title: "Yuki", status: "done", app: "omp", program: { name: "Yuki", key: "omp" } },
];

function view(tickets, list = AGENTS) {
  globalThis.__dashAgents = list;
  globalThis.__dashTerminals = [];
  globalThis.__dashShared = {};
  return Object.assign(Object.create(Dashboard.prototype), {
    tickets: () => tickets,
    orchestrator: () => null,
    statusOf: (a) => a.status,
  });
}

const entry = (role, text) => ({ ts: "2026-11-14 23:30", role, text });
const rows = (tickets, list) => view(tickets, list).waitsOnMe();

test("done agent with a '?' in its completion report does not wait", () => {
  const out = rows([{
    id: "dash-3", status: "doing", terminal: "t2", title: "Dashboard 3",
    verlauf: [entry("Yuki", "Fertig auf feat/dash-3 (38d6373; kein Push). Wartet auf dich: nur echte Fragen (nicht done, keine Antwort danach)?")],
  }]);
  assert.deepEqual(out, []);
});

test("the same report while the agent is blocked is a waiting row", () => {
  const out = rows([{
    id: "dash-3", status: "doing", terminal: "t3", title: "Dashboard 3",
    verlauf: [entry("Claude", "Fertig auf feat/dash-3 (38d6373; kein Push). Wartet auf dich: nur echte Fragen (nicht done, keine Antwort danach)?")],
  }], [...AGENTS, BLOCKED]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "agent");
  assert.equal(out[0].address, "t3");
});

test("a review ticket waits", () => {
  const out = rows([{ id: "demo-1", status: "review", title: "Sidebar: Abstände vereinheitlichen" }]);
  assert.deepEqual(out.map((e) => [e.kind, e.key]), [["ticket", "ticket:demo-1"]]);
});

test("a doing ticket with a real question from a working agent waits", () => {
  const out = rows([{
    id: "demo-2", status: "doing", terminal: "t1", title: "Team-Panel",
    verlauf: [entry("Echo", "Der Worktree steht. Soll ich den Demo-Test löschen?")],
  }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "ask");
  assert.equal(out[0].address, "t1");
  assert.equal(out[0].tk.id, "demo-2");
});

test("a question word at the start of the last line is a question too", () => {
  const out = rows([{
    id: "demo-2", status: "doing", terminal: "t1", title: "Team-Panel",
    verlauf: [entry("Echo", "Der Worktree steht.\nSoll ich den Demo-Test löschen")],
  }]);
  assert.equal(out.length, 1);
});

test("done tickets never wait, even with an open-looking question", () => {
  const out = rows([{
    id: "demo-4", status: "done", terminal: "t1", title: "Tab-Leiste",
    verlauf: [entry("Echo", "Soll ich den Demo-Test löschen?")],
  }]);
  assert.deepEqual(out, []);
});

test("an answered question (mensch after it) does not wait", () => {
  const out = rows([{
    id: "demo-2", status: "doing", terminal: "t1", title: "Team-Panel",
    verlauf: [entry("Echo", "Soll ich den Demo-Test löschen?"), entry("mensch", "Ja")],
  }]);
  assert.deepEqual(out, []);
});

test("a completion report from a working agent is not a question", () => {
  const out = rows([{
    id: "demo-2", status: "doing", terminal: "t1", title: "Team-Panel",
    verlauf: [entry("Echo", "Fertig: Checks grün, Commit abc, kein Push. Offen? nichts.")],
  }]);
  assert.deepEqual(out, []);
});

test("a question that mentions a green check is still a question", () => {
  const out = rows([{
    id: "demo-2", status: "doing", terminal: "t1", title: "Team-Panel",
    verlauf: [entry("Echo", "Der Worktree steht, Checks sind grün. Soll ich den Demo-Test löschen und den Rest nachziehen?")],
  }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "ask");
});

test("a report with 'Commit …, kein Push' is not a question", () => {
  const out = rows([{
    id: "demo-2", status: "doing", terminal: "t1", title: "Team-Panel",
    verlauf: [entry("Echo", "Rebase erledigt, Commit 3fef86f, kein Push (alles grün)?")],
  }]);
  assert.deepEqual(out, []);
});

test("the count is the number of rows, and the Verlauf questions are the difference", () => {
  const out = rows([
    { id: "demo-1", status: "review", title: "Review" },
    {
      id: "demo-2", status: "doing", terminal: "t1", title: "Team-Panel",
      verlauf: [entry("Echo", "Soll ich den Demo-Test löschen?")],
    },
    {
      id: "dash-3", status: "doing", terminal: "t2", title: "Dashboard 3",
      verlauf: [entry("Yuki", "Fertig, kein Push (nicht done)?")],
    },
  ]);
  const inbox = out.filter((e) => e.kind !== "ask").length;
  const diff = out.filter((e) => e.kind === "ask").length;
  assert.equal(out.length, 2);      // one review row + one Verlauf question
  assert.equal(inbox, 1);           // Inbox: Abnahmen + Rückfragen
  assert.equal(diff, 1);            // the difference the header names
  assert.equal(inbox + diff, out.length);
});
