# Dashboard überlagert mehrere Workspaces

Ticket `workspace-fabrik-3-dashboard-uberlagert`. Vertrag von unten:
`docs/ui/notes-SPACE.md` (Space an Tickets, Lanes und Events; `hub spaces --json`;
`--space`/`--all`). Dieses Dokument beschreibt, was das Dashboard daraus macht.

Geändert: `mods/dashboard/main.js`, neu `mods/dashboard/spaces.js` (reine Regel) und
`mods/dashboard/test/spaces.test.mjs`. **Nicht** angefasst: `mods/dashboard/ui.js`
(gemeinsame Kopie aller Mods), `mods/orchestra/**` (kein `hub`).

## Kopf: Bereichswahl

Eine Chip-Reihe unter dem Titel, links das Wort „Bereich":

```text
Bereich   Dieser Workspace   ● Alpha   ● Beta   ● agentic-vm   Alle        Summe aus 2 Spaces
```

- **Dieser Workspace** (Vorgabe): der Space, den das Fenster zeigt (`spaces().active`),
  sonst der, den `hub spaces --json` als seinen meldet.
- **je Space ein Chip** mit Farbpunkt; mehrere an = Überlagerung.
- **Alle**: jeder Space, auch der, den das Fenster nicht mehr listet, und die Tickets
  ohne Workspace.
- Bleibt nach dem Abwählen eines Chips nichts übrig, gilt wieder „Dieser Workspace"
  (nie eine leere Fläche). Sind danach alle an, wird daraus „Alle".
- Die Wahl liegt in `shared("dashboard.spaces")` (`{ mode: "own"|"some"|"all", ids: [] }`)
  und steht damit auch nach einem Neustart.
- Die Reihe steht ab dem ersten bekannten Space (vorher gibt es nichts zu wählen). In einem
  Fenster mit genau einem Space führen alle drei Wege zum selben Bild — die *Zeilen*
  bleiben dort ohne Punkte und Namen („ruhig wie bisher").
- Tastatur: jeder Chip ist Tab-Stopp (`.tab_index`), ↵/Leertaste schaltet ihn; Fokus
  zeigt sich als `hover`-Fläche, der Tooltip nennt Space, Orchestrator und die Taste.

## Farben

`c1…c6` sind die Serienfarben der App, wie das Team-Panel sie für Agents nimmt
(`c1` accent, `c2` working, `c3` done, `c4` blocked, `c5` solid, `c6` muted). Der Hash der
Space-ID entscheidet; ist der Platz belegt, rückt der nächste freie nach. Damit trägt ein
Space überall denselben Punkt, zwei überlagerte Spaces nie denselben, und erst ab sieben
Spaces wiederholt sich die Reihe.

## Zeilen und Zahlen

- Bei **genau einem** gewählten Space bleibt alles wie bisher: keine Punkte, keine Namen.
- Bei **Überlagerung** trägt jede Zeile (`Wartet auf dich`: Abnahme, Rückfrage, Frage aus
  dem Verlauf; `In Arbeit`; `Stockt`) einen Chip aus Farbpunkt und Space-Name. Er ersetzt
  den früheren Chip „von \<owner\>": im Space-Modell sagt der Space, wem ein Ticket
  gehört, nicht mehr der Orchestrator-Terminal.
- Zuordnung eines Tickets: sein `space`, wenn es `space_name` trägt; ein Alt-Ticket (ohne
  `space_name`) gehört dem Space, dessen Ordner sein `repo` enthält; ohne Ordner bleibt es
  „ohne Workspace". Genau die Regel aus `notes-SPACE.md`, hier lokal nachgerechnet, weil
  das Dashboard keine hub-Module importieren darf.
- Ein Agent ohne Ticket zählt zu dem Space, in dem das Fenster steht; das ist die einzige
  Zeile, die keine Fabrik hat.
- `Fabrik` (Stationen, „In Arbeit"), `Stockt` und `Wartet auf dich` filtern auf die
  gewählten Spaces; die Stationen-Leiste zählt nur deren Tickets.
- **Messwerte** („Fabrik heute"): je gewähltem Space eine `hub stats --space <id>`-Abfrage,
  im Cache 30 s; die Karte zeigt die Summe (erledigt, Nacharbeit, Ticket-Kosten) und je Tag
  die Summe der sieben Balken. Der **Median** ist der Median der vereinigten erledigten
  Tickets — die Summe von Medianen wäre keine Kennzahl. Bei „Alle" ist es hubs eigene
  `stats --all`-Zahl. Tooltip: je Space „n erledigt · Median … · $…".
- **Kosten**: „Team offen" summiert die Ticket-Kosten der gewählten Spaces (`hub spaces`
  summiert sie je Space aus `data/orchestra/costs.json`) plus den Orchestrator
  (`costs.json` führt ihn einmal; er zählt, wenn sein Space gewählt ist) über das
  Team-Budget. Tooltip: je Space eine Zeile, dann der Orchestrator. „Heute" bleibt eine
  Zahl: der Kalendertag aus omp kennt keinen Space (steht so im Tooltip).
- „Letzte Aktivität" und „Team" bleiben unverändert: sie zeigen Menschen und Ereignisse,
  keine Fabrik-Zahlen.

## Karte „Workspaces"

Nur bei mehr als einem Space. Eine Zeile je Space: Farbpunkt, Name, Orchestrator-Zustand
(„Orchestrator läuft" mit Terminal im Tooltip / „kein Orchestrator"), offene Tickets je
Stufe (Geplant · In Arbeit · Prüfung), Ticket-Kosten.

- Klick auf die Zeile wechselt in den Space (`space.select {id}`); ein Space, den das
  Fenster nicht listet, ist nicht anklickbar.
- Läuft dort keiner, startet **Orchestrator starten** ihn: `hub orchestrator start
  --agent <shared "orchestra.agent" | omp> --space <id>` — derselbe Aufruf wie im
  Team-Panel. Regeln, Labels und Prompt schreibt hub; das Dashboard hat keine eigene Kopie
  des Starts mehr.
- Leere Zustände: ein Space ohne Tickets sagt „keine Tickets", ein Space ohne
  Orchestrator zeigt den Chip „kein Orchestrator" und den Start-Knopf.
- Fußzeile, still: „n Tickets ohne Workspace" (`hub spaces --adopt --to <space>`), wenn es
  welche gibt.

## Grenzen

- „Heute" (omp) und das Team-Budget sind global; nur die Ticket-Kosten lassen sich je
  Space belegen.
- Ein „Nachfragen" auf einer Zeile aus einem fremden Space ruft `hub nudge <id> --force`:
  der Mensch hat die Zeile in der Überlagerung angeklickt, hubs Wächter ist für Agents.
- Eine Mini-Timeline gibt es im Dashboard nicht (das Ticket sagt „ggf."); die Timeline
  bleibt im Team-Panel.
- Im Testfenster startet der Knopf den **echten** Agenten: `hub` kennt `programs.json`
  nicht (anders als die Mods). Zum Prüfen `hc kill <terminal>` hinterher oder den Start mit
  `hub orchestrator start --agent "<demo/agent.sh …>"` nachstellen.

## Nachweis

```text
$ docs/ui-preview.sh check dashboard        # im Test-Home, Mods aus dem Worktree
check passed: …/mods/dashboard
$ docs/ui-preview.sh status | jq .errors
[]
$ node --test mods/dashboard/test/spaces.test.mjs mods/dashboard/test/waits.test.mjs
# 21 Tests grün (11 Auswahl/Summen, 10 Wartet-Regel)
```

Screenshots in `/tmp/ui-space-dash/` (Test-Home, drei Spaces, Demo-Tickets mit
`space`/`space_name`; Fenster 1710×1010 bzw. 900 breit):

| Datei | Was |
|---|---|
| `01-ein-space.png` | „Dieser Workspace": keine Punkte, keine Namen |
| `02-zwei-ueberlagert.png` | zwei Spaces an: Farbpunkt + Name in Abnahme-, Rückfrage- und Stockt-Zeile |
| `03-alle.png` | „Alle": alle drei Spaces, Stationen 1/2/1/1 |
| `04-schmal-900.png` | dieselbe Überlagerung bei 900 px Breite |
| `05-fabrik-ueberlagert.png` | Überlagerung, herausgezoomt: „In Arbeit" mit Punkten, Messwerte als Summe, Kosten je Space |
| `06-alle-ohne-workspace.png` | „Alle": Stationen zählen das Alt-Ticket mit, die Karte nennt in der Fußzeile „1 Ticket ohne Workspace" |

Die Auswahl ist über `shared("dashboard.spaces")` gesetzt und jeweils mit einem
Fenster-Neustart gelesen worden — derselbe Weg wie „Auswahl bleibt erhalten".
