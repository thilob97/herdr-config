# UI/UX-Bestandsaufnahme Fabric (Fenster, Seitenleiste, Toasts, Lampe, Banner)

**Ticket:** T-115 (Eltern-Ticket: T-114 · Folge-Tickets: T-116, T-117) · **Datum:** 2026-11-23 · **Basis:** `main`
**Rolle:** `xen` (UI / UX Designer)
**Umfang:** `mods/fabric/ui.js`, `mods/fabric/model.js`, `mods/fabric/main.js`, `mods/fabric/views/*.js`, `mods/fabric-sidebar/main.js`, `mods/fabric-sidebar/model.js`, `mods/fabric-toast/main.js`, `layouts/fabric.json`, `docs/fabric-ui.md`.

---

**Nachweis T-116:** umgesetzt in `ff4d7b8`, `0b06018`, `df49bb3`, `194803d`, `a83eb4b` und `8103692`. Die Übersichtstabelle in Abschnitt 4.1 nennt je Befund den tatsächlich behebenden Commit; die Detailabschnitte verweisen darauf. Die Nachher-Screenshots liegen unter `docs/assets/ui-audit/nachher/`.

## 1. Ergebnis und Überblick

Die Bestandsaufnahme umfasst **45 Vorher-Screenshots** (alle mit `fab preview shot T-115` in einer isolierten Vorschau-Instanz unter `/tmp/fab-preview/T-115` aufgenommen und unter `docs/assets/ui-audit/vorher/` abgelegt) sowie **44 konkrete UI-Befunde (`U-01` bis `U-44`)** und eine verbindliche **Begriffstabelle**.

### Verteilung nach Kategorie und Zuordnung

| Kategorie | T-116 (`mods/fabric`) | T-117 (`mods/fabric-sidebar`, `mods/fabric-toast`) | Gesamt |
|---|---:|---:|---:|
| **Abstand** | 5 (`U-01`–`U-05`) | 3 (`U-31`–`U-33`) | **8** |
| **Schriftgröße** | 3 (`U-06`–`U-08`) | 3 (`U-34`–`U-36`) | **6** |
| **Farbe** | 4 (`U-09`–`U-12`) | 3 (`U-37`–`U-39`) | **7** |
| **Begriff** | 5 (`U-13`–`U-17`) | 3 (`U-40`–`U-42`) | **8** |
| **Doppelfunktion** | 3 (`U-18`–`U-20`) | 1 (`U-43`) | **4** |
| **toter Knopf** | 2 (`U-21`–`U-22`) | 0 | **2** |
| **abgeschnittener Text** | 4 (`U-23`–`U-26`) | 1 (`U-44`) | **5** |
| **Dialog** | 2 (`U-27`–`U-28`) | 0 | **2** |
| **Chips** | 2 (`U-29`–`U-30`) | 0 | **2** |
| **Summe** | **30 Befunde (T-116)** | **14 Befunde (T-117)** | **44 Befunde** |

### Schwerpunkte des Befunds

1. **Redundante Status- und Alarmflächen im Fenster (`U-18`, `U-19`, `U-21`):** Die Autopilot-Lampe samt Statustext wird im geöffneten Fabric-Fenster gleichzeitig in der linken Navigation (`mods/fabric/main.js:4322`) und in der oberen Kopfleiste (`mods/fabric/main.js:4426`) gerendert. Bei aktivem Alarm steht derselbe Alarmtext dreimal im selben Fenster (Alarm-Banner oben + Kopfleisten-Lampe + Navigations-Lampe) und ein viertes Mal im Seitenleisten-Banner dahinter. Zudem zeigen `Board` (`views/board.js:216`) und `Tickets` (`views/tickets-page.js:64`) im bereits geöffneten Hauptfenster einen dauerhaft aktiven, wirkungslosen Knopf „Im Fenster öffnen“.
2. **Gebrochene und abgeschnittene Layouts (`U-23`, `U-24`, `U-25`, `U-26`, `U-44`):**
   - Im **Inbox-Popover** (`mods/fabric/main.js:4883`) hängt `.when(Boolean(lesson), …)` mit `.w_full()` auf der äußeren `h_flex()` statt in der inneren `v_flex()`. Dadurch wird der Text eines Lehren-Vorschlags auf wenige Pixel (`„T-“`) zusammengequetscht.
   - In der **Tickets-Tabelle** (`mods/fabric/model.js:322-330`, `views/tickets-page.js:97`) überschreitet die Summe der festen Spaltenbreiten (`884 px` + Abstände = `956 px`) die Inhaltsbreite des Standardfensters (`~893 px`); die letzte Spalte `Kommentare` wird zu `Komme` abgeschnitten.
   - Im **Workflow-Graphen** (`mods/fabric/views/workflows.js:315-359, 550-597`, `model.js:2231-2253`) laufen senkrechte Kanten über mehrere Ebenen mitten durch dazwischenliegende Knotenkarten; im Builder überlappen `18 px` hohe Kanten-Labels (`top(mid - 9)`) den nur `12 px` hohen vertikalen Knotenabstand (`gapY: 12`).
   - Im **Posteingang-Block der Seitenleiste** (`mods/fabric/views/inbox.js:98-110`, `layouts/fabric.json:71-81`) überlappt `ui.emptyState` (`p(24)`, `justify_center()`) bei niedriger Blockhöhe die eigene Kopfzeile und schneidet den Aktionsknopf „Zum Board“ unten ab.
3. **Token-Wildwuchs in Views, Seitenleiste und Toast (`U-01`–`U-12`, `U-31`–`U-39`):** Während `mods/fabric/ui.js:14-29` ein sauberes Token-Set definiert (`FONT: 11/12/13/15/18`, `SPACE: 4/8/12/16/24`, `RADIUS: 6/8/12`), verwenden Views in `mods/fabric/views/*.js` sowie `mods/fabric-sidebar/main.js` und `mods/fabric-toast/main.js` zahllose Einzelzahlen (Schriftgrößen `8.5`, `9`, `9.5`, `10`, `10.5`, `11.5`; Abstände `1`, `2`, `3`, `5`, `6`, `7`, `9`, `10`, `18`, `19`, `26`, `30`, `36`; Radien `1`, `3`, `4`, `5`, `9`, `10`, `11`; elf verschiedene Hex-Alpha-Suffixe von `+"12"` bis `+"b8"`).
4. **Sprach- und Begriffsbruch (`U-13`–`U-17`, `U-40`–`U-42`):** Englisch und Deutsch sind gemischt (`Inbox` vs. `Posteingang`, `AGENTS · 1 BUSY · THIS MACHINE · WAITING/WORKING/IDLE/DONE/ERROR` vs. `arbeitet/wartet/bereit/fertig/Fehler`, `needs a login: run` / `Copy` / `Copied`, rohes `decision` als Chip im Posteingang, `flow flow` im Zeitverlauf, `verify`/`lessons` vs. `Prüfskript`/`Lernnotizen`, `Wartezeiten` vs. `Liegezeiten`, Tippfehler `2 Laufe` statt `2 Läufe`, `1 Team(s)`).

---

## 2. Umgebung und Methode

- **Vorschau-Instanz:** `fab preview start T-115` unter `/tmp/fab-preview/T-115/home` mit isoliertem `FAB_HOME` (`/tmp/fab-preview/T-115/home/data/fabric`) und eigenem Core (`fabp-t-115`). Nach Abschluss der Aufnahmen mit `fab preview stop T-115` rückstandsfrei beendet.
- **Screenshots:** Alle 45 Bilder unter `docs/assets/ui-audit/vorher/` wurden ausschließlich mit `fab preview shot T-115` aufgenommen.
- **Vorher/Nachher-Struktur:** Jede Tabelle in Abschnitt 3 nennt je Zustand den Nachher-Beleg. Zustände ohne Nachher-Bild sind mit `—` und dem Grund markiert; die je Seite aufgenommenen Belege stehen in der Übersicht oben.
- **Nachher-Belege T-116:** folgende Aufnahmen wurden nach dem Umbau mit `fab preview shot T-116` erzeugt und liegen unter `docs/assets/ui-audit/nachher/`:

| Seite | Nachher |
|---|---|
| Board | ![board-voll](../assets/ui-audit/nachher/board-voll.png) |
| Tickets | ![tickets-voll](../assets/ui-audit/nachher/tickets-voll.png) |
| Ticket-Detail | ![ticket-detail-voll](../assets/ui-audit/nachher/ticket-detail-voll.png) |
| Ticket-Detail mit Kontext-Drawer | ![ticket-detail-kontext](../assets/ui-audit/nachher/ticket-detail-kontext.png) |
| Team | ![team-voll](../assets/ui-audit/nachher/team-voll.png) |
| Prompts | ![prompts-voll](../assets/ui-audit/nachher/prompts-voll.png) |
| Vorlagen | ![vorlagen-voll](../assets/ui-audit/nachher/vorlagen-voll.png) |
| Repos | ![repos-voll](../assets/ui-audit/nachher/repos-voll.png) |
| Repos · Wissen | ![repos-wissen-voll](../assets/ui-audit/nachher/repos-wissen-voll.png) |
| Workflows | ![workflows-voll](../assets/ui-audit/nachher/workflows-voll.png) |
| Pipelines | ![pipelines-voll](../assets/ui-audit/nachher/pipelines-voll.png) |
| Einstellungen | ![einstellungen-voll](../assets/ui-audit/nachher/einstellungen-voll.png) |
| Zeitverlauf | ![zeitverlauf-voll](../assets/ui-audit/nachher/zeitverlauf-voll.png) |

Nicht per Vorschau-Route erreichbar sind die Zustände, die einen Klick im Fenster verlangen (Dialoge, Team-Prompt- und Blaupausen-Drawer, Autopilot-Popover, Posteingang-Popover). Der Posteingang ist als Seitenleisten-Block belegt; die Popover-Aufnahme aus T-115 bleibt als Vorher-Beleg. Die betroffenen Nachher-Zellen nennen den Grund einzeln.

---

## 3. Seiten, Ansichten und Zustände (Vorher-Screenshots)

### 3.1 Board (`mods/fabric/views/board.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll** | ![board-voll](../assets/ui-audit/vorher/board-voll.png)<br>`docs/assets/ui-audit/vorher/board-voll.png` | ![board-voll](../assets/ui-audit/nachher/board-voll.png)<br>`docs/assets/ui-audit/nachher/board-voll.png` | 6 Spalten (inkl. Filter `Verworfen`). Auf Karte `T-1` dritte Titelzeile halb abgeschnitten (`U-23`), 5 Status-/Metrik-Elemente auf einer Karte (`U-29`), 4 Nachkommastellen `$0.4200` (`U-16`), toter Knopf „Im Fenster öffnen“ oben rechts (`U-21`), doppelte Autopilot-Lampe (`U-18`). |
| **Leer** | ![board-leer](../assets/ui-audit/vorher/board-leer.png)<br>`docs/assets/ui-audit/vorher/board-leer.png` | ![board-leer](../assets/ui-audit/nachher/board-leer.png)<br>`docs/assets/ui-audit/nachher/board-leer.png` | Nutzt keinen `ui.emptyState`, sondern schreibt in jede leere Spalte einzeln den Kleintext `leer` (`views/board.js:191,203`, `U-20`). |
| **Fehler** | ![board-fehler](../assets/ui-audit/vorher/board-fehler.png)<br>`docs/assets/ui-audit/vorher/board-fehler.png` | ![board-fehler](../assets/ui-audit/nachher/board-fehler.png)<br>`docs/assets/ui-audit/nachher/board-fehler.png` | Drei gestapelte `ui.notice`-Leisten (`loadError`, `flash`, `errorFor("status")`) direkt unter der Filterleiste (`views/board.js:225-230`). |

### 3.2 Tickets – Tabelle und Sidepanel (`mods/fabric/views/tickets-page.js`, `mods/fabric/views/tickets.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll (Fenster)** | ![tickets-voll](../assets/ui-audit/vorher/tickets-voll.png)<br>`docs/assets/ui-audit/vorher/tickets-voll.png` | ![tickets-voll](../assets/ui-audit/nachher/tickets-voll.png)<br>`docs/assets/ui-audit/nachher/tickets-voll.png` | Rechte Spalte `Kommentare` wird am Fensterrand zu `Komme` abgeschnitten (`U-24`). Toter Knopf „Im Fenster öffnen“ im Header (`U-21`). Eigener Filter-Schlüssel `includeDroppedTable` synchronisiert nicht mit `showDropped` des Boards (`U-19`). |
| **Voll (Sidepanel)** | ![tickets-panel-voll](../assets/ui-audit/vorher/tickets-panel-voll.png)<br>`docs/assets/ui-audit/vorher/tickets-panel-voll.png` | ![tickets-panel-voll](../assets/ui-audit/nachher/tickets-panel-voll.png)<br>`docs/assets/ui-audit/nachher/tickets-panel-voll.png` | Stufenliste mit Schnellanlage im rechten Sidepanel (`views/tickets.js`). Im Detail-Modus heißt der Reject-Knopf hier `Zurück` statt `Zurück mit Feedback` (`U-15`) und `Abnehmen` umgeht die im Hauptfenster erzwungene `changesGate`-Prüfung (`U-22`). |
| **Leer** | ![tickets-leer](../assets/ui-audit/vorher/tickets-leer.png)<br>`docs/assets/ui-audit/vorher/tickets-leer.png` | ![tickets-leer](../assets/ui-audit/nachher/tickets-leer.png)<br>`docs/assets/ui-audit/nachher/tickets-leer.png` | Nutzt `ui.emptyState` („Keine Tickets in dieser Auswahl“) mit Primärknopf „Neues Ticket“ (`views/tickets-page.js:82-92`). |
| **Fehler** | ![tickets-fehler](../assets/ui-audit/vorher/tickets-fehler.png)<br>`docs/assets/ui-audit/vorher/tickets-fehler.png` | ![tickets-fehler](../assets/ui-audit/nachher/tickets-fehler.png)<br>`docs/assets/ui-audit/nachher/tickets-fehler.png` | `loadError` und `flash` werden über `ui.notice` unter der Filterleiste angezeigt (`views/tickets-page.js:77-78`). |

### 3.3 Ticket-Detail und Kontextvorschau (`mods/fabric/views/ticket.js`, `mods/fabric/views/context.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll** | ![ticket-detail-voll](../assets/ui-audit/vorher/ticket-detail-voll.png)<br>`docs/assets/ui-audit/vorher/ticket-detail-voll.png` | ![ticket-detail-voll](../assets/ui-audit/nachher/ticket-detail-voll.png)<br>`docs/assets/ui-audit/nachher/ticket-detail-voll.png` | Beginnt nicht mit `ui.header(...)`, sondern mit eigenem zweizeiligen `head()` (`U-04`). Überladene Kopfzeile mit Status-Chip, `wartet auf dich`, `Lauf rot`-Pill, redundantem `Läufe`-Chip, `Was sieht der Agent?` und Branch-Chip (`U-30`). Jeder Kommentar trägt einen permanenten Knopf `Als Entscheidung` plus `1 Erwähnung`-Chip (`U-29`). Rechts heißt das Feld `Wartezeiten` während die Stufen `In Arbeit`, `Prüfung bei ada`, `wartet auf mensch` (Liegezeiten) listen (`U-15`). |
| **Voll (Kontext-Drawer & Wecken)** | ![ticket-detail-kontext](../assets/ui-audit/vorher/ticket-detail-kontext.png)<br>`docs/assets/ui-audit/vorher/ticket-detail-kontext.png` | ![ticket-detail-kontext](../assets/ui-audit/nachher/ticket-detail-kontext.png)<br>`docs/assets/ui-audit/nachher/ticket-detail-kontext.png` | Geöffneter Drawer „Was sieht der Agent?“ (`views/context.js`) mit Breite `560 px` verdeckt die gesamte Eigenschaften-Spalte und staucht die linke Spalte auf `~330 px` (`U-28`). |
| **Leer** | ![ticket-detail-leer](../assets/ui-audit/vorher/ticket-detail-leer.png)<br>`docs/assets/ui-audit/vorher/ticket-detail-leer.png` | ![ticket-detail-leer](../assets/ui-audit/nachher/ticket-detail-leer.png)<br>`docs/assets/ui-audit/nachher/ticket-detail-leer.png` | Ticket `T-4` ohne Beschreibung und ohne Verlauf: Beschreibung nutzt `ui.emptyState` („Keine Beschreibung“), der Verlauf darunter jedoch nur eine nackte Textzeile „Noch kein Verlauf.“ (`views/ticket.js:509`, `U-20`). |
| **Fehler** | ![ticket-detail-fehler](../assets/ui-audit/vorher/ticket-detail-fehler.png)<br>`docs/assets/ui-audit/vorher/ticket-detail-fehler.png` | ![ticket-detail-fehler](../assets/ui-audit/nachher/ticket-detail-fehler.png)<br>`docs/assets/ui-audit/nachher/ticket-detail-fehler.png` | Inline-Fehlermeldungen (`ui.notice`) an Titel, Beschreibung, Änderungen, Checks, Kommentarfeld und Aktionsleiste. Ist das Ticket selbst unlesbar (`!app.ticket`), zeigt `views/ticket.js:1013` fälschlich `ui.loading` mit Endlos-Spinner statt `ui.notice`/`ui.emptyState` (`U-20`). |

### 3.4 Team (`mods/fabric/views/team.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll** | ![team-voll](../assets/ui-audit/vorher/team-voll.png)<br>`docs/assets/ui-audit/vorher/team-voll.png` | ![team-voll](../assets/ui-audit/nachher/team-voll.png)<br>`docs/assets/ui-audit/nachher/team-voll.png` | Zwei Primärknöpfe (`+ Neues Team` und `+ Neue Blaupause`, beide `primary: true`) nebeneinander im Header (`U-11`). Rollen stehen als rohe Schlüssel `umsetzer`, `pruefer` neben `UI / UX Designer` (`U-17`). Orchestrator-Status steht doppelt in derselben Team-Karte (oben als Pill `gestoppt` und 28 px darunter im Orchestrator-Block erneut als Pill `gestoppt`, `U-18`). Mitglieder-Zeilen haben Eingabefelder für Modell und `max-cost` ohne Feld-Labels (`U-05`). |
| **Voll (Prompt-Drawer)** | ![team-prompt-drawer](../assets/ui-audit/vorher/team-prompt-drawer.png)<br>`docs/assets/ui-audit/vorher/team-prompt-drawer.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Geöffneter Drawer „Orchestrator-Prompt · herdr-app“ (`width: 560`). Während der Drawer offen ist, schneidet die linke Team-Ansicht die Header-Knöpfe `+ Neues Team` / `+ Neue Blaupause` ab (`U-25`). Zudem ist dies ein zweiter Pflegeort für denselben Orchestrator-Prompt neben der Seite `Prompts` (`U-19`). |
| **Leer** | ![team-leer](../assets/ui-audit/vorher/team-leer.png)<br>`docs/assets/ui-audit/vorher/team-leer.png` | ![team-leer](../assets/ui-audit/nachher/team-leer.png)<br>`docs/assets/ui-audit/nachher/team-leer.png` | Weder die leere Blaupausen-Karte (`views/team.js:128-139`) noch die leere Team-Liste (`views/team.js:544-547`) nutzen `ui.emptyState`; stattdessen eigene `v_flex`-Blöcke ohne Aktionsknopf bei „Noch keine Teams“ (`U-20`). |
| **Fehler** | ![team-fehler](../assets/ui-audit/vorher/team-fehler.png)<br>`docs/assets/ui-audit/vorher/team-fehler.png` | ![team-fehler](../assets/ui-audit/nachher/team-fehler.png)<br>`docs/assets/ui-audit/nachher/team-fehler.png` | `rosterError` und `flash` oben am Seitenkopf sowie Inline-Notices im Orchestrator-Block und am Fuß der Team-Karte (`views/team.js:227,489,538-539`). |

### 3.5 Prompts und Vorlagen (`mods/fabric/views/prompts.js`, `mods/fabric/views/templates.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll (Prompts)** | ![prompts-voll](../assets/ui-audit/vorher/prompts-voll.png)<br>`docs/assets/ui-audit/vorher/prompts-voll.png` | ![prompts-voll](../assets/ui-audit/nachher/prompts-voll.png)<br>`docs/assets/ui-audit/nachher/prompts-voll.png` | Zweispaltig (`LIST = 250`). Links steht `725 B`, rechts im selben Fenster `725 Bytes` (`U-16`). Der Untertitel der Liste zeigt für `orchestrator` und `preamble` die englischen `kind`-Schlüssel `orchestrator · 12989 B` / `preamble · 725 B`, für Agenten aber deutsch `Rolle` (`U-17`). Eigener Editor-Header rechts mit abweichenden Abständen (`U-04`). |
| **Leer (Prompts)** | ![prompts-leer](../assets/ui-audit/vorher/prompts-leer.png)<br>`docs/assets/ui-audit/vorher/prompts-leer.png` | ![prompts-leer](../assets/ui-audit/nachher/prompts-leer.png)<br>`docs/assets/ui-audit/nachher/prompts-leer.png` | Zwei `ui.emptyState`-Flächen nebeneinander (links „Keine Prompts“, rechts „Prompt wählen“). |
| **Fehler (Prompts)** | ![prompts-fehler](../assets/ui-audit/vorher/prompts-fehler.png)<br>`docs/assets/ui-audit/vorher/prompts-fehler.png` | ![prompts-fehler](../assets/ui-audit/nachher/prompts-fehler.png)<br>`docs/assets/ui-audit/nachher/prompts-fehler.png` | Rote `promptError`- und `errorFor("prompt")`-Notices sowie gelbe Warn-Notice für unbekannte Platzhalter über dem Editor (`views/prompts.js:121-125`). |
| **Voll (Vorlagen)** | ![vorlagen-voll](../assets/ui-audit/vorher/vorlagen-voll.png)<br>`docs/assets/ui-audit/vorher/vorlagen-voll.png` | ![vorlagen-voll](../assets/ui-audit/nachher/vorlagen-voll.png)<br>`docs/assets/ui-audit/nachher/vorlagen-voll.png` | Nutzt in der Navigation (`main.js:38`) und im Header (`views/templates.js:115`) exakt dasselbe Icon `prompt` wie die Seite `Prompts`. Links `256 B`, rechts `256 Bytes` (`U-16`). |
| **Leer (Vorlagen)** | ![vorlagen-leer](../assets/ui-audit/vorher/vorlagen-leer.png)<br>`docs/assets/ui-audit/vorher/vorlagen-leer.png` | ![vorlagen-leer](../assets/ui-audit/nachher/vorlagen-leer.png)<br>`docs/assets/ui-audit/nachher/vorlagen-leer.png` | Zwei `ui.emptyState`-Flächen nebeneinander („Keine Vorlagen“ / „Vorlage wählen“). |
| **Fehler (Vorlagen)** | ![vorlagen-fehler](../assets/ui-audit/vorher/vorlagen-fehler.png)<br>`docs/assets/ui-audit/vorher/vorlagen-fehler.png` | ![vorlagen-fehler](../assets/ui-audit/nachher/vorlagen-fehler.png)<br>`docs/assets/ui-audit/nachher/vorlagen-fehler.png` | `templateError` und `errorFor("template")` stehen als `ui.notice` nur in der rechten Editor-Spalte statt unter dem Seitenkopf (`views/templates.js:93-95`, `U-04`). |

### 3.6 Repos (`mods/fabric/views/repos.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll (Prüfskript)** | ![repos-voll](../assets/ui-audit/vorher/repos-voll.png)<br>`docs/assets/ui-audit/vorher/repos-voll.png` | ![repos-voll](../assets/ui-audit/nachher/repos-voll.png)<br>`docs/assets/ui-audit/nachher/repos-voll.png` | Links in der Repo-Zeile stehen englische Dateischlüssel-Chips `verify` und `lessons` neben dem deutschen Chip `Steckbrief`, während die Reiter rechts `Prüfskript`, `Lernnotizen`, `Steckbrief`, `Wissen` heißen (`U-14`). Im Testlauf-Block steht ein statischer, informationsloser Chip `jetzt` (`views/repos.js:78`, `U-30`). |
| **Voll (Wissen)** | ![repos-wissen-voll](../assets/ui-audit/vorher/repos-wissen-voll.png)<br>`docs/assets/ui-audit/vorher/repos-wissen-voll.png` | ![repos-wissen-voll](../assets/ui-audit/nachher/repos-wissen-voll.png)<br>`docs/assets/ui-audit/nachher/repos-wissen-voll.png` | Reiter `Wissen` zeigt Dateien mit rohen englischen `file.kind`-Chips (`pdf`, `markdown`) und einer zusätzlichen Unterüberschrift „Wissen“, die den aktiven Reiter-Namen doppelt wiederholt (`U-18`). |
| **Leer** | ![repos-leer](../assets/ui-audit/vorher/repos-leer.png)<br>`docs/assets/ui-audit/vorher/repos-leer.png` | ![repos-leer](../assets/ui-audit/nachher/repos-leer.png)<br>`docs/assets/ui-audit/nachher/repos-leer.png` | Links `ui.emptyState` („Keine Repos“). Rechts bei fehlendem `.fabric/verify.sh` oder im leeren Wissensordner (`views/repos.js:145-149, 259-275`) eigene Inline-Container statt `ui.emptyState` (`U-20`). |
| **Fehler** | ![repos-fehler](../assets/ui-audit/vorher/repos-fehler.png)<br>`docs/assets/ui-audit/vorher/repos-fehler.png` | ![repos-fehler](../assets/ui-audit/nachher/repos-fehler.png)<br>`docs/assets/ui-audit/nachher/repos-fehler.png` | `reposError` unter dem Seitenkopf, `errorFor("repo-set")` unter der Reiterleiste und `errorFor("repo-test")` im Testlauf-Kasten (`views/repos.js:80,247,296`). |

### 3.7 Workflows (`mods/fabric/views/workflows.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll (Laufansicht)** | ![workflows-voll](../assets/ui-audit/vorher/workflows-voll.png)<br>`docs/assets/ui-audit/vorher/workflows-voll.png` | ![workflows-voll](../assets/ui-audit/nachher/workflows-voll.png)<br>`docs/assets/ui-audit/nachher/workflows-voll.png` | In der linken Liste steht `8 Knoten · 11 Kanten · 2 Laufe` (Rechtschreibfehler `Laufe` statt `Läufe`, `views/workflows.js:117`, `U-16`). Im Graphen schneiden senkrechte Kanten und Labels (`fail`, `pass`) mitten durch die Knotenkarten (`U-26`). Die Modus-Umschaltung `Lauf` / `Builder` nutzt zwei `ui.button` mit `primary`-Wechsel statt `ui.tabs` (`U-11`). |
| **Voll (Builder)** | ![workflows-builder](../assets/ui-audit/vorher/workflows-builder.png)<br>`docs/assets/ui-audit/vorher/workflows-builder.png` | ![workflows-builder](../assets/ui-audit/nachher/workflows-builder.png)<br>`docs/assets/ui-audit/nachher/workflows-builder.png` | Kanten-Labels (`pass`, `done`, `→`) mit Höhe `18 px` überlappen bei `gapY: 12` die oberen und unteren Rahmen der Knotenkarten (`U-26`). Knotentyp heißt im Builder `Agent-Schritt`, in der Laufansicht dagegen `Agent` (`U-15`). Eigene Konstanten `padding: 16`, `gapX: 12`, `gapY: 12` und `.text_size(10)` statt Token aus `ui.js` (`U-01`, `U-06`). |
| **Leer** | ![workflows-leer](../assets/ui-audit/vorher/workflows-leer.png)<br>`docs/assets/ui-audit/vorher/workflows-leer.png` | ![workflows-leer](../assets/ui-audit/nachher/workflows-leer.png)<br>`docs/assets/ui-audit/nachher/workflows-leer.png` | Links in der Spalte stehen reine Textzeilen („Kein Workflow gewählt“ / „Noch kein Lauf“), rechts `ui.emptyState` („Keine Workflows“ bzw. „Kein Lauf“). |
| **Fehler** | ![workflows-fehler](../assets/ui-audit/vorher/workflows-fehler.png)<br>`docs/assets/ui-audit/vorher/workflows-fehler.png` | ![workflows-fehler](../assets/ui-audit/nachher/workflows-fehler.png)<br>`docs/assets/ui-audit/nachher/workflows-fehler.png` | Vier verschiedene Fehlerdarstellungen auf einer Seite: `ui.notice` oben (`flowError`, `flowRunsError`), ein eigener handgebauter gelber `pendingNotice`-Balken (`views/workflows.js:958-980`, `U-10`), eine rote Aufzählung `• …` im Prüfungs-Block rechts (`views/workflows.js:896-902`) und `ui.notice` unter dem Speichern-Knopf. |

### 3.8 Pipelines (`mods/fabric/views/pipelines.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll** | ![pipelines-voll](../assets/ui-audit/vorher/pipelines-voll.png)<br>`docs/assets/ui-audit/vorher/pipelines-voll.png` | ![pipelines-voll](../assets/ui-audit/nachher/pipelines-voll.png)<br>`docs/assets/ui-audit/nachher/pipelines-voll.png` | Linke Spalte ist `300 px` breit (`LIST = 300`, während Prompts/Vorlagen `250 px` und Repos/Workflows `260 px` nutzen, `U-03`). Log-Stream-Spalte (`out`/`err`) nutzt `.text_size(9)` unterhalb des kleinsten Font-Tokens `FONT.xs = 11` (`views/pipelines.js:183`, `U-07`). |
| **Leer** | ![pipelines-leer](../assets/ui-audit/vorher/pipelines-leer.png)<br>`docs/assets/ui-audit/vorher/pipelines-leer.png` | ![pipelines-leer](../assets/ui-audit/nachher/pipelines-leer.png)<br>`docs/assets/ui-audit/nachher/pipelines-leer.png` | Links doppelter Text „Noch kein Lauf / `fab verify` legt einen Lauf an.“ und rechts gleichzeitig `ui.emptyState` mit exakt demselben Titel und Text (`views/pipelines.js:75-90, 316-321`, `U-20`). |
| **Fehler** | ![pipelines-fehler](../assets/ui-audit/vorher/pipelines-fehler.png)<br>`docs/assets/ui-audit/vorher/pipelines-fehler.png` | ![pipelines-fehler](../assets/ui-audit/nachher/pipelines-fehler.png)<br>`docs/assets/ui-audit/nachher/pipelines-fehler.png` | Gestapelte `ui.notice`-Leisten für `pipelineRunsError`, `pipelineDetailError` und `pipeline-rerun` über der zweispaltigen Ansicht. |

### 3.9 Einstellungen (`mods/fabric/views/settings.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll** | ![einstellungen-voll](../assets/ui-audit/vorher/einstellungen-voll.png)<br>`docs/assets/ui-audit/vorher/einstellungen-voll.png` | ![einstellungen-voll](../assets/ui-audit/nachher/einstellungen-voll.png)<br>`docs/assets/ui-audit/nachher/einstellungen-voll.png` | Feste Kartenbreiten `w(440)` in einer `flex_wrap`-Zeile plus `max_w(900)` darunter führen bei Standardfensterbreite (`~893 px` Inhaltsbereich) zu ungleichmäßigem Umbruch und freier Restfläche rechts (`U-03`). Im Abschnitt „Benachrichtigungen“ steht dreimal das englische Wort `Inbox` (`U-13`). Außerdem wirft `infoRow` beim Klick auf den Kopier-Knopf (`views/settings.js:43`) einen `ReferenceError: app is not defined`, weil `app` nicht als Parameter an `infoRow` übergeben wird (`U-22`). |
| **Leer** | ![einstellungen-leer](../assets/ui-audit/vorher/einstellungen-leer.png)<br>`docs/assets/ui-audit/vorher/einstellungen-leer.png` | ![einstellungen-leer](../assets/ui-audit/nachher/einstellungen-leer.png)<br>`docs/assets/ui-audit/nachher/einstellungen-leer.png` | **Notiz zum Leerzustand:** Die Einstellungsseite besitzt keinen eigenen `emptyState`, weil Datenordner, CLI-/Roster-Pfade, Benachrichtigungs-Schalter und Tastentabelle statische App-Metadaten sind. Ohne Tickets/Ereignisse stehen Zähler auf `0`, Kosten auf `$0.00` und `Stand der Index-Datei` auf `—`. |
| **Fehler** | ![einstellungen-fehler](../assets/ui-audit/vorher/einstellungen-fehler.png)<br>`docs/assets/ui-audit/vorher/einstellungen-fehler.png` | ![einstellungen-fehler](../assets/ui-audit/nachher/einstellungen-fehler.png)<br>`docs/assets/ui-audit/nachher/einstellungen-fehler.png` | `loadError`, `errorFor("index")` und `flash` stehen als `ui.notice` oben; `versionError` erscheint inline in der Zeile `Version` („nicht lesbar: …“), die Kostenlimit-Warnung als rote Fußzeile in der Karte `Kosten`. |

### 3.10 Inbox / Posteingang (`mods/fabric/views/inbox.js`, `mods/fabric/main.js:4801-4905`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll** | ![inbox-voll](../assets/ui-audit/vorher/inbox-voll.png)<br>`docs/assets/ui-audit/vorher/inbox-voll.png` | ![inbox-voll](../assets/ui-audit/nachher/inbox-voll.png)<br>`docs/assets/ui-audit/nachher/inbox-voll.png` *(Sidebar-Block; Popover nur per Klick)* | Drei schwerwiegende Fehler im Popover (`main.js:4801-4905`): (1) Der Knopf oben heißt `Inbox`, das Popover und die Seitenleiste heißen `Posteingang` (`U-13`). (2) Ein Lehren-Eintrag (`kind: "lesson"`) quetscht wegen `.when(Boolean(lesson), …)` mit `.w_full()` auf der äußeren `h_flex()` den Text auf `T-` zusammen (`U-25`). (3) Ein Entscheidungs-Vorschlag (`kind: "decision"`) zeigt den unübersetzten englischen Chip `decision`, weil `decision` in `INBOX_WORDS` fehlt (`U-14`). Zudem ragt das Popover über den oberen Fensterrand hinaus (`U-27`). |
| **Leer** | ![inbox-leer](../assets/ui-audit/vorher/inbox-leer.png)<br>`docs/assets/ui-audit/vorher/inbox-leer.png` | ![inbox-leer](../assets/ui-audit/nachher/inbox-leer.png)<br>`docs/assets/ui-audit/nachher/inbox-leer.png` *(Sidebar-Block; Popover nur per Klick)* | Popover zeigt `ui.emptyState` („Nichts zu tun / Der Posteingang ist leer.“). |
| **Fehler** | ![inbox-fehler](../assets/ui-audit/vorher/inbox-fehler.png)<br>`docs/assets/ui-audit/vorher/inbox-fehler.png` | ![inbox-fehler](../assets/ui-audit/nachher/inbox-fehler.png)<br>`docs/assets/ui-audit/nachher/inbox-fehler.png` *(Sidebar-Block; Popover nur per Klick)* | Im Seitenleisten-Block `Posteingang` werden bei `loadError` eine `ui.notice` und darunter ein `ui.emptyState` mit dem Fehlertext in die nur `~105 px` hohe Fläche gepresst, sodass der Text unten abgeschnitten wird (`U-44`). |

### 3.11 Zeitverlauf (`mods/fabric/views/timeline.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Voll** | ![zeitverlauf-voll](../assets/ui-audit/vorher/zeitverlauf-voll.png)<br>`docs/assets/ui-audit/vorher/zeitverlauf-voll.png` | ![zeitverlauf-voll](../assets/ui-audit/nachher/zeitverlauf-voll.png)<br>`docs/assets/ui-audit/nachher/zeitverlauf-voll.png` | Workflow-Ereignisse (`kind: "flow"`, `actor: "flow"`) erscheinen als unübersetztes **`flow flow`** mit Initialen-Avatar `FL`, weil `flow` (ebenso wie `decision` und `alarm`) in `EVENT_WORDS`, `actorLabel` und `eventSummary` fehlt (`U-14`). |
| **Leer** | ![zeitverlauf-leer](../assets/ui-audit/vorher/zeitverlauf-leer.png)<br>`docs/assets/ui-audit/vorher/zeitverlauf-leer.png` | ![zeitverlauf-leer](../assets/ui-audit/nachher/zeitverlauf-leer.png)<br>`docs/assets/ui-audit/nachher/zeitverlauf-leer.png` | Zeigt `ui.emptyState` („Kein Verlauf für T-4“ mit Chip-Aktion „Alle Ereignisse“). Die Aktion im `emptyState` ist hier ein `ui.chip` statt wie überall sonst ein `ui.button` (`U-11`). |
| **Fehler** | ![zeitverlauf-fehler](../assets/ui-audit/vorher/zeitverlauf-fehler.png)<br>`docs/assets/ui-audit/vorher/zeitverlauf-fehler.png` | ![zeitverlauf-fehler](../assets/ui-audit/nachher/zeitverlauf-fehler.png)<br>`docs/assets/ui-audit/nachher/zeitverlauf-fehler.png` | Zeigt bei fehlendem Index `ui.emptyState(t, { title: "Zeitverlauf", text: app.loadError })` statt `ui.notice` für `app.loadError` (`views/timeline.js:112-114`, `U-20`). |

### 3.12 Dialoge und Blaupausen-Drawer (`mods/fabric/views/dialogs.js`)

**Notiz zu den Zuständen `leer`, `voll`, `Fehler` bei Dialogen:** Modale Dialoge existieren nur im geöffneten Zustand. Ihr „leerer“ Zustand ist das frisch geöffnete Formular mit deaktiviertem Primärknopf (`!canCreate` bzw. `!reason`), ihr „voller“ Zustand das ausgefüllte Formular mit Kontextdetails, ihr „Fehler“-Zustand die eingebettete `ui.notice` bei Validierungs- oder `fab`-Fehlern. Die folgenden acht Aufnahmen belegen alle Dialoge und den Blaupausen-Drawer inklusive ihrer Fehler- und Sperrzustände:

| Dialog / Drawer | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Neues Ticket (Voll + Fehlerhinweis)** | ![dialog-neues-ticket](../assets/ui-audit/vorher/dialog-neues-ticket.png)<br>`docs/assets/ui-audit/vorher/dialog-neues-ticket.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Nutzt manuelle `div().text_size(T.xs).text_color(t.dim)`-Labels statt `ui.field(...)` (`views/dialogs.js:77,81,97,120`, `U-27`). Dropdowns haben feste Breite `width: 360` im `580 px` breiten Dialog. |
| **Neues Team (Voll + Fehler)** | ![dialog-neues-team](../assets/ui-audit/vorher/dialog-neues-team.png)<br>`docs/assets/ui-audit/vorher/dialog-neues-team.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Breite `620 px`; mischt `ui.field(...)` für `Name` mit einer lokalen Helferfunktion `sectionLabel(t, ...)` für `Repos`, `Mitglieder`, `Prüferin / Prüfer` und `Gleichzeitige Sessions` (`views/dialogs.js:14,355-459`, `U-27`). |
| **Ticket abnehmen** | ![dialog-abnehmen](../assets/ui-audit/vorher/dialog-abnehmen.png)<br>`docs/assets/ui-audit/vorher/dialog-abnehmen.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Breite `520 px`; zeigt Merge-Ziel, Branch, Worktree und beendete Sessions mit Aktionen „Abbrechen“, „Nur PR öffnen“, „Abnehmen“. |
| **Ticket verwerfen** | ![dialog-verwerfen](../assets/ui-audit/vorher/dialog-verwerfen.png)<br>`docs/assets/ui-audit/vorher/dialog-verwerfen.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Breite `520 px`; Pflichtfeld `Grund (steht im Verlauf)` ohne `ui.field(...)` (`views/dialogs.js:222`). |
| **Team / Blaupause löschen (Fehler)** | ![dialog-loeschen](../assets/ui-audit/vorher/dialog-loeschen.png)<br>`docs/assets/ui-audit/vorher/dialog-loeschen.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Breite `540 px`; zeigt Sperrgrund von `fab team rm` als `ui.notice` im Modal-Fuß. |
| **Ungespeicherte Änderungen** | ![dialog-ungespeichert](../assets/ui-audit/vorher/dialog-ungespeichert.png)<br>`docs/assets/ui-audit/vorher/dialog-ungespeichert.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Breite `520 px`; Aufzählung geänderter Bereiche mit „Abbrechen“, „Verwerfen“, „Speichern“. |
| **Notiz anlegen (Validierungsfehler)** | ![dialog-notiz](../assets/ui-audit/vorher/dialog-notiz.png)<br>`docs/assets/ui-audit/vorher/dialog-notiz.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Breite `560 px`; bei ungültigem Namen (`../ungueltig`) erscheint `ui.notice` unter dem Textfeld. Fünf verschiedene Modal-Breiten (`440`, `480`, `520`, `540`, `560`, `580`, `620 px`) über 8 Dialoge (`U-27`). |
| **Blaupausen-Drawer** | ![drawer-blaupause](../assets/ui-audit/vorher/drawer-blaupause.png)<br>`docs/assets/ui-audit/vorher/drawer-blaupause.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Untertitel schreibt `1 Team(s)` (`views/dialogs.js:631`, `U-16`). Im Hintergrund schneidet die Team-Seite den Header-Knopf `+ Neue Blaupause` ab (`U-25`). |

### 3.13 Seitenleiste (`mods/fabric-sidebar/main.js`, `mods/fabric-sidebar/model.js`)

| Zustand | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-117) | Beobachtung |
|---|---|---|---|
| **Voll (Pixel-Karten, Teams & Posteingang)** | ![seitenleiste-voll](../assets/ui-audit/vorher/seitenleiste-voll.png)<br>`docs/assets/ui-audit/vorher/seitenleiste-voll.png` | — *(T-117, nicht aufgenommen)* | Freie Pixel-Karten nutzen durchgängig englische Großbuchstaben (`AGENTS`, `1 BUSY`, `THIS MACHINE`, `WAITING`, `WORKING`, `IDLE`, `U-40`), während direkt darunter im Team `herdr-app` deutsche Kleinschreibung (`bereit`, `wartet`, `arbeitet`) und rohe Rollenschlüssel (`pruefer`, `umsetzer`, `U-41`) stehen. Sechs verschiedene Nicht-Token-Schriftgrößen (`8.5`, `9.5`, `10`, `10.5`, `11`, `11.5`, `12 px`, `U-34`). |
| **Leer** | ![seitenleiste-leer](../assets/ui-audit/vorher/seitenleiste-leer.png)<br>`docs/assets/ui-audit/vorher/seitenleiste-leer.png` | — *(T-117, nicht aufgenommen)* | Eigener zweizeiliger Leertext („Keine Fabric-Agenten / fab dispatch startet einen.“) mit `11.5 px`/`10.5 px` (`mods/fabric-sidebar/main.js:528-535`). Unten im `Posteingang`-Block überlappt `ui.emptyState` die Kopfzeile und schneidet den Knopf „Zum Board“ halb ab (`U-44`). |
| **Fehler** | ![seitenleiste-fehler](../assets/ui-audit/vorher/seitenleiste-fehler.png)<br>`docs/assets/ui-audit/vorher/seitenleiste-fehler.png` | — *(T-117, nicht aufgenommen)* | `loadError` erscheint nur als nackte rote `10.5 px`-Zeile „Ticketdaten nicht lesbar“ ohne Fehlerpunkt/Rahmen (`mods/fabric-sidebar/main.js:510-519`, `U-38`). Freie Karte zeigt englisches `ERROR`, Team-Zeile darunter deutsches `Fehler` (`U-40`). |

### 3.14 Toasts (`mods/fabric-toast/main.js`)

**Notiz zu den Zuständen `leer`, `voll`, `Fehler`:** Ohne aktiven Toast rendert Herdr kein Toast-Overlay (`leer` = kein Overlay). Die Aufnahme `vorher/toast-ansicht.png` zeigt gleichzeitig einen Fehler-/Aufmerksamkeits-Toast (`level: "error"`) und einen Prüfungs-Toast (`level: "info"`) mit „Öffnen“-Knopf.

| Ansicht | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-117) | Beobachtung |
|---|---|---|---|
| **Voll & Fehler (Toast-Stack)** | ![toast-ansicht](../assets/ui-audit/vorher/toast-ansicht.png)<br>`docs/assets/ui-audit/vorher/toast-ansicht.png` | — *(T-117, nicht aufgenommen)* | Eigene Maße abseits der `ui.js`-Token (`px(18)`, `gap(12)`, `rounded(4)`, `px(8).py(4)`, `U-33`, `U-36`). Für Login-Meldungen stehen englische Texte im Code (`needs a login: run`, `Copy`, `Copied`, `mods/fabric-toast/main.js:45,52`, `U-42`). |

### 3.15 Autopilot-Lampe (`mods/fabric/ui.js:193-202`, `mods/fabric/main.js:4580-4733`)

**Notiz zu den Zuständen `leer`, `voll`, `Fehler`:** Die Lampe bildet die Zustände `aus` (`stopped`), `an` (`running`), `pausiert` (`paused`), `keine Antwort` (`stale`) und `Alarm` (`alarm`) ab; im Popover hat das Log den Leerzustand „Noch kein Log.“, den vollen Zustand (letzte 20 Zeilen) und den Fehlerzustand `errorFor("autopilot-log")`.

| Ansicht | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116) | Beobachtung |
|---|---|---|---|
| **Trigger (doppelt) & Popover (Voll/Alarm)** | ![lampe-autopilot](../assets/ui-audit/vorher/lampe-autopilot.png)<br>`docs/assets/ui-audit/vorher/lampe-autopilot.png` | — *(nur per Klick im Fenster erreichbar; die Preview-Route öffnet keine Dialoge oder Popover)* | Der Autopilot-Trigger ist doppelt im Fenster vorhanden: links unter dem Fabric-Logo (`#fabric-autopilot-side-panel-trigger`) und oben in der Kopfleiste (`#fabric-autopilot-panel-trigger`, `U-18`). Das geöffnete Popover klappt nach oben über den Fensterrand hinaus (`U-27`). Zudem pulsiert `autopilotDot` mit `period: 900` ms und `opacity: 0.35..1` (65 % Hub in 0,9 s statt ruhiger Statusanzeige, `U-12`). |

### 3.16 Alarm-Banner (`mods/fabric/main.js:4512-4547`, `mods/fabric-sidebar/main.js:294-344`)

**Notiz zu den Zuständen `leer`, `voll`, `Fehler`:** Ohne aktiven Alarm (`!alarmActive`) wird kein Banner gerendert (`leer`). Ein aktiver Alarm ist per Definition der `Fehler`- und `voll`-Zustand (roter `main`-Lauf, pausierter Autopilot oder überfälliger `tick`).

| Ansicht | Vorher (`docs/assets/ui-audit/vorher/`) | Nachher (T-116 / T-117) | Beobachtung |
|---|---|---|---|
| **Voll / Fehler (Fenster & Seitenleiste)** | ![banner-alarm](../assets/ui-audit/vorher/banner-alarm.png)<br>`docs/assets/ui-audit/vorher/banner-alarm.png` | ![banner-alarm](../assets/ui-audit/nachher/banner-alarm.png)<br>`docs/assets/ui-audit/nachher/banner-alarm.png` | Fenster-Banner (`main.js:4512-4547`) und Seitenleisten-Banner (`fabric-sidebar/main.js:294-344`) sind getrennt gebaut und weichen optisch stark voneinander ab (`U-43`): im Fenster `bg(t.blocked + "14")`, `border(t.blocked + "55")`, `6 px`-Punkt, rote Schrift (`t.blocked`) und Standard-`ui.button(..., { small: true })` in `t.raised`; in der Seitenleiste `bg(t.blocked + "1f")`, `border(t.blocked + "66")`, Ausrufezeichen `!`, weiße Schrift (`t.foreground`, `10.5 px`) und rote Eigenbau-Knöpfe (`h(18)`). |

---

## 4. Befundliste (`U-01` bis `U-44`)

### 4.1 Übersichtsmatrix

| ID | Ort (`Datei:Zeile` / Seite) | Kategorie | Zuordnung | Status | Kurzbeschreibung |
|---|---|---|---|---|---|
| **U-01** | `mods/fabric/views/workflows.js:33-38, 412-419` (Workflows) | Abstand | T-116 | erledigt (0b06018) | `padding: 16`, `gapX: 12`, `gapY: 12` als Rohzahlen statt `ui.SPACE` (bricht T-116-Regex). |
| **U-02** | `mods/fabric/views/*.js`, `mods/fabric/main.js:4303-4883` (Alle Fensterseiten) | Abstand | T-116 | erledigt (0b06018, df49bb3, 194803d) | Abweichende `gap(...)`- und `p/px/py(...)`-Rohzahlen (`1`, `2`, `3`, `5`, `6`, `7`, `9`) außerhalb von `ui.SPACE` (`4/8/12/16/24`). |
| **U-03** | `mods/fabric/views/prompts.js:10`, `templates.js:10`, `repos.js:10`, `workflows.js:12`, `pipelines.js:11`, `ticket.js:11`, `settings.js:175-179` | Abstand | T-116 | erledigt (0b06018, df49bb3) | Vier verschiedene Spaltenbreiten für linke Listen (`250`, `260`, `300`, `320 px`) und starre `w(440)`-Karten in Einstellungen. |
| **U-04** | `mods/fabric/views/ticket.js:26-104`, `workflows.js:189-297`, `pipelines.js:122-174`, `prompts.js:93-120`, `templates.js:68-92` | Abstand | T-116 | erledigt (ff4d7b8, 0b06018, df49bb3) | Detail- und Unterköpfe bauen eigene Header mit `px(12)`/`py(8)`/`py(12)` statt konsistenter `ui.header`-/`ui.sectionTitle`-Komponenten. |
| **U-05** | `mods/fabric/views/team.js:319-331` (Team) | Abstand | T-116 | erledigt (0b06018) | Mitglieder-Zeilen im Team-Formular reihen `Modell`- und `max-cost`-Inputs ohne Spaltenüberschrift oder `ui.field`-Label aneinander. |
| **U-06** | `mods/fabric/views/workflows.js:399, 593, 624, 644` (Workflows) | Schriftgröße | T-116 | erledigt (0b06018) | Vier Stellen nutzen `.text_size(10)` statt `ui.FONT.xs` (`11 px`, Untergrenze laut Vertrag). |
| **U-07** | `mods/fabric/views/pipelines.js:183` (Pipelines) | Schriftgröße | T-116 | erledigt (0b06018) | Stream-Spalte (`out`/`err`) im Schritt-Log nutzt `.text_size(9)` statt `ui.FONT.xs`. |
| **U-08** | `mods/fabric/ui.js:257` (Avatar-Baustein) | Schriftgröße | T-116 | erledigt (ff4d7b8) | `ui.avatar` berechnet `.text_size(Math.max(9, Math.round(size * 0.4)))` (ergibt `9 px` bzw. `10 px` statt `FONT.xs`). |
| **U-09** | `mods/fabric/ui.js:179,212,234,255,317,339,340,368,801`, `main.js:4380,4522,4524`, `views/board.js:166`, `views/ticket.js:670`, `views/workflows.js:390` | Farbe | T-116 | erledigt (ff4d7b8, 0b06018, df49bb3) | Zehn verschiedene handcodierte Hex-Alpha-Suffixe (`"00"`, `"14"`, `"18"`, `"1a"`, `"1c"`, `"1e"`, `"1f"`, `"26"`, `"2b"`, `"55"`, `"66"`, `"b8"`) über Views verstreut. |
| **U-10** | `mods/fabric/views/workflows.js:958-980`, `main.js:4512-4547` (Workflows, Fenster-Banner) | Farbe | T-116 | erledigt (ff4d7b8, 0b06018) | `pendingNotice` und `alarmBanner` bauen eigene farbige Hinweisbalken statt `ui.notice` bzw. gemeinsamer Banner-Komponente in `ui.js`. |
| **U-11** | `mods/fabric/views/team.js:503-525`, `workflows.js:216-233`, `timeline.js:29-36, 121` | Farbe | T-116 | erledigt (0b06018, df49bb3) | Zwei Primärknöpfe nebeneinander im Team-Header; `ui.button` (`primary`) bzw. `ui.chip` als Tab-/Filter-Umschalter statt `ui.tabs`. |
| **U-12** | `mods/fabric/ui.js:198-202` (Autopilot-Lampe) | Farbe | T-116 | erledigt (ff4d7b8) | `autopilotDot` pulsiert mit `period: 900` ms und `from: 0.35, to: 1` (hektisches Blinken statt ruhigem Atmen ≥ 2000 ms). |
| **U-13** | `mods/fabric/main.js:4824`, `views/settings.js:143,147,148`, `views/ticket.js:567`, `model.js:1080` | Begriff | T-116 | erledigt (0b06018, df49bb3) | Mischgebrauch `Inbox` (englisch) und `Posteingang` (deutsch) im selben Fenster. |
| **U-14** | `mods/fabric/model.js:26-44, 51-56, 1375, 1458-1545`, `ui.js:91-95`, `views/repos.js:35-38, 99` | Begriff | T-116 | erledigt (ff4d7b8, 0b06018) | Fehlende deutsche Wörter für `decision` (zeigt `decision`-Chip in der Inbox) und `flow` (zeigt `flow flow` im Zeitverlauf); englische Chips `verify`/`lessons` in Repos. |
| **U-15** | `mods/fabric/views/ticket.js:884`, `views/tickets.js:234`, `views/workflows.js:18, 260`, `views/team.js:187`, `model.js:1986` | Begriff | T-116 | erledigt (0b06018, df49bb3) | Uneinheitliche Bezeichnungen derselben Sache: `Wartezeiten` vs. `Liegezeiten`, `Zurück` vs. `Zurück mit Feedback`, `Abbruch` vs. `Abbrechen`, `Stopp` vs. `Stoppen`, `Agent-Schritt` vs. `Agent`. |
| **U-16** | `mods/fabric/views/workflows.js:117`, `views/dialogs.js:631`, `views/prompts.js:53,99`, `views/templates.js:48,71`, `model.js:1216-1221` | Begriff | T-116 | erledigt (ff4d7b8, 0b06018, df49bb3) | Tippfehler `2 Laufe` statt `2 Läufe`; `1 Team(s)` statt `1 Team`/`2 Teams`; `B` vs. `Bytes`; 4 Nachkommastellen `$0.4200` neben `$1.28`. |
| **U-17** | `mods/fabric/views/team.js:72,94,305,328,341`, `views/prompts.js:53,98`, `views/ticket.js:609,835` | Begriff | T-116 | erledigt (ff4d7b8, 0b06018, df49bb3) | Rohe interne Rollenschlüssel (`umsetzer`, `pruefer`) und Prompt-Arten (`orchestrator`, `preamble` vs. `Rolle`) werden unformatiert angezeigt. |
| **U-18** | `mods/fabric/main.js:4322-4327, 4426-4431, 4494`, `views/team.js:162, 441`, `views/repos.js:118, 208` | Doppelfunktion | T-116 | erledigt (0b06018) | Autopilot-Lampe doppelt im Fenster (Navigation + Kopfleiste); Orchestrator-Status-Pill doppelt in derselben Team-Karte; Überschrift `Wissen` doppelt unter Reiter `Wissen`. |
| **U-19** | `mods/fabric/main.js:112-113`, `views/board.js:152`, `views/tickets-page.js:12`, `views/team.js:218, 553` | Doppelfunktion | T-116 | erledigt (0b06018) | Getrennter `Verworfen`-Filterzustand zwischen Board (`showDropped`) und Tabelle (`includeDroppedTable`); doppelte Pflege des Orchestrator-Prompts in `Team` und `Prompts`. |
| **U-20** | `mods/fabric/views/board.js:191,203`, `ticket.js:509,1013`, `team.js:128,544`, `repos.js:145,259`, `pipelines.js:75-90`, `timeline.js:113` | Doppelfunktion | T-116 | erledigt (0b06018, df49bb3, a83eb4b) | Sechs Seiten bauen eigene Leer- und Fehlerzustände (oder zeigen Endlos-Spinner / doppelten Leertext) statt `ui.emptyState` und `ui.notice`. |
| **U-21** | `mods/fabric/views/board.js:216-222`, `views/tickets-page.js:64-70` (Board, Tickets) | toter Knopf | T-116 | erledigt (0b06018, df49bb3) | Knopf „Im Fenster öffnen“ (`active: true`) wird im bereits geöffneten Hauptfenster gerendert und bewirkt beim Klick nichts. |
| **U-22** | `mods/fabric/views/settings.js:37-44`, `views/tickets.js:221-231` (Einstellungen, Panel Tickets) | toter Knopf | T-116 | erledigt (0b06018, df49bb3) | Kopier-Knopf in `settings.js:43` wirft `ReferenceError: app is not defined`; `Abnehmen`-Knopf im Sidepanel `tickets.js:221` ist trotz ungesehener Änderungen aktiv und scheitert erst beim Klick am Gate. |
| **U-23** | `mods/fabric/views/board.js:110-119` (Board) | abgeschnittener Text | T-116 | erledigt (0b06018) | `max_h(36)` mit `overflow_hidden()` ohne Zeilenbegrenzung schneidet die dritte Titelzeile auf Board-Karten vertikal mitten durch die Buchstaben ab. |
| **U-24** | `mods/fabric/model.js:322-330`, `views/tickets-page.js:97-108` (Tickets) | abgeschnittener Text | T-116 | erledigt (ff4d7b8, df49bb3) | Feste Spaltenbreiten (`Summe 884 px` + Abstände = `956 px`) übersteigen die Fenster-Inhaltsbreite (`~893 px`); Spalte `Kommentare` wird zu `Komme` abgeschnitten. |
| **U-25** | `mods/fabric/main.js:4845-4900`, `views/team.js:529-537` (Inbox-Popover, Team) | abgeschnittener Text | T-116 | erledigt (0b06018, 194803d) | Im Inbox-Popover quetscht `.when(Boolean(lesson), …)` mit `.w_full()` auf der äußeren `h_flex()` den Lehren-Text auf `T-`; auf der Team-Seite schneiden offene Drawer die Header-Knöpfe `+ Neues Team` / `+ Neue Blaupause` ab. |
| **U-26** | `mods/fabric/views/workflows.js:315-359, 550-597`, `model.js:2171-2263` (Workflows) | abgeschnittener Text | T-116 | erledigt (ff4d7b8, 0b06018) | Senkrechte Kanten und `when`-Labels laufen mitten durch Knotenkarten; im Builder überlappen `18 px` hohe Kanten-Labels den `12 px` kleinen Knotenabstand (`gapY: 12`). |
| **U-27** | `mods/fabric/views/dialogs.js:54-566`, `ui.js:806-829`, `main.js:4622, 4904` (Dialoge, Popover) | Dialog | T-116 | erledigt (ff4d7b8, 0b06018, df49bb3) | Fünf verschiedene Modal-Breiten (`480`–`620 px`), uneinheitliche Feld-Labels (teils `ui.field`, teils `sectionLabel`, teils rohe `div`s); Kopfleisten-Popovers (`Inbox`, `Autopilot`) ragen nach oben über den Fensterrand hinaus. |
| **U-28** | `mods/fabric/views/team.js:564`, `views/context.js:22`, `views/dialogs.js:634`, `ui.js:831-852` (Drawer) | Dialog | T-116 | erledigt (0b06018, df49bb3, 194803d) | Inkonsistente Drawer-Breiten (`420 px` vs. `560 px`) und Schließen-Knöpfe (`Abbrechen` vs. `Schließen`); `560 px`-Drawer im Ticket-Detail drückt den Hauptinhalt auf `~330 px` zusammen. |
| **U-29** | `mods/fabric/views/board.js:100-148`, `views/ticket.js:400-419`, `views/tickets.js:91-118` (Board, Ticket-Detail) | Chips | T-116 | erledigt (0b06018, df49bb3) | Chip-Überflutung auf Board-Karten (bis zu 5 Chips/Pills + 2 Statuspunkte pro Karte) und im Ticket-Verlauf (jeder Kommentar trägt permanent `Als Entscheidung` + `N Erwähnungen`-Chip). |
| **U-30** | `mods/fabric/views/ticket.js:37-73`, `views/repos.js:76-78`, `views/team.js:435-469` (Ticket-Detail, Repos, Team) | Chips | T-116 | erledigt (0b06018, df49bb3) | Redundante und aktionsähnliche Chips: klickbarer Chip `Läufe` direkt neben klickbarer Pill `Lauf rot/grün` im Ticket-Kopf; informationsloser Chip `jetzt` im Repo-Testlauf; Zähler-Chips `3 Mitglieder` / `1 Repo` doppelt zur Überschrift darunter. |
| **U-31** | `mods/fabric-sidebar/main.js:73-343, 479-534` (Seitenleiste) | Abstand | T-117 | offen | Seitenleiste nutzt durchgehend Einzelzahlen (`px(5)`, `px(6)`, `px(10)`, `pt(6)`, `pb(2)`, `pb(3)`, `p(3)`, `p(6)`, `gap(1..6)`, `h(14)`, `h(16)`, `h(17)`, `h(18)`) statt der `SPACE`-/`SIZE`-Token aus `mods/fabric/ui.js`. |
| **U-32** | `mods/fabric-sidebar/main.js:75,95,159,174,199,217,261,266,299,330,489` (Seitenleiste) | Abstand | T-117 | offen | Sieben verschiedene Einzel-Radien (`1`, `3`, `4`, `6`, `8`) statt `RADIUS` (`s: 6, m: 8, l: 12`) aus `mods/fabric/ui.js`. |
| **U-33** | `mods/fabric-toast/main.js:33,34,40,47,49,55` (Toast) | Abstand | T-117 | offen | Toast nutzt `px(18)`, `gap(12)`, `rounded(4)`, `px(6).py(3)` und `px(8).py(4)` statt der Token `SPACE` und `RADIUS` aus `mods/fabric/ui.js`. |
| **U-34** | `mods/fabric-sidebar/main.js:77,97,115,117,142,144,160,162,219,226,229,232,241,273,311,315,334,483,491,515,532,533` | Schriftgröße | T-117 | offen | Seitenleiste verwendet sieben verschiedene Einzel-Schriftgrößen (`8.5`, `9.5`, `10`, `10.5`, `11`, `11.5`, `12 px`), davon vier unterhalb der `11 px`-Untergrenze (`FONT.xs`). |
| **U-35** | `mods/fabric-sidebar/main.js:219, 232` (Pixel-Karten in Seitenleiste) | Schriftgröße | T-117 | offen | Status-Badge (`8.5 px`) und Aufgabenzeile (`9.5 px`) der Pixel-Karten unterschreiten die `11 px`-Mindestgröße für UI-Text deutlich. |
| **U-36** | `mods/fabric-toast/main.js:45,46,48,50,56` (Toast) | Schriftgröße | T-117 | offen | Toast codiert `.text_size(13)` und `.text_size(12)` als Rohzahlen statt `FONT.m` (`13`) und `FONT.s` (`12`). |
| **U-37** | `mods/fabric-sidebar/main.js:76,96,201,202,205,218,300,302,332,333,340` (Seitenleiste) | Farbe | T-117 | offen | Acht verschiedene Hex-Alpha-Suffixe (`"12"`, `"18"`, `"1a"`, `"1e"`, `"1f"`, `"26"`, `"33"`, `"40"`, `"66"`) in `fabric-sidebar/main.js` weichen von den Chip-/Banner-Farben des Fensters ab. |
| **U-38** | `mods/fabric-sidebar/main.js:510-519` (Seitenleiste) | Farbe | T-117 | offen | Ladefehler „Ticketdaten nicht lesbar“ ist eine nackte `10.5 px`-Textzeile ohne Hintergrund, Rahmen oder Punkt (anders als `ui.notice` im Fenster). |
| **U-39** | `mods/fabric-toast/main.js:49-58` (Toast) | Farbe | T-117 | offen | Toast-Knöpfe (`Öffnen`, `Copy`) sind als rahmenlose `div`s ohne `border_1().border_color(t.input)` gebaut und wirken anders als `ui.button` im Fenster. |
| **U-40** | `mods/fabric-sidebar/main.js:142`, `mods/fabric-sidebar/model.js:282-298, 387-389` (Seitenleiste) | Begriff | T-117 | offen | Englische Großbuchstaben `AGENTS`, `N BUSY`, `THIS MACHINE` und `WORKING`/`WAITING`/`DONE`/`IDLE`/`ERROR` direkt über deutschen Team-Zeilen. |
| **U-41** | `mods/fabric-sidebar/model.js:5-11, 69-87, 119-121, 215-220` (Seitenleiste) | Begriff | T-117 | offen | Rohe interne Rollenschlüssel (`umsetzer`, `pruefer`) und englische Kurz-Zeiteinheiten (`<1m`, `5m`, `2h`, `3d` statt `< 1 min`, `5 min`, `2 h`, `3 T`) in der Seitenleiste; `blocked` heißt hier `wartet`, im Fenster `wartet auf dich`. |
| **U-42** | `mods/fabric-toast/main.js:17-18, 45, 52` (Toast) | Begriff | T-117 | offen | Englische Meldungs- und Knopftexte `needs a login: run`, `Copy` und `Copied` im Toast-Mod. |
| **U-43** | `mods/fabric-sidebar/main.js:294-344`, `mods/fabric-sidebar/model.js:553-579` (Seitenleiste) | Doppelfunktion | T-117 | offen | Seitenleisten-Alarm-Banner dupliziert Logik und Darstellung des Fenster-Alarm-Banners mit abweichenden Farben, Schriften und Knöpfen. |
| **U-44** | `layouts/fabric.json:61-82`, `mods/fabric-sidebar/main.js:527-535`, `mods/fabric/views/inbox.js:98-110` (Seitenleiste) | abgeschnittener Text | T-117 | offen | Der `fabric-inbox`-Block in der Seitenleiste (`weight: 2`, `min: 90`) ist für `ui.header` + `ui.emptyState` zu niedrig: „Nichts zu tun“ überlappt die Kopfzeile, „Zum Board“ und Fehlertexte werden unten abgeschnitten. |

---

### 4.2 Detaillierte Befunde für T-116 (`mods/fabric`)

#### U-01 · `mods/fabric/views/workflows.js:33-38, 412-419` · Kategorie: Abstand · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/workflows-voll.png`, `docs/assets/ui-audit/vorher/workflows-builder.png`
- **Befund:** In `views/workflows.js:33-38` (`BUILDER = { nodeWidth: 160, nodeHeight: 72, gapX: 12, gapY: 12, padding: 16 }`) und `views/workflows.js:412-419` (`model.flowLayout(definition, { ..., gapX: 12, gapY: 12, padding: 16 })`) stehen `padding: 16` und `gapX: 12, gapY: 12` als nackte Zahlen statt über `ui.SPACE` (`S.l` und `S.m`). `rg -n 'fontSize: *[0-9]|padding: *[0-9]|gap: *[0-9]|#[0-9a-fA-F]{6}' mods/fabric/views mods/fabric/main.js` schlägt an genau diesen beiden Zeilen an.
- **Vorschlag:** In `views/workflows.js:33-38` und `412-419` die Layout-Abstände aus `ui.SPACE` beziehen (bzw. die Standardmaße zentral in `ui.SIZE` / `ui.SPACE` hinterlegen und über `S.m` / `S.l` referenzieren), sodass die Regex-Prüfung in T-116 null Treffer liefert.

#### U-02 · `mods/fabric/views/*.js`, `mods/fabric/main.js:4303-4883` · Kategorie: Abstand · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-voll.png`, `docs/assets/ui-audit/vorher/ticket-detail-voll.png`, `docs/assets/ui-audit/vorher/team-voll.png`
- **Befund:** Obwohl `mods/fabric/ui.js:15` die 8-pt/4-pt-Skala `SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24 }` vorgibt, nutzen die Views und `main.js` über 90 rohe Zahlen in `.gap(...)` und `.p/.px/.py/.pt/.pb/.pl/.pr(...)`:
  - `views/board.js`: `.gap(3)` (`41, 128`), `.gap(5)` (`100, 163`), `.gap(6)` (`87, 121`), `.gap(8)` (`135` statt `S.s`).
  - `views/ticket.js`: `.gap(1)` (`205, 268`), `.gap(2)` (`279`), `.gap(4)` (`398, 453, 522, 778, 805, 870, 884` statt `S.xs`), `.gap(5)` (`385, 660, 667, 711, 721, 829`), `.gap(6)` (`757`), `.px(6)` (`211, 666, 720`), `.py(2)` (`384`), `.py(6)` (`397`), `.pl(30)` (`421, 426`).
  - `views/team.js`: `.gap(1)` (`90`), `.gap(2)` (`45`), `.gap(5)` (`374, 396`), `.gap(6)` (`71, 91, 174, 224, 310`), `.py(4)` (`86` statt `S.xs`), `.py(6)` (`46`), `.pl(36)` (`71, 77`).
  - `views/pipelines.js`: `.gap(1)` (`233`), `.gap(2)` (`75, 86, 92`), `.gap(3)` (`45`), `.gap(4)` (`130` statt `S.xs`), `.gap(5)` (`62`), `.gap(6)` (`52`), `.py(6)` (`257`), `.pl(19)` (`62`).
  - `views/prompts.js`: `.gap(1)` (`50`), `.gap(2)` (`34`), `.gap(4)` (`69`), `.gap(5)` (`61`), `.gap(6)` (`68`), `.py(5)` (`42`).
  - `views/templates.js`: `.gap(1)` (`44`), `.gap(2)` (`28`), `.py(5)` (`36`).
  - `views/repos.js`: `.gap(2)` (`58, 143`), `.gap(3)` (`18`), `.gap(5)` (`25, 32, 66`), `.gap(6)` (`186`).
  - `views/tickets-page.js`: `.gap(5)` (`31`), `.gap(6)` (`20`).
  - `views/tickets.js`: `.gap(1)` (`56`), `.gap(2)` (`177, 184`), `.gap(4)` (`117`), `.gap(5)` (`59`), `.gap(6)` (`164`), `.py(1)` (`181`), `.py(4)` (`184`), `.py(6)` (`46`), `.pl(26)` (`190`).
  - `views/inbox.js`: `.gap(3)` (`21`), `.gap(4)` (`53`).
  - `views/timeline.js`: `.pb(2)` (`43`), `.py(5)` (`59`), `.gap(2)` (`79`).
  - `views/dialogs.js`: `.gap(5)` (`437, 457`), `.gap(6)` (`590`).
  - `views/switcher.js`: `.pl(6)` (`21`), `.pr(4)` (`22`), `.gap(2)` (`23`).
  - `main.js`: `.gap(2)` (`4303, 4311, 4358`), `.px(8).gap(8)` (`4316-4317` statt `ui.SPACE.s`), `.gap(6)` (`4394, 4592, 4807, 4863`), `.px(9)` (`4806`), `.py(7)` (`4849`), `.gap(1)` (`4862`), `.gap(4)` (`4883`).
- **Vorschlag:** Alle Abstände in `mods/fabric/views/*.js` und `mods/fabric/main.js` konsequent auf `ui.SPACE` (`xs: 4, s: 8, m: 12, l: 16, xl: 24`, ggf. ergänzt um `xxs: 2` in `ui.SPACE` für kompakte Listen) umstellen und wiederkehrende Listen-Zeilen als Baustein in `ui.js` kapseln.

#### U-03 · `mods/fabric/views/prompts.js:10`, `templates.js:10`, `repos.js:10`, `workflows.js:12`, `pipelines.js:11`, `ticket.js:11`, `settings.js:175-179` · Kategorie: Abstand · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/prompts-voll.png`, `docs/assets/ui-audit/vorher/repos-voll.png`, `docs/assets/ui-audit/vorher/pipelines-voll.png`, `docs/assets/ui-audit/vorher/einstellungen-voll.png`
- **Befund:** Jede zweispaltige Seite im Fabric-Fenster definiert ihre eigene linke/rechte Spaltenbreite als lokale Konstante: `prompts.js:10` und `templates.js:10` nutzen `LIST = 250`, `repos.js:10` und `workflows.js:12` nutzen `LIST = 260`, `pipelines.js:11` nutzt `LIST = 300`, `ticket.js:11` und `workflows.js:936` nutzen `320 px`, `workflows.js:1044` nutzt `340 px`. Auf der Einstellungsseite (`views/settings.js:175-179`) haben die oberen drei Karten eine starre Breite `.w(440)`, während die beiden unteren Karten `.w_full().max_w(900)` nutzen; bei Standardfensterbreite (`~893 px` Inhaltsbereich) passen oben nicht zwei `440 px`-Karten plus `12 px` Gap (`892 px < 892.8 px`, je nach Scrollbar bricht die zweite oder dritte Karte asymmetrisch um und lässt rechts eine halbe Spalte leer).
- **Vorschlag:** Spaltenbreiten in `ui.SIZE` zentralisieren (z. B. einheitlich `SIZE.listPane = 260` für Master-Listen links und `SIZE.inspector = 320` für Eigenschaften-Spalten rechts). Auf der Einstellungsseite alle Karten in einem konsistenten `max_w(900)`-Raster (oben `flex_1().min_w(280)` in einer `h_flex()` oder einspaltig/zweispaltig bündig zu `max_w(900)`) ausrichten.

#### U-04 · `mods/fabric/views/ticket.js:26-104`, `workflows.js:189-297`, `pipelines.js:122-174`, `prompts.js:93-120`, `templates.js:68-92`, `repos.js:184-246` · Kategorie: Abstand · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/ticket-detail-voll.png`, `docs/assets/ui-audit/vorher/workflows-voll.png`, `docs/assets/ui-audit/vorher/pipelines-voll.png`
- **Befund:**
  1. `views/ticket.js:26-104` beginnt im geladenen Zustand **nicht** mit `ui.header(t, ...)`, sondern mit einem eigenen zweizeiligen `head()`-Block (`px(S.l).py(S.m)`), während der Ladezustand in `views/ticket.js:1010` `ui.header(t, "Ticket", ...)` verwendet.
  2. Die Detail-Spalten in `prompts.js:93-120`, `templates.js:68-92`, `repos.js:184-246`, `workflows.js:189-297` und `pipelines.js:122-174` bauen jeweils eigene Kopfzeilen mit unterschiedlichen Innenabständen (`p(S.l)` in Prompts/Vorlagen/Repos vs. `px(S.m).py(S.s)` mit `border_b(1)` in Workflows/Pipelines) und platzieren Fehlermeldungen (`ui.notice`) teils über der gesamten Seite (`pipelines.js:358`, `workflows.js:1141`), teils erst innerhalb der rechten Detailspalte unter der Werkzeugleiste (`prompts.js:121`, `templates.js:93`).
- **Vorschlag:** `views/ticket.js` im geladenen wie im leeren/ladenden Zustand mit `ui.header(...)` beginnen lassen; für die rechte Detailspalte von Master-Detail-Seiten (`Prompts`, `Vorlagen`, `Repos`, `Workflows`, `Pipelines`) einen gemeinsamen `ui.detailHeader(t, ...)`-Baustein in `ui.js` nutzen und Seitenfehler einheitlich direkt unter `ui.header` als `ui.notice` rendern.

#### U-05 · `mods/fabric/views/team.js:319-331` · Kategorie: Abstand · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/team-voll.png`
- **Befund:** In der Team-Karte (`views/team.js:319-331`, `memberRow`) stehen neben Avatar, Name und Rolle jedes Mitglieds zwei unbeschriftete Eingabefelder (`member.model` und `member.maxCost`) ohne Spaltenkopf und ohne `ui.field`-Label. Sobald ein Wert eingetragen ist (oder im kompakten Layout untereinander, `views/team.js:316-317`), ist ohne Platzhaltertext nicht mehr erkennbar, welches Feld das Modell und welches das Kostenlimit (`max-cost` in USD) ist.
- **Vorschlag:** Im Abschnitt `Mitglieder` (`views/team.js:345-354`) eine dezente Spaltenkopfzeile (`Mitglied`, `Modell-Übersteuerung`, `Kostenlimit ($)`) oder `ui.field`-Beschriftungen ergänzen.

#### U-06 · `mods/fabric/views/workflows.js:399, 593, 624, 644` · Kategorie: Schriftgröße · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/workflows-voll.png`, `docs/assets/ui-audit/vorher/workflows-builder.png`
- **Befund:** In `views/workflows.js` nutzen vier Stellen `.text_size(10)` statt `ui.FONT.xs` (`11 px`): der Knotenstatus in der Laufansicht (`Zeile 399`), das Kanten-Label im Builder (`Zeile 593`), der Knotentyp im Builder (`Zeile 624`) und das Knotendetail im Builder (`Zeile 644`). Dies verstößt gegen den Vertrag `docs/fabric-ui.md` Abschnitt 3 („Schrift 11/12/13/15/18“) und die 11-px-Untergrenze für UI-Text.
- **Vorschlag:** Alle vier `.text_size(10)`-Aufrufe in `views/workflows.js` durch `.text_size(T.xs)` (`ui.FONT.xs = 11`) ersetzen.

#### U-07 · `mods/fabric/views/pipelines.js:183` · Kategorie: Schriftgröße · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/pipelines-voll.png`
- **Befund:** In `views/pipelines.js:183` (`logLine`) wird das Stream-Kürzel (`out`/`err`) mit `.text_size(9)` gerendert – `2 px` unterhalb des kleinsten erlaubten Tokens `ui.FONT.xs` (`11 px`) und `3 px` unterhalb der 12-px-Untergrenze für Monospace-Text.
- **Vorschlag:** `.text_size(9)` in `views/pipelines.js:183` auf `ui.FONT.xs` (bzw. `ui.FONT.s` passend zur Logzeile) anheben.

#### U-08 · `mods/fabric/ui.js:257` · Kategorie: Schriftgröße · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-voll.png`, `docs/assets/ui-audit/vorher/tickets-voll.png`
- **Befund:** `ui.avatar` (`mods/fabric/ui.js:257`) berechnet die Schriftgröße der Initialen dynamisch über `.text_size(Math.max(9, Math.round(size * 0.4)))`. Für `size = 18` (Board-Karten, Tickets-Tabelle, Sidepanel) ergibt das `9 px`, für `size = 24` (`SIZE.avatar`) `10 px` – beides außerhalb der `FONT`-Rampe (`11/12/13/15/18`).
- **Vorschlag:** In `ui.avatar` Token-Werte aus `FONT` nutzen (`size >= 28 ? FONT.s : FONT.xs`), statt Größen unter `11 px` zu berechnen.

#### U-09 · `mods/fabric/ui.js`, `mods/fabric/main.js`, `mods/fabric/views/*.js` · Kategorie: Farbe · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-voll.png`, `docs/assets/ui-audit/vorher/ticket-detail-voll.png`, `docs/assets/ui-audit/vorher/workflows-voll.png`
- **Befund:** Transparenz-Abstufungen von Theme-Farben werden an über 20 Stellen durch String-Konkatenation mit zehn verschiedenen zweistelligen Hex-Alpha-Werten erzeugt:
  - `+ "00"` (transparent): `ui.js:368, 695, 1022, 1048`, `views/pipelines.js:47`, `views/prompts.js:46`, `views/repos.js:20`, `views/templates.js:40`, `views/workflows.js:105, 132, 732`
  - `+ "14"` (~8 %): `main.js:4522`, `views/workflows.js:390`
  - `+ "18"` (~9 %): `ui.js:340`, `views/ticket.js:670`
  - `+ "1a"` (~10 %): `views/board.js:166`
  - `+ "1c"` (~11 %): `ui.js:317`
  - `+ "1e"` (~12 %): `ui.js:234`
  - `+ "1f"` (~12 %): `ui.js:212`, `main.js:4380`
  - `+ "26"` (~15 %): `ui.js:179`
  - `+ "2b"` (~17 %): `ui.js:255`
  - `+ "55"` (~33 %) / `+ "66"` (~40 %): `main.js:4524`, `ui.js:339`
  - `+ "b8"` (~72 %): `ui.js:801`
  Dadurch haben Chips (`+"1e"`), Pills (`+"1f"`), Badges (`+"26"`), Notices (`+"1c"`), Alarm-Banner (`+"14"`), Spaltenköpfe (`+"1a"`) und Blockade-Zeilen (`+"18"`) minimal unterschiedliche, zufällig wirkende Hintergrundsättigungen.
- **Vorschlag:** In `mods/fabric/ui.js` einen einzigen Satz benannter Alpha-/Flächenhelfer definieren (z. B. `ALPHA = { subtle: "18", tint: "24", border: "55", backdrop: "b8", clear: "00" }` bzw. `ui.tint(color)` / `ui.tintBorder(color)`) und in allen Views ausschließlich diese Helfer bzw. `ui.js`-Komponenten verwenden.

#### U-10 · `mods/fabric/views/workflows.js:958-980`, `mods/fabric/main.js:4512-4547` · Kategorie: Farbe · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/workflows-fehler.png`, `docs/assets/ui-audit/vorher/banner-alarm.png`
- **Befund:** `pendingNotice` in `views/workflows.js:958-980` baut einen eigenen gelben Warnbalken (`bg(t.working + "1c")`, ohne den `6 px`-Farbpunkt von `ui.notice`, mit `.text_size(T.xs)` statt `FONT.s`). Ebenso baut `alarmBanner` in `main.js:4512-4547` einen eigenen roten Balken (`bg(t.blocked + "14")`, `border_color(t.blocked + "55")`), der optisch von `ui.notice(t, ..., "error")` abweicht.
- **Vorschlag:** `ui.notice(t, message, level, { actions = [], id = null })` in `ui.js` um optionale Aktionsknöpfe erweitern und sowohl für `pendingNotice` in `views/workflows.js` als auch für `alarmBanner` in `main.js` wiederverwenden.

#### U-11 · `mods/fabric/views/team.js:503-525`, `mods/fabric/views/workflows.js:216-233`, `mods/fabric/views/timeline.js:29-36, 121` · Kategorie: Farbe · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/team-voll.png`, `docs/assets/ui-audit/vorher/workflows-voll.png`, `docs/assets/ui-audit/vorher/zeitverlauf-voll.png`, `docs/assets/ui-audit/vorher/zeitverlauf-leer.png`
- **Befund:**
  1. Im Header der `Team`-Seite (`views/team.js:503-525`) stehen zwei Primärknöpfe (`+ Neues Team` mit `primary: true` und `+ Neue Blaupause` mit `primary: true`) direkt nebeneinander, zuzüglich des globalen Primärknopfs `+ Neues Ticket` direkt darüber in der Fenster-Kopfleiste (drei gefüllte Primärknöpfe auf `80 px` Höhe).
  2. In `views/workflows.js:216-233` wird der Ansichts-Umschalter `Lauf` / `Builder` aus zwei einzelnen `ui.button`-Elementen mit wechselndem `primary: mode === ...` gebaut, während `views/ticket.js:14` (`Ansicht` / `Bearbeiten`) und `views/repos.js:201` (`Prüfskript` / `Lernnotizen` / `Steckbrief` / `Wissen`) für denselben Zweck `ui.tabs` nutzen.
  3. In `views/timeline.js:29-36` wird der Filter `Alle` / `T-1` aus zwei `ui.chip`-Elementen statt `ui.tabs` gebaut, und im `emptyState` (`views/timeline.js:121`) wird als `action` ein `ui.chip` statt `ui.button` übergeben.
- **Vorschlag:** (1) Auf der `Team`-Seite nur `+ Neues Team` als `primary: true` (oder sekundär neben dem globalen `+ Neues Ticket`) und `+ Neue Blaupause` als sekundären Button (`primary: false`) oder direkt im Kopf der Karte `Blaupausen` platzieren. (2) Für `Lauf` / `Builder` in `views/workflows.js` und `Alle` / `<Ticket>` in `views/timeline.js` einheitlich `ui.tabs` verwenden; im `emptyState` von `views/timeline.js:121` `ui.button` statt `ui.chip` nutzen.

#### U-12 · `mods/fabric/ui.js:198-202` · Kategorie: Farbe · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/lampe-autopilot.png`
- **Befund:** `ui.autopilotDot` (`mods/fabric/ui.js:200`) animiert die laufende Autopilot-Lampe mit `.loop("opacity", { from: 0.35, to: 1, period: 900 })`. Ein Zyklus von `900 ms` mit `65 %` Opazitätshub wirkt wie ein hektisches Warnblinken und widerspricht dem Ziel einer ruhigen Arbeitsoberfläche (Designregel: maximal einmal pro 2 s atmen, geringer Opazitätshub).
- **Vorschlag:** Den Puls in `ui.autopilotDot` deutlich beruhigen (z. B. `period: 2400`, dezenter Bereich `from: 0.75, to: 1`) oder auf eine statische grüne Lampe beschränken.

#### U-13 · `mods/fabric/main.js:4824`, `mods/fabric/views/settings.js:143,147,148`, `mods/fabric/views/ticket.js:567`, `mods/fabric/model.js:1080` · Kategorie: Begriff · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/inbox-voll.png`, `docs/assets/ui-audit/vorher/einstellungen-voll.png`, `docs/assets/ui-audit/vorher/ticket-detail-voll.png`
- **Befund:** Für den Posteingang werden im Fenster abwechselnd `Inbox` und `Posteingang` verwendet:
  - `mods/fabric/main.js:4824`: Knopftext `"Inbox"`, während Tooltip (`Zeile 4826`) und Popover-Titel (`Zeile 4837`) `"Posteingang"` heißen.
  - `mods/fabric/views/inbox.js:79`: Header `"Posteingang"`.
  - `mods/fabric/views/ticket.js:567`: Hinweis `"„@name“ weckt. „@mensch“ landet in der Inbox."`
  - `mods/fabric/model.js:1080`: `wakeSummary` erzeugt `"Inbox: ${inbox.join(", ")}"`.
  - `mods/fabric/views/settings.js:143,147,148`: `"Neue Inbox-Einträge melden sich einmal, mit Ton."`, `"Toasts für neue Inbox-Einträge"`, `"… der Eintrag bleibt in der Inbox."`
- **Vorschlag:** Durchgängig die deutsche Zielbezeichnung **`Posteingang`** verwenden (Knopf in der Kopfleiste, `wakeSummary` → `Posteingang: …`, Hinweis im Ticket-Detail, Texte in den Einstellungen).

#### U-14 · `mods/fabric/model.js:26-44, 51-56, 1375, 1458-1545`, `mods/fabric/ui.js:91-95`, `mods/fabric/views/repos.js:35-38, 99` · Kategorie: Begriff · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/inbox-voll.png`, `docs/assets/ui-audit/vorher/zeitverlauf-voll.png`, `docs/assets/ui-audit/vorher/repos-voll.png`, `docs/assets/ui-audit/vorher/repos-wissen-voll.png`
- **Befund:** Mehrere interne Schlüssel aus `index.json` / SQLite werden im UI unübersetzt auf Englisch gerendert:
  1. `mods/fabric/model.js:51-56` (`INBOX_WORDS`): enthält nur `question`, `review`, `attention`, `lesson`. Für offene Entscheidungs-Vorschläge erzeugt `index.py` jedoch Einträge mit `kind: "decision"`. Dadurch zeigt der Posteingang (und der Toast-Titel in `main.js:1060`) das rohe englische Wort **`decision`** (`vorher/inbox-voll.png`).
  2. `mods/fabric/model.js:26-44` (`EVENT_WORDS`) und `1458-1545` (`actorLabel`, `eventSummary`): kennen weder `kind: "flow"` / `actor: "flow"` noch `kind: "decision"`, `kind: "alarm"` oder `actor: "fab"`. Im Zeitverlauf (`vorher/zeitverlauf-voll.png`) erscheint deshalb **`flow flow`** mit Avatar `FL`.
  3. `mods/fabric/views/repos.js:35-38`: Die Repo-Liste links zeigt die Chips **`verify`**, **`kein verify`** und **`lessons`** neben dem deutschen Chip **`Steckbrief`**, obwohl die Reiter rechts (`views/repos.js:205-208`) **`Prüfskript`**, **`Lernnotizen`**, **`Steckbrief`** und **`Wissen`** heißen.
  4. `mods/fabric/views/repos.js:99`: Im Reiter `Wissen` zeigt `ui.chip(t, file.kind, t.muted)` die rohen englischen Dateitypen `markdown` und `pdf`.
- **Vorschlag:**
  1. `INBOX_WORDS` um `decision: "Entscheidung"` (sowie `INBOX_LEVELS` und `ui.inboxColor`) ergänzen.
  2. `EVENT_WORDS`, `actorLabel` und `eventSummary` um `flow` („Workflow“ / „führte Workflow aus“), `decision` („Entscheidung“ / „entschied“), `alarm` („Alarm“) und `fab` („Fabric“) ergänzen.
  3. In `views/repos.js:35-38` die Chips auf **`Prüfskript`** (bzw. **`kein Prüfskript`**) und **`Lernnotizen`** umstellen; Dateitypen im Wissensordner deutsch bzw. als Großbuchstaben-Kürzel (`Markdown`, `PDF`, `Text`, `Bild`) formatieren.

#### U-15 · `mods/fabric/views/ticket.js:884`, `mods/fabric/views/tickets.js:234`, `mods/fabric/views/workflows.js:18, 260`, `mods/fabric/views/team.js:187`, `mods/fabric/model.js:1986` · Kategorie: Begriff · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/ticket-detail-voll.png`, `docs/assets/ui-audit/vorher/workflows-voll.png`, `docs/assets/ui-audit/vorher/workflows-builder.png`, `docs/assets/ui-audit/vorher/team-voll.png`
- **Befund:** Dieselbe Funktion oder Eigenschaft trägt an verschiedenen Stellen im Fenster unterschiedliche deutsche Wörter:
  1. **Liegezeiten vs. Wartezeiten:** `views/ticket.js:884` beschriftet das Feld mit **`Wartezeiten`**, obwohl `ticket.waits.stages` die Verweildauer in allen Stufen (`In Arbeit`, `Prüfung bei ada`, `wartet auf mensch`) enthält und die CLI (`fab show`, `fabric/fablib/render.py`) sowie der Kommentar in `model.js:1213` dafür **`Liegezeiten`** verwenden. Auf der Board-Karte (`views/board.js:31`) steht zudem `wartet 50 min` für die Summe aller Stufen (auch wenn das Ticket 50 min `In Arbeit` war).
  2. **Zurück mit Feedback vs. Zurück:** Im Ticket-Detail (`model.js:204`) heißt der Reject-Knopf **`Zurück mit Feedback`**, im Sidepanel `Tickets` (`views/tickets.js:234`) dagegen nur **`Zurück`** (leicht mit dem Navigationsknopf „Zurück“ zur Liste verwechselbar).
  3. **Abbrechen vs. Abbruch:** In `views/workflows.js:255` heißt der Knopf **`Abbruch`**, während alle Dialoge und Formulare **`Abbrechen`** nutzen.
  4. **Stoppen vs. Stopp:** Im Autopilot-Popover (`main.js:4690`) heißt der Knopf **`Stoppen`**, im Orchestrator-Block (`views/team.js:188`) **`Stopp`**.
  5. **Agent vs. Agent-Schritt:** Der Workflow-Knotentyp `agent` heißt in `model.js:1986` (`FLOW_KIND_WORDS`) **`Agent`**, im Builder (`views/workflows.js:18`, `NODE_TYPE_WORDS`) dagegen **`Agent-Schritt`** (wobei `NODE_TYPE_WORDS`, `TRIGGER_WORDS` und `ACTION_WORDS` in `views/workflows.js:16-31` ohnehin Duplikate von `FLOW_KIND_WORDS` und `FLOW_TRIGGER_WORDS` in `model.js:1984-1998` sind).
- **Vorschlag:** Gemäß Begriffstabelle vereinheitlichen: **`Liegezeiten`** (im Detail-Feld `views/ticket.js:884` und im Board-Chip/Tooltip `views/board.js:31`), **`Zurück mit Feedback`** (auch in `views/tickets.js:234`), **`Abbrechen`**, **`Stoppen`**, **`Agent`** (Duplikat-Wörterbücher in `views/workflows.js:16-31` entfernen und aus `model.js` importieren).

#### U-16 · `mods/fabric/views/workflows.js:117`, `mods/fabric/views/dialogs.js:631`, `mods/fabric/views/prompts.js:53,99`, `mods/fabric/views/templates.js:48,71`, `mods/fabric/model.js:1216-1221` · Kategorie: Begriff · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/workflows-voll.png`, `docs/assets/ui-audit/vorher/drawer-blaupause.png`, `docs/assets/ui-audit/vorher/prompts-voll.png`, `docs/assets/ui-audit/vorher/board-voll.png`
- **Befund:**
  1. In `views/workflows.js:117` steht `${runCount} Lauf${runCount === 1 ? "" : "e"}` → ergibt **`2 Laufe`** (ohne Umlaut) direkt über der Überschrift **`Läufe`** (`Zeile 176`).
  2. In `views/dialogs.js:631` steht `${(blueprint?.teams ?? []).length} Team(s)` mit englischem Klammer-Plural, während `views/team.js:532` sauber `${teams.length} Team${teams.length === 1 ? "" : "s"}` formatiert.
  3. In `views/prompts.js:53,99` und `views/templates.js:48,71` steht links in der Liste `725 B` und rechts im selben Fenster `725 Bytes`, während `model.knowledgeSize` (`model.js:1878-1890`) Dateigrößen bereits sauber in `B`/`KB`/`MB` formatiert.
  4. `model.formatCost` (`model.js:1216-1221`) formatiert Beträge ab `$1` mit 2 Nachkommastellen (`$1.28`), Beträge unter `$1` jedoch mit 4 Nachkommastellen (`$0.4200`, `$0.1900`). Auf dem Board (`board-voll.png`) stehen dadurch `$1.28` und `$0.4200` / `$0.1900` nebeneinander.
- **Vorschlag:** (1) `views/workflows.js:117` zu `${runCount} ${runCount === 1 ? "Lauf" : "Läufe"}` korrigieren. (2) `views/dialogs.js:631` ohne `(s)` formatieren. (3) Dateigrößen in `prompts.js` und `templates.js` einheitlich über `model.knowledgeSize(...)` (oder durchgängig `B`) darstellen. (4) Kosten in `formatCost` für Ticket-/Spaltensummen einheitlich auf 2 Nachkommastellen (`$0.42`, und nur für Sub-Cent-Beträge `< 0.01` vier Stellen oder `< $0.01`) runden, sofern die bestehenden Unit-Tests in `model.test.mjs` entsprechend angepasst werden.

#### U-17 · `mods/fabric/views/team.js:72,94,305,328,341`, `mods/fabric/views/prompts.js:53,98`, `mods/fabric/views/ticket.js:609,835` · Kategorie: Begriff · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/team-voll.png`, `docs/assets/ui-audit/vorher/prompts-voll.png`
- **Befund:**
  1. In `fabric/roster.json` sind Rollen teils als technische ASCII-Schlüssel (`umsetzer`, `pruefer`), teils als Anzeigename (`UI / UX Designer`) gespeichert. Das UI zeigt diese Strings roh an (`umsetzer` und `pruefer` mit `ue` und kleingeschrieben direkt über `UI / UX Designer` in `team-voll.png`).
  2. In `views/prompts.js:53,98` wird `prompt.kind` über `prompt.kind === "agent" ? "Rolle" : prompt.kind` ausgegeben; für `orchestrator` und `preamble` erscheinen dadurch die englischen/kleingeschriebenen Schlüssel `orchestrator` und `preamble` als Typbezeichnung neben `Rolle`.
- **Vorschlag:** In `model.js` eine Formatierfunktion `roleLabel(role)` (`umsetzer` → `Umsetzer`, `pruefer` → `Prüferin / Prüfer`, `orchestrator` → `Orchestrator`) und `promptKindWord(kind)` (`orchestrator` → `Orchestrator`, `preamble` → `Präambel`, `agent` → `Rolle`) bereitstellen und überall im Fenster nutzen.

#### U-18 · `mods/fabric/main.js:4322-4327, 4426-4431, 4494`, `mods/fabric/views/team.js:162, 441`, `mods/fabric/views/repos.js:118, 208` · Kategorie: Doppelfunktion · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-voll.png`, `docs/assets/ui-audit/vorher/lampe-autopilot.png`, `docs/assets/ui-audit/vorher/team-voll.png`, `docs/assets/ui-audit/vorher/repos-wissen-voll.png`
- **Befund:** Drei Elemente werden am selben Ort doppelt gerendert:
  1. **Doppelte Autopilot-Lampe im Fenster:** `this.autopilotTrigger(...)` wird sowohl in der linken Fenster-Navigation unter dem „Fabric“-Titel (`main.js:4322`, `popupId: "fabric-autopilot-side-panel"`) als auch in der oberen Kopfleiste neben `+ Neues Ticket` (`main.js:4426`, `popupId: "fabric-autopilot-panel"`) gerendert. Bei aktivem Alarm steht derselbe Alarmtext dreimal im Fenster (Alarm-Banner oben + Kopfleisten-Lampe + Navigations-Lampe).
  2. **Doppelte Orchestrator-Status-Pill in der Team-Karte:** In `views/team.js:441` zeigt der Kopf der Team-Karte `ui.pill(t, { label: live.word, ... })` (`● gestoppt`), und direkt darunter im eingebetteten `orchestratorBlock` (`views/team.js:162`) steht exakt dieselbe Pill (`● gestoppt`) ein zweites Mal (zusätzlich zur globalen Pill `Orchestrator: gestoppt` unten links in der Fenster-Navigation, `main.js:4339`).
  3. **Doppelte Überschrift „Wissen“:** Im Reiter `Wissen` der Repo-Seite (`views/repos.js:118`) steht direkt unter dem aktiven Tab `Wissen` (`Zeile 208`) nochmals der Titel `Wissen`, während die anderen drei Reiter (`Prüfskript`, `Lernnotizen`, `Steckbrief`) keinen solchen Untertitel wiederholen.
- **Vorschlag:**
  1. Den Autopilot-Trigger im Fenster nur an **einer** Stelle rendern (in der oberen Kopfleiste neben `Posteingang`, sodass die linke Navigation frei für Seitenpunkte bleibt); bei aktivem Alarm im Lampen-Trigger nur das Kurzwort `Alarm` statt des vollständigen Banner-Satzes zeigen.
  2. In `views/team.js:441` die doppelte Status-Pill im Kopf der Team-Karte entfernen, da der `orchestratorBlock` direkt darunter den Status prominent samt Terminal anzeigt.
  3. In `views/repos.js:118` die redundante Überschrift `Wissen` entfalten bzw. die Aktionsknöpfe (`Datei hinzufügen`, `Notiz`) wie bei `Jetzt testen` direkt rechts in die Reiter-Zeile (`views/repos.js:200-246`) legen.

#### U-19 · `mods/fabric/main.js:112-113`, `mods/fabric/views/board.js:152`, `mods/fabric/views/tickets-page.js:12`, `mods/fabric/views/team.js:218, 553` · Kategorie: Doppelfunktion · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-voll.png`, `docs/assets/ui-audit/vorher/tickets-voll.png`, `docs/assets/ui-audit/vorher/team-prompt-drawer.png`, `docs/assets/ui-audit/vorher/prompts-voll.png`
- **Befund:**
  1. `Board` und `Tickets` teilen sich über `ui.fabricFilters` (`ui.js:588`) die Filter `search`, `assigneeFilter` und `repoFilter`, nutzen für das Kontrollkästchen `Verworfen` aber zwei getrennte State-Felder (`this.showDropped` auf dem Board vs. `this.includeDroppedTable` in der Tabelle, `main.js:112-113`). Schaltet der Nutzer `Verworfen` auf dem Board ein und wechselt auf `Tickets`, ist der Filter dort wieder aus, während Suche, Zuständig und Repo aktiv bleiben.
  2. Der Orchestrator-Prompt lässt sich sowohl im Drawer der `Team`-Seite (`views/team.js:553`, `renderTeamPromptDrawer`) als auch auf der Hauptseite `Prompts` (`views/prompts.js`) in einem Vollbild-Editor bearbeiten.
- **Vorschlag:** (1) Für den `Verworfen`-Filter dasselbe State-Feld (`this.showDropped`) auf Board und Tickets-Tabelle verwenden. (2) Den Knopf „Prompt bearbeiten“ im Team-Orchestrator-Block entweder direkt auf die Seite `Prompts` navigieren lassen (sofern kein abweichender Team-Prompt vorliegt) oder die Kopfzeile des Team-Prompt-Drawers an den Editor-Kopf der `Prompts`-Seite angleichen.

#### U-20 · `mods/fabric/views/board.js:191,203`, `ticket.js:509,1013`, `team.js:128,544`, `repos.js:145,259`, `pipelines.js:75-90`, `timeline.js:113` · Kategorie: Doppelfunktion · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-leer.png`, `docs/assets/ui-audit/vorher/team-leer.png`, `docs/assets/ui-audit/vorher/repos-leer.png`, `docs/assets/ui-audit/vorher/pipelines-leer.png`, `docs/assets/ui-audit/vorher/zeitverlauf-fehler.png`
- **Befund:** T-116 fordert: „Leerzustände nutzen `emptyState`, Fehler `notice`.“ Aktuell weichen sechs Views davon ab:
  1. `views/board.js:232-250`: Wenn `app.tickets` leer ist oder der Filter keine Treffer liefert (`total === 0`), zeigt das Board fünf leere Spalten mit dem Kleintext `leer` statt `ui.emptyState` (wie es `views/tickets-page.js:82-92` für exakt denselben Filterzustand tut).
  2. `views/team.js:128-139` („Noch keine Blaupausen“) und `544-547` („Noch keine Teams“) bauen eigene `v_flex`-Blöcke nach statt `ui.emptyState` zu nutzen.
  3. `views/repos.js:145-149` („Noch keine Dateien im Wissensordner.“) und `259-275` (`.fabric/verify.sh fehlt` / `.fabric/project.md fehlt`) bauen eigene Container statt `ui.emptyState`.
  4. `views/pipelines.js:75-90` und `316-321`: Wenn es noch keinen Lauf gibt, stehen links in der Liste und rechts im Detailbereich gleichzeitig zweimal dieselben Sätze („Noch kein Lauf / `fab verify` legt einen Lauf an.“).
  5. `views/ticket.js:1013`: Wenn `app.ticketError` gesetzt ist (`!ticket`), rendert `renderTicket` `ui.loading(t, app.ticketError)` mit einem **rotierenden Endlos-Spinner** neben der Fehlermeldung statt `ui.notice(t, app.ticketError)` + `ui.emptyState`.
  6. `views/timeline.js:113` und `views/inbox.js:99`: Wenn `!app.index` wegen `app.loadError` eintritt, wird `app.loadError` als grauer Untertext in `ui.emptyState` statt als `ui.notice(t, app.loadError)` angezeigt.
- **Vorschlag:** Alle genannten Leerzustände auf `ui.emptyState` und alle Fehleranzeigen (`app.ticketError`, `app.loadError` in Timeline/Inbox/Tickets-Panel) auf `ui.notice` umstellen.

#### U-21 · `mods/fabric/views/board.js:216-222`, `mods/fabric/views/tickets-page.js:64-70` · Kategorie: toter Knopf · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-voll.png`, `docs/assets/ui-audit/vorher/tickets-voll.png`
- **Befund:** `renderBoard` und `renderTicketsPage` werden ausschließlich innerhalb des bereits geöffneten Fabric-Hauptfensters (`this.isApp === true`, `main.js:4282-4283`) gerendert. Trotzdem enthalten beide Seiten rechts in `ui.header` einen `ui.iconButton` mit `icon: "external"`, `tooltip: "Im Fenster öffnen"`, `active: true` und `onClick: (cx) => app.openInWindow({ page: "board" | "tickets" }, cx)`. Ein Klick darauf navigiert von `board` nach `board` bzw. von `tickets` nach `tickets` und hat keinerlei Wirkung.
- **Vorschlag:** Die beiden toten Icon-Knöpfe `#fabric-board-window` (`views/board.js:216-222`) und `#fabric-tickets-window` (`views/tickets-page.js:64-70`) ersatzlos entfernen (in den Sidepanels `views/tickets.js`, `views/inbox.js` und `views/timeline.js` bleibt der Knopf „Im Fenster öffnen“ natürlich erhalten) und `docs/fabric-ui.md` entsprechend nachziehen.

#### U-22 · `mods/fabric/views/settings.js:37-44`, `mods/fabric/views/tickets.js:221-231` · Kategorie: toter Knopf · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/einstellungen-voll.png`, `docs/assets/ui-audit/vorher/tickets-panel-voll.png`
- **Befund:**
  1. In `views/settings.js:26-45` nimmt `function infoRow(t, label, value, { copy = null, mono = false } = {})` **kein** `app`-Argument entgegen, ruft aber in Zeile 43 `onClick: (cx) => app.copyText(cx, copy, ...)` auf. Ein Klick auf den Kopier-Knopf neben `Datenordner`, `Roster` oder `CLI` in den Einstellungen schlägt mit `ReferenceError: app is not defined` fehl.
  2. Im Sidepanel `Tickets` (`views/tickets.js:221-231`) ist der Primärknopf `Abnehmen` (`#fabric-panel-accept`) immer aktiv (`disabled: Boolean(app.busy)`), obwohl `app.openAcceptModal(cx)` (`main.js:3197-3209`) `model.changesGate(this.changes, this.changesSeenHead)` prüft. Da es im Sidepanel gar keinen „Änderungen ansehen“-Bereich gibt, scheitert jeder Klick auf `Abnehmen` im Sidepanel für ein Ticket mit Branch sofort mit der Fehlermeldung „Änderungen für HEAD … ansehen“.
- **Vorschlag:** (1) `app` an `infoRow(app, t, ...)` in `views/settings.js` übergeben. (2) Im Sidepanel `views/tickets.js` bei Status `review` entweder denselben `changesGate`-Sperrgrund am `Abnehmen`-Knopf setzen oder für die Abnahme das Ticket im Hauptfenster öffnen.

#### U-23 · `mods/fabric/views/board.js:110-119` · Kategorie: abgeschnittener Text · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-voll.png`
- **Befund:** Auf den Board-Karten (`views/board.js:110-119`) hat der Ticket-Titel `.text_size(T.s)` (`12 px`), `.line_height(1.32)` (`~15.84 px` pro Zeile), `.whitespace_normal()`, `.max_h(36)` und `.overflow_hidden()`. Zwei Zeilen benötigen `~31.7 px`; die verbleibenden `4.3 px` bis `max_h(36)` zeigen die obersten Pixel der dritten Textzeile, die mitten durch die Buchstaben horizontal abgeschnitten wird (deutlich sichtbar bei `T-1`, `T-2` und `T-4` in `board-voll.png`).
- **Vorschlag:** `max_h` exakt auf zwei Zeilen begrenzen (`max_h(32)` bei `line_height(1.3)` bzw. `model.oneLine(ticket.title, 72)` mit sauberer Ellipse `…` und vollem Titel im `.tooltip(...)`), sodass keine angeschnittene dritte Zeile mehr erscheint.

#### U-24 · `mods/fabric/model.js:322-330`, `mods/fabric/views/tickets-page.js:97-108` · Kategorie: abgeschnittener Text · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/tickets-voll.png`
- **Befund:** `TABLE_COLUMNS` in `mods/fabric/model.js:322-330` vergibt für alle sieben Spalten feste Pixelbreiten: `id: 64`, `title: 300`, `status: 96`, `assignee: 92`, `repo: 132`, `updated_at: 108`, `comment_count: 92` (Summe `884 px`, plus `6 × 8 px` Gap und `2 × 12 px` Padding = `956 px`). Da `ui.table` (`ui.js:963,992`) Spalten ohne `column.width` bereits mit `.flex_1().min_w(0)` flexibel streckt, mit festem `width: 300` bei `title` aber starr `956 px` erzwingt, wird im Standardfenster (`~893 px` Inhaltsbreite) die Spalte `Kommentare` rechts zu `Komme` abgeschnitten.
- **Vorschlag:** In `TABLE_COLUMNS` für `title` keine starre `width: 300` erzwingen (oder `width: null` setzen, da `ui.table` Spalten ohne `width` bereits per `.flex_1().min_w(0)` auf den verfügbaren Platz verteilt) und die schmalen Metadatenspalten kompakt halten (`comment_count: 84`, `repo: 120`), sodass alle sieben Spalten ohne Abschneiden ins Fenster passen.

#### U-25 · `mods/fabric/main.js:4845-4900`, `mods/fabric/views/team.js:529-537` · Kategorie: abgeschnittener Text · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/inbox-voll.png`, `docs/assets/ui-audit/vorher/drawer-blaupause.png`, `docs/assets/ui-audit/vorher/team-prompt-drawer.png`
- **Befund:**
  1. Im **Inbox-Popover** (`mods/fabric/main.js:4845-4900`) ist die Zeile ein `h_flex()`. Die Klammer des inneren `.child(v_flex().flex_1().min_w(0)...)` schließt bereits in Zeile 4882 vor `.when(Boolean(lesson), (el) => el.child(h_flex().w_full().gap(4)...))`. Dadurch wird die Button-Zeile (`Bestätigen` / `Verwerfen`) mit `.w_full()` als drittes horizontales Kind in die äußere `h_flex()` gehängt und drückt die Textspalte auf wenige Pixel (`T-`) zusammen.
  2. Auf der **Team-Seite** (`views/team.js:529-537`) hat die rechte Seite des Headers den Zählertext plus zwei breite Text-Buttons (`+ Neues Team`, `+ Neue Blaupause`). Sobald rechts der Blaupausen-Drawer (`420 px`) oder Team-Prompt-Drawer (`560 px`) offen ist, reicht die verbleibende Breite der Team-Spalte (`~470 px` bzw. `~330 px`) nicht mehr aus und `+ Neue Blaupause` (bzw. `+ Neues Team`) wird rechts abgeschnitten.
- **Vorschlag:**
  1. In `mods/fabric/main.js:4882-4899` den `.when(Boolean(lesson), ...)`-Block **innerhalb** der `v_flex().flex_1().min_w(0)` platzieren (genau wie `.when(Boolean(retry), ...)` darüber).
  2. Auf der Team-Seite bei geöffnetem Drawer (`Boolean(app.blueprintDrawer || app.teamPrompt)`) oder schmaler Inhaltsbreite die kompakte Header-Variante nutzen bzw. `+ Neue Blaupause` in den Kopf der Karte `Blaupausen` verschieben.

#### U-26 · `mods/fabric/views/workflows.js:315-359, 550-597`, `mods/fabric/model.js:2171-2263` · Kategorie: abgeschnittener Text · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/workflows-voll.png`, `docs/assets/ui-audit/vorher/workflows-builder.png`
- **Befund:**
  1. Im vertikalen Workflow-Layout (`views/workflows.js:38, 415`: `gapY: 12`) beträgt der vertikale Abstand zwischen zwei Knotenkarten nur `12 px`. Im Builder (`views/workflows.js:575-595`) wird auf jede Kante ein Label-Chip mit `.h(18)` und `.top(mid - 9)` gesetzt – das `18 px` hohe Label ragt oben und unten je `3 px` in die Rahmen der benachbarten Knotenkarten hinein.
  2. Überspringt eine Kante eine oder mehrere Schichten in derselben Spalte (z. B. `nachtfenster → ende` oder `main-pruefen → wache` über `revert` hinweg), zeichnet `edgeLines` (`views/workflows.js:315-359`) eine senkrechte Linie bei `x1 = from.x + from.w / 2` mitten durch die darunterliegenden Knotenkarten und setzt das Kanten-Label (`fail`, `pass`) direkt über den Text einer fremden Knotenkarte (`workflows-voll.png`).
- **Vorschlag:** Den vertikalen Schichtabstand `gapY` in `views/workflows.js` von `12` auf mindestens `28` (`SPACE.xl` = `24` oder `28`) erhöhen, damit Kanten-Labels frei zwischen den Schichten stehen; Kanten, die mehrere Schichten überspringen (`Math.abs(to.y - from.y) > nodeHeight + gapY`), in `flowLayout` seitlich am Knoten vorbeiführen statt durch die Kartenmitte.

#### U-27 · `mods/fabric/views/dialogs.js:54-566`, `mods/fabric/ui.js:806-829`, `mods/fabric/main.js:4622, 4904` · Kategorie: Dialog · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/dialog-neues-ticket.png`, `docs/assets/ui-audit/vorher/dialog-neues-team.png`, `docs/assets/ui-audit/vorher/dialog-notiz.png`, `docs/assets/ui-audit/vorher/inbox-voll.png`, `docs/assets/ui-audit/vorher/lampe-autopilot.png`
- **Befund:**
  1. Die acht Dialoge in `views/dialogs.js` und `ui.modal` nutzen sechs verschiedene Breiten: `440 px` (Standard in `ui.modal`), `480 px` (`knowledgeRemoveDialog`), `520 px` (`acceptDialog`, `dropDialog`, `unsavedDialog`), `540 px` (`deleteBlueprintDialog`, `deleteTeamDialog`), `560 px` (`knowledgeNoteDialog`), `580 px` (`newTicketDialog`), `620 px` (`newTeamDialog`).
  2. Innerhalb der Dialoge werden Formularfelder auf drei verschiedene Arten beschriftet: in `newTicketDialog` (`Zeilen 77, 81, 97, 120`) und `dropDialog` (`Zeile 222`) mit rohen `div().text_size(T.xs).text_color(t.dim)`, in `newTeamDialog` teils mit `ui.field` (`Zeile 355`), teils mit lokalem `sectionLabel` (`Zeilen 359, 396, 438, 458`), in `knowledgeNoteDialog` (`Zeilen 530, 533`) mit `sectionLabel`. Zudem haben Dropdowns in `newTicketDialog` eine feste Breite `width: 360`, während der Trigger `.w_full()` über `532 px` läuft.
  3. Die beiden Popovers in der oberen Fensterleiste (`Autopilot` in `main.js:4622` mit `maxHeight: 600` und `Posteingang` in `main.js:4830` mit `max_h(420)`) klappen in `Popup` über den oberen Rand des Fabric-Fensters hinaus (`vorher/inbox-voll.png`, `vorher/lampe-autopilot.png`).
- **Vorschlag:** (1) Modal-Breiten in `ui.SIZE` auf zwei Standardgrößen begrenzen (z. B. `modal: 520` für Bestätigungen und `modalWide: 580` für Formular-Dialoge). (2) In allen Dialogen durchgängig `ui.field(...)` für Formularfelder verwenden. (3) Popover-Maximalhöhen in der Kopfleiste kompakt halten (`max_h(360)`) und `ui.popoverPanel` auch für das Posteingang-Popover (`main.js:4828`) nutzen.

#### U-28 · `mods/fabric/views/team.js:564`, `mods/fabric/views/context.js:22`, `mods/fabric/views/dialogs.js:634`, `mods/fabric/ui.js:831-852` · Kategorie: Dialog · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/drawer-blaupause.png`, `docs/assets/ui-audit/vorher/team-prompt-drawer.png`, `docs/assets/ui-audit/vorher/ticket-detail-kontext.png`
- **Befund:** Die drei Drawer im Fenster (`ui.drawer`, Standardbreite `380 px`) übergeben unterschiedliche Breiten (`420 px` für Blaupause, `560 px` für Team-Prompt und Kontextvorschau) und unterschiedliche Schließen-Buttons im Footer (`Abbrechen` im Blaupausen-Drawer vs. `Schließen` im Team-Prompt- und Kontext-Drawer). Im Ticket-Detail wird der Drawer als viertes Flex-Kind neben Navigation (`208 px`), Hauptspalte und Eigenschaften-Spalte (`320 px`) eingehängt (`main.js:4455`), sodass ein `560 px`-Drawer die Hauptspalte und Eigenschaften-Spalte auf unlesbare Breiten zusammenquetscht (`ticket-detail-kontext.png`).
- **Vorschlag:** Drawer-Breiten vereinheitlichen (oder den Drawer `absolute().right_0().top_0().bottom_0()` über dem rechten Inhaltsbereich lagern, statt die Hauptspalten im `h_flex` zusammenzudrücken) und den Schließen-Knopf im Footer bei editierbaren Drawern einheitlich `Abbrechen` (bzw. bei reiner Ansicht `Schließen`) nennen.

#### U-29 · `mods/fabric/views/board.js:100-148`, `mods/fabric/views/ticket.js:400-419`, `mods/fabric/views/tickets.js:91-118` · Kategorie: Chips · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/board-voll.png`, `docs/assets/ui-audit/vorher/ticket-detail-voll.png`
- **Befund:**
  1. **Board-Karten (`views/board.js:100-148`):** Eine einzelne Karte stapelt oben neben der ID `wartet auf dich` und `stockt seit …`, und im Fußbereich zusätzlich `Checks grün/rot`, `Urteil bestanden/abgelehnt`, den vollen Branch-Namen, einen grünen Kosten-Chip (`$0.4200`), einen gelben Wartezeit-Chip (`wartet 50 min`) und eine rote/grüne Pipeline-Pill (`Lauf rot`). Auf `T-1` konkurrieren damit sechs farbige Badges/Indikatoren auf wenigen Quadratzentimetern um Aufmerksamkeit.
  2. **Kommentarzeilen im Ticket-Verlauf (`views/ticket.js:400-419`):** Jeder einzelne Kommentar im Verlauf zeigt rechts in der Kopfzeile permanent einen vollwertigen Button `✓ Als Entscheidung` und daneben einen Chip `1 Erwähnung` / `2 Erwähnungen` (obwohl die `@erwähnung` im Kommentartext direkt darunter bereits fett hervorgehoben ist).
- **Vorschlag:**
  1. Auf Board-Karten den Fußbereich verschlanken: Branch-Namen und Einzel-Chips für Kosten/Liegezeiten im Kartenfuß weglassen oder als kompakten einzeiligen Metatext (`$0.42 · 50 min`) in `t.dim` statt als bunte Chips darstellen, sodass nur echte Handlungs-Signale (`wartet auf dich`, `stockt`, `Checks`/`Urteil`/`Lauf`) farbig hervortreten.
  2. Im Ticket-Verlauf den redundanten Chip `N Erwähnungen` entfernen (Erwähnungen sind im Text bereits fett markiert) und `Als Entscheidung` als dezenten Icon-/Text-Link oder nur im Kontext unterbringen.

#### U-30 · `mods/fabric/views/ticket.js:37-73`, `mods/fabric/views/repos.js:76-78`, `mods/fabric/views/team.js:435-469` · Kategorie: Chips · Zuordnung: T-116 · Status: erledigt (Commits je Befund in der Übersichtstabelle)
- **Beleg:** `docs/assets/ui-audit/vorher/ticket-detail-voll.png`, `docs/assets/ui-audit/vorher/repos-voll.png`, `docs/assets/ui-audit/vorher/team-voll.png`
- **Befund:**
  1. Im Kopf des Ticket-Details (`views/ticket.js:49-62`) steht neben der klickbaren Pipeline-Pill `● Lauf rot` (die bereits zu `pipelines` für dieses Ticket navigiert) immer noch ein zusätzlicher klickbarer grauer Chip `Läufe`, der zum selben Ziel navigiert. Zudem steht rechts der Branch noch einmal als Chip, obwohl `Branch` direkt daneben in der Eigenschaften-Spalte mit Kopierknopf steht.
  2. Im Testlauf-Kasten der Repo-Seite (`views/repos.js:78`) steht neben `Exit 0` ein statischer grauer Chip `jetzt` ohne Zeitstempel-Berechnung (`ui.chip(t, "jetzt", t.dim)`).
  3. Im Kopf jeder Team-Karte (`views/team.js:437-440`) stehen die Chips `3 Mitglieder` und `1 Repo`, obwohl unmittelbar darunter die Abschnittsüberschriften `Repos [1]` (`Zeile 247`) und `Mitglieder [3]` (`Zeile 349`) dieselben Zähler-Chips noch einmal tragen.
- **Vorschlag:** (1) Im Ticket-Kopf den doppelten Chip `Läufe` (wenn bereits `Lauf …` als Pill sichtbar ist, oder einen einzigen `Pipeline`-Verweis) und den doppelten Branch-Chip entfernen. (2) Den statischen Chip `jetzt` in `views/repos.js:78` entfernen. (3) In `views/team.js:437-440` die doppelten Zähler-Chips `N Mitglieder` und `N Repos` im Kartenkopf entfernen.

---

### 4.3 Detaillierte Befunde für T-117 (`mods/fabric-sidebar`, `mods/fabric-toast`)

#### U-31 · `mods/fabric-sidebar/main.js:73-343, 479-534` · Kategorie: Abstand · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-voll.png`, `docs/assets/ui-audit/vorher/seitenleiste-leer.png`
- **Befund:** `mods/fabric-sidebar/main.js` besitzt keine Token-Konstanten und verwendet für Höhen, Innenabstände und Lücken durchgehend Einzelzahlen außerhalb der `SPACE`-Skala (`4/8/12/16/24`) aus `mods/fabric/ui.js`:
  - `ticketChip` (`Zeile 73-74`): `.h(17).px(5)`
  - `orchestratorBadge` (`Zeile 93-94`): `.h(17).px(6)`
  - `teamHeader` (`Zeile 110-113`): `.mt(4).pt(6).px(10).pb(2).gap(6)`
  - `agentsHeader` (`Zeile 137-140`): `.px(10).pt(6).pb(2).gap(6)`
  - `freeGroupHeader` (`Zeile 154-157`): `.mt(5).pt(6).px(10).pb(3).gap(6)`
  - `pinButton` (`Zeile 173`): `.p(3)`
  - `freeCard` (`Zeile 197-198, 211-216`): `.gap(8).p(6)`, `.gap(2)`, `.gap(4)`, `.h(14).px(4)`
  - `rowView` (`Zeile 256-270`): `.pl(8 + row.depth * 14).pr(8).py(4).gap(6)`, `.gap(1)`, `.gap(5)`
  - `alarmBanner` (`Zeile 303-329`): `.px(8).py(6).gap(5)`, `.gap(6)`, `.gap(4)`, `.h(18).px(7)`
  - `render` (`Zeile 480-531`): `.h(34).px(10).gap(6)`, `.min_w(18).h(16).px(5)`, `.px(8).pb(4).gap(4)`, `.px(10).pb(4)`, `.py(2)`, `.px(12).py(8).gap(2)`.
- **Vorschlag:** Am Kopf von `mods/fabric-sidebar/main.js` die Token `FONT`, `SPACE`, `RADIUS` und `SIZE` analog zu `mods/fabric/ui.js` als Konstanten definieren und alle Abstände und Elementhöhen in `mods/fabric-sidebar/main.js` daraus ableiten.

#### U-32 · `mods/fabric-sidebar/main.js:75,95,159,174,199,217,261,266,299,330,489` · Kategorie: Abstand · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-voll.png`
- **Befund:** Für Eckenradien nutzt `mods/fabric-sidebar/main.js` sieben verschiedene Einzelzahlen: `.rounded(1)` (`Zeile 159`), `.rounded(3)` (`Zeile 217`), `.rounded(4)` (`Zeilen 75, 95, 174, 266, 330`), `.rounded(6)` (`Zeilen 199, 261, 299`), `.rounded(8)` (`Zeile 489`), während `mods/fabric/ui.js` `RADIUS = { s: 6, m: 8, l: 12 }` definiert.
- **Vorschlag:** Alle Eckenradien in `mods/fabric-sidebar/main.js` auf `RADIUS` (`s: 6, m: 8, l: 12` bzw. `size / 2` für runde Punkte/Badges) angleichen.

#### U-33 · `mods/fabric-toast/main.js:33,34,40,47,49,55` · Kategorie: Abstand · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/toast-ansicht.png`
- **Befund:** `mods/fabric-toast/main.js` verwendet rohe Zahlen `.px(18)` (`Zeile 33`), `.gap(12)` (`Zeile 34`), `.rounded(4)` (`Zeilen 40, 49, 55`), `.gap(8)` (`Zeile 47`), `.px(6).py(3)` (`Zeile 49`) und `.px(8).py(4)` (`Zeile 55`) statt der Token `SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24 }` und `RADIUS = { s: 6, m: 8, l: 12 }` aus `mods/fabric/ui.js`.
- **Vorschlag:** In `mods/fabric-toast/main.js` die Token-Konstanten `FONT`, `SPACE`, `RADIUS` aus `mods/fabric/ui.js` übernehmen (`px(SPACE.l)`, `gap(SPACE.m)`, `rounded(RADIUS.s)` für Knöpfe).

#### U-34 · `mods/fabric-sidebar/main.js:77,97,115,117,142,144,160,162,219,226,229,232,241,273,311,315,334,483,491,515,532,533` · Kategorie: Schriftgröße · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-voll.png`, `docs/assets/ui-audit/vorher/seitenleiste-fehler.png`
- **Befund:** In `mods/fabric-sidebar/main.js` kommen sieben verschiedene, frei gewählte Schriftgrößen inkl. halber Pixelwerte vor:
  - `8.5 px` (`Zeile 219`, Badge auf Pixel-Karte)
  - `9.5 px` (`Zeile 232`, Aufgabe auf Pixel-Karte)
  - `10 px` (`Zeilen 77, 97, 117, 142, 144, 160, 162, 226, 334, 491`)
  - `10.5 px` (`Zeilen 115, 241, 315, 515, 533`)
  - `11 px` (`Zeilen 229, 311, 483`)
  - `11.5 px` (`Zeile 532`)
  - `12 px` (`Zeile 273`)
  Keine einzige Stelle nutzt `FONT`-Konstanten; vier Größen liegen unterhalb der `11 px`-Untergrenze (`FONT.xs = 11`).
- **Vorschlag:** Alle Schriftgrößen in `mods/fabric-sidebar/main.js` auf `FONT = { xs: 11, s: 12, m: 13 }` aus `mods/fabric/ui.js` umstellen (Metazeilen, Chips, Gruppenköpfe: `FONT.xs = 11`; Agenten-/Kartentitel: `FONT.s = 12`).

#### U-35 · `mods/fabric-sidebar/main.js:214-234` · Kategorie: Schriftgröße · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-voll.png`
- **Befund:** Auf den Pixel-Karten (`freeCard`) wird das Status-Badge (`WAITING`, `WORKING`, `IDLE`) in `8.5 px` auf `14 px` Höhe und die Aufgabenzeile darunter in `9.5 px` gerendert. Im 8-Stunden-Betrieb auf Desktop-Monitoren sind `8.5 px` und `9.5 px` deutlich unter der Lesbarkeitsgrenze von `11 px` (`FONT.xs`).
- **Vorschlag:** Status-Badge und Aufgabenzeile in `freeCard` auf `FONT.xs` (`11 px`, Badge-Höhe `SIZE.chip` bzw. `18 px`) anheben.

#### U-36 · `mods/fabric-toast/main.js:45,46,48,50,56` · Kategorie: Schriftgröße · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/toast-ansicht.png`
- **Befund:** `mods/fabric-toast/main.js` setzt `.text_size(13)` (`Zeile 45`) und `.text_size(12)` (`Zeilen 46, 48, 50, 56`) als literale Zahlen statt über `FONT = { xs: 11, s: 12, m: 13 }`.
- **Vorschlag:** `FONT`-Konstanten analog zu `mods/fabric/ui.js` in `mods/fabric-toast/main.js` definieren und `FONT.m` / `FONT.s` verwenden.

#### U-37 · `mods/fabric-sidebar/main.js:76,96,201,202,205,218,300,302,332,333,340` · Kategorie: Farbe · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-voll.png`, `docs/assets/ui-audit/vorher/banner-alarm.png`
- **Befund:** `mods/fabric-sidebar/main.js` mischt neun verschiedene Hex-Alpha-Suffixe (`+"12"`, `+"18"`, `+"1a"`, `+"1e"`, `+"1f"`, `+"26"`, `+"33"`, `+"40"`, `+"66"`). Ein Ticket-Chip in der Seitenleiste (`Zeile 76`) hat `t.accent + "1a"` mit Radius `4`, im Fenster (`ui.chip`, `ui.js:234`) dagegen `t.accent + "1e"` mit Radius `6`.
- **Vorschlag:** Dieselben Alpha-Konstanten und Chip-Farben wie in `mods/fabric/ui.js` verwenden.

#### U-38 · `mods/fabric-sidebar/main.js:510-519` · Kategorie: Farbe · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-fehler.png`
- **Befund:** Bei einem Lesefehler (`this.loadError`) zeigt `mods/fabric-sidebar/main.js:510-519` lediglich ein ungerahmtes `div().px(10).pb(4).text_size(10.5).text_color(t.blocked).child("Ticketdaten nicht lesbar")`, während alle anderen Fabric-Flächen einen Fehlerhinweis mit Hintergrundtönung, Farbpunkt und `FONT.s` (`ui.notice`) darstellen.
- **Vorschlag:** Den Fehlerhinweis in `mods/fabric-sidebar/main.js:510-519` im Stil von `ui.notice` (Hintergrund `t.blocked` getönt, `6 px`-Farbpunkt, `FONT.xs`/`FONT.s`) gestalten.

#### U-39 · `mods/fabric-toast/main.js:49-58` · Kategorie: Farbe · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/toast-ansicht.png`
- **Befund:** Die Aktionsknöpfe im Toast (`#fabric-toast-open` „Öffnen“ und `#toast-login-copy`) haben `.bg(t.raised)` und `.rounded(4)` ohne Rahmen (`border_1().border_color(t.input)`), während alle sekundären Knöpfe im Fabric-Fenster (`ui.button`, `ui.js:337-340`) `.rounded(RADIUS.m).border_1().border_color(t.input).bg(t.raised)` tragen.
- **Vorschlag:** Die Toast-Knöpfe in `mods/fabric-toast/main.js` mit `rounded(RADIUS.m)`, `border_1().border_color(t.input)`, `bg(t.raised)` und `FONT.s` an `ui.button(..., { small: true })` aus `mods/fabric/ui.js` angleichen.

#### U-40 · `mods/fabric-sidebar/main.js:142`, `mods/fabric-sidebar/model.js:282-298, 387-389` · Kategorie: Begriff · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-voll.png`, `docs/assets/ui-audit/vorher/seitenleiste-fehler.png`
- **Befund:** Der obere Bereich der Seitenleiste (`mods/fabric-sidebar`) ist komplett auf Englisch in Großbuchstaben beschriftet, während der untere Bereich desselben Mods auf Deutsch beschriftet ist:
  - `mods/fabric-sidebar/main.js:142`: Abschnittskopf **`AGENTS`**
  - `mods/fabric-sidebar/model.js:297`: `busyLabel` liefert **`0 BUSY`**, **`1 BUSY`**, **`2 BUSY`**
  - `mods/fabric-sidebar/model.js:388`: `machineLabel` liefert **`THIS MACHINE`**
  - `mods/fabric-sidebar/model.js:282-288`: `FREE_STATUS_WORDS` liefert **`WORKING`**, **`WAITING`**, **`DONE`**, **`IDLE`**, **`ERROR`**
  Direkt darunter im selben Mod (`mods/fabric-sidebar/model.js:5-11`) heißen exakt dieselben fünf Statuswerte auf Deutsch **`arbeitet`**, **`wartet`**, **`fertig`**, **`bereit`**, **`Fehler`**.
- **Vorschlag:** Gemäß Begriffstabelle und T-117-Abnahmekriterium die Bezeichnungen in `mods/fabric-sidebar/main.js` und `mods/fabric-sidebar/model.js` (samt `mods/fabric-sidebar/test/model.test.mjs`) auf die deutschen Zielbegriffe umstellen:
  - Abschnittskopf: **`Agenten`**
  - `busyLabel`: **`${n} aktiv`**
  - `machineLabel`: **`Dieser Rechner`** (bzw. bei benannter Maschine deren Name)
  - `FREE_STATUS_WORDS`: dieselben deutschen Statuswörter wie `STATUS_WORDS` (**`arbeitet`**, **`wartet`**, **`fertig`**, **`bereit`**, **`Fehler`**).

#### U-41 · `mods/fabric-sidebar/model.js:5-11, 59-67, 119-121, 215-220` · Kategorie: Begriff · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-voll.png`
- **Befund:**
  1. In den Team-Zeilen der Seitenleiste (`mods/fabric-sidebar/model.js:119-121, 216`) wird `row.role` roh aus `roster.json` übernommen (`pruefer`, `umsetzer`).
  2. `runtimeText` (`mods/fabric-sidebar/model.js:59-67`) formatiert Laufzeiten mit englischem `d` und ohne Leerzeichen (`<1m`, `5m`, `2h`, `3d`), während `formatDuration` im Fenster (`mods/fabric/model.js:1226-1235`) `< 1 min`, `5 min`, `2 h 05 min` und `relativeTime` `Tage` nutzt.
  3. Für `status === "blocked"` zeigt `mods/fabric-sidebar/model.js:7` `wartet`, während `mods/fabric/model.js:1089` für `sessionStatus("blocked")` `wartet auf dich` nutzt.
- **Vorschlag:** Rollen in `mods/fabric-sidebar/model.js` über dieselbe Zuordnung wie im Fenster (`umsetzer` → `Umsetzer`, `pruefer` → `Prüferin / Prüfer`) ausgeben und die Statuswörter (`arbeitet`, `wartet`, `fertig`, `bereit`, `Fehler`, `beendet`) zwischen Fenster und Seitenleiste exakt abgleichen.

#### U-42 · `mods/fabric-toast/main.js:17-18, 45, 52` · Kategorie: Begriff · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/toast-ansicht.png`
- **Befund:** `mods/fabric-toast/main.js` enthält im Login-Zweig englische UI-Texte:
  - Zeile 45: ``login ? `${login[1]} needs a login: run` : p.title ?? ""``
  - Zeile 52: `.child(this.copied ? "Copied" : "Copy")`
  während Zeile 58 im selben Toast auf Deutsch `.child("Öffnen")` beschriftet ist.
- **Vorschlag:** In `mods/fabric-toast/main.js:45,52` deutsche Texte verwenden: `` `${login[1]} braucht eine Anmeldung:` `` und `this.copied ? "Kopiert" : "Kopieren"`.

#### U-43 · `mods/fabric-sidebar/main.js:294-344`, `mods/fabric-sidebar/model.js:553-579` · Kategorie: Doppelfunktion · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/banner-alarm.png`
- **Befund:** Der Alarm-Banner in `mods/fabric-sidebar/main.js:294-344` und der Alarm-Banner im Fabric-Fenster (`mods/fabric/main.js:4512-4547`) zeigen dieselben Alarme aus `index.json`, unterscheiden sich aber in fast jedem visuellen Parameter:
  - Seitenleiste: Ausrufezeichen `!` (`11 px`, fett) statt `6 px`-Farbpunkt; Textfarbe `t.foreground` (`10.5 px`) statt `t.blocked` (`12 px`); Hintergrund `t.blocked + "1f"` mit Rahmen `t.blocked + "66"` und `rounded(6)`; rote Eigenbau-Knöpfe (`h(18)`, `text_size(10)`, `bg(t.blocked + "18")`, `text_color(t.blocked)`).
  - Fenster: `6 px`-Farbpunkt; Textfarbe `t.blocked` (`FONT.s = 12 px`); Hintergrund `t.blocked + "14"` mit `border_b(1)` in `t.blocked + "55"`; neutrale `ui.button(..., { small: true })` (`h(24)`, `bg(t.raised)`, `text_color(t.foreground)`).
- **Vorschlag:** Den Seitenleisten-Alarm-Banner in `mods/fabric-sidebar/main.js` visuell an den Fenster-Banner (`ui.js`-Token: `6 px`-Farbpunkt, `FONT.xs`/`FONT.s`, `RADIUS.m`, einheitliche Hintergrund-/Rahmentönung und Button-Gestaltung) angleichen.

#### U-44 · `layouts/fabric.json:61-82`, `mods/fabric-sidebar/main.js:527-535`, `mods/fabric/views/inbox.js:98-110` · Kategorie: abgeschnittener Text · Zuordnung: T-117 · Status: offen
- **Beleg:** `docs/assets/ui-audit/vorher/seitenleiste-leer.png`, `docs/assets/ui-audit/vorher/seitenleiste-fehler.png`, `docs/assets/ui-audit/vorher/banner-alarm.png`
- **Befund:** In `layouts/fabric.json:61-82` hat `fabric-agents` `weight: 9` (`min: 120`) und `fabric-inbox` nur `weight: 2` (`min: 90`). Dadurch bleiben dem `Posteingang`-Block unten links nur `~105 px` Gesamthöhe (abzüglich `46 px` für `ui.header` nur `~59 px` für den Inhalt). Im Leerzustand (`vorher/seitenleiste-leer.png`) zentriert `ui.emptyState` (`p(24)`) den dreizeiligen Block (`Nichts zu tun`, Erklärungstext, Knopf `Zum Board`) in diesen `59 px`, sodass „Nichts zu tun“ nach oben über die Trennlinie in den Header „Posteingang“ hineinragt und der Knopf „Zum Board“ unten halb abgeschnitten wird. Im Fehlerzustand (`vorher/seitenleiste-fehler.png`) wird der Fehlertext unter der `ui.notice` ebenfalls abgeschnitten.
- **Vorschlag:** Für schmale/niedrige Panel-Flächen (`views/inbox.js` bzw. `ui.emptyState` mit `{ compact: true }`) das Padding von `SPACE.xl` (`24 px`) auf `SPACE.m` (`12 px`) reduzieren und `.overflow_y_scrollbar()` nutzen (bzw. in `layouts/fabric.json` das Gewicht von `fabric-inbox` auf `weight: 3`, `min: 130` anheben), damit Header, Text und Aktionsknopf niemals überlappen.

---

## 5. Begriffstabelle

Jede Sache in der Fabric-Oberfläche (`mods/fabric`, `mods/fabric-sidebar`, `mods/fabric-toast`) erhält genau **eine** deutsche Zielbezeichnung. Die Tests in `mods/fabric/test/model.test.mjs` (T-116) und `mods/fabric-sidebar/test/model.test.mjs` (T-117) prüfen diese Zielbegriffe.

| Sache / Konzept | Heute verwendete Bezeichnungen (mit Fundstellen) | Deutsche Zielbezeichnung | Zuordnung |
|---|---|---|---|
| **Posteingang des Menschen** | `Inbox` (`mods/fabric/main.js:4824`, `views/ticket.js:567`, `views/settings.js:143,147,148`, `model.js:1080`), `Posteingang` (`views/inbox.js:79,99`, `main.js:4826,4837,4901`) | **Posteingang** | T-116 |
| **Ticket-Stufe `draft`** | `Entwurf` (`mods/fabric/model.js:8`) | **Entwurf** | T-116 |
| **Ticket-Stufe `todo`** | `Geplant` (`mods/fabric/model.js:9`) | **Geplant** | T-116 |
| **Ticket-Stufe `doing`** | `In Arbeit` (`mods/fabric/model.js:10`) | **In Arbeit** | T-116 |
| **Ticket-Stufe `review`** | `Prüfung` (`mods/fabric/model.js:11`) | **Prüfung** | T-116 |
| **Ticket-Stufe `done`** | `Fertig` (`mods/fabric/model.js:12`) | **Fertig** | T-116 |
| **Ticket-Stufe `dropped`** | `Verworfen` (`mods/fabric/model.js:13`) | **Verworfen** | T-116 |
| **Seiten im Fabric-Fenster** | `Board`, `Tickets`, `Workflows`, `Pipelines`, `Team`, `Prompts`, `Vorlagen`, `Repos`, `Einstellungen` (`mods/fabric/main.js:31-41`) | **Board**, **Tickets**, **Workflows**, **Pipelines**, **Team**, **Prompts**, **Vorlagen**, **Repos**, **Einstellungen** | T-116 |
| **Posteingangs-Eintragsart `question`** | `Frage` (`mods/fabric/model.js:52`) | **Frage** | T-116 |
| **Posteingangs-Eintragsart `review`** | `Prüfung` (`mods/fabric/model.js:53`) | **Prüfung** | T-116 |
| **Posteingangs-Eintragsart `attention`** | `Aufmerksamkeit` (`mods/fabric/model.js:54`) | **Aufmerksamkeit** | T-116 |
| **Posteingangs-Eintragsart `lesson`** | `Lehre` (`mods/fabric/model.js:55`) | **Lehre** | T-116 |
| **Posteingangs-Eintragsart `decision`** | `decision` (fehlt in `INBOX_WORDS`, `mods/fabric/model.js:51-56`, fällt auf rohen Schlüssel zurück) | **Entscheidung** | T-116 |
| **Agenten-/Session-Status `working`** | `arbeitet` (`mods/fabric/model.js:1088`, `mods/fabric-sidebar/model.js:6`), `WORKING` (`mods/fabric-sidebar/model.js:283`) | **arbeitet** | T-116 / T-117 |
| **Agenten-/Session-Status `blocked`** | `wartet auf dich` (`mods/fabric/model.js:1089,1701`), `wartet` (`mods/fabric-sidebar/model.js:7`), `WAITING` (`mods/fabric-sidebar/model.js:284`) | **wartet** *(Session/Agent in Seitenleiste & Chip)* / **wartet auf dich** *(Ticket-Hinweis für den Menschen)* | T-116 / T-117 |
| **Agenten-/Session-Status `done`** | `fertig` (`mods/fabric/model.js:1090`, `mods/fabric-sidebar/model.js:8`), `DONE` (`mods/fabric-sidebar/model.js:285`) | **fertig** | T-116 / T-117 |
| **Agenten-/Session-Status `idle`** | `bereit` (`mods/fabric/model.js:1091`, `mods/fabric-sidebar/model.js:9`), `IDLE` (`mods/fabric-sidebar/model.js:286`) | **bereit** | T-116 / T-117 |
| **Agenten-/Session-Status `error`** | `Fehler` (`mods/fabric-sidebar/model.js:10`), `ERROR` (`mods/fabric-sidebar/model.js:287`), `error` (`mods/fabric/model.js:1097`) | **Fehler** | T-116 / T-117 |
| **Agenten-/Session-Status `exited`** | `beendet` (`mods/fabric/model.js:1093`) | **beendet** | T-116 |
| **Abschnitt freie Agenten (Seitenleiste)** | `AGENTS` (`mods/fabric-sidebar/main.js:142`) | **Agenten** | T-117 |
| **Zähler arbeitender freier Agenten** | `${n} BUSY` (`mods/fabric-sidebar/model.js:297`) | **`${n} aktiv`** | T-117 |
| **Lokale Maschinengruppe (Seitenleiste)** | `THIS MACHINE` (`mods/fabric-sidebar/model.js:388`) | **Dieser Rechner** | T-117 |
| **Rolle `umsetzer`** | `umsetzer` (`fabric/roster.json`, `views/team.js:72,94,305,328`, `fabric-sidebar/model.js:216`) | **Umsetzer** | T-116 / T-117 |
| **Rolle `pruefer` / Reviewer** | `pruefer` (`fabric/roster.json`, `views/team.js:94`, `fabric-sidebar/model.js:216`), `Prüfer` (`views/settings.js:96`), `Prüferin / Prüfer` (`views/team.js:376`, `views/dialogs.js:438`), `Prüferin oder Prüfer` (`model.js:1584`) | **Prüferin / Prüfer** | T-116 / T-117 |
| **Prompt-Art (`prompt.kind`)** | `orchestrator`, `preamble`, `Rolle` (`views/prompts.js:53,98`), `Prompt` (`views/prompts.js:98`) | **Orchestrator**, **Präambel**, **Rolle** | T-116 |
| **Repo-Datei `.fabric/verify.sh`** | `verify` / `kein verify` (`views/repos.js:35`), `Prüfskript` (`views/repos.js:205`, `main.js:1477,4056`) | **Prüfskript** *(bzw. **kein Prüfskript**)* | T-116 |
| **Repo-Datei `.fabric/lessons.md`** | `lessons` (`views/repos.js:37`), `Lernnotizen` (`views/repos.js:206`, `main.js:1480,4058`), `Lehren` (`.fabric/lessons.md`, `model.js:43,55`) | **Lernnotizen** *(Reiter/Repo-Datei)* · **Lehre** *(einzelner Vorschlag im Posteingang)* | T-116 |
| **Repo-Datei `.fabric/project.md`** | `Steckbrief` (`views/repos.js:38,207`, `main.js:1483,4057`) | **Steckbrief** | T-116 |
| **Repo-Ordner `.fabric/knowledge/`** | `Wissen` (`views/repos.js:118,208`), `Wissensordner` (`views/repos.js:128,146`, `views/dialogs.js:507,545`) | **Wissen** *(Reiter)* · **Wissensordner** *(Erklärungstext)* | T-116 |
| **Verweildauer eines Tickets je Stufe (`ticket.waits`)** | `Wartezeiten` (`views/ticket.js:884`), `wartet …` (`views/board.js:31`), `Liegezeiten` (`model.js:1213`, `fabric/fablib/render.py`) | **Liegezeiten** | T-116 |
| **Ticket zur Überarbeitung zurückgeben (`fab reject`)** | `Zurück mit Feedback` (`model.js:204`, `views/ticket.js:984`), `Zurück` (`views/tickets.js:234`) | **Zurück mit Feedback** | T-116 |
| **Aktion/Dialog/Lauf abbrechen** | `Abbrechen` (`views/dialogs.js:61,171,208,244,266,338,479,512,550,647`, `views/ticket.js:846`), `Abbruch` (`views/workflows.js:255`) | **Abbrechen** | T-116 |
| **Laufenden Dienst anhalten (Orchestrator / Autopilot)** | `Stoppen` (`main.js:4690`), `Stopp` (`views/team.js:188`) | **Stoppen** | T-116 |
| **Workflow-Knotentyp `agent`** | `Agent` (`model.js:1986`), `Agent-Schritt` (`views/workflows.js:18`) | **Agent** | T-116 |
| **Plural von `Lauf`** | `Läufe` (`views/pipelines.js:106,348`, `views/workflows.js:176`), `Laufe` (`views/workflows.js:117`) | **Läufe** *(Singular: **Lauf**)* | T-116 |
| **Plural von `Team`** | `1 Team` / `2 Teams` (`views/team.js:532`), `1 Team(s)` (`views/dialogs.js:631`) | **Team** *(Singular)* / **Teams** *(Plural)* | T-116 |
| **Laufende Agenten-Terminals (`sessions`)** | `Sessions` (`views/ticket.js:803`, `views/team.js:398`, `views/dialogs.js:162,199,458`), `Sitzung` / `Sitzungen` (`views/team.js:131`, `model.js:733,774`) | **Sessions** | T-116 |
| **Zeitverlauf-Ereignis `flow` / `decision` / `alarm`** | `flow flow` (`model.js:26-44, 1458-1545`), `decision` | **Workflow** / **Entscheidung** / **Alarm** | T-116 |
| **Toast-Login & Zwischenablage (`mods/fabric-toast`)** | `needs a login: run`, `Copy`, `Copied` (`mods/fabric-toast/main.js:45,52`) | **`braucht eine Anmeldung:`**, **Kopieren**, **Kopiert** | T-117 |

---

## 6. Zuordnung und Checkliste für T-116 und T-117

### 6.1 Arbeitspaket T-116 (`mods/fabric/ui.js`, `mods/fabric/model.js`, `mods/fabric/main.js`, `mods/fabric/views/*.js`, `docs/fabric-ui.md`)

- [x] **U-01** (`views/workflows.js:33-38, 412-419`): `padding: 16`, `gapX: 12`, `gapY: 12` über `ui.SPACE` beziehen (Regex-Prüfung grün).
- [x] **U-02** (`views/*.js`, `main.js`): Einzelzahlen für `gap` und `p/px/py/pt/pb/pl/pr` durch `ui.SPACE`-Token ersetzen.
- [x] **U-03** (`views/prompts.js`, `templates.js`, `repos.js`, `workflows.js`, `pipelines.js`, `ticket.js`, `settings.js`): Spaltenbreiten (`SIZE.listPane`, `SIZE.inspector`) und Kartenbreiten in Einstellungen vereinheitlichen.
- [x] **U-04** (`views/ticket.js`, `workflows.js`, `pipelines.js`, `prompts.js`, `templates.js`, `repos.js`): Jede Seite mit `ui.header(...)` beginnen; Detail-Header und Platzierung von `ui.notice` vereinheitlichen.
- [x] **U-05** (`views/team.js:319-331`): Spaltenüberschriften/Labels für `Modell` und `Kostenlimit` in der Mitgliederliste ergänzen.
- [x] **U-06** (`views/workflows.js:399,593,624,644`): `.text_size(10)` durch `ui.FONT.xs` (`11`) ersetzen.
- [x] **U-07** (`views/pipelines.js:183`): `.text_size(9)` im Schritt-Log durch `ui.FONT.xs` ersetzen.
- [x] **U-08** (`ui.js:257`): `ui.avatar`-Schriftgröße auf `ui.FONT` begrenzen (`>= 11 px`).
- [x] **U-09** (`ui.js`, `main.js`, `views/*.js`): Hex-Alpha-Suffixe über zentrale Helfer in `ui.js` vereinheitlichen.
- [x] **U-10** (`views/workflows.js:958-980`, `main.js:4512-4547`): `pendingNotice` und `alarmBanner` über `ui.notice` / gemeinsamen Banner-Baustein in `ui.js` abbilden.
- [x] **U-11** (`views/team.js:503-525`, `workflows.js:216-233`, `timeline.js:29-36,121`): Doppelten Primärknopf im Team-Header auflösen; `ui.tabs` für `Lauf`/`Builder` und `Alle`/`Ticket` sowie `ui.button` im Timeline-`emptyState` nutzen.
- [x] **U-12** (`ui.js:198-202`): Puls der Autopilot-Lampe beruhigen (`period >= 2000` ms, dezenter Opazitätshub).
- [x] **U-13** (`main.js:4824`, `views/settings.js:143,147,148`, `views/ticket.js:567`, `model.js:1080`): `Inbox` durchgängig zu `Posteingang` ändern.
- [x] **U-14** (`model.js:26-56,1375,1458-1545`, `ui.js:91-95`, `views/repos.js:35-38,99`): `decision: "Entscheidung"` in `INBOX_WORDS`, `flow`/`decision`/`alarm`/`fab` in `EVENT_WORDS`/`eventSummary` ergänzen; Repo-Chips auf `Prüfskript`/`Lernnotizen` umstellen.
- [x] **U-15** (`views/ticket.js:884`, `views/tickets.js:234`, `views/workflows.js:18,260`, `views/team.js:187`): Begriffe auf `Liegezeiten`, `Zurück mit Feedback`, `Abbrechen`, `Stoppen`, `Agent` angleichen.
- [x] **U-16** (`views/workflows.js:117`, `views/dialogs.js:631`, `views/prompts.js:53,99`, `views/templates.js:48,71`, `model.js:1216`): `Laufe` → `Läufe`, `Team(s)` → `Team`/`Teams`, Bytes-Formatierung und Kosten-Formatierung bereinigen.
- [x] **U-17** (`views/team.js`, `views/prompts.js`, `views/ticket.js`): Rollenschlüssel (`umsetzer` → `Umsetzer`, `pruefer` → `Prüferin / Prüfer`) und Prompt-Arten sauber formatieren.
- [x] **U-18** (`main.js:4322,4426`, `views/team.js:441`, `views/repos.js:118`): Doppelte Autopilot-Lampe in der Fenster-Navigation, doppelte Orchestrator-Pill im Team-Kartenkopf und doppelte Überschrift `Wissen` entfernen.
- [x] **U-19** (`main.js:112-113`, `views/board.js:152`, `views/tickets-page.js:12`): `Verworfen`-Filter zwischen Board und Tickets-Tabelle teilen.
- [x] **U-20** (`views/board.js`, `ticket.js`, `team.js`, `repos.js`, `pipelines.js`, `timeline.js`): Alle Leerzustände über `ui.emptyState` und alle Fehler über `ui.notice` darstellen.
- [x] **U-21** (`views/board.js:216-222`, `views/tickets-page.js:64-70`): Tote Knöpfe „Im Fenster öffnen“ im Hauptfenster entfernen und `docs/fabric-ui.md` nachziehen.
- [x] **U-22** (`views/settings.js:37-44`, `views/tickets.js:221-231`): `app`-Referenz in `settings.js:infoRow` reparieren; `Abnehmen`-Gate im Tickets-Sidepanel berücksichtigen.
- [x] **U-23** (`views/board.js:110-119`): Vertikal halb abgeschnittene dritte Titelzeile auf Board-Karten beheben.
- [x] **U-24** (`model.js:322-330`, `views/tickets-page.js`): Spaltenbreiten der Tickets-Tabelle so anpassen, dass `Kommentare` nicht mehr zu `Komme` abgeschnitten wird.
- [x] **U-25** (`main.js:4845-4900`, `views/team.js:529-537`): Im Inbox-Popover `.when(Boolean(lesson), ...)` in die innere `v_flex` hängen; Team-Header bei offenem Drawer vor Abschneiden schützen.
- [x] **U-26** (`views/workflows.js:315-359,550-597`, `model.js:2171-2263`): `gapY` vergrößern und Kantenführung im Workflow-Graphen so anpassen, dass Kanten und Labels keine Knotenkarten überlappen.
- [x] **U-27** (`views/dialogs.js`, `ui.js:806`, `main.js:4622,4904`): Modal-Breiten und `ui.field`-Labels vereinheitlichen; Kopfleisten-Popovers innerhalb des Fensters halten.
- [x] **U-28** (`views/team.js`, `views/context.js`, `views/dialogs.js`, `ui.js:831`): Drawer-Breiten, Footer-Knöpfe und Überlagerung im Ticket-Detail bereinigen.
- [x] **U-29** (`views/board.js:100-148`, `views/ticket.js:400-419`): Chip-Überflutung auf Board-Karten und im Ticket-Verlauf (`N Erwähnungen`-Chip) reduzieren.
- [x] **U-30** (`views/ticket.js:37-73`, `views/repos.js:78`, `views/team.js:437-440`): Redundante Chips (`Läufe` neben `Lauf …`, `jetzt`, doppelte `Mitglieder`/`Repos`-Chips im Team-Kopf) entfernen.

### 6.2 Arbeitspaket T-117 (`mods/fabric-sidebar/main.js`, `mods/fabric-sidebar/model.js`, `mods/fabric-toast/main.js`)

- [ ] **U-31** (`mods/fabric-sidebar/main.js`): Abstände und Elementhöhen auf `SPACE`- und `SIZE`-Konstanten aus `mods/fabric/ui.js` umstellen.
- [ ] **U-32** (`mods/fabric-sidebar/main.js`): Eckenradien auf `RADIUS` (`6/8/12`) aus `mods/fabric/ui.js` umstellen.
- [ ] **U-33** (`mods/fabric-toast/main.js`): Abstände und Radien im Toast auf `SPACE` und `RADIUS` aus `mods/fabric/ui.js` umstellen.
- [ ] **U-34** (`mods/fabric-sidebar/main.js`): Alle sieben Einzel-Schriftgrößen (`8.5`–`12 px`) auf `FONT`-Konstanten (`11/12/13`) aus `mods/fabric/ui.js` umstellen.
- [ ] **U-35** (`mods/fabric-sidebar/main.js:214-234`): Badge (`8.5 px`) und Aufgabenzeile (`9.5 px`) der Pixel-Karten auf `FONT.xs` (`11 px`) anheben.
- [ ] **U-36** (`mods/fabric-toast/main.js`): Schriftgrößen im Toast über `FONT.m` (`13`) und `FONT.s` (`12`) referenzieren.
- [ ] **U-37** (`mods/fabric-sidebar/main.js`): Hex-Alpha-Suffixe für Chips, Badges und Karten an `mods/fabric/ui.js` angleichen.
- [ ] **U-38** (`mods/fabric-sidebar/main.js:510-519`): Fehleranzeige (`loadError`) optisch an `ui.notice` angleichen.
- [ ] **U-39** (`mods/fabric-toast/main.js:49-58`): Toast-Knöpfe (`Öffnen`, `Kopieren`) mit Rahmen, Radius und Padding an `ui.button` angleichen.
- [ ] **U-40** (`mods/fabric-sidebar/main.js:142`, `mods/fabric-sidebar/model.js:282-298,387-389`): Englische Begriffe (`AGENTS`, `N BUSY`, `THIS MACHINE`, `WORKING`/`WAITING`/`DONE`/`IDLE`/`ERROR`) auf die deutschen Zielbegriffe der Begriffstabelle (`Agenten`, `${n} aktiv`, `Dieser Rechner`, `arbeitet`/`wartet`/`fertig`/`bereit`/`Fehler`) umstellen und Tests in `mods/fabric-sidebar/test/model.test.mjs` aktualisieren.
- [ ] **U-41** (`mods/fabric-sidebar/model.js:5-11,119-121,215-220`): Rollenbezeichnungen (`Umsetzer`, `Prüferin / Prüfer`) und Statuswörter in den Team-Zeilen der Seitenleiste angleichen.
- [ ] **U-42** (`mods/fabric-toast/main.js:45,52`): Englische Login- und Kopier-Texte (`needs a login: run`, `Copy`, `Copied`) eindeutschen (`braucht eine Anmeldung:`, `Kopieren`, `Kopiert`).
- [ ] **U-43** (`mods/fabric-sidebar/main.js:294-344`): Alarm-Banner der Seitenleiste optisch an den Fenster-Alarm-Banner angleichen.
- [ ] **U-44** (`mods/fabric-sidebar/main.js:527-535`, `layouts/fabric.json`): Leer- und Fehlerdarstellung in der Seitenleiste so kompakt gestalten, dass im Posteingang-Block keine Überlappung mit der Kopfzeile mehr auftritt.
