# Notizen Y: Fünf Features in der Oberfläche

Branch `feat/five-ui` (Basis `main`, `2087a34`). Die hub-Kommandos `triage`, `preflight`,
`stalls`, `nudge`, `night` und `memory` sind die Quelle; die Oberfläche zeigt sie nur.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/dashboard/main.js` | Karte **Stockt** (`hub stalls --json` alle 10 s) mit Ticket · Stufe · Alter · Agent, **Nachfragen** (`hub nudge`) und **Alle anzeigen** (Team-Panel); in der Fabrik-Karte die Zeile **Nachtschicht** aus `## Nachtschicht` |
| `mods/dashboard/tickets.js` | `nightOf(body)` liest den letzten Lauf (`- begin → end · n gestartet, m übersprungen`) aus dem Ticket |
| `mods/board/card.js` | Prioritäts-Chip `P1` rot / `P2` gelb / `P3` gedämpft, Größe `S`/`M`/`L` als Text, Warn-Chip `Preflight ✗`, Chip `Triage offen` bei fehlendem `triaged` und gesetztem `source` |
| `mods/orchestra/hubview.js` | dieselbe Karte im Team-Panel; zusätzlich `✓`/`!`/`–` für den Preflight neben den Gates |
| `mods/teams/main.js` | Abschnitt **Gedächtnis** im Agent-Detail: letzte fünf Einträge (`hub memory list --agent NAME --json`), Textfeld und **Eintrag hinzufügen** (`hub memory add --agent NAME [--ticket ID] TEXT`), Neulesen mit dem 15-s-Refresh |
| `docs/ui/notes-Y.md` | diese Notizen |

## Entscheidungen

**Priorität nur einmal.** Die Triage schreibt `priority: p1|p2|p3` und zusätzlich ein Label.
Die Karte liest zuerst das Feld, fällt für ältere Tickets auf ein Label zurück und blendet
Prioritäts-Labels aus der Label-Zeile aus. So steht nie `P1` neben `p1`.

**Preflight an zwei Stellen, je Fläche anders.** Das Board trägt den Warn-Chip
`Preflight ✗` (dort gibt es keine Gate-Symbole), das Team-Panel die Zeichen `✓`/`!`/`–`
neben den Gates. Beide lesen nur das Ticketfeld `preflight`; ob der Lauf zum HEAD gehört,
prüft weiterhin `hub gate`.

**Nachtschicht ohne Statusdatei.** `hub night` schreibt seinen Lauf erst am Ende als
`## Nachtschicht` ins Ticket. Die Fabrik-Karte sucht den jüngsten Lauf über alle Tickets:
liegt sein Ende in der Zukunft, steht dort `läuft bis HH:MM · n gestartet`, sonst
`zuletzt bis HH:MM · n gestartet`; ohne Lauf `aus`. Der Tooltip nennt den vollen Zeitraum
und die Übersprungenen.

**Lesetakt.** Stalls 10 s, Nachtschicht/Tickets 5 s, Board-Karten 5 s, Team-Hub 15 s.
Keine neue Abhängigkeit; `hub` bleibt der einzige Leser der Ticketdateien.

## Prüfung

- `herdr-app check mods/dashboard mods/board mods/orchestra mods/teams` → je `check passed`.
- `docs/ui-preview.sh hub memory list --agent Ada --json` → 5 Einträge; `hub memory add …`
  → 6, der neue Eintrag ist der letzte (Form `{date, ticket, text}`).
- Testfenster `~/.herdr/ui-preview/feat-five-ui`, Screenshots `/tmp/ui-five/`:
  - `dashboard-stockt.png` (Stockt-Karte mit drei Zeilen: In Arbeit, Prüfung, Geplant)
  - `dashboard-night6.png` (Fabrik-Karte, Zeile „Nachtschicht: läuft bis 06:00 · 3 gestartet“)
  - `board-priority.png` (P1/S mit `Preflight ✗`, P2/M, P3/L mit `Triage offen`)
  - `team-preflight.png` (Preflight `!` bzw. `✓`/`–` neben den Gates)
  - `teamhub-memory.png` (Abschnitt Gedächtnis, fünf Einträge, Eingabe und Knopf)
- Testfenster danach mit `docs/ui-preview.sh down` beendet; kein Push.

## Offen

- Ein laufender Nachtlauf ist erst nach seinem Ende im Ticket sichtbar; bis dahin zeigt die
  Karte den vorigen Lauf (oder `aus`).
- `hub stalls` liest `status_at`; Tickets ohne dieses Feld (vor der Status-Log-Änderung)
  erscheinen nicht als hängend.
