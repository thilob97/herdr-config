// Tests der reinen Fabric-Logik: Stufen, Erwähnungen, Inbox, Timeline.
//   node --test mods/fabric/test/

import test from "node:test";
import assert from "node:assert/strict";

import {
  groupByStage, mentionSegments, sortInbox, timelineFeed, eventSummary, relativeTime,
  wakeLine, sessionChips, sessionStatus, childrenOf, childProgress,
  teamForTicket, teamAgents,
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

test("Zeitverlauf: neueste zuerst, nach Tagen gruppiert, Filter je Ticket", () => {
  const now = new Date(2026, 10, 18, 12, 0, 0).getTime();
  const day = 86400000;
  const events = [
    { at: now - day - 1000, kind: "wake", ticket: "T-1", actor: "zap", target: "ada", text: "geweckt" },
    { at: now - 1000, kind: "comment", ticket: "T-2", actor: "mensch", target: "", text: "@zap bitte" },
    { at: now, kind: "comment", ticket: "T-1", actor: "ada", target: "", text: "passt" },
  ];

  const feed = timelineFeed(events, { now });
  assert.deepEqual(feed.days.map((group) => group.label), ["Heute", "Gestern"]);
  assert.deepEqual(feed.days.flatMap((group) => group.rows.map((row) => row.ticket)), ["T-1", "T-2", "T-1"]);
  assert.equal(feed.total, 3);
  assert.equal(feed.actors, 3);

  const scoped = timelineFeed(events, { ticket: "T-1", now });
  assert.deepEqual(scoped.days.flatMap((group) => group.rows.map((row) => row.at)), [now, now - day - 1000]);
  assert.equal(scoped.total, 2);
  assert.equal(scoped.actors, 2);
});

test("Zeitverlauf: Ereignisarten werden zu unterscheidbaren Sätzen", () => {
  const status = eventSummary({ at: 1, kind: "status", actor: "orchestrator", text: "draft → todo" });
  assert.equal(status.actor, "Orchestrator");
  assert.equal(status.verb, "änderte den Status");
  assert.equal(status.detail, "Entwurf → Geplant");

  assert.equal(eventSummary({ kind: "wake", actor: "zap", target: "ada", text: "geweckt" }).verb, "weckte ada");
  assert.equal(eventSummary({ kind: "wake", actor: "mensch", target: "orchestrator" }).verb, "weckte den Orchestrator");
  assert.equal(eventSummary({ kind: "wake", actor: "zap", target: "mensch" }).verb, "weckte den Menschen");
  assert.equal(eventSummary({ kind: "verdict", actor: "ada", text: "pass: HEAD geprüft" }).detail, "bestanden — HEAD geprüft");
  assert.equal(eventSummary({ kind: "verify", actor: "zap", text: "fail" }).detail, "rot");
  assert.equal(eventSummary({ kind: "comment", actor: "zap", text: "hallo" }).verb, "kommentierte");
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

test("Sitzungsstatus: herdr-Status wird zu deutschem Wort und Farbschlüssel", () => {
  assert.deepEqual(sessionStatus("working"), { word: "arbeitet", color: "working" });
  assert.deepEqual(sessionStatus("blocked"), { word: "wartet auf dich", color: "blocked" });
  assert.deepEqual(sessionStatus("done"), { word: "fertig", color: "done" });
  assert.deepEqual(sessionStatus("idle"), { word: "bereit", color: "muted" });
  assert.deepEqual(sessionStatus("exited"), { word: "beendet", color: "dim" });
  assert.deepEqual(sessionStatus(null), { word: "unbekannt", color: "dim" });
  assert.deepEqual(sessionStatus("fremd"), { word: "fremd", color: "dim" });
});

test("Sitzungen finden ihr Terminal über Adresse, sonst über fab-<agent>-<id>", () => {
  const sessions = [
    { agent: "zap", terminal: "t80", name: "fab-zap-t-1" },
    { agent: "ada", terminal: "weg", name: "fab-ada-t-1" },
    { agent: "bo", name: "fab-bo-t-1" },
    { agent: "cy", terminal: "t88" },
    { agent: "di" },
    { agent: "ed" },
  ];
  const terminals = [
    { address: "t80", name: "fab-zap-t-1", state: "live", status: "working" },
    { address: "t81", name: "fab-ada-t-1", state: "live", status: "done" },
    { address: "t82", name: "fab-bo-t-1", state: "exited", status: "done" },
    { address: "t88", name: "fremd", state: "live", status: "working" },
    { address: "t83", name: "fab-di-t-1", state: "live" },
  ];
  const agentRows = [
    { address: "t80", status: "blocked" },
    { address: "t81", status: "done" },
  ];

  const chips = sessionChips(sessions, terminals, agentRows, "T-1");

  assert.deepEqual(
    chips.map((chip) => [chip.agent, chip.terminal, chip.word, chip.color, chip.ended]),
    [
      ["zap", "t80", "wartet auf dich", "blocked", false],
      ["ada", "t81", "fertig", "done", false],
      ["bo", "t82", "beendet", "dim", true],
      ["cy", "t88", "arbeitet", "working", false],
      ["di", "t83", "bereit", "muted", false],
      ["ed", "", "beendet", "dim", true],
    ],
  );

  // `agents()` hat Vorrang vor dem Status aus `terminals()`.
  assert.equal(chips[0].status, "blocked");
  assert.equal(chips[0].tooltip, "wartet auf Freigabe – klicken zum Öffnen");
  assert.match(chips[2].tooltip, /fab-bo-t-1 ist beendet/);
  assert.match(chips[3].tooltip, /arbeitet · klicken zum Öffnen/);
  assert.deepEqual(sessionChips(null), []);
});

// ---------- Statusübergänge und Aktionsleiste ----------

test("Statusübergänge: done nur über Abnehmen, dropped lässt sich wieder öffnen", async () => {
  const { statusOptions, canTransition } = await import("../model.js");
  assert.deepEqual(
    statusOptions("draft").map((option) => option.key),
    ["draft", "todo", "dropped"],
  );
  assert.deepEqual(
    statusOptions("doing").map((option) => option.key),
    ["doing", "todo", "review", "dropped"],
  );
  assert.deepEqual(
    statusOptions("review").map((option) => option.key),
    ["review", "doing", "dropped"],
  );
  assert.deepEqual(
    statusOptions("done").map((option) => [option.key, option.disabled]),
    [["done", true]],
  );
  assert.deepEqual(statusOptions("dropped").map((option) => option.key), ["dropped", "draft"]);

  assert.equal(canTransition("draft", "todo"), true);
  assert.equal(canTransition("draft", "done"), false);
  assert.equal(canTransition("review", "done"), false);
  assert.equal(canTransition("dropped", "draft"), true);
  assert.equal(canTransition("done", "doing"), false);
});

test("Aktionsleiste je Status nennt den Grund, wenn eine Aktion deaktiviert ist", async () => {
  const { actionBar, FORMULATE_COMMENT } = await import("../model.js");
  const tickets = [
    { id: "T-1", status: "draft" },
    { id: "T-2", status: "doing" },
    { id: "T-3", status: "done" },
  ];

  const draft = actionBar({ status: "draft" }, tickets);
  assert.deepEqual(draft.map((action) => action.id), ["formulate", "drop"]);
  assert.equal(draft[0].hint, FORMULATE_COMMENT);

  const todo = actionBar({ status: "todo", repo: "", body: "## Auftrag\nx", blocked_by: [] }, tickets);
  assert.equal(todo[0].id, "dispatch");
  assert.equal(todo[0].disabled, true);
  assert.match(todo[0].reason, /Repo fehlt/);
  assert.match(todo[0].reason, /Abnahmekriterien/);
  assert.match(todo[0].reason, /Kein Zuständiger/);

  const blocked = actionBar({
    status: "todo", repo: "/r", assignee: "zap", body: "## Abnahmekriterien\n- [ ] x", blocked_by: ["T-2"],
  }, tickets);
  assert.equal(blocked[0].disabled, true);
  assert.equal(blocked[0].reason, "Blockiert durch T-2");

  const ready = actionBar({
    status: "todo", repo: "/r", assignee: "zap", body: "## Abnahmekriterien\n- [ ] x", blocked_by: ["T-3"],
  }, tickets);
  assert.equal(ready[0].disabled, false, "erledigte Blocker zählen nicht");

  const doing = actionBar({ status: "doing", worktree: "", assignee: "" }, tickets);
  assert.deepEqual(doing.map((action) => [action.id, action.disabled]), [
    ["verify", true], ["wake", true], ["drop", false],
  ]);
  assert.match(doing[0].reason, /Kein Worktree/);
  assert.match(doing[1].reason, /Kein Zuständiger/);

  const review = actionBar({ status: "review" }, tickets);
  assert.deepEqual(review.map((action) => action.id), ["accept", "reject", "drop"]);
  assert.equal(review[0].kind, "primary");
  assert.equal(review[0].confirm, "accept");

  assert.deepEqual(actionBar({ status: "done" }, tickets).map((action) => action.id), [],
    "im Fenster gibt es keinen „Im Fenster öffnen“-Knopf");
  assert.deepEqual(actionBar({ status: "dropped" }, tickets).map((action) => action.id), ["reopen"]);
});

// ---------- Board und Tabelle ----------

test("Board-Spalten: fünf Stufen, Fertig begrenzt, Prüfung hervorgehoben", async () => {
  const { boardColumns } = await import("../model.js");
  const tickets = [];
  for (let index = 1; index <= 24; index += 1) {
    tickets.push({ id: `T-${index}`, status: "done", title: `fertig ${index}`, updated_at: index });
  }
  tickets.push(
    { id: "T-30", status: "review", title: "prüfen", updated_at: 5 },
    { id: "T-31", status: "doing", title: "arbeiten", updated_at: 7, repo: "/r/a" },
    { id: "T-32", status: "dropped", title: "verworfen", updated_at: 9 },
  );

  const columns = boardColumns(tickets);
  assert.deepEqual(columns.map((column) => column.key), ["draft", "todo", "doing", "review", "done"]);
  assert.equal(columns[4].count, 20);
  assert.equal(columns[4].tickets[0].id, "T-24");
  assert.equal(columns[3].attention, true);
  assert.equal(columns[2].attention, false);

  const filtered = boardColumns(tickets, { query: "arbeiten", repo: "/r/a" });
  assert.deepEqual(filtered[2].tickets.map((ticket) => ticket.id), ["T-31"]);
  assert.equal(filtered[2].tickets.length, 1);

  const dropped = boardColumns(tickets, { includeDropped: true });
  assert.deepEqual(dropped.map((column) => column.key), ["draft", "todo", "doing", "review", "done", "dropped"]);
  assert.deepEqual(dropped[5].tickets.map((ticket) => ticket.id), ["T-32"], "Verworfen ist ein Filter, der eine Spalte zeigt");
  assert.equal(boardColumns(tickets).some((column) => column.key === "dropped"), false);

  const byAssignee = boardColumns(tickets, { assignee: "zap" });
  assert.equal(byAssignee.flatMap((column) => column.tickets).length, 0);
});

test("Tabellensortierung: Kopf dreht die Richtung, leere Werte ans Ende", async () => {
  const { sortTickets, nextSort } = await import("../model.js");
  const tickets = [
    { id: "T-2", title: "b", updated_at: 20, comment_count: 4 },
    { id: "T-1", title: "a", updated_at: 10, comment_count: 0 },
    { id: "T-3", title: "c", updated_at: 30, comment_count: 2 },
  ];
  assert.deepEqual(sortTickets(tickets).map((ticket) => ticket.id), ["T-3", "T-2", "T-1"]);
  assert.deepEqual(sortTickets(tickets, { key: "title", dir: "asc" }).map((ticket) => ticket.id), ["T-1", "T-2", "T-3"]);
  assert.deepEqual(sortTickets(tickets, { key: "comment_count", dir: "desc" }).map((ticket) => ticket.id), ["T-2", "T-3", "T-1"]);
  assert.deepEqual(nextSort({ key: "title", dir: "asc" }, "title"), { key: "title", dir: "desc" });
  assert.deepEqual(nextSort({ key: "title", dir: "asc" }, "updated_at"), { key: "updated_at", dir: "desc" });
});

// ---------- Unter-Tickets ----------

test("Unter-Tickets: nach parent gefiltert, numerisch sortiert, fremde ignoriert", () => {
  const tickets = [
    { id: "T-10", parent: "T-1", status: "draft" },
    { id: "T-2", parent: "T-1", status: "doing" },
    { id: "T-1", parent: null, status: "doing" },
    { id: "T-3", parent: "T-9", status: "draft" },
    { id: "T-4", status: "draft" },
  ];
  assert.deepEqual(childrenOf(tickets, "T-1").map((row) => row.id), ["T-2", "T-10"]);
  assert.deepEqual(childrenOf(tickets, "T-9").map((row) => row.id), ["T-3"]);
  assert.deepEqual(childrenOf(tickets, "T-404"), []);
  assert.deepEqual(childrenOf(undefined, "T-1"), []);
});

test("Unter-Tickets: Fortschritt zählt done und dropped als erledigt", () => {
  assert.deepEqual(childProgress([]), { total: 0, closed: 0, open: 0 });
  assert.deepEqual(childProgress([
    { id: "T-2", status: "done" },
    { id: "T-3", status: "dropped" },
    { id: "T-4", status: "doing" },
  ]), { total: 3, closed: 2, open: 1 });
  assert.deepEqual(childProgress([{ id: "T-5", status: "draft" }]), { total: 1, closed: 0, open: 1 });
});

// ---------- Erwähnungen und Vorschau ----------

test("@-Vorschläge: erkennt die Eingabe am Cursor und ersetzt sie", async () => {
  const { mentionQuery, mentionSuggestions, insertMention } = await import("../model.js");
  assert.deepEqual(mentionQuery("Hallo @ad", 9), { start: 6, end: 9, query: "ad" });
  assert.equal(mentionQuery("thilo@example.com", 17), null);
  assert.equal(mentionQuery("Hallo @ada", 6), null, "der Cursor steht vor dem @");

  const suggestions = mentionSuggestions("Bitte @a", 8, ["ada", "zap", "ada", "anton", "mensch"]);
  assert.deepEqual(suggestions.map((entry) => entry.name), ["ada", "anton"]);

  const inserted = insertMention("Bitte @a prüfen", 8, "ada");
  assert.equal(inserted.text, "Bitte @ada prüfen");
  assert.equal(inserted.caret, 11);
  assert.deepEqual(insertMention("ohne", 4, "ada"), { text: "ohne", caret: 4 });
});

test("@-Vorschläge: leere Eingabe, alle Namen, Auswahl und Ersetzen", async () => {
  const {
    mentionQuery, mentionSuggestions, mentionNames, moveMentionIndex, replaceMention, insertMention,
    mentionKeyBindings,
  } = await import("../model.js");
  assert.deepEqual(mentionQuery("@", 1), { start: 0, end: 1, query: "" });
  assert.deepEqual(mentionQuery("Hallo @", 7), { start: 6, end: 7, query: "" });
  assert.equal(mentionQuery("thilo@", 6), null);
  assert.equal(mentionQuery("thilo@example.com", 16), null);

  const names = ["ada", "anton", "zap", "bo", "cy", "di", "ed", "fay"];
  assert.equal(mentionSuggestions("@", 1, names).length, 8, "kein 6er-Deckel");

  assert.deepEqual(mentionNames([{ name: "zap" }, { name: "ada" }, { name: "Zap" }]),
    ["zap", "ada", "orchestrator", "mensch"]);
  assert.deepEqual(mentionNames([" mensch ", "Ada", ""]), ["mensch", "Ada", "orchestrator"]);

  assert.equal(moveMentionIndex(0, 3, -1), 2);
  assert.equal(moveMentionIndex(2, 3, 1), 0);
  assert.equal(moveMentionIndex(1, 3, 1), 2);
  assert.equal(moveMentionIndex(4, 0, 1), 0);
  assert.equal(moveMentionIndex(4, 0, -1), 0);

  assert.deepEqual(replaceMention("Bitte @a prüfen", { start: 6, end: 8 }, "ada"),
    { text: "Bitte @ada prüfen", caret: 11 });
  assert.deepEqual(replaceMention("Bitte @a", { start: 6, end: 8 }, "ada"),
    { text: "Bitte @ada ", caret: 11 });
  assert.deepEqual(replaceMention("Bitte @a prüfen", { start: 8, end: 8 }, "ada"),
    { text: "Bitte @a prüfen", caret: 8 });
  assert.deepEqual(replaceMention("Bitte @a prüfen", { start: 5, end: 2 }, "ada"),
    { text: "Bitte @a prüfen", caret: 2 });

  assert.deepEqual(insertMention("Bitte @a prüfen", 8, "ada"), { text: "Bitte @ada prüfen", caret: 11 });
  assert.deepEqual(insertMention("@", 1, "orchestrator"), { text: "@orchestrator ", caret: 14 });

  const bindings = mentionKeyBindings();
  assert.equal(bindings.length, 10, "fünf Tasten in beiden Textfeld-Kontexten");
  assert.equal(bindings.every((entry) => entry.context), true, "keine globalen Bindungen");
  assert.deepEqual([...new Set(bindings.map((entry) => entry.context))].sort(), ["Input", "Textarea"]);
  assert.deepEqual(
    [...new Set(bindings.map((entry) => entry.keystroke))].sort(),
    ["down", "enter", "escape", "tab", "up"],
  );
  assert.equal(bindings.filter((entry) => entry.keystroke === "enter"
    || entry.keystroke === "tab").every((entry) => entry.action === "fabric-mention-accept"), true);
});

test("„weckt“-Vorschau: Agenten wecken, mensch landet in der Inbox, Unbekanntes nicht", async () => {
  const { wakeTargets, wakeSummary } = await import("../model.js");
  const names = ["ada", "zap"];
  assert.deepEqual(wakeTargets("@Ada @mensch @fremd @ada", names), [
    { name: "ada", kind: "wake" },
    { name: "mensch", kind: "inbox" },
    { name: "fremd", kind: "unknown" },
  ]);
  assert.deepEqual(wakeTargets("@mensch", names, "mensch"), [{ name: "mensch", kind: "self" }]);
  assert.equal(wakeSummary("@ada und @mensch", names), "Weckt ada · Inbox: mensch.");
  assert.equal(wakeSummary("@zap @fremd", names), "Weckt zap · Unbekannt: fremd.");
  assert.equal(wakeSummary("nur Text", names), "Weckt niemanden.");
});

test("Kommentare bleiben reiner Text, nur Erwähnungen werden hervorgehoben", async () => {
  const { plainMentionMarkdown } = await import("../model.js");
  assert.equal(plainMentionMarkdown("__pycache__"), "\\_\\_pycache\\_\\_");
  assert.equal(plainMentionMarkdown("4*5=20"), "4\\*5\\=20");
  assert.equal(plainMentionMarkdown("`code`"), "\\`code\\`");
  assert.equal(plainMentionMarkdown("Hallo @ada, __pycache__ und 4*5=20"),
    "Hallo **@ada**, \\_\\_pycache\\_\\_ und 4\\*5\\=20");
  assert.equal(plainMentionMarkdown("Zeile 1\nZeile 2"), "Zeile 1  \nZeile 2");
  assert.equal(plainMentionMarkdown("# kein Titel [x](y)"), "\\# kein Titel \\[x\\]\\(y\\)");
  assert.equal(plainMentionMarkdown("Titel\n==="), "Titel  \n\\=\\=\\=");
  assert.equal(plainMentionMarkdown("&amp;"), "\\&amp;");
  assert.equal(plainMentionMarkdown("<b>x</b>"), "\\<b\\>x\\</b\\>");
  const indented = plainMentionMarkdown("    eingerückt");
  assert.equal(indented, "\u00a0\u00a0\u00a0\u00a0eingerückt");
  assert.equal(indented.includes("    "), false, "kein ASCII-Codeblock");
});

test("Pfade und Sonderzeichen bleiben in Kommentaren wörtlich", async () => {
  const { plainMentionMarkdown } = await import("../model.js");
  assert.equal(
    plainMentionMarkdown("C:\\pfad\\datei /usr/*/bin a*b*c $x_1$ __init__.py"),
    "C:\\\\pfad\\\\datei /usr/\\*/bin a\\*b\\*c $x\\_1$ \\_\\_init\\_\\_\\.py",
  );
});

test("Nackte URLs werden zu Links, Satzzeichen bleiben Text", async () => {
  const { plainMentionMarkdown } = await import("../model.js");
  assert.equal(
    plainMentionMarkdown("Siehe https://example.com/a_b?x=1, dann."),
    "Siehe <https://example.com/a_b?x=1>, dann\\.",
  );
  assert.equal(
    plainMentionMarkdown("https://example.com/pfad_(x)"),
    "<https://example.com/pfad_(x)>",
    "paarige Klammern gehören zur Adresse",
  );
  assert.equal(
    plainMentionMarkdown("https://example.com/x)"),
    "<https://example.com/x>\\)",
    "unpaarige Klammer bleibt Text",
  );
});

test("Erwähnungen wirken auch neben Links und Bildverweisen", async () => {
  const { plainMentionMarkdown, wakeTargets, mentionedNames } = await import("../model.js");
  assert.equal(
    plainMentionMarkdown("@ada siehe https://example.com/x und ![Plan](data/fabric/attachments/T-1/plan.png)"),
    "**@ada** siehe <https://example.com/x> und Plan",
  );
  assert.equal(
    plainMentionMarkdown("thilo@example.com schreibt"),
    "thilo@example\\.com schreibt",
    "E-Mail-Adressen bleiben Text",
  );
  assert.equal(
    plainMentionMarkdown("1. erst\n1. dann"),
    "1\\. erst  \n1\\. dann",
    "keine geordnete Liste aus Kommentartext",
  );
  assert.equal(plainMentionMarkdown("3. Punkt"), "3\\. Punkt");
  const text = "@ada siehe https://example.com/x und ![Plan](data/fabric/attachments/T-1/plan.png)";
  assert.deepEqual(mentionedNames(text), ["ada"]);
  assert.deepEqual(wakeTargets(text, ["ada", "zap"], "zap"), [{ name: "ada", kind: "wake" }]);
});

test("Bildverweise: relative Pfade, Alt-Text, kein Dedupe, Anhang einfügen", async () => {
  const {
    IMAGE_TYPES, IMAGE_HINT, isImagePath, imageRefs, stripImages, insertAttachment,
  } = await import("../model.js");

  assert.deepEqual(IMAGE_TYPES, ["png", "jpg", "jpeg", "gif", "webp"]);
  assert.equal(IMAGE_HINT, "png, jpg, jpeg, gif, webp");

  assert.equal(isImagePath("data/fabric/attachments/T-1/plan.PNG"), true);
  assert.equal(isImagePath("bild.webp?raw=1#oben"), true);
  assert.equal(isImagePath("notiz.txt"), false);
  assert.equal(isImagePath("notes/bild"), false);
  assert.equal(isImagePath("https://example.com/x.png"), false);

  const md = "![Plan](data/fabric/attachments/T-1/plan.png)";
  assert.deepEqual(
    imageRefs(`${md} und ${md} ![fern](https://x/y.png) ![notiz](notiz.txt) ![absolut](/tmp/x.png)`),
    [
      { alt: "Plan", path: "data/fabric/attachments/T-1/plan.png", markdown: md },
      { alt: "Plan", path: "data/fabric/attachments/T-1/plan.png", markdown: md },
    ],
    "Doppelte bleiben erhalten, Fremdes fällt weg",
  );

  assert.equal(stripImages(`a ${md} b ![x](q.jpg)`), "a Plan b x");
  assert.equal(stripImages("a![](p.png)b"), "ab");

  assert.deepEqual(insertAttachment("", { start: 0, end: 0 }, md),
    { text: md, caret: md.length });
  assert.deepEqual(insertAttachment("Text", { start: 4, end: 4 }, md),
    { text: `Text ${md}`, caret: 4 + 1 + md.length });
  assert.deepEqual(insertAttachment("ab\ncd", { start: 2, end: 2 }, "X"),
    { text: "ab X\ncd", caret: 4 });
  assert.deepEqual(insertAttachment("abcdef", { start: -4, end: 99 }, "X"),
    { text: "X", caret: 1 }, "Bereich wird beschnitten");
});

// ---------- Flags ----------

test("Flags werden nach Shell-Regeln zerlegt und wieder zusammengesetzt", async () => {
  const { splitShell, joinShell } = await import("../model.js");
  const words = ["--max-cost=5", "--name", "a b", "--x", "c d", "'"];
  const text = joinShell(words);
  assert.deepEqual(splitShell(text), words);
  assert.deepEqual(splitShell(`--a "b c" --d 'e f' --g h\\ i`), ["--a", "b c", "--d", "e f", "--g", "h i"]);
  assert.deepEqual(splitShell(""), []);
});

test("argv ↔ Programm, Modell und Flags in beide Richtungen", async () => {
  const { argvParts, argvFromParts, flagsText } = await import("../model.js");
  assert.deepEqual(argvParts(["omp", "--model=opencode-go/x", "--max-cost=5", "--fast"]), {
    program: "omp", model: "opencode-go/x", flags: ["--max-cost=5", "--fast"],
  });
  assert.deepEqual(argvParts(["claude", "--model", "opus", "--fast"]), {
    program: "claude", model: "opus", flags: ["--fast"],
  });
  assert.deepEqual(argvParts(["--model=x"]), { program: "--model=x", model: "", flags: [] });

  const parts = { program: "omp", model: "opencode-go/x", flags: `--max-cost=5 --name "a b"` };
  const argv = argvFromParts(parts);
  assert.deepEqual(argv, ["omp", "--model=opencode-go/x", "--max-cost=5", "--name", "a b"]);
  assert.deepEqual(argvParts(argv), { program: "omp", model: "opencode-go/x", flags: ["--max-cost=5", "--name", "a b"] });
  assert.equal(flagsText(argvParts(argv).flags), `--max-cost=5 --name 'a b'`);
  assert.deepEqual(argvFromParts({ program: "" }), []);
});

// ---------- Ungespeicherte Änderungen ----------

test("Ungespeicherte Änderungen werden erkannt, Zeilenenden zählen nicht", async () => {
  const { isDirty, dirtyEntries } = await import("../model.js");
  assert.equal(isDirty("a\nb", "a\nb"), false);
  assert.equal(isDirty("a\r\nb\r\n", "a\nb"), false);
  assert.equal(isDirty("a\nb ", "a\nb"), false);
  assert.equal(isDirty("a\nc", "a\nb"), true);
  assert.equal(isDirty("", ""), false);
  assert.equal(isDirty(null, ""), false);

  assert.deepEqual(dirtyEntries([
    { key: "body", label: "Beschreibung", value: "neu", saved: "alt" },
    { key: "prompt", label: "Prompt", value: "gleich", saved: "gleich" },
  ]), [{ key: "body", label: "Beschreibung" }]);
});

test("Programm-Auswahl: nur installierte, aktueller Wert bleibt als Ausnahme", async () => {
  const { programOptions } = await import("../model.js");
  const programs = [
    { name: "omp", run: ["omp"], installed: true },
    { name: "pi", run: ["pi"], installed: false },
    { name: "claude", run: ["claude"], installed: true },
    { name: "claude", run: ["claude"], installed: true },
  ];
  assert.deepEqual(programOptions(programs, "omp").map((row) => row.value), ["omp", "claude"]);
  assert.deepEqual(programOptions(programs, "pi").map((row) => row.value), ["pi", "omp", "claude"]);
  assert.equal(programOptions(programs, "pi")[0].detail, "nicht installiert");
  assert.equal(programOptions(programs, "pi")[0].warn, true);
  assert.equal(programOptions(programs, "pi")[0].selected, true);

  const empty = programOptions([], "claude");
  assert.deepEqual(empty.map((row) => row.value), ["claude"]);
  assert.equal(empty[0].warn, true);
  assert.deepEqual(programOptions([], ""), []);
  assert.deepEqual(programOptions(undefined, ""), []);
});

test("Platzhalter, Prompt-Reihenfolge und Vorlagen", async () => {
  const { unknownPlaceholders, sortPrompts, verifyTemplate, PLACEHOLDERS } = await import("../model.js");
  assert.deepEqual(unknownPlaceholders("Hallo {id} {fremd} {id}"), ["fremd"]);
  assert.deepEqual(unknownPlaceholders("Hallo {id}", Object.keys(PLACEHOLDERS)), []);
  assert.deepEqual(
    sortPrompts([
      { name: "zap", kind: "agent" },
      { name: "preamble", kind: "preamble" },
      { name: "orchestrator", kind: "orchestrator" },
      { name: "ada", kind: "agent" },
    ]).map((prompt) => prompt.name),
    ["orchestrator", "preamble", "ada", "zap"],
  );
  assert.match(verifyTemplate(), /^#!\/bin\/sh/);
  assert.match(verifyTemplate(), /set -eu/);
});


// ---------- Ticketwahl und Live-Status ----------

test("Ticketwahl: nur das Fenster folgt der Route, Panels der Auswahl", async () => {
  const { ticketIdFor, followsSelection } = await import("../model.js");
  const windowRoute = { page: "ticket", id: "T-3" };
  assert.equal(ticketIdFor(true, windowRoute, "T-5"), "T-3");
  assert.equal(ticketIdFor(false, windowRoute, "T-5"), "T-5");
  assert.equal(ticketIdFor(true, { page: "board" }, "T-5"), "T-5");
  assert.equal(followsSelection(true, { page: "board" }), true);
  assert.equal(followsSelection(true, windowRoute), false);
  assert.equal(followsSelection(false, { page: "board" }), false);
});

test("Orchestrator: arbeitet ist nicht wartet; Live-Terminal hat Vorrang", async () => {
  const { orchestratorWord, orchestratorColorKey, liveOrchestrator } = await import("../model.js");
  assert.equal(orchestratorWord({ live: true, status: "working" }), "arbeitet");
  assert.equal(orchestratorWord({ live: true, status: "blocked" }), "wartet auf dich");
  assert.equal(orchestratorWord({ live: false }), "gestoppt");
  assert.equal(orchestratorColorKey({ live: true, status: "working" }), "working");
  assert.equal(orchestratorColorKey({ live: true, status: "blocked" }), "blocked");
  const live = liveOrchestrator({ started_at: 1 }, [
    { address: "t90", name: "fab-orchestrator", state: "live", status: "blocked" },
  ]);
  assert.deepEqual([live.live, live.terminal, live.status, live.started_at], [true, "t90", "blocked", 1]);
  const team = liveOrchestrator({ started_at: 2 }, [
    { address: "t91", name: "fab-zweit-orchestrator", state: "live", status: "working",
      labels: { "fab.role": "orchestrator", "fab.team": "zweit" } },
  ]);
  assert.deepEqual([team.live, team.terminal, team.status], [true, "t91", "working"]);
});

test("Live-Sessions eines Agenten kommen aus den Terminals", async () => {
  const { liveAgentSessions } = await import("../model.js");
  const rows = liveAgentSessions("zap", [
    { address: "t80", name: "fab-zap-t-4", state: "live", status: "working", labels: { "fab.agent": "zap" } },
    { address: "t81", name: "fab-ada-t-5", state: "live", status: "idle", labels: { "fab.agent": "ada" } },
    { address: "t82", name: "fab-zap-t-9", state: "exited", status: "done", labels: {} },
  ]);
  assert.deepEqual(rows, [
    { name: "fab-zap-t-4", terminal: "t80", status: "working" },
    { name: "fab-zap-t-9", terminal: "t82", status: "exited" },
  ]);
});

// ---------- Argumente mit führenden Bindestrichen ----------

test("Freitexte stehen hinter --, Optionen tragen =", async () => {
  const {
    editArgs, newArgs, commentArgs, rejectArgs, dropArgs, wakeArgs, promptSetArgs, repoSetArgs,
  } = await import("../model.js");

  assert.deepEqual(editArgs("T-1", { title: "---", body: "-wichtig" }), [
    "edit", "T-1", "--title=---", "--body=-wichtig", "--from=mensch",
  ]);
  assert.deepEqual(newArgs("-wichtig", { repo: "/r", wake: false }), [
    "new", "--repo=/r", "--no-wake", "--from=mensch", "--", "-wichtig",
  ]);
  assert.deepEqual(commentArgs("T-1", "-wichtig"), [
    "comment", "T-1", "--from=mensch", "--", "-wichtig",
  ]);
  assert.deepEqual(rejectArgs("T-1", "---"), ["reject", "T-1", "--", "---"], "reject kennt kein --from");
  assert.deepEqual(dropArgs("T-1", "-grund"), ["drop", "T-1", "--from=mensch", "--", "-grund"]);
  assert.deepEqual(wakeArgs("T-1", "zap", "mensch", "-los"), [
    "wake", "T-1", "zap", "--from=mensch", "--", "-los",
  ]);
  assert.deepEqual(promptSetArgs("zap", "-text"), ["prompt", "set", "zap", "--text=-text", "--from=mensch"]);
  assert.deepEqual(repoSetArgs("/r", "verify", "#!/bin/sh\n"), [
    "repo", "set", "/r", "verify", "--text=#!/bin/sh\n", "--from=mensch",
  ]);
});

// ---------- Blaupausen-Drawer: Wechsel zwischen Blaupausen ----------

const ZAP = {
  name: "zap", role: "umsetzer", color: "c1",
  argv: ["omp", "--model=opencode-go/deepseek-v4.1-flash", "--approval-mode=yolo", "--max-cost=5"],
};
const ADA = {
  name: "ada", role: "pruefer", color: "c2",
  argv: ["claude", "--model", "opus", "--dangerously-skip-permissions"],
};
// Das Formular schreibt das Modell immer als --model=<Wert>; inhaltlich gleich.
const ADA_SAVED = ["claude", "--model=opus", "--dangerously-skip-permissions"];

function argvOf(args) {
  const flag = args.find((arg) => arg.startsWith("--argv-json="));
  return JSON.parse(flag.slice("--argv-json=".length));
}

test("Drawer-Wechsel zeigt und speichert nur die Werte der gewählten Blaupause", async () => {
  const { blueprintDraft, sameBlueprintDraft, blueprintSwitchNeedsConfirm, blueprintSaveArgs } =
    await import("../model.js");

  assert.deepEqual(blueprintDraft(ADA), {
    original: "ada",
    color: "c2",
    name: "ada",
    role: "pruefer",
    program: "claude",
    model: "opus",
    flags: "--dangerously-skip-permissions",
    prompt: "",
  });

  const zapDraft = { mode: "edit", ...blueprintDraft(ZAP) };
  const adaDraft = { mode: "edit", ...blueprintDraft(ADA) };
  assert.equal(sameBlueprintDraft(zapDraft, adaDraft), false);
  assert.equal(sameBlueprintDraft(zapDraft, { mode: "edit", original: "zap" }), true);

  // Geänderter zap-Drawer: Wechsel fragt nach, statt still zu überschreiben.
  assert.equal(blueprintSwitchNeedsConfirm(zapDraft, adaDraft, true), true);
  assert.equal(blueprintSwitchNeedsConfirm(null, adaDraft, true), false, "erster Aufbau fragt nicht");
  assert.equal(blueprintSwitchNeedsConfirm(zapDraft, adaDraft, false), false, "ohne Änderung wechselt es direkt");

  // Nach dem Wechsel steht ausschließlich adas Formular im Drawer.
  const form = {
    name: adaDraft.name,
    role: adaDraft.role,
    model: adaDraft.model,
    flags: adaDraft.flags,
    program: adaDraft.program,
    prompt: "adas prompt",
  };
  const plan = blueprintSaveArgs({ mode: "edit", original: "ada", color: "c2" }, form);
  assert.equal(plan.error, undefined);
  assert.equal(plan.args[0], "blueprint");
  assert.equal(plan.args[1], "edit");
  assert.equal(plan.args[2], "ada");
  assert.deepEqual(argvOf(plan.args), ADA_SAVED);
  assert.equal(plan.args.includes("--prompt-text=adas prompt"), true);
  assert.equal(plan.args.some((arg) => arg.includes("deepseek") || arg.includes("yolo")), false,
    "keine Werte aus zaps Drawer");

  // Umbenennen zielt weiterhin auf die angezeigte Blaupause (ada), nicht auf zap.
  const renamed = blueprintSaveArgs({ mode: "edit", original: "ada", color: "c2" }, { ...form, name: "ada-2" });
  assert.equal(renamed.args[2], "ada");
  assert.equal(renamed.args.includes("--rename=ada-2"), true);
  assert.deepEqual(argvOf(renamed.args), ADA_SAVED);

  const added = blueprintSaveArgs({ mode: "new", original: "", color: "c3" }, { ...form, name: "neu" });
  assert.deepEqual(added.args.slice(0, 3), ["blueprint", "add", "neu"]);
  assert.equal(added.args.includes("--color=c3"), true);
});

test("Schneller Wechsel: spätes Prompt-Laden der alten Blaupause landet nicht im neuen Formular", async () => {
  const { promptLoadApplies } = await import("../model.js");
  const zapEditor = { value: "" };
  const adaEditor = { value: "" };
  const zapLoad = { draft: 1, editor: zapEditor, name: "zap" };

  // Drawer inzwischen auf ada (neuer Lauf, neuer Editor) → zaps Antwort verwerfen.
  assert.equal(promptLoadApplies(zapLoad, { draft: 2, editor: adaEditor, name: "ada" }), false);
  // Gleicher Lauf, aber Drawer geschlossen → verwerfen.
  assert.equal(promptLoadApplies(zapLoad, { draft: 2, editor: null, name: "" }), false);
  // Eigener Lauf darf schreiben.
  assert.equal(promptLoadApplies(zapLoad, { draft: 1, editor: zapEditor, name: "zap" }), true);
  // adas Lauf schreibt nur in adas Editor.
  const adaLoad = { draft: 2, editor: adaEditor, name: "ada" };
  assert.equal(promptLoadApplies(adaLoad, { draft: 2, editor: adaEditor, name: "ada" }), true);
  assert.equal(promptLoadApplies(adaLoad, { draft: 2, editor: zapEditor, name: "zap" }), false);
});

test("Speichern ohne Namen oder Programm meldet den Fehler statt zu schreiben", async () => {
  const { blueprintSaveArgs } = await import("../model.js");
  assert.deepEqual(blueprintSaveArgs({ mode: "edit", original: "ada", color: "c2" }, {
    name: "  ", role: "pruefer", model: "opus", flags: "", program: "claude", prompt: "",
  }), { error: "Bitte einen Namen angeben." });
  assert.deepEqual(blueprintSaveArgs({ mode: "edit", original: "ada", color: "c2" }, {
    name: "ada", role: "pruefer", model: "opus", flags: "", program: "", prompt: "",
  }), { error: "Bitte ein Programm wählen." });
});

// ---------- Teamkarten ----------

const TEAM = {
  name: "herdr-app",
  repos: ["/r/a", "/r/b"],
  members: [{ blueprint: "zap", model: "sonnet", max_cost: 7 }, { blueprint: "ada" }],
  reviewer: "ada",
  max_sessions: 4,
};

test("teamDraft liest die Teamkarte ohne Zusatzfelder", async () => {
  const { teamDraft } = await import("../model.js");
  assert.deepEqual(teamDraft(TEAM), {
    name: "herdr-app",
    repos: ["/r/a", "/r/b"],
    members: [
      { blueprint: "zap", model: "sonnet", max_cost: 7 },
      { blueprint: "ada", model: "", max_cost: "" },
    ],
    reviewer: "ada",
    max_sessions: 4,
  });
});

test("teamMembersJson lässt leere Übersteuerungen weg und schreibt max_cost als Zahl", async () => {
  const { teamMembersJson } = await import("../model.js");
  assert.equal(teamMembersJson([
    { blueprint: "zap", model: "sonnet", max_cost: "7" },
    { blueprint: "ada", model: "  ", max_cost: "" },
    { blueprint: "bo", max_cost: 0 },
  ]), JSON.stringify([
    { blueprint: "zap", model: "sonnet", max_cost: 7 },
    { blueprint: "ada" },
    { blueprint: "bo", max_cost: 0 },
  ]));
});

test("teamSaveArgs ersetzt Repos und Mitglieder als ganze Listen", async () => {
  const { teamSaveArgs } = await import("../model.js");
  const plan = teamSaveArgs(TEAM, {
    name: "herdr-app",
    repos: ["/r/a", "/r/c"],
    members: [{ blueprint: "zap", model: "", max_cost: "" }, { blueprint: "ada", model: "opus" }],
    reviewer: "ada",
    max_sessions: "6",
  });
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.args.slice(0, 3), ["team", "edit", "herdr-app"]);
  const repoArgs = [];
  for (let index = 3; index < plan.args.length; index += 1) {
    if (plan.args[index] === "--repo") repoArgs.push(plan.args[index + 1]);
  }
  assert.deepEqual(repoArgs, ["/r/a", "/r/c"]);
  assert.equal(plan.args.filter((arg) => arg === "--repo").length, 2, "ein --repo je Pfad");
  assert.equal(plan.args.includes('--members-json=[{"blueprint":"zap"},{"blueprint":"ada","model":"opus"}]'), true);
  assert.equal(plan.args.includes("--reviewer=ada"), true);
  assert.equal(plan.args.includes("--max-sessions=6"), true);
  assert.equal(plan.args.at(-1), "--from=mensch");
});

test("teamSaveArgs verlangt Repos, Mitglieder und einen Prüfer aus dem Team", async () => {
  const { teamSaveArgs } = await import("../model.js");
  const base = {
    name: "herdr-app",
    repos: ["/r/a"],
    members: [{ blueprint: "zap" }, { blueprint: "ada" }],
    reviewer: "ada",
    max_sessions: 4,
  };
  assert.equal(teamSaveArgs(TEAM, { ...base, repos: [] }).error, "Team braucht mindestens ein Repo.");
  assert.equal(teamSaveArgs(TEAM, { ...base, members: [] }).error, "Team braucht mindestens ein Mitglied.");
  assert.equal(teamSaveArgs(TEAM, { ...base, reviewer: "" }).error, "Bitte eine Prüferin oder einen Prüfer wählen.");
  // Ein Prüfer außerhalb der Mitglieder geht an fab; dort kommt die Meldung her.
  assert.equal(teamSaveArgs(TEAM, { ...base, reviewer: "bo" }).error, undefined);
  assert.equal(teamSaveArgs(TEAM, { ...base, max_sessions: 0 }).error, "Sitzungen müssen zwischen 1 und 16 liegen.");
  assert.equal(teamSaveArgs(TEAM, { ...base, members: [{ blueprint: "zap" }, { blueprint: "ada", max_cost: "viel" }] }).error,
    "max-cost für ada muss eine ganze Zahl ≥ 0 sein.");
});

test("teamAddArgs baut die Kommandozeile für ein neues Team", async () => {
  const { teamAddArgs } = await import("../model.js");
  const plan = teamAddArgs({
    name: "  alpha  ",
    repos: ["/r/a", " /r/c ", "/r/a", ""],
    members: [{ blueprint: "zap", model: "", max_cost: "" }, { blueprint: "ada", model: "opus" }],
    reviewer: "  ada  ",
    max_sessions: "6",
  });
  assert.equal(plan.error, undefined);
  assert.equal(plan.name, "alpha");
  assert.equal(plan.sessions, 6);
  assert.deepEqual(plan.args, [
    "team", "add", "alpha",
    "--repo", "/r/a",
    "--repo", "/r/c",
    "--repo", "/r/a",
    '--members-json=[{"blueprint":"zap"},{"blueprint":"ada","model":"opus"}]',
    "--reviewer=ada",
    "--max-sessions=6",
    "--from=mensch",
  ]);
  // Das Orchestrator-Prompt wählt fab selbst.
  assert.equal(plan.args.some((arg) => arg.startsWith("--orchestrator-prompt")), false);
});

test("teamAddArgs meldet fehlende oder ungültige Eingaben", async () => {
  const { teamAddArgs } = await import("../model.js");
  const base = {
    name: "alpha",
    repos: ["/r/a"],
    members: [{ blueprint: "zap" }, { blueprint: "ada" }],
    reviewer: "ada",
    max_sessions: 4,
  };
  const nameError = "Teamname: 1–16 Zeichen, nur Kleinbuchstaben, Ziffern, „_“ und „-“, beginnend mit einem Buchstaben.";
  assert.equal(teamAddArgs({ ...base, name: "" }).error, "Bitte einen Teamnamen angeben.");
  assert.equal(teamAddArgs({ ...base, name: "   " }).error, "Bitte einen Teamnamen angeben.");
  assert.equal(teamAddArgs({ ...base, name: "Alpha" }).error, nameError);
  assert.equal(teamAddArgs({ ...base, name: "1alpha" }).error, nameError);
  assert.equal(teamAddArgs({ ...base, name: "a".repeat(17) }).error, nameError);
  assert.equal(teamAddArgs({ ...base, name: "a".repeat(16) }).error, undefined);
  assert.equal(teamAddArgs({ ...base, repos: [] }).error, "Team braucht mindestens ein Repo.");
  assert.equal(teamAddArgs({ ...base, repos: ["  ", ""] }).error, "Team braucht mindestens ein Repo.");
  assert.equal(teamAddArgs({ ...base, members: [] }).error, "Team braucht mindestens ein Mitglied.");
  assert.equal(teamAddArgs({ ...base, reviewer: "" }).error, "Bitte eine Prüferin oder einen Prüfer wählen.");
  assert.equal(teamAddArgs({ ...base, max_sessions: 0 }).error, "Sitzungen müssen zwischen 1 und 16 liegen.");
  assert.equal(teamAddArgs({ ...base, max_sessions: 17 }).error, "Sitzungen müssen zwischen 1 und 16 liegen.");
  assert.equal(teamAddArgs({ ...base, members: [{ blueprint: "zap" }, { blueprint: "ada", max_cost: "viel" }] }).error,
    "max-cost für ada muss eine ganze Zahl ≥ 0 sein.");
});

test("teamAddArgs schneidet Leerraum ab und nimmt Mitglieder ohne Übersteuerungen", async () => {
  const { teamAddArgs } = await import("../model.js");
  const plan = teamAddArgs({
    name: " alpha ",
    repos: [" /r/a "],
    members: [{ blueprint: "zap", model: " ", max_cost: "" }, { blueprint: "ada" }],
    reviewer: " zap ",
    max_sessions: 1,
  });
  assert.equal(plan.error, undefined);
  assert.equal(plan.name, "alpha");
  assert.equal(plan.args[2], "alpha");
  assert.equal(plan.args[4], "/r/a");
  assert.equal(plan.args.includes('--members-json=[{"blueprint":"zap"},{"blueprint":"ada"}]'), true);
  assert.equal(plan.args.includes("--reviewer=zap"), true);
  assert.equal(plan.args.includes("--max-sessions=1"), true);
  assert.equal(plan.args.at(-1), "--from=mensch");
});

test("blueprintMemberOptions bietet nur noch nicht gewählte Blaupausen", async () => {
  const { blueprintMemberOptions } = await import("../model.js");
  const blueprints = [
    { name: "zap", role: "umsetzer" },
    { name: "ada", role: "pruefer" },
    { name: "bo", role: "recherche" },
  ];
  assert.deepEqual(blueprintMemberOptions(blueprints, [{ blueprint: "ada" }, "zap"]), [
    { value: "bo", label: "bo", detail: "recherche", selected: false },
  ]);
});

test("teamDirty erkennt Änderungen an Repos, Mitgliedern, Prüfer und Sitzungen", async () => {
  const { teamDirty } = await import("../model.js");
  const form = {
    name: "herdr-app",
    repos: ["/r/a", "/r/b"],
    members: [{ blueprint: "zap", model: "sonnet", max_cost: "7" }, { blueprint: "ada" }],
    reviewer: "ada",
    max_sessions: "4",
  };
  assert.equal(teamDirty(TEAM, form), false);
  assert.equal(teamDirty(TEAM, { ...form, repos: ["/r/a"] }), true);
  assert.equal(teamDirty(TEAM, { ...form, members: [{ blueprint: "zap" }, { blueprint: "ada" }] }), true);
  assert.equal(teamDirty(TEAM, { ...form, reviewer: "zap" }), true);
  assert.equal(teamDirty(TEAM, { ...form, max_sessions: "5" }), true);
});

test("teamForTicket und teamAgents wählen das Team nach dem Repo-Pfad", () => {
  const teams = [
    { name: "team-a", repos: ["/r/a"], agents: [{ name: "ada" }, { name: "bo" }] },
    { name: "team-b", repos: ["/r/b/"], agents: [{ name: "cy" }] },
  ];

  assert.equal(teamForTicket(teams, { repo: "/r/b" }), teams[1]);
  assert.deepEqual(teamAgents(teams, { repo: "/r/b" }).map((agent) => agent.name), ["cy"]);
  assert.equal(teamForTicket(teams, { repo: "/r/b/" }), teams[1]);

  assert.equal(teamForTicket(teams, {}), teams[0]);
  assert.deepEqual(teamAgents(teams, { repo: "" }).map((agent) => agent.name), ["ada", "bo"]);

  assert.equal(teamForTicket(teams, { repo: "/r/unknown" }), null);
  assert.deepEqual(teamAgents(teams, { repo: "/r/unknown" }), []);
});
