# Kronen-Erkennung mit Namenspräfix, Doku-Korrekturen

Ticket `ux-8-kronen-erkennung-mit-namensprafix-d`. `hub` erkennt einen Orchestrator
schon länger am Label **oder** am Namen (`orchestrator`, `orchestrator-<space>`, siehe
`is_orchestrator` in `mods/orchestra/bin/hub`); die UI-Mods kannten nur das Label und
den exakten Namen. Ein Terminal `orchestrator-xyz` ohne Labels bekam deshalb keine
Krone.

## Eine Regel

Orchestrator ist ein Terminal, wenn

1. `labels["hub.role"] === "orchestrator"` (so setzt `hub orchestrator start` es), oder
2. sein Name `orchestrator` ist, oder
3. sein Name mit `orchestrator-` beginnt (der Space-Name folgt).

Der Helfer steht im Master `mods/orchestra/ui.js`:

```js
export function isOrchestrator(t) {
  if (!t) return false;
  if (t.labels?.["hub.role"] === "orchestrator") return true;
  const name = String(t.name ?? "");
  return name === "orchestrator" || name.startsWith("orchestrator-");
}
```

Alle elf `mods/*/ui.js` sind byte-identisch (`md5 mods/*/ui.js`).

Benutzt wird er in:

| Datei | Stelle |
|---|---|
| `mods/orchestra/orchestrator.js` | `find()`, `all()` |
| `mods/status-bar/main.js` | `orchestratorHere()` (Budget der Fabrik) |
| `mods/tabs-graph/main.js` | `orchestration()` (Krone), `inboxCount()` (wartender Orchestrator) |

Die drei Klone `mods/agent-cards`, `mods/tabs-graph` und `mods/space-folders` sind
Kopien ausgelieferter Mods und halten ihre Tokens selbst; sie haben keine `ui.js`-Kopie
(Herdr lädt kein Modul über Mod-Ordner hinweg). Dort steht dieselbe Zwei-Zeilen-Regel
lokal, mit Verweis auf `ui.isOrchestrator`:

```js
const isOrchestrator = (x) => x.labels?.["hub.role"] === "orchestrator"
  || x.name === "orchestrator" || String(x.name ?? "").startsWith("orchestrator-");
```

`mods/launcher/main.js` prüfte den Präfix bereits selbst und bleibt unverändert.

Dieses Dokument ersetzt den Abschnitt „Erkennung“ in `docs/ui/notes-ORCH-MARK.md`;
Zeichen, Flächen und die Herkunft von Tab und Space gelten weiter.

## Doku-Korrekturen

- **`README.md`**, Auftrag/„Ans Team“: der Sendeweg ist die **Adresse** des
  Orchestrators dieses Workspace (`hub orchestrator list --json` → `terminal`,
  dann `hc send <address>`), nicht `hc send orchestrator` per Name — der trifft in
  einem Haus mit mehreren Fabriken den falschen. Der Launcher macht es so.
- **`docs/ui/notes-SPACE-UI.md`**: `hub orchestrator start --space <id> --json` →
  ohne `--json`; das Kommando kennt den Schalter nicht (Exit 2) und druckt immer JSON.
- **`docs/ui/notes-SPACE.md`**, Vertrag `hub spaces --json`: `kind`
  (`workspace`/`agent`), `workspace` und `cost_open` (nur Tickets außer `done`)
  ergänzt, mit Verweis auf `notes-SPACE-FIX.md`.

## Prüfen

```sh
docs/ui-preview.sh up
docs/ui-preview.sh sync
for m in orchestra status-bar tabs-graph space-folders agent-cards; do docs/ui-preview.sh check $m; done
md5 mods/*/ui.js
docs/ui-preview.sh shot orch-tabs
```

Beleg im Test-Home: ein Terminal `orchestrator-xyz` **ohne** Labels
(`hc run --name orchestrator-xyz …`) trägt die Krone in Tab-Leiste, Spaces-Liste und
Agent-Karte. Screenshots unter `/tmp/ui-orchfix/`. Testfenster danach
`docs/ui-preview.sh down`.
