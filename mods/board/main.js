// Board: die Pipeline als Kanban (Geplant · In Arbeit · Prüfung · Fertig). Vier
// Spalten mit Kopf (Name, Zahl n/limit, Kostensumme) und eigenem Scroll; bei schmalem
// Panel 2×2, darunter untereinander. Die WIP-Limits kommen aus `hub wip --json`
// (data/orchestra/wip.json): „In Arbeit" und „Prüfung" tragen `n/limit`, sind voll
// gedimmt und färben den Zähler in der Wartet-Farbe. Die Karten sind die Ticket-Karte
// aus card.js (dieselbe wie im Team-Panel): ID, Labels, Status, Titel, Agent, Branch,
// Alter in der Stufe, Gates, Kosten, Kommentare, Nachweise, Sperre; Hover mit Öffnen /
// Agent / Prüfen.
//
// Der Kopf trägt Suchfeld und Trefferzahl („12 von 49"): der Filter durchsucht Titel,
// Labels, Branch und Ticket-ID, ⌘F springt hinein, Esc leert ihn; Treffer bleiben in
// ihren Spalten, leere Spalten bleiben sichtbar. Der Filter gilt für die Sitzung
// (localStorage).
//
// Daten: shared "orchestra.tickets" und shared "orchestra.gates" (der HubDaemon pflegt
// beide alle 5 bzw. 15 s) für die Karten und Gates; `hub wip --json`
// (data/orchestra/wip.json, alle 30 s und bei Space-Wechsel) für die Limits, shared
// "orchestra.costs" (Datei data/orchestra/costs.json als Rückfall) für die Kosten,
// shared "agents.identity" für Avatare (über ui.identityChip). Eigene `hub ticket
// list`/`hub gates`-Aufrufe nur, wenn shared noch leer ist (Kaltstart ohne Daemon) und
// beim Klick auf „Daten alt". "board.panel" schaltet das Panel um; die Tab-Leiste
// trägt der Orchestrator ein (nicht dieser Mod).
//
// Datenfrische: jeder Leseversuch stempelt Erfolg oder den ersten Fehler seit dem letzten
// Erfolg. Ist eine Quelle älter als 30 s (oder hat sie einen Fehler), steht „Daten alt" in
// `warning` im Kopf, mit Quelle, letztem Erfolg und Fehlertext im Tooltip; ein Klick liest
// alle vier sofort neu. Kein eigener Timer: die Refreshes oben tragen den Zustand.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { exec, appHome, readTextFile, shared, theme, layout, run, notify, nextCommand, openOverlay, settings } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, T_L, GAP_S, GAP_M, INSET_PANEL, H_HEADER, H_SECTION, H_ROW, usd, at } from "./ui.js";
import { STAGES, stageOf, stageColor, ticketCard, blockersOf } from "./card.js";

const HUB = () => `${appHome()}/mods/orchestra/bin/hub`;
const REFRESH = 5000, GATE_REFRESH = 15000, COST_REFRESH = 30000, WIP_REFRESH = 30000;
// `hub wip --json` owns the limits (data/orchestra/wip.json); these are its defaults.
const WIP_DEFAULT = { arbeit: 3, pruefung: 2 };
// Fertig bleibt eine Spalte, keine Liste: die letzten Abnahmen stehen, der Rest klappt zu.
const DONE_SHOW = 5;
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");
// Datenfrische: je Quelle der letzte Erfolg und der erste Fehler seitdem. Kein eigener
// Timer: die bestehenden Leser (5/15/30 s) schreiben hier hinein. Über 30 s ohne Erfolg
// oder nach einem Fehler trägt der Kopf „Daten alt“; der Tooltip nennt die Quelle.
const STALE_MS = 30000;
const SOURCES = { tickets: "Tickets", gates: "Gates", costs: "Kosten", wip: "WIP" };
const shortAge = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h`;
};

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const normalize = (t) => ({ ...t, comments: t.comments ?? t.verlauf?.length ?? 0 });
// Vom HubDaemon gepflegte Listen. Ein nie gesetztes shared (null) ist keine Liste: dann
// liest das Board selbst, bis der Daemon liefert.
const sharedList = (key) => { const v = shared(key); return Array.isArray(v) ? v : null; };
const sortCards = (a, b) => at(a.status_at || a.updated || a.created) - at(b.status_at || b.updated || b.created)
  || String(a.id).localeCompare(String(b.id));

export default class Board extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    // Eine Liste je Lauf: `shared()` kopiert bei jedem Aufruf, `inScope` je Ticket wäre
    // bei 70 Tickets teuer (siehe ui.inScope).
    const tks = ui.teamTickets();
    this.tickets = tks.map(normalize).filter((tk) => ui.inScope(tk, tks));
    this.gates = shared("orchestra.gates") ?? [];
    this.space = ui.activeSpace()?.id ?? "";
    this.costFile = null;
    this.wip = { ...WIP_DEFAULT };
    this.selected = null;
    this.hovered = null;
    this.reveal = null;
    this.width = 0;
    // Auf-/Zuklappen gilt für die Sitzung (localStorage), nicht für ein Ticket.
    try { this.doneAll = localStorage.getItem("doneAll") === "1"; } catch { this.doneAll = false; }
    // Der Filter gilt für die Sitzung (localStorage, wie Zeitraum und Aufklappen); ⌘F
    // setzt den Fokus hinein, Esc leert ihn. Treffer bleiben in ihren Spalten, leere
    // Spalten bleiben stehen.
    try { this.filter = String(localStorage.getItem("filter") ?? "").trim().toLowerCase(); } catch { this.filter = ""; }
    this.search = InputState.new({ placeholder: "Tickets filtern …", value: this.filter });
    this.search.on("change", (_e, cx) => {
      this.filter = this.search.value().trim().toLowerCase();
      try {
        if (this.filter) localStorage.setItem("filter", this.filter);
        else localStorage.removeItem("filter");
      } catch {}
      cx.notify();
    });
    this.focus = ui.focusFields();
    this.focus.track(this.search, "board-filter");
    this.loaded = false;
    this.note = null;
    // at: letzter Erfolg (ms), err: erster Fehlertext seit diesem Erfolg.
    this.fresh = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, { at: 0, err: null }]));
    this.readingT = false;
    this.readingG = false;
    this.readingC = false;
    this.readingW = false;
    this.scrolls = Object.fromEntries(STAGES.map((s) => [s.key, ScrollHandle.new()]));
    this.outer = ScrollHandle.new();
    this.readCosts(cx);
    this.readWip(cx);
    this.readTickets(cx);
    this.readGates(cx);
    cx.timer.every(REFRESH, (cx) => this.readTickets(cx));
    cx.timer.every(GATE_REFRESH, (cx) => this.readGates(cx));
    cx.timer.every(COST_REFRESH, (cx) => this.readCosts(cx));
    cx.timer.every(WIP_REFRESH, (cx) => this.readWip(cx));
    cx.timer.every(20000, (cx) => cx.notify()); // die Alter in der Stufe
    cx.timer.after(50, () => this.handle.focus());
    // Kommando der Tab-Leiste: board.panel zeigt das Panel (idempotent, Kaltstart-fest).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "panel") this.showPanel(cx);
      }
    });
  }

  // ---------- Daten ----------

  /** Ein Leseversuch ist durch: Erfolg stempelt den Zeitpunkt und löscht den Fehler;
   *  ein Fehlschlag merkt den ersten Fehlertext seit dem letzten Erfolg. */
  seen(key, err = null) {
    const f = this.fresh[key];
    if (err == null) { f.at = Date.now(); f.err = null; }
    else if (!f.err) f.err = errorText(err).slice(0, 160);
  }

  staleSources() {
    const now = Date.now();
    // Vor dem ersten Versuch (at 0, kein Fehler) ist nichts „alt“: der Chip soll nicht
    // beim ersten Bild aufblitzen, sondern erst nach einem Fehlschlag oder 30 s Stille.
    return Object.keys(SOURCES).filter((k) => this.fresh[k].err
      || (this.fresh[k].at && now - this.fresh[k].at > STALE_MS));
  }

  applyTickets(tks) {
    // Alle lesen, auf die Fabrik des aktiven Workspace filtern: Alt-Tickets ohne
    // `space` bleiben sichtbar (ui.inScope), fremde Spaces nicht.
    this.tickets = tks.map(normalize).filter((tk) => ui.inScope(tk, tks));
    this.loaded = true;
  }

  readTickets(cx, force = false) {
    const fromDaemon = sharedList("orchestra.tickets");
    if (fromDaemon && !force) {
      this.applyTickets(fromDaemon);
      this.seen("tickets");
      cx.notify();
      return;
    }
    if (this.readingT) return;
    this.readingT = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["ticket", "list", "--all", "--json"], { timeout: 20000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop());
        this.applyTickets(JSON.parse(r.stdout || "[]"));
        this.seen("tickets");
      } catch (e) { this.seen("tickets", e); } finally { this.readingT = false; cx.notify(); }
    });
  }

  /** `--space` dieses Workspace; ohne Space alles (dann gibt es nichts zu wählen). */
  scopeArgs(flag = "--space") {
    const sid = ui.activeSpace()?.id;
    return sid ? [flag, sid] : ["--all"];
  }

  readGates(cx, force = false) {
    const fromDaemon = sharedList("orchestra.gates");
    if (fromDaemon && !force) {
      this.gates = fromDaemon;
      this.seen("gates");
      cx.notify();
      return;
    }
    if (this.readingG) return;
    this.readingG = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["gates", "--json", ...this.scopeArgs()], { timeout: 20000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop());
        this.gates = JSON.parse(r.stdout || "[]");
        this.seen("gates");
      } catch (e) { this.seen("gates", e); } finally { this.readingG = false; cx.notify(); }
    });
  }

  readCosts(cx) {
    if (this.readingC) return;
    this.readingC = true;
    const path = `${appHome()}/data/orchestra/costs.json`;
    cx.spawn(async (cx) => {
      try {
        this.costFile = JSON.parse(await readTextFile(path) ?? "{}");
        this.seen("costs");
      } catch (e) {
        // Keine Kostendatei ist kein Fehler: shared("orchestra.costs") trägt die Zahlen.
        if (/ENOENT|no such file/i.test(String(e?.message ?? e))) { this.costFile = {}; this.seen("costs"); }
        else this.seen("costs", e);
      } finally { this.readingC = false; cx.notify(); }
    });
  }

  // The WIP limits from `hub wip`; the Board counts its own columns against them.
  readWip(cx) {
    if (this.readingW) return;
    this.readingW = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["wip", "--json", ...this.scopeArgs()], { timeout: 20000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop());
        this.wip = { ...WIP_DEFAULT, ...JSON.parse(r.stdout || "{}") };
        this.seen("wip");
      } catch (e) { this.seen("wip", e); } finally { this.readingW = false; cx.notify(); }
    });
  }

  /** Limit of a stage, or null where WIP does not apply (Geplant, Fertig). */
  limitOfStage(key) { return key === "doing" ? this.wip.arbeit : key === "review" ? this.wip.pruefung : null; }

  costs() {
    const s = shared("orchestra.costs"), f = this.costFile;
    if (!s && !f) return {};
    if (!s) return f ?? {};
    if (!f) return s;
    return Number(f.at ?? 0) > Number(s.at ?? 0) ? f : s;
  }

  budget() { return { ticket: 3, team: 20, ...(shared("orchestra.budget") ?? {}) }; }
  limitOf(tk) { return this.budget().ticket + ((shared("orchestra.budgetExtra") ?? {})[tk.id] ?? 0); }
  spentOf(tk) { return Number(this.costs().tickets?.[tk.id] ?? 0); }
  gateOf(id) { return this.gates.find((g) => g.id === id) ?? null; }
  openBlockers(tk) { return blockersOf(tk, this.tickets); }

  // ---------- Aktionen ----------

  openTicket(tk) {
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
      props: { ticket: tk.id, terminal: tk.terminal || null, folder: tk.worktree || tk.repo, on: tk.machine || null } });
  }

  async hub(args, timeout) {
    const r = await exec(HUB(), args, { timeout });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit ${r.code}`).trim().split("\n").pop());
    return r;
  }

  // Die dritte Aktion: nur wenn der Übergang erlaubt ist; sonst „Prüfen“, wenn erst
  // `hub verify` (oder die Prüfstation im Review-Fenster) fehlt.
  nextOf(tk) {
    const stage = stageOf(tk);
    if (stage === "done" || this.openBlockers(tk).length) return null;
    if (stage === "todo") return {
      label: "Nächste Stufe", tip: `hub dispatch ${tk.id}: den Agenten im Worktree starten`,
      run: () => this.hub(["dispatch", tk.id], 120000),
    };
    if (stage === "doing") {
      const g = this.gateOf(tk.id);
      const checksOk = g ? g.ok : tk.checks === "pass";
      if (!checksOk) return {
        label: "Prüfen", tip: `hub verify ${tk.id}: Checks im Worktree ausführen (Gate für die Prüfung)`,
        run: () => this.hub(["verify", tk.id], 900000),
      };
      const rv = g?.review ?? null;
      const reviewOk = rv ? rv.ok : tk.review === "pass";
      const summary = String(rv?.summary || tk.review_summary || "").trim();
      if (!reviewOk || !summary) return {
        label: "Prüfen", tip: "Prüfstation im Review-Fenster starten (hub review-start)",
        open: true,
      };
      return {
        label: "Nächste Stufe", tip: `hub review ${tk.id} --summary …: in die Prüfung übergeben`,
        run: () => this.hub(["review", tk.id, "--summary", summary], 60000),
      };
    }
    return { label: "Prüfen", tip: "Abnahme im Review-Fenster: Zusammenfassung, Nachweise, Diff", open: true };
  }

  runNext(cx, tk) {
    const step = this.nextOf(tk);
    if (!step) return;
    if (step.open) { this.openTicket(tk); return; }
    this.note = { ok: null, text: `${step.label} läuft …` };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await step.run();
        this.note = { ok: true, text: `${step.label}: erledigt` };
        this.readTickets(cx);
        this.readGates(cx);
      } catch (e) {
        this.note = { ok: false, text: errorText(e) };
        notify({ title: "Board", body: errorText(e).slice(0, 200), level: "warning", timeout: 12000 });
      }
      cx.notify();
    });
  }

  // board.panel: dasselbe wie tabs-graph.togglePanel, aber ohne den fremden Mod zu ändern,
  // und idempotent: das Board wird gezeigt, nicht umgeschaltet. So kann die Tab-Leiste
  // zuerst das Panel zeigen und danach dieses Kommando schicken (Kaltstart, solange der
  // Block noch nie gerendert wurde, ist das Kommando unbekannt; select+show genügt dann).
  showPanel(cx) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body"), me = find(root, "board");
    if (!panel || !body || !me) {
      this.note = { ok: false, text: "Board steht noch nicht im Layout; der Orchestrator trägt es ein." };
      notify({ title: "Board", body: this.note.text, level: "info", timeout: 10000 });
      cx.notify();
      return;
    }
    if (body.active !== "board") run("layout.select", { stack: "panel-body", child: "board" });
    if (panel.hidden) run("layout.show", { id: "panel" });
  }

  // ---------- Auswahl ----------

  /** Passt ein Ticket zum Filter? Durchsucht Titel, Labels, Branch und Ticket-ID;
   *  mehrere Wörter müssen alle irgendwo vorkommen (UND), Groß/Klein egal. */
  matches(tk) {
    if (!this.filter) return true;
    const hay = [tk.id, tk.title, tk.labels, tk.branch].map((v) => String(v ?? "").toLowerCase());
    return this.filter.split(/\s+/).every((q) => hay.some((h) => h.includes(q)));
  }

  clearFilter(cx) {
    this.search.set_value("");
    this.filter = "";
    try { localStorage.removeItem("filter"); } catch {}
    this.handle.focus();
    cx.notify();
  }

  columns() {
    const by = { todo: [], doing: [], review: [], done: [] };
    for (const tk of this.tickets) if (this.matches(tk)) by[stageOf(tk)].push(tk);
    for (const k of Object.keys(by)) by[k].sort(sortCards);
    return by;
  }

  flat(by) { return STAGES.flatMap((s) => by[s.key]); }

  /** Karten, die im eingeklappten Fertig verborgen sind (alle außer den fünf jüngsten). */
  foldedDone(id) {
    if (this.doneAll) return false;
    const done = this.columns().done;
    return done.length > DONE_SHOW && done.slice(0, -DONE_SHOW).some((tk) => tk.id === id);
  }

  toggleDone(cx) {
    this.doneAll = !this.doneAll;
    try { localStorage.setItem("doneAll", this.doneAll ? "1" : "0"); } catch {}
    cx.notify();
  }

  pick(list, i, cx) {
    if (!list.length) return;
    this.selected = list[(i + list.length) % list.length].id;
    // Die Tastatur erreicht jedes Ticket; ein verborgenes klappt die Spalte auf.
    if (this.foldedDone(this.selected)) this.toggleDone(cx);
    this.reveal = this.selected;
    this.handle.focus();
    cx.notify();
  }

  onKey(ev, cx) {
    const k = ev.key;
    // ⌘F springt ins Suchfeld; Esc leert erst den Filter, dann die Auswahl.
    if (ev.keystroke === "cmd-f" || ev.keystroke === "ctrl-f") {
      this.search.focus();
      cx.stop_propagation();
      return;
    }
    if (k === "escape" && this.filter) { this.clearFilter(cx); cx.stop_propagation(); return; }
    // Tippen im Suchfeld gehört dem Feld, nicht der Kartenauswahl.
    if (this.focus.has("board-filter")) return;
    const by = this.columns(), list = this.flat(by);
    const i = list.findIndex((t) => t.id === this.selected);
    if (k === "down" || k === "j") this.pick(list, i + 1, cx);
    else if (k === "up" || k === "k") this.pick(list, i - 1, cx);
    else if (k === "home") this.pick(list, 0, cx);
    else if (k === "end") this.pick(list, list.length - 1, cx);
    else if (k === "enter") { if (i >= 0) this.openTicket(list[i]); cx.notify(); }
    else if (k === "escape") { this.selected = null; this.handle.focus(); cx.notify(); }
    else return;
    cx.stop_propagation();
  }

  // ---------- Karte und Spalten ----------

  card(t, tk) {
    return ticketCard(t, tk, {
      gate: this.gateOf(tk.id),
      spent: this.spentOf(tk), limit: this.limitOf(tk),
      all: this.tickets,
      titleChars: this.titleChars(),
      hovered: this.hovered === tk.id,
      selected: this.selected === tk.id,
      next: this.nextOf(tk),
      onHover: (on, cx) => {
        if (on) this.hovered = tk.id;
        else if (this.hovered === tk.id) this.hovered = null;
        cx.notify();
      },
      onOpen: (cx) => { this.selected = tk.id; this.handle.focus(); this.openTicket(tk); cx.notify(); },
      onAgent: () => { if (tk.terminal) ui.focusAgent(tk.terminal); },
      onNext: (cx) => this.runNext(cx, tk),
    });
  }

  column(t, key, list, { grow, onToggle }) {
    const s = STAGES.find((x) => x.key === key);
    const sum = list.reduce((n, tk) => n + this.spentOf(tk), 0);
    // WIP: the head carries `n/limit`; a full stage dims its name and turns the count
    // into the waiting colour, so the reason `hub dispatch` refuses is visible here.
    const limit = this.limitOfStage(key);
    const full = limit != null && list.length >= limit;
    const count = limit != null ? `${list.length}/${limit}` : String(list.length);
    const countTip = limit == null ? `${list.length} Tickets`
      : full ? `WIP-Limit ${limit}: voll — hub dispatch startet nichts Neues (hub wip ${key === "doing" ? "arbeit" : "pruefung"}=${limit + 1})`
        : `${list.length} von ${limit} (WIP-Limit)`;
    // Fertig zeigt die fünf jüngsten nach `status_at` (sortCards: älteste zuerst, also
    // die letzten fünf); darunter klappt eine Zeile den Rest auf. Der Kopf zählt weiter alle.
    const folded = key === "done" && list.length > DONE_SHOW && !this.doneAll;
    const shown = folded ? list.slice(-DONE_SHOW) : list;
    const body = v_flex().id(`col-${key}-body`).gap(GAP_S).px(GAP_S).pb(GAP_S);
    if (grow) body.flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scrolls[key]);
    if (!list.length) body.child(ui.empty(t, s.empty, { row: true }));
    else {
      let n = 0;
      for (const tk of shown) {
        if (grow && this.reveal === tk.id) { this.scrolls[key].scroll_to_item(n); this.reveal = null; }
        body.child(this.card(t, tk));
        n++;
      }
      if (key === "done" && list.length > DONE_SHOW) {
        const rest = list.length - DONE_SHOW;
        body.child(div().id("col-done-more").h(H_ROW).flex_none().px(GAP_S).flex().items_center()
          .child(ui.link(t, "board-done-more", folded ? `+${rest} ältere anzeigen` : `−${rest} ältere ausblenden`,
            () => onToggle(), { tip: folded ? "alle Abnahmen dieser Sitzung zeigen" : "auf die fünf jüngsten zurück" })));
      }
    }
    return v_flex().id(`col-${key}`).min_w(0).rounded(8).bg(t.background).border_1().border_color(t.border)
      .when(grow, (el) => el.flex_1().min_h(0))
      .child(h_flex().h(H_SECTION).flex_none().px(ui.GAP_M).gap(GAP_S).items_center().border_b(1).border_color(t.border)
        .child(div().id(`col-${key}-name`).flex_none().text_size(T_S).font_medium()
          .text_color(full ? t.dim : stageColor(t, key)).when(full, (el) => el.tooltip("Stufe voll (WIP-Limit)")).child(s.label))
        .child(div().id(`col-${key}-count`).flex_none().text_size(T_XS).tooltip(countTip)
          .text_color(full ? t.blocked : t.dim).child(count))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T_XS).text_color(sum > 0 ? t.muted : t.dim)
          .tooltip("Kosten der Tickets in dieser Spalte").child(`Σ ${usd(sum)}`)))
      .child(body);
  }

  // Spalten nach gemessener Panelbreite (this.width aus on_size_change, echte Pixel ÷ Zoom):
  // unter 520 px eine Spalte untereinander (der Spaltenkopf ist die Trennzeile), ab 520 px
  // 2×2, ab 900 px 1×4. Kein Schätzen, keine Zwischenstufe; vor dem ersten Messen steht „1".
  mode(w) { return w >= 900 ? "4" : w >= 520 ? "2" : "1"; }

  // Zeichen je Titelzeile: Innenbreite der Karte ÷ mittlere Zeichenbreite (12 px
  // semibold ≈ 7,3 px). Innenbreite = Spaltenbreite minus Spaltenpolster (6 je Seite),
  // Kartenpolster (8 je Seite) und zwei Rahmen; 340 px ist nur der Wert vor dem ersten
  // on_size_change. Zusammen mit clampTitle ergibt das zwei Zeilen mit „…".
  titleChars() {
    const w = this.width || 340, cols = { 4: 4, 2: 2, 1: 1 }[this.mode(w)] ?? 1;
    const colW = (w - 2 * INSET_PANEL - (cols - 1) * GAP_M) / cols;
    return Math.max(10, Math.floor(Math.max(60, colW - 30) / 7.3));
  }

  /** „Daten alt“ im Kopf: sobald eine Quelle einen Fehler hat oder ihr letzter Erfolg
   *  über 30 s zurückliegt. Der Tooltip nennt je Quelle letzten Erfolg und den ersten
   *  Fehlertext; ein Klick stößt alle vier Leser sofort neu an. */
  freshChip(t) {
    const bad = this.staleSources();
    if (!bad.length) return null;
    const now = Date.now();
    const tip = bad.map((k) => {
      const f = this.fresh[k];
      const last = f.at ? `zuletzt vor ${shortAge(now - f.at)}` : "noch kein Erfolg";
      return `${SOURCES[k]}: ${last}${f.err ? ` · ${f.err}` : ""}`;
    }).join("\n");
    // Themes without a warning role (the app's default) fall back instead of failing the
    // whole render: a colour that does not exist must never blank the board.
    const warn = t.warning ?? t.unknown ?? t.muted;
    return div().id("board-fresh").flex_none().h(18).px(6).flex().items_center().rounded(4)
      .bg(warn + "26").text_size(T_XS).font_medium().text_color(warn)
      .cursor_pointer().tooltip(`${tip}\n\nKlicken: sofort neu lesen`)
      .on_click((_e, cx) => {
        this.readTickets(cx, true); this.readGates(cx, true); this.readCosts(cx); this.readWip(cx);
        cx.notify();
      })
      .child("Daten alt");
  }

  render(cx) {
    const t = theme();
    // Space-Wechsel (spaces() zeichnet neu): Board, Gates und WIP sofort für den neuen
    // Workspace lesen — kein Neustart, kein zusätzlicher Timer.
    const sid = ui.activeSpace()?.id ?? "";
    if (sid !== this.space) {
      this.space = sid;
      this.readTickets(cx);
      this.readGates(cx);
      this.readWip(cx);
    }
    const by = this.columns();
    const flat = this.flat(by);
    if (this.selected && !flat.some((x) => x.id === this.selected)) this.selected = null;
    const mode = this.mode(this.width || 368);
    const open = flat.filter((x) => stageOf(x) !== "done").length;
    const total = flat.reduce((n, tk) => n + this.spentOf(tk), 0);

    const right = [];
    const scope = ui.spaceChip(t);
    const fresh = this.freshChip(t);
    if (fresh) right.push(fresh);
    if (this.note) right.push(div().id("board-note").max_w(230).min_w(0).flex_shrink_1().truncate().text_size(T_XS)
      .text_color(this.note.ok === false ? t.blocked : this.note.ok ? t.muted : t.dim)
      .tooltip(this.note.text).child(this.note.text));
    right.push(div().id("board-total").flex_none().text_size(T_XS).text_color(t.muted)
      .tooltip(this.filter ? "Offene Treffer · Kostensumme der Treffer" : "Offene Tickets · Kostensumme aller Karten im Board")
      .child(`${open} offen · Σ ${usd(total)} gesamt`));

    // Kopfzeile: Titel, Trefferzahl („12 von 49" im Filter), Suchfeld (⌘F), Notiz, Summe.
    // Esc im Feld leert den Filter, ohne die Kartenauswahl zu verlieren.
    const search = div().id("board-search").flex_1().min_w(80).max_w(280)
      .on_key_down((ev, cx) => { if (ev.key === "escape" && this.filter) { this.clearFilter(cx); cx.stop_propagation(); } })
      .child(ui.inputBox(t, "board-filter", Input.new(this.search), { focused: this.focus.has("board-filter") }));
    const count = this.filter ? `${flat.length} von ${this.tickets.length}` : String(flat.length);
    const header = h_flex().id("board-header").h(H_HEADER).flex_none().px(INSET_PANEL).gap(GAP_M).items_center()
      .border_b(1).border_color(t.border)
      .child(div().flex_none().text_size(T_L).font_semibold().text_color(t.foreground).child("Board"))
      .when(Boolean(scope), (el) => el.child(scope))
      .child(div().id("board-count").flex_none().text_size(T_XS).text_color(t.dim)
        .when(Boolean(this.filter), (el) => el.tooltip(`${flat.length} von ${this.tickets.length} Tickets passen zum Filter`))
        .child(count))
      .child(search)
      .children(right);

    let body;
    if (mode === "4") {
      body = h_flex().id("board-cols").flex_1().min_h(0).items_stretch().p(INSET_PANEL).gap(GAP_M)
        .children(STAGES.map((s) => this.column(t, s.key, by[s.key], { grow: true, onToggle: () => this.toggleDone(cx) })));
    } else if (mode === "2") {
      const row = (a, b) => h_flex().flex_1().min_h(0).items_stretch().gap(GAP_M)
        .child(this.column(t, a, by[a], { grow: true, onToggle: () => this.toggleDone(cx) }))
        .child(this.column(t, b, by[b], { grow: true, onToggle: () => this.toggleDone(cx) }));
      body = v_flex().id("board-grid").flex_1().min_h(0).p(INSET_PANEL).gap(GAP_M)
        .child(row("todo", "doing")).child(row("review", "done"));
    } else {
      const at0 = STAGES.findIndex((s) => s.key === stageOf(flat.find((x) => x.id === this.selected) ?? { status: "todo" }));
      if (this.reveal) { this.outer.scroll_to_item(Math.max(0, at0)); this.reveal = null; }
      body = v_flex().id("board-stack").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.outer)
        .p(INSET_PANEL).gap(GAP_M)
        .children(STAGES.map((s) => this.column(t, s.key, by[s.key], { grow: false, onToggle: () => this.toggleDone(cx) })));
    }

    return v_flex().id("board").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .on_key_down((ev, cx) => this.onKey(ev, cx))
      .on_size_change((size, cx) => {
        // on_size_change meldet echte Pixel; Layout und Karten rechnen in Layout-Pixeln.
        const w = Math.round(size.width / (settings().zoom || 1));
        if (w !== this.width) { this.width = w; cx.notify(); }
      })
      .child(header)
      .child(body);
  }
}
