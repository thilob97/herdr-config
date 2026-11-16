// Quests als Popup: ein Klick auf eine Zeile wählt das Ticket, und die Detailspalte
// rechts zeigt es (vorher öffnete der Klick im Popup den Auftrag-Dialog).
//   node --test mods/quests/test/panel.test.mjs
import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataUrl = (body) => "data:text/javascript," + encodeURIComponent(body);

// Elemente sind Kettenglieder: jeder Aufruf gibt dasselbe Element zurück, `child`
// sammelt Text, `on_*` merkt den Handler. So läuft card()/detail() ohne Fenster.
const APP = dataUrl(`
const noop = () => {};
function element() {
  const box = { texts: [], handlers: {} };
  const p = new Proxy(box, {
    get(t, k) {
      if (k === "then") return undefined;
      if (k in t) return t[k];
      return (...args) => {
        if (k === "child") { if (typeof args[0] === "string") t.texts.push(args[0]); else if (args[0]?.texts) t.texts.push(...args[0].texts); return p; }
        if (k === "children") { for (const a of args[0] ?? []) { if (typeof a === "string") t.texts.push(a); else if (a?.texts) t.texts.push(...a.texts); } return p; }
        if (k === "when") { if (args[0]) args[1](p); return p; }
        if (k.startsWith("on_")) { t.handlers[k] = args[0]; return p; }
        return p;
      };
    },
  });
  return p;
}
export class View {}
export const div = element, svg = element, image = element, v_flex = element, h_flex = element;
export class InputState { static new(s) { return { value: () => s?.value ?? "", set_value: noop, on: noop, focus: noop }; } }
export const Input = { new: (s) => s }, Textarea = {}, TextareaState = { new: (s) => s };
export const TextView = { markdown: (_id, body) => { const e = element(); e.child(body ?? ""); return e; } };
export const ScrollHandle = { new: () => ({ scroll_to_item: noop }) };
export const run = (...a) => { (globalThis.__runs ??= []).push(a); };
export const theme = () => new Proxy({}, { get: () => "#aabbcc" });
export const props = () => ({ overlay: { id: "o" } });
export const openOverlay = noop, closeOverlay = noop, notify = noop, setShared = noop;
export const appHome = () => "/tmp", settings = () => ({ zoom: 1, font_family: "mono" });
export const agents = () => [], terminals = () => [], spaces = () => [], panes = () => [];
export const shared = (k) => (globalThis.__shared ?? {})[k] ?? null;
export const exec = async () => ({ code: 0, stdout: "[]", stderr: "" });
`);

const REWRITE = new Set(["gpui-kit", "gpui-base", "herdr"]);
registerHooks({
  resolve(spec, context, next) {
    if (REWRITE.has(spec)) return { url: APP, shortCircuit: true };
    return next(spec, context);
  },
});

globalThis.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
  setItem(k, v) { this.store.set(k, String(v)); },
  removeItem(k) { this.store.delete(k); },
};

const { Board, openBoard } = await import(pathToFileURL(join(here, "..", "main.js")).href);
// Same shape as the stub's theme(): every token is a colour.
const theme = () => new Proxy({}, { get: () => "#aabbcc" });

const TICKET = {
  source: "plain", id: "sauerteig", title: "Sauerteig ansetzen", body: "Mehl und Wasser mischen.",
  status: "todo", labels: [], project: "", url: "",
};

function board() {
  const b = Object.create(Board.prototype);
  Object.assign(b, {
    overlay: { id: "o" }, settings: { dryRun: true }, src: { plain: { tickets: [TICKET] } }, started: [],
    repos: [], filter: "", only: "plain", stage: "all", folded: new Set(), hovered: null, selected: null,
    gen: 0, teamList: [], input: { value: () => "" }, focus: { has: () => false },
    live: { byAgent: new Map(), byTerm: new Map(), tabs: new Set() },
  });
  return b;
}

test("Board öffnen ruft das Board-Popup, keinen Panel-Befehl", () => {
  globalThis.__runs = [];
  openBoard();
  assert.deepEqual(globalThis.__runs.at(-1), ["mod.open", { name: "board" }]);
});

test("die Detailspalte ist ohne Wahl leer", () => {
  const b = board();
  assert.ok(b.detail(theme()).texts.some((s) => s.startsWith("Wähle ein Ticket")));
});

test("ein Klick auf eine Zeile wählt das Ticket und füllt die Detailspalte", () => {
  const b = board();
  const card = b.card(theme(), TICKET);
  assert.equal(typeof card.handlers.on_click, "function", "die Zeile ist klickbar");
  card.handlers.on_click({}, { notify() {} });
  assert.equal(b.selected, "plain:sauerteig", "Klick wählt statt den Auftrag-Dialog zu öffnen");
  const detail = b.detail(theme());
  assert.ok(detail.texts.includes("Sauerteig ansetzen"), "Titel steht in der Detailspalte");
  assert.ok(detail.texts.includes("Mehl und Wasser mischen."), "Beschreibung steht darunter");
});
