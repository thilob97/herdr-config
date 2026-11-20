// Tests der reinen Seitenleisten-Logik: Auswahl, Baum, Namen, Status, Laufzeit.
//   node --test mods/fabric-sidebar/test/

import test from "node:test";
import assert from "node:assert/strict";

import {
  costOf, costText, fabricEntry, fabricRows, runtimeText, statusWord, ticketFromName,
} from "../model.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const term = (address, name, labels, extra = {}) => ({
  address, name, state: "live", labels, parent: null, status: "idle",
  created_ms: NOW - 10 * MIN, ...extra,
});

const orchestrator = term("t8k", "fab-orchestrator", {
  "fab.role": "orchestrator", "herdr.space": "sp1", "herdr.tab": "tb1",
});
const zap = term("t8x", "fab-zap-t-12", {
  "fab.agent": "zap", "fab.ticket": "T-12", "herdr.space": "sp1", "herdr.tab": "tb2",
}, { created_ms: NOW - 5 * MIN });
const ada = term("t8y", "fab-ada-t-3", {
  "fab.agent": "ada", "fab.ticket": "T-3", "herdr.space": "sp1", "herdr.tab": "tb3",
}, { created_ms: NOW - 2 * 60 * MIN });
const other = term("t7q", "orchestrator", {}, { status: "working" });

test("nur Fabric-Terminals werden ausgewählt, der Orchestrator über Label oder Namen", () => {
  assert.equal(fabricEntry(orchestrator).orchestrator, true);
  assert.equal(fabricEntry(term("t1", "fab-orchestrator", {})).orchestrator, true);
  assert.equal(fabricEntry(term("t1b", "fab-zed-orchestrator", {})).orchestrator, true);
  assert.equal(fabricEntry(term("t1c", "fab-zed-zap-t-1", { "fab.agent": "zap" })).orchestrator, false);
  assert.deepEqual(fabricEntry(zap), {
    address: "t8x", name: "fab-zap-t-12", agent: "zap", ticket: "T-12", orchestrator: false,
  });
  assert.equal(fabricEntry(other), null);
  assert.equal(fabricEntry(term("t2", "t2", { "herdr.space": "sp1" })), null);
});

test("Ticket fällt ohne Label aus dem Terminalnamen", () => {
  assert.equal(ticketFromName("fab-zap-t-12"), "T-12");
  assert.equal(ticketFromName("fab-ada-t-3"), "T-3");
  assert.equal(ticketFromName("fab-orchestrator"), null);
  assert.equal(ticketFromName("zap"), null);
  assert.equal(fabricEntry(term("t3", "fab-zap-t-4", { "fab.agent": "zap" })).ticket, "T-4");
});

test("echte Subagenten ohne fab-Labels stehen unter ihrem Elternagenten", () => {
  // `hc run` ohne --no-parent: nur parent, keine fab.*-Labels.
  const sub = term("t8z", "t4-sub", {}, { parent: "t8y", status: "working" });
  const grand = term("t8g", "t4-grand", {}, { parent: "t8z", status: "idle" });
  const helper = term("t8h", "helper", {}, { parent: "t8k", status: "idle" });
  const stray = term("t9q", "stray", {}, { status: "idle" });
  const stranger = term("t8w", "fab-zap-t-7", {
    "fab.agent": "zap", "fab.ticket": "T-7",
  }, { parent: "t-unknown" });

  const { orchestrator: top, rows } = fabricRows(
    [orchestrator, zap, ada, sub, grand, helper, stray, stranger, other],
    [{ address: "t8z", status: "blocked" }],
    [
      { id: "T-12", title: "Eigener Fabric-Abschnitt" },
      { id: "T-3", title: "Zeitverlauf" },
      { id: "T-7", title: "Ohne bekannten Elternagenten" },
    ],
    [{ name: "zap", role: "umsetzer" }, { name: "ada", role: "pruefer" }],
    NOW,
  );

  assert.equal(top.address, "t8k");
  assert.deepEqual(rows.map((row) => [row.address, row.depth]), [
    ["t8k", 0],
    ["t8y", 1],
    ["t8z", 2],
    ["t8g", 3],
    ["t8w", 1],
    ["t8x", 1],
    ["t8h", 1],
  ]);
  assert.deepEqual(rows.map((row) => row.title), [
    "Orchestrator",
    "ada · T-3 Zeitverlauf",
    "t4-sub · T-3 Zeitverlauf",
    "t4-grand · T-3 Zeitverlauf",
    "zap · T-7 Ohne bekannten Elternagenten",
    "zap · T-12 Eigener Fabric-Abschnitt",
    "helper",
  ]);
  assert.equal(rows.find((row) => row.address === "t8z").status, "blocked");
  assert.equal(rows.some((row) => row.address === "t9q"), false);
});

test("ohne Orchestrator stehen Agenten als Wurzeln", () => {
  const { orchestrator: top, rows } = fabricRows([zap, ada], [], [], [], NOW);
  assert.equal(top, null);
  assert.deepEqual(rows.map((row) => [row.address, row.depth]), [["t8y", 0], ["t8x", 0]]);
});

test("Status kommt aus agents(), sonst vom Terminal", () => {
  const { rows } = fabricRows(
    [orchestrator, zap, ada],
    [{ address: "t8x", status: "working" }, { address: "t8y", status: "blocked" }],
    [{ id: "T-12", title: "A" }, { id: "T-3", title: "B" }],
    [],
    NOW,
  );
  assert.deepEqual(rows.map((row) => model_wrap(row)), [
    ["t8k", "idle", "bereit"],
    ["t8y", "blocked", "wartet"],
    ["t8x", "working", "arbeitet"],
  ]);
  assert.deepEqual(
    ["working", "blocked", "done", "idle", "error", "weg"].map(statusWord),
    ["arbeitet", "wartet", "fertig", "bereit", "Fehler", "weg"],
  );
});

// Kleine Hilfe: [Adresse, roher Status, deutsches Wort].
function model_wrap(row) {
  return [row.address, row.status, statusWord(row.status)];
}

test("Rolle, Laufzeit und Kosten stehen nur da, wenn es sie gibt", () => {
  const { rows } = fabricRows(
    [orchestrator, zap, ada],
    [],
    [{ id: "T-12", title: "A" }, { id: "T-3", title: "B" }],
    [{ name: "zap", role: "umsetzer" }],
    NOW,
  );
  const byAddress = new Map(rows.map((row) => [row.address, row]));
  assert.equal(byAddress.get("t8x").meta, "umsetzer · bereit · 5m");
  assert.equal(byAddress.get("t8y").meta, "bereit · 2h");
  assert.equal(byAddress.get("t8k").meta, "bereit · 10m");
  assert.equal(byAddress.get("t8x").costText, "");
});

test("Kosten erscheinen, wenn Herdr sie meldet", () => {
  const paid = term("t9", "fab-zap-t-1", { "fab.agent": "zap", "fab.ticket": "T-1" }, { cost_usd: 1.234 });
  assert.equal(costOf(paid), 1.234);
  assert.equal(costText(1.234), "$1.23");
  assert.equal(costText(null), "");
  const { rows } = fabricRows([paid], [], [{ id: "T-1", title: "A" }], [], NOW);
  assert.equal(rows[0].meta, "bereit · 10m · $1.23");
});

test("Laufzeit formatiert Minuten, Stunden, Tage; ohne Start leer", () => {
  assert.equal(runtimeText(NOW - 30_000, NOW), "<1m");
  assert.equal(runtimeText(NOW - 5 * MIN, NOW), "5m");
  assert.equal(runtimeText(NOW - 125 * MIN, NOW), "2h");
  assert.equal(runtimeText(NOW - 3 * 24 * 60 * MIN, NOW), "3d");
  assert.equal(runtimeText(undefined, NOW), "");
  assert.equal(runtimeText(NOW + MIN, NOW), "");
});

test("zwei Teams mit eigenem Orchestrator: Team oben, Agenten eingerückt, Subagent erbt", () => {
  const alphaOrch = term("a1", "fab-alpha-orchestrator", {
    "fab.role": "orchestrator", "fab.team": "alpha",
  });
  const betaOrch = term("b1", "fab-beta-orchestrator", {
    "fab.role": "orchestrator", "fab.team": "beta",
  });
  // Kein `fab.team`: das Team kommt aus dem Terminalnamen.
  const alphaZap = term("a2", "fab-alpha-zap-t-1", {
    "fab.agent": "zap", "fab.ticket": "T-1",
  }, { created_ms: NOW - 5 * MIN });
  const betaAda = term("b2", "fab-beta-ada-t-2", {
    "fab.agent": "ada", "fab.ticket": "T-2",
  });
  const betaSub = term("b3", "sub", {}, { parent: "b2" });

  const { orchestrator: top, rows, teams } = fabricRows(
    [betaAda, betaSub, alphaZap, betaOrch, alphaOrch],
    [],
    [{ id: "T-1", title: "Eins" }, { id: "T-2", title: "Zwei" }],
    [
      { name: "zap", role: "umsetzer", teams: ["alpha"] },
      { name: "ada", role: "pruefer", teams: ["beta"] },
    ],
    NOW,
    [{ name: "alpha" }, { name: "beta" }],
  );

  assert.equal(top.address, "a1");
  assert.deepEqual(teams.map((team) => team.name), ["alpha", "beta"]);
  assert.deepEqual(teams.map((team) => team.orchestrator.address), ["a1", "b1"]);
  assert.deepEqual(teams[0].rows.map((row) => [row.address, row.depth, row.team]), [
    ["a1", 0, "alpha"],
    ["a2", 1, "alpha"],
  ]);
  assert.deepEqual(teams[1].rows.map((row) => [row.address, row.depth, row.team]), [
    ["b1", 0, "beta"],
    ["b2", 1, "beta"],
    ["b3", 2, "beta"],
  ]);
  assert.deepEqual(rows.map((row) => row.address), ["a1", "a2", "b1", "b2", "b3"]);
  assert.equal(teams[0].count, 2);
  assert.equal(teams[1].count, 3);
});

test("ohne Team-Label entscheidet der Name, der längste Teamname gewinnt; Legacy-Orchestrator ins erste Team", () => {
  const legacy = term("o1", "fab-orchestrator", { "fab.role": "orchestrator" });
  const web = term("w1", "fab-acme-web-ada-t-3", { "fab.agent": "ada", "fab.ticket": "T-3" });
  const core = term("c1", "fab-acme-zap-t-4", { "fab.agent": "zap", "fab.ticket": "T-4" });

  const { rows, teams } = fabricRows(
    [legacy, web, core], [], [], [], NOW,
    [{ name: "acme" }, { name: "acme-web" }],
  );

  assert.deepEqual(teams.map((team) => team.name), ["acme", "acme-web"]);
  // Das alte globale `fab-orchestrator` gehört zum ersten (Legacy-)Team.
  assert.equal(teams[0].orchestrator.address, "o1");
  assert.deepEqual(teams[0].rows.map((row) => [row.address, row.depth]), [
    ["o1", 0],
    ["c1", 1],
  ]);
  // Gruppe ohne Orchestrator: Agenten beginnen bei depth 0.
  assert.equal(teams[1].orchestrator, null);
  assert.deepEqual(teams[1].rows.map((row) => [row.address, row.depth]), [["w1", 0]]);
  assert.equal(teams[1].rows[0].team, "acme-web");
  assert.deepEqual(rows.map((row) => row.address), ["o1", "c1", "w1"]);
});

test("Gruppen folgen der Team-Reihenfolge, Unbekannte alphabetisch", () => {
  const zulu = term("z1", "fab-zulu-orchestrator", {
    "fab.role": "orchestrator", "fab.team": "zulu",
  });
  const alpha = term("a1", "fab-alpha-orchestrator", {
    "fab.role": "orchestrator", "fab.team": "alpha",
  });
  const gamma = term("g1", "fab-gamma-x-t-1", {
    "fab.agent": "x", "fab.ticket": "T-1", "fab.team": "gamma",
  });

  const { teams } = fabricRows(
    [gamma, alpha, zulu], [], [], [], NOW,
    [{ name: "zulu" }, { name: "alpha" }],
  );

  assert.deepEqual(teams.map((team) => team.name), ["zulu", "alpha", "gamma"]);
  assert.deepEqual(teams.map((team) => team.orchestrator?.address ?? null), ["z1", "a1", null]);
});
