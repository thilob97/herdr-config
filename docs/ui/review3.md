# UI/UX-Review Runde 3: Dashboard, Prüfstation, Gates

Basis: `main` @ `d89330d` (Dashboard 4, Prüfstation, Prüf-/CI-Gate, Lehren, Aufräumen, Messwerte,
Basis-Drift). Worktree `feat/review3`, Testfenster nach `docs/ui-preview.sh`: eigenes Home
`~/.herdr/ui-preview/feat-review3`, eigener Core `uiprev-db5b022d`, Demo-Welt, Fenster 1710×1010
(schmal: 1000×1010). Screenshots und Kommandoausgaben: `/tmp/ui-review3/`.

Geprüft wurden nur die Flächen, die seit dem letzten Durchgang dazukamen: Start-Dashboard,
Team-Panel mit Prüfstation, Review-Fenster mit Urteil/Befunden/CI/Lehren, Inbox mit
Verlaufs-Fragen, Tastenkürzel, Aufräumen. Maßstab sind `docs/ui/review.md` (Sprache und
Schweregrade) und `docs/ui-spec.md` §5.

## Urteil

**Nicht abnahmefähig.** Ein Blocker (R3-01), vier Major, zehn Minor, sechs Nit.

Der Blocker ist kein Aussehen: `hub cleanup` hat im Testfenster drei Worktrees unter
`~/.herdr/worktrees` gelöscht, darunter zwei Worktrees der Live-Welt (einer meiner, einer eines
anderen Agents). Die Testisolation aus `docs/ui-preview.sh` deckt `hub cleanup` nicht ab, weil das
Kommando `~` benutzt statt des Test-Homes. Das ist Datenverlust in der echten Welt und muss vor
jeder Abnahme behoben werden (Details unten).

Ohne R3-01 funktioniert der Fabrikpfad Auftrag → Ticket → `hub verify` → `hub review-start` →
Urteil → `hub review` → Review-Fenster → Mergen → Aufräumen durchgehend, und die neuen Zustände
(Checks ✓/✗, Review grün/rot, Runde, Lehren, CI) sind lesbar. Die vier Major sind aber alle auf
den neuen Flächen und sollten mit dem Blocker zusammen weg: **R3-02** (Dashboard friert
Ticketdaten ein), **R3-03** (Review-Fenster lässt dem Diff 1–2 Zeilen und verliert beim
Aufklappen die Fußleiste), **R3-04** (Kosten-Karte nennt den Team-Verbrauch „heute"; drei
verschiedene Kosten-Zahlen auf zwei Flächen) und **R3-05** (CI-Gate ist an keinen Commit
gebunden; ein rotes Urteil überlebt einen neuen HEAD und das Mergen läuft trotzdem).

## Verfahren

- Testfenster nach Spec §1 neu gebaut (`docs/ui-preview.sh up`), Demo-Welt, Fenster 1710×1010.
  Der Worktree stand vor dem Start auf dem aktuellen `main` (`git log --oneline main..HEAD`
  leer, `HEAD = d89330d`).
- Demo-Daten für die neuen Flächen im **Test-Home** ergänzt (nicht im Repo): `.herdr/verify.sh`
  im Demo-Worktree, ein zweiter Branch mit Worktree (`feat/prufstation-im-ablauf`), ein Ticket
  `prufstation-im-ablauf`, zwei Review-Befunde, ein Urteil, ein CI-Fehler und zwei Lehren, ein
  Lehren-Vorschlag für `demo-1`, ein Verlaufs-Frage in `demo-2` (`@mensch`). `hub ci` lief gegen
  ein Fake-`gh` (`/tmp/ui-review3/bin/gh`), das dieselbe JSON-Form wie `gh pr checks` liefert;
  das Demo-Repo hat kein `origin`; ein echtes `gh` hätte nichts zu prüfen.
- Ablauf wie der Mensch, siehe Tabelle „Ablauf". Klicks und Tastendrücke lassen sich in das
  Hintergrundfenster nicht posten (unverändert zu Runde 1/2). Die geprüften Knöpfe rufen
  dieselben Kommandos auf, die ich ausgeführt habe; zusätzlich öffnete ein Testhelfer
  `mods/zzopen` (nur im Test-Home, wieder entfernt) das Review-Fenster im Ticket-Modus.
  Aufklapp-Zustände (Befunde, CI) und die Inbox-Auswahl habe ich in den **Test-Home-Kopien**
  kurzzeitig injiziert und danach zurückgespielt.
- Grenzen: nur Theme `elric` vorhanden (kein helles Theme im Test-Home); Zoom 0,8 wurde für die
  Tastenkürzel probiert, ist aber nicht bewertet (Spec gilt bei Zoom 1). Die Screenshots sind 2×.

## Flächen und Screenshots

| Fläche | Zustand | Bild |
|---|---|---|
| Gesamtfenster | Ausgangslage, Team-Panel offen | `00-workspace.png`, `01-team-panel.png` |
| Dashboard | voll (Ticket in Prüfung, blockierter Agent, Verlaufs-Frage, Team, Fabrik, Kosten, Auftrag) | `11-dashboard-voll.png` |
| Dashboard | schmal (1000 px), mit Team-Toast | `13-dashboard-schmal.png`, `13b-schmal-unten.png` |
| Dashboard | leer (eigenes Home und Core) | `14-dashboard-leer.png` |
| Dashboard | eingefroren (Beleg R3-02) | `10-dashboard-veraltet.png` |
| Team-Panel | Prüfstation läuft (Reviewer live) | `04-team-review-laeuft.png`, `20-ablauf-team-laeuft.png` |
| Team-Panel | Prüfstation grün, Lehren, PR, Runde | `05-team-review-gruen.png`, `05b-team-review-detail.png`, `05c-team-reviewer-detail.png`, `21-ablauf-team-gruen.png` |
| Review-Fenster | Ticket-Modus: Urteil, CI, Lehren, Nachweise, Diff | `06-review-fenster-demo1.png`, `06e-diff.png` |
| Review-Fenster | Befunde aufgeklappt | `22b-ablauf-befunde.png` |
| Review-Fenster | CI und Befunde aufgeklappt (Fußleiste weg) | `06b-review-aufgeklappt.png`, `06c-review-bottom.png`, `06d-review-ci.png` |
| Review-Fenster | nach dem Mergen | `23-ablauf-gemergt.png`, `23b-gemergt-kopf.png`, `23c-gemergt-station.png` |
| Inbox | Verlaufs-Frage in der Liste | `12-inbox-fragen.png` |
| Inbox | Frage ausgewählt (Antwortfeld) | `12b-inbox-frage.png` |
| Tastenkürzel | Dialog | `03-tastenkuerzel.png` |
| Aufräumen | Dry-Run und Lauf (Kommandoausgabe) | `30-cleanup-dry.txt`, `31-cleanup.txt` |

## Befunde

### Blocker

#### R3-01 — `hub cleanup` löscht fremde Worktrees (Aufräumen, orchestra)

**Befund.** `local_worktrees()` (`mods/orchestra/bin/hub:1384-1402`) sammelt **alle** Verzeichnisse
unter `~/.herdr/worktrees/<repo>/`, ohne Bezug zum laufenden App-Home oder zu den Repos der
Tickets. `cmd_cleanup` (`:1478-1508`) entfernt jeden Worktree, den kein Ticket **dieses** Homes
als `worktree` nennt. Im Test-Home sind die echten Worktrees der Live-Welt damit „ohne Ticket".
Der Lauf hat gelöscht:

- `/Users/thilo/.herdr/worktrees/herdr-app/feat-hermes-popup-doppel-ctrl-offnet-chat-mit`
  (Worktree eines anderen Agents; Branch `feat/hermes-popup-doppel-ctrl-offnet-chat-mit` lebt;
  der Worktree wurde um 01:32 wieder angelegt),
- `/Users/thilo/.herdr/worktrees/herdr-app/feat-review3` (mein eigener Worktree),
- `/Users/thilo/.herdr/worktrees/repo/leftover` (der gewollte Test-Rest).

`/Users/thilo/.herdr/worktrees/repo/review-demo-1` blieb korrekt (gehört zu `demo-1`).
Der Dry-Run (`30-cleanup-dry.txt`) hatte die beiden fremden Pfade bereits genannt; ich habe den
Lauf trotzdem ausgeführt, weil ich die Zeilen als Testkontext gelesen habe. Das war falsch — ein
destruktives Kommando, dessen Dry-Run Pfade außerhalb der Testwelt nennt, darf nicht laufen.
Den eigenen Worktree habe ich aus `feat/review3` (HEAD `d89330d`) am selben Pfad
wiederhergestellt; am fremden Worktree habe ich nichts angefasst.

**Vorschlag.** `hub cleanup` auf die Repos und Worktree-Pfade der Tickets **dieses** Homes
begrenzen (Repo-Pfad aus dem Ticket, Worktree-Präfix daraus ableiten) und Worktrees überspringen,
deren Verzeichnis von einer anderen Instanz oder einem lebenden Prozess benutzt wird. Ohne
`--yes` nur den Dry-Run ausführen; die Ausgabe soll den Bereich nennen („Worktrees unter
`~/.herdr/worktrees/<repo>` für 3 Tickets"). Im Testverfahren `HOME` für `hub` auf das Test-Home
setzen oder `--root` einführen, damit die Isolation auch für `hub` gilt.

### Major

#### R3-02 — Dashboard friert Ticketdaten ein (Dashboard)

**Befund.** Das Dashboard liest `shared("orchestra.tickets")` (`mods/dashboard/main.js:124`), aber
nichts schreibt es, solange das Dashboard offen ist: der Herausgeber ist `HubDaemon`
(`mods/orchestra/hubview.js:96-108`), und der steckt nur als 0-px-Block im Layout `elric`
(`layouts/elric.json:223-229`). `layouts/dashboard.json` enthält nur `dashboard`; das Dashboard
startet alle 5 s `sync`/`loadQuestions`, alle 30 s `hub stats` — kein `tickets.publish`
(`main.js:114-118`). Folge: Neue Tickets, Statuswechsel, Urteile und Verlaufs-Fragen erscheinen
erst, nachdem der Mensch einmal in den Workspace und zurück gewechselt hat. Beleg: die Frage in
`demo-2` stand um 01:04 im Ticket, `10-dashboard-veraltet.png` (01:05:54) zeigt „Wartet auf dich 2"
ohne sie; nach `layout.switch elric` → warten → `layout.switch dashboard` zeigt
`11-dashboard-voll.png` „Wartet auf dich 3" und „Inbox 2 + 1 Verlauf". In `shared.json` stand
`demo-2.updated` noch auf `2026-01-01 12:00`, während die Datei `2026-11-15 01:04` trug.

**Vorschlag.** Den Daemon ins Dashboard-Layout legen (`layouts/dashboard.json` um einen 0-px-Block
`{"mod":"orchestra","props":{"role":"daemon"}}` ergänzen) oder im Dashboard alle 5 s denselben
Herausgeber aufrufen (kleine Kopie von `tickets.publish` bzw. `hub ticket list --json` plus
Verlauf). Der Startbildschirm darf nicht von einem anderen Layout abhängen.

#### R3-03 — Das Review-Fenster gibt dem Diff 1–2 Zeilen und verliert beim Aufklappen die Fußleiste (Review)

**Befund.** Der Kopf `ticketHead` (`mods/review/main.js:642-700`) enthält seit Runde 3 zusätzlich
CI-Zeile, Prüfstation, Befunde, Verlauf, Lehren und Kommentarfeld; er ist `flex_none`, ohne eigene
Höhenbegrenzung oder Scroll. Das Fenster ist 960×680 (Aufrufer in `orchestra/hubview.js`,
`inbox/main.js:170`, `dashboard/main.js:317`). Im Ruhezustand bleiben dem Diff rund 50–70 px:
`06e-diff.png` zeigt eine Zeile, `22c-diff.png` zwei. Klappt man „Fehlschläge" und
„Befunde" auf, wächst der Kopf über das Fenster; die Fußleiste mit **Mergen/PR/Nur abnehmen** und
das Kommentarfeld werden abgeschnitten (`06b-review-aufgeklappt.png`, `06c-review-bottom.png`).
Nur „Befunde" aufgeklappt lässt die Fußleiste gerade stehen (`22b-ablauf-befunde.png`). Die
Fläche, auf der der Mensch die Arbeit prüft, zeigt die Arbeit fast nicht.

**Vorschlag.** Den Kopf in aufklappbare Abschnitte mit Standard „zu" teilen (Nachweise, Verlauf,
Lehren, Befunde; Prüfstation+CI+Prüfung in **einer** kompakten Zeile) und die Fußleiste fest
unten halten; oder den Kopf scrollbar machen und dem Diff mindestens 45 % der Höhe geben. Die
Fensterhöhe auf 760–900 anheben, wenn die Aufrufer das hergeben. Ziel: der Diff ist auch mit
geöffneten Befunden und CI-Details sichtbar, die Abnahme bleibt erreichbar.

#### R3-04 — Die Kosten-Karte nennt den Team-Verbrauch „heute"; drei Kosten-Zahlen (Dashboard)

**Befund.** `costsCard` (`mods/dashboard/main.js:756-786`) setzt `const today = c.teamCost` und
beschriftet sie „heute". `teamCost` ist aber „offene Tickets + Orchestrator" (`costs.js:79`), keine
Tagesgröße. Auf demselben Dashboard steht in „Fabrik heute" `stats.today.cost` (1.84 = Kosten der
heute erledigten Tickets) und in der Kosten-Karte „$2.87 heute" (Team-Verbrauch); die Statusleiste
schreibt „$1.24 heute" (Provider-Limits, `mods/status-bar/main.js:391`). Drei Zahlen, zwei davon
mit demselben Wort „heute", alle ohne Bezugsgröße (`11-dashboard-voll.png`,
`13-dashboard-schmal.png`, `20-ablauf-team-laeuft.png`).

**Vorschlag.** Eine Größe pro Karte und benennen: Karte „Kosten" als „Sitzung" oder
„Team-Verbrauch $2.87 / $20" (dann ist die Zeile „Team-Budget" darunter die Quote), „Fabrik heute"
als „erledigte Tickets heute $1.84" und die Statusleiste als „Limits heute $1.24". Oder auf eine
Definition (z. B. `stats.today.cost`) zusammenziehen und die anderen als Tooltip.

#### R3-05 — Das CI-Gate hängt an keinem Commit; rot bleibt stehen, Mergen läuft (Gates, orchestra + review)

**Befund.** `hub ci` schreibt `ci`, `ci_at`, `ci_url`, `ci_details`, aber keinen Kopf-Commit
(`apply_ci`, `mods/orchestra/bin/hub:1624-1649`; `FIELDS` `:83` hat kein `ci_head`). Anders als
`checks_head` und `review_head` kann das CI-Ergebnis nicht veralten. Im Ablauf: `hub ci` meldet rot
und setzt das Ticket auf `doing`; nach Fix, `hub verify` und `hub review-start` steht im Fenster
„CI ✗ 01:09" neben „Checks ✓ · HEAD a7ffbf4", „Review grün" und dem primären **Mergen**
(`22-ablauf-review-fenster.png`). `hub land --merge` hat trotzdem gemergt und im Ergebnis
`"ci": "fail"` zurückgegeben (`23-ablauf-gemergt.png`; Kommandoausgabe unten). Nach dem Landen
bleibt „Erneut prüfen" in der CI-Zeile aktiv; ein Lauf auf dem abgenommenen Ticket setzt es wieder
auf `doing` (verifiziert: `hub ci prufstation-im-ablauf` → `status: doing`, `merged: main@d01f21a`
bleibt).

**Vorschlag.** `ci_head` (PR-Kopf) mitschreiben und die Zeile wie die anderen Gates behandeln:
„CI ✗ · Stand a7ffbf4 (neuer Commit)" in `blocked`, sonst grün. Entscheiden, ob ein rotes CI das
Mergen sperrt (oder nur `--pr --wait-ci`); in jedem Fall den Stand sichtbar machen.
„Erneut prüfen" bei `status=done` ausblenden/deaktivieren.

### Minor und Nit

| ID | Schwere | Paket | Datei:Zeile | Bild | Befund | Vorschlag |
|---|---|---|---|---|---|---|
| R3-06 | minor | orchestra + review | `review/main.js:608-625`, `orchestra/hubview.js:390-394` | `05c`, `23c` | Nach dem Ende des Reviewers zeigt die Prüfstation den rohen Terminal-Namen: „Reviewer t8 (beendet)", „t10 (beendet)". Das Ticket trägt `reviewer: claude` und die Runde; die Identität ist weg | Den Reviewer-Namen (Identität oder Programmname) beim Start ins Ticket schreiben und das Chip daraus bauen; `review_terminal` nur für den Live-Zustand nutzen |
| R3-07 | minor | orchestra | `orchestra/ui.js:69-80` | `01`, `05` | „Checks ✗ · nicht geprüft" ist rot mit ✗, obwohl nichts geprüft wurde. Spec 5.6 sagt für „keine Angabe" `Checks –` in `dim`; ✗ ist sonst „rot" | `Checks – · nicht geprüft` in `muted`/`dim`; ✗ nur bei `checks=fail` oder veraltetem HEAD |
| R3-08 | minor | review + orchestra | `review/main.js:605-618`, `orchestra/bin/hub:374-400` | `23c` | Nach dem Mergen sagt die Kopfzeile „Review grün" + „abgenommen", die Prüfstation darunter „rot · neuer Commit": `hub gate` liest ohne Worktree den HEAD des Repos (den Merge-Commit) und hält das Urteil für veraltet | Bei `status=done` das aufgezeichnete Urteil zeigen (wie `verifyRow`) und `gate` für gelandete Tickets nicht auswerten; Merge-Commits nicht als neuen Prüfstand zählen |
| R3-09 | minor | inbox (+ orchestra) | `inbox/main.js:69-79,120-123`, `dashboard/main.js:565-580` | `12`, `12b` | Inbox-Badge 2, Liste 3 wartende Dinge: die Verlaufs-Frage zählt nicht mit (7.3 nennt nur blocked + review). Nur das Dashboard erklärt „Inbox 2 + 1 Verlauf" | Die Frage in die Zählerformel aufnehmen (dann 3) oder den Hinweis auch im Inbox-Kopf zeigen; 7.3 nachziehen |
| R3-10 | minor | review | `review/main.js:694`, `:725` | `06e` | Zwei Primärknöpfe gleichzeitig: „Lehren übernehmen" im Kopf und „Mergen" in der Fußleiste. Spec 5.6: höchstens einer pro Fläche | „Lehre übernehmen" sekundär; „Mergen" bleibt der eine Primärknopf |
| R3-11 | minor | dashboard | `dashboard/main.js:642,658-659` | `11`, `12b` | Der Team-Block nutzt den rohen Terminal-Status: Rune steht „ruhig", während Sidebar und Inbox „arbeitet" (Sub-Agent) zeigen. Zwei Zahlen/Wörter für denselben Zustand | Dieselbe effektive Statusregel wie `inbox/main.js:48-57` verwenden oder am Eltern-Eintrag „Sub-Agent arbeitet" zeigen |
| R3-12 | minor | orchestra | `orchestra/hubview.js:362,383-385` | `05b`, `20`, `22b` | „Lehren 2 PR offen" steht ohne Trennung in einer Zeile; PR-Zustand ist Fließtext in `done`-Farbe und liest sich als Teil der Lehren-Zeile | „PR offen" als eigener Chip in der Gate-Zeile oder mit Trenner/Icon; Lehren-Zähler bleibt allein |
| R3-13 | minor | dashboard | `dashboard/main.js:196-200,612,634,658` | `13` | Spalte „Dauer" zeigt das Alter des Status (bzw. seit dem ersten Sehen); nach einem Fenster-Neustart steht bei allen „gerade". Es ist keine Dauer der Arbeit | „Status seit" nennen oder aus `status_at`/Ticket-Zeit rechnen; Tooltip mit Bezug |
| R3-14 | minor | dashboard (+ toast) | `dashboard/main.js:805-826` | `13b` | Im schmalen Fenster liegt der Team-Toast genau über dem „Senden" der Auftrag-Zeile, solange er sichtbar ist; die primäre Aktion ist verdeckt | Auf dem Dashboard den Toast höher setzen oder die Auftrag-Zeile um die Toast-Fläche freihalten |
| R3-15 | minor | orchestra | `orchestra/ui.js:102-108`, `review/main.js:605-625` | `22` | Fünf Wörter für zwei Dinge: „Prüfstation", „Reviewer", „Review grün", „Review offen", „abgenommen". „Review grün" und „Review offen" stehen nebeneinander und wirken wie ein Widerspruch | Zwei Wörter: **Prüfung** (Station, grün/rot) und **Abnahme** (Mensch, offen/abgenommen); „Reviewer" → „Prüfer" |
| R3-16 | nit | inbox | `inbox/main.js:376` | `12` | Im Kopf der Detailansicht steht die rohe Adresse „t2" in `T_XS dim`; alle anderen Flächen zeigen Identität (die Adresse steht im Tooltip) | Adresse nur in den Tooltip des Identitäts-Chips |
| R3-17 | nit | orchestra | `orchestra/bin/hub:968` | `20` | „Urteil: pass (Runde 1) · Urteil: pass — 0 Blocker …": das Wort „Urteil" steht doppelt, weil der Reviewer seine Zusammenfassung mit „Urteil:" beginnt | Kommentar ohne Präfix „Urteil:" schreiben oder ein führendes „Urteil:" in der Zusammenfassung entfernen |
| R3-18 | nit | orchestra | `orchestra/hubview.js:344` | `05c` | Die Verlaufs-Vorschau schneidet mitten im Wort ab („Vorschlag für eine Lehre: Schmale Fenster im") — kein Ellipsis, kein Fade | Zwei-Zeilen-Clamp mit „…" oder Fade am Kartenrand |
| R3-19 | nit | dashboard | `dashboard/main.js:510-514` | `11` | Hat das Ticket keinen Terminal mehr, zeigt die Prüfzeile den Orchestrator als Identität („Oh My Pi") — als hätte er die Arbeit gemacht | Chip nur für `tk.terminal`; sonst kein Chip (oder `tk.agent` als Programmname) |
| R3-20 | nit | review | `review/main.js:550-560,777` | `23b` | Nach dem Mergen zeigt die Fenster-Meta den entfernten absoluten Pfad (`…/demo/worktrees/ui-1`) statt Branch/Commits | Im abgeschlossenen Zustand „gemergt in main@…" oder den Branch nennen; Pfad nur im Tooltip |
| R3-21 | nit | dashboard | `dashboard/main.js:613,629,745,786` | `11`, `13` | Zwischenhöhen zwischen den Tokens: 40 (Tätig-Zeile), 18 (Balken), 16 (Spaltenkopf), 15 (Kostenzeilen). Optisch stimmig, aber §5.1 nennt eine geschlossene Liste | Auf H_ROW/H_ROW2 und H_CHIP ziehen oder als bewusste Karten-Innengröße in der Spec ergänzen |

## Was gut ist

- **Leerer Zustand.** Dashboard ohne Daten ist vollständig: „Nichts wartet auf dich", „Keine Agents
  laufen", Stufen 0, „Noch keine Tickets. Gib dem Team unten einen Auftrag.", Kosten 0, Auftrag mit
  „Orchestrator starten" als einzigem Primärknopf. Keine stillen leeren Flächen
  (`14-dashboard-leer.png`).
- **Wartet-Regel.** Abschlussberichte warten nicht, echte Fragen schon; die Verlaufs-Frage steht
  auf Dashboard und in der Inbox, und das Dashboard erklärt den Unterschied der Zahlen
  („Inbox 2 + 1 Verlauf") statt ihn zu verstecken (`11`, `12`, `12b`).
- **Prüfstation.** Checks und Urteil sind an einen HEAD gebunden und nennen den Grund, wenn sie
  veralten; „Erneut prüfen" startet einen zweiten Agenten mit anderem Programm als der Umsetzer,
  im eigenen Worktree, und der laufende Reviewer erscheint als Identitäts-Chip am Ticket (`20`, `21`, `22`).
- **CI-Zeile.** Chip, Zeitpunkt, „PR öffnen", „Erneut prüfen"; rote Checks klappen Namen und
  Log-Auszug auf, deutsche Wörter, keine rohen Exec-Texte (`06d`, `22`).
- **Lehren.** Datum, Text, Quelle; der Vorschlag wartet sichtbar auf den Menschen und wird erst
  mit „Lehre übernehmen" geschrieben (`06`).
- **Ablauf.** `hub verify` → `hub review-start` → Befunde → `hub review-verdict` → `hub review` →
  Fenster → `hub land --merge` funktioniert inklusive Aufräumen von Agent, Worktree und
  Prüf-Worktree; das Ticket verlässt die Pipeline und die Sidebar (`23`).
- **Tokens.** Keine neuen Schriftgrößen, Radien oder Hex-Farben; Köpfe 42, Chips 18, Eingaben 30;
  alle Prüfbefehle aus §10 ohne Treffer; `docs/ui-preview.sh check` für dashboard, orchestra,
  review, inbox und launcher grün; `errors: []` in jeder Aufnahme.

## Ablauf wie der Mensch

| Schritt | Kommando | Beobachtung | Beleg |
|---|---|---|---|
| 1. Auftrag | `hc send orchestrator "Neues Ticket bitte: Prüfstation im Ablauf — Abnahme mit Nachweis."` | Das Kommando ist das, was das Auftragsfeld im Dashboard sendet (`dashboard/main.js:442`); der Fake-Orchestrator zeigt den Text im Terminal | `20` |
| 2. Ticket | `hub ticket new --title "Prüfstation im Ablauf" --repo …/demo/repo`, danach `hub ticket set … agent=omp branch=feat/prufstation-im-ablauf base=main worktree=… terminal=t9 space=… status=doing` | Ticket erscheint in „In Arbeit"; Team-Zeile mit Identität, Branch, Kosten, Lehren | `20` |
| 3. Prüfen | `hub verify prufstation-im-ablauf` | „Checks pass · 0.0 s · exit 0 · HEAD f63275a"; Chip grün mit HEAD | `20`, `21` |
| 4. CI rot | `PATH=/tmp/ui-review3/bin:$PATH hub ci prufstation-im-ablauf` | „CI rot: test (ubuntu) · …", „Ticket auf doing", Verlauf-Kommentar, `hc send` an den Umsetzer | `20` (Terminal-Echo) |
| 5. Fix + Prüfen | Commit „Fix: schmale Karte", `hub verify …` | Neuer HEAD `a7ffbf4`, Checks wieder pass | `21` |
| 6. Prüfstation | `hub review-start prufstation-im-ablauf` | Reviewer `t10` (`claude`), eigener Worktree, eigener Space; Team zeigt „Review läuft" + Reviewer-Chip | `20` |
| 7. Befunde + Urteil | `hub ticket comment … --from review "major: …"` (2×), `hub review-verdict … --verdict pass --summary …` | „Review pass · Runde 1 · HEAD a7ffbf4"; Befunde im Verlauf; Ticket bleibt `review` | `22b` |
| 8. Übergabe | `hub review … --summary … --evidence /tmp/ui-review3/11-dashboard-voll.png --evidence …/PRUEFSTATION.md` | Status `review`; Fenster zeigt Urteil, Befunde, CI, Lehren, Nachweise, Diff | `22`, `22b` |
| 9. Mergen | `hub land prufstation-im-ablauf --merge` | Merge `main@d01f21a`; Agent beendet, Worktree und Prüf-Worktree entfernt; Fenster „Abgenommen und gemergt in main@d01f21a" (Fußleiste) | `23` |
| 10. Aufräumen | `hub cleanup --dry-run`, `hub cleanup` | Der gewollte Rest (`leftover`) wird entfernt; **zusätzlich zwei fremde Worktrees** (R3-01) | `30-cleanup-dry.txt`, `31-cleanup.txt` |

Der Merge im Demo-Repo ist echt (`git -C ~/.herdr/ui-preview/feat-review3/demo/repo log --oneline`
zeigt `d01f21a Merge feat/prufstation-im-ablauf: Prüfstation im Ablauf`). `hub land` meldete
`{"merged":"main@d01f21a","pr":"https://github.com/demo/repo/pull/8","ci":"fail",…}`.

## Prüfnachweise

**Spec §10** über die neuen Dateien (`dashboard`, `orchestra` inkl. `hub`, `review`, `inbox`,
`launcher`, `status-bar`, `tabs-graph`): keine Hex-Farben, keine Radien außerhalb 4/6/8/10, kein
`toUpperCase()` außer der Provider-Schlüsselbildung in `status-bar/main.js:135`, keine englischen
Reste. Die `text_size`-Suche meldet nur Aufrufe mit `T_*`-Variablen (der Regex prüft Literale; die
Variablen lösen ihn aus, sind aber die Skala). `docs/ui-preview.sh check` grün für die fünf
geprüften Mods, `errors: []` in jeder `status`-Abfrage, keine Mod-Warnung.

**Kontrast (Theme `elric`, kleine Schrift).** Alle neuen Texte liegen über 4,5:1; die früheren
`dim`-Reste sind nicht zurückgekommen.

| Stelle | Vordergrund / Grund | Verhältnis |
|---|---|---|
| „Reviewer", „Prüfstation", Zeitstempel, `review · 01:09` | `dim` / `surface` | 5,57 |
| Team-Spaltenköpfe, „Dauer", „Lehren 2" | `dim`/`muted` / `surface` | 5,57 / 7,26 |
| „Inbox 2 + 1 Verlauf", „7 Tage · erledigt" | `dim` / `background` | 6,17 |
| Gate-Chip „Checks ✓" | `done` / `done`+`26` auf `surface` | 9,87 |
| Gate-Chip „Checks ✗", „CI ✗" | `blocked` / `blocked`+`26` auf `surface` | 5,15 |
| „Review offen" | `working` / `working`+`26` auf `surface` | 9,09 |
| „Lehre übernehmen" (primär) | `solid_foreground` / `solid` | 7,57 |

**Geometrie.** Panel- und Fensterköpfe 42 px, Sektionsköpfe 28, Chips 18, Knöpfe 26/22, Eingaben
30 (Abweichungen im Dashboard: R3-21); das Review-Fenster beginnt bei 42 px und schließt mit dem Icon-Knopf. Die Prüfzeile im
Dashboard ist 44 px (Titel + Chips + Knopf), die Team-Zeile 28 px, wie in der Spec.

## Testfenster, Live-Welt, Grenzen

- Testfenster per `docs/ui-preview.sh down` beendet, Test-Cores gestoppt (auch der leere
  Zusatz-Core `uiprev-empty-r3`); das Test-Home bleibt wie in den Runden davor liegen. Der Helfer
  `mods/zzopen`, die Injektionen in `mods/inbox`/`mods/review` und
  `/tmp/ui-review3/zzopen-target` sind entfernt bzw. aus dem Worktree zurückgespielt.
- **Live-Welt:** keine getrackte Datei der Live-Config wurde durch den Review geändert; das
  laufende Fenster des Menschen schreibt weiterhin `settings.json` (bereits vor dem Review
  geändert) und Laufzeitzustand. Der Cleanup-Lauf hat jedoch Worktree-Metadaten der Live-Welt
  verändert (R3-01): zwei Worktrees entfernt, einen davon (meinen) wiederhergestellt; der fremde
  Branch ist intakt, sein Worktree ist inzwischen wieder da. Kein Push.
- Der eigene Worktree war zwischenzeitlich weg (R3-01) und wurde aus `feat/review3` neu
  angelegt; der Branch stand dabei auf `d89330d` (main), dieser Bericht ist der einzige Commit
  darauf (`git log --oneline main..HEAD`).
- Grenzen der Aufnahme: keine Maus-/Tastatureingabe ins Hintergrundfenster; Zustände über
  Test-Home-Injektion und denselben Kommandopfad wie die Knöpfe. CI über Fake-`gh`; das echte
  `gh` ist nicht mit dem Demo-Repo verbunden. Nur `elric` als Theme vorhanden; helles Theme nicht
  geprüft. Zoom 0,8 (Tastenkürzel) ist nicht bewertet, weil die Spec Zoom 1 vorgibt.

## Restliste

Vor der Abnahme, in dieser Reihenfolge (Paket in Klammern):

1. **R3-01** `hub cleanup` auf das eigene Home/Repo begrenzen und ohne `--yes` nur Dry-Run
   (orchestra).
2. **R3-02** Ticket-Herausgeber ins Dashboard-Layout oder ins Dashboard (dashboard + orchestra).
3. **R3-03** Review-Kopf falten/scrollen, Fußleiste fest, Diff ≥ 45 % (review).
4. **R3-05** `ci_head` und Stale-Anzeige, „Erneut prüfen" nach `done` aus (orchestra + review).
5. **R3-04** Kosten-Karte benennen (dashboard).
6. **R3-06**, **R3-07**, **R3-08**, **R3-09**, **R3-15** (Sprache/Identität/Zähler), dann die
   übrigen Minor und Nit.

Ohne R3-01 wäre der Fabrikpfad in meinen Augen abnahmefähig; mit dem Datenverlust in `hub cleanup`
nicht.
