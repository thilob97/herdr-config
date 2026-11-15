# FIX 3: memory-`--repo`, leerer Titel, Besitzer-Spalte, Basis-Warnung

Vier Befunde aus dem Live-Betrieb, alle mit einem Regressionstest in
`mods/orchestra/test/hub_bugs_test.py` belegt.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | `memory_selector(..., write=True)` prüft `--repo` vor der Sperre; `cmd_new` lehnt leere Titel ab; `cmd_set` warnt bei unbekannter `base`, ohne den Wert zu verwerfen; `cmd_status` zeigt `mensch` wieder an |
| `mods/orchestra/test/hub_bugs_test.py` | vier neue Abschnitte 11–14: memory auf fehlendem/schreibgeschütztem Repo, leerer Titel, Besitzer-Spalte (eigen/fremd/leer/`mensch`), Basis-Warnung |
| `docs/ui/notes-FIX3.md` | diese Notizen |

## Verhalten

1. **`hub memory add --repo PFAD`** verlangt ein vorhandenes, schreibbares
   Verzeichnis. Fehlt es, endet der Befehl wie `hub lesson` mit
   `hub: kein Repo: Pfad` (Exit 1) statt mit einem `OSError`-Traceback aus
   `os.makedirs`; ein vorhandenes, aber schreibgeschütztes Repo meldet
   `hub: kein Repo: Pfad (nicht schreibbar)`. Geprüft wird vor `hub_lock`, weil
   der Fehler nichts zu sperren hat. `add`/`clear` fangen ein spätes `OSError`
   zusätzlich ab, damit nie ein Traceback erscheint.
2. **`hub ticket new --title`** lehnt einen leeren oder nur aus Leerzeichen
   bestehenden Titel mit `hub: --title darf nicht leer sein` (Exit 1) ab, bevor
   eine ID oder Datei entsteht (vorher wurde daraus `ticket`).
3. **`hub status`**: Die Spalte `Besitzer` zeigt nur fremde Orchestratoren.
   Eigene und besitzerlose Tickets stehen auf `–`; `mensch` bleibt als
   `mensch` sichtbar (vorher wurde auch die Person ausgeblendet).
4. **`hub ticket set ID base=WERT`** prüft den Wert ohne Netz gegen
   `git rev-parse --verify --quiet WERT^{commit}` im Worktree bzw. Repo und
   schreibt bei einem unbekannten Wert eine Zeile auf stderr:
   `Basis 'WERT' ist im Repo nicht bekannt`. Der Wert wird trotzdem gesetzt,
   weil `base` auch ein Commit sein darf; `git` läuft außerhalb von
   `hub_lock`. Ohne Repo am Ticket und bei `base=` (abräumen) gibt es keine
   Warnung.
