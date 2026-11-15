# Eine Fabrik je Workspace — der Space als Schlüssel

Ticket `workspace-fabrik-1-space-als-schlussel-i`. Dieses Dokument ist der Vertrag für die
Panel-Tickets: Datenmodell, Filter, JSON-Felder und Beispielausgaben stammen aus einem
Wegwerf-Home mit zwei Spaces (Alpha lokal, Beta mit Maschinenpräfix).

## Datenmodell

Ein Ticket trägt im Frontmatter:

| Feld | Bedeutung |
|---|---|
| `space` | stabile Space-ID, so wie `herdr-app ls` sie liefert (`sp…`, remote `maschine/sp…`) |
| `space_name` | Anzeigename zum Zeitpunkt des Anlegens |
| `owner` | Terminal-ID des Orchestrators, der es angelegt hat — nur noch Herkunft, nicht der Schlüssel |
| `agent_space` | der Herdr-Space, in dem der Agent des Tickets läuft (früher fälschlich `space`) |

**Altbestand:** Ein Ticket ohne `space_name` gilt als alt: sein `space` ist der damalige
Agent-Space und zählt nicht als Workspace. Es wird über `repo` dem Space zugeordnet, dessen
Ordner den Pfad enthält; ohne solchen Ordner bleibt es `space: ""` („ohne Workspace") und
ist **nicht** in einer Projekt-Fabrik sichtbar — nur mit `--all`, `--space ""` oder
`--space none`. `hub spaces --adopt --yes` schreibt `space`/`space_name` und rettet den
alten Wert nach `agent_space`; `hub spaces --adopt --to <id|name> --yes` ordnet auch die
per Repo nicht zuordenbaren Tickets einem Space zu.

## Wer bin ich, welcher Space ist meiner

`hub` leitet den eigenen Space so ab (erste Antwort gewinnt):

1. `HERDR_SPACE` (ID oder Name),
2. das eigene Terminal: `hub.ticket`-Label → Space des Tickets (Agenten erben ihn),
   sonst `herdr.space`/`hub.space`-Label,
3. der Space, dessen Ordner das aktuelle Verzeichnis enthält,
4. `""` — dann gilt die alte Besitzer-Sicht (`owner`, besitzerlos = überall sichtbar).

`orchestrator_id()` nimmt zuerst das eigene Terminal (Rolle `hub.role=orchestrator`) und
dann den Orchestrator **des eigenen Space** (`hub.space`-Label). Ein fremder Space wird nie
still genommen; ohne eigene Fabrik ist die ID leer.

## Filter

Überall gleich: ohne Angabe der eigene Space, `--space <id|name>` dieser, `--all` alle.
Betroffen: `ticket list`, `status`, `stats`, `stalls`, `wip`, `timeline`, `gates`,
`night`, `cleanup`, `ticket next|inbox`. Der Name wird case-insensitiv verglichen; ein
unbekannter Name bricht mit Liste ab, eine `sp…`-ID wird auch ohne laufendes Fenster
akzeptiert. `--space ""` und `--space none` wählen die Gruppe „ohne Workspace" (Alt-Tickets,
deren `repo` in keinen Space-Ordner fällt). Diese Gruppe erscheint in keiner Projekt-Fabrik;
`hub status` nennt sie in einer Fußzeile:

```text
60 Tickets ohne Workspace (hub spaces --adopt --to <space>)
```

`hub status --json` trägt dafür `"unassigned": 60` und `"unassigned_hint"`.

## JSON mit `space`/`space_name` je Eintrag

### `hub whoami`

```json
{
  "orchestrator": "t-orch-a",
  "name": "orchestrator",
  "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "space_name": "Alpha",
  "space_folder": "/tmp/hub-notes.Hxswce/repos/alpha",
  "tickets": 1,
  "wip": {
    "arbeit": { "limit": 3, "count": 1 },
    "pruefung": { "limit": 2, "count": 0 }
  }
}
```

### `hub ticket list --json` (je Eintrag)

```json
{
  "id": "tile-cache-im-board",
  "title": "Tile-Cache im Board",
  "status": "doing",
  "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "space_name": "Alpha",
  "owner": "t-orch-a",
  "agent": "Zap"
}
```

### `hub status --json`

```json
{
  "space": "spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "space_name": "Beta",
  "tickets": [
    { "id": "altes-ticket", "status": "todo",
      "space": "spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "space_name": "Beta",
      "owner": "t-orch-a" },
    { "id": "review-fenster-sortiert", "status": "review",
      "space": "spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "space_name": "Beta",
      "owner": "t-orch-a" }
  ]
}
```

(gekürzt auf die Space-Felder; jede Zeile trägt weiter alle Felder der alten Ausgabe.)

### `hub timeline --json` — Lanes und Events (gekürzt)

```json
{
  "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "space_name": "Alpha",
  "lanes": [
    {
      "kind": "orchestrator", "label": "orchestrator", "terminal": "t-orch-a",
      "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "space_name": "Alpha",
      "status": "live", "start": 1763000000000, "end": 1794754702918, "cost": 0.0,
      "events": []
    },
    {
      "kind": "agent", "label": "Moxie", "ticket": "tile-cache-im-board", "terminal": "t-a",
      "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "space_name": "Alpha",
      "status": "live", "start": 1763010000000, "end": 1794754702918, "cost": 0.0,
      "events": [
        { "kind": "status", "ticket": "tile-cache-im-board",
          "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "text": "doing" }
      ]
    }
  ],
  "events": [
    { "kind": "status", "ticket": "tile-cache-im-board", "terminal": "t-a",
      "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "text": "doing" }
  ]
}
```

`--all` liefert die Orchestrator-Lane je Space und alle Lanes/Events; `--ticket` bleibt
wie bisher ohne Orchestrator-Lane. `events.jsonl` trägt jetzt je Zeile `space` und
`space_name` (alte Zeilen werden über ihr Ticket zugeordnet).

### `hub stats --json` (gekürzt)

```json
{
  "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "space_name": "Alpha",
  "summary": { "tickets": 1, "done": 0, "median_min": null, "rounds": 0, "rework": 0, "cost": 0.0 },
  "tickets": [
    { "id": "tile-cache-im-board",
      "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "space_name": "Alpha", "status": "doing" }
  ]
}
```

### `hub stalls --json`

```json
[
  {
    "stage": "review", "stage_label": "Prüfung", "id": "review-fenster-sortiert",
    "title": "Review-Fenster sortiert",
    "space": "spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "space_name": "Beta",
    "agent": "", "age_minutes": 478, "age": "7 h",
    "nudge": "hub nudge review-fenster-sortiert", "threshold": 120
  }
]
```

`hub stalls` im Space Alpha liefert `[]` — die Stufe hängt in Beta.

### `hub wip --json`

```json
{
  "arbeit": 3,
  "pruefung": 2,
  "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "space_name": "Alpha"
}
```

(`space`/`space_name` erscheinen nur, wenn ein Space bekannt ist; ein Home ohne Spaces
behält die alte Zwei-Schlüssel-Ausgabe. `--mine` schreibt jetzt `mine[<space-id>]`;
alte `mine[<terminal>]`-Einträge werden weiter gelesen, der Space gewinnt.)

### `hub spaces --json`

```json
{
  "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "space_name": "Alpha",
  "spaces": [
    {
      "id": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "name": "Alpha",
      "folder": "/tmp/hub-notes.Hxswce/repos/alpha", "machine": "",
      "orchestrator": "t-orch-a", "live": true, "tickets": 1,
      "open": { "todo": 0, "doing": 1, "review": 0 }, "cost": 0.0
    },
    {
      "id": "spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "name": "Beta",
      "folder": "/tmp/hub-notes.Hxswce/repos/beta", "machine": "agentic-vm",
      "orchestrator": "agentic-vm/t-orch-b", "live": true, "tickets": 2,
      "open": { "todo": 1, "doing": 0, "review": 1 }, "cost": 0.0
    }
  ]
}
```

`cost` summiert `data/orchestra/costs.json` je Space; `orchestrator` ist leer, wenn dort
keiner läuft. Ein Space, den das Fenster nicht mehr listet, dessen Tickets aber `space`
tragen, erscheint mit leerem `folder` weiter.

### `hub orchestrator list --json`

```json
{
  "orchestrators": [
    { "space": "spaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "space_name": "Alpha",
      "folder": "/tmp/hub-notes.Hxswce/repos/alpha", "terminal": "t-orch-a",
      "name": "orchestrator", "agent": "omp", "live": true },
    { "space": "spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "space_name": "Beta",
      "folder": "/tmp/hub-notes.Hxswce/repos/beta", "terminal": "agentic-vm/t-orch-b",
      "name": "orchestrator", "agent": "omp", "live": true }
  ]
}
```

## Orchestrator je Space

`hub orchestrator start [--space <id|name>] [--agent <programm>] [--restart]`:

- cwd `~/.herdr/orchestrator` (dort gilt `AGENTS.md`), Regeln aus `mods/orchestra/orchestrator.md`;
- Labels `hub.role=orchestrator`, `hub.space=<id>` und `herdr.space=<id>` (der Terminal
  erscheint im Space);
- Start-Prompt nennt Space-Name, ID und Ordner;
- läuft dort schon einer, bricht es mit dessen Terminal und dem `--restart`-Hinweis ab;
  `--restart` beendet ihn (kill + wait) und startet neu.

`mods/orchestra/orchestrator.js` ruft genau dieses Kommando für den aktiven Space auf;
`find()`/`send()`/`screen()` suchen den Orchestrator über `hub.space`/`herdr.space` des
aktuellen Space. Ein Dashboard-Start (eigene Kopie in `mods/dashboard`) folgt in dessen
Ticket.

## Migration

```text
$ hub spaces --adopt
altes-ticket                             → Beta (spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)

$ hub spaces --adopt --to Beta
altes-ticket-ohne-ordner                 → Beta (spbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)
```

Ohne `--yes` wird nichts geschrieben; die JSON-Form nennt `dry_run: true` und je Ticket
`space`, `space_name`, `old_agent_space`. `--to <id|name>` fängt zusätzlich alle Tickets,
deren `repo` in keinen Space-Ordner fällt (sie bleiben sonst „ohne Workspace"). Es wird nie
etwas gelöscht, und nur `$HERDR_APP_HOME/data/quests/tickets` angefasst.

## Leistung

Ein hub-Aufruf holt die Space-Liste (`herdr-app ls`) und die Terminal-Metadaten
(`hc ls --all`) **je einmal** je Prozess, `hc get` höchstens für das eigene Terminal;
`repo → space` ist je Pfad gecacht. Timeline, Status und Sichten spawnen keinen
Subprozess pro Ticket, Lane oder Event.

Gemessen am echten Home (2026-11-15, ~75 Tickets, 4 Spaces, `/usr/bin/time -p`):

| Kommando | vor dem Space-Modell | nach dem Space-Modell (vor Cache) | jetzt |
|---|---:|---:|---:|
| `hub status` | 0.14 s | 2.04 s | 0.21 s |
| `hub timeline --json` | 0.26 s | 23.73 s | 0.20 s |
| `hub whoami` | — | 3.87 s | 0.23 s |
| `hub spaces` | — | 2.01 s | 0.18 s |

Der Test `test_timeline_reads_the_terminal_snapshot_once_for_fifty_tickets` schreibt 50
Tickets mit je einem Terminal und zählt die Stub-Aufrufe: `hub timeline --json` bleibt bei
höchstens 5 (`herdr-app ls`, `hc ls --all`, `hc get` für das eigene Terminal).

## Tests

`mods/orchestra/test/hub_space_test.py` (Wegwerf-Home, zwei Spaces, je ein Orchestrator):

- `ticket new` setzt `space`/`space_name`; `hub ticket new --space Beta` überschreibt.
- `status`, `timeline` (Lanes und Events), `wip`, `stalls` trennen die Spaces; `--all`
  zeigt beide; `--space <Name>` wählt einen.
- Neustart: neuer Orchestrator-Terminal im selben Space sieht die Tickets weiter.
- Alt-Ticket ohne `space_name` zählt per `repo` zum Space; „ohne Workspace" ist nur mit
  `--all`/`--space ""`/`none` sichtbar und steht als Fußzeile in `hub status`.
- `--adopt` schreibt im Dry-Run nichts, mit `--yes` `space`/`space_name` und rettet den
  alten Agent-Space; `--adopt --to Beta --yes` nimmt die Unzuordenbaren mit.
- Zweiter `orchestrator start` im selben Space verweigert mit Terminal und `--restart`;
  `--restart` startet mit allen Labels und dem Prompt.
- 50 Tickets mit 50 Terminals: `timeline --json` bleibt bei ≤ 5 Subprozessen.

Alle acht Suiten (`hub_bugs`, `hub_cleanup`, `hub_features`, `hub_multi`, `hub_race`,
`hub_space`, `hub_timeline`, `hub_wip`) sind grün; `herdr-app check mods/orchestra` läuft
durch.

## Offen für die Panels

- `mods/launcher` liest `tk.space` als Space des Tickets; das ist jetzt der Workspace
  (gewollt), für den Agent-Space gibt es `agent_space`.
- Board/Dashboard/Team zeigen den Space noch nicht; `hub status --json`, `hub spaces
  --json` und `hub timeline --json` liefern die Felder dafür.
- `mods/dashboard/main.js` startet den Orchestrator noch mit einer eigenen Kopie; es sollte
  `hub orchestrator start` aufrufen (wie `mods/orchestra/orchestrator.js`).
- `~/.herdr/orchestrator/AGENTS.md` liegt außerhalb des Repos. Dort gehören in den
  Abschnitt „Wer du bist" zwei Zeilen: der Space-Name samt ID und der Hinweis, dass
  `hub`-Kommandos ohne `--space` auf diesen Space filtern und `--all` alle zeigt.
