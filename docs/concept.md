# Kernkonzept: die Mods als Agentic Software Fabric

**Ein Satz:** Du schreibst ein Ticket. Der Orchestrator formuliert es aus, zerlegt es und weist es den Agenten zu. Die Agenten arbeiten, fragen und verhandeln **im Ticket** und taggen sich gegenseitig. Alles davon ist sichtbar, durchsuchbar und nachvollziehbar — weil es nur einen Ort gibt, an dem es passiert.

Die Mods sind der POC für diese These: keine Sammlung von Agent-Monitoren, sondern eine operierbare Fabrik auf `hub`/`hc`, in der das Ticket Oberfläche, Kanal und Protokoll zugleich ist.

## Sechs Prinzipien

1. **Der Work Order ist das dauerhafte Objekt.** Tickets tragen Identität, Zustand, Verlauf, Abnahme und Nachweise. Agenten, Sessions und Modelle sind austauschbar; ein Ticket überlebt jeden Agenten.
2. **Das Ticket ist der einzige Kanal — auch zwischen Agenten.** Arbeit, Frage, Blocker, Übergabe und Absprache stehen als Kommentar im Ticket (`hub ticket comment --from <rolle>`, `@name` taggt). Agenten reden nicht aneinander vorbei und nicht im Chat: sie reden im Ticket. Neue Arbeit ist ein neues Ticket mit `--blocked-by`, keine Nachricht.
3. **Eine Erwähnung weckt.** `@name` in einem Ticket-Kommentar ist kein Etikett, sondern ein Auftrag: der genannte Agent wird angestoßen und arbeitet an diesem Ticket weiter — liest den Verlauf, antwortet im Ticket, macht seinen Teil. Läuft er nicht, übernimmt der Orchestrator den Anstoß (starten oder zuweisen). `@mensch` landet in der Inbox. Jeder Anstoß ist selbst ein sichtbares Ereignis; Schutz gegen Ping-Pong und Budget-Stopps gilt auch hier.
4. **Der Orchestrator formuliert und verteilt, der Mensch entscheidet.** Der Mensch gibt den Auftrag (ein Satz reicht); der Orchestrator macht daraus Ziel, Kontext, Abnahmekriterien, legt Abhängigkeiten und weist zu. Freigaben des Menschen nur an drei Stellen: Abnahme, Rückfrage, Landen. Alles davor ist maschinell belegt.
5. **Sichtbarkeit ist keine Funktion, sondern Folge.** Weil jede Handlung ein Ticket-Ereignis ist, entsteht Monitoring beim Arbeiten: Wer hat was gesagt, wer hat wen geweckt, wer wartet auf wen, welche Runde, welcher Blocker, welche Kosten. Graph, Timeline, Board, Inbox und Team-Panel lesen dieselbe Wahrheit — keine separate Telemetrie, keine Schattenkanäle.
6. **Eine Zahl, eine Wahrheit.** Pipeline-Stufe, Inbox-Zähler, Identität und Kosten kommen aus einer Quelle (`shared("orchestra.tickets")`, `shared("agents.identity")`, `hub status`). Jede Oberfläche zeigt dieselbe Zahl — sonst ist sie wertlos.

## Der Fluss, den das Konzept meint

```
Mensch: ein Satz
   → Orchestrator: Ticket mit Ziel, Abnahmekriterien, Abhängigkeiten
   → Zuweisung an Agent(en); Agent fragt/taggt im Ticket
   → Agenten untereinander: @name im selben Ticket weckt den Genannten, Verlauf ist die Akte
   → Prüfstation + verify belegen maschinell
   → Mensch: Abnahme / Merge
```

Jeder Pfeil ist ein Ticket-Ereignis und damit im Verlauf, im Graph und in der Timeline sichtbar.

## Was die Mods dafür sind

| Rolle | Mods |
|---|---|
| Eingang | `launcher` (Auftrag), `quests` (Quellen) |
| Fluss | `board`, `tabs-graph` (Pipeline), `teams` |
| Aufsicht | `graph`, `timeline`, `dashboard`, `agent-cards`, `status-bar` |
| Gates | `inbox`, `review`, `toast-review` |
| Betrieb | `orchestra` (Roster, Budget, Daemon), `mcp-servers`, `marketplaces`, `docker`, `worktree` |

## Nicht das Ziel

- Agent-Absprachen außerhalb des Tickets (Chat, Direktnachrichten, Seitenkanäle). Im Ticket ist genau das erwünscht.
- Chat mit dem Menschen als primäre Fläche. Gelesen wird das Artefakt, nicht das Transkript.
- Ein generisches Multi-Agent-Framework oder eine Cloud-Control-Plane.
- Vollautonomie ohne Freigabepunkte.

## Woran der POC gemessen wird

1. Ein Auftrag in einem Satz führt zu einem ausgearbeiteten, zugewiesenen Ticket — ohne dass der Mensch ein Terminal öffnet.
2. Jede Agent-zu-Agent-Absprache steht im Ticket und ist ohne Rückfrage auffindbar.
3. Jede wartende Entscheidung erscheint genau einmal in der Inbox — und keine verschwindet.
4. Kosten und Budget sind sichtbar und greifen wirklich.
5. Ein neuer Mod lässt sich anbinden, ohne eine zweite Wahrheit zu erzeugen.

Herkunft der Prinzipien: `docs/factory-research.md` (Harness, WIP an der Prüfspalte, Spec-first, Freigabepunkte, Lernen pro Repo).
