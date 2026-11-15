# Panels zeigen nur den aktiven Workspace

Ticket `workspace-fabrik-2-panels-zeigen-nur-den`. Vertrag für Daten und CLI: `notes-SPACE.md`
(Ticket „Workspace-Fabrik 1“). Dieses Dokument beschreibt, was die Panels daraus machen.

## Der Helfer (eine Kopie in jedem `mods/<mod>/ui.js`)

Herdr lädt kein Modul über Mod-Ordner hinweg, deshalb liegt der Helfer als identische Kopie in
jedem `ui.js` (Master: `mods/orchestra/ui.js`; alle elf Dateien sind byte-identisch).

| Export | Bedeutung |
|---|---|
| `activeSpace()` | `{ id, name, folder, machine }` des aktiven Space aus `spaces()`, sonst `null`. |
| `inScope(ticket)` | Gehört das Ticket zur Fabrik dieses Workspace? |
| `spaceChip(t)` | Ruhiger Chip „<Space-Name>“ (h 18, Tooltip „Fabrik dieses Workspace“). |

`inScope` ist bewusst großzügig, damit kein Altbestand still verschwindet:

1. kein aktiver Space → `true` (nichts zu filtern);
2. Ticket ohne `space` → `true` (Altbestand vor dem Space-Modell);
3. `space` ist der aktive Space → `true`;
4. `space` trägt einen `space_name` (Ticket aus dem Space-Modell) → nur der eigene Space;
5. altes `space` ohne `space_name` (damals der Agent-Space) → `repo` liegt im Ordner des
   aktiven Space (oder es gibt keinen `repo`, dann `true`).

`spaces()` zeichnet die Mods bei jedem Wechsel neu. Ein Space-Wechsel braucht deshalb keinen
Neustart und keinen neuen Timer: die Panels vergleichen `activeSpace()?.id` im `render` mit dem
zuletzt gelesenen Space und lesen dann sofort neu (Board, Timeline), bzw. rechnen ihre Filter
ohnehin bei jedem `render` neu (Team, Inbox, Quests, Statusleiste).

## Was die einzelnen Mods zeigen

**Board** (`mods/board`) — liest weiter `hub ticket list --all --json` und filtert mit
`ui.inScope`: Alt-Tickets ohne `space` bleiben sichtbar, fremde Spaces nicht. `hub gates --json`
und `hub wip --json` bekommen `--space <id>` (ohne Space `--all`), damit Gates und WIP-Limits
zum selben Workspace gehören. Kopf: Chip mit dem Space-Namen.

**Timeline** (`mods/timeline`) — liest `hub timeline --json --all` und filtert Lanes und Events
über ihr `space`-Feld (Lanes ohne `space` bleiben). Kopf: Chip; das Fenster (`windowHeader`)
trägt ihn ebenso.

**Team-Panel** (`mods/orchestra`) — `HubSection.all()` filtert `shared("orchestra.tickets")` mit
`ui.inScope`; `orchestrator.js` sucht den Orchestrator schon per `hub.space`/`herdr.space` des
aktiven Space. `hub stats --json` und `hub gates --json` laufen mit `--space <id>`.

- Ohne Orchestrator im Space zeigt die Karte einen leeren Zustand: „Noch keiner in diesem
  Workspace (<Name>).“ und den Primärknopf **Orchestrator starten** (`orch.start()` ruft
  `hub orchestrator start --space <id>`). Ein fremder Orchestrator wird nie genommen.
- Die Eingabe der Karte ist immer sichtbar („Auftrag oder Antwort an den Orchestrator…“) und
  geht über `orch.send()` an genau diesen Orchestrator; wartet er, ist dieselbe Zeile die
  Antwort. Das ist der workspace-treue Auftrag im Panel.
- Behoben: `HubSection` las `subFresh` im ersten `publish()`, bevor es gesetzt war. Der Lauf
  warf, `publishing` blieb `true`, und das Panel zeigte für immer den alten Stand von
  `orchestra.tickets` (im Testfenster die Demo-Tickets). Jetzt steht `subFresh` vor dem ersten
  `publish()`; das Panel veröffentlicht seine Tickets wie im Kommentar beschrieben.

**Inbox** (`mods/inbox`) — Einträge kommen nur aus dem aktiven Space: Agents über `a.space`,
der wartende Orchestrator über sein `hub.space`/`herdr.space`-Label, Tickets und Fragen über
`ui.inScope`. Die Zähler im Kopf (`inboxCount()`) zählen diesen Space; der Tooltip nennt die
Gesamtsumme („Diesem Workspace: n wartend · gesamt m“). Kopf: Chip mit dem Space-Namen.

**Quests** (`mods/quests`) — nur die Quelle **Lokal** ist eine Fabrik-Liste; GitHub-, Asana-
und Trilium-Quests gehören keinem Workspace. `store.parseTicket` liest jetzt `space` und
`space_name` (und schreibt sie beim Bearbeiten zurück, `EXTRA`), `Board.matches` filtert lokale
Tickets mit `ui.inScope`. Kopf: Chip.

**Statusleiste** (`mods/status-bar`) — „Team $x / $y“ rechnet die Fabrik des aktiven Space:
Summe der Kosten offener Tickets dieses Space (`shared("orchestra.costs").tickets`) plus den
Orchestrator, wenn im Space einer läuft. Der Tooltip nennt die Gesamtsumme des Hauses. Ohne
Space bleibt es die Gesamtsumme.

## Nicht in diesem Ticket (Grenzen)

Diese Stellen zeigen weiter das ganze Haus; sie liegen außerhalb der Ticket-Grenzen:

- `mods/launcher` (`⌘⇧N`): `orchestrator()` sucht den Terminal mit Namen `orchestrator` im
  ganzen Haus. Mit dem Space-Modell heißen sie `orchestrator-<space>`; der Dialog findet dann
  keinen und bietet „Selbst starten“ an. Der workspace-treue Auftrag steht im Team-Panel.
- `mods/tabs-graph`: der Inbox-Zähler in der Tab-Leiste hat eine eigene Kopie der Zählung und
  zählt weiter das ganze Haus. Der Zähler der Inbox (Popup-Kopf) ist der gescopte.
- `mods/dashboard`: liest `shared("orchestra.stats")`, das jetzt pro aktivem Space gefüllt
  wird; die Dashboard-Karten selbst sind nicht angefasst.

## Prüfung

```sh
docs/ui-preview.sh up            # Test-Home + Fenster
docs/ui-preview.sh sync          # Worktree-Änderungen (Mods laden live neu)
# zwei Spaces mit je eigenen Tickets (die Demo-Tickets bleiben Altbestand):
docs/ui-preview.sh do space.new --folder "$T/demo/repo" --name Alpha --tab shell
docs/ui-preview.sh hub ticket new --title "Alpha: …" --repo "$T/demo/repo" --space Alpha
docs/ui-preview.sh hub spaces --adopt --yes        # Altbestand per Repo übernehmen
docs/ui-preview.sh hub orchestrator start --space Alpha
```

Belege in `/tmp/ui-space/`: `alpha-{board,timeline,team,inbox,quests}`, `beta-{…}` und
`gamma-team` (Space ohne Orchestrator: leerer Zustand mit „Orchestrator starten“). Alpha zeigt
sechs Tickets ($2.87 Team), Beta zwei ($0.41 Team), Gamma null; Board, Timeline, Team, Inbox und
die lokale Quests-Liste wechseln mit dem Space im selben Fenster.

`herdr-app check` (über `docs/ui-preview.sh check <mod>`) ist für `board`, `timeline`,
`orchestra`, `inbox`, `quests` und `status-bar` grün; `errors: []`.
