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
| `spaceChip(t, { maxW })` | Ruhiger Chip „<Space-Name>“ (h 18, Tooltip „Fabrik dieses Workspace“); der Name kürzt sich, `maxW` (Standard 140) hält ihn schmal. |

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
- Kopf: der Space-Chip sitzt vor der Stufenzeile; sein Platz wird der Stufenzeile abgezogen
  (`stages(t, counts, reserve)`). Reicht der Platz nicht (z. B. 400 px Panelbreite), zeigt die
  Leiste nur Zähler (`1 · 2 · 0`), nie ein abgeschnittenes Wort. Die Krone am
  Orchestrator-Terminal aus `notes-ORCH-MARK.md` bleibt unverändert.
- Die Budgetzeile (`$3/Ticket`, `Team $x / $y`) zeigt die Kosten der Fabrik dieses Workspace
  (offene Tickets + Orchestrator); der Tooltip nennt die Gesamtsumme des Hauses. Der Klick
  ändert weiter das eine Budget des Hauses.
- Der Abschnitt **Teams** folgt dem Workspace: Ein Team mit `space` erscheint nur dort, sonst
  entscheidet der Space seiner Mitglieder (Agent bzw. `hub.space`/`herdr.space`-Label des
  Terminals). Sind alle Mitglieder beendet und kein Space mehr feststellbar, bleibt das Team
  sichtbar; Bearbeiten (Beobachten, Auflösen) schreibt immer die ganze Liste, nicht nur die
  sichtbaren Teams. Der Launcher schreibt den Space beim Start in die Gruppe.

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

**Launcher** (`mods/launcher`, `⌘⇧N`) — `orchestrator()` nimmt nur den Terminal des aktiven
Workspace (`hub.role=orchestrator` und `hub.space`/`herdr.space` = aktiver Space, Name
`orchestrator[-<space>]`). Der Dialog öffnet auf „Ans Team“; ohne Orchestrator zeigt er den
Satz „Kein Orchestrator in diesem Workspace (<Name>). Starte ihn hier — oder starte selbst.“
und als Primärknopf **Orchestrator starten** (`hub orchestrator start --space <id>`,
derselbe Weg wie das Team-Panel). Gesendet wird per `hc send <address>` an genau diesen
Terminal, nie per Name an einen fremden. Ein Home ohne Space-Labels behält den einen
namenlosen Orchestrator.

**Tab-Leiste** (`mods/tabs-graph`) — der Inbox-Zähler zählt die Fabrik des aktiven Workspace
(Agents, wartender Orchestrator, Review-Tickets); der Tooltip nennt Space und Gesamtsumme
(„Inbox · Beta: 1 warten in diesem Workspace · gesamt 3“). Das Modul hält seine Tokens selbst,
deshalb steht die kleine Scope-Regel dort lokal (gleiche Regel wie `ui.inScope`).

**Dashboard** (`mods/dashboard`) — nicht Teil dieses Tickets; es liest `shared("orchestra.stats")`
und `orchestra.costs`, die jetzt pro aktivem Space gefüllt werden. Die Karten selbst sind
unverändert.

## Prüfung

```sh
docs/ui-preview.sh up            # Test-Home + Fenster
docs/ui-preview.sh sync          # Worktree-Änderungen (Mods laden live neu)
# zwei Spaces mit je eigenen Tickets (die Demo-Tickets bleiben Altbestand):
docs/ui-preview.sh do space.new --folder "$T/demo/repo" --name Alpha --tab shell
docs/ui-preview.sh hub ticket new --title "Alpha: …" --repo "$T/demo/repo" --space Alpha
docs/ui-preview.sh hub spaces --adopt --yes        # Altbestand per Repo übernehmen
docs/ui-preview.sh hub orchestrator start --space Alpha
# Kopf bei 400 px: Chip sitzt vor der Stufenzeile, die dann nur Zähler zeigt
docs/ui-preview.sh do layout.resize --id panel --px 400
# Auftrag ohne Orchestrator (Space Gamma): Dialog bietet „Orchestrator starten“
docs/ui-preview.sh do mod.open --name launcher
```

Belege in `/tmp/ui-space/`: `alpha-{board,timeline,team,inbox,quests}`, `beta-{…}`,
`gamma-team` (Space ohne Orchestrator: leerer Zustand mit „Orchestrator starten“),
`gamma-auftrag` (Launcher ohne Orchestrator: Start statt fremdem Senden) und
`beta-team-400` (Panel auf 400 px: Stufenzeile nur Zähler, nichts abgeschnitten). Alpha zeigt
sechs Tickets ($2.87 Team), Beta zwei ($0.41 Team), Gamma null; Board, Timeline, Team, Inbox,
lokale Quests-Liste und der Inbox-Zähler der Tab-Leiste wechseln mit dem Space im selben
Fenster. Das Team „UI-Umbau“ (Agents im Space `demo-app`) erscheint in Alpha und Beta nicht
mehr.

`herdr-app check` (über `docs/ui-preview.sh check <mod>`) ist für alle elf Mods mit `ui.js`
sowie `tabs-graph` grün; `errors: []`; alle `mods/*/ui.js` byte-identisch.
