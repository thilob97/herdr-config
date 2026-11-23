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
| launchd-Agent `fab tick` (macOS) | `~/Library/LaunchAgents/de.herdr.fabric.tick.plist`; legt der erste `fab`-Aufruf idempotent an, `FAB_TICK_AUTOSTART=0` schaltet ab, `FAB_LAUNCH_AGENTS_DIR` lenkt das Verzeichnis um; der Auftrag trägt immer das Standard-Home und ist nicht an ein abweichendes `FAB_HOME` gebunden | — |

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

- **Zeit.** Alle Uhrleser (`store.now_ms()`, Kosten, Liegezeiten, Vorschau, Sicherung) nutzen die zentrale Uhr in `fabric/fablib/clock.py`. Ohne `FAB_NOW` gilt die echte Uhr; `FAB_NOW` (Epoch-Millisekunden oder ISO 8601, ohne Zone lokal) friert sie für Tests ein.
- **Eine Änderung = eine Transaktion.** Ticket, Ereignis und Zähler werden gemeinsam festgeschrieben oder gar nicht; ein abgebrochener Schreibvorgang hinterlässt keinen halben Zustand.
- **Sperre nur für Zustand, nicht für Arbeit.** Der flock in `lock` schützt nur kurze Lese-/Schreibblöcke; Lesebefehle (`list`, `show`, `inbox`, `roster`, `agents`, `stats`, `flow list`, `autopilot status`) nehmen ihn nicht. Lange Arbeiten wie Prüfläufe, `git merge/push`, `gh` und `hc` laufen außerhalb; `handover` und `accept` lesen den Zustand, geben die Sperre frei und tragen das Ergebnis nur ein, wenn das Ticket unverändert ist (Compare-and-Set über `store.revision`). Ein wartender Schreiber bricht nach `FAB_LOCK_TIMEOUT` Sekunden (Standard 30) mit `gesperrt von PID <pid> (<befehl>) seit <n> s` ab; Halterdaten stehen in `lock.holder`.
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
  },
  "max_cost": 5,
  "cost": {
    "currency": "USD", "total": 0.42, "today": 0.42, "at": 1790000000000,
    "sessions": [
      {"agent": "zap", "name": "fab-zap-t-1", "started_at": 1790000000000,
       "cost": 0.31, "source": "omp", "files": 1}
    ]
  },
  "waits": {
    "total_ms": 5400000,
    "stages": [
      {"key": "doing", "label": "In Arbeit", "ms": 3600000, "open": false},
      {"key": "review", "label": "Prüfung bei ada", "ms": 1200000, "open": true},
      {"key": "mensch", "label": "wartet auf mensch", "ms": 600000, "open": false}
    ]
  }
}
```

- `status`: `draft` → `todo` → `doing` → `review` → `done`; daneben `dropped`. Zeiten in Epoch-Millisekunden.
- Felder ohne Wert: `null` bzw. `[]`. Kein Feld fehlt. Unbekannte Felder bleiben beim Schreiben erhalten — auch in einzelnen Kommentaren: deren Rohdaten werden vollständig gespeichert, `n` bleibt die vergebene Nummer, neue Kommentare zählen ab der höchsten vorhandenen Nummer weiter.
- `checks`/`verdict` gelten nur, solange `head` dem aktuellen HEAD des Worktrees entspricht.
- `attachments`: nur Bilder (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`), abgelegt von `fab attach` unter `data/fabric/attachments/<ID>/`. `path` ist relativ zur App-Wurzel (`~/.config/herdr-app`), damit der Mod ihn als Bild laden kann; im Body und in Kommentaren steht derselbe Pfad als Markdown-Bildlink `![name](path)`.
- `stall`: nur von `fab tick` geschrieben, optional. `rule` ∈ `doing mention review todo blocked`, `since` = Beginn des Stillstands, `attempts` = bisherige Weck-/Startversuche, `attention` = nach zwei erfolglosen Versuchen oder Regel 5, `reason` einzeilig ohne „stockt seit“, `agent` = zu weckender Agent oder `orchestrator`. Ein Kommentar im Ticket, jede zugestellte manuelle Weckung und jeder Statuswechsel entfernen `stall`; `fab tick` entfernt ihn, sobald die Bedingung wegfällt. `draft`, `review`, `done` und `dropped` werden von `fab tick` weder gelesen noch verändert.
- `sessions[]`: `ended` (optional) hält das beobachtete Ende einer Session `{at, code, reason, terminal}`; `seen_live` (optional, bool) belegt, dass die Session in einem Tick lief. Beide setzt `fab tick`/`fab dispatch` über `fabric/fablib/sessions.py`; ein neuer Start über `remember_session` entfernt `ended` und bei neuer Terminaladresse auch `seen_live`.
- `max_cost`: optionales Kostenlimit in USD (`fab edit --max-cost`), `null` = kein Limit. `cost` ist der zuletzt gespeicherte Stand aus den Session-Protokollen (omp: `FAB_OMP_SESSIONS` oder `~/.omp/agent/sessions`, claude: `FAB_CLAUDE_PROJECTS` oder `~/.claude/projects`, je Worktree-Ordner); `fab show` rechnet frisch, `store.save` schreibt den Stand mit. `waits` wird nur ins Lesemodell geschrieben, nie in die DB: drei Stufen `doing`, `review` (Label mit Prüfername), `mensch` mit Millisekunden und `open`.

### Ereignis (Zeile in `events`)

```json
{"at": 1790000000000, "kind": "comment", "ticket": "T-1", "actor": "zap", "target": "ada", "text": "…"}
```

`kind` ∈ `created edited status assigned comment wake dispatch verify verdict handover accept accept_noop reject drop orchestrator config tick pr session_ended`.
`target` nur bei `wake` (wer geweckt wird), `assigned` (wem), `dispatch` (welcher Agent), `tick` (welcher Agent) und `session_ended` (Terminalname); sonst `""`.
Bei `wake` steht in `text` genau eines von: `geweckt`, `gestartet`, `an orchestrator`, `unterdrückt: <grund>`.
Bei `tick` steht in `text` eines von: `geweckt`, `gestartet`, `an orchestrator`, `attention`, `gelöst`; `reason` nennt Regel und Grund, z. B. `Regel 1 (doing): keine Session seit 12 min`.
Bei `session_ended` nennt `reason` Exit-Code, Endzeit und hc-Grund (`Exit 129 · Ende 2026-11-22 12:21 · Grund killed`) oder `Fehlstart: Session nie sichtbar`; `text` enthält die letzten Bildschirmzeilen aus `hc read` (höchstens 20 Zeilen/2000 Zeichen, Kürzung wird benannt). Je Session und Ende genau ein Ereignis.

### Lesemodell `index.json`

```json
{
  "version": 1,
  "generated_at": 1790000000000,
  "tick": {"last_tick": 0, "age_ms": 360000, "limit_ms": 300000, "stale": true},
  "alarm": {"active": true, "count": 1, "alarms": [
    {"id": "main:42", "kind": "main", "at": 0, "since": 0, "ticket": "T-70",
     "run": 42, "step": "node --test mods/fabric", "reverted": true, "paused": true,
     "reason": "",
     "text": "main rot seit 12:51 – T-70 zurückgenommen – Schritt node --test mods/fabric fehlgeschlagen",
     "actions": ["run", "ticket", "resume", "ack"]}
  ]},
  "tickets": [
    {"id": "T-1", "title": "…", "status": "doing", "assignee": "zap", "repo": "…", "branch": "…",
     "updated_at": 0, "comment_count": 3, "waiting": [], "blocked_by": [],
     "checks": "pass", "verdict": null,
     "last_comment": {"author": "zap", "at": 0, "text": "…", "mentions": ["ada"]},
     "sessions": [{"agent": "zap", "name": "fab-zap-t-1", "terminal": "t9a"}],
     "stall": {"rule": "doing", "since": 0, "attempts": 2, "attention": true, "reason": "…"},
     "team": "herdr-app", "max_cost": 5,
     "cost": {"currency": "USD", "total": 0.42, "today": 0.42},
     "waits": {"total_ms": 5400000,
               "stages": [{"key": "doing", "label": "In Arbeit", "ms": 3600000, "open": false},
                          {"key": "review", "label": "Prüfung bei ada", "ms": 1200000, "open": true},
                          {"key": "mensch", "label": "wartet auf mensch", "ms": 600000, "open": false}]}}
  ],
  "inbox": [
    {"id": "question:T-1:0", "kind": "question", "ticket": "T-1", "at": 0, "from": "zap", "text": "…"},
    {"id": "review:T-2:0", "kind": "review", "ticket": "T-2", "at": 0, "from": "zap", "text": "Zusammenfassung"},
    {"id": "attention:T-3:0", "kind": "attention", "ticket": "T-3", "at": 0, "from": "fab",
     "text": "stockt seit 12 min – Regel 1 (doing): …", "agent": "zap",
     "reason": "Regel 1 (doing): …", "since": 0},
    {"id": "attention:tick:1790000000000", "kind": "attention", "ticket": "", "at": 0,
     "from": "fab", "text": "fab tick seit 6 min nicht gelaufen – Stillstands-Wächter prüfen",
     "reason": "", "since": 1790000000000, "alarm": "tick:1790000000000", "run": null}
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
- Lebt `last_tick` länger als 5 min zurück, steht zusätzlich genau **ein** `attention`-Eintrag ohne Ticket in der Inbox (`attention:tick:<last_tick>`); der nächste Tick räumt ihn ab. Der Zustand steht zusätzlich als `tick` im Lesemodell.
- `alarm` ist der aktive Alarmzustand aus `fabric/fablib/alarm.py` (Abschnitt 4e). Jeder Alarm erzeugt zentral genau einen Inbox-Eintrag `attention:<alarm.id>` mit `alarm`, `run` und bei `tick` zusätzlich `since`; quittierte Alarme fehlen in beiden Listen.
- Der Mod zählt nichts selbst: Inbox-Zahl = `inbox.length`, Stufen = Tickets nach `status`.
- Jeder Inbox-Eintrag trägt eine stabile `id`; sie bleibt über Neuberechnungen von `index.json` gleich, solange der Eintrag besteht.
- `index.json` bleibt unter 1 MiB: Ticket-Einträge ohne `body` und ohne `comments`, höchstens 300 Ereignisse.

## 3. CLI

Alle schreibenden Befehle laufen in genau einer Transaktion, hängen Ereignisse an und erzeugen danach die Lesemodelle (`index.json`, betroffene `tickets/<ID>.json`) neu. Fehler: Exit-Code ≠ 0, deutsche Meldung auf stderr. `--json` liefert maschinenlesbare Ausgabe, wo angegeben.

| Befehl | Wirkung |
|---|---|
| `fab new "<satz>" [--template NAME] [--issue N] [--repo PFAD] [--from NAME]` | Ticket `draft`, Titel = Satz (max. 80 Zeichen), Body `## Auftrag\n<satz>`. Satz und `--issue` sind beide optional, aber eins von beiden ist Pflicht; `--template` und `--issue` schließen sich aus. `--template NAME` setzt den Body aus der Vorlage `NAME` (jedes `{satz}` wird durch den Satz ersetzt), Titel bleibt der Satz. `--issue N` übernimmt Titel und Body eines **offenen** GitHub-Issues, hängt den Issue-Link an den Body und speichert Feld `issue` `{number, url, title}`; ein geschlossenes Issue, ein Repo ohne github.com-Origin oder ein fehlendes/nicht angemeldetes `gh` bricht mit deutscher Meldung ab. `--repo` Standard: Git-Wurzel des aktuellen Ordners, sonst `null`. Danach automatisch Kommentar von `--from` (Standard `mensch`): `@orchestrator bitte ausformulieren und verteilen` → weckt den Orchestrator. Gibt die ID aus. Bei einem Issue-Ticket trägt der PR-Body zusätzlich `Closes #N`. |
| `fab list [--status S] [--json]` / `fab show ID [--json]` | lesen. `show` rechnet Kosten und Liegezeiten frisch und zeigt `## Kosten` (je Session, `Summe: $x · Limit: $y`) sowie `## Liegezeiten`; `--json` ergänzt `cost` (Snapshot aus `costs.collect`) und `waits` nur in der Ausgabe. `## Beendete Sessions` listet jedes `session_ended` mit Zeit, Terminalname, Grund und den letzten Zeilen. |
| `fab stats [--team NAME] [--today] [--json]` | Kosten je Team: mit Worktree und Sessions frisch aus den Protokollen, sonst aus dem gespeicherten Ticket-Snapshot; Tabelle mit Team, Summe, Heute, Zahl der Tickets mit Betrag. `--team` filtert (unbekanntes Team = Fehler), `--today` zählt nur Tickets mit heutigem Betrag und setzt `total` auf die Heute-Summe. `--json` liefert `{generated_at, currency, teams:[{name,total,today,tickets}], total, today}`. |
| `fab edit ID [--title T] [--body T \| --body-file F] [--repo PFAD] [--base B] [--max-cost USD] --from NAME` | ändern. `--max-cost` setzt das Kostenlimit (Komma als Dezimaltrenner erlaubt, `>= 0`); ein leerer Wert (`--max-cost=`) löscht es. |
| `fab status ID STATUS --from NAME` | Statuswechsel. `done` nur über `accept`. |
| `fab assign ID NAME --from NAME` | Zuständigen auf ein Mitglied des Teams setzen, zu dem das Ticket-Repo gehört; ein Nicht-Mitglied wird mit Team und Mitgliederliste abgelehnt |
| `fab link ID --blocked-by ID… --from NAME` | Abhängigkeiten, ohne Zyklen. `--remove ID…` entfernt sie; fällt die letzte weg, startet `fab` das Ticket wie nach einer Abnahme (Abschnitt `fab accept`). |
| `fab comment ID --from NAME [--no-wake] "<text>"` | Kommentar; jede `@erwähnung` weckt (Abschnitt 4). Gibt pro genanntem Namen eine Zeile mit dem Ergebnis aus. |
| `fab attach ID DATEI [--no-edit] [--from NAME]` | Bild als Anhang: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` (Groß/klein egal). Kopiert nach `data/fabric/attachments/<ID>/<name>` (Name aus der Datei, bereinigt; gleicher Inhalt wird wiederverwendet, sonst `-2`, `-3`, …). Gibt die Zeile `![<name>](data/fabric/attachments/<ID>/<name>)` aus, hängt den Anhang an `attachments` und standardmäßig den Link an den Body; `--no-edit` lässt den Body unverändert. Akteur: `--from`, Standard `mensch`. |
| `fab diff ID [--json] [--file PFAD]` | Änderungen vor der Abnahme: Dateien mit `+`/`−` (`git diff --numstat base...branch`), Commits (`git log base..branch`), HEAD sowie Nachweise aus Ticket-Anhängen und im Handover genannten Dateien/Screenshots. `--json` liefert `{id, base, branch, head, merge_base, files, commits, proofs}`; `--file` den Text-Diff einer Datei (mit `--json` als `{path, diff}`). |
| `fab preview start [--page board\|ticket\|settings\|workflows\|repos\|team\|context\|knowledge]\|shot\|stop ID` | Eigene Vorschau-Instanz je Ticket-Worktree unter `/tmp/fab-preview/<ID>/`. `start` kopiert `settings.json`, `keys.json`, `layouts/`, `mods/` und die CLI aus dem Ticket-Worktree (nie `data`) nach `/tmp/fab-preview/<ID>/home`, nutzt ein privates `HOME` und `HC_SESSION` `fabp-<id>`, legt ein Demo-Ticket an (nie echte Ticketdaten), ergänzt Demokosten und Liegezeiten und startet ein eigenes Herdr-Fenster mit eigenem Core; `--page` wählt die Startseite (Standard `board`; `repos` öffnet den Steckbrief, `knowledge` den Wissensordner eines isolierten Demo-Repos im Vorschau-Home, `context` die Kontextvorschau des Demo-Tickets). `shot` speichert dort ein PNG und hängt es nach denselben Regeln wie `fab attach` an (Feld `attachments`, Link im Body); Akteur: `--from`, sonst `assignee`, sonst `mensch`. `stop` beendet App und Core und entfernt `/tmp/fab-preview/<ID>`. |
| `fab dispatch ID [--agent NAME] --from NAME` | Verlangt `repo`, einen Abschnitt `## Abnahmekriterien` und keine offenen `blocked_by`. Legt Branch `fab/<ID>-<slug>` vom aktuellen HEAD des Repos und den Worktree an, startet den Agenten (Abschnitt 5), Status `doing`. Läuft er schon für das Ticket: wecken statt starten. Eine beendete Session (nicht in `hc ls`, `state == "finished"` in `hc ls --all`) wird vorher als `session_ended` vermerkt; „läuft schon“ gilt nur für eine lebende Session, sonst startet `dispatch` neu. |
| `fab verify ID [--from NAME]` | Führt die Pipeline des Worktrees aus (`.fabric/pipeline.json`, Fallback `.fabric/verify.sh` als ein Schritt, Abschnitt „Pipeline“; Timeout 1200 s je Schritt). Schreibt `checks` samt `run_id` auf den HEAD. Akteur des `verify`-Ereignisses ist `--from`, Standard: `assignee`. |
| `fab runs [--ticket ID] [--json]` | Pipeline-Läufe lesen, nach `id` aufsteigend, optional auf ein Ticket gefiltert. |
| `fab run show RUN [--step NAME] [--json]` | Einen Lauf mit Schritten, Zuständen, Laufzeiten und gespeicherter Ausgabe zeigen; `--step NAME` beschränkt auf einen Schritt. |
| `fab run rerun RUN` | Denselben Lauf wiederholen: gleicher Worktree, Trigger, Ticket, Repo und Branch auf dem aktuellen HEAD; das Ergebnis ist ein neuer Lauf mit eigener `run_id`. |
| `fab verdict ID pass\|fail [--head SHA] --from NAME "<zusammenfassung>"` | Urteil des Prüfers auf den HEAD. `--head` ist der tatsächlich geprüfte Commit; weicht der Worktree-HEAD davon ab (neuer Commit während der Prüfung), bricht der Befehl ab, statt still auf den ungeprüften HEAD zu buchen. `fail`: Kommentar mit Zusammenfassung, Status `doing`, entfernt `mensch` aus `waiting` (keine Inbox-Frage), weckt `assignee`. `pass`: weckt `assignee` mit dem Hinweis, auf grünen Checks mit `fab handover` zu übergeben. Ist der Prüfer selbst der `assignee`, wird weder bei `pass` noch bei `fail` jemand geweckt. |
| `fab handover ID --from NAME "<zusammenfassung>"` | Übergabe an den Menschen. Gate: `checks.state == pass` und `verdict.state == pass`, beide auf dem aktuellen HEAD. Sonst Abbruch mit den Gründen. Zusätzlich Abbruch, wenn der Diff `base...branch` Logikdateien ändert, aber keine Testdatei; die Meldung nennt die Logikdateien und die aktiven Testmuster. Standardmuster: `fabric/fablib/**/*.py` und `mods/*/**/*.js` (ohne `mods/*/views/**`) für Logik, `fabric/tests/test_*.py` und `mods/*/test/**` für Tests; je Repo über `.fabric/testpolicy.json` übersteuerbar (Abschnitt „Test-Policy“). Danach prüft `fab` den Merge-Stand (lokale Basis `<base>` plus Branch) in einem temporären Worktree (Abschnitt „Merge-Stand“); rote Checks verweigern die Übergabe. Erfolg: Status `review`, `mensch` in `waiting`, Kommentar, Feld `merge` mit `tree`, `base`, `base_ref`, `remote_base`, `branch`, `state` und `at`. |
| `fab accept ID [--pr-only]` | Nur der Mensch. Bricht ab, wenn das Urteil nicht auf dem aktuellen Worktree-HEAD liegt (neuer Commit nach der Prüfung) oder der Merge-Tree nicht mehr dem bei `fab handover` geprüften `merge.tree` entspricht. Weicht er ab, wird der Merge-Stand neu geprüft, das bisherige Urteil verworfen, der Status geht auf `doing`, und die Prüferin wird für ein neues Urteil geweckt (Abschnitt „Merge-Stand“). Ist `origin` ein GitHub-Remote und `gh auth status` erfolgreich, läuft die Abnahme über einen Pull Request: `base` und Branch werden gepusht (`base` nur, wenn `origin/<base>` fehlt oder vom lokalen Stand abweicht; ist `<base>` nicht fast-forward-fähig zu `origin/<base>`, bricht `fab` vor jedem Push ab und sagt „nichts gepusht“), der PR wird angelegt oder gefunden und seine URL in Feld `pr` (`{"url": …, "state": "open"}`), als Kommentar `PR geöffnet: <url>` und als `pr`-Ereignis gespeichert. Der PR-Body endet bei einem Issue-Ticket mit `Closes #N`. `--pr-only` endet hier: Status bleibt `review`, Worktree und Branch bleiben. Ohne GitHub-Remote oder ohne `gh`-Anmeldung merge lokal; ein Issue-Ticket bekommt dann die Zeile `Issue #N bleibt offen: kein PR-Merge ohne GitHub-Remote/gh`. Ohne `--pr-only` wird der PR gemergt; danach folgen `git fetch` und `git merge --ff-only origin/<base>` im Haupt-Checkout. Grüne Checks setzen Feld `pr` auf `{"url": …, "state": "merged", "commit": <Merge-Commit>}` und schreiben den Kommentar `PR gemergt: <url>` samt `pr`-Ereignis. Danach löscht `fab` den Remote-Branch, beendet alle Sessions des Tickets, entfernt Worktree und Branch, setzt Status `done` und schreibt das `accept`-Ereignis mit URL. Scheitert der Merge selbst, bleibt der Status `review`, Kommentar und `pr`-Ereignis nennen Grund und URL, Exit 1; ein erneutes `fab accept` versucht den Merge erneut, und `gh_pr_merge` wertet einen bereits gemergten PR (`state == "MERGED"`) als Erfolg. Nach erfolgreichem Merge steht `pr` schon vor dem Aufräumen auf `{"url": …, "state": "merged", "commit": <Merge-Commit>}` (Kommentar `PR gemergt: <url>`, `pr`-Ereignis); scheitert danach das Aufräumen, bleibt der Status `review`, Kommentar und `pr`-Ereignis nennen „PR gemergt, Aufräumen unvollständig: …“, Exit 1. Ein erneutes `fab accept` schließt bei `pr.state == "merged"` ohne HEAD-/Urteilsprüfung nur das Aufräumen ab (Status `done`, `accept`-Ereignis; der Kommentar `PR gemergt: <url>` steht bereits aus dem Merge), auch wenn Worktree oder Branch schon teilweise entfernt sind — ein bereits gemergter PR gilt als Erfolg. Ohne GitHub-Remote oder ohne gh-Anmeldung wird wie bisher lokal mit `--no-ff` gemergt; `--pr-only` bricht dann mit Erklärung ab. Die bisherigen Prüfungen (Status `review`, keine offenen Unter-Tickets, Felder, Basis ausgecheckt, keine Datei-Überschneidung) gelten für beide Wege; nur der Wiederholungslauf nach bereits gemergtem PR überspringt HEAD-/Urteilsprüfung und Basis-Check. Danach startet `fab` automatisch jedes Ticket, das nur noch durch dieses blockiert war und startbereit ist (`todo`, Zuständiger, Repo, Abnahmekriterien) — mit denselben Regeln wie `fab dispatch`. Entwürfe und unvollständige Tickets bleiben liegen; Grund und Startfehler stehen als `dispatch`-Ereignis im Verlauf, die Abnahme bleibt gültig. Nach dem Merge läuft `herdr-app check` für jedes Verzeichnis `mods/*` im Haupt-Checkout. Ist ein Check rot, macht `fab` den Merge rückgängig (lokal: `git reset --keep` auf den Stand vor dem Merge; PR-Weg: Revert-Commit, gepusht nach `<base>`), lässt den Status `review`, behält Worktree und Branch (auf dem PR-Weg auch den Remote-Branch) und schreibt einen `attention`-Eintrag in die Inbox (`Merge zurückgesetzt: …`) mit der Check-Ausgabe. Erfolg beendet alle Sessions des Tickets — auch solche ohne Eintrag unter `## Sessions`, über das Label `fab.ticket` oder den Terminalnamen `fab-<team>-<agent>-t-<n>`. |
| `fab reject ID "<feedback>"` | Nur der Mensch. Kommentar von `mensch`, Status `doing`, weckt `assignee`. |
| `fab drop ID --from NAME "<grund>"` | Status `dropped`, Sessions beenden (auch ohne Eintrag unter `## Sessions`, per Label `fab.ticket` oder Namen), Worktree bleibt. |
| `fab wake ID NAME --from NAME ["<text>"]` | Wecken von Hand, gleiche Regeln wie bei Erwähnungen |
| `fab tick [--dry-run] [--install\|--uninstall]` | Stillstandswächter (Abschnitt 4b). Ohne Optionen ein Lauf: wecken/starten oder `attention`, sonst nichts; zusätzlich meldet und beendet er lebende Sessions zu `done`/`dropped`-Tickets (per Label `fab.ticket` oder Namen `fab-<team>-<agent>-t-<n>`). Beendete Sessions offener Tickets erkennt er an `hc ls --all`: `state == "finished"` schreibt genau einmal `session_ended` mit Exit-Code, Endzeit und letzten Zeilen; eine nie sichtbare Session meldet `Fehlstart`. Ein `doing`-Ticket ohne lebende Session bekommt dadurch sofort `attention`, ohne die Stillstandsfrist abzuwarten. Jeder echte Lauf schreibt `last_tick`; ist er älter als 5 min, erscheint ein `attention`-Eintrag in der Inbox. `--dry-run` zeigt nur die geplanten Aktionen und schreibt insbesondere kein `last_tick`. `--install` legt den launchd-Agent `~/Library/LaunchAgents/de.herdr.fabric.tick.plist` (Intervall 60 s) an, `--uninstall` entfernt ihn; ohne Auftrag legt der erste `fab`-Aufruf ihn unter macOS selbst an (Abschnitt 4b). Kein `--from`. |
| `fab orchestrator start\|stop\|status [TEAM]` | Orchestrator-Terminal je Team verwalten (Abschnitt 5) |
| `fab autopilot start [--until HH:MM\|done] \| stop \| resume \| status [--json]` | Autopilot-Terminal `autopilot` ohne Parent starten, beenden, eine Pause aufheben oder den Status zeigen; `--json` liefert genau den Inhalt von `$FAB_HOME/autopilot.json`. Ein zweiter Start bei laufendem Terminal bricht mit Meldung ab (Abschnitt 4d). |
| `fab alarm status [--json]` / `fab alarm ack [--json]` | Aktive Alarme bei rotem `main`, pausiertem Autopilot und ausgefallenem `fab tick` zeigen bzw. alle aktuellen quittieren (Abschnitt 4e). `status --json` liefert `{active, count, alarms}`; `ack` gibt `{acked, active, count, alarms}` aus und schreibt `index.json` neu. |
| `fab agents [--json]` | Mitglieder aller Teams mit Teamzuordnung (`teams`) und laufende Sessions. Beendete Sessions zeigen `beendet`; je Ticket und Terminalname erscheint nur der neueste Start. |
| `fab inbox [--json]` | wie `index.json.inbox` |
| `fab index` | `index.json` neu erzeugen |
| `fab migrate [--json]` | Altdateien nach `fabric.db` überführen und den Abgleichsbericht zeigen; ein zweiter Lauf ändert nichts |
| `fab backup [--json]` | Konsistente SQLite-Sicherung nach `data/fabric/backups/` schreiben; behält die letzten 14 |

`--from` ist bei allen schreibenden Befehlen außer `new`, `accept`, `reject`, `verify` und `map` Pflicht; `map` schreibt ohne Angabe als `fab`. `verify` nimmt `--from NAME` optional; Standard ist der `assignee`. `accept` und `reject` schreiben als `mensch`.

Der Diff des Tickets ist `git diff main...HEAD`: die Merge-Basis des Branches gegen seinen HEAD, nicht die aktuelle Spitze von `main`. Alles, was inzwischen auf `main` gelandet ist, gehört nicht zu den Nachweisen dieses Tickets; `fab diff ID` und die Gates von `fab handover` rechnen genauso mit `base...branch`.

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

### Merge-Stand

`fab handover` prüft nicht nur den Branch-HEAD, sondern den Stand, der beim lokalen Merge entsteht: `git merge-tree --write-tree` berechnet den Tree der lokalen Basis `<base>` plus Branch, ohne Worktree oder Refs zu verändern; `remote_base` hält zusätzlich den `origin/<base>`-SHA fest. Für diesen Tree erzeugt `fab` einen synthetischen Merge-Commit (keine Ref), legt davon einen temporären Worktree an, führt dort die Pipeline aus und entfernt den Worktree wieder — auch bei rotem Lauf oder Abbruch. Der Tree-Hash landet als `merge.tree` samt `base`, `base_ref`, `remote_base`, `branch` und `state` am Ticket.

`fab accept` berechnet den Tree erneut gegen dieselbe lokale Basis `<base>`, bevor irgendetwas gemergt oder gepusht wird; der PR-Weg prüft nach `git fetch` zuerst, dass `origin/<base>` höchstens hinter der lokalen Basis liegt, und pusht diese dann. Ist er gleich dem geprüften `merge.tree`, gilt Urteil und Abnahme weiter; das Ergebnis des `--no-ff`-Merges wird zusätzlich gegen `merge.tree` geprüft, sonst wird der Merge zurückgesetzt. Weicht der Tree ab, nimmt `fab` nicht ab: es prüft den neuen Merge-Stand (inklusive Checks), verwirft das bisherige Urteil, setzt den Status auf `doing`, entfernt `mensch` aus `waiting` und weckt die Prüferin für ein neues Urteil; sind die Checks rot oder entsteht ein Konflikt, wird stattdessen der Zuständige geweckt. Ohne neues Urteil verweigert `fab handover` wieder. Läuft `main` weiter, ohne den Merge-Tree zu ändern (z. B. ein leerer Commit), bleibt die Abnahme gültig.

Fehlt dem Ticket ein `merge`-Feld (etwa weil es vor der Merge-Stand-Prüfung in `review` ging), kann `fab accept` keinen geprüften Tree vergleichen. Es behandelt das wie einen abweichenden Stand: prüft den Merge-Stand neu, verwirft ein altes Urteil, setzt den Status auf `doing` und weckt die Prüferin. Abgenommen wird erst, wenn für den neu berechneten Stand ein Urteil vorliegt und `merge.tree` dazu passt; so kann kein ungeprüfter Merge durchrutschen.

### Abnahme ohne Änderung

Ändert ein Branch nichts, prüft `fab` mit `git rev-list --count <base>..<branch>` (dieselbe Basisreferenz wie der Merge-Stand), ob null Commits über der Basis liegen. `fab handover` setzt dann `no_change: true`, schreibt einen Hinweis ans Ticket und braucht weder Checks noch Urteil; der Status geht wie sonst auf `review`. `fab accept` schließt das Ticket als `done` ohne Merge und ohne PR: Kommentar und Ereignis `accept_noop` enthalten „ohne Änderung abgeschlossen“, Worktree, Branch und Sessions werden entfernt. `fab show` zeigt „ohne Änderung“; der Autopilot nimmt den Stand genau einmal ab, ohne `main` erneut zu prüfen.

### Pipeline

Jeder Nachweis läuft als Pipeline. Die Schritte stehen in `.fabric/pipeline.json` im jeweiligen Checkout (Haupt-Checkout oder Ticket-Worktree):

```json
{"steps": [
  {"name": "unittest", "run": "python3 -m unittest discover -s fabric/tests -t ."},
  {"name": "check-fabric", "run": "herdr-app check mods/fabric"}
]}
```

- `name` und `run` sind Pflicht und müssen nicht-leere Strings sein; `run` wird im Checkout per `sh -c` ausgeführt, die Listenreihenfolge ist die Ausführungsreihenfolge. Ein ungültiger Eintrag bricht mit dem Pfad der Datei ab.
- Fehlt `.fabric/pipeline.json`, aber `.fabric/verify.sh` existiert, gilt genau ein Schritt `{"name": "verify.sh", "run": "sh .fabric/verify.sh"}`. Fehlt beides, bricht `fab` mit einer Meldung ab, die beide Pfade nennt. `.fabric/verify.sh` bleibt ausführbar und ruft selbst die Schritte aus `pipeline.json` auf; so gibt es nur eine Quelle der Wahrheit.
- Je Schritt gilt ein Timeout von 1200 s. Läuft er ab, endet der Schritt mit Exit 124, und an sein stderr wird `Timeout nach <n> s` gehängt.
- Systemweit laufen höchstens `max_verify` Prüfläufe gleichzeitig (Roster, Standard 2; `fab settings set max_verify N`). Jeder Lauf entsteht zuerst als `queued`, belegt einen Slot und wird erst danach `running`. Ist kein Slot frei, steht einmal je Lauf `Lauf #<id>: in der Warteschlange (max. <n> gleichzeitig)` auf stderr. Die Wartezeit zählt nicht ins Schritt-Timeout: Die Uhr eines Schritts startet erst nach dem Slot-Erwerb.
- Slots sind dauerhafte `flock`-Dateien unter `<FAB_HOME>/verify-slots/slot-<i>.lock`; die Exklusivität liefert der Kernel und gibt die Sperre bei Prozessende frei (auch bei `SIGKILL`). Die Dateien werden nicht gelöscht, die PID darin ist nur Diagnose. `fab runs` und `fab run show` zeigen `queued` als `Warteschlange`; `--json` bleibt bei `queued`. Das Warten hat ein eigenes Zeitlimit: Nach `FAB_VERIFY_WAIT` Sekunden (Standard 1800) endet der Lauf mit `Warteschlange: nach <n> s kein Prüfslot frei (max. <n> gleichzeitig). …` als `fail`, statt zu hängen.
- Zusätzlich hält jeder laufende Prozess die Besitzdatei `<FAB_HOME>/verify-runs/run-<id>.lock`. Belegt der nächste Laufstart sie, ist der Besitzer tot, und er setzt den verwaisten Lauf auf `fail` (Schritte `running` → `fail`, `pending` → `skipped`); ein lebender Lauf behält seine Sperre und bleibt unberührt. Ohne dieses Aufräumen bliebe ein per `SIGKILL` beendeter Lauf für immer `queued` bzw. `running`. Der Lauf schreibt seinen Endstatus noch vor dem Freigeben der Besitzdatei, und das Aufräumen schreibt nur bedingt auf offene Zustände: Ein inzwischen fertiger Lauf samt Schritten bleibt unangetastet. Wie die Slots werden die Besitzdateien nie gelöscht; es wächst eine je Lauf, die PID darin ist nur Diagnose.
- Nach dem ersten fehlgeschlagenen Schritt werden alle folgenden als `skipped` gespeichert, ohne ausgeführt zu werden; der Lauf endet `fail`, `code` ist der Exit des ersten Fehlschlags, sonst 0. `tail` sind die letzten 20 Zeilen der kombinierten Ausgabe.
- Auslöser (`trigger`): `verify` (`fab verify` und Merge-Stand), `main` (Haupt-Checkout), `repo-test` (`fab repo test`) und `autopilot`.
- Gespeichert werden je Lauf `id`, `ticket`, `repo`, `worktree`, `branch`, `head`, `trigger`, `state`, `started_at`, `duration_ms`; je Schritt `position`, `name`, `command`, `state`, `duration_ms`, `exit_code`, `stdout`, `stderr`. Jeder Lauf hat eine `run_id`; `fab runs`, `fab run show RUN` und `fab run rerun RUN` arbeiten darauf.
- Ablage sind die Tabellen `pipeline_runs` und `pipeline_steps` in `fabric.db` (Abschnitt 2).

### Projektkarte

`fab map PFAD [--from NAME]` schreibt die Projektkarte `.fabric/map.md` im Haupt-Checkout und committet genau diese Datei, aber nur wenn sich ihr Inhalt ändert; sonst lautet die Ausgabe „… unverändert“. Quellen sind `git ls-files` für die getrackte Struktur, Ordner mit `mod.json`, `package.json`, `pyproject.toml` oder `__init__.py` für die Module, ausführbare Dateien und `bin`/`main` aus getrackten `package.json` für die Einstiegspunkte sowie `steps[].run` aus `.fabric/pipeline.json` bzw. `sh .fabric/verify.sh` für die Testbefehle. Der Inhalt ist deterministisch, ohne Zeitstempel und ohne absoluten Repo-Pfad.

Der Workflow `fabric/flows/projektkarte.json` erneuert die Karte stündlich (`cron`, `every_minutes: 60`) und führt `fab map .` nur im Shell-Nachtfenster 02:00–02:59 aus, damit die Erneuerung nicht in den Tag fällt. Das `.` bezieht sich auf das Repo des Laufs (`repo` der Workflow-Definition, sonst das Startverzeichnis des Laufs); der 60-Minuten-Takt lässt höchstens einen Lauf je Nacht zu, dafür muss ein `fab tick` im Fenster liegen. Wie die übrigen `.fabric`-Schreiber lehnt `fab map` ein symlinktes `.fabric` ab. Der Workflow wird nicht automatisch angelegt; einspielen mit `fab flow add fabric/flows/projektkarte.json`.

## 3b. Konfiguration und Pflege (für das UI)

Das UI pflegt alles über diese Befehle. Alle schreiben atomar (tmp + `os.replace`), lassen unbekannte Felder stehen, schreiben ein Ereignis `config` (`text` = was geändert wurde), erzeugen `index.json` neu und verlangen `--from` (das UI übergibt `mensch`). Fehler: deutsche Meldung auf stderr, Exit ≠ 0. Schreibbefehle committen ihre eigenen Dateien gezielt selbst — Roster als `chore(roster): …`, Promptdatei als `chore(prompt): …` —, aber nur wenn der Checkout auf seinem Basis-Branch steht; andere Änderungen bleiben uncommittet, und außerhalb eines Git-Repos wird nichts committet.

| Befehl | Wirkung |
|---|---|
| `fab roster --json` | Kompletter Roster: `max_sessions`, `reviewer`, `orchestrator {argv, prompt}`, `agents[] {name, role, color, argv, prompt, teams[]}` (Mitglieder aller Teams, je Name einmal) und je Agent die abgeleiteten Felder `program` (= `argv[0]`), `model` (Wert von `--model=`/`--model`), `flags` (übrige argv), `open_tickets`, `sessions` (laufende Terminals mit `name`, `terminal`, `status`) |
| `fab agent add NAME --role R [--color cN] --argv-json JSON [--prompt-text T] --from N` | Neuer Agent. Name `^[a-z][a-z0-9_-]{0,15}$`, eindeutig, nicht `orchestrator`/`mensch`/`fab`; Farbe `c1`–`c6`, sonst die nächste freie; `argv` nicht leer. Legt `prompts/<name>.md` an (Text oder kurze Vorlage). |
| `fab agent edit NAME [--rename NEU] [--role R] [--color cN] [--argv-json JSON] [--prompt-text T] --from N` | Ändern. `--rename` nur, wenn kein offenes Ticket den Agenten nennt (`assignee`) und keine Session läuft; benennt die Promptdatei mit um und passt `reviewer` an. |
| `fab agent rm NAME --from N` | Entfernen. Verweigert bei offenen Tickets, laufender Session oder wenn er `reviewer` ist (Gründe in der Meldung). Die Promptdatei bleibt erhalten. |
| `fab settings set KEY VALUE [--team NAME] --from N` | `max_sessions` (1–16), `max_verify` (1–16, Standard 2; systemweit gleichzeitige Prüfläufe, Abschnitt „Pipeline“), `reviewer` (Roster-Name), `orchestrator_argv` (JSON-Liste, nicht leer), `max_sessions_total` (1–64), `context_limit` (0 = aus, sonst mindestens die Länge des Kürzungshinweises bis 100000, Standard 6000; Obergrenze für Steckbrief und Team-Brief im Prompt), `tick_doing_minutes`, `tick_mention_minutes`, `tick_review_minutes`, `tick_blocked_minutes`, `tick_retry_minutes` (jeweils 0–1440, Minuten; steuern `fab tick`, Abschnitt 4b), `orchestrator_dispatches` (0–100, Standard 5) und `orchestrator_idle_minutes` (0–1440, Standard 30) für den Orchestrator-Neustart (Abschnitt 4c). `--team` schreibt die beiden Orchestrator-Werte in dieses Team; ohne `--team` gilt das erste Team. 0 schaltet die jeweilige Regel ab. |
| `fab blueprint add NAME --role R [--color cN] --argv-json JSON [--prompt-text T] --from N` | Blaupause anlegen; Name wie `fab agent add`, Farbe sonst die nächste freie, Prompt `prompts/<name>.md` |
| `fab blueprint edit NAME [--rename NEU] [--role R] [--color cN] [--argv-json JSON] [--prompt-text T] --from N` | Blaupause ändern; `--rename` zieht Teams und Prüfer mit |
| `fab blueprint rm NAME --from N` | Entfernen; verweigert, solange die Blaupause Mitglied eines Teams ist. Der Prompt bleibt |
| `fab team add NAME --repo PFAD… --members-json JSON --reviewer NAME [--max-sessions N] [--orchestrator-argv-json JSON] [--orchestrator-prompt PFAD] --from N` | Team anlegen; ein Repo gehört höchstens einem Team, der Prüfer muss Mitglied sein. Ohne `--orchestrator-prompt` bekommt das Team `prompts/orchestrator-<name>.md` als Kopie der aktuellen Vorlage (`orchestrator.prompt`, sonst `prompts/orchestrator.md`); eine vorhandene Datei wird nicht überschrieben. Ein expliziter `--orchestrator-prompt` wird unverändert übernommen und nicht kopiert. |
| `fab team edit NAME [--rename NEU] [--repo PFAD…] [--members-json JSON] [--reviewer NAME] [--max-sessions N] [--orchestrator-argv-json JSON] [--orchestrator-prompt PFAD] [--brief TEXT\|--brief-file PFAD] --from N` | Team ändern; Repos und Mitglieder werden als ganze Liste ersetzt; `--brief`/`--brief-file` setzt den Team-Brief (Ziele, Prioritäten, Definition of Done, Glossar, Stil, Entscheider), ein leerer Wert entfernt ihn. Mitglieder: `[{"blueprint": "zap", "model": "…", "max_cost": 5}]`. `--rename` wird abgelehnt, solange ein Orchestrator (`fab orchestrator stop <name>`) oder eine Agenten-Session (`hc kill <terminal>`) des Teams läuft; erfolgreiche Umbenennungen merken sich den alten Namen, damit laufende Terminals weiter zugeordnet werden. |
| `fab team rm NAME --from N` | Team entfernen. Verweigert mit einer Meldung, die alle Gründe nennt, solange offene Tickets (`todo`, `doing`, `review`) in seinen Repos liegen, sein Orchestrator (`fab orchestrator stop <name>`) oder eine Agenten-Session (`hc kill <terminal>`) des Teams läuft. Die Laufzeitprüfung erkennt auch Terminals unter einem früheren Teamnamen. Die Promptdatei bleibt erhalten. |
| `fab team list [--json]` | Teams mit Repos, Mitgliedern (inkl. Übersteuerungen), Prüfer, Limit, Orchestrator und `brief`. `prompt_shared` markiert einen von mehreren Teams genutzten Promptpfad, `shared_with` nennt die anderen Teams |
| `fab prompt list --json` | `[{name, kind: orchestrator\|preamble\|agent, path, bytes, placeholders: [...]}]` |
| `fab prompt show NAME [--team TEAM]` | Rohtext (`orchestrator`, `preamble` oder Blaupause); `--team` wählt den Orchestrator-Prompt dieses Teams |
| `fab prompt set NAME --text T [--team TEAM] --from N` | Speichern. Bei unbekannten Platzhaltern (nicht in Abschnitt 5) Warnung auf stderr, gespeichert wird trotzdem. |
| `fab orchestrator status [TEAM] --json` | `{live, name, terminal, status, started_at}`. `status` = herdr-Status aus `hc ls --json`, sonst `null` |
| `fab orchestrator start\|stop\|restart [TEAM] [--from N]` | Orchestrator des Teams starten, stoppen oder neu starten |
| `fab repos --json` | Bekannte Repos aus Tickets und `--add PFAD…` (das UI gibt die Space-Ordner mit): `[{path, branch, open_tickets, verify_exists, lessons_exists, project_exists}]`, nur Git-Wurzeln, ohne Doppelte |
| `fab repo show PFAD --json` | `{path, branch, verify: {exists, text}, lessons: {exists, text}, project: {exists, text}, project_template, knowledge: {exists, files: [{name, size, kind}]}}`; `kind` ist `PDF`, `Bild`, `Notiz` oder `Datei`, `files` ist nach Name sortiert; fehlt der Steckbrief, zeigt die Textausgabe seine Vorlage |
| `fab repo set PFAD verify\|lessons\|project --text T --from N` | Schreibt `.fabric/verify.sh` (ausführbar), `.fabric/lessons.md` bzw. den Steckbrief `.fabric/project.md` im Haupt-Checkout und committet die geschriebene Datei als eigenen Commit `chore(fabric): …`. Ist nicht der Basisbranch ausgecheckt, wird nur geschrieben. Verweigert außerhalb einer Git-Wurzel. |
| `fab context ID [--json]` bzw. `fab context --team NAME [--json]` | Gibt genau den Text aus, der im Startprompt eines Agenten bzw. im Orchestrator-Prompt an `{context}` steht: Steckbrief(e), Team-Brief, die letzten bestätigten Entscheidungen (max. 5) aus `.fabric/decisions.md`, der Abschnitt `Wissensordner` (absoluter Ordnerpfad und Dateinamen aus `.fabric/knowledge/`, keine Dateiinhalte) und bei vorhandener Karte der Abschnitt `Projektkarte` (nur absoluter Pfad zu `.fabric/map.md`, kein Karteninhalt), gekürzt auf `context_limit` mit Hinweis „gekürzt, vollständig in PFAD“. `--json` liefert `{text, chars, limit, clipped, scope, id, team}` für die Vorschau im Fabric-Fenster; `clipped` kommt direkt aus dem Kürzen, nicht aus dem Wort im Inhalt. |
| `fab map PFAD [--from NAME]` | Schreibt die Projektkarte `.fabric/map.md` deterministisch aus Git und Dateisystem (Abschnitte Struktur, Module, Einstiegspunkte, Testbefehle) und committet nur bei Änderung genau diese Datei; ohne Änderung meldet `fab` „unverändert“ und committet nichts. |
| `fab repo test PFAD [--json]` | Führt die Pipeline im Haupt-Checkout aus (Auslöser `repo-test`, Timeout 1200 s je Schritt, Abschnitt „Pipeline“): `{exit, tail}` samt `run_id` |
| `fab knowledge list PFAD [--json]` | Zeigt die Wissensdateien aus `.fabric/knowledge/` als `name · Größe · Typ`; `kind` ist `PDF`, `Bild`, `Notiz` oder `Datei`. `--json` liefert `[{name, size, kind}]` nach Name sortiert; ein fehlender oder leerer Ordner ergibt eine leere Liste, ein Pfad ohne Git-Wurzel ist ein Fehler. |
| `fab knowledge add PFAD DATEI [--name NAME] [--force] --from N` | Kopiert eine Datei binär und atomar nach `.fabric/knowledge/` (Zielname aus `--name`, sonst der Dateiname), höchstens 20 MB. Namen ohne Pfadtrenner, ohne `..` und ohne führenden Punkt. Ein vorhandener Name wird nur mit `--force` überschrieben. Committet genau diese Datei als `chore(fabric): Wissensdatei … hinzugefügt`; eine Ablehnung schreibt und committet nichts. |
| `fab knowledge note PFAD NAME --text T --from N` | Schreibt eine Notiz als UTF-8 nach `.fabric/knowledge/NAME.md` (die Endung `.md` wird ergänzt) und committet genau diese Datei als `chore(fabric): Wissensnotiz … angelegt`; eine vorhandene Datei ist ein Fehler. |
| `fab knowledge rm PFAD NAME --from N` | Löscht eine Wissensdatei und committet genau die Löschung als `chore(fabric): Wissensdatei … entfernt`; eine fehlende Datei ist ein Fehler. |
| `fab decide [propose] T-x --from N "ENTSCHEIDUNG" [--reason "TEXT"]` · `fab decide confirm\|reject T-x D1 --from N` · `fab decide list [--repo [PFAD]]` | Legt einen Entscheidungs-Vorschlag (`D1`, Feld `decision_proposals`, Ereignis `decision`) im Ticket an; `--from mensch` bestätigt sofort. Bestätigen schreibt die Zeile in `.fabric/decisions.md` des Ticket-Repos, Verwerfen nicht. `list` zeigt offene Vorschläge (`T-x D1 · von · Text · Begründung: …`) bzw. mit `--repo` die bestätigten Zeilen des Checkouts (Standard: aktueller Ordner). |
| `fab link ID --remove ID… --from N` | Abhängigkeiten entfernen |
| `fab new "<satz>" [--template NAME] [--issue N] [--repo PFAD] [--from NAME] [--no-wake]` | wie oben; `--no-wake` legt nur den Entwurf an, ohne `@orchestrator`-Kommentar |
| `fab template list [--json]` | Vorlagen in fester Reihenfolge `bug`, `feature`, `refactor`, `chore`, danach weitere alphabetisch: `[{name, path, bytes}]`, Pfad absolut. Lokale Vorlagen (neben dem Roster) gewinnen gegen die mitgelieferten aus `fabric/templates/`. |
| `fab template show NAME` | Rohtext der Vorlage. Unbekannter Name: deutsche Meldung mit allen vorhandenen Namen, Exit ≠ 0. |
| `fab template set NAME --text T --from N` | Speichert atomar im aktiven Vorlagenordner (Umgebungsvariable `FAB_TEMPLATES`, sonst `<Rosterordner>/templates`), Ereignis `config` und eigener Commit `chore(template): templates/<name>.md gespeichert (<n> Bytes)`. Name muss `^[a-z][a-z0-9_-]*$` erfüllen. |
| `fab issue list [--repo PFAD] [--json]` | Offene GitHub-Issues des Repos (`--repo` Standard: Git-Wurzel des aktuellen Ordners) über `gh issue list`: `[{number, title, url}]`, Text `#12 Titel`. Fehlt ein github.com-Origin, `gh` oder die Anmeldung, bricht der Befehl mit deutscher Meldung ab. |
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
7. Roster-Agent → sein Terminal für dieses Ticket (Name `fab-<agent>-<id klein>`) wecken (`geweckt`). Läuft es nicht und hat das Ticket einen Worktree: den Agenten im Worktree starten (`gestartet`, Abschnitt 5). Hat das Ticket keinen Worktree: Nachricht an den Orchestrator (`an orchestrator`). Auch ein `geweckt` trägt die laufende Session unter `## Sessions` nach, falls sie dort fehlt; so bleibt eine Session auffindbar, die vor einem fehlgeschlagenen Schreibvorgang gestartet wurde.
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
- Kostenlimit: Ist `max_cost` gesetzt und die frische Summe aus `costs.collect` überschreitet es, beendet `tick` vor allen Regeln jede Session (`hc kill` über Terminal/Name), setzt `mensch` in `waiting` (Regel 1 startet nicht neu) und meldet einmalig `attention` mit `Kostenlimit überschritten: $x > $y` (Regel 6); weitere Ticks ändern nichts. `--dry-run` meldet nur die geplante Aufmerksamkeit.
- Auslöser: Jeder echte `fab tick` schreibt `last_tick` (Millisekunden, zentrale Uhr) in die Tabelle `meta`. Fehlt der launchd-Auftrag, legt der erste `fab`-Aufruf ihn unter macOS idempotent an (Intervall 60 s, `RunAtLoad` aus); `FAB_TICK_AUTOSTART=0` schaltet das ab, `FAB_LAUNCH_AGENTS_DIR` lenkt das Verzeichnis um, und ohne ausdrückliche Freigabe (`=1`) wird aus einem Worktree nichts angelegt, weil dessen Pfad beim Aufräumen verschwindet. Der Auftrag trägt immer das Standard-Home `~/.config/herdr-app/data/fabric`, nie das `FAB_HOME` des auslösenden Aufrufs: weicht `FAB_HOME` ab, wird nichts angelegt und `fab tick --install` nennt den Grund; eine bestehende Plist mit abweichendem `FAB_HOME` schreibt der nächste `fab`-Aufruf auf das Standard-Home um.
- Der Mod-Timer lebt im Inbox-Block, den es nur im Layout `fabric` gibt (`layouts/fabric.json`); in jedem anderen Layout tickt bei geschlossenem Fabric-Fenster nur launchd. Beide Ansichten teilen sich den letzten Versuch; scheitert der Aufruf, stößt der Mod einen Index-Lauf an, der den Alarm veröffentlicht.
- Ursache des Ausfalls vom 22.11. (T-80): Der Tick-Timer war nur in der `isApp`-Ansicht (das Fabric-Overlay) registriert. Das Schließen des Fensters beendete die Ansicht samt Timer, während der launchd-Auftrag nie automatisch angelegt worden war.
- Alarm: Ist `last_tick` älter als 5 min, enthält `index.json` unter `tick` den Zustand `{last_tick, age_ms, limit_ms, stale: true}` und die Inbox genau einen `attention`-Eintrag `attention:tick:<last_tick>` mit Text `fab tick seit … nicht gelaufen`. Derselbe Ausfall erzeugt keinen zweiten Eintrag; der nächste erfolgreiche Tick schreibt `last_tick` neu und löst den Eintrag auf. Ohne bekannten `last_tick` gibt es keinen Alarm. Banner und rote Lampe baut T-75 auf diesem Zustand.

## 4c. Neustart des Orchestrators

Der Kontext des Team-Orchestrators bleibt begrenzt. Zähler und Leerlauf werden per SQL aus der Tabelle `events` gelesen; ein zusätzlicher Zustand entsteht nicht. Ein Neustart ist `hc kill` auf das laufende Orchestrator-Terminal und ein frischer `fab orchestrator start`, gefolgt von einem `orchestrator`-Ereignis mit `text: "neu gestartet"` und `reason` (Zähler oder Leerlauf). Das Ereignis setzt den Zähler zurück.

- **Zähler:** Gezählt werden erfolgreiche `fab dispatch`-Aufrufe mit `--from orchestrator` seit dem letzten Start; Dispatch-Versuche mit `Start fehlgeschlagen` zählen nicht. Beim nächsten Wecken mit `@orchestrator` startet `fab` neu, statt `hc send` an die alte Session zu richten; die Weckernachricht geht an die neue Session. Schwelle `orchestrator_dispatches` (Standard 5, 0 schaltet ab).
- **Leerlauf:** `fab tick` startet einen laufenden Orchestrator neu, wenn sein Terminal nicht `working`/`blocked` ist und seit `orchestrator_idle_minutes` (Standard 30, 0 schaltet ab) weder ein fab-Aufruf noch eine Ausgabe beobachtet wurde. Ausgabe kommt aus `hc get` (`status_ms`, sonst `created_ms`), fab-Aufrufe aus Ereignissen mit `actor: "orchestrator"` des Teams. Wartet ein offenes Ticket auf ihn (letzte Erwähnung ohne spätere Reaktion oder `orchestrator` in `waiting`), bleibt er stehen; `--dry-run` nennt den geplanten Neustart nur.
- Der Zähler gilt je Team; `fab settings set … --team NAME` schreibt `orchestrator.dispatches` bzw. `orchestrator.idle_minutes` in das Team.

## 4d. Autopilot `fab autopilot`

`fab autopilot start` startet die Schleife als hc-Terminal `autopilot` ohne Parent im Haupt-Checkout. `--until HH:MM` setzt die Endzeit (heute, sonst morgen), `--until done` beendet erst, wenn nichts mehr offen ist. `stop` beendet das Terminal, `resume` hebt eine Pause auf, `status` zeigt den Status; `status --json` gibt genau die Statusdatei aus.

Die Schleife läuft alle 120 s:

- **Abnahme:** Tickets in `review` werden angenommen, wenn `checks` und `verdict` `pass` auf dem aktuellen Worktree-HEAD sind. Das Haupt-Checkout muss sauber sein; nur `fabric/roster.json` und `fabric/prompts/` dürfen uncommittet sein und werden als `chore: UI-Konfiguration (Autopilot)` committet.
- **main nach dem Merge:** `.fabric/verify.sh` im Haupt-Checkout. Rot ⇒ ein zweiter Lauf nach 60 s; bleibt es rot, nimmt `git revert -m 1 --no-edit HEAD` den Merge zurück und der Autopilot pausiert. Die Pause gilt auch, wenn der Revert fehlschlägt; der Schutzschritt hängt nicht an dessen Exit-Code.
- **Konflikt:** Scheitert `fab accept` an einem Merge-Konflikt, geht genau ein Hinweis je HEAD an den Zuständigen.
- **Rückfragen:** Steht `mensch` in `waiting` (außer bei `review`), geht einmal je Ticket die Entscheidungsbitte an den Orchestrator.
- **Stillstand:** Ohne lebende Session und ohne Ereignis seit 20 min wird der Zuständige geweckt (höchstens dreimal, dann der Orchestrator); zwischen Weckungen liegen mindestens 30 min.
- **Verteilen:** Offene `todo` ohne Blocker stoßen höchstens alle 30 min einen Orchestrator-Hinweis an.

Statusdatei `$FAB_HOME/autopilot.json` (Standard `data/fabric/autopilot.json`): `state` (`running`/`paused`/`stopped`), `reason`, `end` (ISO `YYYY-MM-DDTHH:MM`, leer bei `done`), `updated_at` (ms), `paused_since` (ms, Beginn der laufenden Pause; leer außerhalb von `paused`), `last_action`, `log` und `pid`. Weitere Felder dürfen hinzukommen; Leser ignorieren Unbekanntes. Die Pausemarke liegt daneben in `autopilot-pause`, das Log in `autopilot.log`.

## 4e. Alarme

`fab alarm status [--json]` und `fab alarm ack [--json]` lesen und quittieren den Alarmzustand in `index.json["alarm"]`. Abgeleitet wird aus drei Quellen:

- **main rot:** Der jüngste Pipeline-Lauf mit `trigger == "main"` endet `fail`. Schritt ist der erste fehlgeschlagene Schritt, das Ticket kommt aus dem Lauf oder aus dem Betreff von `git log -1 --format=%s <head>` (`T-<n>`). „zurückgenommen“ wird nur gemeldet, wenn `git log -n 50 --format=%B` im Repo `This reverts commit <head>` enthält. Nach einem grünen main-Lauf ist der Alarm weg.
- **Pause:** `autopilot.json` steht auf `paused`; `since` ist `paused_since`, sonst `updated_at`. Bei aktivem main-Alarm erscheint die Pause nicht als eigener Alarm, weil der main-Alarm `resume` anbietet.
- **tick:** `store.tick_alarm()` ist `stale` (älter als 5 min); `since` ist `last_tick`, der Text nennt das Alter.

Jeder Alarm trägt eine stabile `id` (`main:<run>`, `pause:<since>`, `tick:<last_tick>`), `at`, `since`, `ticket`, `run`, `step`, `reverted`, `paused`, `reason`, `text` und `actions`. Lampe und Banner lesen `alarms`; der Toast dedupliziert über dieselbe `id` wie der Inbox-Eintrag `attention:<id>`. `fab alarm ack` quittiert **alle** aktuell abgeleiteten Alarme, auch die bei main unterdrückte Pause, und speichert die IDs dedupliziert (höchstens 100) unter dem Meta-Schlüssel `alarm_ack`; ein neuer main-Lauf hat eine neue `id` und löst wieder aus.

## 5. Agenten starten

Roster `fabric/roster.json`:

```json
{
  "max_sessions": 4,
  "max_verify": 2,
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
  Der Startprompt ist `prompts/preamble.md`, gefolgt vom Rollenprompt `prompts/<agent>.md` und dem Ticket (`fab show`-Text). Platzhalter in `preamble.md`: `{id} {title} {agent} {role} {worktree} {branch} {base} {reviewer} {lessons} {context}`. `{context}` füllt Projekt-Steckbrief(e), Team-Brief, die letzten bestätigten Entscheidungen, den Abschnitt `Wissensordner` (Pfad und Dateinamen, keine Inhalte) und bei vorhandener Karte den Abschnitt `Projektkarte` (nur Pfad), `{lessons}` die bestätigten Lehren.
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
- Solange der Inbox-Block existiert (Layout `fabric`), ruft der Mod jede Minute `fab tick` auf (Abschnitt 4b); ein laufender Tick blockiert keinen zweiten. Board- und Ticket-Karten zeigen bei `stall` „stockt seit …“ mit dem Grund als Tooltip.
- Geschrieben wird nur über `exec("${appHome()}/fabric/fab", […])`. Der Mod schreibt nie selbst in Ticket-Dateien.
- Gemeinsamer Zustand: `shared("fabric.selected")` (gewähltes Ticket).
- Aufbau: `main.js` (View, verteilt nach `view`), `model.js` (reine Logik ohne herdr-/gpui-Importe: Gruppieren, Kürzel, Zeitformat, Erwähnungen markieren, Zeitverlauf-Feed: Tagesgruppen und Ereignissätze), `ui.js` (Token und Bausteine), `views/*.js`. `model.js` hat node-Tests.
- Texte deutsch. Farben nur über `theme()`. Status- und Stufenwörter stehen genau einmal in `model.js`.
- **Benachrichtigungen.** Jeder neue menschliche Inbox-Eintrag (`question`, `review`, `attention`, `lesson`, `decision`) erzeugt genau **einen** Toast mit Ton und dem Knopf **„Öffnen“**, der das zugehörige Ticket im Fabric-Fenster zeigt. Den Toast rendert der Mod `fabric-toast` (Layout-Wurzel `"toast": "fabric-toast"`); er läuft nur über den gemeinsamen Zustand, nicht über eigene Timer. Bereits gemeldete Einträge stehen in `shared("fabric.notify.seen")`. Einstellungen stehen in `shared("fabric.notify")` als `{enabled, quiet_from, quiet_to}` (Stunden 0–23, Standard `22`–`8`); in der Ruhezeit oder bei `enabled: false` unterdrückte Einträge wandern trotzdem in `seen` und werden später **nicht** nachgeholt.
- Layout `layouts/fabric.json`: Klon von `main`. Im Stack `panel-body` die Kinder `fabric-tickets` (`{"mod":"fabric","props":{"view":"tickets"}}`) und `fabric-timeline`, `files` und `changes` bleiben. In der Seitenleiste folgen auf `spaces` der Block `fabric-agents` (Mod `fabric-sidebar`: freie Agenten als Karten, Fabric-Teams mit Orchestrator, Rolle/Status/Laufzeit und Ticket-Chip) und `fabric-inbox`. Einen eigenen `agents`-Block gibt es im Layout `fabric` nicht mehr; der Mod `agents-filtered` bleibt für andere Layouts bestehen. `fabric-sidebar` setzt `setAgentOrder` auf die eigene Reihenfolge (angepinnte und wartende zuerst), damit `agent.next`/`agent.prev` weiter zu den sichtbaren Agenten springen. Tasten in `keys.json`: Panel Tickets und Timeline umschalten, Fokus auf „Neues Ticket“.
