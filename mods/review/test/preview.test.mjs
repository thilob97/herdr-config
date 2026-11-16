// Der Nachweis-Vorschau darf einen fehlenden Beweis nur einmal kopieren: `cp` schlägt
// im gelöschten Worktree fehl und `previews[p] = null` beendet den Render-Kreis.
//   node --test mods/review/test/preview.test.mjs

import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataUrl = (body) => "data:text/javascript," + encodeURIComponent(body);

const el = () => {
  const node = {};
  const p = new Proxy(node, {
    get(target, key) {
      if (key === "when") return (cond, fn) => { if (cond) fn(p); return p; };
      if (key === "child" || key === "children" || key === "tooltip") return () => p;
      return () => p;
    },
  });
  return p;
};

const GPUI = dataUrl(`
export class View {}
export const div = ${el.toString()}, svg = ${el.toString()}, image = ${el.toString()};
export const v_flex = ${el.toString()}, h_flex = ${el.toString()};
export class InputState { static new() { return { on() {}, value() { return ""; }, set_value() {} }; } }
export class TextareaState { static new() { return { on() {} }; } }
export const Input = { new: (s) => s }, Textarea = { new: (s) => s };
export const Scrollbar = { new: () => (${el.toString()})() };
export const v_virtual_list = () => (${el.toString()})();
`);

const host = `
export const appHome = () => "/tmp/review-test";
export const shared = () => null;
export const setShared = () => {};
export const agents = () => [];
export const terminals = () => [];
export const panes = () => [];
export const spaces = () => [];
export const focused = () => null;
export const props = () => ({});
export const theme = () => ({});
export const settings = () => ({});
export const run = () => {};
export const hc = async () => ({ code: 0, stdout: "", stderr: "" });
export const readTextFile = async () => null;
export const openOverlay = () => {};
export const closeOverlay = () => {};
export const exec = async (cmd, args) => {
  (globalThis.__execCalls ??= []).push([cmd, ...args]);
  return { code: cmd === "cp" ? 1 : 0, stdout: "", stderr: "" };
};
`;

const HERDR = dataUrl(host);

registerHooks({
  resolve(spec, context, next) {
    if (spec === "gpui-kit" || spec === "gpui-base") return { url: GPUI, shortCircuit: true };
    if (spec === "herdr") return { url: HERDR, shortCircuit: true };
    return next(spec, context);
  },
});

const { default: Review } = await import(pathToFileURL(join(here, "..", "main.js")).href);

test("ein fehlender Nachweis wird nur einmal kopiert", async () => {
  const pending = [];
  const cx = {
    notify() {},
    spawn(fn) { pending.push(fn(cx)); },
    timer: { every() {}, after() {} },
  };
  const view = Object.assign(Object.create(Review.prototype), { previews: {}, copying: new Set() });
  const tk = { evidence: ["/gone/worktree/nachweis.png"] };
  globalThis.__execCalls = [];

  // Zwei Renders, während der erste Kopierversuch noch läuft.
  view.previewEvidence(tk, cx);
  view.previewEvidence(tk, cx);
  await Promise.all(pending.splice(0));

  // Drei weitere Renders: null heißt „nicht mehr vorhanden“, kein neuer cp.
  for (let i = 0; i < 3; i++) {
    view.previewEvidence(tk, cx);
    await Promise.all(pending.splice(0));
  }

  assert.equal(view.previews["/gone/worktree/nachweis.png"], null);
  const copies = globalThis.__execCalls.filter(([cmd]) => cmd === "cp");
  assert.equal(copies.length, 1, `cp-Aufrufe: ${JSON.stringify(copies)}`);
});
