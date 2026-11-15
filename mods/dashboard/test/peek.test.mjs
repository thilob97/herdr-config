// Peek statt Layout-Wechsel und Daten aus dem Daemon (Architektur 1): ein Klick auf
// eine Agent-Zeile bleibt im Dashboard (`terminal.peek`), „Zum Space" wechselt nach
// elric; frische shared-Daten ersetzen eigene Poller.
//   node --test mods/dashboard/test/peek.test.mjs
// main.js imports the app's modules; the loader below maps them to small stubs.

import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataUrl = (body) => "data:text/javascript," + encodeURIComponent(body);

const APP = dataUrl(`
export class View {}
// A chainable element stub: records id, children and on_click so a test can walk a
// rendered head and press its buttons. Every other builder method returns itself.
export const el = () => {
  const node = { id: null, onClick: [], children: [] };
  const p = new Proxy(node, {
    get(target, key) {
      if (key === "__node") return target;
      if (key === "id") return (v) => { target.id = v; return p; };
      if (key === "on_click") return (fn) => { target.onClick.push(fn); return p; };
      if (key === "child") return (c) => { target.children.push(c); return p; };
      if (key === "children") return (cs) => { target.children.push(...cs.filter(Boolean)); return p; };
      if (key === "when") return (cond, fn) => { if (cond) fn(p); return p; };
      return () => p;
    },
  });
  return p;
};
export const div = el, svg = el, image = el, v_flex = el, h_flex = el;
export class InputState { static new() { return { on() {}, value() { return ""; }, set_value() {} }; } }
export class TextareaState { static new() { return { on() {} }; } }
export const Input = {}, Textarea = {};
export const agents = () => globalThis.__dashAgents ?? [];
export const terminals = () => globalThis.__dashTerminals ?? [];
export const spaces = () => [], panes = () => [];
export const run = (name, args) => { (globalThis.__runs ??= []).push({ name, args }); };
export const hc = async () => ({ code: 1, stdout: "", stderr: "" });
export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
export const theme = () => ({});
export const shared = (k) => (globalThis.__dashShared ?? {})[k] ?? null;
export const setShared = () => {};
export const openOverlay = (o) => { globalThis.__overlay = o; };
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

function world({ agents = [], terminals = [], shared = {} } = {}) {
  globalThis.__dashAgents = agents;
  globalThis.__dashTerminals = terminals;
  globalThis.__dashShared = shared;
  globalThis.__runs = [];
  globalThis.__overlay = null;
}

function view(extra = {}) {
  return Object.assign(Object.create(Dashboard.prototype), {
    fresh: { tickets: { at: 0, err: null }, stalls: { at: 0, err: null },
      stats: { at: 0, err: null }, spaces: { at: 0, err: null } },
    tks: null, tksJson: null, readingTks: false,
  }, extra);
}

const runs = () => globalThis.__runs ?? [];

// ---------- Peek statt hartem Layout-Wechsel ----------

test("a click on an agent row peeks at its terminal and stays on the dashboard", () => {
  world({ agents: [{ address: "t1", status: "working" }] });
  const v = view();
  v.peekAgent("t1");
  assert.deepEqual(runs(), [{ name: "terminal.peek", args: { terminal: "t1" } }]);
});

test("the row of a blocked agent opens a peek, Enter too", () => {
  world({ agents: [{ address: "t3", status: "blocked" }] });
  const v = view();
  v.open({ kind: "agent", key: "agent:t3", address: "t3" });
  v.open({ kind: "doing", key: "doing:x", tk: { id: "x", terminal: "t3" } });
  assert.deepEqual(runs().map((r) => r.name), ["terminal.peek", "terminal.peek"]);
  assert.ok(runs().every((r) => r.args.terminal === "t3"));
});

test("a gone agent has nothing to peek at", () => {
  world();
  view().peekAgent("t9");
  assert.deepEqual(runs(), []);
});

test("'Zum Space' is the deliberate switch to layout elric", () => {
  world({ agents: [{ address: "t1", tab: "tab-1", pane: "pane-1", status: "working" }] });
  view().openSpaceAndTerminal("t1");
  assert.deepEqual(runs(), [
    { name: "layout.switch", args: { name: "elric" } },
    { name: "tab.select", args: { id: "tab-1" } },
    { name: "pane.focus", args: { pane: "pane-1" } },
  ]);
});

test("the head opens Board and Timeline as popups and stays on the dashboard", () => {
  world();
  const head = view().header({});
  const nodes = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    const raw = n.__node ?? n;
    nodes.push(raw);
    for (const c of raw.children ?? []) walk(c);
  };
  walk(head);
  const press = (id) => {
    const node = nodes.find((n) => n.id === id);
    assert.ok(node, `button ${id} fehlt im Kopf`);
    for (const fn of node.onClick) fn({}, { stop_propagation() {} });
  };
  press("dash-board");
  press("dash-timeline");
  assert.deepEqual(runs(), [
    { name: "mod.open", args: { name: "board" } },
    { name: "mod.open", args: { name: "timeline" } },
  ]);
});

test("a review ticket opens the review overlay", () => {
  world();
  view().open({ kind: "ticket", key: "ticket:demo-1", tk: { id: "demo-1", title: "Sidebar" } });
  assert.equal(globalThis.__overlay?.mod, "review");
  assert.equal(globalThis.__overlay?.props.ticket, "demo-1");
});

// ---------- Daemon-Daten statt eigener Poller ----------

test("a fresh heartbeat makes shared tickets the source, without a file read", () => {
  const list = [{ id: "demo-1", status: "review" }];
  world({ shared: { "orchestra.spaces": { at: Date.now() }, "orchestra.tickets": list } });
  let spawned = 0;
  const v = view();
  v.refreshTickets({ spawn() { spawned++; }, notify() {} });
  assert.equal(spawned, 0, "kein Fallback-Poller");
  assert.deepEqual(v.tickets(), list);
});

test("a stale heartbeat falls back to the ticket files", () => {
  world({ shared: { "orchestra.spaces": { at: Date.now() - 13000 }, "orchestra.tickets": [{ id: "a" }] } });
  let spawned = 0;
  const v = view();
  v.refreshTickets({ spawn() { spawned++; }, notify() {} });
  assert.equal(spawned, 1, "der Fallback liest die Dateien");
});

test("without a published heartbeat the dashboard reads the files", () => {
  world({ shared: { "orchestra.tickets": [{ id: "a" }] } });
  const v = view();
  assert.equal(v.sharedFresh(), false);
  let spawned = 0;
  v.refreshTickets({ spawn() { spawned++; }, notify() {} });
  assert.equal(spawned, 1);
});

test("the heartbeat older than 12 s is stale", () => {
  world({ shared: { "orchestra.spaces": { at: Date.now() - 12001 } } });
  assert.equal(view().sharedFresh(), false);
  world({ shared: { "orchestra.spaces": { at: Date.now() - 1000 } } });
  assert.equal(view().sharedFresh(), true);
});

// ---------- Letzte Aktivität kennt ihren Agenten ----------

test("an event from an agent's Verlauf carries the address for its peek", () => {
  world({ agents: [{ address: "t1", title: "Echo", status: "working" }] });
  const v = view({
    tks: [{ id: "demo-2", status: "doing", terminal: "t1",
      verlauf: [{ ts: "2026-11-14 23:30", role: "Echo", text: "Der Worktree steht." }] }],
  });
  v.inSelTicket = () => true;
  const rows = v.activity();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, "t1");
});
