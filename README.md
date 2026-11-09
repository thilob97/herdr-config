# herdr-config

Meine Konfiguration für die [Herdr](https://herdr.dev) Desktop-App. Das Repo ist direkt `~/.config/herdr-app`.

## Regel für Agents

Nach **jeder** Änderung an dieser Config sofort committen und pushen (`git add -A && git commit && git push`).

Neue Panel-Mods (Seitenleisten wie Git-Graph, Timeline) **nicht** als eigene Spalte andocken, sondern in die Leiste oben neben Files/Changes:

1. In `layouts/main-folders.json` dem Stack `panel-body` ein Kind geben: `{ "id": "<id>", "type": "block", "content": { "mod": "<mod>" } }`.
2. In `mods/tabs-graph/main.js` die Liste `extra` um `["<id>", "<Label>", "<icon.svg>"]` ergänzen.
3. In der `mod.json` des Mods `"place": "none"` setzen, und einen Block, den Herdr selbst angedockt hat, aus dem Layout entfernen.

Mods, die das ganze Fenster übernehmen (z. B. Forge), bekommen keinen Panel-Eintrag, sondern einen Button rechts hinter dem Trennstrich in `mods/tabs-graph/main.js` (wie `open-forge`).

## Was getrackt wird

| Datei | Zweck |
|---|---|
| `programs.json` | Ergänzt Herdrs eingebaute Programmtabelle (u. a. `omp` / Oh My Pi mit Name, Icon und Eintrag im +-Menü) |
| `settings.json` | Zoom, Fonts, Sounds |
| `keys.json` | Tastenbelegung |
| `layouts/`, `themes/`, `mods/` | Nur eigene Layouts, Themes und Mods, inkl. Klone und `*-edited`-Kopien |

## Was ignoriert wird

Die `.gitignore` ist eine Whitelist (`/*`, dann gezielt `!`). Ausgeschlossen sind:

- **Was Herdr selbst schreibt:** `AGENTS.md`, `*.d.ts`, `icons/`, `frame/`, `view.json`, `shared.json`, `data/`, `telemetry/`, Socket, Status-Dateien.
- **Ausgelieferte Layouts, Themes und Mods** (`main`, `terminals`, `win98`, die mitgelieferten Themes, alle Standard-Mods). Herdr überschreibt sie bei jedem Start.
- `layouts/.state/` (Klick-Einstellungen), `*.error`, `*.reset-*`, `*.old-*`.

## Hinweise

- Bringt ein Herdr-Update neue eigene Mods, Layouts oder Themes mit, tauchen sie als ungetrackte Dateien auf. Dann in der `.gitignore` ergänzen.
- Ausgelieferte Dateien nicht direkt ändern, sondern klonen:
  `herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`
  bzw. `herdr-app do mod.clone '{"name":"files","as":"my-files"}'`.
- Falls `keys.json` bei unveränderter Belegung ständig als geändert auftaucht, schreibt Herdr sie beim Start neu. Dann aus dem Repo nehmen.

## Auf einem neuen Rechner

Vor dem ersten Herdr-Start:

```sh
git clone https://github.com/thilob97/herdr-config.git ~/.config/herdr-app
```

Existiert der Ordner schon:

```sh
cd ~/.config/herdr-app
git init -b main
git remote add origin https://github.com/thilob97/herdr-config.git
git pull origin main
```

## OMP Chat

Der Einstieg **OMP Chat** in der Projekttabbar öffnet den nativen Chat aus `mods/omp-chat`. Dort lässt sich eine neue eigene RPC-Sitzung starten, eine eigene laufende Sitzung wieder anhängen oder eine gespeicherte Sitzung ausdrücklich **fortsetzen**. Maschine und Projektordner (`machine`/`cwd`) bleiben an die anfängliche Auswahl gebunden: lokales Windows oder die vorhandene WSL-Maschine `wsl` mit Distribution `Ubuntu-24.04` und Benutzer `thilo`. Ein späterer Projektwechsel leitet die Sitzung nicht um. Bestehende interaktive omp-Terminals werden weder übernommen noch beendet.

**Enter** fügt einen Zeilenumbruch ein, **Ctrl+Enter** sendet. Der Verlauf zeigt **Neueste oben**; manuelles Scrollen pausiert das Folgen, **Neue Nachrichten ↑** zeigt wieder die neuesten Einträge. Die Darstellung verwendet eine native Lazy-Liste statt WebView oder Herdr-/omp-Fork; die Reihenfolge „Neueste oben“ berücksichtigt die fehlende native AutoBottom-API. **Vor jedem Tool fragen** ist eine optionale Einstellung pro neuer Sitzung und ändert keine globale omp-Konfiguration.

**Tab schließen** trennt nur die Ansicht; der eigene Worker und die Bridge laufen weiter. Wiederverbinden sendet keine Prompts erneut. Nur die ausdrückliche Aktion **Sitzung beenden** beendet den betreffenden eigenen Worker.

Einmalig in Windows-PowerShell einrichten:

```powershell
node "$env:USERPROFILE\.config\herdr-app\mods\omp-chat\service.mjs" setup --app-home "$env:USERPROFILE\.config\herdr-app"
```

Die Einrichtung validiert Windows Node, die bestehenden Windows-/WSL-omp-Installationen und die Core-CLI `hc`; sie installiert diese nicht. Der Service läuft im Core und nutzt ausschließlich authentifiziertes Loopback. `data/omp-chat` enthält maschinenlokale Runtime- und Endpointdaten mit SID-basierten ACLs für den Benutzer und SYSTEM. Diese Daten bleiben lokal; **niemals Tokens einchecken**.
