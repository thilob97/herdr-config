# Notizen J: Wartet auf dich nur aus echten Fragen, beendete Agents einklappen

Branch `feat/dash-3` (Basis `main`, fab5969). Das Start-Dashboard zeigt unter „Wartet auf dich“
keine Abschlussmeldungen mehr; fertige Agents stehen eingeklappt am Ende des Team-Blocks.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/dashboard/main.js` | drei Wartet-Quellen, Zeilenform, beendete Agents, Gruppenfilter, 5-s-Takt |
| `README.md` | Abschnitt „Start-Dashboard“ um Wartet-Zahl und Team-Faltung ergänzt |
| `docs/ui/notes-J.md` | diese Notizen |

`mods/dashboard/ui.js`, `layouts/dashboard.json`, `keys.json`, `layouts/elric.json`,
`docs/ui-spec.md` und `docs/ui/review.md` bleiben unverändert.

## Was der Mensch sieht

- **Wartet auf dich** hat drei Quellen und eine Zeile je Sachverhalt:
  - Ticket in `review`: Identitäts-Chip (Agent oder Orchestrator), Titel (max. zwei Zeilen `T_S`),
    Gate-Chips, Alter, Knopf **Prüfen**.
  - Agent `blocked`: Identitäts-Chip, letzte Fragezeile des Terminals (max. zwei Zeilen), Alter,
    Antwortfeld. Ohne Fragezeichen im Bildschirm steht dort „Wartet auf eine Antwort.“, nie roher
    Text einer Abschlussmeldung.
  - Ticket-Verlauf, dessen letzter Eintrag von einem Agent (nicht `mensch`, nicht `hub`) stammt,
    kein Fragezeichen-freier Bericht ist und auf den keine Antwort folgte: Frage als Link-Zeile,
    Klick öffnet das Review-Fenster. Hier wird geantwortet (Kommentar im Ticket), nicht im
    Dashboard.
  - **Nicht** gezeigt: `status: done`, `question`-Treffer ohne „?“, Toasts. Ein blockierter Agent
    und seine Frage im selben Ticket erscheinen einmal (der Agent hat das Antwortfeld).
- **Zahl am Kopf:** `waits.length`, also exakt die Zeilen. Für ihren Review- und Blocked-Teil ist
  das die Formel aus `docs/ui-spec.md` §7.3 (blockierte Agents plus Tickets in Prüfung), also
  Inbox-Zähler und Team-Panel-Stufe „Prüfung n“. Eine zusätzliche Verlaufs-Frage zählt als eigene
  Zeile; sie ist im Inbox-Kopf (bewusst nur §7.3) nicht enthalten.
- **Team:** aktive Agents zuerst, gruppiert nach `orchestra.groups` bzw. Space; Gruppen ohne
  lebenden Agent entfallen. Fertige Agents (`done` laut Terminal-Report) stehen in einer
  eingeklappten Zeile „n beendet“ am Ende, ein Klick klappt sie auf. Ein fertiger Agent bleibt
  „fertig“, auch wenn `agents()` ihn nach dem Ansehen als `idle` meldet — der rohe Status kommt aus
  `terminals()`.
- **Takt:** `sync` und `hc read` laufen alle 5 s, die Uhr rendert alle 20 s; keine Abfrage pro
  Sekunde.

## Prüfung

Testfenster `~/.herdr/ui-preview/feat-dash-3` (eigener Core, Demo-Welt), Dashboard-Layout.

- `docs/ui-preview.sh check dashboard`: `check passed`; `herdr-app status`: `errors: []`.
- Screenshots `/tmp/ui-dashboard3/`:
  - `before.png`: alter Stand mit einer `doing`-Ticket-Frage, deren Text die Abschlussmeldung
    eines Agenten ist (der beobachtete Fehler).
  - `after.png`: derselbe Zustand mit dem neuen Stand — die Meldung fehlt, Review und blockierter
    Agent bleiben, Zahl 2 = Inbox-Zähler = Stufe „Prüfung 1“ plus ein blockierter Agent.
  - `done.png`: Team-Block mit eingeklappter Zeile „1 beendet“ (fertiger Demo-Agent).
  - `empty.png`: leeres Test-Home ohne Agents, Tickets, Teams und Kosten.
- Zählprobe im Testfenster: Review-Ticket `demo-1` plus blockierter Agent `Moxie` = 2 Zeilen; Inbox
  §7.3 ergibt `1 blocked + 1 review = 2`; Team-Panel-Stufe „Prüfung 1“.
- Der fertige Demo-Agent `pi` (Terminal-Status `done`) erscheint nicht unter „Wartet auf dich“ und
  steht als „1 beendet“ am Ende des Team-Blocks.

## Offen

- Eine Verlaufs-Frage, deren Agent nicht mehr blockiert ist, ist eine eigene Wartet-Zeile, die der
  Inbox-Kopf nach §7.3 nicht mitzählt (die Inbox listet sie unter „Rückfragen“, ihr Kopf zählt nur
  blockierte Agents und Prüfungen). Im Demo-Fall und bei jedem noch blockierten Agenten stimmen die
  Zahlen.
- Der Testkern wandelt `done` nach dem Ansehen in `idle`; die Mod liest deshalb den Terminal-Status.
  Endgültig beendete Terminals verschwinden aus `agents()` und damit aus dem Team-Block.
