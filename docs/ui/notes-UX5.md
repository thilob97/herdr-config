# UX 5: Board-Filter, Timeline-Legende, Besitzer-Chip im Dashboard

Drei sichtbare Verbesserungen für den Betrieb mit vielen Tickets: das Board lässt sich
in der Kopfzeile durchsuchen, die Timeline erklärt ihre Ereignis-Symbole unter der
Zeitleiste, und das Dashboard nennt den fremden Orchestrator eines Tickets.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/board/main.js` | Suchfeld + Trefferzahl in der Kopfzeile, `matches()`, `clearFilter()`, ⌘F/Esc, gefilterte Spalten |
| `mods/timeline/main.js` | eine Ereignis-Tabelle (`EVENTS`) für Marker und Legende, Legendenzeile unter der Zeitleiste, erklärende Marker-Tooltips |
| `mods/dashboard/main.js` | `foreignOwner()`/`ownerChip()`, Chip in `reviewRow` („Wartet auf dich") und `doingRow` („Fabrik") |
| `mods/dashboard/test/waits.test.mjs` | Randfälle der Besitzerregel: fremd, eigen, herrenlos, `mensch`, kein lebender Orchestrator |
| `docs/ui/notes-UX5.md` | diese Notizen |

## Verhalten

- **Board-Filter.** Das Suchfeld steht in der Kopfzeile (`board-filter`), ⌘F setzt den
  Fokus hinein, Esc leert es. Durchsucht werden Titel, Labels, Branch und Ticket-ID,
  Groß/Klein egal; mehrere Wörter müssen alle vorkommen (UND), jedes darf in einem
  anderen Feld stehen. Der Kopf zählt die Treffer als `12 von 49`, die Spalten zählen
  nur Treffer, und leere Spalten bleiben mit ihrem Leertext stehen. Karten behalten
  Gates, Sperren und Kosten (die Blocker-Prüfung liest weiter alle Tickets). Der Filter
  liegt in `localStorage["filter"]` (`data/board/store.json`) und wird beim Öffnen
  wieder gesetzt. Die Tastenauswahl (↑↓/j/k, ↵) arbeitet auf den Treffern; Tippen im
  Feld bewegt keine Karte.
- **Timeline-Legende.** Unter der Zeitleiste steht eine ruhige Zeile „Ereignisse" mit
  den sechs Symbolen in Wörtern: Dispatch · Prüfung · Urteil · CI · Landen · Sub-Agent.
  Marker-Tooltip und Legende lesen dieselbe Tabelle, der Marker-Tooltip sagt zusätzlich,
  was die Art bedeutet („14:32 · Dispatch — ein Agent wurde gestartet · …"). Der
  Sub-Agent-Punkt nennt „Sub-Agent" im Tooltip. Die Statuslegende über dem Raster
  (arbeitet · wartet · fertig · Sub-Agent) bleibt unverändert.
- **Dashboard.** `foreignOwner(tk)` vergleicht `owner` mit dem lebenden Orchestrator
  (`terminals()`, Name `orchestrator`) und übergeht `mensch` und leere Besitzer — dieselbe
  Regel, mit der `hub status` den Besitzer ausblendet. Ein fremdes Ticket trägt in
  „Wartet auf dich" und „Fabrik" den Chip `von <owner>` (Tooltip „anderer Orchestrator",
  Farbe `muted`); eigene und herrenlose Tickets tragen keinen Chip. Ohne lebenden
  Orchestrator gibt es nichts zu vergleichen, dann bleibt der Chip aus (kein eigenes
  Ticket wirkt fremd). Das Board zeigt keinen Besitzer-Chip.

## Prüfung

- `docs/ui-preview.sh check board`, `check timeline`, `check dashboard`: je
  `check passed`.
- `node --test mods/dashboard/test/waits.test.mjs`: 13/13 grün (zwei neue Fälle für die
  Besitzerregel).
- Testfenster `feat-ux5`: `herdr-app status` → `errors: []`; danach `down`.
- Belege unter `/tmp/ui-ux5/`:
  - `board-filter.png` — Panel 1100 px: Kopf „Board · 12 von 49", Suchfeld `filter`,
    gefüllte Spalte Geplant mit 12 Treffern, leere Spalten In Arbeit / Prüfung / Fertig.
  - `board-narrow.png` — dasselbe bei 368 px: „12 von 49" und Suchfeld passen in die
    Kopfzeile, Kartenliste darunter.
  - `timeline-legend.png` — Zeile unter der Zeitleiste: Ereignisse ● Dispatch ● Prüfung
    ● Urteil ● CI ● Landen ● Sub-Agent.
  - `dashboard-owner.png` — „Wartet auf dich": Wartung 40 mit `von t9z`, demo-1 ohne
    Chip; „Fabrik": erste Zeile mit `von t9z`, die eigenen Zeilen ohne.

## Grenzen

- Der Dashboard-Chip zeigt den rohen Besitzerwert (die Terminal-Adresse, die `hub`
  schreibt), keinen veröffentlichten Agent-Namen; `von <owner>` ist wörtlich die
  Ticket-Angabe.
- Der Board-Filter ist Textsuche, keine Suche in Status, Alter oder Kosten.
- Kein Push.
