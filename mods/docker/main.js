// Docker containers per machine, grouped by compose project, as cards like the agents list.
// `docker ps` every 5s, `docker stats` every 10s for machines with running containers, and
// again after every action. Timers keep running while the panel is hidden (Herdr can't tell).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, machines, spaces, run, theme, notify } from "herdr";

// One JSON object per container; labels by name, since `.Labels` joins values that may hold commas.
const PS_FORMAT = '{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},"status":{{json .Status}},"ports":{{json .Ports}},' +
  '"project":{{json (.Label "com.docker.compose.project")}},"dir":{{json (.Label "com.docker.compose.project.working_dir")}},"files":{{json (.Label "com.docker.compose.project.config_files")}}}';
const SHELL = "command -v bash >/dev/null 2>&1 && exec bash || exec sh";
const STANDALONE = "Standalone";

const lines = (text) => text.split("\n").flatMap((l) => {
  try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; }
});

// Published TCP host ports: "0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp" is "3000"; "5432/tcp" isn't published.
const portsOf = (s) => [...new Set([...(s ?? "").matchAll(/:(\d+(?:-\d+)?)->\d+(?:-\d+)?\/tcp/g)].map((m) => m[1]))];

// Color and motion by state: bob while running, pulse while unhealthy or restarting.
function look(t, c) {
  const health = /\(healthy\)/.test(c.status) ? "healthy" : /\(unhealthy\)/.test(c.status) ? "unhealthy" : null;
  if (c.state === "restarting" || (c.state === "running" && health === "unhealthy")) return { color: t.blocked, anim: "pulse" };
  if (c.state === "running") return { color: health === "healthy" ? t.done : t.working, anim: "bob" };
  if (c.state === "dead") return { color: t.blocked, anim: null };
  if (c.state === "paused") return { color: t.idle ?? t.dim, anim: null };
  return { color: t.dim, anim: null };
}

const clamp = (n) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

export default class Docker extends View {
  init(_props, cx) {
    this.hosts = new Map(); // machine key ("" here) -> { on, error, list }
    this.usage = new Map(); // machine key -> Map(container id -> docker stats row)
    this.psBusy = new Set();
    this.psAgain = new Set();
    this.statsBusy = new Set();
    this.busy = new Set(); // card / group ids with an action running
    this.folded = new Set();
    this.all = localStorage.getItem("all") === "1";
    this.filter = "";
    this.hovered = null;
    this.menu = null; // card whose actions a right-click pinned open
    this.confirm = null; // card asking whether to remove
    this.input = InputState.new({ placeholder: "Filter containers…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().trim().toLowerCase(); cx.notify(); });
    this.poll(cx);
    cx.timer.every(5000, (cx) => this.poll(cx));
    cx.timer.every(10000, (cx) => this.stats(cx));
  }

  poll(cx) {
    for (const m of machines()) if (m.layout !== "unavailable") this.ps(cx, m.name);
  }

  ps(cx, on) {
    const key = on ?? "";
    if (this.psBusy.has(key)) { this.psAgain.add(key); return; }
    this.psBusy.add(key);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("docker", ["ps", "-a", "--format", PS_FORMAT], { on, timeout: 20000 });
        const fresh = !this.hosts.has(key);
        this.hosts.set(key, r.code === 0
          ? { on, error: null, list: lines(r.stdout) }
          : { on, error: (r.stderr || r.stdout).trim() || `docker exited with ${r.code}`, list: [] });
        if (fresh && r.code === 0) this.stats(cx);
      } catch {
        // No docker there, or the machine is gone: no section.
        this.hosts.delete(key);
      } finally {
        this.psBusy.delete(key);
      }
      cx.notify();
      if (this.psAgain.delete(key)) this.ps(cx, on);
    });
  }

  stats(cx) {
    for (const [key, host] of this.hosts) {
      if (this.statsBusy.has(key)) continue;
      if (!host.list.some((c) => c.state === "running")) { this.usage.delete(key); continue; }
      this.statsBusy.add(key);
      cx.spawn(async (cx) => {
        try {
          const r = await exec("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { on: host.on, timeout: 30000 });
          if (r.code === 0) this.usage.set(key, new Map(lines(r.stdout).map((s) => [s.ID, s])));
        } catch {} finally {
          this.statsBusy.delete(key);
        }
        cx.notify();
      });
    }
  }

  // Runs a docker command for a card or group, then refreshes that machine. Failures show stderr.
  act(cx, busyId, on, args) {
    if (this.busy.has(busyId)) return;
    this.busy.add(busyId);
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("docker", args, { on, timeout: 180000 }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
      this.busy.delete(busyId);
      if (r.code !== 0) {
        const verb = args[0] === "compose" ? `compose ${args.at(-1) === "-d" ? "up" : args.at(-1)}` : args[0];
        notify({ title: `docker ${verb} failed`, body: ((r.stderr || r.stdout).trim() || `exit ${r.code}`).slice(-600), level: "error" });
      }
      this.ps(cx, on);
      cx.notify();
    });
  }

  // A tab on the container's machine: the focused space if it's there, else its first space, else a new one.
  openTerminal(on, name, argv) {
    const there = (s) => (s.machine ?? null) === on;
    const space = spaces().find((s) => s.active && there(s)) ?? spaces().find(there);
    if (space) run("tab.new", { space: space.id, name, argv });
    else run("space.new", { machine: on ?? "", name, argv });
  }

  compose(cx, host, g, verb) {
    const project = ["compose", "-p", g.project];
    const files = g.files ? g.files.split(",").flatMap((f) => ["-f", f]) : [];
    const args = verb === "up"
      ? [...project, ...(g.dir ? ["--project-directory", g.dir] : []), ...files, "up", "-d"]
      : [...project, verb];
    this.act(cx, g.id, host.on, args);
  }

  icon(t, id, icon, tip, action) {
    return div().id(id).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(icon).size(13));
  }

  spinner(t, color) {
    return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(color ?? t.working).spin(900);
  }

  // The state dot: a soft halo breathes around it while running, faster when in trouble.
  dot(l) {
    const dot = div().size(7).rounded(4).bg(l.color);
    if (!l.anim) return div().size(13).mx(0).flex_none().flex().items_center().justify_center().child(dot.opacity(0.6));
    const period = l.anim === "pulse" ? 800 : 2200;
    return div().relative().size(13).flex_none().flex().items_center().justify_center()
      .child(div().absolute().inset_0().rounded(7).bg(l.color + "55").loop("opacity", { from: 0, to: 1, period }))
      .child(dot);
  }

  // The tile: a container glyph in the state's color; still while running, pulses while in trouble.
  tile(t, l) {
    const glyph = svg("mods/docker/icon.svg").size(20).absolute().left(4.5).top(5).text_color(l.color)
      .when(l.anim === "pulse", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 900 }))
      .when(!l.anim, (el) => el.opacity(0.6));
    return div().relative().size(32).flex_none().rounded(8).bg(t.background).border(1.5)
      .border_color(l.anim ? l.color : t.border).overflow_hidden().child(glyph);
  }

  card(t, host, c) {
    const id = `${host.key}/${c.id}`;
    const l = look(t, c);
    const running = c.state === "running" || c.state === "restarting";
    const name = c.name || c.id;
    const u = c.state === "running" ? this.usage.get(host.key)?.get(c.id) : null;
    const open = this.hovered === id || this.menu === id;
    const busy = this.busy.has(id);
    const asking = this.confirm === id;
    const actions = h_flex().flex_none().gap(1).items_center()
      .child(running
        ? this.icon(t, `stop-${id}`, "mods/docker/stop.svg", "Stop", (cx) => this.act(cx, id, host.on, ["stop", c.id]))
        : this.icon(t, `start-${id}`, "mods/docker/play.svg", "Start", (cx) => this.act(cx, id, host.on, ["start", c.id])))
      .child(this.icon(t, `restart-${id}`, "mods/docker/restart.svg", "Restart", (cx) => this.act(cx, id, host.on, ["restart", c.id])))
      .child(this.icon(t, `logs-${id}`, "mods/docker/logs.svg", "Logs", () => this.openTerminal(host.on, `logs ${name}`, ["docker", "logs", "-f", "--tail", "200", c.id])))
      .when(c.state === "running", (el) => el.child(this.icon(t, `shell-${id}`, "mods/workspace-chrome/terminal.svg", "Shell",
        () => this.openTerminal(host.on, `sh ${name}`, ["docker", "exec", "-it", c.id, "sh", "-c", SHELL]))))
      .when(!running, (el) => el.child(this.icon(t, `rm-${id}`, "mods/docker/trash.svg", "Remove…", (cx) => { this.confirm = id; cx.notify(); })));
    const chip = (p) => div().id(`port-${id}-${p}`).flex_none().px(5).h(16).flex().items_center().rounded(4)
      .bg(t.raised).border(1).border_color(t.border).text_size(10.5).text_color(t.muted).cursor_pointer()
      .hover((s) => s.text_color(t.foreground).border_color(t.input)).tooltip(`Open http://localhost:${p.split("-")[0]}`)
      // shortcut: localhost is right for this computer and WSL, not for a remote ssh machine; use its host then.
      .on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(`http://localhost:${p.split("-")[0]}`); })
      .child(`:${p}`);
    const bar = (label, pct, text) => h_flex().flex_1().min_w(0).gap(5).items_center()
      .child(div().flex_none().child(label))
      .child(div().flex_1().min_w(12).h(3).rounded(2).bg(t.border).child(div().h(3).rounded(2).w(`${clamp(pct)}%`).bg(pct >= 85 ? t.blocked : t.accent)))
      .child(div().flex_none().child(text));
    const ports = portsOf(c.ports);
    return div().id(`c-${id}`).relative().mb(6).flex_none().rounded(10).overflow_hidden()
      .bg(this.menu === id ? t.selected : t.surface).border(1).border_color(this.menu === id ? t.accent : t.border)
      .hover((s) => s.bg(t.hover).border_color(t.input))
      .on_hover((on, cx) => {
        if (on) this.hovered = id;
        else if (this.hovered === id) this.hovered = null;
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu = this.menu === id ? null : id; cx.notify(); })
      .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(l.color))
      .child(h_flex().pl(12).pr(10).py(8).gap(10).items_start()
        .child(this.tile(t, l))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(h_flex().gap(6).items_center().h(18)
            .child(div().flex_shrink(1).min_w(0).truncate().font_semibold().text_color(running ? t.foreground : t.muted).child(name))
            .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(c.image))
            .child(busy ? this.spinner(t, l.color) : open && !asking ? actions : this.dot(l)))
          .child(asking
            ? h_flex().gap(6).items_center().text_size(11)
              .child(div().flex_1().min_w(0).truncate().text_color(t.blocked).child(`Remove ${name}?`))
              .child(div().id(`rm-yes-${id}`).flex_none().px(7).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_color(t.blocked).cursor_pointer()
                .hover((s) => s.bg(t.blocked + "40"))
                .on_click((_e, cx) => { cx.stop_propagation(); this.confirm = null; this.act(cx, id, host.on, ["rm", c.id]); })
                .child("Remove"))
              .child(div().id(`rm-no-${id}`).flex_none().px(7).h(18).flex().items_center().rounded(5).text_color(t.dim).cursor_pointer()
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_click((_e, cx) => { cx.stop_propagation(); this.confirm = null; cx.notify(); })
                .child("Cancel"))
            : h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
              .child(div().flex_1().min_w(0).truncate().child(c.status))
              .children(ports.map(chip)))
          .when(Boolean(u), (el) => el.child(h_flex().gap(10).items_center().text_size(10.5).text_color(t.dim)
            .child(bar("CPU", parseFloat(u.CPUPerc), u.CPUPerc))
            .child(bar("MEM", parseFloat(u.MemPerc), String(u.MemUsage ?? "").split(" / ")[0]))))));
  }

  // A compose project (or the standalone containers): folds; compose ones get up / stop / restart.
  group(t, host, g) {
    const open = !this.folded.has(g.id);
    const up = g.members.filter((c) => c.state === "running").length;
    const compose = g.project !== null;
    return h_flex().id(g.id).px(6).pt(6).h(28).flex_none().gap(6).items_center().text_size(11).font_medium().text_color(t.dim)
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { open ? this.folded.add(g.id) : this.folded.delete(g.id); cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .child(div().flex_shrink(1).min_w(0).truncate().text_color(up ? t.muted : t.dim).child(g.project ?? STANDALONE))
      .child(div().id(`n-${g.id}`).flex_none().text_color(up ? t.working : t.dim).tooltip(`${up} running of ${g.members.length}`).child(`${up}/${g.members.length}`))
      .child(div().flex_1())
      .when(compose && this.busy.has(g.id), (el) => el.child(this.spinner(t)))
      .when(compose && !this.busy.has(g.id), (el) => el
        .child(this.icon(t, `up-${g.id}`, "mods/docker/play.svg", g.dir ? "compose up -d" : "compose up -d (no project folder known)", (cx) => this.compose(cx, host, g, "up")))
        .child(this.icon(t, `stop-${g.id}`, "mods/docker/stop.svg", "compose stop", (cx) => this.compose(cx, host, g, "stop")))
        .child(this.icon(t, `restart-${g.id}`, "mods/docker/restart.svg", "compose restart", (cx) => this.compose(cx, host, g, "restart"))));
  }

  rows(t, host) {
    const label = host.on ?? "This PC";
    const running = host.list.filter((c) => c.state === "running").length;
    const head = h_flex().id(`m-${host.key}`).px(6).pt(10).pb(2).flex_none().gap(6).items_center().text_size(11.5).font_semibold().text_color(t.muted)
      .child(svg("mods/workspace-chrome/server.svg").size(12).flex_none().text_color(t.dim))
      .child(div().child(label))
      .when(!host.error, (el) => el.child(div().text_size(11).font_normal().text_color(t.dim).child(`${running} running · ${host.list.length}`)));
    if (host.error) {
      return [head, h_flex().id(`err-${host.key}`).mx(2).mb(6).px(10).py(8).gap(8).items_center().rounded(10).border(1).border_color(t.border).bg(t.surface)
        .text_size(11.5).text_color(t.dim).tooltip(host.error)
        .child(div().size(7).flex_none().rounded(4).border(1.5).border_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().child(/daemon|connect|pipe|socket/i.test(host.error) ? "Docker not running" : host.error))];
    }
    const match = (c) => (this.all || c.state === "running" || c.state === "restarting")
      && (!this.filter || [c.name, c.image, c.project].some((s) => (s ?? "").toLowerCase().includes(this.filter)));
    // Compose projects by name (ps lists newest first, so a project's folder comes from its newest container), standalone last.
    const groups = new Map();
    for (const c of host.list) {
      const project = c.project || null;
      const id = `g-${host.key}-${project ?? ""}`;
      if (!groups.has(id)) groups.set(id, { id, project, dir: null, files: null, members: [] });
      const g = groups.get(id);
      g.members.push(c);
      if (!g.dir && c.dir) { g.dir = c.dir; g.files = c.files || null; }
    }
    const ordered = [...groups.values()].sort((a, b) => (a.project === null) - (b.project === null) || (a.project ?? "").localeCompare(b.project ?? ""));
    const out = [head];
    for (const g of ordered) {
      const shown = g.members.filter(match);
      if (!shown.length) continue;
      out.push(this.group(t, host, g));
      if (!this.folded.has(g.id)) out.push(...shown.map((c) => this.card(t, host, c)));
    }
    if (out.length === 1) out.push(div().px(8).py(4).text_size(11.5).text_color(t.dim).child(this.filter ? "Nothing matches." : this.all ? "No containers." : "No running containers."));
    return out;
  }

  render(cx) {
    const t = theme();
    const hosts = machines().filter((m) => m.layout !== "unavailable")
      .map((m) => this.hosts.get(m.name ?? "") && { ...this.hosts.get(m.name ?? ""), key: m.name ?? "" }).filter(Boolean);
    const loading = !hosts.length && this.psBusy.size > 0;
    const seg = (id, label, on, value) => div().id(id).px(8).h(20).flex().items_center().rounded(5).text_size(11)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.all = value; localStorage.setItem("all", value ? "1" : "0"); cx.notify(); })
      .child(label);
    return v_flex().id("docker").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .on_mouse_down("left", (_e, cx) => { if (this.menu || this.confirm) { this.menu = null; this.confirm = null; cx.notify(); } })
      .child(h_flex().px(14).h(40).flex_none().gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/docker/icon.svg").size(15).flex_none().text_color(t.accent))
        .child(div().flex_1().text_size(12.5).font_semibold().child("Docker"))
        .child(h_flex().p(2).gap(2).rounded(7).border(1).border_color(t.border).bg(t.background)
          .child(seg("show-running", "Running", !this.all, false))
          .child(seg("show-all", "All", this.all, true)))
        .child(this.icon(t, "refresh", "mods/docker/restart.svg", "Refresh", (cx) => { this.poll(cx); this.stats(cx); })))
      .child(h_flex().px(10).pt(8).pb(4).flex_none()
        .child(Input.new(this.input).w_full().h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.surface).text_size(12).text_color(t.foreground)))
      .child(v_flex().id("docker-list").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar()
        .children(hosts.flatMap((h) => this.rows(t, h)))
        .when(!hosts.length, (el) => el.child(div().px(8).py(10).text_size(12).text_color(t.dim)
          .child(loading ? "Looking for Docker…" : "No machine with Docker found."))));
  }
}
