// Board: die Pipeline als Kanban (Geplant · In Arbeit · Prüfung · Fertig). Vier
// Spalten mit Kopf (Name, Zahl n/limit, Kostensumme) und eigenem Scroll; bei schmalem
// Panel 2×2, darunter untereinander. Die WIP-Limits kommen aus `hub wip --json`
// (data/orchestra/wip.json): „In Arbeit" und „Prüfung" tragen `n/limit`, sind voll
// gedimmt und färben den Zähler in der Wartet-Farbe. Die Karten sind die Ticket-Karte
// aus card.js (dieselbe wie im Team-Panel): ID, Labels, Status, Titel, Agent, Branch,
// Alter in der Stufe, Gates, Kosten, Kommentare, Nachweise, Sperre; Hover mit Öffnen /
// Agent / Prüfen.
//
// Daten: `hub ticket list --all --json` (Ticket-Dateien, alle fünf Sekunden) für die
// Karten, `hub wip --json` (data/orchestra/wip.json, alle 30 s) für die Limits,
// shared "orchestra.gates" bzw. `hub gates --json` für die Gates, shared
// "orchestra.costs" (Datei data/orchestra/costs.json als Rückfall) für die Kosten,
// shared "agents.identity" für Avatare (über ui.identityChip). "board.panel" schaltet
// das Panel um; die Tab-Leiste trägt der Orchestrator ein (nicht dieser Mod).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { exec, appHome, readTextFile, shared, theme, layout, run, notify, nextCommand, openOverlay, settings } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, GAP_S, GAP_M, INSET_PANEL, H_SECTION, H_ROW, usd, at } from "./ui.js";
import { STAGES, stageOf, stageColor, ticketCard, blockersOf } from "./card.js";

const HUB = () => `${appHome()}/mods/orchestra/bin/hub`;
const REFRESH = 5000, GATE_REFRESH = 15000, COST_REFRESH = 30000, WIP_REFRESH = 30000;
// `hub wip --json` owns the limits (data/orchestra/wip.json); these are its defaults.
const WIP_DEFAULT = { arbeit: 3, pruefung: 2 };
// Fertig bleibt eine Spalte, keine Liste: die letzten Abnahmen stehen, der Rest klappt zu.
const DONE_SHOW = 5;
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const normalize = (t) => ({ ...t, comments: t.comments ?? t.verlauf?.length ?? 0 });
const sortCards = (a, b) => at(a.status_at || a.updated || a.created) - at(b.status_at || b.updated || b.created)
  || String(a.id).localeCompare(String(b.id));

export default class Board extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.tickets = (shared("orchestra.tickets") ?? []).map(normalize);
    this.gates = shared("orchestra.gates") ?? [];
    this.costFile = null;
    this.wip = { ...WIP_DEFAULT };
    this.selected = null;
    this.hovered = null;
    this.reveal = null;
    this.width = 0;
    // Auf-/Zuklappen gilt für die Sitzung (localStorage), nicht für ein Ticket.
    try { this.doneAll = localStorage.getItem("doneAll") === "1"; } catch { this.doneAll = false; }
    this.loaded = false;
    this.note = null;
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

  readTickets(cx) {
    if (this.readingT) return;
    this.readingT = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["ticket", "list", "--all", "--json"], { timeout: 20000 });
        if (r.code === 0) { this.tickets = JSON.parse(r.stdout || "[]").map(normalize); this.loaded = true; }
      } catch {} finally { this.readingT = false; cx.notify(); }
    });
  }

  readGates(cx) {
    if (this.readingG) return;
    this.readingG = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["gates", "--json"], { timeout: 20000 });
        if (r.code === 0) this.gates = JSON.parse(r.stdout || "[]");
      } catch {} finally { this.readingG = false; cx.notify(); }
    });
  }

  readCosts(cx) {
    if (this.readingC) return;
    this.readingC = true;
    const path = `${appHome()}/data/orchestra/costs.json`;
    cx.spawn(async (cx) => {
      try { this.costFile = JSON.parse(await readTextFile(path) ?? "{}"); } catch {}
      finally { this.readingC = false; cx.notify(); }
    });
  }

  // The WIP limits from `hub wip`; the Board counts its own columns against them.
  readWip(cx) {
    if (this.readingW) return;
    this.readingW = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(HUB(), ["wip", "--json"], { timeout: 20000 });
        if (r.code === 0) this.wip = { ...WIP_DEFAULT, ...JSON.parse(r.stdout || "{}") };
      } catch {} finally { this.readingW = false; cx.notify(); }
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

  columns() {
    const by = { todo: [], doing: [], review: [], done: [] };
    for (const tk of this.tickets) by[stageOf(tk)].push(tk);
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
    const by = this.columns(), list = this.flat(by);
    const i = list.findIndex((t) => t.id === this.selected);
    const k = ev.key;
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

  render(cx) {
    const t = theme();
    const by = this.columns();
    const flat = this.flat(by);
    if (this.selected && !flat.some((x) => x.id === this.selected)) this.selected = null;
    const mode = this.mode(this.width || 368);
    const open = flat.filter((x) => stageOf(x) !== "done").length;
    const total = flat.reduce((n, tk) => n + this.spentOf(tk), 0);

    const right = [];
    if (this.note) right.push(div().id("board-note").max_w(230).truncate().text_size(T_XS)
      .text_color(this.note.ok === false ? t.blocked : this.note.ok ? t.muted : t.dim)
      .tooltip(this.note.text).child(this.note.text));
    right.push(div().id("board-total").flex_none().text_size(T_XS).text_color(t.muted)
      .tooltip("Offene Tickets · Kostensumme aller Karten im Board").child(`${open} offen · Σ ${usd(total)} gesamt`));

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
      .child(ui.panelHeader(t, "Board", right, { count: flat.length }))
      .child(body);
  }
}
