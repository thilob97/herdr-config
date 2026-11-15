# Notizen R2: Board-Feinschliff (Kosten, Titel, Zugang)

Branch `feat/board-2` (Basis `main`, `c325548`). Board-Panel in `elric`, Block `board`.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/board/card.js` | Karte: höchstens zwei Label-Chips (danach „+n mehr"), Titel über zwei Zeilen mit „…", unzugewiesene Karten ohne „niemand", Kosten in einer Zeile |
| `mods/board/main.js` | Titelzeichen je Zeile aus der Kartenbreite (on_size_change ÷ Zoom), 4 Spalten ab 772 px, `board.panel` idempotent (zeigt statt umzuschalten) |
| `mods/tabs-graph/main.js` | Knopf „Board" mit Kaltstart: erst `layout.select` (lädt den `place:none`-Block) und `layout.show`, das Mod-Kommando nur wenn geladen; Öffnen/Schließen bleibt in der Leiste |
| `mods/orchestra/hubview.js` | dieselbe Karte (Kopie) gleich nachgezogen |
| `docs/ui/notes-R2.md` | diese Notizen |

## Was der Mensch sieht

- **Kosten:** eine Zeile je Karte (`$0/$3` bei Budget 3). Die Kopfzeile trägt ID, höchstens
  zwei Chips (Priorität zuerst), rechts das Alter; die zweite Zeile ist der Titel, die dritte
  Identität (nur wenn zugewiesen), Gates und Kosten. Kein Umbruch mehr, deshalb keine zweite
  Kostenzeile unter den Gates.
- **Titel:** zwei Zeilen, an einer Wortgrenze mit „…" beendet. Die Zeichenzahl je Zeile kommt
  aus der Innenbreite der Karte (`on_size_change` meldet echte Pixel; das Board rechnet mit
  `settings().zoom` auf Layout-Pixel um). Bei 772 px Panelbreite sind vier Karten 180 px breit,
  darunter 2×2, darunter eine Spalte.
- **Niemand:** unzugewiesene Karten zeigen keine Identität; rechts in der Kopfzeile bleibt das
  Alter (`317d`).
- **Viele Labels:** erster Chip plus `+n mehr`, keine abgeschnittenen Pillen.
- **Zugang:** `board` ist ein `place:none`-Mod und meldet `board.panel` erst, wenn der Block
  einmal gerendert wurde. Der Knopf in der Tab-Leiste wählt daher zuerst
  `layout.select {stack:"panel-body", child:"board"}` (lädt den Block) und zeigt dann das Panel;
  erst wenn der Block schon aktiv ist, folgt `board.panel` (jetzt idempotent: zeigt das Panel,
  schaltet nicht um). Ein Kaltstart öffnet das Board ohne „unknown command".
- **Spalten:** leere Spalte mit „Nichts geplant." bleibt; die Kartenkopfzeile kürzt viele
  Labels als `+n mehr` statt sie abzuschneiden.

## Prüfung

- `herdr-app check` für `mods/board`, `mods/tabs-graph`, `mods/orchestra`: `check passed`.
- Kaltstart im Testfenster (`~/.herdr/ui-preview/feat-board-2`, frisch gestartet, Panel zu,
  Board nie gezeigt): Klick auf „Board" öffnet das Panel; `herdr-app status` → `errors: []`,
  kein Fehler-Toast.
- Screenshots `/tmp/ui-board2/`: `20-cold-start.png` (Kaltstart per Klick, 1710 px),
  `21-narrow-1000.png` (1000 px, 2×2), `22-wide-1700.png` (1700 px, Panel 800 px, 1×4).
- Testfenster beendet (`docs/ui-preview.sh down`).
