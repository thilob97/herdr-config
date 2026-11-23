// Reine Logik des Fabric-Mods: keine herdr-, keine gpui-Importe.
// Wörter, Übergänge, Board, Filter, Flags, Erwähnungen, Zeitformat,
// der Zeitverlauf-Feed und der Schutz vor ungespeicherten Änderungen stehen hier.

// ---------- Stufen und Statuswörter ----------

const STATUS_WORDS = {
  draft: "Entwurf",
  todo: "Geplant",
  doing: "In Arbeit",
  review: "Prüfung",
  done: "Fertig",
  dropped: "Verworfen",
};

export const STATUS_KEYS = ["draft", "todo", "doing", "review", "done", "dropped"];

// Die Stufen des Boards und der Liste, in dieser Reihenfolge.
export const STAGES = ["draft", "todo", "doing", "review", "done"].map((key) => ({
  key,
  label: STATUS_WORDS[key],
}));

export const statusWord = (status) => STATUS_WORDS[status] ?? status ?? "";

export const EVENT_WORDS = {
  created: "angelegt",
  edited: "geändert",
  status: "Status",
  assigned: "zugeteilt",
  comment: "Kommentar",
  wake: "Wecken",
  dispatch: "verteilt",
  verify: "geprüft",
  verdict: "Urteil",
  handover: "übergeben",
  pr: "PR",
  accept: "abgenommen",
  reject: "zurückgewiesen",
  drop: "verworfen",
  orchestrator: "Orchestrator",
  config: "Konfiguration",
  lesson: "Lehre",
};

export const eventWord = (kind) => EVENT_WORDS[kind] ?? kind ?? "";

export const CHECK_WORDS = { pass: "grün", fail: "rot" };
export const VERDICT_WORDS = { pass: "bestanden", fail: "abgelehnt" };

export const INBOX_WORDS = {
  question: "Frage",
  review: "Prüfung",
  attention: "Aufmerksamkeit",
  lesson: "Lehre",
};

// Erlaubte Wechsel. `done` gibt es nur über `fab accept`; `dropped` lässt sich
// wieder öffnen. Die Oberfläche bietet nur diese Wege an.
const TRANSITIONS = {
  draft: ["todo", "dropped"],
  todo: ["draft", "doing", "dropped"],
  doing: ["todo", "review", "dropped"],
  review: ["doing", "dropped"],
  done: [],
  dropped: ["draft"],
};

/** Status, die das Select im Detail anbietet, mit `disabled` und Grund.
 *  „Verworfen“ trägt `drop: true`: es öffnet immer den Verwerfen-Dialog
 *  (`fab drop`), nie einen direkten Statuswechsel. */
export function statusOptions(current) {
  const allowed = TRANSITIONS[current] ?? [];
  const options = [{ key: current, label: statusWord(current), disabled: false, reason: "" }];
  for (const key of allowed) {
    options.push({ key, label: statusWord(key), disabled: false, reason: "", drop: key === "dropped" });
  }
  if (current === "done") {
    return [{ key: "done", label: statusWord("done"), disabled: true, reason: "Fertig ist abgeschlossen." }];
  }
  return options;
}

/** Ist der Wechsel erlaubt? */
export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

// ---------- Aktionsleiste ----------

export const FORMULATE_COMMENT = "@orchestrator bitte ausformulieren und verteilen";

const hasCriteriaSection = (body) => /^##\s+Abnahmekriterien\s*$/m.test(String(body ?? ""));

/** Offene Abhängigkeiten eines Tickets (nicht done/dropped). */
export function openBlockers(ticket, tickets) {
  const byId = new Map((tickets ?? []).map((row) => [row?.id, row]));
  return (ticket?.blocked_by ?? []).filter((id) => {
    const blocker = byId.get(id);
    return !blocker || (blocker.status !== "done" && blocker.status !== "dropped");
  });
}

/** Was fehlt für `fab dispatch`? Leer heißt: bereit. */
export function dispatchBlockers(ticket, tickets = []) {
  const missing = [];
  if (!ticket?.repo) missing.push("Repo fehlt");
  if (!hasCriteriaSection(ticket?.body)) missing.push("Abschnitt „Abnahmekriterien“ fehlt");
  if (!ticket?.assignee) missing.push("Kein Zuständiger");
  const blockers = openBlockers(ticket, tickets);
  if (blockers.length) missing.push(`Blockiert durch ${blockers.join(", ")}`);
  return missing;
}

// ---------- Änderungen und Abnahme ----------

/** Darf abgenommen werden? Nur wenn die Änderungen geladen sind und zum
 *  zuletzt gesehenen HEAD passen – ein neuer HEAD sperrt wieder. */
export function changesGate(changes, seenHead) {
  const head = changes?.head ?? "";
  if (!head) return { enabled: false, reason: "Änderungen sind nicht geladen" };
  if (String(seenHead ?? "") !== head) {
    return { enabled: false, reason: `Änderungen für HEAD ${head.slice(0, 7)} ansehen` };
  }
  return { enabled: true, reason: "" };
}

/** `fab diff <id> --json`; mit `file` zusätzlich `--file=<pfad>`. */
export function diffArgs(id, { file = null } = {}) {
  return ["diff", id, "--json", ...(file ? [`--file=${file}`] : [])];
}

/** `fab diff <id> --file=<pfad>` für den Sprung in eine einzelne Datei. */
export function diffFileArgs(id, file) {
  return ["diff", id, `--file=${file}`];
}

/** Aktionen je Status. `kind` steuert die Darstellung: primary, normal, danger.
 *  Jede deaktivierte Aktion trägt ihren Grund im `reason` (Tooltip). */
export function actionBar(ticket, tickets = [], changes = null, seenHead = "") {
  const status = ticket?.status;
  const actions = [];
  const add = (action) => actions.push({
    disabled: false,
    reason: "",
    kind: "normal",
    ...action,
  });

  if (status === "draft") {
    add({
      id: "formulate",
      label: "Ausformulieren lassen",
      kind: "primary",
      icon: "sparkle",
      command: "fab comment",
      hint: FORMULATE_COMMENT,
    });
  }
  if (status === "todo") {
    const missing = dispatchBlockers(ticket, tickets);
    add({
      id: "dispatch",
      label: "Verteilen",
      kind: "primary",
      icon: "send",
      command: "fab dispatch",
      disabled: missing.length > 0,
      reason: missing.join(" · "),
    });
  }
  if (status === "doing") {
    add({
      id: "verify",
      label: "Prüfen",
      icon: "check",
      command: "fab verify",
      disabled: !ticket?.worktree,
      reason: ticket?.worktree ? "" : "Kein Worktree – erst verteilen",
    });
    add({
      id: "wake",
      label: "Agent wecken…",
      icon: "bell",
      command: "fab wake",
      disabled: !ticket?.assignee,
      reason: ticket?.assignee ? "" : "Kein Zuständiger",
    });
  }
  if (status === "review") {
    const gate = changesGate(changes, seenHead);
    add({
      id: "accept",
      label: "Abnehmen",
      kind: "primary",
      icon: "check",
      command: "fab accept",
      confirm: "accept",
      disabled: !gate.enabled,
      reason: gate.reason,
    });
    add({
      id: "reject",
      label: "Zurück mit Feedback",
      icon: "undo",
      command: "fab reject",
      hint: "Der Text aus dem Kommentarfeld wird das Feedback.",
    });
  }
  if (status !== "done" && status !== "dropped") {
    add({
      id: "drop",
      label: "Verwerfen…",
      kind: "danger",
      icon: "trash",
      command: "fab drop",
      confirm: "drop",
    });
  }
  if (status === "dropped") {
    add({
      id: "reopen",
      label: "Wieder öffnen",
      icon: "undo",
      command: "fab status",
    });
  }
  return actions;
}

// ---------- Unter-Tickets ----------

const ticketNumber = (id) => {
  const match = /(\d+)\s*$/.exec(String(id ?? ""));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

/** Kinder eines Tickets, numerisch nach ID sortiert (T-2 vor T-10). */
export function childrenOf(tickets, id) {
  return (tickets ?? [])
    .filter((row) => row?.parent === id)
    .sort((a, b) => ticketNumber(a.id) - ticketNumber(b.id)
      || String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

/** Fortschritt der Kinder: erledigt sind done und dropped. */
export function childProgress(children) {
  const total = (children ?? []).length;
  const closed = (children ?? []).filter((row) => row?.status === "done" || row?.status === "dropped").length;
  return { total, closed, open: total - closed };
}

// ---------- Board und Filter ----------

const text = (value) => String(value ?? "").toLowerCase();

function matchesQuery(ticket, query) {
  const needle = text(query).trim();
  if (!needle) return true;
  const haystack = [
    ticket?.id,
    ticket?.title,
    ticket?.assignee,
    ticket?.repo,
    ticket?.branch,
    ticket?.last_comment?.text,
    ticket?.last_comment?.author,
  ].map(text).join(" ");
  return needle.split(/\s+/).every((part) => haystack.includes(part));
}

/** Filter für Board und Tabelle. `assignee`/`repo` sind exakte Werte oder "all". */
export function filterTickets(tickets, filters = {}) {
  const { query = "", assignee = "all", repo = "all", includeDropped = false } = filters;
  return [...(tickets ?? [])].filter((ticket) => {
    if (!ticket) return false;
    if (!includeDropped && ticket.status === "dropped") return false;
    if (assignee !== "all" && (ticket.assignee ?? "") !== assignee) return false;
    if (repo !== "all" && (ticket.repo ?? "") !== repo) return false;
    return matchesQuery(ticket, query);
  });
}

const byUpdated = (a, b) => (b?.updated_at ?? 0) - (a?.updated_at ?? 0);

/** Spalten des Boards; „Fertig“ höchstens `doneLimit`, „Prüfung“ meldet,
 *  wenn dort etwas auf den Menschen wartet. Mit `includeDropped` kommt die
 *  Spalte „Verworfen“ hinzu – sie ist ein Filter, keine feste Stufe. */
export function boardColumns(tickets, filters = {}) {
  const { doneLimit = 20, includeDropped = false } = filters;
  const filtered = filterTickets(tickets, filters);
  const stages = [...STAGES];
  if (includeDropped) stages.push({ key: "dropped", label: STATUS_WORDS.dropped });
  return stages.map((stage) => {
    let rows = filtered.filter((ticket) => ticket.status === stage.key).sort(byUpdated);
    if (stage.key === "done") rows = rows.slice(0, doneLimit);
    return {
      key: stage.key,
      label: stage.label,
      tickets: rows,
      count: rows.length,
      attention: stage.key === "review" && rows.length > 0,
    };
  });
}

/** Alle Zuständigen und Repos für die Filterleiste. */
export function filterOptions(tickets) {
  const assignees = new Set();
  const repos = new Set();
  for (const ticket of tickets ?? []) {
    if (ticket?.assignee) assignees.add(ticket.assignee);
    if (ticket?.repo) repos.add(ticket.repo);
  }
  return {
    assignees: ["all", ...assignees].map((name) => ({ value: name, label: name === "all" ? "Alle" : name })),
    repos: ["all", ...repos].map((path) => ({ value: path, label: path === "all" ? "Alle" : repoName(path) })),
  };
}

/** Tabellenspalten; `key` ist ein Feld des Index-Eintrags. */
export const TABLE_COLUMNS = [
  { key: "id", label: "ID", width: 64 },
  { key: "title", label: "Titel", width: 300 },
  { key: "status", label: "Status", width: 96 },
  { key: "assignee", label: "Zuständig", width: 92 },
  { key: "repo", label: "Repo", width: 132 },
  { key: "updated_at", label: "Aktualisiert", width: 108 },
  { key: "comment_count", label: "Kommentare", width: 92, numeric: true },
];

/** Sortiert die Tabelle; fehlende Werte ans Ende. */
export function sortTickets(tickets, sort = { key: "updated_at", dir: "desc" }) {
  const { key = "updated_at", dir = "desc" } = sort;
  const sign = dir === "asc" ? 1 : -1;
  const value = (ticket) => {
    if (key === "status") return STATUS_KEYS.indexOf(ticket?.status);
    if (key === "repo") return repoName(ticket?.repo);
    if (key === "updated_at" || key === "comment_count") return ticket?.[key] ?? 0;
    return ticket?.[key] ?? "";
  };
  return [...(tickets ?? [])].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === right) return byUpdated(a, b);
    if (left === null || left === "") return 1;
    if (right === null || right === "") return -1;
    return (left > right ? 1 : -1) * sign;
  });
}

/** Ein Klick auf einen Spaltenkopf: gleiche Spalte dreht die Richtung. */
export function nextSort(sort, key) {
  if (sort?.key !== key) return { key, dir: key === "updated_at" ? "desc" : "asc" };
  return { key, dir: sort.dir === "asc" ? "desc" : "asc" };
}

// ---------- Flags und Kommandozeilen ----------

/** Zerlegt Text nach Shell-Regeln: Leerraum trennt, '…' ist wörtlich,
 *  "…" erlaubt \\" und \\\\, außerhalb maskiert \\ das nächste Zeichen. */
export function splitShell(source) {
  const input = String(source ?? "");
  const words = [];
  let word = "";
  let joined = false;
  let quote = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else { word += char; joined = true; }
      continue;
    }
    if (quote === '"') {
      if (char === "\\" && index + 1 < input.length && '"\\'.includes(input[index + 1])) {
        word += input[index + 1];
        index += 1;
        joined = true;
      } else if (char === '"') {
        quote = null;
      } else {
        word += char;
        joined = true;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      joined = true;
      continue;
    }
    if (char === "\\" && index + 1 < input.length) {
      word += input[index + 1];
      index += 1;
      joined = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (joined || word) words.push(word);
      word = "";
      joined = false;
      continue;
    }
    word += char;
    joined = true;
  }
  if (joined || word) words.push(word);
  return words;
}

/** Setzt Wörter so zusammen, dass `splitShell` sie wiederfindet. */
export function joinShell(words) {
  const list = (words ?? []).map((word) => String(word ?? ""));
  return list.map((word) => {
    if (word === "") return "''";
    if (!/[\s'"\\$`]/.test(word)) return word;
    return `'${word.replace(/'/g, `'\\''`)}'`;
  }).join(" ");
}

/** Zerlegt argv in Programm, Modell und übrige Flags.
 *  Erkennt `--model=Wert` und `--model Wert`; das Modell wird dabei entfernt. */
export function argvParts(argv) {
  const list = [...(argv ?? [])].map((part) => String(part ?? "")).filter(Boolean);
  const program = list.shift() ?? "";
  let model = "";
  const flags = [];
  for (let index = 0; index < list.length; index += 1) {
    const part = list[index];
    if (part.startsWith("--model=")) {
      model = part.slice("--model=".length);
      continue;
    }
    if (part === "--model" && index + 1 < list.length) {
      model = list[index + 1];
      index += 1;
      continue;
    }
    flags.push(part);
  }
  return { program, model, flags };
}

/** Programm, Modell und Flags zurück zu argv. */
export function argvFromParts(parts = {}) {
  const program = String(parts.program ?? "").trim();
  if (!program) return [];
  const argv = [program];
  const model = String(parts.model ?? "").trim();
  if (model) argv.push(`--model=${model}`);
  for (const flag of splitShell(parts.flags ?? "")) argv.push(flag);
  return argv;
}

/** Flags als Text für das Eingabefeld. */
export function flagsText(flags) {
  return joinShell(flags ?? []);
}

/** Kurzform für Listen: erster Programmname, Modell, Flag-Anzahl. */
export function argvSummary(program, model, flags) {
  const pieces = [program || "—"];
  if (model) pieces.push(model);
  const count = (flags ?? []).length;
  if (count) pieces.push(`${count} Flag${count === 1 ? "" : "s"}`);
  return pieces.join(" · ");
}

// ---------- Anhänge ----------

/** Bildtypen, die `fab attach` annimmt. */
export const IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "webp"];
/** Kurzhinweis für Eingabefelder. */
export const IMAGE_HINT = "png, jpg, jpeg, gif, webp";

// Markdown-Bild: `![alt](pfad)`; der Pfad endet am ersten `)`.
const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Relativer Pfad mit Bildendung? Abfrage und Fragment zählen nicht mit. */
export function isImagePath(path) {
  const value = String(path ?? "").trim();
  if (!value || SCHEME.test(value)) return false;
  const clean = value.split(/[?#]/, 1)[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_TYPES.includes(clean.slice(dot + 1).toLowerCase());
}

/** Alle relativen Bildverweise in Reihenfolge, ohne Dedupe: { alt, path, markdown }. */
export function imageRefs(text) {
  const refs = [];
  for (const match of String(text ?? "").matchAll(IMAGE_MARKDOWN)) {
    const path = match[2];
    if (path.startsWith("/") || /^https?:/i.test(path)) continue;
    if (!isImagePath(path)) continue;
    refs.push({ alt: match[1], path, markdown: match[0] });
  }
  return refs;
}

/** Bild-Markdown durch seinen Alt-Text ersetzen; leerer Alt-Text entfernt den Verweis. */
export function stripImages(text) {
  return String(text ?? "").replace(IMAGE_MARKDOWN, "$1");
}

/** Anhang an `range` einfügen: { text, caret }. Leerraum bleibt, sonst ein Trennzeichen. */
export function insertAttachment(text, range, reference) {
  const source = String(text ?? "");
  const ref = String(reference ?? "");
  const clamp = (value, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(Math.trunc(number), source.length));
  };
  const start = clamp(range?.start, 0);
  const end = Math.max(start, clamp(range?.end, start));
  const lead = start > 0 && !/\s/.test(source[start - 1]) ? " " : "";
  const trail = end < source.length && !/\s/.test(source[end]) ? " " : "";
  return {
    text: source.slice(0, start) + lead + ref + trail + source.slice(end),
    caret: start + lead.length + ref.length,
  };
}

// ---------- Blaupausen-Drawer ----------

/** Formularwerte des Blaupausen-Drawers, ausschließlich aus dieser Blaupause. */
export function blueprintDraft(blueprint) {
  const parts = argvParts(blueprint?.argv ?? []);
  return {
    original: blueprint?.name ?? "",
    color: blueprint?.color ?? "",
    name: blueprint?.name ?? "",
    role: blueprint?.role ?? "umsetzer",
    program: parts.program,
    model: parts.model,
    flags: flagsText(parts.flags),
    prompt: blueprint?.prompt ?? "",
  };
}

/** Zeigt der Drawer dieselbe Blaupause im selben Modus? */
export function sameBlueprintDraft(left, right) {
  return Boolean(left && right)
    && left.mode === right.mode
    && left.original === (right.original ?? "");
}

/** Ein offener, geänderter Drawer wird beim Wechsel nicht still überschrieben. */
export function blueprintSwitchNeedsConfirm(current, next, dirty) {
  if (!current || sameBlueprintDraft(current, next)) return false;
  return Boolean(dirty);
}

/** Speicherargumente: Ziel und Werte stammen aus demselben Drawer-Zustand.
 *  `draft` = { mode, original, color } der angezeigten Blaupause,
 *  `form` = { name, role, model, flags, program, prompt } aus den Formularfeldern. */
export function blueprintSaveArgs(draft, form) {
  const name = String(form?.name ?? "").trim();
  const program = String(form?.program ?? draft?.program ?? "").trim();
  if (!name) return { error: "Bitte einen Namen angeben." };
  if (!program) return { error: "Bitte ein Programm wählen." };
  const argv = argvFromParts({ program, model: form?.model ?? "", flags: form?.flags ?? "" });
  const args = [
    "blueprint",
    draft.mode === "new" ? "add" : "edit",
    draft.mode === "new" ? name : draft.original,
  ];
  if (draft.mode === "edit" && name !== draft.original) args.push(`--rename=${name}`);
  args.push(`--role=${String(form?.role ?? "").trim() || "umsetzer"}`);
  if (draft.color) args.push(`--color=${draft.color}`);
  args.push(`--argv-json=${JSON.stringify(argv)}`);
  if (String(form?.prompt ?? "").trim()) args.push(`--prompt-text=${form.prompt}`);
  args.push("--from=mensch");
  return { args, name, argv };
}

// ---------- Entscheidungen und Kontext ----------

/** Ein Kommentar als Satz: Leerraum wird zu einem Leerzeichen, außen bleibt nichts. */
export function decisionSentence(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** `fab decide`; der Satz steht hinter `--`, damit auch ein führendes `-` Text bleibt. */
export function decideArgs(id, sentence, from = "mensch") {
  return ["decide", id, `--from=${from}`, "--", sentence];
}

export function decideConfirmArgs(id, proposal, from = "mensch") {
  return ["decide", "confirm", id, proposal, `--from=${from}`];
}

export function decideRejectArgs(id, proposal, from = "mensch") {
  return ["decide", "reject", id, proposal, `--from=${from}`];
}

/** Ein Kommentar als Entscheidung: Satz, Knopfzustand und Argumente. */
export function decisionComment(ticket, comment) {
  const id = String(ticket?.id ?? "").trim();
  const sentence = decisionSentence(comment?.text);
  const disabled = !id || !sentence;
  return {
    sentence,
    disabled,
    args: disabled ? null : decideArgs(id, sentence),
  };
}

/** Offene Entscheidungs-Vorschläge samt Knopfzustand. Nur ein Vorschlag mit
 *  ID und ein Ticket mit ID lassen sich bestätigen oder verwerfen. */
export function decisionProposals(ticket) {
  const ticketId = String(ticket?.id ?? "").trim();
  return (Array.isArray(ticket?.decision_proposals) ? ticket.decision_proposals : [])
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const id = String(item.id ?? "").trim();
      const actionable = Boolean(ticketId && id);
      return {
        key: `${id || "ohne-id"}-${index}`,
        id,
        text: String(item.text ?? ""),
        reason: String(item.reason ?? ""),
        by: String(item.by ?? ""),
        confirm: {
          disabled: !actionable,
          args: actionable ? decideConfirmArgs(ticketId, id) : null,
        },
        reject: {
          disabled: !actionable,
          args: actionable ? decideRejectArgs(ticketId, id) : null,
        },
      };
    });
}

/** Kontextvorschau als Anzeigewerte: Text, Zeichen, Obergrenze und die Zeile
 *  darüber. `chars`, `limit` und `clipped` kommen aus `fab context --json`;
 *  fehlen sie, zählt der Text, die Obergrenze bleibt 0 und nur der echte
 *  Kürzungshinweis am Ende gilt als gekürzt. */
export function contextDisplay(data) {
  const text = String(data?.text ?? "");
  const chars = Number.isInteger(data?.chars) && data.chars >= 0 ? data.chars : [...text].length;
  const limit = Number.isInteger(data?.limit) && data.limit >= 0 ? data.limit : 0;
  const empty = chars === 0;
  const clipped = typeof data?.clipped === "boolean"
    ? data.clipped
    : text.endsWith("[…] gekürzt") || /\n\n\[…\] gekürzt(?:, vollständig in .*)?$/.test(text);
  const over = limit > 0 && chars > limit;
  const ratio = limit > 0 ? Math.min(1, chars / limit) : 0;
  let label;
  if (over) label = `${chars} Zeichen · über der Obergrenze von ${limit}`;
  else if (limit === 0) label = `${chars} Zeichen · Kontext ist aus`;
  else if (empty) label = "0 Zeichen · noch kein Kontext";
  else if (clipped) label = `${chars} von höchstens ${limit} Zeichen · gekürzt`;
  else label = `${chars} von höchstens ${limit} Zeichen`;
  return { text, chars, limit, empty, clipped, over, ratio, label };
}

// ---------- Teams ----------

/** Formularwerte einer Teamkarte aus dem Roster. */
export function teamDraft(team) {
  return {
    name: String(team?.name ?? ""),
    brief: String(team?.brief ?? ""),
    repos: (team?.repos ?? []).map((repo) => String(repo)),
    members: (team?.members ?? [])
      .filter((member) => member && typeof member === "object" && member.blueprint)
      .map((member) => ({
        blueprint: String(member.blueprint),
        model: String(member.model ?? ""),
        max_cost: member.max_cost == null ? "" : member.max_cost,
      })),
    reviewer: String(team?.reviewer ?? ""),
    max_sessions: Number(team?.max_sessions ?? 4),
  };
}

function memberCost(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : text;
}

function normalizeMembers(members) {
  return (members ?? [])
    .filter((member) => member && String(member.blueprint ?? "").trim())
    .map((member) => ({
      blueprint: String(member.blueprint).trim(),
      model: String(member.model ?? "").trim(),
      max_cost: memberCost(member.max_cost),
    }));
}

function sessionNumber(raw) {
  const text = String(raw ?? "").trim();
  const value = Number(text);
  return Number.isInteger(value) ? value : text;
}

/** Mitglieder als JSON; leere Übersteuerungen entfallen, max_cost wird Zahl. */
export function teamMembersJson(members) {
  return JSON.stringify(normalizeMembers(members).map((member) => {
    const row = { blueprint: member.blueprint };
    if (member.model) row.model = member.model;
    if (member.max_cost !== "") row.max_cost = member.max_cost;
    return row;
  }));
}

/** Speicherargumente einer Teamkarte; Repos bleiben eine geordnete Liste. */
export function teamSaveArgs(team, form, { briefFile = "" } = {}) {
  const name = String(team?.name ?? "").trim();
  const repos = (form?.repos ?? []).map((repo) => String(repo ?? "").trim()).filter(Boolean);
  const members = normalizeMembers(form?.members);
  const reviewer = String(form?.reviewer ?? "").trim();
  const sessions = sessionNumber(form?.max_sessions);
  if (!name) return { error: "Teamname fehlt." };
  if (!repos.length) return { error: "Team braucht mindestens ein Repo." };
  if (!members.length) return { error: "Team braucht mindestens ein Mitglied." };
  if (!reviewer) return { error: "Bitte eine Prüferin oder einen Prüfer wählen." };
  // Ob der Prüfer Mitglied ist, entscheidet fab (`Prüfer muss Mitglied des Teams sein`).
  for (const member of members) {
    if (member.max_cost !== "" && typeof member.max_cost !== "number") {
      return { error: `max-cost für ${member.blueprint} muss eine ganze Zahl ≥ 0 sein.` };
    }
  }
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 16) {
    return { error: "Sitzungen müssen zwischen 1 und 16 liegen." };
  }
  const args = ["team", "edit", name];
  // Ein leerer Feldwert ist kein Rename; fab prüft den neuen Namen selbst.
  const nextName = String(form?.name ?? "").trim();
  if (nextName && nextName !== name) args.push(`--rename=${nextName}`);
  for (const repo of repos) args.push("--repo", repo);
  args.push(
    `--members-json=${teamMembersJson(members)}`,
    `--reviewer=${reviewer}`,
    `--max-sessions=${sessions}`,
  );
  const brief = String(briefFile ?? "");
  if (brief) args.push(`--brief-file=${brief}`);
  args.push("--from=mensch");
  return { args, name, sessions };
}

const TEAM_NAME = /^[a-z][a-z0-9_-]{0,15}$/;

const TEAM_NAME_ERROR = "Teamname: 1–16 Zeichen, nur Kleinbuchstaben, Ziffern, „_“ und „-“, beginnend mit einem Buchstaben.";

/** Anlegeargumente eines neuen Teams. Prüft wie `teamSaveArgs`; das
 *  Orchestrator-Prompt wählt fab selbst (`prompts/orchestrator-<name>.md`). */
export function teamAddArgs(form) {
  const name = String(form?.name ?? "").trim();
  const repos = (form?.repos ?? []).map((repo) => String(repo ?? "").trim()).filter(Boolean);
  const members = normalizeMembers(form?.members);
  const reviewer = String(form?.reviewer ?? "").trim();
  const sessions = sessionNumber(form?.max_sessions);
  if (!name) return { error: "Bitte einen Teamnamen angeben." };
  if (!TEAM_NAME.test(name)) return { error: TEAM_NAME_ERROR };
  if (!repos.length) return { error: "Team braucht mindestens ein Repo." };
  if (!members.length) return { error: "Team braucht mindestens ein Mitglied." };
  if (!reviewer) return { error: "Bitte eine Prüferin oder einen Prüfer wählen." };
  for (const member of members) {
    if (member.max_cost !== "" && typeof member.max_cost !== "number") {
      return { error: `max-cost für ${member.blueprint} muss eine ganze Zahl ≥ 0 sein.` };
    }
  }
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 16) {
    return { error: "Sitzungen müssen zwischen 1 und 16 liegen." };
  }
  const args = ["team", "add", name];
  for (const repo of repos) args.push("--repo", repo);
  args.push(
    `--members-json=${teamMembersJson(members)}`,
    `--reviewer=${reviewer}`,
    `--max-sessions=${sessions}`,
    "--from=mensch",
  );
  return { args, name, sessions };
}

/** Noch nicht gewählte Blaupausen für das Mitglieder-Dropdown. */
export function blueprintMemberOptions(blueprints, members) {
  const used = new Set((members ?? [])
    .map((member) => (typeof member === "string" ? member : member?.blueprint))
    .filter(Boolean));
  return (blueprints ?? [])
    .filter((blueprint) => blueprint?.name && !used.has(blueprint.name))
    .map((blueprint) => ({
      value: blueprint.name,
      label: blueprint.name,
      detail: blueprint.role || "ohne Rolle",
      selected: false,
    }));
}

/** Weicht das Formular vom geladenen Team ab? */
export function teamDirty(team, form) {
  if (!team || !form) return false;
  const base = teamDraft(team);
  const next = {
    name: String(form.name ?? base.name).trim(),
    brief: String(form.brief ?? base.brief),
    repos: (form.repos ?? []).map((repo) => String(repo)),
    members: normalizeMembers(form.members),
    reviewer: String(form.reviewer ?? ""),
    max_sessions: sessionNumber(form.max_sessions),
  };
  return JSON.stringify(base) !== JSON.stringify(next);
}

// Repo-Pfade ohne abschließende Schrägstriche vergleichen.
const trimRepo = (value) => String(value ?? "").replace(/\/+$/, "");

/** Team eines Tickets: ohne Repo das erste Team, sonst das Team mit dem Repo-Pfad. */
export function teamForTicket(teams, ticket) {
  const list = Array.isArray(teams) ? teams : [];
  const repo = ticket?.repo ? trimRepo(ticket.repo) : "";
  if (!repo) return list[0] ?? null;
  return list.find((team) => (team?.repos ?? []).some((path) => trimRepo(path) === repo)) ?? null;
}

/** Agenten des Ticket-Teams; ohne Team eine leere Liste. */
export function teamAgents(teams, ticket) {
  return teamForTicket(teams, ticket)?.agents ?? [];
}

/** Ein später `prompt show`-Lauf darf nur das Formular füllen, das ihn startete. */
export function promptLoadApplies(load, current) {
  return Boolean(load && current)
    && load.draft === current.draft
    && load.editor === current.editor
    && load.name === current.name;
}

// ---------- Erwähnungen ----------

// Eine Erwähnung ist `@name` mit `[a-z][a-z0-9_-]*`, ohne Groß-/Kleinschreibung.
// Steht direkt davor ein Zeichen einer E-Mail-Adresse (Buchstabe, Ziffer, . _ % + -),
// ist es keine Erwähnung: `thilo@example.com` bleibt Text.
const MENTION = /(^|[^A-Za-z0-9._%+-])@([A-Za-z][A-Za-z0-9_-]*)/g;

/** Zerlegt Text in Segmente: { text, mention, name? }. Namen sind kleingeschrieben. */
export function mentionSegments(text) {
  const source = String(text ?? "");
  const segments = [];
  let last = 0;
  for (const match of source.matchAll(MENTION)) {
    const at = match.index + match[1].length;
    if (at > last) segments.push({ text: source.slice(last, at), mention: false });
    const raw = `@${match[2]}`;
    segments.push({ text: raw, mention: true, name: match[2].toLowerCase() });
    last = at + raw.length;
  }
  if (last < source.length) segments.push({ text: source.slice(last), mention: false });
  return segments;
}

// Zeichen, die Markdown auswerten würde. Kommentare und Inbox-Texte sind
// reiner Text; betont werden nur Erwähnungen, verlinkt nur nackte URLs.
// Auch der Punkt bleibt maskiert: `1. ` am Zeilenanfang wäre sonst eine Liste.
const MARKDOWN_SPECIAL = /[\\`*_{}\[\]()#+\-.!|>~=&<>]/g;

/** Maskiert Markdown-Sonderzeichen, damit der Text wörtlich erscheint. */
export function escapeMarkdown(text) {
  return String(text ?? "").replace(MARKDOWN_SPECIAL, "\\$&");
}

/** Führenden Leerraum als geschützte Leerzeichen erhalten: sichtbar eingerückt,
 *  aber kein Markdown-Codeblock (der vier ASCII-Leerzeichen verlangt). */
function protectIndent(text) {
  return text.replace(/^[ \t]+/gm, (indent) => indent
    .replace(/ /g, "\u00a0")
    .replace(/\t/g, "\u00a0\u00a0\u00a0\u00a0"));
}

/** Nackte URL: Satzzeichen am Ende abtrennen, unpaarige Klammer am Ende schließen. */
function trimUrl(url) {
  let value = url;
  let changed = true;
  while (changed) {
    changed = false;
    while (value && ".,;:!?".includes(value[value.length - 1])) {
      value = value.slice(0, -1);
      changed = true;
    }
    while (value.endsWith(")")) {
      const open = (value.match(/\(/g) ?? []).length;
      const close = (value.match(/\)/g) ?? []).length;
      if (close <= open) break;
      value = value.slice(0, -1);
      changed = true;
    }
  }
  return value;
}

// Inline-Mathematik `$…$` in einer Zeile; ein maskiertes Zeichen hinter dem
// Backslash beendet sie nicht. Ohne schließendes `$` gibt es keinen Treffer.
const INLINE_MATH = "\\$(?:\\\\[^\\n]|[^\\\\$\\n])+\\$";

// Bild-Markdown, Inline-Mathematik, nackte URL, Erwähnung — in dieser
// Reihenfolge, damit der Bild-Alt-Text und URLs nicht als Erwähnung gelesen
// werden und Mathematik wörtlich bleibt.
const PLAIN_TOKEN = new RegExp([
  IMAGE_MARKDOWN.source,
  INLINE_MATH,
  "https?:\\/\\/[^\\s<>\"']+",
  "(?<![A-Za-z0-9._%+-])@([A-Za-z][A-Za-z0-9_-]*)",
].join("|"), "g");

/** Kommentartext als reiner Text, Zeilenumbrüche erhalten: `@name` fett,
 *  nackte URLs als Link, Bild-Markdown nur als Alt-Text, `$…$` wörtlich. */
export function plainMentionMarkdown(text) {
  const source = protectIndent(String(text ?? ""));
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(PLAIN_TOKEN)) {
    if (match.index > last) parts.push(escapeMarkdown(source.slice(last, match.index)));
    if (match[1] !== undefined) {
      parts.push(escapeMarkdown(match[1]));
    } else if (match[3] !== undefined) {
      parts.push(`**${escapeMarkdown(`@${match[3]}`)}**`);
    } else if (match[0].startsWith("$")) {
      parts.push(match[0]);
    } else {
      const url = trimUrl(match[0]);
      parts.push(`<${url}>${escapeMarkdown(match[0].slice(url.length))}`);
    }
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push(escapeMarkdown(source.slice(last)));
  return parts.join("").replace(/\n/g, "  \n");
}

/** Alle genannten Namen, in Reihenfolge, ohne Doppelte. */
export function mentionedNames(text) {
  const seen = new Set();
  const names = [];
  for (const part of mentionSegments(text)) {
    if (part.mention && !seen.has(part.name)) {
      seen.add(part.name);
      names.push(part.name);
    }
  }
  return names;
}

/** Die `@`-Eingabe am Cursor: { start, end, query } oder null. */
export function mentionQuery(text, caret = String(text ?? "").length) {
  const source = String(text ?? "");
  const at = Math.max(0, Math.min(caret, source.length));
  const before = source.slice(0, at);
  const match = /@([A-Za-z0-9_-]*)$/.exec(before);
  if (!match) return null;
  const start = at - match[0].length;
  const previous = start > 0 ? source[start - 1] : "";
  if (previous && /[A-Za-z0-9._%+-]/.test(previous)) return null;
  return { start, end: at, query: match[1].toLowerCase() };
}

/** Vorschläge für `@…`; Namen, die mit der Eingabe beginnen, zuerst exakte Treffer. */
export function mentionSuggestions(text, caret, names = []) {
  const query = mentionQuery(text, caret);
  if (!query) return [];
  const unique = [...new Set((names ?? []).map((name) => String(name ?? "").toLowerCase()).filter(Boolean))];
  const matches = unique.filter((name) => name.startsWith(query.query));
  matches.sort((a, b) => (a === query.query ? -1 : b === query.query ? 1 : a.localeCompare(b)));
  return matches.map((name) => ({ name, query: query.query }));
}

/** Alle vorschlagbaren Namen: Roster, dann `orchestrator` und `mensch`.
 *  Einträge dürfen `{name}` oder Zeichenketten sein; Doppelte fallen weg. */
export function mentionNames(agents = []) {
  const seen = new Set();
  const names = [];
  const add = (value) => {
    const name = String(value ?? "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  for (const agent of agents ?? []) add(typeof agent === "string" ? agent : agent?.name);
  add("orchestrator");
  add("mensch");
  return names;
}

/** Nächster Vorschlag in der Liste; läuft am Ende wieder zum Anfang. */
export function moveMentionIndex(index, length, delta) {
  if (!(length > 0)) return 0;
  const step = Number(delta) || 0;
  return (((Number(index) || 0) + step) % length + length) % length;
}

/** Ersetzt genau `range` durch `@name ` und liefert Text und Cursor dahinter.
 *  Ein ungültiger oder leerer Bereich lässt den Text unverändert. */
export function replaceMention(text, range, name) {
  const source = String(text ?? "");
  const start = Number(range?.start);
  const end = Number(range?.end);
  const invalid = !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end > source.length || end <= start;
  if (invalid) {
    return { text: source, caret: Number.isInteger(end) ? Math.max(0, Math.min(end, source.length)) : source.length };
  }
  const insert = `@${name}`;
  const space = /\s/.test(source[end] ?? "") ? "" : " ";
  return {
    text: source.slice(0, start) + insert + space + source.slice(end),
    caret: start + insert.length + 1,
  };
}

/** Die Tasten der Vorschlagsliste. Sie hängen an den Kontexten der Textfelder
 *  (`Input`, `Textarea`), damit sie auf derselben Tiefe liegen wie deren eigene
 *  Bindungen; die spätere Registrierung entscheidet den Gleichstand. Ohne
 *  offene Liste reicht der Handler die Aktion per `cx.propagate()` weiter. */
export function mentionKeyBindings() {
  const actions = [
    ["up", "fabric-mention-up"],
    ["down", "fabric-mention-down"],
    ["enter", "fabric-mention-accept"],
    ["tab", "fabric-mention-accept"],
    ["escape", "fabric-mention-close"],
  ];
  const bindings = [];
  for (const context of ["Input", "Textarea"]) {
    for (const [keystroke, action] of actions) {
      bindings.push({ keystroke, action, context });
    }
  }
  return bindings;
}

/** Ersetzt die `@`-Eingabe durch `@name ` und liefert Text und neue Cursorposition. */
export function insertMention(text, caret, name) {
  const source = String(text ?? "");
  const query = mentionQuery(source, caret);
  if (!query) return { text: source, caret };
  return replaceMention(source, query, name);
}

/** Wen ein Kommentar erreicht. `author` ist der schreibende Name (hier `mensch`).
 *  mensch → Inbox, Agent/Orchestrator → wecken, Unbekanntes → nichts. */
export function wakeTargets(text, names = [], author = "") {
  const known = new Set((names ?? []).map((name) => String(name ?? "").toLowerCase()));
  return mentionedNames(text).map((name) => {
    if (name === String(author ?? "").toLowerCase()) return { name, kind: "self" };
    if (name === "mensch") return { name, kind: "inbox" };
    if (name === "orchestrator") return { name, kind: "wake" };
    if (known.has(name)) return { name, kind: "wake" };
    return { name, kind: "unknown" };
  });
}

/** Eine Zeile unter dem Kommentarfeld: „Weckt ada · Inbox: mensch“.
 *  `pending` ist die offene `@`-Eingabe; ihr Bereich zählt nicht als Erwähnung. */
export function wakeSummary(text, names = [], author = "", pending = null) {
  const source = String(text ?? "");
  const start = pending?.start;
  const end = pending?.end;
  const valid = Number.isInteger(start) && Number.isInteger(end)
    && start >= 0 && start <= end && end <= source.length;
  const visible = valid ? source.slice(0, start) + source.slice(end) : source;
  const targets = wakeTargets(visible, names, author);
  if (!targets.length) return "Weckt niemanden.";
  const wake = targets.filter((target) => target.kind === "wake").map((target) => target.name);
  const inbox = targets.filter((target) => target.kind === "inbox").map((target) => target.name);
  const unknown = targets.filter((target) => target.kind === "unknown").map((target) => target.name);
  const parts = [];
  if (wake.length) parts.push(`Weckt ${wake.join(", ")}`);
  if (inbox.length) parts.push(`Inbox: ${inbox.join(", ")}`);
  if (unknown.length) parts.push(`Unbekannt: ${unknown.join(", ")}`);
  return `${parts.join(" · ")}.`;
}

// ---------- Sitzungen ----------

const SESSION_STATUS = {
  working: { word: "arbeitet", color: "working" },
  blocked: { word: "wartet auf dich", color: "blocked" },
  done: { word: "fertig", color: "done" },
  idle: { word: "bereit", color: "muted" },
  live: { word: "läuft", color: "working" },
  exited: { word: "beendet", color: "dim" },
};

/** Herdr-Status → { word, color }; unbekannte Stati bleiben als Wort stehen. */
export function sessionStatus(status) {
  return SESSION_STATUS[status] ?? { word: status ? String(status) : "unbekannt", color: "dim" };
}

/** Chips für `ticket.sessions`: das Terminal wird über seine Adresse gesucht, sonst
 *  über den Namen `fab-<agent>-<id>`. `terminals()` und `agents()` kommen von herdr.
 *  `ended` heißt: es gibt kein laufendes Terminal; solche Chips sind nicht klickbar. */
export function sessionChips(sessions, terminals = [], agents = [], ticketId = "") {
  const byAddress = new Map();
  const byName = new Map();
  for (const row of terminals ?? []) {
    if (row?.address) byAddress.set(row.address, row);
    if (row?.name) byName.set(row.name, row);
  }
  const agentAt = new Map();
  for (const row of agents ?? []) if (row?.address) agentAt.set(row.address, row);

  return (sessions ?? []).filter(Boolean).map((session) => {
    const name = session.name
      || (session.agent ? `fab-${session.agent}-${String(ticketId).toLowerCase()}` : "");
    const terminal = (session.terminal && byAddress.get(session.terminal))
      || (name && byName.get(name))
      || null;
    const address = terminal?.address ?? session.terminal ?? "";
    const ended = !terminal || terminal.state !== "live";
    const status = ended ? "exited" : (agentAt.get(address)?.status ?? terminal.status ?? "idle");
    const look = sessionStatus(status);
    return {
      agent: session.agent ?? "",
      name,
      terminal: address,
      ended,
      status,
      word: look.word,
      color: look.color,
      tooltip: ended
        ? `Terminal ${name || address || "ist"} ist beendet`
        : status === "blocked"
          ? "wartet auf Freigabe – klicken zum Öffnen"
          : `Terminal ${name || address} – ${look.word} · klicken zum Öffnen`,
    };
  });
}

// ---------- Gruppieren ----------

const newestFirst = (a, b) => (b?.updated_at ?? 0) - (a?.updated_at ?? 0);

/** Tickets nach Stufe, in Stufenreihenfolge; je Stufe das zuletzt geänderte zuerst.
 *  `dropped` erscheint in keiner Stufe. */
export function groupByStage(tickets) {
  const known = new Set(Object.keys(STATUS_WORDS));
  const sorted = [...(tickets ?? [])]
    .filter((ticket) => ticket && known.has(ticket.status) && ticket.status !== "dropped")
    .sort(newestFirst);
  return STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    tickets: sorted.filter((ticket) => ticket.status === stage.key),
  }));
}

// ---------- Zeit ----------

/** Relative Zeit auf Deutsch; leer ohne brauchbaren Zeitstempel. */
export function relativeTime(at, now = Date.now()) {
  if (!Number.isFinite(at)) return "";
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "vor 1 Tag";
  if (days < 7) return `vor ${days} Tagen`;
  const date = new Date(at);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function stallAge(at, now) {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} Tagen`;
}

/** „stockt seit 5 min“; leer ohne Zeitstempel. Gleiche Dauer wie im Lesemodell. */
export function stallLabel(stall, now = Date.now()) {
  if (!Number.isFinite(stall?.since)) return "";
  return `stockt seit ${stallAge(stall.since, now)}`;
}

/** Grund des Stillstands für Tooltips; leer, wenn keiner bekannt ist. */
export function stallReason(stall) {
  return String(stall?.reason ?? "");
}

/** Absolute Zeit für Tooltips: DD.MM.YYYY HH:MM. */
export function absoluteTime(at) {
  if (!Number.isFinite(at)) return "";
  const date = new Date(at);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Uhrzeit HH:MM der Zeitzone des Rechners. */
export function clockTime(at) {
  if (!Number.isFinite(at)) return "";
  const date = new Date(at);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

// ---------- Kosten und Liegezeiten ----------

/** Kosten für Listen: ab einem Dollar zwei Nachkommastellen, kleine Beträge vier. */
export function formatCost(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  if (value > 0) return `$${value.toFixed(4)}`;
  return "$0.00";
}

const durationNumber = (value) => (Number.isFinite(value) ? Math.max(0, value) : 0);

/** Dauer auf Deutsch: „0 min“, „< 1 min“, „12 min“, „1 h 05 min“. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "—";
  const value = durationNumber(ms);
  if (value === 0) return "0 min";
  if (value < 60000) return "< 1 min";
  if (value < 3600000) return `${Math.floor(value / 60000)} min`;
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

/** Kostenschnappschuss eines Tickets; fehlende Werte zählen als 0. */
export function ticketCost(ticket) {
  const raw = ticket?.cost ?? {};
  const number = (value) => (Number.isFinite(value) ? value : 0);
  return {
    total: number(raw.total),
    today: number(raw.today),
    currency: typeof raw.currency === "string" && raw.currency ? raw.currency : "USD",
  };
}

/** Kosten aller Tickets, je Team zusammengefasst; über dem Limit zählt mit. */
export function costTotals(tickets) {
  const teams = new Map();
  let total = 0;
  let today = 0;
  let overLimit = 0;
  for (const ticket of tickets ?? []) {
    if (!ticket) continue;
    const cost = ticketCost(ticket);
    const name = String(ticket.team ?? "").trim() || "ohne Team";
    const row = teams.get(name) ?? { name, total: 0, today: 0, tickets: 0 };
    row.total += cost.total;
    row.today += cost.today;
    row.tickets += 1;
    teams.set(name, row);
    total += cost.total;
    today += cost.today;
    if (Number.isFinite(ticket.max_cost) && cost.total > ticket.max_cost) overLimit += 1;
  }
  return {
    total,
    today,
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
    overLimit,
  };
}

/** Eine Zeile aus mehrzeiligem Text, gekürzt für Listen. */
export function oneLine(text, max = 140) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…` : flat;
}

/** Initialen für Avatare: „ada“ → „A“, „zap zwei“ → „ZZ“. */
export function initials(name) {
  const words = String(name ?? "").trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/** Repo-Pfad ohne Home-Präfix, für Listen. */
export function repoName(path) {
  const value = String(path ?? "").replace(/\/+$/, "");
  if (!value) return "";
  return value.split("/").pop() || value;
}

/** Kopfzeile eines Repos: Name und Elternordner. */
export function repoTitle(path) {
  const value = String(path ?? "");
  return { name: repoName(value), parent: value.slice(0, Math.max(0, value.length - repoName(value).length - 1)) };
}

// ---------- Inbox ----------

/** Inbox-Einträge, neueste oben; gleiche Zeit behält ihre Reihenfolge. */
export function sortInbox(inbox) {
  return [...(inbox ?? [])]
    .filter(Boolean)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** Fehlgeschlagener Agentenstart: Agent und `wake`-Argumente für „Erneut starten“. */
export function inboxRetry(entry) {
  const ticket = entry?.ticket;
  const agent = entry?.agent;
  if (typeof ticket !== "string" || !ticket) return null;
  if (typeof agent !== "string" || !agent) return null;
  return { agent, args: wakeArgs(ticket, agent, "mensch", "Erneut starten") };
}

/** `fab lesson`-Argumente für „Bestätigen“ und „Verwerfen“. */
export function lessonArgs(id, action, value, from = "mensch") {
  return ["lesson", action, id, value, `--from=${from}`];
}

/** Offener Lehren-Vorschlag: Argumente für „Bestätigen“ und „Verwerfen“. */
export function inboxLesson(entry) {
  if (entry?.kind !== "lesson") return null;
  const ticket = entry?.ticket;
  const proposal = entry?.proposal;
  if (typeof ticket !== "string" || !ticket) return null;
  if (typeof proposal !== "string" || !proposal) return null;
  return {
    confirm: lessonArgs(ticket, "confirm", proposal),
    discard: lessonArgs(ticket, "discard", proposal),
  };
}

// ---------- Benachrichtigungen ----------

export const NOTIFY_SETTINGS_KEY = "fabric.notify";
export const NOTIFY_SEEN_KEY = "fabric.notify.seen";

export const NOTIFY_DEFAULTS = Object.freeze({ enabled: true, quiet_from: 22, quiet_to: 8 });

const quietHour = (value, fallback) => (Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback);

/** Einstellungen der Inbox-Benachrichtigung; kaputte Werte fallen auf die Vorgabe zurück. */
export function normalizeNotifySettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...NOTIFY_DEFAULTS };
  return {
    enabled: raw.enabled !== false,
    quiet_from: quietHour(raw.quiet_from, NOTIFY_DEFAULTS.quiet_from),
    quiet_to: quietHour(raw.quiet_to, NOTIFY_DEFAULTS.quiet_to),
  };
}

/** Minute des Tages in der Zeitzone des Rechners. */
export function minuteOfDay(ms) {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return 0;
  return date.getHours() * 60 + date.getMinutes();
}

/** Liegt `minutes` in der Ruhezeit? Beginn zählt, Ende nicht; gleiche Zeiten = keine Ruhe. */
export function inQuietHours(minutes, settings) {
  const { quiet_from: fromHour, quiet_to: toHour } = normalizeNotifySettings(settings);
  if (fromHour === toHour) return false;
  const from = fromHour * 60;
  const to = toHour * 60;
  const minute = ((Number(minutes) % 1440) + 1440) % 1440;
  if (!Number.isFinite(minute)) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export const INBOX_LEVELS = { question: "warning", review: "info", attention: "error", lesson: "success" };

/** Toast-Stufe einer Inbox-Art; Unbekanntes bleibt bei „info“. */
export function inboxNotifyLevel(kind) {
  return INBOX_LEVELS[kind] ?? "info";
}

/** Klang einer Inbox-Art: nur „attention“ blockiert. */
export function inboxNotifySound(kind) {
  return kind === "attention" ? "blocked" : "done";
}

/** Stabile Kennung eines Inbox-Eintrags; ohne `id` aus Art, Ticket und Zeit. */
export function inboxEntryId(entry) {
  const id = entry?.id;
  if (typeof id === "string" && id) return id;
  const kind = entry?.kind ?? "";
  const ticket = entry?.ticket ?? "";
  const at = entry?.at ?? "";
  const proposal = entry?.proposal;
  const agent = entry?.agent;
  const suffix = proposal ? `:${proposal}` : agent ? `:${agent}` : "";
  return `${kind}:${ticket}:${at}${suffix}`;
}

/** Neue, noch nicht gesehene Inbox-Einträge; Ruhezeit und Abschalten merken
 *  die aktuellen Einträge trotzdem als gesehen, damit sie nicht später feuern. */
export function inboxNotifications(inbox, seen, settings, now = Date.now()) {
  const current = sortInbox(inbox);
  const old = seen && typeof seen === "object" && !Array.isArray(seen) ? seen : {};
  const known = new Set(Object.keys(old));
  const next = {};
  const fresh = [];

  for (const entry of current) {
    const key = inboxEntryId(entry);
    next[key] = Object.prototype.hasOwnProperty.call(old, key) ? old[key] : now;
    if (!known.has(key)) fresh.push(entry);
  }
  fresh.reverse();

  const nextKeys = Object.keys(next);
  const changed = nextKeys.length !== known.size || nextKeys.some((key) => !known.has(key));
  const quiet = !normalizeNotifySettings(settings).enabled
    || inQuietHours(minuteOfDay(now), settings);

  return { fresh: quiet ? [] : fresh, seen: next, changed };
}

// ---------- Verlauf ----------

/** `wake`-Zeilen zwischen den Kommentaren, z. B. `→ ada geweckt`. */
export function wakeLine(event) {
  const target = event?.target ?? "";
  const text = event?.text ?? "geweckt";
  if (text === "an orchestrator") return "→ an den Orchestrator";
  if (text.startsWith("unterdrückt")) return target ? `→ ${target}: ${text}` : `→ ${text}`;
  return target ? `→ ${target} ${text}` : `→ ${text}`;
}

/** Kommentare und `wake`-Ereignisse eines Tickets, zeitlich einsortiert. */
export function history(ticket, events) {
  const rows = [];
  for (const comment of ticket?.comments ?? []) {
    rows.push({ kind: "comment", at: comment.at ?? 0, comment });
  }
  for (const event of events ?? []) {
    if (event?.kind !== "wake" || event.ticket !== ticket?.id) continue;
    rows.push({ kind: "wake", at: event.at ?? 0, event });
  }
  return rows.sort((a, b) => a.at - b.at);
}

/** Ende des Verlaufs im Scrollbereich: Index 0 ist der Text, danach folgen
 *  `history()`s Kopfzeile und Zeilen. Ohne Zeilen steht dort die Leerzeile. */
export function historyEndIndex(ticket, events) {
  const rows = history(ticket, events);
  return rows.length ? 1 + rows.length : 2;
}

// ---------- Zeitverlauf (Feed) ----------

/** Anzeigename eines Akteurs. */
export function actorLabel(name) {
  if (name === "orchestrator") return "Orchestrator";
  if (name === "mensch") return "Mensch";
  return String(name ?? "");
}

/** Tagesschlüssel in der Zeitzone des Rechners, z. B. `2026-11-18`. */
export function dayKey(at) {
  if (!Number.isFinite(at)) return "";
  const date = new Date(at);
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** „Heute“, „Gestern“ oder DD.MM.YYYY für eine Tagesüberschrift. */
export function dayLabel(at, now = Date.now()) {
  if (!Number.isFinite(at)) return "";
  if (dayKey(at) === dayKey(now)) return "Heute";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(at) === dayKey(yesterday.getTime())) return "Gestern";
  const date = new Date(at);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function firstWord(text) {
  return String(text ?? "").trim().split(/[\s:—·]+/)[0] ?? "";
}

/** Ein Ereignis als Satz: `actorLabel`, `verb` und `detail` für eine Feed-Zeile.
 *  Die Formulierung ist die Unterscheidung; Farbe und Punkt sind nur Verstärkung. */
export function eventSummary(event) {
  const kind = event?.kind ?? "";
  const text = String(event?.text ?? "").trim();
  const target = actorLabel(event?.target);
  const base = {
    kind,
    at: event?.at ?? 0,
    ticket: event?.ticket ?? "",
    actor: actorLabel(event?.actor),
    target,
    text,
  };
  switch (kind) {
    case "comment":
      return { ...base, verb: "kommentierte", detail: text };
    case "wake": {
      const who = target === "Orchestrator" ? "den Orchestrator"
        : target === "Mensch" ? "den Menschen" : target;
      return { ...base, verb: who ? `weckte ${who}` : "weckte", detail: text };
    }
    case "status": {
      const change = /^([a-z]+)\s*→\s*([a-z]+)$/.exec(text);
      return {
        ...base,
        verb: "änderte den Status",
        detail: change ? `${statusWord(change[1])} → ${statusWord(change[2])}` : text || "Status geändert",
      };
    }
    case "verdict": {
      const word = VERDICT_WORDS[firstWord(text)];
      const colon = text.indexOf(":");
      const rest = colon >= 0 ? text.slice(colon + 1).trim() : "";
      return { ...base, verb: "urteilte", detail: word ? `${word}${rest ? ` — ${rest}` : ""}` : text };
    }
    case "verify":
      return { ...base, verb: "prüfte", detail: CHECK_WORDS[firstWord(text)] ?? text };
    case "created":
      return { ...base, verb: "legte an", detail: text };
    case "edited":
      return { ...base, verb: "änderte", detail: text };
    case "assigned":
      return { ...base, verb: "teilte zu", detail: target || text };
    case "dispatch":
      return { ...base, verb: "verteilte", detail: text };
    case "handover":
      return { ...base, verb: "übergab", detail: text };
    case "accept":
      return { ...base, verb: "nahm ab", detail: text };
    case "reject":
      return { ...base, verb: "wies zurück", detail: text };
    case "drop":
      return { ...base, verb: "verwarf", detail: text };
    default:
      return { ...base, verb: eventWord(kind) || "Ereignis", detail: text };
  }
}

/** Ereignisse als Feed: neueste zuerst, nach Tagen gruppiert.
 *  `ticket` grenzt auf ein Ticket ein; ohne Angabe zählen alle Ereignisse.
 *  `total` ist die Zahl der Zeilen, `actors` die Zahl der beteiligten Akteure. */
export function timelineFeed(events, { ticket = null, now = Date.now() } = {}) {
  const list = (events ?? [])
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event && Number.isFinite(event.at))
    .filter(({ event }) => !ticket || event.ticket === ticket)
    .sort((a, b) => b.event.at - a.event.at || a.index - b.index);

  const days = [];
  const byKey = new Map();
  const actors = new Set();
  for (const { event } of list) {
    if (event.actor) actors.add(event.actor);
    const key = dayKey(event.at);
    let day = byKey.get(key);
    if (!day) {
      day = { key, label: dayLabel(event.at, now), rows: [] };
      byKey.set(key, day);
      days.push(day);
    }
    day.rows.push(eventSummary(event));
  }
  return { days, total: list.length, actors: actors.size };
}

// ---------- Prompts, Repos, Einstellungen ----------

export const PLACEHOLDERS = {
  id: "Ticket-ID",
  title: "Ticket-Titel",
  agent: "Name des Agenten",
  role: "Rolle aus dem Roster",
  worktree: "Pfad des Worktrees",
  branch: "Branch des Tickets",
  base: "Basis-Branch",
  reviewer: "Prüferin oder Prüfer",
};

/** Unbekannte Platzhalter im Text, ohne Doppelte. */
export function unknownPlaceholders(text, allowed = Object.keys(PLACEHOLDERS)) {
  const known = new Set(allowed);
  const found = new Set();
  for (const match of String(text ?? "").matchAll(/\{([a-z][a-z0-9_-]*)\}/g)) {
    if (!known.has(match[1])) found.add(match[1]);
  }
  return [...found];
}

/** Programm-Auswahl für den Agent-Drawer: nur installierte Programme.
 *  Das aktuell eingetragene Programm bleibt als einzige Ausnahme sichtbar,
 *  auch wenn es nicht installiert ist – markiert mit `warn`.
 *  Ohne Programme (leer oder nicht lesbar) bleibt nur der aktuelle Wert. */
export function programOptions(programs, current = "") {
  const rows = [];
  const seen = new Set();
  for (const program of programs ?? []) {
    const value = program?.run?.[0] ?? program?.name;
    if (!value || seen.has(value) || !program?.installed) continue;
    seen.add(value);
    rows.push({
      value,
      label: program.name ?? value,
      detail: "",
      installed: true,
      warn: false,
      selected: value === current,
    });
  }
  if (current && !seen.has(current)) {
    rows.unshift({
      value: current,
      label: current,
      detail: "nicht installiert",
      installed: false,
      warn: true,
      selected: true,
    });
  }
  return rows;
}

/** Reihenfolge der Prompt-Liste: Orchestrator, Präambel, dann Agenten. */
export function sortPrompts(prompts) {
  const rank = (prompt) => (prompt?.kind === "orchestrator" ? 0 : prompt?.kind === "preamble" ? 1 : 2);
  return [...(prompts ?? [])].sort((a, b) => rank(a) - rank(b) || String(a?.name).localeCompare(String(b?.name)));
}

/** Reiter der Repo-Ansicht in Anzeigereihenfolge. */
export const REPO_TABS = ["verify", "lessons", "project", "wissen"];

/** Reiter mit eigenem Editor; `wissen` ist nur Ansicht. */
export const REPO_EDITOR_TABS = ["verify", "lessons", "project"];

/** Reiter nach dem Laden: gültiger Deeplink gewinnt, ein Reload desselben
 *  Repos behält den offenen Reiter, alles andere startet beim Prüfskript. */
export function repoTabAfterLoad({ wanted = null, previousPath = null, path = null, current = "verify" } = {}) {
  if (REPO_TABS.includes(wanted)) return wanted;
  if (previousPath && path && previousPath === path) {
    return REPO_TABS.includes(current) ? current : "verify";
  }
  return "verify";
}

/** Editor-Schlüssel eines Reiters oder `null`, wenn er keinen hat. */
export function repoEditorKey(tab) {
  return REPO_EDITOR_TABS.includes(tab) ? tab : null;
}

// ---------- Vorlagen und Issues ----------

/** Feste Reihenfolge der mitgelieferten Vorlagen. */
export const TEMPLATE_ORDER = ["bug", "feature", "refactor", "chore"];

const TEMPLATE_WORDS = { bug: "Bug", feature: "Feature", refactor: "Refactor", chore: "Chore" };

/** Anzeigename einer Vorlage; unbekannte Namen bleiben unverändert. */
export function templateLabel(name) {
  return TEMPLATE_WORDS[name] ?? String(name ?? "");
}

/** Vorlagen in fester Reihenfolge, danach weitere alphabetisch. */
export function sortTemplates(rows) {
  const rank = (row) => {
    const index = TEMPLATE_ORDER.indexOf(row?.name);
    return index < 0 ? TEMPLATE_ORDER.length : index;
  };
  return [...(rows ?? [])].sort((a, b) =>
    rank(a) - rank(b) || String(a?.name).localeCompare(String(b?.name)));
}

/** Zeile eines Issues im Dropdown: `#12 Titel`. */
export function issueLabel(issue) {
  if (issue?.number == null || issue.number === "") return String(issue?.title ?? "");
  return `#${issue.number} ${issue?.title ?? ""}`.trim();
}

/** Vorlage für ein fehlendes `.fabric/verify.sh`. */
export function verifyTemplate() {
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    "# Prüfungen dieses Repos. Exit 0 heißt grün.",
    "# Beispiel:",
    "# python3 -m unittest",
    "",
  ].join("\n");
}

/** Orchestrator-Zustand in einem Wort. */
export function orchestratorWord(state) {
  if (!state?.live) return "gestoppt";
  if (state.status === "blocked") return "wartet auf dich";
  if (state.status === "working") return "arbeitet";
  return "läuft";
}

/** Farbschlüssel für `ui.sessionColor`: blocked, working, done oder dim. */
export function orchestratorColorKey(state) {
  if (!state?.live) return "dim";
  if (state.status === "blocked") return "blocked";
  if (state.status === "working") return "working";
  if (state.status === "done") return "done";
  return "muted";
}

/** Der Orchestrator aus dem live-Terminal, mit dem gespeicherten Stand als Rücken.
 *  `team` grenzt die Terminals über `fab.team` bzw. den Terminalnamen ein. */
export function liveOrchestrator(state, terminals = [], team = "") {
  const row = (terminals ?? []).find((entry) => {
    const name = String(entry?.name ?? "");
    const labels = entry?.labels && typeof entry.labels === "object" ? entry.labels : {};
    const orchestrator = name === "fab-orchestrator"
      || labels["fab.role"] === "orchestrator"
      || /^fab-.+-orchestrator$/.test(name);
    if (!orchestrator) return false;
    if (!team) return true;
    return labels["fab.team"] === team || name === `fab-${team}-orchestrator`;
  });
  if (!row) {
    if (state?.live) return { ...state };
    return { ...(state ?? {}), live: false, terminal: state?.terminal ?? null, status: null };
  }
  return {
    ...(state ?? {}),
    live: row.state === "live",
    terminal: row.address ?? state?.terminal ?? null,
    status: row.state === "live" ? (row.status ?? state?.status ?? null) : null,
    started_at: state?.started_at ?? null,
  };
}

/** Laufende Sessions eines Agenten aus `terminals()` (Labels `fab.agent` oder Name). */
export function liveAgentSessions(name, terminals = []) {
  return (terminals ?? [])
    .filter((row) => row?.labels?.["fab.agent"] === name
      || (row?.name && row.name.startsWith(`fab-${name}-`)))
    .map((row) => ({
      name: row.name ?? "",
      terminal: row.address ?? "",
      status: row.state === "live" ? (row.status ?? "idle") : "exited",
    }));
}

// ---------- Ticketwahl je Instanz ----------

/** Das Ticket, das diese Instanz zeigen soll. Außerhalb des Fensters zählt
 *  nur die geteilte Auswahl; die Route gehört dem Fenster. */
export function ticketIdFor(isApp, route, selected) {
  if (!isApp) return selected ?? null;
  if (route?.page === "ticket" && route.id) return route.id;
  return selected ?? null;
}

/** Folgt das Fenster einer neuen Auswahl? Nur wenn die Route kein Ticket nennt. */
export function followsSelection(isApp, route) {
  return Boolean(isApp) && route?.page !== "ticket";
}

// ---------- Argumente ----------

/** Freitexte stehen hinter `--` und Optionen tragen `=`, damit argparse
 *  auch `-wichtig` und `---` als Text annimmt. */
export function editArgs(id, fields = {}, from = "mensch") {
  const args = ["edit", id];
  if (fields.title != null) args.push(`--title=${fields.title}`);
  if (fields.body != null) args.push(`--body=${fields.body}`);
  if (fields.repo != null) args.push(`--repo=${fields.repo}`);
  if (fields.base != null) args.push(`--base=${fields.base}`);
  args.push(`--from=${from}`);
  return args;
}

export function newArgs(sentence, { repo = null, wake = true, from = "mensch", template = null, issue = null } = {}) {
  const args = ["new"];
  if (repo) args.push(`--repo=${repo}`);
  if (!wake) args.push("--no-wake");
  if (template) args.push(`--template=${template}`);
  if (issue != null && issue !== "") args.push(`--issue=${issue}`);
  args.push(`--from=${from}`);
  const text = String(sentence ?? "");
  if (text) args.push("--", text);
  return args;
}

export function commentArgs(id, text, from = "mensch", { noWake = false } = {}) {
  const args = ["comment", id, `--from=${from}`];
  if (noWake) args.push("--no-wake");
  args.push("--", text);
  return args;
}

/** `fab accept`; mit `prOnly` entsteht nur der PR, der Merge bleibt aus. */
export function acceptArgs(id, { prOnly = false } = {}) {
  return ["accept", id, ...(prOnly ? ["--pr-only"] : [])];
}

/** Erste PR-Adresse aus der Ausgabe von `fab accept`; leer, wenn keine. */
export function prUrl(text) {
  const match = String(text ?? "").match(/https:\/\/\S+\/pull\/\d+/);
  return match ? match[0] : "";
}

export function rejectArgs(id, feedback) {
  // `fab reject` schreibt immer als `mensch` und kennt kein `--from`.
  return ["reject", id, "--", feedback];
}

export function dropArgs(id, reason, from = "mensch") {
  return ["drop", id, `--from=${from}`, "--", reason];
}

export function wakeArgs(id, name, from = "mensch", text = "") {
  const args = ["wake", id, name, `--from=${from}`];
  if (text) args.push("--", text);
  return args;
}

export function promptSetArgs(name, text, from = "mensch") {
  return ["prompt", "set", name, `--text=${text}`, `--from=${from}`];
}

export function templateSetArgs(name, text, from = "mensch") {
  return ["template", "set", name, `--text=${text}`, `--from=${from}`];
}

export function repoSetArgs(path, key, text, from = "mensch") {
  return ["repo", "set", path, key, `--text=${text}`, `--from=${from}`];
}

// ---------- Wissensordner ----------

/** `fab knowledge add`-Argumente; `--name` und `--force` nur wenn gesetzt. */
export function knowledgeAddArgs(path, file, { name = "", force = false, from = "mensch" } = {}) {
  return [
    "knowledge", "add", path, file,
    ...(name ? [`--name=${name}`] : []),
    ...(force ? ["--force"] : []),
    `--from=${from}`,
  ];
}

/** `fab knowledge note`-Argumente. */
export function knowledgeNoteArgs(path, name, text, from = "mensch") {
  return ["knowledge", "note", path, name, `--text=${text}`, `--from=${from}`];
}

/** `fab knowledge rm`-Argumente. */
export function knowledgeRemoveArgs(path, name, from = "mensch") {
  return ["knowledge", "rm", path, name, `--from=${from}`];
}

/** Notizname mit `.md`-Endung; vorhandene Endungen bleiben. */
export function knowledgeNoteFile(name) {
  const value = String(name ?? "");
  return value.toLowerCase().endsWith(".md") ? value : `${value}.md`;
}

/** Deutscher Hinweis zum Notiznamen oder leer, wenn er taugt. */
export function knowledgeNameProblem(name) {
  const value = String(name ?? "");
  if (!value) return "Name fehlt.";
  if (value.startsWith(".")) return "Der Name darf nicht mit einem Punkt beginnen.";
  if (value.includes("/") || value.includes("\\")) return "Der Name darf keinen Pfadtrenner enthalten.";
  if (value.includes("..")) return "Der Name darf kein „..“ enthalten.";
  return "";
}

/** Dateigröße in B/KB/MB mit einer Nachkommastelle ab KB. */
export function knowledgeSize(size) {
  const value = typeof size === "number" ? size : Number(size);
  if (size == null || size === "" || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(1)} ${units[unit]}`;
}

// ---------- Layout-Helfer ----------

export const COMPACT_WIDTH = 760;
/** Ab dieser Optionszahl scrollt ein Dropdown; darunter passt die Liste. */
export const DROPDOWN_SCROLL_FROM = 12;

export function dropdownNeedsScroll(count) {
  return Number(count) >= DROPDOWN_SCROLL_FROM;
}

/** Letzter direkter Kind-Index im Eigenschaften-Scrollbereich: eingebettet
 *  folgt er dem Verlauf, sonst ist er das letzte Feld der Spalte. */
export function propertiesEndIndex(historyLastIndex, fieldCount, compact) {
  return compact
    ? Number(historyLastIndex) + Number(fieldCount)
    : Number(fieldCount) - 1;
}

/** Schmale Fenster (< 760 logische px) brauchen das einspaltige UI. */
export function compactWidth(width) {
  return Number(width) > 0 && Number(width) < COMPACT_WIDTH;
}

export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function panelState(layout) {
  const panel = findNode(layout, "panel");
  const stack = findNode(layout, "panel-body");
  return { shown: Boolean(panel && !panel.hidden), active: stack?.active ?? null };
}

/** Nächste Layout-Befehle für einen Panel-Knopf: hide oder show+select. */
export function panelToggle(layout, child) {
  const current = panelState(layout);
  if (current.shown && current.active === child) return [{ name: "layout.hide", args: { id: "panel" } }];
  return [
    { name: "layout.show", args: { id: "panel" } },
    { name: "layout.select", args: { stack: "panel-body", child } },
  ];
}

/** Spalten des Boards als Filterwerte. */
export function stageOptions() {
  return [{ value: "all", label: "Alle Stufen" }, ...STAGES.map((stage) => ({ value: stage.key, label: stage.label }))];
}

// ---------- Ungespeicherte Änderungen ----------

/** Textvergleich für Editoren: Zeilenenden und ein letzter Zeilenumbruch zählen nicht. */
export function isDirty(current, saved) {
  const normalize = (value) => String(value ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return normalize(current) !== normalize(saved);
}

/** Alle ungespeicherten Bereiche aus { key, value, saved, label }. */
export function dirtyEntries(entries) {
  return (entries ?? [])
    .filter((entry) => entry && isDirty(entry.value, entry.saved))
    .map((entry) => ({ key: entry.key, label: entry.label }));
}

/** Hinweis, wenn noch keine Daten da sind. */
export const EMPTY_HINT = "Noch keine Tickets – ein Satz im Kopf des Fensters legt das erste an.";

// ---------- Workflows: Läufe, Knotenstatus und Graph-Layout ----------

// Die Engine schreibt je Schritt `done`, `fail`, `pass` oder `wartet`; die
// Oberfläche kennt nur die vier Knotenzustände und „übersprungen“.
const FLOW_STATUS_WORDS = {
  waiting: "wartet",
  running: "läuft",
  done: "fertig",
  failed: "fehlgeschlagen",
  skipped: "übersprungen",
};

const FLOW_RUN_WORDS = {
  running: "läuft",
  paused: "pausiert",
  done: "fertig",
  failed: "fehlgeschlagen",
  cancelled: "abgebrochen",
  dry: "trocken",
};

const FLOW_KIND_WORDS = {
  trigger: "Auslöser",
  agent: "Agent",
  action: "Aktion",
  condition: "Bedingung",
  approval: "Freigabe",
  end: "Ende",
};

const FLOW_TRIGGER_WORDS = {
  manual: "manuell",
  ticket_done: "Ticket fertig",
  github_issue: "GitHub-Issue",
  main_red: "main rot",
};

/** Knotenzustand auf Deutsch. Unbekanntes bleibt stehen. */
export const flowStatusWord = (status) =>
  FLOW_STATUS_WORDS[status] ?? (status ? String(status) : "");

/** Laufzustand auf Deutsch. Unbekanntes bleibt stehen. */
export const flowRunWord = (status) =>
  FLOW_RUN_WORDS[status] ?? (status ? String(status) : "");

/** Knotentyp auf Deutsch. Unbekanntes bleibt stehen. */
export const flowKindWord = (type) =>
  FLOW_KIND_WORDS[type] ?? (type ? String(type) : "");

/** Letzter Schritt je Knoten; die spätere Position gewinnt. */
export function flowNodeSteps(run) {
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  const last = {};
  const positions = {};
  steps.forEach((step, index) => {
    const id = step?.node;
    if (!id) return;
    const raw = Number(step.position);
    const position = Number.isFinite(raw) ? raw : index;
    if (!(id in last) || position >= positions[id]) {
      last[id] = step;
      positions[id] = position;
    }
  });
  return last;
}

const FLOW_STEP_STATES = { done: "done", pass: "done", fail: "failed", wartet: "waiting" };
const FLOW_TERMINAL_RUNS = new Set(["done", "failed", "cancelled"]);

/** Ein Schritt ist für eine Bedingung auch bei „fail“ regulär beendet; nur
 *  Aktionen und Agenten kennen einen echten Fehlschlag. */
function flowStepState(node, step) {
  const raw = String(step?.status ?? "");
  if (node?.type === "condition" && (raw === "pass" || raw === "fail")) return "done";
  return FLOW_STEP_STATES[raw] ?? null;
}

/** Ausgänge, die ein besuchter Knoten tatsächlich genommen hat. */
function flowTakenEdges(node, step, outgoing) {
  if (!step) return outgoing;
  const status = String(step.status ?? "");
  const data = step.data ?? {};
  if (node?.type === "condition" && (status === "pass" || status === "fail")) {
    const matched = outgoing.filter((edge) => String(edge.when ?? "") === status);
    return matched.length ? matched : outgoing;
  }
  if (node?.type === "action" && (status === "done" || status === "fail")) {
    const when = status === "done" ? "pass" : "fail";
    const matched = outgoing.filter((edge) => String(edge.when ?? "") === when);
    return matched.length ? matched : outgoing;
  }
  if (node?.type === "agent") {
    const ticketStatus = String(data.status ?? "");
    if (ticketStatus === "done" || ticketStatus === "dropped") {
      const matched = outgoing.filter((edge) => String(edge.when ?? "") === ticketStatus);
      return matched.length ? matched : outgoing;
    }
  }
  return outgoing;
}

/** Vom Auslöser aus erreichbare Knoten entlang der genommenen Kanten. */
function flowActiveNodes(definition, steps) {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const byId = new Map(nodes.filter((node) => node?.id).map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }

  let starts = nodes.filter((node) => node?.type === "trigger" && node.id).map((node) => node.id);
  if (!starts.length) {
    const targets = new Set(edges.map((edge) => edge.to));
    starts = nodes.filter((node) => node?.id && !targets.has(node.id)).map((node) => node.id);
  }
  if (!starts.length && nodes.length && nodes[0]?.id) starts = [nodes[0].id];

  const active = new Set();
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift();
    if (active.has(id)) continue;
    active.add(id);
    const exits = outgoing.get(id) ?? [];
    for (const edge of flowTakenEdges(byId.get(id), steps[id], exits)) {
      if (!active.has(edge.to)) queue.push(edge.to);
    }
  }
  return active;
}

/** Zustand jedes Knotens für die Laufansicht: besuchte Schritte, der aktuelle
 *  Knoten und die vom Auslöser aus tatsächlich genommene Verzweigung. */
export function flowNodeStates(definition, run) {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const steps = flowNodeSteps(run);
  const active = flowActiveNodes(definition, steps);
  const status = String(run?.status ?? "");
  const current = String(run?.current ?? "");
  const terminal = FLOW_TERMINAL_RUNS.has(status);
  const states = {};

  for (const node of nodes) {
    if (!node?.id) continue;
    const step = steps[node.id];
    if (status === "failed" && node.id === current) {
      // Der Lauf scheiterte an genau diesem Knoten – auch wenn er keinen oder
      // nur einen „wartet“-Schritt hat (Ticket fehlt, Limit, kein Ausgang).
      states[node.id] = "failed";
    } else if (status === "running" && node.id === current) {
      states[node.id] = node.type === "approval" ? "waiting" : "running";
    } else if (status === "paused" && node.id === current) {
      states[node.id] = "waiting";
    } else if (step) {
      states[node.id] = flowStepState(node, step) ?? (active.has(node.id) ? "waiting" : "skipped");
    } else if (terminal) {
      states[node.id] = "skipped";
    } else {
      states[node.id] = active.has(node.id) ? "waiting" : "skipped";
    }
  }
  return states;
}

function flowTriggerLabel(node) {
  const kind = String(node.trigger ?? "");
  if (kind === "cron") {
    const every = Number(node.every_minutes);
    return Number.isFinite(every) && every > 0 ? `cron alle ${every} min` : "cron";
  }
  return FLOW_TRIGGER_WORDS[kind] ?? (kind || "manuell");
}

/** Zwei Zeilen der Knotenkarte; beide bleiben kurz genug für die Karte. */
function flowNodeText(node) {
  const kind = node?.type;
  if (kind === "trigger") {
    return { label: flowTriggerLabel(node), detail: "" };
  }
  if (kind === "agent") {
    const title = oneLine(node.title, 80);
    const agent = oneLine(node.agent, 80);
    return { label: title || agent || "Agent", detail: title && agent ? agent : "" };
  }
  if (kind === "action") {
    const words = { shell: "Shell", fab: "fab", notify: "Benachrichtigung" };
    const command = node.action === "notify" ? node.text : node.command;
    return { label: words[node.action] ?? (node.action || "Aktion"), detail: oneLine(command, 80) };
  }
  if (kind === "condition") {
    return { label: oneLine(node.expr, 80) || "Bedingung", detail: "" };
  }
  if (kind === "approval") {
    return { label: oneLine(node.text, 80) || "Freigabe", detail: "" };
  }
  return { label: "Ende", detail: "" };
}

const flowMeasure = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

/** Schichten von den Auslösern vorwärts, Knoten einer Schicht in
 *  Definitionsreihenfolge; Kanten zu früheren Schichten zählen nicht. */
export function flowLayout(definition, options = {}) {
  const nodeWidth = flowMeasure(options.nodeWidth, 190);
  const nodeHeight = flowMeasure(options.nodeHeight, 64);
  const gapX = flowMeasure(options.gapX, 72);
  const gapY = flowMeasure(options.gapY, 16);
  const padding = flowMeasure(options.padding, 20);
  const vertical = Boolean(options.vertical);
  const source = Array.isArray(definition?.nodes) ? definition.nodes.filter((node) => node?.id) : [];
  const sourceEdges = Array.isArray(definition?.edges) ? definition.edges : [];

  const index = new Map(source.map((node, position) => [node.id, position]));
  const incoming = new Map();
  for (const edge of sourceEdges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge.from);
  }

  const layers = new Map();
  const visiting = new Set();
  const layerOf = (node) => {
    if (layers.has(node.id)) return layers.get(node.id);
    if (node.type === "trigger") {
      layers.set(node.id, 0);
      return 0;
    }
    // Eine Kante in einen laufenden Zweig ist ein Rückweg und zählt nicht.
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    let layer = 0;
    for (const from of incoming.get(node.id) ?? []) {
      if (!index.has(from)) continue;
      layer = Math.max(layer, layerOf(source[index.get(from)]) + 1);
    }
    visiting.delete(node.id);
    layers.set(node.id, layer);
    return layer;
  };
  source.forEach(layerOf);

  const ordered = source
    .map((node, position) => ({ node, position, layer: layers.get(node.id) ?? 0 }))
    .sort((left, right) => left.layer - right.layer || left.position - right.position);

  const rows = new Map();
  const nodes = ordered.map(({ node, layer }) => {
    const row = rows.get(layer) ?? 0;
    rows.set(layer, row + 1);
    return {
      id: node.id,
      type: node.type,
      ...flowNodeText(node),
      x: padding + (vertical ? row * (nodeWidth + gapX) : layer * (nodeWidth + gapX)),
      y: padding + (vertical ? layer * (nodeHeight + gapY) : row * (nodeHeight + gapY)),
      w: nodeWidth,
      h: nodeHeight,
    };
  });

  const geometry = new Map(nodes.map((node) => [node.id, node]));
  const edges = [];
  sourceEdges.forEach((edge, index) => {
    const from = geometry.get(edge.from);
    const to = geometry.get(edge.to);
    if (!from || !to) return;
    const x1 = vertical ? from.x + from.w / 2 : from.x + from.w;
    const y1 = vertical ? from.y + from.h : from.y + from.h / 2;
    const x2 = vertical ? to.x + to.w / 2 : to.x;
    const y2 = vertical ? to.y : to.y + to.h / 2;
    const back = vertical ? to.y <= from.y : to.x <= from.x;
    edges.push({
      index,
      from: edge.from,
      to: edge.to,
      when: edge.when ?? null,
      x1,
      y1,
      x2,
      y2,
      mid: back ? (vertical ? y1 + 26 : x1 + 26) : (vertical ? (y1 + y2) / 2 : (x1 + x2) / 2),
      back,
      vertical,
    });
  });

  const right = nodes.reduce((max, node) => Math.max(max, node.x + node.w), 0);
  const bottom = nodes.reduce((max, node) => Math.max(max, node.y + node.h), 0);
  return {
    nodes,
    edges,
    width: nodes.length ? right + padding : nodeWidth + 2 * padding,
    height: nodes.length ? bottom + padding : nodeHeight + 2 * padding,
  };
}

/** Kurzer Text unter dem Knoten: Ticket, Freigabetext oder Ausgabe/Code. */
export function flowNodeReason(step) {
  const data = step?.data;
  if (!data || typeof data !== "object") return "";
  if (data.ticket) return `Ticket ${data.ticket}`;
  if (data.text) return oneLine(data.text, 80);
  if (data.ausgabe) return oneLine(data.ausgabe, 80);
  if (data.fehler) return oneLine(`Fehler: ${data.fehler}`, 80);
  if (data.code !== undefined && data.code !== null && String(data.code) !== "0") {
    return `Code ${data.code}`;
  }
  if (data.zusammenfassung) return oneLine(data.zusammenfassung, 80);
  return "";
}

/** Ticket-ID eines Schritts als Zeichenkette; ohne Ticket null. */
export function flowNodeTicket(step) {
  const ticket = step?.data?.ticket;
  return ticket === undefined || ticket === null || ticket === "" ? null : String(ticket);
}

// ---------- Workflows: Definitionen, Builder und Prüfung ----------

// Dieselben Werte und Meldungen wie `fabric/fablib/flows.py`, damit der
// Builder nichts baut, was `fab flow add` ablehnt.
export const FLOW_NODE_TYPES = ["trigger", "agent", "action", "condition", "approval", "end"];
export const FLOW_TRIGGER_TYPES = ["manual", "cron", "ticket_done", "github_issue", "main_red"];
export const FLOW_ACTION_TYPES = ["shell", "fab", "notify"];

/** Tiefe Kopie reiner JSON-Werte; Reihenfolge der Felder bleibt erhalten. */
function flowCopy(value) {
  if (Array.isArray(value)) return value.map(flowCopy);
  if (value && typeof value === "object") {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = flowCopy(value[key]);
    return copy;
  }
  return value;
}

/** Definition aus Objekt oder JSON-Text als tiefe Kopie. `updated_at` ist
 *  Listen-Metadaten und fällt weg; unbekannte Felder bleiben erhalten. */
export function flowLoad(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const copy = flowCopy(parsed);
  const result = { name: "" };
  if (copy && typeof copy === "object" && !Array.isArray(copy)) {
    result.name = copy.name === undefined || copy.name === null ? "" : String(copy.name);
    for (const key of Object.keys(copy)) {
      if (key === "name" || key === "updated_at" || key === "limits" || key === "nodes" || key === "edges") continue;
      result[key] = copy[key];
    }
    result.limits = copy.limits && typeof copy.limits === "object" && !Array.isArray(copy.limits) ? copy.limits : {};
    result.nodes = Array.isArray(copy.nodes) ? copy.nodes : [];
    result.edges = Array.isArray(copy.edges) ? copy.edges : [];
  } else {
    result.limits = {};
    result.nodes = [];
    result.edges = [];
  }
  return result;
}

/** Neue, leere Definition. */
export function flowNewDefinition(name = "neuer-workflow") {
  return { name: String(name ?? ""), limits: {}, nodes: [], edges: [] };
}

/** Kanonisches JSON: name, übrige Felder, limits, nodes, edges. */
export function flowSerialize(definition) {
  const source = flowLoad(definition);
  const ordered = { name: source.name };
  for (const key of Object.keys(source)) {
    if (key === "name" || key === "limits" || key === "nodes" || key === "edges") continue;
    ordered[key] = source[key];
  }
  ordered.limits = source.limits;
  ordered.nodes = source.nodes;
  ordered.edges = source.edges;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Definition aus gespeichertem JSON-Text; ungültiges JSON wirft. */
export function flowParse(text) {
  return flowLoad(JSON.parse(text));
}

/** Startwerte eines neuen Knotens; `id` und `type` stehen immer vorn. */
export function flowNodeTemplate(type, id) {
  const node = { id, type };
  if (type === "trigger") {
    node.trigger = "manual";
  } else if (type === "agent") {
    node.agent = "";
    node.title = "";
    node.prompt = "";
  } else if (type === "action") {
    node.action = "shell";
    node.command = "";
  } else if (type === "condition") {
    node.expr = "";
  } else if (type === "approval") {
    node.text = "";
  }
  return node;
}

const FLOW_ID_BASES = {
  trigger: "start",
  agent: "agent",
  action: "aktion",
  condition: "bedingung",
  approval: "freigabe",
  end: "ende",
};

/** Freie Knoten-ID: Grundname, danach 2, 3, … */
export function flowNodeId(definition, type) {
  const base = FLOW_ID_BASES[type] ?? (type ? String(type) : "knoten");
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const taken = new Set(nodes.map((node) => String(node?.id ?? "")));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/** Knoten anhängen; liefert neue Definition und vergebene ID. */
export function flowAddNode(definition, type) {
  const copy = flowLoad(definition);
  const id = flowNodeId(copy, type);
  copy.nodes.push(flowNodeTemplate(type, id));
  return { definition: copy, id };
}

/** Knoten und alle Kanten darauf entfernen. */
export function flowRemoveNode(definition, id) {
  const copy = flowLoad(definition);
  const target = String(id ?? "");
  copy.nodes = copy.nodes.filter((node) => String(node?.id ?? "") !== target);
  copy.edges = copy.edges.filter(
    (edge) => String(edge?.from ?? "") !== target && String(edge?.to ?? "") !== target,
  );
  return copy;
}

/** Knoten zusammenführen; abhängige Felder werden mit aufgeräumt. */
export function flowPatchNode(definition, id, patch) {
  const copy = flowLoad(definition);
  const target = String(id ?? "");
  const node = copy.nodes.find((entry) => String(entry?.id ?? "") === target);
  if (!node) return copy;
  const values = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  Object.assign(node, values);
  for (const key of Object.keys(node)) {
    if (node[key] === undefined) delete node[key];
  }
  if (node.type === "trigger" && node.trigger !== "cron") delete node.every_minutes;
  if (node.type === "action" && node.action !== "shell" && node.action !== "fab") {
    delete node.command;
  }
  if (node.type === "action" && node.action !== "notify") delete node.text;
  return copy;
}

/** Kante anhängen und passenden Ausgang setzen. */
export function flowConnect(definition, from, to) {
  const copy = flowLoad(definition);
  const fromId = String(from ?? "");
  const toId = String(to ?? "");
  const ids = new Set(copy.nodes.map((node) => String(node?.id ?? "")));
  if (!ids.has(fromId) || !ids.has(toId) || fromId === toId) {
    return { definition: copy, index: -1 };
  }
  const existing = copy.edges.findIndex(
    (edge) => String(edge?.from ?? "") === fromId && String(edge?.to ?? "") === toId,
  );
  if (existing !== -1) return { definition: copy, index: existing };

  const source = copy.nodes.find((node) => String(node?.id ?? "") === fromId);
  const used = new Set(
    copy.edges
      .filter((edge) => String(edge?.from ?? "") === fromId)
      .map((edge) => String(edge?.when ?? "")),
  );
  let when = "";
  if (source?.type === "condition" || source?.type === "action") {
    if (!used.has("pass")) when = "pass";
    else if (!used.has("fail")) when = "fail";
  } else if (source?.type === "agent") {
    if (!used.has("done")) when = "done";
    else if (!used.has("dropped")) when = "dropped";
  }

  const edge = { from: fromId, to: toId };
  if (when) edge.when = when;
  const index = copy.edges.length;
  copy.edges.push(edge);
  return { definition: copy, index };
}

/** Kante an einer Position entfernen. */
export function flowRemoveEdge(definition, index) {
  const copy = flowLoad(definition);
  const position = Number(index);
  if (Number.isInteger(position) && position >= 0 && position < copy.edges.length) {
    copy.edges.splice(position, 1);
  }
  return copy;
}

/** Kante zusammenführen und `max_loops`/`when` normalisieren. */
export function flowPatchEdge(definition, index, patch) {
  const copy = flowLoad(definition);
  const position = Number(index);
  const edge = copy.edges[position];
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) return copy;
  if (patch && typeof patch === "object" && !Array.isArray(patch)) Object.assign(edge, patch);

  if ("max_loops" in edge) {
    const value = edge.max_loops;
    if (value === "" || value === null || value === undefined) {
      delete edge.max_loops;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      edge.max_loops = value;
    } else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      edge.max_loops = Number(value);
    }
  }
  if ("when" in edge) {
    const value = edge.when;
    if (value === "" || value === null || value === undefined) delete edge.when;
    else edge.when = String(value);
  }
  return copy;
}

/** Alle Kanten ab einem Knoten in Definitionsreihenfolge. */
export function flowOutgoing(definition, id) {
  const target = String(id ?? "");
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const result = [];
  edges.forEach((edge, index) => {
    if (String(edge?.from ?? "") === target) result.push({ index, edge });
  });
  return result;
}

/** Mögliche Ausgänge einer Kante ab diesem Knoten. */
export function flowEdgeWhenOptions(definition, fromId) {
  const target = String(fromId ?? "");
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const node = nodes.find((entry) => String(entry?.id ?? "") === target);
  if (node?.type === "condition" || node?.type === "action") return ["pass", "fail"];
  if (node?.type === "agent") return ["done", "dropped"];
  return [];
}

const FLOW_PLACEHOLDER_FIELDS = {
  agent: ["status", "zusammenfassung", "dateien", "branch", "pr", "anhaenge", "ticket"],
  action: ["code", "ausgabe", "fehler"],
  condition: ["pass"],
};

/** Platzhalter `{{knoten.feld}}` aus den Knoten vor dieser Position. */
export function flowPlaceholders(definition, nodeId) {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const target = nodeId === undefined || nodeId === null || nodeId === "" ? null : String(nodeId);
  let limit = nodes.length;
  if (target !== null) {
    const position = nodes.findIndex((node) => String(node?.id ?? "") === target);
    if (position !== -1) limit = position;
  }
  const result = [];
  for (let index = 0; index < limit; index += 1) {
    const node = nodes[index];
    if (!node || (target !== null && String(node.id ?? "") === target)) continue;
    const id = String(node.id ?? "");
    if (!id) continue;
    for (const field of FLOW_PLACEHOLDER_FIELDS[node.type] ?? []) {
      result.push({ text: `{{${id}.${field}}}`, node: id, field });
    }
  }
  return result;
}

/** Ganzzahl wie Pythons `int()`; `null`, wenn der Wert nicht passt. */
function flowIntValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const text = value.trim();
    return /^[+-]?\d+$/.test(text) ? Number(text) : null;
  }
  return null;
}

/** Einfache Zyklen als Listen von Kantenindizes; keine Drehungs-Dubletten. */
function flowCycles(edges) {
  const adjacency = new Map();
  edges.forEach((edge, index) => {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(index);
  });
  const found = [];
  const seen = new Set();

  const walk = (start, node, pathNodes, pathEdges) => {
    for (const index of adjacency.get(node) ?? []) {
      const next = edges[index].to;
      if (next === start) {
        const key = [...pathEdges, index].sort((left, right) => left - right).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          found.push([...pathEdges, index]);
        }
      } else if (!pathNodes.has(next)) {
        const nextNodes = new Set(pathNodes);
        nextNodes.add(next);
        walk(start, next, nextNodes, [...pathEdges, index]);
      }
    }
  };

  for (const node of adjacency.keys()) walk(node, node, new Set([node]), []);
  return found;
}

/** Prüft eine Definition wie `fab flow add`; sammelt alle Fehler. */
export function flowValidate(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    return { ok: false, errors: ["Workflow-Definition ist kein JSON-Objekt"] };
  }
  const name = String(definition.name || "").trim();
  if (!name) return { ok: false, errors: ["Workflow braucht einen Namen"] };

  const prefix = `${name}: `;
  const errors = [];
  const rawNodes = definition.nodes;
  const rawEdges = definition.edges;
  const nodesValid = Array.isArray(rawNodes) && rawNodes.length > 0;

  if (!nodesValid) errors.push(`${prefix}Knoten fehlen`);
  if (!Array.isArray(rawEdges)) errors.push(`${prefix}Kanten fehlen`);

  const byId = new Map();
  const nodes = [];
  if (nodesValid) {
    for (const raw of rawNodes) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${prefix}Knoten ist kein JSON-Objekt`);
        continue;
      }
      const id = String(raw.id || "").trim();
      if (!id) {
        errors.push(`${prefix}Knoten ohne ID`);
        continue;
      }
      if (byId.has(id)) {
        errors.push(`${prefix}Knoten ${id} doppelt`);
        continue;
      }
      const kind = String(raw.type || "").trim();
      byId.set(id, { id, type: kind });
      nodes.push({ id, type: kind });
      if (!FLOW_NODE_TYPES.includes(kind)) {
        errors.push(`${prefix}Knoten ${id} hat unbekannten Typ ${kind || "—"}`);
        continue;
      }
      if (kind === "trigger") {
        const trigger = String(raw.trigger || "").trim();
        if (!FLOW_TRIGGER_TYPES.includes(trigger)) {
          errors.push(`${prefix}Knoten ${id} hat unbekannten Auslöser ${trigger || "—"}`);
        }
        if (trigger === "cron") {
          let every = flowIntValue(raw.every_minutes);
          if (every === null) every = 0;
          if (every <= 0) errors.push(`${prefix}cron-Auslöser ${id} braucht every_minutes > 0`);
        }
      } else if (kind === "action") {
        const action = String(raw.action || "").trim();
        if (!FLOW_ACTION_TYPES.includes(action)) {
          errors.push(`${prefix}Knoten ${id} hat unbekannte Aktion ${action || "—"}`);
        } else if ((action === "shell" || action === "fab") && !String(raw.command || "").trim()) {
          errors.push(`${prefix}Aktion ${id} braucht einen Befehl`);
        }
      } else if (kind === "condition") {
        if (!String(raw.expr || "").trim()) errors.push(`${prefix}Bedingung ${id} braucht einen Ausdruck`);
      }
    }

    if (!nodes.some((node) => node.type === "trigger")) errors.push(`${prefix}Auslöser fehlt`);
    if (!nodes.some((node) => node.type === "end")) errors.push(`${prefix}Ende fehlt`);
  }

  const cycleEdges = [];
  if (nodesValid && Array.isArray(rawEdges)) {
    for (const raw of rawEdges) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${prefix}Kante ist kein JSON-Objekt`);
        continue;
      }
      const source = String(raw.from || "").trim();
      const target = String(raw.to || "").trim();
      let known = true;
      if (!byId.has(source)) {
        errors.push(`${prefix}Kante von unbekanntem Knoten ${source || "—"}`);
        known = false;
      }
      if (!byId.has(target)) {
        errors.push(`${prefix}Kante auf unbekannten Knoten ${target || "—"}`);
        known = false;
      }

      const hasLimit = raw.max_loops !== null && raw.max_loops !== undefined;
      let limit = null;
      if (hasLimit) {
        limit = flowIntValue(raw.max_loops);
        if (limit === null) {
          errors.push(`${prefix}Kante ${source} → ${target} hat kein gültiges Schleifenlimit`);
        } else if (limit <= 0) {
          errors.push(`${prefix}Kante ${source} → ${target} braucht max_loops > 0`);
        }
      }
      if (known) {
        cycleEdges.push({
          from: source,
          to: target,
          max_loops: hasLimit ? (limit === null ? raw.max_loops : limit) : undefined,
        });
      }
    }

    for (const cycle of flowCycles(cycleEdges)) {
      if (cycle.some((index) => cycleEdges[index].max_loops)) continue;
      const path = cycle.map((index) => cycleEdges[index].from);
      path.push(cycleEdges[cycle[cycle.length - 1]].to);
      errors.push(`${prefix}Zyklus ohne Schleifenlimit: ${path.join(" → ")}`);
    }
  }

  const limits = definition.limits;
  if (limits !== undefined && limits !== null) {
    if (typeof limits !== "object" || Array.isArray(limits)) {
      errors.push(`${prefix}limits ist kein JSON-Objekt`);
    } else {
      for (const key of ["max_cost", "max_minutes"]) {
        const value = limits[key];
        if (value === undefined || value === null || value === "") continue;
        const number = Number(value);
        if (!Number.isFinite(number)) {
          errors.push(`${prefix}limits.${key} ist keine Zahl`);
        } else if (number < 0) {
          errors.push(`${prefix}limits.${key} darf nicht negativ sein`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------- Alarme ----------

const ALARM_KINDS = ["main", "pause", "tick"];

const ALARM_BUTTON_LABELS = {
  run: "Lauf ansehen",
  ticket: "Ticket öffnen",
  resume: "Pause aufheben",
  ack: "Quittieren",
};

/** Alarmliste aus `index.alarm.alarms` oder direkt aus dem Alarmobjekt. */
function alarmList(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  if (Array.isArray(raw.alarms)) return raw.alarms;
  const alarm = raw.alarm;
  if (alarm && typeof alarm === "object" && !Array.isArray(alarm) && Array.isArray(alarm.alarms)) {
    return alarm.alarms;
  }
  return [];
}

/** Gültige Alarm-Einträge in Reihenfolge: `id` nicht leer, bekannte Art;
 *  je `id` zählt der erste Eintrag. Jeder Eintrag trägt seine Knöpfe in
 *  Vertragsreihenfolge, unbekannte Aktionen fallen weg, „Quittieren“ steht zuletzt. */
export function alarmEntries(raw) {
  const seen = new Set();
  const entries = [];
  for (const item of alarmList(raw)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (typeof item.id !== "string" || item.id === "") continue;
    if (!ALARM_KINDS.includes(item.kind)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    const actions = Array.isArray(item.actions) ? item.actions : [];
    const keys = [];
    for (const key of actions) {
      if (!Object.prototype.hasOwnProperty.call(ALARM_BUTTON_LABELS, key)) continue;
      if (keys.includes(key)) continue;
      keys.push(key);
    }
    const ordered = keys.filter((key) => key !== "ack");
    if (keys.includes("ack")) ordered.push("ack");

    entries.push({
      ...item,
      buttons: ordered.map((key) => ({ key, label: ALARM_BUTTON_LABELS[key] })),
    });
  }
  return entries;
}

/** Steht ein gültiger Alarm an? */
export function alarmActive(raw) {
  return alarmEntries(raw).length > 0;
}

// ---------- Autopilot ----------

// Nach sechs Minuten ohne Lebenszeichen gilt ein laufender oder pausierter
// Autopilot als veraltet. Die Grenze selbst zählt noch als frisch.
export const AUTOPILOT_STALE_MS = 6 * 60 * 1000;

const AUTOPILOT_STATES = ["running", "paused", "stopped"];

/** Statusdatei des Autopiloten lesen; alles Unbrauchbare wird zu `null`. */
function autopilotStatus(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

/** Endzeit als `HH:MM` aus `YYYY-MM-DDTHH:MM` oder `HH:MM`; sonst `""`. */
function autopilotEndTime(end) {
  const match = /(?:^|T)(\d{2}):(\d{2})$/.exec(String(end ?? "").trim());
  return match ? `${match[1]}:${match[2]}` : "";
}

function autopilotEndLabel(status) {
  const time = autopilotEndTime(status?.end);
  return time ? `bis ${time}` : "bis alles fertig";
}

/** Lampe des Autopiloten: Zustand, Farbe, Text und Puls aus der Statusdatei.
 *  Ein anstehender Alarm hat Vorrang vor jedem Status. Veraltet hat Vorrang
 *  vor running und paused. */
export function autopilotLamp(raw, now = Date.now(), alarm = null) {
  const alarms = alarmEntries(alarm);
  if (alarms.length > 0) {
    const text = typeof alarms[0].text === "string" && alarms[0].text ? alarms[0].text : "Alarm";
    return { state: "alarm", color: "blocked", text, pulse: false };
  }
  const status = autopilotStatus(raw);
  const state = typeof status?.state === "string" ? status.state : "";
  if (!AUTOPILOT_STATES.includes(state)) {
    return { state: "stopped", color: "dim", text: "Autopilot aus", pulse: false };
  }
  if (state === "stopped") {
    return { state: "stopped", color: "dim", text: "Autopilot aus", pulse: false };
  }

  const updated = status.updated_at;
  const stamp = updated === null || updated === undefined || updated === "" ? NaN : Number(updated);
  if (!Number.isFinite(stamp) || Number(now) - stamp > AUTOPILOT_STALE_MS) {
    return { state: "stale", color: "dim", text: "Autopilot reagiert nicht", pulse: false };
  }

  if (state === "paused") {
    const reason = typeof status.reason === "string" ? status.reason.trim() : "";
    return {
      state: "paused",
      color: "working",
      text: reason ? `Autopilot pausiert · ${reason}` : "Autopilot pausiert",
      pulse: false,
    };
  }

  return {
    state: "running",
    color: "done",
    text: `Autopilot an · ${autopilotEndLabel(status)}`,
    pulse: true,
  };
}

/** Letzte `limit` Zeilen eines Logtexts; ein abschließender Zeilenumbruch zählt nicht. */
export function autopilotLogLines(text, limit = 20) {
  if (typeof text !== "string" || text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const count = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (count === 0 || lines.length === 0) return [];
  return lines.slice(-count);
}

/** Inhalt des Autopilot-Popovers: Lampe, letzte Aktion, Endzeit, Logpfad und Logzeilen. */
export function autopilotPopover(raw, logText, now = Date.now()) {
  const status = autopilotStatus(raw);
  const lamp = autopilotLamp(status, now);
  // Die Endzeit gehört auch zu einem pausierten oder verstummten Lauf; nur
  // „aus“ hat keine. Ohne Endzeit heißt der Lauf „bis alles fertig“.
  const endTime = autopilotEndTime(status?.end);
  const endLabel = lamp.state === "stopped"
    ? ""
    : endTime ? `bis ${endTime}` : lamp.state === "running" ? "bis alles fertig" : "";
  return {
    lamp,
    lastAction: typeof status?.last_action === "string" ? status.last_action : "",
    endLabel,
    logPath: typeof status?.log === "string" ? status.log : "",
    lines: autopilotLogLines(logText, 20),
  };
}

/** Welche Popover-Knöpfe der Zustand anbietet. „Log öffnen“ gibt es immer;
 *  Starten nur aus dem Stand, Pause aufheben nur pausiert, Stoppen nur für
 *  einen laufenden oder pausierten Autopiloten. Ein anstehender Alarm sperrt
 *  den Start und bietet Fortsetzen und Stoppen an. */
export function autopilotActions(lamp, alarm = null) {
  const alarms = alarmEntries(alarm);
  const state = lamp?.state ?? "stopped";
  if (alarms.length > 0) {
    const paused = alarms.some((item) => item.paused === true || item.kind === "pause");
    return {
      start: false,
      resume: paused,
      stop: state === "running" || state === "paused" || paused,
    };
  }
  return {
    start: state === "stopped" || state === "stale",
    resume: state === "paused",
    stop: state === "running" || state === "paused",
  };
}

export const TICK_INTERVAL_MS = 60000;

/** Ist der nächste `fab tick` fällig? Ohne bekannten Versuch sofort. */
export function tickDue(lastAttempt, now = Date.now(), interval = TICK_INTERVAL_MS) {
  const stamp = Number(lastAttempt);
  if (!Number.isFinite(stamp) || stamp <= 0) return true;
  return Number(now) - stamp >= interval;
}

// ---------- Pipelines ----------

export const PIPELINE_STATE_WORDS = {
  pass: "grün",
  fail: "rot",
  running: "läuft",
  queued: "Warteschlange",
  pending: "wartet",
  skipped: "übersprungen",
};

export const PIPELINE_TRIGGER_WORDS = {
  verify: "Prüfung",
  main: "main",
  "repo-test": "Repo-Test",
  autopilot: "Autopilot",
};

const PIPELINE_STATES = new Set(["pass", "fail", "running", "queued", "skipped"]);

/** Zustand eines Laufs oder Schritts; Unbekanntes wartet. */
export function pipelineState(entry) {
  const state = typeof entry?.state === "string" ? entry.state.trim().toLowerCase() : "";
  return PIPELINE_STATES.has(state) ? state : "pending";
}

/** Deutsches Wort zum Zustand; Unbekanntes wartet. */
export function pipelineStateWord(state) {
  return PIPELINE_STATE_WORDS[state] ?? "wartet";
}

/** Deutsches Wort zum Auslöser; unbekannte Auslöser bleiben roh. */
export function pipelineTriggerWord(trigger) {
  if (typeof trigger !== "string") return "—";
  const raw = trigger.trim();
  if (raw === "") return "—";
  return PIPELINE_TRIGGER_WORDS[raw.toLowerCase()] ?? raw;
}

/** Zählt Schritte je Zustand. */
export function pipelineStepSummary(steps) {
  const summary = { total: 0, pass: 0, fail: 0, running: 0, pending: 0, skipped: 0 };
  if (!Array.isArray(steps)) return summary;
  for (const step of steps) {
    summary.total += 1;
    // `queued` gehört zu Läufen; ein solcher Schritt zählt wie bisher als wartend.
    const state = pipelineState(step);
    summary[Object.hasOwn(summary, state) ? state : "pending"] += 1;
  }
  return summary;
}

function pipelineRunId(run) {
  const id = Number(run?.id);
  return Number.isFinite(id) ? id : -Infinity;
}

/** Läufe nach numerischer Kennung absteigend, ohne die Eingabe zu ändern. */
export function pipelineRunsNewest(runs) {
  if (!Array.isArray(runs)) return [];
  return [...runs].sort((left, right) => pipelineRunId(right) - pipelineRunId(left));
}

/** Jüngster Lauf eines Tickets oder null. */
export function pipelineLastRun(runs, ticketId) {
  if (!Array.isArray(runs)) return null;
  let last = null;
  for (const run of runs) {
    if (run?.ticket !== ticketId) continue;
    if (last === null || pipelineRunId(run) > pipelineRunId(last)) last = run;
  }
  return last;
}

/** Badge des jüngsten Laufs eines Tickets oder null. */
export function pipelineBadge(runs, ticketId) {
  const run = pipelineLastRun(runs, ticketId);
  if (run === null) return null;
  const state = pipelineState(run);
  return { run, state, word: pipelineStateWord(state) };
}

/** Erster gescheiterter, sonst erster laufender Schritt; sonst null. */
export function pipelineAutoStep(steps) {
  if (!Array.isArray(steps)) return null;
  const failed = steps.find((step) => pipelineState(step) === "fail");
  if (failed) return failed;
  return steps.find((step) => pipelineState(step) === "running") ?? null;
}

/** Ausgeklappte Schritte: nur der automatisch gewählte, nach Position. */
export function pipelineOpenSteps(steps) {
  const auto = pipelineAutoStep(steps);
  if (auto === null) return {};
  const position = Number(auto.position);
  return Number.isFinite(position) ? { [position]: true } : {};
}

/** Logzeilen eines Schritts in Stream-Reihenfolge, ohne den Schluss-Umbruch. */
export function pipelineLogLines(step) {
  const lines = [];
  for (const stream of ["stdout", "stderr"]) {
    const text = step?.[stream];
    if (typeof text !== "string" || text === "") continue;
    const parts = text.split("\n");
    if (parts[parts.length - 1] === "") parts.pop();
    for (const part of parts) lines.push({ stream, text: part });
  }
  return lines;
}

/** Sucht in Logzeilen; leere Suche liefert alle Zeilen. */
export function pipelineLogSearch(lines, query) {
  const list = Array.isArray(lines) ? lines : [];
  const needle = typeof query === "string" ? query.trim() : "";
  if (needle === "") {
    return { query: needle, total: list.length, count: list.length, lines: list };
  }
  const lower = needle.toLowerCase();
  const hits = list.filter((line) => String(line?.text ?? "").toLowerCase().includes(lower));
  return { query: needle, total: list.length, count: hits.length, lines: hits };
}

/** Dauer eines Laufs: unter einer Sekunde, Sekunden mit Zehntel, dann Minuten. */
export function pipelineDuration(ms) {
  if (ms === null || ms === undefined) return "—";
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1000) return "< 1 s";
  if (value < 10000) return `${(value / 1000).toFixed(1).replace(".", ",")} s`;
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds} s`;
  return formatDuration(value);
}

/** Ziel eines Laufs: Ticket, sonst die ersten acht Zeichen des Heads. */
export function pipelineRunTarget(run) {
  const ticket = typeof run?.ticket === "string" ? run.ticket.trim() : "";
  if (ticket !== "") return ticket;
  const head = typeof run?.head === "string" ? run.head.trim() : "";
  if (head !== "") return head.slice(0, 8);
  return "—";
}
