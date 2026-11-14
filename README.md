# herdr-config

Meine Konfiguration für die [Herdr](https://herdr.dev) Desktop-App. Das Repo ist direkt `~/.config/herdr-app`.

## Regel für Agents

Nach **jeder** Änderung an dieser Config sofort committen und pushen (`git add -A && git commit && git push`).

Neue Panel-Mods (Seitenleisten wie Git-Graph, Timeline) **nicht** als eigene Spalte andocken, sondern in die Leiste oben neben Files/Changes:

1. In `layouts/elric.json` dem Stack `panel-body` ein Kind geben: `{ "id": "<id>", "type": "block", "content": { "mod": "<mod>" } }`.
2. In `mods/tabs-graph/main.js` einen Eintrag `{ id, label, icon, key, tip }` in `WERKZEUGE` (Werkzeuge) bzw. `FABRIK` (Fabrik-Flächen) ergänzen. Damit gibt es den Knopf in der passenden Panel-Gruppe und das Kommando `tabs-graph.panel-<id>`; in `keys.json` unter `layout:elric` die nächste freie `cmd-alt-<n>`-Taste darauf legen (`key` = `<n>`).
3. In der `mod.json` des Mods `"place": "none"` setzen, und einen Block, den Herdr selbst angedockt hat, aus dem Layout entfernen.

Forge, `open-with`, die `over9k*`-Mods und `usage-limits` sind entfernt (keine Mods, Layouts oder Tasten mehr). Laufzeitdaten unter `data/` bleiben liegen.

## Was getrackt wird

| Datei | Zweck |
|---|---|
| `programs.json` | Ergänzt Herdrs eingebaute Programmtabelle (u. a. `omp` / Oh My Pi mit Name, Icon und Eintrag im +-Menü) |
| `settings.json` | Zoom, Fonts, Sounds |
| `keys.json` | Tastenbelegung |
| `layouts/`, `themes/`, `mods/` | Nur eigene Layouts, Themes und Mods, inkl. Klone und `*-edited`-Kopien |

## Was ignoriert wird

Die `.gitignore` ist eine Whitelist (`/*`, dann gezielt `!`). Ausgeschlossen sind:

- **Was Herdr selbst schreibt:** `AGENTS.md`, `*.d.ts`, `icons/`, `frame/`, `view.json`, `shared.json`, `data/`, `telemetry/`, Socket, Status-Dateien.
- **Ausgelieferte Layouts, Themes und Mods** (`main`, `terminals`, `win98`, die mitgelieferten Themes, alle Standard-Mods). Herdr überschreibt sie bei jedem Start.
- `layouts/.state/` (Klick-Einstellungen), `*.error`, `*.reset-*`, `*.old-*`.

## Hinweise

- Bringt ein Herdr-Update neue eigene Mods, Layouts oder Themes mit, tauchen sie als ungetrackte Dateien auf. Dann in der `.gitignore` ergänzen.
- Ausgelieferte Dateien nicht direkt ändern, sondern klonen:
  `herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`
  bzw. `herdr-app do mod.clone '{"name":"files","as":"my-files"}'`.
- Falls `keys.json` bei unveränderter Belegung ständig als geändert auftaucht, schreibt Herdr sie beim Start neu. Dann aus dem Repo nehmen.

## Mods

Aktiv ist das Layout `elric` (Klon von `main`), daneben `quests`. Eigene Mods:

| Mod | Zweck |
|---|---|
| `space-folders` | Spaces nach Maschine und Ordner in der Seitenleiste (extern, siehe unten) |
| `agent-cards` | Die eine Agent-Darstellung (Klon von `agents`): Karten mit Avatar, Status, OMP-Modell, Kontext, Kosten, Sub-Agents; Mehrfachauswahl mit Auswahlleiste; veröffentlicht `shared("agents.identity")`, siehe Seitenleiste |
| `sidebar-footer` | Kopf der Seitenleiste (Logo, Suche, ein-/ausklappen) und ihr Fuß als eine Icon-Zeile: Einstellungen, Marketplaces, MCP-Server, Maschine hinzufügen, Tastenkürzel (Klon von `workspace-chrome`), siehe Seitenleiste |
| `tabs-graph` | Tab-Leiste (Klon von `tabs`): Tabs, „+“ direkt dahinter, rechts **Auftrag**, **Inbox** mit Zähler, **Review**, dann die Panels als zwei Gruppen *Fabrik* (Quests, Team) und *Werkzeuge* (Changes, Git, Tree, Blueprint, Docker); das offene zeigt seinen Namen, Tooltip mit Taste |
| `status-bar` | Statusleiste (Klon von `workspace-status`): Maschine und Branch, Limits, Kosten heute, Team-Budget-Chip |
| `inbox` | Freigabe-Stelle (Popup): Rückfragen, Abnahmen, Fertiges, siehe Agent-Zentrale |
| `review` | Review-Fenster: Abnahme eines Tickets (Ticket-Modus) oder Änderungen eines Agents, siehe Agent-Zentrale |
| `toast-review` | Benachrichtigungen (Klon von `toast`, im Layout-Root als `"toast"` gesetzt) mit Review-Knopf bei fertigen Agents |
| `cheatsheet` | Tastenkürzel-Übersicht (Dialog), live aus `keys.json`, deutsch beschriftet und gruppiert, filterbar |
| `launcher` | Auftrag-Dialog: „Ans Team“ (an den Orchestrator) oder „Selbst starten“ mit Prompt-Vorlagen aus `mods/launcher/templates/*.md`, siehe Agent-Zentrale |
| `orchestra` | Team-Panel: Pipeline der Tickets, Orchestrator (Agent, der Tickets anlegt, verteilt und prüft), Teams, Budgets, siehe Agent-Zentrale |
| `quests` | Ticket-Eingang (GitHub, Asana, Trilium, lokal), siehe Quests |
| `docker` | Panel mit Containern, Compose-Gruppen und Aktionen |
| `marketplaces`, `mcp-servers` | Fenster für Agent-Plugin-Marketplaces und MCP-Server je Host, Maschine und Projekt |
| `blueprint`, `filetree`, `file-icons`, `git-graph` | Extern, siehe unten |

## Agent-Zentrale

**Wartende Agents:** `status-bar` merkt sich, seit wann jeder Agent in seinem Status ist (`shared("attention.since")`). `cmd-j` springt zum nächsten Agent, der wartet: erst *blocked*, dann *done*, jeweils der älteste zuerst; erneut drücken geht weiter. Funktioniert über alle Spaces und Maschinen, aber nur in Layouts mit `status-bar` (`elric`, `quests`). Die einzige Wartet-Zahl außerhalb der Inbox ist der Zähler am Inbox-Knopf der Tab-Leiste.

Die Oberfläche folgt einer Fabrik: **Eingang** (Auftrag-Dialog, Quests) → **Stationen** (Team-Panel: Geplant › In Arbeit › Prüfung › Fertig) → **Gates** (Checks, Review-Fenster) → **Output mit Nachweisen** (Review-Fenster: Mergen, PR, Abnehmen). Was auf dich wartet, sammelt die **Inbox**. Agents selbst stehen nur in der Seitenleiste; alle anderen Stellen zeigen sie als Chip (Avatar und Name aus `shared("agents.identity")`, Status), ein Klick geht hin.

**Auftrag** (`cmd-shift-n` oder Knopf **Auftrag** in der Tab-Leiste) ist der einzige Eingang für neue Arbeit, ein Dialog mit zwei Modi (Umschalter oben; Standard „Ans Team“, wenn ein Orchestrator läuft):

- **Ans Team:** ein Textfeld, **An das Team** schickt es an den Orchestrator (`hc send orchestrator`; wartet er auf eine Antwort, mit `--force`). Läuft keiner, steht dort ein Hinweis aufs Team-Panel.
- **Selbst starten:** Vorlage, Space (bestimmt Maschine und Ordner), ein oder mehrere Agents (mehrere = je einer pro Agent, parallel), wo: neuer Tab im Space oder je ein eigener Git-Worktree unter `~/.herdr/worktrees/<repo>/` mit eigenem Space (bei mehreren Agents bekommt der Branch `-<agent>` angehängt). Tab-Name und erste Nachricht sind vorbelegt; `{folder}`, `{branch}`, `{branchnote}` und `{space}` werden beim Start ersetzt. Gestartet wird über `herdr-app do tab.new|space.new`. „Als Team beobachten“ legt aus den gestarteten Agents ein Team an.

Aufrufe mit Ticket (aus Quests): `openOverlay({ mod: "launcher", kind: "dialog", width: 860, height: 680, props: { mode: "team" | "self", ticket } })` füllt Text, Tab-Namen und Branch vor. Was daraus gestartet wird, gibt der Dialog über `shared("quests.handover")` an Quests zurück (siehe Quests).

**Vorlagen** sind Markdown-Dateien in `mods/launcher/templates/` (getrackt), Kopf `name:` (Anzeige) und `tab:` (Tab-Name, Branch-Präfix), darunter die Nachricht. Mitgeliefert: Bug fixen, Feature bauen, Code-Review, Tests schreiben, Codebase erklären, Refactoring. Neue Datei = neue Vorlage beim nächsten Öffnen.

**Inbox** (`cmd-shift-j` oder Knopf **Inbox** in der Tab-Leiste) ist die eine Freigabe-Stelle, in dieser Reihenfolge: **Rückfragen** (Agents, die warten, auch der Orchestrator), **Abnahmen** (Tickets in Prüfung), **Fertig** (fertige Agents), darunter abgedimmt **Arbeitet**. Der Zähler im Kopf ist derselbe wie am Inbox-Knopf: wartende Agents (+1, wenn der Orchestrator fragt) plus Tickets in Prüfung, sonst die Zahl der fertigen. Rechts der Bildschirm des gewählten Agents bzw. Orchestrators (`hc read`, alle 2,5 s neu) mit Antwortfeld, bei einem Ticket Zusammenfassung, Gates und Nachweise mit **Prüfen**. Ein Auftrag „Ans Team“, für den noch kein Ticket existiert, steht bis zu 15 Minuten als Zeile **beim Orchestrator** unter *Arbeitet* (Klick öffnet das Team-Panel). Der Kopf zählt als Badge, die Tastenhinweise sind kurz. `↑/↓` wählen, `↵` hingehen bzw. prüfen, `r` antworten (über `hc send`; bei *blocked* mit `--force`, die Antwort beantwortet seinen Dialog), `v` Review (bei *done*).

**Review-Fenster**, zwei Modi:

- **Ticket-Modus** (Knopf **Prüfen** im Team-Panel oder in der Inbox; `props.ticket`): Titel, Gate-Chips (`Checks ✓/✗/–`, `Review offen`, `abgenommen`), die Zusammenfassung des Orchestrators und die Nachweise (Klick öffnet die Datei; Bildnachweise als 48-px-Vorschau), darunter der Diff des Ticket-Branches gegen seine Basis (auch wenn der Agent schon beendet ist). Unten die Abnahme: **Mergen**, **PR**, **Änderungen …** (Feedback an den Orchestrator, das Ticket geht zurück auf „in Arbeit“) und **Nur abnehmen**. Das Ergebnis steht im Fenster; nach dem Mergen oder Abnehmen ersetzt es die Fußleiste, die dann nur noch **Schließen** anbietet. Die Fußleiste ist mit **Abnahme** beschriftet. Über den Nachweisen steht die **Prüfung**: Gate-Chip, **Letzte Zeilen** (der aufgezeichnete Auszug, aufklappbar) und **Prüfung erneut ausführen** (`hub verify <id>` im Worktree des Tickets).
- **Terminal-Modus** (`cmd-shift-r` oder Knopf **Review** in der Tab-Leiste für das fokussierte Terminal; aus der Inbox, von einer Agent-Karte oder per Knopf am Toast „… ist fertig“): Git-Änderungen im Ordner des Agents, auch auf entfernten Maschinen. Dateiliste mit +/−, Diff, Branch mit ↑/↓. Die Kopfzeile nennt das Ticket, an dem der Agent arbeitet; die Fußleiste heißt **Arbeit am Agent**. Aktionen: **Commit** (`git add -A` + `git commit`, Nachricht mit Tab-Namen vorbelegt), **Feedback senden** (`hc send`), **Zum Agent**, **Changes-Panel** (wählt Space und öffnet `changes`), **Worktree entfernen** (nur unter `~/.herdr/worktrees/`, öffnet den mitgelieferten Worktree-Dialog).

Toasts sind deutsch und nennen die Identität („Dash wartet auf dich“, „Quill ist fertig“) mit Identitäts-Chip; **Review** ist ein Icon-Knopf. Das Review-Fenster vergleicht Branches mit ihrem Abzweig von der Ticket-Basis, `origin/HEAD`, `main` oder `master` (Kopf: „gegen main · N Commits“); auf dem Haupt-Branch selbst zeigt es nur Uncommittetes. **Commit** gilt nur Uncommittetem.

**Team** (Panel, `cmd-alt-7` oder Knopf **Team**): im Kopf die Pipeline `Geplant n › In Arbeit n › Prüfung n › Fertig n` (Klick springt zur Sektion; Prüfung in Pink, sobald etwas auf dich wartet; Zähler ab 100 als `99+`, bei Platzmangel nur belegte Stufen, der Tooltip nennt alle). Alle vier Stufen bleiben sichtbar, leere sagen es („Nichts in Prüfung.“). Genau ein **Prüfen** ist primär (das älteste Prüf-Ticket), die übrigen sind sekundär; die Budget-Chips tragen einen Stift und erhöhen beim Klick. Darunter die Orchestrator-Karte, dann die Tickets nach Stufe: **Prüfung** (Zusammenfassung, Gate-Chips und **Prüfen**), **In Arbeit** (am Ende die Budget-Chips), **Geplant**, die **Teams** und, eingeklappt, **Fertig**. Jedes Ticket zeigt seinen Agent als Chip, Branch, Gates und `$ausgegeben / $Budget`; ein Klick geht zum Agent. Teams (`shared("orchestra.groups")`, angelegt aus der Auswahl in der Seitenleiste oder vom Auftrag-Dialog) zeigen Fortschritt pro Mitglied, „alle fertig“, Beobachten an/aus und Auflösen. Die Statusleiste beobachtet die Teams, auch wenn das Panel zu ist: Hat ein Mitglied gearbeitet und arbeitet bzw. wartet keins mehr, kommt einmal „Team … ist fertig“ mit Ton.

**Orchestrator** (Karte oben im Team-Panel): ein eigener Agent (Standard omp, umschaltbar über den Agent-Namen auf der Karte), der immer läuft: ein unsichtbarer Block `orchestra-daemon` (0 px, in der Statuszeile von `elric`) startet ihn, wenn keiner läuft, außer er wurde mit **Anhalten** gestoppt (dann bietet die Karte **Starten**). Er hat kein eigenes Tab; **Öffnen** zeigt sein Terminal (Peek), die Karte seinen Schritt bzw. seine letzte Nachricht. Fragt er dich etwas, erscheint auf der Karte und in der Inbox ein Antwortfeld. Aufträge bekommt er über den Auftrag-Dialog. Er arbeitet in `~/.herdr/orchestrator` mit den Anweisungen aus `mods/orchestra/orchestrator.md` (bei jedem Start als `AGENTS.md`/`CLAUDE.md` kopiert) und hat `mods/orchestra/bin/hub` im PATH:

- `hub ticket new|list|show|set` legt Tickets als lokale Quests-Tickets an (`data/quests/tickets/*.md`, Feld `by: orchestrator`; Quests-Quelle „Lokal“ ist dafür eingeschaltet). Quests behält die zusätzlichen Felder (`machine`, `agent`, `assignee`, `blocked_by`, `tags`, `waiting`, `branch`, `worktree`, `terminal`, `checks`, `evidence`, `by`, `updated` …) beim Bearbeiten.
- **Tickets sind der einzige Weg, auch untereinander.** Arbeit bekommt ein Agent nur über `hub ticket next <agent>` bzw. den Auftrag im Ticket; erledigt wird nur, was im Ticket steht. Fragen, Blocker und Übergaben sind Kommentare im Ticket: `hub ticket comment <id> --from <rolle> "text @agent"` (Rolle `orchestrator`, Agent-Name oder `mensch`; `@name` wird als Tag gespeichert, neueste unten im Abschnitt `## Verlauf`). Antworten stehen im selben Ticket; neue Arbeit ist ein neues Ticket mit `--blocked-by` auf das auslösende. `hub ticket assign <id> <agent>` weist zu, `hub ticket link <id> --blocked-by <id>…` setzt Abhängigkeiten, `hub ticket inbox <agent>` zeigt, wer genannt, wem zugewiesen ist und wer auf eine Antwort wartet (`hub ticket watch <id> --on <agent>`), `hub ticket list --agent <name> --json` filtert. `hub ticket show` zeigt den Verlauf; er überlebt `review` und `done`. Chat an andere Agents ist verboten, `hc send` bleibt für „du bist fertig“ und „du bist blockiert, Ticket X“ sowie den Hinweis „Ticket <id>: neue Nachricht“.
- **Verlauf in der Oberfläche:** Das Team-Panel zeigt an jeder Ticket-Zeile die letzten zwei Kommentare (Rolle · Zeit · Text, `@Tags` pink), „alle“ klappt den ganzen Verlauf auf. Das Review-Fenster im Ticket-Modus zeigt den Verlauf unter der Zusammenfassung, darunter das Feld „Kommentar an @agent…“, das `hub ticket comment <id> --from mensch` aufruft. Die Inbox führt offene Fragen (`@mensch` im letzten Kommentar bzw. `waiting`) unter **Rückfragen**: ↵ oder **Ticket öffnen** geht ins Review-Fenster, das Antwortfeld schreibt den Kommentar ins Ticket statt ins Terminal. `hub status` hat die Spalte `Verlauf` (Zahl der Kommentare).
- `hub dispatch <id> [--agent omp|claude|codex]` legt einen Worktree `~/.herdr/worktrees/<repo>/<branch>` an (auch `--on <maschine>` über `hc exec`) und startet den Agent dort mit `hc run` als Kind des Orchestrators, in einem eigenen Herdr-Space, mit dem Ticket als erster Nachricht. Es verweigert den Start, solange ein Vorgänger aus `blocked_by` nicht `done` ist, und nennt ihn. Das Präambel-Ticket nennt das Ticket als einzige Quelle und die Kommentar-Regeln; Rückfragen und Ergebnisse laufen als Ticket-Kommentare, `hc send` nur für fertig/blockiert.
- `hub verify <id>` führt die Prüfung des Repos aus: `<worktree>/.herdr/verify.sh` (sonst das Ticket-Feld `verify`), mit `sh`, im Worktree und auf der Maschine des Tickets. Es schreibt ins Ticket `checks: pass|fail`, `checks_head` (Worktree-HEAD), `checks_at`, `checks_duration`, `checks_exit`, `checks_cmd` und unter `## Prüfung` die letzten 20 Zeilen. Fehlt das Skript, endet es mit Pfad und Hinweis. `hub gate <id> [--json]` sagt, ob der Lauf noch zählt.
- `hub review <id> --summary … --evidence <pfad> [--evidence <pfad>]…` übergibt erst geprüfte Arbeit an dich: Das Ticket rückt in **Prüfung** und in die Inbox (Abnahmen), mit Zusammenfassung, Gate-Chips und Nachweisen (`evidence`, Dateipfade), dazu Meldung und Ton. Das **Gate** verweigert den Übergang, solange `checks` nicht `pass` ist oder der Lauf älter als der letzte Commit im Worktree ist, und nennt `hub verify`; `--force --reason "…"` überfährt es und schreibt den Grund in den Verlauf. `--checks` gibt es nicht mehr: der Agent belegt nichts selbst. **Prüfen** öffnet das Review-Fenster im Ticket-Modus.
- **Mergen** (`hub land <id> --merge`) mergt den Branch mit `--no-ff` in seine Basis (der Branch, auf dem das Repo beim Verteilen stand, Feld `base`), beendet den Agent, entfernt Worktree und Branch und sagt es dem Orchestrator. Voraussetzung: Worktree committet, Haupt-Checkout sauber und auf der Basis. Bei einem Konflikt wird der Merge abgebrochen und das Ticket mit Auftrag zum Rebase an den Orchestrator zurückgegeben. **PR** (`hub land <id> --pr`) pusht den Branch nach `origin` und öffnet mit `gh pr create` einen Pull Request (Text aus der Zusammenfassung); Branch bleibt, Worktree und Agent gehen. **Nur abnehmen** (`hub done`) setzt `done` ohne Merge.
- **Kosten und Budget:** Alle 30 s liest der Watcher über `mods/agent-cards/helpers/omp-cards.py` die Kosten der omp-Sitzungen von Ticket-Agents und Orchestrator, rechnet sie den Tickets zu und schreibt `data/orchestra/costs.json` (auch in `hub status`). Die Karte zeigt die Orchestrator-Kosten, jedes Ticket `$ausgegeben / $Budget`, am Ende von „In Arbeit“ `$3/Ticket` und `Team $x / $20` (anklicken zum Ändern; gespeichert in `shared("orchestra.budget")`). Über dem Ticket-Budget wird dessen Agent angehalten (`hc interrupt`) mit Meldung und **+$…** zum Freigeben; über dem Team-Budget (offene Tickets + Orchestrator) werden alle Ticket-Agents und der Orchestrator angehalten. Kosten melden nur omp-Agents.
- Der Orchestrator mergt und pusht nie ohne ausdrückliches OK. Endet ein Zug von ihm (Antwort oder Rückfrage), kommt die Meldung „Orchestrator meldet sich“ bzw. „… braucht dich“.

**Aus Quests:** Im Quests-Panel beim Drüberfahren über ein Ticket **Orchestrator** (Auftrag-Dialog „Ans Team“) und **Start** („Selbst starten“), in der Detailansicht **An Orchestrator** und **Start**. Der Dialog ist mit dem Ticket vorbelegt; lokale Tickets werden direkt die des Orchestrators (`by: orchestrator`), GitHub, Asana und Trilium bekommt er mit Text, Link und dem passenden lokalen Checkout (aus den Spaces) und legt sie mit `hub ticket new --source <url>` an. Läuft zu einem Ticket schon ein Agent, bietet die Zeile **Zum Agent** (primär) und **An Orchestrator**, kein **Start**. Quests zeigt als Zustand dieselbe Pipeline-Stufe wie Team und Inbox (Geplant, In Arbeit, Prüfung, Fertig); die Inbox-Zeile **beim Orchestrator** überbrückt die Zeit bis zum Ticket.

**Tastenkürzel** (`cmd-/` oder **Tastenkürzel** unten in der Seitenleiste): alle Belegungen aus `keys.json`, gruppiert und filterbar; Herdrs eigene Liste bleibt auf `cmd-shift-/`. Neue Mod-Kommandos bekommen ihre deutsche Beschreibung in `DESC` in `mods/cheatsheet/main.js`, sonst erscheint der Befehlsname.

| Taste | Wirkung |
|---|---|
| `cmd-j` | nächster wartender Agent |
| `cmd-p` | Suche (Picker) |
| `cmd-,` | Einstellungen |
| `ctrl-shift-m` | Marketplaces |
| `ctrl-shift-y` | MCP-Server |
| `cmd-shift-j` | Inbox |
| `cmd-shift-r` | Review für das fokussierte Terminal |
| `cmd-shift-t` | neuer Tab mit `omp` |
| `cmd-/` | Tastenkürzel-Übersicht |
| `cmd-shift-n` | Auftrag (Ans Team oder Selbst starten) |
| `cmd-shift-b` | rechtes Panel ein/aus (`elric`) |
| `cmd-alt-1` … `cmd-alt-7` | Panel Changes, Git, Tree, Blueprint, Docker, Quests, Team (`elric`; erneut drücken schließt) |

## Prüfungen

Kein Ticket kommt in **Prüfung**, ohne dass die Prüfung des Repos gelaufen ist. Der Agent belegt sie nicht selbst mit `--checks`: `hub` führt sie aus, protokolliert sie am Ticket, und nur dieser Lauf kommt durchs Gate.

**Das Skript.** `hub verify <id>` sucht `<worktree>/.herdr/verify.sh` und führt es mit `sh` aus — auf der Maschine des Tickets, im Worktree, gegen dessen HEAD. Fehlt es und ist kein Ticket-Feld `verify` gesetzt, endet der Befehl mit dem Pfad und dem Hinweis darauf. `hub ticket new` legt im Zielrepo nichts an: Beim ersten Ticket schreibt der Agent `.herdr/verify.sh` selbst (Tests, Lint, `herdr-app check` — was das Repo eben prüft), committet es und lässt `hub verify` laufen. Danach ist es Teil des Repos und gilt für alle Tickets.

**Das Protokoll** steht im Frontmatter (`checks: pass|fail`, `checks_head`, `checks_at`, `checks_duration`, `checks_exit`, `checks_cmd`) und im Abschnitt `## Prüfung` des Tickets: eine Kopfzeile `- <zeit> · pass · <dauer> s · exit <code> · HEAD <kurz> · <befehl>` und die letzten 20 Zeilen der Ausgabe im Code-Block. Exit 0 heißt `pass`, alles andere `fail`; `hub verify` endet nach einem protokollierten Lauf mit 0 (das Ergebnis steht im Ticket), ohne Lauf mit 1.

**Das Gate.** `hub review` verweigert den Übergang nach **Prüfung**, solange `checks` nicht `pass` ist oder `checks_head` nicht der letzte Commit im Worktree ist (`git rev-parse HEAD`); die Meldung nennt `hub verify <id>`. Nach einem neuen Commit ist ein alter grüner Lauf also ungültig. `hub gate <id> [--json]` zeigt denselben Befund. `--force --reason "…"` überfährt das Gate und schreibt den Grund als Eintrag in den `## Verlauf`.

**In der Oberfläche** zeigt der Gate-Chip im Team-Panel und im Review-Fenster `Checks ✓ · 3.2s · HEAD abc1234` bzw. rot den Grund (`nicht geprüft`, `Exit 1`, `neuer Commit`). Im Review-Fenster steht über den Nachweisen die Zeile **Prüfung** mit **Letzte Zeilen** (Auszug aufklappen) und **Prüfung erneut ausführen** (`hub verify <id>`).

## Rahmen: Seitenleiste, Tab-Leiste, Statusleiste

**Seitenleiste.** Der **Kopf** (42 px, bündig mit der Tab-Leiste) zeigt Logo, „Herdr“, Suche (`cmd-p`) und Ein-/Ausklappen; er kommt aus dem eigenen Mod `sidebar-footer` statt aus dem ausgelieferten `workspace-chrome`. Der **Fuß** ist eine 28-px-Zeile (bündig mit der Statusleiste) mit Icon-Knöpfen für Einstellungen (`cmd-,`, mit Punkt, wenn ein Update bereitliegt), Marketplaces (`ctrl-shift-m`), MCP-Server (`ctrl-shift-y`), Maschine hinzufügen und Tastenkürzel (`cmd-/`); eingeklappt (Rail) bleiben Einstellungen und „…“ mit den übrigen vier. **Spaces** nehmen nur so viel Höhe, wie sie brauchen (Kopf, eine 28-px-Zeile je Space, Ordner oder Maschine), höchstens 40 % der Listenhöhe, darüber scrollen sie; den Rest bekommen die Agents. Kopf „Spaces n“ mit „Neuer Ordner“ und „Neuer Space (⌘N)“; Maschinen-Zeilen sind Sektionsköpfe; Kachelfarben kommen aus dem Theme.

**Agent-Karten** sind die eine Agent-Darstellung: Avatar · Name · Space · Statusanzeige, darunter Tab bzw. Titel und seit wann der Status gilt, bei omp eine dritte Zeile mit Modell, ctx (mit Balken) und Kosten. Der fokussierte Agent hat den pinken Rahmen. Statusanzeige wie überall: Spinner = arbeitet, pulsierender Punkt = wartet, Punkt = fertig, Ring = ruhig. Sektionen „Wartet auf dich“, „Arbeitet“, „Fertig“, „Ruhig“, „Angeheftet“; der Uhr-Knopf im Kopf sortiert „Nach Dringlichkeit“ oder „Nach Space“. Beim Drüberfahren: **Review** (Änderungen dieses Agents im Review-Fenster), **Unterbrechen** und **Mehr (…)** mit Plugins, MCP-Server, Anheften/Lösen und Umbenennen (dasselbe Menü per Rechtsklick). **Mehrfachauswahl:** ⌘-Klick wählt Karten aus (Häkchen statt Avatar); darunter erscheint die Auswahlleiste: „n ausgewählt · aufheben“, Nachricht an die Auswahl (wartende nur mit „auch wartende“, das beantwortet ihre Frage), **Unterbrechen** und **Als Team beobachten** (legt „Team HH:MM“ an, sichtbar im Team-Panel unter Teams). `agent-cards` veröffentlicht Name, Avatar und Programm jedes Agents in `shared("agents.identity")` (`{ "<adresse>": { name, avatar, program } }`); Team-Panel, Inbox, Review und Toasts zeigen damit denselben Namen, Umbenennen ändert ihn überall.

**Tab-Leiste.** „+“ steht direkt hinter dem letzten Tab und öffnet einen Tab (Terminal oder Agent), wie im Browser. Rechts: der Primärknopf **Auftrag** (`cmd-shift-n`, der eine Eingang für neue Arbeit), **Inbox** mit Zähler (Rückfragen plus Tickets in Prüfung; wartet nichts, die fertigen Agents in deren Farbe), **Review** als Icon (`cmd-shift-r`), dann die Panel-Gruppen *Fabrik* (Quests, Team) und *Werkzeuge* (Changes, Git, Tree, Blueprint, Docker). Tabs sind 28 px hoch und zeigen den Status wie überall.

**Statusleiste.** Links Ort (Maschine) und Branch, rechts Limits als Chips, „$x heute“ und der Chip **Team $x / $y** (Kosten offener Tickets + Orchestrator gegen das Team-Budget, darüber in Wartet-Farbe); ein Klick darauf öffnet das Team-Panel, dort änderst du das Budget. Die Hover-Karte heißt „Kosten und Limits“. Die Team-Beobachtung („Team … ist fertig“) läuft hier, auch wenn das Team-Panel zu ist.

**Werkzeug-Panels und Fenster.** Alle Panel-Köpfe sehen aus wie bei Changes (42 px, Titel links, rechts höchstens drei Icon-Knöpfe mit Tooltip); Umschalter sind einheitliche Segmente (Git: Alle Zweige/Aktueller Zweig, Tree: Tree/Zuletzt, Docker: Laufend/Alle, Quests: Offen/In Arbeit/Alle). Git zeigt Branch und Update-Hinweis als Chips, Blueprint Projekt, Agent und Update als Chips („Neu laden“ in der Diagramm-Zeile). Marketplaces und MCP-Server haben dieselbe Titelzeile wie das Review-Fenster und einen Scope-Umschalter „Benutzer | Projekt“; der Tastenkürzel-Dialog hat eine Titelzeile mit Esc-Chip und Gruppen ohne Großbuchstaben.

Gestaltung nach `docs/ui-spec.md` (Tokens, Bausteine, Verträge zwischen den Mods); `docs/ui-preview.sh` startet ein isoliertes Vorschau-Fenster pro Worktree.

## Externe Addons

Sauber aus folgenden Quellen installiert; vorhandene Lizenzen liegen bei den Mods. Nicht angegebene Release-Versionen sind durch den vollständigen Commit gepinnt.

| Addon | Quelle | Version / Commit | lokal angepasst |
|---|---|---|---|
| `blueprint` | [chappse6/herdr-blueprint-app](https://github.com/chappse6/herdr-blueprint-app), `mods/blueprint` | 0.3.5 · `9e6533ace80e392a14311ad05c1dbda10696deda` | `main.js`: Panel-Kopf (Titel „Blueprint“, Projekt als Meta, Agent- und Update-Chip, Icon-Knöpfe 26, „Neu laden“ in der Diagramm-Zeile), Kopfhöhe 42. Diagramme, Sprachen (`i18n.js`) und Abläufe unverändert. Erkennt sich als Panel über `props.panel` im Layout-Block `blueprint`. |
| `filetree` | [cybertron288/herdr-mods](https://github.com/cybertron288/herdr-mods), `filetree/mods/filetree` | `34e7c3348e954fd0a1147b846898db8c3e37e526` | `main.js`: Panel-Rahmen, Kopf mit Titel „Tree“ und Segment „Tree/Zuletzt“, Werkzeug-Knöpfe, Filterfeld, Leerzustände (deutsch). Baum, Git-Zusammenfassung und Vorschau unverändert. |
| `file-icons` | [cybertron288/herdr-mods](https://github.com/cybertron288/herdr-mods), `file-icons/mods/file-icons` | `34e7c3348e954fd0a1147b846898db8c3e37e526` | — |
| `git-graph` | [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph), `mods/git-graph` | 0.3.2 · `2f4fe0fc22e7cc726f3c1a2a654887c96227c37b` | `graph.js`: Panel-Kopf (Titel, Branch- und Update-Chip, Icon-Knöpfe 26 mit Tooltips), Segment „Alle Zweige/Aktueller Zweig“, Checkbox „Remotes“, Leerzustände (deutsch). Graph, Details und Dialoge unverändert. |
| `space-folders` | [jankeesvw/herdr-space-folders](https://github.com/jankeesvw/herdr-space-folders), `mods/space-folders` | `63a78b20d5ed30d57166a3c7165a6eb558c3ef84` | Kopf, Zeilenhöhen (28), Radien, Knöpfe (22 px mit Tooltip), Schriftgrößen und Theme-Farben; die Höhe des Spaces-Blocks folgt dem Inhalt (`layout.resize`, nur wenn sich die Zeilenzahl ändert, nie im Rail; Grenze 40 % mit `shared("agent-cards.height")`). Inhalte und Texte der Ordner-Dialoge unverändert. |

**Plattformgrenzen:** SpaceFolders benötigt POSIX-`sh` für die Ordnerpersistenz. Git-Graph benötigt Git. Git-Graph und Blueprint können upstream automatisch öffentliche Versionsmetadaten abfragen; das ist keine automatische Neuinstallation.

## Blueprint-Panel

Installiert aus [chappse6/herdr-blueprint-app](https://github.com/chappse6/herdr-blueprint-app/tree/master), Version **0.3.5**, Commit `9e6533ace80e392a14311ad05c1dbda10696deda` (MIT, Lizenz unter `mods/blueprint/LICENSE`). Native Mod ohne Backend oder Paketinstallation; Herdr ≥ 0.1.10. Im aktiven **elric**-Layout öffnet der Button **Blueprint** in der Leiste neben Changes, Git und Tree das vorhandene Seitenpanel im Stack `panel-body`; keine neue Spalte, Layout-Umschaltung oder globale Tastenbelegung. Alternativ:

```sh
herdr-app do layout.select --stack panel-body --child blueprint
herdr-app do layout.show --id panel
```

Öffnen allein sendet keinen Prompt. **Connect**, neue Diagramme und **Send** senden über `hc send` an den ausgewählten Agenten und können Agent-Tokens/Kosten verursachen; Änderungen aus dem Diagramm können auch Codeänderungen anfordern. OMP wird über Herdrs allgemeine Agent-/Programmerkennung im aktiven Tab angeboten, nicht über einen eigenen OMP-Adapter. Keine Demo-Diagramme oder Agent-Prompts werden bei der Installation erzeugt.

Die Mod fragt lokal mit Git den Projektordner ab und speichert Mermaid-Dateien sowie Projekt-/Agent-Metadaten unter `data/blueprint/projects/`. Ungepinnte Diagramme werden nach sieben Tagen automatisch gelöscht; nach einem Tag bleiben höchstens zehn ungepinnte Diagramme. Die automatische GitHub-Versionsabfrage lädt nur Metadaten, keine Updates; `herdr-app do blueprint.update-check-off` schaltet sie ab (`blueprint.update-check-on` wieder an). Ein ausdrücklich ausgelöstes Update sendet dagegen einen Update-Auftrag an den Agenten. Sprache kommt automatisch aus `~/.claude/settings.json`; `blueprint.lang-auto`, `blueprint.lang-en`, `blueprint.lang-ko` und `blueprint.lang-ja` steuern sie über `herdr-app do`. Eigene Einstellungen: `blueprint.lang` und `blueprint.update`. PNG-Export ist nur unter macOS verfügbar.

**Remote-Grenze:** Speicherung und Git-Projektabfrage erfolgen auf diesem Rechner. An Agenten werden lokale Diagrammpfade gesendet; eine Übertragung auf entfernte Herdr-Maschinen (z. B. `agentic-vm`) ist upstream nicht implementiert. Die eingebauten Befehle `blueprint.add-button` und `blueprint.remove-button` nicht verwenden: Sie ersetzen das Layout bzw. klonen Standard-Tabs statt dieser `elric`-/`tabs-graph`-Integration.

## Quests

Eigene Mod `quests`, der Eingang für Signale: Tickets aus GitHub Issues (`gh`, Repos der Spaces plus Liste in den Einstellungen), Asana (PAT), Trilium (ETAPI, Suche Standard `#quest`) und lokalen Markdown-Tickets (`data/quests/tickets/*.md` mit Frontmatter `title`, `status` todo/doing/done, `repo`, `labels`, `due`). Panel **Quests** in der Leiste oben (Stack `panel-body`), ganze Seite = Layout `quests` (Quellen | Tickets | Ticket, „Zurück zu Elric“); `ctrl-shift-q` wechselt zwischen `elric` und `quests`.

**Weiter geht jedes Ticket über den Auftrag-Dialog:** **Orchestrator** bzw. **An Orchestrator** öffnet ihn im Modus „Ans Team“, **Start** im Modus „Selbst starten“, jeweils mit dem Ticket vorbelegt: Text an den Orchestrator, erste Nachricht aus der Vorlage der Quests-Einstellungen, Tab-Name, Branch (`feat/…` oder `fix/…` nach Labels, editierbar), Space des passenden Checkouts und standardmäßig ein eigener Worktree unter `~/.herdr/worktrees/<repo>/<branch>` auf der Maschine des Space. Was gestartet wurde, schreibt der Dialog nach `shared("quests.handover")`; Quests übernimmt es beim nächsten Zeichnen: Eintrag in `data/quests/started.json` (die Zeilen zeigen danach den Agent-Status), ein lokales Ticket wird bei „Ans Team“ das des Orchestrators (`by: orchestrator`), und bei „Selbst starten“ der **Writeback** (im Dialog abschaltbar, global „Probelauf“): GitHub Kommentar + `--add-assignee @me`, Asana Kommentar, Trilium Labels `questStatus=doing` und `questBranch=<branch>`, lokal `status: doing`.

Zugangsdaten nur in `data/quests/settings.json` (git-ignoriert), Eingabe in den Einstellungen der Mod; Tokens werden nie wieder angezeigt und in Fehlermeldungen maskiert.

## Auf einem neuen Rechner

Vor dem ersten Herdr-Start:

```sh
git clone https://github.com/thilob97/herdr-config.git ~/.config/herdr-app
```

Existiert der Ordner schon:

```sh
cd ~/.config/herdr-app
git init -b main
git remote add origin https://github.com/thilob97/herdr-config.git
git pull origin main
```

## Start-Dashboard

`layouts/dashboard.json` ist eine ruhige Fabrik-Übersicht ohne Seitenleiste, Tab-Leiste und Statusleiste: eine Karte mit „Wartet auf dich“ (Tickets in Prüfung, offene Fragen aus Ticket-Verläufen, Rückfragen von Agents mit Antwortfeld), dem **Team** (je Agent Identitäts-Chip, Status, Space/Tab, Ticket, Dauer und Kosten; Teams als Gruppenzeile wie im Team-Panel) mit **Letzte Aktivität** (bis fünf Ereignisse aus den Ticket-Verläufen, Agents und Budgets) daneben, der Fabrik-Stufenleiste mit den wichtigsten Tickets in Arbeit und der **Kosten-Karte** rechts (heute, Team-Budget, pro Ticket; Klick öffnet das Team-Panel), dazu das Auftragsfeld an den Orchestrator (⌘↵ sendet; ohne laufenden Orchestrator steht dort „Orchestrator starten“). Leere Bereiche sind eine Zeile, kein leerer Kasten.

- **Zum Startbildschirm:** `⌘⇧0` wechselt zwischen `dashboard` und `elric`; im Dashboard geht dieselbe Taste zurück (Hinweis „⌘⇧0 Workspace“ unter dem Auftrag), ebenso der Knopf „Workspace“ und `g` `w`. Herdr startet mit dem zuletzt gezeigten Layout (`shared("layout")`), nach dem Wechsel also im Dashboard.
- **Rückweg:** `⌘⇧0` (in `keys.json` global `layout.switch:dashboard`, im Layout `dashboard` `layout.switch:elric`).
- **Im Dashboard:** `↑↓` wählt, `↵` öffnet (Agent → Terminal, Ticket → Review-Fenster), `r` antwortet der gewählten Rückfrage, `g` `w` geht zum Workspace, `Esc` räumt Wahl und Fokus. Ein Klick auf eine Team-Zeile wechselt auf `elric` und fokussiert den Tab des Agents; ein Klick auf die Kosten-Karte öffnet das Team-Panel.
- Datenquellen sind dieselben wie in Team, Inbox und Statusleiste: `shared("orchestra.tickets")` (mit `verlauf` und `question`), `agents()`, `shared("orchestra.costs")`, `shared("orchestra.budget")`, `shared("orchestra.groups")` und `shared("attention.since")`. `layouts/elric.json` bleibt unverändert.
