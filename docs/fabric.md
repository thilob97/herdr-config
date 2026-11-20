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
| Orchestrator-Arbeitsordner | `~/.herdr/fabric-orchestrator/` (bekommt `AGENTS.md` aus `fabric/prompts/orchestrator.md` bei jedem Start) | — |

`fab` findet seinen Code über den eigenen Pfad (Symlink `~/.local/bin/fab` → `fabric/fab` ist erlaubt). Der Mod ruft immer den absoluten Pfad `${appHome()}/fabric/fab` auf.

## 2. Daten (`$FAB_HOME`)

```
tickets/T-<n>.json   ein Ticket, Schema unten
counter              nächste Nummer (Ganzzahl), nur unter Lock gelesen/geschrieben
events.jsonl         Ereignislog, nur anhängen
index.json           Lesemodell für den Mod, nach JEDER Änderung atomar neu geschrieben (tmp + rename)
lock                 flock für alle Schreibvorgänge
```

IDs kommen aus `counter`, nie aus dem Dateinamen-Maximum: `T-1`, `T-2`, …

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
  ]
}
```

- `status`: `draft` → `todo` → `doing` → `review` → `done`; daneben `dropped`. Zeiten in Epoch-Millisekunden.
- Felder ohne Wert: `null` bzw. `[]`. Kein Feld fehlt. Unbekannte Felder bleiben beim Schreiben erhalten.
- `checks`/`verdict` gelten nur, solange `head` dem aktuellen HEAD des Worktrees entspricht.
- `attachments`: nur Bilder (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`), abgelegt von `fab attach` unter `data/fabric/attachments/<ID>/`. `path` ist relativ zur App-Wurzel (`~/.config/herdr-app`), damit der Mod ihn als Bild laden kann; im Body und in Kommentaren steht derselbe Pfad als Markdown-Bildlink `![name](path)`.

### Ereignis (eine Zeile in `events.jsonl`)

```json
{"at": 1790000000000, "kind": "comment", "ticket": "T-1", "actor": "zap", "target": "ada", "text": "…"}
```

`kind` ∈ `created edited status assigned comment wake dispatch verify verdict handover accept reject drop orchestrator`.
`target` nur bei `wake` (wer geweckt wird), `assigned` (wem) und `dispatch` (welcher Agent); sonst `""`.
Bei `wake` steht in `text` genau eines von: `geweckt`, `gestartet`, `an orchestrator`, `unterdrückt: <grund>`.

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
     "sessions": [{"agent": "zap", "name": "fab-zap-t-1", "terminal": "t9a"}]}
  ],
  "inbox": [
    {"kind": "question", "ticket": "T-1", "at": 0, "from": "zap", "text": "…"},
    {"kind": "review", "ticket": "T-2", "at": 0, "from": "zap", "text": "Zusammenfassung"},
    {"kind": "attention", "ticket": "T-3", "at": 0, "from": "fab", "text": "Ping-Pong zwischen zap und ada"}
  ],
  "roster": [{"name": "zap", "role": "umsetzer", "color": "c1"}],
  "events": [ "die letzten 300 Ereignisse, älteste zuerst" ]
}
```

- `inbox` wird **nur** in `fab` berechnet: `question` = Ticket nicht done, `mensch` in `waiting`; `review` = Status `review`; `attention` = Wecken unterdrückt durch Ping-Pong-Bremse oder Start fehlgeschlagen, solange danach nichts Neues im Ticket passiert ist.
- Pro Ticket höchstens **ein** Eintrag aus `question` und `review`: Steht das Ticket auf `review`, gilt nur `review`, `question` entfällt (auch wenn `mensch` in `waiting` steht). `attention` darf daneben stehen.
- Der Mod zählt nichts selbst: Inbox-Zahl = `inbox.length`, Stufen = Tickets nach `status`.
- `index.json` bleibt unter 1 MiB: Ticket-Einträge ohne `body` und ohne `comments`, höchstens 300 Ereignisse.

## 3. CLI

Alle Befehle schreiben unter Lock, hängen Ereignisse an und erzeugen danach `index.json` neu. Fehler: Exit-Code ≠ 0, deutsche Meldung auf stderr. `--json` liefert maschinenlesbare Ausgabe, wo angegeben.

| Befehl | Wirkung |
|---|---|
| `fab new "<satz>" [--repo PFAD] [--from NAME]` | Ticket `draft`, Titel = Satz (max. 80 Zeichen), Body `## Auftrag\n<satz>`. `--repo` Standard: Git-Wurzel des aktuellen Ordners, sonst `null`. Danach automatisch Kommentar von `--from` (Standard `mensch`): `@orchestrator bitte ausformulieren und verteilen` → weckt den Orchestrator. Gibt die ID aus. |
| `fab list [--status S] [--json]` / `fab show ID [--json]` | lesen |
| `fab edit ID [--title T] [--body T \| --body-file F] [--repo PFAD] [--base B] --from NAME` | ändern |
| `fab status ID STATUS --from NAME` | Statuswechsel. `done` nur über `accept`. |
| `fab assign ID NAME --from NAME` | Zuständigen setzen (Roster-Name) |
| `fab link ID --blocked-by ID… --from NAME` | Abhängigkeiten, ohne Zyklen. `--remove ID…` entfernt sie; fällt die letzte weg, startet `fab` das Ticket wie nach einer Abnahme (Abschnitt `fab accept`). |
| `fab comment ID --from NAME [--no-wake] "<text>"` | Kommentar; jede `@erwähnung` weckt (Abschnitt 4). Gibt pro genanntem Namen eine Zeile mit dem Ergebnis aus. |
| `fab attach ID DATEI [--no-edit] [--from NAME]` | Bild als Anhang: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` (Groß/klein egal). Kopiert nach `data/fabric/attachments/<ID>/<name>` (Name aus der Datei, bereinigt; gleicher Inhalt wird wiederverwendet, sonst `-2`, `-3`, …). Gibt die Zeile `![<name>](data/fabric/attachments/<ID>/<name>)` aus, hängt den Anhang an `attachments` und standardmäßig den Link an den Body; `--no-edit` lässt den Body unverändert. Akteur: `--from`, Standard `mensch`. |
| `fab dispatch ID [--agent NAME] --from NAME` | Verlangt `repo`, einen Abschnitt `## Abnahmekriterien` und keine offenen `blocked_by`. Legt Branch `fab/<ID>-<slug>` vom aktuellen HEAD des Repos und den Worktree an, startet den Agenten (Abschnitt 5), Status `doing`. Läuft er schon für das Ticket: wecken statt starten. |
| `fab verify ID [--from NAME]` | Führt `<worktree>/.fabric/verify.sh` aus (fehlt sie: Fehler mit Pfad), `sh` im Worktree, Timeout 10 min. Schreibt `checks` auf den HEAD. Akteur des `verify`-Ereignisses ist `--from`, Standard: `assignee`. |
| `fab verdict ID pass\|fail --from NAME "<zusammenfassung>"` | Urteil des Prüfers auf den HEAD. `fail`: Kommentar mit Zusammenfassung, Status `doing`, weckt `assignee`. `pass`: weckt `assignee` mit dem Hinweis, auf grünen Checks mit `fab handover` zu übergeben. Ist der Prüfer selbst der `assignee`, wird weder bei `pass` noch bei `fail` jemand geweckt. |
| `fab handover ID --from NAME "<zusammenfassung>"` | Übergabe an den Menschen. Gate: `checks.state == pass` und `verdict.state == pass`, beide auf dem aktuellen HEAD. Sonst Abbruch mit den Gründen. Erfolg: Status `review`, `mensch` in `waiting`, Kommentar. |
| `fab accept ID` | Nur der Mensch. Merge `--no-ff` des Branch in `base` im Haupt-Checkout (der muss auf `base` stehen; uncommittete Änderungen bleiben erlaubt, solange sie keine Datei des Branchs berühren — sonst Abbruch mit den betroffenen Dateien), beendet alle Sessions des Tickets, entfernt Worktree und Branch, Status `done`. Danach startet `fab` automatisch jedes Ticket, das nur noch durch dieses blockiert war und startbereit ist (`todo`, Zuständiger, Repo, Abnahmekriterien) — mit denselben Regeln wie `fab dispatch`. Entwürfe und unvollständige Tickets bleiben liegen; Grund und Startfehler stehen als `dispatch`-Ereignis im Verlauf, die Abnahme bleibt gültig. |
| `fab reject ID "<feedback>"` | Nur der Mensch. Kommentar von `mensch`, Status `doing`, weckt `assignee`. |
| `fab drop ID --from NAME "<grund>"` | Status `dropped`, Sessions beenden, Worktree bleibt. |
| `fab wake ID NAME --from NAME ["<text>"]` | Wecken von Hand, gleiche Regeln wie bei Erwähnungen |
| `fab orchestrator start\|stop\|status` | Orchestrator-Terminal verwalten (Abschnitt 5) |
| `fab agents [--json]` | Roster und laufende Sessions |
| `fab inbox [--json]` | wie `index.json.inbox` |
| `fab index` | `index.json` neu erzeugen |

`--from` ist bei allen schreibenden Befehlen außer `new`, `accept`, `reject` und `verify` Pflicht. `verify` nimmt `--from NAME` optional; Standard ist der `assignee`. `accept` und `reject` schreiben als `mensch`.

## 3b. Konfiguration und Pflege (für das UI)

Das UI pflegt alles über diese Befehle. Alle schreiben atomar (tmp + `os.replace`), lassen unbekannte Felder stehen, schreiben ein Ereignis `config` (`text` = was geändert wurde), erzeugen `index.json` neu und verlangen `--from` (das UI übergibt `mensch`). Fehler: deutsche Meldung auf stderr, Exit ≠ 0. Schreibbefehle committen ihre eigenen Dateien gezielt selbst — Roster als `chore(roster): …`, Promptdatei als `chore(prompt): …` —, aber nur wenn der Checkout auf seinem Basis-Branch steht; andere Änderungen bleiben uncommittet, und außerhalb eines Git-Repos wird nichts committet.

| Befehl | Wirkung |
|---|---|
| `fab roster --json` | Kompletter Roster: `max_sessions`, `reviewer`, `orchestrator {argv, prompt}`, `agents[] {name, role, color, argv, prompt}` und je Agent die abgeleiteten Felder `program` (= `argv[0]`), `model` (Wert von `--model=`/`--model`), `flags` (übrige argv), `open_tickets`, `sessions` (laufende Terminals mit `name`, `terminal`, `status`) |
| `fab agent add NAME --role R [--color cN] --argv-json JSON [--prompt-text T] --from N` | Neuer Agent. Name `^[a-z][a-z0-9_-]{0,15}$`, eindeutig, nicht `orchestrator`/`mensch`/`fab`; Farbe `c1`–`c6`, sonst die nächste freie; `argv` nicht leer. Legt `prompts/<name>.md` an (Text oder kurze Vorlage). |
| `fab agent edit NAME [--rename NEU] [--role R] [--color cN] [--argv-json JSON] [--prompt-text T] --from N` | Ändern. `--rename` nur, wenn kein offenes Ticket den Agenten nennt (`assignee`) und keine Session läuft; benennt die Promptdatei mit um und passt `reviewer` an. |
| `fab agent rm NAME --from N` | Entfernen. Verweigert bei offenen Tickets, laufender Session oder wenn er `reviewer` ist (Gründe in der Meldung). Die Promptdatei bleibt erhalten. |
| `fab settings set KEY VALUE --from N` | `max_sessions` (1–16), `reviewer` (Roster-Name), `orchestrator_argv` (JSON-Liste, nicht leer) |
| `fab prompt list --json` | `[{name, kind: orchestrator\|preamble\|agent, path, bytes, placeholders: [...]}]` |
| `fab prompt show NAME` | Rohtext (`orchestrator`, `preamble` oder Agentname) |
| `fab prompt set NAME --text T --from N` | Speichern. Bei unbekannten Platzhaltern (nicht in Abschnitt 5) Warnung auf stderr, gespeichert wird trotzdem. |
| `fab orchestrator status --json` | `{live, name, terminal, status, started_at}`. `status` = herdr-Status aus `hc ls --json`, sonst `null` |
| `fab orchestrator restart --from N` | stop + start |
| `fab repos --json` | Bekannte Repos aus Tickets und `--add PFAD…` (das UI gibt die Space-Ordner mit): `[{path, branch, open_tickets, verify_exists, lessons_exists}]`, nur Git-Wurzeln, ohne Doppelte |
| `fab repo show PFAD --json` | `{path, branch, verify: {exists, text}, lessons: {exists, text}}` |
| `fab repo set PFAD verify\|lessons --text T --from N` | Schreibt `.fabric/verify.sh` (ausführbar) bzw. `.fabric/lessons.md` im Haupt-Checkout. Verweigert außerhalb einer Git-Wurzel. |
| `fab repo test PFAD [--json]` | Führt `.fabric/verify.sh` im Haupt-Checkout aus (Timeout 600 s): `{exit, tail}` |
| `fab link ID --remove ID… --from N` | Abhängigkeiten entfernen |
| `fab new "<satz>" [--repo PFAD] [--from NAME] [--no-wake]` | wie oben; `--no-wake` legt nur den Entwurf an, ohne `@orchestrator`-Kommentar |
| `fab version` | Version (Datum + Git-HEAD des Fabric-Codes) |

`index.json.roster` enthält je Agent `{name, role, color, program, model}`. Das UI liest den vollständigen Roster bei Bedarf über `fab roster --json`.

## 4. Wecken durch Erwähnung

Erwähnung = `@name`, Muster `@([a-z][a-z0-9_-]*)`, ohne Beachtung der Groß-/Kleinschreibung. Pro Kommentar wird jeder Name höchstens einmal geweckt. Für jeden genannten Namen gilt in dieser Reihenfolge:

1. Name = Autor → nichts.
2. `--no-wake` → nichts.
3. `mensch` → kein Wecken. `mensch` kommt in `waiting`, das Ticket erscheint in der Inbox.
4. Ticket `done` oder `dropped` → `unterdrückt: abgeschlossen`.
5. Ping-Pong-Bremse: mehr als 8 Weckungen desselben Ziels im selben Ticket innerhalb von 10 min → `unterdrückt: ping-pong`. Der Orchestrator bekommt beim ersten Mal genau eine Nachricht, die Inbox einen `attention`-Eintrag.
6. `orchestrator` → das Terminal `fab-orchestrator` wecken. Läuft es nicht, wird es gestartet (`gestartet`).
7. Roster-Agent → sein Terminal für dieses Ticket (Name `fab-<agent>-<id klein>`) wecken (`geweckt`). Läuft es nicht und hat das Ticket einen Worktree: den Agenten im Worktree starten (`gestartet`, Abschnitt 5). Hat das Ticket keinen Worktree: Nachricht an den Orchestrator (`an orchestrator`).
8. Unbekannter Name → `unterdrückt: unbekannt`.

Ein geweckter Agent bekommt per `hc send <terminal> "<text>"` (bei Fehlschlag noch einmal mit `--force`):

> Ticket {id} „{title}“: @{autor} hat dich erwähnt: „{kommentar, max. 300 Zeichen}“. Lies `fab show {id}`, arbeite an diesem Ticket weiter und antworte im Ticket mit `fab comment {id} --from {name} "…"`.

Jedes Ergebnis wird als `wake`-Ereignis geschrieben, auch jede Unterdrückung. Ist `mensch` erwähnt, gibt es zusätzlich das Ereignis `comment` mit `target: ""`; die Inbox liest `waiting`. `waiting` wird geleert, sobald der Wartende im Ticket kommentiert.

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
  `hc run --bg --json --name fab-<agent>-<id klein> --cwd <worktree> --label fab.agent=<agent> --label fab.ticket=<ID> --no-parent --outlive-parent <argv…> "<startprompt>"`.
  Der Startprompt ist `prompts/preamble.md`, gefolgt vom Rollenprompt `prompts/<agent>.md` und dem Ticket (`fab show`-Text). Platzhalter in `preamble.md`: `{id} {title} {agent} {role} {worktree} {branch} {base} {reviewer}`.
- Ist `argv[0]` des Agenten (oder des Orchestrators) `claude`, markiert `fab` vorher das Startverzeichnis (Worktree bzw. Orchestrator-Ordner) als vertraut: `projects["<realpath>"].hasTrustDialogAccepted = true` in `~/.claude.json`. Es wird nur dieser eine Schlüssel geändert; alle anderen Felder bleiben unverändert. Geschrieben wird atomar (tmp im selben Ordner, gleiche Dateirechte, `os.replace`); hat sich die Datei seit dem Lesen geändert, wird bis zu 3-mal neu gelesen. Fehlt die Datei oder ist sie kein gültiges JSON: Warnung auf stderr, Start läuft trotzdem. Pfad über `$FAB_CLAUDE_JSON`, Standard `~/.claude.json`; Tests setzen immer eine Temp-Datei.
- Ist `max_sessions` erreicht (arbeitende oder auf Antwort wartende `fab-*`-Terminals ohne Orchestrator), wird nicht gestartet. Ergebnis: `unterdrückt: voll`, dazu ein `attention`-Eintrag. Status `working`/`blocked` zählt; `idle`/`done` nicht, und Sessions von `done`/`dropped`-Tickets zählen nicht mehr. Ohne Statuswort gilt eine Session als beschäftigt.
- Laufend heißt: `hc ls --json` führt ein Terminal mit diesem Namen und `state == "live"`. `fab agents` zeigt je Session das Statuswort, damit untätige Sessions erkennbar bleiben.
- `fab orchestrator start`: Kopiert `prompts/orchestrator.md` nach `~/.herdr/fabric-orchestrator/AGENTS.md` und startet `hc run --bg --name fab-orchestrator --cwd ~/.herdr/fabric-orchestrator --label fab.role=orchestrator --no-parent --outlive-parent <argv…> "Du bist der Fabric-Orchestrator. Lies AGENTS.md und dann fab inbox und fab list."`.
- Alle `hc`-Aufrufe gehen über eine einzige Funktion, die Tests durch einen Stub auf dem `PATH` ersetzen.

## 6. Ablauf, den die Prompts beschreiben

1. Der Mensch: `fab new "<satz>"`. Das weckt `@orchestrator`.
2. Der Orchestrator formuliert aus (`fab edit`: Ziel, Kontext, Abnahmekriterien, Grenzen), setzt `repo`, weist zu (`fab assign`), stellt auf `todo`, verteilt (`fab dispatch`). Entscheidungen, die beim Menschen liegen, stellt er als Kommentar mit `@mensch`.
3. Der Umsetzer arbeitet im Worktree, committet, führt `fab verify` aus und schreibt bei Grün `@<reviewer> bitte prüfen`.
4. Der Prüfer liest `git diff <base>...HEAD` und die Abnahmekriterien, kommentiert Befunde und gibt `fab verdict` ab. Bei `fail` wird der Umsetzer automatisch geweckt, bei `pass` ebenfalls (mit dem Hinweis auf `fab handover`). Ist der Prüfer selbst der Zuständige, wird niemand geweckt.
5. Bei `pass` übergibt der Umsetzer mit `fab handover`. Der Mensch entscheidet im Mod (`accept` oder `reject`).
6. Fragen und Absprachen laufen nur im Ticket, mit `@name`. Kein `hc send` zwischen Agenten, keine Seitenkanäle.

## 7. Mod `fabric`

Ein einziger Mod, mehrfach im Layout, Ansicht über `props().view`:

| `view` | Inhalt |
|---|---|
| `tickets` | Eingabe „Neues Ticket in einem Satz…“ (→ `fab new`, Repo = Git-Wurzel von `focused().cwd`). Liste nach Stufe: Entwurf, Geplant, In Arbeit, Prüfung, Fertig (eingeklappt). Klick → Detail: Kopf (ID, Titel, Status, Zuständiger, Branch, Chips für Checks und Urteil), Body, Verlauf (Autor, Zeit, Text, `@erwähnungen` hervorgehoben, `wake`-Ergebnisse dazwischen als kleine Zeilen), Kommentarfeld (→ `fab comment --from mensch`). Bei `review`: **Abnehmen** (→ `fab accept`) und **Zurück mit Feedback** (→ `fab reject`). |
| `inbox` | `index.inbox`, neueste oben. Klick → `setShared("fabric.selected", id)` und Ticket-Ansicht zeigen. Die Zahl hängt als Badge am Kopf. |
| `timeline` | Ereignisse aus `index.events` als chronologischer Feed, neueste oben und nach Tagen gruppiert. Je Zeile: Akteur, Satz („weckte ada“, „änderte den Status“, „urteilte“), Ticket-ID, Uhrzeit, Art-Punkt; `wake` nennt das Ziel im Satz. Die Auswahl grenzt auf ein Ticket ein, „Alle“ zeigt wieder alle. Klick auf eine Zeile wählt das Ticket. |

- Der Mod liest nur `index.json` und `tickets/<ID>.json` (`readTextFile`). Er beobachtet `data/fabric` mit `watchFolder`, mit einem 5-s-Timer als Rückfall.
- Geschrieben wird nur über `exec("${appHome()}/fabric/fab", […])`. Der Mod schreibt nie selbst in Ticket-Dateien.
- Gemeinsamer Zustand: `shared("fabric.selected")` (gewähltes Ticket).
- Aufbau: `main.js` (View, verteilt nach `view`), `model.js` (reine Logik ohne herdr-/gpui-Importe: Gruppieren, Kürzel, Zeitformat, Erwähnungen markieren, Zeitverlauf-Feed: Tagesgruppen und Ereignissätze), `ui.js` (Token und Bausteine), `views/*.js`. `model.js` hat node-Tests.
- Texte deutsch. Farben nur über `theme()`. Status- und Stufenwörter stehen genau einmal in `model.js`.
- Layout `layouts/fabric.json`: Klon von `main`. Im Stack `panel-body` die Kinder `fabric-tickets` (`{"mod":"fabric","props":{"view":"tickets"}}`) und `fabric-timeline`, `files` und `changes` bleiben. In der Seitenleiste unter `agents` ein Block `fabric-inbox`; über `agents` der Block `fabric-agents` (Mod `fabric-sidebar`: eigener Abschnitt „Fabric“ mit Orchestrator, Rolle/Status/Laufzeit, Ticket-Chip). Der Block `agents` nutzt den Klon `agents-filtered` der mitgelieferten Liste: Er blendet Fab-Terminals (Labels `fab.agent`/`fab.role`, Name `fab-*`) samt Subagenten aus, die übrigen Agenten bleiben. `main.json` und die mitgelieferte Liste bleiben unverändert. Beleg: `docs/assets/t14-fabric-filtered.png` (nur der normale Agent), Vergleich `docs/assets/t14-main-unfiltered.png` (dieselben Fab-Agenten in der normalen Liste von `main`). Tasten in `keys.json`: Panel Tickets und Timeline umschalten, Fokus auf „Neues Ticket“.
