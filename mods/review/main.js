// Review: the one place to check and accept work. Opened as a window with
// props { terminal?, folder?, on?, ticket? }:
// - ticket mode (props.ticket, an id from shared "orchestra.tickets"; the Team
//   panel's and the inbox's "Prüfen", or props.terminal of an agent whose ticket
//   waits for review, e.g. the sidebar card's Review): the ticket's title, gate chips, the
//   orchestrator's summary and the evidence files above the diff of its branch,
//   and the acceptance below: Mergen, PR, Änderungen … (to the orchestrator) or
//   Nur abnehmen, all through mods/orchestra/bin/hub.
// - terminal mode (props.terminal from the inbox or a toast, or no props for the
//   focused agent / terminal, mod.open:review): what that agent changed in its own
//   folder (on its own machine), and commit, feedback to it, go to it, the Changes
//   panel there, or remove its worktree.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { agents, panes, terminals, spaces, focused, exec, hc, readTextFile, run, openOverlay, closeOverlay, props, theme, settings, shared, appHome } from "herdr";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M, T_L } from "./ui.js";

// Reads write nothing under .git (no index refresh or lock), as the Changes panel does.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const REFRESH = 5000;
const MAX_LINES = 1500;
const ORCH = "orchestrator";
const hubBin = () => `${appHome()}/mods/orchestra/bin/hub`;
const machineOf = (address) => (address?.includes("/") ? address.slice(0, address.indexOf("/")) : null);
const countLines = (text) => (text ? text.split("\n").length - Number(text.endsWith("\n")) : 0);
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));
const lastLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop().slice(0, 240);

// The ticket's `## Verlauf` as `hub ticket comment` writes it: `- time · role · text`.
const VERLAUF_ENTRY = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · ([^·]+?) · (.*)$/;
function verlaufEntries(text) {
  const m = /^## Verlauf[ \t]*$/m.exec(text ?? "");
  if (!m) return [];
  return text.slice(m.index + m[0].length).split(/^## /m)[0].split(/\r?\n/)
    .map((l) => VERLAUF_ENTRY.exec(l.trim())).filter(Boolean)
    .map((x) => ({ ts: x[1], role: x[2].trim(), text: x[3].trim() }));
}
// Never the raw exec text (N1): the prefixes and the "folder is gone" case get German words.
const errorText = (e) => String(e?.message ?? e ?? "fehlgeschlagen")
  .replace(/^Error: /, "").replace(/^hub: /, "").replace(/^herdr\.exec: /, "")
  .replace(/cannot run git: No such file or directory \(os error \d+\)/i, "git findet den Ordner nicht mehr (Worktree entfernt?)");
const baseName = (p) => p.replace(/\/+$/, "").split("/").pop() || p;

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

// Tells the orchestrator (if it runs); a blocked one waits on a question, so --force.
async function tellOrchestrator(text) {
  const o = terminals().find((x) => x.name === ORCH && x.state === "live");
  if (!o) return false;
  const r = await hc(["send", ORCH, text, ...(o.status === "blocked" ? ["--force"] : [])]);
  if (r.code !== 0) throw new Error(lastLine(r));
  return true;
}

async function hub(args, timeout = 30000) {
  const r = await exec(hubBin(), args, { timeout });
  if (r.code !== 0) throw new Error(lastLine(r));
  return r.stdout.trim();
}

export default class Review extends View {
  init(_props, cx) {
    const p = props() ?? {};
    // An agent whose ticket waits for your acceptance: its review is that acceptance.
    this.ticketId = p.ticket ?? (p.terminal ? (shared("orchestra.tickets") ?? []).find((t) => t.terminal === p.terminal && t.status === "review")?.id ?? null : null);
    this.address = p.terminal ?? (p.folder || p.ticket ? null : focused()?.terminal ?? focused()?.agent ?? null);
    this.files = []; this.rows = []; this.open = null; this.diffWidth = 300;
    this.repo = null; this.error = null; this.note = null; this.busy = null; this.loading = false;
    this.snapshot = null;   // the ticket as last seen (it stays readable after landing)
    this.gate = null;       // hub gate --json: does the recorded check count for the current HEAD?
    this.gating = false;
    this.showChecks = false; // the recorded check output, folded under the gate
    this.previews = {};     // evidence path → app-home-relative copy for the 48-px preview
    this.copying = new Set();
    this.settled = false;   // the ticket was landed or accepted here: nothing more to do
    this.asking = false;    // the "Änderungen …" field is open
    this.verlauf = null;    // the ticket's Verlauf after a comment written here
    this.ciOpen = false;    // the CI failures under the ticket head are expanded
    this.findingsOpen = false; // the reviewer's findings under the ticket head are expanded
    this.ciPatch = null;    // fresh CI fields from `hub ci`, until shared catches up
    this.lessonsOpen = false; // the repo's lessons, unfolded
    this.verlaufOpen = false; // the ticket's Verlauf, unfolded
    this.evidenceOpen = false; // the evidence files, unfolded
    this.confirmedLesson = null; // proposal text just confirmed here (hide it until the next publish)
    this.commitInput = InputState.new({ placeholder: "Commit-Nachricht" });
    this.commitInput.on("submit", (_e, cx) => this.commit(cx));
    this.commentInput = InputState.new({ placeholder: "Kommentar (an @agent)… (↵ ins Ticket)" });
    this.commentInput.on("submit", (_e, cx) => this.comment(cx));
    this.feedbackInput = InputState.new({ placeholder: "Feedback an den Agent… (↵ senden)" });
    this.feedbackInput.on("submit", (_e, cx) => this.feedback(cx));
    this.changesInput = InputState.new({ placeholder: "Was soll anders werden? (↵ an den Orchestrator)" });
    this.changesInput.on("submit", (_e, cx) => this.requestChanges(cx));
    this.focus = ui.focusFields();
    this.focus.track(this.commitInput, "rv-commit-msg");
    this.focus.track(this.commentInput, "rv-comment");
    this.focus.track(this.feedbackInput, "rv-feedback");
    this.focus.track(this.changesInput, "rv-changes");
    this.refresh(cx);
    cx.timer.every(REFRESH, (cx) => this.refresh(cx));
  }

  // `image(path)` resolves against the application root (the app home), not the file
  // system, so an evidence screenshot elsewhere is copied there once for its preview.
  previewEvidence(tk, cx) {
    for (const p of (tk.evidence ?? []).filter((x) => /\.(png|jpe?g|gif|webp)$/i.test(x) && !tk.machine)) {
      if (this.previews[p] || this.copying.has(p)) continue;
      this.copying.add(p);
      const rel = `data/review/previews/${p.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
      cx.spawn(async (cx) => {
        try {
          await exec("mkdir", ["-p", `${appHome()}/data/review/previews`]);
          const r = await exec("cp", ["-f", p, `${appHome()}/${rel}`]);
          if (r.code === 0) this.previews[p] = rel;
        } finally { this.copying.delete(p); cx.notify(); }
      });
    }
  }

  ticket() {
    if (!this.ticketId) return null;
    const tk = (shared("orchestra.tickets") ?? []).find((x) => x.id === this.ticketId);
    if (tk) this.snapshot = this.ciPatch ? { ...tk, ...this.ciPatch } : tk;
    return this.snapshot;
  }

  // The gate is computed, not remembered: `hub gate` compares the recorded checks_head
  // with the worktree's HEAD now, and carries the last check output.
  loadGate(cx) {
    if (!this.ticketId || this.gating || this.ticket()?.status === "done") return;
    this.gating = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(hubBin(), ["gate", this.ticketId, "--json"], { timeout: 15000 });
        this.gate = r.code === 0 ? JSON.parse(r.stdout.trim() || "{}") : null;
      } catch { this.gate = null; }
      finally { this.gating = false; cx.notify(); }
    });
  }

  // Where the work is: the agent's pane's live folder, else what the core reports, else
  // props { folder, on } or the ticket's worktree (its agent may have ended already).
  target() {
    const p = props() ?? {}, tk = this.ticket();
    const folder = p.folder ?? tk?.worktree ?? tk?.repo ?? null;
    const a = this.address ?? tk?.terminal ?? null;
    if (!a && !folder) return null;
    const agent = a ? agents().find((x) => x.address === a) : null;
    const pane = a ? panes().find((x) => x.terminal === a) : null;
    const term = a ? terminals().find((x) => x.address === a) : null;
    const space = spaces().find((s) => s.id === agent?.space) ?? spaces().find((s) => s.tabs?.some((t) => t.id === pane?.tab));
    const live = Boolean(term && term.state !== "finished");
    const on = a && live ? machineOf(a) : p.on ?? tk?.machine ?? machineOf(a);
    // A ticket's branch lives in its worktree, whatever folder its agent's shell is in now.
    const cwd = tk ? folder ?? term?.cwd : (live ? pane?.cwd ?? term?.cwd : null) ?? folder ?? term?.cwd ?? null;
    return { address: a, agent, pane, space, on: on || null, cwd, live };
  }

  git(args, on, cwd) { return exec("git", [...READ, ...args], { cwd, on }); }

  refresh(cx) {
    if (this.loading || this.busy || this.settled) return;
    if (this.ticketId) this.loadGate(cx);
    // Landed or accepted elsewhere: its worktree is gone, and that is no error (N1).
    if (this.ticket()?.status === "done") { this.repo = null; this.files = []; this.rows = []; this.error = null; cx.notify(); return; }
    const tg = this.target();
    if (!tg?.cwd) {
      this.repo = null; this.files = []; this.rows = [];
      this.error = this.ticketId && !this.ticket() ? `Ticket ${this.ticketId} nicht gefunden.`
        : tg?.address ? "Das Terminal ist beendet oder hat keinen bekannten Ordner." : "Kein Agent ausgewählt.";
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
        const branchName = branch.code === 0 ? branch.stdout.trim() : null;
        // An agent's branch: what it changed since it left the main branch, committed or
        // not (the diff against the merge base); on the main branch itself: uncommitted only.
        const base = hasHead ? await this.baseOf(on, root, branchName) : null;
        const diffRef = base?.mergeBase ?? (hasHead ? "HEAD" : null);
        const stats = {};
        const numstats = diffRef ? [await this.git(["diff", diffRef, "--numstat", "-z", "--no-renames"], on, root)]
          : [await this.git(["diff", "--cached", "--numstat", "-z", "--no-renames"], on, root), await this.git(["diff", "--numstat", "-z", "--no-renames"], on, root)];
        for (const r of numstats) for (const entry of r.stdout.split("\0")) {
          const [a, d, ...parts] = entry.split("\t");
          if (!parts.length) continue;
          const path = parts.join("\t"), o = stats[path] ?? { add: 0, del: 0 };
          stats[path] = { add: o.add + (Number(a) || 0), del: o.del + (Number(d) || 0), binary: a === "-" };
        }
        const seen = new Map();
        for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const s = xy.includes("U") || xy === "AA" || xy === "DD" ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          seen.set(path, { path, status: s, fresh, ...(stats[path] ?? { add: 0, del: 0 }) });
        }
        if (base) {
          const names = await this.git(["diff", base.mergeBase, "--name-status", "-z", "--no-renames"], on, root);
          const parts = names.stdout.split("\0").filter(Boolean);
          for (let i = 0; i + 1 < parts.length; i += 2) {
            const s = parts[i][0], path = parts[i + 1];
            if (!seen.has(path)) seen.set(path, { path, status: s === "D" ? "D" : s === "A" ? "A" : "M", fresh: false, ...(stats[path] ?? { add: 0, del: 0 }) });
          }
        }
        const files = [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
        const [behind, ahead] = track.code === 0 ? track.stdout.trim().split(/\s+/).map(Number) : [null, null];
        const dirty = status.stdout.split("\0").filter(Boolean).length;
        this.repo = { root, on, hasHead, head: hasHead ? head.stdout.trim() : null, branch: branchName, ahead, behind, base, diffRef, dirty,
          worktree: /\/\.herdr\/worktrees\//.test(root) }; // where the worktree mod puts checkouts
        this.files = files; this.error = null;
        if (this.open && !files.some((f) => f.path === this.open)) this.open = null;
        if (!this.open && files.length) this.open = files[0].path;
        if (this.open) await this.load(this.open);
        else this.rows = [];
        if (!this.commitInput.value() && dirty) this.commitInput.set_value(this.suggestion());
      } catch (e) {
        // A worktree the merge already removed is a finished state, not an error (N1).
        const tk = this.ticket();
        if (tk?.status === "done" || /ENOENT|No such file or directory|cannot run git/i.test(String(e?.message ?? e))) {
          this.repo = null; this.files = []; this.rows = []; this.error = null;
        } else this.error = errorText(e);
      }
      finally { this.loading = false; cx.notify(); }
    });
  }

  // The main branch this one started from (the ticket's base, else origin's default,
  // main or master) and the merge base with it, when the branch has commits of its own.
  async baseOf(on, root, branchName) {
    const head = await this.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], on, root);
    const candidates = [this.ticket()?.base, head.code === 0 ? head.stdout.trim() : null, "main", "master"].filter(Boolean);
    for (const name of candidates) {
      if (name === branchName || name === `origin/${branchName}`) return null;
      const mb = await this.git(["merge-base", "HEAD", name], on, root);
      if (mb.code !== 0) continue;
      const mergeBase = mb.stdout.trim();
      const count = await this.git(["rev-list", "--count", `${mergeBase}..HEAD`], on, root);
      const commits = Number(count.stdout.trim()) || 0;
      return commits ? { name, mergeBase, commits } : null;
    }
    return null;
  }

  suggestion() {
    const tg = this.target();
    const tab = tg?.agent?.tab_name;
    return tab && !/^\d+$/.test(tab) ? tab : ui.plain(tg?.agent?.title) || "";
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
      const r = await this.git(["diff", ...(repo.diffRef ? [repo.diffRef] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], repo.on, repo.root);
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
      try { await this.load(path); } catch (e) { this.note = { ok: false, text: errorText(e) }; }
      cx.notify();
    });
    cx.notify();
  }

  // One action at a time; its outcome shows in the footer.
  act(cx, busy, fn) {
    if (this.busy) return;
    this.busy = busy; this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.note = { ok: true, text: await fn() }; }
      catch (e) { this.note = { ok: false, text: errorText(e) }; }
      finally { this.busy = null; this.refresh(cx); cx.notify(); }
    });
  }

  // ---------- ticket mode ----------

  // The commit every recorded gate (checks, review, CI) has to match: the worktree's HEAD
  // now, else the one `hub gate` read (a ticket without a local checkout).
  headNow() { return this.repo?.head ?? this.gate?.head ?? null; }

  // `hub ci` writes the ticket file; shared("orchestra.tickets") catches up only every 5 s,
  // so the CI row takes the fresh fields straight from `hub ticket list --json`.
  async ciSnapshot() {
    try {
      const rows = JSON.parse(await hub(["ticket", "list", "--all", "--json"]));
      const row = rows.find((x) => x.id === this.ticketId);
      if (row) this.ciPatch = {
        ci: row.ci, ci_at: row.ci_at, ci_url: row.ci_url, ci_details: row.ci_details,
        pr: row.pr, status: row.status,
      };
    } catch {}
  }

  checkCi(cx) {
    const tk = this.ticket();
    if (!tk) return;
    this.act(cx, "ci", async () => {
      const out = await hub(["ci", tk.id], 120000);
      await this.ciSnapshot();
      return out.split("\n")[0] || "CI geprüft";
    });
  }

  // The CI row: state, PR link, recheck. Red checks open into the checks and the log tail
  // `hub ci` stored in `ci_details` (and wrote as a Verlauf comment).
  ciRow(t, tk, cx) {
    let d = null;
    try { d = JSON.parse(tk.ci_details || "null"); } catch {}
    const failed = d?.checks ?? [];
    const st = tk.ci, url = tk.ci_url || tk.pr;
    const stale = ui.headStale(this.headNow(), tk.ci_head);
    const word = { pass: "grün", fail: "rot", running: "läuft", unknown: "nicht prüfbar" }[st] ?? "noch nicht geprüft";
    return v_flex().id("rv-ci").flex_none().gap(ui.GAP_XS)
      .child(h_flex().gap(ui.GAP_S).items_center().h(ui.H_BTN_S)
        .when(Boolean(st), (el) => el.child(ui.ciChip(t, tk, { stale })))
        .when(!st, (el) => el.child(div().flex_none().text_size(T_S).font_medium().text_color(t.muted).child(`CI ${word}`)))
        .when(st === "fail", (el) => el.child(ui.link(t, "rv-ci-toggle", `${this.ciOpen ? "▾" : "▸"} ${failed.length ? `Fehlschläge (${failed.length})` : "Fehlschlag"}`,
          (c) => { this.ciOpen = !this.ciOpen; c.notify(); },
          { tip: this.ciOpen ? "Fehlschläge ausblenden" : "Fehlschläge und Log-Auszug einblenden" })))
        .when(Boolean(tk.ci_at), (el) => el.child(div().text_size(T_XS).text_color(t.dim)
          .when(stale, (x) => x.tooltip("neuer Commit seit dem Lauf — neu prüfen")).child(tk.ci_at)))
        .when(Boolean(url), (el) => el.child(ui.link(t, "rv-ci-url", "PR öffnen", (c) => c.open_url(url), { tip: url })))
        .child(div().flex_1())
        .when(Boolean(tk.pr), (el) => el.child(ui.button(t, "rv-ci-check", this.busy === "ci" ? "Prüft …" : "Erneut prüfen",
          (c) => this.checkCi(c), { small: true, enabled: !this.busy && tk.status !== "done",
            tip: stale ? `Der Lauf ist älter als der Worktree-HEAD: hub ci ${tk.id} prüft den PR neu`
              : "gh pr checks: Ergebnis ins Ticket; Fehlschläge mit Log in den Verlauf" }))))
      .when(st === "fail" && this.ciOpen, (el) => el.child(v_flex().id("rv-ci-detail").flex_none().gap(2).p(6).rounded(6)
        .bg(t.background).border_1().border_color(t.border)
        .children(failed.map((c, i) => h_flex().gap(ui.GAP_S).items_center().min_w(0)
          .child(div().flex_none().text_size(T_XS).font_medium().text_color(t.blocked).child(c.name || "Check"))
          .when(Boolean(c.state), (x) => x.child(div().text_size(T_XS).text_color(t.muted).child(String(c.state).toLowerCase())))
          .when(Boolean(c.link), (x) => x.child(ui.link(t, `rv-ci-log-${i}`, "Log", (c2) => c2.open_url(c.link), { tip: c.link })))))
        .when(Boolean(d.log), (x) => x.child(div().max_h(110).overflow_y_scroll().text_size(T_XS).text_color(t.dim)
          .children(String(d.log).split("\n").map((line) => div().child(line || " ")))))
        .when(!failed.length && !d?.log, (x) => x.child(div().text_size(T_XS).text_color(t.muted).child(tk.ci_comment || "Details im Verlauf.")))));
  }

  // `hub land` merges (or opens a PR), then ends the agent and removes the worktree.
  // A merge conflict goes back to the orchestrator, who has the agent rebase.
  land(cx, how) {
    const tk = this.ticket();
    if (!tk) return;
    this.act(cx, how, async () => {
      const r = await exec(hubBin(), ["land", tk.id, `--${how}`], { timeout: 180000 });
      if (r.code !== 0) {
        const err = errorText(lastLine(r));
        if (/merge conflict/.test(err)) {
          await hub(["ticket", "set", tk.id, "status=doing"]);
          const told = await tellOrchestrator(`Merge-Konflikt bei Ticket ${tk.id} „${tk.title}“: ${err}. Lass den Agent rebasen, prüfe erneut und gib es wieder zum Review.`);
          this.settled = true;
          return told ? "Merge-Konflikt: an den Orchestrator zurückgegeben (Rebase)" : "Merge-Konflikt: Ticket zurück auf „in Arbeit“; der Orchestrator läuft nicht";
        }
        throw new Error(err);
      }
      const out = JSON.parse(r.stdout.trim().split("\n").pop());
      this.settled = true;
      await tellOrchestrator(`Ticket ${tk.id} „${tk.title}“ wurde abgenommen und ${out.merged ? `gemergt (${out.merged})` : `als Pull Request eingereicht: ${out.pr}`}. Agent und Worktree sind aufgeräumt.`).catch(() => false);
      return out.pr ? `PR erstellt: ${out.pr}` : `Gemergt: ${out.merged}`;
    });
  }

  accept(cx) {
    const tk = this.ticket();
    if (!tk) return;
    this.act(cx, "accept", async () => {
      await hub(["done", tk.id]);
      this.settled = true;
      await tellOrchestrator(`Ticket ${tk.id} „${tk.title}“ wurde vom Menschen abgenommen (ohne Merge).`).catch(() => false);
      return "Abgenommen (ohne Merge; Branch und Worktree bleiben)";
    });
  }

  runVerify(cx) {
    const tk = this.ticket();
    if (!tk || this.busy) return;
    this.act(cx, "verify", async () => {
      const r = await exec(hubBin(), ["verify", tk.id], { timeout: 900000 });
      if (r.code !== 0) throw new Error(errorText(lastLine(r)));
      this.showChecks = true;
      return (r.stdout || "").trim().split("\n").pop() || "Prüfung ausgeführt";
    });
  }

  // "Erneut prüfen": the station judges the current HEAD; its verdict is what `hub review` waits for.
  startReview(cx) {
    const tk = this.ticket();
    if (!tk || this.busy) return;
    this.act(cx, "review-start", async () => {
      const out = await hub(["review-start", tk.id], 60000);
      return out.split("\n").pop() || "Prüfstation gestartet";
    });
  }

  requestChanges(cx) {
    const tk = this.ticket(), text = this.changesInput.value().trim();
    if (!tk || !text) return;
    this.act(cx, "changes", async () => {
      if (!(await tellOrchestrator(`Feedback vom Menschen zu Ticket ${tk.id} „${tk.title}“: ${text}`))) throw new Error("Der Orchestrator läuft nicht (Team-Panel: Starten).");
      await hub(["ticket", "set", tk.id, "status=doing"]);
      this.changesInput.set_value("");
      this.asking = false;
      this.settled = true;
      return "Änderungen an den Orchestrator gegeben; das Ticket ist wieder in Arbeit";
    });
  }

  // Answers and questions go into the ticket's Verlauf, where the agent reads them.
  comment(cx) {
    const tk = this.ticket(), text = this.commentInput.value().trim();
    if (!tk || !text) return;
    this.act(cx, "comment", async () => {
      await hub(["ticket", "comment", tk.id, "--from", "mensch", text]);
      this.commentInput.set_value("");
      const path = `${appHome()}/data/quests/tickets/${tk.id}.md`;
      const raw = await readTextFile(path).catch(() => null);
      if (raw !== null) this.verlauf = verlaufEntries(raw);
      return `Kommentar im Ticket ${tk.id}`;
    });
  }

  // The orchestrator's suggestion after feedback: the human's OK writes it into the repo's
  // lessons (bin/hub lesson confirm), so the next order carries it.
  confirmLesson(cx) {
    const tk = this.ticket(), p = tk?.lessonProposal;
    if (!tk || !p) return;
    this.act(cx, "lesson", async () => {
      await hub(["lesson", "confirm", tk.id]);
      this.confirmedLesson = p.text;
      return `Lehre übernommen: ${p.text}`;
    });
  }

  // ---------- terminal mode ----------

  commit(cx) {
    const message = this.commitInput.value().trim(), repo = this.repo;
    if (!message || !repo || !this.files.length) return;
    this.act(cx, "commit", async () => {
      for (const args of [["add", "-A"], ["commit", "-m", message]]) {
        const r = await exec("git", args, { cwd: repo.root, on: repo.on });
        if (r.code !== 0) throw new Error(`Commit fehlgeschlagen: ${lastLine(r)}`);
      }
      this.commitInput.set_value("");
      return `Committet: ${message}`;
    });
  }

  feedback(cx) {
    const text = this.feedbackInput.value().trim(), tg = this.target();
    if (!text || !tg?.live) return;
    // A blocked agent waits on a question: the feedback is the answer.
    const args = ["send", tg.address, text, ...(tg.agent?.status === "blocked" ? ["--force"] : [])];
    this.act(cx, "send", async () => {
      const r = await hc(args);
      if (r.code !== 0) throw new Error(`Senden fehlgeschlagen: ${lastLine(r)}`);
      this.feedbackInput.set_value("");
      return "Feedback gesendet";
    });
  }

  close() { closeOverlay(props().overlay); }

  goToAgent() {
    const tg = this.target();
    if (tg?.pane) run("pane.focus", { pane: tg.pane.pane });
    else if (tg?.address) run("agent.focus", { terminal: tg.address });
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

  field(t, id, input, { send, focused = false } = {}) {
    return div().flex_1().min_w(0).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(ui.inputBox(t, id, Input.new(input), { focused, send }));
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "26")).when(kind === "-", (e) => e.bg(t.ansi1 + "26"))
      .child(div().w(34).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().w(10).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === "+" || kind === "-" ? kind : ""))
      .child(div().flex_1().min_w(0).whitespace_nowrap().child(text));
  }

  fileRow(t, f, cx) {
    const parts = f.path.split("/"), name = parts.pop();
    const color = f.status === "A" ? t.ansi2 : f.status === "D" || f.status === "U" ? t.ansi1 : t.working;
    return h_flex().id(`rv-${f.path}`).h(ui.H_ROW).flex_none().px(8).gap(ui.GAP_M).items_center().rounded(6).cursor_pointer().text_size(T_M)
      .when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.pick(f.path, cx))
      .child(div().w(12).flex_none().text_size(T_S).text_color(color).child(f.status))
      .child(h_flex().flex_1().min_w(0)
        .child(div().min_w(0).truncate().text_color(t.dim).child(parts.length ? `${parts.join("/")}/` : ""))
        .child(div().flex_none().max_w(200).truncate().text_color(t.foreground).child(name)))
      .when(f.add > 0, (e) => e.child(div().text_size(T_XS).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().text_size(T_XS).text_color(t.ansi1).child(`−${f.del}`)));
  }

  // Branch, its base and what is uncommitted: the window's meta line.
  meta() {
    const repo = this.repo;
    if (!repo) return this.target()?.cwd ?? "";
    const parts = [repo.branch ?? "ohne Branch"];
    if (repo.base) parts.push(`gegen ${repo.base.name} · ${repo.base.commits} Commit${repo.base.commits === 1 ? "" : "s"}`);
    if (repo.dirty) parts.push(`${repo.dirty} uncommittet`);
    if (repo.ahead != null && (repo.ahead || repo.behind)) parts.push(`↑${repo.ahead} ↓${repo.behind}`);
    if (repo.on) parts.push(repo.on);
    return parts.join(" · ");
  }

  // A Verlauf line: time and role, then the text with @tags highlighted.
  verlaufLine(t, v) {
    return h_flex().min_w(0).gap(ui.GAP_S).items_start().text_size(T_S)
      .child(div().flex_none().max_w(170).truncate().text_color(t.dim).child(`${v.role} · ${v.ts.slice(11)}`))
      .child(h_flex().flex_1().min_w(0).flex_wrap().text_color(t.muted)
        .children(v.text.split(/(@[A-Za-z0-9][A-Za-z0-9_.-]*)/g).filter(Boolean).map((p) =>
          div().when(p.startsWith("@"), (e) => e.text_color(t.accent).font_medium()).child(p))));
  }

  // The check's state: what `hub verify` ran on this HEAD, its output folded underneath,
  // and the button that runs it again (the gate in `hub review` trusts only that run).
  verifyRow(t, tk, cx) {
    // A landed ticket has no worktree left: the recorded run is what remains.
    const g = tk.status === "done" ? null : this.gate, tail = g?.tail ?? tk.verify?.tail ?? [];
    const color = !g ? t.muted : g.ok ? t.done : t.blocked;
    const state = g
      ? (g.ok ? `bestanden · ${g.cmd ?? ".herdr/verify.sh"}${g.at ? ` · ${g.at}` : ""}` : g.reason)
      : tk.checks === "pass" ? "bestanden (aufgezeichnet)" : tk.checks === "fail" ? "rot (aufgezeichnet)" : "noch nicht ausgeführt";
    return v_flex().flex_none().gap(ui.GAP_S)
      .child(h_flex().gap(ui.GAP_S).items_center().min_w(0)
        .child(div().flex_none().text_size(T_S).font_medium().text_color(t.muted).child("Prüfung"))
        .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(color).tooltip(state).child(state))
        .child(ui.link(t, "rv-checks", this.showChecks ? "Zeilen ausblenden" : "Letzte Zeilen",
          (cx) => { this.showChecks = !this.showChecks; cx.notify(); },
          { tip: `Die letzten Zeilen von ${g?.cmd ?? tk.checks_cmd ?? ".herdr/verify.sh"}` }))
        .child(ui.button(t, "rv-verify", this.busy === "verify" ? "Prüft …" : "Prüfung erneut ausführen",
          (cx) => this.runVerify(cx),
          { small: true, enabled: !this.busy && tk.status !== "done",
            tip: `hub verify ${tk.id} im Worktree${tk.machine ? ` auf ${tk.machine}` : ""}; das Gate verlangt diesen Lauf` })))
      .when(this.showChecks, (el) => el.child(div().id("rv-checks-log").max_h(180).overflow_y_scroll().rounded(6)
        .bg(t.background).border_1().border_color(t.border).p(ui.GAP_M).text_size(T_XS)
        .font_family(settings().font_family ?? "JetBrains Mono").text_color(t.muted)
        .child(tail.length ? tail.join("\n") : "Keine Ausgabe aufgezeichnet.")));
  }

  // One lesson: when, what, and where it came from.
  lessonLine(t, l) {
    const source = { review: "Review", human: "Mensch", ci: "CI", vorschlag: "Vorschlag" }[l.source] ?? l.source;
    return h_flex().min_w(0).gap(ui.GAP_S).items_start().text_size(T_S)
      .child(div().flex_none().text_size(T_XS).text_color(t.dim).child(l.date))
      .child(div().flex_1().min_w(0).text_color(t.muted).child(l.text))
      .child(div().flex_none().text_size(T_XS).text_color(t.dim).tooltip(`Ticket ${l.ticket}`).child(source));
  }

  // The reviewer station: verdict from `hub gate` (it knows the HEAD), the `--from review`
  // comments as findings, and the button for another round.
  reviewRow(t, tk, cx) {
    const live = tk.review_terminal
      ? terminals().find((x) => x.address === tk.review_terminal && x.state === "live") : null;
    const r = this.gate?.review ?? null;
    const verdict = r?.verdict ?? tk.review ?? null;
    const at = r?.at ?? tk.review_at, by = r?.reviewer || tk.reviewer;
    const stale = ui.headStale(this.headNow(), r?.review_head ?? tk.review_head);
    const [word, color] = live ? ["läuft", t.working]
      : stale ? ["veraltet (neuer Commit)", t.muted]
        : (r ? r.ok : verdict === "pass") ? ["grün", t.done]
          : verdict === "fail" ? ["rot", t.blocked]
            : verdict === "pass" ? ["grün (aufgezeichnet)", t.muted] : ["noch nicht gestartet", t.muted];
    const why = stale ? "neuer Commit seit dem Lauf — neu prüfen" : r?.reason || tk.review_summary || "";
    const findings = (this.verlauf ?? tk.verlauf ?? [])
      .filter((v) => v.role === "review" && !v.text.startsWith("Urteil:"));
    return v_flex().id("rv-review").flex_none().gap(ui.GAP_XS)
      .child(h_flex().gap(ui.GAP_S).items_center().min_w(0)
        .child(div().flex_none().text_size(T_S).font_medium().text_color(t.muted).child("Prüfstation"))
        .child(div().flex_none().text_size(T_S).text_color(color).when(Boolean(why), (el) => el.tooltip(why)).child(word))
        .when(Boolean(tk.review_terminal), (el) => el.child(div().flex_none().max_w(160).child(ui.identityChip(t, "rv-reviewer", tk.review_terminal))))
        .when(!tk.review_terminal && Boolean(by), (el) => el.child(div().flex_none().text_size(T_S).text_color(t.muted).child(by)))
        .when(Boolean(at) && !live, (el) => el.child(div().text_size(T_XS).text_color(t.dim).child(at)))
        .when(Boolean(tk.review_rounds), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.muted).child(`Runde ${tk.review_rounds}`)))
        .when(findings.length > 0, (el) => el.child(ui.link(t, "rv-findings-toggle", `${this.findingsOpen ? "▾" : "▸"} Befunde (${findings.length})`,
          (c2) => { this.findingsOpen = !this.findingsOpen; c2.notify(); },
          { tip: this.findingsOpen ? "Befunde ausblenden" : "Befunde des Reviewers einblenden" })))
        .child(div().flex_1())
        .child(ui.button(t, "rv-review-start", this.busy === "review-start" ? "Startet …" : "Erneut prüfen",
          (c2) => this.startReview(c2), { small: true, enabled: !this.busy && tk.status !== "done",
            tip: stale ? `Das Urteil ist älter als der Worktree-HEAD: hub review-start ${tk.id} prüft neu`
              : `hub review-start ${tk.id}: ein zweiter Agent prüft Diff und Abnahmekriterien` })))
      .when(this.findingsOpen && findings.length > 0, (el) => el.child(div().id("rv-findings").flex_none().gap(2).p(6).rounded(6)
        .bg(t.background).border_1().border_color(t.border)
        .children(findings.map((v) => this.verlaufLine(t, v)))));
  }

  // Fixed top: title, gate chips and the orchestrator's summary. It never grows with the
  // accordions below, so the diff and the footer keep their room at every window height.
  ticketHead(t, tk) {
    return v_flex().id("rv-head").flex_none().px(ui.INSET_PANEL).py(ui.GAP_M).gap(ui.GAP_S).border_b(1).border_color(t.border)
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(ui.statusIcon(t, tk.status === "review" ? "blocked" : tk.status === "done" ? "done" : tk.status === "doing" ? "working" : "idle"))
        .child(div().flex_1().min_w(0).truncate().text_size(T_L).font_semibold().text_color(t.foreground).child(tk.title))
        .when(Boolean(tk.terminal), (el) => el.child(div().flex_none().max_w(180).child(ui.identityChip(t, "rv-who", tk.terminal))))
        .children(ui.gateChips(t, tk, tk.status === "done" ? null : this.gate)))
      .when(this.gate?.base?.ok === false, (el) => el.child(div().id("rv-base-drift").text_size(T_S).text_color(t.blocked)
        .child(`Basis veraltet: im Worktree \`git rebase ${this.gate.base.base || tk.base}\` ausführen, dann erneut prüfen (oder hub rebase ${tk.id}).`)))
      .child(div().id("rv-summary").max_h(36).overflow_hidden().text_size(T_S).text_color(tk.summary ? t.muted : t.dim)
        .when(Boolean(tk.summary), (el) => el.tooltip(tk.summary))
        .child(tk.summary || "Keine Zusammenfassung des Orchestrators."));
  }

  // The scrollable middle above the diff: gates and actions, then the folded detail
  // sections (Nachweise, Verlauf, Lehren) and the comment field. Its cap keeps at least
  // 60 % of the middle for the diff; expanded sections scroll here instead of pushing the
  // footer out of the window.
  ticketMeta(t, tk, cx) {
    this.previewEvidence(tk, cx);
    const evidence = tk.evidence ?? [];
    const verlauf = this.verlauf ?? tk.verlauf ?? [];
    const lessons = tk.lessons ?? [];
    const proposal = tk.lessonProposal && tk.lessonProposal.text !== this.confirmedLesson ? tk.lessonProposal : null;
    const local = !tk.machine;
    const toggle = (id, label, open, onClick) => ui.link(t, id, `${open ? "▾" : "▸"} ${label}`, onClick,
      { tip: open ? `${label.replace(/ \d+$/, "")} ausblenden` : `${label.replace(/ \d+$/, "")} einblenden` });
    return v_flex().id("rv-meta").flex_none().min_h(0).max_h("40%").overflow_y_scroll()
      .px(ui.INSET_PANEL).py(ui.GAP_M).gap(ui.GAP_M).border_b(1).border_color(t.border)
      .when(Boolean(tk.pr) || Boolean(tk.ci), (el) => el.child(this.ciRow(t, tk, cx)))
      .child(this.reviewRow(t, tk, cx))
      .child(this.verifyRow(t, tk, cx))
      .child(h_flex().gap(ui.GAP_L).items_center()
        .child(toggle("rv-evidence-toggle", `Nachweise ${evidence.length}`, this.evidenceOpen,
          (cx2) => { this.evidenceOpen = !this.evidenceOpen; cx2.notify(); }))
        .when(verlauf.length > 0, (el) => el.child(toggle("rv-verlauf-toggle", `Verlauf ${verlauf.length}`, this.verlaufOpen,
          (cx2) => { this.verlaufOpen = !this.verlaufOpen; cx2.notify(); })))
        .when(lessons.length > 0, (el) => el.child(toggle("rv-lessons-toggle", `Lehren ${lessons.length}`, this.lessonsOpen,
          (cx2) => { this.lessonsOpen = !this.lessonsOpen; cx2.notify(); })))
        .child(div().flex_1()))
      .when(this.evidenceOpen, (el) => el.child(h_flex().flex_wrap().gap(ui.GAP_M).items_start()
        .when(!evidence.length, (x) => x.child(div().text_size(T_S).text_color(t.muted).child("keine angegeben")))
        .children(evidence.map((p, i) => {
          const pic = /\.(png|jpe?g|gif|webp|svg)$/i.test(p);
          if (!local) return div().flex_none().text_size(T_S).text_color(t.muted).tooltip(`${p} (auf ${tk.machine}; hier nicht zu öffnen)`).child(baseName(p));
          return div().id(`rv-ev-${i}`).flex_none().cursor_pointer().tooltip(`Öffnen: ${p}`)
            .on_mouse_down("left", (_e, cx2) => cx2.stop_propagation())
            .on_click(() => exec("open", [p]).catch(() => null))
            .when(pic && Boolean(this.previews[p]), (x) => x.child(v_flex().flex_none().w(64).gap(2)
              .child(image(this.previews[p]).w(48).h(48).flex_none().rounded(4).border_1().border_color(t.border))
              .child(div().w(64).truncate().text_size(T_XS).text_color(t.muted).child(baseName(p)))))
            .when(pic && !this.previews[p], (x) => x.child(svg("mods/review/icon.svg").size(16).text_color(t.muted)))
            .when(!pic, (x) => x.child(div().text_size(T_S).text_color(t.muted).hover((s) => s.text_color(t.foreground)).child(baseName(p))));
        }))
        .when(!local && evidence.length > 0, (x) => x.child(div().text_size(T_XS).text_color(t.muted).child(`auf ${tk.machine}`)))))
      .when(this.verlaufOpen && verlauf.length > 0, (el) => el.child(v_flex().id("rv-verlauf").gap(2).min_w(0)
        .child(div().max_h(160).overflow_y_scroll().gap(2).children(verlauf.map((v) => this.verlaufLine(t, v))))))
      .when((this.lessonsOpen && (lessons.length > 0 || !proposal)) || Boolean(proposal), (el) => el.child(v_flex().id("rv-lessons").gap(2).min_w(0)
        .when(this.lessonsOpen, (x) => x.child(div().max_h(160).overflow_y_scroll().gap(2)
          .children(lessons.length ? lessons.map((l) => this.lessonLine(t, l))
            : [div().text_size(T_S).text_color(t.dim).child("Noch keine Lehre für dieses Repo.")])))
        .when(Boolean(proposal), (x) => x.child(h_flex().gap(ui.GAP_S).items_center()
          .child(div().flex_1().min_w(0).text_size(T_S).text_color(t.foreground).child(`Vorschlag: ${proposal.text}`))
          .child(ui.button(t, "rv-lesson", "Lehre übernehmen", (cx2) => this.confirmLesson(cx2),
            { kind: "primary", small: true, enabled: !this.busy, tip: "Schreibt die Lehre ins Repo; jeder nächste Auftrag enthält sie" }))))))
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(this.field(t, "rv-comment", this.commentInput, { focused: this.focus.has("rv-comment"),
          send: ui.sendButton(t, "rv-comment-send", "mods/orchestra/icons/send.svg",
            "Kommentar ins Ticket (↵); @agent taggen, dort liest er ihn", (cx2) => this.comment(cx2), { enabled: !this.busy }) })));
  }

  ticketFooter(t, tk) {
    const open = tk.status === "review" && !this.settled;
    const canLand = open && !this.busy && Boolean(tk.worktree);
    const label = (key, idle, doing) => (this.busy === key ? doing : idle);
    if (!open) {
      // Landed or accepted: the result, and one way out. No greyed buttons (B13).
      const result = this.note?.text
        ?? (tk.status === "done"
          ? (tk.merged ? `Abgenommen und gemergt in ${tk.merged}` : tk.pr ? `Abgenommen und als Pull Request eingereicht: ${tk.pr}` : "Abgenommen.")
          : "Dieses Ticket wartet gerade nicht auf deine Abnahme.");
      return v_flex().flex_none().px(ui.INSET_PANEL).py(ui.GAP_M).gap(ui.GAP_M).border_t(1).border_color(t.border).bg(t.chrome)
        .child(h_flex().h(ui.H_BTN).gap(ui.GAP_M).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(this.note && !this.note.ok ? t.blocked : t.foreground).tooltip(result).child(result))
          .child(ui.button(t, "rv-close-footer", "Schließen", () => this.close(), { kind: "primary", tip: "Fenster schließen" })));
    }
    return v_flex().flex_none().px(ui.INSET_PANEL).py(ui.GAP_M).gap(ui.GAP_M).border_t(1).border_color(t.border).bg(t.chrome)
      .when(Boolean(this.note), (e) => e.child(div().text_size(T_S).text_color(this.note.ok ? t.foreground : t.blocked).child(this.note.text)))
      .when(open && this.asking, (e) => e.child(h_flex().gap(ui.GAP_M).items_center()
        .child(this.field(t, "rv-changes", this.changesInput, { focused: this.focus.has("rv-changes"),
          send: ui.sendButton(t, "rv-changes-send", "mods/orchestra/icons/send.svg",
            "An den Orchestrator senden (↵)", (cx) => this.requestChanges(cx), { enabled: !this.busy }) }))))
      .child(h_flex().h(ui.H_BTN).gap(ui.GAP_M).items_center()
        .child(div().flex_none().text_size(T_S).text_color(t.muted).child("Abnahme"))
        .child(ui.button(t, "rv-merge", label("merge", "Mergen", "Mergt …"), (cx) => this.land(cx, "merge"),
          { kind: "primary", enabled: canLand, tip: `In ${tk.base || "die Basis"} mergen (--no-ff); beendet den Agent und entfernt Worktree und Branch` }))
        .child(ui.button(t, "rv-pr", label("pr", "PR", "PR …"), (cx) => this.land(cx, "pr"),
          { enabled: canLand, tip: "Branch nach origin pushen und einen Pull Request öffnen; beendet den Agent und entfernt den Worktree" }))
        .child(ui.button(t, "rv-ask", this.asking ? "Abbrechen" : "Änderungen …", (cx) => {
          this.asking = !this.asking;
          if (this.asking) this.changesInput.focus();
          cx.notify();
        }, { enabled: open && !this.busy, tip: "Feedback an den Orchestrator; er gibt es an den Agent weiter" }))
        .child(div().flex_1())
        .when(open && !this.busy, (e) => e.child(div().id("rv-accept").flex_none().text_size(T_S).text_color(t.muted).cursor_pointer()
          .hover((s2) => s2.text_color(t.foreground)).tooltip("Abnehmen, ohne zu mergen (Branch und Worktree bleiben)")
          .on_mouse_down("left", (_ev, cx) => cx.stop_propagation()).on_click((_ev, cx) => this.accept(cx)).child("Nur abnehmen"))));
  }

  terminalFooter(t, tg) {
    const repo = this.repo;
    const canCommit = Boolean(repo?.dirty && !this.busy);
    const canSend = Boolean(tg?.live && !this.busy);
    return v_flex().flex_none().px(ui.INSET_PANEL).py(ui.GAP_M).gap(ui.GAP_M).border_t(1).border_color(t.border).bg(t.chrome)
      .when(Boolean(this.note), (e) => e.child(div().truncate().text_size(T_S).text_color(this.note.ok ? t.done : t.blocked).child(this.note.text)))
      .child(h_flex().h(ui.H_BTN).gap(ui.GAP_M).items_center()
        .child(div().flex_none().text_size(T_S).text_color(t.muted).child("Arbeit am Agent")))
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(this.field(t, "rv-commit-msg", this.commitInput, { focused: this.focus.has("rv-commit-msg") }))
        .child(div().w(132).flex_none().child(ui.button(t, "rv-commit", this.busy === "commit" ? "Committe …" : "Commit", (cx) => this.commit(cx),
          { kind: "primary", enabled: canCommit, tip: "git add -A und git commit im Ordner des Agents" }).w_full())))
      .child(h_flex().gap(ui.GAP_M).items_center()
        .child(this.field(t, "rv-feedback", this.feedbackInput, { focused: this.focus.has("rv-feedback") }))
        .child(div().w(132).flex_none().child(ui.button(t, "rv-send", this.busy === "send" ? "Sende …" : "Feedback senden", (cx) => this.feedback(cx),
          { enabled: canSend, tip: "Per hc send an den Agent (wartet er, beantwortet es seine Frage)" }).w_full())))
      .child(h_flex().gap(ui.GAP_S).items_center()
        .child(ui.button(t, "rv-go", "Zum Agent", () => this.goToAgent(), { enabled: Boolean(tg?.live) }))
        .child(ui.button(t, "rv-panel", "Changes-Panel", () => this.changesPanel(), { enabled: Boolean(tg?.space), tip: "Space wählen und das Changes-Panel öffnen" }))
        .when(Boolean(repo?.worktree), (e) => e.child(ui.button(t, "rv-worktree", "Worktree entfernen", () => this.removeWorktree())))
        .child(div().flex_1())
        .child(ui.iconButton(t, "rv-refresh", "mods/orchestra/icons/restart.svg", this.loading ? "lädt …" : "Aktualisieren", (cx) => this.refresh(cx))));
  }

  render(cx) {
    const t = theme(), tg = this.target(), repo = this.repo, tk = this.ticket();
    const add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const stats = [
      div().flex_none().text_size(T_S).text_color(t.ansi2).child(`+${add}`),
      div().flex_none().text_size(T_S).text_color(t.ansi1).child(`−${del}`),
    ];
    const who = !tk && tg?.address ? [div().flex_none().max_w(200).child(ui.identityChip(t, "rv-agent", tg.address))] : [];
    // Terminal mode names the ticket its agent works on (B15).
    const linked = tk || !tg?.address ? null : (shared("orchestra.tickets") ?? []).find((x) => x.terminal === tg.address) ?? null;
    const ticketTag = linked
      ? [div().id("rv-ticket").flex_none().max_w(260).truncate().text_size(T_S).text_color(t.muted)
        .tooltip(`Ticket ${linked.id}: ${linked.title}`).child(`Ticket ${linked.id} · ${linked.title}`)]
      : [];
    const header = ui.windowHeader(t, "Review", [...ticketTag, ...who, ...stats], () => this.close(), { meta: this.meta() });

    const body = this.error
      ? ui.empty(t, this.error)
      : !repo && tk && tk.status === "done"
        ? ui.empty(t, "Abgenommen: Branch und Worktree sind aufgeräumt.")
      : !repo
        ? v_flex().flex_1().items_center().justify_center().child(ui.loading(t, "lese Änderungen …"))
        : !this.files.length
          ? ui.empty(t, tk ? "Keine Änderungen gegenüber der Basis." : "Keine Änderungen: der Agent hat hier nichts uncommittet hinterlassen.")
          : h_flex().flex_1().min_h(0)
            .child(div().w(300).flex_none().h_full().relative().border_r(1).border_color(t.border)
              .child(v_flex().id("rv-files").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => this.fileRow(t, f, cx))))
              .child(Scrollbar.vertical("rv-files").absolute().inset_0()))
            .child(div().flex_1().min_w(0).h_full().relative().bg(t.background).font_family(settings().font_family ?? "JetBrains Mono").text_size(T_S).text_color(t.foreground)
              .child(div().id("rv-diff-x").size_full().overflow_x_scrollbar()
                .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("rv-diff", this.rows.length, 20, (i) => String(i),
                  (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
              .child(Scrollbar.vertical("rv-diff").viewport_from_layout().absolute().inset_0()));

    const middle = v_flex().id("rv-middle").flex_1().min_h(0)
      .when(Boolean(tk), (el) => el.child(this.ticketMeta(t, tk, cx)))
      .child(body);

    return v_flex().id("review").size_full().min_h(0).overflow_hidden().bg(t.popover).text_size(T_M).text_color(t.foreground)
      .child(header)
      .when(Boolean(tk), (el) => el.child(this.ticketHead(t, tk)))
      .child(middle)
      .child(tk ? this.ticketFooter(t, tk) : this.terminalFooter(t, tg));
  }
}
