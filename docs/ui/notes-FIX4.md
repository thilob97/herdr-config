# FIX 4: doppelter review-start, Land-Meldung, `--since 0h`

Drei Befunde aus dem Live-Betrieb, jeder mit Regressionstest.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | `review-start` sperrt eine offene Runde (auch bei beendetem Terminal) und kennt `--restart`; `land --merge` trennt „noch keine CI" von der Stale-Meldung; `since_ms` lehnt ein Fenster ≤ 0 ab |
| `mods/orchestra/test/hub_race_test.py` | zwei Tests: offene Runde verweigert den zweiten Start (auch wenn das Terminal nicht mehr lebt), `--restart` beendet den laufenden Reviewer; ein Urteil erlaubt die nächste Runde |
| `mods/orchestra/test/hub_cleanup_test.py` | Land-Gate ohne `ci_head`: „noch keine CI gelaufen (hub ci ID)", kein abgeschnittenes `keinen ,` |
| `mods/orchestra/test/hub_timeline_test.py` | `--since 0h|0m|0d` endet mit Exit 1 und der erwarteten Meldung |
| `docs/ui/notes-FIX4.md` | diese Notizen |

## Verhalten

1. **`hub review-start ID`** verweigert einen zweiten Start, solange die Runde offen
   ist — also ein `review_terminal` aufgezeichnet ist und noch kein Urteil
   (`review`) vorliegt. Das gilt unabhängig davon, ob das Terminal noch lebt: ein
   sofort beendeter Reviewer (`--agent true`) hinterlässt sonst ein „finished"
   Terminal, und der zweite Aufruf startete bisher einen zweiten Agenten im selben
   Worktree `review-<id>` und überschrieb `review_terminal`. Die Meldung nennt
   Runde und Adresse und bietet `hc send` oder `--restart` an. `--restart` beendet
   den laufenden Reviewer (`hc kill`) und startet einen neuen; nach einem Urteil
   beginnt jeder weitere Start eine neue Runde, und ein noch lebendes altes
   Terminal wird beendet, bevor der neue Agent dasselbe Verzeichnis betritt.
2. **`hub land ID --merge`**: Ist `ci` gesetzt, aber kein `ci_head` aufgezeichnet,
   lautet die Verweigerung `noch keine CI gelaufen (hub ci ID)` statt der
   abgeschnittenen Zeichenkette `keinen ,`. Mit `ci_head` bleibt es bei
   `CI <zustand> gilt für <sha>, HEAD ist <sha>`; rotes CI bleibt `CI rot (<zeit>)`.
3. **`hub timeline --since`** akzeptiert nur ein positives Fenster (`1h`, `30m`,
   `7d`) oder `all`. `0h`, `0m`, `0d` und `0` enden mit Exit 1 und
   `--since erwartet 1h, 30m, 7d oder all`, statt ein 0-Minuten-Fenster und eine
   Lane „0 min" zu zeigen.
