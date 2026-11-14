# Notizen H: Lehren pro Repo in jedem Auftrag

Branch `feat/lessons`, Basis `main`. Was beim Review und bei der Abnahme gelernt
wurde, landet pro Repo in einer Datei und im nächsten Auftrag; Vorschläge des
Orchestrators bestätigt der Mensch im Review-Fenster.

## Datei und Format

`<repo>/.herdr/lessons.md`, eine Zeile je Lehre, höchstens 40 (die älteste fällt
raus), stabil geparst von `hub`, `mods/orchestra/tickets.js` und dem Review-Fenster:

```
- 2026-11-14 · lernschleife-lehren-pro-repo-in-jeden-au · review · Erst den Bestand lesen, dann ändern.
```

`date · ticket · quelle · text`; `ticket` ist `-`, wenn die Lehre über den Repo-Pfad
statt über ein Ticket kam. Quellen: `review`, `human`, `ci`. Doppelte Texte werden
nicht erneut geschrieben. Die Datei ist Arbeitsdatei des Repos, nicht dieses
Config-Repos.

## `hub`

| Befehl | Wirkung |
|---|---|
| `hub lesson add <repo\|ticket> --from review\|human\|ci "Text"` | schreibt eine Lehre; `<ticket>` nimmt Repo, ID und Maschine des Tickets |
| `hub lesson list <repo\|ticket> [--last N] [--json] [--pending]` | zeigt Lehren (bei `<ticket>` nur dessen Zeilen), `--pending` die Vorschläge |
| `hub dispatch <id> [--no-lessons]` | hängt die letzten 8 Lehren als `## Was hier schon schiefging` an die Aufgabe |
| `hub land <id> --merge\|--pr --lesson "Text"…` | schreibt die Lehre (`human`) und nennt sie im Verlauf des Tickets |
| `hub lesson propose <id> "Text"` | Vorschlag des Orchestrators: `lessons-pending.md` + Verlauf, noch nicht in der Datei |
| `hub lesson confirm <id>` | der Knopf im Review-Fenster: schreibt den Vorschlag (`review`) und nennt ihn im Verlauf; der Vorschlag verschwindet |

Auf anderen Maschinen lesen/schreiben `dispatch`, `land` und `lesson` über
`hc exec --on`; das Panel liest nur lokal (siehe Grenzen).

## Oberfläche

- **Team-Panel** (`mods/orchestra/hubview.js`): jede Ticket-Zeile trägt
  `Lehren n` (Tooltip: Zahl, die letzten drei Lehren, Hinweis auf einen offenen
  Vorschlag). Pink, solange ein Vorschlag wartet. Daten kommen mit
  `shared("orchestra.tickets")` aus `published()` (`tickets.js`), das die Datei je
  Repo einmal pro Publish liest. Herdrs `fs/promises` hat kein `fs.stat` (der erste
  Versuch lieferte still `null`); die Existenzprüfung nutzt `fs.exists`.
- **Review-Fenster** (`mods/review/main.js`, Ticket-Modus): Abschnitt **Lehren n**
  unter der Zusammenfassung, standardmäßig die letzten zwei, Klick auf die
  Kopfzeile klappt alle auf; Quelle rechts (`Review`, `Mensch`, `CI`), Datum links,
  Ticket-ID im Tooltip. Ein wartender Vorschlag steht immer sichtbar darüber mit
  **Lehre übernehmen** (ruft `hub lesson confirm`; nach Erfolg verschwindet er lokal
  sofort, die Zahl folgt mit dem nächsten Publish).

## Selbsttest

Log: `/tmp/ui-lessons/selftest.txt` (19 Prüfungen, `exit=0`), jeweils eigenes
`HERDR_APP_HOME` und Wegwerf-Repo:

- leer, Format mit/ohne Ticket-ID, Dedupe;
- 45 × `lesson add` → exakt 40 Zeilen, „Lehre 5“ raus, „Lehre 6“ erste;
- `list --last 8` (8 Zeilen), `list --json` (40 Objekte);
- `dispatch` mit `--no-worktree` und `--agent "sh -c 'cat > /dev/null'"`: genau ein
  Abschnitt, genau 8 Lehren; mit `--no-lessons` kein Abschnitt. Zusätzlich echt in
  einem isolierten `HC_SESSION`-Core gestartet und die Prozessargumente geprüft;
- `land --merge --lesson`: Lehre in der Datei, `Lehre notiert: …` im Verlauf;
- `propose` → `confirm`: Vorschlag in `lessons-pending.md` und im Verlauf, nach dem
  Bestätigen als `review` in der Datei, Pending leer, `Lehre übernommen: …` im Verlauf.

Screenshots (`/tmp/ui-lessons/`): `team.png` (`Lehren 3` an den Ticket-Zeilen,
pink bei offenem Vorschlag), `review.png` (Abschnitt zugeklappt, Vorschlag +
Knopf), `review-expanded.png` (alle drei Lehren mit Quelle). Test-Home
`~/.herdr/ui-preview/feat-lessons`, Demo-Repo, `errors: []` beim Aufnehmen.

## Grenzen des Nachweises

- Klicks lassen sich nicht in das Hintergrund-Testfenster posten. Für den
  Ticket-Modus wurde im **Test-Home** `review/main.js` einmalig auf `demo-1`
  vorbelegt (bzw. `lessonsOpen = true` für das aufgeklappte Bild); der Worktree
  enthält diese Zeile nicht. Den Klickpfad bestätigt der identische Aufruf
  `hub lesson confirm` im Selbsttest.
- Nur lokale Repos zeigen die Zahl; bei `machine`-Tickets auf anderen Rechnern
  bleibt sie aus, weil das Panel den Pfad dort nicht lesen kann. `dispatch` und
  `land` arbeiten dort über `hc exec --on`.
- `hub land --lesson` schreibt die Lehre **nach** dem Landen: scheitert die Datei
  (Rechte), ist das Ticket trotzdem abgenommen und der Fehler wird gemeldet.

## Dateien

`mods/orchestra/bin/hub`, `mods/orchestra/tickets.js`, `mods/orchestra/hubview.js`,
`mods/review/main.js`, `mods/orchestra/orchestrator.md`, `README.md`,
`docs/ui/notes-H.md`.
