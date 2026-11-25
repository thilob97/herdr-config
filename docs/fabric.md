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
- **Sperre nur für Zustand, nicht für Arbeit.** Der flock in `lock` schützt nur kurze Lese-/Schreibblöcke; Lesebefehle (`list`, `show`, `inbox`, `roster`, `agents`, `stats`, `flow list`, `autopilot status`) nehmen ihn nicht. Lange Arbeiten wie Prüfläufe, `git merge/push`, `gh` und `hc` laufen außerhalb; `handover` und `accept` lesen den Zustand, geben die Sperre frei und tragen das Ergebnis nur ein, wenn das Ticket unverändert ist (Compare-and-Set über `store.revision`). Die Revision zählt Zustand, nicht Verlauf: `comments`, `updated_at`, `cost` und `waits` ändern sie nicht; Status, Branch, Zuständiger, `accept` und andere Felder schon. Ein während der Arbeit parallel hinzugekommener Kommentar wird beim Speichern übernommen (Schlüssel `(at, author, text)`), eine Feldänderung bricht dagegen mit „Ticket wurde während der Arbeit geändert“ ab. Ein wartender Schreiber bricht nach `FAB_LOCK_TIMEOUT` Sekunden (Standard 30) mit `gesperrt von PID <pid> (<befehl>) seit <n> s` ab; Halterdaten stehen in `lock.holder`.
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

Alle schreibenden Befehle schreiben jede Änderung in genau einer Transaktion, hängen Ereignisse an und erzeugen danach die Lesemodelle (`index.json`, betroffene `tickets/<ID>.json`) neu; `fab accept` schreibt seinen Fortschritt in mehreren solchen Transaktionen, eine je Schritt (Abschnitt „Wiederaufnehmbare Abnahme“). Fehler: Exit-Code ≠ 0, deutsche Meldung auf stderr. `--json` liefert maschinenlesbare Ausgabe, wo angegeben.

| Befehl | Wirkung |
|---|---|
| `fab new "<satz>" [--template NAME] [--issue N] [--repo PFAD] [--from NAME]` | Ticket `draft`, Titel = Satz (max. 80 Zeichen), Body `## Auftrag\n<satz>`. Satz und `--issue` sind beide optional, aber eins von beiden ist Pflicht; `--template` und `--issue` schließen sich aus. `--template NAME` setzt den Body aus der Vorlage `NAME` (jedes `{satz}` wird durch den Satz ersetzt), Titel bleibt der Satz. `--issue N` übernimmt Titel und Body eines **offenen** GitHub-Issues, hängt den Issue-Link an den Body und speichert Feld `issue` `{number, url, title}`; ein geschlossenes Issue, ein Repo ohne github.com-Origin oder ein fehlendes/nicht angemeldetes `gh` bricht mit deutscher Meldung ab. `--repo` Standard: Git-Wurzel des aktuellen Ordners, sonst `null`. Danach automatisch Kommentar von `--from` (Standard `mensch`): `@orchestrator bitte ausformulieren und verteilen` → weckt den Orchestrator. Gibt die ID aus. Bei einem Issue-Ticket trägt der PR-Body zusätzlich `Closes #N`. |
| `fab list [--status S] [--json]` / `fab show ID [--json]` | lesen. `show` rechnet Kosten und Liegezeiten frisch und zeigt `## Kosten` (je Session, `Summe: $x · Limit: $y`) sowie `## Liegezeiten`; `--json` ergänzt `cost` (Snapshot aus `costs.collect`) und `waits` nur in der Ausgabe. `## Beendete Sessions` listet jedes `session_ended` mit Zeit, Terminalname, Grund und den letzten Zeilen. Ist eine Abnahme begonnen (`accept.steps` nicht leer), folgt nach den Metazeilen eine Zeile `Abnahme: gepusht ✓ · PR gemergt … · aufgeräumt … · fertig …`: `✓` erledigt, `…` offen; die Folge richtet sich nach dem Weg (PR: `pushed`, `pr_merged`, `cleaned`, `done`; lokal: `merged`, `cleaned`, `done`; sonst `cleaned`, `done`). Labels: `pushed` = gepusht, `pr_merged` = PR gemergt, `merged` = gemergt, `cleaned` = aufgeräumt, `done` = fertig. |
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
| `fab verify ID [--from NAME]` | Führt die Pipeline des Worktrees aus (`.fabric/pipeline.json`, Fallback `.fabric/verify.sh` als ein Schritt, Abschnitt „Pipeline“; Timeout 1200 s je Schritt). Der Lauf hängt nicht am Aufrufer: Ein SIGTERM an ihn beendet nur das Warten, der Lauf schreibt seinen Endstatus und die Checks selbst; ein zweiter Aufruf auf demselben Ticket und HEAD wartet auf diesen Lauf (T-143, Abschnitt „Pipeline“). Schreibt `checks` samt `run_id` auf den HEAD. Akteur des `verify`-Ereignisses ist `--from`, Standard: `assignee`. |
| `fab runs [--ticket ID] [--json]` | Pipeline-Läufe lesen, nach `id` aufsteigend, optional auf ein Ticket gefiltert. |
| `fab run show RUN [--step NAME] [--json]` | Einen Lauf mit Schritten, Zuständen, Laufzeiten und gespeicherter Ausgabe zeigen; bei einem Abbruch zusätzlich die Zeile `Grund: Abbruch: …` (Abschnitt „Pipeline“); `--step NAME` beschränkt auf einen Schritt. |
| `fab run rerun RUN` | Denselben Lauf wiederholen: gleicher Worktree, Trigger, Ticket, Repo und Branch auf dem aktuellen HEAD; das Ergebnis ist ein neuer Lauf mit eigener `run_id`. |
| `fab verdict ID pass\|fail [--head SHA] --from NAME "<zusammenfassung>"` | Urteil des Prüfers auf den HEAD. `--head` ist der tatsächlich geprüfte Commit; weicht der Worktree-HEAD davon ab (neuer Commit während der Prüfung), bricht der Befehl ab, statt still auf den ungeprüften HEAD zu buchen. `fail`: Kommentar mit Zusammenfassung, Status `doing`, entfernt `mensch` aus `waiting` (keine Inbox-Frage), weckt `assignee`. `pass`: weckt `assignee` mit dem Hinweis, auf grünen Checks mit `fab handover` zu übergeben. Ist der Prüfer selbst der `assignee`, wird weder bei `pass` noch bei `fail` jemand geweckt. |
| `fab handover ID --from NAME "<zusammenfassung>"` | Übergabe an den Menschen. Gate: `checks.state == pass` und `verdict.state == pass`, beide auf dem aktuellen HEAD. Sonst Abbruch mit den Gründen. Zusätzlich Abbruch, wenn der Diff `base...branch` Logikdateien ändert, aber keine Testdatei; die Meldung nennt die Logikdateien und die aktiven Testmuster. Standardmuster: `fabric/fablib/**/*.py` und `mods/*/**/*.js` (ohne `mods/*/views/**`) für Logik, `fabric/tests/test_*.py` und `mods/*/test/**` für Tests; je Repo über `.fabric/testpolicy.json` übersteuerbar (Abschnitt „Test-Policy“). Danach prüft `fab` den Merge-Stand (Basisreferenz `base_ref` plus Branch, Abschnitt „Basisreferenz“) in einem temporären Worktree (Abschnitt „Merge-Stand“); rote Checks verweigern die Übergabe. Erfolg: Status `review`, `mensch` in `waiting`, Kommentar, Feld `merge` mit `tree`, `base`, `base_ref`, `remote_base`, `branch`, `state` und `at`. |
| `fab accept ID [--pr-only]` | Nur der Mensch. Status `review` (bei `done`: `<id>: bereits angenommen`, Exit 0), keine offenen Unter-Tickets, `repo`/`base`/`branch`/`worktree` gesetzt. Die Abnahme ist wiederaufnehmbar: Sie läuft in den Schritten `pushed`, `pr_merged`, `cleaned`, `done` (PR) bzw. `merged`, `cleaned`, `done` (lokal); jeder erledigte Schritt steht sofort unter `accept.steps`, ein erneuter Aufruf setzt beim nächsten offenen Schritt fort und wiederholt keinen erledigten (Abschnitt „Wiederaufnehmbare Abnahme“). Der PR-Merge-Nachweis kommt aus `gh pr view` (GitHub), nicht aus `ticket.pr.state`; `--pr-only` endet nach `pushed`. Ohne GitHub-Remote oder `gh`-Anmeldung wird lokal mit `--no-ff` gemergt; `--pr-only` bricht dann mit Erklärung ab, ein Issue-Ticket bekommt die Zeile `Issue #N bleibt offen: kein PR-Merge ohne GitHub-Remote/gh`. Im lokalen Weg bricht `fab` ab, wenn das Urteil nicht auf dem aktuellen Worktree-HEAD liegt (neuer Commit nach der Prüfung) oder der Merge-Tree vom geprüften `merge.tree` abweicht (Abschnitt „Merge-Stand“); der PR-Weg prüft den Merge-Nachweis von GitHub und die `mods/*`-Checks. Details stehen unter „Wiederaufnehmbare Abnahme“. Nach `done` startet `fab` automatisch jedes Ticket, das nur noch durch dieses blockiert war und startbereit ist (`todo`, Zuständiger, Repo, Abnahmekriterien) — mit denselben Regeln wie `fab dispatch`. Entwürfe und unvollständige Tickets bleiben liegen; Grund und Startfehler stehen als `dispatch`-Ereignis im Verlauf, die Abnahme bleibt gültig. Rote `mods/*`-Checks nehmen den Merge zurück (lokal `git reset --keep`, PR-Weg Revert-Commit, gepusht nach `<base>`), lassen den Status `review`, behalten Worktree und Branch (auf dem PR-Weg auch den Remote-Branch) und schreiben `Merge zurückgesetzt: …` als `attention` in die Inbox. Erfolg beendet alle Sessions des Tickets — auch solche ohne Eintrag unter `## Sessions`, über das Label `fab.ticket` oder den Terminalnamen `fab-<team>-<agent>-t-<n>`. |
| `fab reject ID "<feedback>"` | Nur der Mensch. Kommentar von `mensch`, Status `doing`, weckt `assignee`. |
| `fab drop ID --from NAME "<grund>"` | Status `dropped`, Sessions beenden (auch ohne Eintrag unter `## Sessions`, per Label `fab.ticket` oder Namen), Worktree bleibt. |
| `fab wake ID NAME --from NAME ["<text>"]` | Wecken von Hand, gleiche Regeln wie bei Erwähnungen |
| `fab tick [--dry-run] [--install\|--uninstall]` | Stillstandswächter (Abschnitt 4b). Ohne Optionen ein Lauf: wecken/starten oder `attention`, sonst nichts; zusätzlich meldet und beendet er lebende Sessions zu `done`/`dropped`-Tickets (per Label `fab.ticket` oder Namen `fab-<team>-<agent>-t-<n>`). Beendete Sessions offener Tickets erkennt er an `hc ls --all`: `state == "finished"` schreibt genau einmal `session_ended` mit Exit-Code, Endzeit und letzten Zeilen; eine nie sichtbare Session meldet `Fehlstart`. Ein `doing`-Ticket ohne lebende Session bekommt dadurch sofort `attention`, ohne die Stillstandsfrist abzuwarten. Jeder echte Lauf schreibt `last_tick`; ist er älter als 5 min, erscheint ein `attention`-Eintrag in der Inbox. `--dry-run` zeigt nur die geplanten Aktionen und schreibt insbesondere kein `last_tick`. `--install` legt den launchd-Agent `~/Library/LaunchAgents/de.herdr.fabric.tick.plist` (Intervall 60 s) an, `--uninstall` entfernt ihn; ohne Auftrag legt der erste `fab`-Aufruf ihn unter macOS selbst an (Abschnitt 4b). Kein `--from`. |
| `fab orchestrator start\|stop\|status [TEAM]` | Orchestrator-Terminal je Team verwalten (Abschnitt 5) |
| `fab autopilot start [--until HH:MM\|done] \| stop \| resume \| status [--json]` | Autopilot-Terminal `autopilot` ohne Parent starten, beenden, eine Pause aufheben oder den Status zeigen; `--json` liefert genau den Inhalt von `$FAB_HOME/autopilot.json`. Ein zweiter Start bei laufendem Terminal bricht mit Meldung ab (Abschnitt 4d). |
| `fab alarm status [--json]` / `fab alarm ack [--json]` | Aktive Alarme bei rotem `main`, pausiertem Autopilot, wiederholt übersprungenen Abnahmen und ausgefallenem `fab tick` zeigen bzw. alle aktuellen quittieren (Abschnitt 4e). `status --json` liefert `{active, count, alarms}`; `ack` gibt `{acked, active, count, alarms}` aus und schreibt `index.json` neu. |
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

`fab handover` prüft nicht nur den Branch-HEAD, sondern den Stand, der beim lokalen Merge entsteht: `git merge-tree --write-tree` berechnet den Tree der Basisreferenz `base_ref` (lokal, sonst `origin/<base>`) plus Branch, ohne Worktree oder Refs zu verändern; `remote_base` hält zusätzlich den `origin/<base>`-SHA fest. Für diesen Tree erzeugt `fab` einen synthetischen Merge-Commit (keine Ref), legt davon einen temporären Worktree an, führt dort die Pipeline aus und entfernt den Worktree wieder — auch bei rotem Lauf oder Abbruch. Der Tree-Hash landet als `merge.tree` samt `base`, `base_ref`, `remote_base`, `branch` und `state` am Ticket.

Der lokale Abnahmeweg berechnet den Tree erneut gegen dieselbe Basisreferenz `base_ref`, bevor er mergt; der PR-Weg gleicht zuerst die Basis nach `git fetch` nach (Abschnitt „Basisreferenz“) und prüft danach denselben `merge.tree`, bevor er pusht oder mergt; ist der PR laut GitHub bereits gemergt, entfällt das Gate. Nach dem PR-Merge prüft `fab` `mods/*`. Im lokalen Weg gilt: Ist der Tree gleich dem geprüften `merge.tree`, gilt Urteil und Abnahme weiter; das Ergebnis des `--no-ff`-Merges wird zusätzlich gegen `merge.tree` geprüft, sonst wird der Merge zurückgesetzt. Weicht der Tree ab, nimmt `fab` lokal nicht ab: es prüft den neuen Merge-Stand (inklusive Checks), verwirft das bisherige Urteil, setzt den Status auf `doing`, entfernt `mensch` aus `waiting` und weckt die Prüferin für ein neues Urteil; sind die Checks rot oder entsteht ein Konflikt, wird stattdessen der Zuständige geweckt. Ohne neues Urteil verweigert `fab handover` wieder. Läuft `main` weiter, ohne den Merge-Tree zu ändern (z. B. ein leerer Commit), bleibt die Abnahme gültig.

Im lokalen Weg kann `fab accept` ohne `merge`-Feld (etwa weil das Ticket vor der Merge-Stand-Prüfung in `review` ging) keinen geprüften Tree vergleichen. Es behandelt das wie einen abweichenden Stand: prüft den Merge-Stand neu, verwirft ein altes Urteil, setzt den Status auf `doing` und weckt die Prüferin. Abgenommen wird erst, wenn für den neu berechneten Stand ein Urteil vorliegt und `merge.tree` dazu passt; so kann kein ungeprüfter Merge durchrutschen.

### Basisreferenz

Für Merge-Stand und Abnahme gibt es genau eine Basisreferenz: `git.base_ref` liefert die lokale Basis `<base>`, wenn sie als Commit existiert, sonst `origin/<base>`; fehlt beides, bricht `fab` ab. `fab handover`, der lokale Abnahmeweg und die Noop-Prüfung rechnen damit, nie mit einer zweiten, abweichenden Basis.

Vor dem Push im PR-Weg gleicht `fab accept` die lokale Basis mit `origin/<base>` ab. Nach `git fetch` gilt:

- Fehlt `origin/<base>`, bleibt die lokale Basis unverändert und wird gepusht.
- Liegt die lokale Basis hinter `origin/<base>` und hat keine eigenen Commits, wird sie per `git merge --ff-only origin/<base>` nachgezogen.
- Andernfalls hat sie eigene Commits über `origin/<base>`; diese dürfen ausschließlich die von `fab` verwalteten Pfade `.fabric/`, `fabric/roster.json`, `fabric/prompts/`, `fabric/templates/` und die App-Konfiguration `settings.json`, `keys.json`, `layouts/` betreffen (`FAB_PATHS` in `fabric/fablib/managed.py:26`). Dann rebased `fab` auf `origin/<base>` (`fabric/fablib/cli.py:1704-1712`) und pusht die Basis mit. Das nimmt die Auto-Commits mit, die `fab` selbst auf main legt: `chore(roster)` aus `fabric/fablib/config.py:172` und `agents.py:56`, `chore(prompt)` aus `prompts.py:137`, `chore(template)` aus `templates.py:127` und `chore: UI-Konfiguration (Autopilot)` für App-Konfiguration aus `fabric/fablib/autopilot.py:432-434`; das Vorlagenziel liegt neben dem Roster (`templates.py:29-34`). Betrifft auch nur eine Datei außerhalb dieser Pfade – etwa `fabric/fablib/x.py` oder ein gemischter Commit –, bricht es vor jedem Push mit `fremde lokale Commits über origin/<base>; nichts gepusht` und der Liste der fremden Dateien ab; die Meldung nennt alle erlaubten Pfade. Ein Rückstand zu `origin/<base>` ist damit kein Abbruchgrund mehr.

### Wiederaufnehmbare Abnahme

`fab accept` legt den Fortschritt unter `accept.steps` am Ticket ab:

```json
{"accept": {"steps": {
  "pushed":    {"at": 1790000000000, "base": "<sha>", "head": "<sha>", "url": "…"},
  "pr_merged": {"at": 1790000000000, "url": "…", "commit": "<sha>"},
  "merged":    {"at": 1790000000000, "commit": "<sha>"},
  "cleaned":   {"at": 1790000000000},
  "done":      {"at": 1790000000000}
}}}
```

Jeder Schritt wird direkt nach Erfolg als eigener CAS-Schreibvorgang gespeichert; bereits erledigte Schritte bleiben auch bei einem späteren Abbruch stehen. Ein erneuter Aufruf liest sie, setzt beim nächsten offenen Schritt fort und wiederholt keinen erledigten; URL und Commit eines vorhandenen Schritts kommen aus `pr` bzw. dem Schritt. Ein `pushed`-Eintrag ist nur gültig, solange der Branch lokal existiert und sein HEAD dem gespeicherten `head` entspricht; sonst wird er verworfen und neu gepusht. Ist der PR laut GitHub gemergt, werden `pushed` und `pr_merged` nicht wiederholt; ein fehlender Branch oder Worktree verhindert die Abnahme dann nicht (Fall T-115: PR gemergt, Branch und Worktree weg, Ticket noch nicht `done`).

Vorbedingungen sind Status `review` (bei `done` meldet `fab` `<id>: bereits angenommen` und endet mit 0), keine offenen Unter-Tickets sowie gesetzte Felder `repo`, `base`, `branch` und `worktree`. Solange der PR nicht laut GitHub gemergt ist, muss das Urteil auf dem aktuellen Worktree-HEAD liegen; sonst bricht `fab` vor jedem Push ab. Ist der PR bereits gemergt (Altticket), entfällt diese Prüfung. Fehlt der Branch und gibt es weder PR-URL noch Merge-Nachweis, bricht `fab` mit `<id>: Branch <branch> existiert nicht und kein PR ist gemergt; nichts abgenommen` ab; auf einem fehlenden Branch läuft nie `git rev-list`.

**PR-Weg** (vorhandene PR-URL oder GitHub-Remote mit `gh`-Anmeldung):

- `pushed`: Vor jedem Push und Merge-Stand-Gate fragt `fab` bei vorhandener PR-URL GitHub nach dem Zustand; `MERGED` überspringt `pushed`, Gate und Urteil, und der Merge-Nachweis entscheidet (Fall T-115). Sonst muss der Branch lokal existieren, sonst bricht `fab` mit einer klaren Meldung ab (kein `unknown revision`). Danach gleicht es die Basis ab (Abschnitt „Basisreferenz“), pusht `<base>` nur, wenn `origin/<base>` fehlt oder vom lokalen Stand abweicht, und pusht den Branch. Die PR-URL stammt aus `pr.url` oder von `gh`; `fab` speichert `pr` als `{"url": …, "state": "open"}`, den Kommentar `PR geöffnet: <url>` und das Ereignis `pr` und trägt `pushed` mit Basis- und Branch-HEAD ein. `--pr-only` endet hier: Status `review`, Worktree und Branch bleiben.
- `pr_merged`: Den Nachweis liefert GitHub über `gh pr view <url> --json state,number,mergeCommit`, nicht `ticket.pr.state`. `MERGED` übernimmt den Merge-Commit von GitHub; `OPEN` mergt `fab` und fragt erneut, muss dann `MERGED` sein; `CLOSED` und andere Zustände brechen mit `PR … ist <state>, nicht gemergt` ab. Danach zieht `fab` die Basis nach und prüft `mods/*`; ist ein Check rot, revertiert es den Merge-Commit von GitHub (nicht die nachgezogene Spitze von `<base>`), pusht `<base>` und speichert den bisherigen Abbruch „herdr-app check rot“. Grün setzt `pr.commit`, schreibt `PR gemergt: <url>` (Kommentar und Ereignis) genau einmal und trägt `pr_merged` mit `url` und `commit` ein.
- `cleaned`: Remote-Branch löschen (ein bereits fehlender ist in Ordnung), alle Sessions beenden, Worktree und lokalen Branch (falls vorhanden) entfernen; `cleaned` speichern.
- `done`: `fab` fragt GitHub erneut und verlangt `MERGED`, sonst Abbruch mit fehlendem Merge-Nachweis; dann Status `done`, `stall` weg, `waiting` leer, Ereignis `accept` `<branch> → <base> via PR <url> @ <kurz>`, `done` speichern, Prüfer-Hinweise wecken. Ausgabe: `<id>: angenommen, <branch> über PR #<number> (<url>) in <base> gemergt (<kurz>); Worktree und Branch entfernt` (ohne Nummer `über PR <url>`), ergänzt um `; <n> Session(s) beendet`.

**Lokaler Weg** (kein GitHub-Remote oder keine `gh`-Anmeldung):

- `merged`: Ist der Merge bereits angewandt (`merge.tree` gesetzt, Branch existiert, `base` enthält den Branch, Tree stimmt), wird der Schritt ohne erneuten Merge eingetragen. Sonst gelten die bisherigen Prüfungen (Worktree-HEAD, Urteil auf diesem HEAD, Haupt-Checkout auf `<base>`, kein Dirty-Überlapp, Tree gegen `base_ref`, `--no-ff`, Tree-Gegenprüfung, `mods/*`); rote Checks setzen per `git reset --keep` zurück.
- `cleaned`: Sessions beenden, Worktree und lokalen Branch (falls vorhanden) entfernen, `origin/<branch>` nur löschen, wenn vorhanden; Schritt speichern.
- `done`: Status `done`, `stall` weg, `waiting` leer, Ereignis `accept` `<branch> → <base> @ <kurz>`, Schritt speichern, Prüfer-Hinweise wecken; Ausgabe wie bisher samt Issue-Hinweis.

Scheitert ein Schritt, bleiben die bereits gespeicherten Schritte stehen; die bisherigen Abbruchpfade (`_accept_merge_changed`, `_accept_check_failed`, „PR gemergt, Aufräumen unvollständig“) behalten ihre Texte und Exit-Codes. Ein bereits gemergter PR gilt als Erfolg.

### Abnahme ohne Änderung

„Ohne Änderung abgeschlossen“ gilt nur, wenn **alle** Bedingungen zutreffen: Der Branch existiert lokal, es gibt keine PR-URL, keinen `pr_merged`-Schritt, `pr.state` ist nicht `merged`, und `git rev-list --count base_ref..branch` ergibt 0 (dieselbe Basisreferenz wie der Merge-Stand). Dann setzt `fab handover` `no_change: true`, schreibt einen Hinweis ans Ticket und braucht weder Checks noch Urteil; der Status geht wie sonst auf `review`. `fab accept` schließt das Ticket als `done` ohne Merge und ohne PR: Es beendet die Sessions, entfernt Worktree, lokalen Branch und `origin/<branch>` (jeweils falls vorhanden), trägt `cleaned` ein, setzt `status` auf `done`, `waiting` leer und `no_change`, schreibt Kommentar und Ereignis `accept_noop` mit „ohne Änderung abgeschlossen“ und trägt `done` ein. `fab show` zeigt „ohne Änderung“. Trifft eine Bedingung nicht zu, nimmt `fab` nie „ohne Änderung“ ab, sondern geht den PR- oder lokalen Weg; der Autopilot prüft die Noop-Bedingung live über `git.branch_exists` und `commit_count`.

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
- Je Schritt gilt ein Timeout von 1200 s. Läuft er ab, endet der Schritt mit Exit 124, an sein stderr wird `Timeout nach <n> s` gehängt, und der Lauf speichert den Grund `Abbruch: Zeitlimit nach <n> s im Schritt <name>`.
- Systemweit laufen höchstens `max_verify` Prüfläufe gleichzeitig (Roster, Standard 2; `fab settings set max_verify N`). Jeder Lauf entsteht zuerst als `queued`, belegt einen Slot und wird erst danach `running`. Ist kein Slot frei, steht einmal je Lauf `Lauf #<id>: in der Warteschlange (max. <n> gleichzeitig)` auf stderr. Die Wartezeit zählt nicht ins Schritt-Timeout: Die Uhr eines Schritts startet erst nach dem Slot-Erwerb.
- Slots sind dauerhafte `flock`-Dateien unter `<FAB_HOME>/verify-slots/slot-<i>.lock`; die Exklusivität liefert der Kernel und gibt die Sperre bei Prozessende frei (auch bei `SIGKILL`). Die Dateien werden nicht gelöscht, die PID darin ist nur Diagnose. `fab runs` und `fab run show` zeigen `queued` als `Warteschlange`; `--json` bleibt bei `queued`. Das Warten hat ein eigenes Zeitlimit: Nach `FAB_VERIFY_WAIT` Sekunden (Standard 1800) endet der Lauf mit `Warteschlange: nach <n> s kein Prüfslot frei (max. <n> gleichzeitig). …` als `fail`, statt zu hängen.
- Zusätzlich hält jeder laufende Prozess die Besitzdatei `<FAB_HOME>/verify-runs/run-<id>.lock`. Belegt der nächste Laufstart sie, ist der Besitzer tot, und er setzt den verwaisten Lauf auf `fail` (Schritte `running` → `fail`, `pending` → `skipped`) samt Grund `Abbruch: verwaister Lauf (Besitzer ohne Endstatus beendet)`; ein lebender Lauf behält seine Sperre und bleibt unberührt. Ohne dieses Aufräumen bliebe ein per `SIGKILL` beendeter Lauf für immer `queued` bzw. `running`. Der Lauf schreibt seinen Endstatus noch vor dem Freigeben der Besitzdatei, und das Aufräumen schreibt nur bedingt auf offene Zustände: Ein inzwischen fertiger Lauf samt Schritten bleibt unangetastet. Wie die Slots werden die Besitzdateien nie gelöscht; es wächst eine je Lauf, die PID darin ist nur Diagnose.
- `fab verify` löst den Lauf von seinem Aufrufer (T-143). Der Aufruf startet den eigentlichen Lauf als eigenes Kind mit `start_new_session=True` (`fabric/fablib/cli.py:1166`) und wartet nur noch auf die Ablage; das Kind schreibt die Lauf-Id nach dem Belegen der Besitzdatei in eine Startdatei (`on_start`, `fabric/fablib/pipeline.py:234`). Darum beendet ein SIGTERM an den Aufrufer, wie ihn das Werkzeug-Zeitlimit eines Agenten sendet, nur den Wartenden: Besitzdatei, Slot und Schritte bleiben beim Kind, und es schreibt Endstatus und `checks` selbst (`_record_verify`, `fabric/fablib/cli.py:1084`; ein schon geschriebener Lauf wird über die `run_id` nicht doppelt verbucht). Ein zweites `fab verify` auf demselben Ticket und HEAD serialisiert nur das kurze Startfenster über `<FAB_HOME>/verify-starts/<ticket>-<head>.lock` (`verifyslots.start_claim`, `fabric/fablib/verifyslots.py:81`), findet den offenen Lauf über `pipeline.open_run` (`fabric/fablib/pipeline.py:398`) und wartet mit `pipeline.wait_run` (`fabric/fablib/pipeline.py:458`) auf dessen Ergebnis, statt einen zweiten Lauf zu starten. Stirbt der Lauf selbst, erkennt der Wartende den toten Besitzer und räumt ihn wie ein Laufstart auf – ein echter Abbruch bleibt ein Abbruch. Die Ausgabe des gelösten Laufs steht in `<FAB_HOME>/verify-runs/run-<id>.log`; `fab verify` gibt den gespeicherten `tail` aus.
- Jeder Lauf speichert einen Grund `reason` (T-127). Bei `pass` und bei einem gewöhnlichen roten Test ist er leer. Ein Abbruch beginnt mit `Abbruch:` und nennt die Art: `Zeitlimit nach <n> s im Schritt <name>` (Schritt-Timeout), `Signal <n> im Schritt <name>` (der Schrittprozess selbst wurde per Signal beendet), `verwaister Lauf (…)` (Aufräumen aus der Besitzdatei), `Abbruch: unterbrochen (<Ausnahme>)` (Ausnahme mitten im Lauf, etwa `KeyboardInterrupt`; gesetzt in `fabric/fablib/pipeline.py:299`) oder den von `run_parallel.py` erkannten Testabbruch `Signal <n> in <datei>`. Als Testabbruch zählt beides: der Testdatei-Prozess selbst wurde per Signal beendet, oder ein Test scheitert an einem per Signal beendeten Unterprozess (negativer Rückgabewert, im Traceback `-15 != 0`). Der Läufer wiederholt diese Datei genau einmal; bleibt auch der zweite Versuch ein Signal, endet er mit Exit 3 und der Zeile `Abbruch: Signal <n> in <datei>` und zeigt die Ausgabe der Datei in einem `ABBRUCH`-Block, damit ein echter Fehlschlag nicht verschwindet. `fab run show RUN` zeigt den Grund als Zeile `Grund: Abbruch: …`; `--json` enthält ihn als `reason`.
- Ein solcher Signalabbruch ist nicht im Repo verursacht (T-127): Der einzige SIGTERM-Sender im Repo ist `preview._terminate`, und er signalisiert ausschließlich die eigene, per `start_new_session` isolierte Gruppe nach Prüfung von Startzeit, PGID und cwd/Marker (T-106). `hc kill` beendet mit SIGHUP, `subprocess.run(timeout=…)` mit SIGKILL; Testhilfen signalisieren nur eigene Kinder. In den belegten Fällen (#199/#201/#202) starb jeweils genau ein `fab new`-Kind, während die Suite und ihre Geschwister weiterliefen — es war also ein einzelnes `kill(pid, SIGTERM)` von außerhalb des Prüfbaums. Eine Instrumentierung mit `si_pid`-Protokoll im SIGTERM-Empfänger fand in fünf vollen Läufen keinen fremden Absender; Kandidat außerhalb ist ein pid-basierter `kill` eines Agenten-Werkzeugs nach PID-Wiederverwendung. Solche Signale werden deshalb als Abbruch abgefangen und mit Grund festgehalten, nicht als Testfehler gewertet.
- Nach dem ersten fehlgeschlagenen Schritt werden alle folgenden als `skipped` gespeichert, ohne ausgeführt zu werden; der Lauf endet `fail`, `code` ist der Exit des ersten Fehlschlags, sonst 0. `tail` sind die letzten 20 Zeilen der kombinierten Ausgabe.
- Auslöser (`trigger`): `verify` (`fab verify` und Merge-Stand), `main` (Haupt-Checkout), `repo-test` (`fab repo test`) und `autopilot`.
- Gespeichert werden je Lauf `id`, `ticket`, `repo`, `worktree`, `branch`, `head`, `trigger`, `state`, `started_at`, `duration_ms`, `reason`; je Schritt `position`, `name`, `command`, `state`, `duration_ms`, `exit_code`, `stdout`, `stderr`. Jeder Lauf hat eine `run_id`; `fab runs`, `fab run show RUN` und `fab run rerun RUN` arbeiten darauf.
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

Der Kontext des Team-Orchestrators bleibt begrenzt. Zähler und Leerlauf werden per SQL aus der Tabelle `events` gelesen; den Zustand eines frischen Starts hält `fab` je Team als JSON in der Tabelle `meta` fest. Ein Neustart ist `hc kill` auf das laufende Orchestrator-Terminal und ein frischer `fab orchestrator start`, gefolgt von einem `orchestrator`-Ereignis mit `text: "neu gestartet"` und `reason` (Zähler oder Leerlauf). Das Ereignis setzt den Zähler zurück.

- **Zähler:** Gezählt werden erfolgreiche `fab dispatch`-Aufrufe mit `--from orchestrator` seit dem letzten Start; Dispatch-Versuche mit `Start fehlgeschlagen` zählen nicht. Beim nächsten Wecken mit `@orchestrator` startet `fab` neu, statt `hc send` an die alte Session zu richten; die Weckernachricht geht an die neue Session. Schwelle `orchestrator_dispatches` (Standard 5, 0 schaltet ab).
- **Leerlauf:** `fab tick` startet einen laufenden Orchestrator neu, wenn sein Terminal nicht `working`/`blocked` ist und seit `orchestrator_idle_minutes` (Standard 30, 0 schaltet ab) weder ein fab-Aufruf noch eine Ausgabe beobachtet wurde. Ausgabe kommt aus `hc get` (`status_ms`, sonst `created_ms`), fab-Aufrufe aus Ereignissen mit `actor: "orchestrator"` des Teams. Wartet ein offenes Ticket auf ihn (letzte Erwähnung ohne spätere Reaktion oder `orchestrator` in `waiting`), bleibt er stehen; `--dry-run` nennt den geplanten Neustart nur.
- **Schlaflücke:** Liegt `last_tick` mehr als 10 Minuten zurück (mehr als das Tick-Intervall, etwa nach Systemschlaf), wertet `fab tick` das nicht als Leerlauf: Die Leerlauf-Zählung beginnt neu (Meta `orchestrator_idle_reset:<team>` auf jetzt), der Orchestrator wird nicht neu gestartet, und erst ab dieser neuen Basis zählt `orchestrator_idle_minutes`. Dasselbe gilt für einen offenen Startzustand (`pending`): Eine vor dem Schlaf erfolgte Antwort wird zuerst erkannt, löscht den Startzustand und setzt die Leerlauf-Basis ebenfalls auf den Aufwachzeitpunkt; ohne Antwort beginnt die Frist beim Aufwachzeitpunkt neu (nur `at` rückt auf jetzt, Versuch und Terminal bleiben), statt dass `retry` oder „Start ohne Antwort“ folgt. Jeder Abstand von mindestens 10 Minuten seit dem letzten Tick gilt als Schlaf – auch wenn der Wächter nicht läuft und `fab tick` nur von Hand aufgerufen wird; diesen Fall deckt der Tick-Alarm (`stale`, älter als 5 Minuten) ab.
- **Startfrist:** Jeder Neustart – Leerlauf wie Zähler – merkt sich Versuch, Zeitpunkt und Terminal als JSON in `orchestrator_start:<team>`. Als beantwortet gilt der Start, wenn innerhalb von 5 Minuten ein fab-Ereignis mit `actor: "orchestrator"` des Teams auftritt oder `hc ls` für das Terminal `working`/`blocked` meldet; `status_ms`/`created_ms` allein zählen nicht. Nach einer Schlaflücke beginnt diese Frist beim Aufwachen neu.
- **Zweiter Versuch:** Bleibt die Antwort aus, startet der nächste fällige `fab tick` genau einmal erneut (Grund `Start ohne Antwort: zweiter Versuch`).
- **Meldung:** Bleibt auch der zweite Versuch 5 Minuten ohne Antwort, schreibt `fab tick` ein `orchestrator`-Ereignis mit `text: "Start ohne Antwort"` und legt einen `attention`-Alarm in der Inbox an (`reason: "Start ohne Antwort"`, Alarm `kind: "orchestrator"`, Text `Orchestrator <team>: Start ohne Antwort nach <n> Versuchen – Terminal prüfen`, sortiert nach main und Pause vor `tick`). Ein dritter Start folgt nicht; `fab orchestrator status` zeigt „Start ohne Antwort“ statt des Terminal-Status (nicht „idle“). `fab orchestrator start|restart|stop` und ein neuer Orchestrator-Start im Weckpfad löschen den Zustand.
- Der Zähler gilt je Team; `fab settings set … --team NAME` schreibt `orchestrator.dispatches` bzw. `orchestrator.idle_minutes` in das Team. `--dry-run` nennt geplante Neustarts und Meldungen nur und schreibt weder `meta` noch Ereignisse.

## 4d. Autopilot `fab autopilot`

`fab autopilot start` startet die Schleife als hc-Terminal `autopilot` ohne Parent im Haupt-Checkout. `--until HH:MM` setzt die Endzeit (heute, sonst morgen), `--until done` beendet erst, wenn nichts mehr offen ist. `stop` beendet das Terminal, `resume` hebt eine Pause auf, `status` zeigt den Status; `status --json` gibt genau die Statusdatei aus.

Die Schleife läuft alle 120 s:

- **Abnahme:** Der Autopilot ruft `fab accept` auf; dieses prüft den Ablauf selbst (Abschnitt „Wiederaufnehmbare Abnahme“). Nur ohne begonnene Abnahme (`accept.steps` leer und `pr.state` nicht `merged`) gilt davor das Gate: `checks` und `verdict` `pass` auf dem aktuellen HEAD des Worktrees (`head(worktree)`); bei `no_change` zählen live `git.branch_exists` und `commit_count` über der Basis. Bei begonnener Abnahme entfällt das Gate, damit ein abgebrochener Lauf (etwa nach `pr_merged` oder `cleaned`) beim nächsten Lauf fortsetzt. Das Haupt-Checkout muss in beiden Fällen sauber sein; uncommittet dürfen nur die Pfade aus `CONFIG_PATHS` sein: `fabric/roster.json`, `fabric/prompts/` und die App-Konfiguration `settings.json`, `keys.json`, `layouts/` (`fabric/fablib/managed.py:19-28`). `ensure_clean_main` committet sie als `chore: UI-Konfiguration (Autopilot)` (`fabric/fablib/autopilot.py:430-438`), ohne den Inhalt zu vergleichen oder zu normalisieren; `is_config_path` prüft Einträge mit `/` als Präfix und Dateien exakt (`managed.py:31-49`).
- **Blockierter main:** Trägt main daneben eine andere uncommittete Datei (etwa `README.md`) oder eine Mischung, wird nichts committet, `ensure_clean_main` gibt `False` zurück und die Abnahme entfällt (`fabric/fablib/autopilot.py:440-453`). Je Autopilot-Runde zählt das höchstens einmal: `begin_round`/`end_round` sammeln die Beobachtungen aller review-Tickets eines Durchlaufs (`autopilot.py:293-312`, `986-1009`); ein Aufruf außerhalb von `once()` zählt sofort als eigene Runde (`440-448`). Zähler, Pfade und Repo liegen unter dem Meta-Schlüssel `autopilot_skip` (`autopilot.py:40-41`, `314-389`); ab `SKIP_ALARM_ROUNDS = 3` (`autopilot.py:40`) erscheint der Alarm `skip:<since>` mit allen blockierenden Pfaden (Abschnitt 4e), und der Autopilot weckt den Orchestrator genau einmal je Episode (`autopilot.py:370-386`, `405-415`, `fabric/fablib/wake.py:195-217`). `refresh_skip` prüft zu Beginn jeder Runde das gespeicherte Repo und löscht den Zustand, sobald dort keine uncommitteten Pfade mehr stehen (`autopilot.py:391-403`, `988`) – auch ohne abnahmebereites Ticket; ebenso löscht `ensure_clean_main` bei sauberem main oder erfolgreichem Konfigurations-Commit (`autopilot.py:357-368`, `426-429`, `436-438`).
- **main nach dem Merge:** `.fabric/verify.sh` im Haupt-Checkout. Rot ⇒ ein zweiter Lauf nach 60 s. Bleibt es rot, entscheidet der gespeicherte Grund des zweiten Laufs (`pipeline.run()["reason"]`, Abschnitt „Pipeline“): Beginnt er mit `Abbruch:` (Zeitlimit, Signal, verwaister Lauf), gibt es keinen Revert. Sonst nimmt `autopilot._revert_main` (`fabric/fablib/autopilot.py:603-660`) den Merge-Commit an HEAD (`git revert -m 1`) zurück, wenn HEAD ein Merge-Commit ist und höchstens ein First-Parent-Commit über `origin/main` liegt: 0, wenn der PR-Weg den Merge schon gepusht hat, 1, wenn der lokale Weg ihn noch nicht gepusht hat. Danach folgt `git push origin main`; der Revert liegt damit auch auf `origin/main`, und lokales `main` und `origin/main` bleiben gleich. Mehr als ein First-Parent-Commit (fremde lokale Commits) oder ein HEAD, der kein Merge-Commit ist, führen zu keinem Revert. Scheitert der Fetch oder der Push, wird nichts gepusht; einen bereits angelegten lokalen Revert verwirft `git reset --keep` auf den Stand davor. In jedem Rot-Fall pausiert der Autopilot (`fabric/fablib/autopilot.py:842-851`); die Pause hängt nicht am Exit-Code des Reverts. Der Pausengrund steht in `autopilot.json` (`reason`) und im Pausenalarm, der Hauptalarm ergänzt ihn als `– Grund: …` (`fabric/fablib/alarm.py:107-150`); ein `@orchestrator`-Kommentar am Ticket weckt den Orchestrator, damit er die Pause ohne Menschen auflösen kann.
- **Konflikt:** Scheitert `fab accept` an einem Merge-Konflikt, geht genau ein Hinweis je HEAD an den Zuständigen.
- **Rückfragen:** Steht `mensch` in `waiting` (außer bei `review`), geht einmal je Ticket die Entscheidungsbitte an den Orchestrator.
- **Stillstand:** Ohne lebende Session und ohne Ereignis seit 20 min wird der Zuständige geweckt (höchstens dreimal, dann der Orchestrator); zwischen Weckungen liegen mindestens 30 min.
- **Verteilen:** Offene `todo` ohne Blocker stoßen höchstens alle 30 min einen Orchestrator-Hinweis an.

Statusdatei `$FAB_HOME/autopilot.json` (Standard `data/fabric/autopilot.json`): `state` (`running`/`paused`/`stopped`), `reason`, `end` (ISO `YYYY-MM-DDTHH:MM`, leer bei `done`), `updated_at` (ms), `paused_since` (ms, Beginn der laufenden Pause; leer außerhalb von `paused`), `last_action`, `log` und `pid`. Weitere Felder dürfen hinzukommen; Leser ignorieren Unbekanntes. Die Pausemarke liegt daneben in `autopilot-pause`, das Log in `autopilot.log`.

## 4e. Alarme

`fab alarm status [--json]` und `fab alarm ack [--json]` lesen und quittieren den Alarmzustand in `index.json["alarm"]`. Abgeleitet wird aus fünf Quellen:

- **main rot:** Der jüngste Pipeline-Lauf mit `trigger == "main"` endet `fail`. Schritt ist der erste fehlgeschlagene Schritt, das Ticket kommt aus dem Lauf oder aus dem Betreff von `git log -1 --format=%s <head>` (`T-<n>`). „zurückgenommen“ wird nur gemeldet, wenn `git log -n 50 --format=%B` im Repo `This reverts commit <head>` enthält. Nach einem grünen main-Lauf ist der Alarm weg.
- **Pause:** `autopilot.json` steht auf `paused`; `since` ist `paused_since`, sonst `updated_at`, und `text` nennt den gespeicherten `reason`. Bei aktivem main-Alarm erscheint die Pause nicht als eigener Alarm, weil der main-Alarm `resume` anbietet; der main-Alarm übernimmt den Pausengrund als `reason` und im Text (`– Grund: …`).
- **skip:** `autopilot.skip_state()` liefert `count`, `paths`, `since`, `notified` und `repo`; solange `count < SKIP_ALARM_ROUNDS` (3, `fabric/fablib/autopilot.py:38`), gibt es keinen Alarm. Ab der Schwelle trägt `skip:<since>` die Uhrzeit des ersten Skips, die Anzahl der übersprungenen Runden und alle blockierenden Pfade, die `git.pending_paths` (`fabric/fablib/git.py:80`) gemeldet hat, im Text (`fabric/fablib/alarm.py:174-197`); einsortiert ist er nach der Pause und vor Orchestrator und tick (`alarm.py:17`). `refresh_skip` löscht den Zustand zu Beginn jeder Autopilot-Runde, sobald das gespeicherte Repo sauber ist (`fabric/fablib/autopilot.py:389-401`, `917`); ebenso tun das sauberer main oder ein erfolgreicher Konfigurations-Commit in `ensure_clean_main` (`autopilot.py:355-366`, `425-427`, `434-436`). Damit fällt der Alarm aus `fab alarm status` und der Inbox.
- **orchestrator:** Ein Orchestrator-Start, der ohne Antwort endgültig scheitert, erscheint als `orchestrator:<team>:<at>` mit `reason: "Start ohne Antwort"` (`fabric/fablib/alarm.py:223-257`, Abschnitt 4c).
- **tick:** `store.tick_alarm()` ist `stale` (älter als 5 min); `since` ist `last_tick`, der Text nennt das Alter.

Jeder Alarm trägt eine stabile `id` (`main:<run>`, `pause:<since>`, `skip:<since>`, `orchestrator:<team>:<at>`, `tick:<last_tick>`), `at`, `since`, `ticket`, `run`, `step`, `reverted`, `paused`, `reason`, `text` und `actions`. Lampe und Banner lesen `alarms`; der Toast dedupliziert über dieselbe `id` wie der Inbox-Eintrag `attention:<id>`. `fab alarm ack` quittiert **alle** aktuell abgeleiteten Alarme, auch die bei main unterdrückte Pause, und speichert die IDs dedupliziert (höchstens 100) unter dem Meta-Schlüssel `alarm_ack`; ein neuer main-Lauf hat eine neue `id` und löst wieder aus.

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
5. Bei `pass` übergibt der Umsetzer mit `fab handover`. Der Mensch entscheidet im Mod (`accept` oder `reject`). Ist `origin` ein GitHub-Remote und `gh` angemeldet, öffnet und mergt `fab accept` einen PR; `fab accept --pr-only` öffnet ihn nur. Die Abnahme läuft in Schritten (`accept.steps`); bricht ein Lauf ab, setzt ein erneuter Aufruf beim nächsten offenen Schritt fort, ohne Erledigtes zu wiederholen.
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
