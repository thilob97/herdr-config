# Fabrik-Graph (mods/graph)

Notizen zum Mod, das die Fabrik eines Workspace als Baum von oben nach unten zeigt —
neben der horizontalen Timeline.

## Was es zeigt

- Wurzel: der Orchestrator des aktiven Workspace, oben, mit Krone
  (`mods/orchestra/orchestrator.svg`, wie Timeline und Team-Panel).
- Darunter seine Agents als Karten: Avatar in der Agent-Farbe (Avatar-Bild aus
  `shared("agents.identity")`, sonst Initiale auf getönter Farbe), Name,
  Status-Chip (arbeitet/wartet/fertig/ruhig — `ui.statusChip`, dieselben Farben
  wie die Timeline) und der Ticket-Chip.
- Sub-Agents eingerückt unter ihrem Parent (16 px je Ebene, Karte wird schmaler).
- Eine Spalte je Wurzel (Lanes ohne sichtbaren Parent); bleibt ein Agent durch
  den Statusfilter ohne Parent, wird er selbst Wurzel statt zu verschwinden.
- Leerer Zustand: „Noch keiner in diesem Workspace“ + **Orchestrator starten**
  (derselbe Weg wie das Team-Panel: `hub orchestrator start --space <id>` plus
  `shared("orchestra.autostart")`). Filtert der Kopf alles weg, steht dort
  „Kein Agent in diesem Filter.“ mit „Alle anzeigen“.

## Daten und Scope

- `hub timeline --json --all` alle 15 s (keine zusätzliche Abfrage unter 5 s),
  Scope im Fenster wie in den Panels: Lanes ohne `space` bleiben sichtbar, sonst
  muss `ui.workspaceId(lane.space) === ui.workspaceId(activeSpace.id)` gelten.
  Tickets kommen aus `shared("orchestra.tickets")`, gefiltert mit `ui.inScope`.
- Zeiten werden im Mod auf Sekunden normalisiert (`sec()` wie in der Timeline);
  `hub timeline` liefert Millisekunden.
- Ticket-Knoten: ein Chip je Ticket, im ersten sichtbaren Agenten dieses Tickets.
  Sub-Agents tragen das Ticket nur als Text — sonst gäbe es zwei Chips je Ticket
  und doppelte Kanten.

## Kanten

- `dispatch`: Orchestrator-Karte unten → Agent-Karte oben.
- `parent`: Agent → Sub-Agent.
- `ticket`: `blocked_by` als dünner Bogen zwischen zwei sichtbaren Chips
  (Start rechts am Blocker, Ende rechts am wartenden Chip; andere Spalte: Ende
  links). Gestrichelt, wenn der Blocker-Ticket-Status `done` ist.
- Fehlt der Blocker im gescopten Ticket-Array (andere Fabrik/anderer Space) und
  ist er nicht erledigt, wird der Chip zu „wartet auf <Kürzel>“.
- Pfeilspitzen malt der Renderer aus der Richtung des letzten Kontrollpunkts;
  Hover auf einer Karte (oder ihrem Chip) hebt die eingehenden Kanten in `accent`.
- `mods/graph/layout.js` rechnet nur (keine App-Importe): Karten, Chips, Kanten
  als dieselben Segmente wie `mods/git-graph/lanes.js`. `edgeSegments(edge)`
  liefert `[x1, y1, c1x, c1y, c2x, c2y, x2, y2, dashed]`; der Renderer baut
  daraus `PathBuilder.stroke(...)` + optional `dash_array(...)` und malt mit
  `window.paint_path`. Koordinaten werden wie in `git-graph` mit
  `settings().zoom` multipliziert, weil `paint_path` nicht mitzoomt.

## Geometrie

`CARD_W 208 · CARD_H 70 · TICKET_H 18 · PAD 12 · GAP_Y 16 · GAP_X 32 ·
INDENT 16 · GUTTER 12` (Layout-Einheiten). Ticket-Chip in der Karte: `x+10`,
`y+42`. Spalten: `x = PAD + Spalte*(CARD_W+GAP_X) + Tiefe*INDENT`,
`y = PAD + Zeile*(CARD_H+GAP_Y)` (Zeile je Spalte, nicht global).

## Einbindung

- Block `factory` (Mod `graph`) in `layouts/elric.json`, direkt nach `timeline`.
  Der Block heißt **nicht** `graph`: den ids-Bereich `graph` belegt der Git-Graph.
- Tab-Leiste (`mods/tabs-graph`): Eintrag `factory` (Label „Fabrik“,
  `mods/graph/icon.svg`) mit Taste `7`. Team rückt auf `⌘⌥⇧7`
  (`key: null, chord: "⌘⌥⇧7"`), damit `⌘⌥7` den Fabrik-Graph öffnet.
- `keys.json` (`layout:elric`): `cmd-alt-7 → tabs-graph.panel-factory`,
  `cmd-alt-shift-7 → tabs-graph.panel-team`.
- Fenster: `mod.open:graph` (mod.json overlay, 760×760).
- Kommandos für Test und Tastatur: `graph.filter-all|working|blocked|done` und
  `graph.window-1h|24h|7d|all` (setzen dieselben Filter wie der Kopf und
  persistieren sie in localStorage).
- Status: `hub timeline` meldet für laufende Terminals oft nur `live` statt des
  Agent-Status; das Mod liest dann `status` aus `terminals()` (arbeitet/wartet/
  fertig/ruhig). Lanes ohne `start` (hc liefert kein `created_ms`) gelten im
  Zeitfenster als aktiv, solange sie arbeiten; sonst zählt ein Ereignis im Fenster.
- Cheatsheet: Panel-Name `factory`, Aktion `mod.open:graph`, beide in der
  Gruppe *Fabrik*.

## Tests

`node --test mods/graph/test/*.test.mjs` (Node 26: die Verzeichnisform
`node --test mods/graph/test/` löst dort keinen Lauf aus, auch nicht für
`mods/orchestra/test/`). Geprüft: Orchestrator oben + Dispatch-Kanten, eine
Spalte je Wurzel + Einrückung, Ticket-Bögen (gestrichelt bei erledigtem
Blocker), fremder Blocker als Chip, Sub-Agent-Fenster, Zeitfenster- und
Statusfilter, Kantensegmente, Determinismus.

## Screenshots (`/tmp/ui-graph/`)

`docs/ui-preview.sh up`, dann im Test-Home (nur Demo-Daten, keine Repo-Datei):

```sh
hub ticket set demo-1 terminal=t2 blocked_by=demo-4 \
  space=<demo-app-id> space_name=demo-app
hub ticket set demo-2 blocked_by=demo-3 space=… space_name=demo-app
hub ticket set demo-3 terminal=t3 blocked_by=demo-1 space=… space_name=demo-app
hub ticket set demo-4 terminal=t5 space=… space_name=demo-app
# Sub-Agent-Zeiten, die hub heute nicht aus agent-cards bekommt (siehe unten):
printf '%s\n' '{"id":"sa-search","title":"Suche nach Aufrufen","started":…,"ended":…,"terminal":"t1"}' \
  '{"id":"sa-tests","title":"Tests für quests","started":…,"terminal":"t1"}' > data/agent-cards/subagents.jsonl
hc run --bg --name orchestrator --label hub.role=orchestrator --label hub.space=<demo-app-id> \
  -- <test-home>/demo/agent.sh working omp "Orchestrator: verteilt Tickets"
```

Dann `do tabs-graph.panel-factory`, `do graph.filter-done` /
`graph.window-1h` für die Zustände, `do space.select --index 2` für den leeren
Workspace, `shot graph-full|graph-narrow|graph-done|graph-empty|graph-key`.
Ohne die Demo-Seeds zeigt der Graph nur die Lanes, deren Tickets einen
Terminal nennen.

## Bekannte Lücke (nicht in diesem Ticket lösbar)

`hub timeline` liest Sub-Agent-Zeiten aus Feldern `started`/`ended` in
`data/agent-cards/subagents.jsonl`; `mods/agent-cards/history.js` schreibt aber
`at` (Geburt) und `{kind: "end", at}` (Ende). Die Zeiten sind deshalb heute
leer. `mods/orchestra/bin/hub` ist für dieses Ticket tabu — im Ticket gemeldet.
Der Graph zeigt solche Sub-Agents ohne Zeitfenster-Prüfung (sichtbar, solange
der Parent sichtbar ist); `layout.js` kann `started`/`ended` bereits, sobald
die Daten sie liefern.
