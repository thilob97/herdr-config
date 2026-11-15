// Team-Hub: the named agents of the roster (agents/roster.json) as cards. Each agent
// keeps its role, program, model, checkout and branch prefix, so it can be dispatched
// again and again by name (`hub dispatch --agent <name>`, `hub agent …`). The window
// reads the roster and the tickets through bin/hub, shows every agent's running
// tickets and can start an order for the selected agent (the Auftrag dialog, prefilled)
// without typing into a running agent.
// Opened as a window (mod.open --name teams).

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, theme, props, closeOverlay, openOverlay, nextCommand, appHome } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M, T_L, T_XL, usd } from "./ui.js";

const HUB = () => `${appHome()}/mods/orchestra/bin/hub`;
const PROGRAMS = [
  { key: "omp", name: "Oh My Pi" },
  { key: "claude", name: "Claude" },
  { key: "codex", name: "Codex" },
  { key: "pi", name: "Pi" },
];
const COLORS = ["c1", "c2", "c3", "c4", "c5", "c6"];
const REFRESH = 15000;

// c1..c6 are the roster's series colours; the theme decides what they look like.
const colorOf = (t, c) => ({ c1: t.accent, c2: t.working, c3: t.done, c4: t.blocked, c5: t.solid, c6: t.muted }[c] ?? t.accent);
// Theme colour + alpha suffix (5.4); a colour that is already translucent stays as it is.
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + a : c);
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const programName = (key) => PROGRAMS.find((p) => p.key === key)?.name ?? (key || "—");
const tail = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop() || "—";
const clean = (e) => String(e?.message ?? e ?? "fehlgeschlagen")
  .replace(/^Error: /, "").replace(/^hub: /, "").replace(/^herdr\.exec: /, "");
const lastLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop().slice(0, 240);
const STATUS = {
  todo: { label: "geplant", color: (t) => t.muted },
  doing: { label: "in Arbeit", color: (t) => t.working },
  review: { label: "Prüfung", color: (t) => t.blocked },
  done: { label: "fertig", color: (t) => t.done },
};

async function hub(args, timeout = 30000) {
  const r = await exec(HUB(), args, { timeout });
  if (r.code !== 0) throw new Error(lastLine(r));
  return r.stdout.trim();
}

const json = (text, fallback) => {
  try { return JSON.parse(text || ""); } catch { return fallback; }
};

export default class Teams extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.agents = [];
    this.tickets = [];
    this.stats = new Map();
    this.filter = localStorage.getItem("teams.filter") === "active" ? "active" : "all";
    this.selected = localStorage.getItem("teams.selected");
    this.mode = "list";          // "list" | "form"
    this.form = null;            // { editing, color, branchPrefix, program }
    this.confirm = null;         // agent name waiting for the delete confirmation
    this.error = "";
    this.busy = false;
    this.loading = true;
    this.gen = 0;

    const field = (placeholder) => {
      const s = InputState.new({ placeholder });
      s.on("change", (_e, cx) => cx.notify());
      s.on("submit", (_e, cx) => { if (this.mode === "form") this.save(cx); });
      return s;
    };
    this.fName = field("Name, z. B. Zap");
    this.fRole = field("Rolle, z. B. Umsetzer");
    this.fModel = field("Modell, optional, z. B. opencode-go/…");
    this.fRepo = field("Repo-Pfad, z. B. ~/.config/herdr-app");
    this.fLabels = field("Labels, kommagetrennt, z. B. ui, tests");
    this.fNotes = TextareaState.new({ rows: 4, placeholder: "Notizen für die erste Nachricht: Vorlieben, Grenzen, Prüfschritte …" });
    this.fNotes.on("change", (_e, cx) => cx.notify());
    this.focus = ui.focusFields();
    for (const [id, state] of [["tm-f-name", this.fName], ["tm-f-role", this.fRole], ["tm-f-model", this.fModel],
      ["tm-f-repo", this.fRepo], ["tm-f-labels", this.fLabels], ["tm-f-notes", this.fNotes]]) this.focus.track(state, id);

    this.load(cx);
    cx.timer.every(REFRESH, (cx) => { if (this.mode === "list" && !this.busy && !this.loading) this.load(cx); });
    // While the window is loaded, the bar's "Team-Hub" (teams.panel, ⌘⌥9) closes it again.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "panel" && c !== "toggle") continue;
        const overlay = props()?.overlay;
        if (overlay) closeOverlay(overlay);
        else openOverlay({ mod: "teams", kind: "window", key: "teams", width: 980, height: 680 });
      }
    });
  }

  // ---- data ---------------------------------------------------------------

  async fetchAll() {
    const [roster, tickets, stats] = await Promise.all([
      hub(["agent", "list", "--json"]),
      hub(["ticket", "list", "--all", "--json"]),
      hub(["stats", "--json"]),
    ]);
    return {
      agents: json(roster, null), tickets: json(tickets, null), stats: json(stats, null),
    };
  }

  apply(data) {
    if (!Array.isArray(data.agents) || !Array.isArray(data.tickets)) throw new Error("Der Roster ist nicht lesbar.");
    this.agents = data.agents;
    this.tickets = data.tickets;
    this.stats = new Map((data.stats?.agents ?? []).map((a) => [String(a.name).toLowerCase(), a]));
    const names = this.agents.map((a) => a.name);
    if (!names.some((n) => same(n, this.selected))) this.selected = names[0] ?? null;
    if (this.selected) localStorage.setItem("teams.selected", this.selected);
  }

  load(cx) {
    const gen = ++this.gen;
    cx.spawn(async (cx) => {
      try {
        const data = await this.fetchAll();
        if (gen !== this.gen) return;
        this.apply(data);
        this.error = "";
      } catch (e) {
        if (gen === this.gen) this.error = clean(e);
      } finally {
        if (gen === this.gen) {
          this.loading = false;
          this.busy = false;
          cx.notify();
        }
      }
    });
  }

  // One mutation, then a fresh read from hub (it is the one writer of the roster).
  act(cx, fn, after) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await fn();
        const data = await this.fetchAll();
        this.apply(data);
        after?.();
        this.error = "";
      } catch (e) {
        this.error = clean(e);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  agentOf(name) {
    return this.agents.find((a) => same(a.name, name)) ?? null;
  }

  running(name) {
    return this.tickets
      .filter((tk) => same(tk.agent, name) && tk.status !== "done")
      .sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")));
  }

  usesOf(name) {
    return this.tickets.filter((tk) => same(tk.agent, name)).length;
  }

  costOf(name) {
    return Number(this.stats.get(String(name).toLowerCase())?.cost ?? 0);
  }

  activeOf(agent) {
    return this.running(agent.name).length > 0;
  }

  // ---- roster changes -----------------------------------------------------

  openForm(cx, agent = null) {
    this.confirm = null;
    this.error = "";
    this.mode = "form";
    this.form = {
      editing: agent?.name ?? null,
      program: agent?.program ?? "omp",
      color: agent?.color ?? COLORS[this.agents.length % COLORS.length],
      branchPrefix: agent?.branch_prefix ?? "feat/",
    };
    this.fName.set_value(agent?.name ?? "");
    this.fRole.set_value(agent?.role ?? "");
    this.fModel.set_value(agent?.model ?? "");
    this.fRepo.set_value(agent?.repo ?? "");
    this.fLabels.set_value((agent?.labels ?? []).join(", "));
    this.fNotes.set_value(agent?.notes ?? "");
    cx.notify();
    cx.timer.after(50, () => this.fName.focus());
  }

  closeForm(cx) {
    this.mode = "list";
    this.form = null;
    this.error = "";
    cx.notify();
  }

  save(cx) {
    if (!this.form || this.busy) return;
    const name = this.fName.value().trim();
    if (!name) { this.error = "Der Name fehlt."; cx.notify(); this.fName.focus(); return; }
    const role = this.fRole.value().trim();
    const model = this.fModel.value().trim();
    const repo = this.fRepo.value().trim();
    const labels = this.fLabels.value().split(",").map((s) => s.trim()).filter(Boolean).join(",");
    const notes = this.fNotes.value().trim();
    const editing = this.form.editing;
    const args = editing ? ["agent", "edit", editing] : ["agent", "add"];
    args.push("--name", name, "--role", role, "--program", this.form.program, "--model", model,
      "--repo", repo, "--branch-prefix", this.form.branchPrefix ?? "feat/", "--labels", labels, "--notes", notes);
    if (!editing) args.push("--color", this.form.color);
    this.act(cx, () => hub(args), () => {
      this.selected = name;
      localStorage.setItem("teams.selected", name);
      this.mode = "list";
      this.form = null;
    });
  }

  remove(cx, name) {
    this.act(cx, () => hub(["agent", "rm", name]), () => {
      this.confirm = null;
    });
  }

  // ---- order --------------------------------------------------------------

  orderText(agent) {
    const model = agent.model ? ` · ${agent.model}` : "";
    const prefix = agent.branch_prefix || "feat/";
    return [
      `Auftrag für ${agent.name}${agent.role ? ` (${agent.role})` : ""}.`,
      `Programm/Modell: ${programName(agent.program)}${model}`,
      agent.repo ? `Checkout: ${agent.repo}` : null,
      `Branch: ${prefix}…`,
      "",
      `Was soll ${agent.name} tun? Ziel, Kontext und woran du erkennst, dass es fertig ist …`,
    ].filter((x) => x != null).join("\n");
  }

  startOrder(agent) {
    openOverlay({
      mod: "launcher", kind: "dialog", width: 860, height: 680,
      props: { mode: "team", ticket: { title: `Auftrag an ${agent.name}`, repo: agent.repo || "", team: this.orderText(agent) } },
    });
  }

  openReview(tk) {
    openOverlay({
      mod: "review", kind: "window", key: "review", width: 960, height: 680,
      props: { ticket: tk.id, terminal: tk.review_terminal || tk.terminal || null, folder: tk.worktree || tk.repo, on: tk.machine || null },
    });
  }

  // ---- view ---------------------------------------------------------------

  visible() {
    return this.filter === "all" ? this.agents : this.agents.filter((a) => this.activeOf(a));
  }

  avatar(t, agent, size = 28) {
    const color = colorOf(t, agent.color);
    return div().size(size).flex_none().rounded_full().bg(tint(color, "26")).border_1().border_color(tint(color, "88"))
      .flex().items_center().justify_center().text_size(T_L).font_semibold().text_color(color)
      .child((agent.name || "?").slice(0, 1).toUpperCase());
  }

  card(t, agent) {
    const color = colorOf(t, agent.color);
    const on = same(agent.name, this.selected);
    const running = this.running(agent.name).length;
    return ui.card(t, `tm-card-${agent.name}`, { border: on ? t.accent : undefined })
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (this.mode === "form") this.closeForm(cx);
        this.confirm = null;
        this.selected = agent.name;
        localStorage.setItem("teams.selected", agent.name);
        cx.notify();
      })
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(this.avatar(t, agent))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().gap(ui.GAP_S).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(T_L).font_semibold().text_color(t.foreground).child(agent.name))
            .when(agent.role, (el) => el.child(ui.chip(t, agent.role, color))))
          .child(div().truncate().text_size(T_S).text_color(t.muted)
            .child([programName(agent.program), agent.model].filter(Boolean).join(" · ") || "—")))
        .when(running > 0, (el) => el.child(ui.counterBadge(t, running, t.working))))
      .child(h_flex().gap(ui.GAP_S).items_center().text_size(T_XS).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().tooltip(agent.repo || "kein Repo").child(agent.repo ? tail(agent.repo) : "kein Repo"))
        .child(div().flex_none().text_color(t.muted).child(`${this.usesOf(agent.name)} Einsätze · ${usd(this.costOf(agent.name))}`)));
  }

  field(t, id, label, state) {
    return v_flex().gap(ui.GAP_XS)
      .child(div().text_size(T_S).font_medium().text_color(t.muted).child(label))
      .child(ui.inputBox(t, id, Input.new(state), { focused: this.focus.has(id) }));
  }

  formView(t, cx) {
    const f = this.form;
    const editing = Boolean(f.editing);
    return v_flex().id("tm-form").gap(ui.GAP_M).p(ui.INSET_PANEL)
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(div().text_size(T_XL).font_semibold().text_color(t.foreground).child(editing ? `Agent ${f.editing} bearbeiten` : "Agent anlegen"))
        .child(div().flex_1())
        .when(editing, (el) => el.child(this.avatar(t, this.agentOf(f.editing) ?? { name: f.editing, color: f.color }, 24))))
      .child(this.field(t, "tm-f-name", "Name", this.fName))
      .child(this.field(t, "tm-f-role", "Rolle", this.fRole))
      .child(v_flex().gap(ui.GAP_XS)
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Programm"))
        .child(ui.segment(t, "tm-f-program", PROGRAMS.map((p) => ({ value: p.key, label: p.name, tip: p.key })),
          f.program, (value, cx) => { f.program = value; cx.notify(); })))
      .child(this.field(t, "tm-f-model", "Modell (optional)", this.fModel))
      .child(this.field(t, "tm-f-repo", "Repo-Pfad", this.fRepo))
      .child(this.field(t, "tm-f-labels", "Labels (kommagetrennt)", this.fLabels))
      .child(v_flex().gap(ui.GAP_XS)
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Notizen"))
        .child(Textarea.new(this.fNotes).h(92).w_full().px(10).py(6).rounded(6).border_1()
          .border_color(this.focus.has("tm-f-notes") ? t.accent : t.input).bg(t.background)
          .text_size(T_M).text_color(t.foreground)))
      .when(editing, (el) => el.child(div().text_size(T_XS).text_color(t.dim)
        .child(`Branch-Präfix ${f.branchPrefix || "feat/"} und Farbe ${f.color} bleiben erhalten.`)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(T_S).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(ui.GAP_S).items_center().pt(ui.GAP_XS)
        .child(ui.button(t, "tm-save", editing ? "Speichern" : "Anlegen", (cx) => this.save(cx),
          { kind: "primary", enabled: !this.busy, tip: "In agents/roster.json schreiben (hub agent …)" }))
        .child(ui.button(t, "tm-cancel", "Abbrechen", (cx) => this.closeForm(cx), { enabled: !this.busy }))
        .when(this.busy, (el) => el.child(ui.loading(t, "schreibe …"))));
  }

  confirmView(t, agent, cx) {
    return ui.card(t, "tm-confirm", { border: t.blocked }).p(ui.INSET_PANEL).gap(ui.GAP_M)
      .child(div().text_size(T_XL).font_semibold().text_color(t.foreground).child(`Agent ${agent.name} löschen?`))
      .child(div().text_size(T_S).text_color(t.muted)
        .child("Nur der Roster-Eintrag verschwindet. Seine Tickets und Branches bleiben, laufende Agents werden nicht beendet."))
      .child(h_flex().gap(ui.GAP_S).items_center()
        .child(ui.button(t, "tm-del-yes", "Löschen", (cx) => this.remove(cx, agent.name),
          { kind: "primary", enabled: !this.busy, tip: "Eintrag aus agents/roster.json entfernen" }))
        .child(ui.button(t, "tm-del-no", "Abbrechen", (cx) => { this.confirm = null; cx.notify(); }, { enabled: !this.busy }))
        .when(this.busy, (el) => el.child(ui.loading(t, "lösche …"))))
      .when(Boolean(this.error), (el) => el.child(div().text_size(T_S).text_color(t.blocked).child(this.error)));
  }

  row(t, id, label, value, tip) {
    return h_flex().id(id).min_h(22).gap(ui.GAP_M).items_start()
      .child(div().w(96).flex_none().text_size(T_S).text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_size(T_S).text_color(t.foreground).when(Boolean(tip), (el) => el.tooltip(tip)).child(value || "—"));
  }

  detailView(t, agent, cx) {
    if (same(this.confirm, agent.name)) return this.confirmView(t, agent, cx);
    const color = colorOf(t, agent.color);
    const running = this.running(agent.name);
    return v_flex().id("tm-detail").gap(ui.GAP_M)
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(this.avatar(t, agent, 34))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().gap(ui.GAP_S).items_center()
            .child(div().text_size(T_XL).font_semibold().text_color(t.foreground).child(agent.name))
            .when(agent.role, (el) => el.child(ui.chip(t, agent.role, color))))
          .child(div().text_size(T_S).text_color(t.muted)
            .child([programName(agent.program), agent.model].filter(Boolean).join(" · ") || "Programm offen")))
        .child(ui.button(t, "tm-edit", "Bearbeiten", (cx) => this.openForm(cx, agent), { tip: "Name, Rolle, Programm, Modell, Repo, Labels und Notizen ändern" }))
        .child(ui.button(t, "tm-del", "Löschen", (cx) => { this.confirm = agent.name; cx.notify(); }, { tip: "Mit Rückfrage entfernen" })))
      .child(ui.card(t, "tm-detail-card").gap(ui.GAP_S)
        .child(this.row(t, "tm-d-repo", "Repo", agent.repo, agent.repo))
        .child(this.row(t, "tm-d-branch", "Branch-Präfix", agent.branch_prefix || "feat/"))
        .child(h_flex().gap(ui.GAP_M).items_start()
          .child(div().w(96).flex_none().text_size(T_S).text_color(t.dim).child("Labels"))
          .child(h_flex().flex_1().flex_wrap().gap(ui.GAP_XS)
            .children((agent.labels ?? []).length ? agent.labels.map((l) => ui.chip(t, l, t.muted))
              : [div().text_size(T_S).text_color(t.foreground).child("—")])))
        .child(h_flex().gap(ui.GAP_M).items_start()
          .child(div().w(96).flex_none().text_size(T_S).text_color(t.dim).child("Notizen"))
          .child(div().flex_1().min_w(0).text_size(T_S).text_color(agent.notes ? t.foreground : t.dim).child(agent.notes || "—"))))
      .child(h_flex().items_center()
        .child(ui.button(t, "tm-order", "Auftrag starten", (_cx) => this.startOrder(agent),
          { kind: "primary", tip: "Auftrag-Dialog für diesen Agenten vorbelegen" })))
      .child(ui.sectionHeader(t, "Laufende Tickets", { count: running.length }))
      .when(!running.length, (el) => el.child(ui.empty(t, "Keine laufenden Tickets.", { row: true })))
      .children(running.map((tk) => {
        const st = STATUS[tk.status] ?? STATUS.todo;
        return h_flex().id(`tm-tk-${tk.id}`).h(ui.H_ROW).flex_none().gap(ui.GAP_S).items_center().rounded(6).px(ui.GAP_XS)
          .cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (tk.status === "review") this.openReview(tk);
            else if (tk.terminal) ui.focusAgent(tk.terminal);
          })
          .child(ui.statusIcon(t, tk.status === "review" ? "blocked" : tk.status === "doing" ? "working" : "idle"))
          .child(ui.chip(t, st.label, st.color(t)))
          .child(div().w(150).flex_none().truncate().text_size(T_XS).text_color(t.dim).child(tk.id))
          .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.foreground).child(tk.title || ""))
          .when(tk.status === "review", (el) => el.child(div().text_size(T_XS).text_color(t.accent).child("prüfen")));
      }))
      .when(this.error && this.mode === "list", (el) => el.child(div().text_size(T_S).text_color(t.blocked).child(this.error)));
  }

  body(t, cx) {
    if (this.loading && !this.agents.length) return v_flex().flex_1().p(ui.INSET_PANEL).child(ui.loading(t));
    const shown = this.visible();
    const all = this.agents.length;
    if (!all) {
      return v_flex().flex_1().min_h(0)
        .when(Boolean(this.error), (el) => el.child(div().px(ui.INSET_PANEL).py(ui.GAP_S).text_size(T_S).text_color(t.blocked).child(this.error)))
        .child(ui.empty(t, "Noch keine Agents. Lege den ersten an: Name, Rolle, Programm und Repo genügen.",
          { icon: "mods/orchestra/icons/tray.svg", action: ui.button(t, "tm-first", "Agent anlegen", (cx) => this.openForm(cx), { kind: "primary" }) }));
    }
    const list = v_flex().id("tm-list").w(360).flex_none().h_full().min_h(0).border_r(1).border_color(t.border)
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().px(ui.INSET_PANEL).py(ui.GAP_S).gap(ui.GAP_S)
        .when(!shown.length, (el) => el.child(ui.empty(t, this.filter === "active"
          ? "Kein Agent hat laufende Tickets. Filter „Alle“ zeigt den ganzen Roster."
          : "Kein Agent im Roster.", { row: true })))
        .children(shown.map((a) => this.card(t, a))))
      .when(Boolean(this.error) && this.mode === "list", (el) => el.child(div().px(ui.INSET_PANEL).py(ui.GAP_S).text_size(T_XS).text_color(t.blocked).child(this.error)));
    const right = v_flex().id("tm-right").flex_1().min_w(0).h_full().min_h(0).overflow_y_scrollbar()
      .when(this.mode === "form", (el) => el.child(this.formView(t, cx)))
      .when(this.mode !== "form", (el) => {
        const sel = this.agentOf(this.selected);
        return el.when(Boolean(sel), (x) => x.child(this.detailView(t, sel, cx)))
          .when(!sel, (x) => x.child(ui.empty(t, "Wähle links einen Agenten oder lege einen neuen an.", { icon: "mods/orchestra/icons/tray.svg" })));
      });
    return h_flex().flex_1().min_h(0).children([list, right]);
  }

  render(cx) {
    const t = theme();
    const active = this.agents.filter((a) => this.activeOf(a)).length;
    const overlay = props()?.overlay;
    return v_flex().id("teams-root").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.mode === "form") this.closeForm(cx);
        else if (this.confirm) { this.confirm = null; cx.notify(); }
        else if (overlay) closeOverlay(overlay);
        cx.stop_propagation();
        cx.notify();
      })
      .child(ui.windowHeader(t, "Team-Hub", [
        ui.segment(t, "tm-filter", [
          { value: "active", label: "Aktiv", tip: "Agents mit laufenden Tickets" },
          { value: "all", label: "Alle", tip: "Der ganze Roster" },
        ], this.filter, (value, cx) => {
          this.filter = value;
          localStorage.setItem("teams.filter", value);
          cx.notify();
        }),
        ui.button(t, "tm-add", "+ Agent", (cx) => this.openForm(cx), { small: true, tip: "Neuen Agenten in agents/roster.json anlegen" }),
      ], () => { if (overlay) closeOverlay(overlay); }, {
        meta: `${this.agents.length} ${this.agents.length === 1 ? "Agent" : "Agents"} · ${active} aktiv`,
        metaTip: "Roster aus agents/roster.json · Einsätze und Kosten aus den Tickets",
      }))
      .child(this.body(t, cx));
  }
}
