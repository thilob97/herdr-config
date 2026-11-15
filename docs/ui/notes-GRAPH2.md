# Fabrik-Graph, Layout 2 (mods/graph)

Ersetzt das Ein-Spalten-Layout aus `notes-GRAPH.md`: der Graph ist jetzt ein
echter Baum mit mehreren Spalten, kompakten Karten und orthogonalen Kanten
zwischen Knoten statt Kurvenbüscheln am linken Rand.

## Aufbau

- **Wurzel** oben mittig: Orchestrator-Karte mit Krone, Name und getrimmtem
  „verteilt n Agenten“ (`ROOT_H 44`). Ohne Orchestrator ist jede parentlose Lane
  eine eigene Wurzel/Spalte.
- **Spalten** über die Panelbreite: Agents eines Orchestrators bekommen
  round-robin eine Spalte (`column`), mehr Agents als Spalten rücken in die
  nächste Zeile derselben Spalte. Spaltenzahl `min(direct, max(2, fit))`, mit
  `fit = floor((contentW + GAP_X) / (CARD_W + GAP_X))`; `cardW` ist die
  Spaltenbreite, höchstens `CARD_W_MAX 260`. Bei ~400 px sind es zwei, bei
  ~760 px drei Spalten.
- **Karte** einzeilig (`CARD_H 36`): Avatar (Agent-Farbe, 16/18 px), Name
  (gekürzt, Tooltip), Status-Chip. Der Orchestrator ist die einzige zweizeilige
  Karte. Das Panel misst seine Breite per `on_size_change` (wie die Timeline)
  und gibt sie als `width` an `layoutGraph`.
- **Ticket-Chip** als eigene Zeile direkt unter der Karte, gleiche Spalte:
  Status-Punkt + Kürzel (`shortId`, bei mehreren Tickets desselben Wortstamms
  mit zweitem Wortkürzel, z. B. `GRAPH-SP`). Ein Chip je Ticket; Sub-Agents
  erben das Ticket, bekommen aber keinen zweiten Chip.

## Kanten (orthogonal, gerundet)

`layout.js` liefert `points: [[x,y], …]`; der Renderer (`main.js`, `polyline`)
rundet jede Ecke mit einem Cubic und setzt die Pfeilspitze in Richtung des
letzten Segments. `pathScale()` folgt `git-graph`: Herdr ab 0.1.12 zoomt
`paint_path` selbst (Faktor 1), davor wird `settings().zoom` multipliziert.
Sonst laufen alle Kanten 20 % neben den Karten.

- **Anchor:** jede Baumkante beginnt an der Unterkante des Parents (rechts vom
  Ticket-Chip, damit sie ihn nicht kreuzt) und endet mittig an der Oberkante
  des Kindes.
- **Dispatch:** Wurzel → Agent. Erste Zeile je Spalte über die Bus-Zeile unter
  der Wurzel; tiefere Zeilen laufen bei der linken/rechten Außenspalte im
  Panelrand (6 px), bei einer mittleren Spalte im Spaltengang (`GAP_X 40`) nach
  unten und 10 px über der Zielkarte wieder hinein. Die Eintrittshöhe ist je
  Spalte versetzt, damit zwei Nachbarspalten keine durchgehende Linie bilden.
- **Parent:** Agent → Sub-Agent/Child in einer Gasse rechts neben den
  Kindkarten; so kreuzt die Kante keinen älteren Sub-Agent darüber.
- **Ticket:** Pfeil vom wartenden Chip zum Blocker-Chip. Gleiche Spalte 20 px
  neben der Karte im Spaltengang, benachbarte Spalten durch den Gang, weiter weg
  oben über alle Karten. Gestrichelt **nur** eine erledigte Abhängigkeit; `faint`,
  wenn beide Tickets fertig sind. Fehlt der Blocker im Scope, trägt der Chip
  „wartet auf …“ und es gibt keinen Faden.
- Keine Kante schneidet eine fremde Karte (Test „keine Kante läuft durch eine
  fremde Karte“).

## Geometrie

`PAD 20 · CARD_W 200 · CARD_W_MAX 260 · CARD_H 36 · ROOT_H 44 · ROOT_W_MAX 280 ·
TICKET_H 16 · CHIP_GAP 4 · CHIP_INSET 10 · INDENT 22 · GAP_X 40 ·
BAND_GAP 30 · SUB_GAP 10 · DISPATCH_GAP 26 · MIN_COLS 2 · NARROW_W 520`
(Layout-Einheiten, vor dem Zoom).

Sub-Agents stehen in derselben Spalte, `INDENT` je Ebene nach rechts, und werden
entsprechend schmaler. Karten überlappen nie; der Test prüft alle Paare.

## Tests

`node --test mods/graph/test/*.test.mjs` (Node 26 löst die Verzeichnisform
`node --test mods/graph/test/` nicht auf). Geprüft: Wurzel mittig + Dispatch,
Spaltenverteilung über die Breite, Sub-Agent-Einrückung, einzeilige Karten,
Ticket-Chips unter der Karte, Pfeilrichtung und Strich-Muster der
Abhängigkeiten, 400-px-Zustand, keine Kartenüberlappung, keine Kante durch eine
fremde Karte, Anker an Knotenrändern (nie am Panelrand), Filter/Zeitfenster,
Determinismus.

## Screenshots (`/tmp/ui-graph2/`)

`docs/ui-preview.sh up`, dann im Test-Home Demo-Daten setzen (Tickets über
`hub ticket set <id> terminal=t1 space=<demo-app-id> space_name=demo-app
blocked_by=<id>`; der Graph liest `shared("orchestra.tickets")`, deshalb die
Liste nach `hub ticket list --json --all` in `shared.json` spiegeln). Für
Sub-Agents `data/agent-cards/subagents.jsonl` mit `started`/`ended` in ms
schreiben. Orchestrator: `hub orchestrator start --space <id> --agent omp`.

Dann `do tabs-graph.panel-factory`, `do layout.show --id panel`,
`do graph.filter-done`, `do space.select --index 2` und
`SHOTS=/tmp/ui-graph2 docs/ui-preview.sh shot graph-full|graph-wide|graph-done|graph-empty`.
Das Fenster `mod.open:graph` (`props().overlay`) nutzt dasselbe Layout mit der
gemessenen Fensterbreite.
