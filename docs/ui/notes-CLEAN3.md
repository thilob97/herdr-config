# CLEAN 3 — Hub-Dispatch, Prüfrunden-Sperre, verify.sh, Remote-Timeout, toter Code

Audit vom 16.11., Branch `feat/clean3`. Alle Fehler 1–7 haben einen Regressionstest, der
gegen den Stand `4ae26ff` (HEAD vor diesem Ticket) rot war und jetzt grün ist.

## Was geändert ist

| # | Fix | Stelle | Test | Rot vor dem Fix |
|---|-----|--------|------|-----------------|
| 1 | `dispatch` schreibt `base`, `base_head`, `repo` ins Frontmatter (der Reload unter dem Lock warf die lokal berechneten Werte weg) | `mods/orchestra/bin/hub`, `cmd_dispatch` → `saved()` | `hub_features_test.py::test_dispatch_records_base_and_base_head` | `None != 'main' : die Basis steht im Frontmatter` |
| 2 | Ein neuer Prüfrunden-Start leert `review`, `review_head`, `review_at`, `review_summary`; damit ist die Runde ab Runde 2 wieder offen und ein zweiter Reviewer wird verweigert | `cmd_review_start` → `saved()` | `hub_race_test.py::test_review_round_two_is_again_locked` | dritter Start liefert `0` statt `1`, startet `t-review-3` |
| 3 | `.herdr/verify.sh` fährt alle `mods/*/test/*.test.mjs` (auch Orchestra-Regeln), `--full` zusätzlich alle `hub_*_test.py`; Node-/Python-Fehler setzen `fail=1`, die Schlusszeile ist nur bei `fail=0` „grün“; `py_compile` meldet ehrlich | `.herdr/verify.sh` | `scope.test.mjs` 9/9 (vorher 2 rot), Negativlauf mit absichtlich roter Wegwerf-Suite: `verify: rot`, exit 1 | `scope.test.mjs`: „ein dispatchter Agent steht in der Inbox seines Workspace …“, „ein unterwegs-Auftrag erscheint nur in seinem Workspace …“ |
| 3b | `scope.test.mjs` stellt die Uhr je `world()` vor (> `HOST_TICK` 25 ms), statt `ui.js` anzufassen | `mods/orchestra/test/scope.test.mjs` | dito | dito |
| 4 | Remote-Aufrufe von `verify` und `preflight` laufen mit `hc exec --timeout 600` (`REMOTE_TIMEOUT`), Hilfetext nennt es | `run()` + beide Aufrufer, Modul-Docstring | `hub_features_test.py::test_remote_verify_and_preflight_use_a_long_timeout` | kein `--timeout 600` im `hc exec`-Log |
| 5 | Ausgabezeilen mit `## ` am Zeilenanfang bekommen beim Schreiben ein Schutz-Leerzeichen; `prufung`/`preflight_section` und `verifyOf` (Quests) lesen es zurück | `body_lines`/`body_line` in `bin/hub`, `verifyOf` in `tickets.js` | `hub_features_test.py::test_a_heading_in_the_output_does_not_end_the_sections`, `tickets.test.mjs::verifyOf liest die Ausgabe trotz einer ## Zeile vollständig` | Tickettext enthält `## Kaputt` roh; `gate`-Tail leer bzw. ` ' ## Kaputt'` statt `'## Kaputt'` |
| 6 | `sandbox: repo` im Roster wirkt wie `--no-worktree` (kein Branch, kein Worktree) | `cmd_dispatch` | `hub_features_test.py::test_roster_sandbox_repo_starts_without_a_worktree` | `branch: feat/ohne-worktree` + Worktree im Frontmatter |
| 7 | `ticket new --body-file <fehlt>` nennt Pfad und Grund statt Traceback | `cmd_new` | `hub_bugs_test.py::test_missing_body_file_is_refused_without_traceback` | `Traceback … FileNotFoundError` |
| 8 | Toter Code raus: `FIELDS`, `STATUSES`, `serialize`, `setStatus` (kein Aufrufer; `git grep 'tickets\.\(STATUSES\|serialize\|setStatus\)'` leer, hubview nutzt nur `publish`) | `mods/orchestra/tickets.js` | `tickets.test.mjs` lädt das Modul weiterhin | — |
| 9 | `memory_path_repo` gelöscht (kein Aufrufer) | `mods/orchestra/bin/hub` | `git grep memory_path_repo` leer | — |

## Nachpflege bestehender Tickets

Nicht nötig: offen sind nur die Sauerteig-Tickets. Deren `base` fehlt historisch, aber sie
werden nicht neu dispatcht; ein `hub ticket set <id> base=…` ist nur nötig, wenn eines davon
`hub rebase` oder `land --merge` braucht. Am echten Home wurde nichts geschrieben.

## Prüfungen

- `sh .herdr/verify.sh --full`: exit 0, `verify: grün`; 12 ui.js-Kopien identisch,
  `py_compile` grün, 64 Node-Tests + 2 neue `tickets.test.mjs`, 8 Hub-Suiten
  (bugs 19, cleanup 8, features 18, multi 7, race 9, space 22, timeline 10, wip 9 = 102 Tests) grün.
- `python3 -m py_compile mods/orchestra/bin/hub` grün.
- `herdr-app check mods/orchestra`: `check passed`.
- Rot-Beweise: die neuen Tests wurden zusätzlich gegen `git show HEAD:mods/orchestra/bin/hub`
  (Stand vor dem Ticket) in einer Kopie unter `/tmp` gefahren — dort rot mit den oben
  genannten Meldungen, mit dem Fix grün.
