# Notizen E: Tickets als einziger Weg (Teil 1)

Branch `feat/ui-tickets` (Basis `feat/ui-umbau`). Teil 1 = `hub`, Regeln, Dispatch-Präambel.
Die UI (Team-Panel, Review, Inbox, `hub status`-Spalte) folgt in Teil 2 nach Paket B.

## Neue `hub`-Befehle

| Befehl | Wirkung |
|---|---|
| `hub ticket comment <id> --from <rolle> "text"` | Eintrag `- JJJJ-MM-TT HH:MM · rolle · text` unter `## Verlauf`, neueste unten; `@name` → Feld `tags` |
| `hub ticket assign <id> <agent>` | Feld `assignee` |
| `hub ticket link <id> --blocked-by <id>…` | Feld `blocked_by`; Zyklen und unbekannte IDs abgewiesen |
| `hub ticket next <agent>` | erstes `todo`, zugewiesen, nicht blockiert; Exit 1 mit Meldung, wenn keins |
| `hub ticket inbox <agent> [--json]` | genannt (`@` im letzten Kommentar), zugewiesen oder wartend (`watch`), mit offener Frage und Alter |
| `hub ticket watch <id> --on <agent>` | Feld `waiting`: „wartet auf Antwort von @agent“ |
| `hub ticket list --agent <name> --json` | Filter auf `assignee`/`tags`/`waiting`, plus `comments`-Zahl |
| `hub dispatch <id>` | verweigert den Start, solange ein `blocked_by` nicht `done` ist, und nennt das offene Ticket |

`hub ticket show` druckt den Verlauf mit (Body). `hub review` behält ihn: es trennt
`## Verlauf` vor dem Ersetzen der Zusammenfassung ab und hängt ihn wieder an;
`--checks`/`--evidence` unverändert. `hub done` fasst den Body nicht an.
Quests (`mods/quests/store.js`) behält `assignee`, `blocked_by`, `tags`, `waiting`
beim Bearbeiten und zeigt `assignee` (vorher `agent`) als Zuständigen.

## Selbsttest im Test-Home

`HERDR_APP_HOME=$(mktemp -d)`, kein echter Config- oder Terminal-Zugriff, kein Agent
gestartet. Protokoll: `/tmp/ui-ticket/selftest-teil1.txt` (alle Zeilen `ok`, Exit 0).

Geprüft: anlegen, kommentieren (mehrzeilig → ein Eintrag, Tag `bob`), zuweisen,
verlinken, `next` (Treffer und Exit 1), `dispatch` auf blockiertes Ticket
(„`darauf-aufbauen` ist blockiert durch `basis-bauen` (todo)“, Exit 1), `inbox`
(genannt/zugewiesen/wartend), `list --agent --json`, Zyklus- und Feld-Abweisung,
`review` + `done` mit erhaltenem Verlauf, `dispatch` nach `done` des Vorgängers
läuft weiter bis zur Repo-Prüfung (Gate frei, nichts gestartet), `--help`.
