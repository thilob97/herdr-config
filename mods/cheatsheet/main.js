// Tastenkürzel: every binding from keys.json (live through keys()), in German,
// grouped by what it is for. Same action on several keys = one row; numbered
// selects (⌘1…⌘9) fold into one. Bindings scoped to a layout or the terminal
// carry a tag. Type to filter; Esc closes. Unknown actions show as written.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, props, closeOverlay, theme, window } from "herdr";

// Tokens (docs/ui-spec.md, 5).
const GAP_XS = 4, GAP_S = 6, GAP_M = 8, GAP_L = 12, GAP_XL = 16;
const INSET_CARD = 10, H_SECTION = 28, H_ROW = 28, H_INPUT = 30, H_CHIP = 18;
const T_XS = 10.5, T_S = 11, T_M = 12, T_XL = 15;

const SEND = { "\u001bb": "Wort zurück", "\u001bf": "Wort vor", "\u0017": "Wort löschen", "\u0001": "Zeilenanfang", "\u0005": "Zeilenende", "\u0015": "Zeile löschen" };
const PANEL = { changes: "Changes", graph: "Git", filetree: "Tree", blueprint: "Blueprint", docker: "Docker", quests: "Quests", team: "Team" };
const DIR = { left: "links", right: "rechts", up: "oben", down: "unten" };
const DESC = {
  "mod.open:launcher": "Auftrag: neue Arbeit ans Team oder selbst starten",
  "mod.open:inbox": "Inbox: was auf dich wartet",
  "status-bar.attention-next": "Zum nächsten wartenden Agent (wartet, dann fertig)",
  "mod.open:review": "Review des fokussierten Terminals",
  "mod.open:cheatsheet": "Diese Übersicht",
  "agent.next": "Nächster Agent", "agent.prev": "Vorheriger Agent",
  "tab.new": "Neuer Tab (Shell)", "tab.close": "Tab schließen", "tab.next": "Nächster Tab", "tab.prev": "Vorheriger Tab", "tab.rename": "Tab umbenennen",
  "space.new": "Neuer Space", "space.next": "Nächster Space", "space.prev": "Vorheriger Space", "space.rename": "Space umbenennen",
  "space-folders.next": "Nächster Space (Seitenleisten-Reihenfolge)", "space-folders.prev": "Vorheriger Space (Seitenleisten-Reihenfolge)",
  "pane.close": "Pane schließen", "pane.zoom": "Pane zoomen / zurück",
  "tabs-graph.panel": "Rechtes Panel ein/aus",
  "layout.toggle:sidebar": "Seitenleiste ein/aus", "layout.switch": "Nächstes Layout",
  "mod.open:picker": "Gehe zu… (Tab, Space, Agent)", "app.palette": "Befehlspalette",
  "mod.open:marketplaces": "Marketplaces", "mod.open:mcp-servers": "MCP-Server",
  "app.settings": "Einstellungen", "app.help": "Herdrs eigene Tastenliste",
  "app.zoom_in": "Zoom größer", "app.zoom_out": "Zoom kleiner", "app.zoom_reset": "Zoom zurücksetzen",
  "app.quit": "Beenden", "app.hide": "Ausblenden", "app.hide_others": "Andere ausblenden",
  "terminal.search": "Suchen", "terminal.copy": "Kopieren", "terminal.paste": "Einfügen", "terminal.paste_image": "Bild einfügen",
};
const GROUPS = [
  ["Auftrag und Agents", (a) => /^agent\.|^status-bar\.|^mod\.open:(inbox|review|launcher)$/.test(a)],
  ["Panels und Seitenleiste", (a) => /^tabs-graph\.|^layout\.toggle:sidebar$/.test(a)],
  ["Tabs", (a) => /^tab\./.test(a)],
  ["Spaces", (a) => /^space\.|^space-folders\./.test(a)],
  ["Panes", (a) => /^pane\./.test(a)],
  ["Terminal", (a) => /^terminal\.|^send:/.test(a)],
  ["App und Layouts", () => true],
];

function actionText(action) {
  if (typeof action === "string") return action;
  try { return JSON.stringify(action); } catch { return String(action); }
}

// The command a binding runs, for grouping: object-form bindings
// ({"command": "tab.new", "args": {...}}) group by their command.
function commandOf(action) {
  const a = actionText(action);
  if (!a.startsWith("{")) return a;
  try { return JSON.parse(a).command ?? a; } catch { return a; }
}

function describe(raw) {
  const a = actionText(raw);
  if (a.startsWith("{")) {
    try {
      const o = JSON.parse(a);
      if (o.command === "tab.new" && o.args?.argv) return `Neuer Tab mit ${o.args.argv.join(" ")}`;
      return o.command;
    } catch { return a; }
  }
  if (DESC[a]) return DESC[a];
  if (a.startsWith("send:")) return SEND[a.slice(5)] ?? `tippt ${JSON.stringify(a.slice(5))}`;
  const [name, arg] = a.split(/:(.*)/s);
  if (name.startsWith("tabs-graph.panel-")) return `Panel ${PANEL[name.slice(17)] ?? name.slice(17)} ein/aus`;
  if (name === "pane.split") return `Teilen nach ${DIR[arg] ?? arg}`;
  if (name === "pane.go") return `Fokus nach ${DIR[arg] ?? arg}`;
  if (name === "pane.swap") return `Pane nach ${DIR[arg] ?? arg} tauschen`;
  if (name === "layout.switch") return `Layout ${arg}`;
  if (name === "mod.open") return `${arg} öffnen`;
  return arg ? `${name} ${arg}` : name;
}

function chord(k, mac) {
  const MAC = { cmd: "⌘", ctrl: "⌃", alt: "⌥", option: "⌥", shift: "⇧" };
  const WORD = { cmd: "Ctrl+", ctrl: "Ctrl+", alt: "Alt+", option: "Alt+", shift: "Shift+" };
  const NAMED = { left: "←", right: "→", up: "↑", down: "↓", enter: "↵", backspace: "⌫", escape: "Esc", tab: "Tab", pagedown: "PgDn", pageup: "PgUp", space: "Space" };
  const parts = k.endsWith("--") ? [...k.slice(0, -2).split("-"), "-"] : k.split("-");
  const key = parts.pop();
  const mods = parts.map((p) => (mac ? MAC[p] : WORD[p]) ?? `${p}+`).join("");
  return mods + (NAMED[key] ?? key.toUpperCase());
}
const pretty = (k, mac) => k.split(" ").map((c) => chord(c, mac)).join(" ");
const scope = (s) => (s === "global" ? null : s === "terminal" ? "im Terminal" : s.startsWith("layout:") ? s.slice(7) : s.replace(/^mod:/, ""));

export default class Cheatsheet extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Filtern … (Taste oder Beschreibung)" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().toLowerCase(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
  }

  rows(mac) {
    const byKey = new Map();
    for (const k of keys()) {
      const action = actionText(k.action);
      // ⌘1 … ⌘9 for tab.select:1..9 is one row.
      const num = /^(tab|space)\.select:(\d)$/.exec(action);
      const id = num ? `${num[1]}.select#${k.section}#${k.keys.replace(/\d$/, "")}` : `${action}#${k.section}`;
      const row = byKey.get(id) ?? { action, section: k.section, keys: [], nums: [], desc: num ? `${num[1] === "tab" ? "Tab" : "Space"} 1–9 wählen` : describe(k.action) };
      if (num) row.nums.push({ n: +num[2], keys: k.keys });
      else row.keys.push(pretty(k.keys, mac));
      byKey.set(id, row);
    }
    for (const r of byKey.values()) {
      if (!r.nums.length) continue;
      r.nums.sort((a, b) => a.n - b.n);
      const first = pretty(r.nums[0].keys, mac), last = pretty(r.nums.at(-1).keys, mac);
      r.keys = [r.nums.length > 1 ? `${first} … ${last}` : first];
    }
    const f = this.filter;
    return [...byKey.values()].filter((r) => !f || r.desc.toLowerCase().includes(f) || r.keys.join(" ").toLowerCase().includes(f) || r.action.toLowerCase().includes(f));
  }

  // A group as a card (5.6) with a section head; keys as chips.
  card(t, name, rows) {
    return v_flex().w_full().px(INSET_CARD).pb(GAP_S).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(h_flex().h(H_SECTION).items_center().text_size(T_S).font_medium().text_color(t.muted).child(name))
      .children(rows.map((r, i) => h_flex().id(`cs-${name}-${i}`).min_h(H_ROW).gap(GAP_M).items_center()
        .child(h_flex().w(150).flex_none().gap(GAP_XS).flex_wrap()
          .children(r.keys.map((k) => div().h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised)
            .text_size(T_XS).text_color(t.foreground).child(k))))
        .child(div().flex_1().min_w(0).text_size(T_M).text_color(t.foreground).child(r.desc))
        .when(Boolean(scope(r.section)), (el) => el.child(div().flex_none().h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(t.muted).child(scope(r.section))))));
  }

  render() {
    const t = theme();
    const mac = window()?.platform === "macos";
    const left = this.rows(mac);
    const groups = [];
    for (const [name, test] of GROUPS) {
      const mine = left.filter((r) => !r.taken && test(commandOf(r.action)));
      mine.forEach((r) => { r.taken = true; });
      if (mine.length) groups.push([name, mine]);
    }
    // Two columns, each group to the shorter one.
    const cols = [[], []], height = [0, 0];
    for (const g of groups) { const c = height[0] <= height[1] ? 0 : 1; cols[c].push(g); height[c] += g[1].length + 2; }
    const close = () => closeOverlay(props().overlay);
    // Dialog (5.6): p 16, gap 12, a 28 px title row, content fills the height.
    return v_flex().id("cheatsheet").size_full().min_h(0).p(GAP_XL).gap(GAP_L).bg(t.popover).text_size(T_M)
      .on_key_down((e) => { if (e.key === "escape") close(); })
      .child(h_flex().h(28).flex_none().items_center().gap(GAP_M)
        .child(div().text_size(T_XL).font_semibold().text_color(t.foreground).child("Tastenkürzel"))
        .child(div().text_size(T_S).text_color(t.muted).child("aus keys.json, live"))
        .child(div().flex_1())
        .child(div().text_size(T_XS).text_color(t.dim).child("tippen filtert"))
        .child(div().id("cs-esc").h(H_CHIP).px(6).flex().items_center().rounded(4).bg(t.raised).text_size(T_XS).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Schließen (Esc)").on_click(close).child("Esc")))
      .child(h_flex().h(H_INPUT).flex_none().px(10).gap(GAP_S).items_center().rounded(6).border_1().border_color(this.typing ? t.accent : t.input).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(12).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(T_M).text_color(t.foreground)))
      .child(div().id("cs-scroll").flex_1().min_h(0).overflow_y_scrollbar()
        .child(groups.length
          ? h_flex().w_full().gap(GAP_L).items_start()
            .children(cols.map((col, i) => v_flex().id(`cs-col-${i}`).flex_1().min_w(0).gap(GAP_L).children(col.map(([name, rows]) => this.card(t, name, rows)))))
          : h_flex().h(H_ROW).items_center().text_size(T_S).text_color(t.dim).child("Keine Taste passt zum Filter.")));
  }
}
