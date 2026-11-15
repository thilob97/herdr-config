# Notizen S: Team-Hub — benannte Agents aus dem Roster

Branch `feat/teams-hub`. Ein Agent wird einmal mit Name, Rolle, Programm, Modell, Repo,
Branch-Präfix, Labels, Notizen und Farbe angelegt (`agents/roster.json`, versioniert in der
Live-Config) und danach über seinen Namen gestartet: `hub dispatch <ticket> --agent Zap`.
Das Fenster **Team-Hub** (`mods/teams`, `mod.open --name teams`) zeigt den Roster als Karten,
legt/bearbeitet/löscht Einträge über `hub agent …`, zeigt je Agent seine laufenden Tickets und
öffnet den Auftrag-Dialog vorbelegt.

## Dateien

| Datei | Inhalt |
|---|---|
| `agents/roster.json` (neu) | drei Beispiele: Zap (Umsetzer, omp), Ada (Prüfer, claude), Mira (Recherche, pi); Feld `color` `c1..c6` |
| `mods/orchestra/bin/hub` | Roster lesen/schreiben; `agent list/show/add/edit/rm`; `dispatch --agent <Roster-Name>` (Programm + `--model`, Repo- und Branch-Präfix-Standard, Rolle/Notizen in der ersten Nachricht, `agent: <Name>` im Ticket); `stats --json` trägt `agents` (Einsätze, offen, Kosten); `review-start` vergleicht das Programm hinter dem Roster-Namen |
| `mods/teams/mod.json` (neu) | Fenster „Team-Hub“, `kind: window`, `key: teams`, 980 × 680 |
| `mods/teams/main.js` (neu) | Karten, Filter Aktiv/Alle, Detail mit laufenden Tickets, Formular, Löschen-Rückfrage, Leerzustand, Auftrag-Dialog |
| `mods/teams/ui.js` (neu) | unveränderte Kopie von `mods/orchestra/ui.js` (Herdr kennt keine Modul-Imports über Mod-Ordner) |
| `.gitignore` | `!/agents/` in der Whitelist |
| `docs/ui/notes-S.md` | diese Notizen |

## Verhalten

**Roster.** `agents/roster.json` ist eine Liste; fehlende Felder bekommen die Standardwerte
(`program` `omp`, `branch_prefix` `feat/`, `color` `c1`, `labels` `[]`). `hub agent list` liest
ohne Datei `keine Agents` (Exit 0), `show/edit/rm` nennen die fehlende Datei. `add` und `edit`
validieren Name (eindeutig, auch beim Umbenennen), Programm (`omp|claude|codex|pi`) und Farbe
(`c1..c6`) und schreiben atomar; ein Fehler lässt die Datei unberührt.

**Dispatch.** `--agent Zap` findet den Roster-Eintrag ohne Rücksicht auf Groß-/Kleinschreibung,
setzt `agent: Zap` (nicht `omp`) ins Ticket, nimmt `program` + `--model` als Startkommando,
`repo` (mit `~`-Auflösung, ins Ticket geschrieben) und `branch_prefix` als Standard, wenn das
Ticket sie nicht hat, und stellt der Aufgabe `Du bist Zap (Umsetzer).`, `Notizen: …` und
`Modell: …` voran. Namen, die kein Roster-Eintrag sind, laufen unverändert als Programm oder
Kommando (`--agent "true"` startet weiterhin genau `true`).

**Fenster.** Karten nennen Avatar-Initiale in der Agent-Farbe, Name, Rolle, Programm/Modell,
Repo-Ende (voller Pfad im Tooltip) sowie `N Einsätze · $x` aus `hub stats`. „Aktiv“ filtert auf
Agents mit Tickets in `todo/doing/review`; Standard ist „Alle“, weil ein frischer Roster noch
keine Einsätze hat. Die Detailfläche zeigt Repo, Branch-Präfix, Labels, Notizen und die
laufenden Tickets (Prüfung öffnet das Review-Fenster, Arbeit fokussiert den Agenten). Das
Formular schreibt ausschließlich über `hub agent add|edit`; beim Bearbeiten bleiben Farbe und
Branch-Präfix erhalten. Löschen fragt im Detail nach und entfernt nur den Roster-Eintrag.
„Auftrag starten“ öffnet den Auftrag-Dialog im Team-Modus mit Agent, Rolle, Programm/Modell,
Checkout und Branch-Präfix im Text.

**Farben.** `c1`→`accent`, `c2`→`working`, `c3`→`done`, `c4`→`blocked`, `c5`→`solid`,
`c6`→`muted`; neue Agents bekommen der Reihe nach `c1..c6`.

**Leiste.** `mods/teams/icon.svg` ersetzt den Platzhalter im Knopf „Team-Hub“ (tabs-graph prüft das
Icon beim Start). `teams.panel` schließt das geladene Fenster über `nextCommand`. Solange das
Fenster zu ist, lädt Herdr ein `place: none`-Mod nicht: `teams.panel`/⌘⌥9 melden dann „need the
mod loaded“. Ein Host-Block in `layouts/elric.json` oder ein `mod.open`-Rückfall in
`mods/tabs-graph` liegen außerhalb der Grenzen dieses Tickets; `mod.open --name teams` öffnet
das Fenster in jedem Fall.

**Messwerte.** `hub stats` gruppiert alle Tickets nach `agent`: Roster-Einträge zuerst (auch mit
0 Einsätzen), danach weitere Agenten-Schlüssel, mit `tickets`, `open` und der Kostensumme aus
`data/orchestra/costs.json`. Die Textausgabe hat dafür den Abschnitt „Agents“. Das Team-Panel
selbst (`mods/orchestra/hubview.js`) bleibt in diesem Ticket unberührt.

## Belege

- Roster-Selbsttest im Wegwerf-Home (`HERDR_APP_HOME=$(mktemp -d)`): fehlende Datei (`list`
  leer, `show` Exit 1), `add` mit allen Feldern, doppelter Name (Exit 1), unbekanntes Programm
  (Exit 1), `show --json`, `edit` (Rolle/Modell, andere Felder bleiben), Umbenennen, `rm`.
- Dispatch ohne echten Agent: Stub-`hc` auf `PATH` protokolliert das Startkommando; `--agent Zap`
  liefert `omp --model m1`, Rolle/Notizen/Modell im Prompt, `agent: Zap`, Roster-Repo, Branch
  `feat/<ticket>`; `--agent true` liefert `true` ohne `--model`.
- `hub stats --json` im Wegwerf-Home: Zap 2 Einsätze/1 offen/$2.00, Ada 0, weiterer Schlüssel
  als eigene Zeile.
- Fenster im Test-Home (`docs/ui-preview.sh`): `/tmp/ui-teams/liste.png` (Karten, Zap mit zwei
  laufenden Tickets), `formular.png`, `bearbeiten.png` (Testo, Farbe/Branch-Präfix bleiben),
  `loeschen-rueckfrage.png`, `leer.png`, `auftrag.png` (vorbelegter Dialog). Anlegen, Bearbeiten
  und Löschen wurden über die Fensterpfade ausgelöst und danach in `agents/roster.json` geprüft
  (Testo angelegt, geändert, entfernt); die Haken lagen nur im Test-Home und sind nicht im Repo.
- `python3 -m py_compile mods/orchestra/bin/hub`, `herdr-app check mods/teams` und
  `herdr-app check mods/orchestra` (einzeln; das Werkzeug lädt ein Verzeichnis): grün. Kein Push.
