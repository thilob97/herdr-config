// workspace-status, plus omp's provider limits and today's cost on the right.
// Hovering them opens a card: every limit window per machine, costs per machine
// and model, and what the running omp agents cost. helpers/usage.py reads omp
// (`omp usage --json --redact`, ~/.omp/stats.db); no token or email leaves it.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { spaces, agents, terminals, theme, run, window, keys, exec, machines, appHome, readTextFile, shared, setShared, nextCommand, notify, focused, playSound } from "herdr";

const HELPER = () => `${appHome()}/mods/status-bar/helpers/usage.py`;
const CARDS = () => `${appHome()}/mods/agent-cards/helpers/omp-cards.py`; // per-session cost, as the agent cards read it
const EVERY = { limits: 5 * 60 * 1000, costs: 2 * 60 * 1000 };
const STALE = 60 * 1000; // hover refreshes anything older
const NAMES = { "github-copilot": "copilot", anthropic: "claude", "openai-codex": "codex", "opencode-go": "opencode", "google-gemini-cli": "gemini", "google-antigravity": "antigravity" };
const MAX_CHIPS = 4;
const COL_W = 330;

const short = (p) => NAMES[p] ?? p ?? "?";
const money = (n) => (n == null ? "—" : n >= 1000 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
const clock = (ms) => (ms ? new Date(ms).toTimeString().slice(0, 5) : "—");
const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : null);
const isHot = (w) => w.pct >= 85 || w.status === "exhausted";
function until(ms) {
  if (!ms) return "";
  const s = Math.max(0, (ms - Date.now()) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d >= 2 ? `${d}d` : d ? `${d}d${h}h` : h ? `${h}h${m}m` : `${m}m`;
}

// Attention order: blocked before finished, the longest waiting first.
const ATTENTION = { blocked: 0, done: 1 };

export default class StatusBar extends View {
  init(_props, cx) {
    this.width = 0;
    this.data = { limits: {}, costs: {} }; // kind → machine key ("" here) → { at, value, error }
    this.sessions = null;                  // { at, list, errors }
    this.busy = new Set();
    this.py = {};                          // machine key → promise of "python3" | "python"
    this.src = {};                         // helper path → promise of its text, for other machines
    cx.timer.every(30 * 1000, (cx) => { this.refresh("limits", EVERY.limits, cx); this.refresh("costs", EVERY.costs, cx); });
    // Keys: status-bar.attention-next goes to the next agent that waits for you.
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "attention-next") this.attentionNext();
    });
  }

  // When each agent's status last changed, for every mod (the inbox reads it).
  // The status bar shows in the elric and quests layouts, so it keeps watch.
  trackSince(list) {
    const old = shared("attention.since") ?? {};
    const next = {};
    let changed = Object.keys(old).length !== list.length;
    for (const a of list) {
      const o = old[a.address];
      next[a.address] = o && o.status === a.status ? o : { status: a.status, at: Date.now() };
      if (next[a.address] !== o) changed = true;
    }
    if (changed) setShared("attention.since", next);
  }

  // Watched teams (shared "orchestra.groups", from the launcher or the Team panel):
  // once a member has worked, the team is finished when none works or waits any
  // more (ended members count as finished). Says so once per round of work.
  watchTeams() {
    const groups = shared("orchestra.groups") ?? [];
    if (!groups.length) return;
    const live = new Map(terminals().filter((x) => x.state === "live").map((x) => [x.address, x.status]));
    const app = new Map(agents().map((a) => [a.address, a.status]));
    let changed = false;
    const next = groups.map((g) => {
      if (!g.watch) return g;
      const states = g.members.map((m) => app.get(m) ?? live.get(m) ?? "gone");
      const busy = states.some((s) => s === "working" || s === "blocked");
      const worked = g.worked || states.includes("working");
      if (busy) {
        if (g.notified || worked !== g.worked) { changed = true; return { ...g, worked, notified: false }; }
        return g;
      }
      if (worked && !g.notified) {
        changed = true;
        notify({ title: `Team „${g.name}“ ist fertig`, body: `${g.members.length} Agents · im Team-Panel ansehen`, level: "success", timeout: 15000,
          action: { name: "tabs-graph.panel-team" } });
        playSound("done");
        return { ...g, worked, notified: true };
      }
      return g;
    });
    if (changed) setShared("orchestra.groups", next);
  }

  waiting() {
    const since = shared("attention.since") ?? {};
    const at = (a) => (since[a.address]?.status === a.status ? since[a.address].at : a.seq);
    return agents().filter((a) => a.status in ATTENTION)
      .sort((x, y) => ATTENTION[x.status] - ATTENTION[y.status] || at(x) - at(y));
  }

  // The most urgent waiting agent that isn't the one in front of you; pressing
  // again from there moves on, so it cycles through all of them.
  attentionNext() {
    const list = this.waiting();
    if (!list.length) return notify({ title: "Keine wartenden Agents", level: "info", timeout: 2500 });
    const here = focused()?.terminal;
    const i = list.findIndex((a) => a.address === here);
    const a = i < 0 ? list[0] : list[(i + 1) % list.length];
    run("pane.focus", { pane: a.pane });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // This computer, then every reachable machine (homelab offline: skipped).
  machines() {
    return [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
  }

  // A python helper here (by path) or on another machine (its text via -c, as agent-cards does).
  async helper(on, path, args, timeout) {
    const key = on ?? "";
    this.py[key] ??= exec("python3", ["-c", "1"], { on, timeout: 10000 }).then((r) => (r.code === 0 ? "python3" : "python"), () => "python");
    let argv = [path, ...args];
    if (on) {
      this.src[path] ??= readTextFile(path).catch(() => null);
      const src = await this.src[path];
      if (!src) throw new Error(`can't read ${path}`);
      argv = ["-c", src, ...args];
    }
    const r = await exec(await this.py[key], argv, { on, timeout });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop().slice(0, 200));
    return JSON.parse(r.stdout);
  }

  refresh(kind, olderThan, cx) {
    for (const on of this.machines()) {
      const key = on ?? "";
      if (this.busy.has(`${kind}:${key}`) || Date.now() - (this.data[kind][key]?.at ?? 0) < olderThan) continue;
      this.busy.add(`${kind}:${key}`);
      cx.spawn(async (cx) => {
        const slot = { at: Date.now(), value: null, error: null };
        try { slot.value = await this.helper(on, HELPER(), [kind], 150000); } catch (e) { slot.error = String(e?.message ?? e); }
        this.busy.delete(`${kind}:${key}`);
        this.data[kind][key] = slot;
        cx.notify();
      });
    }
  }

  // The running omp agents' session cost, per machine in parallel; only while the card opens.
  refreshSessions(cx) {
    if (this.busy.has("sessions") || Date.now() - (this.sessions?.at ?? 0) < STALE) return;
    const byMachine = new Map();
    for (const a of agents()) {
      if (a.app !== "omp" && a.program?.key !== "omp") continue;
      const on = machineOf(a.address);
      if (!byMachine.has(on)) byMachine.set(on, {});
      byMachine.get(on)[on ? a.address.slice(on.length + 1) : a.address] = a.title ?? "";
    }
    this.busy.add("sessions");
    cx.spawn(async (cx) => {
      const list = [], errors = [];
      await Promise.all([...byMachine].map(async ([on, wanted]) => {
        try {
          const got = await this.helper(on, CARDS(), [encodeURIComponent(JSON.stringify(wanted))], 20000);
          for (const [id, info] of Object.entries(got ?? {})) list.push({ address: on ? `${on}/${id}` : id, ...info });
        } catch (e) { errors.push(`${on ?? "This computer"}: ${e?.message ?? e}`); }
      }));
      this.busy.delete("sessions");
      this.sessions = { at: Date.now(), list: list.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)), errors };
      cx.notify();
    });
  }

  opened(cx) {
    this.refresh("limits", STALE, cx);
    this.refresh("costs", STALE, cx);
    this.refreshSessions(cx);
  }

  level(pct, t) {
    // Not accent: in elric accent and blocked are the same pink.
    return pct >= 85 ? t.blocked : pct >= 60 ? t.working : t.done;
  }

  bar(w, pct, color, t) {
    return div().w(w).h(4).flex_none().rounded(2).bg(t.border)
      .child(div().h(4).rounded(2).w(Math.round(w * Math.min(100, Math.max(0, pct)) / 100)).bg(color));
  }

  // Breathes while a limit is (nearly) used up, as the agent cards' status dot does.
  dot(color, hot) {
    return hot
      ? div().relative().size(10).flex_none().flex().items_center().justify_center()
        .child(div().absolute().inset_0().rounded(5).bg(color + "55").loop("opacity", { from: 0, to: 1, period: 900 }))
        .child(div().size(6).rounded(3).bg(color))
      : div().size(6).flex_none().rounded(3).bg(color);
  }

  // The tightest window per provider over every machine, most used first.
  chips() {
    const best = new Map();
    for (const slot of Object.values(this.data.limits)) {
      for (const p of slot.value?.providers ?? []) {
        for (const w of p.windows) {
          if (w.pct == null) continue;
          const cur = best.get(p.provider);
          if (!cur || w.pct > cur.pct || (w.pct === cur.pct && isHot(w))) best.set(p.provider, { provider: p.provider, pct: w.pct, hot: isHot(w) });
        }
      }
    }
    return [...best.values()].sort((a, b) => b.pct - a.pct);
  }

  chip(c, t) {
    const color = this.level(c.pct, t);
    return h_flex().gap(5).items_center().flex_none()
      .child(this.dot(color, c.hot))
      .child(div().text_color(t.muted).child(short(c.provider)))
      .child(this.bar(26, c.pct, color, t))
      .child(div().text_color(color).child(`${Math.round(c.pct)}%`));
  }

  // How many chips the bar has room for; char widths are estimates (11.8px mono ≈ 7px).
  fit(chips, used) {
    if (!this.width) return Math.min(chips.length, MAX_CHIPS);
    let room = this.width - used, n = 0;
    for (const c of chips) {
      const w = 7 * (short(c.provider).length + 4) + 26 + 10 + 15 + 14;
      if (room - w < (n + 1 < chips.length ? 40 : 0)) break;
      room -= w;
      n++;
    }
    return n < chips.length ? Math.max(1, Math.min(n, MAX_CHIPS)) : n;
  }

  costToday() {
    const got = Object.values(this.data.costs).filter((s) => s.value);
    return got.length ? got.reduce((sum, s) => sum + s.value.today, 0) : null;
  }

  // ---------- card ----------

  heading(text, t) {
    return div().text_size(10.5).text_color(t.dim).child(text.toUpperCase());
  }

  error(text, t) {
    return div().text_size(11).text_color(t.blocked).child(`— ${text}`);
  }

  limitsBlock(slot, key, t) {
    const v = v_flex().gap(6).child(this.heading("Limits", t));
    if (!slot) return v.child(div().text_color(t.dim).child(this.busy.has(`limits:${key}`) ? "reading…" : "—"));
    if (slot.error) return v.child(this.error(slot.error, t));
    for (const p of slot.value.providers) {
      v.child(h_flex().gap(6).items_center().mt(2)
        .child(div().font_semibold().text_color(t.foreground).child(short(p.provider)))
        .when(Boolean(p.plan), (e) => e.child(div().px(5).rounded(4).bg(t.raised).text_size(10).text_color(t.accent).child(p.plan)))
        .when(Boolean(p.error), (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(t.blocked).child(p.error))));
      for (const w of p.windows) {
        const color = w.pct == null ? t.dim : this.level(w.pct, t);
        v.child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(w.label))
          .child(this.bar(70, w.pct ?? 0, color, t))
          .child(div().w(38).flex_none().flex().justify_end().text_color(color).child(w.pct == null ? "—" : `${Math.round(w.pct)}%`))
          .child(div().w(54).flex_none().flex().justify_end().text_size(11).text_color(t.dim).child(w.resetsAt ? `in ${until(w.resetsAt)}` : "")));
      }
    }
    slot.value.disabled.forEach((d, i) => v.child(h_flex().id(`dis-${key}-${i}`).gap(6).items_center().opacity(0.55).tooltip(d.reason)
      .child(div().flex_none().text_color(t.muted).child(short(d.provider)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`unavailable · ${d.reason}`))));
    if (!slot.value.providers.length && !slot.value.disabled.length) v.child(div().text_color(t.dim).child("no accounts with limits"));
    return v;
  }

  costsBlock(slot, key, t) {
    const v = v_flex().gap(4).child(this.heading("Costs", t));
    if (!slot) return v.child(div().text_color(t.dim).child(this.busy.has(`costs:${key}`) ? "reading…" : "—"));
    if (slot.error) return v.child(this.error(slot.error, t));
    const row = (id, name, cells, color, bold) => h_flex().id(id).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(color).when(bold, (e) => e.font_semibold()).child(name))
      .children(cells.map((c) => div().w(56).flex_none().flex().justify_end().text_color(color).when(bold, (e) => e.font_semibold()).child(c)));
    const c = slot.value;
    return v
      .child(row(`ch-${key}`, "", ["today", "7 days", "30 days"], t.dim, false))
      .child(row(`ct-${key}`, "all models", [money(c.today), money(c.week), money(c.month)], t.foreground, true))
      .children(c.models.map((m, i) => row(`cm-${key}-${i}`, m.model, [money(m.today), money(m.week), money(m.month)], t.muted, false).tooltip(`${m.provider}/${m.model}`)));
  }

  machineColumn(on, t) {
    const key = on ?? "";
    const l = this.data.limits[key], c = this.data.costs[key];
    return v_flex().w(COL_W).flex_none().gap(10)
      .child(h_flex().gap(6).items_center()
        .child(svg(`mods/workspace-chrome/${on ? "server" : "monitor"}.svg`).size(13).text_color(t.muted))
        .child(div().flex_1().font_semibold().text_color(t.foreground).child(on ?? "This computer"))
        .child(div().text_size(10.5).text_color(t.dim).child(`limits ${clock(l?.at)} · costs ${clock(c?.at)}`)))
      .child(this.limitsBlock(l, key, t))
      .child(this.costsBlock(c, key, t));
  }

  sessionsBlock(t) {
    const s = this.sessions;
    const v = v_flex().gap(4).child(this.heading("Running omp agents", t));
    if (!s) return v.child(div().text_color(t.dim).child(this.busy.has("sessions") ? "reading…" : "—"));
    const byAddress = new Map(agents().map((a) => [a.address, a]));
    for (const x of s.list) {
      const a = byAddress.get(x.address);
      v.child(h_flex().gap(8).items_center()
        .child(div().size(6).flex_none().rounded(3).bg(t[a?.status] ?? t.idle))
        // Titles carry Nerd Font icons and emoji the UI font can't draw.
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`${a?.space_name ?? x.address} · ${(a?.title ?? "").replace(/[\uE000-\uF8FF\u{10000}-\u{10FFFF}]\s*/gu, "")}`))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${x.model ?? "?"}${x.percent != null ? ` · ctx ${x.percent}%` : ""}`))
        .child(div().w(60).flex_none().flex().justify_end().text_color(t.foreground).child(money(x.cost))));
    }
    if (!s.list.length && !s.errors.length) v.child(div().text_color(t.dim).child("none"));
    if (s.list.length > 1) v.child(h_flex().justify_end().text_color(t.dim).child(`together ${money(s.list.reduce((n, x) => n + (x.cost ?? 0), 0))}`));
    s.errors.forEach((e) => v.child(this.error(e, t)));
    return v;
  }

  card(t) {
    const list = this.machines();
    const latest = Math.max(0, ...Object.values(this.data.limits).map((s) => s.at), ...Object.values(this.data.costs).map((s) => s.at));
    const rule = () => div().h(1).flex_none().bg(t.border);
    return v_flex().p(12).gap(10).rounded(8).border(1).border_color(t.border).bg(t.popover).shadow_lg()
      .text_size(12).text_color(t.foreground)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().font_semibold().child("Costs & limits"))
        .child(div().text_size(10.5).text_color(t.dim).child(`updated ${clock(latest)}`)))
      .child(rule())
      .child(h_flex().gap(20).items_start().children(list.map((on) => this.machineColumn(on, t))))
      .child(rule())
      .child(this.sessionsBlock(t).w(COL_W * list.length + 20 * (list.length - 1)))
      .child(div().text_size(10.5).text_color(t.dim)
        .child("limits every 5 min, costs every 2 min · omp usage, ~/.omp/stats.db · days are local"));
  }

  render(cx) {
    const t = theme();
    // A machine not read yet (start, or one that just came online) is read now.
    for (const kind of ["limits", "costs"]) this.refresh(kind, EVERY[kind], cx);
    const space = spaces().find(s => s.active);
    const list = agents();
    this.trackSince(list);
    this.watchTeams();
    const needs = list.filter(a => a.status === "blocked").length;
    const done = list.filter(a => a.status === "done").length;
    const badgeText = [needs ? `${needs} wartet` : "", done ? `${done} fertig` : ""].filter(Boolean).join(" · ");
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const where = space?.machine ?? "This computer";
    const hint = this.hint();
    const cost = this.costToday();
    const chips = this.chips();
    const costText = `${money(cost)} today`;
    // Left side + hint + cost chip + paddings and gaps, estimated as in fit().
    const used = 7 * (where.length + (space?.branch?.length ?? 0) + `${list.length} agents`.length + (badgeText ? badgeText.length + 4 : 0) + hint.length + costText.length) + 28 + 20 * 6 + 60;
    const n = this.fit(chips, used);
    const anyLimits = Object.values(this.data.limits).some((s) => s.value);
    const trigger = h_flex().id("costs-limits").gap(14).items_center().flex_none()
      .on_hover((on, cx) => { if (on) this.opened(cx); })
      .children(chips.slice(0, n).map((c) => this.chip(c, t)))
      .when(n < chips.length, (e) => e.child(div().text_color(t.dim).child(`+${chips.length - n}`)))
      .when(!anyLimits, (e) => e.child(div().text_color(t.dim).child("limits —")))
      .child(div().text_color(cost == null ? t.dim : t.foreground).child(costText));
    return h_flex().id("root").size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .child(label(space?.machine ? "server" : "monitor", where))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`))
      // Waiting agents: click opens the inbox; the dot breathes while one is blocked.
      .when(Boolean(badgeText), el => el.child(h_flex().id("attention").gap(6).items_center().px(7).h(20).rounded(5)
        .cursor_pointer().bg(t.raised).hover(s => s.bg(t.hover))
        .on_click(() => run("mod.open", { name: "inbox" }))
        .child(this.dot(needs ? t.blocked : t.done, needs > 0))
        .when(needs > 0, e => e.child(div().text_color(t.blocked).child(`${needs} wartet`)))
        .when(needs > 0 && done > 0, e => e.child(div().text_color(t.dim).child("·")))
        .when(done > 0, e => e.child(div().text_color(t.done).child(`${done} fertig`)))))
      .child(div().flex_1())
      .child(HoverCard.new("costs-limits-card").anchor("bottom_right").open_delay(250).close_delay(300)
        .trigger(trigger)
        .content(this.card(t)))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(hint));
  }
}
