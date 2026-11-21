// Tests der reinen Seitenleisten-Logik: Auswahl, Baum, Namen, Status, Laufzeit.
//   node --test mods/fabric-sidebar/test/

import test from "node:test";
import assert from "node:assert/strict";

import {
  busyLabel, costOf, costText, fabricAddresses, fabricEntry, fabricRows, freeAgentCards,
  freeCornerIcon, freeSpriteKey, freeStatusWord, hiddenAgentAddresses, runtimeText, statusWord,
  ticketFromName, truncateTask,
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

// --- Freie Agenten ohne Fabric-Team (AGENTS-Abschnitt) ----------------------

test("freie Agenten: Space-Orchestrator ja, Fabric-Terminals und ihre Kinder nein", () => {
  const space = term("t7q", "orchestrator", { "hub.role": "orchestrator" }, {
    status: "done", title: "orchestrator",
  });
  const teamOrch = term("t118", "fab-herdr-app-orchestrator", {
    "fab.role": "orchestrator",
  }, { status: "done" });
  const zapAgent = term("t119", "fab-herdr-app-zap-t-43", {
    "fab.agent": "zap", "fab.ticket": "T-43",
  }, { status: "working" });
  const free = term("t10b", "autopilot", {}, { status: "working", title: "autopilot" });
  const child = term("t8z", "kind", {}, { parent: "t119", status: "idle" });
  const shell = term("t1", "zsh", {}, { status: null });

  const { cards } = freeAgentCards([space, teamOrch, zapAgent, free, child, shell], [], []);
  assert.deepEqual(cards.map((card) => card.address), ["t7q", "t10b"]);
  assert.equal(cards[0].orchestrator, true);
  assert.equal(cards[1].orchestrator, false);
  // Der Orchestrator bleibt im Fabric-Abschnitt, der freie Agent nicht.
  assert.equal(fabricEntry(teamOrch).orchestrator, true);
  assert.equal(fabricEntry(space), null);
});

test("freie Karten: alle fünf Status, Badge, Eck-Icon, Motiv, Klickziel", () => {
  const statuses = ["working", "blocked", "done", "idle", "error"];
  const { cards } = freeAgentCards(
    statuses.map((status, index) => term(`f${index}`, `frei-${index}`, {}, {
      status, title: `Agent ${index}`,
    })),
    [],
    [],
  );
  assert.deepEqual(cards.map((card) => card.badge), [
    "WORKING", "WAITING", "DONE", "IDLE", "ERROR",
  ]);
  assert.deepEqual(cards.map((card) => card.icon), ["play", "clock", "note", "zzz", "alert"]);
  for (const [index, card] of cards.entries()) {
    assert.equal(card.sprite, ["agent-a", "agent-b"][index % 2]);
    assert.deepEqual(card.click, { kind: "terminal", terminal: card.address });
  }
  assert.deepEqual(statuses.map(freeStatusWord), ["WORKING", "WAITING", "DONE", "IDLE", "ERROR"]);
  assert.equal(freeCornerIcon("weg"), "dot");
});

test("Orchestrator-Motiv unterscheidet sich von Agenten-Motiven", () => {
  const [orchestrator] = freeAgentCards(
    [term("o1", "orchestrator", { "hub.role": "orchestrator" }, { status: "idle" })],
    [], [],
  ).cards;
  assert.equal(orchestrator.sprite, "orchestrator");
  assert.equal(freeSpriteKey({ name: "zap" }), freeSpriteKey({ name: "zap" }));
  assert.notEqual(freeSpriteKey({}, 0), freeSpriteKey({}, 1));
  assert.notEqual(orchestrator.sprite, freeSpriteKey({ name: "zap" }));
});

test("Kürzung langer Aufgaben, Gruppenzähler 0/3 und N BUSY", () => {
  const long = "Ein sehr langer Ticket-Titel, der in der schmalen Seitenleiste nicht vollständig Platz hat";
  assert.equal(truncateTask("kurz"), "kurz");
  assert.ok(truncateTask(long).length <= 42);
  assert.ok(truncateTask(long).endsWith("…"));
  assert.equal(truncateTask("a\nb   c"), "a b c");

  const idle = [0, 1, 2].map((index) => term(`i${index}`, `ruhig-${index}`, {}, {
    status: "idle", title: long,
  }));
  const quiet = freeAgentCards(idle, [], []);
  assert.deepEqual(quiet.groups.map((group) => [group.name, group.busy, group.total]), [
    ["THIS MACHINE", 0, 3],
  ]);
  assert.equal(busyLabel(quiet.busy), "0 BUSY");
  assert.equal(quiet.groups[0].cards[0].task.endsWith("…"), true);

  const mixed = freeAgentCards([
    ...idle,
    term("w1", "arbeit-1", {}, { status: "working" }),
    term("remote/w2", "arbeit-2", {}, { status: "working" }),
  ], [], []);
  assert.equal(busyLabel(mixed.busy), "2 BUSY");
  assert.deepEqual(mixed.groups.map((group) => [group.name, group.busy, group.total]), [
    ["THIS MACHINE", 1, 4],
    ["REMOTE", 1, 1],
  ]);
  assert.deepEqual(mixed.groups[1].cards[0].click, { kind: "terminal", terminal: "remote/w2" });
});

// --- Veröffentlichter Snapshot für andere Mods ------------------------------

test("hiddenAgentAddresses: Fabric samt Nachfahren und freie Karten, reine Shells nicht", () => {
  const orch = term("t8k", "fab-orchestrator", { "fab.role": "orchestrator" });
  const agent = term("t8x", "fab-zap-t-12", { "fab.agent": "zap", "fab.ticket": "T-12" });
  const sub = term("t8z", "kind", {}, { parent: "t8x" });
  const grand = term("t8g", "enkel", {}, { parent: "t8z" });
  const space = term("t7q", "orchestrator", { "hub.role": "orchestrator" }, { status: "done" });
  const reported = term("t7r", "autopilot", {}, { status: "working" });
  const shell = term("shell", "zsh", {}, { status: null });

  const snapshot = hiddenAgentAddresses(
    [orch, agent, sub, grand, space, reported, shell],
    [{ address: "t7r", status: "working" }],
  );

  assert.deepEqual(snapshot.fabric.sort(), ["t8g", "t8k", "t8x", "t8z"]);
  // Dieselbe Auswahl wie die freien Karten; die Shell bleibt sichtbar.
  assert.deepEqual(snapshot.free.sort(), ["t7q", "t7r"]);
  assert.equal(snapshot.fabric.some((address) => snapshot.free.includes(address)), false);
  assert.equal(snapshot.fabric.includes("shell"), false);
  assert.equal(snapshot.free.includes("shell"), false);
  assert.deepEqual(
    freeAgentCards([orch, agent, sub, grand, space, reported, shell], [], []).cards.map((card) => card.address).sort(),
    ["t7q", "t7r"],
  );
  assert.deepEqual(hiddenAgentAddresses(), { fabric: [], free: [] });
});

// --- Kartenname und Aufgabenzeile -------------------------------------------

test("Kartenname kommt vom Label, die Aufgabe aus dem bereinigten Titel", () => {
  const [card] = freeAgentCards([
    term("o1", "orchestrator", { "hub.role": "orchestrator" }, {
      status: "working", title: "π > FABRIC: Build fab tick ✨",
    }),
  ], [], []).cards;
  assert.equal(card.name, "orchestrator");
  assert.equal(card.task, "FABRIC: Build fab tick");
});

test("Label vor Terminalname; Programmpräfix vor Statusglyphe und Emoji fallen weg", () => {
  const byLabel = freeAgentCards(
    [term("t77", "t-77", { "hub.role": "orchestrator" }, { status: "idle" })], [], [],
  ).cards;
  assert.equal(byLabel[0].name, "orchestrator");

  const [cost] = freeAgentCards([
    term("t78", "t-78", {}, { status: "working", title: "π ⠼ 💰 COST: Add per-ticket costs" }),
  ], [], []).cards;
  assert.equal(cost.name, "t-78");
  assert.equal(cost.task, "COST: Add per-ticket costs");
});

test("ein Titel, der nur den Namen wiederholt, lässt die Aufgabe leer", () => {
  const [card] = freeAgentCards([
    term("t79", "orchestrator", { "hub.role": "orchestrator" }, {
      status: "idle", title: "orchestrator",
    }),
  ], [], []).cards;
  assert.equal(card.name, "orchestrator");
  assert.equal(card.task, "");
});

// --- Abgrenzung der Fabric-Terminals ---------------------------------------

test("fabricAddresses: Labels, fab-Name, Nachfahrenkette, fremde Eltern, Zyklus", () => {
  const byAgent = term("a1", "x", { "fab.agent": "zap" });
  const byRole = term("a2", "x", { "fab.role": "orchestrator" });
  const byName = term("a3", "fab-ada-t-9", {});
  const child = term("a4", "kind", {}, { parent: "a1" });
  const grand = term("a5", "enkel", {}, { parent: "a4" });
  const foreignParent = term("b0", "orchestrator", {});
  const foreignChild = term("b1", "kind", {}, { parent: "b0" });
  const cyc1 = term("c1", "c1", {}, { parent: "c2" });
  const cyc2 = term("c2", "c2", {}, { parent: "c1" });

  const hidden = fabricAddresses([
    byAgent, byRole, byName, child, grand, foreignParent, foreignChild, cyc1, cyc2,
  ]);
  assert.deepEqual([...hidden].sort(), ["a1", "a2", "a3", "a4", "a5"]);
  assert.deepEqual([...fabricAddresses()], []);
});
