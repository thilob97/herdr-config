# Orchestrator-Erkennung, Agent-Spaces, Dashboard-Bereich

Ticket `workspace-fabrik-4-orchestrator-erkennun`. Nach dem ersten Lauf mit zwei
Orchestratoren (Space `orchestrator`, Space `Sauerteig-app`) zeigten `hub spaces` und
`hub orchestrator list` verschiedene Bilder, und die Wegwerf-Spaces der Agents standen
als Workspaces im Dashboard. Dieses Dokument beschreibt die eine Regel und was die
Oberfläche daraus macht.

Geändert: `mods/orchestra/bin/hub`, `mods/orchestra/test/hub_space_test.py`,
`mods/dashboard/main.js`, `mods/dashboard/spaces.js`, `mods/dashboard/test/spaces.test.mjs`.
`mods/dashboard/ui.js` bleibt unberührt.

## Eine Erkennung für beide Kommandos

`hc ls` liefert **keine Labels**. Ein Orchestrator-Terminal heißt `orchestrator` oder
`orchestrator-<space>` (so vergibt es `hub orchestrator start`); das ist der billige
Zeuge. `orchestrator_terminals()` liest den einen `hc ls --all`-Schnappschuss und
`is_orchestrator()` erkennt Name **oder** `hub.role=orchestrator`. `orchestrator_of()`
ordnet einen Terminal über `hub.space`/`herdr.space` (wenn Labels aus `hc get` kommen)
oder über die Terminal-Liste des Space zu.

Beide Ansichten benutzen dieselbe Funktion:

- `hub spaces --json` → je Space `orchestrator` und `live`.
- `hub orchestrator list` → für gelistete Spaces `orchestrator_of()`, danach nur noch
  Orchestratoren, deren Space das Fenster nicht mehr listet.

Nur der Name `orchestrator` reichte nicht: der zweite Orchestrator hieß
`orchestrator-sauerteig-app` und war damit in `hub spaces` unsichtbar, während
`orchestrator list` ihn über einen separaten `hc get`-Scan fand.

## Agent-Spaces sind keine Workspaces

`hub spaces` trägt je Zeile `kind: "workspace"|"agent"` und für Agenten
`workspace: <space des tickets>`. Zwei Zeugen, wie im Ticket verlangt:

1. das Feld `agent_space` eines Tickets,
2. ein Terminal mit Label `hub.ticket` in diesem Herdr-Space (ältere Dispatches).

Ein Space, der zugleich Workspace eines Tickets ist, bleibt Workspace; ein Space ohne
Tickets und ohne Orchestrator ebenfalls. Die Standardausgabe (Text und JSON) blendet
`kind: "agent"` aus; `hub spaces --agents` zeigt sie mit ihrem Workspace. Dieselbe
Liste liest das Dashboard (`--json --agents`) und filtert für Chips, Bereichswahl und
Workspaces-Karte auf `kind: "workspace"`.

Ein Ticket, das ein Team-Agent (Terminal mit `hub.ticket`) anlegt, erbt den Workspace
seines eigenen Tickets: `my_space()` prüft dieses Label **vor** `HERDR_SPACE`, damit der
Wegwerf-Space des Worktrees nicht in `space`/`space_name` des neuen Tickets landet.

## Dashboard

- **Chip-Reihe** und Karte **Workspaces** zeigen nur `kind: workspace`. „Dieser
  Workspace" bildet einen Agent-Space über dessen `workspace` auf den echten Workspace ab.
- **Team** und **Letzte Aktivität** filtern auf die Bereichswahl. `agentWorkspace()`
  nimmt das Ticket des Terminals (auch ein erledigtes); ohne Ticket zählt der
  Herdr-Space, ein Agent-Space über `workspace`. Ein Agent in einem Agent-Space zählt
  also zum Workspace seines Tickets.
- **Orchestrator starten** erscheint nur, wenn `hub spaces` für den eigenen Workspace
  wirklich `live: false` meldet (`canStart()`); ohne Antwort von hub erscheint der Knopf
  nicht. Der Orchestrator selbst kommt aus der Zeile (`orchestrator`-Terminal), nicht
  mehr aus dem ersten Terminal namens `orchestrator`.

## Nachweis

```text
python3 mods/orchestra/test/hub_*_test.py     # 8 Suiten, alle OK
node --test mods/dashboard/test/*.mjs         # 25 Tests, alle OK
herdr-app check mods/orchestra                # check passed
herdr-app check mods/dashboard                # check passed
```

Am echten Home (nur lesend): `hub spaces --json` nennt `orchestrator` mit `t2c`/live
und `Sauerteig-app` mit `t4t`/live; `feat-space-panels`, `feat-research-…` und
`feat-space-fix` sind `kind: "agent"` und erscheinen nur mit `--agents`.
`hub status` und `hub spaces` bleiben unter 0,3 s (0,11–0,17 s gemessen).

Screenshot: `/tmp/ui-space-fix/dashboard-space-fix.png` — zwei Workspaces
(`demo-app`, `demo-review`), beide „Orchestrator läuft"; ein zusätzlicher Agent-Space
(`feat-agent`) steht weder in der Chip-Reihe noch in der Workspaces-Karte.
