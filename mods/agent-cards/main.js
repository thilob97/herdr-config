// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.
// omp agents also show their model, thinking level, context and cost, and the
// subagents omp's task tool started: helpers/omp-cards.py reads them from omp's
// session files on the agent's machine, every 5 seconds (a snapshot, not live).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, readTextFile, appHome } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

const isOmp = (a) => a.app === "omp" || a.program?.key === "omp";
// `vps/t7` lives on vps; `t7` here (null).
const machineOf = (address) => (address.includes("/") ? address.slice(0, address.indexOf("/")) : null);
const HELPER = () => `${appHome()}/mods/agent-cards/helpers/omp-cards.py`;
// Another machine gets the helper's text (`python -c`): its files aren't there.
let helperText = null;
const helperSource = () => (helperText ??= readTextFile(HELPER()).catch(() => null));
// Python 3 runs as "python3", else "python" (as on Windows): found once per machine.
const pythons = new Map();
function python(on) {
  const key = on ?? "";
  if (!pythons.has(key)) {
    pythons.set(key, exec("python3", ["-c", "1"], { on, timeout: 10000 }).then((r) => (r.code === 0 ? "python3" : "python"), () => "python"));
  }
  return pythons.get(key);
}
// omp's job states as card states.
const SUB_STATUS = { running: "working", pending: "idle", completed: "done", failed: "blocked", cancelled: "blocked", aborted: "blocked" };
const SUBS_SHOWN = 6;
const unfinished = (s) => s.status === "running" || s.status === "pending";
// At most SUBS_SHOWN, in the order omp started them: unfinished ones first to stay, then the newest.
function shownSubs(list) {
  if (list.length <= SUBS_SHOWN) return list;
  const keep = new Set(list.filter(unfinished).slice(0, SUBS_SHOWN));
  for (let i = list.length - 1; i >= 0 && keep.size < SUBS_SHOWN; i--) keep.add(list[i]);
  return list.filter((s) => keep.has(s));
}
const tokens = (n) => (n < 1000 ? String(n) : n < 1e6 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1)}M`);
// Pixel creatures in the Elric palette (avatars/a01..a16.svg).
const AVATARS = Array.from({ length: 16 }, (_, i) => `mods/agent-cards/avatars/a${String(i + 1).padStart(2, "0")}.svg`);
// Names for the creatures, handed out at random like the avatars.
const NAMES = ["Blip", "Byte", "Glitch", "Zorbo", "Nyx", "Quark", "Pixel", "Moxie", "Vex", "Zap", "Rune", "Sprocket",
  "Krill", "Bloop", "Fizz", "Gizmo", "Nova", "Orbit", "Puck", "Riff", "Sparky", "Tango", "Uno", "Wisp",
  "Yuki", "Ziggy", "Comet", "Dash", "Echo", "Flux", "Grit", "Halo", "Ion", "Jinx", "Kip", "Lumo",
  "Mochi", "Nibbles", "Ozzy", "Pogo", "Quill", "Rex", "Sizzle", "Tofu", "Vortex", "Waffle", "Xeno", "Zuzu"];

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    if (props()?.rename) return this.initRename(cx);
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    // Each agent's avatar (index into AVATARS), picked at random when it first shows.
    this.avatars = JSON.parse(localStorage.getItem("avatars") ?? "{}");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    // omp details by agent address, as the helper last printed them; machines being read.
    this.omp = new Map();
    this.ompText = new Map();
    this.ompBusy = new Set();
    this.pollOmp(cx);
    cx.timer.every(5000, (cx) => this.pollOmp(cx));
  }

  // One helper run per machine with omp agents, unless the last one is still running.
  // A failed run or a terminal the helper can't place shows nothing extra.
  pollOmp(cx) {
    const byMachine = new Map();
    const live = new Set();
    for (const a of agents()) {
      if (!isOmp(a)) continue;
      live.add(a.address);
      const on = machineOf(a.address);
      const key = on ?? "";
      if (!byMachine.has(key)) byMachine.set(key, { on, wanted: {} });
      byMachine.get(key).wanted[on ? a.address.slice(on.length + 1) : a.address] = a.title ?? "";
    }
    let gone = false;
    for (const address of [...this.omp.keys()]) {
      if (!live.has(address)) { this.omp.delete(address); gone = true; }
    }
    for (const key of [...this.ompText.keys()]) if (!byMachine.has(key)) this.ompText.delete(key);
    if (gone) cx.notify();
    for (const [key, { on, wanted }] of byMachine) {
      if (this.ompBusy.has(key)) continue;
      this.ompBusy.add(key);
      cx.spawn(async (cx) => {
        try {
          const arg = encodeURIComponent(JSON.stringify(wanted));
          const src = on ? await helperSource() : null;
          if (on && !src) return;
          const r = await exec(await python(on), on ? ["-c", src, arg] : [HELPER(), arg], { on, timeout: 20000 }).catch(() => null);
          const text = r?.code === 0 ? r.stdout : "";
          if (this.ompText.get(key) === text) return;
          this.ompText.set(key, text);
          let got = null;
          try { got = JSON.parse(text); } catch {}
          for (const id of Object.keys(wanted)) {
            const address = on ? `${on}/${id}` : id;
            const info = got && typeof got === "object" ? got[id] : null;
            if (info && typeof info === "object") this.omp.set(address, info);
            else this.omp.delete(address);
          }
          cx.notify();
        } finally {
          this.ompBusy.delete(key);
        }
      });
    }
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  // A new agent gets a random avatar among the least used and a random name
  // nobody has yet; it keeps both, and one not seen for a week is forgotten.
  assignAvatars(list, now) {
    const DAY = 86400000;
    const uses = AVATARS.map(() => 0);
    for (const v of Object.values(this.avatars)) if (uses[v.n] != null) uses[v.n]++;
    const taken = new Set(Object.values(this.avatars).map((v) => v.name));
    const pickName = () => {
      const free = NAMES.filter((x) => !taken.has(x));
      const name = free.length ? free[Math.floor(Math.random() * free.length)] : `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${taken.size}`;
      taken.add(name);
      return name;
    };
    let dirty = false;
    for (const a of list) {
      const known = this.avatars[a.address];
      if (known) {
        // Saved before names existed: give it one now.
        if (!known.name) { known.name = pickName(); dirty = true; }
        // "Last seen" only needs day precision: save it at most once a day.
        if (now - known.at > DAY) { known.at = now; dirty = true; }
        continue;
      }
      const least = Math.min(...uses);
      const free = uses.flatMap((u, n) => (u === least ? [n] : []));
      const n = free[Math.floor(Math.random() * free.length)];
      uses[n]++;
      this.avatars[a.address] = { n, name: pickName(), at: now };
      dirty = true;
    }
    for (const [k, v] of Object.entries(this.avatars)) if (now - v.at > 7 * DAY) { delete this.avatars[k]; dirty = true; }
    if (dirty) localStorage.setItem("avatars", JSON.stringify(this.avatars));
  }

  // Renaming goes through a dialog copy of this mod, which has its own storage:
  // it hands the name over in shared state and the list copy keeps it. An empty
  // name rolls a new random one.
  applyRename() {
    const r = shared("agent-cards.rename");
    if (!r?.id || r.id === localStorage.getItem("renamed")) return;
    localStorage.setItem("renamed", r.id);
    const entry = this.avatars[r.address];
    if (!entry) return;
    const name = String(r.name ?? "").trim().slice(0, 40);
    if (name) entry.name = name;
    else {
      const taken = new Set(Object.values(this.avatars).map((v) => v.name));
      const free = NAMES.filter((x) => !taken.has(x));
      entry.name = (free.length ? free : NAMES)[Math.floor(Math.random() * (free.length || NAMES.length))];
    }
    localStorage.setItem("avatars", JSON.stringify(this.avatars));
  }

  openRename(address) {
    openOverlay({ mod: "agent-cards", kind: "dialog", width: 360, height: 200, props: { rename: address, value: this.avatars[address]?.name ?? "" } });
  }

  initRename(cx) {
    this.input = InputState.new({ value: props().value ?? "" });
    const len = (props().value ?? "").length;
    if (len) this.input.set_selected_range({ start: 0, end: len });
    this.input.on("submit", () => this.submitRename());
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submitRename() {
    const p = props();
    setShared("agent-cards.rename", { address: p.rename, name: this.input.value(), id: `${p.rename}:${Date.now()}` });
    closeOverlay(p.overlay);
  }

  renameDialog(t) {
    const p = props();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("rename").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Rename agent"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11.5).text_color(t.dim).child("Leave empty for a new random name."))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(button("rn-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("rn-save", "Save", true, () => this.submitRename())));
  }

  // The avatar tile: bobs while working, blinks while it needs you.
  avatar(t, a) {
    const n = this.avatars[a.address]?.n ?? 0;
    const ring = t[a.status] ?? t.border;
    const sprite = image(AVATARS[n]).w(24).h(24).absolute().left(3)
      .when(a.status === "working", (el) => el.loop("top", { from: 4, to: 0, period: 700 }))
      .when(a.status !== "working", (el) => el.top(3))
      .when(a.status === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 900 }))
      .when(a.status === "idle" && !a.focused, (el) => el.opacity(0.6));
    return div().relative().size(32).flex_none().rounded(8).bg(t.background).border(1.5).border_color(ring).overflow_hidden().child(sprite);
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // A subagent omp's task tool started: no terminal of its own, so nothing to open;
  // its task shows on hover. A failed one says so rather than "Needs you".
  ompSubRow(t, a, s) {
    const st = SUB_STATUS[s.status] ?? "idle";
    return h_flex()
      .id(`omp-sub-${a.address}-${s.id}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(24)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12)
      .hover((el) => el.bg(t.hover))
      .when(Boolean(s.description), (el) => el.tooltip(s.description))
      .child(div().self_start().mt(-4).w(9).h(16).mr(4).flex_none().border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.input))
      .child(div().flex_none().mr(6).px(4).h(15).rounded(4).bg(t.raised).text_size(10).text_color(t.dim).flex().items_center().child(s.agent))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(s.id))
      .child(st === "blocked"
        ? div().flex_none().px(5).h(16).rounded(4).bg(t.blocked + "26").text_size(10).text_color(t.blocked).flex().items_center().child(s.status)
        : this.status(t, { status: st }));
  }

  // How many omp subagents the cap left out.
  ompMoreRow(t, a, n) {
    return h_flex()
      .id(`omp-more-${a.address}`)
      .pl(39)
      .pr(8)
      .h(20)
      .flex_none()
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .child(div().w(9).mr(4).flex_none())
      .child(div().child(`+${n} more`));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.rename) return this.renameDialog(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.assignAvatars(list, Date.now());
    this.applyRename();
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const inner = collapsed || !isOmp(a) ? [] : this.omp.get(a.address)?.subagents ?? [];
      const r = row(a, i, subs, inner);
      if (this.folded.has(a.address)) return [r];
      const shownInner = shownSubs(inner);
      return [
        r,
        ...subs.map((s) => this.subRow(t, s, shown, byPriority)),
        ...shownInner.map((s) => this.ompSubRow(t, a, s)),
        ...(inner.length > shownInner.length ? [this.ompMoreRow(t, a, inner.length - shownInner.length)] : []),
      ];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    // inner: omp's own subagents, finished ones counting as idle as Herdr's do.
    const fold = (a, subs, inner) => {
      const sts = [...subs.map((s) => kidStatus(s.t, this.listed)), ...inner.map((s) => (s.status === "completed" ? "idle" : SUB_STATUS[s.status] ?? "idle"))];
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(sts.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(panes());
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = [], inner = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      // A card: status stripe on the left, name and status on top, where and how long below.
      const accent = t[a.status] ?? t.idle ?? t.dim;
      const where = [machine, full ? more : a.space_name].filter(Boolean).join(" \u00b7 ");
      // omp: what its session file said at the last read, on a third line.
      const o = isOmp(a) ? this.omp.get(a.address) : null;
      const thinking = o?.thinking ? (o.configured === "auto" && o.thinking !== "auto" ? `${o.thinking} (auto)` : o.thinking) : null;
      const pct = o?.percent ?? null;
      const facts = o ? [
        o.model,
        o.thinking,
        pct != null ? `ctx ${pct}%` : o.context ? `ctx ${tokens(o.context)}` : null,
        o.cost != null ? `$${o.cost.toFixed(2)}` : null,
      ].filter(Boolean) : [];
      const about = o ? [
        `omp session snapshot (${o.via === "tty" ? "this terminal's tty" : "matched by terminal title"}), read every 5s`,
        o.model ? `model ${[o.provider, o.model].filter(Boolean).join("/")}` : null,
        thinking ? `thinking ${thinking}` : null,
        o.context ? `context ${tokens(o.context)}${o.window ? ` of ${tokens(o.window)} tokens` : " tokens"} (last reply)` : null,
        o.cost != null ? `cost $${o.cost.toFixed(2)} in this session file` : null,
      ].filter(Boolean).join("\n") : "";
      const fill = pct == null ? null : pct >= 85 ? t.blocked : pct >= 60 ? t.working : t.accent;
      return h_flex()
        .id(`ag-${a.address}`)
        .mb(6)
        .px(10)
        .py(8)
        .gap(10)
        .items_start()
        .flex_none()
        .rounded(10)
        .bg(a.focused ? t.selected : t.surface)
        .border(1)
        .border_color(a.focused ? t.accent : t.border)
        .border_l(3)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).border_color(t.input))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openRename(a.address); })
        .child(this.avatar(t, a))
        .child(v_flex().flex_1().min_w(0).gap(4)
        .child(h_flex().gap(8).items_center()
          .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
            .when(subs.length + inner.length > 0, el => el.on_click((_e, cx) => {
              cx.stop_propagation();
              this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
              cx.notify();
            })).child(pic)))
          .child(h_flex().flex_1().min_w(0).gap(6).items_center()
            .child(div().flex_none().font_semibold().text_color(idle ? t.muted : t.foreground).child(this.avatars[a.address]?.name ?? name))
            .when(Boolean(this.avatars[a.address]?.name), el => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(name))))
          .child(this.status(t, a, byPriority && !isPinned)))
        .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
          .child(div().size(6).flex_none().rounded(3).bg(accent))
          .child(div().flex_1().min_w(0).truncate().child(where || a.status || ""))
          .when(subs.length + inner.length > 0, el => el.child(fold(a, subs, inner)))
          .when(this.hovered === a.address, el => el.child(pin))
          .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().child(duration(now - when)))))
        .when(facts.length > 0, el => el.child(v_flex().id(`omp-${a.address}`).gap(3).tooltip(about)
          .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(facts.join(" \u00b7 ")))
          .when(fill != null, el => el.child(div().h(2).w_full().rounded(1).bg(t.border)
            .child(div().h(2).rounded(1).w(`${Math.min(100, Math.max(0, pct))}%`).bg(fill)))))));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "agent-cards", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
