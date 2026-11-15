// Die Ticket-Karte (Board und Team-Panel), kompakt für ein Kanban: Zeile 1 ID-Chip,
// Labels und Alter; Titel über zwei Zeilen; Zeile 3 Identität, Gates als Symbole,
// Kommentar-/Nachweis-Zahlen und Kosten. Statuswort, Bearbeitungszeit und die Stufen-
// Dauer stehen im Spaltenkopf bzw. im Tooltip. Beim Hover kommen Branch und die
// Aktionen Öffnen / Agent (dazu die nächste erlaubte Stufe) hinzu.
//
// Herdr kennt kein Modul über Mod-Ordner hinweg: dieselbe Karte steht als Kopie in
// mods/orchestra/hubview.js (ticketCard). Änderungen immer in beiden Dateien.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, shared, terminals } from "herdr";
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

// Ticket-Zeitstempel sind "JJJJ-MM-TT HH:MM" (lokal).
export function at(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(ts ?? ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
}

const STAGE_AGE = { todo: "geplant", doing: "in Arbeit", review: "in Prüfung", done: "fertig" };
const shortDur = (min) => (min < 1 ? "jetzt" : min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`);
const minutesSince = (ts) => {
  const ms = at(ts);
  return ms ? Math.max(0, Math.round((Date.now() - ms) / 60000)) : null;
};
const stageAge = (tk, stage) => {
  const min = minutesSince(tk.status_at || tk.updated || tk.created);
  return min == null ? "Stufe unbekannt" : `${STAGE_AGE[stage]} seit ${shortDur(min)}`;
};
const ageText = (tk) => {
  const min = minutesSince(tk.status_at || tk.updated || tk.created);
  return min == null ? "—" : shortDur(min);
};
const updatedStamp = (tk) => String(tk.updated || "nie bearbeitet");

// Zwei Zeilen mit Auslassungszeichen an einer Wortgrenze.
const clampTitle = (s, n = 34) => {
  const text = String(s ?? "");
  if (text.length <= n) return text;
  const cut = text.slice(0, n - 1), space = cut.lastIndexOf(" ");
  return `${(space > n * 0.55 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

const PRIO = /^(p[0-3]|prio[-:]?[0-3]|kritisch|hoch|urgent)$/i;
function labelChips(t, tk) {
  const labels = [...new Set([...splitList(tk.labels), ...splitList(tk.tags)])];
  const prio = labels.filter((l) => PRIO.test(l));
  const rest = labels.filter((l) => !PRIO.test(l));
  const out = prio.map((l) => ({ text: l.toUpperCase(), color: /^(p0|prio[-:]?0|kritisch|urgent)$/i.test(l) ? t.blocked : t.working }));
  for (const l of rest.slice(0, Math.max(0, 2 - out.length))) out.push({ text: l, color: t.muted });
  const more = labels.length - out.length;
  if (more > 0) out.push({ text: `+${more}`, color: t.dim });
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
  return h_flex().flex_none().gap(2).items_center().children(gateState(tk, gate).map((g) => {
    const color = g.state === "pass" ? t.done : g.state === "fail" ? t.blocked : g.state === "run" ? t.working : t.dim;
    const icon = g.state === "run" ? ICON_SPIN : g.state === "pass" ? ICON_CHECK : g.state === "fail" ? ICON_X : ICON_MINUS;
    return div().id(`tk-gate-${g.key}-${tk.id}`).size(11).flex_none().flex().items_center().justify_center()
      .tooltip(g.tip).child(svg(icon).size(11).text_color(color).when(g.state === "run", (el) => el.spin(900)));
  }));
}

// Avatar 16 + Vorname; der volle Name steht im Tooltip.
function whoChip(t, tk) {
  const live = tk.terminal ? ui.identity(tk.terminal) : null;
  const name = live?.name || String(tk.assignee || tk.agent || "").trim();
  if (!name) return h_flex().flex_none().h(22).px(4).items_center().gap(3).rounded(4).bg(t.raised)
    .tooltip("Kein Agent zugewiesen").child(div().text_size(T_XS).text_color(t.dim).child("niemand"));
  const known = live?.avatar ? live : Object.values(shared("agents.identity") ?? {}).find((x) => x && x.name === name);
  return h_flex().flex_none().max_w(70).h(22).px(4).gap(3).items_center().rounded(4).bg(t.raised).tooltip(name)
    .when(Boolean(known?.avatar), (el) => el.child(image(known.avatar).w(16).h(16).flex_none()))
    .child(div().min_w(0).truncate().text_size(T_XS).text_color(t.muted).child(name.split(" ")[0]));
}

const countIcon = (t, icon, n, tip) => h_flex().flex_none().gap(1).items_center().tooltip(tip)
  .child(svg(icon).size(9).text_color(t.dim))
  .child(div().text_size(T_XS).text_color(t.muted).child(String(n)));

const labelPill = (t, text, color) => h_flex().flex_none().h(16).px(3).items_center().rounded(4)
  .bg(color + "26").text_size(T_XS).font_medium().text_color(color).child(text);

const miniAction = (t, id, label, action, { enabled = true, primary = false, tip } = {}) =>
  ui.button(t, id, label, (cx) => action(cx), { kind: primary ? "primary" : "secondary", small: true, enabled, tip });

/**
 * Eine Ticket-Karte. `o`: gate, spent, limit, all (alle Tickets für blocked_by),
 * stopped, hovered, selected, next ({ label, tip, run(cx) } | null; fehlt es, gibt
 * es keine dritte Aktion), raiseStep/onRaise, onHover(on, cx), onOpen(cx),
 * onAgent(cx), onNext(cx).
 */
export function ticketCard(t, tk, o = {}) {
  const stage = stageOf(tk);
  const spent = Number(o.spent ?? 0), limit = Number(o.limit ?? 0);
  const over = spent > limit || Boolean(o.stopped);
  const blocked = blockersOf(tk, o.all ?? []);
  const labels = labelChips(t, tk);
  const comments = commentCount(tk), evidence = evidenceCount(tk);
  const hovered = Boolean(o.hovered), selected = Boolean(o.selected);
  const box = selected ? t.selected : undefined;
  const shownLabels = blocked.length ? labels.slice(0, 1) : labels;

  const ageLine = div().flex_none().text_size(T_XS).text_color(t.dim)
    .tooltip(`${stageAge(tk, stage)} · zuletzt bearbeitet ${updatedStamp(tk)}`).child(ageText(tk));

  const row1 = h_flex().flex_wrap().gap(3).items_center().min_w(0)
    .child(h_flex().flex_none().h(18).px(4).items_center().rounded(4).bg(t.raised)
      .text_size(T_XS).font_medium().font_family(settings().font_family).text_color(t.muted)
      .tooltip(`Ticket ${tk.id}`).child(shortId(tk.id)))
    .children(shownLabels.map((l) => labelPill(t, l.text, l.color)))
    .when(blocked.length > 0, (el) => el.child(ui.chip(t, `gesperrt: ${blocked.map((b) => shortId(b.id)).join(", ")}`, t.blocked,
      { tip: `Sperre: ${blocked.map((b) => `${b.id} (${b.status ?? "unbekannt"})`).join(", ")}` })))
    .when(comments > 0, (el) => el.child(countIcon(t, ICON_COMMENT, comments, `${comments} Kommentare im ## Verlauf`)))
    .when(evidence > 0, (el) => el.child(countIcon(t, ICON_EVIDENCE, evidence, `${evidence} Nachweise (evidence)`)))
    .child(div().flex_1())
    .child(ageLine);

  const title = div().id(`tk-title-${tk.id}`).w_full().max_h(30).overflow_hidden().text_size(T_M).font_semibold()
    .line_height(1.2).text_color(stage === "done" ? t.muted : t.foreground).child(clampTitle(tk.title || tk.id));

  const row3 = h_flex().flex_wrap().gap(GAP_XS).items_center().min_w(0)
    .child(whoChip(t, tk))
    .child(gateIcons(t, tk, o.gate))
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
    .child(actions);

  return v_flex().id(`tk-${tk.id}`).relative().flex_none().p(8).gap(GAP_XS).rounded(8)
    .bg(box ?? t.surface).border_1()
    .border_color(selected ? t.accent : blocked.length ? t.blocked : t.border)
    .cursor_pointer().hover((s) => s.bg(box ?? t.hover))
    .tooltip(`${stageLabel(stage)} · ${stageAge(tk, stage)} · zuletzt bearbeitet ${updatedStamp(tk)}`)
    .on_hover((on, cx) => o.onHover?.(on, cx))
    .on_click((_e, cx) => o.onOpen?.(cx))
    .child(row1).child(title).child(row3)
    .when(hovered, (el) => el.child(hover));
}
