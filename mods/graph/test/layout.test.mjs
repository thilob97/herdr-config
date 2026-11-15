// Layout des Fabrik-Graphen ohne Fenster: Wurzel, Spalten, kompakte Karten,
// Ticket-Chips und die orthogonalen Kantenzüge, die der Renderer als
// `paint_path` malt.
//   node --test mods/graph/test/

import test from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, shortId, CARD_H, ROOT_H, TICKET_H, PAD, CHIP_GAP, CHIP_INSET,
  DISPATCH_GAP } from "../layout.js";

const lane = (o) => ({ label: o.id, kind: "agent", parent: null, ticket: null, start: 100, end: null, status: "working", events: [], subagents: [], ...o });
const graph = (lanes, tickets = [], extra = {}) => layoutGraph({ lanes, tickets, now: 200, width: 760, ...extra });
const node = (g, id) => g.nodes.find((n) => n.id === id);
const chip = (g, id) => g.ticketNodes.find((n) => n.ticket === id);
const rect = (n) => ({ l: n.x, r: n.x + n.w, t: n.y, b: n.y + n.h });

function overlap(a, b) {
  const x = rect(a), y = rect(b);
  return x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5;
}

const agents = (n) => Array.from({ length: n }, (_, i) => lane({ id: `a${i + 1}`, parent: "orch", start: 20 + i }));

test("Orchestrator ist die Wurzel oben mittig und dispatcht seine Agents", () => {
  const g = graph([lane({ id: "orch", kind: "orchestrator", start: 10 }), ...agents(2)]);
  const root = node(g, "lane:orch");
  assert.equal(root.kind, "orchestrator");
  assert.equal(root.y, PAD);
  assert.equal(root.x + root.w / 2, 760 / 2);
  assert.equal(root.h, ROOT_H);
  assert.equal(root.subtitle, "verteilt 2 Agenten");
  assert.equal(node(g, "lane:a1").y, PAD + ROOT_H + DISPATCH_GAP);
  const dispatch = g.edges.filter((e) => e.kind === "dispatch");
  assert.deepEqual(dispatch.map((e) => e.to), ["lane:a1", "lane:a2"]);
  for (const e of dispatch) {
    assert.equal(e.from, "lane:orch");
    assert.deepEqual(e.points[0], [root.x + root.w / 2, root.y + root.h], "Dispatch startet an der Unterkante der Wurzel");
    assert.equal(e.points[e.points.length - 1][1], node(g, e.to).y, "und endet an der Oberkante des Agenten");
    assert.equal(e.dashed, false, "Baumkanten sind nie gestrichelt");
  }
  assert.equal(g.edges.some((e) => e.to === "lane:orch"), false, "kein Pfeil in den Orchestrator");
});

test("jeder Agent bekommt eine Spalte, verteilt über die Panelbreite", () => {
  const g = graph([lane({ id: "orch", kind: "orchestrator", start: 10 }), ...agents(5)]);
  const byColumn = new Map();
  for (const n of g.nodes.filter((x) => x.kind === "agent")) {
    const list = byColumn.get(n.column) ?? [];
    list.push(n);
    byColumn.set(n.column, list);
  }
  assert.equal(g.columns.length, 3, "760 px tragen drei Spalten");
  assert.deepEqual([...byColumn.keys()].sort(), [0, 1, 2]);
  assert.ok(node(g, "lane:a1").x < node(g, "lane:a2").x);
  assert.ok(node(g, "lane:a2").x < node(g, "lane:a3").x);
  const first = Math.min(...g.nodes.map((n) => n.x));
  const last = Math.max(...g.nodes.map((n) => n.x + n.w));
  assert.ok(first >= PAD - 0.5 && first <= PAD + 80, "erste Spalte beginnt am linken Rand");
  assert.ok(last <= 760 - PAD + 0.5 && last >= 760 - PAD - 80, "letzte Spalte reicht an den rechten Rand");
  for (const a of g.nodes) for (const b of g.nodes) if (a.id < b.id) assert.equal(overlap(a, b), false, `${a.id} überlappt ${b.id}`);
});

test("Sub-Agents hängen eingerückt unter ihrem Parent", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({
      id: "a", parent: "orch", ticket: "tk-1", start: 20, subagents: [
        { id: "s1", title: "Suche", started: 30, ended: null },
        { id: "s2", title: "Tests", started: 40, ended: 50 },
      ],
    }),
    lane({ id: "b", parent: "orch", start: 30 }),
  ]);
  const parent = node(g, "lane:a");
  const subs = g.nodes.filter((n) => n.kind === "subagent");
  assert.deepEqual(subs.map((n) => n.id), ["sub:a:s1", "sub:a:s2"]);
  for (const s of subs) {
    assert.equal(s.parent, "lane:a");
    assert.equal(s.column, parent.column, "Sub-Agent bleibt in der Spalte seines Parents");
    assert.ok(s.x > parent.x, "und ist nach rechts eingerückt");
    assert.ok(s.w < parent.w, "die eingerückte Karte ist schmaler");
    assert.ok(s.y > parent.y + parent.h, "und steht unter ihm");
  }
  assert.ok(subs[0].y < subs[1].y);
  for (const a of g.nodes) for (const b of g.nodes) if (a.id < b.id) assert.equal(overlap(a, b), false, `${a.id} überlappt ${b.id}`);
  const parentEdge = g.edges.find((e) => e.to === "sub:a:s1");
  assert.equal(parentEdge.kind, "parent");
  assert.equal(parentEdge.points[0][1], parent.y + parent.h, "startet an der Unterkante des Parents");
  assert.ok(parentEdge.points[0][0] >= parent.x + 10 && parentEdge.points[0][0] <= parent.x + parent.w - 10);
  assert.deepEqual(parentEdge.points[parentEdge.points.length - 1], [subs[0].x + subs[0].w / 2, subs[0].y]);
});

test("Ticket-Kürzel bleiben auch bei gleichem Wortstamm unterscheidbar", () => {
  const ids = ["graph-spalten-verteilen", "graph-kanten-ziehen", "graph-chips-bundeln"];
  assert.equal(new Set(ids.map(shortId)).size, ids.length);
  assert.equal(shortId("graph-spalten-verteilen"), "GRAPH-SP");
  assert.equal(shortId("demo-1"), "DEMO-1");
});

test("Agent-Karten sind kompakt, der Ticket-Chip sitzt als Zeile darunter", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1" }),
  ], [{ id: "tk-1", status: "doing", blocked_by: "" }]);
  const a = node(g, "lane:a");
  assert.equal(a.h, CARD_H);
  assert.ok(a.h <= 40);
  const c = chip(g, "tk-1");
  assert.equal(c.node, a.id);
  assert.equal(c.x, a.x + CHIP_INSET, "gleiche Spalte");
  assert.equal(c.y, a.y + a.h + CHIP_GAP, "direkt unter der Karte");
  assert.equal(c.h, TICKET_H);
  assert.equal(c.status, "doing");
  assert.equal(c.label, shortId("tk-1"));
});

test("blocked_by wird zum Pfeil vom Ticket zum sichtbaren Blocker", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1" }),
    lane({ id: "b", parent: "orch", ticket: "tk-2", start: 120 }),
  ], [
    { id: "tk-1", status: "doing", blocked_by: "" },
    { id: "tk-2", status: "todo", blocked_by: "tk-1" },
  ]);
  const a = chip(g, "tk-1"), b = chip(g, "tk-2");
  const edge = g.edges.find((e) => e.kind === "ticket");
  assert.equal(edge.from, b.id, "der wartende Chip ist die Quelle");
  assert.equal(edge.to, a.id, "der Blocker ist das Ziel");
  assert.deepEqual(edge.points[0], [b.x, b.y + b.h / 2], "Start an der Chipkante");
  assert.deepEqual(edge.points[edge.points.length - 1], [a.x + a.w, a.y + a.h / 2], "Ende an der Chipkante");
  assert.equal(edge.dashed, false);
  assert.equal(edge.faint, false);
});

test("erledigte Abhängigkeit: gestrichelt und zart; fremder Blocker: Chip statt Pfeil", () => {
  const done = graph([lane({ id: "a", ticket: "tk-1" }), lane({ id: "b", ticket: "tk-2", start: 110 })], [
    { id: "tk-1", status: "done", blocked_by: "" },
    { id: "tk-2", status: "done", blocked_by: "tk-1" },
  ]);
  const edge = done.edges.find((e) => e.kind === "ticket");
  assert.equal(edge.dashed, true);
  assert.equal(edge.faint, true);

  const foreign = graph([lane({ id: "b", ticket: "tk-2" })], [
    { id: "tk-2", status: "todo", blocked_by: "tk-1" },
  ]);
  assert.equal(foreign.edges.some((e) => e.kind === "ticket"), false);
  assert.equal(chip(foreign, "tk-2").label, `wartet auf ${shortId("tk-1")}`);
  assert.deepEqual(node(foreign, "lane:b").waits, [{ id: "tk-1", short: shortId("tk-1") }]);
});

test("400 px: zwei schmale Spalten und einzeilige Karten ohne Überlappung", () => {
  const g = graph([lane({ id: "orch", kind: "orchestrator", start: 10 }), ...agents(5)], [], { width: 400 });
  assert.equal(g.narrow, true);
  assert.equal(g.columns.length, 2);
  const a = node(g, "lane:a1");
  assert.equal(a.h, CARD_H);
  assert.ok(a.w < 220, "Spaltenbreite schrumpft");
  for (const x of g.nodes) for (const y of g.nodes) if (x.id < y.id) assert.equal(overlap(x, y), false, `${x.id} überlappt ${y.id}`);
  for (const c of g.ticketNodes) {
    const n = node(g, c.node);
    assert.ok(c.x + c.w <= n.x + n.w, "Chip bleibt in der Spalte");
  }
});

test("keine Kante läuft durch eine fremde Karte", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "t1" }),
    lane({ id: "b", parent: "orch", ticket: "t2", start: 110 }),
    lane({ id: "c", parent: "orch", ticket: "t3", start: 120 }),
    lane({ id: "d", parent: "b", ticket: "t4", start: 130 }),
  ], [
    { id: "t1", status: "done", blocked_by: "" },
    { id: "t2", status: "doing", blocked_by: "t1" },
    { id: "t3", status: "todo", blocked_by: "t2" },
    { id: "t4", status: "todo", blocked_by: "t1" },
  ], { width: 400 });
  const hits = (p, q, n) => {
    const [x1, y1] = p, [x2, y2] = q, l = n.x + 1, r = n.x + n.w - 1, t = n.y + 1, b = n.y + n.h - 1;
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const clip = (d, lo, hi) => {
      if (d === 0) return lo <= 0 && hi >= 0;
      const a = lo / d, c = hi / d, lo2 = Math.min(a, c), hi2 = Math.max(a, c);
      t0 = Math.max(t0, lo2); t1 = Math.min(t1, hi2);
      return t0 < t1;
    };
    return clip(dx, l - x1, r - x1) && clip(dy, t - y1, b - y1);
  };
  for (const e of g.edges) {
    for (let i = 0; i < e.points.length - 1; i++) {
      for (const n of g.nodes) {
        if (e.from === n.id || e.to === n.id || n.id === `lane:${n.laneId}` && (e.from === n.chip || e.to === n.chip)) continue;
        if (e.from === `ticket:${n.ticket}` || e.to === `ticket:${n.ticket}`) continue;
        assert.equal(hits(e.points[i], e.points[i + 1], n), false,
          `${e.kind} ${e.from}->${e.to} läuft durch ${n.id}`);
      }
    }
  }
});

test("jede Kante endet an Knotenrändern, keine am Panelrand", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    ...agents(5),
    lane({ id: "sub", parent: "a1", start: 60 }),
  ], [
    { id: "t1", status: "doing", blocked_by: "" },
    { id: "t2", status: "todo", blocked_by: "t1" },
    { id: "t3", status: "todo", blocked_by: "t1" },
  ]);
  for (const e of g.edges) {
    assert.ok(e.points.length >= 2);
    for (const [x, y] of e.points) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(x >= 0 && x <= g.width && y >= 0 && y <= g.height);
    }
    const [sx] = e.points[0];
    const [ex] = e.points[e.points.length - 1];
    assert.notEqual(sx, 0);
    assert.notEqual(sx, g.width);
    assert.notEqual(ex, 0);
    assert.notEqual(ex, g.width);
  }
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

test("ohne Orchestrator ist jede parentlose Lane eine eigene Spalte", () => {
  const g = graph([lane({ id: "lone", start: 40 }), lane({ id: "other", start: 45 }), lane({ id: "kid", parent: "lone", start: 50 })]);
  assert.equal(g.columns.length, 2);
  assert.deepEqual(g.columns.map((c) => c.root), ["lane:lone", "lane:other"]);
  assert.equal(node(g, "lane:kid").column, node(g, "lane:lone").column);
  assert.ok(node(g, "lane:kid").x > node(g, "lane:lone").x);
});

test("dieselbe Eingabe ergibt dasselbe Layout", () => {
  const lanes = [
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1" }),
    lane({ id: "b", parent: "orch", ticket: "tk-2", start: 120 }),
  ];
  const tickets = [{ id: "tk-1", status: "doing", blocked_by: "" }, { id: "tk-2", status: "todo", blocked_by: "tk-1" }];
  assert.deepEqual(layoutGraph({ lanes, tickets, now: 200, width: 760 }), layoutGraph({ lanes, tickets, now: 200, width: 760 }));
});
