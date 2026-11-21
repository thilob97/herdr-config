# herdr-config

Meine Herdr-Konfiguration (`~/.config/herdr-app`) und die **Fabric**: ein Ticket schreiben, der Orchestrator formuliert und verteilt, Agenten sprechen sich im Ticket ab, eine `@erwähnung` weckt den Genannten, alles ist sichtbar.

- Konzept: `docs/concept.md`
- Vertrag (Daten, CLI, Wecken, Mod): `docs/fabric.md`
- Alter POC-Stand: Git-Tag `archive/poc-v1`

## Teile

| Teil | Ort |
|---|---|
| CLI `fab` | `fabric/fab` (Python 3, nur stdlib), Symlink `~/.local/bin/fab` |
| Roster und Prompts | `fabric/roster.json`, `fabric/prompts/` |
| Mod `fabric` (Tickets, Inbox, Timeline) | `mods/fabric/` |
| Layout | `layouts/fabric.json` |
| Daten | `data/fabric/` (SQLite `fabric.db`, Lesemodelle, Sicherungen; nicht getrackt) |

## Benutzen

```sh
fab new "Ein Satz, was passieren soll" --repo ~/code/projekt   # weckt den Orchestrator
fab list
fab show T-1
fab comment T-1 --from mensch "@zap bitte …"                  # weckt zap
fab tick                                                       # Stillstand beheben
fab accept T-1                                                 # Merge nach Prüfung
```

Im Layout `fabric`:

| Taste | Wirkung |
|---|---|
| `cmd-shift-n` | Neues Ticket |
| `cmd-shift-1` | Tickets-Panel ein/aus |
| `cmd-shift-2` | Timeline-Panel ein/aus |

Die Inbox steht in der Seitenleiste unter den Agents.

Ein Repo braucht `.fabric/verify.sh` für `fab verify`.

## Prüfen

```sh
python3 -m unittest discover -s fabric/tests -t .
node --test mods/fabric/test/
herdr-app check mods/fabric
```

Für UI-Nachweise je Ticket-Worktree: `fab preview start ID` startet eine eigene Instanz unter `/tmp/fab-preview/<ID>/` mit kopierten Einstellungen, Mods und CLI, privatem `HOME` und eigenem Core (Demo-Ticket statt echter Daten). `fab preview shot ID` legt ein PNG an und hängt es wie `fab attach` an (Akteur: `--from`, sonst `assignee`, sonst `mensch`); `fab preview stop ID` beendet App und Core und entfernt das Verzeichnis.

## Regel für Arbeit an diesem Repo

Arbeit, die an Agenten geht, läuft ausschließlich über `fab`-Tickets (`fab new` → Orchestrator → Agent im Worktree → `handover` → `accept`). Keine Nebenwege über interne Subagenten oder Chat.
