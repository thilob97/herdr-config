# Notizen U: Ticket-Zeiten — erstellt, in Stufe, zuletzt, Prüfung

Branch `feat/ticket-meta` (Basis `main`, `070b2fa`). Kein neues Feld: alles aus `created`,
`updated`, `status_at` und `review_at`; `status_at` schreibt `hub ticket status` beim Wechsel,
ältere Tickets fallen auf `updated`/`created` zurück.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/review/ui.js`, `mods/board/ui.js`, `mods/orchestra/ui.js` | gemeinsamer Zeit-Block: `at`, `minutesSince`, `dur`, `age(ts)`, `STAGE_WORD`, `staged(ticket)` → `{ key, since, min, text }`; Kopie je Mod wie der übrige `ui.js`-Block (`mods/teams/ui.js` bleibt unverändert, es ist keine Fläche dieses Tickets) |
| `mods/review/main.js` | `timeChips`: vier Chips unter dem Titel (erstellt, in der Stufe, zuletzt bearbeitet, Prüfung), `T_XS`/`muted`, Tooltip mit Datum/Uhrzeit; fehlt ein Zeitstempel, fehlt der Chip |
| `mods/board/card.js` | Zeile 1 bleibt „Alter in der Stufe"; Hover zeigt zusätzlich „erstellt … · zuletzt …" (bricht in schmalen Spalten um statt abzuschneiden), Tooltip mit den vollen Stempeln |
| `mods/board/main.js` | `at` kommt jetzt aus `ui.js` (die Ortsparse lag doppelt) |
| `mods/orchestra/hubview.js` | Kopie der Karte; Zeile 1 zeigt „in <Stufe> seit …" (Team-Panel hat keinen Spaltenkopf mit der Stufe) |
| `docs/ui/notes-U.md` | diese Notizen |

## Verhalten

Alle Werte werden beim Rendern aus den Zeitstempeln gerechnet — kein Timer, keine Sekunden.
`dur` schreibt „jetzt", „42 min", „3 h", „2 d"; `age` daraus „gerade eben" bzw. „vor 42 min".
`staged` liefert die Stufe (`status` → `geplant`, `in Arbeit`, `in Prüfung`, `fertig`).

- **Review-Fenster:** Zeile `rv-times` direkt unter dem Titel, z. B. „erstellt vor 3 h ·
  in Prüfung seit 1 h · zuletzt bearbeitet vor 14 min · Prüfung seit 7 min"; der Tooltip je
  Chip nennt den vollen Stempel (`2026-11-15 05:56`). Die Prüfrunden stehen unverändert als
  „Runde N" in der Prüf-Zeile.
- **Board:** die Karte behält das Alter in der Stufe in Zeile 1. Beim Hover kommt unter dem
  Branch die Zeile „erstellt vor 2 d · zuletzt vor 6 min" dazu (Tooltip: beide Stempel).
- **Team-Panel:** die Ticket-Zeile ersetzt die nackte Dauer durch „in Arbeit seit 46 min",
  „in Prüfung seit 1 h", „geplant seit 317 d"; der Tooltip ergänzt „zuletzt bearbeitet …".

## Prüfung

Testfenster `~/.herdr/ui-preview/feat-ticket-meta` (eigener Core, Demo-Welt), Fenster
1710×1010. Frontmatter der Demo-Tickets im **Test-Home** manipuliert:

| Ticket | created | status_at | updated | review_at |
|---|---|---|---|---|
| `demo-1` (review) | `2026-11-15 05:56` | `2026-11-15 07:46` | `2026-11-15 08:44` | `2026-11-15 08:51` |
| `demo-2` (doing) | `2026-11-13 08:56` | `2026-11-15 08:14` | `2026-11-15 08:53` | — |

- `herdr-app check mods/review`, `mods/board`, `mods/orchestra`: `check passed`.
- Belege `/tmp/ui-meta/`: `review-meta.png` (vier Chips unter dem Titel: „erstellt vor 3 h ·
  in Prüfung seit 1 h · zuletzt bearbeitet vor 19 min · Prüfung seit 12 min"),
  `board-hover.png` (Alter `50min` in Zeile 1, Hover „erstellt vor 2 d · zuletzt vor 11 min"),
  `team-row.png` („in Arbeit seit 49 min", „in Prüfung seit 1 h", „geplant seit 317 d").
- Der Branch wurde vor den Belegen auf `main` (`070b2fa`) rebased; Konflikte nur in den
  beiden Kartenkopien (dort hatte `main` inzwischen die Dauer ohne Leerzeichen gesetzt,
  z. B. `50min` — die Zeile 1 des Boards behält das, das Team-Panel schreibt „seit …").
- Ohne `orchestra-daemon` veröffentlicht niemand `orchestra.tickets`: für die Belege wurde
  die Liste nach dem Bearbeiten der Tickets einmal aus `hub ticket list --all --json` nach
  `shared.json` geschrieben und das Fenster neu gestartet. Der Hover auf der Board-Karte und
  der Ticket-Modus des Review-Fensters sind im Test-Home injiziert (`this.hovered = "demo-2"`,
  `props.ticket ?? "demo-1"`), nicht im Worktree.

## Offen

- Die Zeit-Chips sitzen im festen Kopf des Review-Fensters; bei sehr schmalem Fenster bricht
  die Zeile um (`flex_wrap`) und der Kopf wächst um eine Zeile.
- `mods/teams` (Team-Hub-Fenster) und die übrigen `ui.js`-Kopien haben den Zeit-Block nicht;
  sie zeigen keine Ticket-Zeiten und lagen außerhalb dieses Tickets.
