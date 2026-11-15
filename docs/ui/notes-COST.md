# Kosten-Sprache: „Team offen" statt „Team gesamt"

Die Kosten-Karte im Dashboard nannte ihre zweite Zahl „Team gesamt", meinte aber nur
die Kosten **offener** Tickets plus Orchestrator (`costs().teamCost`, derselbe Wert wie
der Team-Panel-Kopf). Der Kalendertag aller Sitzungen („Heute", Helfer der
Statusleiste) kann größer sein — die Beschriftung behauptete mehr, als die Zahl zählt.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/dashboard/main.js` | Karte „Kosten": Label „Team offen", Kartentooltip nennt beide Bedeutungen |
| `docs/ui/notes-COST.md` | diese Notizen |

## Verhalten

- **Label.** `Heute` ($-Wert, Kalendertag aller omp-Sitzungen) und `Team offen`
  (`$x / $y`, Kosten offener Tickets + Orchestrator / Team-Budget). Kein „gesamt" mehr
  für eine Zahl, die nur offene Tickets zählt.
- **Tooltip der Karte (überfahren):**
  `Heute: Kalendertag aller Sitzungen · Team offen: offene Tickets + Orchestrator / Budget`.
- **Tooltips der Zeilen.** `Heute`: „Kalendertag, wie die Statusleiste: alle
  omp-Sitzungen". `Team offen`: „Kosten offener Tickets + Orchestrator / Team-Budget,
  wie der Team-Panel-Kopf".
- **Gleiche Wörter anderswo.** Team-Panel-Kopf (`mods/orchestra/hubview.js`,
  `Team $x / $y`) und Statusleiste (`mods/status-bar/main.js`, `Team $x / $y`) bleiben
  bei `Team … / …`; beide Tooltips nennen „offene Tickets + Orchestrator".
- **Screenshot.** `/tmp/ui-cost/card.png` (Test-Home, Werte manipuliert: Heute 6.72,
  Team offen 5.80 / 100).
