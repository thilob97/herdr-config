# Parallelität: atomare Ticket-IDs und eine Sperre für alle Mutatoren

Zwei `hub`-Aufrufe im selben Home überschrieben einander: `ticket new` wählte die ID vor
der Sperre und schrieb die Datei danach, und mehrere Mutatoren lasen das Ticket ohne
`hub_lock`, änderten ihre Kopie und schrieben sie zurück. Ergebnis waren ID-Kollisionen
und verlorene Felder, Kommentare und Lehren.

## Reproduktionen (Wegwerf-Home, echte Prozesse)

| Aufruf, gleichzeitig gestartet | vorher | nachher |
|---|---|---|
| 5× `hub ticket new --title "Gleich"` | 1 Ticket (letzter Schreiber gewinnt) | 5 Dateien, 5 verschiedene IDs |
| 6× `hub lesson add <repo> --from review "Lehre N"` | 2 Zeilen | 6 Zeilen |
| 4× `hub agent add Neo` | 1 Eintrag, 4× Exit 0 | 1 Eintrag, 1× Exit 0, 3× Exit 1 |
| 10× `hub ticket set <id> feld=…` (je ein anderes Feld) | Felder gingen verloren | alle 10 Felder stehen |

## Was geändert wurde

`mods/orchestra/bin/hub`:

| Stelle | Änderung |
|---|---|
| `claim_ticket()` (neu), `cmd_new` | ID wird **innerhalb** von `hub_lock` gewählt; `os.open(..., O_CREAT\|O_EXCL)` ist die Besitznahme. `FileExistsError` → nächste Nummer (`-2`, `-3`, …). Kein Pfad überschreibt eine fremde Datei, auch wenn ein alter `hub` ohne Sperre mitschreibt. |
| `write()` | Temp-Datei trägt die PID (`<id>.<pid>.tmp`): zwei Schreiber desselben Tickets können sich nicht mehr die Scratch-Datei teilen. |
| `cmd_spec`, `cmd_triage` (`--apply`) | Lesen–Ändern–Schreiben unter `hub_lock`. |
| `cmd_assign`, `cmd_link`, `cmd_watch` | dito; `link` prüft Zyklen auf demselben Stand, den es schreibt. |
| `cmd_agent_add/edit/rm` | Roster-Lesen–Ändern–Schreiben unter `hub_lock`. `--prompt` schreibt die Datei danach, außerhalb der Sperre. |
| `cmd_rebase` | `base_head` über `update_ticket` (frische Datei), `git rebase` bleibt außerhalb. |
| `cmd_verify` | `save_check()` trägt nur die Prüffelder + `## Prüfung` auf das **frisch gelesene** Ticket; die lange Suite läuft ohne Sperre. |
| `cmd_ci`, `wait_ci` | `apply_ci` schreibt über `update_ticket`; jeder Poll ist eine kurze Sperre, das Warten dazwischen nicht. `hc send`/`hc get` laufen außerhalb. |
| `cmd_night` | Der Nachtschicht-Block je gestartetem Ticket über `update_ticket`; Start und `hc run` bleiben außerhalb der Sperre. |
| `run_preflight` | Ergebnis und `## Preflight` über `update_ticket`; der Prüflauf im Wegwerf-Worktree bleibt außerhalb. |
| `add_lesson`, `cmd_lesson_propose/confirm` | `lesson_guard()`: lokale Repos unter `hub_lock`; `--on` bleibt ohne, weil eine andere Maschine von dieser Sperre nicht gesehen wird. |
| `write_lessons` (lokal) | Atomar in Python: `open` + `os.replace`, Fehler als `Lehren nicht schreibbar: …` statt Shell-Text. |
| `cmd_lesson_add` | Prüft vorher das Schreibrecht (`.herdr` bzw. Repo) und meldet `Lehren nicht schreibbar: <repo> (kein Schreibrecht für <pfad>)`. |

Bewusst **nicht** unter der Sperre: `git merge`, `git push`, `gh`, `hc run`, `hc send`,
`hc get`, `hub verify`'s Testlauf, `hub ci`'s Abfrage und jede `ssh`-Ausführung auf einer
anderen Maschine. Die Sperre deckt nur das Lesen–Ändern–Schreiben der Datei ab.

## Fehlerpfade

- `hub agent add Neo` bei vorhandenem Namen: `hub: Agent 'Neo' gibt es schon`, Exit 1.
  Parallel gewinnt genau ein Aufruf; die anderen scheitern sichtbar.
- `hub lesson add` auf einem nicht schreibbaren Repo: eine Zeile `hub: Lehren nicht
  schreibbar: …` mit Exit 1, kein Traceback.
- `hub verify`/`hub ci`/`hub rebase` schreiben ihre Felder auf den aktuellen Stand; ein
  paralleler Kommentar oder eine parallele `spec`-Ergänzung bleibt erhalten.

## Tests

`mods/orchestra/test/hub_race_test.py` startet echte `hub`-Prozesse (`subprocess`) in
einem Wegwerf-HOME; `hc` ist ein Stub auf `PATH`. Sechs Fälle: 5× `ticket new`, 6×
`lesson add`, nicht schreibbares Repo, 4× `agent add`, 10× `ticket set` auf ein Ticket,
`spec` + `assign` parallel.

```
python3 mods/orchestra/test/hub_race_test.py -v
```

## Grenzen

- Die Sperre ist pro Home (`data/orchestra/.hub.lock`) und prozessübergreifend
  (flock). Zwei Homes auf demselben Ticket-Store sind nicht serialisiert — das war
  vorher auch so und ist kein unterstützter Betrieb.
- Ein `--on`-Repo (andere Maschine) hat keine gemeinsame Sperre; dort gilt weiter
  „letzter Schreiber gewinnt". Der lokale Ticket-Schreibvorgang bleibt geschützt.
