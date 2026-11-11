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
      // The last line of its reply: not box borders, the right-aligned session title, or the status line.
      try { line = (await orch.screen(14)).filter((l) => !/^\s{20,}/.test(l) && !/▶|⎋|~\/\.herdr\/orchestrator/.test(l)).map((l) => l.trim())
        .filter((l) => l && !/^[─━│╭╰╮╯├┤>π-]/.test(l)).pop() ?? ""; } catch {}
      notify({ title: st === "blocked" ? "Orchestrator braucht dich" : "Orchestrator meldet sich", body: line.slice(0, 200),
        level: st === "blocked" ? "warning" : "info", timeout: 15000, action: { name: "tabs-graph.panel-team" } });
    });
  }
}

export class HubSection {
  constructor(view, cx) {
    this.view = view;
    this.lines = [];
    this.note = null;
    this.busy = false;
    this.feedbackFor = null;
    this.showDone = false;
    this.known = [];
    this.ask = InputState.new({ placeholder: "Auftrag an den Orchestrator… (↵ senden)" });
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
      try { this.lines = await orch.screen(9); } catch { this.lines = []; }
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
    return div().id(id).h(22).px(7).flex().flex_none().items_center().rounded(5).text_size(11)
      .bg(strong && enabled ? t.solid : t.raised).text_color(!enabled ? t.dim : strong ? t.solid_foreground : t.foreground)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }))
      .child(label);
  }

  dot(t, st) {
    if (st === "working") return svg(`${WC}/spinner.svg`).size(11).flex_none().text_color(t.working).spin(900);
    const color = !st ? t.dim : st === "blocked" || st === "error" ? t.blocked : t.done;
    return div().size(11).flex_none().flex().items_center().justify_center()
      .child(st === "blocked" ? div().size(7).rounded(4).bg(color).loop("opacity", { from: 0.3, to: 1, period: 900 }) : div().size(7).rounded(4).bg(color));
  }

  card(t) {
    const o = orch.find(), st = o?.status ?? null;
    const name = this.known.find((a) => a.key === orch.agentKey())?.name ?? orch.agentKey();
    return v_flex().id("hub-card").flex_none().gap(7).p(9).rounded(8).bg(t.background).border(1)
      .border_color(st === "blocked" ? t.blocked : o ? t.accent : t.border)
      .child(h_flex().gap(7).items_center()
        .child(svg("mods/orchestra/icon.svg").size(13).text_color(o ? t.accent : t.dim))
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Orchestrator"))
        .child(this.dot(t, o ? st ?? "idle" : null))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(st === "blocked" ? t.blocked : t.dim)
          .child(o ? `${STATE[st] ?? "startet…"} · ${o.address}` : orch.autostart() ? "startet gleich…" : "aus"))
        .child(div().id("hub-agent").h(20).px(6).flex().items_center().rounded(5).bg(t.raised).text_size(10.5).text_color(t.muted)
          .cursor_pointer().tooltip("Agent für den Orchestrator (gilt beim nächsten Start)").on_click((_e, cx) => { this.cycleAgent(); cx.notify(); })
          .child(`${name} ▾`)))
      .when(Boolean(o), (el) => el.child(v_flex().id("hub-screen").p(7).rounded(6).bg(t.chrome).text_size(10.5).text_color(t.muted)
        .cursor_pointer().tooltip("Öffnen").on_click(() => run("terminal.peek", { terminal: o.address }))
        .children((this.lines.length ? this.lines : ["…"]).map((l, i) => div().id(`hub-ln-${i}`).whitespace_nowrap().overflow_hidden().child(l || " ")))))
      .child(h_flex().h(28).px(8).gap(6).items_center().rounded(7).border_1().border_color(o ? t.input : t.border).bg(t.background)
        .child(div().text_color(t.dim).text_size(11).child("›"))
        .child(Input.new(this.ask).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().gap(4).items_center().flex_wrap()
        .child(this.btn(t, "hub-send", "Senden", (cx) => this.sendAsk(cx), { strong: true, enabled: Boolean(o) && !this.busy }))
        .child(this.btn(t, "hub-open", "Öffnen", () => run("terminal.peek", { terminal: o.address }), { enabled: Boolean(o) }))
        .child(o
          ? this.btn(t, "hub-stop", "Stoppen", (cx) => this.act(cx, "Orchestrator gestoppt", async () => { orch.setAutostart(false); await orch.stop(); }))
          : this.btn(t, "hub-start", "Starten", (cx) => this.act(cx, "Orchestrator gestartet", async () => { orch.setAutostart(true); await orch.start(); }), { strong: true, enabled: !this.busy }))
        .when(Boolean(o), (el) => el.child(this.btn(t, "hub-restart", "Neu starten", (cx) => this.act(cx, "Orchestrator neu gestartet", async () => {
          await orch.stop();
          await orch.start();
        }))))
        .when(Boolean(this.note), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(this.note.ok ? t.done : t.blocked).child(this.note.text))));
  }

  ticketRow(t, tk) {
    const live = tk.terminal ? terminals().find((x) => x.address === tk.terminal && x.state === "live") : null;
    const ast = live?.status ?? null;
    const review = tk.status === "review";
    const fb = this.feedbackFor === tk.id;
    return v_flex().id(`tk-${tk.id}`).flex_none().gap(4).px(8).py(6).rounded(7)
      .bg(review ? t.raised : t.background).border(1).border_color(review ? t.done : t.border)
      .child(h_flex().gap(6).items_center()
        .child(tk.status === "doing" ? this.dot(t, ast ?? "idle") : div().size(7).flex_none().rounded(4).bg(review ? t.done : tk.status === "done" ? t.dim : t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(tk.status === "done" ? t.dim : t.foreground).child(tk.title))
        .when(tk.status === "doing" && Boolean(tk.terminal), (el) => el.child(div().id(`tk-go-${tk.id}`).flex_none().text_size(10.5).text_color(t.dim)
          .cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => this.openTerminal(tk.terminal))
          .child(live ? `${tk.agent || "agent"} · ${{ working: "arbeitet", blocked: "wartet", done: "fertig", idle: "ruhig" }[ast] ?? ast ?? ""}` : "beendet"))))
      .child(div().truncate().text_size(10.5).text_color(t.dim)
        .child([tk.branch || tk.repo, tk.machine].filter(Boolean).join(" · ")))
      .when(review && Boolean(tk.summary), (el) => el.child(div().text_size(11).text_color(t.muted).child(tk.summary.slice(0, 400))))
      .when(review, (el) => el.child(h_flex().gap(4).items_center().flex_wrap()
        .child(this.btn(t, `tk-rv-${tk.id}`, "Review", () => openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680,
          props: { terminal: tk.terminal, folder: tk.worktree || tk.repo, on: tk.machine || null } }), { strong: true }))
        .child(this.btn(t, `tk-ok-${tk.id}`, "Abnehmen", (cx) => this.accept(cx, tk), { enabled: !this.busy }))
        .child(this.btn(t, `tk-fb-${tk.id}`, fb ? "Abbrechen" : "Änderungen anfordern", (cx) => {
          this.feedbackFor = fb ? null : tk.id;
          if (!fb) this.feedback.focus();
          cx.notify();
        }))))
      .when(fb, (el) => el.child(h_flex().h(26).px(7).items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.feedback).flex_1().h_full().text_size(11.5).text_color(t.foreground))));
  }

  tickets(t) {
    const all = shared("orchestra.tickets") ?? [];
    const by = (s) => all.filter((x) => x.status === s);
    const doing = all.filter((x) => x.status !== "review" && x.status !== "done" && x.status !== "todo");
    const done = by("done");
    const head = (label, n, color) => h_flex().pt(4).gap(6).text_size(10.5).font_semibold().text_color(color ?? t.dim)
      .child(label.toUpperCase()).child(div().text_color(t.dim).child(String(n)));
    const el = v_flex().flex_none().gap(5);
    if (!all.length) return el.child(div().px(2).text_size(11).text_color(t.dim)
      .child("Noch keine Tickets. Gib dem Orchestrator oben einen Auftrag; er legt Tickets in Quests an und verteilt sie ans Team."));
    if (by("review").length) el.child(head("Bereit für dich", by("review").length, t.done)).children(by("review").map((x) => this.ticketRow(t, x)));
    if (doing.length) el.child(head("In Arbeit", doing.length)).children(doing.map((x) => this.ticketRow(t, x)));
    if (by("todo").length) el.child(head("Offen", by("todo").length)).children(by("todo").map((x) => this.ticketRow(t, x)));
    if (done.length) el.child(h_flex().id("tk-done").pt(4).gap(6).text_size(10.5).font_semibold().text_color(t.dim).cursor_pointer()
      .on_click((_e, cx) => { this.showDone = !this.showDone; cx.notify(); })
      .child(`ERLEDIGT ${done.length} ${this.showDone ? "▴" : "▾"}`))
      .when(this.showDone, (e) => e.children(done.map((x) => this.ticketRow(t, x))));
    return el;
  }

  render(t) {
    return v_flex().flex_none().gap(8)
      .child(this.card(t))
      .child(div().pt(2).text_size(10.5).font_semibold().text_color(t.dim).child("TICKETS DES ORCHESTRATORS"))
      .child(this.tickets(t));
  }
}
