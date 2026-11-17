// Reine Logik des Fabric-Mods: keine herdr-, keine gpui-Importe.
// Stufen, Statuswörter, Gruppierung, Zeitformat, Erwähnungen, Inbox-Reihenfolge
// und Timeline-Geometrie stehen genau hier.

// ---------- Stufen und Statuswörter ----------

const STATUS_WORDS = {
  draft: "Entwurf",
  todo: "Geplant",
  doing: "In Arbeit",
  review: "Prüfung",
  done: "Fertig",
  dropped: "Verworfen",
};

// Die Stufen der Liste, in dieser Reihenfolge; `dropped` hat keine Stufe.
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
};

export const eventWord = (kind) => EVENT_WORDS[kind] ?? kind ?? "";

export const CHECK_WORDS = { pass: "grün", fail: "rot" };
export const VERDICT_WORDS = { pass: "bestanden", fail: "abgelehnt" };

export const INBOX_WORDS = {
  question: "Frage",
  review: "Prüfung",
  attention: "Aufmerksamkeit",
};

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

// ---------- Timeline ----------

/** Spuren und Punkte für `index.events`.
 *  Spuren: Orchestrator, Roster-Agenten in Roster-Reihenfolge, Mensch.
 *  `x` und `y` sind Anteile von 0 bis 1; `wake` wird zum Pfeil von Spur zu Spur. */
export function timeline(events, roster = []) {
  const list = [...(events ?? [])]
    .filter((event) => event && Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at);

  const names = [];
  const roles = new Map();
  const add = (name) => {
    if (typeof name === "string" && name && !names.includes(name)) names.push(name);
  };

  add("orchestrator");
  for (const entry of roster ?? []) {
    const name = typeof entry === "string" ? entry : entry?.name;
    add(name);
    if (name && entry?.role) roles.set(name, entry.role);
  }
  for (const event of list) {
    if (event.actor && event.actor !== "mensch") add(event.actor);
  }
  add("mensch");

  const label = (name) =>
    name === "orchestrator" ? "Orchestrator" : name === "mensch" ? "Mensch" : name;
  const lanes = names.map((name, index) => ({
    name,
    index,
    label: label(name),
    role: roles.get(name) ?? null,
  }));
  const laneOf = new Map(lanes.map((lane) => [lane.name, lane.index]));
  const laneCount = Math.max(1, lanes.length);
  const start = list.length ? list[0].at : 0;
  const end = list.length ? list[list.length - 1].at : 0;
  const position = (at) => (end === start ? 0.5 : (at - start) / (end - start));

  const points = list.map((event) => {
    const lane = laneOf.get(event.actor) ?? 0;
    return {
      event,
      at: event.at,
      actor: event.actor ?? "",
      kind: event.kind ?? "",
      ticket: event.ticket ?? "",
      lane,
      x: position(event.at),
      y: (lane + 0.5) / laneCount,
    };
  });

  const arrows = points
    .filter((point) => point.kind === "wake" && laneOf.has(point.event.target))
    .map((point) => ({
      at: point.at,
      x: point.x,
      actor: point.actor,
      target: point.event.target,
      from: point.lane,
      to: laneOf.get(point.event.target),
      y1: point.y,
      y2: (laneOf.get(point.event.target) + 0.5) / laneCount,
      ticket: point.ticket,
      text: point.event.text ?? "",
    }))
    .filter((arrow) => arrow.from !== arrow.to);

  return { lanes, points, arrows, start, end, span: end - start };
}

/** Hinweis, wenn noch keine Daten da sind. */
export const EMPTY_HINT = "Noch keine Tickets – oben einen Satz eingeben.";
