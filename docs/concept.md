# Kernkonzept: die Mods als Agentic Software Fabric

**Ein Satz:** Herdr soll die Fabrik selbst sein — ein Arbeitsplatz, an dem ein Mensch Aufträge hineingibt, Agenten sie ausführen, und jede Station (Eingang, Fluss, Gates, Nachweise, Kosten) sichtbar und bedienbar ist, ohne Terminal-Wissen und ohne Cloud-Control-Plane.

Die Mods sind der POC für diese These: keine Sammlung von Agent-Monitoren, sondern eine operierbare Fabrik auf `hub`/`hc`.

## Fünf Prinzipien

1. **Der Work Order ist das dauerhafte Objekt.** Tickets tragen Identität, Zustand, Verlauf, Abnahme und Nachweise. Agenten, Sessions und Modelle sind austauschbar; ein Ticket überlebt jeden Agenten. Koordination läuft über Work-State, nicht über Agent-zu-Agent-Gespräche.
2. **Der Mensch entscheidet was, die Agenten wie.** Freigaben nur an drei Stellen: Abnahme (Review), Berechtigungsfrage (blocked), Landen (Merge/PR). Alles davor ist maschinell belegt (`hub verify`, Prüfstation, CI).
3. **Eine Zahl, eine Wahrheit.** Pipeline-Stufe, Inbox-Zähler, Identität und Kosten kommen aus einer Quelle (`shared("orchestra.tickets")`, `shared("agents.identity")`, `hub status`). Jede Oberfläche zeigt dieselbe Zahl — sonst ist sie wertlos.
4. **Das Fabric ist sichtbar.** Graph, Timeline, Board, Dashboard und Team-Panel sind keine Deko: sie zeigen, wer woran arbeitet, was hängt, was Geld kostet. Ohne Inventar keine Steuerung.
5. **Lokal und föderiert.** Alles läuft über `hub`/`hc` auf den Maschinen des Menschen. Spaces sind Fabriken, Maschinen sind Standorte. Keine zweite Control Plane, kein Vendor-Lock-in.

## Was die Mods dafür sind

| Rolle | Mods |
|---|---|
| Eingang | `launcher` (Auftrag), `quests` (Quellen) |
| Fluss | `board`, `tabs-graph` (Pipeline), `teams` |
| Aufsicht | `graph`, `timeline`, `dashboard`, `agent-cards`, `status-bar` |
| Gates | `inbox`, `review`, `toast-review` |
| Betrieb | `orchestra` (Roster, Budget, Daemon), `mcp-servers`, `marketplaces`, `docker`, `worktree` |

## Nicht das Ziel

- Chat als primäre Fläche. Transkripte sind Beweismittel, nicht Oberfläche; gelesen wird das Artefakt.
- Agent-zu-Agent-Verhandlung als Koordinationsmechanismus.
- Ein generisches Multi-Agent-Framework oder eine Cloud-Control-Plane.
- Vollautonomie ohne Freigabepunkte.

## Woran der POC gemessen wird

1. Ein Auftrag läuft von Quests bis Merge, ohne dass der Mensch ein Terminal öffnet.
2. Jede wartende Entscheidung erscheint genau einmal in der Inbox — und keine verschwindet.
3. Kosten und Budget sind sichtbar und greifen wirklich (kein „angehalten", das nicht angehalten hat).
4. Ein neuer Mod lässt sich anbinden, ohne eine zweite Wahrheit zu erzeugen.

Herkunft der Prinzipien: `docs/factory-research.md` (Harness, WIP an der Prüfspalte, Spec-first, Freigabepunkte, Lernen pro Repo).
