// Layout des Timeline-Graphen ohne Fenster: Wurzel, Spalten, mehrstufige
// Sub-Agents, Ticket-Chips mit Triage-Maß und die Rückläufer-Kanten, die der
// Renderer als `paint_path` malt.
//   node --test mods/timeline/test/

import test from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, feedbackRounds, shortId, CARD_H, ROOT_H, TICKET_H, PAD, CHIP_GAP,
  CHIP_INSET, DISPATCH_GAP } from "../graph.js";

const lane = (o) => ({
  id: o.id, label: o.label ?? o.id, kind: o.kind ?? "agent", parent: o.parent ?? null,
  ticket: o.ticket ?? null, terminal: o.terminal ?? null,
  start: o.start === undefined ? 100 : o.start, end: o.end === undefined ? null : o.end,
  status: o.status ?? "working", events: o.events ?? [], subagents: o.subagents ?? [],
});
const graph = (lanes, tickets = [], extra = {}) => layoutGraph({ lanes, tickets, now: 500, width: 760, ...extra });
const node = (g, id) => g.nodes.find((n) => n.id === id);
const chip = (g, id) => g.ticketNodes.find((n) => n.ticket === id);
const rect = (n) => ({ l: n.x, r: n.x + n.w, t: n.y, b: n.y + n.h });

function overlap(a, b) {
  const x = rect(a), y = rect(b);
  return x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5;
}
const assertNoOverlap = (g) => {
  for (const a of g.nodes) for (const b of g.nodes) if (a.id < b.id) {
    assert.equal(overlap(a, b), false, `${a.id} überlappt ${b.id}`);
  }
};
const verdict = (at, text, ticket, terminal) => ({ at, kind: "verdict", rawKind: "verdict", text, ticket, terminal });

test("Orchestrator ist die Wurzel oben mittig und dispatcht seine Agents", () => {
  const g = graph([lane({ id: "orch", kind: "orchestrator", start: 10 }), lane({ id: "a1", parent: "orch", start: 20 }),
    lane({ id: "a2", parent: "orch", start: 30 })]);
  const root = node(g, "lane:orch");
  assert.equal(root.kind, "orchestrator");
  assert.equal(root.y, PAD);
  assert.equal(root.x + root.w / 2, 760 / 2);
  assert.equal(root.h, ROOT_H);
  assert.equal(node(g, "lane:a1").y, PAD + ROOT_H + DISPATCH_GAP);
  const dispatch = g.edges.filter((e) => e.kind === "dispatch");
  assert.deepEqual(dispatch.map((e) => e.to), ["lane:a1", "lane:a2"]);
  for (const e of dispatch) {
    assert.equal(e.from, "lane:orch");
    assert.deepEqual(e.points[0], [root.x + root.w / 2, root.y + root.h]);
    assert.equal(e.points[e.points.length - 1][1], node(g, e.to).y);
    assert.equal(e.dashed, false);
  }
  assert.equal(g.edges.some((e) => e.to === "lane:orch"), false);
});

test("drei Ebenen Sub-Agents hängen eingerückt unter ihrem Parent", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({
      id: "a", parent: "orch", ticket: "tk-1", start: 20, subagents: [
        { id: "s1", title: "Suche", started: 30, ended: 40 },
        { id: "s2", title: "Tests", started: 41, parent: "s1" },
        { id: "s3", title: "Tiefe Recherche", started: 42, parent: "s2" },
      ],
    }),
  ], [{ id: "tk-1", status: "doing", size: "M" }]);
  const parent = node(g, "lane:a");
  const s1 = node(g, "sub:a:s1"), s2 = node(g, "sub:a:s2"), s3 = node(g, "sub:a:s3");
  assert.ok(s1 && s2 && s3, "alle drei Ebenen sind Karten");
  assert.equal(s1.parent, "lane:a");
  assert.equal(s2.parent, "sub:a:s1");
  assert.equal(s3.parent, "sub:a:s2");
  assert.deepEqual([s1, s2, s3].map((n) => n.depth), [2, 3, 4]);
  for (const n of [s1, s2, s3]) {
    assert.equal(n.column, parent.column, "Sub-Agents bleiben in der Spalte ihres Parents");
    assert.equal(n.h, CARD_H);
  }
  assert.ok(s1.x > parent.x && s2.x > s1.x && s3.x > s2.x, "jede Ebene rückt weiter ein");
  assert.ok(s1.w < parent.w && s2.w < s1.w && s3.w < s2.w, "und wird schmaler");
  assert.ok(s1.y > parent.y + parent.h && s2.y > s1.y + s1.h && s3.y > s2.y + s2.h);
  assertNoOverlap(g);
  const edges = g.edges.filter((e) => e.kind === "parent");
  assert.deepEqual(edges.map((e) => [e.from, e.to]), [
    ["lane:a", "sub:a:s1"], ["sub:a:s1", "sub:a:s2"], ["sub:a:s2", "sub:a:s3"],
  ]);
  assert.deepEqual(edges[1].points[edges[1].points.length - 1], [s2.x + s2.w / 2, s2.y]);
});

test("Rückläufer: zwei Runden nach fail, das pass färbt nur die Pfeilspitze", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1", terminal: "t1", start: 20 }),
    lane({ id: "r", kind: "reviewer", parent: "a", ticket: "tk-1", terminal: "r1", start: 100,
      events: [verdict(200, "fail", "tk-1", "r1"), verdict(300, "fail", "tk-1", "r1"),
        verdict(400, "pass", "tk-1", "r1")] }),
  ], [{ id: "tk-1", status: "done", size: "S" }]);
  const c = chip(g, "tk-1");
  assert.ok(c, "der Ticket-Chip ist das Ziel der Rückläufer");
  const loops = g.edges.filter((e) => e.kind === "feedback");
  assert.equal(loops.length, 2, "je Runde eine Kante");
  assert.deepEqual(loops.map((e) => e.tip), ["Runde 1: fail → Nacharbeit", "Runde 2: fail → Nacharbeit"]);
  for (const e of loops) {
    assert.equal(e.from, "lane:r", "vom Reviewer-Knoten");
    assert.equal(e.to, c.id);
    assert.equal(e.dashed, true, "Rückläufer bleiben gestrichelt");
    const rv = node(g, "lane:r");
    assert.equal(e.points[0][1], rv.y + rv.h / 2, "startet an der Seite des Reviewers");
    assert.ok([rv.x, rv.x + rv.w].includes(e.points[0][0]), "und an einer seiner Kanten");
    assert.ok(e.points[e.points.length - 1][1] >= c.y && e.points[e.points.length - 1][1] <= c.y + c.h,
      "endet an der Chip-Höhe, je Runde versetzt");
    assert.ok([c.x, c.x + c.w].includes(e.points[e.points.length - 1][0]), "am Chip-Rand");
    assert.ok(e.badge, "ein Marker trägt den Runden-Tooltip");
  }
  assert.deepEqual(g.edges.filter((e) => e.kind === "feedback").map((e) => e.arrow), ["blocked", "success"],
    "Runde 1 endete im nächsten fail, Runde 2 im pass");
  assert.equal(g.rounds, 2);
  assert.equal(c.rounds.length, 2);
  assert.equal(c.rounds[1].pass, true);
});

test("Runden entstehen auch aus status_log: review → doing, zweimal", () => {
  const lanes = [lane({ id: "a", ticket: "tk-1" }), lane({ id: "r", kind: "reviewer", ticket: "tk-1", terminal: "r1" })];
  const tickets = [{
    id: "tk-1", status: "review", size: "L",
    status_log: "todo@2026-01-01 10:00|review@2026-01-01 10:01|doing@2026-01-01 10:02"
      + "|review@2026-01-01 10:03|doing@2026-01-01 10:04|review@2026-01-01 10:05",
  }];
  const rounds = feedbackRounds(lanes, tickets).get("tk-1");
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds.map((r) => r.n), [1, 2]);
  assert.deepEqual(rounds.map((r) => r.pass), [false, false], "ohne pass-Urteil bleibt der Pfeil gedämpft");
});

test("Agent-Karten sind kompakt, der Chip trägt das Triage-Maß als Suffix", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1" }),
    lane({ id: "b", parent: "orch", ticket: "tk-2", start: 120 }),
    lane({ id: "c", parent: "orch", ticket: "tk-3", start: 130 }),
  ], [
    { id: "tk-1", status: "doing", size: "S" },
    { id: "tk-2", status: "review", size: "M" },
    { id: "tk-3", status: "done", labels: "feature, size-l, p2" },
  ]);
  const a = node(g, "lane:a");
  assert.equal(a.h, CARD_H);
  assert.ok(a.h <= 40);
  assert.equal(chip(g, "tk-1").label, `${shortId("tk-1")} · S`);
  assert.equal(chip(g, "tk-2").label, `${shortId("tk-2")} · M`);
  assert.equal(chip(g, "tk-3").label, `${shortId("tk-3")} · L`, "Label size-l zählt als Triage");
  const c = chip(g, "tk-1");
  assert.equal(c.node, a.id);
  assert.equal(c.x, a.x + CHIP_INSET);
  assert.equal(c.y, a.y + a.h + CHIP_GAP);
  assert.equal(c.h, TICKET_H);
  assert.ok(c.w >= 58 && c.x + c.w <= a.x + a.w);
});

test("Zeitfenster filtert wie im Balken-Modus", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "alt", parent: "orch", start: 20, end: 30, status: "done" }),
    lane({ id: "neu", parent: "orch", start: 150, end: 180, status: "done" }),
    lane({ id: "ohne", parent: "orch", start: null, end: null, status: "idle",
      events: [{ at: 160, kind: "dispatch", text: "" }] }),
    lane({ id: "leer", parent: "orch", start: null, end: null, status: "idle", events: [{ at: 20, kind: "dispatch", text: "" }] }),
  ], [], { windowStart: 140, now: 200 });
  assert.deepEqual(g.nodes.map((n) => n.id), ["lane:orch", "lane:neu", "lane:ohne"]);
});

test("Ticket-Filter behält die Lanes eines Tickets samt Kindern", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1" }),
    lane({ id: "b", parent: "orch", ticket: "tk-2", start: 110 }),
    lane({ id: "kid", parent: "a", ticket: "tk-2", start: 120 }),
  ], [], { ticket: "tk-2" });
  // Wie im Balken-Modus: der Ticket-Filter lässt nur die Lanes des Tickets und
  // ihre Kinder stehen; der Orchestrator bleibt nur bei „Alle“ die Wurzel.
  assert.deepEqual(g.nodes.map((n) => n.id), ["lane:b", "lane:kid"]);
});

test("400 px: zwei schmale Spalten und Karten ohne Überlappung", () => {
  const lanes = [lane({ id: "orch", kind: "orchestrator", start: 10 }),
    ...Array.from({ length: 5 }, (_, i) => lane({ id: `a${i + 1}`, parent: "orch", start: 20 + i,
      subagents: [{ id: "s1", title: "Sub", started: 30 }, { id: "s2", title: "Sub-Sub", started: 31, parent: "s1" }] }))];
  const g = graph(lanes, [], { width: 400 });
  assert.equal(g.narrow, true);
  assert.equal(g.columns.length, 2);
  assert.ok(node(g, "lane:a1").w < 220, "Spaltenbreite schrumpft");
  assertNoOverlap(g);
  for (const n of g.nodes.filter((x) => x.kind === "subagent")) {
    assert.ok(n.w >= 96, "eingerückte Karten bleiben lesbar");
  }
});

test("keine Kante läuft durch eine fremde Karte", () => {
  const g = graph([
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "t1", start: 20,
      subagents: [{ id: "s1", title: "Suche", started: 30 }, { id: "s2", title: "Tiefe", started: 31, parent: "s1" }] }),
    lane({ id: "b", parent: "orch", ticket: "t2", start: 110,
      events: [verdict(120, "fail", "t2", "b")] }),
    lane({ id: "c", parent: "orch", ticket: "t3", start: 130 }),
  ], [{ id: "t1", status: "done", size: "S" }, { id: "t2", status: "done", size: "M" },
    { id: "t3", status: "todo", size: "L" }], { width: 400 });
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
        if (e.from === n.id || e.to === n.id || e.to === n.chip || e.from === n.chip) continue;
        assert.equal(hits(e.points[i], e.points[i + 1], n), false,
          `${e.kind} ${e.from}->${e.to} läuft durch ${n.id}`);
      }
    }
  }
});

test("dieselbe Eingabe ergibt dasselbe Layout", () => {
  const lanes = [
    lane({ id: "orch", kind: "orchestrator", start: 10 }),
    lane({ id: "a", parent: "orch", ticket: "tk-1", start: 20,
      subagents: [{ id: "s1", title: "Suche", started: 30 }, { id: "s2", title: "Tiefe", started: 31, parent: "s1" }],
      events: [verdict(200, "fail", "tk-1", "r1"), verdict(400, "pass", "tk-1", "r1")] }),
    lane({ id: "b", parent: "orch", ticket: "tk-2", start: 120 }),
  ];
  const tickets = [{ id: "tk-1", status: "done", size: "S" }, { id: "tk-2", status: "todo", size: "M" }];
  assert.deepEqual(layoutGraph({ lanes, tickets, now: 500, width: 760 }),
    layoutGraph({ lanes, tickets, now: 500, width: 760 }));
});
