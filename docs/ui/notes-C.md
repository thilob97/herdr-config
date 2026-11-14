# Paket C: Rahmen und Werkzeuge (für README, Paket B überträgt und löscht diese Datei)

## Was sich für dich ändert

**Tab-Leiste**
- „+“ steht direkt hinter dem letzten Tab und öffnet einen Tab (Terminal oder Agent), wie im Browser.
- Rechts gibt es genau einen Eingang für neue Arbeit: den Primärknopf **Auftrag** (⌘⇧N). Der alte
  Knopf „Starten“ ist weg.
- **Inbox** zeigt im Zähler alles, was auf dich wartet: Rückfragen (blockierte Agents, auch der
  Orchestrator) plus Tickets in Prüfung; wartet nichts, zählt er fertige Agents (in deren Farbe).
  Das ist die einzige Wartet-Zahl außerhalb der Inbox.
- **Review** ist ein Icon-Knopf (⌘⇧R).
- Die Panels sind in zwei Gruppen geteilt: *Fabrik* (Quests, Team) und *Werkzeuge* (Changes, Git,
  Tree, Blueprint, Docker). Das offene Panel zeigt seinen Namen. Tasten bleiben: ⌘⌥1 Changes, ⌘⌥2 Git,
  ⌘⌥3 Tree, ⌘⌥4 Blueprint, ⌘⌥5 Docker, ⌘⌥6 Quests, ⌘⌥7 Team (Tooltips nennen sie).
- Tabs sind etwas kompakter (28 px) und zeigen den Status wie überall: Spinner = arbeitet,
  pulsierender Punkt = wartet, Punkt = fertig.

**Statusleiste**
- Links: Ort (Maschine) und Branch. Rechts: Limits als Chips, Kosten „$x heute“, Chip
  **Team $x / $y** (Kosten offener Tickets + Orchestrator gegen das Team-Budget; über Budget in
  Wartet-Farbe). Ein Klick auf den Team-Chip öffnet das Team-Panel, dort änderst du das Budget.
- Entfallen: „N agents“ und das Badge „● 1 wartet“. ⌘J springt weiter zum nächsten wartenden Agent,
  die Team-Beobachtung („Team … ist fertig“) läuft weiter.
- Die Hover-Karte heißt „Kosten und Limits“ und ist deutsch.

**Werkzeug-Panels** (Git, Tree, Blueprint, Docker)
- Alle Köpfe sehen aus wie bei Changes: 42 px, Titel links (Panelname), rechts höchstens drei
  Icon-Knöpfe mit Tooltip. Umschalter sind einheitliche Segmente (Git: Alle Zweige/Aktueller Zweig,
  Tree: Tree/Zuletzt, Docker: Laufend/Alle). Leerzustände: Icon und ein Satz, mittig.
- Git: Branch und Update-Hinweis als Chips. Blueprint: Titel „Blueprint“, Projekt daneben, Agent und
  Update als Chips; „Neu laden“ sitzt jetzt rechts in der Diagramm-Zeile.

**Fenster und Dialoge**
- Marketplaces und MCP-Server haben dieselbe Titelzeile wie das Review-Fenster (Schließen rechts),
  einen Scope-Umschalter „Benutzer | Projekt“ und sind deutsch.
- Tastenkürzel (⌘/): Titelzeile mit Esc-Chip, Gruppen ohne Großbuchstaben, „Auftrag“ (⌘⇧N),
  „Inbox: was auf dich wartet“ (⌘⇧J), „Zum nächsten wartenden Agent“ (⌘J).

## Externe Addons: „lokal angepasst“ (Vermerk für die Tabelle in README)

| Addon | lokal angepasst |
|---|---|
| `git-graph` | `graph.js`: Panel-Kopf (Titel, Branch- und Update-Chip, Icon-Knöpfe 26 mit Tooltips), Segment „Alle Zweige/Aktueller Zweig“, Checkbox „Remotes“, Leerzustände (deutsch). Graph, Details und Dialoge unverändert. |
| `filetree` | `main.js`: Panel-Rahmen, Kopf mit Titel „Tree“ und Segment „Tree/Zuletzt“, Werkzeug-Knöpfe, Filterfeld, Leerzustände (deutsch). Baum, Git-Zusammenfassung und Vorschau unverändert. |
| `blueprint` | `main.js`: Panel-Kopf (Titel „Blueprint“, Projekt als Meta, Agent- und Update-Chip, Icon-Knöpfe 26, „Neu laden“ in der Diagramm-Zeile), Kopfhöhe 42. Diagramme, Sprachen (`i18n.js`) und Abläufe unverändert. Erkennt sich als Panel über `props.panel` im Layout-Block `blueprint`. |
