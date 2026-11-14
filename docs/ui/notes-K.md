# Notizen K: Prüfstation (automatischer Reviewer vor dem Menschen)

Branch `feat/review-station` (Basis `main`, 69c1ac3). Ein zweiter Agent prüft nach grünem
`hub verify` den Diff; erst sein `pass`-Urteil öffnet den Übergang nach **Prüfung**.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | `review-start`, `review-verdict`, beide Gates in `gate`/`review` schreiben, `hub review` verlangt das Urteil, `## Review`, Felder, `hub status` mit `Urteil`/`Runden` |
| `mods/orchestra/tickets.js` | Review-Felder, `reviewOf` (Abschnitt `## Review`), Veröffentlichung an `orchestra.tickets` |
| `mods/orchestra/ui.js`, `mods/review/ui.js` | `reviewChip` (`Review läuft/grün/rot/rot · neuer Commit/–`), in `gateChips` für jedes Ticket außer `todo` |
| `mods/orchestra/hubview.js` | Stufe Prüfung: Zeile **Umsetzer**, eigene Chip-Zeile (umbruchfähig), Zeile **Reviewer** mit Identitäts-Chip und `Runde n` |
| `mods/review/main.js` | Zeile **Prüfstation** (Urteil, Reviewer, Runde, Zusammenfassung), **Befunde** aufklappbar, **Erneut prüfen** → `hub review-start` |
| `mods/orchestra/orchestrator.md` | Ablauf: verify → review-start → Urteil → review; fail → beheben, verify, review-start |
| `README.md` | Abschnitt **Prüfstation**, Gate-, Team- und Review-Fenster-Absätze |

## Vertrag

- Felder am Ticket: `review` (`pass`/`fail`), `review_head` (voller HEAD des Umsetzer-Worktrees),
  `review_at`, `review_summary`, `review_rounds` (jedes Urteil eine Runde), `reviewer`,
  `review_terminal`. Abschnitt `## Review` vor `## Verlauf`:
  `- <zeit> · pass|fail · Runde n · HEAD <kurz> · <reviewer>` und die Zusammenfassung.
- `hub review-start <id> [--agent …]` verweigert ohne grünen `hub verify`, ohne Branch/Basis und
  solange ein Reviewer-Terminal lebt. Standard-Reviewer ist ein anderes Programm als `agent`
  (Reihenfolge claude, codex, pi, omp). Worktree `~/.herdr/worktrees/<repo>/review-<id>`,
  `git worktree add --detach` auf dem Branch; ein erneuter Start zieht ihn mit
  `git checkout -f --detach` auf die neue Spitze.
- `hub review-verdict` verlangt eine Station (`review_terminal`) und schreibt Urteil, Runde,
  Abschnitt und einen `--from review`-Verlaufseintrag `Urteil: …`. `fail` setzt `status=doing`
  und schickt dem Umsetzer per `hc send`: „Review rot — … Befunde im Verlauf; beheben, dann
  hub verify und hub review-start.“
- `hub gate`/`hub gates` liefern `review: {verdict, ok, reason, head, review_head, at, rounds,
  summary, reviewer}`; `review.ok` gilt nur für `pass` auf dem aktuellen Worktree-HEAD. Die
  bestehenden Checks-Felder und `ok`/`reason` bedeuten weiter nur die Checks.
- `hub review` sammelt beide Gründe (` · `) und verweigert ohne `pass`-Urteil; `--force --reason`
  überfährt beide Gates und schreibt den Grund in den Verlauf.
- `hub gate <id> --json` im Wegwerf-Repo:
  `{"ok": true, "review": {"verdict": "pass", "ok": true, "review_head": "<sha>", "rounds": "3",
  "summary": "behoben", "reviewer": "true", …}}`; `hub gates` trägt dasselbe `review` je Zeile.

## Nachweise: Wegwerf-Repo

`/tmp/reviewstation-test/run.sh` (Mock-`hc` unter `/tmp/reviewstation-test/bin/hc`, Log unter
`hc.log`; kein echter Agent, kein Push). Repo mit `main` und Worktree `feat/station`, Ticket mit
`verify`-Skript `exit 0`, Umsetzer-Terminal `tIMPL`.

Ergebnis (letzter Lauf, `ALLE PRUEFUNGEN BESTANDEN`):

1. `hub verify` → `checks: pass`, `checks_head` = Branch-Spitze.
2. `review-verdict` ohne Station → Exit 1, „keine Prüfstation“; `hub review` ohne Urteil → Exit 1,
   Grund „Reviewer-Urteil“.
3. `review-start --agent true` → `review-terminal tREV`, Worktree
   `~/.herdr/worktrees/repo/review-test-prufstation` mit dem Branch-Inhalt; `gate --json`:
   `review.ok=false`, Grund nennt `hub review-start`.
4. `review-verdict pass` → `review: pass`, `## Review`, `review.ok=true`; `hub review` → `status: review`.
5. Neuer Commit: `hub review` nennt zuerst die Checks, nach erneutem `hub verify` das alte Urteil
   („Review-Urteil älter als der letzte Commit … hub review-start“).
6. `review-verdict fail` → `status: doing`, `review_rounds: 2`, `## Review` mit „Runde 2“, Verlauf
   mit `Urteil: fail (Runde 2)`, `hc send` an `tIMPL` mit „Review rot“. `hub review` danach →
   Exit 1 mit „Review rot: 3 Major offen; Befunde im Verlauf“.
7. Fix-Commit → `verify` → `review-start` → `review-verdict pass` (Runde 3) → `hub review` erlaubt.
8. `hub status` zeigt `Urteil` (`pass`) und `Runden` (`3`).

## Oberfläche

Testfenster `~/.herdr/ui-preview/feat-review-station` (eigener Core `uiprev-3220bbe5`, Demo-Welt),
`errors: []`. `docs/ui-preview.sh check orchestra` und `check review`: `check passed`.

Screenshots in `/tmp/ui-reviewstation/`:

- `01-team-review-laeuft.png`: Stufe Prüfung, Umsetzer-Zeile, Chips `Checks ✓ · 0.0s · HEAD 4eaa155`,
  `Review läuft`, `Review offen`; Reviewer-Zeile mit Identitäts-Chip (claude) und `Runde 2`.
- `02-team-review-gruen.png`: nach Ende des Reviewer-Terminals `Review grün`, Reviewer als Name.
- `03-review-fenster-urteil.png`: Review-Fenster, Zeile **Prüfstation grün** mit Reviewer, Runde,
  Zusammenfassung, **Befunde (2)** zugeklappt, **Erneut prüfen** im Kopf.
- `04-review-fenster-befunde.png`: dieselbe Zeile, **Befunde (2)** aufgeklappt (die zwei
  `review`-Kommentare).
- `05-team-review-rot.png`: `Review rot` in Team-Panel und Review-Fenster, mit Begründung im Tooltip.

Die Demo-Daten wurden nur im Test-Home ergänzt (Prüfung, Review-Felder, zwei `review`-Kommentare);
für den Ticket-Modus im Review-Fenster war dort kurz `this.ticketId = "demo-1"` gesetzt, für den
zweiten Screenshot `findingsOpen = true`. Danach `sync` (Worktree-Stand zurück), Fenster mit
`docs/ui-preview.sh down` beendet.

## Prüfbefehle

- `python3 -m py_compile mods/orchestra/bin/hub`: OK; beide neuen `--help` zeigen die Argumente.
- Spec §10 über die geänderten JS-Dateien: keine Hex-Farben, kein `toUpperCase()`, keine
  englischen Reste, keine Radien außer 4/6/8/10; Schriftgrößen nur über `T_XS`–`T_XL`.
- `docs/ui-preview.sh check orchestra|review`: `check passed`; `herdr-app status`: `errors: []`.

## Offen

- Das Urteil ist an den Worktree-HEAD gebunden, nicht an einen Inhalt: ein Rebase auf denselben
  Baum erzeugt einen neuen Commit und damit eine neue Runde. Das ist gewollt streng.
- `hub review-verdict` prüft nicht kryptografisch, wer es aufruft; die Station und die
  Ticket-Regeln (`--from review`) sind die Grenze. Ein Umsetzer könnte den Befehl selbst absetzen.
- Nach dem Ende des Reviewers zeigt der Identitäts-Chip „(beendet)“, weil `agents.identity` nur
  lebende Agents kennt; das Urteil selbst bleibt am Ticket.
- `review_rounds` ist nicht gedeckelt; sichtbar in `hub status` und im Review-Fenster. Eine
  Obergrenze wäre eine eigene Entscheidung.
- `mods/inbox/ui.js` und `mods/dashboard/ui.js` sind eigene Kopien der Bausteine und bleiben
  unverändert (Ticket-Umfang nur `mods/orchestra/**`, `mods/review/**`); ihre Gate-Chips zeigen
  weiterhin nur Checks und `Review offen`. Die Prüfstation erscheint in Team-Panel und
  Review-Fenster.
