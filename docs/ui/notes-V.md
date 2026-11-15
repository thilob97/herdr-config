# Notizen V: Roster v2 — Prompt und Harness je Agent

Branch `feat/roster-v2` (Basis `main`, `3611729`). Jeder Roster-Eintrag trägt jetzt
`prompt`, `harness`, `skills`, `mcp`, `sandbox`, `wip` und `permissions`; `hub dispatch`
baut daraus Programm, Flags, Prompt und Grenzen. Alte `agents/roster.json` bleibt lesbar:
`norm_agent` füllt die neuen Felder mit ihren Vorgaben (`prompt` =
`agents/prompts/<slug>.md`, `sandbox=worktree`, `wip=1`, `permissions` beide `false`).

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | Roster-Felder, Defaults und Normalisierung; `harness_flags`/`command_argv` (Tabelle je Programm); `prompt_path`/`read_prompt`/`write_prompt`; `agent add/edit` mit allen Feldern, `agent command`, `agent prompt`, `show` flach; Dispatch mit WIP-Gate, Prompt-Abschnitt, Umgebung und `harness` im Ticket; `harness` in `FIELDS` |
| `mods/orchestra/tickets.js` | `harness` in den Ticket-Feldern (Quests schreibt es mit, `published()` reicht es an die Panels) |
| `mods/teams/main.js` | Formular in den Abschnitten Rolle, Harness, Prompt, Umgebung, Grenzen; Prompt-Pfad und -Text mit „Datei speichern"; „Befehl anzeigen" sichert die Felder und zeigt `hub agent command` im Monospace-Block; Karte `WIP n/limit`; Detail zeigt Harness, Prompt, Skills/MCP, Sandbox, Grenzen |
| `agents/roster.json` | Zap, Ada, Mira mit Harness, WIP, Prompt-Pfad |
| `agents/prompts/{zap,ada,mira}.md` | Rollen-Prompts: Vorgehen, Belege, Grenzen |
| `docs/ui/notes-V.md` | diese Notizen |

## Kommando und Validierung

Programm-Tabelle in `HARNESS_KEYS`/`CLAUDE_PERMISSION`:

| Programm | Flags |
|---|---|
| `omp` | `--model`, `--smol`, `--slow`, `--models`, `--approval-mode`, `--max-cost`, `--no-lsp` |
| `claude` | `--model`, `--permission-mode` (`always-ask*`→`default`, `write`→`acceptEdits`, `yolo`→`bypassPermissions`) |
| `codex`, `pi` | `--model` |

Ein handgeschriebener Eintrag mit unbekanntem Programm (z. B. `true` im Wegwerf-Home)
startet dieses Programm und bekommt die omp-Flags; die CLI selbst lehnt unbekannte
Programme ab. `--max-cost 0` oder negativ, `--wip -1`, ein Approval-Modus außerhalb
`always-ask|always-ask-cached|write|yolo` und eine Sandbox außerhalb `worktree|repo`
enden mit `hub: …` und Exit 1. `--prompt` und `--prompt-file` schließen sich aus;
`--prompt` schreibt den Text in die (ggf. angelegte) Datei.

Der Prompt-Pfad ist relativ zum Repo des Agents; fehlt die Datei dort, liest `hub`
dieselbe relative Datei unter `HERDR_APP_HOME` (Test-Home, frischer Checkout). Erst
wenn beide fehlen, bricht der Dispatch mit dem vollen Pfad ab.

## Dispatch

`hub dispatch <ticket> --agent <Name>` startet `command_argv(agent)` ohne Zusatzflags,
die das Programm nicht kennt. Die Aufgabe bekommt vor dem Ticket:

```
Du bist Zap (Umsetzer).
Notizen: …
Modell: …

## Deine Rolle

<Prompt-Datei>

## Umgebung

Skills: ui, …
MCP: …
Grenzen: kein Push, keine Branches löschen
```

Danach folgen Tickettext und Lehren wie bisher. Das Ticket bekommt `agent: <Name>` und
`harness: omp --model=… --approval-mode=… --max-cost=…`.

Das WIP-Gate zählt `doing`-Tickets des Agents (`agent`, sonst `assignee`), ohne das
gerade gestartete Ticket. Bei `wip > 0` und erreichter Grenze verweigert der Dispatch:

```
hub: Test hat 1/1 Tickets in Arbeit: demo-1 (Demoticket); erst abschließen (hub done ID)
oder das Limit erhöhen (hub agent edit Test --wip N)
```

## Team-Hub

Formular-IDs für die Prüfung: `tm-f-color`, `tm-f-smol`, `tm-f-slow`, `tm-f-max-cost`,
`tm-f-models`, `tm-f-approval`, `tm-f-lsp`, `tm-f-prompt-path`, `tm-f-prompt`,
`tm-prompt-save`, `tm-f-branch`, `tm-f-skills`, `tm-f-mcp`, `tm-f-sandbox`, `tm-f-wip`,
`tm-f-push`, `tm-f-delete`, `tm-command`, `tm-command-out`. „Befehl anzeigen" ruft
zuerst `hub agent add/edit` mit dem Formularstand und dann `hub agent command`; der Block
zeigt also das Kommando des gespeicherten Stands. Karte: `WIP <doing>/<wip>` (`∞` bei 0)
und Kosten; Detail: Approval, Kostenlimit, Models, LSP, Prompt, Skills, MCP, Sandbox, WIP,
Grenzen.

## Prüfung

Wegwerf-Homes unter `/tmp/hubtest*`, `hc` als Stub, kein echter Agent gestartet.

- `hub agent command Zap`: `omp --model=opencode-go/deepseek-v4.1-flash`; nach
  `hub agent edit Zap --smol X --no-lsp --max-cost 5`:
  `omp --model=… --smol=X --max-cost=5 --no-lsp`.
- `hub agent add Test --prompt "Du prüfst." --wip 2 --approval-mode write` legt Eintrag
  und `agents/prompts/test.md` an; `hub agent show Test` zeigt alle Felder;
  `--approval-mode nope`, `--max-cost 0`, `--wip -1`, `--program nope`, `--sandbox nope`
  werden mit Klartext abgelehnt.
- `hub dispatch demo-1 --agent Test --no-worktree`: argv enthält
  `--model=m1 --approval-mode=write --max-cost=5 --no-lsp`; Aufgabe enthält
  `## Deine Rolle`, `Skills: ui`, `MCP: ctx`, `Grenzen: kein Push, keine Branches löschen`;
  Ticket: `agent: Test`, `harness: true --model=m1 --approval-mode=write --max-cost=5 --no-lsp`.
- Zweites `doing`-Ticket bei `wip 1`: Dispatch verweigert und nennt `demo-1 (Demoticket)`;
  `wip 2` startet, `wip 2` erreicht verweigert mit beiden IDs; fehlende Prompt-Datei bei
  `wip 0`: `hub: Prompt-Datei fehlt: …`.
- `python3 mods/orchestra/test/hub_cleanup_test.py`: 8 Tests, OK.
- `herdr-app check mods/teams`, `herdr-app check mods/orchestra`: `check passed`.
- Testfenster `~/.herdr/ui-preview/feat-roster-v2` (eigener Core, Demo-Welt), Belege in
  `/tmp/ui-roster2/`: `list.png` (Karten mit WIP/Kosten, Detail mit Harness/Grenzen),
  `form-top.png` (Rolle/Harness), `form-lower.png` (Prompt/Umgebung/Grenzen),
  `command.png` (gespeichertes Kommando `omp --model=… --slow=… --models=… --approval-mode=write --max-cost=5`).
  Die unteren Formularabschnitte sind im Test-Home per `mt(-…)` in den Ausschnitt
  geschoben; der Worktree enthält diese Verschiebung nicht. Keine UI-Fehler im
  `herdr-app status` (`"errors": []`), Testfenster beendet.

## Offen

- Ein gesetztes Kostenlimit lässt sich im Formular nicht leeren: der Hub lehnt
  `--max-cost 0` ab, also bleibt der alte Wert stehen. Ein `--no-max-cost` fehlt.
- Das Formular ist länger als das 680-px-Fenster; die Abschnitte liegen im Scrollbereich
  der rechten Spalte.
- `hub agent command` liest den gespeicherten Stand; ungespeicherte Felder erscheinen
  erst nach „Speichern"/„Befehl anzeigen" (letzteres sichert vorher).
