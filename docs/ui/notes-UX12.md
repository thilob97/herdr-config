# UX 12: Kopfleiste, Shortcuts und Dashboard auf Popups vs. Sidepanel

Breite Mehrspalten-Übersichten öffnen als Popup-Fenster über der Arbeit; die
vertikalen Live-Begleiter docken im rechten Sidepanel neben dem Terminal an.
Geänderte Dateien: `layouts/elric.json`, `keys.json`, `mods/tabs-graph/main.js`,
`mods/cheatsheet/main.js`, `mods/dashboard/main.js`,
`mods/dashboard/test/peek.test.mjs`, `docs/ui/notes-UX12.md`.

## 1. Sidepanel (`layouts/elric.json`)

- `panel` ist standardmäßig **400 px** breit (vorher 368), `min` bleibt 280,
  `max` 900. Zwei schmale Spalten und der 2-spaltige Fabrik-Graph haben Luft.
- `panel-body` bekommt den Block `inbox`
  (`{ mod: "inbox", props: { panel: true } }`), direkt nach Docker.
- Die breiten Ansichten `quests`, `board` und `timeline` sind aus
  `panel-body.children` entfernt: sie leben jetzt als Popups. Im Stack bleiben
  die Werkzeuge (Changes, Git, Tree, Blueprint, Docker), `inbox`, `team`
  (Orchestra-Pipeline) und `factory` (Graph).

## 2. Tasten (`keys.json`, `mods/cheatsheet/main.js`)

| Taste | Kommando | Fläche |
|---|---|---|
| `⌘⌥8` | `mod.open:board` | Board (Popup) |
| `⌘⌥0` | `mod.open:timeline` | Timeline (Popup) |
| `⌘⌥6`, `⌃⇧Q` | `mod.open:quests` | Quests (Popup) |
| `⌘⌥9` | `mod.open:teams` | Team-Hub (Popup) |
| `⌘⌥⇧7` | `tabs-graph.panel-team` | Team-Pipeline (Sidepanel) |
| `⌘⌥7` | `tabs-graph.panel-factory` | Fabrik-Graph (Sidepanel) |
| `⌘⌥1` … `⌘⌥5` | `tabs-graph.panel-<id>` | Werkzeuge (Sidepanel) |

`⌃⇧Q` liegt global auf `mod.open:quests`; `layout:quests` behält sein lokales
`ctrl-shift-q → layout.switch:elric`. Die Fabrik-Tasten stehen in
`layout:elric`. Das Cheatsheet nennt Popup und Sidepanel in der Beschreibung
(`Board (Popup) öffnen`, `Fabrik-Graph (Sidepanel) ein/aus`, …) und sortiert
Board/Timeline/Quests/Team-Hub sowie die Fabrik-Sidepanels in die Gruppe
„Fabrik“.

## 3. Kopfleiste (`mods/tabs-graph/main.js`)

- Neues Kommando `panel-inbox` über den generischen `panel-<id>`-Pfad:
  `PANELS` enthält jetzt Team, Graph, Inbox und die fünf Werkzeuge; Klicks und
  Tasten laufen durch `togglePanel(id)`.
- Links stehen unverändert Dashboard (`⌘⇧0`), Auftrag (`⌘⇧N`), Inbox
  (`⌘⇧J`, Top-Popup mit Zähler-Badge) und Review.
- **Gruppe 1 `popups-fabrik`**: Board, Timeline, Quests, Team-Hub als
  `22×22`-Icon-Knöpfe in einer Kapsel; Klick ruft
  `run("mod.open", { name })`, Tooltip `"<Name> als Popup-Fenster öffnen (<Taste>)"`.
- **Gruppe 2 `panels-sidepanel`**: Team, Graph, Inbox, ein `1 px`-Trenner
  (`t.border`), dann Changes, Git, Tree, Blueprint, Docker. Alle in einer Leiste.
  Nur das offene Sidepanel zeigt zusätzlich seinen Namen; die übrigen bleiben
  `22×22`-Icons. Popups zeigen nie einen Namen, weil sie nie `body.active` sind.
- Der alte Kaltstart-Helfer `openPanel` (für `board.panel`/`timeline.panel` im
  Panel) ist entfallen; die Sidepanels sind geladene Layout-Blöcke.

## 4. Dashboard (`mods/dashboard/main.js`)

Der Kopf trägt jetzt `Board` und `Timeline` als Schnellzugriff. Beide rufen
`popup(name)` → `run("mod.open", { name })` und wechseln **nicht** ins Layout
elric; das Dashboard bleibt hinter dem Popup stehen. `Workspace` (`⌘⇧0`) und
`Zum Space` wechseln weiterhin bewusst nach elric.

## Tests

```text
sh .herdr/verify.sh
node --test mods/dashboard/test/*.test.mjs
```

- `verify.sh`: 12 byte-identische `ui.js`, `hub` kompiliert, 55 Node-Tests grün.
- Dashboard: 41 Tests grün. Neu in `peek.test.mjs`: der Element-Stub ist
  chainbar und merkt sich `on_click`; der Test presst `dash-board` und
  `dash-timeline` und erwartet `mod.open` mit `board`/`timeline` — ohne
  `layout.switch`.
- `herdr-app check` grün für `tabs-graph`, `cheatsheet`, `dashboard`.

## Testfenster

`docs/ui-preview.sh` mit `SHOTS=/tmp/ui-ux12`:

| Beleg | Inhalt |
|---|---|
| `1-kopfleiste-elric.png` | elric-Kopf: Popup-Kapsel (4 Icons) getrennt von der Sidepanel-Leiste (Team/Graph/Inbox · Trenner · 5 Werkzeuge) |
| `2-sidepanel-inbox.png` | Sidepanel `inbox` offen, 400 px, nur dieser Knopf trägt seinen Namen |
| `3-dashboard-popup-board.png` | Dashboard mit geöffnetem Board-Popup, kein Layout-Wechsel |

Testfenster am Ende beendet (`docs/ui-preview.sh down`), kein Push.
