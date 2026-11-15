# Orchestrator-Kennzeichnung

Ein Zeichen für den Orchestrator dieses Workspace, überall gleich. Ruhige Anzeige
(`shared("ui.calm")`, Standard an): das Zeichen ist statisch, keine Animation.
Ticket: `orchestrator-kennzeichnung-tab-space-und`.

## Zeichen

| Teil | Wert |
|---|---|
| Icon | `mods/orchestra/orchestrator.svg` (Krone, Lucide-Stil wie `mods/workspace-chrome/`) |
| Farbe | `t.accent` aus dem Theme; kein eigener Hex-Wert |
| Badge | „Orchestrator“ (10,5 px, `t.accent`, Rand `t.accent`, Grund `t.chrome`) |
| Tooltip | „Orchestrator dieses Workspace“ |

Das Icon liegt bei `mods/orchestra` und wird von den anderen Mods über den Pfad
gelesen — Mods dürfen Assets fremder Mods zeichnen (`mods/workspace-chrome/*.svg`
ist die bestehende Regel).

## Erkennung

Ein Terminal ist Orchestrator, wenn es lebt und `labels["hub.role"] ==
"orchestrator"` trägt; Rückfall ist der Terminalname `orchestrator`. Dieselbe
Funktion steht wortgleich in `tabs-graph`, `space-folders` und `agent-cards`:
`orchestration()` liefert die Adressen, Tab-Ids und Space-Ids.

```js
const live = terminals().filter((x) => x.state === "live"
  && (x.labels?.["hub.role"] === "orchestrator" || x.name === "orchestrator"));
const tabOf = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p.tab]));
```

Tab und Space kommen aus `panes()` (Terminal → Tab) und `spaces()` (Tab → Space),
nicht aus `where`-Namen: Namen sind nicht eindeutig. Ein Space „ist“
Orchestrator-Space, sobald ein lebender Orchestrator-Terminal in einem seiner Tabs
läuft. Ein detached Orchestrator (kein Tab, z. B. der geheime
`orchestra/orchestrator.js`-Terminal) markiert keinen Space.

Hinweis: `hub.space=<space-id>` (Space-Orchestrator) entsteht parallel in
`feat/space-hub`; diese Erkennung braucht es nicht und funktioniert mit ihm, sobald
der Orchestrator in einem Tab des Space läuft.

## Flächen

| Fläche | Mod | Umsetzung |
|---|---|---|
| Tab-Leiste | `mods/tabs-graph` (Klon von `tabs`) | Krone statt Programm-Glyph, Akzent-Rand auch inaktiv, Tab-Anzeige immer ganz links (Modell unverändert), kein Schließen-Knopf am aktiven Orchestrator-Tab, Ziehen wählt nur |
| Spaces | `mods/space-folders` (Klon von `spaces`) | Krone rechts neben dem Namen; auf der Leiste Akzent-Ziffer und Tooltip |
| Agents-Liste | `mods/agent-cards` (Klon von `agents`) | Krone statt Programm-Icon, Badge „Orchestrator“, Karte zuoberst in ihrer Gruppe; Kinder bleiben eingerückt |
| Team-Panel | `mods/orchestra/hubview.js` | Krone + Titel „Orchestrator“ in der Orchestrator-Karte, Tooltip; keine Logik |
| Timeline | `mods/timeline` | Krone vor dem Lane-Namen, wenn `lane.kind === "orchestrator"` |

Die Ticket-Namen `tabs`, `spaces`, `workspace-chrome` sind die ausgelieferten Mods
(ignoriert, werden beim Start überschrieben). Geändert werden die getrackten Klone
`tabs-graph`, `space-folders`, `agent-cards`; `workspace-chrome` braucht keine
Änderung, weil das Icon in `mods/orchestra` liegt.

## Prüfen

```sh
docs/ui-preview.sh sync
for m in tabs-graph space-folders agent-cards orchestra timeline; do docs/ui-preview.sh check $m; done
docs/ui-preview.sh shot orch-tabs
```

Screenshots unter `/tmp/ui-orch/` (Vergrößerungen der Ausschnitte). Ruhige Anzeige
bleibt an; es gibt keine Animation.
