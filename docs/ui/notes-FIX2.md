# Notizen FIX2: Status-Whitelist, Gedächtnis-Kürzung, Ereignis-Zuordnung, robuste Status-Ausgabe

Branch `feat/bugs2` (Basis `main`, `0685ddf`). Alle Änderungen liegen in `mods/orchestra/bin/hub`,
der Statusliste in `mods/orchestra/tickets.js` und `mods/orchestra/test/hub_bugs_test.py`.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | `STATUSES` + `check_status`; `read` liefert `None` ohne Frontmatter, `load` stirbt lesbar; `memory add` kürzt; `author_terminal` für Kommentar-/Nudge-Events; `cmd_status` überspringt defekte Dateien und kennt `--json` |
| `mods/orchestra/tickets.js` | `STATUSES` (Spiegel der hub-Liste für die Oberfläche) |
| `mods/orchestra/test/hub_bugs_test.py` | fünf neue Fälle (ungültiger Status, alle gültigen, Gedächtnis-Kürzung/60-Zeilen-Deckel, Kommentar-/Nudge-Terminal, kaputte Datei + `--json`) |
| `docs/ui/notes-FIX2.md` | diese Notizen |

## Entscheidungen

**Eine Statusliste, zwei Leser.** `STATUSES = todo, doing, review, done, blocked` steht in `hub`
und als Export in `tickets.js`. `set_status` prüft zentral, `cmd_set` meldet den Fehler mit
Ticket-ID und allen erlaubten Werten. `blocked` ist erlaubt; ein Grund wird nicht erzwungen.

**`read` wirft nicht mehr, `load` erklärt.** `read(tid)` liefert `None`, wenn der `---`-Block fehlt;
`all_tickets` filtert solche Dateien, Einzelbefehle nutzen `load` und sterben mit
`<id>: kein Ticket-Frontmatter …` statt mit `KeyError: 'title'`. Fehlt nur `title`, setzt `read`
den Dateinamen als Titel (wie `tickets.js`), damit die Anzeige nicht bricht.

**Status bleibt stabil.** `hub status` sammelt die defekten IDs einmal (`invalid_tickets`) und
schreibt genau eine Zeile `übersprungen: <n> ungültige Datei(en): <namen>` nach stderr, Exit 0.
`status --json` listet dieselben Ticketzeilen plus `{"id": …, "invalid": true}` und den `invalid`-Block.

**Gedächtnis bleibt eine Zeile.** `MEMORY_TEXT_MAX = 240`, inklusive `…`; `add_memory` kürzt vor dem
Schreiben und `cmd_memory` weist in der Ausgabe darauf hin. Der 60-Zeilen-Deckel (`MEMORY_MAX`)
bleibt unverändert.

**Ereignis-Terminal folgt dem Autor.** `author_terminal(role)` gibt für `orchestrator`
`HC_TERMINAL_ID` zurück, sonst `""`. `comment` und `nudge` nutzen das; das Ticket-Terminal nannte
den Agenten, nicht den Autor. `review` (Prüfstation gestartet) und `verdict` behalten bewusst ihr
Prüf-/Reviewer-Terminal: dort ist der Terminal das Subjekt des Ereignisses (die gestartete Lane),
kein Kommentar-Autor.

## Prüfung

- `python3 -m py_compile mods/orchestra/bin/hub` → ok
- `python3 mods/orchestra/test/hub_bugs_test.py` → 12 Tests grün
- alle `mods/orchestra/test/*.py` → 59 Tests grün
- `herdr-app check mods/orchestra` → `check passed`
