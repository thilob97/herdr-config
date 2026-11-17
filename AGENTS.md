# AGENTS.md — Einstiegspunkt

Diese Datei ist die **Karte**, nicht das Handbuch. Sie sagt, wo du nachsiehst, und
verweist in die README-Abschnitte statt sie ganz zu lesen.

Herdr schreibt eine eigene `AGENTS.md`; diese hier ist versioniert (`.gitignore` →
`!/AGENTS.md`). Wird sie überschrieben: `git checkout -- AGENTS.md`.

## Was das hier ist

Config-Repo der Herdr-Desktop-App — es **ist** `~/.config/herdr-app`. Aktives Layout
`elric` (Klon von `main`), daneben `dashboard`. 24 eigene Mods. Die Fabrik-Logik
steckt in `mods/orchestra/bin/hub` (~5.900 Zeilen Python), Hilfe dort über `hub help`.

## Drei Regeln

1. **Vor dem Bericht prüfen:** `bash .herdr/verify.sh` (schnell) bzw. `--full`.
   Ein grüner Lauf, der den geänderten Pfad nicht berührt, zählt nicht.
2. **Ausgelieferte Dateien nicht direkt ändern** — klonen:
   `herdr-app do mod.clone '{"name":"files","as":"my-files"}'`.
3. **Nach jeder Änderung committen und pushen** (so steht es in der README).

## Wo was liegt

| Frage | Datei |
|---|---|
| Layout, Tasten, Themes | `layouts/elric.json`, `keys.json`, `themes/` |
| Agenten-Roster, Prompts, Gedächtnis | `agents/roster.json`, `agents/prompts/*.md`, `agents/memory/*.md` |
| Fabrik-CLI, Gates, Tickets | `mods/orchestra/bin/hub` |
| Prüfungen | `.herdr/verify.sh`, `mods/*/test/`, `mods/orchestra/test/hub_*_test.py` |
| Warum es so ist | `README.md` — „Prüfungen", „Prüfstation", „Harness je Agent", „Fluss" |
| Recherche-Grundlage | `docs/factory-research.md` |

## Für Agenten einer Fabrik

Rolle und Grenzen stehen im jeweiligen Prompt (`agents/prompts/<name>.md`, gesetzt über
`agents/roster.json`). Dort gilt: Umsetzer committet klein und prüft, Prüfer ändert
nichts und belegt jeden Befund, Recherche schreibt Belege statt Code.
