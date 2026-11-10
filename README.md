# herdr-config

Meine Konfiguration für die [Herdr](https://herdr.dev) Desktop-App. Das Repo ist direkt `~/.config/herdr-app`.

## Regel für Agents

Nach **jeder** Änderung an dieser Config sofort committen und pushen (`git add -A && git commit && git push`).

Neue Panel-Mods (Seitenleisten wie Git-Graph, Timeline) **nicht** als eigene Spalte andocken, sondern in die Leiste oben neben Files/Changes:

1. In `layouts/elric.json` dem Stack `panel-body` ein Kind geben: `{ "id": "<id>", "type": "block", "content": { "mod": "<mod>" } }`.
2. In `mods/tabs-graph/main.js` die ID in die Liste `enabled` aufnehmen und eine Zeile `.child(panelButton("<id>", "<Label>", "mods/<mod>/<icon>.svg"))` nach den bestehenden Buttons ergänzen.
3. In der `mod.json` des Mods `"place": "none"` setzen, und einen Block, den Herdr selbst angedockt hat, aus dem Layout entfernen.

Forge ist entfernt: Es gibt keinen Forge-Button, keine Forge-Tastenbelegung und keine `forge-*`-Mods oder Forge-Ansicht mehr. Git-Graph und Tree bleiben als Panels erhalten. Bereits vorhandene Forge-Laufzeitdaten und externe Backend-Caches werden nicht gelöscht.

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

## Bereinigte Mod-Installation

Aktiv ist `elric`. Die sechs eigenen Addons sind **blueprint**, **filetree**, **file-icons**, **git-graph**, **space-folders** und **tabs-graph**. `tabs-graph` ist ein frischer Klon der mitgelieferten `tabs`-Mod **0.1.14**; seine Buttons **Changes**, **Git**, **Tree** und **Blueprint** wählen Panels im bestehenden Stack `panel-body`, ohne zusätzliche Spalten. Timeline und Usage sind nicht mehr eingebunden.

Die alten Installationen von `open-with`, allen 16 `over9k*`-Mods und `usage-limits` sowie das Over9k-Layout samt Vorschau und Tastenbelegungen wurden entfernt. Die fünf externen Addons wurden sauber aus folgenden Quellen neu installiert; vorhandene Lizenzen liegen bei den Mods. Nicht angegebene Release-Versionen sind durch den vollständigen Commit gepinnt.

| Addon | Quelle | Version / Commit |
|---|---|---|
| `blueprint` | [chappse6/herdr-blueprint-app](https://github.com/chappse6/herdr-blueprint-app), `mods/blueprint` | 0.3.5 · `9e6533ace80e392a14311ad05c1dbda10696deda` |
| `filetree` | [cybertron288/herdr-mods](https://github.com/cybertron288/herdr-mods), `filetree/mods/filetree` | `34e7c3348e954fd0a1147b846898db8c3e37e526` |
| `file-icons` | [cybertron288/herdr-mods](https://github.com/cybertron288/herdr-mods), `file-icons/mods/file-icons` | `34e7c3348e954fd0a1147b846898db8c3e37e526` |
| `git-graph` | [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph), `mods/git-graph` | 0.3.2 · `2f4fe0fc22e7cc726f3c1a2a654887c96227c37b` |
| `space-folders` | [jankeesvw/herdr-space-folders](https://github.com/jankeesvw/herdr-space-folders), `mods/space-folders` | `63a78b20d5ed30d57166a3c7165a6eb558c3ef84` |
| `tabs-graph` | Lokal aus Herdrs mitgeliefertem `tabs` geklont, Panel-Buttons ergänzt | 0.1.14 |

**Erhalten:** Nutzerdaten unter `data/` einschließlich Blueprint-Diagrammen, Sitzungen, `shared.json`, `view.json`, `settings.json`, `programs.json`, Mod-Laufzeitdaten und `filetree/config.json`. Externe Ordnerdateien (auch `~/.config/herdr-space-folders.json` in WSL) und der alte externe Claude-Statusline-Hook bleiben unberührt. Die vorhandenen reinen Typreste von `herdr-mod-manager` und `claude-status` sind unverändert, aber keine ausführbaren Installationen. Sicherung vor der Bereinigung: `C:/Users/tbarth/.config/herdr-app-before-cleanmods-20261109-02.tar.gz`.

**Nachweis:** Alle sechs `herdr-app check`-Prüfungen waren erfolgreich. Die Invariantenprüfung bestätigt 27 ausführbare Mods (21 mitgelieferte und sechs eigene) sowie das Fehlen der entfernten Mod-Verzeichnisse und Referenzen. Ein Screenshot bestätigt das Rendering von Tree, gruppierter Seitenleiste und Toolbar. Git-Operationen, Browser-Aktionen und Agent-Prompting wurden damit nicht getestet; neue Tests wurden nicht angelegt. Es wurden keine Agent-Prompts gesendet, Hooks registriert oder Installationsskripte ausgeführt.

**Plattformgrenzen:** SpaceFolders benötigt POSIX-`sh` und entsprechende Werkzeuge für die Ordnerpersistenz. Git-Graph benötigt Git; Manygit wird unter nativem Windows nicht unterstützt. Git-Graph und Blueprint können upstream automatisch öffentliche Versionsmetadaten abfragen; das ist keine automatische Neuinstallation. Die WSL-Grenze von Blueprint ist unten beschrieben.

## Blueprint-Panel

Installiert aus [chappse6/herdr-blueprint-app](https://github.com/chappse6/herdr-blueprint-app/tree/master), Version **0.3.5**, Commit `9e6533ace80e392a14311ad05c1dbda10696deda` (MIT, Lizenz unter `mods/blueprint/LICENSE`). Native Mod ohne Backend oder Paketinstallation; Herdr ≥ 0.1.10. Im aktiven **elric**-Layout öffnet der Button **Blueprint** in der Leiste neben Changes, Git und Tree das vorhandene Seitenpanel im Stack `panel-body`; keine neue Spalte, Layout-Umschaltung oder globale Tastenbelegung. Alternativ:

```powershell
herdr-app do layout.select --stack panel-body --child blueprint
herdr-app do layout.show --id panel
```

Öffnen allein sendet keinen Prompt. **Connect**, neue Diagramme und **Send** senden über `hc send` an den ausgewählten Agenten und können Agent-Tokens/Kosten verursachen; Änderungen aus dem Diagramm können auch Codeänderungen anfordern. OMP wird über Herdrs allgemeine Agent-/Programmerkennung im aktiven Tab angeboten, nicht über einen eigenen OMP-Adapter. Keine Demo-Diagramme oder Agent-Prompts werden bei der Installation erzeugt.

Die Mod fragt lokal mit Git den Projektordner ab und speichert Mermaid-Dateien sowie Projekt-/Agent-Metadaten unter `data/blueprint/projects/`. Ungepinnte Diagramme werden nach sieben Tagen automatisch gelöscht; nach einem Tag bleiben höchstens zehn ungepinnte Diagramme. Die automatische GitHub-Versionsabfrage lädt nur Metadaten, keine Updates; `herdr-app do blueprint.update-check-off` schaltet sie ab (`blueprint.update-check-on` wieder an). Ein ausdrücklich ausgelöstes Update sendet dagegen einen Update-Auftrag an den Agenten. Sprache kommt automatisch aus `~/.claude/settings.json`; `blueprint.lang-auto`, `blueprint.lang-en`, `blueprint.lang-ko` und `blueprint.lang-ja` steuern sie über `herdr-app do`. Eigene Einstellungen: `blueprint.lang` und `blueprint.update`. PNG-Export ist nur unter macOS verfügbar.

**Windows/WSL-Grenze:** Speicherung und Git-Projektabfrage erfolgen auf dem lokalen Windows-Host. An Agenten werden Windows-Diagrammpfade gesendet; eine Übersetzung/Übertragung nach WSL oder auf entfernte Herdr-Maschinen ist upstream nicht implementiert. Die Panel-Installation stellt deshalb keine vollständige Remote-/WSL-Zeichenfunktion bereit. Die eingebauten Befehle `blueprint.add-button` und `blueprint.remove-button` nicht verwenden: Sie ersetzen das Layout bzw. klonen Standard-Tabs statt dieser `elric`-/`tabs-graph`-Integration.

## Quests

Eigene Mod `quests`: Tickets aus GitHub Issues (`gh`, Repos der Spaces plus Liste in den Einstellungen), Asana (PAT), Trilium (ETAPI, Suche Standard `#quest`) und lokalen Markdown-Tickets (`data/quests/tickets/*.md` mit Frontmatter `title`, `status` todo/doing/done, `repo`, `labels`, `due`). Panel **Quests** in der Leiste oben (Stack `panel-body`), ganze Seite = Layout `quests` (Quellen | Liste | Detail + Start, „Back to Elric“); `ctrl-shift-q` wechselt zwischen `elric` und `quests`.

**Start:** Space/Maschine wählen, Branch (`feat/…` oder `fix/…` nach Labels, editierbar), optional Worktree unter `~/.herdr/worktrees/<repo>/<branch>` auf der Maschine des Space (eigener Space wie beim mitgelieferten `worktree`-Mod), Agent aus `knownAgents` (Standard omp) oder freies Kommando, erste Nachricht aus Vorlage. Gestartet wird über `herdr-app do space.new|tab.new` (liefert Space/Tab/Terminal-IDs), festgehalten in `data/quests/started.json`; Karten zeigen den Agent-Status. **Writeback** (pro Start abschaltbar, global „Dry run“): GitHub Kommentar + `--add-assignee @me`, Asana Kommentar, Trilium Labels `questStatus=doing` und `questBranch=<branch>`, lokal `status: doing`.

Zugangsdaten nur in `data/quests/settings.json` (git-ignoriert), Eingabe in den Einstellungen der Mod; Tokens werden nie wieder angezeigt und in Fehlermeldungen maskiert.

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
