// Tests der Filterlogik: Die Liste blendet genau die Adressen aus, die die
// Fabric-Seitenleiste als Karte veröffentlicht — auch gepinnte Agenten.
//   node --test mods/agents-filtered/test/

import test from "node:test";
import assert from "node:assert/strict";

import { hiddenForLayout, visibleAgents, visibleTerminals } from "../model.js";
// Nur im Test erlaubt: die Regel liegt in der Fabric-Seitenleiste.
import { hiddenAgentAddresses } from "../../fabric-sidebar/model.js";

const term = (address, name, extra = {}) => ({
  address, name, state: "live", labels: {}, parent: null, ...extra,
});

test("freier Agent verschwindet auch gepinnt, wenn die Fabric-Seitenleiste ihn zeigt", () => {
  const fabric = {
    address: "t7q",
    name: "orchestrator",
    state: "live",
    labels: { "hub.role": "orchestrator" },
    title: "π > FABRIC: ...",
  };
  const listed = [{ address: "t7q", status: "working", pinned: true }];
  const snapshot = hiddenAgentAddresses([fabric], listed);
  assert.deepEqual(snapshot.free, ["t7q"]);
  assert.deepEqual(visibleAgents(listed, snapshot, "fabric"), []);
});

test("reine Shell ohne Status bleibt neben dem freien Agenten sichtbar", () => {
  const fabric = {
    address: "t7q",
    name: "orchestrator",
    state: "live",
    labels: { "hub.role": "orchestrator" },
  };
  const listed = [{ address: "t7q", status: "working", pinned: true }];
  const snapshot = hiddenAgentAddresses([fabric], listed);
  const list = [{ address: "shell" }, ...listed];
  assert.deepEqual(visibleAgents(list, snapshot, "fabric"), [{ address: "shell" }]);
});

test("im Layout board bleibt der freie Agent sichtbar, Fab-Terminals bleiben draußen", () => {
  const free = {
    address: "t7q",
    name: "orchestrator",
    state: "live",
    labels: { "hub.role": "orchestrator" },
  };
  const fab = term("t8k", "fab-orchestrator", { labels: { "fab.role": "orchestrator" } });
  const child = term("t8z", "kind", { parent: "t8k" });
  const listed = [{ address: "t7q", status: "working" }];
  const snapshot = hiddenAgentAddresses([free, fab, child], listed);

  assert.deepEqual(visibleAgents(listed, snapshot, "board").map((a) => a.address), ["t7q"]);
  assert.deepEqual(
    visibleAgents([...listed, { address: "t8k" }, { address: "t8z" }], snapshot, "board")
      .map((a) => a.address),
    ["t7q"],
  );
  assert.deepEqual(
    [...hiddenForLayout(snapshot, "board")].sort(),
    ["t8k", "t8z"],
  );
});

test("visibleTerminals blendet fabric immer und free nur im Layout fabric aus", () => {
  const free = term("t7q", "orchestrator", { labels: { "hub.role": "orchestrator" } });
  const shell = term("shell", "zsh", { status: null });
  const fab = term("t8k", "fab-orchestrator", { labels: { "fab.role": "orchestrator" } });
  const child = term("t8z", "kind", { parent: "t8k" });
  const all = [free, shell, fab, child];
  const snapshot = hiddenAgentAddresses(all, [{ address: "t7q", status: "working" }]);

  assert.deepEqual(
    visibleTerminals(all, snapshot, "fabric").map((terminal) => terminal.address),
    ["shell"],
  );
  assert.deepEqual(
    visibleTerminals(all, snapshot, "board").map((terminal) => terminal.address),
    ["t7q", "shell"],
  );
  assert.deepEqual(visibleTerminals(all), all);
  assert.deepEqual(visibleAgents([{ address: "t7q" }, { address: "shell" }]), [
    { address: "t7q" }, { address: "shell" },
  ]);
});

test("kaputte Snapshots und Werte blenden nichts Unerwartetes aus", () => {
  assert.deepEqual([...hiddenForLayout(null)], []);
  assert.deepEqual([...hiddenForLayout(undefined, "fabric")], []);
  assert.deepEqual([...hiddenForLayout({ fabric: "t7q", free: { a: 1 } })], []);
  assert.deepEqual([...hiddenForLayout({ fabric: [null, "", 5] })].sort(), ["5"]);
  assert.deepEqual(visibleAgents(null, { fabric: ["a"] }), []);
  assert.deepEqual(
    visibleAgents([{ address: "a" }, { address: "b" }], { fabric: ["a"] }).map((a) => a.address),
    ["b"],
  );
});
