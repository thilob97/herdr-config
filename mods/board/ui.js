// UI-Bausteine nach docs/ui-spec.md, Abschnitt 5 (Tokens, Bausteine). Paket B hält in
// jedem seiner Mods eine identische Kopie dieser Datei (`mods/<mod>/ui.js`): Herdr kennt
// kein Modul über Mod-Ordner hinweg. Änderungen in allen Kopien gleich nachziehen.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, shared, agents, terminals, spaces } from "herdr";

// 5.1 Abstände und Größen
export const GAP_XS = 4, GAP_S = 6, GAP_M = 8, GAP_L = 12, GAP_XL = 16;
export const INSET_PANEL = 14, INSET_CARD = 10;
export const H_HEADER = 42, H_SECTION = 28, H_ROW = 28, H_ROW2 = 44, H_BTN = 26, H_BTN_S = 22, H_INPUT = 30, H_CHIP = 18, H_BAR = 28;
// 5.2 Schrift
export const T_XS = 10.5, T_S = 11, T_M = 12, T_L = 13, T_XL = 15;
// 5.3 Radien stehen als Zahlen im Code (Chip 4, Knopf/Zeile 6, Karte/Segment 8, Panel 10),
// damit der Prüfbefehl aus Abschnitt 10 sie sieht.

const WC = "mods/workspace-chrome";
export const ICON_CLOSE = "mods/pane/close.svg";

// Titles and screens carry Nerd Font icons and emoji the UI font can't draw.
export const plain = (s) => (s ?? "").replace(/[\uE000-\uF8FF\u{10000}-\u{10FFFF}]\s*/gu, "").trim();

// ---------- Status (5.6 Statusanzeige) ----------

export const STATUS_WORD = { working: "arbeitet", blocked: "wartet", done: "fertig", idle: "ruhig", error: "Fehler" };
export const statusColor = (t, st) => (st === "error" ? t.blocked : t[st] ?? t.dim);

/** Ruhige Anzeige (shared "ui.calm", default on): keine Spinner, kein Pulsen.
 *  `false` lässt die Animationen wieder laufen; ⌘⇧A schaltet (tabs-graph.calm). */
export const calm = () => shared("ui.calm") ?? true;

/** Ein Zahlenformat für Kosten (B9): Cent unter $10, sonst ganze Dollar. */
export const usd = (n) => { const v = Number(n ?? 0); return `$${Math.abs(v) < 10 && v % 1 !== 0 ? v.toFixed(2) : Math.round(v)}`; };

// ---------- Ticket-Zeiten (Felder 7.6: created, updated, status_at, review_at) ----------

// Ticket-Zeitstempel sind "JJJJ-MM-TT HH:MM" (lokal). Alle Werte werden bei jedem
// Rendern gerechnet: kein Timer, keine Sekunden, damit nichts flackert.
export function at(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(ts ?? ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
}

/** Minuten seit `ts`; null ohne lesbaren Zeitstempel. */
export function minutesSince(ts) {
  const ms = at(ts);
  return ms ? Math.max(0, Math.round((Date.now() - ms) / 60000)) : null;
}

/** Kurze Dauer in einer Sprache, überall gleich: „gerade", „42 min", „2 h",
 *  „> 1 Tag", „3 T"; „—" ohne Zeitstempel. Alles über 24 h ist eine Untergrenze,
 *  deshalb sagt der erste Tag „> 1 Tag"; danach zählt „n T" statt des winzigen „n d". */
export const dur = (min) => (min == null ? "—"
  : min < 1 ? "gerade" : min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h`
    : Math.floor(min / 1440) < 2 ? "> 1 Tag" : `${Math.floor(min / 1440)} T`);

/** Alter eines Zeitstempels („JJJJ-MM-TT HH:MM") in derselben Sprache wie `dur`;
 *  leer ohne Zeitstempel. */
export const age = (ts) => {
  const min = minutesSince(ts);
  return min == null ? "" : dur(min);
};

/** Alter in Minuten seit einem ms-Zeitstempel (z. B. `attention.since`); leer ohne Wert. */
export const ageMs = (ms) => (ms ? dur(Math.max(0, Math.round((Date.now() - ms) / 60000))) : "");

export const STAGE_WORD = { todo: "geplant", doing: "in Arbeit", review: "in Prüfung", done: "fertig" };

/** Die Stufe des Tickets und wie lange sie gilt: { key, since, min, text }.
 *  `status_at` schreibt `hub ticket status` beim Wechsel; ältere Tickets fallen auf
 *  `updated` und `created` zurück (wie Board und Team-Panel bisher rechneten). */
export function staged(tk) {
  const key = ["todo", "review", "done"].includes(tk?.status) ? tk.status : "doing";
  const since = tk?.status_at || tk?.updated || tk?.created || null;
  const min = minutesSince(since);
  return { key, since, min, text: min == null ? "Stufe unbekannt"
    : min < 1 ? `${STAGE_WORD[key]} gerade eben` : `${STAGE_WORD[key]} seit ${dur(min)}` };
}

/** Fokus je Eingabe (5.6: mit Fokus `border(accent)`): in init `this.focus = ui.focusFields()`,
 *  je Feld `this.focus.track(state, "id")`, im Rendern `focused: this.focus.has("id")`. */
export function focusFields() {
  const on = new Set();
  const set = (id, value) => (_e, cx) => { if (value) on.add(id); else on.delete(id); cx.notify(); };
  return {
    track(state, id) { state.on("focus", set(id, true)); state.on("blur", set(id, false)); },
    has: (id) => on.has(id),
  };
}

/** Die eine Statusanzeige, Box 12×12. Ruhig: gefüllter Punkt (arbeits), Ring (wartet),
 *  Punkt (fertig), hohler Punkt (ruhig) — gleiche Größen, ohne Animation. */
export function statusIcon(t, st) {
  const box = () => div().size(12).flex_none().flex().items_center().justify_center();
  if (st === "working") return calm()
    ? box().child(div().size(7).rounded_full().bg(t.working))
    : svg(`${WC}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900);
  if (st === "blocked") return calm()
    ? box().child(div().size(7).rounded_full().border(1.5).border_color(t.blocked))
    : box().relative()
      .child(div().absolute().inset_0().rounded_full().bg(t.blocked + "55").loop("opacity", { from: 0, to: 1, period: 900 }))
      .child(div().size(7).rounded_full().bg(t.blocked));
  if (st === "done" || st === "error") return box().child(div().size(7).rounded_full().bg(statusColor(t, st)));
  return box().child(div().size(7).rounded_full().border(1.5).border_color(t.idle ?? t.dim));
}

/** Whether a run's recorded HEAD belongs to another commit than the worktree's now.
 *  Short SHAs match by prefix (`hub` records either form). No HEAD on either side: not stale. */
export const headStale = (current, recorded) => Boolean(current && recorded)
  && !(current === recorded || current.startsWith(recorded) || recorded.startsWith(current));

/** Chip mit Statuswort (h 18, Tönung 26). `color` überschreibt die Statusfarbe (z. B. t.dim). */
export function chip(t, text, color, { icon, tip, id } = {}) {
  const c = color ?? t.muted;
  return h_flex().when(Boolean(id), (el) => el.id(id)).flex_none().h(H_CHIP).px(6).gap(GAP_XS).items_center().rounded(4)
    .bg(c + "26").text_size(T_XS).font_medium().text_color(c)
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .when(Boolean(icon), (el) => el.child(svg(icon).size(12)))
    .child(text);
}
export const statusChip = (t, st, word) => chip(t, word ?? STATUS_WORD[st] ?? st ?? "", statusColor(t, st));

// ---------- Gate-Chips (5.6, Felder 7.6) ----------

/** Prüf-Gate eines Tickets: `hub verify` schreibt checks, HEAD, Dauer, Exit und den Auszug.
 *  `gate` (aus `hub gate --json`) überstimmt die Aufzeichnung, weil es den HEAD von jetzt kennt.
 *  Ohne Prüfung steht `Checks –` in `muted`; ✗ nur bei rot oder einem Commit nach dem Lauf. */
export function gateChip(t, tk, gate) {
  const ok = gate ? gate.ok : tk.checks === "pass";
  const head = (gate?.checked_head ?? tk.checks_head ?? "").slice(0, 7);
  const dur = (gate?.duration ?? tk.checks_duration) ? `${gate?.duration ?? tk.checks_duration}s` : null;
  if (ok) return chip(t, ["Checks ✓", dur, head && `HEAD ${head}`].filter(Boolean).join(" · "), t.done,
    { tip: `Checks bestanden${(gate?.at ?? tk.checks_at) ? ` · ${gate?.at ?? tk.checks_at}` : ""} (hub verify)` });
  const checks = gate ? gate.checks : tk.checks;
  const why = gate?.reason ?? (checks === "fail" ? `Checks rot (Exit ${tk.checks_exit ?? "?"})`
    : "Noch keine Prüfung");
  if (checks !== "fail" && !gate?.stale) return chip(t, "Checks –", t.muted, { tip: why });
  const short = checks === "fail" ? `Exit ${gate?.exit ?? tk.checks_exit ?? "?"}` : "neuer Commit";
  return chip(t, `Checks ✗ · ${short}`, t.blocked, { tip: why });
}

/** Prüfungs-Chip: `gate.review` (aus `hub gate`) überstimmt die Aufzeichnung,
 *  ein laufender Prüfer-Terminal geht vor (er prüft gerade eine neue Runde). */
export function reviewChip(t, tk, gate) {
  const live = tk.review_terminal
    ? terminals().find((x) => x.address === tk.review_terminal && x.state === "live") : null;
  if (live) return chip(t, "Prüfung läuft", t.working,
    { tip: `Prüfung läuft${tk.reviewer_name ? ` (${tk.reviewer_name})` : ""} · ${tk.review_terminal}` });
  const r = gate?.review ?? null;
  const verdict = r?.verdict ?? tk.review ?? null;
  const at = r?.at ?? tk.review_at, by = r?.reviewer_name || r?.reviewer || tk.reviewer_name || tk.reviewer;
  if (r?.stale) return chip(t, `Prüfung ${verdict === "fail" ? "rot" : verdict === "pass" ? "grün" : "–"} (veraltet)`, t.muted,
    { tip: r.reason || "neuer Commit seit dem Lauf — neu prüfen" });
  if (r ? r.ok : verdict === "pass") return chip(t, "Prüfung grün", t.done,
    { tip: [r?.summary || tk.review_summary, at, by].filter(Boolean).join(" · ") || "Urteil pass auf dem HEAD" });
  if (verdict === "fail") return chip(t, "Prüfung rot", t.blocked,
    { tip: r?.reason ?? (tk.review_summary ? `Prüfung rot: ${tk.review_summary}` : "Prüfung rot; Befunde im Verlauf") });
  if (verdict === "pass") return chip(t, "Prüfung grün (aufgezeichnet)", t.muted,
    { tip: r?.reason ?? "Urteil pass (aufgezeichnet)" });
  return chip(t, "Prüfung –", t.muted, { tip: "Noch kein Prüfer-Urteil: hub review-start" });
}

/** Prüfer-Chip: der Live-Terminal, sonst die beim Start ins Ticket geschriebene Identität
 *  (`reviewer_name`); `review_terminal` bleibt dem Live-Zustand vorbehalten. */
export function reviewerChip(t, id, tk, { maxW = 160, name } = {}) {
  const live = tk.review_terminal
    ? terminals().find((x) => x.address === tk.review_terminal && x.state === "live") : null;
  if (live) return div().flex_none().max_w(maxW).child(identityChip(t, id, tk.review_terminal));
  const label = name || tk.reviewer_name || tk.reviewer;
  if (!label) return null;
  return chip(t, label, t.muted,
    { tip: ["Prüfer", tk.reviewer, tk.review_terminal ? `Terminal ${tk.review_terminal}` : null].filter(Boolean).join(" · ") });
}

/** Gate-Chips eines Tickets aus orchestra.tickets: Checks, Prüfungs-Urteil, dazu Abnahme offen
 *  bzw. abgenommen (die Abnahme des Menschen). */
export function gateChips(t, tk, gate) {
  const out = [gateChip(t, tk, gate)];
  if (tk.status !== "todo") out.push(reviewChip(t, tk, gate));
  if (tk.status === "review") out.push(chip(t, "Abnahme offen", t.working, { tip: "Wartet auf deine Abnahme" }));
  else if (tk.status === "done") out.push(chip(t, "abgenommen", t.done));
  return out;
}

/** CI-Chip (5.6): pass/fail/running/unknown aus `hub ci`; `pr`/`ci_at` erklärt er im Tooltip.
 *  `stale`: the run belongs to an older HEAD than the worktree's, so it proves nothing now. */
export function ciChip(t, tk, { stale = false } = {}) {
  const [text, color] = {
    pass: ["CI ✓", t.done], fail: ["CI ✗", t.blocked],
    running: ["CI …", t.working], unknown: ["CI ?", t.muted],
  }[tk.ci] ?? ["CI –", t.muted];
  if (stale) return chip(t, `${tk.ci === "fail" ? "CI rot" : text} (veraltet)`, t.muted,
    { tip: "neuer Commit seit dem Lauf — neu prüfen" });
  return chip(t, text, color, { tip: tk.ci_at ? `PR-Checks: zuletzt geprüft ${tk.ci_at}` : "PR-Checks: noch nicht geprüft" });
}

/** Zähler-Badge: h 16, Text background auf Statusfarbe. */
export function counterBadge(t, n, color) {
  return div().flex_none().h(16).min_w(16).px(5).flex().items_center().justify_center().rounded(8)
    .bg(color).text_size(T_XS).font_semibold().text_color(t.background).child(String(n));
}

// ---------- Workspace (Fabrik je Space) ----------

/** Der aktive Workspace dieses Fensters: { id, name, folder, machine }, sonst null.
 *  `spaces()` zeichnet die Mods bei jedem Wechsel neu — kein eigener Timer nötig. */
export function activeSpace() {
  const s = spaces().find((x) => x.active) ?? null;
  return s ? { id: s.id, name: s.name ?? "", folder: s.folder ?? "", machine: s.machine ?? null } : null;
}

// ---------- Fabrik (Orchestrator) ----------

/** Ist dieses Terminal ein Orchestrator? Das Label `hub.role=orchestrator` (so setzt
 *  `hub orchestrator start` es), sonst der Name `orchestrator` oder
 *  `orchestrator-<space>` — dieselbe Regel wie `hub` (`is_orchestrator`) für `hc ls`. */
export function isOrchestrator(t) {
  if (!t) return false;
  if (t.labels?.["hub.role"] === "orchestrator") return true;
  const name = String(t.name ?? "");
  return name === "orchestrator" || name.startsWith("orchestrator-");
}

const pathKey = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

/** Der Workspace eines Tickets, wie `mods/dashboard/spaces.js` (dort die Quelle der
 *  Wahrheit): `space` samt `space_name`, sonst der Space, dessen Ordner sein `repo`
 *  enthält; "" heißt „ohne Workspace". */
export function ticketWorkspace(tk) {
  const sid = String(tk?.space ?? "").trim();
  if (sid && String(tk?.space_name ?? "").trim()) return sid;
  const repo = pathKey(tk?.repo);
  if (!repo) return "";
  const hits = spaces().filter((s) => s.folder && inside(repo, pathKey(s.folder))
    && (!tk.machine || s.machine === tk.machine));
  return hits.sort((x, y) => pathKey(y.folder).length - pathKey(x.folder).length)[0]?.id ?? "";
}

/** Die Space-ID, zu der ein Space gehört. Ein Agent-Space ist der Wegwerf-Space eines
 *  Tickets: sein `agent_space` (ältere Auslieferungen: ein Terminal mit `hub.ticket`)
 *  nennt das Ticket, dessen Workspace gilt. Jeder andere Space ist sein eigener. Ein
 *  Space, den ein Ticket als Workspace nennt, bleibt Workspace — wie `hub spaces`. */
const WS_CACHE = { tks: null, map: new Map() };
export function workspaceId(sid) {
  const id = String(sid ?? "").trim();
  if (!id) return "";
  const tks = shared("orchestra.tickets") ?? [];
  // Der Cache hängt an der Ticket-Liste (ein neues Array ungültigt); Kopfzeilen
  // (Budget, Messwerte) scannen so nicht jedes Mal 70 Tickets × alle Spaces
  // erneut — das Rendern kommt schneller zurück und wird seltener unterbrochen.
  if (WS_CACHE.tks !== tks) { WS_CACHE.tks = tks; WS_CACHE.map = new Map(); }
  const hit = WS_CACHE.map.get(id);
  if (hit !== undefined) return hit;
  let ws = id;
  if (tks.some((t) => String(t?.space ?? "").trim() === id && String(t?.space_name ?? "").trim())) ws = id;
  else {
    const mine = tks.find((t) => String(t?.agent_space ?? "").trim() === id);
    if (mine) {
      const tk_ws = ticketWorkspace(mine);
      if (tk_ws && tk_ws !== id) ws = tk_ws;
    } else {
      for (const x of terminals()) {
        if ((x.space ?? x.labels?.["herdr.space"]) !== id) continue;
        const tk = tks.find((t) => t?.id === x.labels?.["hub.ticket"]);
        const tk_ws = tk ? ticketWorkspace(tk) : "";
        if (tk_ws && tk_ws !== id) { ws = tk_ws; break; }
      }
    }
  }
  WS_CACHE.map.set(id, ws);
  return ws;
}

/** Der Workspace eines Agenten: der seines Tickets — auch eines erledigten —, sonst
 *  der seines Herdr-Space; "" ohne beides. */
export function agentWorkspace(a) {
  const tks = shared("orchestra.tickets") ?? [];
  const tk = tks.find((t) => t?.terminal && t.terminal === a?.address);
  return (tk ? ticketWorkspace(tk) : "") || workspaceId(a?.space ?? a?.space_id ?? "");
}

/** Gehört das Ticket zur Fabrik des aktiven Workspace?
 *  - ohne aktiven Space: ja (dann gibt es nichts zu filtern),
 *  - ohne `space`: Altbestand, bleibt sichtbar,
 *  - im eigenen Workspace: ja (ein Agent-Space zählt als der Workspace seines Tickets),
 *  - mit `space_name`: eine andere Fabrik,
 *  - altes `space` ohne `space_name` (damals der Agent-Space): über `repo` im Space-Ordner.
 *  So zeigt keine Liste fremde Fabriken, und nichts Altes fällt still heraus. */
export function inScope(tk) {
  const sp = activeSpace();
  if (!sp || !tk) return true;
  const sid = String(tk.space ?? "").trim();
  if (!sid) return true;
  if (workspaceId(sid) === workspaceId(sp.id)) return true;
  if (String(tk.space_name ?? "").trim()) return false;
  const repo = pathKey(tk.repo), folder = pathKey(sp.folder);
  return !repo || !folder ? true : inside(repo, folder);
}

/** Ruhiger Bereichs-Chip im Kopf: „<Space-Name>“, Tooltip „Fabrik dieses Workspace“.
 *  Der Name kürzt sich (max_w), damit er bei schmalem Panel nie die Zeile sprengt. */
export function spaceChip(t, { maxW = 140 } = {}) {
  const sp = activeSpace();
  if (!sp) return null;
  return h_flex().id("space-scope").flex_none().max_w(maxW).h(H_CHIP).px(6).gap(GAP_XS).items_center().rounded(4)
    .bg(t.muted + "26").text_size(T_XS).font_medium().text_color(t.muted).tooltip("Fabrik dieses Workspace")
    .child(div().min_w(0).truncate().child(sp.name || "Ohne Space"));
}

// ---------- Knöpfe (5.6 Knöpfe) ----------

const stop = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());

/** Text-Knopf. kind: "primary" | "secondary"; small: in Zeilen und Karten (h 22). */
export function button(t, id, label, action, { kind = "secondary", small = false, enabled = true, tip, icon } = {}) {
  const primary = kind === "primary";
  return stop(h_flex().id(id).flex_none().h(small ? H_BTN_S : H_BTN).px(10).gap(GAP_XS).items_center().justify_center().rounded(6).text_size(T_M).font_medium()
    .bg(!enabled ? t.raised : primary ? t.solid : t.raised)
    .text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .when(enabled, (el) => el.cursor_pointer()
      .hover((s) => (primary ? s.opacity(0.85) : s.bg(t.hover)))
      .on_click((e, cx) => { cx.stop_propagation(); action(cx, e); }))
    .when(Boolean(icon), (el) => el.child(svg(icon).size(14)))
    .child(label));
}

/** Icon-Knopf: 26 in Leisten/Köpfen, 22 (small) in Zeilen. Tooltip Pflicht. */
export function iconButton(t, id, icon, tip, action, { small = false, enabled = true, active = false } = {}) {
  const s = small ? H_BTN_S : H_BTN;
  return stop(div().id(id).size(s).flex_none().flex().items_center().justify_center().rounded(6)
    .text_color(!enabled ? t.dim : active ? t.foreground : t.dim).tooltip(tip)
    .when(active, (el) => el.bg(t.selected))
    .when(enabled, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
      .on_click((e, cx) => { cx.stop_propagation(); action(cx, e); }))
    .when(!enabled, (el) => el.opacity(0.5))
    .child(svg(icon).size(small ? 12 : 14)));
}

/** Link: nur Text T_S, dim, hover foreground. */
export function link(t, id, label, action, { tip } = {}) {
  return stop(div().id(id).flex_none().text_size(T_S).text_color(t.dim).cursor_pointer()
    .hover((s) => s.text_color(t.foreground)).when(Boolean(tip), (el) => el.tooltip(tip))
    .on_click((e, cx) => { cx.stop_propagation(); action(cx, e); }).child(label));
}

/** Segment (Umschalter). items: [{ value, label, tip? }]. */
export function segment(t, id, items, value, onPick) {
  return h_flex().id(id).flex_none().h(H_BTN).p(2).gap(2).items_center().rounded(8).bg(t.background).border_1().border_color(t.border)
    .children(items.map((it) => {
      const on = it.value === value;
      return stop(div().id(`${id}-${it.value}`).h(22).px(8).flex().items_center().rounded(6).text_size(T_S)
        .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected))
        .when(Boolean(it.tip), (el) => el.tooltip(it.tip))
        .when(!on, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => onPick(it.value, cx)))
        .child(it.label));
    }));
}

// ---------- Köpfe (5.6 Panel-Kopf, Fenster, Dialog, Sektionskopf) ----------

/** Panel-Kopf: h 42, px 14, Titel T_L semibold, optional Zähler, rechts `right` (Elemente). */
export function panelHeader(t, title, right = [], { count } = {}) {
  return h_flex().h(H_HEADER).flex_none().px(INSET_PANEL).gap(GAP_M).items_center().border_b(1).border_color(t.border)
    .child(div().flex_none().text_size(T_L).font_semibold().text_color(t.foreground).child(title))
    .when(count != null, (el) => el.child(div().text_size(T_XS).text_color(t.dim).child(String(count))))
    .child(div().flex_1())
    .children(right);
}

/** Fenster-Titelzeile: wie Panel-Kopf, bg chrome, als letztes Schließen. */
export function windowHeader(t, title, right = [], onClose, { meta, metaTip } = {}) {
  return h_flex().h(H_HEADER).flex_none().px(INSET_PANEL).gap(GAP_M).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .child(div().flex_none().text_size(T_L).font_semibold().text_color(t.foreground).child(title))
    .when(Boolean(meta), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.muted)
      .when(Boolean(metaTip), (x) => x.tooltip(metaTip)).child(meta)))
    .when(!meta, (el) => el.child(div().flex_1()))
    .children(right)
    .child(iconButton(t, "win-close", ICON_CLOSE, "Schließen", () => onClose()));
}

/** Dialog/Popup-Titelzeile: h 28, Titel T_XL, Meta T_S muted, Tastenhinweise T_XS dim, Chip „Esc“. */
export function dialogHeader(t, title, onClose, { meta, hints } = {}) {
  return h_flex().h(28).flex_none().gap(GAP_M).items_center()
    .child(div().flex_none().text_size(T_XL).font_semibold().text_color(t.foreground).child(title))
    .when(meta != null, (el) => el.child(div().flex_none().text_size(T_S).text_color(t.muted).child(meta)))
    .child(div().flex_1())
    .when(Boolean(hints), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.dim).child(hints)))
    .child(stop(div().id("dlg-esc").flex_none().h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Schließen (Esc)")
      .on_click((_e, cx) => { cx.stop_propagation(); onClose(); }).child("Esc")));
}

/** Sektionskopf: h 28, T_S medium, Zähler dim, rechts optional `right` (Icon-Knopf 22 oder Chevron). */
export function sectionHeader(t, text, { count, color, right, px = 0, id, onClick, open } = {}) {
  const head = h_flex().when(Boolean(id), (el) => el.id(id)).h(H_SECTION).flex_none().px(px).gap(GAP_S).items_center().text_size(T_S).font_medium()
    .child(div().text_color(color ?? t.muted).child(text))
    .when(count != null, (el) => el.child(div().text_color(t.dim).child(String(count))))
    .child(div().flex_1())
    .when(open != null, (el) => el.child(svg(`${WC}/${open ? "chevron-down" : "chevron-right"}.svg`).size(12).text_color(t.dim)))
    .when(Boolean(right), (el) => el.child(right));
  return onClick ? head.cursor_pointer().on_click((_e, cx) => onClick(cx)) : head;
}

// ---------- Karte, Eingabe, Leerzustand ----------

/** Karte: p 10, gap 6, radius 8, surface, border; Fokus/Hervorhebung über `border`. */
export function card(t, id, { border } = {}) {
  return v_flex().id(id).flex_none().p(INSET_CARD).gap(GAP_S).rounded(8).bg(t.surface).border_1().border_color(border ?? t.border);
}

/** Rahmen eines Eingabefelds (h 30, px 10, radius 6). `input`: Input.new(state) o. ä.; `send`: optionaler Senden-Knopf (Icon 22, Primärfarben). */
export function inputBox(t, id, input, { focused = false, send } = {}) {
  return h_flex().id(id).h(H_INPUT).flex_none().pl(10).pr(send ? 4 : 10).gap(GAP_S).items_center().rounded(6)
    .bg(t.background).border_1().border_color(focused ? t.accent : t.input)
    .child(input.flex_1().h_full().text_size(T_M).text_color(t.foreground))
    .when(Boolean(send), (el) => el.child(send));
}

/** Senden-Knopf innen im Eingabefeld: Icon-Knopf 22 in Primärfarben. */
export function sendButton(t, id, icon, tip, action, { enabled = true } = {}) {
  return stop(div().id(id).size(H_BTN_S).flex_none().flex().items_center().justify_center().rounded(6)
    .bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).tooltip(tip)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }))
    .child(svg(icon).size(12)));
}

/** Leerzustand einer ganzen Fläche (mittig) bzw. einer Sektion (`row: true`, eine Zeile h 28). */
export function empty(t, text, { icon, row = false, action } = {}) {
  if (row) return div().h(H_ROW).flex_none().flex().items_center().text_size(T_S).text_color(t.dim).child(text);
  return v_flex().flex_1().size_full().gap(GAP_M).items_center().justify_center().p(GAP_XL)
    .when(Boolean(icon), (el) => el.child(svg(icon).size(16).text_color(t.dim)))
    .child(div().text_size(T_S).text_color(t.dim).text_center().child(text))
    .when(Boolean(action), (el) => el.child(action));
}

/** Wartezustand: Spinner 12 + „lädt …“; ruhig als „…“ statt Animation. */
export const loading = (t, text = "lädt …") => h_flex().gap(GAP_S).items_center().text_size(T_S).text_color(t.dim)
  .child(calm() ? div().size(12).flex_none().flex().items_center().justify_center().child("…")
    : svg(`${WC}/spinner.svg`).size(12).text_color(t.dim).spin(900)).child(text);

// ---------- Identität (7.1) und Identitäts-Chip (5.6) ----------

/** Wer hinter einer Adresse steckt: Name und Avatar ausschließlich aus
 *  shared("agents.identity"). Fehlt der Name, steht `name` als Programm-Kürzel
 *  (`omp` klein) bzw. als Adresse — nie der Programmname („Oh My Pi") — und
 *  `named: false` sagt, dass es keine veröffentlichte Identität ist. */
export function identity(address) {
  const a = agents().find((x) => x.address === address) ?? null;
  const x = a ? null : terminals().find((y) => y.address === address && y.state === "live") ?? null;
  const known = (shared("agents.identity") ?? {})[address];
  const program = a?.program ?? x?.program ?? null;
  const programKey = program?.key ? String(program.key).toLowerCase() : null;
  return {
    address,
    name: known?.name ?? programKey ?? address,
    named: Boolean(known?.name),
    avatar: known?.avatar ?? null,
    program,
    programKey,
    status: a?.status ?? x?.status ?? null,
    pane: a?.pane ?? null,
    space: a?.space_name ?? (x?.where ?? "").split(" / ")[0] ?? "",
    live: Boolean(a || x),
  };
}

/** Klick auf eine Agent-Identität: Pane fokussieren, ohne Pane `terminal.peek`. */
export function focusAgent(address) {
  const a = agents().find((x) => x.address === address);
  if (a?.pane) run("pane.focus", { pane: a.pane });
  else run("terminal.peek", { terminal: address });
}

/** Identitäts-Chip: h 22, Avatar 16 (sonst Programm-Icon), Name T_S, Statusanzeige; Klick fokussiert.
 *  Nur ein Name aus shared("agents.identity") ist eine Identität; sonst steht das
 *  Programm-Kürzel klein und gedämpft (`omp`, „Programm, kein laufender Agent"). */
export function identityChip(t, id, address, { status } = {}) {
  const who = identity(address);
  const st = status !== undefined ? status : who.status;
  const p = who.program;
  const label = who.named ? who.name : who.programKey ?? address;
  const pic = who.named && who.avatar ? image(who.avatar).w(16).h(16).flex_none()
    : p?.icon ? (p.tint ? svg(p.icon).size(16).flex_none().text_color(t.muted) : image(p.icon).w(16).h(16).flex_none())
      : null;
  const tip = who.named ? [p?.name, who.space, address].filter(Boolean).join(" · ")
    : who.programKey ? `Programm${who.live ? " ohne veröffentlichte Identität" : ", kein laufender Agent"} · ${address}`
      : address;
  return stop(h_flex().id(id).flex_none().min_w(0).h(H_BTN_S).px(6).gap(GAP_XS).items_center().rounded(6).bg(t.raised)
    .tooltip(tip).when(who.live, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stopPropagation?.(); focusAgent(address); }))
    .when(Boolean(pic), (el) => el.child(pic))
    .child(div().min_w(0).truncate().text_size(T_S).text_color(who.named && who.live ? t.foreground : t.dim)
      .child(who.named && !who.live ? `${label} (beendet)` : label))
    .when(Boolean(st), (el) => el.child(statusIcon(t, st))));
}
