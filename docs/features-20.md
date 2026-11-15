# 20 Feature-Ideen für die Fabrik — und die fünf, die zuerst kommen

Bewertung: **Wert** (1–5) · **Aufwand** (1–5, kleiner ist besser) · **Risiko** (1–5) · Auswahl `★` = sofort umgesetzt.

| # | Feature | Wert | Aufwand | Risiko | Idee |
|---|---|---|---|---|---|
| 1 | **Triage-Station** `hub triage` | 5 | 2 | 2 | ★ Aus einem rohen Signal (Titel/Text) wird ein startbares Ticket: Typ (bug/feature/chore) erkannt, Priorität und Größe geschätzt, Template (Ziel/Abnahme/Grenzen) ergänzt, Labels gesetzt. Ohne Triage kein Dispatch für Signale. |
| 2 | **Preflight** `hub preflight` | 4 | 2 | 1 | ★ Bevor ein Agent startet: Basis-Commit auschecken und `verify.sh` darauf laufen lassen. Rote Basis → kein Dispatch (spart ganze Agentenläufe). |
| 3 | **Stall-Wächter** `hub stalls` / `hub nudge` | 5 | 2 | 1 | ★ Tickets, die in einer Stufe hängen bleiben (In Arbeit > 45 min, Prüfung > 2 h, Geplant > 1 Tag), werden gelistet; `hub nudge` fragt den Agenten nach dem Stand und schreibt es ins Ticket. |
| 4 | **Nachtschicht** `hub night` | 5 | 3 | 3 | ★ Arbeitet die Warteschlange ab, solange niemand da ist: startet startbare Tickets, respektiert WIP-Limits und Spec-Gate, hört zu einer Uhrzeit auf, Protokoll im Ticket. |
| 5 | **Agent-Gedächtnis** `hub memory` | 4 | 2 | 1 | ★ Jeder Agent schreibt auf, was funktioniert hat und was nicht (`agents/memory/<name>.md`); der Dispatch hängt die letzten Einträge an. Anders als Lehren (pro Repo, aus Review) ist das Selbstwissen des Agenten. |
| 6 | Rollback `hub rollback` | 5 | 3 | 4 | Einen gelandeten Merge rückgängig machen, mit Verify davor/danach. |
| 7 | Auto-Changelog | 3 | 2 | 1 | Aus gemergten Tickets je Woche ein Changelog erzeugen. |
| 8 | SLA-Kennzahlen pro Stufe | 4 | 2 | 1 | p50/p90 Wartezeit je Stufe statt nur Gesamtmedian. |
| 9 | Inline-Review-Kommentare | 5 | 4 | 2 | Im Review-Fenster Zeile markieren, Kommentar ans Ticket, Agent arbeitet ihn ab. |
| 10 | Dependency-Graph | 3 | 3 | 2 | `blocked_by` als kleiner Graph im Team-Panel. |
| 11 | Nightly Evals | 4 | 4 | 3 | Golden Tasks pro Repo, nächtlich gegen den Agenten laufen lassen, Score im Dashboard. |
| 12 | Modell-A/B | 4 | 4 | 3 | Dasselbe Ticket zwei Modellen geben, Kosten/Zeit/Review-Score vergleichen. |
| 13 | Handoff-Notiz | 4 | 2 | 1 | Agent schreibt beim Abschluss „was geändert, was riskant"; der Prüfer liest sie zuerst. |
| 14 | Idea-Inbox (Hotkey) | 3 | 2 | 1 | Globale Taste schreibt eine Idee als Ticket in `todo` (ohne Repo-Bindung). |
| 15 | Benachrichtigungen (Telegram/Slack) | 3 | 3 | 2 | „Wartet auf dich" aufs Handy, Antwort direkt aus der Nachricht. |
| 16 | Repo-Templates | 3 | 2 | 1 | `hub ticket new --template bug|feature|chore` mit eigenen Vorlagen je Repo. |
| 17 | Board-WIP je Agent | 3 | 2 | 1 | Spaltenkopf zeigt belegte Agent-Slots, Karten zeigen WIP-Überschreitung. |
| 18 | Kosten-Trend + Alarm | 4 | 2 | 2 | Tageskosten je Agent, Alarm bei Ausreißer, Sparkline im Dashboard. |
| 19 | Ticket-Suche über alles | 3 | 2 | 1 | `hub find <text>` über Titel, Verlauf, Lehren, Gedächtnis. |
| 20 | Cross-Repo-Abhängigkeiten | 3 | 4 | 3 | Ticket in Repo A blockiert Ticket in Repo B, ein Board für beide. |

## Die fünf, die sofort gebaut werden

1. **Triage** (#1) — macht aus Signalen startbare Arbeit und ist Voraussetzung für alles Weitere.
2. **Preflight** (#2) — verhindert verbrannte Agentenläufe auf kaputter Basis.
3. **Stall-Wächter** (#3) — hält den Fluss; nutzt die Zeitstempel, die seit `status_at` da sind.
4. **Nachtschicht** (#4) — der größte Gewinn an Durchsatz, weil sie die Limits und Gates respektiert.
5. **Agent-Gedächtnis** (#5) — klein, aber es macht jeden Lauf besser als den vorigen.

Gemeinsam ist allen fünf: sie brauchen keinen neuen Speicher außer einer kleinen Datei, sie respektieren die vorhandenen Gates (Spec, WIP, Verify), und sie sind über `hub` testbar.

**Nicht jetzt:** Rollback (#6) braucht Sorgfalt bei Merge-Konflikten; Inline-Reviews (#9) und Evals (#11) sind eigene Projekte.
