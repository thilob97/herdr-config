// Tastatur im Dashboard: j/k/g/r/↵ gehören der Auswahl nur, solange niemand im
// Auftrag- oder Antwortfeld tippt (board/main.js:387).
//   node --test mods/dashboard/test/keys.test.mjs

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
export const agents = () => [];
export const terminals = () => [];
export const spaces = () => [];
export const panes = () => [];
export const run = () => {};
export const hc = async () => ({ code: 1, stdout: "", stderr: "" });
export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
export const theme = () => ({});
export const shared = () => null;
export const setShared = () => {};
export const openOverlay = () => {};
export const appHome = () => "/tmp";
export const machines = () => [];
export const readTextFile = async () => null;
`);

registerHooks({
  resolve(spec, context, next) {
    return ["gpui-kit", "gpui-base", "herdr"].includes(spec) ? { url: APP, shortCircuit: true } : next(spec, context);
  },
});

const { default: Dashboard } = await import(pathToFileURL(join(here, "..", "main.js")).href);

function view({ focus = () => false, answers = new Map() } = {}) {
  const seen = { runs: [], sends: 0, focused: 0, stopped: 0 };
  const cx = { notify() {}, stop_propagation() { seen.stopped++; }, timer: { after() {} } };
  const v = Object.assign(Object.create(Dashboard.prototype), {
    key: "a", armed: null, answers,
    focus: { has: focus }, handle: { focus: () => { seen.focused++; } },
    rows: () => [{ key: "a" }, { key: "b" }],
    send: () => { seen.sends++; },
    workspace: () => { seen.runs.push("workspace"); },
    open: () => {},
  });
  return { v, cx, seen };
}

test("j im Auftragsfeld wählt nicht", () => {
  const { v, cx, seen } = view({ focus: (id) => id === "dash-order" });
  v.onKey({ key: "j" }, cx);
  assert.equal(v.key, "a");
  assert.equal(seen.stopped, 0);
});

test("g w im Antwortfeld wechselt die Ansicht nicht", () => {
  const answers = new Map([["t3", {}]]);
  const { v, cx, seen } = view({ focus: (id) => id === "dash-answer-t3", answers });
  v.onKey({ key: "g" }, cx);
  assert.equal(v.armed, null, "g wird nicht scharf, solange das Feld tippt");
  v.onKey({ key: "w" }, cx);
  assert.deepEqual(seen.runs, []);
  assert.equal(seen.stopped, 0);
});

test("⌘↵ sendet auch aus dem Feld", () => {
  const { v, cx, seen } = view({ focus: (id) => id === "dash-order" });
  v.onKey({ key: "enter", keystroke: "cmd-enter" }, cx);
  assert.equal(seen.sends, 1);
  assert.equal(seen.stopped, 1);
});

test("ohne Feld im Fokus wählt j weiter", () => {
  const { v, cx, seen } = view();
  v.onKey({ key: "j" }, cx);
  assert.equal(v.key, "b");
  assert.equal(seen.stopped, 1);
});

test("Esc gibt die Auswahl frei, auch aus einem Feld", () => {
  const { v, cx, seen } = view({ focus: (id) => id === "dash-order" });
  v.onKey({ key: "escape" }, cx);
  assert.equal(v.key, null);
  assert.equal(seen.focused, 1);
});
