// Tests der Filterlogik: Fab-Terminals und ihre Subagenten bleiben draußen,
// alle anderen Agenten bleiben sichtbar.
//   node --test mods/agents-filtered/test/

import test from "node:test";
import assert from "node:assert/strict";

import {
  fabricAddresses, fabricTerminal, visibleAgents, visibleTerminals,
} from "../model.js";

const term = (address, name, extra = {}) => ({
  address, name, state: "live", labels: {}, parent: null, ...extra,
});

test("Fab-Terminals erkennt Labels und den Namen fab-*", () => {
  assert.equal(fabricTerminal(term("t1", "fab-zap-t-14", { labels: { "fab.agent": "zap" } })), true);
  assert.equal(fabricTerminal(term("t2", "irgendwas", { labels: { "fab.role": "orchestrator" } })), true);
  assert.equal(fabricTerminal(term("t3", "fab-orchestrator")), true);
  assert.equal(fabricTerminal(term("t4", "fab-ada-t-3")), true);
  assert.equal(fabricTerminal(term("t5", "orchestrator")), false);
  assert.equal(fabricTerminal(term("t6", "zsh", { labels: { "herdr.space": "sp1" } })), false);
  assert.equal(fabricTerminal(null), false);
});

test("Subagenten ohne Labels gehören über parent zu ihren Fab-Terminals", () => {
  const terminals = [
    term("t8k", "fab-orchestrator"),
    term("t8x", "fab-zap-t-14"),
    term("t8z", "helfer", { parent: "t8x" }),
    term("t8g", "tief", { parent: "t8z" }),
    term("t8q", "frei"),
  ];
  const hidden = fabricAddresses(terminals);
  assert.deepEqual([...hidden].sort(), ["t8g", "t8k", "t8x", "t8z"]);
});

test("fremde Eltern und fremde Kinder bleiben sichtbar", () => {
  const terminals = [
    term("t7q", "orchestrator"),
    term("t8x", "fab-zap-t-14"),
    term("t8z", "kind", { parent: "t8x" }),
    term("t7k", "kind", { parent: "t7q" }),
  ];
  const visible = visibleAgents(
    [
      { address: "t7q" }, { address: "t7k" }, { address: "t8x" }, { address: "t8z" },
    ],
    terminals,
  );
  assert.deepEqual(visible.map((agent) => agent.address), ["t7q", "t7k"]);
});

test("Parent-Zyklen hängen nichts Fremdes an", () => {
  const terminals = [
    term("a", "a", { parent: "b" }),
    term("b", "b", { parent: "a" }),
    term("c", "fab-x-t-1"),
  ];
  assert.deepEqual([...fabricAddresses(terminals)], ["c"]);
});

test("ohne Fab-Terminals bleibt die Liste unverändert", () => {
  const terminals = [term("t7q", "orchestrator"), term("t7k", "kind", { parent: "t7q" })];
  const list = [{ address: "t7q" }, { address: "t7k" }];
  assert.deepEqual(visibleAgents(list, terminals), list);
  assert.deepEqual(visibleTerminals(terminals), terminals);
});

test("Terminalliste filtert dieselben Adressen", () => {
  const terminals = [
    term("t7q", "orchestrator"),
    term("t8k", "fab-orchestrator"),
    term("t8z", "helfer", { parent: "t8k" }),
  ];
  assert.deepEqual(
    visibleTerminals(terminals).map((terminal) => terminal.address),
    ["t7q"],
  );
});
