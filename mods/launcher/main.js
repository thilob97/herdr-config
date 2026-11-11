// Agent starten: one or more agents (fan out: one per picked agent) in a space,
// as a new tab there or each in its own git worktree (own space, like the
// shipped worktree mod), with a first message from a template in
// mods/launcher/templates/*.md (frontmatter: name, tab). {folder}, {branch},
// {branchnote} and {space} are filled in at start. Started agents can become a
// watched team: shared "orchestra.groups", shown by the orchestra panel and
// watched by the status bar (it says when the whole team is finished).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { spaces, focused, exec, knownAgents, notify, props, closeOverlay, theme, shared, setShared, home, appHome, readTextFile } from "herdr";
import * as fs from "fs/promises";
import { place, git, repoOf, homeOn, slug } from "./git.js";

const WC = "mods/workspace-chrome";
const TEMPLATES = () => `${appHome()}/mods/launcher/templates`;

function parseTemplate(file, text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { id: file, name: meta.name || file.replace(/\.md$/, ""), tab: meta.tab || "", body: (m ? text.slice(m[0].length) : text).trim() };
}

const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const fill = (text, vars) => text.replace(/\{(folder|branch|branchnote|space)\}/g, (_m, k) => vars[k] ?? "");
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen").replace(/^Error: /, "");

export default class Launcher extends View {
  init(_props, cx) {
    this.templates = [];
    this.template = null;
    this.agents = null;     // installed agents on the space's machine
    this.picked = new Set(["omp"]);
    this.mode = "tab";      // "tab" | "worktree"
    this.repo = undefined;  // undefined: reading, null: no git
    this.team = true;
    this.busy = false;
    this.error = "";
    this.token = 0;
    this.branch = InputState.new({ placeholder: "Branch, z. B. agent/fix-login" });
    this.folder = InputState.new({ placeholder: "Ordner" });
    this.name = InputState.new({ placeholder: "Tab-Name" });
    this.custom = InputState.new({ placeholder: "Kommando, z. B. claude --model opus" });
    this.task = TextareaState.new({ rows: 12, placeholder: "Erste Nachricht an den Agent…" });
    const here = focused()?.space;
    this.pick(cx, spaces().find((s) => s.id === here)?.id ?? spaces()[0]?.id);
    cx.spawn(async (cx) => {
      try {
        const files = (await fs.readdir(TEMPLATES())).filter((f) => f.endsWith(".md")).sort();
        this.templates = await Promise.all(files.map(async (f) => parseTemplate(f, await readTextFile(`${TEMPLATES()}/${f}`))));
      } catch (e) { this.error = `Vorlagen nicht lesbar: ${errorText(e)}`; }
      cx.notify();
    });
    cx.timer.after(300, () => this.task.focus());
  }

  space() { return spaces().find((s) => s.id === this.spaceId) ?? null; }

  pick(cx, id) {
    const s = spaces().find((x) => x.id === id);
    const token = ++this.token;
    this.spaceId = s?.id ?? null;
    this.repo = s ? undefined : null;
    this.agents = null;
    if (!s) return;
    const on = s.machine ?? null;
    const folder = place(s) ?? "";
    this.folder.set_value(folder);
    cx.spawn(async (cx) => {
      const [repo, list] = await Promise.all([folder ? repoOf(folder, on).catch(() => null) : null, knownAgents({ on }).catch(() => [])]);
      if (token !== this.token) return;
      this.repo = repo;
      this.agents = list.filter((a) => a.installed);
      for (const k of [...this.picked]) if (k !== "custom" && !this.agents.some((a) => a.key === k)) this.picked.delete(k);
      if (!this.picked.size) this.picked.add(this.agents.find((a) => a.key === "omp")?.key ?? this.agents[0]?.key ?? "custom");
      if (!repo && this.mode === "worktree") this.mode = "tab";
      cx.notify();
    });
    cx.notify();
  }

  useTemplate(tp, cx) {
    this.template = tp?.id ?? null;
    this.task.set_value(tp?.body ?? "");
    this.name.set_value(tp?.tab ?? "");
    this.branch.set_value(tp ? `agent/${slug(tp.tab || tp.name)}-${stamp()}` : "");
    cx.notify();
  }

  toggleAgent(key, cx) {
    if (this.picked.has(key)) { if (this.picked.size > 1) this.picked.delete(key); }
    else this.picked.add(key);
    cx.notify();
  }

  // [{ key, name, argv }] for every picked agent.
  launches() {
    return [...this.picked].map((key) => {
      if (key === "custom") {
        const argv = this.custom.value().trim().split(/\s+/).filter(Boolean);
        return { key: slug(argv[0] ?? "cmd"), name: argv[0] ?? "Kommando", argv };
      }
      const a = this.agents?.find((x) => x.key === key);
      return { key, name: a?.name ?? key, argv: a?.run ?? [] };
    });
  }

  start(cx) {
    if (this.busy) return;
    this.busy = true; this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try { await this.run(); closeOverlay(props().overlay); }
      catch (e) { this.error = errorText(e); }
      this.busy = false;
      cx.notify();
    });
  }

  async run() {
    const s = this.space();
    if (!s) throw new Error("Wähle einen Space.");
    if (this.repo === undefined) throw new Error("Lese noch das Repository des Space…");
    const list = this.launches();
    if (list.some((l) => !l.argv.length)) throw new Error("Wähle einen Agent oder gib ein Kommando ein.");
    const on = s.machine ?? null;
    const worktree = this.mode === "worktree" && Boolean(this.repo);
    const base = this.branch.value().trim();
    if (worktree && !base) throw new Error("Gib einen Branch-Namen ein.");
    const tabBase = this.name.value().trim() || this.templates.find((t) => t.id === this.template)?.tab || "agent";
    const text = this.task.value();
    const made = [];
    for (const l of list) {
      let folder = this.folder.value().trim() || place(s) || "";
      let branch = null;
      if (worktree) {
        branch = list.length > 1 ? `${base}-${l.key}` : base;
        if (!(await git(this.repo.top, ["check-ref-format", "--branch", branch], on)).ok) throw new Error(`„${branch}“ ist kein gültiger Branch-Name.`);
        folder = `${await homeOn(on, home())}/.herdr/worktrees/${this.repo.name}/${slug(branch.replace(/\//g, "-"))}`;
        const exists = (await git(this.repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], on)).ok;
        const r = await git(this.repo.top, exists ? ["worktree", "add", folder, branch] : ["worktree", "add", "-b", branch, folder, "HEAD"], on, 600000);
        if (!r.ok) throw new Error(r.err || "git worktree add fehlgeschlagen.");
      }
      const task = fill(text, { folder, branch: branch ?? "", branchnote: branch ? ` auf Branch ${branch}` : "", space: s.name }).trim();
      const name = (list.length > 1 ? `${tabBase} · ${l.name}` : tabBase).slice(0, 40);
      // herdr-app do prints the ids it made; a worktree gets its own space, unnamed so it follows the checkout.
      const [cmd, args] = worktree
        ? ["space.new", { folder, machine: on ?? "", tab: name, argv: l.argv, ...(task ? { task } : {}) }]
        : ["tab.new", { space: s.id, name, argv: l.argv, ...(task ? { task } : {}), ...(folder ? { folder } : {}) }];
      const r = await exec("herdr-app", ["do", cmd, JSON.stringify(args)], { timeout: 60000 });
      let out = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || !out?.terminal) throw new Error(`${l.name}: ${out?.error ?? ((r.stderr || r.stdout).trim() || `${cmd} fehlgeschlagen`)}`);
      const address = on && !out.terminal.includes("/") ? `${on}/${out.terminal}` : out.terminal;
      made.push({ address, name: l.name, branch, space: out.space ?? s.id });
    }
    if (this.team && made.length) {
      const groups = shared("orchestra.groups") ?? [];
      const id = `g${Date.now().toString(36)}`;
      setShared("orchestra.groups", [...groups, { id, name: tabBase, members: made.map((m) => m.address), at: Date.now(), watch: true, notified: false }]);
    }
    notify({
      title: made.length > 1 ? `${made.length} Agents gestartet: ${tabBase}` : `${made[0].name} gestartet: ${tabBase}`,
      body: made.map((m) => `${m.name}${m.branch ? ` · ${m.branch}` : ""}`).join("\n"),
      level: "success", timeout: 8000, action: { name: "space.select", args: { id: made[0].space } },
    });
  }

  // ---------- view ----------

  chip(t, id, text, on, action, disabled) {
    return div().id(id).flex_none().px(9).h(26).flex().items_center().rounded(6).text_size(12)
      .bg(on ? t.selected : t.raised).border(1).border_color(on ? t.solid : t.border).text_color(disabled ? t.dim : on ? t.foreground : t.muted)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => action(cx)))
      .child(text);
  }

  field(t, label, child) {
    return v_flex().gap(5).child(div().text_size(11).font_semibold().text_color(t.dim).child(label.toUpperCase())).child(child);
  }

  input(t, state) {
    return div().h(30).px(9).flex().items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
      .child(Input.new(state).w_full().h_full().text_size(12).text_color(t.foreground));
  }

  listRow(t, id, on, title, sub, action) {
    return v_flex().id(id).flex_none().px(9).py(5).rounded(6).cursor_pointer()
      .bg(on ? t.selected : t.popover).hover((s) => s.bg(on ? t.selected : t.hover))
      .on_click((_e, cx) => action(cx))
      .child(div().truncate().text_size(12).text_color(on ? t.foreground : t.muted).child(title))
      .when(Boolean(sub), (el) => el.child(div().truncate().text_size(10.5).text_color(t.dim).child(sub)));
  }

  render() {
    const t = theme();
    const s = this.space();
    const r = this.repo;
    const n = this.picked.size;
    const repoLine = !s ? "" : r === undefined ? "lese Repository…" : r === null ? "kein Git-Repository: kein Worktree möglich" : `${r.name} · ${r.top}`;
    const close = () => closeOverlay(props().overlay);

    const left = v_flex().w(260).flex_none().min_h(0).gap(12)
      .child(this.field(t, "Vorlage", v_flex().id("ln-templates").h(290).overflow_y_scrollbar().gap(2)
        .child(this.listRow(t, "tp-none", this.template === null, "Leer", "eigene Nachricht", (cx) => this.useTemplate(null, cx)))
        .children(this.templates.map((tp) => this.listRow(t, `tp-${tp.id}`, this.template === tp.id, tp.name, tp.body.split("\n")[0], (cx) => this.useTemplate(tp, cx))))))
      .child(this.field(t, "Space · Maschine", v_flex().id("ln-spaces").h(220).overflow_y_scrollbar().gap(2)
        .children(spaces().map((x) => this.listRow(t, `sp-${x.id}`, x.id === this.spaceId, x.name, `${x.machine ?? "dieser Rechner"} · ${place(x) ?? ""}`, (cx) => this.pick(cx, x.id))))));

    const right = v_flex().flex_1().min_w(0).min_h(0).gap(12)
      .child(this.field(t, `Agents${n > 1 ? ` · ${n} parallel` : ""}`, v_flex().gap(6)
        .child(h_flex().flex_wrap().gap(6)
          .when(this.agents === null && Boolean(s), (el) => el.child(div().text_size(11.5).text_color(t.dim).child("suche installierte Agents…")))
          .children((this.agents ?? []).map((a) => this.chip(t, `ag-${a.key}`, a.name, this.picked.has(a.key), (cx) => this.toggleAgent(a.key, cx))))
          .child(this.chip(t, "ag-custom", "Kommando…", this.picked.has("custom"), (cx) => this.toggleAgent("custom", cx))))
        .when(this.picked.has("custom"), (el) => el.child(this.input(t, this.custom)))))
      .child(this.field(t, "Wo", v_flex().gap(6)
        .child(h_flex().gap(6)
          .child(this.chip(t, "md-tab", "Neuer Tab im Space", this.mode === "tab", (cx) => { this.mode = "tab"; cx.notify(); }))
          .child(this.chip(t, "md-wt", n > 1 ? "Je ein Worktree (eigene Spaces)" : "Eigener Worktree (eigener Space)", this.mode === "worktree", (cx) => { this.mode = "worktree"; cx.notify(); }, !r)))
        .child(div().truncate().text_size(11).text_color(r === null ? t.blocked : t.dim).child(repoLine))
        .child(this.mode === "worktree"
          ? h_flex().gap(8).items_center().child(div().flex_1().child(this.input(t, this.branch)))
            .when(n > 1, (el) => el.child(div().text_size(11).text_color(t.dim).child("+ -<agent>")))
          : this.input(t, this.folder))))
      .child(this.field(t, "Tab-Name", this.input(t, this.name)))
      .child(this.field(t, "Erste Nachricht · {folder} {branch} {branchnote} {space} werden ersetzt",
        Textarea.new(this.task).h(200).px(8).py(6).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground)))
      .child(h_flex().id("ln-team").gap(8).items_center().cursor_pointer().on_click((_e, cx) => { this.team = !this.team; cx.notify(); })
        .child(div().size(14).flex_none().rounded(4).border_1().border_color(this.team ? t.solid : t.input).bg(this.team ? t.solid : t.background)
          .flex().items_center().justify_center().when(this.team, (el) => el.child(svg(`${WC}/check.svg`).size(10).text_color(t.solid_foreground))))
        .child(div().text_size(12).text_color(t.muted).child("Als Team beobachten (Team-Panel; Meldung, wenn alle fertig sind)")))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).items_center().justify_end()
        .when(this.busy, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("starte…")))
        .child(div().id("ln-start").h(30).px(14).flex().items_center().rounded(7).text_size(12.5).font_semibold()
          .bg(this.busy || !s ? t.raised : t.solid).text_color(this.busy || !s ? t.dim : t.solid_foreground)
          .when(!this.busy && Boolean(s), (el) => el.cursor_pointer().hover((x) => x.opacity(0.85)).on_click((_e, cx) => this.start(cx)))
          .child(n > 1 ? `${n} Agents starten` : "Agent starten")));

    return v_flex().id("launcher").size_full().min_h(0).p(18).gap(14).bg(t.popover).text_size(12.5)
      .child(h_flex().items_center().gap(10)
        .child(svg("mods/launcher/icon.svg").size(16).text_color(t.muted))
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Agent starten"))
        .child(div().flex_1())
        .child(div().id("ln-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((x) => x.bg(t.hover).text_color(t.foreground)).on_click(close).child("Esc")))
      .child(h_flex().flex_1().min_h(0).gap(18).items_start().child(left).child(right));
  }
}
