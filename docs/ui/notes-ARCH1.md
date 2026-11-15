# Architektur 1: Daemon im Dashboard, Budget je Workspace, Peek

Ticket `architektur-1-daemon-im-dashboard-budget`. Branch `feat/arch1`, Basis `main`.

## Was geändert ist

| Datei | Änderung |
| --- | --- |
| `layouts/dashboard.json` | 0-px-Block `orchestra-daemon` (`props.role = "daemon"`) wie in `layouts/elric.json`: `HubDaemon` läuft auch im `dashboard`-Layout (Tickets/Gates/Kosten, Autostart, Toasts). |
| `mods/orchestra/hubview.js` | `SpacesWatcher` im `HubDaemon`: `hub spaces --json --agents` alle 15 s nach `shared("orchestra.spaces")` mit `at: Date.now()` (Herzschlag). |
| `mods/orchestra/orchestrator.js` | `terminalSpace(x, tks)`: `hub.space` → `herdr.space` → `paneSpaceOf` (`panes()` → `tab` → `spaces().tabs`), normalisiert mit `ui.workspaceId`. `find(sid = spaceId())` und `send(text, sid = spaceId())` nehmen eine Workspace-ID; `all()` ordnet jeden Orchestrator seinem Workspace zu (eine Ticket-Liste je Durchlauf). |
| `mods/orchestra/costs.js` | Ticket-Budget-Stopp geht per `orch.send(…, ui.ticketWorkspace(t))` an den Orchestrator **dieses** Workspace (nur wenn dort einer läuft). Team-Stopp unterbricht alle Orchestratoren aus `orch.all()`. `raiseTicket(t)` schickt die Erhöhung in den Ticket-Workspace. |
| `mods/board/main.js` | Karten aus `shared("orchestra.tickets")`, Gates aus `shared("orchestra.gates")`; eigener `hub ticket list`/`hub gates` nur bei leerem shared und beim Klick auf „Daten alt“ (`force`). `hub wip` bleibt bei Space-Wechsel / alle 30 s. |
| `mods/dashboard/main.js` | Herzschlag `shared("orchestra.spaces").at` (< 12 s) ⇒ `shared("orchestra.tickets")`/`shared("orchestra.spaces")` statt eigener Subprozesse; Fallback-Poller nur bei veraltetem/fehlendem Herzschlag. Klick auf Agent-Zeilen („Wartet auf dich“, „In Arbeit“, „Team“, „Letzte Aktivität“) ⇒ `run("terminal.peek", { terminal })`; kleiner Knopf „Zum Space“ ⇒ `openSpaceAndTerminal` (Layout `elric`, Tab, Pane). Review-Ticket ⇒ Review-Overlay. Der Nachtschicht-Eintrag (nur im Ticket-Text) wird einmal beim Start gelesen und weitergereicht. |
| `mods/orchestra/orchestrator.md` | Abschnitt **Workspace-Fabrik**: `hub whoami`, `hub spaces`, `--space`/`--all`, ein Orchestrator je Space, Fabrik-Graph `⌘⌥7`. |

## Prüfung

- `herdr-app check mods/orchestra|mods/board|mods/dashboard`: grün.
- `node --test mods/dashboard/test/*.test.mjs`: 40 Tests grün (neu: `test/peek.test.mjs` — Peek bleibt im Dashboard, „Zum Space“ wechselt, Review-Overlay, shared-Frische/Fallback, Aktivitätszeile trägt die Agent-Adresse).
- `node --test mods/orchestra/test/scope.test.mjs`: 9 grün (Stub um `panes()` ergänzt).
- Workspace-Zielprüfung (Wegwerf-Skript, danach gelöscht): Ticket-Agent über Budget ⇒ `interrupt` am Agenten, `send` nur an den Orchestrator des Ticket-Workspace (nicht an den aktiven Space); `raiseTicket` ebenso; Team-Budget ⇒ `interrupt` an alle Orchestratoren; Orchestrator ohne Labels wird über `panes() → tab → spaces().tabs` gefunden.

## Beleg im Test-Home (`docs/ui-preview.sh`)

- Layout `dashboard` (per `layout.switch dashboard`), ohne Wechsel nach `elric`.
- `shared.json`: `orchestra.spaces.at` frisch (15-s-Takt), `orchestra.tickets` mit 4 → 5 Tickets nach Anlegen von `demo-5.md` (Republish binnen 7 s durch den Daemon), `orchestra.costs`/`data/orchestra/costs.json` vom Daemon geschrieben (mtime 20:14:10).
- `terminal.peek` auf `t1`: Layout bleibt `dashboard` (`status.layout = "dashboard"`, Overlay `layout`).
- Screenshots: `/tmp/ui-arch1/arch1-dashboard.png`, `/tmp/ui-arch1/arch1-peek.png`.
- Testfenster danach `down`; kein Push.

## Offene Punkte

- `hub spaces --json --agents` liefert weiter Agent-Spaces (`kind: "agent"`); das Dashboard filtert sie wie bisher über `spaces.workspaceRows`.
- Der 12-s-Frischetest hängt am 15-s-Takt des Daemons: zwischen 12 und 15 s nach dem letzten Publish liest das Dashboard seine Rückfallquelle (Dateien bzw. einmalig `hub spaces`). Bewusst so im Ticket.
