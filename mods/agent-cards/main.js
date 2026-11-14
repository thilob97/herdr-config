// The one place agents show in full (docs/ui-spec.md 4.1, 2): a card per agent in
// priority sections or grouped by space; parents take their most urgent sub-agent's
// place. A viewed done agent stays in Fertig until left.
// omp agents also show their model, thinking level, context and cost, and the
// subagents omp's task tool started: helpers/omp-cards.py reads them from omp's
// session files on the agent's machine, every 5 seconds (a snapshot, not live).
// Cmd-click selects cards; the selection bar under the list messages, interrupts
// or watches them as a team (shared "orchestra.groups"). Every agent's name and
// avatar go to shared "agents.identity" for the other mods' identity chips.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, hc, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, readTextFile, appHome } from "herdr";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4;
const GAP_S = 6;
const GAP_M = 8;
const GAP_L = 12;
const GAP_XL = 16;
const INSET_CARD = 10;
const H_SECTION = 28;
const H_ROW = 28;
const H_BTN = 26;
const H_BTN_S = 22;
const H_INPUT = 30;
const H_CHIP = 18;
const T_XS = 10.5;
const T_S = 11;
const T_M = 12;
const T_L = 13;
const T_XL = 15;

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
  { id: "priority", label: "Nach Dringlichkeit", icon: "clock" },
  { id: "grouped", label: "Nach Space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Wartet auf dich", 3: "Fertig", 2: "Arbeitet", 1: "Ruhig" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
// The word for a status, where one is needed (docs/ui-spec.md 5.6).
const WORD = { working: "arbeitet", blocked: "wartet", done: "fertig", idle: "ruhig", error: "Fehler" };

// The status mark, the same everywhere: a 12×12 box.
function statusMark(t, status) {
  const box = () => div().size(12).flex_none().flex().items_center().justify_center();
  if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") {
    return box().relative()
      .child(div().absolute().inset_0().rounded_full().bg(t.blocked + "55").loop("opacity", { from: 0, to: 1, period: 900 }))
      .child(div().size(7).rounded_full().bg(t.blocked));
  }
  if (status === "done") return box().child(div().size(7).rounded_full().bg(t.done));
  if (status === "error") return box().child(div().size(7).rounded_full().bg(t.blocked));
  return box().child(div().size(7).rounded_full().border(1.5).border_color(status === "idle" ? t.idle : t.dim));
}

// A status as a chip with its word, where the mark alone would say it only by color.
function statusChip(t, status, word = WORD[status] ?? status) {
  const color = t[status === "error" ? "blocked" : status] ?? t.dim;
  return div().h(H_CHIP).px(6).flex_none().flex().items_center().rounded(4).bg(color + "26")
    .text_size(T_XS).font_medium().text_color(color).child(word);
}

// An icon button: 22 with icon 12 in rows and cards, 26 with icon 14 in heads; always a tooltip.
function iconBtn(t, id, path, tooltip, action, size = H_BTN_S) {
  return div().id(id).size(size).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tooltip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
    .child(svg(path).size(size === H_BTN_S ? 12 : 14));
}

// A text button: primary (solid) or secondary (raised); 26 high, 22 in rows.
function textBtn(t, id, label, { primary = false, enabled = true, small = false } = {}, action) {
  return h_flex().id(id).h(small ? H_BTN_S : H_BTN).px(10).flex_none().items_center().rounded(6).text_size(T_M).font_medium()
    .bg(!enabled ? t.raised : primary ? t.solid : t.raised).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => (primary ? s.opacity(0.85) : s.bg(t.hover)))
      .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); }))
    .child(label);
}

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
    if (props()?.sortMenu || props()?.more) return;
    if (props()?.rename) return this.initRename(cx);
    this.folded = new Set();
    // Cmd-clicked cards, by address; the message to them, and how the last action went.
    this.selected = new Set();
    this.force = false;
    this.busy = false;
    this.note = null;
    this.message = InputState.new({ placeholder: "Nachricht an die Auswahl…" });
    this.message.on("submit", (_e, cx) => this.broadcast(cx));
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
    if (gone) { this.publishOmp(); cx.notify(); }
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
          this.publishOmp();
          cx.notify();
        } finally {
          this.ompBusy.delete(key);
        }
      });
    }
  }

  // The subagents omp's task tool started, by agent address, for other mods (the
  // Team panel's graph): shared "omp.subagents", written only when it changed.
  publishOmp() {
    const next = {};
    for (const [address, info] of this.omp) if (info.subagents?.length) next[address] = info.subagents;
    if (JSON.stringify(next) !== JSON.stringify(shared("omp.subagents") ?? {})) setShared("omp.subagents", next);
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

  // The rename dialog (docs/ui-spec.md 5.6, Dialog).
  renameDialog(t) {
    const p = props();
    return v_flex().id("rename").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(GAP_XL).gap(GAP_L).bg(t.popover).text_color(t.foreground)
      .child(h_flex().h(H_ROW).gap(GAP_M).items_center()
        .child(div().flex_1().text_size(T_XL).font_semibold().child("Agent umbenennen"))
        .child(div().id("rn-esc").h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(t.dim)
          .cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => closeOverlay(p.overlay)).child("Esc")))
      .child(v_flex().gap(GAP_S)
        .child(div().text_size(T_S).font_medium().text_color(t.muted).child("Name"))
        .child(Input.new(this.input).h(H_INPUT).px(10).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(T_M).text_color(t.foreground))
        .child(div().text_size(T_S).text_color(t.dim).child("Leer lassen für einen neuen Zufallsnamen.")))
      .child(h_flex().gap(GAP_M).justify_end()
        .child(textBtn(t, "rn-cancel", "Abbrechen", {}, () => closeOverlay(p.overlay)))
        .child(textBtn(t, "rn-save", "Speichern", { primary: true }, () => this.submitRename())));
  }

  // The avatar tile (28): bobs while working, blinks while it needs you. A selected
  // card shows a check in its place.
  avatar(t, a) {
    if (this.selected.has(a.address)) {
      return div().size(28).flex_none().flex().items_center().justify_center().rounded(6).bg(t.solid)
        .child(svg("mods/workspace-chrome/check.svg").size(14).text_color(t.solid_foreground));
    }
    const n = this.avatars[a.address]?.n ?? 0;
    const sprite = image(AVATARS[n]).w(24).h(24).absolute().left(1)
      .when(a.status === "working", (el) => el.loop("top", { from: 3, to: 0, period: 700 }))
      .when(a.status !== "working", (el) => el.top(1))
      .when(a.status === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 900 }))
      .when(a.status === "idle" && !a.focused, (el) => el.opacity(0.6));
    return div().relative().size(28).flex_none().rounded(6).bg(t.background).border_1().border_color(t.border).overflow_hidden().child(sprite);
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

  // A popup's rows: icon 14 and text, 28 high.
  menuRow(t, id, iconPath, label, action, checked = false) {
    return h_flex().id(id).h(H_ROW).px(GAP_M).gap(GAP_M).items_center().rounded(6).text_color(t.foreground).cursor_pointer()
      .hover((el) => el.bg(t.hover))
      .on_click(action)
      .child(svg(iconPath).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().truncate().child(label))
      .when(checked, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)));
  }

  sortMenu(t) {
    const on = sortOf().id;
    const close = () => closeOverlay(props().overlay);
    return v_flex().w_full().p(GAP_XS).gap(2).bg(t.popover).text_size(T_M)
      .child(h_flex().h(H_ROW).px(GAP_M).items_center().text_size(T_S).text_color(t.dim).child("Agents sortieren"))
      .children(SORTS.map((s) => this.menuRow(t, `sort-${s.id}`, `mods/workspace-chrome/${s.icon}.svg`, s.label,
        () => { setShared("agents.sort", s.id); close(); }, s.id === on)));
  }

  // A card's "…": what's done to one agent now and then. A copy of this mod as a
  // popup: it gets the agent's address, whether it's pinned and its name.
  moreMenu(t) {
    const { more: address, pinned, name, overlay } = props();
    const then = (action) => () => { closeOverlay(overlay); action(); };
    return v_flex().w_full().p(GAP_XS).gap(2).bg(t.popover).text_size(T_M)
      .child(this.menuRow(t, "more-plugins", "mods/workspace-chrome/layers.svg", "Plugins …", then(() =>
        openOverlay({ mod: "marketplaces", kind: "window", key: "marketplaces", width: 860, height: 600, props: { agent: address } }))))
      .child(this.menuRow(t, "more-mcp", "mods/agent-cards/icons/plug.svg", "MCP-Server …", then(() =>
        openOverlay({ mod: "mcp-servers", kind: "window", key: "mcp-servers", width: 860, height: 600, props: { agent: address } }))))
      .child(this.menuRow(t, "more-pin", `mods/workspace-chrome/${pinned ? "pin-off" : "pin"}.svg`, pinned ? "Lösen" : "Anheften", then(() =>
        run("terminal.pin", { terminal: address, pinned: !pinned }))))
      .child(this.menuRow(t, "more-rename", "mods/agent-cards/icons/pencil.svg", "Umbenennen …", then(() =>
        openOverlay({ mod: "agent-cards", kind: "dialog", width: 380, height: 210, props: { rename: address, value: name ?? "" } }))));
  }

  openMore(a) {
    openOverlay({ mod: "agent-cards", kind: "popup", width: 200, height: 4 * (H_ROW + 2) + 2 * GAP_XS,
      props: { more: a.address, pinned: a.pinned, name: this.avatars[a.address]?.name ?? "" } });
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

  // The tree lines in front of a sub-agent's row.
  lines(t, lines) {
    return lines.map((l) => div().self_start().mt(-4).w(9).h(18).mr(GAP_XS).flex_none()
      .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
      .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6)));
  }

  // A sub-agent with a terminal: a list row under its parent's card.
  subRow(t, s, shown) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 12, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .h(H_ROW)
      .pl(30)
      .pr(GAP_M)
      .flex_none()
      .items_center()
      .rounded(6)
      .text_size(T_M)
      .when(on, (el) => el.bg(t.raised))
      .hover((el) => el.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(this.lines(t, s.lines))
      .when(Boolean(pic), (el) => el.child(div().mr(GAP_S).child(pic)))
      .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .when(st === "blocked", (el) => el.child(div().mr(GAP_S).child(statusChip(t, "blocked"))))
      .child(statusMark(t, st));
  }

  // A subagent omp's task tool started: no terminal of its own, so nothing to open;
  // its task shows on hover. A failed one says so in words.
  ompSubRow(t, a, s) {
    const st = SUB_STATUS[s.status] ?? "idle";
    const failed = { failed: "fehlgeschlagen", cancelled: "abgebrochen", aborted: "abgebrochen" }[s.status];
    return h_flex()
      .id(`omp-sub-${a.address}-${s.id}`)
      .h(H_ROW)
      .pl(30)
      .pr(GAP_M)
      .flex_none()
      .items_center()
      .rounded(6)
      .text_size(T_M)
      .hover((el) => el.bg(t.hover))
      .when(Boolean(s.description), (el) => el.tooltip(s.description))
      .children(this.lines(t, ["└"]))
      .child(div().flex_none().mr(GAP_S).px(GAP_XS).h(H_CHIP).rounded(4).bg(t.raised).text_size(T_XS).text_color(t.dim).flex().items_center().child(s.agent))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(s.id))
      .child(failed ? statusChip(t, "blocked", failed) : statusMark(t, st));
  }

  // How many omp subagents the cap left out.
  ompMoreRow(t, a, n) {
    return h_flex()
      .id(`omp-more-${a.address}`)
      .h(H_ROW)
      .pl(30 + 9 + GAP_XS)
      .flex_none()
      .items_center()
      .text_size(T_S)
      .text_color(t.dim)
      .child(`+${n} weitere`);
  }

  // On the rail, where no word fits: a ! for blocked (the only bold text).
  bang(t) {
    return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(T_XS).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  }

  // ---- the selection ----

  toggle(address) {
    if (this.selected.has(address)) this.selected.delete(address);
    else this.selected.add(address);
    this.note = null;
  }

  // The message to every selected agent; one that waits for an answer only with
  // "auch wartende" (--force), which answers its question with the message.
  broadcast(cx) {
    const text = this.message.value().trim();
    if (!text || !this.selected.size || this.busy) return;
    const status = new Map(agents().map((a) => [a.address, a.status]));
    const targets = [...this.selected].filter((a) => status.has(a));
    this.busy = true; this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let sent = 0, skipped = 0;
      const failed = [];
      for (const a of targets) {
        const blocked = status.get(a) === "blocked";
        if (blocked && !this.force) { skipped++; continue; }
        try {
          const r = await hc(["send", a, text, ...(blocked ? ["--force"] : [])]);
          if (r.code === 0) sent++;
          else failed.push(`${a}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
        } catch (e) { failed.push(`${a}: ${e?.message ?? e}`); }
      }
      if (!failed.length) this.message.set_value("");
      this.note = {
        ok: !failed.length,
        text: [`gesendet an ${sent}`, skipped ? `${skipped} wartende übersprungen` : "", failed.length ? `Fehler: ${failed.join("; ").slice(0, 200)}` : ""].filter(Boolean).join(" · "),
      };
      this.busy = false;
      cx.notify();
    });
  }

  interrupt(cx) {
    const targets = [...this.selected];
    if (!targets.length || this.busy) return;
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      const out = await Promise.all(targets.map((a) => hc(["interrupt", a]).then((r) => r.code === 0, () => false)));
      this.note = { ok: out.every(Boolean), text: `unterbrochen: ${out.filter(Boolean).length} von ${targets.length}` };
      this.busy = false;
      cx.notify();
    });
    cx.notify();
  }

  // The selection as a watched team (shared "orchestra.groups", docs/ui-spec.md 7.2):
  // the Team panel shows it, the status bar tells when all of it is done.
  watchAsTeam() {
    if (!this.selected.size) return;
    const d = new Date();
    const name = `Team ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const groups = shared("orchestra.groups") ?? [];
    setShared("orchestra.groups", [...groups, { id: `g${Date.now()}`, name, members: [...this.selected], at: Date.now(), watch: true, notified: false }]);
    this.note = { ok: true, text: `${name} wird beobachtet (Team-Panel)` };
  }

  // Under the list while cards are selected: what to do with all of them.
  selectionBar(t) {
    const n = this.selected.size;
    const ready = Boolean(this.message.value().trim()) && !this.busy;
    const check = div().size(14).flex_none().flex().items_center().justify_center().rounded(4).border_1()
      .border_color(this.force ? t.solid : t.input).bg(this.force ? t.solid : t.background)
      .when(this.force, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(12).text_color(t.solid_foreground)));
    return v_flex().id("ag-selection").flex_none().px(GAP_XL).py(GAP_M).gap(GAP_S).bg(t.chrome).border_t(1).border_color(t.border)
      .child(h_flex().h(H_BTN_S).gap(GAP_S).items_center().text_size(T_S)
        .child(div().font_medium().text_color(t.foreground).child(`${n} ausgewählt`))
        .child(div().id("ag-sel-clear").text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.selected.clear(); this.note = null; cx.notify(); }).child("aufheben")))
      .child(h_flex().h(H_INPUT).pl(10).pr(GAP_XS).gap(GAP_XS).items_center().rounded(6).bg(t.background).border_1().border_color(t.input)
        .child(Input.new(this.message).flex_1().min_w(0).text_size(T_M).text_color(t.foreground))
        .child(div().id("ag-sel-send").size(H_BTN_S).flex_none().flex().items_center().justify_center().rounded(6)
          .bg(ready ? t.solid : t.raised).text_color(ready ? t.solid_foreground : t.dim)
          .tooltip("Senden (Enter)")
          .when(ready, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.broadcast(cx)))
          .child(svg("mods/agent-cards/icons/send.svg").size(12))))
      .child(h_flex().id("ag-sel-force").h(H_BTN_S).gap(GAP_S).items_center().text_size(T_S).text_color(t.muted).cursor_pointer()
        .tooltip("Auch an Agents senden, die auf eine Antwort warten: die Nachricht beantwortet ihre Frage")
        .on_click((_e, cx) => { this.force = !this.force; cx.notify(); })
        .child(check).child("auch wartende"))
      .child(h_flex().flex_wrap().gap(GAP_S)
        .child(textBtn(t, "ag-sel-int", "Unterbrechen", { enabled: !this.busy }, (_e, cx) => this.interrupt(cx)))
        .child(textBtn(t, "ag-sel-team", "Als Team beobachten", {}, (_e, cx) => { this.watchAsTeam(); cx.notify(); })))
      .when(Boolean(this.note), (el) => el.child(div().text_size(T_S).text_color(this.note.ok ? t.muted : t.blocked).child(this.note.text)));
  }

  // Every listed agent's name and avatar (docs/ui-spec.md 7.1), written only when it changed.
  publishIdentity(list) {
    const next = {};
    for (const a of list) {
      const v = this.avatars[a.address];
      if (v) next[a.address] = { name: v.name, avatar: AVATARS[v.n] ?? AVATARS[0], program: a.program?.key ?? a.app ?? null };
    }
    if (JSON.stringify(next) !== JSON.stringify(shared("agents.identity") ?? {})) setShared("agents.identity", next);
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.more) return this.moreMenu(t);
    if (props()?.rename) return this.renameDialog(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.assignAvatars(list, Date.now());
    this.applyRename();
    this.publishIdentity(list);
    for (const address of this.selected) if (!this.listed.has(address)) this.selected.delete(address);
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
        ...subs.map((s) => this.subRow(t, s, shown)),
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
      return h_flex()
        .id(`fold-${a.address}`)
        .h(H_CHIP)
        .px(GAP_XS)
        .gap(GAP_XS)
        .flex_none()
        .items_center()
        .rounded(4)
        .text_size(T_XS)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .tooltip(open ? "Sub-Agents einklappen" : "Sub-Agents zeigen")
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
        .when(!open, (el) => el.child(String(sts.length)));
    };

    // The second line says which tab: one someone named or the agent's own title,
    // never an automatic tab number unless two cards would otherwise read the same.
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
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(H_ROW)
          .px(GAP_M)
          .flex_none()
          .items_center()
          .gap(GAP_XS)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(a.status === "blocked" ? this.bang(t) : statusMark(t, a.status)));
      }
      const pic = icon(a.program, 16, t.foreground);
      // An agent on another machine (`vps/t7`) says which.
      const machine = machineOf(a.address);
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const chosen = this.selected.has(a.address);
      const hovered = this.hovered === a.address;
      // Under a space head (grouped) the space goes without saying; without one
      // (priority, pinned) the card names its space.
      const full = byPriority || isPinned;
      const where = [machine, full ? a.space_name : null].filter(Boolean).join(" \u00b7 ");
      const tab = detail.get(a.address) ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      const name = this.avatars[a.address]?.name ?? (a.program?.name || label(a));
      // "Wartet" never by color alone: under "Wartet auf dich" the head says it, elsewhere a chip.
      const sayWaiting = a.status === "blocked" && !(byPriority && !isPinned);
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
        `omp-Sitzung (${o.via === "tty" ? "über das tty dieses Terminals" : "über den Terminal-Titel gefunden"}), alle 5 s gelesen`,
        o.model ? `Modell ${[o.provider, o.model].filter(Boolean).join("/")}` : null,
        thinking ? `Denken ${thinking}` : null,
        o.context ? `Kontext ${tokens(o.context)}${o.window ? ` von ${tokens(o.window)} Tokens` : " Tokens"} (letzte Antwort)` : null,
        o.cost != null ? `Kosten $${o.cost.toFixed(2)} in dieser Sitzung` : null,
      ].filter(Boolean).join("\n") : "";
      const fill = pct == null ? null : pct >= 85 ? t.blocked : pct >= 60 ? t.working : t.done;
      // While hovered: Review, Unterbrechen and "…" over the card's top right.
      const actions = h_flex().absolute().top(7).right(7).gap(2).rounded(6).bg(chosen ? t.selected : t.hover)
        .child(iconBtn(t, `rv-${a.address}`, "mods/agent-cards/icons/review.svg", "Review: Änderungen dieses Agents",
          () => openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680, props: { terminal: a.address } })))
        .child(iconBtn(t, `int-${a.address}`, "mods/agent-cards/icons/stop.svg", "Unterbrechen", () => hc(["interrupt", a.address]).catch(() => null)))
        .child(iconBtn(t, `more-${a.address}`, "mods/agent-cards/icons/more.svg", "Mehr: Plugins, MCP-Server, Anheften, Umbenennen", () => this.openMore(a)));
      return h_flex()
        .id(`ag-${a.address}`)
        .relative()
        .mb(GAP_S)
        .p(INSET_CARD)
        .gap(10)
        .items_start()
        .flex_none()
        .line_height(1.2)
        .rounded(8)
        .bg(chosen ? t.selected : t.surface)
        .border_1()
        .border_color(a.focused ? t.accent : t.border)
        .cursor_pointer()
        .hover((s) => s.bg(chosen ? t.selected : t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click((e, cx) => {
          if (e.modifiers?.platform) { this.toggle(a.address); cx.notify(); }
          else run("pane.focus", { pane: a.pane });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMore(a); })
        .child(this.avatar(t, a))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().h(16).gap(GAP_S).items_center()
            .when(Boolean(pic), (el) => el.child(pic))
            .child(div().flex_none().max_w(120).truncate().text_size(T_L).font_semibold().text_color(idle ? t.muted : t.foreground).child(name))
            .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.dim).child(where))
            .when(sayWaiting, (el) => el.child(statusChip(t, "blocked")))
            .child(statusMark(t, a.status)))
          .child(h_flex().h(14).gap(GAP_S).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.muted).child(tab || WORD[a.status] || ""))
            .when(subs.length + inner.length > 0, (el) => el.child(fold(a, subs, inner)))
            .when(Boolean(when), (el) => el.child(div().flex_none().text_size(T_XS).text_color(t.dim).child(duration(now - when)))))
          .when(facts.length > 0, (el) => el.child(h_flex().id(`omp-${a.address}`).gap(GAP_S).items_center().tooltip(about)
            .child(div().flex_1().min_w(0).truncate().text_size(T_XS).text_color(t.dim).child(facts.join(" \u00b7 ")))
            .when(fill != null, (el) => el.child(div().w(36).h(2).flex_none().rounded_full().bg(t.border)
              .child(div().h(2).rounded_full().w(`${Math.min(100, Math.max(0, pct))}%`).bg(fill)))))))
        .when(hovered, (el) => el.child(actions));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Angeheftet", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's section head; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .h(H_SECTION)
        .px(GAP_M)
        .flex_none()
        .gap(GAP_S)
        .items_center()
        .text_size(T_S)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.muted).child(g.label))
        .child(div().text_color(t.dim).child(String(g.members.length)))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && Boolean(top) && top !== "idle", (el) => el.child(statusMark(t, top)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(12).flex_none().text_color(t.dim)));
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
      .text_size(T_L)
      .when(!collapsed, (el) => el.child(h_flex().h(H_SECTION).pl(16).pr(GAP_M).gap(GAP_S).flex_none().items_center()
        .text_size(T_S).font_medium().text_color(t.muted)
        .child("Agents")
        .child(div().text_color(t.dim).child(String(this.listed.size)))
        .child(div().flex_1())
        .child(iconBtn(t, "ag-sort", `mods/workspace-chrome/${sort.icon}.svg`, `Sortierung: ${sort.label}`,
          () => openOverlay({ mod: "agent-cards", kind: "popup", width: 210, height: 3 * (H_ROW + 2) + 2 * GAP_XS, props: { sortMenu: true } })))))
      .when(list.length === 0 && !collapsed, (el) => el.child(div().px(16).py(GAP_S).text_size(T_S).text_color(t.dim)
        .child("Noch keine Agents. Sie erscheinen hier, sobald sie ihren Status melden (ältere Versionen und Agents in tmux evtl. nicht).")))
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : GAP_M).overflow_y_scrollbar().mode("always").children(rows))
      .when(!collapsed && this.selected.size > 0, (el) => el.child(this.selectionBar(t)))
      .when(collapsed, (el) => el.child(h_flex().h(H_ROW).items_center().justify_center()
        .child(div().id("collapse").text_size(T_L).text_color(t.dim).cursor_pointer().tooltip("Sidebar aufklappen")
          .hover((s) => s.text_color(t.foreground)).on_click(toggleSidebar).child("»"))));
  }
}
