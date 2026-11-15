# Fabrik-Research: was wir übernehmen

Stand: 2026-11-15. Quellen unten; jede Zeile „angewendet" verweist auf ein Ticket oder eine Datei.

## 1. Agent = Modell + Harness

Addy Osmani und die LangChain-Beiträge trennen **inner harness** (Agent-Loop, Tools, Systemprompt des Anbieters) von **outer harness** (unsere AGENTS.md, Skills, MCP-Server, Berechtigungen, Verifikation). Was wir verbessern können, ist ausschließlich der outer harness — und der gehört zum Agenten, nicht zum Ticket.

**Angenommen:** Jeder Roster-Agent bekommt einen eigenen Prompt (`agents/prompts/<name>.md`), eigene Harness-Parameter (Modell, kleines/schnelles Modell, Approval-Modus, Kostenlimit) und eine Umgebungsbeschreibung (Skills, MCP-Server, Repo, Branch-Präfix). `hub dispatch` baut daraus das Startkommando, statt für alle `omp` ohne Profil zu starten.

## 2. Modell-Routing statt „ein Modell für alles"

LangChain: „viele Aufgaben brauchen kein Frontier-Modell". Zusätzlich: der Reviewer soll ein **anderes** Modell als der Umsetzer nutzen, damit Fehler nicht mitdieselbe Blindstelle teilen.

**Angenommen:** `model`, `smol`, `slow` je Agent; `hub review-start` wählt weiter ein anderes Programm/Modell als der Umsetzer; die Rolle (Umsetzer/Prüfer/Recherche) bestimmt die Voreinstellung.

## 3. WIP-Limits gehören an die Prüf-Spalte

Scrum.org, FocusClaw und Yeret sind sich einig: Agenten produzieren schneller, als Menschen prüfen; der Stau entsteht vor **Review/QA**, nicht in der Umsetzung. WIP zählt Arbeitseinheiten (Spec/Ticket), nicht Agenten oder Personas.

**Angenommen:** Konfigurierbare Limits für „In Arbeit" (Standard 3) und „Prüfung" (Standard 2). `hub dispatch` verweigert den Start über dem Limit der Zielstufe; das Board zeigt `2/3` im Spaltenkopf und färbt den Kopf, wenn das Limit erreicht ist; `hub wip` zeigt und setzt die Limits. Nacharbeit zählt nicht als neue Einheit.

## 4. Spec-getriebene Arbeit mit Abnahmekriterien

GitHub Spec Kit und Microsoft: erst Konstitution/Spec, dann Plan, dann Aufgaben, dann Umsetzung; ohne geschriebene Abnahmekriterien wird die Prüfung zur Geschmacksfrage.

**Angenommen:** Ein Ticket ohne Abschnitt „Abnahmekriterien" kommt nicht in `dispatch` (Meldung nennt `hub spec <id>`); `hub spec <id>` legt/öffnet Ziele-, Abnahme- und Grenzen-Abschnitte als Vorlage. Der Reviewer hakt genau diese Kriterien ab (steht schon in der Prüfstation).

## 5. Explizite Freigabepunkte statt stiller Autonomie

Nebula/WSO2: Pipelines ohne Checkpoints brechen an der schwächsten Stufe; Freigaben gehören an die Stellen mit Nebenwirkungen.

**Angenommen:** Freigaben (Mensch) nur an drei Stellen: Abnahme (Ticket `review`), Berechtigungsfrage eines Agenten (`blocked`), Landen (Merge/PR). Alles davor ist maschinell belegt (`hub verify`, Prüfstation, `hub ci`). Das Dashboard führt genau diese Punkte unter „Wartet auf dich".

## 6. Evals und Lernen pro Repo

LangChain: Trace-Analyse fand als häufigste Fehler „nicht getestet", „Anweisung nicht befolgt", „Zeitlimit". Wir haben dieselben Fehler in dieser Session gesehen (Agent berichtet ohne Commit, veraltete Basis, zu viel Politur).

**Angenommen:** `hub lesson` (schon da) wird aus Abnahmen, Review-Befunden und CI-Fehler gespeist und geht in jeden Dispatch; `hub stats` zeigt Nacharbeit und Prüfrunden — die zwei Zahlen, die Harness-Fehler sichtbar machen.

## Quellen

- Addy Osmani, *Agent Harness Engineering* — https://addyosmani.com/blog/agent-harness-engineering
- LangChain, *How to Build a Model Router in the Harness* — https://www.langchain.com/blog/how-to-build-a-model-router-in-the-harness
- LangChain, *Improving Deep Agents with harness engineering* — https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
- ai-agent-guidebook, *Harness engineering* — https://github.com/ai-curriculum-project/ai-agent-guidebook/blob/main/best-practices/harness-engineering.md
- Scrum.org, *WIP Limits in Scrum with Kanban* — https://www.scrum.org/resources/blog/wip-limits-scrum-kanban-essential-regulator-ai-age
- FocusClaw, *AI Agent WIP Limits* — https://focusclaw.app/blog/ai-agent-wip-limits
- Yuval Yeret, *Do WIP Limits Still Make Sense When Agents Write the Code?* — https://yuvalyeret.com/blog/calculate-kanban-wip-limits-ai-age
- GitHub Spec Kit, *Quickstart* — https://github.github.com/spec-kit/quickstart.html
- Microsoft for Developers, *Spec-Driven Development* — https://developer.microsoft.com/blog/spec-driven-development-ai-native-engineering
- Nebula, *Multi-agent orchestration patterns* — https://www.nebula.gg/blog/multi-agent-orchestration-patterns
- TrueFoundry, *Die Agentic Software Factory erklärt* — https://www.truefoundry.com/de/blog/software-factory-agentic-enterprise-guide
