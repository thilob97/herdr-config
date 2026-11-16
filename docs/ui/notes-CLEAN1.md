# CLEAN 1: Panel-Fehler, Render-Last, toter Code

Ticket `clean-1-panel-fehler-render-last-toter-c`. Stand: 2026-11-16, Branch `feat/clean1`.

## Fehler

| # | Fix | Beleg |
|---|---|---|
| 1 | `ui.isOrchestrator(x)` statt `x.name === "orchestrator"` in `review/main.js` (`tellOrchestrator`) und `inbox/main.js` (Zähler + Eintrag); Space wie `orch.find()`: `hub.space`, dann `herdr.space`, dann `ui.paneSpaceOf`. | `mods/orchestra/test/scope.test.mjs`: „ein Orchestrator mit Space-Namen wartet in der Inbox und zählt mit“, „Review schickt an orchestrator-<space> …“ inkl. Pane-Fallback. |
| 2 | Quests ist ein Popup: `Board.selected` gilt im Fenster, Klick wählt (nicht mehr `auftrag`), Detailspalte rechts liest `this.selected`; `liveState`/Detail-Start einmal je Rendern. | `mods/quests/test/panel.test.mjs`: Klick setzt `selected`, Detail zeigt Titel und Beschreibung. Screenshot `/tmp/ui-clean1/quests-popup.png` (Detailspalte, „Board öffnen“). |
| 3 | „Ins Sidepanel“-Knopf (`surfaceToggle … to-panel`) aus Board-, Timeline- und Quests-Fensterkopf entfernt; Graph und Inbox behalten ihn. | `git grep "surfaceToggle.*\(board-to-panel\|tl-to-panel\|q-to-panel\)"` leer; Screenshots `board-popup.png`, `timeline-popup.png`, `quests-popup.png` zeigen nur × im Kopf. |
| 4 | „Board öffnen“ ruft `run("mod.open", { name: "board" })` (vorher `tabs-graph.panel-board`, das es nicht gibt). | `mods/quests/test/panel.test.mjs`: „Board öffnen ruft das Board-Popup …“. |
| 5 | Statusleiste nennt für das Team-Panel `⌘⌥⇧7` statt `⌘⌥7`. | `git grep "⌘⌥7" mods/status-bar` nur noch im Graph-/Team-Zusammenhang; Zeilen 439–440 nennen `⌘⌥⇧7`. |

## Render-Last

- **Board**: `costsNow`, `budgetNow`, `extraNow`, `gateById` einmal je `render`; `spentOf`/`limitOf`/`gateOf` lesen daraus.
- **Team-Panel (`hubview.js`)**: `tksNow`, `gateCache`, `termsCache`, `budgetCache`, `extraCache`, `orchCache` einmal je `sync`/Render; `ticketRow` reicht Gates, Limit, Budget, Terminals an `ticketCard` weiter.
- **`tabs-graph`**: `panes()` einmal je Render (Programm-Map, `orchestration(paneList)`), `agents()` einmal in `inboxCount`.
- **`orchestra/main.js`**: Space-Cache je Gruppe; `quests/main.js`: `liveCache()` einmal je Render, Detail-Start einmal.
- **`ui.js` Tick-Cache**: `if (Date.now() - host.at < HOST_TICK) return;` — Identity-Leser (`shared("agents.identity")`) cachen jetzt mit; `HOST_TICK = 120` ms, damit ein langer Dashboard-Render nicht mittendrin neu liest. Danach `sh mods/orchestra/bin/sync-ui` (11 Kopien).

## Toter Code

Gelöscht: `layouts/quests.json`, `layouts/quests.svg`, `keys.json` `layout:quests`; Quests-Seite (`Seite`-Knopf, Panel-/Page-Zweige, `class Bar`, `fromPage`, `SEL`); Panel-Kommandos `board.panel`, `timeline.panel`, `graph.panel` + `showPanel`/`find`/`layout`-Importe (tabs-graph ruft sie nicht); `tabs-graph` Icon-Ersatz (`fallback`, Prüf-Spawn, `readTextFile`/`appHome`, `board.svg`, `teams.svg`); `ui.js` `H_BAR`, Export von `ICON_CLOSE`/`gateChip`/`reviewChip`; `budgetChips`; eigene `paneSpaceOf`-Kopie in `orchestrator.js` (nutzt `ui.paneSpaceOf`); `NAME`.

`git grep` für alle diese Bezeichner: keine Aufrufer mehr (Ausnahme: Kommentare in historischen `docs/ui/notes-*.md`).

Im Layout `dashboard` gibt es kein `tabs-graph`: dort greifen weder `tabs-graph.panel-*` noch der Popup-Knopf; `mods/dashboard/**` blieb unverändert (nur die `ui.js`-Kopie via sync-ui).

Zwei Absicherungen aus dem Ticket:

- `tabs-graph.panel-<id>` als **Kommando** öffnet immer (`openPanel`); nur der Klick auf den Kopfknopf schaltet um (`togglePanel`). Beleg im Testfenster: zweimal `tabs-graph.panel-team` hintereinander lässt das Panel offen (`/tmp/ui-clean1/team-panel-twice.png`).
- Ein Home, dessen `shared("layout")` noch `quests` ist, startet sauber: der Orchestrator-Daemon (in `elric` und `dashboard`) schaltet beim Init auf `elric`, weil das Layout gelöscht ist.

## Doku

`README.md`: Layout-Liste (nur noch `elric` + `dashboard`), Tab-Leisten (Popups vs. Sidepanel), Tasten (`⌘⌥⇧7` Team, `⌘⌥7` Graph, `⌘⌥6`/`⌃⇧Q` Quests als Popup, `⌘⌥8` Board, `⌘⌥0` Timeline), Timeline/Fabrik-Graph als Popup bzw. Sidepanel, `hub stats --json` statt `hub stats agents`, Dashboard-Hinweis im Kopf und Peek statt Layout-Wechsel. `keys.json`: `layout:quests` entfernt, `cmd-alt-8`/`cmd-alt-0` auch unter `layout:dashboard`.

## Prüfungen

```
sh .herdr/verify.sh                                   # grün (55 Tests, ui.js-Kopien identisch)
node --test mods/quests/test/panel.test.mjs \         # 3/3
            mods/orchestra/test/scope.test.mjs        # 11/11
herdr-app check (Test-Home): quests review inbox board timeline graph
  tabs-graph status-bar cheatsheet orchestra           # alle „check passed“
herdr-app status                                      # errors: []
```

Screenshots: `/tmp/ui-clean1/{board,timeline,quests}-popup.png`, `team-panel-twice.png`.
Testfenster danach mit `docs/ui-preview.sh down` beendet; kein Push.
