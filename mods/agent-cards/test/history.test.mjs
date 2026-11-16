// Sub-Agent-Historie (data/agent-cards/subagents.jsonl): Parent-Kette über
// mehrere Ebenen, End-Zeilen und die Einmal-Schreibregel.
//   node --test mods/agent-cards/test/

import test from "node:test";
import assert from "node:assert/strict";
import { appendHistory, subagentEvents, unseen } from "../history.js";

const AT = "2026-11-16T10:00:00.000Z";
const LATER = "2026-11-16T11:00:00.000Z";

const nested = () => new Map([["t-a", { model: "m1", subagents: [
  { id: "s1", agent: "scout", description: "Suche", children: [
    { id: "s2", agent: "task", description: "Tests", children: [
      { id: "s3", agent: "task", description: "Tiefe" },
    ] },
  ] },
  { id: "s4", agent: "task", description: "Zweig" },
] }]]);

test("drei Ebenen Sub-Agents tragen ihre Parent-Kette", () => {
  const { lines } = subagentEvents(new Map(), nested(), AT);
  assert.deepEqual(lines.map((l) => [l.id, l.parent, l.terminal]), [
    ["s1", "t-a", "t-a"],
    ["s2", "s1", "t-a"],
    ["s3", "s2", "t-a"],
    ["s4", "t-a", "t-a"],
  ]);
  assert.deepEqual(lines.map((l) => l.title), ["Suche", "Tests", "Tiefe", "Zweig"]);
  for (const l of lines) {
    assert.equal(l.at, AT);
    assert.equal(l.kind, undefined);
    assert.equal(l.program, l.id === "s1" ? "scout" : "task");
    assert.equal(l.model, "m1");
  }
});

test("verschwundene Sub-Agents schließen mit derselben Parent-Kette", () => {
  const first = subagentEvents(new Map(), nested(), AT);
  const { seen, lines } = subagentEvents(first.seen, new Map(), LATER);
  assert.deepEqual(lines.map((l) => [l.id, l.parent, l.terminal, l.kind]), [
    ["s1", "t-a", "t-a", "end"],
    ["s2", "s1", "t-a", "end"],
    ["s3", "s2", "t-a", "end"],
    ["s4", "t-a", "t-a", "end"],
  ]);
  assert.equal(seen.size, 0);
});

test("bekannte ids schreiben keine zweite Geburt, die End-Zeile bleibt eigen", () => {
  const first = subagentEvents(new Map(), nested(), AT);
  const text = first.lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  assert.deepEqual(unseen(text, first.lines), []);
  const ends = subagentEvents(first.seen, new Map(), LATER).lines;
  assert.equal(ends.length, 4);
  assert.deepEqual(unseen(text, ends), ends, "jede End-Zeile wird einmal geschrieben");
  assert.deepEqual(unseen(appendHistory(text, [ends[0]]), ends), ends.slice(1),
    "dieselbe End-Zeile schreibt nicht zweimal");
});

test("appendHistory hält die neuesten Zeilen", () => {
  const text = appendHistory("", [{ id: "a" }, { id: "b" }]);
  assert.equal(text, `${JSON.stringify({ id: "a" })}\n${JSON.stringify({ id: "b" })}\n`);
  const cut = appendHistory(text, [{ id: "c" }], 2, 1);
  assert.equal(cut, `${JSON.stringify({ id: "c" })}\n`);
});
