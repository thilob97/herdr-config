# UX 2: Tastenkürzel, Karten-Kürzung, Identität ohne Terminal, Altersformat

Drei Lücken, die ein Durchlauf durch die Oberfläche gezeigt hat. Tokens bleiben die
aus `docs/ui-spec.md`.

## Tastenkürzel (`mods/cheatsheet/main.js`)

- Die vier neuen Tasten haben deutsche Beschreibungen statt roher Befehle:
  `⌘⇧0` „Dashboard zeigen", `⌘⌥8` „Panel Board zeigen", `⌘⌥9` „Team-Hub öffnen",
  `⌘⌥0` „Panel Timeline ein/aus" (über `PANEL.timeline`). Ebenso `layout.switch:quests`
  („Quests zeigen") und `layout.switch:elric` („Zurück zur Werkbank (elric)"); die nackte
  `layout.switch`-Zeile heißt jetzt „Nächstes Layout" statt „Layout undefined".
- `PANEL` kennt `board` und `timeline`, damit `tabs-graph.panel-<id>` nie den Befehl zeigt.
- Neue Gruppe **Fabrik** für die Fabrik-Flächen der Tab-Leiste: `board.panel`,
  `mod.open:teams`, `tabs-graph.panel-{quests,team,timeline}`. Die Werkzeug-Panels
  (Changes, Git, Tree, Blueprint, Docker) bleiben unter „Panels und Seitenleiste".
  Layout-Wechsel bleiben unter „App und Layouts".

## Ticket-Karte im Team-Panel (`mods/orchestra/hubview.js`)

Die Kopie der Board-Karte (`mods/board/card.js`) ist jetzt deckungsgleich mit dem Board:

- Label-Chips tragen den vollen Text und schrumpfen selbst (`min_w(0)`, `truncate`,
  Ellipse); höchstens zwei Chips plus `+n`, alle Labels im Tooltip. Kein Vorab-Schnitt
  mehr (`l.length > 10 → l.slice(0, 9)…` ist weg).
- `clampTitle` ist die Board-Fassung: zwei Zeilen, Wortgrenze, die zweite Zeile hält ein
  Zeichen für das `…` frei; ein einzelnes zu langes Wort endet mit `…`.

## Identität (`mods/orchestra/ui.js`, `hubview.js`, `mods/dashboard/main.js`)

- `ui.identity()` liest den Namen **nur** aus `shared("agents.identity")` und liefert
  `named` sowie `programKey` (klein, z. B. `omp`). Ein Programmname („Oh My Pi") ist
  keine Identität mehr; das Programm steht klein und gedämpft, Tooltip
  „Programm, kein laufender Agent" (bzw. „Programm ohne veröffentlichte Identität",
  solange das Terminal lebt).
- `identityChip()` zeigt ohne veröffentlichten Namen das Programm-Kürzel in `dim`; der
  Avatar erscheint nur zu einem echten Namen. Klick/Fokus unverändert.
- `hubview.js` (`whoChip`): `tk.agent` ist ein Programm-Kürzel, kein Agent; Identität
  kommt aus `agent_name`/`assignee` bzw. `shared("agents.identity")`.
- Dashboard (`teamRow`): gleiche Regel — ohne veröffentlichten Namen das Programm-Kürzel
  klein und gedämpft, Tooltip „Programm, keine veröffentlichte Identität".

## Altersformat (`mods/dashboard/main.js`)

- Eine Sprache für alle Altersangaben des Dashboards: `gerade`, `42 min`, `2 h`,
  `> 1 Tag`, `3 T`. Der erste Tag ist eine Untergrenze („> 1 Tag"), danach zählt `n T`
  statt des winzigen `n d`. Gilt für die Spalte **Seit**, die Wartet-Zeilen und
  „Letzte Aktivität".
- Das Alter einer Review-Zeile kommt aus demselben Rückfall wie im Board
  (`status_at` → `updated` → `created`), ein Ticket ohne `status_at` hat also ein Alter
  statt eines Strichs.

## Grenzen dieser Änderung

- `mods/board/card.js` und die `ui.js`-Kopien der übrigen Mods bleiben unverändert: die
  Grenzen dieses Tickets nennen nur `mods/orchestra/{ui,hubview}.js` und
  `mods/dashboard/main.js`. Board-Karte und Team-Karte sind in Kürzung und Titel gleich;
  die Identitätsregel ist im Team-Panel und im Dashboard umgesetzt.

## Prüfung

- `herdr-app check mods/cheatsheet`, `mods/orchestra`, `mods/dashboard`: je
  `check passed` (einzeln, das Werkzeug lädt ein Verzeichnis).
- Testfenster `feat-ux2`: `herdr-app status` → `errors: []`, danach `down`.
- Belege unter `/tmp/ui-ux2/`:
  - `cheatsheet.png` — Gruppe „Fabrik": `⌘⌥0` Panel Timeline, `⌘⌥6` Panel Quests,
    `⌘⌥7` Panel Team, `⌘⌥8` Panel Board, `⌘⌥9` Team-Hub, keine rohen Befehle.
  - `cheatsheet-dashboard.png` — gefiltert „Dashboard": `⌘⇧0` „Dashboard zeigen".
  - `team-card.png` — Team-Panel: DEMO-2 mit `tickets-pipeline-k…` + `+3`,
    DEMO-1 ohne Terminal mit `omp` klein und gedämpft (Identität „Echo 69" daneben).
  - `dashboard-seit.png` — Dashboard: „> 1 Tag" in der Wartet-Zeile, „318 T" in
    „Letzte Aktivität"; die Spalte **Seit** zeigt Minuten, weil die Statusleiste den
    Wechsel frisch gestempelt hat.
- Der Dialog hat im Test-Home die ausgelieferten 860×640; für „Dashboard zeigen" wurde
  er über das Filterfeld eingegrenzt (Tastendruck via System Events), nicht umgebaut.
- Kein Push.
