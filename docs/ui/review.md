# UI/UX-Review des Gesamtumbaus — zweiter Durchgang (Kontroll-Review)

Basis: `feat/ui-umbau` @ `6da7aa3` (Merge Paket C Kostenformat; davor B- und C-Nachbesserungen,
Tickets-Werkzeuge Teil 1). Der Branch `feat/ui-review` wurde dafür auf diesen Stand zurückgesetzt.
Geprüft wurde alles aus dem Ticket erneut, nicht nur die Nachbesserungen. Der Bericht des ersten
Durchgangs steht unverändert im Anhang; seine Screenshots liegen weiter unter `/tmp/ui-review/`, die
dieses Durchgangs unter `/tmp/ui-review2/`.

## Urteil

**Abnahmefähig — ja**, mit kleinen Auflagen. Von den 10 Major des ersten Durchgangs sind 8 belegt
behoben (A1, A2/S3, B1, B2, B3, B4, C1, C2); der Kontrast (S1) ist auf den Hauptflächen behoben und
hat zwei Reste (N4), der Fokusrand (S2) ist umgesetzt, konnte im Hintergrundfenster aber nicht
bewiesen werden. Von den 18 Minor sind 16 behoben, 2 offen (B5; A5 nur für Karten und Spaces, nicht
für Tabs). Von den 7 Nit sind 5 behoben (B16, B17, B18, C5, C7), 2 bleiben (A7, A8). Dazu kommen 7
neue Minor und 6 Nit — keiner davon blockiert den Fabrikpfad
(Auftrag → Stufenleiste → Prüfung → Review → Mergen). Ein Blocker ist nicht dabei.

Empfohlen, bevor das Review-Ticket zugeht (jeweils < 30 min, Details unten): B5 (Stufenleiste lässt
mit zweistelligen Zählern eine Stufe weg), N1 (roher Exec-Fehler im Review-Fenster nach dem Mergen),
N4 (Auftrag-Hinweis 2,77:1), N7 (Titel in der Inbox-Abnahme auf 12 Zeichen), N8 (zwei Zahlen unter
„Arbeitet").

## Verfahren

- Testfenster nach Spec §1 neu aufgebaut (`docs/ui-preview.sh up` nach dem Reset), eigenes Test-Home
  `~/.herdr/ui-preview/feat-ui-review`, Core `uiprev-36b2d7e3`, Demo-Welt, Fenster 1710×1010.
- Aufgenommen (Screenshots in `/tmp/ui-review2/`): Gesamtfenster (mit Team-Toast), Sidebar
  (normal, Rail, 11 Spaces, Auswahl, Hover, Mehr-Menü), Tab-Leiste (4 und 9 Tabs), Status- und
  Versorgungsleiste, Team-Panel (Demo-Daten, 12 Tickets, nach dem Mergen), Quests (Panel und Layout
  `quests`), Changes/Git/Tree/Blueprint/Docker, Review-Fenster (Ticket-Modus mit Gates und
  Nachweisen, Terminal-Modus, nach dem Mergen), Inbox, Auftrag-Dialog (3 Varianten), Toasts
  („wartet", „Team fertig"), Marketplaces, MCP-Server, Tastenkürzel, Theme `elric`.
- Ablauf echt gegen die Demo-Welt: `hub ticket new` → `status=doing` → `hub review --checks pass
  --evidence …` → Review-Fenster im Ticket-Modus → `hub land --merge` (Merge im Demo-Repo
  `fe87949`), danach Fenster im abgeschlossenen Zustand. Zusätzlich geprüft: `hub review` ohne
  `--checks/--evidence` erhält beide Felder (Ticket-Datei und `orchestra.tickets`).
- Grenzen (unverändert): Maus- und Tastenereignisse lassen sich nicht in das Hintergrund-Testfenster
  posten. Hover/Auswahl habe ich wie im ersten Durchgang kurzzeitig im Test-Home injiziert und per
  `sync` zurückgenommen (`33-sidebar-auswahl-hover.png`). Klickpfade sind am Code und über dieselben
  Kommandos geprüft, die die Knöpfe aufrufen.

## Stand der Befunde aus dem ersten Durchgang

| ID (Runde 1) | Schwere | Stand | Beleg |
|---|---|---|---|
| C1 „+" im scrollenden Streifen | major | **behoben** — „+" und Überlaufzähler `+n` stehen fest neben dem Streifen, Tooltip nennt ⌘⇧] | `47-tabs-viele.png` |
| A1 Ordner-Menü/-Dialog englisch | major | **behoben** — „Neuer Ordner", „Ordner löschen", „Abbrechen", „Sichern", „Neue Spaces starten in"; `Loading…` → „lädt …" | `mods/space-folders/main.js:166,618-648` |
| A2/S3 „This computer" | major | **behoben** — überall „Dieser Computer" | `10-panel-quests.png`, `32-sidebar-many.png` |
| B1 Quests nennt Prüfung „in Arbeit" | major | **behoben** — `STAGE_WORD = {todo: Geplant, doing: In Arbeit, review: Prüfung, done: Fertig}`, Zeilen zeigen „Prüfung" | `10-panel-quests.png`, `46-layout-quests.png` |
| B2 Start für laufende Tickets | major | **behoben** — laufend: primär „Zum Agent", „An Orchestrator" sekundär, kein „Start" | `46-layout-quests.png`, `quests/main.js:307-315` |
| B3 Toast englisch/ohne Identität | major | **behoben** — „Glitch wartet auf dich" mit Identitäts-Chip (Avatar, Name, Status) | `36-toast-wartet.png` |
| B4 Toast über der Versorgungsleiste | major | **behoben** — Toast-Karte hält 36 px (28 + 8) Abstand, Versorgungsleiste bleibt frei | `36-toast-wartet.png`, `44-ablauf-5-gemergt.png` |
| S1 Kontrast | major | **weitgehend behoben** — Kosten, Branch, Gates, Nachweise, „Nur abnehmen", Statusleiste auf `muted` (5,3–15:1); `elric`-`dim` 4,55–5,8; Reste siehe N4 | Messungen unten |
| S2 Fokusrand | major | **umgesetzt, im Hintergrundfenster nicht beweisbar** — `ui.focusFields()` in sieben Mods, `border(accent)` bei Fokus; im Testfenster bleibt der Rand `input`, weil das Fenster nicht Tastaturfokus hat. Im Vordergrundfenster gegenprüfen | `mods/launcher/ui.js:32-41,185`, `23-auftrag-team.png` |
| B5 Stufenleiste ohne Kürzung | minor | **nicht behoben** — mit `Geplant 12` ist die Leiste voll und „› Fertig 1" fällt still weg (`overflow_hidden`); Zähler `99+` allein reicht nicht. Vorschlag: bei Platzmangel nur die Zähler zeigen (`12 · 1 · 1 · 1`, Tooltip mit Stufe) oder die Leiste zweizeilig | `45-team-viele-tickets.png` |
| B6 leere Stufen verschwinden | minor | **behoben** — alle vier Stufen mit „Nichts in Prüfung."/„Nichts in Arbeit." | `10-panel-team.png` |
| B7 mehrere primäre „Prüfen" | minor | **behoben** — primär nur das älteste Prüf-Ticket, die anderen sekundär (nachgemessen) | `43-ablauf-4-review.png` |
| B8 Budget-Chips ohne Affordanz | minor | **behoben** — Stift-Icon + Tooltip „Klicken: erhöhen" | `10-panel-team.png` |
| B9 zwei Zahlenformate | minor | **behoben** — `ui.usd()` überall (`$2.87 / $20`, `$162 heute`) | `01-overview.png`, `45-team-viele-tickets.png` |
| B10 Inbox zählt doppelt | minor | **behoben** — Badge statt Satz; Hinweise auf `muted` | `22-inbox.png` |
| B11 Abnahme-Zeile nur ein Gate | minor | **behoben** — „Checks –" und „Review offen" | `22-inbox.png` |
| B12 Popup über der Tab-Leiste | minor | **behoben** — Popup beginnt bei 48 px unter der 42-px-Leiste | `22-inbox.png` |
| B13 ausgegraute Knöpfe nach Abnahme | minor | **behoben** — Fußleiste zeigt Ergebnis + „Schließen" (primär) | `44-ablauf-5-gemergt.png` |
| B14 Nachweise ohne Vorschau | minor | **behoben** — 48-px-Vorschauen der Screenshots, Tooltip mit Pfad; Fußleisten beschriftet („Abnahme", „Arbeit am Agent") | `43-ablauf-4-review.png`, `21-review-terminal.png` |
| B15 Terminal-Modus ohne Ticket | minor | **behoben** — Kopf „Ticket demo-2 · Team-Panel: Pipeline-A…" + Identitäts-Chip | `21-review-terminal.png` |
| B16 Orchestrator-Karte `· 0.41` | nit | **behoben** — `· $0.41` | `10-panel-team.png` |
| B17 `hub --help` verweist auf Team-Graph | nit | **behoben** — „Team-Panel" | `mods/orchestra/bin/hub:6` |
| B18 `h(4000)`-Hack | nit | **behoben** (nicht mehr im Code) | `mods/inbox/main.js` |
| C2 Zwillinge ungleich | major | **behoben** — beide „+" in der Titelzeile, gleiche Gewichtung | `27-marketplaces.png`, `28-mcp.png` |
| C3 Tastenspalte presst Beschreibungen | minor | **behoben** — Tastenchips nach Inhalt, Beschreibung einzeilig mit Tooltip, Layout-Chip nur am Gruppenkopf | `26-tastenkuerzel.png` |
| C5 doppelter Spinner | nit | **behoben** | `27-marketplaces.png` |
| C6 Blueprint-Agent ohne Identität | minor | **behoben** — Identitäts-Chip (Avatar + „Puck" + Status) | `10-panel-blueprint.png` |
| C7 Projektname auf 5 Zeichen | nit | **behoben** — Projektname steht in der Diagramm-Zeile | `10-panel-blueprint.png` |
| A3 Auswahlleiste drei Zeilen | minor | **behoben** — zwei Zeilen (Aktionen + Eingabe) | `33-sidebar-auswahl-hover.png` |
| A4 Rail ohne Identität | minor | **behoben** — Avatar 16 + Status statt Nummern | `31-sidebar-rail.png` |
| A5 Abschneiden ohne Tooltip | minor | **teilweise** — Karten- und Space-Namen haben Tooltips; Tab-Namen nicht (N2) | `mods/agent-cards/main.js:846`, `space-folders/main.js:810` |
| A6 Idle-Agent unter „Arbeitet" wortlos | minor | **behoben** — „Sub-Agent arbeitet" | `45-team-viele-tickets.png`, `33-sidebar-auswahl-hover.png` |
| A7 `gap(10)` literal | nit | offen (unverändert, unkritisch) | `mods/agent-cards/main.js` |
| A8 `pl(16)` literal | nit | offen (unverändert, unkritisch) | `mods/agent-cards/main.js` |
| C4 Segment-Gruppen ungleich | minor | **geändert, siehe N3** | `47-tabs-viele.png` |

## Neue und gebliebene Befunde

| ID | Schwere | Paket | Datei | Bild | Befund | Vorschlag |
|---|---|---|---|---|---|---|
| N1 | minor | B | `mods/review/main.js:132-201,523` | `44-ablauf-5-gemergt.png` | Mergen bei geöffnetem Fenster: der nächste 5-s-Refresh läuft in den entfernten Worktree, `exec` meldet „herdr.exec: cannot run git: No such file or directory (os error 2)". Weil `orchestra.tickets` in diesem Moment noch `review` trägt, greift der „gelandet"-Zweig nicht — der rohe englische Text bleibt als `this.error` stehen, auch nachdem der Fuß schon „Abgenommen und gemergt" zeigt. Neu geöffnet ist alles korrekt | Im Catch auch „Ordner/Worktree weg" (ENOENT, `cannot run git`) als gelandet/beendet behandeln und `this.error` leeren, sobald `ticket().status` auf `done` wechselt; Exec-Text nie roh zeigen |
| N2 | minor | C | `mods/tabs-graph/main.js:146` | `47-tabs-viele.png` | Tab-Namen werden bei 170 px gekürzt, ohne Tooltip (Karten und Spaces haben einen) | `.tooltip(name)` am Tab-Label |
| N3 | minor | C | `mods/tabs-graph/main.js:196-210` | `47-tabs-viele.png` | Beide Panel-Gruppen zeigen ab 1400 px *alle* Namen (5.6 sagt: Icon-Variante, nur das offene Panel mit Namen). Das kostet rund 470 px der Leiste: bei 9 Tabs sind 3 sichtbar und 6 hinter „+6" | Wie 5.6: nur Icons, offenes Panel mit Namen; ab ~1500 px optional Werkzeuge als ein Menü |
| N4 | minor | B + C | `mods/launcher/main.js:304,339`, `mods/inbox/main.js:226` | `23-auftrag-team.png`, `22-inbox.png` | Zwei Kontrast-Reste: Auftrag-Hinweis und `repo · …`-Zeile noch `dim` = 2,77:1; Metazeile in der **gewählten** Inbox-Zeile `muted` auf `selected` = 3,98:1 | Hinweis/Repo-Zeile auf `muted`; in gewählten Zeilen `selected`-Hintergrund aufhellen (Theme) oder Text `foreground` |
| N5 | nit | C | `mods/tabs-graph/main.js:243-249` | `47-tabs-viele.png` | Der Streifen schneidet den letzten sichtbaren Tab mitten im Wort ab („Arbeits") — kein Ellipsis, kein Fade | Clip am Streifenrand mit Fade oder letzte Kachel ausblenden (zählt dann in `+n`) |
| N6 | nit | B | `mods/quests/main.js:359-360` | `10-panel-quests.png` | Filter sagt „Offen / Begonnen", die Zeilen „Geplant / In Arbeit / Prüfung" | Filter „Geplant · In Arbeit/Prüfung · Alle" oder „Offen/Begonnen" auch als Statuswörter (eine Sprache) |
| N7 | minor | B | `mods/inbox/main.js:196-226` | `22-inbox.png` | In der Abnahme-Zeile teilen sich zwei Gate-Chips die erste Zeile mit dem Titel: „Sidebar: Ab…" bleibt von 33 Zeichen | Chips in die zweite Zeile (wie die Ticket-Karte im Team-Panel) oder Kurzformen „✓"/„Review" |
| N8 | minor | A + B | `mods/agent-cards/main.js` (Sektion), `mods/inbox/main.js:296` | `22-inbox.png` | Beide Flächen schreiben „Arbeitet", zählen aber verschieden: Sidebar 2 (Dringlichkeit inkl. Sub-Agent), Inbox 1 (eigener Status). Zwei Zahlen unter demselben Wort | Inbox-Zahl auf „Agent oder Sub-Agent arbeitet" erweitern, oder die Sidebar-Sektion „Beschäftigt" nennen |
| N9 | minor | C | `mods/git-graph/dialog.js:72,94` | — | Commit-Dialog des externen Git-Mods: Eingabe h 36, Radius 9, Schrift 12.8, Knopf „Cancel" — abseits der Tokens (5.6: h 30, Radius 6, `T_M`) | Eingabe/Knöpfe auf `H_INPUT`/6/`T_M`; „Cancel" → „Abbrechen" (C3 deckt Knöpfe und Eingaben ab) |
| N10 | nit | C | `mods/blueprint/main.js:1597-1610` | `10-panel-blueprint.png` | Agent-Auswahl und Leerzustand im Blueprint nutzen 11,5/12,5/14 px und Radien 7/12 | Auf die Skala ziehen (T_S/T_M/T_L, 6/8) |
| N11 | nit | C | `mods/docker/main.js` (Leerzustand) | `10-panel-docker.png` | „Docker läuft nicht." ohne nächsten Schritt | Zweiter Satz oder Link „Docker Desktop starten" |
| N12 | nit | B | `mods/review/main.js:432-441` | `43-ablauf-4-review.png` | Nachweis-Vorschauen ohne Bildunterschrift; nur der Tooltip nennt den Pfad | Dateiname unter/neben der Vorschau (`T_XS`) |
| N13 | nit | B | `mods/inbox/main.js:311` | `22-inbox.png` | Tastenhinweis „↑↓ ↵ r v" bleibt kryptisch (Buchstaben ohne Verb) | „↑↓ wählen · ↵ öffnen · r antworten · v Review" wie im ersten Entwurf, nur in `muted` |

## Kontrast, gemessen (Standard-Theme, kleine Schrift)

| Stelle | Vordergrund / Grund | vorher | jetzt |
|---|---|---|---|
| Gate-Chip „Checks –" | mit → `muted` | 2,84 | **6,80** |
| Team: Branch, `$1.84 / $3` | mit → `muted`/`foreground` | 3,25 | **6,17 / 15,18** |
| Statusleiste `⌘⇧P Befehle`, „Nur abnehmen" | mit → `muted` | 3,49 | **6,62** |
| Review „keine angegeben" | mit → `muted` | 2,77 | **5,25** |
| Inbox Meta in gewählter Zeile | `muted` auf `selected` | 2,10 | **3,98** (N4) |
| Auftrag-Hinweis, `repo · …` | noch `dim` | 2,77 | **2,77** (N4) |
| Theme `elric` `dim` | #928ac0 auf surface/chrome/selected | 3,44 | **5,57 / 5,82 / 4,55** |

## Prüfbefehle

- Spec §10 über alle Paket-Dateien: keine Treffer bei Schriftgrößen, Radien, Hex-Farben,
  `toUpperCase()` (nur Space-Kachel und Tastennamen), englischer Stichprobe. Ausnahmen liegen nur in
  externen Addons jenseits von Kopf/Knöpfen (`blueprint`-Canvas, `filetree`-Zeilen, `git-graph`
  „Loading more commits…", `blueprint`-i18n) — laut G11 so gewollt; N9/N10 betreffen die dortigen
  Knöpfe/Eingaben.
- `errors: []` in jeder Aufnahme des Testfensters; keine Mod-Warnung.
- Kopfhöhen: alle Panel-Köpfe 42 px, Titel-x identisch; Fenster Marketplaces/MCP/Review 42; Dialoge
  mit Titelzeile 28 + Esc-Chip.
- Sieben `ui.js`-Kopien tragen dieselben Helfer (`usd`, `focusFields`, `inputBox`, `statusIcon`).

## Testfenster und Live-Welt

- Testfenster per `docs/ui-preview.sh down` beendet, Test-Cores gestoppt; im Test-Home angelegte
  Helfer (`mods/zzopen`) und Zustandsinjektionen sind wieder entfernt.
- Live-Config `~/.config/herdr-app`: keine Änderung an getrackten Dateien, keine Spur des Tests
  (`rg 'uiprev|ui-preview|feat-ui-review'` leer); geändert hat sich nur Laufzeitzustand, den das
  laufende Fenster des Menschen selbst schreibt.

---

# Anhang: Bericht des ersten Durchgangs (unverändert)

## UI/UX-Review des Gesamtumbaus (`feat/ui-umbau`)

Unabhängiger Review nach dem Merge von Spec und den Paketen A, B und C. Ich habe keinen Mod-Code
geändert. Alle Befunde sind belegt (Screenshot-Pfad und Datei:Zeile); die Vorschläge gehören den
Paket-Agents (Eigentum nach Spec §9).

### Verfahren

- Testfenster nach Spec §1: eigenes Test-Home `~/.herdr/ui-preview/feat-ui-review`, eigener Core
  `uiprev-36b2d7e3`, Demo-Welt, Fenster 1710×1010, Screenshots 2×. Live-Config und echtes Fenster
  nicht angefasst (Nachweis unten).
- Aufgenommen: Sidebar (normal, Rail, 10 Spaces, Auswahl, Hover, Mehr-Menü), Tab-Leiste (normal und
  9 Tabs), Statusleiste, Versorgungsleiste, Team-Panel (Demo-Daten und 12 Tickets), Quests (Panel und
  Layout `quests`), Changes/Git/Tree/Blueprint/Docker, Review-Fenster (Ticket- und Terminal-Modus,
  vor und nach dem Mergen), Inbox, Auftrag-Dialog (Ans Team, Selbst starten, Ticket vorbelegt),
  Toasts, Marketplaces, MCP-Server, Tastenkürzel. Ablage: `/tmp/ui-review/`.
- Zustände, die nur mit der Maus entstehen (Hover, Auswahl), ließen sich nicht per Klick erzeugen:
  Das Test-Fenster läuft im Hintergrund unterhalb des Bildschirms, und weder gepostete Maus- noch
  Tastenereignisse (`CGEvent.postToPid`) kommen an. Diese Zustände habe ich im **Test-Home** (nicht im
  Worktree) kurzzeitig injiziert (`this.selected`/`this.hovered` in der Kopie, danach per `sync`
  zurückgenommen) — `/tmp/ui-review/33-sidebar-auswahl.png`, `34-sidebar-hover.png`,
  `35-sidebar-mehr.png`. Klickpfade habe ich am Code und über dieselben Kommandos geprüft, die die
  Knöpfe aufrufen; Ablauf, Ticket-Modus und Mergen liefen echt gegen die Demo-Welt.
- Werkzeuge: Spec-Prüfbefehle §10 über alle Paket-Dateien, Kontrastmessung aus den Screenshots,
  Kantenmessung (Kopfhöhen, Titel-x) in Pixeln.

| Fläche | Screenshot |
|---|---|
| Gesamtfenster | `/tmp/ui-review/01-overview.png`, `02-overview-clean.png` |
| Sidebar normal / Rail / viele Spaces | `02-overview-clean.png`, `31-sidebar-rail.png`, `32-sidebar-many.png` |
| Sidebar Auswahl / Hover / Mehr | `33-sidebar-auswahl.png`, `34-sidebar-hover.png`, `35-sidebar-mehr.png` |
| Tab-Leiste, Überlauf | `02-overview-clean.png`, `47-tabs-viele.png` |
| Statusleiste / Versorgung | `02-overview-clean.png`, `37-status-karte-aus-C.png` |
| Team-Panel | `10-panel-team.png`, `42-ablauf-3-pruefung.png`, `45-team-viele-tickets.png` |
| Quests Panel / Layout `quests` | `10-panel-quests.png`, `46-layout-quests.png` |
| Changes, Git, Tree, Blueprint, Docker | `10-panel-changes.png`, `10-panel-graph.png`, `10-panel-filetree.png`, `10-panel-blueprint.png`, `10-panel-docker.png` |
| Review Ticket-Modus / Terminal-Modus | `20-review-ticket.png`, `43-ablauf-4-review-fenster.png`, `21-review-terminal.png` |
| Review nach dem Mergen | `44-ablauf-5-gemergt.png` |
| Inbox (Standard-Theme / elric) | `22-inbox.png`, `51-theme-elric-inbox.png` |
| Auftrag: Team / Selbst / Ticket | `23-auftrag-team.png`, `24-auftrag-self.png`, `25-auftrag-ticket.png` |
| Toasts (wartet / fertig) | `01-overview.png`, `36-toast-fertig.png` |
| Marketplaces / MCP | `27-marketplaces.png`, `28-mcp.png` |
| Tastenkürzel | `26-tastenkuerzel.png` |
| Ablauf 1–5 | `40-ablauf-1-ticket-geplant.png` … `44-ablauf-5-gemergt.png` |

### Urteil vorab

**Nicht abnahmefähig.** Kein Blocker (nichts ist unbedienbar, kein Absturz, `errors: []` in jeder
Aufnahme). **Zehn Major** (acht in den Paket-Tabellen, dazu die zwei querschnittlichen S1 Kontrast und
S2 Fokus), **18 Minor**, **7 Nit**. Acht der Major sind in den Paketen selbst zu beheben: `+` aus dem
Scroll-Streifen lösen (C), englische Ordner-Dialoge und das Rechner-Wort (A), Zustandssprache in
Quests und startbare laufende Tickets (B), Fokusrand (B + C), der ungleiche Zwilling
Marketplaces/MCP (C). Zwei brauchen eine Entscheidung des Orchestrators: die Toast-Position liegt im
Core (B4), und die Kontrastregel steckt im Theme (C) wie in sechs byte-identischen `ui.js`-Kopien
(B) — dort eine Stelle zu ändern heißt, sechs zu ändern.

### Querschnitt: Sprache, Kontrast, Fokus

#### S1 — Kontrast: `dim` trägt Funktion und liegt unter 4.5:1 (major, B + C)

Gemessen aus den Screenshots (kleine Schrift 10.5–11 px, WCAG AA verlangt 4.5:1):

| Stelle | Vordergrund / Grund | Verhältnis |
|---|---|---|
| Team: `$1.84 / $3`, Branch, Gate-Chip „Checks –" | #696a6d auf #17191d / #232529 | 3.25 / 2.84 |
| Inbox: Meta `demo-app · Tab Review` in der Auswahl | #696a6d auf #39393e | 2.10 |
| Inbox: Abschnitt „Arbeitet" (opacity 0.6) | #4e4f53 auf #25272b | 1.83 |
| Statusleiste: `⌘⇧P Befehle`, Review „Nur abnehmen", „keine angegeben" | #696a6d auf #101114 / #25272b | 3.49 / 2.77 |
| Tastenkürzel-Hinweis, Auftrag-Hinweis | #696a6d auf #25272b | 2.77 |
| Theme `elric`: `dim` #6f66a0 auf `surface`/`chrome`/`selected` | — | 3.44 / 3.59 / 2.81 |

Betroffen sind genau die Texte, die der Mensch zum Prüfen braucht: Kosten pro Ticket, Branch,
Nachweis-Namen, Tastenhinweise, die Aktion „Nur abnehmen". Vorschlag: funktionale Sekundärtexte auf
`muted` heben (7.3:1 im Standard-Theme, 7.3:1 in `elric`), `dim` nur für wirklich Entbehrliches
(Zeitstempel, „aktualisiert 19:44"); zusätzlich `dim` in `themes/elric.json` auf ≥ 4.5:1 gegen
`surface` anheben (z. B. #8c84b8) und die opacity-0.6-Zeilen der Inbox auf 0.75. Dateien:
`mods/orchestra/hubview.js:226-241`, `mods/inbox/main.js:190,197,308`, `mods/review/main.js:406-412,434`,
`mods/status-bar/main.js:418-422`, `themes/elric.json`.

#### S2 — Kein Fokusrand an Eingabefeldern (major, B + C)

Spec 5.6: Eingabefeld „mit Fokus `border(accent)`". `ui.inputBox()` hat den Parameter `focused`,
aber **kein Aufrufer übergibt ihn** (`mods/{orchestra,quests,inbox,review,launcher,toast-review}/ui.js:171-176`);
die Textareas im Auftrag-Dialog (`mods/launcher/main.js:278`) und in Quests (`mods/quests/main.js:57`)
zeigen ebenfalls nur `input`. Der Fokus ist damit nur am Cursor erkennbar — in
`23-auftrag-team.png` sieht man nicht, welches Feld die Tastatur hat. Nur `docker`, `cheatsheet`,
`filetree` und `git-graph` färben beim Tippen (`this.typing ? t.accent : t.input`). Vorschlag: in
`inputBox`/`area` den Fokus aus der `InputState` ableiten (`input.is_focused()` bzw. `this.typing`
wie in `docker/main.js:325`) und den Rand dann `accent` setzen — eine Stelle, sechs Mods.

#### S3 — Ein Rechner, drei Namen (major, A + C)

`space-folders` schreibt „This computer" (`mods/space-folders/main.js:699`), die Statusleiste
„Dieser Computer" (`mods/status-bar/main.js:332,384`), der Auftrag-Dialog „dieser Rechner"
(`mods/launcher/main.js:315`), Marketplaces „Host" (`mods/marketplaces/main.js:788`). Vorschlag:
überall „Dieser Computer" (Produktwort, wie in der Statusleiste), „Host" nur da, wo eine
Agent-Konfiguration gemeint ist, sonst „Maschine".

#### S4 — Sprache: Paket A hat noch englische Flächen (major, A)

`mods/space-folders/main.js` ist außen deutsch (Tooltips „Neuer Ordner", „Neuer Space (⌘N)") und
innen englisch: Kontextmenü `New folder` (`:166`), `New space here` (`:618`), `Delete folder` (`:620`),
`Edit folder` (`:640`), Felder `Name` / `Start new spaces in` / `Collect spaces from` (`:641-645`),
`Cancel` / `Save` (`:647-648`), `pickFolder("Start new spaces in")` (`:526`), `Loading…` (`:680`),
`Drop here to take it out of its folder` (`:894`). Vorschlag: diese Strings übersetzen („Neuer
Ordner", „Neuer Space hier", „Ordner löschen", „Ordner bearbeiten", „Abbrechen", „Sichern",
„lädt …"). Reste der englischen Inhalte (`Blueprint`-Canvas, Git-Spalten) bleiben laut G11.

### Paket A — Sidebar und Agent-Darstellung

| ID | Schwere | Datei | Bild | Befund | Vorschlag |
|---|---|---|---|---|---|
| A1 | major | `mods/space-folders/main.js:166,526,618-648,680,894` | `02-overview-clean.png` | Ordner-Menü und -Dialog englisch (S4) | Strings übersetzen |
| A2 | major | `mods/space-folders/main.js:699` | `02-overview-clean.png` | „This computer" (S3) | „Dieser Computer" |
| A3 | minor | `mods/agent-cards/main.js:615-640` | `33-sidebar-auswahl.png` | Auswahlleiste bricht bei 268 px auf drei Zeilen („2 ausgewählt", Eingabe, dann „Unterbrechen" + „Als Team beobachten" gestapelt) und nimmt der Liste ~90 px | Aktionen in eine Zeile: Icon-Knöpfe 22 mit Tooltip, „Unterbrechen" und „Als Team beobachten" als Icons; Eingabe erst in Zeile 2 |
| A4 | minor | `mods/agent-cards/main.js:750-761` | `31-sidebar-rail.png` | Rail zeigt je Agent nur Nummer + Status, keine Identität und ohne Tooltip | Tooltip mit Name · Status · Space, oder Avatar 16 statt Nummer |
| A5 | minor | `mods/agent-cards/main.js:833`, `mods/tabs-graph/main.js:145`, `mods/space-folders/main.js:811` | `47-tabs-viele.png` | Kartenname (`max_w(120)`), Tab-Name (`max_w(170)`) und Space-Name (`max_w(150)`) werden abgeschnitten, ohne Tooltip | `.tooltip(name)` an allen drei |
| A6 | minor | `mods/agent-cards/main.js:651-664` | `02-overview-clean.png` | „Arbeitet 2" enthält Rune mit Idle-Ring (nur sein Sub-Agent arbeitet) und ohne Wort | Bei idle + arbeitendem Kind den Spinner am Kind zeigen und am Eltern-Eintrag „Sub-Agent arbeitet" (`T_XS` muted) |
| A7 | nit | `mods/agent-cards/main.js:808-809` | — | Kartenabstand `gap(10)` literal, Spec sagt `GAP_M` (8) | `GAP_M` |
| A8 | nit | `mods/agent-cards/main.js:901` | — | Sektionskopf „Agents" mit `pl(16)` literal statt `INSET_SIDEBAR` | Konstante benutzen |

Gut: Kopf und Tab-Leiste enden auf derselben Linie (42 px), Fuß 28 px auf Höhe der Statusleiste,
Spaces-Block passt sich dem Inhalt an (bei 3 Spaces 8 px Leerraum, bei 10 Spaces 40 % und Scroll),
5 Agents ohne Scrollen sichtbar, Kartenhöhe ~52 px, identische `ui.js`-Kopien (sechsmal derselbe
Hash), Spec-Prüfbefehle ohne Treffer.

### Paket B — Agenten-Fabrik

| ID | Schwere | Datei | Bild | Befund | Vorschlag |
|---|---|---|---|---|---|
| B1 | major | `mods/quests/sources.js:17-21`, `mods/quests/main.js:29,262,404` | `10-panel-quests.png`, `46-layout-quests.png` | Quests nennt ein Ticket in `review` „in Arbeit" (`stage()` faltet `review` auf `doing`), das Team-Panel „Prüfung", die Inbox „Abnahmen". Zwei Zustandssprachen für dieselbe Sache | Entweder Quests zeigt die Pipeline-Stufe (`Geplant/In Arbeit/Prüfung/Fertig`, `review → Prüfung`), oder Quests zeigt als Eingang gar keinen Pipeline-Zustand, sondern nur „im Team" + Gate-Chip. Filter `Offen/In Arbeit/Alle` entsprechend |
| B2 | major | `mods/quests/main.js:276-280,414-417` | `46-layout-quests.png` | Hover-Knöpfe „Orchestrator" und „Start" erscheinen auch für Tickets, die schon laufen (hier: in Prüfung) — ein Klick startet einen zweiten Agent auf derselben Arbeit | Bei lebendem Record primär „Zum Agent" (`open`), „An Orchestrator" sekundär, „Start" ausblenden; sonst wie heute |
| B3 | major | `mods/toast-review/main.js:29-60` | `01-overview.png`, `36-toast-fertig.png` | Toast schreibt den Core-Titel englisch („Claude Code needs you", „Pi finished") und nennt das Programm statt der Identität („Claude Code", nicht „Dash") | Titel wie die Login-Zeile umschreiben: „Dash wartet auf dich" / „Quill ist fertig" mit Name aus `shared("agents.identity")`; Identitäts-Chip (Avatar 16 + Name) statt Punkt |
| B4 | major | Core-Overlay; `mods/toast-review/main.js`, `layouts/elric.json` (`status-row` 28) | `36-toast-fertig.png` | Der Toast liegt über der Versorgungsleiste: Unterkante y = 993, Statuszeile beginnt bei 982 → 11 px überdeckt, genau `$144.48 heute`, `Team $2.87 / $20.00` und `⌘⇧P Befehle` sind oben abgeschnitten. Vor dem Umbau war dort leere Fläche, jetzt stehen dort die Messwerte (4.1 Punkt 6) | Position ist Core, nicht Mod: beim Orchestrator beantragen, Toasts um die Höhe der Statuszeile (28 px + 8) anzuheben; bis dahin im README als bekannte Einschränkung nennen |
| B5 | minor | `mods/orchestra/main.js:35-49` | `45-team-viele-tickets.png` | Stufenleiste `overflow_hidden()` ohne Kürzung; bei 12 Tickets endet „Fertig 2" bündig an der Panel-Kante — bei dreistelligen Zahlen oder längerem Text fällt eine Stufe still weg | Zähler auf 2 Zeichen begrenzen (`99+`) und bei Platzmangel nur die offenen Stufen zeigen (Fertig ins Tooltip) |
| B6 | minor | `mods/orchestra/main.js:88-105` | `10-panel-team.png` | Leere Stufen sind uneinheitlich: „In Arbeit" zeigt eine Zeile „Nichts in Arbeit.", „Prüfung" und „Geplant" fehlen ganz — der Mensch weiß nicht, ob leer oder nicht vorhanden | Alle vier Stufen immer zeigen (Zähler 0, leere Zeile 28 px), wie Spec 5.6 „Leere Sektion" |
| B7 | minor | `mods/orchestra/hubview.js:232-236` | `42-ablauf-3-pruefung.png` | Jede Ticket-Zeile in Prüfung trägt einen Primärknopf „Prüfen" — bei zwei Tickets zwei Primärflächen nebeneinander (Spec: höchstens einer pro Fläche) | Sekundärknopf für alle, primär nur das oberste/älteste Prüf-Ticket; oder ein Primärknopf im Sektionskopf („Nächstes prüfen") |
| B8 | minor | `mods/orchestra/hubview.js:262-270` | `10-panel-team.png` | Budget-Chips `$3/Ticket`/`Team $2.87 / $20` sehen wie Anzeige aus, ändern den Wert aber per Klick; der gleich aussehende Chip in der Statusleiste öffnet das Panel | Chip mit Stift-Icon und Tooltip „klicken: erhöhen" oder Klick auf das Team-Panel verlagern |
| B9 | minor | `mods/orchestra/hubview.js:20`, `mods/status-bar/main.js:26` | `10-panel-team.png` vs `02-overview-clean.png` | Zahlenformat doppelt: Team-Panel `$1.84 / $3`, Statusleiste `$2.87 / $20.00` | Eine Funktion (Cent, wenn < $10, sonst ganze) in `ui.js` |
| B10 | minor | `mods/inbox/main.js:308-315` | `22-inbox.png` | Kopf zählt doppelt (Badge „2" und „2 warten auf dich"), die Tastenhinweise sind `T_XS dim` (2.77:1) | Satz weglassen oder Badge; Hinweise auf `muted`, „↑↓ ↵ r v" kürzen |
| B11 | minor | `mods/inbox/main.js:197` | `22-inbox.png` | „Abnahmen"-Zeile zeigt nur den ersten Gate-Chip (`slice(0,1)`), „Review offen" fehlt | Zwei Chips (Checks + Review) oder Statuswort „wartet" ersetzen |
| B12 | minor | `mods/inbox/mod.json` (Popup `at: top, offset: 40`) | `22-inbox.png` | Popup beginnt 2 px über der Unterkante der 42-px-Tab-Leiste und deckt deren unteren Rand ab | `offset: 48` |
| B13 | minor | `mods/review/main.js:426-437` | `44-ablauf-5-gemergt.png` | Nach dem Mergen bleiben „Mergen", „PR", „Änderungen …" ausgegraut stehen, dazu der Satz „schon abgenommen" | Fußleiste im abgeschlossenen Zustand ersetzen: Ergebnis + „Schließen" (primär) |
| B14 | minor | `mods/review/main.js:406-412,434` | `43-ablauf-4-fenster.png` | Nachweise nur als `dim` Dateiname (2.77:1), Bildnachweise ohne Vorschau; die Abnahme-Aktion „Nur abnehmen" ist der leiseste Text der Fenster-Fußleiste | Nachweise als Link in `muted` mit Pfad-Tooltip, Bilder als 48-px-Vorschau; „Nur abnehmen" eine Stufe heller |
| B15 | minor | `mods/review/main.js` (Terminal-Modus) | `21-review-terminal.png` | Der Terminal-Modus nennt das Ticket nicht, obwohl `demo-2` zu diesem Agenten läuft; Ticket- und Terminal-Modus haben verschiedene Fußleisten-Logik (einmal Abschluss, einmal Werkzeuge) | Ticket-Titel/Chip in der Kopfzeile, wenn `ticket` zum Terminal existiert; Fußleisten beschriften („Abnahme" / „Arbeit am Agent") |
| B16 | nit | `mods/orchestra/hubview.js:190-195` | `10-panel-team.png` | Orchestrator-Karte zeigt „Oh My Pi ▾ · 0.41": Trennpunkt doppelt und Kosten ohne `$` | `· $0.41`, Agent-Wahl als Chip |
| B17 | nit | `mods/orchestra/bin/hub` (`--help`) | — | Hilfetext verweist noch auf „Team graph", den es nicht mehr gibt | „Team-Panel" |
| B18 | nit | `mods/inbox/main.js:308` | — | `h(4000)` als Höhentrick für „Popup so hoch wie der Inhalt" | Kommentar belassen, aber Konstante benennen (`FILL`) |

Gut: Pipeline-Stufenleiste mit Klick-Sprung, Ticket-Zeilen mit Identitäts-Chip/Branch/Gates/Kosten,
genau ein Primärknopf „Prüfen" pro Ticket, Review-Ticket-Modus mit Zusammenfassung, Nachweisen,
Diff `feat/demo-review` gegen `main` und Fußleiste; Mergen hat im Demo-Repo funktioniert
(`Merge feat/demo-review …`), danach meldet das Fenster „Abgenommen und gelandet"; Inbox-Reihenfolge
und -Zähler stimmen mit der 7.3-Formel; Auftrag-Dialog hat die zwei Modi und füllt bei Ticket-Vorbelegung
Text, Tab-Name und Branch; Toasts haben den Review-Knopf.

### Paket C — Rahmen und Werkzeuge

| ID | Schwere | Datei | Bild | Befund | Vorschlag |
|---|---|---|---|---|---|
| C1 | major | `mods/tabs-graph/main.js:174-177` | `47-tabs-viele.png` | Das „+" liegt **im** scrollenden Streifen (`tab-scroll`): Bei 9 Tabs ist es nicht mehr sichtbar, der letzte Tab wird mitten im Wort abgeschnitten, es gibt keinen Überlauf-Hinweis. Die Abnahme C1 („+ hinter den Tabs") gilt nur bis zum Überlauf | „+" als festes Element rechts neben dem Streifen (wie „Auftrag"), Streifen mit Rand-Fade oder Zähler „+3" |
| C2 | major | `mods/marketplaces/main.js:539`, `mods/mcp-servers/main.js:529` | `27-marketplaces.png`, `28-mcp.png` | Zwillingsfenster legen dieselbe Aktion verschieden an: MCP „+ Hinzufügen" (solid, primär) in der Titelzeile, Marketplaces „Hinzufügen" (raised) als eigene Werkzeugzeile darunter; im Leerzustand zusätzlich ein primärer „Marketplace hinzufügen" (`:789`) | Beide wie MCP: ein Icon-Knopf in der Titelzeile, Leerzustand nur mit Satz + Link |
| C3 | minor | `mods/cheatsheet/main.js:132` | `26-tastenkuerzel.png` | Feste 150-px-Tastenspalte presst die Beschreibungen in Umbrüche bis zur Worttrennung („Space-wech-sel"); „elric" wiederholt sich als Chip in jeder Zeile | Tastenspalte auf Inhalt (`flex_shrink(0)`, `max_w`) und Beschreibung `truncate` mit Tooltip; Layout-Chip nur an Gruppen |
| C4 | minor | `mods/tabs-graph/main.js:11-23` | `02-overview-clean.png` | Zwei Segmente mit 5 bzw. 2 Einträgen auf 1710 px: die Werkzeug-Gruppe zeigt nur Icons, die Fabrik-Gruppe Icon+Text — Werkzeuge sind dadurch schwerer zu treffen und ohne offenes Panel nicht zu erkennen | Beide Gruppen gleich behandeln (nur Icons, offenes Panel mit Namen) oder Werkzeuge bei Platz in Textform |
| C5 | nit | `mods/marketplaces/main.js:785-789` | `27-marketplaces.png` | Leerzustand zentriert, aber Kopfzeile zeigt schon einen Spinner („lädt …" doppelt) | Kopf-Spinner nur, wenn der Inhalt nicht selbst lädt |
| C6 | minor | `mods/blueprint/main.js:1385-1404` | `10-panel-blueprint.png` | Der Agent im Kopf ist **kein** Identitäts-Chip (der Kommentar `:1389` behauptet es): er zeigt das Programm („Oh My Pi") ohne Avatar, also nicht Name und Avatar aus `shared("agents.identity")` (Spec 4.1.2) | `ui.identity(a.address)` bzw. `shared("agents.identity")` wie in Team-Panel, Inbox und Review |
| C7 | nit | `mods/blueprint/main.js:1394-1396` | `10-panel-blueprint.png` | Bei offenem Panel bleiben dem Projektnamen im 42-px-Kopf ~5 Zeichen („demo…"); voll steht er nur im Tooltip, solange Update- und Agent-Chip daneben stehen | Meta in die Diagramm-Zeile verschieben oder Chips bei `narrow` in ein Überlaufmenü |

Gut: alle Panel-Köpfe 42 px, Titel an derselben x-Position (gemessen 1350 px Bild = 14 px Panel) und
in derselben Größe wie Changes; Statusleiste ohne Agent-Zahl/Attention-Badge, Team-Chip öffnet das
Team-Panel; „Auftrag" einmal und primär; Marktplätze/MCP/Review mit gleicher Titelzeile;
Spec-Prüfbefehle ohne Treffer.

### Ablaufprüfung (wie der Mensch)

| Schritt | Beobachtung | Urteil |
|---|---|---|
| Auftrag geben (⌘⇧N) | Dialog „Auftrag", Umschalter „Ans Team \| Selbst starten", Standard „Ans Team" bei laufendem Orchestrator, Textfeld groß, „An das Team" primär; Hinweis erklärt, was danach passiert | verständlich |
| … bis das Team reagiert | Kein Zwischenzustand: nach dem Senden schließt der Dialog, es gibt einen Toast „Auftrag an das Team"; ein Ticket erscheint erst, wenn der Orchestrator es anlegt (im Test: `40-ablauf-1` nach `hub ticket new`) | Lücke: ohne offenes Team-Panel merkt der Mensch nicht, dass etwas angekommen ist — Toast nur 6 s. Vorschlag: Auftrag als Zeile „beim Orchestrator" in der Inbox (die liest er ohnehin) |
| Ticket in der Stufenleiste | „Geplant 1" → nach `status=doing` „In Arbeit 1" → nach `hub review` „Prüfung 1" in Pink, Sektion „Prüfung · wartet auf dich" | klar; die Stufenleiste ist die beste Neuerung des Umbaus |
| Prüfung mit Gate-Chips | Zeile zeigt „Checks ✓", „Review offen", „1 Nachweis" und **Prüfen**; Inbox-Zähler wächst mit | klar, aber der Gate-Chip „Checks –" ist kaum lesbar (S1) |
| Review-Fenster | Ticket-Modus: Titel, Gate-Chips, Zusammenfassung, Nachweise, Diff gegen `main`, Fußleiste Mergen/PR/Änderungen/Nur abnehmen | klar; Nachweise zu leise (B14) |
| Mergen | „Mergt …", danach Erfolgssatz im Fenster, Ticket wandert nach „Fertig 2" und in der Inbox aus den Abnahmen; die restlichen Knöpfe bleiben ausgegraut stehen (B13) | funktioniert; Aufräumen fehlt |
| Zweiter Weg nach dem Umbau | Quests → Hover „Orchestrator"/„Start" (B2: auch für laufende Tickets) → Auftrag-Dialog vorbelegt | gefährlich für schon laufende Arbeit |

### Prüfnachweise

- `rg`-Prüfbefehle aus Spec §10 über alle eigenen Dateien von A, B und C: keine Treffer
  (Schriftgrößen, Radien, Hex-Farben, `toUpperCase()` nur Tastennamen, englische Stichprobe leer);
  Alpha-Suffixe nur `26/55/88`; `font_bold` nur das „!"-Badge.
- `docs/ui-preview.sh check` implizit über alle geladenen Mods: `errors: []` in jeder Aufnahme,
  keine Warnung im Testfenster.
- Sechs `ui.js`-Kopien in B byte-identisch (`md5 b2ab02a8…`).
- Live-Welt: `~/.config/herdr-app` hat keine Änderung an getrackten Dateien (`git status` leer);
  `rg 'uiprev|ui-preview|feat-ui-review'` findet dort nichts. Geändert haben sich nur Laufzeitdateien,
  die das laufende Fenster des Menschen selbst schreibt (`shared.json`, `view.json`,
  `data/*/store.json`, `data/orchestra/costs.json`, ein Ticket) — nicht durch diesen Review.
  `~/.config/herdr-space-folders.json` wurde nicht angelegt.
- Testfenster per `docs/ui-preview.sh down` beendet, Test-Cores gestoppt, State-Verzeichnisse
  `~/.local/state/herdr-core/uiprev-36b2d7e3*` entfernt; die im Test-Home angelegten Helfer
  (`mods/zzopen`) und Zustandsinjektionen sind wieder entfernt.

### Mindeständerungen für die Abnahme

1. **C1**: „+" aus dem scrollenden Tab-Streifen lösen, Überlauf sichtbar machen.
2. **A (S4, S3)**: Ordner-Dialog/-Menü deutsch; „Dieser Computer" überall gleich.
3. **B1**: eine Zustandssprache — Quests nennt „Prüfung" wie Team/Inbox (oder gar keinen Zustand).
4. **B2**: laufende Tickets in Quests nicht erneut startbar.
5. **S2**: Fokusrand an allen Eingabefeldern und Textareas.
6. **S1**: funktionale Sekundärtexte ≥ 4.5:1 (Kosten, Branch, Nachweise, Tastenhinweise,
   „Nur abnehmen", Inbox-Meta).
7. **B3**: Toasts deutsch und mit Identität.
8. **B4**: Toast nicht über der Versorgungsleiste (Entscheidung Orchestrator/Core).

Danach ist der Umbau in meinen Augen abnahmefähig; die Minor- und Nit-Befunde können in einem
zweiten Durchgang folgen.

