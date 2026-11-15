// Die Ticket-Karte (Board und Team-Panel), kompakt für ein Kanban: Zeile 1 ID-Chip,
// Labels und Alter; Titel über zwei Zeilen; Zeile 3 Identität, Gates als Symbole,
// Kommentar-/Nachweis-Zahlen und Kosten. Statuswort, Bearbeitungszeit und die Stufen-
// Dauer stehen im Spaltenkopf bzw. im Tooltip. Beim Hover kommen Branch, erstellt /
// zuletzt bearbeitet und die Aktionen Öffnen / Agent (dazu die nächste erlaubte Stufe)
// hinzu.
//
// Herdr kennt kein Modul über Mod-Ordner hinweg: dieselbe Karte steht als Kopie in
// mods/orchestra/hubview.js (ticketCard). Änderungen immer in beiden Dateien; dort
// zeigt Zeile 1 statt der nackten Dauer „in <Stufe> seit …" (Team-Panel).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, agents, terminals } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_M, GAP_XS, usd } from "./ui.js";

const WC = "mods/workspace-chrome";
const ICON_CHECK = `${WC}/check.svg`, ICON_X = `${WC}/x.svg`, ICON_MINUS = `${WC}/minus.svg`;
const ICON_SPIN = `${WC}/spinner.svg`, ICON_COMMENT = `${WC}/square-pen.svg`, ICON_EVIDENCE = `${WC}/file-text.svg`;

export const STAGES = [
  { key: "todo", label: "Geplant", empty: "Nichts geplant." },
  { key: "doing", label: "In Arbeit", empty: "Nichts in Arbeit." },
  { key: "review", label: "Prüfung", empty: "Nichts in Prüfung." },
  { key: "done", label: "Fertig", empty: "Nichts fertig." },
];
export const stageOf = (tk) => (["todo", "review", "done"].includes(tk.status) ? tk.status : "doing");
export const stageLabel = (key) => STAGES.find((s) => s.key === key)?.label ?? "In Arbeit";
export const stageColor = (t, key) => ({ todo: t.muted, doing: t.working, review: t.blocked, done: t.done }[key] ?? t.muted);

// "kanban-board-und-ticket-karten-im-echten" → KANBAN; "demo-1" → DEMO-1.
const STOP = new Set(["und", "im", "in", "der", "die", "das", "ein", "eine", "zu", "mit", "fur", "für", "von", "the", "a", "an", "of"]);
export function shortId(id) {
  const raw = String(id ?? "");
  const num = /(\d+)$/.exec(raw)?.[1];
  const words = raw.split("-").filter((p) => p && !STOP.has(p));
  let s = (words[0] || raw).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  if (num && !s.endsWith(num)) s = `${s.slice(0, 6)}-${num}`;
  return s || "TICKET";
}

export function splitList(v) {
  return (Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map((s) => String(s).trim()).filter(Boolean);
}

// Ticket-Zeiten rechnet ui.js: `staged` liest `status_at` mit Rückfall auf
// `updated`/`created`, `age`/`dur` schreiben „vor 3 h" bzw. „3 h".
const stageAge = (tk) => ui.staged(tk).text;
const ageText = (tk) => ui.dur(ui.staged(tk).min);
const updatedStamp = (tk) => String(tk.updated || "nie bearbeitet");

// Titel auf zwei Zeilen mit „…" an einer Wortgrenze. `per` ist die Zeichenzahl je
// Zeile (aus der gemessenen Kartenbreite); passt der Text in zwei Zeilen, bleibt er
// unverändert ohne Auslassungszeichen. Kein Wort wird je mitten getrennt: die letzte
// Zeile hält ein Zeichen für das „…" frei, ein einzelnes zu langes Wort endet mit „…".
const clampTitle = (s, per = 24) => {
  const text = String(s ?? "").replace(/\s+/g, " ").trim();
  const budget = Math.max(8, Math.floor(per));
  const words = text.split(" ").filter(Boolean);
  const lines = [];
  let i = 0;
  for (let li = 0; li < 2 && i < words.length; li++) {
    const room = li === 1 ? Math.max(1, budget - 1) : budget;
    if (words[i].length > room) {
      // Ein zu langes Wort bleibt in seiner Zeile; das „…" zählt in die Zeilenbreite.
      lines.push(`${words[i].slice(0, Math.max(1, room - 1))}…`);
      return lines.join(" ");
    }
    let line = words[i++];
    while (i < words.length && `${line} ${words[i]}`.length <= room) line += ` ${words[i++]}`;
    lines.push(line);
  }
  if (i >= words.length) return lines.join(" ");
  return `${lines.join(" ")}…`;
};

const PRIO = /^(p[0-3]|prio[-:]?[0-3]|kritisch|hoch|urgent)$/i;
// The triage writes priority p1..p3 as its own field (and a label); the card shows one
// chip, never the same priority twice. p1 red, p2 yellow, p3 muted.
function priorityOf(tk) {
  const field = String(tk.priority ?? "").trim().toLowerCase();
  const fromField = /^p?([123])$/.exec(field)?.[1];
  if (fromField) return `p${fromField}`;
  const label = [...splitList(tk.labels), ...splitList(tk.tags)].find((l) => PRIO.test(l));
  if (!label) return null;
  const n = /([123])$/.exec(label)?.[1];
  return n ? `p${n}` : "p1"; // kritisch, hoch, urgent
}
const priorityColor = (t, p) => (p === "p1" ? t.blocked : p === "p2" ? t.working : t.muted);
const sizeOf = (tk) => (/^[SML]$/i.test(String(tk.size ?? "").trim()) ? String(tk.size).trim().toUpperCase() : null);
// Höchstens zwei Chips: bei mehr Labels bleibt eines plus `+n`; Priorität steht als eigener
// Chip davor. Die Chips tragen den vollen Text und schrumpfen selbst (`min_w(0)`, `truncate`,
// Ellipse); alle Labels stehen im Tooltip.
function labelChips(t, tk) {
  const ordered = [...new Set([...splitList(tk.labels), ...splitList(tk.tags)])].filter((l) => !PRIO.test(l));
  if (!ordered.length) return [];
  const all = ordered.join(", ");
  const shown = ordered.slice(0, ordered.length > 2 ? 1 : 2);
  const out = shown.map((l) => ({ text: l, color: t.muted, tip: all }));
  if (ordered.length > shown.length) out.push({ text: `+${ordered.length - shown.length}`, color: t.dim, tip: all, fixed: true });
  return out;
}

export function blockersOf(tk, all = []) {
  return splitList(tk.blocked_by).map((id) => ({ id, status: all.find((x) => x.id === id)?.status ?? null }))
    .filter((b) => b.status !== "done");
}

const evidenceCount = (tk) => (Array.isArray(tk.evidence) ? tk.evidence.length : splitList(tk.evidence).length);
const commentCount = (tk) => Number(tk.comments ?? tk.verlauf?.length ?? 0);
const liveReview = (tk) => (tk.review_terminal
  ? terminals().find((x) => x.address === tk.review_terminal && x.state === "live") : null);

// Ein Gate als Symbol: ✓ bestanden, ✗ rot, – offen, Spinner läuft gerade.
function gateState(tk, gate) {
  const checks = gate ? (gate.ok ? "pass" : gate.stale || gate.checks === "fail" ? "fail" : "none")
    : tk.checks === "pass" ? "pass" : tk.checks === "fail" ? "fail" : "none";
  const checksTip = checks === "pass"
    ? `Checks: bestanden${gate?.at ? ` · ${gate.at}` : ""}`
    : checks === "fail" ? `Checks: rot${gate?.reason ? ` · ${gate.reason}` : tk.checks_exit ? ` (Exit ${tk.checks_exit})` : ""}`
      : `Checks: noch nicht geprüft${gate?.reason ? ` · ${gate.reason}` : ""}`;

  let review, reviewTip;
  if (liveReview(tk)) { review = "run"; reviewTip = "Review: läuft gerade"; }
  else {
    const r = gate?.review ?? null, verdict = r?.verdict ?? tk.review ?? null;
    if (r?.stale) { review = "none"; reviewTip = `Review: ${r.reason || "Urteil älter als der letzte Commit"}`; }
    else if (r ? r.ok : verdict === "pass") { review = "pass"; reviewTip = `Review: grün${r?.summary || tk.review_summary ? ` · ${r?.summary || tk.review_summary}` : ""}`; }
    else if (verdict === "fail") { review = "fail"; reviewTip = `Review: rot${r?.reason ? ` · ${r.reason}` : ""}`; }
    else { review = "none"; reviewTip = `Review: noch kein Urteil${r?.reason ? ` · ${r.reason}` : ""}`; }
  }

  const ci = tk.ci === "pass" ? "pass" : tk.ci === "fail" ? "fail" : tk.ci === "running" ? "run" : "none";
  const ciTip = { pass: "CI: grün", fail: "CI: rot", running: "CI: läuft", unknown: "CI: unbekannt" }[tk.ci] ?? "CI: noch nicht geprüft";
  return [
    { key: "checks", state: checks, tip: checksTip },
    { key: "review", state: review, tip: reviewTip },
    { key: "ci", state: ci, tip: ciTip },
  ];
}

function gateIcons(t, tk, gate) {
  // Drei leere Gates wären nur „– – –": die Reihe erscheint, sobald ein Gate etwas sagt.
  const shown = gateState(tk, gate).filter((g) => g.state !== "none");
  if (!shown.length) return null;
  return h_flex().flex_none().gap(2).items_center().children(shown.map((g) => {
    const color = g.state === "pass" ? t.done : g.state === "fail" ? t.blocked : g.state === "run" ? t.working : t.dim;
    const icon = g.state === "run" ? ICON_SPIN : g.state === "pass" ? ICON_CHECK : g.state === "fail" ? ICON_X : ICON_MINUS;
    return div().id(`tk-gate-${g.key}-${tk.id}`).size(11).flex_none().flex().items_center().justify_center()
      .tooltip(g.tip).child(svg(icon).size(11).text_color(color).when(g.state === "run", (el) => el.spin(900)));
  }));
}

// Identität aus dem Agenten-Anzeigenamen (Hub), sonst aus dem laufenden Terminal.
// Kein Avatar: die Zeile muss neben Gates und Kosten in eine schmale Karte passen.
function whoChip(t, tk) {
  const live = tk.terminal ? ui.identity(tk.terminal) : null;
  const liveName = live?.live && live.name !== tk.terminal ? live.name : null;
  const raw = String(tk.agent_name || tk.assignee || tk.agent || "").trim();
  const key = raw.split(/\s+/)[0];
  const program = key ? (agents().find((a) => (a.program?.key ?? a.app) === key)?.program?.name
    ?? terminals().find((x) => (x.program?.key ?? x.app) === key)?.program?.name) : null;
  const name = liveName || program || raw;
  if (!name) return null;
  return h_flex().flex_none().max_w(72).h(22).px(4).items_center().rounded(4).bg(t.raised)
    .tooltip(liveName ? `${liveName}${program ? ` · ${program}` : ""}` : name)
    .child(div().min_w(0).truncate().text_size(T_XS).text_color(t.muted).child(name));
}

const countIcon = (t, icon, n, tip) => h_flex().flex_none().gap(1).items_center().tooltip(tip)
  .child(svg(icon).size(9).text_color(t.dim))
  .child(div().text_size(T_XS).text_color(t.muted).child(String(n)));

const labelPill = (t, text, color, { tip, shrink = false } = {}) => h_flex().flex_none().h(16).px(2).items_center().rounded(4)
  .when(shrink, (el) => el.flex_shrink_1().min_w(0)).when(Boolean(tip), (el) => el.tooltip(tip))
  .bg(color + "26").text_size(T_XS).font_medium().text_color(color)
  .child(shrink ? div().min_w(0).truncate().child(text) : text);
const priorityPill = (t, p) => labelPill(t, p.toUpperCase(), priorityColor(t, p));
const sizeText = (t, size) => div().flex_none().text_size(T_XS).font_medium().text_color(t.muted)
  .tooltip(`Größe ${size} (hub triage)`).child(size);

const miniAction = (t, id, label, action, { enabled = true, primary = false, tip } = {}) =>
  ui.button(t, id, label, (cx) => action(cx), { kind: primary ? "primary" : "secondary", small: true, enabled, tip });

/**
 * Eine Ticket-Karte. `o`: gate, spent, limit, all (alle Tickets für blocked_by),
 * titleChars (Zeichen je Titelzeile; Standard 24), stopped, hovered, selected,
 * next ({ label, tip, run(cx) } | null; fehlt es, gibt es keine dritte Aktion),
 * raiseStep/onRaise, onHover(on, cx), onOpen(cx), onAgent(cx), onNext(cx).
 */
export function ticketCard(t, tk, o = {}) {
  const stage = stageOf(tk);
  const spent = Number(o.spent ?? 0), limit = Number(o.limit ?? 0);
  const over = spent > limit || Boolean(o.stopped);
  const blocked = blockersOf(tk, o.all ?? []);
  const labels = labelChips(t, tk);
  const prio = priorityOf(tk), size = sizeOf(tk);
  const triageOpen = !String(tk.triaged ?? "").trim() && Boolean(String(tk.source ?? "").trim());
  const flags = [];
  if (String(tk.preflight ?? "").toLowerCase() === "fail") flags.push(ui.chip(t, "Preflight ✗", t.blocked,
    { tip: `Preflight rot${tk.preflight_at ? ` · ${tk.preflight_at}` : ""}: die Basis prüft nicht (hub preflight ${tk.id})` }));
  if (triageOpen) flags.push(ui.chip(t, "Triage offen", t.working,
    { tip: `Noch nicht triagiert: hub triage ${tk.id} --apply` }));
  const comments = commentCount(tk), evidence = evidenceCount(tk);
  const hovered = Boolean(o.hovered), selected = Boolean(o.selected);
  const box = selected ? t.selected : undefined;
  const shownLabels = blocked.length ? labels.slice(0, 1) : labels;

  const ageLine = div().flex_none().text_size(T_XS).text_color(t.dim)
    .tooltip(`${stageAge(tk)} · zuletzt bearbeitet ${updatedStamp(tk)}`).child(ageText(tk).replace(" ", ""));

  // Die Labels bekommen den freien Platz und schrumpfen; die Zahl der übrigen steht
  // als eigener Chip, nie als abgeschnittener Text.
  const labelRow = h_flex().flex_1().min_w(0).gap(2).items_center().overflow_hidden()
    .children(shownLabels.map((l) => labelPill(t, l.text, l.color, { tip: l.tip, shrink: !l.fixed })));
  const row1 = h_flex().gap(2).items_center().min_w(0)
    .child(h_flex().flex_none().h(18).px(3).items_center().rounded(4).bg(t.raised)
      .text_size(T_XS).font_medium().font_family(settings().font_family).text_color(t.muted)
      .tooltip(`Ticket ${tk.id}`).child(shortId(tk.id)))
    .when(Boolean(prio), (el) => el.child(priorityPill(t, prio)))
    .when(Boolean(size), (el) => el.child(sizeText(t, size)))
    .child(labelRow)
    .when(blocked.length > 0, (el) => el.child(ui.chip(t, `gesperrt: ${blocked.map((b) => shortId(b.id)).join(", ")}`, t.blocked,
      { tip: `Sperre: ${blocked.map((b) => `${b.id} (${b.status ?? "unbekannt"})`).join(", ")}` })))
    .when(comments > 0, (el) => el.child(countIcon(t, ICON_COMMENT, comments, `${comments} Kommentare im ## Verlauf`)))
    .when(evidence > 0, (el) => el.child(countIcon(t, ICON_EVIDENCE, evidence, `${evidence} Nachweise (evidence)`)))
    .child(ageLine);

  // Zwei Zeilen mit „…"; die Zeichenzahl kommt aus der Kartenbreite (board) oder
  // bleibt beim Standard für die Team-Spalte.
  const title = div().id(`tk-title-${tk.id}`).w_full().max_h(30).overflow_hidden().text_size(T_M).font_semibold()
    .line_height(1.2).text_color(stage === "done" ? t.muted : t.foreground).child(clampTitle(tk.title || tk.id, o.titleChars));

  const who = whoChip(t, tk);
  const gates = gateIcons(t, tk, o.gate);
  // Eine Zeile: Identität (nur wenn zugewiesen), Gates, Kosten. Kein Umbruch, damit
  // die Kosten nicht in eine zweite Zeile rutschen; leere Gates fallen weg.
  const row3 = h_flex().gap(GAP_XS).items_center().min_w(0).flex_none()
    .when(Boolean(who), (el) => el.child(who))
    .when(Boolean(gates), (el) => el.child(gates))
    .child(div().flex_1())
    .child(div().flex_none().text_size(T_XS).text_color(over ? t.blocked : t.muted)
      .tooltip(`Kosten / Budget (${tk.agent || "Agent"}; nur omp meldet Kosten)`).child(`${usd(spent)}/${usd(limit)}`));

  const actions = h_flex().flex_wrap().gap(GAP_XS).items_center()
    .child(miniAction(t, `tk-open-${tk.id}`, "Öffnen", (cx) => o.onOpen?.(cx), { tip: "Review-Fenster im Ticket-Modus" }))
    .child(miniAction(t, `tk-agent-${tk.id}`, "Agent", (cx) => o.onAgent?.(cx),
      { enabled: Boolean(tk.terminal), tip: tk.terminal ? "Zum Terminal des Agents" : "Kein Agent-Terminal im Ticket" }))
    .when(Boolean(o.next) && !o.next.open, (x) => x.child(miniAction(t, `tk-next-${tk.id}`, o.next.label, (cx) => o.onNext?.(cx), { tip: o.next.tip })))
    .when(Boolean(o.onRaise), (x) => x.child(miniAction(t, `tk-raise-${tk.id}`, `+${usd(o.raiseStep ?? 3)}`, (cx) => o.onRaise(cx),
      { tip: "Budget dieses Tickets erhöhen; der Agent macht weiter" })));

  const hover = v_flex().gap(GAP_XS).pt(2).border_t(1).border_color(t.border)
    .child(div().flex_none().min_w(0).truncate().text_size(T_XS).font_family(settings().font_family)
      .text_color(t.dim).tooltip(tk.branch || tk.repo || "kein Branch")
      .child(tk.branch || String(tk.repo ?? "").split("/").filter(Boolean).pop() || "kein Branch"))
    // Alter in der Stufe steht schon in Zeile 1 (ageText); hier kommen Erstellung und
    // letzte Bearbeitung dazu, damit die Karte wie ein Arbeitsobjekt liest. Die Zeile
    // bricht in schmalen Spalten um, statt „zuletzt …" abzuschneiden.
    .child(div().flex_none().w_full().text_size(T_XS).text_color(t.muted)
      .tooltip(`erstellt ${tk.created || "unbekannt"} · zuletzt bearbeitet ${updatedStamp(tk)}`)
      .child(`erstellt ${ui.age(tk.created) || "unbekannt"} · zuletzt ${ui.age(tk.updated) || "unbekannt"}`))
    .child(actions);

  return v_flex().id(`tk-${tk.id}`).relative().flex_none().p(8).gap(GAP_XS).rounded(8)
    .bg(box ?? t.surface).border_1()
    .border_color(selected ? t.accent : blocked.length ? t.blocked : t.border)
    .cursor_pointer().hover((s) => s.bg(box ?? t.hover))
    .tooltip(`${stageLabel(stage)} · ${stageAge(tk)} · zuletzt bearbeitet ${updatedStamp(tk)}`)
    .on_hover((on, cx) => o.onHover?.(on, cx))
    .on_click((_e, cx) => o.onOpen?.(cx))
    .child(row1).child(title)
    .when(flags.length > 0, (el) => el.child(h_flex().gap(2).items_center().children(flags)))
    .child(row3)
    .when(hovered, (el) => el.child(hover));
}
