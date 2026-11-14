# Paket A: Sidebar und Agent-Darstellung – was sich für dich ändert

Für `README.md` (Paket B überträgt es und löscht diese Datei danach).

## Sidebar

- **Kopf** (42 px, bündig mit der Tab-Leiste): Logo, „Herdr“, Suche (⌘P) und Sidebar ein-/ausklappen.
  Er kommt jetzt aus dem eigenen Mod `sidebar-footer` statt aus dem ausgelieferten `workspace-chrome`.
- **Fuß** (eine 28-px-Zeile, bündig mit der Statusleiste): Icon-Knöpfe für Einstellungen (⌘,, mit
  Punkt, wenn ein Update bereitliegt), Marketplaces (⌃⇧M), MCP-Server (⌃⇧Y), Maschine hinzufügen und
  Tastenkürzel (⌘/). Die Tooltips nennen die Taste. Eingeklappt (Rail) bleiben Einstellungen und „…“;
  „…“ öffnet die übrigen vier als Menü.
- **Spaces** nehmen nur so viel Höhe, wie sie brauchen (Kopf, eine 28-px-Zeile je Space, Ordner oder
  Maschine), höchstens 40 % der Listenhöhe; darüber scrollen sie. Den Rest bekommen die Agents.
  Kopf „Spaces n“ mit „Neuer Ordner“ und „Neuer Space (⌘N)“; Maschinen-Zeilen sind Sektionsköpfe.
  Die Farben der Space- und Ordner-Kacheln kommen aus dem Theme (`ansi*`), nicht mehr aus festen Hex-Werten.

## Agent-Karten (die eine Agent-Darstellung)

- Jede Karte: Avatar · Name · Space · Statusanzeige, darunter Tab bzw. Titel und seit wann der Status
  gilt; bei omp eine dritte Zeile mit Modell, ctx und Kosten samt ctx-Balken. Kein farbiger Seitenstreifen
  mehr; der fokussierte Agent hat den pinken Rahmen.
- Statusanzeige wie überall: Spinner = arbeitet, pulsierender Punkt = wartet, Punkt = fertig, Ring = ruhig.
  Sektionen heißen „Wartet auf dich“, „Arbeitet“, „Fertig“, „Ruhig“, „Angeheftet“. Wo keine Sektion
  „Wartet auf dich“ darüber steht (angeheftet, nach Space gruppiert), sagt ein Chip „wartet“.
- Sortierung (Uhr-Knopf rechts im Kopf): „Nach Dringlichkeit“ oder „Nach Space“.
- **Hover** zeigt drei Knöpfe: **Review** (Änderungen dieses Agents im Review-Fenster),
  **Unterbrechen** und **Mehr (…)** mit Plugins, MCP-Server, Anheften/Lösen und Umbenennen.
  Rechtsklick auf eine Karte öffnet dasselbe Menü (früher: direkt Umbenennen). Plugins/MCP sind keine
  eigenen Hover-Knöpfe mehr.
- **Mehrfachauswahl**: ⌘-Klick wählt Karten aus (Häkchen statt Avatar). Darunter erscheint die
  Auswahlleiste: „n ausgewählt · aufheben“, Nachricht an die Auswahl (Enter oder Pfeil), „auch wartende“
  (schickt auch an Agents, die auf eine Antwort warten, und beantwortet damit ihre Frage),
  **Unterbrechen** und **Als Team beobachten** (legt „Team HH:MM“ an; es erscheint im Team-Panel unter
  Teams, die Statusleiste meldet, wenn alle fertig sind). Das ersetzt Auswahl und Aktionen im
  bisherigen Agent-Graphen des Team-Panels.
- Andere Flächen (Team-Panel, Inbox, Review, Toasts) zeigen Agents als Identitäts-Chip mit demselben
  Namen und Avatar: `agent-cards` veröffentlicht sie in `shared("agents.identity")`
  (`{ "<adresse>": { name, avatar, program } }`). Umbenennen ändert den Namen überall.
- Alle Texte der Sidebar sind deutsch (Produktnamen bleiben).

## Externe Addons – lokal angepasst

- `space-folders`: Kopf, Zeilenhöhen (28), Radien, Knöpfe (22 px mit Tooltip), Schriftgrößen und
  Farben nach dem UI-Spec; Höhe des Spaces-Blocks passt sich dem Inhalt an (`layout.resize`, nur wenn
  sich die Zeilenzahl ändert, nie im Rail). Inhalte und Texte der Ordner-Dialoge unverändert.

## Technisch

- `layouts/elric.json`: `brand` 42 px aus `sidebar-footer`, `spaces` Startwert 160 px (min 90),
  `agents` weight 1 (min 160), `sidebar-footer` 28 px; Blueprint-Block mit `props.panel`.
- `shared("agent-cards.height")`: Höhe des Agents-Blocks, gemessen von `agent-cards`; `space-folders`
  rechnet damit die 40 %-Grenze (Spaces + Agents = Listenhöhe).
