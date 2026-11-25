# Fabric — UI-Spezifikation

Ziel: Alles, was die Fabric hat, lässt sich im UI pflegen: Tickets, Team, Prompts, Orchestrator, Repo-Dateien und Einstellungen. Niemand muss dafür ins Terminal oder in eine Datei. Das UI wirkt wie ein professionelles Produkt, nicht wie ein Debug-Panel.

Grundlagen: `docs/concept.md`, Vertrag `docs/fabric.md` (Daten, CLI, Abschnitt 3b für Konfiguration). Der Mod schreibt nie selbst Dateien. Jede Änderung läuft über `fab`.

## 1. Flächen

| Fläche | Wo | Zweck |
|---|---|---|
| **Fabric-Fenster** | `openOverlay({ mod: "fabric", kind: "window", key: "fabric", keep: true, width: 0.86, height: 0.86, props: { view: "app" } })`, Taste `cmd-shift-f`, Knopf in jedem Panel-Kopf | Die Arbeitsfläche, in der alles gepflegt wird |
| Panel `tickets` | Sidepanel | Schnellzugriff: Liste, kompaktes Detail, Kommentar, Abnahme („Abnehmen“ oder „Nur PR öffnen“ → `fab accept --pr-only`, ohne Merge); Knopf „Im Fenster öffnen“ |
| Panel `timeline` | Sidepanel | Zeitverlauf |
| `inbox` | Seitenleiste | Was auf den Menschen wartet; Klick öffnet das Ticket im Fenster |
| **Fabric-Agenten** | Seitenleiste, Block `fabric-agents` (Mod `fabric-sidebar`) in `layouts/fabric.json` | Nach Team gruppiert, je Team der Orchestrator mit Badge zuerst, Agenten eingerückt mit Rolle, Status und Laufzeit; Klick öffnet das Terminal, der Ticket-Chip das Ticket |

**Zu entscheiden:** Der Posteingang in der Seitenleiste und die Seite **Posteingang** im Fenster zeigen alle offenen Entscheidungs- und Lehren-Vorschläge aller Tickets als Karten. Jede Karte nennt die Frage, den Vorschlagenden, die Begründung, den Ticket-Verweis, die Folgen je Antwort und die Knöpfe **Übernehmen** und **Ablehnen**; die Knöpfe wirken wie `fab decide confirm|reject` bzw. `fab lesson confirm|discard`.

Zwei bewusste Grenzen dieser Karten: Der Verlaufshinweis „Entscheidung offen → oben“ bzw. das Ergebnis am Kommentar (`commentDecisionHint`) erscheint nur, wenn der Kommentartext — nach Zusammenfassen von Leerraum — exakt dem Vorschlagssatz gleicht. `fab decide` und `fab lesson` legen selbst keinen Kommentar an; im Alltag trägt deshalb fast kein Kommentar den Hinweis. Entschiedene Karten stammen nur aus den letzten 300 Ereignissen (`MAX_EVENTS` in `fabric/fablib/index.py`); ältere entschiedene Vorschläge fallen still aus Ticket und Posteingang. Der Vorschlagstext selbst bleibt nur bei **Übernehmen** in `.fabric/decisions.md` bzw. `.fabric/lessons.md` erhalten; abgelehnte Vorschläge werden verworfen und nicht festgehalten.

Die gewählte Auswahl ist überall dieselbe: `shared("fabric.selected")`. Was das Fenster zeigt, steht in `shared("fabric.route")` (z. B. `{ page: "ticket", id: "T-3" }`).

**Fehlgeschlagener Agentenstart:** Scheitert ein Start beim Wecken, hält `fab` den gekürzten Grund (`hc`/`herdr-app`-stderr) im `wake`-Ereignis und als Kommentar fest. Nach 5 s folgt genau ein automatischer zweiter Versuch im Hintergrund. Scheitert auch der, steht im Posteingang ein Eintrag „Aufmerksamkeit“ mit Ticket, Agent und Grund und dem Knopf **Erneut starten**; ein erfolgreicher Start räumt den Eintrag ab. Beleg: `docs/assets/t27-retry.png`.

**Stillstand:** Solange das Fenster offen ist, ruft der Mod jede Minute `fab tick` auf (`docs/fabric.md` Abschnitt 4b). Karten von Tickets mit `stall` tragen „stockt seit …“, der Grund steht im Tooltip. Nach zwei erfolglosen Versuchen oder einer hängenden Kette steht im Posteingang genau ein Eintrag „Aufmerksamkeit“ mit „stockt seit …“, Grund und demselben Knopf **Erneut starten**; ein Kommentar oder eine zugestellte Weckung löst ihn auf. Beleg: mit `stall`-Daten aus einem temporären `HERDR_APP_HOME` (`stockt seit 23 min` bzw. `47 min`) geprüft; ein Screenshot war nicht möglich, weil das Willkommens-Overlay des temporären Homes nicht per CLI schließbar war. Die Darstellung folgt dem vorhandenen Chip-Muster aus T-27.

## 2. Fabric-Fenster

**Rahmen**
- Links eine Navigation (Icon + Wort) mit den Punkten: Board, Tickets, Workflows, Pipelines, Team, Prompts, Vorlagen, Repos, Einstellungen. Unten der Status des Orchestrators als Pill (läuft / wartet auf dich / gestoppt; Klick führt zu Team).
- Oben eine Leiste mit Suche (`/` fokussiert), dem Primärknopf **Neues Ticket**, der Autopilot-Lampe und dem Posteingang-Zähler (führt zur Seite **Posteingang**). Die Autopilot-Lampe steht nur hier, nicht zusätzlich in der Navigation.
- **Posteingang** ist die erste Seite der Navigation (mit Zähler). Reiter filtern nach Art: Alle, Prüfung, Fragen, Aufmerksamkeit, Zu entscheiden, jeweils mit Anzahl (`model.inboxPage`). Oben stehen bei „Alle“ und „Zu entscheiden“ die Entscheidungs- und Lehren-Karten, darunter je Eintrag eine Zeile mit Art, Ticket samt Titel, bis zu drei Zeilen Text, Absender und Zeit sowie **Prüfen** (bei Prüfungen) bzw. **Öffnen** und bei fehlgeschlagenem Agentenstart **Erneut starten**. Die Seite ersetzt das frühere Popover; der Knopf in der Seitenleiste öffnet sie im Fenster.
- Das Fenster lässt sich ziehen; Bedienelemente stoppen das Ziehen mit `cx.stop_propagation()` beim Mouse-Down.
- **Schmales Fenster (< 760 logische px):** Die Navigation wird zur Icon-Leiste über dem Inhalt; Suche und Knopftexte weichen Icons. Das Board stapelt seine Stufen untereinander, das Ticket-Detail wird einspaltig (Verlauf, darunter die Eigenschaften), Namen und lange Zeilen kürzen mit Ellipse und Tooltip. Belege: `docs/assets/t40-narrow-board.png`, `t40-narrow-team.png`, `t40-narrow-ticket.png`.

**Board**
- Spalten Entwurf · Geplant · In Arbeit · Prüfung · Fertig. „Fertig“ zeigt die letzten 20, „Verworfen“ ist ein Filter.
- Im Spaltenkopf steht die Anzahl; ist „Fertig“ gekappt, nennt er „20 von N“. Die Kopfzeile zählt alle Tickets, auch die nicht gezeigten fertigen. „Prüfung“ wird hervorgehoben, wenn darin etwas auf den Menschen wartet.
- Karten zeigen: ID, Titel (zwei Zeilen, gekappt mit „…“, voller Text im Tooltip), Avatar des Zuständigen, Kommentarzahl, das Badge „wartet auf dich“, Mini-Indikatoren für Checks und Urteil, Alter; bei Stillstand „stockt seit …“ (Tooltip = Grund). Zuständiger, Kommentarzahl und Alter bleiben nebeneinander sichtbar; die Status-Chips kürzen sich mit Ellipse, damit das „•••“-Menü in der Karte bleibt. Branch, Kosten und Liegezeit stehen als eine graue Metazeile.
- Ein leerer Filter oder ein leerer Datenbestand zeigt genau einen Leerzustand mit Aktion „Neues Ticket“ statt fünf leerer Spalten.
- Filterleiste: Suche, Zuständig, Repo.
- Klick auf eine Karte öffnet das Ticket. Status ändert man über das Kontextmenü der Karte oder im Detail; Drag & Drop ist nicht nötig.

**Tickets**: Tabelle (`Table`) mit den Spalten ID, Titel, Status, Zuständig, Repo, Aktualisiert, Kommentare. Sortierbar, gleiche Filter wie das Board, Tastaturnavigation. Der Filter „Verworfen“ ist mit dem Board geteilt.

Im Hauptfenster tragen Board und Tickets keinen Knopf „Im Fenster öffnen“; den gibt es nur in den Sidepanels.

**Ticket-Detail** (zweispaltig)
- Links:
  - Titel, inline editierbar.
  - **Zu entscheiden** oben im Ticket, vor Beschreibung und Verlauf: dieselben Karten mit Frage, Vorschlagendem, Begründung, Ticket-Verweis, Folgen je Antwort und den Knöpfen **Übernehmen**/**Ablehnen** (wie `fab decide confirm|reject` bzw. `fab lesson confirm|discard`). Entschiedene Karten bleiben mit Ergebnis, wer entschieden hat und wann sichtbar, ohne Knöpfe — begrenzt auf die letzten 300 Ereignisse (siehe oben).
  - Beschreibung im Markdown-Editor mit Umschalter Ansicht/Bearbeiten, Speichern/Verwerfen und einem Hinweis auf ungespeicherte Änderungen.
  - Verlauf: Kommentare mit Avatar, Name, Zeit (relativ, absolut im Tooltip) und hervorgehobenen `@erwähnungen`. Weck-Ergebnisse stehen als dezente Systemzeilen dazwischen. Kommentare, die zu einer Karte gehören, tragen nur den Hinweis „Entscheidung offen → oben“ bzw. das Ergebnis (übernommen oder abgelehnt, wer und wann), keinen Aktionsknopf. Neueste unten, der Verlauf scrollt beim Öffnen ans Ende.
  - Kommentarfeld: mehrzeilig, `@` schlägt Namen aller Teammitglieder vor (plus `orchestrator`, `mensch`), `cmd-enter` sendet. Unter dem Feld steht, wen der Kommentar wecken wird.
- Rechts, Eigenschaften:
  - Status: Select mit den erlaubten Übergängen; `done` nur über Abnehmen.
  - Zuständig: Select aus den Mitgliedern des Teams, zu dem das Ticket-Repo gehört.
  - Repo: Ordnerwahl mit `pickFolder` plus Liste bekannter Repos.
  - Basis.
  - Branch und Worktree: nur lesen, kopierbar.
  - Blockiert durch: Mehrfachauswahl offener Tickets, jede Abhängigkeit einzeln entfernbar.
  - Checks: Zustand, HEAD, Zeit, Ausgabe ausklappbar, Knopf „Prüfen“.
  - Liegezeiten: Verweildauer je Stufe (`In Arbeit`, `Prüfung bei ada`, `wartet auf mensch`).
  - Urteil: Zustand, von wem, Zusammenfassung.
  - Sessions: Chips mit Live-Status; Klick öffnet das Terminal, „Wecken…“ öffnet ein Feld mit Text und scrollt das Panel vollständig in den sichtbaren Bereich. Beleg: `docs/assets/t40-wake-panel.png`.
- Änderungen (Status Prüfung, mit Branch): Kopfzeile mit HEAD und Summe `+`/`−`; „Ansehen“ öffnet die Dateiliste (mit `+`/`−` je Datei), den Diff der gewählten Datei, die Commits und die Nachweise als Bild-Vorschau (Anhänge und im Handover genannte Dateien/Screenshots). Daten kommen aus `fab diff ID --json` bzw. `--file PFAD`. Das Öffnen merkt sich den HEAD; erst dann ist **Abnehmen** frei. Ein neuer HEAD (andere Commit-Spitze) sperrt wieder.
- Aktionsleiste, abhängig vom Status:
  - Entwurf: **Ausformulieren lassen**. Schreibt einen Kommentar „@orchestrator bitte ausformulieren und verteilen“.
  - Geplant: **Verteilen**. Ruft `fab dispatch`. Fehlen Voraussetzungen, nennt der Knopf sie im Tooltip und ist deaktiviert.
  - In Arbeit: **Prüfen** und **Agent wecken…**.
  - Prüfung: **Abnehmen** (primär, bis die Änderungen für den aktuellen HEAD angesehen wurden deaktiviert) und **Zurück mit Feedback**.
  - Immer: **Verwerfen…**.
  - Abnehmen und Verwerfen öffnen einen Bestätigungsdialog, der sagt, was passiert: Merge in welche Basis, welcher Worktree und welche Sessions verschwinden.

**Neues Ticket** (Dialog): ein Satz oder ein Issue, Repo (vorbelegt mit dem Git-Root des fokussierten Terminals), Vorlage, Issue und Schalter „Orchestrator sofort ausformulieren lassen“ (Standard an).
- **Vorlage**: Dropdown „Ohne Vorlage“ plus Bug, Feature, Refactor und Chore aus `fab template list --json`. Eine gewählte Vorlage füllt den Rumpf (`--template=NAME`); im Text wird `{satz}` durch den Satz ersetzt, der Titel ist der Satzanfang. Eine Vorlage und ein Issue schließen sich aus.
- **Issue**: Dropdown „Ohne Issue“ plus alle offenen Issues des gewählten Repos (`#12 Titel` aus `fab issue list --repo=PFAD --json`). Ein Issue setzt Titel, Rumpf und den Verweis (`--issue=N`) und leert die Vorlage. Fehlt `gh` oder die Authentifizierung, steht der Grund als Hinweis im Dialog; ein Ticket von Hand bleibt möglich. Ohne Repo ist das Issue-Dropdown nicht verfügbar.
- **Anlegen** ist frei, sobald ein Satz da ist oder ein Issue gewählt wurde.
- Mit Schalter aus wird nur ein Entwurf angelegt, mit `--no-wake` am automatischen Kommentar.

**Team**
- Karte **Blaupausen**: je Blaupause Avatar in Rollenfarbe, Name, Rolle, Programm/Modell und die Teams, in denen sie Mitglied ist.
- Anlegen und Bearbeiten in einem Drawer rechts: Name (Umbenennen), Rolle, Farbe (Swatches c1–c6), Programm (Select aus `knownAgents()`, nicht installierte markiert), Modell, weitere Flags nach Shell-Regeln und Rollenprompt im Editor. Speichern ruft `fab blueprint add` bzw. `fab blueprint edit` auf.
- Löschen mit Bestätigung; `fab` verweigert Blaupausen, die noch Mitglied eines Teams sind, mit Begründung.
- Je Team eine Karte:
  - Repos als Liste mit Entfernen; Hinzufügen aus bekannten Repos oder per Ordnerwahl.
  - Mitglieder aus den Blaupausen; je Mitglied optionale Übersteuerungen für Modell und `max-cost`.
  - Prüfer (Select, nur Mitglieder) und maximale gleichzeitige Sessions (`NumberInput`, 1–16).
  - Der Teamname steht als Feld in der Karte; ein geänderter Name wird als `--rename` mitgespeichert.
  - Speichern ersetzt Repos und Mitglieder als ganze Liste über `fab team edit`; Fehler von `fab` (Repo vergeben, Prüfer kein Mitglied, laufende Sessions beim Umbenennen) stehen inline an der Karte.
  - Orchestrator: Status, Start / Stoppen / Neu starten, „Terminal öffnen“ (Peek), Programm und Prompt-Pfad; „Prompt bearbeiten“ öffnet den Prompt dieses Teams (`fab prompt show/set orchestrator --team …`). Nutzen mehrere Teams denselben Promptpfad (`prompt_shared`), markiert die Karte den Pfad als geteilt und nennt per Tooltip die anderen Teams (`shared_with`); „Prompt bearbeiten“ wirkt dann auf alle diese Teams.
- **Neues Team** (Knopf über der Teamliste): Dialog mit Name, Repos, Mitgliedern, Prüfer und maximalen Sessions. `fab team add` legt automatisch `prompts/orchestrator-<name>.md` als Kopie der aktuellen Vorlage an. Fehler von `fab` stehen inline im Dialog.
- Team löschen über „Team löschen“ an der Karte mit Bestätigungsdialog, der die Repos nennt. `fab team rm` verweigert mit Begründung, solange offene Tickets in den Repos des Teams liegen, sein Orchestrator (`fab orchestrator stop <name>`) oder eine Agenten-Session (`hc kill <terminal>`) läuft; die Meldung steht verbatim im Dialog. Die Promptdatei bleibt nach dem Löschen erhalten.
- Beleg: `docs/assets/t22-teams.png` (Team-Seite mit „Neues Team“-Dialog und „Team löschen“ an der Karte).

**Prompts**
- Liste: Orchestrator, Präambel, je Blaupause.
- Rechts ein Editor (`Editor`, Markdown) mit Speichern/Verwerfen, Kennzeichnung ungespeicherter Änderungen und `cmd-s`.
- Bei der Präambel eine Legende der Platzhalter. `fab` warnt bei unbekannten Platzhaltern.

**Vorlagen**
- Liste links in fester Reihenfolge: Bug, Feature, Refactor, Chore, danach weitere alphabetisch.
- Rechts ein Markdown-Editor mit Byte-Anzahl, Kennzeichnung ungespeicherter Änderungen, **Speichern** (`cmd-s`, `fab template set NAME --text=… --from=mensch`) und **Verwerfen**.
- Hinweis über dem Editor: `{satz}` wird beim Anlegen eines Tickets durch dessen Satz ersetzt. Die Dateien liegen neben dem aktiven Roster (`FAB_TEMPLATES` bzw. `templates/`), mit den mitgelieferten Vorlagen als Rückfall.
- Ungespeicherte Änderungen gehen beim Wegnavigieren nicht still verloren (Dialog mit Speichern / Verwerfen / Abbrechen).

**Repos**
- Bekannte Repos: aus Tickets und aus den Ordnern der Herdr-Spaces.
- Je Repo:
  - Branch, Anzahl offener Tickets;
  - Prüfskript `.fabric/verify.sh` (Editor, „Speichern“, „Jetzt testen“ mit Ausgabe und Exit-Code; „Fehlt – anlegen“ mit Vorlage);
  - Lernnotizen `.fabric/lessons.md` (Editor).

**Einstellungen**: Datenordner, Anzahl der Tickets und Ereignisse, Version von `fab`, Pfad des Rosters und Hinweise zu den Tasten. Die Karte **Betrieb** schaltet „Fabric pausieren“ (`fab pause` / `fab resume`); solange die Fabric pausiert ist, steht oben im Fenster ein Hinweis mit **Fortsetzen**.

## 3. Qualitätsmaßstab

- **Design-Token an einer Stelle (`ui.js`):**
  - Abstände 4/8/12/16/24; Ausnahmen nur `0`;
  - Schrift 11/12/13/15/18;
  - Radien 6/8/12;
  - Spaltenbreiten `SIZE.listPane` (260) und `SIZE.inspector` (320), Dialoge `SIZE.modal` (520) und `SIZE.modalWide` (580), Drawer `SIZE.drawer` (420);
  - Farben nur über `theme()`; Tönungen ausschließlich über `ALPHA` (`clear`, `faint`, `soft`, `tint`, `border`, `veil`);
  - ein Wörterbuch für Statusfarben und -wörter (`model.js`), dazu `PAGE_WORDS`, `roleLabel`, `promptKindWord`;
  - Avatare aus Initialen in der Rollenfarbe, Schrift mindestens `FONT.xs`.
- **Jede Aktion** hat:
  - einen Busy-Zustand, in dem der Knopf deaktiviert ist und einen Spinner zeigt;
  - bei Erfolg einen kurzen Toast (`notify`, `level: "success"`);
  - bei Fehler die stderr-Meldung von `fab` inline am Ort und als Toast `error`.
  Erfolg gibt es nur bei Exit-Code 0.
- **Destruktive Aktionen** (Abnehmen, Verwerfen, Agent löschen) nur nach Bestätigung im Dialog.
- **Ungespeicherte Änderungen** gehen beim Wegnavigieren nicht still verloren: Dialog mit Speichern / Verwerfen / Abbrechen.
- **Tastatur:**
  - `cmd-shift-f` Fenster;
  - im Fenster: `cmd-n` neues Ticket, `/` Suche, `↑/↓` in Listen, `Enter` öffnen, `Esc` zurück, `cmd-enter` Kommentar senden, `cmd-s` speichern.
- **Leerzustände** mit Erklärung und passender Aktion: immer `ui.emptyState`, in niedrigen Panels `compact`.
- **Fehler** immer `ui.notice`, direkt unter dem Seitenkopf; Aktionsknöpfe gehören in die `actions` der Notice.
- **Jede Seite** beginnt mit `ui.header`; rechte Detailspalten nutzen `ui.detailHeader`.
- **Ladezustand** beim ersten Lesen.
- **Lange Texte** werden abgeschnitten, der volle Text steht im Tooltip.
- **Icon-Knöpfe** haben immer einen Tooltip.
- **Performance:**
  - kein `exec` und kein Dateizugriff in `render`;
  - Daten über `watchFolder` mit Entprellung (≤ 1 Lesevorgang / 250 ms) plus 5-s-Rückfall;
  - Live-Status aus `agents()`/`terminals()`.
- **Code:**
  - `model.js` rein und getestet;
  - je Seite eine Datei unter `views/`;
  - wiederverwendbare Bausteine nur in `ui.js`, keine Kopien;
  - Icons als SVG im Mod, mit Lizenzhinweis, falls fremd.
- **Sprache:** deutsch, durchgängig dieselben Wörter: Entwurf, Geplant, In Arbeit, Prüfung, Fertig, Verworfen, Zuständig, Prüferin/Prüfer, Abnehmen.

## 4. Knöpfe statt nur Tasten

Jede Funktion mit Taste ist auch als sichtbarer Knopf erreichbar; Tasten sind nur Abkürzungen und stehen im Tooltip des Knopfs (z. B. „Speichern (⌘S)“). Das gilt für: Fabric-Fenster öffnen/schließen, Panels Tickets/Timeline ein- und ausblenden, Neues Ticket, Suche, Speichern/Verwerfen in Editoren, Kommentar senden, Zurück im Detail.
