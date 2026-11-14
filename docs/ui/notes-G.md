# CI-Gate: Notizen und Nachweise

Ziel: Ein Ticket ist erst fertig, wenn die PR-Checks grün sind. Rot kommt als
Ticket-Kommentar und per `hc send` zum Agenten zurück.

## Geändert

- `mods/orchestra/bin/hub`: `hub ci <id>` (`gh pr checks`, Zustand + `ci_at` +
  `ci_url`, rote Checks mit Namen und Log-Auszug in `ci_details` und im
  `## Verlauf` unter `--from ci`), `hub land --pr --wait-ci` (30-s-Poll, 20 min;
  nur `pass` räumt auf), `hub status` mit CI-Spalte. Fehlende `gh`/Remote/
  Netzfehler enden als `ci: unknown` mit Meldung, ohne Traceback.
- `mods/orchestra/tickets.js`: CI-Felder im Frontmatter und `ci_comment` im
  veröffentlichten Ticket.
- `mods/review/main.js` + `mods/review/ui.js` (+ gleiche Kopie in
  `mods/orchestra/ui.js`): CI-Zeile im Ticket-Modus (Chip, Zeitpunkt,
  **PR öffnen**, **Erneut prüfen**), ausklappbare Fehlschläge mit Log.
- `README.md`: Abschnitt **CI**.

Das vorhandene Prüf-Gate (`hub verify`, `checks_head`, Gate-Chip) bleibt
unverändert daneben; CI ist das PR-Gate danach.

## Tests

Mock-`gh`/`hc` (Skripte unter `/tmp/hub-ci-test/`, nicht im Repo):

- `hub ci`: `pass` → `ci: pass`; `fail` → `ci: fail`, `status: doing`,
  Kommentar mit `CI rot: build` und `AssertionError`, `ci_details`-JSON,
  `hc send` mit `<id>: CI rot, siehe Kommentar`; `running` → `ci: running`;
  Netzfehler und fehlendes `gh` → `ci: unknown`; PR ohne Checks → `pass`.
- `hub land --pr --wait-ci` (Wegwerf-Repo mit lokalem Bare-`origin`):
  `running → pass` endet mit `"ci": "pass"`, Agent beendet, Worktree weg,
  Ticket `done`; `fail` endet mit `"ci": "fail"` und Meldung, Worktree und
  Agent bleiben, Ticket `doing`; Netzfehler `unknown` ebenso offen; ohne
  `origin` klare Meldung, Exit 1, kein Traceback; `--wait-ci` ohne `--pr`
  wird abgelehnt.
- `herdr-app check` (Test-Home): `mods/orchestra` und `mods/review` grün.
- `hub status` im Test-Home zeigt `CI ✗`/`CI –`.

## Screenshots (`/tmp/ui-ci/`)

- `01-review-ci-fail.png`: Review-Fenster im Ticket-Modus, CI-Zeile mit
  `CI ✗`, Zeitpunkt, **PR öffnen**, **Erneut prüfen**, darunter
  **Fehlschläge (2)** zugeklappt.
- `02-review-ci-expanded.png`: dieselbe Zeile aufgeklappt, mit `build failure`,
  `lint failure` und dem Log-Auszug.

Das Hintergrund-Testfenster nimmt keine Klicks an. Für die Aufnahmen wurde nur
die Kopie im Test-Home gepatcht (Ticket-Modus direkt auf `demo-1`, einmal
`ciOpen = true`), nie der Worktree; danach `docs/ui-preview.sh sync` hat die
Kopie zurückgesetzt. Testfenster und Test-Cores danach mit `down` beendet.
