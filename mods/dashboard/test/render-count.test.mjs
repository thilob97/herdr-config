// Render-Last des Dashboards: ein Render mit 76 Tickets darf die Host-Brücke nicht
// mehr je Zeile fragen. Der Stub zählt agents(), terminals(), spaces(), shared() und
// machines() wie das Audit-Skript (/tmp/audit-ux/count.mjs).
//   node --test mods/dashboard/test/render-count.test.mjs

import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataUrl = (body) => "data:text/javascript," + encodeURIComponent(body);

const APP = dataUrl(`
export class View {}
const counts = () => (globalThis.__calls ??= {});
const c = (k) => { const m = counts(); m[k] = (m[k] ?? 0) + 1; };
export const el = () => {
  const node = {};
  const p = new Proxy(node, {
    get(target, key) {
      if (key === "when") return (cond, fn) => { if (cond) fn(p); return p; };
      if (key === "child") return (x) => p;
      if (key === "children") return () => p;
      return () => p;
    },
  });
  return p;
};
export const div = el, svg = el, image = el, v_flex = el, h_flex = el;
export class InputState { static new() { return { on() {}, value() { return ""; }, set_value() {} }; } }
export class TextareaState { static new() { return { on() {} }; } }
export const Input = { new: el }, Textarea = { new: el };
export const agents = () => (c("agents"), structuredClone(globalThis.__A ?? []));
export const terminals = () => (c("terminals"), structuredClone(globalThis.__T ?? []));
export const spaces = () => (c("spaces"), structuredClone(globalThis.__S ?? []));
export const panes = () => (c("panes"), []);
export const machines = () => (c("machines"), []);
export const run = () => {};
export const hc = async () => ({ code: 1, stdout: "", stderr: "" });
export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
export const theme = () => ({});
export const shared = (k) => (c("shared:" + k), structuredClone((globalThis.__SH ?? {})[k] ?? null));
export const setShared = () => {};
export const openOverlay = () => {};
export const appHome = () => "/tmp";
export const home = () => "/tmp";
export const readTextFile = async () => null;
`);

registerHooks({
  resolve(spec, context, next) {
    return ["gpui-kit", "gpui-base", "herdr"].includes(spec) ? { url: APP, shortCircuit: true } : next(spec, context);
  },
});

const { default: Dashboard } = await import(pathToFileURL(join(here, "..", "main.js")).href);

const SPACES = [
  { id: "spa", name: "Alpha", folder: "/repos/alpha", machine: "local", kind: "workspace" },
  { id: "spb", name: "Beta", folder: "/repos/beta", machine: "local", kind: "workspace" },
  { id: "spc", name: "Gamma", folder: "/repos/gamma", machine: "local", kind: "workspace" },
];
const AGENTS = Array.from({ length: 6 }, (_, i) => ({
  address: `t${i}`, title: `Agent ${i}`, status: i === 0 ? "blocked" : "working",
  space: SPACES[i % SPACES.length].id, space_name: SPACES[i % SPACES.length].name,
  tab: `tab-${i}`, pane: `pane-${i}`, program: { key: "omp" },
}));
const TICKETS = Array.from({ length: 76 }, (_, i) => {
  const status = ["doing", "doing", "doing", "review", "todo", "done"][i % 6];
  const agent = AGENTS[i % AGENTS.length];
  return {
    id: `tk-${i}`, title: `Ticket ${i} mit einem längeren Titel`, status,
    terminal: i % 4 === 3 ? "" : agent.address,
    space: SPACES[i % SPACES.length].id, space_name: SPACES[i % SPACES.length].name,
    repo: SPACES[i % SPACES.length].folder, updated: "2026-11-16 09:00",
    verlauf: i % 3 === 0
      ? [{ ts: "2026-11-16 09:10", role: agent.title, text: i % 2 ? "Soll ich das so lassen?" : "Fertig, kein Push." }]
      : [],
  };
});

function view() {
  globalThis.__A = AGENTS;
  globalThis.__T = AGENTS.map((a) => ({ ...a, state: "live" }));
  globalThis.__S = SPACES.map((s, i) => ({ id: s.id, name: s.name, folder: s.folder, active: i === 0, tabs: [] }));
  globalThis.__SH = {
    "dashboard.spaces": { mode: "all", ids: [] },
    "orchestra.tickets": TICKETS,
    "orchestra.spaces": { at: Date.now(), space: "spa", spaces: SPACES },
    "orchestra.costs": { at: Date.now(), tickets: { "tk-0": 1.5 }, stopped: { "tk-1": true, __team: true } },
    "orchestra.budget": { team: 20 },
    "orchestra.groups": [{ id: "g1", name: "Team Eins", members: ["t0", "t1"] }],
    "orchestra.stats": { today: { done: 3, rework: 0, cost: 4, median_min: 12 }, history: [] },
    "omp.subagents": {},
    "attention.since": {},
  };
  globalThis.__calls = {};
  return Object.assign(Object.create(Dashboard.prototype), {
    key: null, questions: {}, answers: new Map(), answerNote: {}, seen: new Map(),
    tks: TICKETS, stalls: [], spaceRows: globalThis.__SH["orchestra.spaces"],
    spaceStats: new Map(), focus: { has: () => false }, order: {}, handle: {}, showDone: false,
    fresh: { tickets: { at: Date.now() }, stalls: { at: Date.now() }, stats: { at: Date.now() }, spaces: { at: Date.now() } },
  });
}

test("ein Render mit 76 Tickets bleibt unter 100 Host-Aufrufen", () => {
  const v = view();
  // ui.js cached einen Host-Satz für 120 ms und fragt dafür Date.now. Ein Render, der
  // zufällig länger dauert, würde den Cache mitten im Lauf verlieren und den Test
  // flaky machen; für genau diesen einen Render steht die Uhr still.
  const now = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    assert.ok(v.render({}));
    assert.equal(v.snap, null, "der Schnappschuss endet mit dem Render");
    const calls = globalThis.__calls;
    const total = Object.values(calls).reduce((n, x) => n + x, 0);
    assert.ok(total <= 100, `Host-Aufrufe je Render: ${total}\n${JSON.stringify(calls)}`);
  } finally { Date.now = now; }
});
