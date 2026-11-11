// Review: what an agent changed, in its own folder (on its own machine), and
// what to do about it: commit, send it feedback, go to it, open the Changes
// panel there, or remove its worktree. Opened as a window with
// props { terminal } (the inbox, the Review button on finished toasts), or
// with no props for the focused agent / terminal (mod.open:review).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { agents, panes, terminals, spaces, focused, exec, hc, readTextFile, run, openOverlay, closeOverlay, props, theme, settings } from "herdr";

// Reads write nothing under .git (no index refresh or lock), as the Changes panel does.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const REFRESH = 5000;
const MAX_LINES = 1500;
const machineOf = (address) => (address?.includes("/") ? address.slice(0, address.indexOf("/")) : null);
const plain = (s) => (s ?? "").replace(/[\uE000-\uF8FF\u{10000}-\u{10FFFF}]\s*/gu, "").trim();
const countLines = (text) => (text ? text.split("\n").length - Number(text.endsWith("\n")) : 0);
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));
const lastLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop().slice(0, 240);

function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { old = +m[1]; next = +m[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Review extends View {
  init(_props, cx) {
    this.address = props()?.terminal ?? focused()?.terminal ?? focused()?.agent ?? null;
    this.files = []; this.rows = []; this.open = null; this.diffWidth = 300;
    this.repo = null; this.error = null; this.note = null; this.busy = null; this.loading = false;
    this.commitInput = InputState.new({ placeholder: "Commit-Nachricht" });
    this.commitInput.on("submit", (_e, cx) => this.commit(cx));
    this.feedbackInput = InputState.new({ placeholder: "Feedback an den Agent…" });
    this.feedbackInput.on("submit", (_e, cx) => this.feedback(cx));
    this.refresh(cx);
    cx.timer.every(REFRESH, (cx) => this.refresh(cx));
  }

  // Where the agent is: its pane's live folder, else what the core reports.
  target() {
    const a = this.address;
    if (!a) return null;
    const agent = agents().find((x) => x.address === a);
    const pane = panes().find((p) => p.terminal === a);
    const term = terminals().find((x) => x.address === a);
    const space = spaces().find((s) => s.id === agent?.space) ?? spaces().find((s) => s.tabs?.some((t) => t.id === pane?.tab));
    return { agent, pane, space, on: machineOf(a), cwd: pane?.cwd ?? term?.cwd ?? null, live: Boolean(term && term.state !== "finished") };
  }

  git(args, on, cwd) { return exec("git", [...READ, ...args], { cwd, on }); }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const tg = this.target();
    if (!tg?.cwd) {
      this.repo = null; this.files = []; this.rows = [];
      this.error = this.address ? "Das Terminal ist beendet oder hat keinen bekannten Ordner." : "Kein Agent ausgewählt.";
      cx.notify();
      return;
    }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: tg.cwd, on: tg.on });
        if (top.code !== 0) { this.repo = null; this.files = []; this.rows = []; this.error = `Kein Git-Repository: ${tg.cwd}`; return; }
        const root = top.stdout.trim(), on = tg.on;
        const [status, head, branch, track] = await Promise.all([
          this.git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], on, root),
          this.git(["rev-parse", "--verify", "HEAD"], on, root),
          this.git(["rev-parse", "--abbrev-ref", "HEAD"], on, root),
          this.git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], on, root),
        ]);
        if (status.code !== 0) throw new Error(lastLine(status));
        const hasHead = head.code === 0;
        const stats = {};
        const numstats = hasHead ? [await this.git(["diff", "HEAD", "--numstat", "-z", "--no-renames"], on, root)]
          : [await this.git(["diff", "--cached", "--numstat", "-z", "--no-renames"], on, root), await this.git(["diff", "--numstat", "-z", "--no-renames"], on, root)];
        for (const r of numstats) for (const entry of r.stdout.split("\0")) {
          const [a, d, ...parts] = entry.split("\t");
          if (!parts.length) continue;
          const path = parts.join("\t"), o = stats[path] ?? { add: 0, del: 0 };
          stats[path] = { add: o.add + (Number(a) || 0), del: o.del + (Number(d) || 0), binary: a === "-" };
        }
        const files = status.stdout.split("\0").filter(Boolean).slice(0, 1000).map((entry) => {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const s = xy.includes("U") || xy === "AA" || xy === "DD" ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          return { path, status: s, fresh, ...(stats[path] ?? { add: 0, del: 0 }) };
        });
        const [behind, ahead] = track.code === 0 ? track.stdout.trim().split(/\s+/).map(Number) : [null, null];
        this.repo = { root, on, hasHead, branch: branch.code === 0 ? branch.stdout.trim() : null, ahead, behind,
          worktree: /\/\.herdr\/worktrees\//.test(root) }; // where the worktree mod puts checkouts
        this.files = files; this.error = null;
        if (this.open && !files.some((f) => f.path === this.open)) this.open = null;
        if (!this.open && files.length) this.open = files[0].path;
        if (this.open) await this.load(this.open);
        else this.rows = [];
        if (!this.commitInput.value() && this.files.length) this.commitInput.set_value(this.suggestion());
      } catch (e) { this.error = String(e?.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  suggestion() {
    const tg = this.target();
    const tab = tg?.agent?.tab_name;
    return tab && !/^\d+$/.test(tab) ? tab : plain(tg?.agent?.title) || "";
  }

  async load(path) {
    const file = this.files.find((f) => f.path === path), repo = this.repo;
    if (!file || !repo) return;
    let lines;
    if (file.fresh || (!repo.hasHead && file.status === "A")) {
      const text = await readTextFile(`${repo.root}/${path}`, { on: repo.on }).catch(() => null);
      if (text === null) lines = ["Vorschau nicht möglich (binär, zu groß oder nicht lesbar)"];
      else if (text.includes("\0")) lines = ["Binärdatei"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, MAX_LINES).map((l) => `+${l}`)];
      }
    } else {
      const r = await this.git(["diff", ...(repo.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], repo.on, repo.root);
      if (r.code !== 0) throw new Error(lastLine(r));
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binärdatei geändert" : "Kein Text-Diff"] : all.slice(first);
    }
    if (this.open !== path) return;
    this.rows = diffRows(lines.slice(0, MAX_LINES).map((l) => (l.length > 4000 ? `${l.slice(0, 4000)}…` : l)));
    this.diffWidth = Math.max(300, ...this.rows.map((r) => (r.text.length + 1) * 7 + 50));
  }

  pick(path, cx) {
    this.open = path; this.rows = [];
    cx.spawn(async (cx) => {
      try { await this.load(path); } catch (e) { this.note = { ok: false, text: String(e?.message ?? e) }; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    const message = this.commitInput.value().trim(), repo = this.repo;
    if (!message || !repo || !this.files.length || this.busy) return;
    this.busy = "commit"; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: repo.root, on: repo.on });
          if (r.code !== 0) throw new Error(lastLine(r));
        }
        this.commitInput.set_value("");
        this.note = { ok: true, text: `Committet: ${message}` };
      } catch (e) { this.note = { ok: false, text: `Commit fehlgeschlagen: ${e?.message ?? e}` }; }
      finally { this.busy = null; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  feedback(cx) {
    const text = this.feedbackInput.value().trim(), tg = this.target();
    if (!text || !tg?.live || this.busy) return;
    this.busy = "send"; this.note = null;
    // A blocked agent waits on a question: the feedback is the answer.
    const args = ["send", this.address, text, ...(tg.agent?.status === "blocked" ? ["--force"] : [])];
    cx.spawn(async (cx) => {
      try {
        const r = await hc(args);
        if (r.code !== 0) throw new Error(lastLine(r));
        this.feedbackInput.set_value("");
        this.note = { ok: true, text: "Feedback gesendet" };
      } catch (e) { this.note = { ok: false, text: `Senden fehlgeschlagen: ${e?.message ?? e}` }; }
      finally { this.busy = null; cx.notify(); }
    });
    cx.notify();
  }

  close() { closeOverlay(props().overlay); }

  goToAgent() {
    const tg = this.target();
    if (tg?.pane) run("pane.focus", { pane: tg.pane.pane });
    else if (this.address) run("agent.focus", { terminal: this.address });
  }

  changesPanel() {
    const tg = this.target();
    if (tg?.space) run("space.select", { id: tg.space.id });
    if (tg?.pane) run("pane.focus", { pane: tg.pane.pane });
    run("layout.select", { stack: "panel-body", child: "changes" });
    run("layout.show", { id: "panel" });
    this.close();
  }

  removeWorktree() {
    const tg = this.target();
    if (!tg?.space || !this.repo?.worktree) return;
    openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: tg.space.id, folder: this.repo.root, action: "remove" } });
  }

  // ---------- view ----------

  button(t, id, label, action, { strong = false, enabled = true } = {}) {
    return h_flex().id(id).h(28).px(10).flex_none().items_center().rounded(7).text_size(12)
      .bg(strong && enabled ? t.solid : t.raised).text_color(!enabled ? t.dim : strong ? t.solid_foreground : t.foreground)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { if (enabled) action(cx); })
      .child(label);
  }

  field(t, id, input) {
    return div().id(id).flex_1().min_w(0).h(30).px(10).flex().items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
      .cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(input).h_full().w_full().text_size(12).text_color(t.foreground));
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(34).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().w(10).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === "+" || kind === "-" ? kind : ""))
      .child(div().flex_1().min_w(0).whitespace_nowrap().child(text));
  }

  fileRow(t, f, cx) {
    const parts = f.path.split("/"), name = parts.pop();
    const color = f.status === "A" ? t.ansi2 : f.status === "D" || f.status === "U" ? t.ansi1 : t.working;
    return h_flex().id(`rv-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.pick(f.path, cx))
      .child(div().w(12).flex_none().text_size(11).text_color(color).child(f.status))
      .child(h_flex().flex_1().min_w(0)
        .child(div().min_w(0).truncate().text_color(t.dim).child(parts.length ? `${parts.join("/")}/` : ""))
        .child(div().flex_none().max_w(200).truncate().text_color(t.foreground).child(name)))
      .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
  }

  render(cx) {
    const t = theme(), tg = this.target(), a = tg?.agent, repo = this.repo;
    const add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const who = a ? `${a.program?.name ?? "Agent"} · ${a.space_name} / ${a.tab_name}` : this.address ?? "—";
    const statusColor = t[a?.status] ?? t.dim;
    const canCommit = Boolean(repo && this.files.length && !this.busy);
    const canSend = Boolean(tg?.live && !this.busy);

    const header = h_flex().h(46).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().size(8).flex_none().rounded(4).bg(statusColor))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().font_semibold().text_color(t.foreground).child(`Review · ${who}`))
        .child(div().truncate().text_size(11).text_color(t.dim)
          .child([tg?.on, repo?.root ?? tg?.cwd].filter(Boolean).join(" · "))))
      .when(Boolean(repo?.branch), (e) => e.child(h_flex().gap(5).items_center().text_size(11.5).text_color(t.muted)
        .child(svg("mods/workspace-chrome/branch.svg").size(13))
        .child(repo.branch)
        .when(repo.ahead != null && (repo.ahead || repo.behind), (e) => e.child(div().text_color(t.dim).child(`↑${repo.ahead} ↓${repo.behind}`)))))
      .child(div().text_size(11.5).text_color(t.ansi2).child(`+${add}`))
      .child(div().text_size(11.5).text_color(t.ansi1).child(`−${del}`))
      .child(div().id("rv-close").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.close())
        .child(svg("mods/pane/close.svg").size(13)));

    const empty = (text) => v_flex().flex_1().items_center().justify_center().gap(6).text_color(t.dim).child(text);
    const body = this.error
      ? empty(this.error)
      : !repo
        ? empty("lese Änderungen…")
        : !this.files.length
          ? empty("Keine Änderungen").child(div().text_size(11).child("Der Agent hat hier nichts uncommittet hinterlassen."))
          : h_flex().flex_1().min_h(0)
            .child(div().w(300).flex_none().h_full().relative().border_r(1).border_color(t.border)
              .child(v_flex().id("rv-files").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => this.fileRow(t, f, cx))))
              .child(Scrollbar.vertical("rv-files").absolute().inset_0()))
            .child(div().flex_1().min_w(0).h_full().relative().bg(t.background).font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.foreground)
              .child(div().id("rv-diff-x").size_full().overflow_x_scrollbar()
                .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("rv-diff", this.rows.length, 20, (i) => String(i),
                  (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
              .child(Scrollbar.vertical("rv-diff").viewport_from_layout().absolute().inset_0()));

    const footer = v_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border).bg(t.chrome)
      .when(Boolean(this.note), (e) => e.child(div().text_size(11.5).text_color(this.note.ok ? t.done : t.ansi1).truncate().child(this.note.text)))
      .child(h_flex().gap(8).items_center()
        .child(this.field(t, "rv-commit-msg", this.commitInput))
        .child(this.button(t, "rv-commit", this.busy === "commit" ? "Committe…" : "Commit", (cx) => this.commit(cx), { strong: true, enabled: canCommit })))
      .child(h_flex().gap(8).items_center()
        .child(this.field(t, "rv-feedback", this.feedbackInput))
        .child(this.button(t, "rv-send", this.busy === "send" ? "Sende…" : "Feedback senden", (cx) => this.feedback(cx), { enabled: canSend })))
      .child(h_flex().gap(6).items_center()
        .child(this.button(t, "rv-go", "Zum Agent", () => this.goToAgent(), { enabled: Boolean(tg?.live) }))
        .child(this.button(t, "rv-panel", "Changes-Panel", () => this.changesPanel(), { enabled: Boolean(tg?.space) }))
        .when(Boolean(repo?.worktree), (e) => e.child(this.button(t, "rv-worktree", "Worktree entfernen", () => this.removeWorktree())))
        .child(div().flex_1())
        .child(this.button(t, "rv-refresh", this.loading ? "lädt…" : "Aktualisieren", (cx) => this.refresh(cx))));

    return v_flex().id("review").size_full().min_h(0).overflow_hidden().bg(t.popover).text_size(12.5).text_color(t.foreground)
      .child(header).child(body).child(footer);
  }
}
