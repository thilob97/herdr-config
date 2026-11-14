# Notizen N: Basis-Drift (dispatch/review/rebase)

Branch `feat/base-drift` (Basis `main`). Ein Agent startet nicht mehr unbemerkt auf
einem älteren `main`: `hub dispatch` schreibt die Basis mit, `hub review` verweigert
veraltete Branches, `hub status`, Team-Panel und Review-Fenster zeigen es, und
`hub rebase` holt den Branch nach.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | `base_head` in `FIELDS`; `hub dispatch` schreibt `base`/`base_head` und legt neue Branches auf dem Basis-Commit an; `base_gate`; `hub review` verweigert bei Drift; `hub status`-Spalte `Basis`; neues `hub rebase`; `hub gate` nennt die Basis |
| `mods/orchestra/tickets.js` | `base_head` überlebt den Quests-Writeback (`FIELDS`) |
| `mods/orchestra/hubview.js` | Chip **Basis veraltet** an der Ticket-Zeile, aus `hub gates` |
| `mods/review/main.js` | Satz mit `git rebase <base>` im Review-Fenster (Ticket-Modus) |
| `README.md` | Abschnitt „Basis und Rebase“, Dispatch- und Review-Beschreibung |
| `docs/ui/notes-N.md` | diese Notizen |

## Verhalten

**Dispatch.** `base` ist der Branch des Haupt-Checkouts beim Start, `base_head` sein
Commit (`git rev-parse <base>^{commit}`, sonst `HEAD`). Ein neuer Worktree-Branch
entsteht auf `base_head`, nicht auf einem beliebigen späteren `HEAD`. `--no-worktree`
schreibt dieselben Felder (ohne Branch).

**Drift.** `base_gate` löst die aktuelle Basisspitze im Worktree auf (Fallback:
gespeichertes `base_head`, wenn der Ref fehlt) und prüft
`git merge-base --is-ancestor <tipp> HEAD`. `hub gate --json` trägt das als
`base: {base, base_head, ok, reason, tip, behind}`, `hub gates` damit auch ins
Team-Panel. `ok: null` heißt keine Basis/Branch im Ticket (kein Chip).

**Review.** `hub review` nimmt den Basis-Grund in die Gate-Meldung auf und verweigert
mit `git rebase <base>` (bzw. `hub rebase <id>`), dann erneut prüfen. `--force
--reason` überfährt weiterhin alle Gründe und schreibt sie in den `## Verlauf`.

**Status.** Die Spalte `Basis` zeigt `⚠ Basis veraltet`, `ok` oder `–` (keine
Basis/Branch). Das Team-Panel hängt bei `base.ok === false` den Chip **Basis
veraltet** an die Zeile, der Tooltip nennt Grund und `hub rebase <id>`. Das
Review-Fenster zeigt denselben Zustand als Satz mit dem Rebase-Befehl.

**Rebase.** `hub rebase <id>` verweigert ohne Worktree/Branch, bei uncommitteten
Änderungen und wenn die Basis fehlt. Ist die Basis Ancestor von `HEAD`, meldet es
„Basis aktuell“ und ändert nichts. Sonst `git rebase <base>` im Worktree; Erfolg
setzt `base_head` auf die neue Basisspitze. Ein Konflikt bricht mit Exit 1 ab, nennt
die unmerged Dateien (`git diff --name-only --diff-filter=U`) und lässt den Worktree
im Rebase stehen (kein `--abort`) — der Agent löst auf, `git add`, `git rebase
--continue` und prüft danach neu.

## Prüfung

Wegwerf-Repo (`/tmp/base-drift.*`, eigenes `HOME`/`HERDR_APP_HOME`, Fake-`hc`,
echtes Git):

- `hub dispatch drift-a`: Ticket trägt `base: main` und `base_head` gleich
  `git rev-parse main`; der neue Branch startet auf diesem Commit.
- `main` um einen Commit weiter, Branch mit eigenem Commit: `hub status` zeigt
  `⚠ Basis veraltet`, `hub gate --json` `base.ok: false` mit „1 Commit hinter main“,
  `hub review` endet 1 mit `git rebase main` in der Meldung.
- `hub rebase drift-a`: Erfolg, Branch steht auf dem neuen `main`, `base_head`
  aktualisiert, `hub gate` `base.ok: true`, `hub status` `ok`.
- Zweiter Lauf mit Konflikt in `f.txt`: Exit 1, `hub`-Meldung nennt `f.txt`,
  Worktree ist `UU f.txt` und „interactive rebase in progress“, also auflösbar.

Testfenster (`docs/ui-preview.sh up`, eigenes HOME/`HERDR_APP_HOME`, Demo-Repo;
`main` dort um einen leeren Commit vorgezogen, damit `demo-1`/`demo-2` Drift
haben):

- Team-Panel: Chip **Basis veraltet** an beiden offenen Ticket-Zeilen, Tooltip mit
  Grund und `hub rebase <id>` (`/tmp/ui-base/team-basis.png`).
- Review-Fenster (Ticket `demo-1`): Satz „Basis veraltet: im Worktree `git rebase
  main` ausführen, dann erneut prüfen (oder hub rebase demo-1).“
  (`/tmp/ui-base/review-basis.png`).
- `hub status` im Test-Home: Spalte `Basis` zeigt `⚠ Basis veraltet` für `demo-1`
  und `demo-2`, `–` für das ungestartete `demo-3`.
- `docs/ui-preview.sh check orchestra` und `check review`: `check passed`;
  Testfenster mit `docs/ui-preview.sh down` beendet, kein Push.
