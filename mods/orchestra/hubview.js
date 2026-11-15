// The orchestrator in the Team panel (HubSection: its compact card and the ticket
// pipeline) and its watcher (HubDaemon). HubDaemon runs in a 0px block of the elric
// layout, so it works while the panel is closed: it starts the orchestrator when none
// runs (unless stopped by hand), publishes the orchestrator's tickets as shared
// "orchestra.tickets", and says when a ticket is ready for review or the orchestrator
// ends a turn. The panel republishes the tickets too (without notifications), so it is
// current even where no daemon runs.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, notify, playSound, openOverlay, shared, setShared, knownAgents, terminals, exec, appHome, settings } from "herdr";
import * as orch from "./orchestrator.js";
import * as tickets from "./tickets.js";
import * as costs from "./costs.js";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M, T_L, usd } from "./ui.js";

const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");
const WC = "mods/workspace-chrome";
const HUB = () => `${appHome()}/mods/orchestra/bin/hub`;
// At most two lines of T_S text in the panel's width.
const clip = (s, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// The pipeline: ticket status → stage, in the order work moves.
export const STAGES = [
  { key: "todo", label: "Geplant" },
  { key: "doing", label: "In Arbeit" },
  { key: "review", label: "Prüfung" },
  { key: "done", label: "Fertig" },
];
export const stageOf = (tk) => (["todo", "review", "done"].includes(tk.status) ? tk.status : "doing");
const stageLabel = (key) => STAGES.find((s) => s.key === key)?.label ?? "In Arbeit";

// ---------- Ticket-Karte (Kopie aus mods/board/card.js: Herdr kennt kein Modul über
// Mod-Ordner hinweg; Optik und Verhalten müssen in beiden Dateien gleich bleiben.
// Einzige Ausnahme: Zeile 1 zeigt hier „in <Stufe> seit …" statt der nackten Dauer,
// weil das Team-Panel die Stufe nicht wie das Board im Spaltenkopf hat) ----------

const STOP = new Set(["und", "im", "in", "der", "die", "das", "ein", "eine", "zu", "mit", "fur", "für", "von", "the", "a", "an", "of"]);
const shortId = (id) => {
  const raw = String(id ?? "");
  const num = /(\d+)$/.exec(raw)?.[1];
  const words = raw.split("-").filter((p) => p && !STOP.has(p));
  let s = (words[0] || raw).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  if (num && !s.endsWith(num)) s = `${s.slice(0, 6)}-${num}`;
  return s || "TICKET";
};
const splitList = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map((s) => String(s).trim()).filter(Boolean);
// Ticket-Zeiten (erstellt, Stufe, zuletzt) rechnet ui.js. Das Team-Panel zeigt in
// Zeile 1 „in <Stufe> seit …" statt der nackten Dauer des Boards.
const stageAge = (tk) => ui.staged(tk).text;
const updatedStamp = (tk) => String(tk.updated || "nie bearbeitet");
const PRIO = /^(p[0-3]|prio[-:]?[0-3]|kritisch|hoch|urgent)$/i;
// Die Triage schreibt p1..p3 als eigenes Feld (und Label); die Karte zeigt einen Chip.
function priorityOf(tk) {
  const field = String(tk.priority ?? "").trim().toLowerCase();
  const fromField = /^p?([123])$/.exec(field)?.[1];
  if (fromField) return `p${fromField}`;
  const label = [...splitList(tk.labels), ...splitList(tk.tags)].find((l) => PRIO.test(l));
  if (!label) return null;
  const n = /([123])$/.exec(label)?.[1];
  return n ? `p${n}` : "p1";
}
const priorityColor = (t, p) => (p === "p1" ? t.blocked : p === "p2" ? t.working : t.muted);
const sizeOf = (tk) => (/^[SML]$/i.test(String(tk.size ?? "").trim()) ? String(tk.size).trim().toUpperCase() : null);
// Höchstens zwei Labels; die Priorität steht als eigener Chip davor.
const labelChips = (t, tk) => {
  const ordered = [...new Set([...splitList(tk.labels), ...splitList(tk.tags)])].filter((l) => !PRIO.test(l));
  const shown = ordered.slice(0, ordered.length > 2 ? 1 : 2);
  const out = shown.map((l) => ({ text: l.length > 8 ? `${l.slice(0, 7)}…` : l, color: t.muted }));
  if (ordered.length > shown.length) out.push({ text: `+${ordered.length - shown.length} mehr`, color: t.dim });
  return out;
};
const blockersOf = (tk, all = []) => splitList(tk.blocked_by).map((id) => ({ id, status: all.find((x) => x.id === id)?.status ?? null }))
  .filter((b) => b.status !== "done");
// Titel auf zwei Zeilen mit „…" an einer Wortgrenze. `per` ist die Zeichenzahl je
// Zeile; passt der Text in zwei Zeilen, bleibt er unverändert.
const clampTitle = (s, per = 24) => {
  const text = String(s ?? "").replace(/\s+/g, " ").trim();
  const width = Math.max(8, Math.floor(per));
  if (text.length <= width * 2) return text;
  const words = text.split(" ");
  const lines = [];
  let i = 0;
  for (let li = 0; li < 2 && i < words.length; li++) {
    if (words[i].length > width) {
      lines.push(words[i].slice(0, width));
      words[i] = words[i].slice(width);
      continue;
    }
    let line = words[i++];
    while (i < words.length && `${line} ${words[i]}`.length <= width) line += ` ${words[i++]}`;
    lines.push(line);
  }
  if (i >= words.length) return lines.join(" ");
  while (lines[1].length + 1 > width && lines[1].includes(" ")) lines[1] = lines[1].slice(0, lines[1].lastIndexOf(" "));
  return `${lines[0]} ${lines[1]}…`;
};
const evidenceCount = (tk) => (Array.isArray(tk.evidence) ? tk.evidence.length : splitList(tk.evidence).length);
const commentCount = (tk) => Number(tk.comments ?? tk.verlauf?.length ?? 0);
const liveReview = (tk) => (tk.review_terminal ? terminals().find((x) => x.address === tk.review_terminal && x.state === "live") : null);

const ICON_CHECK = `${WC}/check.svg`, ICON_X = `${WC}/x.svg`, ICON_MINUS = `${WC}/minus.svg`;
const ICON_SPIN = `${WC}/spinner.svg`, ICON_COMMENT = `${WC}/square-pen.svg`, ICON_EVIDENCE = `${WC}/file-text.svg`;

const gateState = (tk, gate) => {
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
};

const gateIcons = (t, tk, gate) =>
  h_flex().flex_none().gap(2).items_center().children(gateState(tk, gate).map((g) => {
    const color = g.state === "pass" ? t.done : g.state === "fail" ? t.blocked : g.state === "run" ? t.working : t.dim;
    const icon = g.state === "run" ? ICON_SPIN : g.state === "pass" ? ICON_CHECK : g.state === "fail" ? ICON_X : ICON_MINUS;
    return div().id(`tk-gate-${g.key}-${tk.id}`).size(11).flex_none().flex().items_center().justify_center()
      .tooltip(g.tip).child(svg(icon).size(11).text_color(color).when(g.state === "run", (el) => el.spin(900)));
  }));

// Vorname; der volle Name steht im Tooltip. Ohne Zuweisung kein Chip. Kein Avatar:
// die Zeile muss neben Gates und Kosten in eine schmale Karte passen.
const whoChip = (t, tk) => {
  const live = tk.terminal ? ui.identity(tk.terminal) : null;
  const name = live?.name || String(tk.assignee || tk.agent || "").trim();
  if (!name) return null;
  return h_flex().flex_none().max_w(52).h(22).px(4).items_center().rounded(4).bg(t.raised).tooltip(name)
    .child(div().min_w(0).truncate().text_size(T_XS).text_color(t.muted).child(name.split(" ")[0]));
};
const countIcon = (t, icon, n, tip) => h_flex().flex_none().gap(1).items_center().tooltip(tip)
  .child(svg(icon).size(9).text_color(t.dim))
  .child(div().text_size(T_XS).text_color(t.muted).child(String(n)));
const labelPill = (t, text, color) => h_flex().flex_none().h(16).px(2).items_center().rounded(4)
  .bg(color + "26").text_size(T_XS).font_medium().text_color(color).child(text);
const priorityPill = (t, p) => labelPill(t, p.toUpperCase(), priorityColor(t, p));
const sizeText = (t, size) => div().flex_none().text_size(T_XS).font_medium().text_color(t.muted)
  .tooltip(`Größe ${size} (hub triage)`).child(size);
// Preflight-Zustand als Zeichen neben den Gates: ✓ bestanden, ! rot, – nicht gelaufen.
const preflightMark = (t, tk) => {
  const state = String(tk.preflight ?? "").toLowerCase();
  const mark = state === "pass" ? "✓" : state === "fail" ? "!" : "–";
  const color = state === "pass" ? t.done : state === "fail" ? t.blocked : t.dim;
  const tail = state === "fail" ? ` · ${tk.preflight_at || ""} (hub preflight ${tk.id})`
    : state === "pass" ? (tk.preflight_at ? ` · ${tk.preflight_at}` : "") : ` (hub preflight ${tk.id})`;
  return div().id(`tk-preflight-${tk.id}`).flex_none().h(11).min_w(10).text_center().text_size(T_XS).font_semibold()
    .text_color(color).tooltip(`Preflight: ${state === "pass" ? "bestanden" : state === "fail" ? "rot" : "noch nicht gelaufen"}${tail}`)
    .child(mark);
};
const miniAction = (t, id, label, action, { enabled = true, primary = false, tip } = {}) =>
  ui.button(t, id, label, (cx) => action(cx), { kind: primary ? "primary" : "secondary", small: true, enabled, tip });

// Dieselbe Karte wie mods/board/card.js (ticketCard): ID, höchstens zwei Labels,
// Alter, zweizeiliger Titel, Identität, Gate-Symbole, Kommentar-/Nachweis-Zahlen,
// Kosten und bei blocked_by ein Sperr-Chip; Hover mit Branch, Öffnen und Agent.
function ticketCard(t, tk, o = {}) {
  const stage = stageOf(tk);
  const spent = Number(o.spent ?? 0), limit = Number(o.limit ?? 0);
  const over = spent > limit || Boolean(o.stopped);
  const blocked = blockersOf(tk, o.all ?? []);
  const labels = labelChips(t, tk);
  const prio = priorityOf(tk), size = sizeOf(tk);
  const triageOpen = !String(tk.triaged ?? "").trim() && Boolean(String(tk.source ?? "").trim());
  // Preflight steht neben den Gates als ✓/!/–; hier nur die Triage-Lücke als Chip.
  const flags = [];
  if (triageOpen) flags.push(ui.chip(t, "Triage offen", t.working,
    { tip: `Noch nicht triagiert: hub triage ${tk.id} --apply` }));
  const comments = commentCount(tk), evidence = evidenceCount(tk);
  const hovered = Boolean(o.hovered), selected = Boolean(o.selected);
  const box = selected ? t.selected : undefined;
  const shownLabels = blocked.length ? labels.slice(0, 1) : labels;

  // Team-Panel: „in Arbeit seit 42 min" statt nur „42 min" (Ticket-Zeiten).
  const ageLine = div().flex_none().text_size(T_XS).text_color(t.dim)
    .tooltip(`${stageAge(tk)} · zuletzt bearbeitet ${updatedStamp(tk)}`).child(stageAge(tk));

  const row1 = h_flex().gap(2).items_center().min_w(0)
    .child(h_flex().flex_none().h(18).px(3).items_center().rounded(4).bg(t.raised)
      .text_size(T_XS).font_medium().font_family(settings().font_family).text_color(t.muted)
      .tooltip(`Ticket ${tk.id}`).child(shortId(tk.id)))
    .when(Boolean(prio), (el) => el.child(priorityPill(t, prio)))
    .when(Boolean(size), (el) => el.child(sizeText(t, size)))
    .children(shownLabels.map((l) => labelPill(t, l.text, l.color)))
    .when(blocked.length > 0, (el) => el.child(ui.chip(t, `gesperrt: ${blocked.map((b) => shortId(b.id)).join(", ")}`, t.blocked,
      { tip: `Sperre: ${blocked.map((b) => `${b.id} (${b.status ?? "unbekannt"})`).join(", ")}` })))
    .when(comments > 0, (el) => el.child(countIcon(t, ICON_COMMENT, comments, `${comments} Kommentare im ## Verlauf`)))
    .when(evidence > 0, (el) => el.child(countIcon(t, ICON_EVIDENCE, evidence, `${evidence} Nachweise (evidence)`)))
    .child(div().flex_1())
    .child(ageLine);

  const title = div().id(`tk-title-${tk.id}`).w_full().max_h(30).overflow_hidden().text_size(T_M).font_semibold()
    .line_height(1.2).text_color(stage === "done" ? t.muted : t.foreground).child(clampTitle(tk.title || tk.id, o.titleChars));

  const who = whoChip(t, tk);
  const row3 = h_flex().gap(ui.GAP_XS).items_center().min_w(0).flex_none()
    .when(Boolean(who), (el) => el.child(who))
    .child(gateIcons(t, tk, o.gate))
    .child(preflightMark(t, tk))
    .child(div().flex_1())
    .child(div().flex_none().text_size(T_XS).text_color(over ? t.blocked : t.muted)
      .tooltip(`Kosten / Budget (${tk.agent || "Agent"}; nur omp meldet Kosten)`).child(`${usd(spent)}/${usd(limit)}`));

  const actions = h_flex().flex_wrap().gap(ui.GAP_XS).items_center()
    .child(miniAction(t, `tk-open-${tk.id}`, "Öffnen", (cx) => o.onOpen?.(cx), { tip: "Review-Fenster im Ticket-Modus" }))
    .child(miniAction(t, `tk-agent-${tk.id}`, "Agent", (cx) => o.onAgent?.(cx),
      { enabled: Boolean(tk.terminal), tip: tk.terminal ? "Zum Terminal des Agents" : "Kein Agent-Terminal im Ticket" }))
    .when(Boolean(o.next) && !o.next.open, (x) => x.child(miniAction(t, `tk-next-${tk.id}`, o.next.label, (cx) => o.onNext?.(cx), { tip: o.next.tip })))
    .when(Boolean(o.onRaise), (x) => x.child(miniAction(t, `tk-raise-${tk.id}`, `+${usd(o.raiseStep ?? 3)}`, (cx) => o.onRaise(cx),
      { tip: "Budget dieses Tickets erhöhen; der Agent macht weiter" })));

  const hover = v_flex().gap(ui.GAP_XS).pt(2).border_t(1).border_color(t.border)
    .child(div().flex_none().min_w(0).truncate().text_size(T_XS).font_family(settings().font_family)
      .text_color(t.dim).tooltip(tk.branch || tk.repo || "kein Branch")
      .child(tk.branch || String(tk.repo ?? "").split("/").filter(Boolean).pop() || "kein Branch"))
    .child(actions);

  return v_flex().id(`tk-${tk.id}`).relative().flex_none().p(8).gap(ui.GAP_XS).rounded(8)
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

// The gate of every open ticket, from `hub gates`: only hub can read the worktree's
// HEAD, so a green chip turns red when a commit lands after the check (every 15 s,
// and after the panel's own actions republish).
export class GateWatcher {
  constructor(cx) {
    this.busy = false;
    this.refresh(cx);
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        const r = await exec(HUB(), ["gates", "--json"], { timeout: 20000 });
        if (r.code !== 0) return;
        const slim = JSON.parse(r.stdout || "[]");
        if (JSON.stringify(slim) !== JSON.stringify(shared("orchestra.gates") ?? [])) setShared("orchestra.gates", slim);
      } catch {}
      finally { this.busy = false; }
    });
  }
}

export const gateOf = (id) => (shared("orchestra.gates") ?? []).find((g) => g.id === id) ?? null;

// Throughput for the panel and the dashboard: `hub stats` is the one calculator, so both
// screens show the same median, rework and cost. It reads the tickets' status log.
export class StatsWatcher {
  constructor(cx) {
    this.busy = false;
    this.refresh(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        const r = await exec(HUB(), ["stats", "--json", "--days", "14"], { timeout: 20000 });
        if (r.code !== 0) return;
        const next = JSON.parse(r.stdout || "{}");
        if (JSON.stringify({ ...next, at: 0 }) !== JSON.stringify({ ...(shared("orchestra.stats") ?? {}), at: 0 })) {
          setShared("orchestra.stats", next);
        }
      } catch {}
      finally { this.busy = false; }
    });
  }
}

export const statsOf = () => shared("orchestra.stats") ?? null;

/** Dauer wie `hub stats` ("42 min", "1 h 05", "—"). */
export const span = (min) => {
  if (min == null) return "—";
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};

const sid = (s) => String(s ?? "").replace(/[^a-zA-Z0-9_.-]+/g, "-");

export class HubDaemon {
  constructor(cx) {
    this.prev = null;        // ticket id → status, after the first read
    this.lastStatus = null;  // the orchestrator's last status
    this.lastTry = 0;
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
    cx.timer.after(8000, (cx) => this.ensure(cx));
    cx.timer.every(30000, (cx) => this.ensure(cx));
    cx.spawn(async () => { await costs.load(); });
    cx.timer.after(10000, (cx) => this.pollCosts(cx));
    cx.timer.every(30000, (cx) => this.pollCosts(cx));
    this.gates = new GateWatcher(cx);
    this.stats = new StatsWatcher(cx);
  }

  pollCosts(cx) {
    if (this.costing) return;
    this.costing = true;
    cx.spawn(async () => { try { await costs.poll(); } finally { this.costing = false; } });
  }

  ensure(cx) {
    if (!orch.autostart() || orch.find() || Date.now() - this.lastTry < 60000) return;
    this.lastTry = Date.now();
    cx.spawn(async () => {
      try { await orch.start(); }
      catch (e) { notify({ title: "Orchestrator startet nicht", body: errorText(e), level: "error", timeout: 15000 }); }
    });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        const slim = await tickets.publish();
        const now = Object.fromEntries(slim.map((t) => [t.id, t.status]));
        if (this.prev) for (const t of slim) {
          if (t.status === "review" && this.prev[t.id] !== "review") {
            notify({ title: `Bereit zur Prüfung: ${t.title}`.slice(0, 90), body: t.summary.split("\n")[0]?.slice(0, 200) || "Der Orchestrator hat es geprüft.",
              level: "success", timeout: 20000, action: { name: "mod.open", args: { name: "inbox" } } });
            playSound("done");
          }
        }
        this.prev = now;
      } finally { this.busy = false; }
    });
  }

  // Called on every render (live data changed): the orchestrator ending a turn.
  watch(cx) {
    const o = orch.find(), st = o?.status ?? null;
    const was = this.lastStatus;
    this.lastStatus = st;
    if (was !== "working" || !st || st === "working") return;
    cx.spawn(async () => {
      let line = "";
      try { line = orch.digest(await orch.screen(40)).message.join(" "); } catch {}
      notify({ title: st === "blocked" ? "Orchestrator braucht dich" : "Orchestrator meldet sich", body: line.slice(0, 200),
        level: st === "blocked" ? "warning" : "info", timeout: 15000,
        action: st === "blocked" ? { name: "mod.open", args: { name: "inbox" } } : { name: "tabs-graph.panel-team" } });
    });
  }
}

export class HubSection {
  constructor(cx) {
    this.digest = { step: null, message: [] };
    this.note = null;
    this.busy = false;
    this.known = [];
    this.reply = InputState.new({ placeholder: "Antwort an den Orchestrator… (↵ senden)" });
    this.reply.on("submit", (_e, cx) => this.sendReply(cx));
    this.hoveredTicket = null;      // ticket id under the pointer (Hover-Aktionen)
    this.focus = ui.focusFields();
    this.focus.track(this.reply, "hub-reply");
    cx.spawn(async (cx) => { this.known = (await knownAgents().catch(() => [])).filter((a) => a.installed); cx.notify(); });
    this.poll(cx);
    cx.timer.every(3000, (cx) => this.poll(cx));
    this.publish(cx);
    cx.timer.every(5000, (cx) => this.publish(cx));
    this.gates = new GateWatcher(cx);
    this.stats = new StatsWatcher(cx);
    this.showStats = false;         // the head line's breakdown is folded
  }

  poll(cx) {
    if (!orch.find() || this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try { this.digest = orch.digest(await orch.screen(40)); } catch { this.digest = { step: null, message: [] }; }
      this.reading = false;
      cx.notify();
    });
  }

  publish(cx) {
    if (this.publishing) return;
    this.publishing = true;
    cx.spawn(async () => { try { await tickets.publish(); } catch {} finally { this.publishing = false; } });
  }

  act(cx, label, fn) {
    if (this.busy) return;
    this.busy = true; this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try { const ok = await fn(); this.note = { ok: true, text: ok ?? label }; }
      catch (e) { this.note = { ok: false, text: errorText(e) }; }
      this.busy = false;
      cx.notify();
    });
  }

  sendReply(cx) {
    const text = this.reply.value().trim();
    if (!text) return;
    this.act(cx, "Antwort gesendet", async () => { await orch.send(text); this.reply.set_value(""); });
  }

  cycleAgent() {
    const keys = this.known.map((a) => a.key);
    if (!keys.length) return;
    setShared("orchestra.agent", keys[(keys.indexOf(orch.agentKey()) + 1) % keys.length]);
  }

  all() { return shared("orchestra.tickets") ?? []; }

  // ---------- Messwerte ----------

  // The head line: today in four numbers, straight from `hub stats` — the same answers
  // the dashboard card shows. A click unfolds stations and repos right below it.
  statsRow(t) {
    const s = statsOf(), d = s?.today;
    const open = this.showStats && Boolean(d);
    return v_flex().id("hub-stats-box").flex_none().gap(ui.GAP_S)
      .child(h_flex().id("hub-stats").flex_none().px(ui.GAP_XS).py(2).gap(ui.GAP_S).items_center().rounded(6)
        .text_size(T_XS).text_color(d ? t.muted : t.dim)
        .when(Boolean(d), (el) => el.cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
          .tooltip(open ? "Aufschlüsselung schließen" : "Klicken: Stationen und Repos aufschlüsseln"))
        .on_click((_e, cx) => { if (!d) return; this.showStats = !this.showStats; cx.notify(); })
        // Two compact lines: the panel is too narrow for the four numbers in one.
        .child(v_flex().flex_1().min_w(0).gap(0)
          .when(!d, (el) => el.child(div().truncate().child("Heute: noch keine Messwerte")))
          .when(Boolean(d), (el) => el
            .child(div().truncate().child(`Heute: ${d.done} erledigt · Median ${span(d.median_min)}`))
            .child(div().truncate().child(`${d.rework} Nacharbeit · ${usd(d.cost)}`))))
        .when(Boolean(d), (el) => el.child(svg(`${WC}/chevron-right.svg`).size(10).flex_none().text_color(t.dim))))
      .when(open, (el) => el.child(this.statsBreakdown(t, s)));
  }

  statsBreakdown(t, s) {
    const row = (id, left, right) => h_flex().id(id).h(20).flex_none().gap(ui.GAP_S).items_center().text_size(T_XS)
      .child(div().w(70).flex_none().truncate().text_color(t.muted).child(left))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(right).child(right));
    return ui.card(t, "hub-stats-break").gap(2)
      .child(div().text_size(T_XS).text_color(t.dim)
        .child(`Stationen · ${s.summary.tickets} Tickets im Fenster · ${s.summary.rounds} Prüfrunden`))
      .children((s.stations ?? []).map((st) => row(`hub-station-${st.key}`, st.label,
        `${st.count}× · Σ ${span(st.sum_min)} · Median ${span(st.median_min)}`)))
      .when((s.repos ?? []).length > 0, (el) => el.child(div().text_size(T_XS).text_color(t.dim).pt(2).child("Repos")))
      .children((s.repos ?? []).map((r) => v_flex().id(`hub-repo-${sid(r.repo)}`).gap(0).text_size(T_XS)
        .child(div().truncate().text_color(t.muted).tooltip(r.repo).child(r.repo.split("/").slice(-2).join("/") || "ohne Repo"))
        .child(div().text_color(t.foreground).child(
          `${r.done}/${r.tickets} erledigt · Median ${span(r.median_min)} · ${r.rounds} Runden · ${r.rework} Nacharbeit · ${usd(r.cost)}`))));
  }

  // ---------- orchestrator card ----------

  card(t) {
    const o = orch.find(), st = o?.status ?? null;
    const name = this.known.find((a) => a.key === orch.agentKey())?.name ?? orch.agentKey();
    const cost = costs.costs().orchestrator ?? 0;
    const { step, message } = this.digest;
    const blocked = st === "blocked";
    const restart = (cx) => this.act(cx, "neu gestartet", async () => { await orch.stop(); await orch.start(); });
    const chip = !o ? ui.chip(t, orch.autostart() ? "startet gleich" : "aus", t.muted)
      : ui.statusChip(t, st ?? "idle", st === "working" ? "arbeitet" : blocked ? "wartet" : "bereit");
    const line = !o
      ? (orch.autostart() ? "Startet in wenigen Sekunden …" : "Angehalten. Starte ihn, damit er Aufträge annimmt.")
      : st === "working" ? (step ?? "denkt nach")
        : message.length ? message.join(" ") : "Bereit. Gib dem Team einen Auftrag (⌘⇧N).";
    // Row 1: who and state, with the quiet controls. Row 2: what it does or last said
    // (click: its terminal), with the agent choice and cost at the right; the panel is too
    // narrow to carry those in row 1 next to three icon buttons.
    return ui.card(t, "hub-card", { border: blocked ? t.blocked : undefined })
      .child(h_flex().h(ui.H_BTN_S).gap(ui.GAP_S).items_center()
        .child(svg("mods/orchestra/icon.svg").size(14).flex_none().text_color(o ? t.foreground : t.dim))
        .child(div().flex_none().text_size(T_L).font_semibold().text_color(t.foreground).child("Orchestrator"))
        .child(chip)
        .child(div().flex_1())
        .when(Boolean(o), (el) => el
          .child(ui.iconButton(t, "hub-open", "mods/orchestra/icons/open.svg", "Terminal des Orchestrators öffnen", () => run("terminal.peek", { terminal: o.address }), { small: true }))
          .child(ui.iconButton(t, "hub-restart", "mods/orchestra/icons/restart.svg", "Neu starten (frischer Kontext)", restart, { small: true, enabled: !this.busy }))
          .child(ui.iconButton(t, "hub-stop", "mods/orchestra/icons/stop.svg", "Anhalten (startet nicht mehr von selbst)",
            (cx) => this.act(cx, "angehalten", async () => { orch.setAutostart(false); await orch.stop(); }), { small: true, enabled: !this.busy })))
        .when(!o, (el) => el.child(ui.button(t, "hub-start", "Starten", (cx) => this.act(cx, "gestartet", async () => { orch.setAutostart(true); await orch.start(); }),
          { small: true, enabled: !this.busy, tip: "Startet den Orchestrator (nicht die Arbeit: die kommt über den Auftrag, ⌘⇧N)" }))))
      .child(h_flex().gap(ui.GAP_M).items_start()
        .child(div().id("hub-line").flex_1().min_w(0).max_h(36).overflow_hidden().text_size(T_S)
          .text_color(blocked ? t.foreground : t.muted)
          .when(Boolean(o), (el) => el.cursor_pointer().tooltip("Klicken: Terminal öffnen").on_click(() => run("terminal.peek", { terminal: o.address })))
          .child(clip(line, 110)))
        .child(h_flex().flex_none().gap(ui.GAP_XS).items_center().text_size(T_S).text_color(t.muted)
          .child(div().id("hub-agent").h(ui.H_BTN_S).px(6).rounded(6).flex().items_center().bg(t.raised).cursor_pointer()
            .hover((s) => s.text_color(t.foreground))
            .tooltip("Agent des Orchestrators wechseln (gilt beim nächsten Start)").on_click((_e, cx) => { this.cycleAgent(); cx.notify(); })
            .child(`${name} ▾`))
          .when(Boolean(o) && cost > 0, (el) => el.child(div().child("·"))
            .child(div().text_size(T_XS).tooltip("Kosten der aktuellen Orchestrator-Sitzung").child(usd(cost))))))
      .when(blocked, (el) => el.child(ui.inputBox(t, "hub-reply", Input.new(this.reply), {
        focused: this.focus.has("hub-reply"),
        send: ui.sendButton(t, "hub-send", "mods/orchestra/icons/send.svg", "Antwort senden (↵)", (cx) => this.sendReply(cx), { enabled: !this.busy }),
      })))
      .when(Boolean(this.note), (el) => el.child(div().text_size(T_XS).text_color(this.note.ok ? t.muted : t.blocked).child(this.note.text)));
  }

  // ---------- tickets ----------

  openReview(tk) {
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
      props: { ticket: tk.id, terminal: tk.terminal || null, folder: tk.worktree || tk.repo, on: tk.machine || null } });
  }

  // Die dritte Karten-Aktion: nur wenn der Übergang erlaubt ist; sonst „Prüfen“, wenn
  // erst `hub verify` oder die Prüfstation im Review-Fenster fehlt.
  nextOf(tk) {
    const stage = stageOf(tk);
    if (stage === "done" || blockersOf(tk, this.all()).length) return null;
    if (stage === "todo") return {
      label: "Nächste Stufe", tip: `hub dispatch ${tk.id}: den Agenten im Worktree starten`,
      run: () => this.hubCmd(["dispatch", tk.id], 120000),
    };
    if (stage === "doing") {
      const gate = gateOf(tk.id);
      const checksOk = gate ? gate.ok : tk.checks === "pass";
      if (!checksOk) return {
        label: "Prüfen", tip: `hub verify ${tk.id}: Checks im Worktree ausführen (Gate für die Prüfung)`,
        run: () => this.hubCmd(["verify", tk.id], 900000),
      };
      const rv = gate?.review ?? null;
      const reviewOk = rv ? rv.ok : tk.review === "pass";
      const summary = String(rv?.summary || tk.review_summary || "").trim();
      if (!reviewOk || !summary) return { label: "Prüfen", tip: "Prüfstation im Review-Fenster starten (hub review-start)", open: true };
      return {
        label: "Nächste Stufe", tip: `hub review ${tk.id} --summary …: in die Prüfung übergeben`,
        run: () => this.hubCmd(["review", tk.id, "--summary", summary], 60000),
      };
    }
    return { label: "Prüfen", tip: "Abnahme im Review-Fenster: Zusammenfassung, Nachweise, Diff", open: true };
  }

  async hubCmd(args, timeout) {
    const r = await exec(HUB(), args, { timeout });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop());
    return r;
  }

  runCardNext(cx, tk) {
    const step = this.nextOf(tk);
    if (!step) return;
    if (step.open) { this.openReview(tk); return; }
    if (this.busy) return;
    this.busy = true;
    this.note = { ok: null, text: `${step.label} läuft …` };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await step.run();
        this.note = { ok: true, text: `${step.label}: erledigt` };
        this.publish(cx);
        this.gates.refresh(cx);
      } catch (e) { this.note = { ok: false, text: errorText(e) }; }
      this.busy = false;
      cx.notify();
    });
  }

  // Die Ticket-Karte, dieselbe wie im Board (ticketCard oben).
  ticketRow(t, tk, { primary = false } = {}) {
    const c = costs.costs();
    const stopped = Boolean(c.stopped?.[tk.id]) && stageOf(tk) !== "done";
    return ticketCard(t, tk, {
      gate: gateOf(tk.id),
      spent: c.tickets?.[tk.id] ?? 0,
      limit: costs.ticketLimit(tk.id),
      all: this.all(),
      stopped,
      primary,
      hovered: this.hoveredTicket === tk.id,
      next: this.nextOf(tk),
      raiseStep: costs.budget().ticket,
      onHover: (on, cx) => {
        if (on) this.hoveredTicket = tk.id;
        else if (this.hoveredTicket === tk.id) this.hoveredTicket = null;
        cx.notify();
      },
      onOpen: () => this.openReview(tk),
      onAgent: () => { if (tk.terminal) ui.focusAgent(tk.terminal); },
      onNext: (cx) => this.runCardNext(cx, tk),
      onRaise: stopped ? (cx) => this.act(cx, "Budget erhöht", () => costs.raiseTicket(tk)) : null,
    });
  }

  // Budget per ticket and for the whole team (open tickets + orchestrator); click to change.
  budgetChips(t) {
    const b = costs.budget(), c = costs.costs();
    const over = (c.teamCost ?? 0) > b.team;
    const chip = (id, text, tip, kind) => div().id(id).flex_none().h(ui.H_CHIP).px(6).gap(ui.GAP_XS).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(over && kind === "team" ? t.blocked : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => { costs.cycle(kind); cx.notify(); })
      .child(svg(`${WC}/square-pen.svg`).size(12).flex_none()).child(text);
    return h_flex().id("bud").h(ui.H_ROW).flex_none().gap(ui.GAP_XS).items_center()
      .child(chip("bud-ticket", `${usd(b.ticket)}/Ticket`, "Klicken: erhöhen. Budget pro Ticket; darüber wird der Agent angehalten.", "ticket"))
      .child(chip("bud-team", `Team ${usd(c.teamCost ?? 0)} / ${usd(b.team)}`, "Klicken: erhöhen. Kosten offener Tickets + Orchestrator / Team-Budget; darüber wird alles angehalten.", "team"));
  }
}
