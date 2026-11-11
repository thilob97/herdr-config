// The orchestrator in the Team panel (HubSection) and its watcher (HubDaemon).
// HubDaemon runs in a 0px block of the elric layout, so it works while the panel
// is closed: it starts the orchestrator when none runs (unless stopped by hand),
// publishes the orchestrator's tickets as shared "orchestra.tickets", and says
// when a ticket is ready for review or the orchestrator ends a turn.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, run, notify, playSound, openOverlay, shared, setShared, knownAgents } from "herdr";
import * as orch from "./orchestrator.js";
import * as tickets from "./tickets.js";

const WC = "mods/workspace-chrome";
const STATE = { working: "arbeitet", blocked: "wartet auf dich", error: "Fehler", done: "bereit", idle: "bereit" };
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");

export class HubDaemon {
  constructor(cx) {
    this.prev = null;        // ticket id → status, after the first read
    this.lastStatus = null;  // the orchestrator's last status
    this.lastTry = 0;
    this.refresh(cx);
    cx.timer.every(5000, (cx) => this.refresh(cx));
    cx.timer.after(8000, (cx) => this.ensure(cx));
    cx.timer.every(30000, (cx) => this.ensure(cx));
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
        const list = (await tickets.list()).filter((t) => t.by === "orchestrator");
        const slim = list.map(({ body, ...t }) => ({ ...t, summary: tickets.summaryOf({ body }) }))
          .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
        if (JSON.stringify(slim) !== JSON.stringify(shared("orchestra.tickets") ?? [])) setShared("orchestra.tickets", slim);
        const now = Object.fromEntries(slim.map((t) => [t.id, t.status]));
        if (this.prev) for (const t of slim) {
          if (t.status === "review" && this.prev[t.id] !== "review") {
            notify({ title: `Bereit zum Review: ${t.title}`.slice(0, 90), body: t.summary.split("\n")[0]?.slice(0, 200) || "Der Orchestrator hat es geprüft.",
              level: "success", timeout: 20000, action: { name: "tabs-graph.panel-team" } });
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
        level: st === "blocked" ? "warning" : "info", timeout: 15000, action: { name: "tabs-graph.panel-team" } });
    });
  }
}

export class HubSection {
  constructor(view, cx) {
    this.view = view;
    this.digest = { step: null, message: [] };
    this.note = null;
    this.busy = false;
    this.feedbackFor = null;
    this.showDone = false;
    this.known = [];
    this.ask = InputState.new({ placeholder: "Was soll das Team bauen?" });
    this.ask.on("submit", (_e, cx) => this.sendAsk(cx));
    this.feedback = InputState.new({ placeholder: "Was soll anders werden? (↵ an den Orchestrator)" });
    this.feedback.on("submit", (_e, cx) => this.sendFeedback(cx));
    cx.spawn(async (cx) => { this.known = (await knownAgents().catch(() => [])).filter((a) => a.installed); cx.notify(); });
    this.poll(cx);
    cx.timer.every(3000, (cx) => this.poll(cx));
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

  sendAsk(cx) {
    const text = this.ask.value().trim();
    if (!text) return;
    this.act(cx, "an den Orchestrator gesendet", async () => { await orch.send(text); this.ask.set_value(""); });
  }

  sendFeedback(cx) {
    const text = this.feedback.value().trim(), t = (shared("orchestra.tickets") ?? []).find((x) => x.id === this.feedbackFor);
    if (!text || !t) return;
    this.act(cx, "Feedback weitergegeben", async () => {
      await orch.send(`Feedback vom Menschen zu Ticket ${t.id} „${t.title}“: ${text}`);
      await tickets.setStatus(t.id, "doing");
      this.feedback.set_value(""); this.feedbackFor = null;
    });
  }

  accept(cx, t) {
    this.act(cx, `${t.title}: abgenommen`, async () => {
      await tickets.setStatus(t.id, "done");
      if (orch.find()) await orch.send(`Ticket ${t.id} „${t.title}“ wurde vom Menschen abgenommen.`);
    });
  }

  openTerminal(address) {
    const a = agents().find((x) => x.address === address);
    if (a) run("pane.focus", { pane: a.pane });
    else run("terminal.peek", { terminal: address });
  }

  cycleAgent() {
    const keys = this.known.map((a) => a.key);
    if (!keys.length) return;
    setShared("orchestra.agent", keys[(keys.indexOf(orch.agentKey()) + 1) % keys.length]);
  }

  // ---------- view ----------

  btn(t, id, label, action, { strong = false, enabled = true } = {}) {
    return div().id(id).h(24).px(9).flex().flex_none().items_center().rounded(6).text_size(11.5)
      .bg(strong && enabled ? t.solid : t.raised).text_color(!enabled ? t.dim : strong ? t.solid_foreground : t.foreground)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }))
      .child(label);
  }

  iconBtn(t, id, icon, tip, action) {
    return div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).tooltip(tip)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(icon).size(13));
  }

  dot(t, st, size = 8) {
    if (st === "working") return svg(`${WC}/spinner.svg`).size(size + 4).flex_none().text_color(t.working).spin(900);
    const color = !st ? t.dim : st === "blocked" || st === "error" ? t.blocked : t.done;
    return div().size(size + 4).flex_none().flex().items_center().justify_center()
      .child(st === "blocked" ? div().size(size).rounded_full().bg(color).loop("opacity", { from: 0.3, to: 1, period: 900 }) : div().size(size).rounded_full().bg(color));
  }

  label(t, text, n, color) {
    return h_flex().px(2).pt(6).gap(6).items_center().text_size(11).font_medium()
      .child(div().text_color(color ?? t.muted).child(text))
      .when(n != null, (el) => el.child(div().text_color(t.dim).child(String(n))));
  }

  card(t) {
    const o = orch.find(), st = o?.status ?? null;
    const name = this.known.find((a) => a.key === orch.agentKey())?.name ?? orch.agentKey();
    const { step, message } = this.digest;
    const word = !o ? (orch.autostart() ? "startet gleich" : "aus") : st === "working" ? "arbeitet" : st === "blocked" ? "braucht dich" : "bereit";
    const stColor = !o ? t.dim : st === "blocked" ? t.blocked : st === "working" ? t.working : t.done;
    const restart = (cx) => this.act(cx, "neu gestartet", async () => { await orch.stop(); await orch.start(); });
    const body = !o
      ? div().text_size(12).text_color(t.dim).child(orch.autostart() ? "Startet in wenigen Sekunden …" : "Angehalten. Starte ihn, damit er Aufträge annimmt.")
      : st === "working"
        ? h_flex().gap(7).items_center().text_size(12).text_color(t.muted)
          .child(svg(`${WC}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900))
          .child(div().flex_1().min_w(0).truncate().child(step ?? "denkt nach"))
        : message.length
          ? v_flex().gap(2).text_size(12).text_color(st === "blocked" ? t.foreground : t.muted).children(message.map((l, i) => div().id(`hub-msg-${i}`).child(l)))
          : div().text_size(12).text_color(t.dim).child("Bereit. Beschreib ein Ziel, er plant Tickets und verteilt sie ans Team.");
    return v_flex().id("hub-card").flex_none().rounded(10).bg(t.background).border(1)
      .border_color(st === "blocked" ? t.blocked : t.border).overflow_hidden()
      // Header: who, state, and the quiet controls.
      .child(h_flex().px(10).pt(9).pb(7).gap(8).items_center()
        .child(div().size(26).flex_none().rounded(7).bg(t.raised).flex().items_center().justify_center()
          .child(svg("mods/orchestra/icon.svg").size(14).text_color(o ? t.accent : t.dim)))
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Orchestrator"))
          .child(h_flex().gap(5).items_center().text_size(10.5)
            .child(this.dot(t, o ? st ?? "idle" : null, 6))
            .child(div().text_color(stColor).child(word))
            .child(div().text_color(t.dim).child("·"))
            .child(div().id("hub-agent").text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
              .tooltip("Agent wechseln (gilt beim nächsten Start)").on_click((_e, cx) => { this.cycleAgent(); cx.notify(); })
              .child(`${name} ▾`))))
        .when(Boolean(o), (el) => el
          .child(this.iconBtn(t, "hub-open", "mods/orchestra/icons/open.svg", "Terminal öffnen", () => run("terminal.peek", { terminal: o.address })))
          .child(this.iconBtn(t, "hub-restart", "mods/orchestra/icons/restart.svg", "Neu starten (frischer Kontext)", restart))
          .child(this.iconBtn(t, "hub-stop", "mods/orchestra/icons/stop.svg", "Anhalten (startet nicht mehr von selbst)",
            (cx) => this.act(cx, "angehalten", async () => { orch.setAutostart(false); await orch.stop(); }))))
        .when(!o, (el) => el.child(this.btn(t, "hub-start", "Starten", (cx) => this.act(cx, "gestartet", async () => { orch.setAutostart(true); await orch.start(); }), { strong: true, enabled: !this.busy }))))
      // What it is doing or last said.
      .child(div().id("hub-body").px(12).py(9).mx(10).rounded(8).bg(t.chrome).cursor_pointer()
        .when(Boolean(o), (el) => el.tooltip("Klicken: Terminal öffnen").on_click(() => run("terminal.peek", { terminal: o.address })))
        .child(body))
      // The ask field with its send button inside.
      .child(h_flex().m(10).h(34).pl(11).pr(4).gap(6).items_center().rounded(8).border_1()
        .border_color(o ? t.input : t.border).bg(t.background)
        .child(Input.new(this.ask).flex_1().h_full().text_size(12.5).text_color(t.foreground))
        .child(div().id("hub-send").size(26).flex_none().flex().items_center().justify_center().rounded(6)
          .bg(o && !this.busy ? t.solid : t.raised).text_color(o && !this.busy ? t.solid_foreground : t.dim)
          .when(Boolean(o) && !this.busy, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.sendAsk(cx)))
          .child(svg("mods/orchestra/icons/send.svg").size(13))))
      .when(Boolean(this.note), (el) => el.child(div().px(12).pb(8).mt(-4).text_size(10.5).text_color(this.note.ok ? t.dim : t.blocked).child(this.note.text)));
  }

  ticketRow(t, tk) {
    const live = tk.terminal ? terminals().find((x) => x.address === tk.terminal && x.state === "live") : null;
    const ast = live?.status ?? null;
    const review = tk.status === "review", done = tk.status === "done";
    const fb = this.feedbackFor === tk.id;
    const where = [tk.branch || tk.repo?.split("/").pop(), tk.machine].filter(Boolean).join(" · ");
    const right = tk.status === "doing"
      ? (live ? { working: "arbeitet", blocked: "wartet", done: "fertig", idle: "ruhig" }[ast] ?? ast ?? "" : "beendet")
      : tk.status === "todo" ? "offen" : "";
    return v_flex().id(`tk-${tk.id}`).flex_none().gap(6).px(10).py(8).rounded(9)
      .bg(t.background).border(1).border_color(review ? t.done : t.border)
      .when(!review, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => tk.terminal && this.openTerminal(tk.terminal)))
      .child(h_flex().gap(8).items_center()
        .child(tk.status === "doing" ? this.dot(t, ast ?? "idle", 7) : div().size(11).flex_none().flex().items_center().justify_center()
          .child(div().size(7).rounded_full().when(review, (e) => e.bg(t.done)).when(done, (e) => e.bg(t.dim)).when(!review && !done, (e) => e.border_1().border_color(t.muted))))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(12.5).text_color(done ? t.dim : t.foreground).when(done, (e) => e.line_through()).child(tk.title))
          .when(Boolean(where), (e) => e.child(div().truncate().text_size(10.5).text_color(t.dim).child(where))))
        .when(Boolean(right), (el) => el.child(div().flex_none().text_size(10.5).text_color(ast === "blocked" ? t.blocked : ast === "working" ? t.working : t.dim).child(right))))
      .when(review && Boolean(tk.summary), (el) => el.child(div().pl(19).text_size(11.5).text_color(t.muted).child(tk.summary.length > 320 ? `${tk.summary.slice(0, 320)}…` : tk.summary)))
      .when(review, (el) => el.child(h_flex().pl(19).gap(5).items_center().flex_wrap()
        .child(this.btn(t, `tk-rv-${tk.id}`, "Review", () => openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
          props: { terminal: tk.terminal, folder: tk.worktree || tk.repo, on: tk.machine || null } }), { strong: true }))
        .child(this.btn(t, `tk-ok-${tk.id}`, "Abnehmen", (cx) => this.accept(cx, tk), { enabled: !this.busy }))
        .child(this.btn(t, `tk-fb-${tk.id}`, fb ? "Abbrechen" : "Änderungen …", (cx) => {
          this.feedbackFor = fb ? null : tk.id;
          if (!fb) this.feedback.focus();
          cx.notify();
        }))))
      .when(fb, (el) => el.child(h_flex().ml(19).h(30).px(9).items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.feedback).flex_1().h_full().text_size(12).text_color(t.foreground))));
  }

  tickets(t) {
    const all = shared("orchestra.tickets") ?? [];
    const by = (s) => all.filter((x) => x.status === s);
    const doing = all.filter((x) => !["review", "done", "todo"].includes(x.status));
    const done = by("done");
    const el = v_flex().flex_none().gap(6);
    if (!all.length) return el.child(h_flex().gap(10).px(12).py(11).rounded(9).border_1().border_color(t.border).items_center()
      .child(svg("mods/orchestra/icons/tray.svg").size(16).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.dim).child("Noch keine Tickets. Der Orchestrator legt sie in Quests an, sobald du ihm ein Ziel gibst.")));
    if (by("review").length) el.child(this.label(t, "Bereit für dich", by("review").length, t.done)).children(by("review").map((x) => this.ticketRow(t, x)));
    if (doing.length) el.child(this.label(t, "In Arbeit", doing.length, t.working)).children(doing.map((x) => this.ticketRow(t, x)));
    if (by("todo").length) el.child(this.label(t, "Geplant", by("todo").length)).children(by("todo").map((x) => this.ticketRow(t, x)));
    if (done.length) el.child(h_flex().id("tk-done").px(2).pt(6).gap(6).items_center().text_size(11).font_medium().text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.showDone = !this.showDone; cx.notify(); })
      .child("Erledigt").child(String(done.length))
      .child(svg(`${WC}/${this.showDone ? "chevron-down" : "chevron-right"}.svg`).size(11)))
      .when(this.showDone, (e) => e.children(done.map((x) => this.ticketRow(t, x))));
    return el;
  }

  render(t) {
    return v_flex().flex_none().gap(4)
      .child(this.card(t))
      .child(this.label(t, "Tickets", (shared("orchestra.tickets") ?? []).filter((x) => x.status !== "done").length || null))
      .child(this.tickets(t));
  }
}
