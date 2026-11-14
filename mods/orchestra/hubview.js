// The orchestrator in the Team panel (HubSection: its compact card and the ticket
// pipeline) and its watcher (HubDaemon). HubDaemon runs in a 0px block of the elric
// layout, so it works while the panel is closed: it starts the orchestrator when none
// runs (unless stopped by hand), publishes the orchestrator's tickets as shared
// "orchestra.tickets", and says when a ticket is ready for review or the orchestrator
// ends a turn. The panel republishes the tickets too (without notifications), so it is
// current even where no daemon runs.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, notify, playSound, openOverlay, shared, setShared, knownAgents, terminals, exec, appHome } from "herdr";
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
    this.openVerlauf = new Set();   // ticket ids whose whole Verlauf is unfolded
    this.focus = ui.focusFields();
    this.focus.track(this.reply, "hub-reply");
    cx.spawn(async (cx) => { this.known = (await knownAgents().catch(() => [])).filter((a) => a.installed); cx.notify(); });
    this.poll(cx);
    cx.timer.every(3000, (cx) => this.poll(cx));
    this.publish(cx);
    cx.timer.every(5000, (cx) => this.publish(cx));
    this.gates = new GateWatcher(cx);
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

  // A Verlauf line: role · time above, the comment below with its @tags highlighted.
  // Words become spans so the narrow panel wraps between them.
  verlaufLine(t, v) {
    return v_flex().min_w(0).gap(0).text_size(T_XS)
      .child(div().text_color(t.dim).child(`${v.role} · ${v.ts.slice(11)}`))
      .child(h_flex().min_w(0).flex_wrap().text_color(t.muted)
        .children(v.text.split(/\s+/).filter(Boolean).map((w) =>
          div().when(w.startsWith("@"), (e) => e.text_color(t.accent).font_medium()).child(`${w} `))));
  }

  // The last two comments, or the whole Verlauf on click ("alle").
  verlaufBlock(t, tk) {
    const all = tk.verlauf ?? [];
    const open = this.openVerlauf.has(tk.id), shown = open ? all : all.slice(-2);
    return v_flex().id(`tk-verlauf-${tk.id}`).gap(2).pt(2).border_t(1).border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().items_center().gap(ui.GAP_S)
        .child(div().text_size(T_XS).text_color(t.dim).child(`Verlauf ${all.length}`))
        .child(div().flex_1())
        .child(div().id(`tk-verlauf-all-${tk.id}`).flex_none().text_size(T_XS).text_color(t.muted).cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .tooltip(open ? "Nur die letzten zwei Kommentare zeigen" : "Den ganzen Verlauf zeigen")
          .on_click((_e, cx) => {
            if (open) this.openVerlauf.delete(tk.id); else this.openVerlauf.add(tk.id);
            cx.notify();
          }).child(open ? "weniger" : "alle")))
      .when(open, (el) => el.child(div().max_h(150).overflow_y_scroll().children(shown.map((v) => this.verlaufLine(t, v)))))
      .when(!open, (el) => el.children(shown.map((v) => div().max_h(32).overflow_hidden().child(this.verlaufLine(t, v)))));
  }

  openReview(tk) {
    openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
      props: { ticket: tk.id, terminal: tk.terminal || null, folder: tk.worktree || tk.repo, on: tk.machine || null } });
  }

  ticketRow(t, tk, { primary = false } = {}) {
    const stage = stageOf(tk);
    const live = tk.terminal ? terminals().find((x) => x.address === tk.terminal && x.state === "live") : null;
    const c = costs.costs();
    const spent = c.tickets?.[tk.id], limit = costs.ticketLimit(tk.id);
    const stopped = Boolean(c.stopped?.[tk.id]) && stage !== "done";
    const over = stopped || (spent != null && spent > limit);
    const status = stage === "review" ? "blocked" : stage === "done" ? "done" : stage === "doing" ? live?.status ?? "idle" : "idle";
    const where = [tk.branch || tk.repo?.split("/").pop(), tk.machine].filter(Boolean).join(" · ");
    const landed = tk.merged ? `gemergt ${tk.merged}` : tk.pr ? "PR offen" : "";
    const done = stage === "done";
    return ui.card(t, `tk-${tk.id}`, { border: stopped ? t.blocked : undefined })
      .when(!done && Boolean(tk.terminal) && stage !== "review", (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Klicken: zum Agent").on_click(() => ui.focusAgent(tk.terminal)))
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(ui.statusIcon(t, status))
        .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(done ? t.muted : t.foreground).child(tk.title))
        .when(spent != null, (el) => el.child(div().flex_none().text_size(T_XS).text_color(over ? t.blocked : t.muted)
          .tooltip(`Kosten dieses Tickets / Budget (${tk.agent || "Agent"}; nur omp meldet Kosten)`).child(`${usd(spent)} / ${usd(limit)}`))))
      .child(h_flex().gap(ui.GAP_S).items_center().min_w(0)
        .when(Boolean(tk.terminal), (el) => el.child(div().flex_none().max_w(130).child(ui.identityChip(t, `tk-who-${tk.id}`, tk.terminal))))
        .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.muted).tooltip(where).child(where))
        .when(tk.lessons != null, (el) => {
          const n = tk.lessons.length, tip = [
            `${n} ${n === 1 ? "Lehre" : "Lehren"} für dieses Repo`,
            ...tk.lessons.slice(-3).map((l) => `· ${l.text}`),
            tk.lessonProposal ? "Ein Vorschlag wartet im Review-Fenster." : "",
          ].filter(Boolean).join("\n");
          return el.child(div().id(`tk-lessons-${tk.id}`).flex_none().text_size(T_XS)
            .text_color(tk.lessonProposal ? t.accent : t.muted).tooltip(tip).child(`Lehren ${n}`));
        })
        .when(Boolean(landed), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.done).when(Boolean(tk.pr), (x) => x.tooltip(tk.pr)).child(landed)))
        .when(stage !== "todo", (el) => el.children(ui.gateChips(t, tk, gateOf(tk.id)))))
      .when(stage === "review" && Boolean(tk.summary), (el) => el.child(div().max_h(36).overflow_hidden().text_size(T_S).text_color(t.muted).child(clip(tk.summary))))
      .when((tk.verlauf ?? []).length > 0, (el) => el.child(this.verlaufBlock(t, tk)))
      .when(stage === "review", (el) => el.child(h_flex().gap(ui.GAP_M).items_center()
        .child(ui.button(t, `tk-rv-${tk.id}`, "Prüfen", () => this.openReview(tk),
          { kind: primary ? "primary" : "secondary", small: true, tip: "Zusammenfassung, Nachweise und Diff prüfen; dort Mergen, PR oder Abnehmen" }))
        .when((tk.evidence ?? []).length > 0, (r) => r.child(div().text_size(T_XS).text_color(t.muted)
          .child(`${tk.evidence.length} ${tk.evidence.length === 1 ? "Nachweis" : "Nachweise"}`)))))
      .when(stopped, (el) => el.child(h_flex().gap(ui.GAP_M).items_center()
        .child(div().flex_1().min_w(0).text_size(T_S).text_color(t.blocked).child("Budget erreicht, Agent angehalten."))
        .child(ui.button(t, `tk-raise-${tk.id}`, `+${usd(costs.budget().ticket)}`, (cx) => this.act(cx, "Budget erhöht", () => costs.raiseTicket(tk)),
          { kind: "primary", small: true, tip: "Budget dieses Tickets erhöhen; der Agent macht weiter" }))));
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
