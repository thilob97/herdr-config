# UX 11: Popups vs. Sidepanels in Board, Timeline, Graph, Quests, Inbox, Launcher

Jede Fabrik-Ansicht hat jetzt die Form, die zu ihrer Geometrie passt: breite Ansichten
(Board, Timeline, Quests, Graph) öffnen als Fenster-Overlay, dieselben Mods bleiben als
Block im rechten Sidepanel, und ein Klick wechselt in beide Richtungen. Inbox läuft
weiter als Top-Popup und zusätzlich als einspaltiges Sidepanel.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/ui.js` (+ 11 Kopien aus `bin/sync-ui`) | `panelHeader`/`windowHeader` mit `actions`, `surfaceToggle`, `switchToPanel`, `switchToWindow` |
| `mods/board/{mod.json,main.js}` | Fenster 1120×720, Kopf mit Umschalter, Panel-Kopf mit `↗` |
| `mods/timeline/{mod.json,main.js}` | Fenster 1040×680, Umschalter in beiden Köpfen |
| `mods/graph/{mod.json,main.js}` | Fenster 980×720, `⇥` → Panel `factory`, `↗` → `mod.open:graph` |
| `mods/quests/{mod.json,main.js}` | Fenster 1080×720, Overlay rendert Quellen · Tickets · Detail, Panel-Kopf mit `↗` |
| `mods/inbox/main.js` | `props().panel` stapelt Liste und Detail; Popup-Kopf mit `⇥` |
| `mods/launcher/mod.json`, `mods/quests/main.js` | Auftrag-Dialog 680×520 (auch der Weg aus Quests) |

## Verhalten

- **Umschalter.** `surfaceToggle(t, id, mode, cb)` zeichnet einen `iconButton`:
  `to-window` zeigt `mods/orchestra/icons/open.svg` (Pfeil nach außen, Tooltip „Als
  großes Popup-Fenster öffnen“), `to-panel` zeigt `mods/workspace-chrome/sidebar.svg`
  (Tooltip „Rechts im Sidepanel anheften“). Beide Icons existieren in der Config; es
  wurde keines erfunden.
- **Panel.** `switchToPanel(childId, overlay)` schließt zuerst das Overlay, dann
  `layout.show panel` und `layout.select panel-body child`. **Fenster.**
  `switchToWindow(mod)` versteckt das Panel und ruft `mod.open`; der Mod liest seine
  Breite aus `mod.json`.
- **Kopf-Aufbau.** `windowHeader(..., { actions })` setzt die Umschalter vor `×`;
  `panelHeader(..., { actions, action })` nach den rechten Elementen. Bestehende
  Aufrufer mit Positionsarray bleiben unverändert.
- **Board.** Vier Spalten ab 900 px gemessener Breite; im 1120er Fenster stehen sie
  nebeneinander, im Panel weiter gestapelt/2×2. Suchfeld, Trefferzahl, „Daten alt“ und
  Kostensumme sitzen unverändert im Kopf.
- **Quests.** `props().overlay` rendert das volle Dreispalten-Layout mit `windowHeader`
  (× = `closeOverlay`, `⇥` = Sidepanel). `props().view === "panel"` bleibt einspaltig
  mit `↗` im Kopf. Die Seite (`view: "page"`) behält ihre drei Spalten ohne Umschalter.
- **Inbox.** Popup: Liste 320 px links, Detail rechts, `⇥` neben Esc. Sidepanel
  (`props().panel === true`): Liste oben (`flex_1`), darunter das Detail mit
  `border_t_1` und Antwortfeld; kein horizontales Quetschen bei 368–400 px. Esc schließt
  nur noch ein Overlay, nicht das Panel.
- **Launcher.** `mod.json` und der Aufruf aus Quests nennen 680×520; der Dialog füllt
  damit seine Inhalte ohne die alte Leerfläche.

## Prüfung

- `sh mods/orchestra/bin/sync-ui` → 11 Kopien; `sh .herdr/verify.sh` → 54 Tests grün,
  alle 12 `ui.js` identisch.
- `herdr-app check mods/{board,timeline,graph,quests,inbox,launcher,orchestra}` → OK.
- Testfenster `feat-ux11-surfaces` (`docs/ui-preview.sh`), Belege `/tmp/ui-ux11/`:
  - `board.png` — 4 Spalten im 1120er Fenster, Kopf mit `⇥` und `×`.
  - `quests-window.png` — Quellen · Tickets · Detail im 1080er Fenster, `⇥` + `×`.
  - `graph-window.png` — 980er Fenster mit `⇥`; `graph-panel.png` — Sidepanel-Kopf
    „Fabrik-Graph … demo-app ↗“.
  - `inbox-popup.png` — 2-spaltiges Popup mit `⇥`; `inbox-panel.png` — Sidepanel mit
    Liste oben, Detail/ Antwortfeld unten, `↗` im Kopf.
  - `timeline-window.png` (1040×680) und `launcher.png` (680×520).
- Fenster am Ende `down`; kein Push.

## Grenzen

- Das Inbox-Sidepanel ist im Mod fertig, aber `layouts/elric.json` (UX 12) hat noch
  keinen Block `inbox` mit `props: { panel: true }`. Für den Beleg wurde der Block nur
  im Test-Home per `layout.set` ergänzt, nicht im Repo.
- `switchToPanel` schließt das Overlay über `hostApi.closeOverlay?.()`; der Namespace-
  Zugriff hält die Node-Tests mit ihrem kleinen `herdr`-Stub am Leben. Ein Klickpfad
  wurde im Testfenster nicht automatisiert geklickt (keine Bedienungshilfen-Rechte);
  belegt sind Layout und beide Köpfe, nicht der Klick selbst.
- Tooltips sind nur im Code belegt; das Hintergrundfenster zeigt sie nicht.
