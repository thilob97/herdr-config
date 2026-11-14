# Notizen F: Prüf-Gate (hub verify, Nachweise am Ticket)

Branch `feat/verify-gate` (Basis `main`). Ziel: kein Ticket erreicht **Prüfung**, ohne
dass die Prüfung des Repos gelaufen ist. Vorher schrieb der Agent `--checks pass`
selbst; jetzt führt `hub` den Befehl aus und nur dieser Lauf öffnet das Gate.

## Befehle

| Befehl | Wirkung |
|---|---|
| `hub verify <id> [--or-command CMD]` | führt `<worktree>/.herdr/verify.sh` mit `sh` im Worktree aus, auf der Maschine des Tickets; sonst den Befehl `--or-command`, das Ticket-Feld `verify`; schreibt `checks`, `checks_head`, `checks_at`, `checks_duration`, `checks_exit`, `checks_cmd` und `## Prüfung` (Kopfzeile + letzte 20 Zeilen) |
| `hub gate <id> [--json]` | `ok` nur bei `checks: pass` **und** `checks_head` = `git rev-parse HEAD` im Worktree; sonst `reason` |
| `hub gates [--json]` | dasselbe für alle offenen Tickets, ohne Auszug (für das Panel) |
| `hub review <id> --summary … --evidence …` | wie bisher, aber mit Gate; `--checks` entfällt |
| `hub review … --force --reason "…"` | überfährt das Gate, schreibt `Gate überfahren (…): <grund>` in den `## Verlauf`; `--reason` ist Pflicht |

`hub ticket new` legt im Zielrepo weiterhin nichts an. Fehlt `.herdr/verify.sh` und ein
`verify`-Feld, endet `hub verify` mit Pfad und Hinweis (Exit 1); ein protokollierter Lauf
endet mit 0, auch wenn er `fail` ist — das Ergebnis steht im Ticket.

## Ticket-Format

Frontmatter wie bisher, neu: `checks_head`, `checks_at`, `checks_duration`, `checks_exit`,
`checks_cmd`, `verify` (Ersatzbefehl). Im Body, zwischen Zusammenfassung und Verlauf:

````md
## Prüfung
- 2026-11-14 22:37 · pass · 1.7 s · exit 0 · HEAD 0c09a1c · .herdr/verify.sh

```text
herdr-app check mods/orchestra
check passed: mods/orchestra
```
````

`tickets.js` parst den Abschnitt (`verifyOf`) und `published()` trägt `verify`
(`meta`, `tail`) in `orchestra.tickets`; `summaryOf` endet jetzt an der nächsten
`##`-Sektion, sonst hinge der Prüf-Auszug an der Zusammenfassung.

## Oberfläche

- **Gate-Chip** (`ui.gateChips`, identisch in `mods/orchestra/ui.js` und
  `mods/review/ui.js`): `Checks ✓ · 1.7s · HEAD 0c09a1c`; rot `Checks ✗ · nicht geprüft`
  bzw. `Exit 1` bzw. `neuer Commit`, der Tooltip nennt den vollen Grund.
- **Team-Panel** holt die Gates alle 15 s mit `hub gates` (`GateWatcher`, geteilt mit dem
  Daemon) nach `shared("orchestra.gates")`; nur so wird ein grüner Chip nach einem
  weiteren Commit rot.
- **Review-Fenster** fragt `hub gate <id> --json` bei jedem Refresh und zeigt über den
  Nachweisen die Zeile **Prüfung**: Zustand/Grund, **Letzte Zeilen** (Auszug,
  aufklappbar) und **Prüfung erneut ausführen** (`hub verify <id>`, 900 s Zeitlimit).
- Inbox und Launcher haben eigene, ältere Kopien von `gateChips` (nur ✓/✗/–); sie liegen
  außerhalb des Pakets und bleiben unverändert.

## Selbsttest

Wegwerf-Home (`HERDR_APP_HOME=$(mktemp -d)`) und Wegwerf-Repo, kein Agent, kein Push:

- Exit 0 → `checks: pass`, `checks_head` = Worktree-HEAD, `## Prüfung` mit Auszug;
  `hub gate --json` frei.
- `hub review` mit grünem Lauf → `status: review`; `## Prüfung` überlebt den Umbau der
  Zusammenfassung.
- Neuer Commit → `gate` gesperrt, `hub review` Exit 1 mit „älter als der letzte Commit“
  und `hub verify` in der Meldung.
- Exit 3 → `checks: fail`, `checks_exit: 3`, Auszug; `review` verweigert („Checks rot“).
- `--force` ohne `--reason` → Exit 1; mit Grund → Übergang und Eintrag im `## Verlauf`.
- Skript entfernt → Exit 1, Meldung nennt `<repo>/.herdr/verify.sh`.

Sichtprüfung im Test-Fenster (`docs/ui-preview.sh up`, Demo-Ticket `demo-1`):
`/tmp/ui-verify/team.png` (grüner Chip), `/tmp/ui-verify/review.png` (Gate-Zeile,
aufgeklappte letzte Zeilen), `/tmp/ui-verify/team-veraltet.png` und
`/tmp/ui-verify/review-stale.png` (neuer Commit: rot „neuer Commit“). Danach
`docs/ui-preview.sh down`.

## Grenzen

Quests' `store.js` kennt die neuen Frontmatter-Felder nicht und ließe sie beim Bearbeiten
fallen; Gate und Chip lesen sie deshalb ersatzweise aus der Kopfzeile von `## Prüfung`
(der Body bleibt erhalten).

`hub review` prüft nur den Übergang nach **Prüfung**. Ein Commit *nach* dem Review macht
den Chip rot, blockt aber `hub land` nicht — das Fenster zeigt es, die Abnahme bleibt eine
Mensch-Entscheidung.
