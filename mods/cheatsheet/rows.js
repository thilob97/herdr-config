// Rows for the cheatsheet, without a window: keys.json's bindings become one row
// per action with its keys and the scopes its bindings are limited to. A binding
// that is not `global` carries a tag; `global` is the default and never one.
//
// Mac and other keyboards differ in how a combo reads; `chord` draws one chord
// (or one modifier pressed on its own: `control control` is two taps of ⌃).

const SEND = { "\u001bb": "Wort zurück", "\u001bf": "Wort vor", "\u0017": "Wort löschen", "\u0001": "Zeilenanfang", "\u0005": "Zeilenende", "\u0015": "Zeile löschen" };
const PANEL = { changes: "Changes", graph: "Git", filetree: "Tree", blueprint: "Blueprint", docker: "Docker", team: "Team", factory: "Fabrik" };
const DIR = { left: "links", right: "rechts", up: "oben", down: "unten" };
const DESC = {
  "layout.switch:dashboard": "Dashboard zeigen",
  "layout.switch:elric": "Zurück zur Werkbank (elric)",
  "mod.open:board": "Board (Popup) öffnen",
  "mod.open:timeline": "Timeline (Popup) öffnen",
  "mod.open:quests": "Quests (Popup) öffnen",
  "mod.open:teams": "Team-Hub (Popup) öffnen",
  "mod.open:launcher": "Auftrag: neue Arbeit ans Team oder selbst starten",
  "mod.open:inbox": "Inbox: was auf dich wartet",
  "mod.open:graph": "Fabrik-Graph: Agents und Tickets von oben nach unten",
  "tabs-graph.panel-team": "Team-Pipeline (Sidepanel) ein/aus",
  "tabs-graph.panel-factory": "Fabrik-Graph (Sidepanel) ein/aus",
  "tabs-graph.panel-inbox": "Inbox (Sidepanel) ein/aus",
  "tabs-graph.panel-changes": "Changes (Sidepanel) ein/aus",
  "tabs-graph.panel-graph": "Git (Sidepanel) ein/aus",
  "tabs-graph.panel-filetree": "Tree (Sidepanel) ein/aus",
  "tabs-graph.panel-blueprint": "Blueprint (Sidepanel) ein/aus",
  "tabs-graph.panel-docker": "Docker (Sidepanel) ein/aus",
  "status-bar.attention-next": "Zum nächsten wartenden Agent (wartet, dann fertig)",
  "mod.open:review": "Review des fokussierten Terminals",
  "mod.open:cheatsheet": "Diese Übersicht",
  "hermes.toggle": "Hermes-Chat (oben rechts) auf/zu",
  "agent.next": "Nächster Agent", "agent.prev": "Vorheriger Agent",
  "tab.new": "Neuer Tab (Shell)", "tab.close": "Tab schließen", "tab.next": "Nächster Tab", "tab.prev": "Vorheriger Tab", "tab.rename": "Tab umbenennen",
  "space.new": "Neuer Space", "space.next": "Nächster Space", "space.prev": "Vorheriger Space", "space.rename": "Space umbenennen",
  "space-folders.next": "Nächster Space (Seitenleisten-Reihenfolge)", "space-folders.prev": "Vorheriger Space (Seitenleisten-Reihenfolge)",
  "pane.close": "Pane schließen", "pane.zoom": "Pane zoomen / zurück",
  "tabs-graph.panel": "Rechtes Panel ein/aus",
  "tabs-graph.calm": "Ruhige Anzeige an/aus (Spinner und Pulsen)",
  "layout.toggle:sidebar": "Seitenleiste ein/aus", "layout.switch": "Nächstes Layout",
  "mod.open:picker": "Gehe zu… (Tab, Space, Agent)", "app.palette": "Befehlspalette",
  "mod.open:marketplaces": "Marketplaces", "mod.open:mcp-servers": "MCP-Server",
  "app.settings": "Einstellungen", "app.help": "Herdrs eigene Tastenliste",
  "app.zoom_in": "Zoom größer", "app.zoom_out": "Zoom kleiner", "app.zoom_reset": "Zoom zurücksetzen",
  "app.quit": "Beenden", "app.hide": "Ausblenden", "app.hide_others": "Andere ausblenden",
  "terminal.search": "Suchen", "terminal.copy": "Kopieren", "terminal.paste": "Einfügen", "terminal.paste_image": "Bild einfügen",
};

export const GROUPS = [
  ["Auftrag und Agents", (a) => /^agent\.|^status-bar\.|^hermes\.|^mod\.open:(inbox|review|launcher)$/.test(a)],
  // Die Fabrik-Flächen der Tab-Leiste: Dashboard, Team-Hub, Board, Timeline, Fabrik-Graph, Quests.
  // Sie stehen nicht bei den Werkzeugen (Changes, Git, Tree, Blueprint, Docker) im Dialog.
  ["Fabrik", (a) => /^layout\.switch:dashboard$|^mod\.open:(board|timeline|quests|teams)$|^tabs-graph\.panel-(team|factory|inbox)$/.test(a)],
  ["Panels und Seitenleiste", (a) => /^tabs-graph\.|^layout\.toggle:sidebar$/.test(a)],
  ["Tabs", (a) => /^tab\./.test(a)],
  ["Spaces", (a) => /^space\.|^space-folders\./.test(a)],
  ["Panes", (a) => /^pane\./.test(a)],
  ["Terminal", (a) => /^terminal\.|^send:/.test(a)],
  ["App und Layouts", () => true],
];

export function actionText(action) {
  if (typeof action === "string") return action;
  try { return JSON.stringify(action); } catch { return String(action); }
}

// The command a binding runs, for grouping: object-form bindings
// ({"command": "tab.new", "args": {...}}) group by their command.
export function commandOf(action) {
  const a = actionText(action);
  if (!a.startsWith("{")) return a;
  try { return JSON.parse(a).command ?? a; } catch { return a; }
}

export function describe(raw) {
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

const MAC = { cmd: "⌘", ctrl: "⌃", control: "⌃", alt: "⌥", option: "⌥", shift: "⇧" };
const WORD = { cmd: "Ctrl+", ctrl: "Ctrl+", control: "Ctrl+", alt: "Alt+", option: "Alt+", shift: "Shift+" };
const NAMED = { left: "←", right: "→", up: "↑", down: "↓", enter: "↵", backspace: "⌫", escape: "Esc", tab: "Tab", pagedown: "PgDn", pageup: "PgUp", space: "Space" };

// `control control` is two taps of a modifier on its own, so a lone
// modifier is its symbol (⌃), never the word as a key ("CONTROL").
export function chord(k, mac) {
  const parts = k.endsWith("--") ? [...k.slice(0, -2).split("-"), "-"] : k.split("-");
  const key = parts.pop();
  if (MAC[key]) return mac ? MAC[key] : WORD[key].slice(0, -1);
  const mods = parts.map((p) => (mac ? MAC[p] : WORD[p]) ?? `${p}+`).join("");
  return mods + (NAMED[key] ?? key.toUpperCase());
}
// Two taps of ⌃ read as one run (⌃⌃); separate chords keep their space.
export const pretty = (k, mac) => {
  const taps = k.split(" ");
  return taps.every((t) => MAC[t]) ? taps.map((t) => chord(t, mac)).join(mac ? "" : " ") : taps.map((t) => chord(t, mac)).join(" ");
};

// Where a binding applies: `global` for every layout, otherwise a short label.
export const scope = (s) => (s === "global" ? "global" : s === "terminal" ? "im Terminal" : s.startsWith("layout:") ? s.slice(7) : s.replace(/^mod:/, ""));
// The one scope a row can name: only when every key of the action is bound in the
// same non-global scope. A global key alongside it wins, and two different
// non-global scopes have no single label, so both stay without a chip.
const tag = (sections) => (sections.length === 1 && scope(sections[0]) !== "global" ? scope(sections[0]) : null);

// keys() rows -> one row per action (a second key joins it). `sections` keeps
// every scope the action is bound in, so the group can tell a shared scope from
// a mixed one. Rows are in keys.json's order.
export function buildRows(bindings, mac, filter = "") {
  const byKey = new Map();
  for (const k of bindings) {
    const action = actionText(k.action);
    // ⌘1 … ⌘9 for tab.select:1..9 is one row.
    const num = /^(tab|space)\.select:(\d)$/.exec(action);
    const id = num ? `${num[1]}.select#${k.section}#${k.keys.replace(/\d$/, "")}` : action;
    const row = byKey.get(id) ?? { action, sections: [], keys: [], nums: [], desc: num ? `${num[1] === "tab" ? "Tab" : "Space"} 1–9 wählen` : describe(k.action) };
    if (!row.sections.includes(k.section)) row.sections.push(k.section);
    if (num) row.nums.push({ n: +num[2], keys: k.keys });
    else {
      const key = pretty(k.keys, mac);
      if (!row.keys.includes(key)) row.keys.push(key);
    }
    byKey.set(id, row);
  }
  for (const r of byKey.values()) {
    if (r.nums.length) {
      r.nums.sort((a, b) => a.n - b.n);
      const first = pretty(r.nums[0].keys, mac), last = pretty(r.nums.at(-1).keys, mac);
      r.keys = [r.nums.length > 1 ? `${first} … ${last}` : first];
    }
    r.tag = tag(r.sections);
  }
  const f = filter.toLowerCase();
  return [...byKey.values()].filter((r) => !f || r.desc.toLowerCase().includes(f) || r.keys.join(" ").toLowerCase().includes(f) || r.action.toLowerCase().includes(f));
}

// A group's head chip only when every row is limited to the same non-global
// scope. Otherwise each row that names a scope says it; global rows say none.
export function groupChip(rows) {
  const labels = rows.map((r) => r.tag);
  const same = rows.length > 0 && labels.every((l) => l !== null && l === labels[0]);
  return { label: same ? labels[0] : null, perRow: !same && labels.some((l) => l !== null) };
}
