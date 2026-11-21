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
  accept: "abgenommen",
  reject: "zurückgewiesen",
  drop: "verworfen",
  orchestrator: "Orchestrator",
  config: "Konfiguration",
};

export const eventWord = (kind) => EVENT_WORDS[kind] ?? kind ?? "";

export const CHECK_WORDS = { pass: "grün", fail: "rot" };
export const VERDICT_WORDS = { pass: "bestanden", fail: "abgelehnt" };

export const INBOX_WORDS = {
  question: "Frage",
  review: "Prüfung",
  attention: "Aufmerksamkeit",
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

/** Status, die das Select im Detail anbietet, mit `disabled` und Grund. */
export function statusOptions(current) {
  const allowed = TRANSITIONS[current] ?? [];
  const options = [{ key: current, label: statusWord(current), disabled: false, reason: "" }];
  for (const key of allowed) {
    options.push({ key, label: statusWord(key), disabled: false, reason: "" });
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

/** Aktionen je Status. `kind` steuert die Darstellung: primary, normal, danger.
 *  Jede deaktivierte Aktion trägt ihren Grund im `reason` (Tooltip). */
export function actionBar(ticket, tickets = []) {
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
    add({
      id: "accept",
      label: "Abnehmen",
      kind: "primary",
      icon: "check",
      command: "fab accept",
      confirm: "accept",
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

// ---------- Teams ----------

/** Formularwerte einer Teamkarte aus dem Roster. */
export function teamDraft(team) {
  return {
    name: String(team?.name ?? ""),
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
export function teamSaveArgs(team, form) {
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
    "--from=mensch",
  );
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
    name: String(form.name ?? base.name),
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

// Bild-Markdown, nackte URL, Erwähnung — in dieser Reihenfolge, damit der
// Bild-Alt-Text und URLs nicht als Erwähnung gelesen werden.
const PLAIN_TOKEN = new RegExp([
  IMAGE_MARKDOWN.source,
  "https?:\\/\\/[^\\s<>\"']+",
  "(?<![A-Za-z0-9._%+-])@([A-Za-z][A-Za-z0-9_-]*)",
].join("|"), "g");

/** Kommentartext als reiner Text, Zeilenumbrüche erhalten: `@name` fett,
 *  nackte URLs als Link, Bild-Markdown nur als Alt-Text. */
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

/** Eine Zeile unter dem Kommentarfeld: „Weckt ada · Inbox: mensch“. */
export function wakeSummary(text, names = [], author = "") {
  const targets = wakeTargets(text, names, author);
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

export function newArgs(sentence, { repo = null, wake = true, from = "mensch" } = {}) {
  const args = ["new"];
  if (repo) args.push(`--repo=${repo}`);
  if (!wake) args.push("--no-wake");
  args.push(`--from=${from}`, "--", sentence);
  return args;
}

export function commentArgs(id, text, from = "mensch", { noWake = false } = {}) {
  const args = ["comment", id, `--from=${from}`];
  if (noWake) args.push("--no-wake");
  args.push("--", text);
  return args;
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

export function repoSetArgs(path, key, text, from = "mensch") {
  return ["repo", "set", path, key, `--text=${text}`, `--from=${from}`];
}

// ---------- Layout-Helfer ----------

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
