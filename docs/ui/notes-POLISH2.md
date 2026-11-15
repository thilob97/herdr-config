# UI-Politur 2: Board-Spalten nach Breite, Timeline-Auto-Fenster

Was sich für den Menschen sichtbar ändert. Tokens bleiben die aus `docs/ui-spec.md`.

## Board (`mods/board`)

- Spaltenzahl folgt der **gemessenen** Panelbreite (`on_size_change`, echte Pixel ÷ Zoom):
  unter 520 px **eine** Spalte (alle Karten untereinander, jeder Spaltenkopf ist die
  Trennzeile), 520–899 px **2×2**, ab 900 px **1×4**. Vor dem ersten Messen steht eine
  Spalte; es gibt keine Zwischenstufe und keine feste Schätzbreite mehr.
- Die Zeichenzahl je Titelzeile rechnet aus derselben Messung: Spaltenbreite minus
  Spaltenpolster (6 je Seite), Kartenpolster (8 je Seite) und Rahmen, ÷ 7,3 px.
- Titel enden bei Platzmangel mit einer echten Ellipse (`…`) an einer **Wortgrenze**;
  kein Wort wird mitten getrennt, die zweite Zeile hält ein Zeichen für das `…` frei.
  Ein einzelnes zu langes Wort endet in seiner Zeile mit `…`. Der alte Fehler
  (`…X` am Ende, harter Schnitt nach zwei Wörtern) ist weg.
- Label-Chips tragen den vollen Labeltext und schrumpfen selbst (`min_w(0)`, `truncate`,
  Ellipse); der Tooltip nennt weiter alle Labels. Kein Vorab-Schnitt mehr.
- Die Kopie der Karte im Team-Panel (`mods/orchestra/hubview.js`) bleibt unverändert:
  dieses Ticket erlaubt nur `mods/board/**`, `mods/timeline/**`, diese Notiz.

## Timeline (`mods/timeline`)

- **Auto** beginnt beim frühesten Start einer Arbeits-Lane (`agent`, `reviewer`,
  `subagent`), nicht mehr bei der Orchestrator-Uptime; erst wenn keine Arbeits-Lane
  einen Start hat, zählt der Orchestrator. Fenster weiterhin mindestens 30 Minuten.
  Ein 30-Minuten-Lauf belegt damit ≥ 8 % der Breite statt eines 3-px-Strichs.
- Eine Lane, die vor dem Fenster beginnt, wird links beschnitten und trägt dort eine
  kleine Kappe: im Balken ein `<` (9 px, Panelhintergrund), bei Sub-Agent-Strichen eine
  kurze Kante in der Statusfarbe. Der Tooltip nennt den echten Start
  („Anfang vor dem Fenster · seit HH:MM").
- Die Zoom-Auswahl (`Auto`, `1 h`, `24 h`, `7 Tage`, `Alles`) bleibt wie bisher in
  `localStorage["timeline.zoom"]` und wird beim Öffnen wieder gelesen.
- `Alles`, `1 h`, `24 h`, `7 Tage` sind unverändert.

## Prüfung

- `docs/ui-preview.sh check board` und `check timeline`: grün.
- `herdr-app status` im Testfenster: `errors: []`.
- Belege (Testfenster `feat-polish-2`, Panel per `layout.resize --id panel --px …`):
  - `/tmp/ui-polish2/board-340.png` — eine Spalte, Karte ~310 px, langer Titel endet
    mit `…` („… als eine…"), langer Label-Chip `tickets-pipeline-koordinati…`.
  - `/tmp/ui-polish2/board-700.png` — 2×2, Titel `… eine geschlossene…`.
  - `/tmp/ui-polish2/board-1200.png` — 1×4, keine Überläufe.
  - `/tmp/ui-polish2/timeline-auto.png` — Auto-Fenster 3 h (09:33–12:33) bei 18 h
    Orchestrator-Uptime; 30-min-Lauf ≈ 16 % der Chartbreite; Orchestrator links
    beschnitten mit `<`-Kappe (`/tmp/ui-polish2/timeline-cap.png` als Ausschnitt).
- Die Timeline-Belege nutzen im Test-Home **synthetische** Lanes (`hub timeline --json`
  gestubbt): die Demo-Agenten starten bei `up` gerade eben und können keine 30-min-Läufe
  zeigen. Der Stub liegt nur unter `~/.herdr/ui-preview/feat-polish-2/`, nicht im Repo.
- Die Klick-Strecke der Zoom-Auswahl ist unverändert und nicht per CLI automatisierbar;
  `localStorage`-Schreiben/-Lesen ist im Code unverändert.
- Kein Push; Testfenster danach beendet.
