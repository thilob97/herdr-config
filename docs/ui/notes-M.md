# Notizen M: Aufräumen (hub done/land/cleanup)

Branch `feat/cleanup` (Basis `main`). Nach der Abnahme bleiben Agent, Worktree und
Space nicht mehr liegen; `hub done` und `hub land` räumen auf, `hub cleanup` findet
Reste, die keiner mehr braucht.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | Aufräum-Routine (`cleanup_ticket`), `done`/`land` rufen sie; neues `hub cleanup [--dry-run]`; `hub status` meldet nur `done`-Tickets mit Resten; neue Felder `space`/`tab` beim Dispatch; `--keep-worktree`/`--keep-space` |
| `mods/orchestra/tickets.js` | `space`/`tab` überleben den Quests-Writeback (FIELDS) |
| `README.md` | Abschnitt „Aufräumen“, `hub done`-Beschreibung |
| `docs/ui/notes-M.md` | diese Notizen |

## Verhalten

`hub done <id>` und `hub land <id> --merge|--pr` rufen dieselbe Routine:

1. **Worktree prüfen.** Gehört er einem anderen Ticket (gleicher Pfad), wird er nicht
   angefasst. Hat er uncommittete Änderungen, bricht das ganze Aufräumen ab: kein
   `hc kill`, kein Space, keine Datei; die Meldung nennt Worktree und Grund. Nur ein
   sauberer, eingetragener Worktree wird mit `git worktree remove` entfernt.
2. **Agent beenden** mit `hc kill`, wenn sein Terminal lebt; ein fertiges Terminal
   wird nur aus dem Ticket genommen. Mit `--keep-space` bleibt der Agent stehen:
   Herdr schließt den Space, sobald sein letztes Terminal endet, ein toter Agent
   könnte ihn also nicht behalten.
3. **Space/Tab schließen.** Die IDs stehen seit dem Dispatch im Ticket (`space`,
   `tab`), sonst in den Labels `herdr.space`/`herdr.tab` am Terminal. Ein Space
   schließt nur, wenn alle seine Terminals zum Ticket gehören (oder tot sind). Gibt
   es ein fremdes lebendes Terminal, bleibt der Space; höchstens das eigene Tab
   schließt, und nur wenn kein fremdes Terminal darin sitzt. Danach fallen die
   Felder aus dem Ticket, damit `hub status` keinen Rest mehr behauptet.
4. **Branch bleibt** bei `done` und `--pr`; nur `land --merge` löscht ihn nach dem
   Merge (wie bisher). `--keep-worktree` lässt den Worktree stehen, `--keep-space`
   Space, Tab und Agent.

`hub cleanup [--dry-run]` sammelt zuerst alle Aktionen und führt sie dann in der
Reihenfolge Agents → Spaces → Worktrees aus:

- Agents mit `hub.ticket`-Label, die `done`/`idle`/`error` melden oder als Terminal
  beendet sind und seit über einer Stunde so stehen (`hc kill` bzw. `hc rm`);
- Spaces mit Ticket-Label oder `space`-Feld im Ticket, in denen nach den geplanten
  Agent-Aktionen kein lebendes Terminal mehr übrig ist;
- Worktrees unter `~/.herdr/worktrees/<repo>/<branch>`, die kein Ticket nennt; nur
  saubere, nur dieser Pfad. Ein fremder oder schmutziger Worktree wird mit Grund
  gemeldet und bleibt.

`--dry-run` druckt dieselbe Liste und schreibt weder Dateien noch `hc`/`herdr-app`.
`hub status` hängt an die offene Tabelle nur dann `Reste (hub cleanup)` an, wenn ein
`done`-Ticket noch ein lebendes Terminal, einen vorhandenen Worktree oder einen
existierenden Space hat. Abgenommene Tickets ohne Reste tauchen nicht auf; das
Team-Panel und das Dashboard hängen ohnehin an lebenden Terminals.

## Prüfung

**Deterministischer Kern** (`/tmp/hubtest/run.py`, Fake-`hc`/`herdr-app`, echtes
Git-Repo, Wegwerf-HOME): 8 Fälle, alle grün.

- `done`: kill, sauberer Worktree weg, Space zu, Branch bleibt, Felder leer;
- schmutziger Worktree: kein kill, kein Space, Worktree bleibt, Grund im stderr,
  Ticket trotzdem `done`;
- fremdes lebendes Terminal im selben Tab: weder Space noch Tab zu; in einem
  anderen Tab: nur das eigene Tab zu, Space bleibt;
- `--keep-worktree --keep-space`: beides bleibt, auch der Agent;
- `cleanup --dry-run`: dieselben drei Kategorien, State-Datei unverändert;
- `cleanup`: genau diese Aktionen, Space eines fremden Terminals unberührt,
  Worktree mit Ticket nicht als Waise entfernt;
- `land --merge`: Merge, kill, Worktree weg, Space zu, Branch gelöscht.

**Isolierter Core + Fenster** (`docs/ui-preview.sh`, eigenes HOME und
`HERDR_APP_HOME` unter `/tmp/ui-cleanup`, HC_SESSION `uiprev-…`):

- `hub dispatch aufraum-demo`, dann `hub done`: `Agent t8 beendet`,
  `Worktree … entfernt`; `herdr-app ls` zeigt den Space nicht mehr (Herdr schließt
  ihn, sobald das letzte Terminal geht; die Routine meldet „Space … ist schon weg“),
  `git show-ref` findet `feat/aufraum-demo` weiter.
- Sicherheitsfall `fremdes-tab`: eigener Agent und Worktree gehen, Space
  `feat-fremdes-tab` bleibt mit dem fremden Tab `fremd`/`t12` und der Meldung
  `Space feat-fremdes-tab bleibt: fremdes lebendes Terminal t12`.
- `hub cleanup --dry-run`: meldet den Waisen-Worktree, den schmutzigen Worktree
  (Grund) und den Space mit lebendem Terminal (bleibt); nichts geändert.
- `hub cleanup`: entfernt nur den sauberen Waisen-Worktree; der schmutzige bleibt
  mit Grund, der fremde Space bleibt.
- `hub done keep-space-2 --keep-space`: Agent-Terminal und Space
  `feat-keep-space-2` leben weiter, der Worktree geht.
- `hub status`: `done`-Ticket `aufraum-screenshot` ohne Reste fehlt; nur
  `fremdes-tab: Space` steht unter `Reste (hub cleanup)`. Nach dem Ende des fremden
  Terminals verschwindet auch diese Zeile.
- `herdr-app check mods/orchestra`: `check passed`; Testfenster mit
  `docs/ui-preview.sh down` beendet.
- Screenshots `/tmp/ui-cleanup/`: `space-before.png` (Space
  `feat-aufraum-scre…` in der Seitenleiste), `space-after.png` (Space weg,
  „Spaces 3“), dazu `before.png`/`after.png` vom Dashboard; keine Karteileiche.

## Offen

- `hub cleanup` betrachtet Worktrees nur auf dieser Maschine
  (`~/.herdr/worktrees`); Agents/Spaces anderer Maschinen werden über ihre
  `hc`-Adressen erkannt, Waisen-Worktrees dort nicht gesucht.
- Herdr schließt einen Space in diesem Build bereits, wenn sein letztes Terminal
  endet. Die Routine verlässt sich nicht darauf; sie schließt vorhandene Spaces
  explizit (und meldet sonst „schon weg“).
