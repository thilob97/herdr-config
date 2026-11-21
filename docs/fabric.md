# Fabric — Vertrag

Verbindliche Schnittstelle zwischen dem CLI `fab`, den Agent-Prompts und dem Mod `fabric`.
Konzept: `docs/concept.md`. Wer davon abweicht, ändert zuerst diese Datei.

## 1. Orte

| Was | Pfad | Git |
|---|---|---|
| CLI | `fabric/fab` (ausführbar, Python 3, nur stdlib), Module in `fabric/fablib/` | getrackt |
| CLI-Tests | `fabric/tests/test_*.py` — `python3 -m unittest discover -s fabric/tests -t .` | getrackt |
| Roster | `fabric/roster.json` | getrackt |
| Prompts | `fabric/prompts/{orchestrator,preamble,<agent>}.md` | getrackt |
| Mod | `mods/fabric/` (ein Mod, mehrere Ansichten) | getrackt |
| Mod-Tests | `mods/fabric/test/*.test.mjs` — `node --test mods/fabric/test/` | getrackt |
| Layout | `layouts/fabric.json` | getrackt |
| Daten | `$FAB_HOME`, Standard `~/.config/herdr-app/data/fabric/` | ignoriert |
| Worktrees | `~/.herdr/worktrees/<repo-basename>/<branch-slug>` | — |
| Vorschau-Home | `/tmp/fab-preview/<ID>/` (Home, User-Home, FAB_HOME; eigener Core `fabp-<id>`) | — |
| Orchestrator-Arbeitsordner | `~/.herdr/fabric-orchestrator/` (bekommt `AGENTS.md` aus `fabric/prompts/orchestrator.md` bei jedem Start) | — |
| launchd-Agent `fab tick` (optional) | `~/Library/LaunchAgents/de.herdr.fabric.tick.plist`, nur per `fab tick --install` | — |

`fab` findet seinen Code über den eigenen Pfad (Symlink `~/.local/bin/fab` → `fabric/fab` ist erlaubt). Der Mod ruft immer den absoluten Pfad `${appHome()}/fabric/fab` auf.

## 2. Daten (`$FAB_HOME`)

```
fabric.db            SQLite (WAL): tickets, comments, sessions, events, counter, attachments, meta
fabric.db-wal/-shm   SQLite-Begleitdateien im WAL-Modus
tickets/T-<n>.json   Lesemodell je Ticket, nach jeder Änderung aus der DB erzeugt
index.json           Lesemodell für den Mod, nach JEDER Änderung atomar neu geschrieben (tmp + rename)
attachments/<ID>/    Bilddateien; die Tabelle `attachments` hält nur den Verweis
backups/             Sicherungen (`fab backup` und täglich automatisch, höchstens 14)
legacy/              abgelegte Altdateien nach erfolgreicher Migration (nicht löschen)
lock                 flock für Schreibvorgänge und die einmalige Migration
```

Die gesamte Datenhaltung läuft über die schmale Schnittstelle in `fabric/fablib/store.py`; kein anderes Modul öffnet `fabric.db` oder die Dateien unter `data/fabric/` selbst. Ausnahme ist die Erzeugung der Lesemodelle `index.json` und `tickets/<ID>.json`.

- **Eine Änderung = eine Transaktion.** Ticket, Ereignis und Zähler werden gemeinsam festgeschrieben oder gar nicht; ein abgebrochener Schreibvorgang hinterlässt keinen halben Zustand.
- **Lesemodelle aus der DB.** Nach dem Commit schreibt `fab` die betroffenen `tickets/<ID>.json` und `index.json` neu. Der Mod und die Seitenleiste lesen weiterhin nur diese Dateien und bleiben unverändert.
- **Migration.** Fehlt `fabric.db` und liegen Altdateien (`tickets/*.json`, `counter`, `events.jsonl`) vor, überführt der erste Aufruf sie automatisch; `fab migrate` macht dasselbe ausdrücklich. Der Bericht vergleicht Tickets, Kommentare, Sessions, Ereignisse, Anhänge und Zähler in Alt und Neu. Bei Abweichung bleibt die DB aus, die Altdateien bleiben unberührt, und `fab` arbeitet weiter auf ihnen, bis die Migration gelingt. Nach Erfolg wandern die Altdateien nach `legacy/`.
- **Sicherung.** Beim ersten Schreibzugriff eines Tages und über `fab tick` entsteht eine konsistente sqlite-Backup-Kopie in `backups/`; `fab backup` erzwingt eine. Die letzten 14 bleiben.
- **IDs** kommen aus der Tabelle `counter`, nie aus dem Dateinamen-Maximum: `T-1`, `T-2`, …

### Ticket `tickets/T-<n>.json`

```json
{
  "id": "T-1",
  "title": "Kurzer Titel",
  "status": "draft",
  "body": "Markdown. Nach dem Ausformulieren: ## Ziel, ## Kontext, ## Abnahmekriterien (- [ ] …), ## Grenzen",
  "repo": "/abs/pfad/zum/checkout",
  "base": "main",
  "branch": "fab/T-1-kurzer-titel",
  "worktree": "/Users/…/.herdr/worktrees/repo/fab-T-1-kurzer-titel",
  "assignee": "zap",
  "blocked_by": [],
  "waiting": ["mensch"],
  "created_at": 1790000000000,
  "updated_at": 1790000000000,
  "created_by": "mensch",
  "comments": [
    {"n": 1, "at": 1790000000000, "author": "zap", "text": "… @ada bitte prüfen", "mentions": ["ada"]}
  ],
  "sessions": [
    {"agent": "zap", "terminal": "t9a", "name": "fab-zap-t-1", "started_at": 1790000000000}
  ],
  "checks": {"state": "pass", "head": "<sha>", "at": 1790000000000, "tail": "letzte 20 Zeilen"},
  "verdict": {"state": "pass", "by": "ada", "head": "<sha>", "at": 1790000000000, "summary": "…"},
  "attachments": [
    {"name": "bild.png", "path": "data/fabric/attachments/T-1/bild.png", "at": 1790000000000}
  ],
  "stall": {
    "rule": "doing", "since": 1790000000000, "attempts": 1,
    "last_attempt": 1790000000000, "attention": false,
    "reason": "keine Session, letzter Eintrag von zap", "agent": "zap"
  }
}
```

- `status`: `draft` → `todo` → `doing` → `review` → `done`; daneben `dropped`. Zeiten in Epoch-Millisekunden.
- Felder ohne Wert: `null` bzw. `[]`. Kein Feld fehlt. Unbekannte Felder bleiben beim Schreiben erhalten.
- `checks`/`verdict` gelten nur, solange `head` dem aktuellen HEAD des Worktrees entspricht.
- `attachments`: nur Bilder (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`), abgelegt von `fab attach` unter `data/fabric/attachments/<ID>/`. `path` ist relativ zur App-Wurzel (`~/.config/herdr-app`), damit der Mod ihn als Bild laden kann; im Body und in Kommentaren steht derselbe Pfad als Markdown-Bildlink `![name](path)`.
- `stall`: nur von `fab tick` geschrieben, optional. `rule` ∈ `doing mention review todo blocked`, `since` = Beginn des Stillstands, `attempts` = bisherige Weck-/Startversuche, `attention` = nach zwei erfolglosen Versuchen oder Regel 5, `reason` einzeilig ohne „stockt seit“, `agent` = zu weckender Agent oder `orchestrator`. Ein Kommentar im Ticket, jede zugestellte manuelle Weckung und jeder Statuswechsel entfernen `stall`; `fab tick` entfernt ihn, sobald die Bedingung wegfällt. `draft`, `review`, `done` und `dropped` werden von `fab tick` weder gelesen noch verändert.

### Ereignis (Zeile in `events`)

```json
{"at": 1790000000000, "kind": "comment", "ticket": "T-1", "actor": "zap", "target": "ada", "text": "…"}
```

`kind` ∈ `created edited status assigned comment wake dispatch verify verdict handover accept reject drop orchestrator config tick pr`.
`target` nur bei `wake` (wer geweckt wird), `assigned` (wem), `dispatch` (welcher Agent) und `tick` (welcher Agent); sonst `""`.
Bei `wake` steht in `text` genau eines von: `geweckt`, `gestartet`, `an orchestrator`, `unterdrückt: <grund>`.
Bei `tick` steht in `text` eines von: `geweckt`, `gestartet`, `an orchestrator`, `attention`, `gelöst`; `reason` nennt Regel und Grund, z. B. `Regel 1 (doing): keine Session seit 12 min`.

### Lesemodell `index.json`

```json
{
  "version": 1,
  "generated_at": 1790000000000,
  "tickets": [
    {"id": "T-1", "title": "…", "status": "doing", "assignee": "zap", "repo": "…", "branch": "…",
     "updated_at": 0, "comment_count": 3, "waiting": [], "blocked_by": [],
     "checks": "pass", "verdict": null,
     "last_comment": {"author": "zap", "at": 0, "text": "…", "mentions": ["ada"]},
     "sessions": [{"agent": "zap", "name": "fab-zap-t-1", "terminal": "t9a"}],
     "stall": {"rule": "doing", "since": 0, "attempts": 2, "attention": true, "reason": "…"}}
  ],
  "inbox": [
    {"kind": "question", "ticket": "T-1", "at": 0, "from": "zap", "text": "…"},
    {"kind": "review", "ticket": "T-2", "at": 0, "from": "zap", "text": "Zusammenfassung"},
    {"kind": "attention", "ticket": "T-3", "at": 0, "from": "fab",
     "text": "stockt seit 12 min – Regel 1 (doing): …", "agent": "zap",
     "reason": "Regel 1 (doing): …", "since": 0}
  ],
  "roster": [{"name": "zap", "role": "umsetzer", "color": "c1", "program": "omp",
              "model": "…", "teams": ["herdr-app"]}],
  "teams": [{"name": "herdr-app", "reviewer": "ada", "max_sessions": 10,
             "orchestrator": {"argv": ["omp"], "prompt": "prompts/orchestrator.md"}}],
  "events": [ "die letzten 300 Ereignisse, älteste zuerst" ]
}
```

- `inbox` wird **nur** in `fab` berechnet: `question` = Ticket nicht done, `mensch` in `waiting`; `review` = Status `review`; `attention` = Wecken unterdrückt durch Ping-Pong-Bremse oder Start fehlgeschlagen, solange danach nichts Neues im Ticket passiert ist. Hat ein `todo`/`doing`-Ticket `stall.attention`, gilt genau **ein** `attention`-Eintrag aus dem Stillstand (`stockt seit …`, Grund und `agent` für „Erneut versuchen“); der aus `wake` abgeleitete Eintrag entfällt dann.
- Pro Ticket höchstens **ein** Eintrag aus `question` und `review`: Steht das Ticket auf `review`, gilt nur `review`, `question` entfällt (auch wenn `mensch` in `waiting` steht). `attention` darf daneben stehen.
- Der Mod zählt nichts selbst: Inbox-Zahl = `inbox.length`, Stufen = Tickets nach `status`.
- `index.json` bleibt unter 1 MiB: Ticket-Einträge ohne `body` und ohne `comments`, höchstens 300 Ereignisse.

## 3. CLI

Alle schreibenden Befehle laufen in genau einer Transaktion, hängen Ereignisse an und erzeugen danach die Lesemodelle (`index.json`, betroffene `tickets/<ID>.json`) neu. Fehler: Exit-Code ≠ 0, deutsche Meldung auf stderr. `--json` liefert maschinenlesbare Ausgabe, wo angegeben.

| Befehl | Wirkung |
|---|---|
| `fab new "<satz>" [--repo PFAD] [--from NAME]` | Ticket `draft`, Titel = Satz (max. 80 Zeichen), Body `## Auftrag\n<satz>`. `--repo` Standard: Git-Wurzel des aktuellen Ordners, sonst `null`. Danach automatisch Kommentar von `--from` (Standard `mensch`): `@orchestrator bitte ausformulieren und verteilen` → weckt den Orchestrator. Gibt die ID aus. |
| `fab list [--status S] [--json]` / `fab show ID [--json]` | lesen |
| `fab edit ID [--title T] [--body T \| --body-file F] [--repo PFAD] [--base B] --from NAME` | ändern |
| `fab status ID STATUS --from NAME` | Statuswechsel. `done` nur über `accept`. |
| `fab assign ID NAME --from NAME` | Zuständigen auf ein Mitglied des Teams setzen, zu dem das Ticket-Repo gehört; ein Nicht-Mitglied wird mit Team und Mitgliederliste abgelehnt |
| `fab link ID --blocked-by ID… --from NAME` | Abhängigkeiten, ohne Zyklen. `--remove ID…` entfernt sie; fällt die letzte weg, startet `fab` das Ticket wie nach einer Abnahme (Abschnitt `fab accept`). |
| `fab comment ID --from NAME [--no-wake] "<text>"` | Kommentar; jede `@erwähnung` weckt (Abschnitt 4). Gibt pro genanntem Namen eine Zeile mit dem Ergebnis aus. |
| `fab attach ID DATEI [--no-edit] [--from NAME]` | Bild als Anhang: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` (Groß/klein egal). Kopiert nach `data/fabric/attachments/<ID>/<name>` (Name aus der Datei, bereinigt; gleicher Inhalt wird wiederverwendet, sonst `-2`, `-3`, …). Gibt die Zeile `![<name>](data/fabric/attachments/<ID>/<name>)` aus, hängt den Anhang an `attachments` und standardmäßig den Link an den Body; `--no-edit` lässt den Body unverändert. Akteur: `--from`, Standard `mensch`. |
| `fab diff ID [--json] [--file PFAD]` | Änderungen vor der Abnahme: Dateien mit `+`/`−` (`git diff --numstat base...branch`), Commits (`git log base..branch`), HEAD sowie Nachweise aus Ticket-Anhängen und im Handover genannten Dateien/Screenshots. `--json` liefert `{id, base, branch, head, merge_base, files, commits, proofs}`; `--file` den Text-Diff einer Datei (mit `--json` als `{path, diff}`). |
| `fab preview start\|shot\|stop ID` | Eigene Vorschau-Instanz je Ticket-Worktree unter `/tmp/fab-preview/<ID>/`. `start` kopiert `settings.json`, `keys.json`, `layouts/`, `mods/` und die CLI aus dem Ticket-Worktree (nie `data`) nach `/tmp/fab-preview/<ID>/home`, nutzt ein privates `HOME` und `HC_SESSION` `fabp-<id>`, legt ein Demo-Ticket an (nie echte Ticketdaten) und startet ein eigenes Herdr-Fenster mit eigenem Core. `shot` speichert dort ein PNG und hängt es nach denselben Regeln wie `fab attach` an (Feld `attachments`, Link im Body); Akteur: `--from`, sonst `assignee`, sonst `mensch`. `stop` beendet App und Core und entfernt `/tmp/fab-preview/<ID>`. |
| `fab dispatch ID [--agent NAME] --from NAME` | Verlangt `repo`, einen Abschnitt `## Abnahmekriterien` und keine offenen `blocked_by`. Legt Branch `fab/<ID>-<slug>` vom aktuellen HEAD des Repos und den Worktree an, startet den Agenten (Abschnitt 5), Status `doing`. Läuft er schon für das Ticket: wecken statt starten. |
| `fab verify ID [--from NAME]` | Führt `<worktree>/.fabric/verify.sh` aus (fehlt sie: Fehler mit Pfad), `sh` im Worktree, Timeout 10 min. Schreibt `checks` auf den HEAD. Akteur des `verify`-Ereignisses ist `--from`, Standard: `assignee`. |
| `fab verdict ID pass\|fail --from NAME "<zusammenfassung>"` | Urteil des Prüfers auf den HEAD. `fail`: Kommentar mit Zusammenfassung, Status `doing`, entfernt `mensch` aus `waiting` (keine Inbox-Frage), weckt `assignee`. `pass`: weckt `assignee` mit dem Hinweis, auf grünen Checks mit `fab handover` zu übergeben. Ist der Prüfer selbst der `assignee`, wird weder bei `pass` noch bei `fail` jemand geweckt. |
| `fab handover ID --from NAME "<zusammenfassung>"` | Übergabe an den Menschen. Gate: `checks.state == pass` und `verdict.state == pass`, beide auf dem aktuellen HEAD. Sonst Abbruch mit den Gründen. Zusätzlich Abbruch, wenn der Diff `base...branch` Logikdateien ändert, aber keine Testdatei; die Meldung nennt die Logikdateien und die aktiven Testmuster. Standardmuster: `fabric/fablib/**/*.py` und `mods/*/**/*.js` (ohne `mods/*/views/**`) für Logik, `fabric/tests/test_*.py` und `mods/*/test/**` für Tests; je Repo über `.fabric/testpolicy.json` übersteuerbar (Abschnitt „Test-Policy“). Erfolg: Status `review`, `mensch` in `waiting`, Kommentar. |
| `fab accept ID [--pr-only]` | Nur der Mensch. Ist `origin` ein GitHub-Remote und `gh auth status` erfolgreich, läuft die Abnahme über einen Pull Request: `base` und Branch werden gepusht (`base` nur, wenn `origin/<base>` fehlt oder vom lokalen Stand abweicht; ist `<base>` nicht fast-forward-fähig zu `origin/<base>`, bricht `fab` vor jedem Push ab und sagt „nichts gepusht“), der PR wird angelegt oder gefunden und seine URL in Feld `pr` (`{"url": …, "state": "open"}`), als Kommentar `PR geöffnet: <url>` und als `pr`-Ereignis gespeichert. `--pr-only` endet hier: Status bleibt `review`, Worktree und Branch bleiben. Ohne `--pr-only` wird der PR gemergt; danach folgen `git fetch`, Löschen des Remote-Branchs und `git merge --ff-only origin/<base>` im Haupt-Checkout. Erst dann beendet `fab` alle Sessions des Tickets, entfernt Worktree und Branch, setzt Status `done`, Feld `pr` auf `{"url": …, "state": "merged"}`, schreibt den Kommentar `PR gemergt: <url>` und das `accept`-Ereignis mit URL. Scheitert der Merge oder das Aufräumen danach, bleibt der Status `review`, Kommentar und `pr`-Ereignis nennen Grund und URL, Exit 1; ein erneutes `fab accept` versucht es erneut (ein bereits gemergter PR gilt als Erfolg). Ohne GitHub-Remote oder ohne gh-Anmeldung wird wie bisher lokal mit `--no-ff` gemergt; `--pr-only` bricht dann mit Erklärung ab. Die bisherigen Prüfungen (Status `review`, keine offenen Unter-Tickets, Felder, Basis ausgecheckt, keine Datei-Überschneidung) gelten für beide Wege. Danach startet `fab` automatisch jedes Ticket, das nur noch durch dieses blockiert war und startbereit ist (`todo`, Zuständiger, Repo, Abnahmekriterien) — mit denselben Regeln wie `fab dispatch`. Entwürfe und unvollständige Tickets bleiben liegen; Grund und Startfehler stehen als `dispatch`-Ereignis im Verlauf, die Abnahme bleibt gültig. Nach dem Merge läuft `herdr-app check` für jedes Verzeichnis `mods/*` im Haupt-Checkout. Ist ein Check rot, macht `fab` den Merge rückgängig (lokal: `git reset --keep` auf den Stand vor dem Merge; PR-Weg: Revert-Commit, gepusht nach `<base>`), lässt den Status `review`, behält Worktree und Branch (auf dem PR-Weg auch den Remote-Branch) und schreibt einen `attention`-Eintrag in die Inbox (`Merge zurückgesetzt: …`) mit der Check-Ausgabe. |
| `fab reject ID "<feedback>"` | Nur der Mensch. Kommentar von `mensch`, Status `doing`, weckt `assignee`. |
| `fab drop ID --from NAME "<grund>"` | Status `dropped`, Sessions beenden, Worktree bleibt. |
| `fab wake ID NAME --from NAME ["<text>"]` | Wecken von Hand, gleiche Regeln wie bei Erwähnungen |
| `fab tick [--dry-run] [--install\|--uninstall]` | Stillstandswächter (Abschnitt 4b). Ohne Optionen ein Lauf: wecken/starten oder `attention`, sonst nichts. `--dry-run` zeigt nur die geplanten Aktionen. `--install` legt den launchd-Agent `~/Library/LaunchAgents/de.herdr.fabric.tick.plist` (Intervall 60 s) an, `--uninstall` entfernt ihn. Kein `--from`. |
| `fab orchestrator start\|stop\|status [TEAM]` | Orchestrator-Terminal je Team verwalten (Abschnitt 5) |
| `fab agents [--json]` | Mitglieder aller Teams mit Teamzuordnung (`teams`) und laufende Sessions. Beendete Sessions zeigen `beendet`; je Ticket und Terminalname erscheint nur der neueste Start. |
| `fab inbox [--json]` | wie `index.json.inbox` |
| `fab index` | `index.json` neu erzeugen |
| `fab migrate [--json]` | Altdateien nach `fabric.db` überführen und den Abgleichsbericht zeigen; ein zweiter Lauf ändert nichts |
| `fab backup [--json]` | Konsistente SQLite-Sicherung nach `data/fabric/backups/` schreiben; behält die letzten 14 |

`--from` ist bei allen schreibenden Befehlen außer `new`, `accept`, `reject` und `verify` Pflicht. `verify` nimmt `--from NAME` optional; Standard ist der `assignee`. `accept` und `reject` schreiben als `mensch`.

### Test-Policy

`fab handover` prüft, ob zu geänderten Logikdateien mindestens eine geänderte Testdatei gehört. Welche Pfade zählen, steht in `.fabric/testpolicy.json` im **Haupt-Checkout** des Repos (nicht im Worktree); fehlt die Datei, gelten die Standardmuster.

```json
{"logic": ["fabric/fablib/**/*.py", "mods/*/**/*.js", "!mods/*/views/**"],
 "tests": ["fabric/tests/test_*.py", "mods/*/test/**"]}
```

- Beide Schlüssel sind optional und ersetzen unabhängig voneinander die jeweilige Standardliste; unbekannte Schlüssel werden ignoriert.
- Muster sind repo-relative POSIX-Globs: `*` innerhalb eines Pfadsegments, `**` über Segmente hinweg (`**/` darf null Segmente treffen), `?` ein Zeichen; ein führendes `!` schließt aus. Groß-/Kleinschreibung zählt.
- Fehlerhafte Datei (kein JSON, falscher Typ, ungültige Musterliste) bricht die Übergabe mit Pfad ab.
- Gemessen wird keine Abdeckung, nur ob mindestens eine geänderte Testdatei im Diff liegt.

## 3b. Konfiguration und Pflege (für das UI)

Das UI pflegt alles über diese Befehle. Alle schreiben atomar (tmp + `os.replace`), lassen unbekannte Felder stehen, schreiben ein Ereignis `config` (`text` = was geändert wurde), erzeugen `index.json` neu und verlangen `--from` (das UI übergibt `mensch`). Fehler: deutsche Meldung auf stderr, Exit ≠ 0. Schreibbefehle committen ihre eigenen Dateien gezielt selbst — Roster als `chore(roster): …`, Promptdatei als `chore(prompt): …` —, aber nur wenn der Checkout auf seinem Basis-Branch steht; andere Änderungen bleiben uncommittet, und außerhalb eines Git-Repos wird nichts committet.

| Befehl | Wirkung |
|---|---|
| `fab roster --json` | Kompletter Roster: `max_sessions`, `reviewer`, `orchestrator {argv, prompt}`, `agents[] {name, role, color, argv, prompt, teams[]}` (Mitglieder aller Teams, je Name einmal) und je Agent die abgeleiteten Felder `program` (= `argv[0]`), `model` (Wert von `--model=`/`--model`), `flags` (übrige argv), `open_tickets`, `sessions` (laufende Terminals mit `name`, `terminal`, `status`) |
| `fab agent add NAME --role R [--color cN] --argv-json JSON [--prompt-text T] --from N` | Neuer Agent. Name `^[a-z][a-z0-9_-]{0,15}$`, eindeutig, nicht `orchestrator`/`mensch`/`fab`; Farbe `c1`–`c6`, sonst die nächste freie; `argv` nicht leer. Legt `prompts/<name>.md` an (Text oder kurze Vorlage). |
| `fab agent edit NAME [--rename NEU] [--role R] [--color cN] [--argv-json JSON] [--prompt-text T] --from N` | Ändern. `--rename` nur, wenn kein offenes Ticket den Agenten nennt (`assignee`) und keine Session läuft; benennt die Promptdatei mit um und passt `reviewer` an. |
| `fab agent rm NAME --from N` | Entfernen. Verweigert bei offenen Tickets, laufender Session oder wenn er `reviewer` ist (Gründe in der Meldung). Die Promptdatei bleibt erhalten. |
| `fab settings set KEY VALUE [--team NAME] --from N` | `max_sessions` (1–16), `reviewer` (Roster-Name), `orchestrator_argv` (JSON-Liste, nicht leer), `max_sessions_total` (1–64), `tick_doing_minutes`, `tick_mention_minutes`, `tick_review_minutes`, `tick_blocked_minutes`, `tick_retry_minutes` (jeweils 0–1440, Minuten; steuern `fab tick`, Abschnitt 4b), `orchestrator_dispatches` (0–100, Standard 5) und `orchestrator_idle_minutes` (0–1440, Standard 30) für den Orchestrator-Neustart (Abschnitt 4c). `--team` schreibt die beiden Orchestrator-Werte in dieses Team; ohne `--team` gilt das erste Team. 0 schaltet die jeweilige Regel ab. |
| `fab blueprint add NAME --role R [--color cN] --argv-json JSON [--prompt-text T] --from N` | Blaupause anlegen; Name wie `fab agent add`, Farbe sonst die nächste freie, Prompt `prompts/<name>.md` |
| `fab blueprint edit NAME [--rename NEU] [--role R] [--color cN] [--argv-json JSON] [--prompt-text T] --from N` | Blaupause ändern; `--rename` zieht Teams und Prüfer mit |
| `fab blueprint rm NAME --from N` | Entfernen; verweigert, solange die Blaupause Mitglied eines Teams ist. Der Prompt bleibt |
| `fab team add NAME --repo PFAD… --members-json JSON --reviewer NAME [--max-sessions N] [--orchestrator-argv-json JSON] [--orchestrator-prompt PFAD] --from N` | Team anlegen; ein Repo gehört höchstens einem Team, der Prüfer muss Mitglied sein. Ohne `--orchestrator-prompt` bekommt das Team `prompts/orchestrator-<name>.md` als Kopie der aktuellen Vorlage (`orchestrator.prompt`, sonst `prompts/orchestrator.md`); eine vorhandene Datei wird nicht überschrieben. Ein expliziter `--orchestrator-prompt` wird unverändert übernommen und nicht kopiert. |
| `fab team edit NAME [--rename NEU] [--repo PFAD…] [--members-json JSON] [--reviewer NAME] [--max-sessions N] [--orchestrator-argv-json JSON] [--orchestrator-prompt PFAD] --from N` | Team ändern; Repos und Mitglieder werden als ganze Liste ersetzt. Mitglieder: `[{"blueprint": "zap", "model": "…", "max_cost": 5}]`. `--rename` wird abgelehnt, solange ein Orchestrator (`fab orchestrator stop <name>`) oder eine Agenten-Session (`hc kill <terminal>`) des Teams läuft; erfolgreiche Umbenennungen merken sich den alten Namen, damit laufende Terminals weiter zugeordnet werden. |
| `fab team rm NAME --from N` | Team entfernen. Verweigert mit einer Meldung, die alle Gründe nennt, solange offene Tickets (`todo`, `doing`, `review`) in seinen Repos liegen, sein Orchestrator (`fab orchestrator stop <name>`) oder eine Agenten-Session (`hc kill <terminal>`) des Teams läuft. Die Laufzeitprüfung erkennt auch Terminals unter einem früheren Teamnamen. Die Promptdatei bleibt erhalten. |
| `fab team list [--json]` | Teams mit Repos, Mitgliedern (inkl. Übersteuerungen), Prüfer, Limit und Orchestrator. `prompt_shared` markiert einen von mehreren Teams genutzten Promptpfad, `shared_with` nennt die anderen Teams |
| `fab prompt list --json` | `[{name, kind: orchestrator\|preamble\|agent, path, bytes, placeholders: [...]}]` |
| `fab prompt show NAME [--team TEAM]` | Rohtext (`orchestrator`, `preamble` oder Blaupause); `--team` wählt den Orchestrator-Prompt dieses Teams |
| `fab prompt set NAME --text T [--team TEAM] --from N` | Speichern. Bei unbekannten Platzhaltern (nicht in Abschnitt 5) Warnung auf stderr, gespeichert wird trotzdem. |
| `fab orchestrator status [TEAM] --json` | `{live, name, terminal, status, started_at}`. `status` = herdr-Status aus `hc ls --json`, sonst `null` |
| `fab orchestrator start\|stop\|restart [TEAM] [--from N]` | Orchestrator des Teams starten, stoppen oder neu starten |
| `fab repos --json` | Bekannte Repos aus Tickets und `--add PFAD…` (das UI gibt die Space-Ordner mit): `[{path, branch, open_tickets, verify_exists, lessons_exists}]`, nur Git-Wurzeln, ohne Doppelte |
| `fab repo show PFAD --json` | `{path, branch, verify: {exists, text}, lessons: {exists, text}}` |
| `fab repo set PFAD verify\|lessons --text T --from N` | Schreibt `.fabric/verify.sh` (ausführbar) bzw. `.fabric/lessons.md` im Haupt-Checkout. Verweigert außerhalb einer Git-Wurzel. |
| `fab repo test PFAD [--json]` | Führt `.fabric/verify.sh` im Haupt-Checkout aus (Timeout 600 s): `{exit, tail}` |
| `fab link ID --remove ID… --from N` | Abhängigkeiten entfernen |
| `fab new "<satz>" [--repo PFAD] [--from NAME] [--no-wake]` | wie oben; `--no-wake` legt nur den Entwurf an, ohne `@orchestrator`-Kommentar |
| `fab version` | Version (Datum + Git-HEAD des Fabric-Codes) |

`index.json.roster` enthält je Blaupause `{name, role, color, program, model, teams}`; `index.json.teams` nennt Reihenfolge, Prüfer, Limit und Orchestrator je Team für die Seitenleiste. Das UI liest den vollständigen Roster bei Bedarf über `fab roster --json`.

## 4. Wecken durch Erwähnung

Erwähnung = `@name`, Muster `@([a-z][a-z0-9_-]*)`, ohne Beachtung der Groß-/Kleinschreibung. Pro Kommentar wird jeder Name höchstens einmal geweckt. Für jeden genannten Namen gilt in dieser Reihenfolge:

1. Name = Autor → nichts. Zuvor geprüft wird ein Merge-Konflikt des Ticket-Branch mit der Basis: Kommentar mit Dateiliste an den Zuständigen und Wecken, auch wenn `mensch` der Autor ist.
2. `--no-wake` → nichts.
3. `mensch` → kein Wecken. `mensch` kommt in `waiting`, das Ticket erscheint in der Inbox.
4. Ticket `done` oder `dropped` → `unterdrückt: abgeschlossen`.
5. Ping-Pong-Bremse: mehr als 8 Weckungen desselben Ziels im selben Ticket innerhalb von 10 min → `unterdrückt: ping-pong`. Der Orchestrator bekommt beim ersten Mal genau eine Nachricht, die Inbox einen `attention`-Eintrag.
6. `orchestrator` → das Terminal `fab-orchestrator` wecken. Läuft es nicht, wird es gestartet (`gestartet`). Hat der Orchestrator des Teams seit seinem letzten Start `orchestrator_dispatches` erfolgreiche `fab dispatch`-Aufrufe mit `--from orchestrator` ausgeführt (Standard 5), wird er vorher neu gestartet; die Weckernachricht geht an die neue Session (Abschnitt 4c).
7. Roster-Agent → sein Terminal für dieses Ticket (Name `fab-<agent>-<id klein>`) wecken (`geweckt`). Läuft es nicht und hat das Ticket einen Worktree: den Agenten im Worktree starten (`gestartet`, Abschnitt 5). Hat das Ticket keinen Worktree: Nachricht an den Orchestrator (`an orchestrator`).
8. Unbekannter Name → `unterdrückt: unbekannt`.

Ein geweckter Agent bekommt per `hc send <terminal> "<text>"` (bei Fehlschlag noch einmal mit `--force`):

> Ticket {id} „{title}“: @{autor} hat dich erwähnt: „{kommentar, max. 300 Zeichen}“. Lies `fab show {id}`, arbeite an diesem Ticket weiter und antworte im Ticket mit `fab comment {id} --from {name} "…"`.

Jedes Ergebnis wird als `wake`-Ereignis geschrieben, auch jede Unterdrückung. Ist `mensch` erwähnt, gibt es zusätzlich das Ereignis `comment` mit `target: ""`; die Inbox liest `waiting`. `waiting` wird geleert, sobald der Wartende im Ticket kommentiert.

## 4b. Stillstandswächter `fab tick`

`fab tick` prüft alle offenen Tickets (`todo`, `doing`) und behebt Stillstand nach festen Regeln. Der Lauf ist idempotent: Ein zweiter Aufruf direkt danach ändert weder Ticket noch Ereignis. Der ganze Lauf steht unter dem Store-Lock, parallele Auslöser (Mod und launchd) kollidieren nicht. `draft`, `review`, `done` und `dropped` werden nicht angefasst. `tick` formuliert nicht aus, weist nicht zu und nimmt nicht ab.

| Regel | Bedingung | Aktion |
|---|---|---|
| 1 | `doing`, `mensch` nicht in `waiting`, keine lebende Session des Tickets, letzte Aktivität älter als `tick_doing_minutes` (10) | Zuständigen wecken; der Text nennt den letzten Verlaufseintrag |
| 2 | letzte Erwähnung eines Agenten (nicht Prüfer/Orchestrator/`mensch`) ohne Antwort und ohne lebende Session, älter als `tick_mention_minutes` (5) | diesen Agenten starten |
| 3 | Prüfer im letzten Kommentar erwähnt, kein Urteil danach, keine lebende Prüfer-Session, älter als `tick_review_minutes` (5) | Prüfer starten |
| 4 | `todo`, keine offenen Blocker, keine Session | Team-Orchestrator wecken; volles Team-/Gesamtlimit ⇒ `unterdrückt: voll`, kein Startversuch |
| 5 | offener Blocker seit mehr als `tick_blocked_minutes` (30) unverändert, außer ein `todo` mit eigenen offenen Blockern (wartet planmäßig; Regel 4 greift dort); ein fehlender Blocker zählt sofort | `attention` mit Blocker und Alter, kein Wecken |
| 6 | dieselbe Regel war zweimal erfolglos (`stall.attempts >= 2`) | `attention` statt einer dritten Weckung; weitere Ticks wecken nicht mehr, bis `stall` aufgelöst ist |

- Versuche werden je Ticket und Regel in `stall` gezählt. Zwischen zwei Versuchen liegt mindestens `tick_retry_minutes` (5); Regel 1 und 5 nutzen ihre eigene Schwelle. Nach einem fehlgeschlagenen Start im zweiten Versuch steht `attention` sofort, sonst nach Ablauf der Wartezeit bei der nächsten Auswertung. Eine lebende Session hält `stall` samt Versuchen fest; erst ein Kommentar oder ein Statuswechsel löst ihn auf.
- Ping-Pong-Bremse (Abschnitt 4) und Session-Limits (Abschnitt 5) gelten auch hier. Unterdrückte Versuche erzeugen kein `tick`-Ereignis und zählen nicht als Versuch.
- Jede Aktion schreibt ein `tick`-Ereignis mit Ticket, Regel und Grund; zugestellte Weckungen zusätzlich ein `wake`-Ereignis. Fällt die Bedingung weg, entfernt `tick` `stall` und schreibt `tick`/`gelöst`.
- `attention` erscheint genau einmal pro Ticket in der Inbox: Text `stockt seit <Dauer> – <Grund>`, `agent` für den Knopf „Erneut versuchen“ im Mod. Der Knopf ruft `fab wake … --from mensch "Erneut starten"`; eine zugestellte Weckung oder ein Kommentar löst `stall` auf. Board-Karten zeigen `stockt seit …`.
- `--dry-run` plant nur: kein Schreiben, kein `hc send`/`hc run`; Ausgabe nennt die geplanten Aktionen.
- Auslöser: der Mod ruft `fab tick` jede Minute auf, solange das Fenster offen ist. Optional installiert der Mensch einen launchd-Agent (Intervall 60 s) mit `fab tick --install`, entfernt ihn mit `--uninstall`. Automatisch wird nichts installiert. `--install` im Haupt-Checkout ausführen: der Auftrag trägt den absoluten Pfad der aufrufenden `fabric/fab`; aus einem Worktree zeigt er nach dem Aufräumen ins Leere.

## 4c. Neustart des Orchestrators

Der Kontext des Team-Orchestrators bleibt begrenzt. Zähler und Leerlauf werden per SQL aus der Tabelle `events` gelesen; ein zusätzlicher Zustand entsteht nicht. Ein Neustart ist `hc kill` auf das laufende Orchestrator-Terminal und ein frischer `fab orchestrator start`, gefolgt von einem `orchestrator`-Ereignis mit `text: "neu gestartet"` und `reason` (Zähler oder Leerlauf). Das Ereignis setzt den Zähler zurück.

- **Zähler:** Gezählt werden erfolgreiche `fab dispatch`-Aufrufe mit `--from orchestrator` seit dem letzten Start; Dispatch-Versuche mit `Start fehlgeschlagen` zählen nicht. Beim nächsten Wecken mit `@orchestrator` startet `fab` neu, statt `hc send` an die alte Session zu richten; die Weckernachricht geht an die neue Session. Schwelle `orchestrator_dispatches` (Standard 5, 0 schaltet ab).
- **Leerlauf:** `fab tick` startet einen laufenden Orchestrator neu, wenn sein Terminal nicht `working`/`blocked` ist und seit `orchestrator_idle_minutes` (Standard 30, 0 schaltet ab) weder ein fab-Aufruf noch eine Ausgabe beobachtet wurde. Ausgabe kommt aus `hc get` (`status_ms`, sonst `created_ms`), fab-Aufrufe aus Ereignissen mit `actor: "orchestrator"` des Teams. Wartet ein offenes Ticket auf ihn (letzte Erwähnung ohne spätere Reaktion oder `orchestrator` in `waiting`), bleibt er stehen; `--dry-run` nennt den geplanten Neustart nur.
- Der Zähler gilt je Team; `fab settings set … --team NAME` schreibt `orchestrator.dispatches` bzw. `orchestrator.idle_minutes` in das Team.

## 5. Agenten starten

Roster `fabric/roster.json`:

```json
{
  "max_sessions": 4,
  "reviewer": "ada",
  "orchestrator": {"argv": ["omp", "--approval-mode=always-ask-cached"], "prompt": "prompts/orchestrator.md"},
  "agents": [
    {"name": "zap", "role": "umsetzer", "color": "c1", "prompt": "prompts/zap.md",
     "argv": ["omp", "--model=opencode-go/deepseek-v4.1-flash", "--approval-mode=always-ask-cached", "--max-cost=5"]},
    {"name": "ada", "role": "pruefer", "color": "c2", "prompt": "prompts/ada.md",
     "argv": ["claude", "--model", "opus"]}
  ]
}
```

- Start eines Agenten auf einem Ticket:
  `hc run --bg --json --name fab-<team>-<agent>-<id klein> --cwd <worktree> --label fab.agent=<agent> --label fab.ticket=<ID> --label fab.team=<team> --no-parent --outlive-parent <argv…> "<startprompt>"`.
  Der Startprompt ist `prompts/preamble.md`, gefolgt vom Rollenprompt `prompts/<agent>.md` und dem Ticket (`fab show`-Text). Platzhalter in `preamble.md`: `{id} {title} {agent} {role} {worktree} {branch} {base} {reviewer}`.
- Ist `argv[0]` des Agenten (oder des Orchestrators) `claude`, markiert `fab` vorher das Startverzeichnis (Worktree bzw. Orchestrator-Ordner) als vertraut: `projects["<realpath>"].hasTrustDialogAccepted = true` in `~/.claude.json`. Es wird nur dieser eine Schlüssel geändert; alle anderen Felder bleiben unverändert. Geschrieben wird atomar (tmp im selben Ordner, gleiche Dateirechte, `os.replace`); hat sich die Datei seit dem Lesen geändert, wird bis zu 3-mal neu gelesen. Fehlt die Datei oder ist sie kein gültiges JSON: Warnung auf stderr, Start läuft trotzdem. Pfad über `$FAB_CLAUDE_JSON`, Standard `~/.claude.json`; Tests setzen immer eine Temp-Datei.
- Ist `max_sessions` erreicht (arbeitende oder auf Antwort wartende `fab-*`-Terminals ohne Orchestrator), wird nicht gestartet. Ergebnis: `unterdrückt: voll`, dazu ein `attention`-Eintrag. Status `working`/`blocked` zählt; `idle`/`done` nicht, und Sessions von `done`/`dropped`-Tickets zählen nicht mehr. Ohne Statuswort gilt eine Session als beschäftigt.
- Laufend heißt: `hc ls --json` führt ein Terminal mit diesem Namen und `state == "live"`. `fab agents` zeigt je Session das Statuswort, damit untätige Sessions erkennbar bleiben.
- `fab orchestrator start [TEAM]`: Kopiert den Orchestrator-Prompt des Teams nach `~/.herdr/fabric-orchestrator/<team>/AGENTS.md` und startet `hc run --bg --name fab-<team>-orchestrator --cwd ~/.herdr/fabric-orchestrator/<team> --label fab.role=orchestrator --label fab.team=<team> --no-parent --outlive-parent <argv…> "Du bist der Fabric-Orchestrator für Team <team>. Lies AGENTS.md und dann fab inbox --team <team> und fab list --team <team>."`.
- Alle `hc`-Aufrufe gehen über eine einzige Funktion, die Tests durch einen Stub auf dem `PATH` ersetzen.

## 6. Ablauf, den die Prompts beschreiben

1. Der Mensch: `fab new "<satz>"`. Das weckt `@orchestrator`.
2. Der Orchestrator formuliert aus (`fab edit`: Ziel, Kontext, Abnahmekriterien, Grenzen), setzt `repo`, weist zu (`fab assign`), stellt auf `todo`, verteilt (`fab dispatch`). Entscheidungen, die beim Menschen liegen, stellt er als Kommentar mit `@mensch`.
3. Der Umsetzer arbeitet im Worktree, committet, führt `fab verify` aus und schreibt bei Grün `@<reviewer> bitte prüfen`.
4. Der Prüfer liest `git diff <base>...HEAD` und die Abnahmekriterien, kommentiert Befunde und gibt `fab verdict` ab. Bei `fail` wird der Umsetzer automatisch geweckt, bei `pass` ebenfalls (mit dem Hinweis auf `fab handover`). Ist der Prüfer selbst der Zuständige, wird niemand geweckt.
5. Bei `pass` übergibt der Umsetzer mit `fab handover`. Der Mensch entscheidet im Mod (`accept` oder `reject`). Ist `origin` ein GitHub-Remote und `gh` angemeldet, legt `fab accept` einen PR an (oder merged ihn direkt); `fab accept --pr-only` öffnet ihn nur.
6. Fragen und Absprachen laufen nur im Ticket, mit `@name`. Kein `hc send` zwischen Agenten, keine Seitenkanäle.

## 7. Mod `fabric`

Ein einziger Mod, mehrfach im Layout, Ansicht über `props().view`:

| `view` | Inhalt |
|---|---|
| `tickets` | Eingabe „Neues Ticket in einem Satz…“ (→ `fab new`, Repo = Git-Wurzel von `focused().cwd`). Liste nach Stufe: Entwurf, Geplant, In Arbeit, Prüfung, Fertig (eingeklappt). Klick → Detail: Kopf (ID, Titel, Status, Zuständiger, Branch, Chips für Checks und Urteil), Body, Verlauf (Autor, Zeit, Text, `@erwähnungen` hervorgehoben, `wake`-Ergebnisse dazwischen als kleine Zeilen), Kommentarfeld (→ `fab comment --from mensch`). Bei `review`: **Abnehmen** (→ `fab accept`) und **Zurück mit Feedback** (→ `fab reject`). |
| `inbox` | `index.inbox`, neueste oben. Klick → `setShared("fabric.selected", id)` und Ticket-Ansicht zeigen. Die Zahl hängt als Badge am Kopf. |
| `timeline` | Ereignisse aus `index.events` als chronologischer Feed, neueste oben und nach Tagen gruppiert. Je Zeile: Akteur, Satz („weckte ada“, „änderte den Status“, „urteilte“), Ticket-ID, Uhrzeit, Art-Punkt; `wake` nennt das Ziel im Satz. Die Auswahl grenzt auf ein Ticket ein, „Alle“ zeigt wieder alle. Klick auf eine Zeile wählt das Ticket. |

- Der Mod liest nur `index.json` und `tickets/<ID>.json` (`readTextFile`). Er beobachtet `data/fabric` mit `watchFolder`, mit einem 5-s-Timer als Rückfall.
- Solange das Fenster offen ist, ruft der Mod jede Minute `fab tick` auf (Abschnitt 4b); ein laufender Tick blockiert keinen zweiten. Board- und Ticket-Karten zeigen bei `stall` „stockt seit …“ mit dem Grund als Tooltip.
- Geschrieben wird nur über `exec("${appHome()}/fabric/fab", […])`. Der Mod schreibt nie selbst in Ticket-Dateien.
- Gemeinsamer Zustand: `shared("fabric.selected")` (gewähltes Ticket).
- Aufbau: `main.js` (View, verteilt nach `view`), `model.js` (reine Logik ohne herdr-/gpui-Importe: Gruppieren, Kürzel, Zeitformat, Erwähnungen markieren, Zeitverlauf-Feed: Tagesgruppen und Ereignissätze), `ui.js` (Token und Bausteine), `views/*.js`. `model.js` hat node-Tests.
- Texte deutsch. Farben nur über `theme()`. Status- und Stufenwörter stehen genau einmal in `model.js`.
- Layout `layouts/fabric.json`: Klon von `main`. Im Stack `panel-body` die Kinder `fabric-tickets` (`{"mod":"fabric","props":{"view":"tickets"}}`) und `fabric-timeline`, `files` und `changes` bleiben. In der Seitenleiste unter `agents` ein Block `fabric-inbox`; über `agents` der Block `fabric-agents` (Mod `fabric-sidebar`: eigener Abschnitt „Fabric“ mit Orchestrator, Rolle/Status/Laufzeit, Ticket-Chip). Der Block `agents` nutzt den Klon `agents-filtered` der mitgelieferten Liste: Er blendet Fab-Terminals (Labels `fab.agent`/`fab.role`, Name `fab-*`) samt Subagenten aus, die übrigen Agenten bleiben. `main.json` und die mitgelieferte Liste bleiben unverändert. Beleg: `docs/assets/t14-fabric-filtered.png` (nur der normale Agent), Vergleich `docs/assets/t14-main-unfiltered.png` (dieselben Fab-Agenten in der normalen Liste von `main`). Tasten in `keys.json`: Panel Tickets und Timeline umschalten, Fokus auf „Neues Ticket“.
