# Notizen Q: Professionelle Farben und ruhigere Layout-Ebenen

Branch `feat/theme-pro`. Nur Palette, Flächen-Hierarchie und Abstände; keine Logik, keine neuen
Mods, kein README. Screenshots unter `/tmp/ui-theme/` (vorher/nachher), Testfenster beendet.

## Dateien

| Datei | Inhalt |
|---|---|
| `themes/elric.json` | neutrale Dunkelpalette, Blau als einziger Akzent, rote Statusfarben getrennt; alle von Mods gelesenen Namen definiert (inkl. `unknown`, `success`, `warning`) |
| `layouts/elric.json` | Statusleiste auf `chrome`, Arbeitsfläche `padding`/`gap` 8 → 10; Trennlinien bleiben 1 px `border` |
| `layouts/dashboard.json` | Fenster hinter der Dashboard-Karte `canvas` statt `surface` (Karte liegt jetzt *auf* der Fläche) |
| `mods/dashboard/main.js` | „Prüfen" sekundär; „Senden" bleibt die einzige Primäraktion der Fläche (Farb-/Rahmen-Nutzung, keine Logik) |
| `docs/ui/notes-Q.md` | diese Notizen |

## Palette

| Rolle | Name | Wert | Verwendung |
|---|---|---|---|
| Fenster hinter allem | `canvas` | `#0b0c0e` | Layout-Wurzel, Abstand zwischen Panels |
| Panel-/Eingabefläche | `background` | `#0e0f11` | Panel-Wurzel, Eingabefeld, Terminal |
| Leisten | `chrome` | `#121418` | Sidebar, Tab-Leiste, Statusleiste, Fenster-Titelzeile |
| Karte | `surface` | `#16181b` | Karten in Panel und Sidebar |
| Hover | `hover` | `#1b1e22` | nur die Karte/Zeile unter dem Zeiger |
| Popover | `popover` | `#1d2126` | Hover-Karten, Popups |
| Sekundärfläche | `raised` | `#22262b` | Sekundärknopf, Chip, Segment-Container |
| Auswahl | `selected` | `#263149` | gewählte Zeile/Karte (blauer Träger, kein Rahmen) |
| Linie | `border` | `#2b2f35` | Karten- und Panelränder, Trenner (1 px) |
| Eingabefeld-Rand | `input` | `#3a4048` | ohne Fokus; mit Fokus `accent` |
| Text | `foreground` | `#e7e9ec` | Titel, Fließtext |
| Text 2 | `muted` | `#aeb4bc` | Meta, Sektionsköpfe |
| Text 3 | `dim` | `#949ba5` | Zeit, Hinweise, deaktiviert |
| Akzent | `accent` | `#4c8dff` | Fokusrand, ein Primärknopf, Cursor |
| Auf Akzent | `accent_foreground` | `#0b0c0e` | Icon/Text auf `accent` |
| Primärknopf | `solid` / `solid_foreground` | `#4c8dff` / `#0b0c0e` | dieselbe eine Aktion |
| wartet | `blocked` | `#ef6d6d` | Rückfrage, Fehler, Überbudget |
| fertig | `done`, `success` | `#5cb87a` | erledigt, Checks grün |
| arbeitet | `working` | `#63b3d1` | Spinner, laufende Arbeit |
| ruhig | `idle` | `#8a919a` | Ring, Wort „ruhig" |
| unbekannt | `unknown` | `#aeb4bc` | Fallback externer Mods |
| Warnung | `warning` | `#d9a441` | sparsam; Amber |
| Terminal | `foreground`/`background`, `ansi0…15` | siehe Datei | ANSI-Diff: `ansi1` rot, `ansi2` grün |

Akzent ist genau ein Blau; Pink ist nicht mehr doppelt belegt (Spec §5.4 sagte `accent = blocked`).
Die Blau-Auswahl (`selected`) ist eine Fläche, kein Fokus: Fokus bleibt der 1-px-`accent`-Rand.

## Ebenen

Relative Leuchtdichte (WCAG 2.1) steigt streng in dieser Reihenfolge:

| Ebene | Wert | L |
|---|---|---|
| `canvas` | `#0b0c0e` | 0,0037 |
| `background` | `#0e0f11` | 0,0048 |
| `chrome` | `#121418` | 0,0069 |
| `surface` (Karte) | `#16181b` | 0,0090 |
| `hover` | `#1b1e22` | 0,0128 |
| `popover` | `#1d2126` | 0,0149 |
| `raised` | `#22262b` | 0,0190 |
| `selected` (Auswahl) | `#263149` | 0,0309 |

Regel: Fläche < Karte < Popover < Auswahl. Karten tragen `surface` + 1 px `border`, keine
Farbfläche, keinen Seitenstreifen, keinen Schatten. Hover hellt nur eine Stufe auf (`surface` →
`hover`); der Fokus ist ein 1-px-`accent`-Rand. `raised` ist eine eigene Sekundärfläche für Knöpfe
und Chips, keine Kartenfarbe.

## Kontrast (WCAG 2.1, ≥ 4,5:1 für Text)

Berechnet aus den Werten oben (`L = 0,2126 R + 0,7152 G + 0,0722 B`, `(L1+0,05)/(L2+0,05)`).
Chip-Werte sind Text auf `<Status>+26` über `surface`.

| Vordergrund / Grund | Verhältnis |
|---|---|
| `foreground` / `background` | 15,77 |
| `foreground` / `canvas` | 16,09 |
| `foreground` / `chrome` | 15,16 |
| `foreground` / `surface` | 14,62 |
| `foreground` / `raised` | 12,51 |
| `foreground` / `popover` | 13,30 |
| `foreground` / `selected` | 10,67 |
| `foreground` / `hover` | 13,75 |
| `muted` / `background` | 9,18 |
| `muted` / `canvas` | 9,37 |
| `muted` / `chrome` | 8,83 |
| `muted` / `surface` | 8,52 |
| `muted` / `raised` | 7,29 |
| `muted` / `popover` | 7,75 |
| `muted` / `selected` | 6,21 |
| `muted` / `hover` | 8,01 |
| `dim` / `background` | 6,84 |
| `dim` / `canvas` | 6,98 |
| `dim` / `chrome` | 6,58 |
| `dim` / `surface` | 6,35 |
| `dim` / `raised` | 5,43 |
| `dim` / `popover` | 5,77 |
| `dim` / `selected` | 4,63 |
| `dim` / `hover` | 5,97 |
| `accent` / `background` | 5,99 |
| `accent` / `surface` | 5,56 |
| `solid_foreground` / `solid` | 6,11 |
| `accent_foreground` / `accent` | 6,11 |
| `blocked` / `surface` | 6,00 |
| `blocked` / `blocked+26` auf `surface` | 4,88 |
| `done` / `surface` | 7,28 |
| `done` / `done+26` auf `surface` | 5,67 |
| `working` / `surface` | 7,54 |
| `working` / `working+26` auf `surface` | 5,84 |
| `warning` / `surface` | 7,91 |
| `warning` / `warning+26` auf `surface` | 6,07 |
| `success` / `surface` | 7,28 |
| `success` / `success+26` auf `surface` | 5,67 |
| `idle` / `surface` | 5,59 |
| `idle` / `idle+26` auf `surface` | 4,53 |
| `background` / `blocked` (Zähler-Badge) | 6,46 |
| `background` / `done` (Zähler-Badge) | 7,85 |
| `background` / `working` (Zähler-Badge) | 8,13 |
| `ansi1` / `background` (Diff −) | 6,70 |
| `ansi2` / `background` (Diff +) | 9,52 |
| `ansi3` / `background` | 11,13 |
| `ansi4` / `background` | 8,35 |
| `ansi5` / `background` | 8,18 |
| `ansi6` / `background` | 12,65 |
| `ansi7` / `background` | 12,42 |
| `ansi9` … `ansi15` / `background` | 8,55 … 16,92 |

`dim` musste gegenüber dem Vorschlag (`#7d848d`) auf `#949ba5` heller werden: nur so bleibt es auf
`raised` (deaktivierte Knöpfe, 5,43) und `selected` (4,63) über 4,5:1. `muted` folgt mit
`#aeb4bc`; die Stufen `foreground` > `muted` > `dim` bleiben sichtbar getrennt. `idle` liegt als
Chip bei 4,53 — knapp, aber über der Grenze.

## Layout und Dashboard

- `layouts/elric.json`: Statusleiste hat jetzt `background: "chrome"` (die Mod färbt sie schon so;
  der Layout-Block macht die Ebene explizit). Arbeitsfläche `padding`/`gap` 10 statt 8, damit
  Panels und Terminal nicht am Rand kleben. Trenner bleiben 1 px `border`, Pane-Radius 10
  (Spec §5.3), keine Schatten.
- `layouts/dashboard.json`: Wurzel `canvas`; die Dashboard-Karte (`background` + 1 px `border`)
  liegt damit sichtbar auf der Fläche, darin die Karten (`ui.card`: `surface` + Rand, Radius 8).
- `mods/dashboard/main.js`: „Prüfen" in der Review-Zeile ist sekundär; die einzige Primäraktion
  der Fläche ist „Senden" (bzw. „Orchestrator starten", solange keiner läuft). Kopfbereich bleibt
  text-only; Statusfarben nur für Status (wartet/fertig/über Budget).
- Keine Hex-Literale in Mods; Farben ausschließlich über Theme-Namen und die dokumentierten
  Alpha-Suffixe (`26`, `55`, `88`).

## Nachweise

Testfenster (`docs/ui-preview.sh`, Demo-Welt, Theme `elric`, Zoom 1,2):

| Screenshot `/tmp/ui-theme/` | Inhalt |
|---|---|
| `before-01-workspace.png` / `after-01-workspace.png` | Workspace voll: Sidebar, Tabs, Terminal, Statusleiste |
| `before-02-dashboard.png` / `after-02-dashboard.png` | Dashboard: wartende Abnahme, Team, Fabrik, Auftrag |
| `before-03-review.png` / `after-03-review.png` | Review-Fenster (Titelzeile `chrome`, Diff in `ansi1`/`ansi2`) |
| `before-04-inbox.png` / `after-04-inbox.png` | Inbox-Popup über dem Workspace |
| `before-05-empty.png` / `after-05-empty.png` | leerer Zustand: neuer Space mit einer Shell |
| — / `after-06-panel.png` | Panel-Kopf (Tree) ohne Farbfläche, 1 px Trenner, Fokus als `accent`-Haarlinie |

- `docs/ui-preview.sh check dashboard` → `check passed`.
- `docs/ui-preview.sh status` nach jeder Aufnahme: `errors: []`, `overlays` nur die erwarteten.
- `jq empty themes/elric.json layouts/*.json` und `node --check mods/dashboard/main.js` grün.
- Testfenster mit `docs/ui-preview.sh down` beendet; Test-Cores gestoppt, Test-Home bleibt liegen.
- Kein Push.

## Offen / Grenzen

- `docs/ui-spec.md` §5.4 beschreibt noch Pink als `accent = blocked`. Das Theme trennt die Rollen
  jetzt (Blau = Fokus/Primär, Rot = wartet/Fehler); der Spec-Text gehörte nachgezogen, liegt aber
  außerhalb der Dateigrenzen dieses Tickets.
- Das Dashboard-Layout nennt für das helle Theme weiterhin `paper`; geprüft wurde nur `elric`
  (das helle Theme liegt nicht im Repo).
- Zoom 1,2 ist die Einstellung des Menschen; die Spec-Pixel gelten bei Zoom 1.
