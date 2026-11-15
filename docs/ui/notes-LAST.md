# Feinschliff: Timeline-Balken lesbar, Fertig-Spalte einklappen

Letzter Feinschliff an Timeline und Board. Tokens bleiben die aus `docs/ui-spec.md`.

## Timeline (`mods/timeline`)

- Balken sind **10 px hoch** (vorher 18, Sub-Agent 4). Ein 10-Minuten-Lauf ist ein Balken,
  kein Punktmuster; der Live-Balken behält seinen pulsierenden Rand.
- Füllung `color + "66"` statt `"33"`. Ein Rand sitzt nur noch ab **2 % Balkenbreite**;
  darunter ist der Balken randlos, damit ein Stummel nicht wie ein Kästchen wirkt.
- **Ereignis-Marker** sind 6-px-Quadrate in der Ereignisfarbe, an der **Unterkante** der
  Zeile unter dem Balken (zwei versetzte Sitze bei fast gleicher Zeit). Das Symbol im
  Marker entfällt; der Tooltip nennt weiter Zeit, Art und Text, der Klick öffnet das Review.
- **Sub-Agent-Punkte** sitzen ebenfalls an der Unterkante (6 px rund, wie bisher).
- Reihenfolge in der Zeile bleibt Balken → Ereignisse → Sub-Agenten; nichts verdeckt den Balken.
- Zwei Ereignisse zur selben Zeit liegen im zweiten Sitz 7 px höher, bleiben aber unter dem Balken.

## Board (`mods/board`)

- Spalte **Fertig** zeigt die **5 jüngsten** Karten nach `status_at` (die Karten sind
  aufsteigend sortiert, also die letzten fünf). Darunter steht `+n ältere anzeigen`; ein
  Klick klappt alle auf, der Text wird zu `−n ältere ausblenden`. Der Zustand gilt pro
  Sitzung in `localStorage["doneAll"]`. Der Spaltenkopf zählt weiter **alle** Karten.
- Die Tastatur (↑/↓) erreicht jedes Ticket; landet die Auswahl auf einer verborgenen
  Karte, klappt die Spalte auf und scrollt dorthin.
- Board-Kopf: `2 offen · Σ $88 gesamt` — die Summe sagt jetzt, dass sie alle Karten
  meint (Tooltip: „Kostensumme aller Karten im Board“).

## Prüfung

- `docs/ui-preview.sh check board` / `check timeline`: grün.
- `herdr-app status` im Testfenster: `errors: []`.
- Belege unter `/tmp/ui-last/`: Timeline mit kurzen Läufen, Board Fertig eingeklappt und
  aufgeklappt, Kopf-Text.
- Kein Push; Testfenster danach beendet.
