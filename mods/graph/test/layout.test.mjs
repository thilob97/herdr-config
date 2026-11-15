// Layout des Fabrik-Graphen ohne Fenster: Baum, Spalten, Ticket-Kanten und die
// Segmente, die der Renderer als `paint_path` malt.
//   node --test mods/graph/test/

import test from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, edgeSegments, edgeGutter, shortId, CARD_H, CARD_W, TICKET_H, PAD, GAP_Y, GAP_X, INDENT } from "../layout.js";

const lane = (o) => ({ label: o.id, kind: "agent", parent: null, ticket: null, start: 100, end: null, status: "working", events: [], subagents: [], ...o });
const graph = (lanes, tickets = [], extra = {}) => layoutGraph({ lanes, tickets, now: 200, ...extra });
const node = (g, id) => g.nodes.find((n) => n.id === id);
const chip = (g, id) => g.ticketNodes.find((n) => n.ticket === id);

test("Orchestrator steht oben und dispatcht seine Agents", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", start: 20 }),
    lane({ id: "b", parent: "orch", start: 30 }),
  ]);
  assert.equal(g.columns.length, 1);
  assert.equal(g.columns[0].root, "lane:orch");
  assert.equal(g.nodes[0].id, "lane:orch");
  assert.equal(node(g, "lane:a").y, PAD + CARD_H + GAP_Y);
  assert.deepEqual(g.edges.filter((e) => e.kind === "dispatch").map((e) => e.to), ["lane:a", "lane:b"]);
  assert.equal(g.edges.some((e) => e.to === "lane:orch"), false, "kein Pfeil in den Orchestrator");
});

test("eine Spalte je Wurzel, Kinder eingerückt und schmaler", () => {
  // Ohne Orchestrator sind zwei parentlose Agents zwei Wurzeln.
  const g = graph([
    lane({ id: "lone", start: 40 }),
    lane({ id: "other", start: 45 }),
    lane({ id: "kid", parent: "lone", start: 50 }),
  ]);
  assert.equal(g.columns.length, 2);
  assert.deepEqual(g.columns.map((c) => c.root), ["lane:lone", "lane:other"]);
  assert.equal(node(g, "lane:other").x, PAD + CARD_W + GAP_X);
  assert.equal(node(g, "lane:kid").x, PAD + INDENT);
  assert.equal(node(g, "lane:kid").w, CARD_W - INDENT);
  assert.equal(node(g, "lane:kid").depth, 1);
  // Kind bleibt in der Spalte seiner Wurzel, nicht in einer eigenen.
  assert.equal(node(g, "lane:kid").column, 0);
});

test("parentlose Agents hängen unter dem Orchestrator einer Spalte", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", start: 20 }),
    lane({ id: "b", start: 30 }),
  ]);
  assert.equal(g.columns.length, 1);
  assert.deepEqual(g.nodes.map((n) => n.id), ["lane:orch", "lane:a", "lane:b"]);
  assert.deepEqual(g.edges.filter((e) => e.kind === "dispatch").map((e) => e.to), ["lane:a", "lane:b"]);
  assert.equal(node(g, "lane:a").parent, "lane:orch");
});

test("blocked_by wird zum Bogen zwischen zwei sichtbaren Ticket-Chips", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1" }),
    lane({ id: "b", parent: "orch", ticket: "tk-2" }),
  ], [
    { id: "tk-1", status: "doing", blocked_by: "" },
    { id: "tk-2", status: "todo", blocked_by: "tk-1" },
  ]);
  const a = chip(g, "tk-1"), b = chip(g, "tk-2");
  assert.equal(a.label, shortId("tk-1"));
  assert.equal(b.label, shortId("tk-2"));
  // Der Chip sitzt in der Karte seines Agenten.
  assert.equal(a.x, node(g, "lane:a").x + 10);
  assert.equal(a.y, node(g, "lane:a").y + 42);
  assert.equal(a.h, TICKET_H);
  const edge = g.edges.find((e) => e.kind === "ticket");
  assert.equal(edge.from, "ticket:tk-1");
  assert.equal(edge.to, "ticket:tk-2");
  assert.equal(edge.dashed, false);
  // Der Bogen beginnt und endet an der Kartenkante in Höhe des Chips und läuft
  // links an den Karten vorbei (eigener Gutter, links vom Baum-Gutter).
  const na = node(g, "lane:a"), nb = node(g, "lane:b");
  assert.equal(edge.x1, na.x);
  assert.equal(edge.y1, na.y + 42 + TICKET_H / 2);
  assert.equal(edge.x2, nb.x);
  assert.equal(edge.y2, nb.y + 42 + TICKET_H / 2);
  assert.ok(edge.c1x < Math.min(edge.x1, edge.x2));
});

test("erledigter Blocker: gestrichelt; fremder Blocker: Chip statt Bogen", () => {
  const done = graph([lane({ id: "a", ticket: "tk-1" }), lane({ id: "b", ticket: "tk-2", start: 110 })], [
    { id: "tk-1", status: "done", blocked_by: "" },
    { id: "tk-2", status: "todo", blocked_by: "tk-1" },
  ]);
  assert.equal(done.edges.find((e) => e.kind === "ticket").dashed, true);

  // tk-1 gehört einer fremden Fabrik und ist darum nicht in `tickets` (ui.inScope).
  const foreign = graph([lane({ id: "b", ticket: "tk-2" })], [
    { id: "tk-2", status: "todo", blocked_by: "tk-1" },
  ]);
  assert.equal(foreign.edges.some((e) => e.kind === "ticket"), false);
  assert.equal(chip(foreign, "tk-2").label, `wartet auf ${shortId("tk-1")}`);
  assert.deepEqual(node(foreign, "lane:b").waits, [{ id: "tk-1", short: shortId("tk-1") }]);
});

test("Sub-Agents hängen unter ihrem Agenten, außerhalb des Fensters fallen sie weg", () => {
  const lanes = [
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({
      id: "a", parent: "orch", ticket: "tk-1", start: 20, subagents: [
        { id: "old", title: "alte Suche", started: 30, ended: 40 },
        { id: "new", title: "neue Suche", started: 150, ended: null },
      ],
    }),
  ];
  const all = graph(lanes);
  assert.equal(all.nodes.filter((n) => n.kind === "subagent").length, 2);

  const win = graph(lanes, [], { windowStart: 140 });
  const subs = win.nodes.filter((n) => n.kind === "subagent");
  assert.deepEqual(subs.map((n) => n.id), ["sub:a:new"]);
  assert.equal(subs[0].parent, "lane:a");
  assert.equal(subs[0].depth, 2);                 // Agent unter Orchestrator, Sub darunter
  assert.equal(subs[0].x, PAD + 2 * INDENT);
  assert.equal(subs[0].ticket, "tk-1");           // Text der Karte, kein zweiter Chip
  assert.equal(win.ticketNodes.length, 1);
  const edge = win.edges.find((e) => e.to === "sub:a:new");
  assert.equal(edge.kind, "parent");
});

test("Zeitfenster lässt nur Agents mit Tätigkeit im Fenster stehen", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "alt", parent: "orch", start: 20, end: 30, status: "done" }),
    lane({ id: "neu", parent: "orch", start: 150, end: 180, status: "done" }),
  ], [], { windowStart: 140 });
  assert.deepEqual(g.nodes.map((n) => n.id), ["lane:orch", "lane:neu"]);
});

test("Statusfilter behält den Orchestrator", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", start: 20, status: "working" }),
    lane({ id: "b", parent: "orch", start: 30, end: 40, status: "done" }),
  ], [], { filter: "done" });
  assert.deepEqual(g.nodes.map((n) => n.id), ["lane:orch", "lane:b"]);
});

test("Kantensegmente laufen links am Parent zum Kind", () => {
  const g = graph([lane({ id: "orch", kind: "orchestrator", start: 10 }), lane({ id: "a", parent: "orch", start: 20 })]);
  const edge = g.edges.find((e) => e.kind === "dispatch");
  const p = node(g, "lane:orch"), c = node(g, "lane:a");
  const midline = c.y + c.h / 2;
  assert.deepEqual(edgeSegments(edge), [
    p.x, p.y + p.h - 4, edgeGutter(p.x), p.y + p.h - 4,
    edgeGutter(p.x), midline, c.x, midline, false,
  ]);
  assert.equal(edgeSegments(edge).length, 9);
});

test("dieselbe Eingabe ergibt dasselbe Layout", () => {
  const lanes = [
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1" }),
    lane({ id: "b", parent: "orch", ticket: "tk-2", start: 120 }),
  ];
  const tickets = [{ id: "tk-1", status: "doing", blocked_by: "" }, { id: "tk-2", status: "todo", blocked_by: "tk-1" }];
  assert.deepEqual(layoutGraph({ lanes, tickets, now: 200 }), layoutGraph({ lanes, tickets, now: 200 }));
});
