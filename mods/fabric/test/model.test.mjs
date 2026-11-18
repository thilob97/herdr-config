// Tests der reinen Fabric-Logik: Stufen, Erwähnungen, Inbox, Timeline.
//   node --test mods/fabric/test/

import test from "node:test";
import assert from "node:assert/strict";

import {
  groupByStage, mentionSegments, sortInbox, timeline, relativeTime, wakeLine,
  sessionChips, sessionStatus,
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

test("Timeline: Akteure sind Spalten, Zeit läuft von neu (oben) nach alt (unten)", () => {
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
  assert.deepEqual(result.points.map((point) => point.x), [0.875, 0.375, 0.375, 0.125, 0.875]);
  assert.deepEqual(result.points.map((point) => point.y), [1, 0.75, 0.5, 0.25, 0]);
  assert.deepEqual(result.times, [5000, 4000, 3000, 2000, 1000]);
  assert.equal(result.rows, 5);

  assert.equal(result.arrows.length, 2);
  assert.deepEqual(
    result.arrows.map((arrow) => [arrow.actor, arrow.from, arrow.target, arrow.to]),
    [["zap", 1, "ada", 2], ["mensch", 3, "zap", 1]],
  );
  assert.deepEqual(
    result.arrows.map((arrow) => [arrow.x1, arrow.x2, arrow.y]),
    [[0.375, 0.625, 0.5], [0.875, 0.375, 0]],
  );
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

// ---------- Erwähnungen und Vorschau ----------

test("@-Vorschläge: erkennt die Eingabe am Cursor und ersetzt sie", async () => {
  const { mentionQuery, mentionSuggestions, insertMention } = await import("../model.js");
  assert.deepEqual(mentionQuery("Hallo @ad", 9), { start: 6, end: 9, query: "ad" });
  assert.equal(mentionQuery("thilo@example.com", 17), null);
  assert.equal(mentionQuery("Hallo @ada", 6), null, "der Cursor steht vor dem @");

  const suggestions = mentionSuggestions("Bitte @a", 8, ["ada", "zap", "ada", "anton", "mensch"]);
  assert.deepEqual(suggestions.map((entry) => entry.name), ["ada", "anton"]);

  const inserted = insertMention("Bitte @a prüfen", 8, "ada");
  assert.equal(inserted.text, "Bitte @ada  prüfen");
  assert.equal(inserted.caret, 11);
  assert.deepEqual(insertMention("ohne", 4, "ada"), { text: "ohne", caret: 4 });
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
    "C:\\\\pfad\\\\datei /usr/\\*/bin a\\*b\\*c $x\\_1$ \\_\\_init\\_\\_.py",
  );
});

test("Nackte URLs werden zu Links, Satzzeichen bleiben Text", async () => {
  const { plainMentionMarkdown } = await import("../model.js");
  assert.equal(
    plainMentionMarkdown("Siehe https://example.com/a_b?x=1, dann."),
    "Siehe <https://example.com/a_b?x=1>, dann.",
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
    "thilo@example.com schreibt",
    "E-Mail-Adressen bleiben Text",
  );
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
