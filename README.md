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
| `review` | Review-Fenster: Abnahme eines Tickets (Ticket-Modus, mit Reviewer-Urteil und Befunden) oder Änderungen eines Agents, siehe Agent-Zentrale |
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

Die Oberfläche folgt einer Fabrik: **Eingang** (Auftrag-Dialog, Quests) → **Stationen** (Team-Panel: Geplant › In Arbeit › Prüfung › Fertig) → **Gates** (Checks, Prüfstation, Review-Fenster) → **Output mit Nachweisen** (Review-Fenster: Mergen, PR, Abnehmen). Was auf dich wartet, sammelt die **Inbox**. Agents selbst stehen nur in der Seitenleiste; alle anderen Stellen zeigen sie als Chip (Avatar und Name aus `shared("agents.identity")`, Status), ein Klick geht hin.

**Auftrag** (`cmd-shift-n` oder Knopf **Auftrag** in der Tab-Leiste) ist der einzige Eingang für neue Arbeit, ein Dialog mit zwei Modi (Umschalter oben; Standard „Ans Team“, wenn ein Orchestrator läuft):

- **Ans Team:** ein Textfeld, **An das Team** schickt es an den Orchestrator (`hc send orchestrator`; wartet er auf eine Antwort, mit `--force`). Läuft keiner, steht dort ein Hinweis aufs Team-Panel.
- **Selbst starten:** Vorlage, Space (bestimmt Maschine und Ordner), ein oder mehrere Agents (mehrere = je einer pro Agent, parallel), wo: neuer Tab im Space oder je ein eigener Git-Worktree unter `~/.herdr/worktrees/<repo>/` mit eigenem Space (bei mehreren Agents bekommt der Branch `-<agent>` angehängt). Tab-Name und erste Nachricht sind vorbelegt; `{folder}`, `{branch}`, `{branchnote}` und `{space}` werden beim Start ersetzt. Gestartet wird über `herdr-app do tab.new|space.new`. „Als Team beobachten“ legt aus den gestarteten Agents ein Team an.

Aufrufe mit Ticket (aus Quests): `openOverlay({ mod: "launcher", kind: "dialog", width: 860, height: 680, props: { mode: "team" | "self", ticket } })` füllt Text, Tab-Namen und Branch vor. Was daraus gestartet wird, gibt der Dialog über `shared("quests.handover")` an Quests zurück (siehe Quests).

**Vorlagen** sind Markdown-Dateien in `mods/launcher/templates/` (getrackt), Kopf `name:` (Anzeige) und `tab:` (Tab-Name, Branch-Präfix), darunter die Nachricht. Mitgeliefert: Bug fixen, Feature bauen, Code-Review, Tests schreiben, Codebase erklären, Refactoring. Neue Datei = neue Vorlage beim nächsten Öffnen.

**Inbox** (`cmd-shift-j` oder Knopf **Inbox** in der Tab-Leiste) ist die eine Freigabe-Stelle, in dieser Reihenfolge: **Rückfragen** (Agents, die warten, auch der Orchestrator), **Abnahmen** (Tickets in Prüfung), **Fertig** (fertige Agents), darunter abgedimmt **Arbeitet**. Der Zähler im Kopf ist derselbe wie am Inbox-Knopf: wartende Agents (+1, wenn der Orchestrator fragt) plus Tickets in Prüfung, sonst die Zahl der fertigen. Rechts der Bildschirm des gewählten Agents bzw. Orchestrators (`hc read`, alle 2,5 s neu) mit Antwortfeld, bei einem Ticket Zusammenfassung, Gates und Nachweise mit **Prüfen**. Ein Auftrag „Ans Team“, für den noch kein Ticket existiert, steht bis zu 15 Minuten als Zeile **beim Orchestrator** unter *Arbeitet* (Klick öffnet das Team-Panel). Der Kopf zählt als Badge, die Tastenhinweise sind kurz. `↑/↓` wählen, `↵` hingehen bzw. prüfen, `r` antworten (über `hc send`; bei *blocked* mit `--force`, die Antwort beantwortet seinen Dialog), `v` Review (bei *done*).

**Review-Fenster**, zwei Modi:

- **Ticket-Modus** (Knopf **Prüfen** im Team-Panel oder in der Inbox; `props.ticket`): Titel, Gate-Chips (`Checks ✓/✗/–`, `Review läuft/grün/rot/–`, `Review offen`, `abgenommen`), die Zusammenfassung des Orchestrators und die Nachweise (Klick öffnet die Datei; Bildnachweise als 48-px-Vorschau), darunter der Diff des Ticket-Branches gegen seine Basis (auch wenn der Agent schon beendet ist). Unter den Gates steht die **Prüfstation**: Urteil des Reviewers (`grün`, `rot`, `läuft`, `noch nicht gestartet`), Reviewer-Identität, Runde, seine Zusammenfassung, die **Befunde** (aufklappbar, die `review`-Kommentare des Tickets) und **Erneut prüfen** (`hub review-start <id>`). Unten die Abnahme: **Mergen**, **PR**, **Änderungen …** (Feedback an den Orchestrator, das Ticket geht zurück auf „in Arbeit“) und **Nur abnehmen**. Das Ergebnis steht im Fenster; nach dem Mergen oder Abnehmen ersetzt es die Fußleiste, die dann nur noch **Schließen** anbietet. Die Fußleiste ist mit **Abnahme** beschriftet. Über den Nachweisen steht die **Prüfung**: Gate-Chip, **Letzte Zeilen** (der aufgezeichnete Auszug, aufklappbar) und **Prüfung erneut ausführen** (`hub verify <id>` im Worktree des Tickets).
- **Terminal-Modus** (`cmd-shift-r` oder Knopf **Review** in der Tab-Leiste für das fokussierte Terminal; aus der Inbox, von einer Agent-Karte oder per Knopf am Toast „… ist fertig“): Git-Änderungen im Ordner des Agents, auch auf entfernten Maschinen. Dateiliste mit +/−, Diff, Branch mit ↑/↓. Die Kopfzeile nennt das Ticket, an dem der Agent arbeitet; die Fußleiste heißt **Arbeit am Agent**. Aktionen: **Commit** (`git add -A` + `git commit`, Nachricht mit Tab-Namen vorbelegt), **Feedback senden** (`hc send`), **Zum Agent**, **Changes-Panel** (wählt Space und öffnet `changes`), **Worktree entfernen** (nur unter `~/.herdr/worktrees/`, öffnet den mitgelieferten Worktree-Dialog).

Toasts sind deutsch und nennen die Identität („Dash wartet auf dich“, „Quill ist fertig“) mit Identitäts-Chip; **Review** ist ein Icon-Knopf. Das Review-Fenster vergleicht Branches mit ihrem Abzweig von der Ticket-Basis, `origin/HEAD`, `main` oder `master` (Kopf: „gegen main · N Commits“); auf dem Haupt-Branch selbst zeigt es nur Uncommittetes. **Commit** gilt nur Uncommittetem.

**Team** (Panel, `cmd-alt-7` oder Knopf **Team**): im Kopf die Pipeline `Geplant n › In Arbeit n › Prüfung n › Fertig n` (Klick springt zur Sektion; Prüfung in Pink, sobald etwas auf dich wartet; Zähler ab 100 als `99+`, bei Platzmangel nur belegte Stufen, der Tooltip nennt alle). Alle vier Stufen bleiben sichtbar, leere sagen es („Nichts in Prüfung.“). Genau ein **Prüfen** ist primär (das älteste Prüf-Ticket), die übrigen sind sekundär; die Budget-Chips tragen einen Stift und erhöhen beim Klick. Darunter die Orchestrator-Karte, dann die Tickets nach Stufe: **Prüfung** (Zusammenfassung, Gate-Chips und **Prüfen**), **In Arbeit** (am Ende die Budget-Chips), **Geplant**, die **Teams** und, eingeklappt, **Fertig**. Jedes Ticket zeigt seinen Agent als Chip, Branch, Gates und `$ausgegeben / $Budget`; ein Klick geht zum Agent. In **Prüfung** stehen Umsetzer und Reviewer getrennt: die Zeile **Umsetzer** mit Agent-Chip, darunter die Chips `Checks ✓ · …`, `Review läuft/grün/rot/–` und `Review offen`, dann die Zeile **Reviewer** mit Identität und `Runde n`. Teams (`shared("orchestra.groups")`, angelegt aus der Auswahl in der Seitenleiste oder vom Auftrag-Dialog) zeigen Fortschritt pro Mitglied, „alle fertig“, Beobachten an/aus und Auflösen. Die Statusleiste beobachtet die Teams, auch wenn das Panel zu ist: Hat ein Mitglied gearbeitet und arbeitet bzw. wartet keins mehr, kommt einmal „Team … ist fertig“ mit Ton.

**Orchestrator** (Karte oben im Team-Panel): ein eigener Agent (Standard omp, umschaltbar über den Agent-Namen auf der Karte), der immer läuft: ein unsichtbarer Block `orchestra-daemon` (0 px, in der Statuszeile von `elric`) startet ihn, wenn keiner läuft, außer er wurde mit **Anhalten** gestoppt (dann bietet die Karte **Starten**). Er hat kein eigenes Tab; **Öffnen** zeigt sein Terminal (Peek), die Karte seinen Schritt bzw. seine letzte Nachricht. Fragt er dich etwas, erscheint auf der Karte und in der Inbox ein Antwortfeld. Aufträge bekommt er über den Auftrag-Dialog. Er arbeitet in `~/.herdr/orchestrator` mit den Anweisungen aus `mods/orchestra/orchestrator.md` (bei jedem Start als `AGENTS.md`/`CLAUDE.md` kopiert) und hat `mods/orchestra/bin/hub` im PATH:

- `hub ticket new|list|show|set` legt Tickets als lokale Quests-Tickets an (`data/quests/tickets/*.md`, Feld `by: orchestrator`; Quests-Quelle „Lokal“ ist dafür eingeschaltet). Quests behält die zusätzlichen Felder (`machine`, `agent`, `assignee`, `blocked_by`, `tags`, `waiting`, `branch`, `worktree`, `terminal`, `checks`, `evidence`, `by`, `updated` …) beim Bearbeiten.
- **Tickets sind der einzige Weg, auch untereinander.** Arbeit bekommt ein Agent nur über `hub ticket next <agent>` bzw. den Auftrag im Ticket; erledigt wird nur, was im Ticket steht. Fragen, Blocker und Übergaben sind Kommentare im Ticket: `hub ticket comment <id> --from <rolle> "text @agent"` (Rolle `orchestrator`, Agent-Name oder `mensch`; `@name` wird als Tag gespeichert, neueste unten im Abschnitt `## Verlauf`). Antworten stehen im selben Ticket; neue Arbeit ist ein neues Ticket mit `--blocked-by` auf das auslösende. `hub ticket assign <id> <agent>` weist zu, `hub ticket link <id> --blocked-by <id>…` setzt Abhängigkeiten, `hub ticket inbox <agent>` zeigt, wer genannt, wem zugewiesen ist und wer auf eine Antwort wartet (`hub ticket watch <id> --on <agent>`), `hub ticket list --agent <name> --json` filtert. `hub ticket show` zeigt den Verlauf; er überlebt `review` und `done`. Chat an andere Agents ist verboten, `hc send` bleibt für „du bist fertig“ und „du bist blockiert, Ticket X“ sowie den Hinweis „Ticket <id>: neue Nachricht“.
- **Verlauf in der Oberfläche:** Das Team-Panel zeigt an jeder Ticket-Zeile die letzten zwei Kommentare (Rolle · Zeit · Text, `@Tags` pink), „alle“ klappt den ganzen Verlauf auf. Das Review-Fenster im Ticket-Modus zeigt den Verlauf unter der Zusammenfassung, darunter das Feld „Kommentar an @agent…“, das `hub ticket comment <id> --from mensch` aufruft. Die Inbox führt offene Fragen (`@mensch` im letzten Kommentar bzw. `waiting`) unter **Rückfragen**: ↵ oder **Ticket öffnen** geht ins Review-Fenster, das Antwortfeld schreibt den Kommentar ins Ticket statt ins Terminal. `hub status` hat die Spalte `Verlauf` (Zahl der Kommentare).
- `hub dispatch <id> [--agent omp|claude|codex]` legt einen Worktree `~/.herdr/worktrees/<repo>/<branch>` an (auch `--on <maschine>` über `hc exec`), schreibt `base` und `base_head` (Branch und Commit des Haupt-Checkouts beim Start) ins Ticket und startet den Agent dort mit `hc run` als Kind des Orchestrators, in einem eigenen Herdr-Space, mit dem Ticket als erster Nachricht. Es verweigert den Start, solange ein Vorgänger aus `blocked_by` nicht `done` ist, und nennt ihn. Das Präambel-Ticket nennt das Ticket als einzige Quelle und die Kommentar-Regeln; Rückfragen und Ergebnisse laufen als Ticket-Kommentare, `hc send` nur für fertig/blockiert.
- `hub verify <id>` führt die Prüfung des Repos aus: `<worktree>/.herdr/verify.sh` (sonst das Ticket-Feld `verify`), mit `sh`, im Worktree und auf der Maschine des Tickets. Es schreibt ins Ticket `checks: pass|fail`, `checks_head` (Worktree-HEAD), `checks_at`, `checks_duration`, `checks_exit`, `checks_cmd` und unter `## Prüfung` die letzten 20 Zeilen. Fehlt das Skript, endet es mit Pfad und Hinweis. `hub gate <id> [--json]` sagt, ob der Lauf noch zählt.
- `hub review-start <id> [--agent …]` startet die **Prüfstation**: einen zweiten Agent (Standard: ein anderes Programm als der Umsetzer) in `~/.herdr/worktrees/<repo>/review-<id>`, auf dem Branch des Umsetzers. Seine Aufgabe: `<base>...HEAD` lesen, Spec und Abnahmekriterien aus dem Ticket prüfen, Befunde mit Schweregrad als `--from review`-Kommentar schreiben und das Urteil über `hub review-verdict` abgeben. Es verweigert den Start ohne grünen `hub verify`, ohne Branch und solange ein Reviewer läuft; das Urteil gilt nur für den Commit, den es geprüft hat. `reviewer` und `review_terminal` stehen danach am Ticket.
- `hub review-verdict <id> --verdict pass|fail --summary "…"` schreibt das Urteil: `review`, `review_head`, `review_at`, `review_summary`, `review_rounds` (jedes Urteil eine Runde) und den Abschnitt `## Review`. `fail` setzt das Ticket auf `doing`, lässt die Befunde im Verlauf stehen und schickt dem Umsetzer per `hc send` den Hinweis, sie zu beheben.
- `hub review <id> --summary … --evidence <pfad> [--evidence <pfad>]…` übergibt erst geprüfte Arbeit an dich: Das Ticket rückt in **Prüfung** und in die Inbox (Abnahmen), mit Zusammenfassung, Gate-Chips und Nachweisen (`evidence`, Dateipfade), dazu Meldung und Ton. Das **Gate** verweigert den Übergang, solange `checks` nicht `pass` ist, der Lauf älter als der letzte Commit im Worktree ist, kein `pass`-Urteil des Reviewers auf diesem Commit vorliegt oder der Branch nicht auf der aktuellen Basis aufsetzt (`git rebase <base>`); die Meldung nennt die Gründe. `--force --reason "…"` überfährt es und schreibt den Grund in den Verlauf. `--checks` gibt es nicht mehr: der Agent belegt nichts selbst. **Prüfen** öffnet das Review-Fenster im Ticket-Modus.
- **Mergen** (`hub land <id> --merge`) mergt den Branch mit `--no-ff` in seine Basis (der Branch, auf dem das Repo beim Verteilen stand, Feld `base`), beendet den Agent, entfernt Worktree und Branch und sagt es dem Orchestrator. Voraussetzung: Worktree committet, Haupt-Checkout sauber und auf der Basis. Ein aufgezeichnetes CI-Ergebnis muss zu diesem Commit gehören: bei `ci: fail` oder `ci_head` ≠ Worktree-HEAD verweigert der Befehl, außer mit `--force --reason "…"` (der Grund landet im Verlauf). Bei einem Konflikt wird der Merge abgebrochen und das Ticket mit Auftrag zum Rebase an den Orchestrator zurückgegeben. **PR** (`hub land <id> --pr`) pusht den Branch nach `origin` und öffnet mit `gh pr create` einen Pull Request (Text aus der Zusammenfassung); Branch bleibt, Worktree und Agent gehen. **Nur abnehmen** (`hub done`) setzt `done` ohne Merge und räumt dabei auf wie `hub land`: Agent beenden, sauberen Worktree entfernen, Space und Tab des Tickets schließen; der Branch bleibt. `--keep-worktree` lässt den Worktree stehen; `--keep-space` lässt Space, Tab und den Agent-Terminal laufen (Herdr schließt den Space, sobald sein letztes Terminal endet).
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
| `ctrl` `ctrl` (doppelt) / `cmd-shift-h` | Hermes-Chat auf/zu |
| `cmd-alt-1` … `cmd-alt-7` | Panel Changes, Git, Tree, Blueprint, Docker, Quests, Team (`elric`; erneut drücken schließt) |

## Prüfungen

Kein Ticket kommt in **Prüfung**, ohne dass die Prüfung des Repos gelaufen ist. Der Agent belegt sie nicht selbst mit `--checks`: `hub` führt sie aus, protokolliert sie am Ticket, und nur dieser Lauf kommt durchs Gate.

**Das Skript.** `hub verify <id>` sucht `<worktree>/.herdr/verify.sh` und führt es mit `sh` aus — auf der Maschine des Tickets, im Worktree, gegen dessen HEAD. Fehlt es und ist kein Ticket-Feld `verify` gesetzt, endet der Befehl mit dem Pfad und dem Hinweis darauf. `hub ticket new` legt im Zielrepo nichts an: Beim ersten Ticket schreibt der Agent `.herdr/verify.sh` selbst (Tests, Lint, `herdr-app check` — was das Repo eben prüft), committet es und lässt `hub verify` laufen. Danach ist es Teil des Repos und gilt für alle Tickets.

**Das Protokoll** steht im Frontmatter (`checks: pass|fail`, `checks_head`, `checks_at`, `checks_duration`, `checks_exit`, `checks_cmd`) und im Abschnitt `## Prüfung` des Tickets: eine Kopfzeile `- <zeit> · pass · <dauer> s · exit <code> · HEAD <kurz> · <befehl>` und die letzten 20 Zeilen der Ausgabe im Code-Block. Exit 0 heißt `pass`, alles andere `fail`; `hub verify` endet nach einem protokollierten Lauf mit 0 (das Ergebnis steht im Ticket), ohne Lauf mit 1.

**Das Gate.** `hub review` verweigert den Übergang nach **Prüfung**, solange `checks` nicht `pass` ist oder `checks_head` nicht der letzte Commit im Worktree ist (`git rev-parse HEAD`); die Meldung nennt `hub verify <id>`. Seit der **Prüfstation** verlangt dasselbe Gate zusätzlich ein `pass`-Urteil des Reviewers auf diesem Commit (nächster Abschnitt). Nach einem neuen Commit sind also alter grüner Lauf und altes Urteil ungültig. `hub gate <id> [--json]` zeigt beide Befunde. `--force --reason "…"` überfährt das Gate und schreibt den Grund als Eintrag in den `## Verlauf`.

**In der Oberfläche** zeigt der Gate-Chip im Team-Panel und im Review-Fenster `Checks ✓ · 3.2s · HEAD abc1234` bzw. rot den Grund (`nicht geprüft`, `Exit 1`, `neuer Commit`). Im Review-Fenster steht über den Nachweisen die Zeile **Prüfung** mit **Letzte Zeilen** (Auszug aufklappen) und **Prüfung erneut ausführen** (`hub verify <id>`).

## Basis und Rebase

Jedes Ticket merkt sich, wo seine Arbeit aufsetzt: `base` ist der Branch des Haupt-Checkouts beim Verteilen (Feld `base`), `base_head` dessen Commit in diesem Moment. `hub dispatch` schreibt beides und legt einen neuen Branch auf genau diesem Commit an, nicht auf irgendeinem späteren `HEAD`.

**Drift erkennen.** `hub review`, `hub gate`, `hub gates` und `hub status` vergleichen die Basis mit dem Branch: `git merge-base --is-ancestor <aktuelle Basis> HEAD` im Worktree. Ist die Basis weitergelaufen und der Branch setzt nicht darauf auf, gilt die Basis als veraltet. `hub review` verweigert dann den Übergang nach **Prüfung** mit der Meldung `git rebase <base>`; `--force --reason "…"` überfährt das Gate weiterhin und schreibt den Grund in den `## Verlauf`. `hub status` hat dafür die Spalte `Basis` (`⚠ Basis veraltet`, `ok` oder `–`), das Team-Panel den Chip **Basis veraltet** an der Ticket-Zeile, das Review-Fenster den Satz mit dem Rebase-Befehl.

**Rebase.** `hub rebase <id>` rebased den Branch im Worktree auf seine Basis. Ist er schon aktuell, sagt es das und ändert nichts; bei uncommitteten Änderungen verweigert es. Bricht der Rebase an einem Konflikt ab, endet `hub rebase` mit Exit 1, nennt die betroffenen Dateien und lässt den Worktree mitten im Rebase stehen — der Agent löst die Konflikte, `git add`, `git rebase --continue`; `git rebase --abort` bricht ab. Erst danach zählen `hub verify` und das Reviewer-Urteil wieder, denn beide gelten nur für den neuen HEAD. `base_head` wird nach einem erfolgreichen Rebase auf die neue Basisspitze gesetzt.

## Prüfstation

Nach grünem `hub verify` prüft ein zweiter Agent den Diff; erst sein Urteil öffnet **Prüfung** für dich. Der Reviewer läuft auf einem anderen Modell als der Umsetzer: `hub review-start <id>` wählt es selbst, `--agent` überschreibt es.

**Ablauf.** Der Orchestrator lässt nach `hub verify` `hub review-start <id>` laufen. Die Station legt `~/.herdr/worktrees/<repo>/review-<id>` an (detached auf dem Branch des Umsetzers), startet dort den Reviewer mit dem Ticket als Auftrag und schreibt `reviewer` und `review_terminal` ans Ticket. Der Reviewer liest `<base>...HEAD`, hakt die Abnahmekriterien ab, schreibt jeden Befund als Kommentar im Ticket (`--from review`, Schweregrad `blocker|major|minor|nit`, Datei:Zeile) und gibt genau ein Urteil ab:

```sh
hub review-verdict <id> --verdict pass --summary "Urteil, Zahl der blocker/major/minor/nit"
hub review-verdict <id> --verdict fail --summary "3 Major offen"
```

Das Urteil steht im Frontmatter (`review`, `review_head`, `review_at`, `review_summary`, `review_rounds`) und im Abschnitt `## Review`; jedes Urteil zählt eine Runde. **fail** setzt das Ticket sofort auf **In Arbeit** zurück, lässt die Befunde im `## Verlauf` stehen und schickt dem Umsetzer per `hc send` den Hinweis, sie zu beheben.

**Das Gate.** `hub review` verlangt zusätzlich zum grünen `hub verify` ein `pass`-Urteil, dessen `review_head` der letzte Commit im Worktree ist. Ein Commit nach dem Urteil macht es ungültig (wie `checks_head`); die Meldung nennt den Grund und `hub review-start`. `hub gate <id> [--json]` zeigt beide Gates (`ok` für die Checks, `review.ok` für den Reviewer), `hub gates` dasselbe für das Team-Panel. `--force --reason "…"` überfährt beide.

**In der Oberfläche.** Die Stufe **Prüfung** im Team-Panel zeigt Umsetzer und Reviewer getrennt: `Checks ✓ · 3.2s · HEAD abc1234`, `Review läuft` (Reviewer-Terminal lebt), `Review grün` (pass auf dem HEAD), `Review rot` (fail) bzw. `Review rot · neuer Commit` (Urteil veraltet), dazu `Runde n` und den Reviewer als Identitäts-Chip. Das Review-Fenster zeigt dieselbe Zeile **Prüfstation** mit Urteil, Reviewer, Runde und Zusammenfassung, die **Befunde** aufklappbar und **Erneut prüfen** (`hub review-start`). `hub status` hat die Spalten `Urteil` (`pass`/`fail`/`–`) und `Runden`.

## CI

Ein Ticket ist erst fertig, wenn die Checks seines Pull Requests grün sind. Das Prüf-Gate oben belegt die Arbeit vor dem Review; CI ist das PR-Gate danach.

**`hub ci <id>`** fragt `gh pr checks --json` für den PR des Tickets ab und schreibt das Ergebnis ins Ticket: `ci: pass|fail|running|unknown`, `ci_at`, `ci_url` und `ci_head` (der HEAD des Worktrees beim Abruf). Ein Ergebnis zählt nur für diesen Commit; `hub land --merge` verweigert ein rotes oder veraltetes Ergebnis (siehe oben). Rote Checks stehen mit Name, Zustand, Link und den letzten Log-Zeilen in `ci_details` und als Kommentar (`--from ci`) im `## Verlauf`. `fail` setzt das Ticket auf `doing`; läuft sein Agent noch, bekommt er `hc send "<id>: CI rot, siehe Kommentar"`. Ein Netz- oder `gh`-Fehler wird `ci: unknown`, ohne Absturz. Ist der Worktree-HEAD nicht lesbar, bleibt `ci_head` leer und das Ergebnis zählt nie als aktuell. Ohne PR und ohne Branch sagt der Befehl, dass er nichts prüfen kann.

**`hub land <id> --pr --wait-ci`** pusht, öffnet den PR (oder nimmt den vorhandenen) und pollt danach 30 s lang, höchstens 20 min. Nur `pass` schließt ab (Agent beenden, Worktree entfernen, `done`); `fail`, `unknown` oder nach 20 min noch `running` lassen Agent und Worktree stehen, damit nachgebessert werden kann. Fehlt `gh` oder `origin`, endet der Befehl mit einer klaren Meldung.

**In der Oberfläche** steht im Review-Fenster (Ticket-Modus) unter den Gates die CI-Zeile: Zustand, Zeitpunkt, **PR öffnen** und **Erneut prüfen** (`hub ci`); rote Checks klappen Namen und Log-Auszug auf. `hub status` hat die Spalte `CI` (`✓`, `…`, `✗`, `?`).

## Lehren

Was beim Review und bei der Abnahme gelernt wurde, landet automatisch im nächsten Auftrag — pro Repo, in `<repo>/.herdr/lessons.md` (eine Zeile je Lehre, höchstens 40; die älteste fällt raus):

```
- 2026-11-14 · lehren-pro-repo · review · Erst den Bestand lesen, dann ändern.
```

- `hub lesson add <repo|ticket> --from review|human|ci "Text"` schreibt eine Lehre; `<ticket>` nimmt ihr Repo und ihre Maschine. `hub lesson list <repo|ticket> [--last 8] [--json]` zeigt sie, `--pending` die noch unbestätigten Vorschläge.
- `hub dispatch` hängt die letzten 8 Lehren des Repos als Abschnitt „Was hier schon schiefging“ an die Aufgabe; `--no-lessons` lässt ihn weg (z. B. für eine unbelastete Premiere).
- `hub land <id> --merge|--pr --lesson "Text"` schreibt eine Lehre aus der Abnahme und nennt sie im Verlauf des Tickets (mehrfach möglich).
- **Rückläufer:** Gibt der Mensch im Review-Fenster **Änderungen …**, geht das Ticket zurück auf `doing`; der Orchestrator legt mit `hub lesson propose <id> "Text"` eine Lehre als Vorschlag ab. Das Review-Fenster zeigt sie mit **Lehre übernehmen** — erst dieser Knopf schreibt sie in die Datei (`--from review`) und nennt sie im Verlauf.
- **Sichtbarkeit:** Jede Ticket-Zeile im Team-Panel trägt `Lehren n` (Tooltip mit den letzten drei; pink, solange ein Vorschlag wartet). Das Review-Fenster listet die Lehren des Repos aufklappbar unter der Zusammenfassung, den Vorschlag mit dem Bestätigen-Knopf.
- Nur lokale Repos haben eine Lehren-Anzeige; auf anderen Maschinen liest `hub dispatch` die Datei dort, das Panel zeigt keine Zahl. `.herdr/lessons.md` ist Arbeitsdatei des Repos, nicht Teil dieses Config-Repos.

## Aufräumen

Nach der Abnahme bleibt nichts liegen: `hub done <id>` setzt `done` und räumt auf, `hub land <id> --merge|--pr` ruft dieselbe Routine nach dem Landen. Beendet wird der Agent (`hc kill`), entfernt der Worktree, den **das Ticket selbst als `worktree` trägt** (Pfadvergleich, keine Ableitung) — nur wenn er sauber ist und kein anderes Ticket ihn beansprucht — und geschlossen der Space bzw. das Tab, das `hub dispatch` über die Labels `herdr.space`, `herdr.tab` und `hub.ticket` angelegt hat. Der Prüf-Worktree `review-<id>` bleibt hier stehen; ihn räumt `hub cleanup` ab, sobald das Ticket `done` ist und kein Reviewer mehr läuft. Der Branch bleibt bei `hub done` und bei `--pr`; nur `--merge` löscht ihn nach dem Merge. `--keep-worktree` lässt den Worktree stehen; `--keep-space` lässt Space, Tab und Agent-Terminal laufen, weil Herdr einen Space ohne Terminal schließt.

- **Grenze:** Ein Aufräum-Befehl fasst nur die eigene Welt an. Kandidaten werden **ausschließlich** aus `repo` und `branch` der Tickets dieses Homes abgeleitet (`<root>/<basename(repo)>/<branch-slug>`, genau wie `hub dispatch`); `<root>` ist `--root`, sonst `$HOME/.herdr/worktrees`. Es wird nie ein Verzeichnis unter der Wurzel gesucht: fremde Homes (etwa ein Test-Home mit eigener Wurzel), fremde Tickets und Worktrees ohne Ticket bleiben unberührt, auch wenn sie unter derselben Wurzel liegen.
- **Sicher:** Ein Space mit einem fremden lebenden Terminal bleibt offen; geschlossen wird dann höchstens das eigene Tab. Ein Worktree, den ein anderes Ticket beansprucht, wird nie angefasst. Hat der Worktree uncommittete Änderungen, bleibt er stehen und wird mit Grund im Klartext gemeldet; Ticket und Dateien bleiben, wo sie sind. Ebenso bleibt ein Worktree, dessen Pfad nicht exakt dem aus dem Ticket berechneten entspricht, dessen HEAD-Branch nicht der Ticket-Branch ist, oder in dem das `cwd` eines lebenden `hc`-Terminals liegt.
- **`hub cleanup [--yes] [--root PATH]`** findet, was dieses Home nicht mehr braucht, im Bereich `--root` und meldet jede Aktion mit Ticket, Pfad und Branch:
  - Worktrees der Tickets dieses Homes, die `done` sind (nicht bei offenem Ticket),
  - Prüf-Worktrees `review-<id>` nach `done` (nicht solange der Reviewer läuft),
  - Spaces, die über ein Ticket-Label gehören und kein lebendes Terminal mehr haben,
  - beendete Agents (`done`/`idle`/`error` oder beendetes Terminal), die seit über einer Stunde stehen.
  **Ohne `--yes` ist `hub cleanup` ein Dry-Run:** es listet dieselben Aktionen und den Bereich und ändert nichts. Mit `--yes` wird in der Reihenfolge Agents → Spaces → Worktrees aufgeräumt.
- **`hub status`** listet `done`-Tickets nur dann unter **Reste**, wenn noch ein Terminal, Worktree oder Space übrig ist; abgenommene Tickets ohne Reste erscheinen nicht extra. Die Zeilen im Team-Panel und im Dashboard hängen an lebenden Terminals und verschwinden mit ihnen.

## Messwerte

Die Fabrik misst sich pro Station, nicht nur in Dollar. `hub stats [--json] [--days 14]` rechnet aus den Tickets und `data/orchestra/costs.json`:

- **Durchlaufzeit** je Ticket: erstes `todo` bis `done`; der Median läuft über die im Fenster erledigten Tickets.
- **Prüfrunden**: wie oft das Ticket in **Prüfung** ging.
- **Nacharbeit**: Rückwege nach **In Arbeit**, nachdem das Ticket schon in **Prüfung** war (Review-Feedback, CI-Fehler).
- **Kosten** je Ticket aus `costs.json`, summiert je Station, je Repo und für heute.
- **Alter** je Ticket in `hub status`: Zeit seit der letzten Statusänderung (`status_at`; bei alten Tickets `updated`).

**Woher die Zeiten kommen.** Jeder Statuswechsel schreibt `status_at` und hängt `state@JJJJ-MM-TT HH:MM` an das Frontmatter-Feld `status_log` (`todo@…|doing@…|review@…|done@…`) — in `hub` (`set_status`) wie im Team-Panel (`tickets.js`). Daraus rechnet `hub stats` Summen, Mediane, Prüfrunden und Nacharbeit. `created`/`updated` allein reichen nicht, weil jeder Schreibvorgang `updated` überschreibt. Tickets von vor diesem Stand haben kein Protokoll: sie stehen mit `—` in der Tabelle, zählen nicht in den Median, und ihr nächster Statuswechsel beginnt das Protokoll.

**Ausgabe.** Tabelle mit je Ticket (Durchlauf, Prüfrunden, Nacharbeit, Kosten), je Station (Anzahl, Summe, Median), je Repo dieselben Zahlen, dazu `Heute: …` und die letzten sieben Tage. `--json` liefert dasselbe maschinenlesbar (`today`, `history`, `summary`, `stations`, `repos`, `tickets`).

**Im UI.** Das Team-Panel trägt unter der Pipeline die Kopf-Zeile „Heute: 3 erledigt · Median 42 min · 1 Nacharbeit · $12" (`shared("orchestra.stats")`, alle 30 s aus `hub stats --json`); ein Klick klappt Stationen und Repos in derselben Fläche auf. Das Dashboard hat die Karte **Fabrik heute** mit denselben vier Werten und den letzten sieben Tagen als Textbalken (kein Chart-Framework); ein Klick öffnet das Team-Panel. Beide lesen denselben Lauf derselben Funktion, deshalb sind die Zahlen gleich.

## Rahmen: Seitenleiste, Tab-Leiste, Statusleiste

**Seitenleiste.** Der **Kopf** (42 px, bündig mit der Tab-Leiste) zeigt Logo, „Herdr“, Suche (`cmd-p`) und Ein-/Ausklappen; er kommt aus dem eigenen Mod `sidebar-footer` statt aus dem ausgelieferten `workspace-chrome`. Der **Fuß** ist eine 28-px-Zeile (bündig mit der Statusleiste) mit Icon-Knöpfen für Einstellungen (`cmd-,`, mit Punkt, wenn ein Update bereitliegt), Marketplaces (`ctrl-shift-m`), MCP-Server (`ctrl-shift-y`), Maschine hinzufügen und Tastenkürzel (`cmd-/`); eingeklappt (Rail) bleiben Einstellungen und „…“ mit den übrigen vier. **Spaces** nehmen nur so viel Höhe, wie sie brauchen (Kopf, eine 28-px-Zeile je Space, Ordner oder Maschine), höchstens 40 % der Listenhöhe, darüber scrollen sie; den Rest bekommen die Agents. Kopf „Spaces n“ mit „Neuer Ordner“ und „Neuer Space (⌘N)“; Maschinen-Zeilen sind Sektionsköpfe; Kachelfarben kommen aus dem Theme.

**Agent-Karten** sind die eine Agent-Darstellung: Avatar · Name · Space · Statusanzeige, darunter Tab bzw. Titel und seit wann der Status gilt, bei omp eine dritte Zeile mit Modell, ctx (mit Balken) und Kosten. Der fokussierte Agent hat den pinken Rahmen. Statusanzeige wie überall: Spinner = arbeitet, pulsierender Punkt = wartet, Punkt = fertig, Ring = ruhig. Sektionen „Wartet auf dich“, „Arbeitet“, „Fertig“, „Ruhig“, „Angeheftet“; der Uhr-Knopf im Kopf sortiert „Nach Dringlichkeit“ oder „Nach Space“. Beim Drüberfahren: **Review** (Änderungen dieses Agents im Review-Fenster), **Unterbrechen** und **Mehr (…)** mit Plugins, MCP-Server, Anheften/Lösen und Umbenennen (dasselbe Menü per Rechtsklick). **Mehrfachauswahl:** ⌘-Klick wählt Karten aus (Häkchen statt Avatar); darunter erscheint die Auswahlleiste: „n ausgewählt · aufheben“, Nachricht an die Auswahl (wartende nur mit „auch wartende“, das beantwortet ihre Frage), **Unterbrechen** und **Als Team beobachten** (legt „Team HH:MM“ an, sichtbar im Team-Panel unter Teams). `agent-cards` veröffentlicht Name, Avatar und Programm jedes Agents in `shared("agents.identity")` (`{ "<adresse>": { name, avatar, program } }`); Team-Panel, Inbox, Review und Toasts zeigen damit denselben Namen, Umbenennen ändert ihn überall.

**Tab-Leiste.** „+“ steht direkt hinter dem letzten Tab und öffnet einen Tab (Terminal oder Agent), wie im Browser. Rechts: der Primärknopf **Auftrag** (`cmd-shift-n`, der eine Eingang für neue Arbeit), **Inbox** mit Zähler (Rückfragen plus Tickets in Prüfung; wartet nichts, die fertigen Agents in deren Farbe), **Review** als Icon (`cmd-shift-r`), dann die Panel-Gruppen *Fabrik* (Quests, Team) und *Werkzeuge* (Changes, Git, Tree, Blueprint, Docker). Tabs sind 28 px hoch und zeigen den Status wie überall.

**Statusleiste.** Links Ort (Maschine) und Branch, rechts Limits als Chips, „$x heute“ und der Chip **Team $x / $y** (Kosten offener Tickets + Orchestrator gegen das Team-Budget, darüber in Wartet-Farbe); ein Klick darauf öffnet das Team-Panel, dort änderst du das Budget. Die Hover-Karte heißt „Kosten und Limits“. Die Team-Beobachtung („Team … ist fertig“) läuft hier, auch wenn das Team-Panel zu ist.

**Werkzeug-Panels und Fenster.** Alle Panel-Köpfe sehen aus wie bei Changes (42 px, Titel links, rechts höchstens drei Icon-Knöpfe mit Tooltip); Umschalter sind einheitliche Segmente (Git: Alle Zweige/Aktueller Zweig, Tree: Tree/Zuletzt, Docker: Laufend/Alle, Quests: Offen/In Arbeit/Alle). Git zeigt Branch und Update-Hinweis als Chips, Blueprint Projekt, Agent und Update als Chips („Neu laden“ in der Diagramm-Zeile). Marketplaces und MCP-Server haben dieselbe Titelzeile wie das Review-Fenster und einen Scope-Umschalter „Benutzer | Projekt“; der Tastenkürzel-Dialog hat eine Titelzeile mit Esc-Chip und Gruppen ohne Großbuchstaben.

Gestaltung nach `docs/ui-spec.md` (Tokens, Bausteine, Verträge zwischen den Mods); `docs/ui-preview.sh` startet ein isoliertes Vorschau-Fenster pro Worktree.

## Hermes

Mod `hermes`: Doppel-Ctrl (`"control control"` in `keys.json`, global und im Terminal) oder `cmd-shift-h` öffnet oben rechts (480×600, unter der Tab-Leiste) ein Fenster mit dem [Hermes Agent](https://github.com/NousResearch/hermes-agent) (`hermes`-TUI, aus dem PATH, sonst `~/.hermes/hermes-agent/hermes`, in der Login-Shell im Home-Ordner). Erneut drücken oder **✕** in der Titelzeile schließt es. Hermes läuft in einem unsichtbaren Core-Terminal namens `hermes` (`hc run --bg --no-parent`, ohne Space/Tab) weiter; Wiederöffnen zeigt dieselbe Sitzung. Beendet sich Hermes, schließt das Fenster, und das nächste Öffnen startet neu. Das Fenster lässt sich ziehen und merkt sich seinen Platz.

Aufbau: ein unsichtbarer 0-px-Block `hermes-host` (volle Breite, unter `root` in `elric`) empfängt `hermes.toggle` und misst die Fensterbreite; die Titelzeile ist dieselbe Mod mit `role: "titlebar"`.

**Grenzen:** Herdr kann ein Overlay-Terminal nicht per Befehl fokussieren (`pane.focus` erreicht nur Tab-Panes und Layout-Blöcke): nach dem Öffnen einmal in den Chat klicken. Esc geht an Hermes, nicht ans Fenster (Hermes braucht Esc selbst). Doppel-Ctrl nutzt die Modifier-Tap-Erkennung von GPUI; sie ist nicht dokumentiert und konnte ohne Bedienungshilfen-Recht nicht automatisch getestet werden, `cmd-shift-h` ist die sichere Taste.

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

## Team-Hub und Roster

Feste Agents liegen versioniert in `agents/roster.json`: Name, Rolle, Programm, Modell, Standard-Repo, Branch-Präfix, Labels, Notizen. Drei Beispiele sind angelegt (Zap/Umsetzer/omp, Ada/Prüfer/claude, Mira/Recherche/pi).

`hub agent list|show <name>|add …|edit …|rm <name>` verwaltet den Roster. `hub dispatch <ticket> --agent Zap` baut das Startkommando aus Programm und Modell, setzt `agent: Zap` ins Ticket, übernimmt `repo` und `branch_prefix`, wenn das Ticket sie nicht hat, und schreibt Rolle und Notizen in die Aufgabe. Ohne Roster-Eintrag gelten weiter die Programmnamen (`omp`, `claude`, `codex`, `pi`) oder ein freies Kommando.

Das Fenster **Team-Hub** (Knopf „Team-Hub“ in der Tab-Leiste, `⌘⌥9`, sonst `mod.open:teams`) zeigt die Agents als Karten mit Avatar in Agent-Farbe, Rolle, Programm/Modell, Repo sowie Einsätzen und Kosten; ein Klick zeigt die laufenden Tickets und startet auf Wunsch einen vorbelegten Auftrag. Anlegen, Bearbeiten und Löschen passieren im selben Fenster. `hub stats agents` zeigt Einsätze und Kosten je Roster-Agent.

## Harness je Agent (Roster v2)

Jeder Agent im Team-Hub ist ein vollständiges Profil in `agents/roster.json`:

| Teil | Felder |
|---|---|
| Rolle | `name`, `role`, `color`, `labels` |
| Harness | `program`, `model`, `smol`, `slow`, `models`, `approval_mode` (`always-ask`/`always-ask-cached`/`write`/`yolo`), `max_cost`, `no_lsp` |
| Prompt | `prompt` (Pfad, Standard `agents/prompts/<slug>.md`) |
| Umgebung | `repo`, `branch_prefix`, `skills`, `mcp`, `sandbox` (`worktree`/`repo`) |
| Grenzen | `wip`, `push`, `delete_branches` |

`hub agent command <name>` zeigt das Startkommando, das `hub dispatch` bauen würde; `hub agent prompt <name>` den Prompt. Der Dispatch hängt den Prompt als Abschnitt „Deine Rolle" vor die Aufgabe, schreibt Skills/MCP/Grenzen hinein und setzt `agent` und `harness` ins Ticket. Zwei Gates greifen vor dem Start: das Agent-WIP (hart, ohne `--force`) und das Stufen-WIP mit `--force --reason`.

## Fluss: WIP, Spec, Definition of Done

- **WIP-Limits** (`hub wip`, Standard `arbeit 3`, `pruefung 2`): `hub dispatch` verweigert über dem Limit und nennt die laufenden Tickets; `--force --reason` schreibt den Grund in den Verlauf. Das Board zeigt `n/limit` im Spaltenkopf, warnt bei Erreichen und dimmt die volle Stufe.
- **Spec-Gate**: `hub spec <id>` legt fehlende Abschnitte `Ziel`, `Abnahmekriterien`, `Grenzen` an. Ein Ticket ohne mindestens ein Abnahmekriterium kommt nicht in den Dispatch.
- **Definition of Done** (sechs Punkte, `hub gate`): Abnahmekriterien · `hub verify` grün am HEAD · Prüfstation `pass` · CI grün oder nicht nötig · Nachweise · Abschluss im Verlauf. `hub review` verweigert fehlende Punkte; das Review-Fenster zeigt die Liste mit ✓/–.

Hintergrund und Quellen: `docs/factory-research.md`.

## Freigaben des Menschen

Drei Stellen, alles andere belegt die Maschine: **Abnahme** (Ticket in `review`), **Rückfrage** eines blockierten Agents, **Landen** (Merge/PR). Das Dashboard führt genau diese unter „Wartet auf dich".

## Farben und Ebenen

Theme `themes/elric.json`: neutrale Dunkelpalette (Fenster `canvas #0b0c0e`, Arbeitsfläche `background #0e0f11`, Leisten `chrome #121418`, Karten `surface #16181b`, Hover `raised #22262b`, Popover `#1d2126`, Auswahl `#263149`), Text `foreground #e7e9ec` / `muted #aeb4bc` / `dim #949ba5`, ein Akzent `#4c8dff`, Status getrennt (`blocked #ef6d6d`, `success #5cb87a`, `warning #d9a441`). Jede Fläche liest nur Theme-Namen, keine Hex-Werte in Mods. Kontraste aller Textfarben ≥ 4,5:1 (dim auf Auswahl 4,6); Tabelle und Vorher/Nachher-Screenshots in `docs/ui/notes-Q.md`.

Ebenen-Regel: Fläche < Karte < Popover < Auswahl; Karten mit 1-px-Rand statt Farbfläche; Primärfarbe nur für die eine Hauptaktion je Fläche.

## Wechsel zwischen Workspace und Dashboard

`⌘⇧0` schaltet in beide Richtungen (global `layout.switch:dashboard`, im Dashboard `layout.switch:elric`). Zusätzlich: der Knopf **Dashboard** in der Tab-Leiste (links vor „Auftrag“), der Link **Dashboard** links in der Statusleiste und der Knopf **Workspace** im Dashboard. Herdr merkt sich das zuletzt gezeigte Layout und startet beim nächsten Mal dort.

## Start-Dashboard

`layouts/dashboard.json` ist eine ruhige Fabrik-Übersicht ohne Seitenleiste, Tab-Leiste und Statusleiste: eine Karte mit „Wartet auf dich“ (Tickets in Prüfung mit „Prüfen“, Rückfragen blockierter Agents mit Antwortfeld, offene Fragen aus dem Ticket-Verlauf als Link; Abschlussmeldungen fertiger Agents nicht), dem **Team** (je aktivem Agent Identitäts-Chip, Status, Space/Tab, Ticket, Dauer und Kosten; beendete Agents in einer eingeklappten Zeile „n beendet“, Gruppen nur für Spaces mit lebenden Agents; Teams als Gruppenzeile wie im Team-Panel) mit **Letzte Aktivität** (bis fünf Ereignisse aus den Ticket-Verläufen, Agents und Budgets) daneben, der Fabrik-Stufenleiste mit den wichtigsten Tickets in Arbeit und der **Kosten-Karte** rechts (heute, Team-Budget, pro Ticket; Klick öffnet das Team-Panel), dazu das Auftragsfeld an den Orchestrator (⌘↵ sendet; ohne laufenden Orchestrator steht dort „Orchestrator starten“). Leere Bereiche sind eine Zeile, kein leerer Kasten.

- **Zum Startbildschirm:** `⌘⇧0` wechselt zwischen `dashboard` und `elric`; im Dashboard geht dieselbe Taste zurück (Hinweis „⌘⇧0 Workspace“ unter dem Auftrag), ebenso der Knopf „Workspace“ und `g` `w`. Herdr startet mit dem zuletzt gezeigten Layout (`shared("layout")`), nach dem Wechsel also im Dashboard.
- **Rückweg:** `⌘⇧0` (in `keys.json` global `layout.switch:dashboard`, im Layout `dashboard` `layout.switch:elric`).
- **Im Dashboard:** `↑↓` wählt, `↵` öffnet (Agent → Terminal, Ticket → Review-Fenster), `r` antwortet der gewählten Rückfrage, `g` `w` geht zum Workspace, `Esc` räumt Wahl und Fokus. Ein Klick auf eine Team-Zeile wechselt auf `elric` und fokussiert den Tab des Agents; ein Klick auf die Kosten-Karte öffnet das Team-Panel; die Zeile „n beendet“ klappt die fertigen Agents auf.
- **Wartet-Zahl:** Die Zahl am Kopf ist die Anzahl der Zeilen und entspricht für ihre Teile dem Inbox-Zähler und der Stufe „Prüfung n“ (`docs/ui-spec.md` §7.3: blockierte Agents plus Tickets in Prüfung). Fragen aus einem Ticket-Verlauf zählen als eigene Zeile; ein blockierter Agent und seine Ticket-Frage erscheinen nur einmal. `hc read` und die gemeinsamen Daten werden höchstens alle 5 s neu gelesen.
- Datenquellen sind dieselben wie in Team, Inbox und Statusleiste: `shared("orchestra.tickets")` (mit `verlauf`; eine Frage ist der letzte Eintrag von einem Agent mit Fragezeichen, nicht der `question`-Treffer der Inbox), `agents()` plus der rohe Status aus `terminals()` (so bleibt ein fertiger Agent „fertig“), `shared("orchestra.costs")`, `shared("orchestra.budget")`, `shared("orchestra.groups")` und `shared("attention.since")`. `layouts/elric.json` bleibt unverändert.
