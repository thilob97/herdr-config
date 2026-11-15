# UX 4: Namen für beendete Agents, kein Terminal-ID-Chip, ⌘⇧0 in Fabrik

Drei Unebenheiten aus dem Live-Fenster (`/tmp/live-board-3.png`): Board-Karten zeigten
für beendete Agents die rohe Adresse („t3z"), weil `shared("agents.identity")` nur die
lebenden Agents enthielt; `⌘⇧0` („Dashboard zeigen") stand unter „App und Layouts"
statt in **Fabrik**.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/agent-cards/main.js` | `publishIdentity` baut `agents.identity` aus **allen** bekannten Avataren, nicht nur den lebenden Agents |
| `mods/board/ui.js` | `identity()` fällt nicht mehr auf die Adresse zurück; `identityChip()` gibt es nur mit Name oder Programm-Kürzel |
| `mods/board/card.js` | `whoChip`: veröffentlichter Name (auch beendet) > Ticket-Name > Agentenname > Programm-Kürzel; sonst kein Chip; `agent`-Befehle zählen nicht als Name |
| `mods/orchestra/hubview.js` | dieselbe Chip-Regel im Team-Panel; aus `tk.agent` nur das Programm-Kürzel, nie der Befehl |
| `mods/cheatsheet/main.js` | `layout.switch:dashboard` in der Gruppe **Fabrik** |
| `docs/ui/notes-UX4.md` | diese Notizen |

## Verhalten

- **Identität.** `this.avatars` (localStorage) hält `{n, name, at}` und jetzt auch
  `program`. `publishIdentity` schreibt daraus bis zu 300 Einträge, neueste zuerst,
  nach Adresse sortiert; nur bei Änderung. Ein beendetes Terminal behält seinen Namen
  sieben Tage (so lange räumt `assignAvatars` auf). `program` kommt vom lebenden Agent,
  sonst aus dem gespeicherten Wert, sonst `null`.
- **Board-Karte.** Mit veröffentlichtem Namen steht der Identitäts-Chip (Avatar, Name,
  bei beendetem Terminal „(beendet)", gedämpft). Ohne veröffentlichten Namen zählt
  `agent_name`/`assignee`, dann ein Roster-Name in `agent`; ein Programm/Kommando
  (`omp`, `omp --model=…`) wird zum kleinen gedämpften Kürzel `omp`. Ohne all das fehlt
  der Chip — nie die Adresse.
- **Team-Panel.** Gleiche Reihenfolge; `tk.agent` ist dort meist ein Befehl und liefert
  nur das Programm-Kürzel.
- **Tastenkürzel.** `⌘⇧0` steht in **Fabrik**, zusammen mit Board, Timeline, Quests und
  Team-Hub.

## Prüfung

- `herdr-app check` im Test-Home (`docs/ui-preview.sh check`): `agent-cards`, `board`,
  `orchestra`, `cheatsheet` — je `check passed`.
- Testfenster `feat-ux4`: `errors: []`; nach einem Fenster-Neustart (Test-Home bleibt)
  enthielt `shared("agents.identity")` 76 Einträge, darunter die beendeten Demo-Agents
  `t1` („Byte 71", zuvor `omp`) und `t3` („Riff 73", zuvor `pi`) — und `t3z` („Dash 65")
  aus der Live-Historie. Zuvor waren es nur die fünf lebenden Agents.
- `grep` über die geänderten Chip-Stellen: kein `?? address`/Adress-Fallback mehr in
  `identity`, `identityChip` oder `whoChip`.
- Testfenster danach `down`.
- Belege unter `/tmp/ui-ux4/`:
  - `board-dead-name.png` — DEMO-2 mit beendetem Agent, Chip „Byte 71 (beendet)";
    DEMO-1 „omp" klein/gedämpft.
  - `board-unknown.png` — DEMO-3 mit unbekanntem Terminal `t9z`: kein Chip, keine
    Adresse.
  - `team-panel.png` — Team-Panel: DEMO-2 „Byte 71", DEMO-1 „omp", DEMO-3 ohne Chip.
  - `cheatsheet.png` — Fabrik beginnt mit „⌘⇧0 Dashboard zeigen".

## Grenzen

- Nur `mods/board/ui.js` trägt die neue Chip-Regel; die übrigen `ui.js`-Kopien und
  `mods/orchestra/main.js` (Team-Gruppen) liegen außerhalb dieses Tickets und bleiben
  unverändert. Für unbekannte Adressen außerhalb von Board und Team-Panel kann dort
  weiterhin der Adress-Fallback stehen.
- `agent-cards` vergisst Avatare nach sieben Tagen; länger beendete Agents verlieren
  ihren Namen wieder.
- Kein Push.
