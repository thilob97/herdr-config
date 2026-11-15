# Notizen MULTI: mehrere Orchestratoren — Identität, Besitz, WIP, Schreibsperre

Branch `feat/multi-orch` (Basis `main`). Ein App-Home, mehrere Orchestratoren, je an
einem eigenen Projekt. `mods/orchestra/bin/hub` trennt sie; Board und Dashboard zeigen
den Besitzer später (keine UI-Änderung in diesem Ticket).

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | `orchestrator_id()` (Umgebung zuerst), `whoami`, Feld `owner`, Besitzerfilter in `status`/`stalls`/`night`/`stats`/`cleanup` (je `--all`), `nudge --force`, WIP je Orchestrator (`mine`, `--all`, `--mine`), `hub_lock` um jede Lese-Änderungs-Schreib-Operation |
| `mods/orchestra/tickets.js` | Feld `owner` im Frontmatter (Serialisierung, kein UI-Verhalten) |
| `mods/orchestra/test/hub_multi_test.py` | Regressionstests: Identität, Besitz, Nacht, 20 parallele Kommentare, WIP je Orchestrator, `nudge --force` |
| `docs/ui/notes-MULTI.md` | diese Notizen |

## Zwei Orchestratoren starten

1. Zwei Herdr-Spaces anlegen, je einen davon für ein Projekt.
2. In jedem Space ein `omp` starten und als Prompt geben: „Du bist Orchestrator."
   (Ein Roster-Eintrag `orchestrator` mit Rolle und Prompt geht genauso.)
3. Beide Prozesse laufen mit demselben `HERDR_APP_HOME` (dasselbe App-Home). Nur so
   sehen sie dieselben Tickets, dasselbe Board und dieselbe Chronik.

Jeder Orchestrator bekommt von `hc` eine eigene Terminal-ID (`HC_TERMINAL_ID` im
Prozess, `hc get` bestätigt Rolle bzw. Namen `orchestrator`). Genau diese ID ist seine
Identität: `hub whoami` zeigt sie mit Name, offenen eigenen Tickets und WIP-Stand.
`hub ticket new` schreibt sie als `owner` ins Ticket.

**Reihenfolge der Identität**: zuerst `HC_TERMINAL_ID` aus der eigenen Umgebung (per
`hc get` bestätigt — Label `hub.role=orchestrator` oder Name `orchestrator`), dann das
erste gelabelte Terminal, dann das erste Terminal mit Namen `orchestrator`. Der
Umgebungsweg gewinnt, damit sich der zweite Orchestrator nicht dem ersten zuordnet;
`hc ls` allein wäre nicht eindeutig.

## Besitz und Standardsicht

- `owner` ist die Terminal-ID des Orchestrators, der das Ticket angelegt hat.
  `hub dispatch` ergänzt sie, wenn sie leer ist (alte Tickets, Importe).
- `status`, `stalls`, `night`, `stats` und `cleanup` zeigen standardmäßig nur eigene
  Tickets **plus besitzerlose** — alte Arbeit verschwindet nicht, fremde bleibt draußen.
  `--all` hebt den Filter auf; `hub status --all` zeigt weiterhin alles.
- `hub status` hat eine Spalte `Besitzer`; sie zeigt nur fremde Besitzer, `mensch` und
  leer bleiben `–`.
- `hub nudge` verweigert fremde Tickets ohne `--force` (die Meldung nennt den Besitzer).

## WIP je Orchestrator

`data/orchestra/wip.json` trägt weiter die Standardwerte `arbeit`/`pruefung` und
zusätzlich `per_orchestrator` (Standard `true`) sowie `mine: {<terminal-id>: {…}}`.
Gezählt werden nur eigene plus besitzerlose Tickets; fremde Arbeit blockiert nicht.

- `hub wip arbeit=4` setzt den Standard für **neue** Orchestratoren (und alle ohne
  eigenen Abschnitt).
- `hub wip --mine arbeit=2` schreibt nur den eigenen Abschnitt; erst dadurch entstehen
  `per_orchestrator: true` und `mine` in der Datei. Ein Home mit einem Orchestrator
  behält so die alte Zwei-Schlüssel-Datei — bestehende Leser und Tests bleiben gültig.
- `hub wip` zeigt die eigene Sicht (`n/limit`), `hub wip --all` die globale Summe über
  alle Orchestratoren.
- `--json` liefert die für den Aufrufer gültigen Limits als `{"arbeit": N, "pruefung": M}`.

## Schreibsperre

Jede Lese-Änderungs-Schreib-Operation läuft unter `fcntl.flock(LOCK_EX)` auf
`data/orchestra/.hub.lock`: `ticket set`, `ticket comment`, `ticket new`, `dispatch`
(schreibender Abschluss), `review`, `done`, `land`, `wip`, `memory`, `cleanup`-Schreiben,
`nudge` und jeder `events.jsonl`-Append samt Rotation. Die Sperre ist prozessintern
reentrant, damit ein Befehl sie einmal außen halten kann.

Sie wird **kurz** gehalten: kein Agentenstart, kein Netzaufruf, kein langes `git` darin.
Der Dispatch startet den Agenten deshalb außerhalb und liest das Ticket im gesperrten
Abschluss frisch; `review`/`done`/`land` rechnen vorher und schreiben nur ihre
Feldänderungen auf den frischen Stand. Timeout 10 s (`HUB_LOCK_TIMEOUT`), dann Exit 1
mit klarer Meldung — kein stiller Verlust.

Parallelität ist belegt: 20 gleichzeitige `hub ticket comment` auf dasselbe Ticket
ergeben 20 Einträge im Verlauf (`hub_multi_test.py`).

## Was geteilt bleibt

| geteilt | warum |
|---|---|
| Roster (`agents/roster.json`) | beide Orchestratoren dispatchen dieselben benannten Agents |
| Lehren (`<repo>/.herdr/lessons.md`) | hängen am Repo, nicht am Orchestrator |
| Gedächtnis (`agents/memory/<name>.md`) | geteilt, weil Agents über Projekte hinweg lernen |
| Kosten (`data/orchestra/costs.json`) | eine Abrechnung für das Home |
| Timeline (`data/orchestra/events.jsonl`) | eine Chronik; die Lane des Orchestrators ist die eigene Terminal-ID |

Getrennt sind nur Warteschlange (Besitz), WIP-Zähler und Schreibzugriff (Sperre).
