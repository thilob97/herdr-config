# Notizen T: Dashboard-Umschalter, Board und Team-Hub in der Leiste

Branch `feat/nav` (Basis `main`, `9612fdd`).

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/tabs-graph/main.js` | Knopf „Dashboard" vor „Auftrag", Board/Team-Hub in der Gruppe Fabrik, Icon-Rückfall, Kommando-Routing |
| `mods/tabs-graph/board.svg`, `teams.svg` | Platzhalter-Icons, solange die Pakete Board/Team-Hub ihr `icon.svg` noch nicht mitbringen |
| `mods/status-bar/main.js` | Textlink „Dashboard" links vor Ort/Branch |
| `keys.json` | `layout:elric`: `cmd-alt-8` → `board.panel`, `cmd-alt-9` → `teams.panel` |
| `docs/ui/notes-T.md` | diese Notizen |

Nicht angefasst: `layouts/*.json` (kein Knopf dort nötig), Theme, README, `mods/cheatsheet`.

## Was der Mensch sieht

- **Umschalter:** rechts vor „Auftrag" steht ein Segment-Knopf „Dashboard" (Icon `mods/dashboard/icon.svg`,
  Höhe 26 wie die übrigen Leistenknöpfe, `background`/`border` statt Primärfarbe). Tooltip
  „Dashboard: Startbildschirm (⌘⇧0)", Klick = `layout.switch:dashboard`. Im Dashboard gibt es den
  Gegenknopf „Workspace" schon; `⌘⇧0` bleibt global belegt und im Layout `dashboard` auf `elric`.
- **Fabrik:** Quests, Team, **Board**, **Team-Hub**. Beide neuen Einträge laufen über ihr eigenes
  Kommando (`board.panel`, `teams.panel`) und zeigen bei offenem Panel ihren Namen — dieselbe
  Segmentlogik wie Quests/Team (`panel-body.active`). Tooltip nennt die Taste (`⌘⌥8`/`⌘⌥9`).
- **Platzhalter:** Fehlt `mods/board/icon.svg` bzw. `mods/teams/icon.svg`, zeichnet der Knopf
  `mods/tabs-graph/board.svg` bzw. `teams.svg`. Die Prüfung läuft einmal beim Laden
  (`readTextFile`), das Ergebnis bleibt stehen; sobald das Paket sein Icon mitbringt, gewinnt es.
- **Statusleiste:** vor Ort/Branch steht „Dashboard" als muted Textlink (Hover foreground, Tooltip
  mit `⌘⇧0`); die Breitenschätzung für die Limit-Chips rechnet die acht Zeichen mit.
- **Schmal:** bei 1150 px bleiben Dashboard, Auftrag, Inbox, Review und beide Panel-Gruppen
  vollständig sichtbar; die Gruppen zeigen wie bisher nur das offene Panel mit Namen.

## Prüfung

Testfenster `~/.herdr/ui-preview/feat-nav` (eigener Core, Demo-Welt), Fenster 1710×1010 und
1150×1010.

- `herdr-app check mods/tabs-graph` und `mods/status-bar`: `check passed`.
- `layout.switch --name dashboard` → `layout: dashboard`; `layout.switch --name elric` →
  `layout: elric`; beide `errors: []`. (Kommando-Beleg, wie im Ticket für `⌘⇧0` vorgesehen;
  `keys.json` ist unverändert global `cmd-shift-0` → `layout.switch:dashboard` und im Layout
  `dashboard` → `layout.switch:elric`.)
- `board.panel` wird im Testfenster beantwortet (`{"ok": true}`), solange die Board-Ansicht
  gerendert ist; die Panel-Gruppe zeigt dann „Board". `teams.panel` verhält sich im Testfenster
  gleich (Antwort `{"ok": true}`); der Name „Team-Hub" steht bei aktivem Panel in der Leiste.
- Belege `/tmp/ui-nav/`: `tabs-normal.png` (1710 px), `tabs-narrow.png` (1150 px), `board-open.png`,
  `teams-open.png`, `status-bar.png` (Ausschnitt der Statusleiste) und `dashboard.png` (Rückweg
  über `Workspace`).

## Offen

- Die Pakete **Board** und **Team-Hub** müssen beim Öffnen ihres Panels den Stack-Kindern die IDs
  `board` bzw. `teams` geben (`layout.select panel-body board|teams`), damit die Leiste den Namen
  zeigen kann; die Kommandos `board.panel`/`teams.panel` bringt das jeweilige Paket mit.
- Für die Screenshots der offenen Panels lief im **Test-Home** (nicht im Repo) je ein Stub-Mod
  `board`/`teams` mit Panel-Kind und Antwort auf `panel`; das Repo enthält nur die Platzhalter-Icons.
- Der Tastenkürzel-Dialog (`mods/cheatsheet`) zeigt für `board.panel`/`teams.panel` noch den
  Kommandonamen statt einer deutschen Beschreibung: seine `DESC`-Liste liegt außerhalb der Grenzen
  dieses Tickets (README: neue Mod-Kommandos dort eintragen). Die Tooltips der Leistenknöpfe nennen
  Taste und Zweck bereits.
