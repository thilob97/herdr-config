# Ruhige Anzeige: Animationen standardmäßig aus, ⌘⇧A schaltet

Ein arbeitender Agent ließ das Fenster dauerhaft neu zeichnen: `spin(900)` und
`loop("opacity")` in Statusanzeigen kosteten im Layout `elric` mit Seitenleiste
32–34 % CPU, ohne Seitenleiste 23 %, im Dashboard 11 % (top, 3 Läufe). Die Anzeige ist
jetzt standardmäßig ruhig: gleiche Marken in gleicher Größe, aber ohne Spinner und
Puls. `⌘⇧A` (`tabs-graph.calm`) schaltet die Animationen wieder ein.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/ui.js` | Master: `calm()` (`shared("ui.calm") ?? true`), `statusIcon()` und `loading()` statisch bei `calm` |
| `mods/*/ui.js` | identische Kopien (11 Dateien, gleiche `md5`) |
| `mods/agent-cards/main.js` | `statusMark`, Karten-Avatar (`loop("top")`, `loop("opacity")`), „läuft …"-Spinner |
| `mods/timeline/main.js` | pulsierender Live-Rand der Balken |
| `mods/status-bar/main.js` | `dot()`-Puls, „lädt …"-Spinner in Limits |
| `mods/tabs-graph/main.js` | `statusMark`, Kommando `calm` samt Notify |
| `mods/space-folders/main.js` | Spinner am gefalteten Ordner |
| `mods/orchestra/hubview.js`, `mods/board/card.js` | Spinner an laufenden Gate-Symbolen |
| `mods/sidebar-footer/main.js` | Punkt „Ruhige Anzeige" im Fußmenü mit Häkchen |
| `mods/cheatsheet/main.js` | `DESC`-Eintrag „Ruhige Anzeige an/aus …" |
| `keys.json` | global `cmd-shift-a` → `tabs-graph.calm` |
| `docs/ui/notes-CALM.md` | diese Notizen |

## Verhalten

- **Ruhig (Standard).** `shared("ui.calm")` fehlt oder ist `true`: arbeitet = gefüllter
  Punkt in `working`, wartet = Ring in `blocked`, fertig = Punkt, ruhig = hohler Punkt,
  Fehler = Punkt in `blocked`; alle Marken in der 12×12-Box mit 7 px Kern wie bisher.
  `loading()` und die Listen-Spinner stehen als „…" in `dim` statt als Spinner.
  Karten-Avatare stehen still, Live-Balken der Timeline haben keinen Puls, laufende
  Gates drehen nicht, der busy-Hinweis in der Auswahlleiste ist „… läuft …".
- **Animiert (`ui.calm === false`).** Unverändertes Verhalten von heute: Spinner
  900 ms, Puls 900 ms, Avatar-Bob 700 ms, Live-Rand 1400 ms.
- **Schalter.** `tabs-graph.calm` (⌘⇧A) schreibt den umgekehrten Wert nach
  `shared("ui.calm")` und zeigt „Ruhige Anzeige an/aus" als Toast. Der
  Tastenkürzel-Dialog führt die Taste unter „Panels und Seitenleiste"; das Fußmenü
  der Seitenleiste („…" bzw. die Knopfreihe) hat „Ruhige Anzeige" mit Häkchen,
  wenn sie an ist.

## Messung

`top -l 2 -stats pid,cpu` gegen das Testfenster (`docs/ui-preview.sh up`, Demo-Welt mit
arbeitenden Agents, Layout `elric`, Seitenleiste offen), je Zustand drei Läufe. Das
Fenster liegt wie beim Vorschau-Verfahren üblich knapp unter dem Bildschirmrand; ein
Streifen bleibt sichtbar, damit macOS weiter zeichnet.

| Lauf | `ui.calm = false` | `ui.calm` fehlt / `true` |
|---|---|---|
| 1 | 24,4 % | 3,2 % |
| 2 | 24,5 % | 3,3 % |
| 3 | 23,9 % | 2,8 % |
| **Mittel** | **24,3 %** | **3,1 %** |

Zweite Runde nach dem Umschalten im selben Fenster: `false` 23,3 / 23,4 / 24,9 %
(23,9 %), `true` 3,5 / 4,0 / 3,1 % (3,5 %); mit fehlendem `ui.calm` nach einem Neustart
5,3 / 5,7 / 4,2 % (5,1 %). Differenz 18,8 bis 21,2 Prozentpunkte, Ziel waren 6.

## Prüfung

- `herdr-app check` im Test-Home für alle 11 `ui.js`-Mods plus `agent-cards`, `board`,
  `cheatsheet`, `sidebar-footer`, `space-folders`, `status-bar`, `tabs-graph`,
  `timeline`: `check passed`.
- `herdr-app status` im Testfenster: `errors: []`, Layout `elric`.
- `md5 mods/*/ui.js`: alle gleich.
- `shared("ui.calm")` fehlte nach frischem Test-Home: Anzeige ruhig (Screenshot
  `default-calm.png`), ⌘⇧A-Notify und Umschalten belegt (`calm-off.png`, `calm-on.png`).
- Testfenster mit `docs/ui-preview.sh down` beendet; kein Push. Belege unter
  `/tmp/ui-calm/`.

## Grenzen

- Die Messung entstand am verdeckten Testfenster, nicht am sichtbaren Live-Fenster;
  die Richtung und Größenordnung decken sich mit der Ausgangsmessung (32–34 %).
- `mods/board/ui.js` trug seit UX 4 eine eigene Identitätsregel (kein Adress-Chip,
  `identityChip` kann `null` liefern). Für die byte-identischen Kopien gilt wieder der
  Master `mods/orchestra/ui.js`; die Board-Karte behält ihre Regel in `card.js`
  (`whoChip` fragt `ui.identity` und ruft `identityChip` nur mit veröffentlichtem
  Namen auf).
- Animationen außerhalb der Ticket-Grenzen (`blueprint`, `docker`, `filetree`,
  `marketplaces`, `mcp-servers`, `quests`) folgen `ui.calm` noch nicht; sie liefen in
  der Messung nicht mit.
