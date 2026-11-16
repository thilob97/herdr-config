// Cheatsheet ohne Fenster: welche Gruppen einen Bereichs-Chip im Kopf tragen,
// welche Zeilen ihren Bereich selbst nennen, und wie einzelne Modifier-Taps lesen.
//   node --test mods/cheatsheet/test/rows.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GROUPS, buildRows, commandOf, groupChip, chord, pretty, scope } from "../rows.js";

const raw = JSON.parse(readFileSync(new URL("../../../keys.json", import.meta.url)));
const bindings = Object.entries(raw).flatMap(([section, map]) =>
  Object.entries(map).map(([keys, action]) => ({ keys, action, section })));

// The rows of one group, as render() assigns them.
function group(name, mac = true) {
  const rows = buildRows(bindings, mac);
  const test = GROUPS.find(([n]) => n === name)[1];
  return rows.filter((r) => test(commandOf(r.action)));
}

test("Bereiche: global ist der Standard und kein Chip", () => {
  assert.equal(scope("global"), "global");
  // Tabs hängen alle an global: kein Chip, keine Zeilen-Tags.
  const tabs = group("Tabs");
  assert.ok(tabs.length > 0);
  assert.deepEqual(groupChip(tabs), { label: null, perRow: false });
});

test("gemischte Gruppe: kein Kopf-Chip, nur die begrenzten Zeilen nennen ihren Bereich", () => {
  // Spaces: layout:elric für space-folders, global für die übrigen.
  const spaces = group("Spaces");
  assert.deepEqual(groupChip(spaces), { label: null, perRow: true });
  assert.equal(spaces.find((r) => r.action === "space-folders.next").tag, "elric");
  assert.equal(spaces.find((r) => r.action === "space.next").tag, null);
  // Panels: layout:elric plus global (Seitenleiste).
  const panels = group("Panels und Seitenleiste");
  assert.deepEqual(groupChip(panels), { label: null, perRow: true });
});

test("einheitliche Gruppe: der Bereich steht einmal im Kopf", () => {
  const terminal = group("Terminal");
  assert.ok(terminal.length > 0);
  assert.equal(groupChip(terminal).label, "im Terminal");
});

test("hermes.toggle ist eine Zeile mit beiden Tasten", () => {
  const rows = group("Auftrag und Agents");
  const hermes = rows.filter((r) => r.action === "hermes.toggle");
  assert.equal(hermes.length, 1);
  assert.deepEqual(hermes[0].keys, ["⌃⌃", "⌘⇧H"]);
  // ⌘⇧H gilt global, ⌃⌃ im Terminal: eine gemeinsame Bereichsangabe gibt es nicht.
  assert.equal(hermes[0].tag, null);
  assert.deepEqual(groupChip(rows), { label: null, perRow: false });
});

test("eine gemischte Zeile nennt keinen Bereich, auch wenn eine Taste begrenzt ist", () => {
  // Quests: ⌃⇧Q global, ⌘⌥6 nur elric.
  const quests = group("Fabrik").find((r) => r.action === "mod.open:quests");
  assert.equal(quests.keys.length, 2);
  assert.equal(quests.tag, null);
});

test("allein getippter Modifier ist sein Zeichen", () => {
  assert.equal(chord("control", true), "⌃");
  assert.equal(chord("control", false), "Ctrl");
  assert.equal(pretty("control control", true), "⌃⌃");
  assert.equal(pretty("control control", false), "Ctrl Ctrl");
  assert.equal(chord("cmd-shift-h", true), "⌘⇧H");
});
