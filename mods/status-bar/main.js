// workspace-status, plus omp's provider limits, today's cost and the team budget on the right.
// Hovering the limits opens a card: every limit window per machine, costs per machine
// and model, and what the running omp agents cost. helpers/usage.py reads omp
// (`omp usage --json --redact`, ~/.omp/stats.db); no token or email leaves it.
// What waits for the person is counted only at the Inbox button (tab bar); this bar
// keeps the attention bookkeeping (attention.since, ⌘J) and the team watch.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { spaces, agents, terminals, theme, run, window, keys, exec, machines, appHome, readTextFile, shared, setShared, nextCommand, notify, focused, playSound } from "herdr";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4, GAP_S = 6, GAP_M = 8, GAP_L = 12, GAP_XL = 16;
const H_CHIP = 18;
const T_XS = 10.5, T_S = 11, T_M = 12, T_L = 13;

const HELPER = () => `${appHome()}/mods/status-bar/helpers/usage.py`;
const CARDS = () => `${appHome()}/mods/agent-cards/helpers/omp-cards.py`; // per-session cost, as the agent cards read it
const EVERY = { limits: 5 * 60 * 1000, costs: 2 * 60 * 1000 };
const STALE = 60 * 1000; // hover refreshes anything older
const NAMES = { "github-copilot": "copilot", anthropic: "claude", "openai-codex": "codex", "opencode-go": "opencode", "google-gemini-cli": "gemini", "google-antigravity": "antigravity" };
const MAX_CHIPS = 4;
const COL_W = 330;
const HERE = "Dieser Computer";

const short = (p) => NAMES[p] ?? p ?? "?";
const money = (n) => (n == null ? "—" : n >= 1000 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
const clock = (ms) => (ms ? new Date(ms).toTimeString().slice(0, 5) : "—");
const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : null);
const isHot = (w) => w.pct >= 85 || w.status === "exhausted";
function until(ms) {
  if (!ms) return "";
  const s = Math.max(0, (ms - Date.now()) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d >= 2 ? `${d} T` : d ? `${d} T ${h} h` : h ? `${h}:${String(m).padStart(2, "0")} h` : `${m} min`;
}

// Team spend against the team budget (as the Team panel computes them), or null before any.
function teamBudget() {
  const c = shared("orchestra.costs");
  if (!c) return null;
  const budget = { team: 20, ...(shared("orchestra.budget") ?? {}) }.team ?? c.teamBudget;
  return { cost: c.teamCost ?? 0, budget, over: budget != null && (c.teamCost ?? 0) > budget };
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
  // binding the hint stays useful ("Befehle") instead of lying.
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return { key, text: "Befehle" };
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
        } catch (e) { errors.push(`${on ?? HERE}: ${e?.message ?? e}`); }
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
    return div().w(w).h(4).flex_none().rounded(4).bg(t.border)
      .child(div().h(4).rounded(4).w(Math.round(w * Math.min(100, Math.max(0, pct)) / 100)).bg(color));
  }

  // Status dot (5.6); breathes while a limit is (nearly) used up, as the blocked indicator does.
  dot(color, hot) {
    return hot
      ? div().relative().size(12).flex_none().flex().items_center().justify_center()
        .child(div().absolute().inset_0().rounded_full().bg(color + "55").loop("opacity", { from: 0, to: 1, period: 900 }))
        .child(div().size(7).rounded_full().bg(color))
      : div().size(12).flex_none().flex().items_center().justify_center().child(div().size(7).rounded_full().bg(color));
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

  // A chip (5.6): h 18, radius 4, T_XS.
  pill(id, t) {
    return h_flex().id(id).h(H_CHIP).px(6).gap(GAP_XS).flex_none().items_center().rounded(4).bg(t.raised).text_size(T_XS);
  }

  chip(c, t) {
    const color = this.level(c.pct, t);
    return this.pill(`limit-${c.provider}`, t)
      .child(this.dot(color, c.hot))
      .child(div().text_color(t.muted).child(short(c.provider)))
      .child(this.bar(26, c.pct, color, t))
      .child(div().text_color(color).child(`${Math.round(c.pct)}%`));
  }

  // How many chips the bar has room for; char widths are estimates (10.5px mono ≈ 6.3px).
  fit(chips, used) {
    if (!this.width) return Math.min(chips.length, MAX_CHIPS);
    let room = this.width - used, n = 0;
    for (const c of chips) {
      const w = 6.3 * (short(c.provider).length + 4) + 12 + 26 + 12 + 3 * GAP_XS + GAP_S;
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

  // Section header (5.6): T_S medium muted, sentence case.
  heading(text, t) {
    return div().text_size(T_S).font_medium().text_color(t.muted).child(text);
  }

  error(text, t) {
    return div().text_size(T_S).text_color(t.blocked).child(`— ${text}`);
  }

  loading(busy, t) {
    return busy
      ? h_flex().gap(GAP_S).items_center().text_size(T_S).text_color(t.dim)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.dim).spin(900)).child("lädt …")
      : div().text_size(T_S).text_color(t.dim).child("—");
  }

  limitsBlock(slot, key, t) {
    const v = v_flex().gap(GAP_S).child(this.heading("Limits", t));
    if (!slot) return v.child(this.loading(this.busy.has(`limits:${key}`), t));
    if (slot.error) return v.child(this.error(slot.error, t));
    for (const p of slot.value.providers) {
      v.child(h_flex().gap(GAP_S).items_center().mt(2)
        .child(div().font_semibold().text_color(t.foreground).child(short(p.provider)))
        .when(Boolean(p.plan), (e) => e.child(div().h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(t.muted).child(p.plan)))
        .when(Boolean(p.error), (e) => e.child(div().min_w(0).truncate().text_size(T_S).text_color(t.blocked).child(p.error))));
      for (const w of p.windows) {
        const color = w.pct == null ? t.dim : this.level(w.pct, t);
        v.child(h_flex().gap(GAP_M).items_center()
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(w.label))
          .child(this.bar(70, w.pct ?? 0, color, t))
          .child(div().w(38).flex_none().flex().justify_end().text_color(color).child(w.pct == null ? "—" : `${Math.round(w.pct)}%`))
          .child(div().w(70).flex_none().flex().justify_end().text_size(T_XS).text_color(t.dim).child(w.resetsAt ? `in ${until(w.resetsAt)}` : "")));
      }
    }
    slot.value.disabled.forEach((d, i) => v.child(h_flex().id(`dis-${key}-${i}`).gap(GAP_S).items_center().opacity(0.55).tooltip(d.reason)
      .child(div().flex_none().text_color(t.muted).child(short(d.provider)))
      .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.dim).child(`nicht verfügbar · ${d.reason}`))));
    if (!slot.value.providers.length && !slot.value.disabled.length) v.child(div().text_size(T_S).text_color(t.dim).child("Keine Konten mit Limits."));
    return v;
  }

  costsBlock(slot, key, t) {
    const v = v_flex().gap(GAP_XS).child(this.heading("Kosten", t));
    if (!slot) return v.child(this.loading(this.busy.has(`costs:${key}`), t));
    if (slot.error) return v.child(this.error(slot.error, t));
    const row = (id, name, cells, color, bold) => h_flex().id(id).gap(GAP_M).items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(color).when(bold, (e) => e.font_semibold()).child(name))
      .children(cells.map((c) => div().w(56).flex_none().flex().justify_end().text_color(color).when(bold, (e) => e.font_semibold()).child(c)));
    const c = slot.value;
    return v
      .child(row(`ch-${key}`, "", ["heute", "7 Tage", "30 Tage"], t.dim, false).text_size(T_S))
      .child(row(`ct-${key}`, "alle Modelle", [money(c.today), money(c.week), money(c.month)], t.foreground, true))
      .children(c.models.map((m, i) => row(`cm-${key}-${i}`, m.model, [money(m.today), money(m.week), money(m.month)], t.muted, false).tooltip(`${m.provider}/${m.model}`)));
  }

  machineColumn(on, t) {
    const key = on ?? "";
    const l = this.data.limits[key], c = this.data.costs[key];
    return v_flex().w(COL_W).flex_none().gap(GAP_L)
      .child(h_flex().gap(GAP_S).items_center()
        .child(svg(`mods/workspace-chrome/${on ? "server" : "monitor"}.svg`).size(14).text_color(t.muted))
        .child(div().flex_1().font_semibold().text_color(t.foreground).child(on ?? HERE))
        .child(div().text_size(T_XS).text_color(t.dim).child(`Limits ${clock(l?.at)} · Kosten ${clock(c?.at)}`)))
      .child(this.limitsBlock(l, key, t))
      .child(this.costsBlock(c, key, t));
  }

  sessionsBlock(t) {
    const s = this.sessions;
    const v = v_flex().gap(GAP_XS).child(this.heading("Laufende omp-Agents", t));
    if (!s) return v.child(this.loading(this.busy.has("sessions"), t));
    const byAddress = new Map(agents().map((a) => [a.address, a]));
    for (const x of s.list) {
      const a = byAddress.get(x.address);
      v.child(h_flex().gap(GAP_M).items_center()
        .child(this.dot(t[a?.status] ?? t.idle, false))
        // Titles carry Nerd Font icons and emoji the UI font can't draw.
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`${a?.space_name ?? x.address} · ${(a?.title ?? "").replace(/[\uE000-\uF8FF\u{10000}-\u{10FFFF}]\s*/gu, "")}`))
        .child(div().flex_none().text_size(T_S).text_color(t.dim).child(`${x.model ?? "?"}${x.percent != null ? ` · ctx ${x.percent}%` : ""}`))
        .child(div().w(60).flex_none().flex().justify_end().text_color(t.foreground).child(money(x.cost))));
    }
    if (!s.list.length && !s.errors.length) v.child(div().text_size(T_S).text_color(t.dim).child("Keine."));
    if (s.list.length > 1) v.child(h_flex().justify_end().text_color(t.dim).child(`zusammen ${money(s.list.reduce((n, x) => n + (x.cost ?? 0), 0))}`));
    s.errors.forEach((e) => v.child(this.error(e, t)));
    return v;
  }

  card(t) {
    const list = this.machines();
    const latest = Math.max(0, ...Object.values(this.data.limits).map((s) => s.at), ...Object.values(this.data.costs).map((s) => s.at));
    const rule = () => div().h(1).flex_none().bg(t.border);
    return v_flex().p(GAP_XL).gap(GAP_L).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .text_size(T_M).text_color(t.foreground)
      .child(h_flex().gap(GAP_M).items_center()
        .child(div().flex_1().text_size(T_L).font_semibold().child("Kosten und Limits"))
        .child(div().text_size(T_XS).text_color(t.dim).child(`aktualisiert ${clock(latest)}`)))
      .child(rule())
      .child(h_flex().gap(20).items_start().children(list.map((on) => this.machineColumn(on, t))))
      .child(rule())
      .child(this.sessionsBlock(t).w(COL_W * list.length + 20 * (list.length - 1)))
      .child(div().text_size(T_XS).text_color(t.dim)
        .child("Limits alle 5 min, Kosten alle 2 min · omp usage, ~/.omp/stats.db · Tage nach Ortszeit"));
  }

  render(cx) {
    const t = theme();
    // A machine not read yet (start, or one that just came online) is read now.
    for (const kind of ["limits", "costs"]) this.refresh(kind, EVERY[kind], cx);
    const space = spaces().find(s => s.active);
    this.trackSince(agents());
    this.watchTeams();
    const label = (icon, text) => h_flex().gap(GAP_S).items_center().min_w(0)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).flex_none()).child(div().truncate().child(text));
    const where = space?.machine ?? HERE;
    const hint = this.hint();
    const cost = this.costToday();
    const chips = this.chips();
    const costText = `${money(cost)} heute`;
    const team = teamBudget();
    const teamText = team ? `Team ${money(team.cost)} / ${money(team.budget)}` : "";
    // Left side + team chip + cost + hint + paddings and gaps, estimated as in fit() (11px mono ≈ 6.6px).
    const used = 6.6 * (where.length + (space?.branch?.length ?? 0) + costText.length + `${hint.key ?? ""} ${hint.text}`.length) + 6.3 * teamText.length
      + 2 * 14 + 2 * 20 + 6 * GAP_L + 28 + 60;
    const n = this.fit(chips, used);
    const anyLimits = Object.values(this.data.limits).some((s) => s.value);
    const trigger = h_flex().id("costs-limits").gap(GAP_S).items_center().flex_none()
      .on_hover((on, cx) => { if (on) this.opened(cx); })
      .children(chips.slice(0, n).map((c) => this.chip(c, t)))
      .when(n < chips.length, (e) => e.child(div().text_size(T_XS).text_color(t.dim).child(`+${chips.length - n}`)))
      .when(!anyLimits, (e) => e.child(div().text_color(t.dim).child("Limits —")))
      .child(div().ml(GAP_S).text_color(cost == null ? t.dim : t.foreground).child(costText));
    return h_flex().id("root").size_full().px(14).gap(GAP_L).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(T_S).text_color(t.muted)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .child(label(space?.machine ? "server" : "monitor", where))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(div().flex_1())
      .child(HoverCard.new("costs-limits-card").anchor("bottom_right").open_delay(250).close_delay(300)
        .trigger(trigger)
        .content(this.card(t)))
      // Team spend against its budget; changing the budget stays in the Team panel.
      .when(Boolean(team), el => el.child(this.pill("team-budget", t)
        .cursor_pointer().bg(team.over ? t.blocked + "26" : t.raised).text_color(team.over ? t.blocked : t.muted)
        .when(team.over, e => e.font_medium())
        .hover(s => s.bg(team.over ? t.blocked + "55" : t.hover).text_color(team.over ? t.blocked : t.foreground))
        .tooltip(team.over ? "Team-Budget überschritten: Team-Panel öffnen (⌘⌥7)" : "Kosten offener Tickets + Orchestrator / Team-Budget: Team-Panel öffnen (⌘⌥7)")
        .on_click(() => run("tabs-graph.panel-team"))
        .child(teamText)))
      .child(h_flex().id("palette").gap(GAP_XS).items_center().cursor_pointer().text_color(t.dim).hover(s => s.text_color(t.foreground))
        .tooltip("Befehlspalette")
        .on_click(() => run("app.palette"))
        .when(Boolean(hint.key), e => e.child(div().text_size(T_XS).child(hint.key)))
        .child(hint.text));
  }
}
