// Tests der reinen Fabric-Logik: Stufen, Erwähnungen, Inbox, Timeline.
//   node --test mods/fabric/test/

import test from "node:test";
import assert from "node:assert/strict";

import {
  groupByStage, mentionSegments, sortInbox, timeline, relativeTime, wakeLine,
} from "../model.js";

test("Tickets werden nach Stufe gruppiert, in Stufenreihenfolge", () => {
  const tickets = [
    { id: "T-1", status: "review", updated_at: 30 },
    { id: "T-2", status: "draft", updated_at: 10 },
    { id: "T-3", status: "done", updated_at: 20 },
    { id: "T-4", status: "doing", updated_at: 40 },
    { id: "T-5", status: "dropped", updated_at: 50 },
    { id: "T-6", status: "doing", updated_at: 60 },
  ];
  const groups = groupByStage(tickets);

  assert.deepEqual(groups.map((group) => group.key), ["draft", "todo", "doing", "review", "done"]);
  assert.deepEqual(groups.map((group) => group.label), ["Entwurf", "Geplant", "In Arbeit", "Prüfung", "Fertig"]);
  assert.deepEqual(groups.map((group) => group.tickets.map((ticket) => ticket.id)), [
    ["T-2"], [], ["T-6", "T-4"], ["T-1"], ["T-3"],
  ]);
  assert.equal(groups.flatMap((group) => group.tickets).some((ticket) => ticket.status === "dropped"), false);
});

test("Erwähnungen: ohne Groß-/Kleinschreibung, mit Satzzeichen, ohne E-Mail-Adressen", () => {
  const casePunctuation = mentionSegments("@Ada, bitte @zap.");
  assert.deepEqual(
    casePunctuation.filter((part) => part.mention).map((part) => part.name),
    ["ada", "zap"],
  );
  assert.deepEqual(
    casePunctuation.map((part) => part.text),
    ["@Ada", ", bitte ", "@zap", "."],
  );

  const email = mentionSegments("Mail an thilo@example.com, danke.");
  assert.deepEqual(email, [{ text: "Mail an thilo@example.com, danke.", mention: false }]);

  const before = mentionSegments("Schreib @ada.");
  assert.deepEqual(before, [
    { text: "Schreib ", mention: false },
    { text: "@ada", mention: true, name: "ada" },
    { text: ".", mention: false },
  ]);

  assert.deepEqual(mentionSegments(""), []);
});

test("Inbox: neueste oben, gleiche Zeit bleibt in ihrer Reihenfolge", () => {
  const inbox = [
    { at: 100, ticket: "T-1", text: "alt" },
    { at: 300, ticket: "T-2", text: "neu" },
    { at: 300, ticket: "T-3", text: "gleich alt" },
    { at: 200, ticket: "T-4", text: "mittel" },
  ];
  assert.deepEqual(sortInbox(inbox).map((entry) => entry.ticket), ["T-2", "T-3", "T-4", "T-1"]);
  assert.deepEqual(sortInbox(null), []);
  assert.equal(inbox[0].ticket, "T-1", "die Eingabe wird nicht verändert");
});

test("Timeline: Spuren Orchestrator, Roster, Mensch; Punkte nach Zeit; Wecken als Pfeil", () => {
  const roster = [
    { name: "zap", role: "umsetzer" },
    { name: "ada", role: "pruefer" },
  ];
  const events = [
    { at: 5000, kind: "wake", ticket: "T-1", actor: "mensch", target: "zap", text: "gestartet" },
    { at: 3000, kind: "wake", ticket: "T-1", actor: "zap", target: "ada", text: "geweckt" },
    { at: 1000, kind: "created", ticket: "T-1", actor: "mensch", target: "", text: "" },
    { at: 4000, kind: "status", ticket: "T-1", actor: "orchestrator", target: "", text: "" },
    { at: 2000, kind: "comment", ticket: "T-1", actor: "zap", target: "", text: "@ada bitte" },
  ];

  const result = timeline(events, roster);

  assert.deepEqual(result.lanes.map((lane) => lane.name), ["orchestrator", "zap", "ada", "mensch"]);
  assert.deepEqual(result.lanes.map((lane) => lane.label), ["Orchestrator", "zap", "ada", "Mensch"]);
  assert.deepEqual(result.points.map((point) => point.at), [1000, 2000, 3000, 4000, 5000]);
  assert.deepEqual(result.points.map((point) => point.lane), [3, 1, 1, 0, 3]);
  assert.deepEqual(result.points.map((point) => point.x), [0, 0.25, 0.5, 0.75, 1]);

  assert.equal(result.arrows.length, 2);
  assert.deepEqual(
    result.arrows.map((arrow) => [arrow.actor, arrow.from, arrow.target, arrow.to]),
    [["zap", 1, "ada", 2], ["mensch", 3, "zap", 1]],
  );
  assert.deepEqual(result.arrows.map((arrow) => arrow.x), [0.5, 1]);
});

test("Timeline ohne Ereignisse hat nur die Spuren", () => {
  const result = timeline([], [{ name: "zap" }]);
  assert.deepEqual(result.lanes.map((lane) => lane.name), ["orchestrator", "zap", "mensch"]);
  assert.deepEqual(result.points, []);
  assert.deepEqual(result.arrows, []);
});

test("Zeit und Weckzeilen auf Deutsch", () => {
  const now = 10 * 60 * 60 * 1000;
  assert.equal(relativeTime(now - 30000, now), "gerade eben");
  assert.equal(relativeTime(now - 5 * 60000, now), "vor 5 min");
  assert.equal(relativeTime(now - 3 * 60 * 60000, now), "vor 3 h");
  assert.equal(relativeTime(now - 26 * 60 * 60000, now), "vor 1 Tag");
  assert.equal(relativeTime(null), "");

  assert.equal(wakeLine({ target: "ada", text: "geweckt" }), "→ ada geweckt");
  assert.equal(wakeLine({ target: "zap", text: "unterdrückt: ping-pong" }), "→ zap: unterdrückt: ping-pong");
  assert.equal(wakeLine({ target: "", text: "an orchestrator" }), "→ an den Orchestrator");
});
