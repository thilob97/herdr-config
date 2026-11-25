// Tests der reinen Fabric-Logik: Stufen, Erwähnungen, Inbox, Timeline.
//   node --test mods/fabric/test/

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Fensterlayout (T-122): läuft mit, weil package.json genau diese Datei lädt.
import "./window-body.test.mjs";

import {
  groupByStage, mentionSegments, sortInbox, inboxRetry, lessonArgs, timelineFeed, eventSummary, relativeTime,
  PAGE_WORDS, pageWord, roleLabel, promptKindWord, actorLabel,
  STAGES, STATUS_WORDS, INBOX_WORDS, EVENT_WORDS,
  stallLabel, stallReason,
  wakeLine, sessionChips, sessionStatus, childrenOf, childProgress,
  openBlockers, blockerEntries,
  teamForTicket, teamAgents,
  decisionSentence, decideConfirmArgs, decideRejectArgs, contextDisplay,
  PROPOSAL_WORDS, proposalQuestion, proposalConsequences, proposalStatusWord,
  ticketCards, inboxCards, commentDecisionHint,
  NOTIFY_SETTINGS_KEY, NOTIFY_SEEN_KEY, NOTIFY_DEFAULTS, normalizeNotifySettings, inQuietHours, minuteOfDay,
  INBOX_LEVELS, inboxNotifyLevel, inboxNotifySound, inboxEntryId, inboxNotifications,
  formatCost, formatDuration, ticketCost, costTotals,
  flowNodeStates, flowLayout, flowStatusWord, flowRunWord, flowNodeSteps,
  flowNodeReason, flowNodeTicket, flowKindWord,
  FLOW_NODE_TYPES, FLOW_TRIGGER_TYPES, FLOW_ACTION_TYPES, flowNewDefinition, flowLoad, flowSerialize,
  flowParse, flowNodeTemplate, flowNodeId, flowAddNode, flowRemoveNode, flowPatchNode, flowConnect,
  flowRemoveEdge, flowPatchEdge, flowOutgoing, flowEdgeWhenOptions, flowPlaceholders, flowValidate,
  autopilotLamp, autopilotLogLines, autopilotPopover, autopilotActions, AUTOPILOT_STALE_MS,
  alarmEntries, alarmActive,
  tickDue, TICK_INTERVAL_MS,
  PIPELINE_STATE_WORDS, PIPELINE_TRIGGER_WORDS, pipelineState, pipelineStateWord, pipelineTriggerWord,
  pipelineStepSummary, pipelineRunsNewest, pipelineLastRun, pipelineBadge, pipelineAutoStep,
  pipelineOpenSteps, pipelineLogLines, pipelineLogSearch, pipelineDuration, pipelineRunTarget,
  knowledgeAddArgs, knowledgeNoteArgs, knowledgeRemoveArgs, knowledgeNoteFile,
  knowledgeNameProblem, knowledgeSize,
  REPO_TABS, REPO_EDITOR_TABS, repoTabAfterLoad, repoEditorKey,
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

test("Inbox: „Erneut starten“ nur mit Ticket und Agent", () => {
  assert.equal(inboxRetry(null), null);
  assert.equal(inboxRetry({}), null);
  assert.equal(inboxRetry({ ticket: "T-27" }), null);
  assert.equal(inboxRetry({ agent: "zap" }), null);
  assert.equal(inboxRetry({ ticket: "T-27", agent: "" }), null);

  assert.deepEqual(inboxRetry({ ticket: "T-27", agent: "zap" }), {
    agent: "zap",
    args: ["wake", "T-27", "zap", "--from=mensch", "--", "Erneut starten"],
  });
  assert.equal(inboxRetry({ ticket: "T-27", agent: "orchestrator" }).agent, "orchestrator");

  const tick = {
    kind: "attention",
    ticket: "T-28",
    agent: "ada",
    reason: "Regel 1 (doing): keine Bewegung",
    since: 100,
  };
  assert.deepEqual(inboxRetry(tick), {
    agent: "ada",
    args: ["wake", "T-28", "ada", "--from=mensch", "--", "Erneut starten"],
  });
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
  const flow = eventSummary({ kind: "flow", actor: "flow", text: "main-pruefen" });
  assert.equal(flow.actor, "Workflow");
  assert.equal(flow.verb, "führte aus");
  assert.equal(flow.detail, "main-pruefen");
  assert.equal(eventSummary({ kind: "decision", actor: "mensch", text: "so" }).verb, "entschied");
  assert.equal(eventSummary({ kind: "alarm", actor: "fab", text: "main rot" }).verb, "meldete");
});

test("Verlaufsende: Text, Kopfzeile, zwei Kommentare, fremde Weckzeilen zählen nicht", async () => {
  const { history, historyEndIndex } = await import("../model.js");
  const ticket = {
    id: "T-1",
    comments: [{ at: 10, text: "erst" }, { at: 30, text: "dann" }],
  };
  const events = [
    { kind: "wake", ticket: "T-1", at: 20, target: "ada", text: "geweckt" },
    { kind: "wake", ticket: "T-2", at: 40, target: "zap", text: "geweckt" },
    { kind: "status", ticket: "T-1", at: 50, text: "todo → doing" },
  ];

  assert.deepEqual(history(ticket, events).map((row) => row.kind), ["comment", "wake", "comment"]);
  assert.equal(historyEndIndex(ticket, events), 1 + 3, "Text plus Kopfzeile plus drei Zeilen");

  assert.equal(historyEndIndex({ id: "T-1", comments: [] }, events), 2,
    "Leerzustand: Text plus Kopfzeile plus eine Zeile");
  assert.equal(historyEndIndex({ id: "T-9", comments: [] }, events), 2);
  assert.equal(historyEndIndex(null, null), 2);
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

test("Stillstand: Dauer auf Deutsch, Grund als Tooltip", () => {
  const now = 10 * 60 * 60 * 1000;
  assert.equal(stallLabel({ since: now - 30000 }, now), "stockt seit gerade eben");
  assert.equal(stallLabel({ since: now - 5 * 60000 }, now), "stockt seit 5 min");
  assert.equal(stallLabel({ since: now - 3 * 60 * 60000 }, now), "stockt seit 3 h");
  assert.equal(stallLabel({ since: now - 2 * 24 * 60 * 60000 }, now), "stockt seit 2 Tagen");
  assert.equal(stallLabel(null, now), "");
  assert.equal(stallLabel({}, now), "");

  assert.equal(stallReason({ reason: "keine Antwort" }), "keine Antwort");
  assert.equal(stallReason(null), "");
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

test("Zielbegriffe: Seiten und Ticket-Stufen tragen die Wörter der Begriffstabelle", () => {
  assert.deepEqual(
    ["board", "tickets", "workflows", "pipelines", "team", "prompts", "templates", "repos", "settings"]
      .map((page) => PAGE_WORDS[page]),
    ["Board", "Tickets", "Workflows", "Pipelines", "Team", "Prompts", "Vorlagen", "Repos", "Einstellungen"],
  );
  assert.equal(pageWord("timeline"), "Zeitverlauf");
  assert.equal(pageWord("inbox"), "Posteingang");
  assert.deepEqual(STAGES.map((stage) => stage.label), ["Entwurf", "Geplant", "In Arbeit", "Prüfung", "Fertig"]);
  assert.equal(STATUS_WORDS.dropped, "Verworfen");
  assert.equal(roleLabel("umsetzer"), "Umsetzer");
  assert.equal(roleLabel("pruefer"), "Prüferin / Prüfer");
  assert.equal(roleLabel("UI / UX Designer"), "UI / UX Designer");
  assert.equal(roleLabel(""), "ohne Rolle");
  assert.equal(promptKindWord("orchestrator"), "Orchestrator");
  assert.equal(promptKindWord("preamble"), "Präambel");
  assert.equal(promptKindWord("agent"), "Rolle");
  assert.equal(INBOX_WORDS.decision, "Entscheidung");
  assert.equal(EVENT_WORDS.flow, "Workflow");
  assert.equal(actorLabel("flow"), "Workflow");
  assert.equal(actorLabel("fab"), "Fabric");
});

// Ausdruck hinter `const|let|var <name> =` bis zum Semikolon auf oberster
// Ebene; Klammern und Strings werden übersprungen.
function initializerOf(source, name) {
  const escaped = name.replace(/\$/g, "\\$&");
  const match = new RegExp(
    `(?:^|[^\\w$.])(?:const|let|var)\\s+${escaped}\\s*=`,
    "m",
  ).exec(source);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === ";" && depth === 0) return source.slice(start, i);
  }
  return null;
}

// Argumente eines Aufrufs ab der öffnenden Klammer, getrennt an Kommas auf
// oberster Ebene.
function callArguments(source, open) {
  const args = [];
  let depth = 0;
  let quote = null;
  let start = open + 1;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      if (depth === 0) {
        args.push(source.slice(start, i));
        return args;
      }
      depth -= 1;
    } else if (char === "," && depth === 0) {
      args.push(source.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

// Statische Teile der String-Literale; Template-Ausdrücke zählen nicht.
function stringLiterals(source) {
  const found = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g;
  for (const match of source.matchAll(pattern)) {
    if (match[3] != null) {
      for (const part of match[3].split(/\$\{[^}]*\}/)) found.push(part);
    } else {
      found.push(match[1] ?? match[2]);
    }
  }
  return found;
}

// Titel-Ausdruck; eine reine Titelvariable wird über ihre Initialisierung
// aufgelöst, damit Literale auch hinter einer Zwischenvariable auffallen.
function titleExpression(source, expression, depth = 0) {
  const trimmed = expression.trim();
  if (depth >= 3 || !/^[A-Za-z_$][\w$]*$/.test(trimmed)) return trimmed;
  const initializer = initializerOf(source, trimmed);
  return initializer == null
    ? trimmed
    : titleExpression(source, initializer, depth + 1);
}

test("Seitenköpfe: keine PAGE_WORDS-Literale, auch nicht über Titelvariablen", () => {
  const views = join(dirname(fileURLToPath(import.meta.url)), "..", "views");
  const files = readdirSync(views).filter((name) => name.endsWith(".js"));
  const words = new Set(Object.values(PAGE_WORDS));
  const used = new Map();
  for (const file of files) {
    const source = readFileSync(join(views, file), "utf8");
    for (const match of source.matchAll(/model\.pageWord\("([^"]+)"\)/g)) {
      used.set(match[1], file);
    }
    for (const match of source.matchAll(/ui\.(?:header|detailHeader)\s*\(/g)) {
      const args = callArguments(source, match.index + match[0].length - 1);
      if (args.length < 2) continue;
      for (const literal of stringLiterals(titleExpression(source, args[1]))) {
        assert.ok(
          !words.has(literal),
          `${file}: Seitenkopf-Literal „${literal}“ statt model.pageWord()`,
        );
      }
    }
  }
  assert.ok(used.size > 0, "keine pageWord-Nutzung in den Views gefunden");
  const missing = [...used]
    .filter(([page]) => !(page in PAGE_WORDS))
    .map(([page, file]) => `${page} (${file})`);
  assert.deepEqual(missing, [], `Seiten ohne PAGE_WORDS-Eintrag: ${missing.join(", ")}`);
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

  // „Verworfen“ öffnet immer den Dialog (fab drop); andere Wechsel nicht.
  assert.deepEqual(
    statusOptions("draft").filter((option) => option.drop).map((option) => option.key),
    ["dropped"],
  );
  assert.deepEqual(
    statusOptions("doing").filter((option) => option.drop).map((option) => option.key),
    ["dropped"],
  );
  assert.equal(
    statusOptions("doing").find((option) => option.key === "review").drop,
    false,
  );
  assert.equal(
    statusOptions("dropped").some((option) => option.drop),
    false,
  );

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
    { id: "T-31", status: "doing", title: "arbeiten", updated_at: 7, repo: "/r/a",
      stall: { rule: "doing", since: 1, attempts: 1, attention: true, reason: "keine Bewegung" } },
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

test("Board-Titel: zwei Zeilen, gekappt mit Ellipse", async () => {
  const { titleLines } = await import("../model.js");
  const short = titleLines("Kurzer Titel", 150);
  assert.deepEqual(short, { lines: ["Kurzer Titel"], clipped: false });

  const long = titleLines("Board-Karten: Statusmenü und Zuständiger bei langen Chips sichtbar halten und Zahlen richtig zeigen", 150);
  assert.equal(long.clipped, true);
  assert.equal(long.lines.length, 2);
  assert.match(long.lines[1], /…$/, "die letzte sichtbare Zeile endet mit einer Ellipse");
  assert.equal(long.lines.join(" ").includes("Zahlen"), false, "gekappter Text bleibt weg");
});

test("Board-Spalten: Fertig nennt neben dem gekappten count die Gesamtzahl", async () => {
  const { boardColumns } = await import("../model.js");
  const tickets = [];
  for (let index = 1; index <= 25; index += 1) {
    tickets.push({ id: `T-${index}`, status: "done", title: `fertig ${index}`, updated_at: index });
  }

  const columns = boardColumns(tickets, { doneLimit: 20 });
  const done = columns.find((column) => column.key === "done");
  assert.equal(done.count, 20, "die Spalte zeigt höchstens doneLimit Karten");
  assert.equal(done.tickets.length, 20);
  assert.equal(done.total, 25, "total bleibt die echte Gesamtzahl");
  assert.equal(columns.find((column) => column.key === "todo").total, 0);
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
  assert.equal(wakeSummary("@ada und @mensch", names), "Weckt ada · Posteingang: mensch.");
  assert.equal(wakeSummary("@zap @fremd", names), "Weckt zap · Unbekannt: fremd.");
  assert.equal(wakeSummary("nur Text", names), "Weckt niemanden.");
});

test("Offene @-Eingabe zählt nicht als Unbekannt", async () => {
  const { wakeSummary } = await import("../model.js");
  const names = ["ada", "zap"];
  assert.equal(wakeSummary("@a", names, "mensch", { start: 0, end: 2 }), "Weckt niemanden.");
  assert.equal(wakeSummary("@ada und @a", names, "mensch", { start: 9, end: 11 }), "Weckt ada.");
  assert.equal(wakeSummary("@a", names, "mensch"), "Unbekannt: a.", "ohne pending bleibt es beim Alten");
  assert.equal(wakeSummary("@a", names, "mensch", { start: 0, end: 9 }), "Unbekannt: a.",
    "ein Bereich außerhalb des Textes zählt nicht");
  assert.equal(wakeSummary("@ada @a", names, "mensch", { start: 5, end: 7 }), "Weckt ada.");
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
    "C:\\\\pfad\\\\datei /usr/\\*/bin a\\*b\\*c $x_1$ \\_\\_init\\_\\_\\.py",
  );
});

test("Inline-Mathematik bleibt wörtlich, die T-13-Fälle bleiben maskiert", async () => {
  const { plainMentionMarkdown } = await import("../model.js");
  assert.equal(plainMentionMarkdown("$x_1$"), "$x_1$");
  assert.equal(plainMentionMarkdown("Formel $a_1 + b^2$ gilt"), "Formel $a_1 + b^2$ gilt");
  assert.equal(plainMentionMarkdown("$a\\$b$"), "$a\\$b$", "maskiertes Zeichen beendet die Formel nicht");
  assert.equal(plainMentionMarkdown("$offen"), "$offen", "ein einzelnes $ bleibt Text");
  assert.equal(plainMentionMarkdown("$a\nb$"), "$a  \nb$", "Formeln laufen nicht über Zeilen");

  for (const literal of ["C:\\pfad\\datei", "/usr/*/bin", "a*b*c", "__init__.py", "1. "]) {
    const rendered = plainMentionMarkdown(literal);
    assert.equal(rendered, literal.replace(/[\\`*_{}\[\]()#+\-.!|>~=&<>]/g, "\\$&"),
      `${literal} bleibt maskiert`);
  }
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


test("Eigenschaften-Ende und Dropdown-Schwelle", async () => {
  const { propertiesEndIndex, dropdownNeedsScroll } = await import("../model.js");
  assert.equal(propertiesEndIndex(4, 14, true), 18, "eingebettet hinter dem Verlauf");
  assert.equal(propertiesEndIndex(4, 14, false), 13, "letztes Feld der Spalte");
  assert.equal(propertiesEndIndex(2, 1, false), 0);
  assert.equal(dropdownNeedsScroll(0), false);
  assert.equal(dropdownNeedsScroll(11), false);
  assert.equal(dropdownNeedsScroll(12), true);
});

test("Schmales Fenster: unter 760 px einspaltig, sonst nicht", async () => {
  const { compactWidth, COMPACT_WIDTH } = await import("../model.js");
  assert.equal(COMPACT_WIDTH, 760);
  assert.equal(compactWidth(520), true);
  assert.equal(compactWidth(759), true);
  assert.equal(compactWidth(760), false);
  assert.equal(compactWidth(1694), false);
  assert.equal(compactWidth(0), false);
  assert.equal(compactWidth(null), false);
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

test("Vorlagen: feste Reihenfolge, Labels und Issue-Zeilen", async () => {
  const { TEMPLATE_ORDER, templateLabel, sortTemplates, issueLabel } = await import("../model.js");
  assert.deepEqual(TEMPLATE_ORDER, ["bug", "feature", "refactor", "chore"]);
  assert.equal(templateLabel("bug"), "Bug");
  assert.equal(templateLabel("feature"), "Feature");
  assert.equal(templateLabel("refactor"), "Refactor");
  assert.equal(templateLabel("chore"), "Chore");
  assert.equal(templateLabel("security"), "security");
  assert.equal(templateLabel(null), "");
  assert.deepEqual(
    sortTemplates([
      { name: "zeta" }, { name: "chore" }, { name: "alpha" },
      { name: "bug" }, { name: "feature" }, { name: "refactor" },
    ]).map((row) => row.name),
    ["bug", "feature", "refactor", "chore", "alpha", "zeta"],
  );
  assert.deepEqual(sortTemplates(null), []);
  assert.equal(issueLabel({ number: 12, title: "Login-Fehler" }), "#12 Login-Fehler");
  assert.equal(issueLabel({ title: "ohne Nummer" }), "ohne Nummer");
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
    editArgs, newArgs, commentArgs, acceptArgs, prUrl, rejectArgs, dropArgs, wakeArgs,
    promptSetArgs, templateSetArgs, repoSetArgs,
  } = await import("../model.js");

  assert.deepEqual(acceptArgs("T-1"), ["accept", "T-1"]);
  assert.deepEqual(acceptArgs("T-1", { prOnly: true }), ["accept", "T-1", "--pr-only"]);
  assert.equal(prUrl("PR bereit: https://github.com/o/r/pull/12\n"), "https://github.com/o/r/pull/12");
  assert.equal(prUrl("https://github.com/o/r/pull/7 wurde geöffnet."), "https://github.com/o/r/pull/7");
  assert.equal(prUrl("kein Link hier"), "");
  assert.equal(prUrl(null), "");

  assert.deepEqual(editArgs("T-1", { title: "---", body: "-wichtig" }), [
    "edit", "T-1", "--title=---", "--body=-wichtig", "--from=mensch",
  ]);
  assert.deepEqual(newArgs("-wichtig", { repo: "/r", wake: false }), [
    "new", "--repo=/r", "--no-wake", "--from=mensch", "--", "-wichtig",
  ]);
  assert.deepEqual(newArgs("", { template: "bug" }), [
    "new", "--template=bug", "--from=mensch",
  ]);
  assert.deepEqual(newArgs("Login reparieren", { repo: "/r", template: "bug" }), [
    "new", "--repo=/r", "--template=bug", "--from=mensch", "--", "Login reparieren",
  ]);
  assert.deepEqual(newArgs("", { issue: 12, wake: false }), [
    "new", "--no-wake", "--issue=12", "--from=mensch",
  ]);
  assert.deepEqual(newArgs("Login reparieren", { issue: 7 }), [
    "new", "--issue=7", "--from=mensch", "--", "Login reparieren",
  ]);
  assert.deepEqual(newArgs(null, { issue: 7 }), [
    "new", "--issue=7", "--from=mensch",
  ]);
  assert.deepEqual(templateSetArgs("bug", "## Ziel\n{satz}"), [
    "template", "set", "bug", "--text=## Ziel\n{satz}", "--from=mensch",
  ]);
  assert.deepEqual(templateSetArgs("chore", "-text", "agent"), [
    "template", "set", "chore", "--text=-text", "--from=agent",
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
    brief: "",
    repos: ["/r/a", "/r/b"],
    members: [
      { blueprint: "zap", model: "sonnet", max_cost: 7 },
      { blueprint: "ada", model: "", max_cost: "" },
    ],
    reviewer: "ada",
    max_sessions: 4,
  });
});

test("teamDraft übernimmt den Steckbrief des Teams", async () => {
  const { teamDraft } = await import("../model.js");
  assert.equal(teamDraft({ ...TEAM, brief: "  Kurz und knapp.  " }).brief, "  Kurz und knapp.  ");
});

// ---------- Entscheidungen und Kontext ----------

test("decisionSentence faltet Leerraum zu einem Satz", async () => {
  const { decisionSentence } = await import("../model.js");
  assert.equal(decisionSentence("  Erste\tZeile\n\nzweite   Zeile  "), "Erste Zeile zweite Zeile");
  assert.equal(decisionSentence(""), "");
  assert.equal(decisionSentence(null), "");
  assert.equal(decisionSentence(undefined), "");
});

test("Vorschlagsfragen, Folgen, Statuswörter und Wortpaare", async () => {
  const { proposalQuestion, proposalConsequences, proposalStatusWord, PROPOSAL_WORDS } = await import("../model.js");
  assert.equal(proposalQuestion("SQLite statt JSON"), "Soll „SQLite statt JSON“ gelten?");
  assert.equal(proposalQuestion("SQLite statt JSON."), "Soll „SQLite statt JSON“ gelten?");
  assert.equal(proposalQuestion("Bleibt das so?"), "Bleibt das so?");
  assert.equal(proposalQuestion("   "), "");
  assert.equal(proposalQuestion(null), "");

  assert.deepEqual(proposalConsequences("decision"), {
    accept: "Die Entscheidung landet in .fabric/decisions.md.",
    reject: "Die Entscheidung wird verworfen und nicht festgehalten.",
  });
  assert.deepEqual(proposalConsequences("lesson"), {
    accept: "Die Lehre landet in .fabric/lessons.md.",
    reject: "Die Lehre wird verworfen und nicht festgehalten.",
  });

  assert.equal(proposalStatusWord("open"), "offen");
  assert.equal(proposalStatusWord("accepted"), "übernommen");
  assert.equal(proposalStatusWord("rejected"), "abgelehnt");
  assert.equal(proposalStatusWord("anderes"), "");
  assert.deepEqual(PROPOSAL_WORDS, { decision: "Entscheidung", lesson: "Lehre" });
});

test("ticketCards: offene Vorschläge und entschiedene Sätze in fester Reihenfolge", async () => {
  const { ticketCards } = await import("../model.js");
  const ticket = {
    id: "T-9",
    decision_proposals: [
      { id: "D1", text: "SQLite", reason: "Ein File", by: "orchestrator" },
    ],
    lesson_proposals: [{ id: "L1", text: "Tests zuerst", by: "ada" }],
  };
  const events = [
    { kind: "decision", ticket: "T-9", actor: "mensch", at: 500, text: "bestätigt: Anderer Satz" },
    { kind: "lesson", ticket: "T-9", actor: "ada", at: 600, text: "verworfen: Noch ein Satz" },
    { kind: "decision", ticket: "T-9", actor: "zap", at: 700, text: "bestätigt: SQLite" },
    { kind: "comment", ticket: "T-9", text: "bestätigt: egal" },
    { kind: "decision", ticket: "T-1", text: "verworfen: Fremd" },
    { kind: "lesson", ticket: "T-9", text: "ohne Präfix" },
    null,
  ];
  const cards = ticketCards(ticket, events);
  assert.deepEqual(cards.map((card) => [card.kind, card.status]), [
    ["decision", "open"],
    ["lesson", "open"],
    ["lesson", "rejected"],
    ["decision", "accepted"],
  ], "offene vor entschiedenen, offene Entscheidung vor Lehre, entschiedene nach Zeit");

  const decision = cards[0];
  assert.equal(decision.id, "D1");
  assert.equal(decision.kindWord, "Entscheidung");
  assert.equal(decision.ticket, "T-9");
  assert.equal(decision.sentence, "SQLite");
  assert.equal(decision.question, "Soll „SQLite“ gelten?");
  assert.equal(decision.context.text, "Vorschlag von orchestrator · Begründung: Ein File · Ticket T-9");
  assert.deepEqual(decision.consequences, {
    accept: "Die Entscheidung landet in .fabric/decisions.md.",
    reject: "Die Entscheidung wird verworfen und nicht festgehalten.",
  });
  assert.equal(decision.status, "open");
  assert.equal(decision.statusWord, "offen");
  assert.equal(decision.decidedBy, "");
  assert.equal(decision.decidedAt, null);
  assert.deepEqual(decision.acceptArgs, ["decide", "confirm", "T-9", "D1", "--from=mensch"]);
  assert.deepEqual(decision.rejectArgs, ["decide", "reject", "T-9", "D1", "--from=mensch"]);

  const lesson = cards[1];
  assert.equal(lesson.kindWord, "Lehre");
  assert.equal(lesson.question, "Soll „Tests zuerst“ gelten?");
  assert.equal(lesson.context.text, "Vorschlag von ada · Ticket T-9");
  assert.deepEqual(lesson.consequences, {
    accept: "Die Lehre landet in .fabric/lessons.md.",
    reject: "Die Lehre wird verworfen und nicht festgehalten.",
  });
  assert.equal(lesson.statusWord, "offen");
  assert.deepEqual(lesson.acceptArgs, ["lesson", "confirm", "T-9", "L1", "--from=mensch"]);
  assert.deepEqual(lesson.rejectArgs, ["lesson", "discard", "T-9", "L1", "--from=mensch"]);

  const rejected = cards[2];
  assert.equal(rejected.id, "");
  assert.equal(rejected.sentence, "Noch ein Satz");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.statusWord, "abgelehnt");
  assert.equal(rejected.decidedBy, "ada");
  assert.equal(rejected.decidedAt, 600);
  assert.equal(rejected.acceptArgs, null);
  assert.equal(rejected.rejectArgs, null);
  assert.equal(rejected.context.text, "Ticket T-9");

  const accepted = cards[3];
  assert.equal(accepted.sentence, "Anderer Satz");
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.statusWord, "übernommen");
  assert.equal(accepted.decidedBy, "mensch");
  assert.equal(accepted.decidedAt, 500);
  assert.equal(accepted.acceptArgs, null);
  assert.equal(accepted.rejectArgs, null);

  assert.deepEqual(ticketCards(null), []);
  assert.deepEqual(ticketCards({}, null), []);
  const robust = ticketCards({
    id: "T-1",
    decision_proposals: [null, "kaputt", {}, { id: "D2" }],
  }, [{}]);
  assert.equal(robust.length, 2, "Nicht-Objekte fallen weg, fehlende IDs bleiben ohne Argumente");
  assert.equal(robust[0].question, "");
  assert.equal(robust[0].acceptArgs, null);
  assert.equal(robust[0].rejectArgs, null);
  assert.equal(robust[1].id, "D2");
  assert.deepEqual(robust[1].acceptArgs, ["decide", "confirm", "T-1", "D2", "--from=mensch"]);
});

test("inboxCards: offene Vorschläge, Duplikate und entschiedene ohne offene Karte", async () => {
  const { inboxCards } = await import("../model.js");
  const entries = [
    { kind: "decision", ticket: "T-9", proposal: "D1", text: "SQLite", from: "orchestrator", reason: "Ein File", at: 10 },
    { kind: "lesson", ticket: "T-9", proposal: "L1", text: "Tests zuerst", from: "ada", at: 11 },
    { kind: "question", ticket: "T-9", proposal: "Q1", text: "Was?" },
    { kind: "decision", ticket: "T-9", text: "ohne Vorschlag" },
    null,
  ];
  const events = [
    { kind: "decision", ticket: "T-9", actor: "mensch", at: 20, text: "bestätigt: SQLite" },
    { kind: "decision", ticket: "T-7", actor: "zap", at: 30, text: "verworfen: Alt" },
  ];
  const cards = inboxCards(entries, events);
  assert.deepEqual(cards.map((card) => [card.kind, card.status]), [
    ["decision", "open"],
    ["lesson", "open"],
    ["decision", "rejected"],
  ], "gleicher Satz offen und entschieden erscheint nur offen, Fremdes bleibt entschieden");

  assert.equal(cards[0].id, "D1");
  assert.equal(cards[0].question, "Soll „SQLite“ gelten?");
  assert.equal(cards[0].context.text, "Vorschlag von orchestrator · Begründung: Ein File · Ticket T-9");
  assert.deepEqual(cards[0].acceptArgs, ["decide", "confirm", "T-9", "D1", "--from=mensch"]);
  assert.deepEqual(cards[0].rejectArgs, ["decide", "reject", "T-9", "D1", "--from=mensch"]);

  assert.equal(cards[1].id, "L1");
  assert.equal(cards[1].context.text, "Vorschlag von ada · Ticket T-9");
  assert.deepEqual(cards[1].acceptArgs, ["lesson", "confirm", "T-9", "L1", "--from=mensch"]);
  assert.deepEqual(cards[1].rejectArgs, ["lesson", "discard", "T-9", "L1", "--from=mensch"]);

  assert.equal(cards[2].ticket, "T-7");
  assert.equal(cards[2].sentence, "Alt");
  assert.equal(cards[2].decidedBy, "zap");
  assert.equal(cards[2].decidedAt, 30);
  assert.equal(cards[2].context.text, "Ticket T-7");

  assert.deepEqual(inboxCards(null), []);
  assert.deepEqual(inboxCards({}, null), []);
});

test("commentDecisionHint: gleicher Satz zeigt offen oder entschieden, sonst nichts", async () => {
  const { ticketCards, commentDecisionHint } = await import("../model.js");
  const cards = ticketCards({
    id: "T-9",
    decision_proposals: [{ id: "D1", text: "SQLite", by: "orchestrator" }],
    lesson_proposals: [{ id: "L1", text: "Tests zuerst", by: "ada" }],
  }, [
    { kind: "decision", ticket: "T-9", actor: "mensch", at: 500, text: "bestätigt: Anderer Satz" },
    { kind: "lesson", ticket: "T-9", actor: "ada", at: 600, text: "verworfen: Noch ein Satz" },
  ]);

  assert.deepEqual(commentDecisionHint({ text: " SQLite " }, cards), {
    state: "open",
    text: "Entscheidung offen → oben",
    decidedAt: null,
  });
  assert.deepEqual(commentDecisionHint({ text: "Tests zuerst" }, cards), {
    state: "open",
    text: "Lehre offen → oben",
    decidedAt: null,
  });
  assert.deepEqual(commentDecisionHint({ text: "Anderer Satz" }, cards), {
    state: "accepted",
    text: "Entscheidung übernommen von mensch",
    decidedAt: 500,
  });
  assert.deepEqual(commentDecisionHint({ text: "Noch ein Satz" }, cards), {
    state: "rejected",
    text: "Lehre abgelehnt von ada",
    decidedAt: 600,
  });
  assert.equal(commentDecisionHint({ text: "Unbekannt" }, cards), null);
  assert.equal(commentDecisionHint(null, cards), null);
  assert.equal(commentDecisionHint({ text: "SQLite" }, null), null);
});

test("decide- und lesson-Argumente bestätigen oder verwerfen exakt", async () => {
  const { decideConfirmArgs, decideRejectArgs, lessonArgs } = await import("../model.js");
  assert.deepEqual(decideConfirmArgs("T-1", "D1"), ["decide", "confirm", "T-1", "D1", "--from=mensch"]);
  assert.deepEqual(decideRejectArgs("T-1", "D1"), ["decide", "reject", "T-1", "D1", "--from=mensch"]);
  assert.deepEqual(decideConfirmArgs("T-1", "D1", "ada"), ["decide", "confirm", "T-1", "D1", "--from=ada"]);
  assert.deepEqual(decideRejectArgs("T-1", "D1", "ada"), ["decide", "reject", "T-1", "D1", "--from=ada"]);
  assert.deepEqual(lessonArgs("T-9", "confirm", "L1"), ["lesson", "confirm", "T-9", "L1", "--from=mensch"]);
  assert.deepEqual(lessonArgs("T-9", "discard", "L1"), ["lesson", "discard", "T-9", "L1", "--from=mensch"]);
  assert.deepEqual(lessonArgs("T-2", "confirm", "L3", "ada"), [
    "lesson", "confirm", "T-2", "L3", "--from=ada",
  ]);
});

test("contextDisplay: normale Zeile, leerer Text und gekürzter Text", async () => {
  const { contextDisplay } = await import("../model.js");
  assert.deepEqual(contextDisplay({ text: "abc", chars: 3, limit: 10, clipped: false }), {
    text: "abc",
    chars: 3,
    limit: 10,
    empty: false,
    clipped: false,
    over: false,
    ratio: 0.3,
    label: "3 von höchstens 10 Zeichen",
  });
  const empty = contextDisplay({ text: "", chars: 0, limit: 10 });
  assert.equal(empty.empty, true);
  assert.equal(empty.label, "0 Zeichen · noch kein Kontext");
  const clipped = contextDisplay({ text: "abc\n\n[…] gekürzt", chars: 20, limit: 20, clipped: true });
  assert.equal(clipped.clipped, true);
  assert.equal(clipped.label, "20 von höchstens 20 Zeichen · gekürzt");
});

test("contextDisplay: „gekürzt“ im Inhalt ist kein Kürzungshinweis", async () => {
  const { contextDisplay } = await import("../model.js");
  const prose = contextDisplay({
    text: "## Steckbrief\n\nBudget wurde gekürzt.",
    chars: 33,
    limit: 6000,
    clipped: false,
  });
  assert.equal(prose.clipped, false);
  assert.equal(prose.label, "33 von höchstens 6000 Zeichen");
  const legacy = contextDisplay({ text: "abc\n\n[…] gekürzt, vollständig in /r/project.md" });
  assert.equal(legacy.clipped, true, "ohne Feld zählt nur der echte Hinweis am Ende");
  const mid = contextDisplay({ text: "Budget wurde gekürzt. Danach folgt Text." });
  assert.equal(mid.clipped, false);
});

test("contextDisplay: Kontext aus, über der Obergrenze und Zeichen aus dem Text", async () => {
  const { contextDisplay } = await import("../model.js");
  const off = contextDisplay({ text: "abc", chars: 3, limit: 0 });
  assert.equal(off.ratio, 0);
  assert.equal(off.label, "3 Zeichen · Kontext ist aus");
  const over = contextDisplay({ text: "x", chars: 25, limit: 20 });
  assert.equal(over.over, true);
  assert.equal(over.ratio, 1);
  assert.equal(over.label, "25 Zeichen · über der Obergrenze von 20");
  const fallback = contextDisplay({ text: "äöü" });
  assert.equal(fallback.chars, 3);
  assert.equal(fallback.limit, 0);
  assert.equal(fallback.label, "3 Zeichen · Kontext ist aus");
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

test("teamSaveArgs hängt eine Briefdatei einmal vor --from=mensch", async () => {
  const { teamSaveArgs } = await import("../model.js");
  const form = {
    name: "herdr-app",
    repos: ["/r/a"],
    members: [{ blueprint: "zap" }, { blueprint: "ada" }],
    reviewer: "ada",
    max_sessions: 4,
  };
  const plan = teamSaveArgs(TEAM, form, { briefFile: "/tmp/b.md" });
  assert.equal(plan.error, undefined);
  assert.equal(plan.args.filter((arg) => arg === "--brief-file=/tmp/b.md").length, 1);
  assert.equal(plan.args.indexOf("--brief-file=/tmp/b.md"), plan.args.indexOf("--from=mensch") - 1);
  assert.equal(plan.args.at(-1), "--from=mensch");
  assert.equal(plan.args.some((arg) => arg.startsWith("--brief-file=")), true);
});

test("teamSaveArgs sendet ohne Briefdatei kein --brief-file", async () => {
  const { teamSaveArgs } = await import("../model.js");
  const form = {
    name: "herdr-app",
    repos: ["/r/a"],
    members: [{ blueprint: "zap" }, { blueprint: "ada" }],
    reviewer: "ada",
    max_sessions: 4,
  };
  for (const options of [undefined, {}, { briefFile: "" }]) {
    const plan = options === undefined ? teamSaveArgs(TEAM, form) : teamSaveArgs(TEAM, form, options);
    assert.equal(plan.error, undefined);
    assert.equal(plan.args.some((arg) => arg.startsWith("--brief-file=")), false);
  }
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

test("teamSaveArgs hängt einen geänderten Namen als --rename direkt an den alten Namen", async () => {
  const { teamSaveArgs } = await import("../model.js");
  const plan = teamSaveArgs(TEAM, {
    name: "  newname  ",
    repos: ["/r/a"],
    members: [{ blueprint: "zap" }, { blueprint: "ada" }],
    reviewer: "ada",
    max_sessions: 4,
  });
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.args.slice(0, 4), ["team", "edit", "herdr-app", "--rename=newname"]);
});

test("teamSaveArgs sendet ohne Namensänderung kein --rename", async () => {
  const { teamSaveArgs } = await import("../model.js");
  const base = {
    repos: ["/r/a"],
    members: [{ blueprint: "zap" }, { blueprint: "ada" }],
    reviewer: "ada",
    max_sessions: 4,
  };
  for (const name of ["herdr-app", "  herdr-app  ", "", "   "]) {
    const plan = teamSaveArgs(TEAM, { ...base, name });
    assert.equal(plan.error, undefined);
    assert.equal(plan.args.some((arg) => arg.startsWith("--rename=")), false, `kein --rename für ${JSON.stringify(name)}`);
  }
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
  assert.equal(teamDirty(TEAM, { ...form, brief: "Neu" }), true);
  assert.equal(teamDirty(TEAM, { ...form, brief: "" }), false);
  assert.equal(teamDirty(TEAM, { ...form, max_sessions: "5" }), true);
  assert.equal(teamDirty(TEAM, { ...form, name: "neu" }), true);
  assert.equal(teamDirty(TEAM, { ...form, name: "  herdr-app  " }), false);
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

// ---------- Änderungen und Abnahme ----------

test("changesGate: ohne Änderungen gesperrt, fremder HEAD gesperrt, gleicher HEAD frei", async () => {
  const { changesGate } = await import("../model.js");
  const head = "0123456789abcdef0123456789abcdef01234567";

  assert.deepEqual(changesGate(null, ""), {
    enabled: false, reason: "Änderungen sind nicht geladen",
  });
  assert.deepEqual(changesGate({}, head), {
    enabled: false, reason: "Änderungen sind nicht geladen",
  });

  const unseen = changesGate({ head }, "");
  assert.equal(unseen.enabled, false);
  assert.match(unseen.reason, /HEAD 0123456/);
  assert.match(unseen.reason, /ansehen/);

  assert.deepEqual(changesGate({ head }, head), { enabled: true, reason: "" });
});

test("changesGate: ein neuer HEAD sperrt wieder", async () => {
  const { changesGate } = await import("../model.js");
  const oldHead = "1111111111111111111111111111111111111111";
  const newHead = "2222222222222222222222222222222222222222";

  assert.equal(changesGate({ head: oldHead }, oldHead).enabled, true);

  const stale = changesGate({ head: newHead }, oldHead);
  assert.equal(stale.enabled, false);
  assert.match(stale.reason, /HEAD 2222222/);
  assert.match(stale.reason, /ansehen/);
});

test("Aktionsleiste: Abnehmen verlangt geladene Änderungen zum selben HEAD", async () => {
  const { actionBar } = await import("../model.js");
  const ticket = { status: "review" };
  const head = "abcdef0123456789abcdef0123456789abcdef01";

  const unloading = actionBar(ticket, []);
  assert.equal(unloading[0].id, "accept");
  assert.equal(unloading[0].disabled, true);
  assert.equal(unloading[0].reason, "Änderungen sind nicht geladen");
  assert.equal(unloading[1].disabled, false, "Zurück bleibt möglich");
  assert.equal(unloading[2].disabled, false, "Verwerfen bleibt möglich");

  const ready = actionBar(ticket, [], { head }, head);
  assert.equal(ready[0].id, "accept");
  assert.equal(ready[0].disabled, false);
  assert.equal(ready[0].reason, "");
  assert.equal(ready[0].kind, "primary");
  assert.equal(ready[0].icon, "check");
  assert.equal(ready[0].confirm, "accept");
  assert.equal(ready[1].disabled, false);
  assert.equal(ready[2].disabled, false);

  const stale = actionBar(ticket, [], { head }, "ffffffffffffffffffffffffffffffffffffffff");
  assert.equal(stale[0].disabled, true);
  assert.match(stale[0].reason, /HEAD abcdef0/);
  assert.match(stale[0].reason, /ansehen/);
  assert.equal(stale[1].disabled, false, "Zurück bleibt auch bei neuem HEAD möglich");
  assert.equal(stale[2].disabled, false);
});

test("diffArgs und diffFileArgs bauen die Kommandozeile", async () => {
  const { diffArgs, diffFileArgs } = await import("../model.js");

  assert.deepEqual(diffArgs("T-29"), ["diff", "T-29", "--json"]);
  assert.deepEqual(diffArgs("T-29", { file: "" }), ["diff", "T-29", "--json"]);
  assert.deepEqual(diffArgs("T-29", { file: "fabric/fab/cli.py" }),
    ["diff", "T-29", "--json", "--file=fabric/fab/cli.py"]);
  assert.deepEqual(diffFileArgs("T-29", "a b/c.py"), ["diff", "T-29", "--file=a b/c.py"]);
});

// ---------- Benachrichtigungen ----------

const localTime = (hour, minute = 0) => new Date(2026, 10, 21, hour, minute).getTime();
const notifyOn = { enabled: true, quiet_from: 22, quiet_to: 8 };

test("Benachrichtigung: ein neuer Inbox-Eintrag feuert genau einmal", async () => {
  const { inboxNotifications, inboxEntryId } = await import("../model.js");
  const inbox = [
    { id: "neu", kind: "review", ticket: "T-2", at: 2000 },
    { id: "alt", kind: "question", ticket: "T-1", at: 1000 },
  ];

  const first = inboxNotifications(inbox, {}, notifyOn, localTime(12));
  assert.deepEqual(first.fresh.map(inboxEntryId), ["alt", "neu"], "ältester zuerst");
  assert.equal(first.changed, true);

  const restart = inboxNotifications(inbox, first.seen, notifyOn, localTime(12, 5));
  assert.deepEqual(restart.fresh, [], "ein Neustart feuert nicht erneut");
  assert.equal(restart.changed, false);

  const grown = inboxNotifications([...inbox, { id: "noch-neuer", kind: "lesson", ticket: "T-3", at: 3000 }],
    first.seen, notifyOn, localTime(12, 10));
  assert.deepEqual(grown.fresh.map(inboxEntryId), ["noch-neuer"]);
  assert.equal(grown.changed, true);
});

test("Benachrichtigung: Ruhezeit unterdrückt und merkt die Einträge als gesehen", async () => {
  const { inboxNotifications } = await import("../model.js");
  const inbox = [{ id: "nacht", kind: "attention", ticket: "T-1", at: 1000 }];

  const night = inboxNotifications(inbox, {}, notifyOn, localTime(23));
  assert.deepEqual(night.fresh, [], "23:00 liegt in der Ruhezeit");
  assert.equal(night.seen.nacht, localTime(23));
  assert.equal(night.changed, true);

  const morning = inboxNotifications(inbox, night.seen, notifyOn, localTime(9));
  assert.deepEqual(morning.fresh, [], "09:00 feuert nicht nachträglich");
  assert.equal(morning.changed, false);

  assert.equal(inboxNotifications(inbox, {}, notifyOn, localTime(8)).fresh.length, 1, "08:00 ist nicht mehr Ruhezeit");
});

test("Benachrichtigung: abgeschaltet unterdrückt und merkt die Einträge als gesehen", async () => {
  const { inboxNotifications } = await import("../model.js");
  const inbox = [{ id: "aus", kind: "review", ticket: "T-1", at: 1000 }];

  const off = inboxNotifications(inbox, {}, { enabled: false }, localTime(12));
  assert.deepEqual(off.fresh, []);
  assert.equal(off.seen.aus, localTime(12));

  const on = inboxNotifications(inbox, off.seen, notifyOn, localTime(12, 5));
  assert.deepEqual(on.fresh, [], "späteres Einschalten feuert nicht rückwirkend");
  assert.equal(on.changed, false);
});

test("Benachrichtigung: Stufe und Klang je Inbox-Art", async () => {
  const { inboxNotifyLevel, inboxNotifySound, INBOX_LEVELS } = await import("../model.js");

  assert.deepEqual(INBOX_LEVELS, {
    question: "warning", review: "info", attention: "error", lesson: "success", decision: "info",
  });
  assert.equal(inboxNotifyLevel("question"), "warning");
  assert.equal(inboxNotifyLevel("review"), "info");
  assert.equal(inboxNotifyLevel("attention"), "error");
  assert.equal(inboxNotifyLevel("lesson"), "success");
  assert.equal(inboxNotifyLevel("unbekannt"), "info");

  assert.equal(inboxNotifySound("attention"), "blocked");
  assert.equal(inboxNotifySound("question"), "done");
  assert.equal(inboxNotifySound("lesson"), "done");
  assert.equal(inboxNotifySound(""), "done");
});

test("Benachrichtigung: inboxEntryId fällt ohne id auf Art, Ticket und Zeit zurück", async () => {
  const { inboxEntryId } = await import("../model.js");

  assert.equal(inboxEntryId({ id: "abc" }), "abc");
  assert.equal(inboxEntryId({ id: "" }), "::");
  assert.equal(inboxEntryId({ kind: "question", ticket: "T-1", at: 1000 }), "question:T-1:1000");
  assert.equal(
    inboxEntryId({ kind: "lesson", ticket: "T-1", at: 1000, proposal: "Regel", agent: "ada" }),
    "lesson:T-1:1000:Regel",
    "der Vorschlag hat Vorrang vor dem Agenten",
  );
  assert.equal(
    inboxEntryId({ kind: "error", ticket: "T-1", at: 1000, agent: "ada" }),
    "error:T-1:1000:ada",
  );
});

// ---------- Kosten und Liegezeiten ----------

test("Kosten werden ab einem Cent zweistellig, kleine Beträge vierstellig gezeigt", () => {
  assert.equal(formatCost(1.234), "$1.23");
  assert.equal(formatCost(0.42), "$0.42");
  assert.equal(formatCost(2), "$2.00");
  assert.equal(formatCost(0.0012), "$0.0012");
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(undefined), "—");
});

test("Dauern auf Deutsch: Minuten, Stunden und die Grenzfälle", () => {
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(30_000), "< 1 min");
  assert.equal(formatDuration(5 * 60_000), "5 min");
  assert.equal(formatDuration(3_600_000 + 5 * 60_000), "1 h 05 min");
  assert.equal(formatDuration(undefined), "—");
});

test("ticketCost füllt fehlende Kostendaten mit 0 und USD", () => {
  assert.deepEqual(ticketCost(undefined), { total: 0, today: 0, currency: "USD" });
  assert.deepEqual(ticketCost({}), { total: 0, today: 0, currency: "USD" });
  assert.deepEqual(ticketCost({ cost: { total: 1.5, today: 0.25, currency: "EUR" } }),
    { total: 1.5, today: 0.25, currency: "EUR" });
});

test("costTotals summiert je Team, heute getrennt, und zählt Limitüberschreitungen", () => {
  const tickets = [
    { id: "T-1", team: "rot", max_cost: 1, cost: { total: 2, today: 0.5 } },
    { id: "T-2", team: "rot", cost: { total: 1, today: 0.25 } },
    { id: "T-3", team: "blau", max_cost: 5, cost: { total: 1, today: 0 } },
    { id: "T-4", cost: { total: 0.5, today: 0.5 } },
  ];
  const totals = costTotals(tickets);

  assert.equal(totals.total, 4.5);
  assert.equal(totals.today, 1.25);
  assert.equal(totals.overLimit, 1);
  assert.deepEqual(totals.teams, [
    { name: "blau", total: 1, today: 0, tickets: 1 },
    { name: "ohne Team", total: 0.5, today: 0.5, tickets: 1 },
    { name: "rot", total: 3, today: 0.75, tickets: 2 },
  ]);
});

// ---------- Workflows: Knotenstatus und Graph-Layout ----------

const BRANCH_FLOW = {
  name: "zweig",
  nodes: [
    { id: "start", type: "trigger", trigger: "manual" },
    { id: "bedingung", type: "condition", expr: "{{start.ok}} == ja" },
    { id: "ja", type: "agent", agent: "zap", title: "Pruefen" },
    { id: "nein", type: "agent", agent: "ada" },
    { id: "ende", type: "end" },
  ],
  edges: [
    { from: "start", to: "bedingung" },
    { from: "bedingung", to: "ja", when: "pass" },
    { from: "bedingung", to: "nein", when: "fail" },
    { from: "ja", to: "ende" },
    { from: "nein", to: "ende" },
  ],
};

const step = (position, node, status, data = {}) => ({
  run: 1, position, node, kind: "agent", status, data, at: position,
});

test("Workflow-Status: genommener Zweig läuft, der andere wird übersprungen", () => {
  const run = {
    id: 1,
    workflow: "zweig",
    status: "running",
    current: "ja",
    steps: [
      step(0, "start", "done"),
      step(1, "bedingung", "pass", { pass: true }),
    ],
  };

  assert.deepEqual(flowNodeStates(BRANCH_FLOW, run), {
    start: "done",
    bedingung: "done",
    ja: "running",
    nein: "skipped",
    ende: "waiting",
  });
});

test("Workflow-Status: Bedingung mit fail ist regulär fertig, der fail-Zweig läuft", () => {
  const run = {
    id: 4,
    workflow: "zweig",
    status: "running",
    current: "nein",
    steps: [
      step(0, "start", "done"),
      step(1, "bedingung", "fail", { pass: false }),
    ],
  };

  assert.deepEqual(flowNodeStates(BRANCH_FLOW, run), {
    start: "done",
    bedingung: "done",
    ja: "skipped",
    nein: "running",
    ende: "waiting",
  });
});

test("Workflow-Status: gescheiterter Lauf markiert den aktuellen Knoten als fehlgeschlagen", () => {
  const ohneSchritt = {
    id: 5,
    workflow: "zweig",
    status: "failed",
    current: "ja",
    reason: "Ticket T-9 fehlt",
    steps: [
      step(0, "start", "done"),
      step(1, "bedingung", "pass", { pass: true }),
    ],
  };
  assert.deepEqual(flowNodeStates(BRANCH_FLOW, ohneSchritt), {
    start: "done",
    bedingung: "done",
    ja: "failed",
    nein: "skipped",
    ende: "skipped",
  });

  const wartend = {
    ...ohneSchritt,
    current: "nein",
    steps: [
      step(0, "start", "done"),
      step(1, "bedingung", "fail", { pass: false }),
      step(2, "nein", "wartet", { ticket: "T-9" }),
    ],
  };
  const states = flowNodeStates(BRANCH_FLOW, wartend);
  assert.equal(states.nein, "failed");
  assert.equal(states.ja, "skipped");
  assert.equal(states.ende, "skipped");
});

test("Workflow-Status: fertiger Lauf überspringt den nicht genommenen Zweig", () => {
  const run = {
    id: 2,
    workflow: "zweig",
    status: "done",
    current: "ende",
    steps: [
      step(0, "start", "done"),
      step(1, "bedingung", "pass", { pass: true }),
      step(2, "ja", "done", { status: "done", ticket: "T-2" }),
      step(3, "ende", "done"),
    ],
  };

  assert.deepEqual(flowNodeStates(BRANCH_FLOW, run), {
    start: "done",
    bedingung: "done",
    ja: "done",
    nein: "skipped",
    ende: "done",
  });
});

test("Workflow-Status: pausierte Freigabe wartet, Zyklen hängen nicht", () => {
  const flow = {
    name: "schleife",
    nodes: [
      { id: "start", type: "trigger", trigger: "manual" },
      { id: "a", type: "approval", text: "Bitte freigeben" },
      { id: "b", type: "action", action: "shell", command: "make" },
      { id: "ende", type: "end" },
    ],
    edges: [
      { from: "start", to: "a" },
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "b", to: "ende" },
    ],
  };
  const run = {
    id: 3,
    status: "paused",
    current: "a",
    steps: [
      step(0, "start", "done"),
      step(1, "a", "wartet", { text: "Bitte freigeben" }),
      step(2, "b", "done", { code: 0 }),
    ],
  };
  const states = flowNodeStates(flow, run);

  assert.equal(states.a, "waiting");
  assert.equal(states.ende, "waiting");
  assert.equal(states.start, "done");
  assert.equal(states.b, "done");

  const running = { ...run, status: "running", current: "a" };
  assert.equal(flowNodeStates(flow, running).a, "waiting");
});

test("Workflow-Layout: Verzweigung in einer Schicht, Ende später, Kanten erhalten", () => {
  const layout = flowLayout(BRANCH_FLOW);
  const at = (id) => layout.nodes.find((node) => node.id === id);

  assert.equal(layout.nodes.length, 5);
  assert.equal(layout.edges.length, BRANCH_FLOW.edges.length);
  assert.equal(at("ja").x, at("nein").x);
  assert.ok(at("ja").y < at("nein").y);
  assert.ok(at("ende").x > at("ja").x);
  assert.deepEqual(layout.nodes.filter((node) => node.x === at("ja").x).map((node) => node.id), ["ja", "nein"]);
  assert.ok(layout.nodes.every((node) => node.x >= 0 && node.y >= 0));
  assert.ok(layout.width >= at("ende").x + at("ende").w);
  assert.ok(layout.height >= at("nein").y + at("nein").h);

  const branchEdge = layout.edges.find((edge) => edge.from === "bedingung" && edge.to === "ja");
  assert.equal(branchEdge.when, "pass");
  assert.equal(branchEdge.back, false);
  assert.equal(branchEdge.x1, at("bedingung").x + at("bedingung").w);
  assert.equal(branchEdge.x2, at("ja").x);
  assert.equal(branchEdge.mid, (branchEdge.x1 + branchEdge.x2) / 2);
  assert.equal(layout.edges.find((edge) => edge.to === "nein").when, "fail");
  assert.equal(layout.edges.find((edge) => edge.from === "start").when, null);

  assert.equal(at("ja").label, "Pruefen");
  assert.equal(at("ja").detail, "zap");
  assert.equal(at("start").label, "manuell");
  assert.equal(at("ende").label, "Ende");

  const empty = flowLayout({ nodes: [], edges: [] });
  assert.equal(empty.nodes.length, 0);
  assert.ok(empty.width > 0 && empty.height > 0);
});

test("Workflow-Layout vertikal: Schichten untereinander, Zweige nebeneinander", () => {
  const layout = flowLayout(BRANCH_FLOW, { vertical: true });
  const at = (id) => layout.nodes.find((node) => node.id === id);

  assert.equal(at("ja").y, at("nein").y);
  assert.ok(at("ja").x < at("nein").x);
  assert.ok(at("ende").y > at("ja").y);
  assert.ok(at("bedingung").y < at("ja").y);
  assert.ok(layout.height >= at("ende").y + at("ende").h);
  assert.ok(layout.width >= at("nein").x + at("nein").w);

  const edge = layout.edges.find((row) => row.from === "bedingung" && row.to === "ja");
  assert.equal(edge.vertical, true);
  assert.equal(edge.x1, at("bedingung").x + at("bedingung").w / 2);
  assert.equal(edge.y1, at("bedingung").y + at("bedingung").h);
  assert.equal(edge.x2, at("ja").x + at("ja").w / 2);
  assert.equal(edge.y2, at("ja").y);
  assert.equal(edge.mid, (edge.y1 + edge.y2) / 2);
});

test("Workflow-Layout vertikal: übersprungene Schicht führt außen an den Karten vorbei", () => {
  const flow = {
    nodes: [
      { id: "start", type: "trigger", trigger: "manual" },
      { id: "a", type: "agent", agent: "zap" },
      { id: "b", type: "agent", agent: "ada" },
      { id: "ende", type: "end" },
    ],
    edges: [
      { from: "start", to: "a" },
      { from: "a", to: "b" },
      { from: "b", to: "ende" },
      { from: "start", to: "ende" },
    ],
  };
  const layout = flowLayout(flow, { vertical: true, gapY: 28 });
  const edge = layout.edges.find((row) => row.from === "start" && row.to === "ende");
  const a = layout.nodes.find((node) => node.id === "a");
  const start = layout.nodes.find((node) => node.id === "start");
  const ende = layout.nodes.find((node) => node.id === "ende");

  assert.equal(edge.skipped, true);
  assert.equal(edge.x1, start.x + start.w + 1, "startet außen am Ausgangsknoten");
  assert.equal(edge.x2, ende.x + ende.w + 1, "endet außen am Zielknoten");
  assert.ok(edge.mid > start.y + start.h && edge.mid < a.y, "Label liegt in der Lücke unter dem Start");
  assert.ok(edge.x1 > a.x + a.w, "die Kante läuft nicht durch die Karte darunter");
});

test("Workflow-Wörter, letzter Schritt und Knotengrund", () => {
  assert.equal(flowStatusWord("waiting"), "wartet");
  assert.equal(flowStatusWord("running"), "läuft");
  assert.equal(flowStatusWord("done"), "fertig");
  assert.equal(flowStatusWord("failed"), "fehlgeschlagen");
  assert.equal(flowStatusWord("skipped"), "übersprungen");
  assert.equal(flowRunWord("running"), "läuft");
  assert.equal(flowRunWord("paused"), "pausiert");
  assert.equal(flowRunWord("done"), "fertig");
  assert.equal(flowRunWord("failed"), "fehlgeschlagen");
  assert.equal(flowRunWord("cancelled"), "abgebrochen");
  assert.equal(flowRunWord("dry"), "trocken");
  assert.equal(flowKindWord("trigger"), "Auslöser");
  assert.equal(flowKindWord("agent"), "Agent");
  assert.equal(flowKindWord("action"), "Aktion");
  assert.equal(flowKindWord("condition"), "Bedingung");
  assert.equal(flowKindWord("approval"), "Freigabe");
  assert.equal(flowKindWord("end"), "Ende");

  const run = {
    steps: [
      step(0, "a", "fail"),
      step(5, "b", "done", { ticket: "T-7" }),
      step(2, "a", "done"),
    ],
  };
  const steps = flowNodeSteps(run);
  assert.equal(steps.a.status, "done");
  assert.equal(steps.b.status, "done");

  assert.equal(flowNodeReason(steps.b), "Ticket T-7");
  assert.equal(flowNodeTicket(steps.b), "T-7");
  assert.equal(flowNodeTicket(steps.a), null);
  assert.equal(flowNodeReason(steps.a), "");
  assert.equal(flowNodeReason({ data: { code: 1 } }), "Code 1");
  assert.equal(flowNodeReason({ data: { ausgabe: "fertig" } }), "fertig");
  assert.equal(flowNodeReason({ data: { text: "Bitte freigeben" } }), "Bitte freigeben");
  assert.equal(flowNodeTicket(undefined), null);
});

test("Workflow-Builder: Knoten anlegen, verbinden und löschen", () => {
  assert.deepEqual(FLOW_NODE_TYPES, ["trigger", "agent", "action", "condition", "approval", "end"]);
  assert.deepEqual(FLOW_TRIGGER_TYPES, ["manual", "cron", "ticket_done", "github_issue", "main_red"]);
  assert.deepEqual(FLOW_ACTION_TYPES, ["shell", "fab", "notify"]);
  assert.deepEqual(flowNodeTemplate("agent", "a"), {
    id: "a", type: "agent", agent: "", title: "", prompt: "",
  });
  assert.deepEqual(flowNodeTemplate("end", "z"), { id: "z", type: "end" });

  let draft = flowNewDefinition("bau");
  assert.deepEqual(Object.keys(draft), ["name", "limits", "nodes", "edges"]);

  let added = flowAddNode(draft, "trigger");
  assert.equal(added.id, "start");
  draft = added.definition;
  added = flowAddNode(draft, "action");
  assert.equal(added.id, "aktion");
  draft = added.definition;
  added = flowAddNode(draft, "end");
  assert.equal(added.id, "ende");
  draft = added.definition;

  assert.deepEqual(draft.nodes.map((node) => [node.id, node.type]), [
    ["start", "trigger"], ["aktion", "action"], ["ende", "end"],
  ]);
  assert.equal(draft.nodes[0].trigger, "manual");
  assert.equal(draft.nodes[1].action, "shell");
  assert.equal(draft.nodes[1].command, "");
  assert.equal(flowNodeId(draft, "action"), "aktion2");
  assert.equal(flowNodeId(draft, "trigger"), "start2");

  added = flowConnect(draft, "start", "aktion");
  assert.equal(added.index, 0);
  draft = added.definition;
  added = flowConnect(draft, "aktion", "ende");
  assert.equal(added.index, 1);
  draft = added.definition;
  assert.deepEqual(draft.edges, [
    { from: "start", to: "aktion" },
    { from: "aktion", to: "ende", when: "pass" },
  ]);
  assert.deepEqual(flowOutgoing(draft, "aktion").map((entry) => entry.index), [1]);

  assert.equal(flowConnect(draft, "start", "fehlt").index, -1);
  assert.equal(flowConnect(draft, "start", "start").index, -1);
  assert.equal(flowConnect(draft, "start", "aktion").index, 0);

  draft = flowRemoveEdge(draft, 1);
  assert.deepEqual(draft.edges, [{ from: "start", to: "aktion" }]);

  draft = flowRemoveNode(draft, "aktion");
  assert.deepEqual(draft.nodes.map((node) => node.id), ["start", "ende"]);
  assert.deepEqual(draft.edges, []);

  // Freigabetext gehört zum Knoten und darf beim Patchen nicht als
  // Aktionsfeld aufgeräumt werden; Aktionen räumen nur ihre eigenen Felder.
  draft = flowAddNode(draft, "approval").definition;
  draft = flowPatchNode(draft, "freigabe", { text: "Bitte freigeben" });
  draft = flowPatchNode(draft, "freigabe", { text: "Bitte freigeben!" });
  assert.equal(draft.nodes.find((node) => node.id === "freigabe").text, "Bitte freigeben!");
  const notify = flowAddNode(draft, "action").definition;
  const switched = flowPatchNode(notify, "aktion", { action: "notify", text: "Meldung" });
  assert.equal(switched.nodes.find((node) => node.id === "aktion").command, undefined);
  assert.equal(switched.nodes.find((node) => node.id === "aktion").text, "Meldung");
});

test("Workflow-Prüfung: Zyklus verlangt ein Schleifenlimit", () => {
  let draft = flowNewDefinition("schleife");
  draft = flowAddNode(draft, "trigger").definition;
  draft = flowAddNode(draft, "action").definition;
  draft = flowAddNode(draft, "action").definition;
  draft = flowAddNode(draft, "end").definition;
  draft = flowPatchNode(draft, "aktion", { command: "echo eins" });
  draft = flowPatchNode(draft, "aktion2", { command: "echo zwei" });
  draft = flowConnect(draft, "start", "aktion").definition;
  draft = flowConnect(draft, "aktion", "aktion2").definition;
  draft = flowConnect(draft, "aktion2", "ende").definition;
  const back = flowConnect(draft, "aktion2", "aktion");
  draft = back.definition;

  assert.equal(back.index, 3);
  assert.equal(draft.edges[3].when, "fail");

  let result = flowValidate(draft);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("Zyklus ohne Schleifenlimit")), true);

  draft = flowPatchEdge(draft, back.index, { max_loops: "3" });
  assert.equal(draft.edges[back.index].max_loops, 3);
  result = flowValidate(draft);
  assert.equal(result.errors.some((error) => error.includes("Zyklus ohne Schleifenlimit")), false);
  assert.equal(result.ok, true);
});

test("Workflow-Prüfung: Pflichtfelder von Aktion und Bedingung", () => {
  let draft = flowNewDefinition("pflicht");
  draft = flowAddNode(draft, "trigger").definition;
  draft = flowAddNode(draft, "action").definition;
  draft = flowAddNode(draft, "condition").definition;
  draft = flowAddNode(draft, "end").definition;
  draft = flowConnect(draft, "start", "aktion").definition;
  draft = flowConnect(draft, "aktion", "bedingung").definition;
  draft = flowConnect(draft, "bedingung", "ende").definition;

  const result = flowValidate(draft);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("braucht einen Befehl")), true);
  assert.equal(result.errors.some((error) => error.includes("braucht einen Ausdruck")), true);
});

test("Workflow-Prüfung: Auslöser und Ende sind Pflicht", () => {
  let missingTrigger = flowNewDefinition("ohne-ausloeser");
  missingTrigger = flowAddNode(missingTrigger, "agent").definition;
  missingTrigger = flowAddNode(missingTrigger, "end").definition;
  missingTrigger = flowConnect(missingTrigger, "agent", "ende").definition;
  let result = flowValidate(missingTrigger);
  assert.equal(result.errors.some((error) => error.includes("Auslöser fehlt")), true);

  let missingEnd = flowNewDefinition("ohne-ende");
  missingEnd = flowAddNode(missingEnd, "trigger").definition;
  missingEnd = flowAddNode(missingEnd, "agent").definition;
  missingEnd = flowConnect(missingEnd, "start", "agent").definition;
  result = flowValidate(missingEnd);
  assert.equal(result.errors.some((error) => error.includes("Ende fehlt")), true);
});

test("Workflow-Rundreise: kanonisch serialisieren und verlustfrei laden", () => {
  let draft = flowNewDefinition("rundreise");
  draft = flowAddNode(draft, "trigger").definition;
  draft = flowAddNode(draft, "agent").definition;
  draft = flowAddNode(draft, "action").definition;
  draft = flowAddNode(draft, "condition").definition;
  draft = flowAddNode(draft, "end").definition;
  draft = flowPatchNode(draft, "start", { trigger: "cron", every_minutes: "15" });
  draft = flowPatchNode(draft, "agent", { agent: "ada", title: "Prüfen", prompt: "Bitte prüfen" });
  draft = flowPatchNode(draft, "aktion", { command: "echo fertig" });
  draft = flowPatchNode(draft, "bedingung", { expr: "{{agent.status}} == done" });
  draft = flowConnect(draft, "start", "agent").definition;
  draft = flowConnect(draft, "agent", "aktion").definition;
  draft = flowConnect(draft, "aktion", "bedingung").definition;
  draft = flowConnect(draft, "bedingung", "ende").definition;

  assert.deepEqual(flowValidate(draft), { ok: true, errors: [] });
  assert.equal(draft.edges.find((edge) => edge.from === "agent").when, "done");

  const json = flowSerialize(draft);
  assert.equal(json.endsWith("\n"), true);
  const loaded = flowParse(json);
  assert.deepEqual(loaded, flowLoad(draft));
  assert.equal(flowSerialize(loaded), json);
  assert.equal(flowSerialize(flowLoad(json)), json);

  assert.deepEqual(Object.keys(draft), ["name", "limits", "nodes", "edges"]);
  assert.deepEqual(Object.keys(flowNewDefinition("neu")), ["name", "limits", "nodes", "edges"]);
  assert.equal("updated_at" in loaded, false);
  assert.equal(loaded.name, "rundreise");
  assert.equal(loaded.nodes[0].every_minutes, "15");
});

test("Workflow-Platzhalter: nur vorgelagerte Knoten und deren Felder", () => {
  let draft = flowNewDefinition("platzhalter");
  draft = flowAddNode(draft, "trigger").definition;
  draft = flowAddNode(draft, "agent").definition;
  draft = flowAddNode(draft, "action").definition;
  draft = flowAddNode(draft, "condition").definition;
  draft = flowAddNode(draft, "end").definition;

  assert.deepEqual(flowPlaceholders(draft, "start"), []);
  const actionFields = flowPlaceholders(draft, "aktion").map((item) => item.text);
  assert.equal(actionFields.includes("{{agent.status}}"), true);
  assert.equal(actionFields.includes("{{agent.zusammenfassung}}"), true);
  assert.equal(actionFields.includes("{{agent.ticket}}"), true);
  assert.equal(actionFields.includes("{{aktion.code}}"), false);
  assert.equal(actionFields.includes("{{start.trigger}}"), false);

  const conditionFields = flowPlaceholders(draft, "bedingung").map((item) => item.text);
  assert.equal(conditionFields.includes("{{aktion.code}}"), true);
  assert.equal(conditionFields.includes("{{aktion.ausgabe}}"), true);
  assert.equal(conditionFields.includes("{{aktion.fehler}}"), true);
  assert.equal(conditionFields.includes("{{agent.status}}"), true);

  const all = flowPlaceholders(draft, "fehlt").map((item) => item.text);
  assert.equal(all.includes("{{agent.status}}"), true);
  assert.equal(all.includes("{{aktion.code}}"), true);
  assert.equal(all.includes("{{bedingung.pass}}"), true);
  assert.deepEqual(flowPlaceholders(draft, "aktion").filter((item) => item.node === "aktion"), []);
});

test("Workflow-Kanten: Ausgänge und Vorgaben", () => {
  let draft = flowNewDefinition("kanten");
  draft = flowAddNode(draft, "trigger").definition;
  draft = flowAddNode(draft, "agent").definition;
  draft = flowAddNode(draft, "action").definition;
  draft = flowAddNode(draft, "condition").definition;
  draft = flowAddNode(draft, "end").definition;

  assert.deepEqual(flowEdgeWhenOptions(draft, "start"), []);
  assert.deepEqual(flowEdgeWhenOptions(draft, "bedingung"), ["pass", "fail"]);
  assert.deepEqual(flowEdgeWhenOptions(draft, "aktion"), ["pass", "fail"]);
  assert.deepEqual(flowEdgeWhenOptions(draft, "agent"), ["done", "dropped"]);
  assert.deepEqual(flowEdgeWhenOptions(draft, "ende"), []);
  assert.deepEqual(flowEdgeWhenOptions(draft, "fehlt"), []);

  draft = flowConnect(draft, "bedingung", "ende").definition;
  draft = flowConnect(draft, "bedingung", "agent").definition;
  draft = flowConnect(draft, "aktion", "ende").definition;
  draft = flowConnect(draft, "aktion", "agent").definition;
  draft = flowConnect(draft, "agent", "ende").definition;
  draft = flowConnect(draft, "agent", "aktion").definition;
  draft = flowConnect(draft, "start", "ende").definition;

  const when = (from, to) => draft.edges.find((edge) => edge.from === from && edge.to === to)?.when;
  assert.equal(when("bedingung", "ende"), "pass");
  assert.equal(when("bedingung", "agent"), "fail");
  assert.equal(when("aktion", "ende"), "pass");
  assert.equal(when("aktion", "agent"), "fail");
  assert.equal(when("agent", "ende"), "done");
  assert.equal(when("agent", "aktion"), "dropped");
  assert.equal(when("start", "ende"), undefined);
  assert.equal("when" in draft.edges.find((edge) => edge.from === "start"), false);

  draft = flowAddNode(draft, "end").definition;
  draft = flowConnect(draft, "bedingung", "ende2").definition;
  const third = draft.edges.find((edge) => edge.from === "bedingung" && edge.to === "ende2");
  assert.equal("when" in third, false);
});

test("Workflow-Laden: Eingabe bleibt unverändert, unbekannte Felder bleiben", () => {
  const input = {
    name: "geladen",
    repo: "herdr",
    updated_at: 1234,
    limits: { max_cost: 5 },
    nodes: [
      { id: "start", type: "trigger", trigger: "manual", template: "standard" },
      { id: "ende", type: "end", note: "ziel" },
    ],
    edges: [{ from: "start", to: "ende", label: "geradeaus" }],
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  const loaded = flowLoad(input);

  assert.deepEqual(input, snapshot);
  assert.equal(loaded.name, "geladen");
  assert.equal(loaded.repo, "herdr");
  assert.equal("updated_at" in loaded, false);
  assert.deepEqual(loaded.limits, { max_cost: 5 });
  assert.equal(loaded.nodes[0].template, "standard");
  assert.equal(loaded.nodes[1].note, "ziel");
  assert.equal(loaded.edges[0].label, "geradeaus");

  loaded.nodes[0].trigger = "cron";
  assert.equal(input.nodes[0].trigger, "manual");

  const fromText = flowLoad(JSON.stringify(input));
  assert.deepEqual(fromText, flowLoad(input));
  assert.equal("updated_at" in fromText, false);
});

// ---------- Autopilot ----------

const autopilotNow = new Date(2026, 10, 22, 12, 0, 0).getTime();

const autopilotStatus = (patch = {}) => ({
  state: "running",
  reason: "",
  end: "2026-11-22T08:00",
  updated_at: autopilotNow,
  last_action: "T-65 angenommen",
  log: "/tmp/autopilot.log",
  pid: 4711,
  ...patch,
});

test("Autopilot-Lampe: laufend mit Endzeit", () => {
  const lamp = autopilotLamp(autopilotStatus({ end: "2026-11-22T08:00" }), autopilotNow);

  assert.deepEqual(lamp, {
    state: "running",
    color: "done",
    text: "Autopilot an · bis 08:00",
    pulse: true,
  });

  const shortEnd = autopilotLamp(autopilotStatus({ end: "07:45" }), autopilotNow);
  assert.equal(shortEnd.text, "Autopilot an · bis 07:45");
  assert.equal(shortEnd.state, "running");

  const noEnd = autopilotLamp(autopilotStatus({ end: "" }), autopilotNow);
  assert.equal(noEnd.text, "Autopilot an · bis alles fertig");
  assert.equal(noEnd.pulse, true);
});

test("Autopilot-Lampe: pausiert nennt den Grund", () => {
  const lamp = autopilotLamp(
    autopilotStatus({ state: "paused", reason: "kein Budget mehr" }),
    autopilotNow,
  );

  assert.equal(lamp.state, "paused");
  assert.equal(lamp.color, "working");
  assert.equal(lamp.pulse, false);
  assert.match(lamp.text, /Autopilot pausiert/);
  assert.match(lamp.text, /kein Budget mehr/);

  const withoutReason = autopilotLamp(autopilotStatus({ state: "paused", reason: "" }), autopilotNow);
  assert.equal(withoutReason.text, "Autopilot pausiert");
});

test("Autopilot-Lampe: aus bei gestoppt, fehlender Datei, kaputtem JSON und fehlendem Zustand", () => {
  const expected = { state: "stopped", color: "dim", text: "Autopilot aus", pulse: false };

  assert.deepEqual(autopilotLamp(autopilotStatus({ state: "stopped" }), autopilotNow), expected);
  assert.deepEqual(autopilotLamp(null, autopilotNow), expected);
  assert.deepEqual(autopilotLamp("{kaputt", autopilotNow), expected);
  assert.deepEqual(autopilotLamp("{}", autopilotNow), expected);
  assert.deepEqual(autopilotLamp({ state: "unbekannt" }, autopilotNow), expected);
  assert.deepEqual(autopilotLamp(42, autopilotNow), expected);
  assert.deepEqual(autopilotLamp([], autopilotNow), expected);
});

test("Autopilot-Lampe: veraltet nach sechs Minuten, nicht bei 5:59", () => {
  const stale = { state: "stale", color: "dim", text: "Autopilot reagiert nicht", pulse: false };
  const old = autopilotNow - (AUTOPILOT_STALE_MS + 1000);

  assert.deepEqual(autopilotLamp(autopilotStatus({ updated_at: old }), autopilotNow), stale);
  assert.deepEqual(
    autopilotLamp(autopilotStatus({ state: "paused", reason: "Pause", updated_at: old }), autopilotNow),
    stale,
  );

  const fresh = autopilotNow - (AUTOPILOT_STALE_MS - 1000);
  assert.equal(autopilotLamp(autopilotStatus({ updated_at: fresh }), autopilotNow).state, "running");
  assert.equal(autopilotLamp(autopilotStatus({ updated_at: fresh }), autopilotNow).pulse, true);

  for (const updated_at of [undefined, null, "keine Zahl"]) {
    assert.deepEqual(
      autopilotLamp(autopilotStatus({ updated_at }), autopilotNow),
      stale,
    );
  }
});

test("Autopilot-Logzeilen: letzte Zeilen, Umbruch am Ende zählt nicht", () => {
  assert.deepEqual(autopilotLogLines(""), []);
  assert.deepEqual(autopilotLogLines(null), []);
  assert.deepEqual(autopilotLogLines("eine\n"), ["eine"]);
  assert.deepEqual(autopilotLogLines("eine\nzwei"), ["eine", "zwei"]);
  assert.deepEqual(autopilotLogLines("a\nb\nc", 2), ["b", "c"]);
  assert.deepEqual(autopilotLogLines("a\nb\nc", 0), []);
});

test("Autopilot-Popover: letzte 20 von 30 Zeilen und Kopfdaten", () => {
  const lines = Array.from({ length: 30 }, (_, index) => `Zeile ${index + 1}`);
  const popover = autopilotPopover(autopilotStatus(), `${lines.join("\n")}\n`, autopilotNow);

  assert.equal(popover.lastAction, "T-65 angenommen");
  assert.equal(popover.endLabel, "bis 08:00");
  assert.equal(popover.logPath, "/tmp/autopilot.log");
  assert.equal(popover.lines.length, 20);
  assert.deepEqual(popover.lines, lines.slice(-20));
  assert.equal(popover.lines[0], "Zeile 11");
  assert.equal(popover.lines[19], "Zeile 30");
  assert.deepEqual(popover.lamp, {
    state: "running",
    color: "done",
    text: "Autopilot an · bis 08:00",
    pulse: true,
  });

  const bare = autopilotPopover({ state: "stopped" }, "");
  assert.equal(bare.lastAction, "");
  assert.equal(bare.endLabel, "");
  assert.equal(bare.logPath, "");
  assert.deepEqual(bare.lines, []);
  assert.equal(bare.lamp.state, "stopped");

  const open = autopilotPopover(autopilotStatus({ end: "" }), "", autopilotNow);
  assert.equal(open.endLabel, "bis alles fertig");

  const paused = autopilotPopover(
    autopilotStatus({ state: "paused", reason: "Budget" }), "", autopilotNow,
  );
  assert.equal(paused.endLabel, "bis 08:00");
});

test("Autopilot-Aktionen: Starten, Pause aufheben und Stoppen je Zustand", () => {
  assert.deepEqual(autopilotActions(autopilotLamp(autopilotStatus(), autopilotNow)), {
    start: false, resume: false, stop: true,
  });
  assert.deepEqual(autopilotActions(autopilotLamp(
    autopilotStatus({ state: "paused", reason: "rot" }), autopilotNow,
  )), { start: false, resume: true, stop: true });
  assert.deepEqual(autopilotActions(autopilotLamp(
    autopilotStatus({ state: "stopped" }), autopilotNow,
  )), { start: true, resume: false, stop: false });
  assert.deepEqual(autopilotActions(autopilotLamp(
    autopilotStatus({ updated_at: autopilotNow - (AUTOPILOT_STALE_MS + 1000) }), autopilotNow,
  )), { start: true, resume: false, stop: false });
  assert.deepEqual(autopilotActions(null), { start: true, resume: false, stop: false });
  assert.deepEqual(autopilotActions({ state: "unbekannt" }), { start: false, resume: false, stop: false });
});

test("Tick ist jede Minute fällig, auch ohne offenes Fabric-Fenster", () => {
  assert.equal(TICK_INTERVAL_MS, 60000);
  assert.equal(tickDue(undefined, 1000), true);
  assert.equal(tickDue(null, 1000), true);
  assert.equal(tickDue(0, 1000), true);
  assert.equal(tickDue("kaputt", 1000), true);
  assert.equal(tickDue(1000, 1000), false);
  assert.equal(tickDue(1000, 1000 + TICK_INTERVAL_MS - 1), false);
  assert.equal(tickDue(1000, 1000 + TICK_INTERVAL_MS), true);
  assert.equal(tickDue(5000, 1000), false);
});

test("Pipeline-Zustände werden abgeleitet, benannt und gezählt", () => {
  assert.equal(pipelineState({ state: "PASS" }), "pass");
  assert.equal(pipelineState({ state: " fail " }), "fail");
  assert.equal(pipelineState({ state: "running" }), "running");
  assert.equal(pipelineState({ state: "queued" }), "queued");
  assert.equal(pipelineState({ state: "QUEUED" }), "queued");
  assert.equal(pipelineState({ state: " skipped " }), "skipped");
  assert.equal(pipelineState({ state: "pending" }), "pending");
  assert.equal(pipelineState({ state: null }), "pending");
  assert.equal(pipelineState({ state: "kaputt" }), "pending");
  assert.equal(pipelineState(null), "pending");

  assert.equal(pipelineStateWord("pass"), "grün");
  assert.equal(pipelineStateWord("fail"), "rot");
  assert.equal(pipelineStateWord("running"), "läuft");
  assert.equal(pipelineStateWord("queued"), "Warteschlange");
  assert.equal(pipelineStateWord("skipped"), "übersprungen");
  assert.equal(pipelineStateWord("pending"), "wartet");
  assert.equal(pipelineStateWord("kaputt"), "wartet");

  assert.equal(pipelineTriggerWord("verify"), "Prüfung");
  assert.equal(pipelineTriggerWord("repo-test"), "Repo-Test");
  assert.equal(pipelineTriggerWord("unbekannt"), "unbekannt");
  assert.equal(pipelineTriggerWord(""), "—");

  const steps = [{ state: "pass" }, { state: "fail" }, { state: "skipped" }, { state: "skipped" }];
  assert.deepEqual(pipelineStepSummary(steps), {
    total: 4, pass: 1, fail: 1, running: 0, pending: 0, skipped: 2,
  });

  // Ein gescheiterter Lauf trägt seinen eigenen Zustand; die Schritte danach
  // sind nur noch übersprungen.
  const failedRun = { id: 7, ticket: "T-7", state: "fail", steps };
  assert.equal(pipelineState(failedRun), "fail");
  assert.equal(pipelineStateWord(pipelineState(failedRun)), "rot");

  assert.equal(pipelineDuration(undefined), "—");
  assert.equal(pipelineDuration(null), "—");
  assert.equal(pipelineDuration(-1), "—");
  assert.equal(pipelineDuration(999), "< 1 s");
  assert.equal(pipelineDuration(2400), "2,4 s");
  assert.equal(pipelineDuration(12345), "12 s");
  assert.equal(pipelineDuration(60000), "1 min");
  assert.equal(pipelineRunTarget({ ticket: "T-7", head: "abcdef123456" }), "T-7");
  assert.equal(pipelineRunTarget({ ticket: "", head: "abcdef123456" }), "abcdef12");
  assert.equal(pipelineRunTarget({}), "—");
});

test("Pipeline klappt den ersten gescheiterten oder laufenden Schritt auf", () => {
  const steps = [
    { position: 0, state: "pass" },
    { position: 1, state: "fail" },
    { position: 2, state: "skipped" },
  ];
  assert.equal(pipelineAutoStep(steps), steps[1]);
  assert.deepEqual(pipelineOpenSteps(steps), { 1: true });

  // Ohne Fehler zählt der laufende Schritt, nicht der übersprungene.
  const runningSteps = [
    { position: 3, state: "skipped" },
    { position: 4, state: "running" },
  ];
  assert.equal(pipelineAutoStep(runningSteps), runningSteps[1]);
  assert.deepEqual(pipelineOpenSteps(runningSteps), { 4: true });

  const allPass = [{ position: 0, state: "pass" }, { position: 1, state: "pass" }];
  assert.equal(pipelineAutoStep(allPass), null);
  assert.deepEqual(pipelineOpenSteps(allPass), {});

  const onlySkipped = [{ position: 5, state: "skipped" }];
  assert.equal(pipelineAutoStep(onlySkipped), null);
  assert.deepEqual(pipelineOpenSteps(onlySkipped), {});
});

test("Pipeline-Logsuche findet Zeilen unabhängig von der Schreibweise", () => {
  const step = { stdout: "Prüfung ok\nzweite Zeile", stderr: "Fehler: rot" };
  const lines = pipelineLogLines(step);

  assert.deepEqual(lines, [
    { stream: "stdout", text: "Prüfung ok" },
    { stream: "stdout", text: "zweite Zeile" },
    { stream: "stderr", text: "Fehler: rot" },
  ]);

  const hit = pipelineLogSearch(lines, "zeile");
  assert.equal(hit.total, 3);
  assert.equal(hit.count, 1);
  assert.deepEqual(hit.lines, [{ stream: "stdout", text: "zweite Zeile" }]);

  const miss = pipelineLogSearch(lines, "gibt-es-nicht");
  assert.equal(miss.count, 0);
  assert.deepEqual(miss.lines, []);

  assert.deepEqual(pipelineLogSearch(lines, "   ").lines, lines);
  assert.deepEqual(pipelineLogLines(null), []);
});

test("Pipeline-Badge zeigt den jüngsten Lauf des Tickets", () => {
  const runs = [
    { id: 1, ticket: "T-1", state: "fail" },
    { id: 3, ticket: "T-1", state: "pass" },
    { id: 2, ticket: "T-2", state: "running" },
  ];
  assert.deepEqual(pipelineRunsNewest(runs).map((run) => run.id), [3, 2, 1]);
  assert.deepEqual(runs.map((run) => run.id), [1, 3, 2]);

  assert.equal(pipelineLastRun(runs, "T-1").id, 3);
  const badge = pipelineBadge(runs, "T-1");
  assert.equal(badge.run.id, 3);
  assert.equal(badge.state, "pass");
  assert.equal(badge.word, "grün");

  assert.equal(pipelineLastRun(runs, "T-9"), null);
  assert.equal(pipelineBadge(runs, "T-9"), null);
  assert.equal(pipelineBadge([], "T-1"), null);
});

// ---------- Alarme ----------

const alarmFixture = () => ({
  active: true,
  count: 3,
  alarms: [
    {
      id: "main:42", kind: "main", at: 1764000000000, since: 1764000000000, ticket: "T-70", run: 42,
      step: "node --test mods/fabric", reverted: true, paused: true, reason: "",
      text: "main rot seit 12:51 – T-70 zurückgenommen – Schritt node --test mods/fabric fehlgeschlagen",
      actions: ["run", "ticket", "resume", "ack"],
    },
    {
      id: "pause:1764000000000", kind: "pause", at: 1764000000000, since: 1764000000000, ticket: "", run: null,
      step: "", reverted: false, paused: true, reason: "main nach Merge rot – Abnahmen pausiert",
      text: "Autopilot pausiert seit 12:51 – main nach Merge rot – Abnahmen pausiert",
      actions: ["resume", "ack"],
    },
    {
      id: "tick:1764000000000", kind: "tick", at: 1764000060000, since: 1764000000000, ticket: "", run: null,
      step: "", reverted: false, paused: false, reason: "",
      text: "fab tick seit 2 h nicht gelaufen – Stillstands-Wächter prüfen",
      actions: ["ack"],
    },
  ],
});

const alarmButtonList = (entry) => entry.buttons.map((button) => `${button.key}:${button.label}`);

test("Alarm-Einträge: Bannertext und Knöpfe je Art, kein Schließen", () => {
  const index = { alarm: alarmFixture() };
  const entries = alarmEntries(index);

  assert.equal(entries.length, 3);
  assert.equal(entries[0].kind, "main");
  assert.match(entries[0].text, /main rot seit 12:51/);
  assert.match(entries[0].text, /T-70/);
  assert.match(entries[0].text, /zurückgenommen/);
  assert.match(entries[0].text, /node --test mods\/fabric/);
  assert.deepEqual(alarmButtonList(entries[0]), [
    "run:Lauf ansehen",
    "ticket:Ticket öffnen",
    "resume:Pause aufheben",
    "ack:Quittieren",
  ]);

  assert.equal(entries[1].kind, "pause");
  assert.match(entries[1].text, /Autopilot pausiert/);
  assert.deepEqual(alarmButtonList(entries[1]), ["resume:Pause aufheben", "ack:Quittieren"]);

  assert.equal(entries[2].kind, "tick");
  assert.match(entries[2].text, /fab tick/);
  assert.deepEqual(alarmButtonList(entries[2]), ["ack:Quittieren"]);

  for (const entry of entries) {
    assert.equal(entry.buttons.some((button) => button.key === "close"), false);
    assert.equal(entry.buttons.some((button) => /schließen/i.test(button.label)), false);
  }
});

test("Alarm-Einträge: ungültige Einträge und Duplikate fallen weg, ack steht zuletzt", () => {
  const raw = {
    alarm: {
      active: true,
      alarms: [
        { id: "", kind: "main", text: "ohne id", actions: ["ack"] },
        { id: 7, kind: "main", text: "id keine Zeichenkette", actions: ["ack"] },
        { id: "x", kind: "unbekannt", text: "unbekannte Art", actions: ["ack"] },
        null,
        "kaputt",
        { id: "doppelt", kind: "main", text: "erster", actions: ["ack", "close", "run"] },
        { id: "doppelt", kind: "tick", text: "zweiter", actions: ["ack"] },
        { id: "reihe", kind: "tick", text: "Reihenfolge", actions: ["ack", "unbekannt", "resume", "run"] },
      ],
    },
  };
  const entries = alarmEntries(raw);

  assert.deepEqual(entries.map((entry) => entry.id), ["doppelt", "reihe"]);
  assert.equal(entries[0].text, "erster");
  assert.deepEqual(entries[0].buttons, [
    { key: "run", label: "Lauf ansehen" },
    { key: "ack", label: "Quittieren" },
  ]);
  assert.deepEqual(alarmButtonList(entries[1]), [
    "resume:Pause aufheben",
    "run:Lauf ansehen",
    "ack:Quittieren",
  ]);

  assert.deepEqual(alarmEntries(null), []);
  assert.deepEqual(alarmEntries({}), []);
  assert.deepEqual(alarmEntries(indexOnlyWithoutAlarms()), []);
  assert.equal(alarmActive(raw), true);
  assert.equal(alarmActive({ alarm: { active: false, alarms: [] } }), false);
});

function indexOnlyWithoutAlarms() {
  return { tickets: [], alarm: null };
}

test("Alarm-Lampe: aktiver Alarm vor jedem Autopilot-Status", () => {
  const alarm = alarmFixture();
  const expected = { state: "alarm", color: "blocked", text: alarm.alarms[0].text, pulse: false };

  assert.deepEqual(autopilotLamp(autopilotStatus(), autopilotNow, alarm), expected);
  assert.deepEqual(autopilotLamp(autopilotStatus({ state: "stopped" }), autopilotNow, alarm), expected);
  assert.deepEqual(autopilotLamp(null, autopilotNow, alarm), expected);
  assert.deepEqual(autopilotLamp("{kaputt", autopilotNow, alarm), expected);

  const fallback = { id: "main:1", kind: "main", text: "", actions: ["ack"] };
  assert.deepEqual(
    autopilotLamp(autopilotStatus(), autopilotNow, { alarms: [fallback] }),
    { state: "alarm", color: "blocked", text: "Alarm", pulse: false },
  );

  const inactive = { active: false, alarms: [] };
  assert.deepEqual(autopilotLamp(autopilotStatus(), autopilotNow, inactive), {
    state: "running", color: "done", text: "Autopilot an · bis 08:00", pulse: true,
  });
  assert.deepEqual(autopilotLamp(null, autopilotNow, inactive), {
    state: "stopped", color: "dim", text: "Autopilot aus", pulse: false,
  });
  assert.deepEqual(autopilotLamp(autopilotStatus(), autopilotNow, null), {
    state: "running", color: "done", text: "Autopilot an · bis 08:00", pulse: true,
  });
});

test("Alarm-Aktionen: Start gesperrt, Fortsetzen und Stoppen aus Pause", () => {
  const alarm = alarmFixture();
  const lamp = autopilotLamp(autopilotStatus(), autopilotNow, alarm);

  assert.deepEqual(autopilotActions(lamp, alarm), { start: false, resume: true, stop: true });
  assert.deepEqual(autopilotActions({ state: "alarm" }, alarm), { start: false, resume: true, stop: true });

  const mainOnly = { alarms: [alarm.alarms[0]] };
  assert.deepEqual(autopilotActions({ state: "alarm" }, mainOnly), { start: false, resume: true, stop: true });
  assert.deepEqual(autopilotActions({ state: "stopped" }, { alarms: [alarm.alarms[2]] }), {
    start: false, resume: false, stop: false,
  });
  assert.deepEqual(autopilotActions({ state: "running" }, { alarms: [alarm.alarms[2]] }), {
    start: false, resume: false, stop: true,
  });

  assert.deepEqual(autopilotActions({ state: "running" }), { start: false, resume: false, stop: true });
  assert.deepEqual(autopilotActions({ state: "stopped" }), { start: true, resume: false, stop: false });
});

test("Alarm-Toast: eine Alarm-Inbox-Zeile feuert genau einmal", () => {
  const inbox = [{
    id: "attention:main:42", kind: "attention", ticket: "", at: 1764000000000,
    text: "main rot seit 12:51 – T-70 zurückgenommen – Schritt node --test mods/fabric fehlgeschlagen",
  }];
  const settings = { enabled: true, quiet_from: 22, quiet_to: 8 };
  const local = new Date(2026, 10, 24, 12, 51, 0).getTime();

  const first = inboxNotifications(inbox, {}, settings, local);
  assert.equal(first.fresh.length, 1);
  assert.equal(first.fresh[0].id, "attention:main:42");
  assert.equal(inboxNotifyLevel(first.fresh[0].kind), "error");
  assert.equal(inboxNotifySound(first.fresh[0].kind), "blocked");

  const second = inboxNotifications(inbox, first.seen, settings, local + 60000);
  assert.equal(second.fresh.length, 0);
  assert.equal(second.changed, false);
});

test("Wissensordner: Argumente für add, note und rm", () => {
  assert.deepEqual(
    knowledgeAddArgs("/repo", "/tmp/plan.pdf"),
    ["knowledge", "add", "/repo", "/tmp/plan.pdf", "--from=mensch"],
  );
  assert.deepEqual(
    knowledgeAddArgs("/repo", "/tmp/plan.pdf", { name: "plan.pdf", force: true }),
    ["knowledge", "add", "/repo", "/tmp/plan.pdf", "--name=plan.pdf", "--force", "--from=mensch"],
  );
  assert.deepEqual(
    knowledgeAddArgs("/repo", "/tmp/a.png", { name: "bild", from: "agent" }),
    ["knowledge", "add", "/repo", "/tmp/a.png", "--name=bild", "--from=agent"],
  );

  const text = "- erster Punkt\nzweiter Punkt";
  assert.deepEqual(
    knowledgeNoteArgs("/repo", "ideen", text),
    ["knowledge", "note", "/repo", "ideen", `--text=${text}`, "--from=mensch"],
  );
  assert.deepEqual(
    knowledgeNoteArgs("/repo", "ideen", text, "agent"),
    ["knowledge", "note", "/repo", "ideen", `--text=${text}`, "--from=agent"],
  );

  assert.deepEqual(
    knowledgeRemoveArgs("/repo", "ideen"),
    ["knowledge", "rm", "/repo", "ideen", "--from=mensch"],
  );
  assert.deepEqual(
    knowledgeRemoveArgs("/repo", "ideen", "agent"),
    ["knowledge", "rm", "/repo", "ideen", "--from=agent"],
  );
});

test("Wissensordner: Notizname bekommt genau eine .md-Endung", () => {
  assert.equal(knowledgeNoteFile("ideen"), "ideen.md");
  assert.equal(knowledgeNoteFile("ideen.md"), "ideen.md");
  assert.equal(knowledgeNoteFile("plan.markdown"), "plan.markdown.md");
});

test("Wissensordner: Namensprüfung meldet den ersten Fehler", () => {
  assert.equal(knowledgeNameProblem("ideen"), "");
  assert.equal(knowledgeNameProblem("ideen-notiz_2"), "");
  assert.equal(knowledgeNameProblem(""), "Name fehlt.");
  assert.equal(knowledgeNameProblem("a/b"), "Der Name darf keinen Pfadtrenner enthalten.");
  assert.equal(knowledgeNameProblem("a\\b"), "Der Name darf keinen Pfadtrenner enthalten.");
  assert.equal(knowledgeNameProblem("a..b"), "Der Name darf kein „..“ enthalten.");
  assert.equal(knowledgeNameProblem(".plan"), "Der Name darf nicht mit einem Punkt beginnen.");
  // Reihenfolge: Punkt vor Trenner, Trenner vor „..“.
  assert.equal(knowledgeNameProblem("../plan"), "Der Name darf nicht mit einem Punkt beginnen.");
  assert.equal(knowledgeNameProblem("a/b..c"), "Der Name darf keinen Pfadtrenner enthalten.");
});

test("Wissensordner: Größen lesbar formatieren", () => {
  assert.equal(knowledgeSize(0), "0 B");
  assert.equal(knowledgeSize(512), "512 B");
  assert.equal(knowledgeSize(1536), "1.5 KB");
  assert.equal(knowledgeSize(2097152), "2.0 MB");
  assert.equal(knowledgeSize(-1), "—");
  assert.equal(knowledgeSize(null), "—");
  assert.equal(knowledgeSize(undefined), "—");
  assert.equal(knowledgeSize("abc"), "—");
  assert.equal(knowledgeSize(Number.NaN), "—");
});

test("Repo-Reiter: gültiger Deeplink gewinnt vor allem anderen", () => {
  assert.equal(repoTabAfterLoad({ wanted: "wissen" }), "wissen");
  assert.equal(repoTabAfterLoad({ wanted: "verify" }), "verify");
  assert.equal(repoTabAfterLoad({ wanted: "lessons" }), "lessons");
  assert.equal(repoTabAfterLoad({ wanted: "project" }), "project");
  // Auch gegen ein anderes Repo und einen anderen aktuellen Reiter.
  assert.equal(repoTabAfterLoad({ wanted: "wissen", previousPath: "/a", path: "/b", current: "verify" }), "wissen");
  assert.equal(repoTabAfterLoad({ wanted: "lessons", previousPath: "/a", path: "/a", current: "project" }), "lessons");
});

test("Repo-Reiter: ungültiger oder leerer Wunsch wird ignoriert", () => {
  assert.equal(repoTabAfterLoad({ wanted: "quatsch", previousPath: "/a", path: "/b" }), "verify");
  assert.equal(repoTabAfterLoad({ wanted: "", previousPath: "/a", path: "/a", current: "wissen" }), "wissen");
  assert.equal(repoTabAfterLoad({ wanted: null, previousPath: "/a", path: "/a", current: "project" }), "project");
  assert.equal(repoTabAfterLoad({ wanted: undefined, path: "/b", current: "lessons" }), "verify");
});

test("Repo-Reiter: Reload desselben Repos behält den offenen Reiter", () => {
  assert.equal(repoTabAfterLoad({ previousPath: "/a", path: "/a", current: "wissen" }), "wissen");
  assert.equal(repoTabAfterLoad({ previousPath: "/a", path: "/a", current: "project" }), "project");
  assert.equal(repoTabAfterLoad({ previousPath: "/a", path: "/a", current: "lessons" }), "lessons");
  assert.equal(repoTabAfterLoad({ previousPath: "/a", path: "/a", current: "verify" }), "verify");
});

test("Repo-Reiter: anderes Repo, fehlender Vorpfad und unbekannter Reiter starten bei verify", () => {
  assert.equal(repoTabAfterLoad({ previousPath: "/a", path: "/b", current: "wissen" }), "verify");
  assert.equal(repoTabAfterLoad({ path: "/b", current: "project" }), "verify");
  assert.equal(repoTabAfterLoad({ previousPath: "/a", path: "/a", current: "quatsch" }), "verify");
  assert.equal(repoTabAfterLoad({ previousPath: "/a", path: "/a", current: null }), "verify");
  assert.equal(repoTabAfterLoad(), "verify");
});

test("Repo-Reiter: nur verify, lessons und project haben einen Editor", () => {
  assert.deepEqual(REPO_TABS, ["verify", "lessons", "project", "wissen"]);
  assert.deepEqual(REPO_EDITOR_TABS, ["verify", "lessons", "project"]);
  assert.equal(repoEditorKey("verify"), "verify");
  assert.equal(repoEditorKey("lessons"), "lessons");
  assert.equal(repoEditorKey("project"), "project");
  assert.equal(repoEditorKey("wissen"), null);
  assert.equal(repoEditorKey(null), null);
  assert.equal(repoEditorKey("x"), null);
});

test("Wissensordner: .md-Endung wird ohne Rücksicht auf Schreibweise erkannt", () => {
  assert.equal(knowledgeNoteFile("Plan.MD"), "Plan.MD");
  assert.equal(knowledgeNoteFile("plan.Md"), "plan.Md");
  assert.equal(knowledgeNoteFile("Plan"), "Plan.md");
  assert.equal(knowledgeNoteFile(""), ".md");
});

test("Blocker: offene und erledigte werden getrennt", () => {
  const tickets = [
    { id: "T-1", status: "todo" },
    { id: "T-2", status: "done" },
    { id: "T-3", status: "dropped" },
  ];
  const ticket = { id: "T-9", blocked_by: ["T-2", "T-3", "T-404", "T-1"] };
  assert.deepEqual(
    blockerEntries(ticket, tickets).map((entry) => [entry.id, entry.status, entry.open]),
    [
      ["T-2", "done", false],
      ["T-3", "dropped", false],
      ["T-404", null, true],
      ["T-1", "todo", true],
    ],
  );
  assert.deepEqual(openBlockers(ticket, tickets), ["T-404", "T-1"]);
  assert.deepEqual(blockerEntries({ id: "T-8", blocked_by: [] }, tickets), []);
});

