# herdr-config

Meine Konfiguration für die [Herdr](https://herdr.dev) Desktop-App. Das Repo ist direkt `~/.config/herdr-app`.

## Regel für Agents

Nach **jeder** Änderung an dieser Config sofort committen und pushen (`git add -A && git commit && git push`).

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
