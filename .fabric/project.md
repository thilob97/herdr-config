# herdr-app – Projekt-Steckbrief

## Zweck
Persönliche Herdr-Konfiguration (`~/.config/herdr-app`) plus **Fabric**: Der Mensch schreibt ein Ticket in einem Satz, der Orchestrator formuliert und verteilt, Agenten arbeiten und sprechen sich ausschließlich im Ticket ab. `@name` weckt den Genannten. Konzept: `docs/concept.md`.

## Nutzer
Ein Mensch (Thilo) als Auftraggeber und Abnehmer, dazu die Agenten aus `fabric/roster.json`: Orchestrator, Umsetzer `zap`, Prüferin `ada`.

## Architektur kurz
- CLI `fab`: `fabric/fab` mit `fabric/fablib/*.py`, Python 3, nur stdlib. Speicher ist SQLite unter `data/fabric/fabric.db` (nicht getrackt).
- Prompts und Roster: `fabric/prompts/`, `fabric/roster.json`.
- Mods (JS, Herdr-Mod-API): `mods/fabric/` (Fenster mit Tickets, Inbox, Timeline, Workflows, Pipelines, Repos, Team), `mods/fabric-sidebar/`, `mods/fabric-toast/`, `mods/agents-filtered/`.
- Workflows: `fabric/flows/*.json` (Engine `fabric/fablib/flows.py`).
- Vertrag für Daten, CLI, Wecken und Mod: `docs/fabric.md`; UI: `docs/fabric-ui.md`.

## Wichtige Befehle
```sh
.fabric/verify.sh                          # gesamter Nachweis (Schritte aus .fabric/pipeline.json)
python3 fabric/tests/run_parallel.py       # Python-Tests parallel
node --test mods/fabric/test/              # Mod-Tests
herdr-app check mods/fabric                # Mod prüfen
fab preview start|shot|stop ID             # UI-Nachweis je Worktree
```

## Konventionen
- Sprache in Code-Kommentaren, Ausgaben und Doku: Deutsch.
- Logik-Änderungen (`fabric/fablib/*.py`, `mods/*/*.js` außer `views/`) brauchen einen geänderten Test; `fab handover` erzwingt das.
- UI-Kriterien werden per Screenshot über `fab preview shot` belegt.
- Tests hängen nicht an der Wanduhr (`FAB_NOW`).
- Dateien unter `.fabric/` committet `fab` selbst.
- Regeln für Herdr, Mods, Layouts und Keys: `AGENTS.md`. Hier werden sie nicht wiederholt.

## Tabus
- Arbeit für Agenten läuft nur über `fab`-Tickets, nicht über Chat oder interne Subagenten.
- Kein Merge und kein Push durch Agenten. `fab accept` gehört dem Menschen.
- Keine Abhängigkeiten außerhalb der stdlib für `fab`.
- `data/`, `telemetry/` und Laufzeitdateien wie `*.sock` werden nicht committet.

## Links
- Repo: https://github.com/thilob97/herdr-config
- Lehren: `.fabric/lessons.md` · Entscheidungen: `.fabric/decisions.md`
- Recherche: `docs/factory-research.md` · QA-Läufe: `docs/qa/`