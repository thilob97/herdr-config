// Tastenkürzel: every binding from keys.json (live through keys()), in German,
// grouped by what it is for. Same action on several keys = one row; numbered
// selects (⌘1…⌘9) fold into one. Bindings scoped to a layout or the terminal
// carry a tag. Type to filter; Esc closes. Unknown actions show as written.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, props, closeOverlay, theme, window } from "herdr";

const SEND = { "\u001bb": "Wort zurück", "\u001bf": "Wort vor", "\u0017": "Wort löschen", "\u0001": "Zeilenanfang", "\u0005": "Zeilenende", "\u0015": "Zeile löschen" };
const PANEL = { changes: "Changes", graph: "Git", filetree: "Tree", blueprint: "Blueprint", docker: "Docker", quests: "Quests" };
const DIR = { left: "links", right: "rechts", up: "oben", down: "unten" };
const DESC = {
  "status-bar.attention-next": "Nächster wartender Agent (blocked, dann fertig)",
  "mod.open:inbox": "Inbox: wer wartet, Bildschirm, antworten",
  "mod.open:review": "Review: Änderungen des fokussierten Agents",
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
  ["Agents", (a) => /^agent\.|^status-bar\.|^mod\.open:(inbox|review)$/.test(a)],
  ["Panels & Seitenleiste", (a) => /^tabs-graph\.|^layout\.toggle:sidebar$/.test(a)],
  ["Tabs", (a) => /^tab\./.test(a)],
  ["Spaces", (a) => /^space\.|^space-folders\./.test(a)],
  ["Panes", (a) => /^pane\./.test(a)],
  ["Terminal", (a) => /^terminal\.|^send:/.test(a)],
  ["App & Layouts", () => true],
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
    this.input = InputState.new({ placeholder: "Filtern… (Taste oder Beschreibung)" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().toLowerCase(); cx.notify(); });
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

  card(t, name, rows) {
    return v_flex().w_full().gap(1).p(10).rounded(9).bg(t.background).border(1).border_color(t.border)
      .child(div().pb(4).text_size(11).font_semibold().text_color(t.dim).child(name.toUpperCase()))
      .children(rows.map((r, i) => h_flex().id(`cs-${name}-${i}`).min_h(26).gap(10).items_center()
        .child(h_flex().w(150).flex_none().gap(4).flex_wrap()
          .children(r.keys.map((k) => div().px(6).py(1).rounded(5).bg(t.raised).border(1).border_color(t.border)
            .text_size(11.5).text_color(t.accent).child(k))))
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(r.desc))
        .when(Boolean(scope(r.section)), (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).child(scope(r.section))))));
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
    return v_flex().id("cheatsheet").size_full().min_h(0).p(18).gap(12).bg(t.popover).text_size(12)
      .on_key_down((e) => { if (e.key === "escape") close(); })
      .child(h_flex().items_center().gap(10)
        .child(svg("mods/cheatsheet/icon.svg").size(16).text_color(t.muted))
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Tastenkürzel"))
        .child(div().text_size(11).text_color(t.dim).child("aus keys.json · live"))
        .child(div().flex_1())
        .child(div().id("cs-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(close).child("Esc")))
      .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(14).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .child(div().id("cs-scroll").flex_1().min_h(0).overflow_y_scrollbar()
        .child(groups.length
          ? h_flex().w_full().gap(12).items_start()
            .children(cols.map((col, i) => v_flex().id(`cs-col-${i}`).flex_1().min_w(0).gap(12).children(col.map(([name, rows]) => this.card(t, name, rows)))))
          : div().p(20).text_color(t.dim).child("Keine Taste passt zum Filter.")));
  }
}
