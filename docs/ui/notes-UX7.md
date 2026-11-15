# UX 7: Sends per Adresse, Inbox-Zuordnung, Kosten, Scope-Normalisierung

Branch `feat/ux7-scope` (Basis `main`, 14d4807; davor d839495, auf den aktuellen `main` rebased). Acht Befunde aus dem Gesamt-Review.

## Was geändert ist

| # | Befund | Änderung |
|---|---|---|
| 1 | Auftrag/Rückfrage ging per Name `orchestrator` an den falschen Space | `mods/dashboard/main.js` sendet an `o.address`; die Inbox-Zeile des Orchestrators trägt `o.address` statt `ORCH` (`mods/inbox/main.js`), damit `screen`, `load` und `send` dieselbe Adresse nutzen. `mods/review/main.js` `tellOrchestrator(text, space)` wählt den Orchestrator über `hub.space`/`herdr.space` des Ticket-Workspace und sendet an seine Adresse; ohne bekannten Space bleibt der erste lebende (Alt-Home). |
| 2 | Dispatchte Agents fehlten in der Inbox ihres Workspace | `entries()` und `inboxCount()` ordnen einen Agenten über `ui.agentWorkspace` zu: Ticket per `terminal` → Workspace des Tickets, sonst Herdr-Space normalisiert. Der Wegwerf-Agent-Space zählt nicht mehr. |
| 3 | Stoppen in A wurde durch Starten in B rückgängig gemacht | `orchestra.autostart.<spaceId>` je Workspace (`mods/orchestra/orchestrator.js` `autostartKey`/`setAutostart`/`autostart`, Dashboard-Start, Team-Panel). Fehlender Eintrag = an. |
| 4 | `costSplit` verlor den Orchestrator eines Space ohne Label | Der `""`-Eintrag aus `costs.json` zählt einmal für den eigenen Workspace — wie der alte eine `orchestrator`-Wert (`mods/dashboard/spaces.js`). |
| 5 | Kosten-Tooltip: Plural/Aufschlüsselung an Ticket-Anteilen | `costSplit` liefert `orchParts` (nur Spaces mit `per[sid] > 0`, inklusive `""`); der Tooltip nennt „Orchestrator/Orchestratoren“ nach deren Anzahl und je Space den Anteil. |
| 6 | Inbox-Kopf-Gleichung stimmte nicht | `inboxNote(list)` zählt jede Gruppe einmal (Rückfragen, Fragen, Abnahmen, fertig, arbeitet/unterwegs) und der Tooltip benennt sie; die Summe ist `list.length`. |
| 7 | Quests-„unterwegs“ überschritt die Workspace-Grenze | `quests.pending[].space` = Workspace des sendenden Fensters (Dashboard, Launcher, Quests-Übergabe); `entries()` zeigt fremde Spaces nicht, Alt-Einträge ohne `space` bleiben sichtbar (wie Alt-Tickets). |
| 8 | Panels normalisierten Agent-Spaces nicht | `mods/orchestra/ui.js` (Master) hat `ticketWorkspace`, `workspaceId` und `agentWorkspace`; `inScope` vergleicht normalisierte IDs. `orchestrator.spaceId()` normalisiert ebenfalls. Alle elf `mods/*/ui.js` sind byte-identisch. |

## Verträge

- **Senden.** Ziel ist immer die Terminal-Adresse aus `hub spaces`/`terminals()`, nie der Name. Alte Home ohne Space-Labels: erster lebender Orchestrator nur, wenn der Space unbekannt ist.
- **Autostart.** Schlüssel `orchestra.autostart.<spaceId>`; `spaceId` ist der Workspace (Agent-Space → Workspace seines Tickets). Fehlt der Schlüssel, startet der Orchestrator. Der alte globale Schlüssel `orchestra.autostart` wird nicht mehr gelesen.
- **Agent-Space → Workspace.** Wie `hub spaces`: ein Ticket mit `space` **und** `space_name` ist ein Workspace und bleibt einer; sonst nennt `agent_space` das Ticket, in älteren Auslieferungen ein Terminal mit `hub.ticket`; ohne beides bleibt die Space-ID. Ticket-Workspace ohne `space_name` fällt auf `repo` im Space-Ordner zurück (wie `mods/dashboard/spaces.js`).
- **Unterwegs.** `quests.pending[]` trägt `space` (Workspace-ID). Einträge ohne `space` sind Altbestand und erscheinen überall.

## Tests

```text
node --test mods/orchestra/test/scope.test.mjs mods/dashboard/test/spaces.test.mjs mods/dashboard/test/waits.test.mjs
```

38 Tests grün. Neu: `scope.test.mjs` (Agent-Space-Normalisierung, `inScope`, Orchestrator-Fund, Inbox-Zuordnung und -Zähler, Unterwegs-Filter, Kopf-Gleichung, Autostart je Space) und zwei Fälle in `spaces.test.mjs` (`""`-Orchestrator, `orchParts`).

`herdr-app check mods/{dashboard,inbox,orchestra,board,timeline,quests,launcher,status-bar,teams,review,toast-review}`: elfmal `check passed`; alle `mods/*/ui.js` byte-identisch (`md5` eine Zeile).

## Testfenster

`docs/ui-preview.sh` (Test-Home `~/.herdr/ui-preview/feat-ux7-scope`, eigener Core, Demo-Welt), `errors: []`. Zwei zusätzliche Workspaces `Torte` und `Sauerteig` mit je eigenem Orchestrator (`t10`, `t11`) und ein dispatchtes Ticket (`sauerteig-testkarte-fur-inbox`, Agent `t12`, Agent-Space `spc0b6…`).

| Beleg | Inhalt |
|---|---|
| `/tmp/ui-fix7/dashboard-sauerteig.png` | Dashboard im Sauerteig-Space: Workspaces-Karte, Team, Fabrik, Kosten |
| `/tmp/ui-fix7/inbox-sauerteig-dispatch.png` | Inbox in Sauerteig: Zeile „Yuki 107 … Sauerteig: Testkarte für Inbox“ (Agent läuft im Wegwerf-Space) |
| `/tmp/ui-fix7/board-agent-space.png` | Board **im Agent-Space**: Kopf zeigt den Agent-Space, die Karte „Sauerteig: Testkarte für Inbox“ ist da (vorher leer) |
| `/tmp/ui-fix7/send-proof.txt` | Dashboard-`send()` (echter Codepfad, `hc` gegen den Test-Core): `["send","t11","Auftragsprobe UX7 …"]`; `setShared("quests.pending", [… "space": "sp0b8…"])` |
| `/tmp/ui-fix7/hc-read-t11.txt`, `hc-read-t7.txt` | Text steht auf `t11` (Sauerteig). `t7` (Name `orchestrator`) hat ihn nicht; `hc send orchestrator "ALT-UX7…"` landet auf `t7` — der alte Weg. |
| `/tmp/ui-fix7/hc-ls.json` | Adressen und Namen der Orchestratoren im Test-Core |

Fenster danach mit `docs/ui-preview.sh down` beendet.

## Offen

- `mods/tabs-graph/main.js` führt eigene Kopien von `inScope`/`inboxCount`; das Mod lag außerhalb der Grenzen dieses Tickets und vergleicht Agent-Spaces weiter roh. Eigenes Ticket.
- Der Dashboard-Auftrag wurde über den echten `send()`-Codepfad mit dem Test-Core belegt (Datei-Beweis); ein Tastatur-Eingabekommando gibt es in `herdr-app do` nicht. Der Tooltip (5) ist über `costSplit` getestet, nicht per Hover aufgenommen.
- Ein Home mit altem globalem `orchestra.autostart: false` startet nach dem Update wieder (fehlender Per-Space-Eintrag = an).
