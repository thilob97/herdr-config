# UX 3: Identität und Alter überall gleich

UX 2 hatte die Identitätsregel und das Altersformat nur in `mods/orchestra` und
`mods/dashboard` umgesetzt; Board, Inbox und Team-Hub zeigten weiter das Programm
(„Oh My Pi") und die kurze Dauer (`1 d`). Jetzt gibt es eine Quelle für beides.

## Eine Quelle: `mods/orchestra/ui.js`

- **Alter.** `dur(min)` spricht eine Sprache: `gerade`, `42 min`, `2 h`, `> 1 Tag`,
  `3 T`; `—` ohne Wert. Über 24 h ist der Wert eine Untergrenze, deshalb `> 1 Tag`;
  danach `n T` statt des winzigen `n d`. `age(ts)` liefert dasselbe für einen
  Ticket-Zeitstempel (`JJJJ-MM-TT HH:MM`), `ageMs(ms)` für ms-Werte wie
  `attention.since`. `staged()` baut daraus „in Arbeit seit 4 min" bzw.
  „in Arbeit gerade eben" — nie „seit jetzt" oder „seit 1 d".
- **Identität.** `identity()` liest den Namen nur aus `shared("agents.identity")`.
  Ohne veröffentlichten Namen ist `name` das Programm-Kürzel (`omp`, klein) oder die
  Adresse — nie der Programmname — und `named: false` sagt, dass es kein Agent ist.
  `identityChip()` zeigt diesen Fall klein und gedämpft, mit Tooltip
  „Programm, kein laufender Agent".
- `headStale` und der `stale`-Zweig von `ciChip` (aus `mods/review`) sind mit
  übernommen; die Kopie in `mods/review` war die einzige, die sie schon hatte.

Alle elf Kopien sind **byte-identisch** (md5 `51a0f19f9e4dffaba48fb97db1934cbc`):

```
mods/board/ui.js  mods/dashboard/ui.js  mods/inbox/ui.js  mods/launcher/ui.js
mods/orchestra/ui.js  mods/quests/ui.js  mods/review/ui.js  mods/status-bar/ui.js
mods/teams/ui.js  mods/timeline/ui.js  mods/toast-review/ui.js
```

## Board-Karte (`mods/board/card.js`)

- Der eigene `whoChip` ist weg. Mit Terminal steht `ui.identityChip` in der dritten
  Zeile (Name, Avatar, Status); ohne Terminal zählt `agent_name`/`assignee` bzw. ein
  Roster-Name in `agent` — ein Programm-Kürzel (`omp`) steht klein und gedämpft wie
  im Team-Panel. „Oh My Pi" erscheint nicht mehr als Identität.
- Zeile 1 zeigt das Alter jetzt ungekürzt: `318 T`, `> 1 Tag`, `42 min` statt `318d`.

## Inbox (`mods/inbox/main.js`)

- Der lokale `ago()`-Formatierer (`9m`, `2h`, `4d`) ist gelöscht; Zeile und
  Rückfrage-Alter kommen aus `ui.ageMs`.
- Agenten ohne veröffentlichte Identität zeigen das Programm-Kürzel klein und
  gedämpft; der Programmname ist kein Zeilentitel mehr.

## Team-Hub (`mods/teams/main.js`)

- Karte und Detail nennen das Programm als Kürzel (`omp · modell`, gedämpft), nicht
  als „Oh My Pi".
- Die Zeilen unter **Laufende Tickets** tragen rechts den Roster-Namen, wenn der Hub
  den Agenten kennt (`tk.agent`); sonst die veröffentlichte Identität des Terminals
  bzw. dessen Programm-Kürzel. Dieselbe Regel wie im Team-Panel.

## Prüfung

- `herdr-app check` im Test-Home (`docs/ui-preview.sh check`): `board`, `inbox`,
  `teams`, `review`, `toast-review`, `quests`, `orchestra`, dazu `dashboard`,
  `launcher`, `status-bar`, `timeline` — je `check passed`.
- `grep -rn "function ago\|const dur =\|function dur" mods/*/main.js mods/*/*.js`
  (ohne `ui.js`): kein Treffer für Board, Inbox, Teams. `mods/dashboard/main.js`
  behält sein `ago(ms)` aus UX 2 (wörtlich dieselbe Sprache), weil das Ticket nur
  die genannten Flächen öffnet; `filetree`, `agent-cards`, `timeline` und
  `status-bar` formatieren Datei- bzw. Limit-Zeiten, keine Ticket-Alter.
- Testfenster `feat-ux3`: `errors: []`, danach `down`.
- Belege unter `/tmp/ui-ux3/`:
  - `board-card.png` — DEMO-2 „Bloop 70" (Identität), DEMO-1 `omp` klein, alle
    Karten `318 T`.
  - `inbox-row.png` — Zeilen „Zap 71 / Bloop 70 / Quark 73" mit `9 min`.
  - `team-card.png` — Team-Hub, Karte Zap mit `omp · modell`; darunter „Laufende
    Tickets": DEMO-2 mit dem Roster-Namen `Zap` rechts.
  - `team-panel.png` — dasselbe Ticket im Team-Panel: `in Arbeit seit 4 min`,
    Chip `Bloop 70`; DEMO-1 `in Prüfung seit 318 T` mit `omp`.
- Für `team-card.png` wurde nur im Test-Home die Fensterhöhe auf 920 px gesetzt,
  damit die Ticket-Zeile im Bild liegt; das Mod selbst bleibt bei 680 px.

## Grenzen

- `mods/orchestra/hubview.js` (Team-Panel) und `mods/dashboard/main.js` liegen
  außerhalb dieses Tickets; das Panel erbt Altersformat und Identitätsregel über
  `ui.js` unverändert.
- Quests' Start-Record (`recordIdentity`) behält seinen eigenen Fallback; über
  `identity()` steht dort jetzt ebenfalls das Programm-Kürzel statt „Oh My Pi".
- Kein Push.
