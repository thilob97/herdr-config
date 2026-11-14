# Notizen I: Team, Kosten und Aktivität im Start-Dashboard

Branch `feat/dash-2` (Basis `main`, 847e37f). Das Dashboard zeigt die Fabrik jetzt vollständig:
wer arbeitet woran, was es kostet und was zuletzt geschah, weiter ohne Seitenleiste, Tab-Leiste
und Statusleiste.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/dashboard/main.js` | Team-Block, Aktivität, Kosten-Karte, kompakte Null-Zustände, Klick auf Agent/Kosten, Hinweis `⌘⇧0 Workspace` |
| `README.md` | Abschnitt „Start-Dashboard“ auf Team/Kosten/Aktivität und die Klickwege gebracht |
| `docs/ui/notes-I.md` | diese Notizen |

`mods/dashboard/ui.js`, `layouts/dashboard.json`, `keys.json`, `layouts/elric.json`,
`docs/ui-spec.md` und `docs/ui/review.md` bleiben unverändert. `⌘⇧0` war bereits in `keys.json`
global auf `layout.switch:dashboard` und im Layout `dashboard` auf `layout.switch:elric` gelegt.

## Was der Mensch sieht

- **Wartet auf dich:** Tickets in Prüfung und Rückfragen von Agents wie bisher. Offene Fragen aus
  Ticket-Verläufen (`question` in `orchestra.tickets`, dieselbe Quelle wie Inbox) sind eine Zeile je
  Frage mit Ticket, Text und Alter; ein Klick öffnet das Review-Fenster. Ist nichts offen, steht dort
  eine ruhige Zeile („Nichts wartet auf dich, keine offenen Fragen.“), kein leerer Kasten.
- **Team:** je Agent eine Zeile mit Identitäts-Chip (Avatar/Name aus `agents.identity`), Status,
  Space/Tab, Ticket, Dauer und Kosten. Gruppenzeilen wie im Team-Panel: zuerst die beobachteten Teams
  aus `shared("orchestra.groups")`, danach die übrigen Agents nach Space; die Zeile trägt Name,
  Anzahl und die dringendste Statusanzeige. Ein Klick auf eine Agent-Zeile wechselt auf `elric` und
  fokussiert Space, Tab und Pane des Agents.
- **Letzte Aktivität:** höchstens fünf Zeilen (`T_S` muted, Zeit `T_XS` dim), neueste zuerst: der
  letzte Eintrag je Ticket aus `verlauf` (sonst sein Zustand), wartende Agents und erreichte Budgets.
- **Fabrik/Kosten:** die Stufenleiste und die Tickets in Arbeit wie bisher. Rechts steht die
  Kosten-Karte als eigene Karte: heute (`orchestra.costs.teamCost`), Team-Budget
  (`orchestra.budget.team`, Standard 20) mit Fortschritt und pro offenem Ticket die Kosten; ein Klick
  öffnet das Team-Panel im Workspace. Dieselben Quellen und Zahlen wie Team-Panel und Team-Chip der
  Statusleiste.
- **Startbildschirm:** `⌘⇧0` wechselt in beide Richtungen. Im Kopf steht dezent „⌘⇧0 Workspace“,
  daneben Uhrzeit und der Knopf „Workspace“.
- **Schmal:** bei 900 px Breite bleiben Team, Aktivität, Kosten und Auftrag sichtbar; lange Texte
  kürzen mit Tooltip, nichts läuft aus der Karte.

## Prüfung

Testfenster `~/.herdr/ui-preview/feat-dash-2` (eigener Core, Demo-Welt), Fenster 1710×1010 und
900×1010.

- `docs/ui-preview.sh check dashboard`: `check passed`; `herdr-app status`: `errors: []` in beiden
  Layouts.
- Screenshots `/tmp/ui-dashboard2/dashboard-full.png` (Team + Aktivität + Fabrik + Kosten +
  Auftrag), `dashboard-narrow.png` (900 px), `dashboard-empty.png` (eigenes leeres Test-Home ohne
  Agents/Tickets/Teams/Kosten). Dazu `costs-card-click.png` (Team-Panel nach Klick auf die Karte).
- **Klick auf Agent-Zeile** im Testfenster mit echtem Zeiger: vorher Tab „Review“ (`tbc04bd…`,
  Agent `t2`) aktiv, danach `layout: elric`, Tab „Pipeline“ (`tbadc5a…`), Pane `pfd0ce…`, Agent
  `t1`; Fehler `[]`.
- **Kosten-Karte:** Klick öffnet `elric` mit dem Team-Panel (`layout.select panel-body team` und
  `layout.show panel` nach dem Layout-Wechsel, damit sie nicht vom Laden verworfen werden).
  Zahlen im Testfenster: Karte `$2.87` heute, `$20` Team-Budget, `demo-1 $1.84`, `demo-2 $0.62`;
  Team-Panel `demo-1 $1.84 / $3`, `demo-2 $0.62 / $3`, unten `Team $2.87 / $20`; Team-Zeile von
  Halo `$0.62`; Statusleiste `Team $2.87 / $20`.
- Leeres Test-Home (`feat-dash-2-empty`, eigener Core) nur für den Leer-Screenshot; danach Fenster
  und Core beendet, Zustandsverzeichnis entfernt.
- Prüfbefehle aus `docs/ui-spec.md` §10 auf `mods/dashboard/main.js`: keine Hex-Farben, kein
  `toUpperCase()`, keine Radien außerhalb 4/6/8/10; Schriftgrößen nur über die Tokens `T_XS`–`T_XL`.

## Offen

- Ein Agent ohne laufenden omp meldet keine Kosten: die Team-Zeile zeigt dann `—`, wie das
  Team-Panel. Die Ticket-Kosten selbst (`orchestra.costs.tickets`) füllen die Karte unabhängig davon.
- Die Aktivität ist aus den vorhandenen Feldern abgeleitet (letzter `verlauf`-Eintrag je Ticket,
  `updated`, `attention.since`, `costs.stopped`); ein eigenes Ereignis-Log gibt es nicht. Reichen
  die Zeiten nicht, steht die Zeile ohne Alter (`T_XS` leer).
- Der Klick-Test braucht die Bedienungshilfen-Freigabe für synthetische Zeigerereignisse; im
  Testfenster geprüft, die Freigabe ist keine Voraussetzung für die Mod.
