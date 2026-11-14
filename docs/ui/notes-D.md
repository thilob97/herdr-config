# Notizen D: Start-Dashboard

Branch `feat/ui-dash` (Basis `main`, 07aeef2). Ein Fenster für den Start: die Fabrik auf
einen Blick, ohne Seitenleiste, Tab-Leiste und Statusleiste.

## Dateien

| Datei | Inhalt |
|---|---|
| `layouts/dashboard.json` | ein Block über die ganze Fläche, `content: { "mod": "dashboard" }`, Hintergrund `surface` |
| `mods/dashboard/` | `main.js` (Ansicht), `ui.js` (Kopie der Bausteine wie in den Paketen B/C), `mod.json` (`place: none`), `icon.svg` |
| `keys.json` | global `⌘⇧0` → `layout.switch:dashboard`; im Layout `dashboard` `⌘⇧0` → `layout.switch:elric` |
| `README.md` | Abschnitt „Start-Dashboard“ (neu, am Ende) |

`layouts/elric.json`, `docs/ui-spec.md`, `docs/ui/review.md` und `docs/ui-preview.sh` bleiben
unverändert.

## Was der Mensch sieht

- **Kopf:** Logo 20, „Herdr“, Uhrzeit/Datum, Knopf „Workspace“ (wechselt auf `elric`).
- **Wartet auf dich:** Tickets mit Status `review` (Titel, Identitäts-Chip, Gate-Chips, „Prüfen“
  öffnet das Review-Fenster im Ticket-Modus); Rückfragen von Agents und des Orchestrators mit der
  letzten Frage vom Bildschirm und einem Antwortfeld (`hc send … --force`); dazu die Karte
  „Offene Fragen“. Ohne Einträge steht dort ein ruhiger Satz statt eines leeren Kastens.
- **Fabrik:** Stufenleiste `Geplant n › In Arbeit n › Prüfung n › Fertig n` mit den Zahlen aus
  `shared("orchestra.tickets")`; Klick auf „Prüfung“ öffnet den Workspace mit dem Team-Panel,
  die anderen Stufen den Workspace. Darunter die wichtigsten (bis fünf) Tickets in Arbeit mit
  Identität, Dauer und Kosten, rechts „Kosten heute“ und „Team-Budget“ aus
  `shared("orchestra.costs")`/`shared("orchestra.budget")`.
- **Auftrag:** großes Textfeld „Was soll das Team bauen?“, `⌘↵` sendet an den Orchestrator
  (bei `blocked` mit `--force`), danach steht die Bestätigung im Feld. Ohne laufenden Orchestrator:
  Hinweis und Knopf „Orchestrator starten“.

## Bedienung

`↑↓` wählt, `↵` öffnet (Agent → Terminal bzw. Peek, Ticket → Review-Fenster), `r` antwortet der
gewählten Rückfrage, `g` `w` und der Workspace-Knopf wechseln auf `elric`, `Esc` räumt Wahl und
Fokus. `⌘⇧0` wechselt in beide Richtungen; `shared("layout")` ist das zuletzt gezeigte Layout,
damit startet Herdr nach dem Wechsel im Dashboard.

## Prüfung

- `docs/ui-preview.sh check dashboard`: grün.
- `docs/ui-preview.sh up`/`do layout.switch --name dashboard`: `errors: []`.
- Screenshots unter `/tmp/ui-audit`: `D-dashboard.png`, `D-dashboard-blocked.png`,
  `D-dashboard-review.png`, `D-dashboard-empty.png` (eigenes leeres Test-Home), `D-dashboard-narrow.png`
  (900 px).
- Antwort aus dem Feld kommt im Fake-Agent an (`docs/ui-preview.sh hc read t2` zeigt den Text);
  Auftrag aus dem Feld kommt im Fake-Orchestrator an (`hc read orchestrator`).
- `⌘⇧0` in beide Richtungen geprüft; danach war `shared("layout")` jeweils das gezeigte Layout.
- Prüfbefehle aus `docs/ui-spec.md` §10 ohne Treffer in den eigenen Dateien.

## Offen

- Die Karte „Offene Fragen“ liest noch keine Ticket-Verläufe: die Tickets-Oberfläche (Teil 2)
  ist nicht gemergt und `shared("orchestra.tickets")` trägt keine Kommentare. Bis dahin zeigt sie
  den leeren Zustand mit Satz; sobald die Quelle da ist, füllt sie sich aus demselben `shared`.
- Dauer einer Zeile in Arbeit ist die Zeit seit dem ersten Sehen dieses Status auf diesem
  Bildschirm (kein Zeitstempel in `hc ls`); vorher steht dort „—“.
