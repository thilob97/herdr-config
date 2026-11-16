// Workspace-Zuordnung (Agent-Space → Workspace seines Tickets) und Autostart je Space.
// Die Mods importieren die App-Module; der Loader unten ersetzt sie durch Stubs, damit
// die Regeln ohne Fenster laufen.
//   node --test mods/orchestra/test/scope.test.mjs

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
export class InputState { static new() { return { on() {}, value() { return ""; }, set_value() {} }; } }
export class ScrollHandle { static new() { return {}; } }
export const Input = { new: (s) => s }, Textarea = {}, TextareaState = { new: (s) => s };
export const run = none, theme = () => ({}), props = () => ({}), closeOverlay = none, openOverlay = none;
export const appHome = () => "/tmp", home = () => "/tmp", knownAgents = async () => [];
export const machines = () => [], readTextFile = async () => null, notify = none;
export const agents = () => globalThis.__agents ?? [];
export const terminals = () => globalThis.__terminals ?? [];
export const panes = () => globalThis.__panes ?? [];
export const spaces = () => globalThis.__spaces ?? [];
export const focused = () => globalThis.__focused ?? null;
// Wie der Host: jeder Aufruf gibt eine frische Kopie (bei 70 Tickets ~1 ms). Wer eine
// Liste je Element braucht, liest sie einmal und gibt sie weiter — sonst wird aus einem
// Rendern über 70 Tickets mehr als das Zeitbudget, und Herdr schneidet es ab.
export const shared = (k) => {
  globalThis.__reads = (globalThis.__reads ?? 0) + 1;
  const v = (globalThis.__shared ?? {})[k];
  return v == null ? null : structuredClone(v);
};
export const setShared = (k, v) => { (globalThis.__shared ??= {})[k] = v; };
export const hc = async (...a) => { (globalThis.__hc ??= []).push(a); return { code: 0, stdout: "", stderr: "" }; };
export const exec = async () => ({ code: 0, stdout: "{}", stderr: "" });
`);

const REWRITE = new Set(["gpui-kit", "gpui-base", "herdr"]);
registerHooks({
  resolve(spec, context, next) {
    if (REWRITE.has(spec)) return { url: APP, shortCircuit: true };
    return next(spec, context);
  },
});

const ui = await import(pathToFileURL(join(here, "..", "ui.js")).href);
const orch = await import(pathToFileURL(join(here, "..", "orchestrator.js")).href);
const inbox = await import(pathToFileURL(join(here, "..", "..", "inbox", "main.js")).href);

const WORKSPACES = [
  { id: "spa", name: "Alpha", folder: "/repos/alpha", machine: null, active: false },
  { id: "spb", name: "Beta", folder: "/repos/beta", machine: null, active: false },
  { id: "spag", name: "feat-agent", folder: "/wt/agent", machine: null, active: true },
];

const TICKETS = [
  { id: "a1", status: "doing", space: "spa", space_name: "Alpha", repo: "/repos/alpha/wt",
    terminal: "t-a", agent_space: "spag" },
  { id: "b1", status: "review", space: "spb", space_name: "Beta", repo: "/repos/beta" },
];

// ui.js hält die Host-Listen 25 ms lang (ein Render-Pass, HOST_TICK). Jedes `world()` ist
// ein neuer Pass: die Uhr rückt vor, damit der nächste Zugriff frische Kopien liest —
// sonst sieht die zweite Szene noch die Spaces der ersten.
const realNow = Date.now;
let ahead = 0;
Date.now = () => realNow() + ahead;

/** A fresh home: spaces, tickets, agents/terminals, shared state. */
function world({ active = "spag", agents = [], terminals = [], tickets = TICKETS } = {}) {
  ahead += 1000;
  const list = WORKSPACES.map((s) => ({ ...s, active: s.id === active }));
  globalThis.__spaces = list;
  globalThis.__agents = agents;
  globalThis.__terminals = terminals;
  globalThis.__focused = null;
  globalThis.__shared = { "orchestra.tickets": tickets };
  globalThis.__hc = [];
  globalThis.__reads = 0;
  return { spaces: list, shared: globalThis.__shared };
}

// ---------- 8: Agent-Space → Workspace seines Tickets ----------

test("ein Agent-Space wirkt als der Workspace seines Tickets", () => {
  world();
  assert.equal(ui.workspaceId("spag"), "spa");
  assert.equal(ui.workspaceId("spa"), "spa", "ein Workspace bleibt er selbst");
  assert.equal(ui.workspaceId(""), "");

  // Im Agent-Worktree-Space gilt die Fabrik, die das Ticket dispatchte.
  assert.equal(orch.spaceId(), "spa");
  assert.equal(ui.inScope({ id: "a1", space: "spa", space_name: "Alpha" }), true);
  assert.equal(ui.inScope({ id: "b1", space: "spb", space_name: "Beta" }), false);
  assert.equal(ui.inScope({ id: "old", repo: "/repos/alpha/x" }), true, "Alt-Ticket über repo");
});

test("der Orchestrator wird mit der Workspace-ID gesucht, nicht mit dem Agent-Space", () => {
  const terminals = [
    { address: "t-a", name: "omp", state: "live", space: "spag", labels: { "herdr.space": "spag", "hub.ticket": "a1" } },
    { address: "t-o", name: "orchestrator", state: "live", labels: { "hub.role": "orchestrator", "hub.space": "spa" } },
    { address: "t-x", name: "orchestrator", state: "live", labels: { "hub.role": "orchestrator", "hub.space": "spag" } },
  ];
  world({ terminals });
  assert.equal(orch.find()?.address, "t-o");
});

test("ältere Auslieferungen: das hub.ticket-Label im Space nennt den Workspace", () => {
  const tickets = [{ id: "old-1", space: "spa", space_name: "Alpha", repo: "/repos/alpha", terminal: "t-old" }];
  const terminals = [{ address: "t-old", name: "omp", state: "live", space: "spag", labels: { "herdr.space": "spag", "hub.ticket": "old-1" } }];
  world({ terminals, tickets });
  assert.equal(ui.workspaceId("spag"), "spa");
});

// ---------- Rendern: eine Liste je Durchlauf, nicht je Ticket ----------

test("die Bereichsprüfung liest die Ticket-Liste einmal, nicht je Ticket", () => {
  // 70 Tickets, alle in Alpha: das Rendern gibt die einmal gelesene Liste weiter.
  const tickets = Array.from({ length: 70 }, (_, i) => ({ id: `t${i}`, status: "doing", space: "spa", space_name: "Alpha" }));
  world({ active: "spa", tickets });
  const list = ui.teamTickets();
  assert.equal(globalThis.__reads, 1, "ein Zugriff für die ganze Liste");
  for (const tk of list) assert.equal(ui.inScope(tk, list), true);
  assert.equal(globalThis.__reads, 1, "kein Lesezugriff mehr je Ticket");
});

// ---------- 2: dispatched agents in the inbox of their workspace ----------

function inboxView() {
  return Object.assign(Object.create(inbox.default.prototype), { answered: new Set() });
}

test("ein dispatchter Agent steht in der Inbox seines Workspace, nicht in fremden", () => {
  const agents = [
    { address: "t-a", status: "working", space: "spag", seq: 1, space_name: "feat-agent" },
    { address: "t-b", status: "working", space: "spb", seq: 2, space_name: "Beta" },
  ];
  const terminals = agents.map((a) => ({ address: a.address, state: "live", space: a.space, labels: {} }));
  world({ active: "spa", agents, terminals });
  const keys = inboxView().entries().map((e) => e.address);
  assert.ok(keys.includes("t-a"), "der Agent im Agent-Space gehört zu Alpha");
  assert.ok(!keys.includes("t-b"), "Beta bleibt draußen");

  // Auch die Zähler folgen dem Ticket, nicht dem Wegwerf-Space.
  agents[0].status = "done";
  const count = inbox.inboxCount();
  assert.equal(count.done, 1);
  assert.equal(count.total.done, 1);
});

test("ein Agent, dessen Ticket zu Alpha gehört, bleibt in Alpha sichtbar", () => {
  const agents = [{ address: "t-a", status: "blocked", space: "spag", seq: 1 }];
  const terminals = [{ address: "t-a", state: "live", space: "spag", labels: {}, status: "blocked" }];
  world({ active: "spa", agents, terminals });
  const keys = inboxView().entries().map((e) => e.address);
  assert.deepEqual(keys, ["t-a"]);
  assert.equal(inbox.inboxCount().blocked, 1);
});

// ---------- 7: handover lines stay in the workspace they were sent from ----------

test("ein unterwegs-Auftrag erscheint nur in seinem Workspace, Alt-Einträge überall", () => {
  const agents = [{ address: "t-a", status: "working", space: "spag", seq: 1 }];
  const terminals = [{ address: "t-a", state: "live", space: "spag", labels: {} }];
  const { shared } = world({ active: "spa", agents, terminals });
  shared["quests.pending"] = [
    { key: "auftrag:1", title: "für Alpha", at: Date.now(), space: "spa" },
    { key: "auftrag:2", title: "für Beta", at: Date.now(), space: "spb" },
    { key: "auftrag:3", title: "alt ohne Space", at: Date.now() },
  ];
  const titles = inboxView().entries().filter((e) => e.kind === "pending").map((e) => e.p.title);
  assert.deepEqual(titles, ["für Alpha", "alt ohne Space"]);

  world({ active: "spb", agents, terminals });
  globalThis.__shared["quests.pending"] = shared["quests.pending"];
  assert.deepEqual(inboxView().entries().filter((e) => e.kind === "pending").map((e) => e.p.title),
    ["für Beta", "alt ohne Space"]);
});

// ---------- 6: the head's equation names every group ----------

test("die Kopf-Gleichung zählt jede Gruppe genau einmal", () => {
  const list = [
    { kind: "agent", group: "ask" }, { kind: "orch", group: "ask" },
    { kind: "question", group: "ask" },
    { kind: "agent", group: "work" }, { kind: "pending", group: "work" },
    { kind: "agent", group: "done" },
    { kind: "ticket", group: "review" },
  ];
  const note = inbox.inboxNote(list);
  assert.deepEqual([note.ask, note.questions, note.review, note.done, note.work], [2, 1, 1, 1, 2]);
  assert.equal(note.ask + note.questions + note.review + note.done + note.work, note.total);
  assert.match(note.text, /= 7 Zeilen$/);
});

// ---------- 3: autostart per space ----------

test("Stoppen in Space A lässt Space B starten; fehlender Eintrag heißt an", () => {
  world({ active: "spa" });
  assert.equal(orch.autostart("spa"), true, "ohne Eintrag an");
  assert.equal(orch.autostartKey("spa"), "orchestra.autostart.spa");

  orch.setAutostart(false, "spa");
  assert.equal(orch.autostart("spa"), false);
  assert.equal(orch.autostart("spb"), true, "A's Stopp gilt nicht für B");
  assert.equal(orch.autostart(), false, "ohne Argument gilt der aktive Space");

  orch.setAutostart(true, "spb");
  assert.equal(orch.autostart("spb"), true);
  assert.equal(orch.autostart("spa"), false, "B's Start macht A nicht wieder an");
});
