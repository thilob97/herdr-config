# CLEAN 2: Dashboard ohne Render-Last, Tasten beim Tippen, UX und toter Code

Das Dashboard liest die Host-Brücke einmal je Render statt je Zeile, lässt die
Auswahl-Tasten beim Tippen im Auftrag-/Antwortfeld in Ruhe und räumt Begriffe,
Spalten und toten Code auf. Geänderte Dateien: `mods/dashboard/main.js`,
`mods/dashboard/spaces.js`, `mods/dashboard/tickets.js`,
`mods/dashboard/test/render-count.test.mjs`, `mods/dashboard/test/keys.test.mjs`,
`docs/ui/notes-CLEAN2.md`.

## 1. Render-Last (`main.js`)

`snapshot()` läuft am Anfang von `render()` und liest je Render genau einmal:
`dashboard.spaces`, `spaces()`, `orchestra.spaces` (aus `this.spaceRows`),
`orchestra.tickets`, `agents()`, `terminals()`, `omp.subagents`,
`orchestra.costs`, `orchestra.budget`, `orchestra.groups`,
`orchestra.stats`, `attention.since`, `agents.identity`. Daraus entstehen die
Karten `ticketSpace`, `agentSpace`, `status`, `effective`, `openTickets` und
`tabName`; die Leser (`pick`, `selIds`, `ownSpaceId`, `spaceList`, `tickets`,
`costs`, `effective`, `statusOf`, `agentOfRole`, `where`, …) nehmen die
Momentaufnahme, solange sie gesetzt ist. Außerhalb eines Renders (Klick, Timer)
lesen sie weiter frisch. `render()` baut `waitsOnMe()` und `doing()` je einmal
und reicht beide an die Abschnitte; `activity()` und die Kostenkarte nutzen
dieselbe Momentaufnahme. Zusätzlich startet `ui.paneSpaceOf("")` den einen
Host-Satz, den `ui.js` für Identitäts-Chips ohnehin je Pass cacht.

Zähltest `mods/dashboard/test/render-count.test.mjs` (Stub zählt `agents`,
`terminals`, `spaces`, `shared`, `machines`; 76 Tickets, 6 Agents, 3 Spaces):
**37 Host-Aufrufe** je Render (Ziel < 100; vorher 1.621 laut Audit).

## 2. Tasten beim Tippen (`main.js`)

`typing()` prüft `dash-order` und alle `dash-answer-<adresse>`-Felder. `onKey`
behandelt zuerst `⌘↵` (senden) und `Esc` (Auswahl frei, Fokus zurück), kehrt
dann bei fokussiertem Feld sofort zurück (wie `board/main.js:387`). `j`, `k`,
`g`, `r` und `↵` erreichen die Auswahl nur ohne Feld im Fokus.
Test `keys.test.mjs`: j im Auftragsfeld, g w im Antwortfeld, ⌘↵ aus dem Feld,
j ohne Fokus, Esc aus dem Feld.

## 3. Fehler und UX

- `doingRow` zeigt `this.effective(live)` statt `live.status`.
- Budget-Ereignis: `stopAt(on)` liest nur den eigenen Stopp-Zeitpunkt (Zahl oder
  `{ at }`); `costs.at` ist der letzte Poll und wird nicht mehr als Stopp-Zeit
  ausgegeben. Fehlt der Zeitpunkt, steht das Ereignis ohne Zeit.
- Team-Spalten: fester Platz `COL_ACTION` (84) für „Zum Agent“ in Kopf und Zeile.
- Workspaces-Karte: fester Platz `COL_WS_ACTION` (148) für „Orchestrator
  starten“, auch wenn der Knopf fehlt — die Kostenspalte springt nicht mehr.
- Tooltips für abgeschnittene Texte: Review-Titel, Frage im Agenten-Kasten,
  Titel der Zeile „In Arbeit“.
- Begriffe: Layoutwechsel heißt „Arbeitsansicht“ (Kopfknopf + `⌘⇧0`), der
  Sprung zum Agenten „Zum Agent“, „elric“ steht in keinem sichtbaren Text,
  „ohne Workspace“ gilt überall (Team-Gruppe, Loses, Space-Name). Der doppelte
  Kopfhinweis `⌘⇧0 Workspace` ist gelöscht.
- Klick auf eine Fabrik-Stufe öffnet außer „Prüfung“ (Team-Panel in der
  Arbeitsansicht) das Board als Popup, statt das Layout zu wechseln.

## 4. Toter Code

- `spaces.js`: unbenutztes `isOn` gelöscht.
- `teamGroupHead`: lokale Rangliste durch `STATUS_RANK` ersetzt.
- `tickets.js`: Kommentar beschreibt den heutigen Stand — der Daemon läuft auch
  im Dashboard-Layout; die Dateien werden nur bei veraltetem Herzschlag gelesen.

## Prüfungen

- `node --test mods/dashboard/test/*.test.mjs`: 47 Tests grün (inkl. Zähltest
  und Tasten-Test).
- `sh .herdr/verify.sh`: grün (12 identische `ui.js`, `hub` kompiliert,
  61 Node-Tests).
- `herdr-app check mods/dashboard` im Test-Home: `check passed`.
- Screenshot: `/tmp/ui-clean2/dashboard.png` (Kopf mit „Arbeitsansicht“,
  ausgerichtete Team-Spalten, Workspaces-Karte mit fester Kostenspalte).
  Testfenster danach beendet, kein Push.
