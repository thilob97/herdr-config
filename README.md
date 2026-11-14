# herdr-config

Meine Konfiguration für die [Herdr](https://herdr.dev) Desktop-App. Das Repo ist direkt `~/.config/herdr-app`.

## Regel für Agents

Nach **jeder** Änderung an dieser Config sofort committen und pushen (`git add -A && git commit && git push`).

Neue Panel-Mods (Seitenleisten wie Git-Graph, Timeline) **nicht** als eigene Spalte andocken, sondern in die Leiste oben neben Files/Changes:

1. In `layouts/elric.json` dem Stack `panel-body` ein Kind geben: `{ "id": "<id>", "type": "block", "content": { "mod": "<mod>" } }`.
2. In `mods/tabs-graph/main.js` die ID in die Konstante `PANELS` aufnehmen und eine Zeile `.child(panelButton("<id>", "<Label>", "mods/<mod>/<icon>.svg"))` nach den bestehenden Buttons ergänzen. Damit gibt es auch das Kommando `tabs-graph.panel-<id>`; in `keys.json` unter `layout:elric` die nächste freie `cmd-alt-<n>`-Taste darauf legen.
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
| `agent-cards` | Agents als Karten (Klon von `agents`): Avatar, OMP-Modell, Kontext, Kosten, Sub-Agents |
| `sidebar-footer` | Fuß der Seitenleiste: Settings, Marketplaces, MCP servers, Tastenkürzel, Add machine (Klon von `workspace-chrome`) |
| `tabs-graph` | Tab-Leiste mit Buttons Starten, Inbox (mit Zähler) und Review, dann die Panels Changes, Git, Tree, Blueprint, Docker, Quests, Team als Icon-Gruppe (das offene zeigt seinen Namen, Tooltip mit Taste) (Klon von `tabs`) |
| `status-bar` | Statusleiste (Klon von `workspace-status`): Maschine, Branch, Agents, Attention-Badge, Limits und Kosten |
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

**Attention:** `status-bar` merkt sich, seit wann jeder Agent in seinem Status ist (`shared("attention.since")`), und zeigt ein Badge `● 2 wartet · 1 fertig` (Klick öffnet die Inbox). `cmd-j` springt zum nächsten Agent, der wartet: erst *blocked*, dann *done*, jeweils der älteste zuerst; erneut drücken geht weiter. Funktioniert über alle Spaces und Maschinen, aber nur in Layouts mit `status-bar` (`elric`, `quests`).

Die Oberfläche folgt einer Fabrik: **Eingang** (Auftrag-Dialog, Quests) → **Stationen** (Team-Panel: Geplant › In Arbeit › Prüfung › Fertig) → **Gates** (Checks, Review-Fenster) → **Output mit Nachweisen** (Review-Fenster: Mergen, PR, Abnehmen). Was auf dich wartet, sammelt die **Inbox**. Agents selbst stehen nur in der Seitenleiste; alle anderen Stellen zeigen sie als Chip (Avatar und Name aus `shared("agents.identity")`, Status), ein Klick geht hin.

**Auftrag** (`cmd-shift-n` oder Knopf **Auftrag** in der Tab-Leiste) ist der einzige Eingang für neue Arbeit, ein Dialog mit zwei Modi (Umschalter oben; Standard „Ans Team“, wenn ein Orchestrator läuft):

- **Ans Team:** ein Textfeld, **An das Team** schickt es an den Orchestrator (`hc send orchestrator`; wartet er auf eine Antwort, mit `--force`). Läuft keiner, steht dort ein Hinweis aufs Team-Panel.
- **Selbst starten:** Vorlage, Space (bestimmt Maschine und Ordner), ein oder mehrere Agents (mehrere = je einer pro Agent, parallel), wo: neuer Tab im Space oder je ein eigener Git-Worktree unter `~/.herdr/worktrees/<repo>/` mit eigenem Space (bei mehreren Agents bekommt der Branch `-<agent>` angehängt). Tab-Name und erste Nachricht sind vorbelegt; `{folder}`, `{branch}`, `{branchnote}` und `{space}` werden beim Start ersetzt. Gestartet wird über `herdr-app do tab.new|space.new`. „Als Team beobachten“ legt aus den gestarteten Agents ein Team an.

Aufrufe mit Ticket (aus Quests): `openOverlay({ mod: "launcher", kind: "dialog", width: 860, height: 680, props: { mode: "team" | "self", ticket } })` füllt Text, Tab-Namen und Branch vor. Was daraus gestartet wird, gibt der Dialog über `shared("quests.handover")` an Quests zurück (siehe Quests).

**Vorlagen** sind Markdown-Dateien in `mods/launcher/templates/` (getrackt), Kopf `name:` (Anzeige) und `tab:` (Tab-Name, Branch-Präfix), darunter die Nachricht. Mitgeliefert: Bug fixen, Feature bauen, Code-Review, Tests schreiben, Codebase erklären, Refactoring. Neue Datei = neue Vorlage beim nächsten Öffnen.

**Inbox** (`cmd-shift-j` oder Knopf **Inbox** in der Tab-Leiste) ist die eine Freigabe-Stelle, in dieser Reihenfolge: **Rückfragen** (Agents, die warten, auch der Orchestrator), **Abnahmen** (Tickets in Prüfung), **Fertig** (fertige Agents), darunter abgedimmt **Arbeitet**. Der Zähler im Kopf ist derselbe wie am Inbox-Knopf: wartende Agents (+1, wenn der Orchestrator fragt) plus Tickets in Prüfung, sonst die Zahl der fertigen. Rechts der Bildschirm des gewählten Agents bzw. Orchestrators (`hc read`, alle 2,5 s neu) mit Antwortfeld, bei einem Ticket Zusammenfassung, Gates und Nachweise mit **Prüfen**. `↑/↓` wählen, `↵` hingehen bzw. prüfen, `r` antworten (über `hc send`; bei *blocked* mit `--force`, die Antwort beantwortet seinen Dialog), `v` Review (bei *done*).

**Review-Fenster**, zwei Modi:

- **Ticket-Modus** (Knopf **Prüfen** im Team-Panel oder in der Inbox; `props.ticket`): Titel, Gate-Chips (`Checks ✓/✗/–`, `Review offen`, `abgenommen`), die Zusammenfassung des Orchestrators und die Nachweise (Klick öffnet die Datei), darunter der Diff des Ticket-Branches gegen seine Basis (auch wenn der Agent schon beendet ist). Unten die Abnahme: **Mergen**, **PR**, **Änderungen …** (Feedback an den Orchestrator, das Ticket geht zurück auf „in Arbeit“) und **Nur abnehmen**. Das Ergebnis steht im Fenster.
- **Terminal-Modus** (`cmd-shift-r` oder Knopf **Review** in der Tab-Leiste für das fokussierte Terminal; aus der Inbox, von einer Agent-Karte oder per Knopf am Toast „… ist fertig“): Git-Änderungen im Ordner des Agents, auch auf entfernten Maschinen. Dateiliste mit +/−, Diff, Branch mit ↑/↓. Aktionen: **Commit** (`git add -A` + `git commit`, Nachricht mit Tab-Namen vorbelegt), **Feedback senden** (`hc send`), **Zum Agent**, **Changes-Panel** (wählt Space und öffnet `changes`), **Worktree entfernen** (nur unter `~/.herdr/worktrees/`, öffnet den mitgelieferten Worktree-Dialog).

Das Review-Fenster vergleicht Branches mit ihrem Abzweig von der Ticket-Basis, `origin/HEAD`, `main` oder `master` (Kopf: „gegen main · N Commits“); auf dem Haupt-Branch selbst zeigt es nur Uncommittetes. **Commit** gilt nur Uncommittetem.

**Team** (Panel, `cmd-alt-7` oder Knopf **Team**): im Kopf die Pipeline `Geplant n › In Arbeit n › Prüfung n › Fertig n` (Klick springt zur Sektion; Prüfung in Pink, sobald etwas auf dich wartet). Darunter die Orchestrator-Karte, dann die Tickets nach Stufe: **Prüfung** (Zusammenfassung, Gate-Chips und **Prüfen**), **In Arbeit** (am Ende die Budget-Chips), **Geplant**, die **Teams** und, eingeklappt, **Fertig**. Jedes Ticket zeigt seinen Agent als Chip, Branch, Gates und `$ausgegeben / $Budget`; ein Klick geht zum Agent. Teams (`shared("orchestra.groups")`, angelegt aus der Auswahl in der Seitenleiste oder vom Auftrag-Dialog) zeigen Fortschritt pro Mitglied, „alle fertig“, Beobachten an/aus und Auflösen. Die Statusleiste beobachtet die Teams, auch wenn das Panel zu ist: Hat ein Mitglied gearbeitet und arbeitet bzw. wartet keins mehr, kommt einmal „Team … ist fertig“ mit Ton.

**Orchestrator** (Karte oben im Team-Panel): ein eigener Agent (Standard omp, umschaltbar über den Agent-Namen auf der Karte), der immer läuft: ein unsichtbarer Block `orchestra-daemon` (0 px, in der Statuszeile von `elric`) startet ihn, wenn keiner läuft, außer er wurde mit **Anhalten** gestoppt (dann bietet die Karte **Starten**). Er hat kein eigenes Tab; **Öffnen** zeigt sein Terminal (Peek), die Karte seinen Schritt bzw. seine letzte Nachricht. Fragt er dich etwas, erscheint auf der Karte und in der Inbox ein Antwortfeld. Aufträge bekommt er über den Auftrag-Dialog. Er arbeitet in `~/.herdr/orchestrator` mit den Anweisungen aus `mods/orchestra/orchestrator.md` (bei jedem Start als `AGENTS.md`/`CLAUDE.md` kopiert) und hat `mods/orchestra/bin/hub` im PATH:

- `hub ticket new|list|show|set` legt Tickets als lokale Quests-Tickets an (`data/quests/tickets/*.md`, Feld `by: orchestrator`; Quests-Quelle „Lokal“ ist dafür eingeschaltet). Quests behält die zusätzlichen Felder (`machine`, `agent`, `branch`, `worktree`, `terminal`, `checks`, `evidence`, `by`, `updated` …) beim Bearbeiten.
- `hub dispatch <id> [--agent omp|claude|codex]` legt einen Worktree `~/.herdr/worktrees/<repo>/<branch>` an (auch `--on <maschine>` über `hc exec`) und startet den Agent dort mit `hc run` als Kind des Orchestrators, in einem eigenen Herdr-Space, mit dem Ticket als erster Nachricht. Rückfragen und Ergebnisse der Agents kommen über hc direkt beim Orchestrator an; er klärt sie selbst.
- `hub review <id> --summary … --checks pass|fail --evidence <pfad> [--evidence <pfad>]…` übergibt erst geprüfte Arbeit an dich: Das Ticket rückt in **Prüfung** und in die Inbox (Abnahmen), mit Zusammenfassung, Gate-Chips (`checks`) und Nachweisen (`evidence`, Dateipfade), dazu Meldung und Ton. `orchestrator.md` verlangt beides bei jedem `hub review`. **Prüfen** öffnet das Review-Fenster im Ticket-Modus.
- **Mergen** (`hub land <id> --merge`) mergt den Branch mit `--no-ff` in seine Basis (der Branch, auf dem das Repo beim Verteilen stand, Feld `base`), beendet den Agent, entfernt Worktree und Branch und sagt es dem Orchestrator. Voraussetzung: Worktree committet, Haupt-Checkout sauber und auf der Basis. Bei einem Konflikt wird der Merge abgebrochen und das Ticket mit Auftrag zum Rebase an den Orchestrator zurückgegeben. **PR** (`hub land <id> --pr`) pusht den Branch nach `origin` und öffnet mit `gh pr create` einen Pull Request (Text aus der Zusammenfassung); Branch bleibt, Worktree und Agent gehen. **Nur abnehmen** (`hub done`) setzt `done` ohne Merge.
- **Kosten und Budget:** Alle 30 s liest der Watcher über `mods/agent-cards/helpers/omp-cards.py` die Kosten der omp-Sitzungen von Ticket-Agents und Orchestrator, rechnet sie den Tickets zu und schreibt `data/orchestra/costs.json` (auch in `hub status`). Die Karte zeigt die Orchestrator-Kosten, jedes Ticket `$ausgegeben / $Budget`, am Ende von „In Arbeit“ `$3/Ticket` und `Team $x / $20` (anklicken zum Ändern; gespeichert in `shared("orchestra.budget")`). Über dem Ticket-Budget wird dessen Agent angehalten (`hc interrupt`) mit Meldung und **+$…** zum Freigeben; über dem Team-Budget (offene Tickets + Orchestrator) werden alle Ticket-Agents und der Orchestrator angehalten. Kosten melden nur omp-Agents.
- Der Orchestrator mergt und pusht nie ohne ausdrückliches OK. Endet ein Zug von ihm (Antwort oder Rückfrage), kommt die Meldung „Orchestrator meldet sich“ bzw. „… braucht dich“.

**Aus Quests:** Im Quests-Panel beim Drüberfahren über ein Ticket **Orchestrator** (Auftrag-Dialog „Ans Team“) und **Start** („Selbst starten“), in der Detailansicht **An Orchestrator** und **Start**. Der Dialog ist mit dem Ticket vorbelegt; lokale Tickets werden direkt die des Orchestrators (`by: orchestrator`), GitHub, Asana und Trilium bekommt er mit Text, Link und dem passenden lokalen Checkout (aus den Spaces) und legt sie mit `hub ticket new --source <url>` an. Die Quests-Zeile zeigt danach „beim Orchestrator“ und seinen Status.

**Tastenkürzel** (`cmd-/` oder **Tastenkürzel** unten in der Seitenleiste): alle Belegungen aus `keys.json`, gruppiert und filterbar; Herdrs eigene Liste bleibt auf `cmd-shift-/`. Neue Mod-Kommandos bekommen ihre deutsche Beschreibung in `DESC` in `mods/cheatsheet/main.js`, sonst erscheint der Befehlsname.

| Taste | Wirkung |
|---|---|
| `cmd-j` | nächster wartender Agent |
| `cmd-shift-j` | Inbox |
| `cmd-shift-r` | Review für das fokussierte Terminal |
| `cmd-shift-t` | neuer Tab mit `omp` |
| `cmd-/` | Tastenkürzel-Übersicht |
| `cmd-shift-n` | Auftrag (Ans Team oder Selbst starten) |
| `cmd-shift-b` | rechtes Panel ein/aus (`elric`) |
| `cmd-alt-1` … `cmd-alt-7` | Panel Changes, Git, Tree, Blueprint, Docker, Quests, Team (`elric`; erneut drücken schließt) |

## Externe Addons

Sauber aus folgenden Quellen installiert; vorhandene Lizenzen liegen bei den Mods. Nicht angegebene Release-Versionen sind durch den vollständigen Commit gepinnt.

| Addon | Quelle | Version / Commit |
|---|---|---|
| `blueprint` | [chappse6/herdr-blueprint-app](https://github.com/chappse6/herdr-blueprint-app), `mods/blueprint` | 0.3.5 · `9e6533ace80e392a14311ad05c1dbda10696deda` |
| `filetree` | [cybertron288/herdr-mods](https://github.com/cybertron288/herdr-mods), `filetree/mods/filetree` | `34e7c3348e954fd0a1147b846898db8c3e37e526` |
| `file-icons` | [cybertron288/herdr-mods](https://github.com/cybertron288/herdr-mods), `file-icons/mods/file-icons` | `34e7c3348e954fd0a1147b846898db8c3e37e526` |
| `git-graph` | [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph), `mods/git-graph` | 0.3.2 · `2f4fe0fc22e7cc726f3c1a2a654887c96227c37b` |
| `space-folders` | [jankeesvw/herdr-space-folders](https://github.com/jankeesvw/herdr-space-folders), `mods/space-folders` | `63a78b20d5ed30d57166a3c7165a6eb558c3ef84` |

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
