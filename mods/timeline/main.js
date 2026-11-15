// Timeline: die Zeitachse der Arbeit. Zeilen sind Lanes aus `hub timeline --json`
// (Orchestrator oben, Agents nach Start, Sub-Agents eingerückt unter ihrem Eltern-Agenten),
// Balken laufen von `start` bis `end` (live bis jetzt, mit pulsierendem Rand) und tragen
// Statusfarbe und `Identität · Ticket-Kurz-ID`; rechts steht die Dauer. Ereignisse
// (Dispatch, Prüfung, Urteil, CI, Landen) sitzen als Symbole auf der Zeile ihres Tickets
// bzw. des Orchestrators; die Legende unter der Zeitleiste nennt Symbol und Wort, der
// Marker-Tooltip erklärt die Art zusätzlich. Oben Stundenraster und „jetzt"-Linie,
// Umschalter 1 h · 24 h · 7 Tage · Alles und Alle · Ticket; der Ticket-Chip in der Kopfzeile
// wählt das Ticket (vorbelegt durch props.ticket). Klick auf einen Balken öffnet das Terminal, auf einen
// Ticket-Marker das Review-Fenster im Ticket-Modus.
//
// Daten: `hub timeline --json` alle 15 s; fehlt der Befehl (die Datenquelle entsteht
// parallel), steht ein ruhiger Hinweis statt eines Absturzes. Live-Balken wachsen
// sekündlich aus `now` + lokaler Zeit weiter, ohne neu zu lesen.
// Das Panel trägt `timeline.panel` (idempotent, Kaltstart-fest wie das Board); als
// Fenster öffnet `mod.open:timeline` (mod.json overlay).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { exec, appHome, shared, setShared, theme, layout, run, nextCommand, openOverlay, closeOverlay, props, settings } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, GAP_XS, GAP_S, GAP_M, INSET_PANEL, H_CHIP, H_ROW } from "./ui.js";

const HUB = () => `${appHome()}/mods/orchestra/bin/hub`;
const REFRESH = 15000;
const LABEL_W = 140, DUR_W = 48;
const ROW_H = 38, THIN_H = 24;

const ZOOMS = [
  { value: "auto", label: "Auto", span: null, tip: "vom frühesten Start bis jetzt, mindestens 30 Minuten" },
  { value: "1h", label: "1 h", span: 3600, tip: "die letzte Stunde, 10-Minuten-Raster" },
  { value: "24h", label: "24 h", span: 86400, tip: "die letzten 24 Stunden, 2-Stunden-Raster" },
  { value: "7d", label: "7 Tage", span: 604800, tip: "die letzten 7 Tage, Tagesraster" },
  { value: "all", label: "Alles", span: null, tip: "seit dem Beginn der Aufzeichnung" },
];
const SCOPES = [
  { value: "all", label: "Alle", tip: "alle Lanes im Zeitraum" },
  { value: "ticket", label: "Ticket", tip: "nur Lanes eines Tickets (Chip in der Kopfzeile)" },
];
const STATUS = { working: "arbeitet", blocked: "wartet", done: "fertig", idle: "ruhig" };
const statusColor = (t, st) => (st === "working" ? t.working : st === "blocked" ? t.blocked : st === "done" ? t.done : t.idle);
// Die Ereignisarten in einer Sprache: Wort, Farbe, Erklärung. Marker-Tooltip und die
// Legende unter der Zeitleiste lesen beide hier, damit sie nie auseinanderlaufen.
const EVENTS = {
  dispatch: { word: "Dispatch", tip: "ein Agent wurde gestartet" },
  check: { word: "Prüfung", tip: "die Checks liefen im Worktree" },
  verdict: { word: "Urteil", tip: "der Prüfer hat sein Urteil geschrieben" },
  ci: { word: "CI", tip: "ein CI-Lauf wurde beobachtet" },
  land: { word: "Landen", tip: "der Branch wurde in die Basis gemergt" },
  other: { word: "Ereignis", tip: "ein Ereignis ohne bekannte Art" },
};
const eventOf = (kind) => EVENTS[kind] ?? EVENTS.other;
const eventColor = (t, kind) => (kind === "dispatch" ? t.accent
  : kind === "check" || kind === "ci" ? t.working
    : kind === "verdict" || kind === "land" ? t.done : t.dim);
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "").replace(/^hub: /, "");
// Alter des letzten Erfolgs für den Fehlerhinweis („zuletzt vor 2 min“).
const shortAge = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h`;
};
const lastLine = (r) => (r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop().slice(0, 240);

// ---- Zeit ----------------------------------------------------------------

/** Sekunden aus Sekunden, Millisekunden oder einem ISO-/Datumsstring; null ohne Wert. */
function sec(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 1e12 ? v / 1000 : v;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
  const d = Date.parse(v);
  return Number.isFinite(d) ? d / 1000 : null;
}
const clock = (s) => {
  const d = new Date(s * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const sameDay = (a, b) => {
  const x = new Date(a * 1000), y = new Date(b * 1000);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};
const stamp = (s, now) => (sameDay(s, now) ? clock(s)
  : `${String(new Date(s * 1000).getDate()).padStart(2, "0")}.${String(new Date(s * 1000).getMonth() + 1).padStart(2, "0")}. ${clock(s)}`);

/** Dauer in der Sprache der Leiste: „42 min“, „> 1 h“, „> 2 d“. */
function durText(seconds) {
  if (!(seconds >= 0)) return "—";
  const min = Math.round(seconds / 60);
  if (min < 1) return "jetzt";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `> ${h} h` : `> ${Math.floor(h / 24)} d`;
}

// ---- Vertrag -------------------------------------------------------------

const normEvent = (e) => ({
  at: sec(e?.at) ?? sec(e?.time) ?? null,
  kind: kindOf(e?.kind),
  rawKind: String(e?.kind ?? ""),
  ticket: e?.ticket ?? null,
  agent: e?.agent ?? null,
  terminal: e?.terminal ?? null,
  text: String(e?.text ?? e?.message ?? "").trim(),
});
const normSub = (s) => ({
  id: s?.id ?? s?.title ?? "",
  title: String(s?.title ?? s?.id ?? "Sub-Agent"),
  started: sec(s?.started) ?? sec(s?.start),
  ended: sec(s?.ended) ?? sec(s?.end),
});
const normLane = (l) => ({
  id: String(l?.id ?? l?.terminal ?? l?.label ?? ""),
  label: String(l?.label ?? l?.name ?? l?.id ?? "?"),
  kind: ["orchestrator", "reviewer", "subagent"].includes(l?.kind) ? l.kind : "agent",
  parent: l?.parent ?? null,
  ticket: l?.ticket ?? null,
  terminal: l?.terminal ?? null,
  start: sec(l?.start),
  end: sec(l?.end),
  status: ["working", "blocked", "done", "idle"].includes(l?.status) ? l.status : null,
  cost: Number.isFinite(Number(l?.cost)) ? Number(l.cost) : null,
  events: Array.isArray(l?.events) ? l.events.map(normEvent).filter((e) => e.at != null) : [],
  subagents: Array.isArray(l?.subagents) ? l.subagents.map(normSub).filter((s) => s.started != null) : [],
});

/** Ereignisart des Vertrags, tolerant gegen deutsche und englische Schreibweisen. */
function kindOf(k) {
  const s = String(k ?? "").toLowerCase();
  if (/dispatch|start|spawn/.test(s)) return "dispatch";
  if (/verify|check|pruef|prüf|test/.test(s)) return "check";
  if (/review|verdict|urteil|abnehm|accept/.test(s)) return "verdict";
  if (/ci\b|^ci|build|lint/.test(s)) return "ci";
  if (/land|merge|done|fertig/.test(s)) return "land";
  return "other";
}

// Ticket-Kurz-ID wie auf der Karte: erstes sinnvolles Wort, Zahl am Ende bleibt.
const STOP = new Set(["und", "im", "in", "der", "die", "das", "ein", "eine", "zu", "mit", "fur", "für", "von", "the", "a", "an", "of"]);
function shortId(id) {
  const raw = String(id ?? "");
  const num = /(\d+)$/.exec(raw)?.[1];
  const words = raw.split("-").filter((p) => p && !STOP.has(p));
  let s = (words[0] || raw).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  if (num && !s.endsWith(num)) s = `${s.slice(0, 6)}-${num}`;
  return s || "TICKET";
}

export default class Timeline extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.menu = props()?.role === "ticket-menu";
    if (this.menu) return;
    const p = props() ?? {};
    this.data = null;             // { now, since, lanes, events }
    this.received = 0;            // Date.now()/1000 when the data arrived (live growth)
    this.loaded = false;
    this.error = null;
    this.lastOk = null;           // Date.now() des letzten erfolgreichen Lesens
    this.reading = false;
    this.zoom = ZOOMS.some((z) => z.value === localStorage.getItem("timeline.zoom"))
      ? localStorage.getItem("timeline.zoom") : "auto";
    this.ticket = p.ticket ? String(p.ticket) : null;
    this.scope = this.ticket ? "ticket" : "all";
    this.sharedTicket = shared("timeline.ticket") ?? null;
    this.width = 0;
    this.scroll = ScrollHandle.new();
    this.read(cx);
    cx.timer.every(REFRESH, (cx) => this.read(cx));
    // Live: der Balken wächst sekündlich weiter; ein fremder Ticket-Klick kommt über shared.
    cx.timer.every(1000, (cx) => {
      const s = shared("timeline.ticket") ?? null;
      if (s !== this.sharedTicket) {
        this.sharedTicket = s;
        if (s) { this.ticket = String(s); this.scope = "ticket"; }
        cx.notify();
        return;
      }
      if (this.live()) cx.notify();
    });
    // Der Chip schickt seine Wahl über shared (ein anderes Fenster desselben Mods).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (!props()?.overlay && c === "panel") this.showPanel(cx);
      }
    });
    cx.timer.after(50, () => this.handle.focus());
  }

  // ---------- Daten ----------

  read(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["timeline", "--json"], { timeout: 15000 });
        if (r.code === 0) {
          const d = JSON.parse(r.stdout || "{}");
          this.data = {
            now: sec(d.now) ?? Date.now() / 1000,
            since: sec(d.since),
            lanes: (Array.isArray(d.lanes) ? d.lanes : []).map(normLane).filter((l) => l.id),
            events: (Array.isArray(d.events) ? d.events : []).map(normEvent).filter((e) => e.at != null),
          };
          this.received = Date.now() / 1000;
          this.loaded = true;
          this.error = null;
          this.lastOk = Date.now();
        } else {
          const msg = lastLine(r);
          this.error = /invalid choice|unrecognized arguments/.test(msg)
            ? "hub timeline fehlt noch — die Datenquelle entsteht parallel." : msg;
        }
      } catch (e) {
        this.error = errorText(e);
      } finally {
        this.reading = false;
        cx.notify();
      }
    });
  }

  now() {
    if (!this.data) return Date.now() / 1000;
    return this.data.now + Math.max(0, Date.now() / 1000 - this.received);
  }

  lanes() { return this.data?.lanes ?? []; }

  /** Wahre, solange eine Lane ohne `end` läuft (dann wächst der Balken). */
  live() {
    const n = this.now();
    return this.lanes().some((l) => l.end == null && l.start != null && l.start <= n && l.status !== "done");
  }

  visible() {
    const lanes = this.lanes();
    let list = lanes;
    if (this.scope === "ticket" && this.ticket) {
      const ids = new Set(lanes.filter((l) => l.ticket === this.ticket).map((l) => l.id));
      // Sub-Agents eines Treffers bleiben, auch wenn ihr eigenes Ticket fehlt.
      for (let changed = true; changed;) {
        changed = false;
        for (const l of lanes) {
          if (!ids.has(l.id) && l.parent && ids.has(l.parent)) { ids.add(l.id); changed = true; }
        }
      }
      list = lanes.filter((l) => ids.has(l.id));
    }
    // Lanes ohne Überlappung mit dem Fenster gehören nicht hinein (sonst klebten
    // alte Balken als Stummel am Rand).
    const start = this.viewStart(), end = this.now();
    return list.filter((l) => {
      // Ohne Start zählt nur, was im Fenster ein Ereignis hat; sonst wäre die Lane leer.
      if (l.start == null) return l.events.some((e) => e.at >= start && e.at <= end);
      const laneEnd = l.end ?? (l.status === "done" ? l.start : end);
      return laneEnd >= start && l.start <= end;
    });
  }

  inView(at) {
    return at != null && at >= this.viewStart() && at <= this.now();
  }

  /** Orchestrator oben, Agents nach Start, Sub-Agents unter ihrem Eltern-Agenten. */
  ordered(list) {
    const byId = new Map(list.map((l) => [l.id, l]));
    const kids = new Map(), roots = [];
    for (const l of list) {
      if (l.parent && l.parent !== l.id && byId.has(l.parent)) {
        const a = kids.get(l.parent) ?? [];
        a.push(l);
        kids.set(l.parent, a);
      } else roots.push(l);
    }
    const start = (l) => l.start ?? this.now();
    const rank = (l) => (l.kind === "orchestrator" ? 0 : 1);
    roots.sort((a, b) => rank(a) - rank(b) || start(a) - start(b));
    const out = [];
    const walk = (l, depth) => {
      out.push({ lane: l, depth });
      (kids.get(l.id) ?? []).sort((a, b) => start(a) - start(b)).forEach((k) => walk(k, depth + 1));
    };
    roots.forEach((l) => walk(l, 0));
    return out;
  }

  /** Welche Zeile ein globales Ereignis trägt: erst die Ticket-Lane, sonst der Orchestrator. */
  ownerOf(ev) {
    const lanes = this.lanes();
    const cands = lanes.filter((l) => l.kind !== "subagent" && ev.ticket && l.ticket === ev.ticket);
    const pick = cands.find((l) => ev.terminal && l.terminal === ev.terminal)
      ?? cands.find((l) => l.kind === "agent") ?? cands[0];
    if (pick) return pick.id;
    return lanes.find((l) => l.kind === "orchestrator")?.id ?? lanes[0]?.id ?? null;
  }

  /** Marker je Lane: eigene Ereignisse plus die globalen, entdoppelt. */
  markers() {
    const by = new Map();
    const add = (laneId, ev) => {
      if (!laneId) return;
      const list = by.get(laneId) ?? [];
      const key = `${ev.at}|${ev.kind}|${ev.text}`;
      if (list.some((x) => x.key === key)) return;
      list.push({ ...ev, key });
      by.set(laneId, list);
    };
    for (const l of this.lanes()) for (const ev of l.events) add(l.id, ev);
    for (const ev of this.data?.events ?? []) add(this.ownerOf(ev), ev);
    for (const list of by.values()) list.sort((a, b) => a.at - b.at);
    return by;
  }

  tickets() {
    const ids = new Set();
    for (const l of this.lanes()) if (l.ticket) ids.add(l.ticket);
    for (const e of this.data?.events ?? []) if (e.ticket) ids.add(e.ticket);
    const all = shared("orchestra.tickets") ?? [];
    const title = (id) => all.find((x) => x.id === id)?.title ?? "";
    return [...ids].sort().map((id) => ({ id, title: title(id) }));
  }

  // ---------- Achse ----------

  /** Frühester Start einer Arbeits-Lane (`agent`, `reviewer`, `subagent`) bis jetzt; nur
   *  wenn keine bekannte Arbeits-Lane einen Start hat, zählt der Orchestrator. Dessen
   *  Uptime (oft 18 h) darf das Fenster nicht diktieren: sonst schrumpfen alle
   *  Agentenläufe zu Strichen am rechten Rand. */
  autoStart() {
    const n = this.now();
    const known = this.lanes().filter((l) => l.start != null && l.start <= n);
    const work = known.filter((l) => l.kind !== "orchestrator");
    const pool = work.length ? work : known;
    return pool.length ? Math.min(...pool.map((l) => l.start)) : n;
  }

  span() {
    const z = ZOOMS.find((x) => x.value === this.zoom);
    if (z?.span) return z.span;
    const n = this.now();
    // Auto: frühester Start einer Arbeits-Lane, aber nie unter 30 Minuten — sonst teilen
    // sich zwei gerade gestartete Agents einen fast leeren 24-h-Streifen.
    if (this.zoom === "auto") return Math.max(1800, n - this.autoStart());
    const starts = this.lanes().map((l) => l.start).filter((s) => s != null && s <= n);
    const first = Math.min(n, this.data?.since ?? n, ...(starts.length ? starts : [n]));
    return Math.max(3600, n - first);
  }

  viewStart() { return this.ticketScopeStart() ?? (this.now() - this.span()); }

  // Im Ticket-Modus lieber den Zeitraum des Tickets zeigen, sonst den Umschalter.
  ticketScopeStart() {
    if (this.scope !== "ticket" || this.zoom !== "all" || !this.ticket) return null;
    const starts = this.visible().map((l) => l.start).filter((s) => s != null);
    return starts.length ? Math.min(...starts) : null;
  }

  // Die Achse endet 2 % hinter „jetzt“, damit Live-Balken und die Jetzt-Linie nicht am
  // Rand kleben; die Rasterlinien bleiben an den echten Zeiten.
  axis() {
    const start = this.viewStart(), now = this.now();
    const span = Math.max(1, now - start);
    return { start, span: span * 1.02 };
  }

  pct(at) {
    const a = this.axis();
    return Math.max(0, Math.min(100, ((at - a.start) / a.span) * 100));
  }

  ticks() {
    const start = this.viewStart(), end = this.now(), span = end - start;
    const step = span <= 7200 ? 600 : span <= 93600 ? 7200 : 86400;
    const out = [];
    if (step >= 86400) {
      const d = new Date(start * 1000);
      d.setHours(24, 0, 0, 0);
      while (d.getTime() / 1000 <= end && out.length < 40) {
        const s = d.getTime() / 1000;
        out.push({ at: s, label: `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.` });
        d.setDate(d.getDate() + 1);
      }
    } else if (step === 7200) {
      // Gerade lokale Stunden, nicht UTC: sonst lägen die Labels auf 13:00, 15:00 …
      const d = new Date(start * 1000);
      d.setMinutes(0, 0, 0);
      if (d.getTime() / 1000 < start) d.setHours(d.getHours() + 1);
      d.setHours(Math.ceil(d.getHours() / 2) * 2);
      while (d.getTime() / 1000 <= end && out.length < 40) {
        const s = d.getTime() / 1000;
        out.push({ at: s, label: clock(s) });
        d.setHours(d.getHours() + 2);
      }
    } else {
      let s = Math.ceil(start / step) * step;
      while (s <= end && out.length < 40) { out.push({ at: s, label: clock(s) }); s += step; }
    }
    return out;
  }

  chartPx() {
    const w = this.width || 368;
    return Math.max(60, w - 2 * INSET_PANEL - LABEL_W - DUR_W);
  }

  // ---------- Panel ----------

  showPanel(cx) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body"), me = find(root, "timeline");
    if (!panel || !body || !me) { cx.notify(); return; }
    if (body.active !== "timeline") run("layout.select", { stack: "panel-body", child: "timeline" });
    if (panel.hidden) run("layout.show", { id: "panel" });
  }

  // ---------- Aktionen ----------

  openTerminal(lane) {
    if (lane.terminal) ui.focusAgent(lane.terminal);
    else if (lane.ticket) this.openReview(lane.ticket);
  }

  openReview(id) {
    if (!id) return;
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680, props: { ticket: id } });
  }

  openTicketMenu() {
    const list = this.tickets();
    if (!list.length) return;
    openOverlay({
      mod: "timeline", kind: "popup", at: "pointer", width: 280,
      height: Math.min(list.length, 8) * 28 + 26 + 8,
      props: { role: "ticket-menu", tickets: list, current: this.ticket },
    });
  }

  pickTicket(id) {
    this.ticket = id;
    this.scope = id ? "ticket" : "all";
  }

  // ---------- Zeichnen ----------

  /** Ticket-Chip der Kopfzeile: zeigt das gewählte Ticket, Klick öffnet die Liste. */
  ticketChip(t) {
    const stop = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    return stop(h_flex().id("tl-ticket-chip").h(H_CHIP).px(6).gap(GAP_XS).flex_none().items_center().rounded(4)
      .bg(t.raised).text_size(T_XS).font_medium().cursor_pointer()
      .text_color(this.ticket ? t.foreground : t.muted)
      .tooltip(this.ticket ? `Ticket-Filter: ${this.ticket} — klicken für ein anderes Ticket`
        : "Ticket wählen: nur die Lanes eines Tickets")
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.openTicketMenu())
      .child(this.ticket ? shortId(this.ticket) : "Ticket"));
  }

  legend(t) {
    const item = (color, word, ring) => h_flex().gap(GAP_XS).flex_none().items_center()
      .child(div().size(7).flex_none().rounded_full().when(Boolean(ring), (el) => el.border(1.5).border_color(color))
        .when(!ring, (el) => el.bg(color)))
      .child(div().text_size(T_XS).text_color(t.dim).child(word));
    return h_flex().id("tl-legend").h(20).flex_none().px(INSET_PANEL).gap(GAP_M).items_center()
      .child(item(t.working, "arbeitet")).child(item(t.blocked, "wartet")).child(item(t.done, "fertig"))
      .child(item(t.muted, "Sub-Agent", true));
  }

  ruler(t, ticks) {
    const labelEvery = Math.max(1, Math.ceil(40 / Math.max(1, this.chartPx() / Math.max(1, ticks.length))));
    return h_flex().id("tl-ruler").h(24).flex_none().items_center().border_b(1).border_color(t.border)
      .child(div().w(LABEL_W).flex_none())
      .child(div().relative().flex_1().min_w(0).h_full()
        .children(ticks.map((k, i) => div().absolute().left(`${this.pct(k.at)}%`).top(6)
          .when(i % labelEvery === 0 && this.pct(k.at) < 97, (el) => el.text_size(T_XS).text_color(t.dim).child(k.label)))))
      .child(div().w(DUR_W).flex_none());
  }

  /** Ein Ereignis-Symbol auf der Zeile. */
  eventMark(t, ev, slot) {
    if (!this.inView(ev.at)) return null;
    const e = eventOf(ev.kind), color = eventColor(t, ev.kind);
    // Der Tooltip nennt Zeit, Art, was die Art bedeutet, und den Ereignistext.
    const tip = `${clock(ev.at)} · ${e.word} — ${e.tip}${ev.text ? ` · ${ev.text}` : ""}`;
    // 6 px an der Unterkante der Zeile, unter dem Balken: das Ereignis markiert die Zeit,
    // ohne den Balken zu verdecken. Die Art trägt die Farbe, der Tooltip den Rest.
    const mark = div().absolute().left(`${this.pct(ev.at)}%`).bottom(1 + slot * 7).size(6).flex_none()
      .rounded(2).bg(color)
      .cursor_pointer().tooltip(tip);
    return ev.ticket ? mark.on_click((_e, cx) => { cx.stop_propagation(); this.openReview(ev.ticket); }) : mark;
  }

  /** Die ruhige Zeile unter der Zeitleiste: Ereignis-Symbole in Wörtern. */
  eventLegend(t) {
    const item = (key, color, word, tip) => h_flex().id(`tl-event-${key}`).flex_none().gap(GAP_XS).items_center().tooltip(tip)
      .child(div().size(6).flex_none().rounded(key === "subagent" ? 999 : 2).bg(color))
      .child(div().text_size(T_XS).text_color(t.dim).child(word));
    return h_flex().id("tl-event-legend").h(22).flex_none().px(INSET_PANEL).gap(GAP_M).items_center()
      .child(div().flex_none().text_size(T_XS).text_color(t.dim).child("Ereignisse"))
      .child(item("dispatch", eventColor(t, "dispatch"), EVENTS.dispatch.word, `Dispatch: ${EVENTS.dispatch.tip}`))
      .child(item("check", eventColor(t, "check"), EVENTS.check.word, `Prüfung: ${EVENTS.check.tip}`))
      .child(item("verdict", eventColor(t, "verdict"), EVENTS.verdict.word, `Urteil: ${EVENTS.verdict.tip}`))
      .child(item("ci", eventColor(t, "ci"), EVENTS.ci.word, `CI: ${EVENTS.ci.tip}`))
      .child(item("land", eventColor(t, "land"), EVENTS.land.word, `Landen: ${EVENTS.land.tip}`))
      .child(item("subagent", t.muted, "Sub-Agent", "Sub-Agent: ein Kind-Agent lief auf der Zeile seines Eltern-Agenten"));
  }

  /** Ein Sub-Agent als Punkt auf der Elternzeile, mit Titel und Dauer im Tooltip. */
  subMark(t, s, now) {
    if (!this.inView(s.started)) return null;
    const ended = s.ended != null;
    const tip = `${s.title} · Sub-Agent · ${durText((s.ended ?? now) - (s.started ?? now))}${ended ? "" : " · läuft"}`;
    return div().absolute().left(`${this.pct(s.started)}%`).bottom(1).size(6).flex_none().rounded_full()
      .bg(ended ? t.done : t.working).opacity(ended ? 0.7 : 1).tooltip(tip);
  }

  /** Balken einer Lane mit Beschriftung und (live) pulsierendem Rand. */
  bar(t, lane, now, thin) {
    if (lane.start == null) return null;
    const end = lane.end ?? (lane.status === "done" ? lane.start : now);
    const live = lane.end == null && lane.status !== "done";
    const color = statusColor(t, lane.status ?? (live ? "working" : "idle"));
    const left = this.pct(lane.start), right = this.pct(Math.max(lane.start, end));
    // Beginnt die Lane vor dem Fenster, wird sie links beschnitten und eine kleine Kappe
    // markiert den Schnitt; der Tooltip nennt den echten Start.
    const clipStart = this.viewStart();
    const clipped = lane.start < clipStart - 1;
    // Beide Balken sind 10 px hoch: ein 10-Minuten-Lauf bleibt so ein Balken, kein
    // Punktmuster. Unter dem Balken bleibt Platz für die Ereignis-Marker an der Unterkante.
    const top = thin ? 3 : 8, h = 10;
    // Ein Rand erst ab 2 % Breite; darunter wirkt er als Kästchen um einen Stummel.
    const wide = right - left >= 2;
    // Unter 28 px wäre der Text ein Stummel; der Tooltip trägt ihn.
    const showLabel = !thin && ((right - left) / 100) * this.chartPx() >= 28;
    const tip = [
      lane.label,
      lane.ticket && `Ticket ${lane.ticket}`,
      STATUS[lane.status] ?? (live ? "arbeitet" : "—"),
      `${clock(lane.start)} – ${live ? "jetzt" : clock(end)}`,
      durText(end - lane.start),
      lane.cost ? ui.usd(lane.cost) : null,
      clipped ? `Anfang vor dem Fenster · seit ${clock(lane.start)}` : null,
    ].filter(Boolean).join(" · ");
    const cutTip = `Anfang vor dem Fenster · seit ${clock(lane.start)}`;
    return div().absolute().left(`${left}%`).top(top).h(h).w(`${Math.max(0, right - left)}%`).min_w(4)
      .when(live && !ui.calm(), (el) => el.child(div().absolute().inset_0().rounded_full().border_1().border_color(color)
        .loop("opacity", { from: 0.15, to: 1, period: 1400 })))
      .child(div().absolute().inset_0().rounded_full().bg(color + "66")
        .when(wide, (el) => el.border_1().border_color(color + "88"))
        .overflow_hidden().tooltip(tip).cursor_pointer()
        .on_click((_e, cx) => { cx.stop_propagation(); this.openTerminal(lane); })
        .when(showLabel, (el) => el.flex().items_center().px(clipped ? 12 : 6)
          .child(div().min_w(0).truncate().text_size(9).line_height(1).text_color(t.foreground).child(lane.label))))
      // Die Kappe sitzt über dem linken, abgeschnittenen Ende: ein „<" im Balken, bei
      // Sub-Agent-Balken eine kurze Kante in der Statusfarbe.
      .when(clipped, (el) => el.child(thin
        ? div().absolute().left(0).top(0).bottom(0).w(2).bg(color).tooltip(cutTip)
        : div().absolute().left(0).top(0).bottom(0).w(9).flex().items_center().justify_center()
          .bg(t.background).text_size(T_XS).font_medium().text_color(color).tooltip(cutTip).child("<")));
  }

  row(t, lane, depth, marks, now, i) {
    const status = lane.status ?? (lane.end == null ? "working" : "done");
    const thin = lane.kind === "subagent";
    const end = lane.end ?? (status === "done" ? lane.start : now);
    const name = lane.label || lane.id;
    const nameText = div().min_w(0).truncate().text_size(T_S).font_semibold()
      .text_color(thin ? t.muted : t.foreground).tooltip(`${name}${lane.ticket ? ` · ${lane.ticket}` : ""}`).child(name);
    const label = thin
      ? h_flex().w(LABEL_W).flex_none().min_w(0).h_full().items_center().gap(GAP_XS).pl(8 + depth * 10).pr(4)
        .child(div().size(7).flex_none().rounded_full().bg(statusColor(t, status)))
        .child(nameText)
      // Zwei Zeilen: Name fett, darunter das Ticket-Kürzel in dim statt einer langen Zeile.
      : v_flex().w(LABEL_W).flex_none().min_w(0).h_full().justify_center().gap(0).pl(8 + depth * 10).pr(4)
        .child(h_flex().gap(GAP_XS).items_center().min_w(0)
          .when(lane.kind === "orchestrator", (el) => el.child(div().flex_none().tooltip("Orchestrator dieses Workspace")
            .child(svg("mods/orchestra/orchestrator.svg").size(12).flex_none().text_color(t.accent))))
          .child(ui.statusIcon(t, status)).child(nameText))
        .when(Boolean(lane.ticket), (el) => el.child(div().pl(16).min_w(0).truncate().text_size(T_XS)
          .text_color(t.dim).child(shortId(lane.ticket))));
    // Zwei Ereignisse fast zur selben Zeit liegen versetzt, sonst deckt eines das andere zu.
    const events = marks.get(lane.id) ?? [];
    const track = div().id(`tl-track-${lane.id}`).relative().flex_1().min_w(0).h_full()
      .child(this.bar(t, lane, now, thin))
      .children(events.map((ev, i) => this.eventMark(t, ev, i % 2)).filter(Boolean))
      .children((lane.subagents ?? []).map((s) => this.subMark(t, s, now)).filter(Boolean));
    return h_flex().id(`tl-row-${lane.id}-${i}`).h(thin ? THIN_H : ROW_H).flex_none().items_center()
      .border_b(1).border_color(t.border)
      .child(label).child(track)
      .child(div().w(DUR_W).flex_none().pr(6).text_right().text_size(T_XS).text_color(t.dim)
        .child(lane.start == null ? "—" : durText(end - lane.start)));
  }

  bodyText(t, visible, cx) {
    if (!this.loaded && !this.error) return ui.loading(t);
    if (!visible.length) {
      const action = this.error
        ? ui.link(t, "tl-retry", "Neu lesen", () => this.read(cx))
        : this.zoom !== "all"
          ? ui.link(t, "tl-empty-all", "Alles anzeigen", () => { this.zoom = "all"; localStorage.setItem("timeline.zoom", "all"); cx.notify(); },
            { tip: "Zeitraum auf die ganze Aufzeichnung stellen" })
          : this.scope === "ticket"
            ? ui.link(t, "tl-empty-tickets", "Alle Tickets", () => { this.scope = "all"; cx.notify(); })
            : null;
      return ui.empty(t, this.error ? `Timeline nicht lesbar: ${this.error}${this.lastOk ? ` · zuletzt vor ${shortAge(Date.now() - this.lastOk)}` : ""}` : "Keine Agenten in diesem Zeitraum.", {
        icon: "mods/workspace-chrome/clock.svg",
        action,
      });
    }
    return null;
  }

  renderMenu() {
    const t = theme();
    const p = props() ?? {};
    const rows = p.tickets ?? [];
    const close = () => closeOverlay(p.overlay);
    return v_flex().id("tl-ticket-menu").size_full().p(6).gap(2).rounded(8).bg(t.popover).text_color(t.foreground)
      .child(div().h(20).flex_none().px(6).flex().items_center().text_size(T_XS).text_color(t.dim).child("Ticket wählen"))
      .children(rows.map((x) => h_flex().id(`tl-pick-${x.id}`).h(H_ROW).flex_none().px(8).gap(GAP_S).items_center().rounded(6)
        .text_size(T_S).when(x.id === p.current, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover)).cursor_pointer()
        .tooltip(x.title || x.id)
        .on_click(() => { setShared("timeline.ticket", x.id); close(); })
        .child(div().flex_none().text_size(T_XS).font_medium().text_color(t.muted).child(shortId(x.id)))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(x.title || x.id))))
      .on_key_down((ev, cx) => { if (ev.key === "escape") { close(); cx.stop_propagation(); } });
  }

  render(cx) {
    if (this.menu) return this.renderMenu();
    const t = theme();
    const now = this.now();
    const all = this.ordered(this.visible());
    const visible = all.map((x) => x.lane);
    const marks = this.markers();
    const ticks = this.ticks();
    const count = visible.length;
    const since = stamp(this.viewStart(), now);
    const meta = `${count} Lanes · seit ${since}`;
    const note = this.error
      ? div().id("tl-note").max_w(180).flex_shrink_1().min_w(0).truncate().text_size(T_XS).text_color(t.dim)
        .tooltip(this.error).child(this.error)
      : null;
    const toolbar = h_flex().id("tl-toolbar").h(34).flex_none().px(INSET_PANEL).gap(GAP_S).items_center()
      .child(ui.segment(t, "tl-zoom", ZOOMS.map((z) => ({ value: z.value, label: z.label, tip: z.tip })), this.zoom,
        (v, cx) => { this.zoom = v; localStorage.setItem("timeline.zoom", v); cx.notify(); }))
      .child(ui.segment(t, "tl-scope", SCOPES, this.scope, (v, cx) => {
        if (v === "ticket" && !this.ticket) {
          const first = this.tickets()[0];
          if (first) this.pickTicket(first.id);
          else this.openTicketMenu();
        } else this.scope = v;
        cx.notify();
      }))
      .child(div().flex_1())
      .when(Boolean(note), (el) => el.child(note));

    const header = props()?.overlay
      ? ui.windowHeader(t, "Timeline", [this.ticketChip(t)], () => closeOverlay(props().overlay), { meta, metaTip: "Lanes im gewählten Zeitraum" })
      : ui.panelHeader(t, "Timeline", [this.ticketChip(t), div().flex_none().text_size(T_XS).text_color(t.dim).child(`seit ${since}`)],
        { count: `${count} Lanes` });

    const rows = all.map((x, i) => this.row(t, x.lane, x.depth, marks, now, i));
    // Das Raster liegt hinter den Zeilen: senkrechte Linien über die ganze Höhe.
    const grid = ticks.map((k) => div().absolute().left(`${this.pct(k.at)}%`).top(0).bottom(0).w(1).bg(t.border));
    const chart = div().id("tl-chart").relative().flex_1().min_h(0)
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(rows))
      .child(div().absolute().top(0).bottom(0).left(LABEL_W).right(DUR_W).children(grid))
      .child(this.nowLine(t));
    const content = visible.length === 0
      ? v_flex().id("tl-empty").flex_1().min_h(0).child(this.bodyText(t, visible, cx))
      : chart;

    return v_flex().id("timeline").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .on_size_change((size, cx) => {
        const w = Math.round(size.width / (settings().zoom || 1));
        if (Math.abs(w - this.width) > 2) { this.width = w; cx.notify(); }
      })
      .child(header)
      .child(toolbar)
      .child(this.legend(t))
      .child(this.ruler(t, ticks))
      .child(content)
      .child(this.eventLegend(t));
  }

  nowLine(t) {
    return div().absolute().top(0).bottom(0).left(`${this.pct(this.now())}%`).w(1).bg(t.blocked + "88");
  }
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
