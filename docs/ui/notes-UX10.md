# UX 10: Worktree-Gruppierung, Agent-Titel, Fabrik-Kapsel, ui.js-Sync

Notizen zu den fünf Punkten aus dem Gesamt-Review (`ux-10-worktree-gruppierung-saubere-agent`).
Geänderte Dateien: `mods/space-folders/main.js`, `mods/agent-cards/main.js`,
`mods/tabs-graph/main.js`, `mods/quests/main.js`, `mods/orchestra/ui.js` (und über
`mods/orchestra/bin/sync-ui` alle elf Kopien), `.herdr/verify.sh`.

## 1. Agent-Worktrees unter ihrem Workspace (`mods/space-folders`)

`ordered()` kannte bisher nur Git: ein `linked` Worktree verschwand unter den Space
seines Repo-Checkouts. Sitzt der Workspace selbst in keinem Checkout (der
Orchestrator in `~/.herdr/orchestrator`), blieb der Agent-Worktree oben stehen —
`F feat-graph` neben `orchestrator`.

Neu entscheidet zusätzlich das Ticket (`parents()`):

- Eine Zuordnung `agent_space → space` aus `shared("orchestra.tickets")` hängt den
  Agent-Space unter den Workspace-Space, sobald beide Spaces in der Liste stehen.
- Ältere Auslieferungen ohne `agent_space` werden über ein Terminal mit Label
  `hub.ticket` erkannt: dessen Space gehört zum `space` des Tickets.
- Space-IDs werden über `localId` verglichen, damit ein `machine:sp…` aus
  `spaces()` und eine unqualifizierte ID aus dem Ticket zusammenfinden.
- Git bleibt der zweite Weg (Worktrees unter dem ersten Space ihres Repos); ein
  Space behält genau einen Platz, den des Tickets. Eine Ebene nur: ein Parent,
  der selbst unter etwas hängt, bleibt stehen — ein Ticket-Paar, das sich
  gegenseitig nennt, kann so keine Zeile verschlucken.

Kinder erben Ordner und Einrückung wie bisher: `├─` / `└─`, Tooltip und Klick
unverändert.

## 2. Terminal-Titel ohne Programm-Marke (`ui.plain`, `agent-cards.clean`)

`π` ist ein Buchstabe, deshalb ließ der alte Ausdruck `^[^\p{L}\p{N}]+` (agent-cards)
`π > 🍞 HUB: Orchestrate…` stehen. Jetzt fällt zuerst ein Präfix weg:

```
^(\s*(?:[π✳✦●▪▸>]|[\uE000-\uF8FF\u{10000}-\u{10FFFF}])\s*)+
```

Danach entfernt `ui.plain` wie bisher die Nerd-Font-Icons und Emoji im Text, und
`agent-cards` schneidet übrig gebliebene Satzzeichen vor dem ersten Wort ab. Die
Karten-Zeile ohne Tab (`a.title`) läuft ebenfalls durch `clean()`; damit steht in
der Sidebar `HUB: Orchestrate…` statt `π > 🍞 HUB: Orchestrate…` — auch im
Inbox-, Review- und Dashboard-Pfad, die `ui.plain` benutzen.

## 3. Host-Brücken-Cache und ui.js-Sync (`mods/orchestra/ui.js`, `.herdr/verify.sh`)

`spaces()`, `terminals()` und `panes()` kopieren bei jedem Aufruf die ganze Liste
nach JS. Ein Rendern fragt sie aber aus `activeSpace()`, `workspaceId()`,
`inScope()`, `isOrchestrator()`, `identity()` und den Gate-Chips mehrfach.

- Kurzer Tick-Cache (25 ms): `hostSpaces()`, `hostTerminals()`, `hostPanes()`
  liefern im selben Pass denselben Satz Kopien; ein Wechsel zeichnet neu und der
  nächste Pass liest frisch.
- `paneSpaceOf(address)` baut einmal je Tick die Map Terminal → Space über den Tab
  in `panes()`. Fehlt der Tab, fällt `workspaceId` wie bisher auf `terminal.space`
  bzw. das Label `herdr.space` zurück.
- `mods/orchestra/bin/sync-ui` kopiert die Quelle in alle anderen `mods/*/ui.js`.
- `.herdr/verify.sh` prüft (a) 12 byte-identische `ui.js`, (b)
  `python3 -m py_compile mods/orchestra/bin/hub`, (c) `node --test` für Dashboard
  und Graph.
- `mods/dashboard/test/waits.test.mjs`: der `herdr`-Stub kennt jetzt `panes`,
  sonst lädt `dashboard/ui.js` nicht mehr.

## 4. Fabrik-Kapsel in der Kopfleiste (`mods/tabs-graph`)

Statt vier einzelner Fabrik-Knöpfe bündelt eine eigene Kapsel die vier Ansichten:
`[Fabrik: Team · Board · Timeline · Graph]`. Nur die im rechten Panel offene
Ansicht zeigt neben dem Icon ihren Namen; die anderen drei bleiben 22×22-Icons,
deren Tooltip Ansicht und Kürzel nennt (⌘⌥⇧7, ⌘⌥8, ⌘⌥0, ⌘⌥7). Quests und Team-Hub
behalten ihr eigenes Segment, die Werkzeuge ihres. Die Kapsel ist ein Segment
zweiter Ebene (gleicher Radius, eigener Rand) und trägt den ruhigen Text „Fabrik“.

`inScope()` und `inboxCount()` normalisieren Space-IDs wie `ui.workspaceId`:
`agent_space` eines Tickets zählt als dessen Workspace (ältere Auslieferungen über
das `hub.ticket`-Label), ein als Workspace genanntes Ticket bleibt Workspace.
Damit zählt der Agent-Worktree im Inbox-Badge zum Ticket-Workspace. Die
Ticket-Liste und die Terminals werden je Aufruf einmal gelesen, nicht je Ticket
und je Agent.

## 5. Quests: lokale Quelle (`mods/quests`)

Die lokale Quelle heißt in der linken Spalte und im Abschnittskopf
**Fabrik (lokal)** — nie zu verwechseln mit GitHub, Asana oder Trilium. Ist sie
gewählt (`only === "plain"`), steht im Kopf der kleine Knopf **Board öffnen**
(`run("tabs-graph.panel-board")`): derselbe Vorrat als Brett, ein Klick statt ⌘⌥8.

## Prüfen

```
.herdr/verify.sh                     # 12× ui.js, py_compile, 40 Node-Tests
herdr-app check mods/{space-folders,agent-cards,tabs-graph,quests,orchestra}
docs/ui-preview.sh up && docs/ui-preview.sh shot …
```

Vorschau-Szenario für die Einrückung: Space `orchestrator` in einem Ordner ohne
Git-Checkout, Space `feat-graph` in einem Worktree von `demo/repo`, Ticket mit
`space: <orchestrator>`, `space_name: orchestrator`, `agent_space: <feat-graph>`
— `feat-graph` steht dann unter `orchestrator` mit `└─` und `feat/graph`, obwohl
Git allein dort nichts einrücken würde. Screenshots: `/tmp/ui-ux10/` (01 Spaces,
02 Agents, 03 Kopfleiste mit Kapsel, 07 Board als aktive Kapsel-Ansicht).
