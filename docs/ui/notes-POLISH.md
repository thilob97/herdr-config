# UI-Politur: Board, Timeline, Dashboard, Quests, Team

Was sich für den Menschen sichtbar ändert. Tokens bleiben die aus `docs/ui-spec.md`.

## Board

- Label-Chips: höchstens zwei Chips plus `+n`; lange Labels werden abgeschnitten, alle
  Labels stehen im Tooltip. Die Zeile bleibt einzeilig, die Karte wächst nicht.
- Identität kommt aus dem Agenten-Anzeigenamen (`agent_name`, sonst `agent`/`assignee`);
  ein Programm-Kürzel wie `omp` wird über den laufenden Agenten zum Programmnamen.
- Eine leere Gate-Reihe (`– – –`) entfällt: Gates erscheinen erst, wenn mindestens ein
  Gate etwas sagt. Das gilt auch für die Ticket-Karte im Team-Panel.

## Timeline

- Neuer Standard-Zoom **Auto**: Fenster vom frühesten Start bis jetzt, mindestens
  30 Minuten. `1 h`, `24 h`, `7 Tage` und `Alles` bleiben.
- Balken sind mindestens 4 px breit und haben runde Enden; in sehr schmalen Balken
  entfällt der Text, der Tooltip trägt ihn.
- Lanes zeigen zwei Zeilen: Name fett, darunter das Ticket-Kürzel in `dim`.
- Lanes ohne Aktivität im Fenster (kein Start, kein Ereignis) werden ausgeblendet.

## Dashboard

- Die Team-Tabelle ist eine echte Spaltenreihe: Status als 16-px-Punkt, Space/Tab und
  Ticket teilen sich den Rest, `Seit` 64 px, `Kosten` 72 px. Werte stehen unter ihren
  Köpfen; das `)`-Artefakt der Statusanzeige ist weg.
- Ein Ticket, das oben unter „Wartet auf dich" steht, erscheint nicht noch einmal unter
  „Stockt". Bleibt dort nichts übrig, sagt die Karte das.
- Die 7-Tage-Zeile zeigt echte Balken mit Höhe; ohne Messwerte steht dort ruhig
  „7 Tage · keine Daten" statt einer Strichreihe.
- Die Kosten-Karte lässt den Abschnitt „pro Ticket" weg, solange kein Ticket Kosten
  gebucht hat (keine Zeile „pro Ticket … —").

## Quests

- Eine gestartete Quest zeigt Avatar, Identität und Programmname. Eine Kommandozeile
  wird nicht mehr angezeigt; das Modell steht nur im Tooltip.
- Das gilt in der Listenzeile und in den Starts der Detailansicht.

## Team-Panel

- Budget-Chips (`$/Ticket`, `Team $x / $y`) stehen als eigene Zeile rechts unter dem
  Panel-Kopf statt zwischen „In Arbeit" und „Geplant".

## Prüfung

- `docs/ui-preview.sh check board|timeline|dashboard|quests|orchestra` grün.
- `herdr-app status` im Testfenster: `errors: []`.
- Screenshots `/tmp/ui-polish/polish-{board,timeline,dashboard,quests,team}.png`.
- Kein Push; Testfenster danach beendet.
