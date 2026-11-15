# Datenfrische: sichtbarer Hinweis bei alten oder fehlenden Daten

Board, Team-Panel und Dashboard schluckten Lesefehler still (`catch {}`): nach einem
abgebrochenen `hub`-Aufruf standen minutenlang alte Zahlen ohne Hinweis. Jetzt sagt jede
Fläche, wie alt ihre Daten sind — ohne neuen Timer und ohne neue Abhängigkeit. Die
bestehenden Refreshes (Board 5/15/30 s, Team 5/15 s, Dashboard 5/10/30 s, Timeline 15 s)
stempeln je Quelle den letzten Erfolg und den ersten Fehlertext seit diesem Erfolg.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/board/main.js` | `fresh` je Quelle (Tickets, Gates, Kosten, WIP), Chip **„Daten alt"** im Kopf, Klick liest alle vier neu |
| `mods/orchestra/hubview.js` | Frische in `GateWatcher.fresh` und `HubSection.subFresh` (Tickets-Publish), Chip im Panel-Kopf inkl. Befehl im Tooltip |
| `mods/orchestra/main.js` | trägt den Chip in `ui.panelHeader(t, "Team", …)` ein |
| `mods/dashboard/main.js` | Punkt in der Kopfzeile: grün < 10 s, gelb > 30 s, rot bei Fehler; Tooltip je Quelle mit Alter und Fehler |
| `mods/timeline/main.js` | „Timeline nicht lesbar: …" ergänzt um „· zuletzt vor 2 min" |
| `docs/ui/notes-FRESH.md` | diese Notizen |

## Verhalten

- **Schwelle.** Eine Quelle gilt als alt, wenn ihr letzter Erfolg über 30 s zurückliegt
  oder seitdem ein Lesen fehlschlug. Vor dem ersten Versuch ist nichts „alt": der Hinweis
  blitzt beim ersten Bild nicht auf.
- **Board-Chip.** Kleiner Chip „Daten alt" in `warning` im Kopf; der Tooltip listet je
  betroffener Quelle „zuletzt vor 9 s" bzw. „noch kein Erfolg" und den ersten Fehlertext.
  Ein Klick stößt Tickets, Gates, Kosten und WIP sofort neu an.
- **Team-Chip.** Derselbe Chip im Panel-Kopf, gespeist aus dem Tickets-Publish (5 s) und
  `hub gates` (15 s). Der Tooltip nennt die Befehle `hub ticket list --all --json` und
  `hub gates --json`. Ein Klick liest beide sofort neu.
- **Dashboard-Punkt.** 7-px-Punkt vor „⌘⇧0 Workspace": grün, solange die Tickets jünger
  als 10 s sind; gelb über 30 s; rot, sobald eine der Quellen (Tickets, Stillstände,
  Messwerte) einen Fehler hat; blass dazwischen und vor dem ersten Erfolg. Der Tooltip
  nennt jede Quelle mit Alter und Fehlertext.
- **Timeline.** Bleibt der Fehlerhinweis stehen, ergänzt er den letzten Erfolg:
  „Timeline nicht lesbar: … · zuletzt vor 10 min".
- **Keine neuen Timer.** Die Zustände hängen an den vorhandenen Refreshes; neu gezeichnet
  wird nur, wenn sich der Frischezustand ändert (plus die bestehenden Renders).
- **Theme-Fallback.** `success`/`warning` fehlen im Standard-Theme der App; Chip und Punkt
  fallen dann auf `unknown`/`muted` zurück, statt das ganze Panel mit einem Farbfehler zu
  leeren.

## Nachweis

Test-Home `~/.herdr/ui-preview/feat-fresh` (Theme `elric`), `hub`-Binary kurz als
`bin/hub.off` umbenannt, danach zurückbenannt:

| Bild | Befund |
|---|---|
| `/tmp/ui-fresh/02-board-fresh.png` | Board ohne Chip (frisch) |
| `/tmp/ui-fresh/05-board-stale.png` | Board mit „Daten alt" nach 9 s ohne `hub` |
| `/tmp/ui-fresh/06-team-stale.png` | Team-Panel mit „Daten alt" |
| `/tmp/ui-fresh/07-dashboard-stale.png` | Dashboard-Punkt rot bei Fehler |
| `/tmp/ui-fresh/08-timeline-stale.png` | „Timeline nicht lesbar: … · zuletzt vor 10 min" |
| `/tmp/ui-fresh/09-dashboard-fresh.png` | Dashboard-Punkt grün nach dem Zurückbenennen |
| `/tmp/ui-fresh/10-timeline-fresh.png` | Timeline wieder mit Lanes |
| `/tmp/ui-fresh/11-board-healed.png`, `12-team-healed.png` | Chips beim nächsten Refresh verschwunden |

`herdr-app check` grün für `board`, `orchestra`, `dashboard`, `timeline`;
`herdr-app status` im Test-Fenster: `errors: []`.
