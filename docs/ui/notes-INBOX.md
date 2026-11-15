# Inbox: Label-Chips, Terminal-Titel, kurzer Pfad

Die Inbox-Liste bekommt die Kürzungsregeln, die das Board schon hat. Im Live-Bild
(`/tmp/round-inbox.png`) stand in der Abnahme-Zeile ein verwaister Rest `h…` (die
Metazeile war auf ein Zeichen geschrumpft) und die „Arbeitet“-Zeile begann mit dem
Programm-Glyph des Terminal-Titels („π HERDR: …“).

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/inbox/main.js` | Label-Chips (`labelChips`, wortgleich aus `mods/board/card.js`), `labelPill`, `clampTitle` (zwei Zeilen, Wortgrenze), `cleanTitle` (Steuerzeichen und führende Glyphen), dreizeilige Zeile mit fester Metazeile, kurzer Repo-Pfad im Detail |
| `docs/ui/notes-INBOX.md` | diese Notizen |

## Verhalten

- **Label-Chips.** Tickets und Fragen tragen in Zeile 1 höchstens zwei Chips; bei mehr
  Labels bleibt eines plus `+n`. Der Chip zeigt den vollen Labeltext und schrumpft selbst
  (`min_w(0)`, `truncate`); der Tooltip nennt alle Labels. Prioritätslabels (`p1`…`p3`)
  fallen wie auf der Karte weg. Die Logik ist die Kopie aus `mods/board/card.js`, weil
  Herdr kein Modul über Mod-Ordner hinweg kennt.
- **Terminal-Titel.** `cleanTitle` entfernt am Anfang Steuerzeichen, Nullbreiten-,
  Nerd-Font- und Emoji-Zeichen sowie Programm-Glyphen (`π `, `✳ `, `● ` …). Der Rest des
  Titels bleibt, wie das Terminal ihn schreibt. Der Titel steht auf einer eigenen Zeile,
  wird an einer Wortgrenze auf zwei Zeilen geklemmt (`clampTitle`) und trägt den vollen
  Text im Tooltip. Space- und Tab-Namen in der Metazeile bleiben unverändert.
- **Kein `h…` mehr.** Die Metazeile hat `min_w(44)`, damit sie nicht auf ein Zeichen
  schrumpft; ihr Tooltip nennt den ganzen Wert. Bei Abnahme-Zeilen steht sie in Zeile 1
  rechts, weil die Gate-Chips die dritte Zeile allein brauchen.
- **Detail.** Der Ticket-Kopf zeigt statt `/Users/thilo/.config/herdr-app` nur das letzte
  Verzeichnis (`herdr-app`); der Tooltip trägt den vollen Repo-Pfad. Mit Branch bleibt
  der Branch stehen.
- **Höhe.** Drei Zeilen: Zustand/Name/Labels, Titel (max. zwei Zeilen), Metazeile/Gates.
  Gemessen im Testfenster: 50–70 px je Zeile (Grenze 72), kein Umbruch bei 320-px-Liste
  (≈ 340 px Panelbreite inklusive Polster).

## Prüfung

- `docs/ui-preview.sh check inbox` → `check passed`.
- Testfenster `feat-inbox`: `errors: []`; danach `down`. Kein Push.
- Belege unter `/tmp/ui-inbox/`:
  - `inbox-detail.png` — Abnahmen-Zeile mit zwei vollen Label-Chips (`abnahme`, `ui`),
    Titel „Sidebar: Abstände vereinheitlichen“, Gates ohne Überlauf; rechts Detail mit
    `repo` statt des vollen Pfads.
  - `inbox-340.png` — Liste als 340-px-Ausschnitt: zwei Chips, `repo`, kein `h…`-Rest;
    „Arbeitet“-Zeile „HERDR: Herdr — Inbox, Board und Abnahmen“ ohne `π`, auf zwei
    Zeilen geklemmt.
  - `inbox-full.png` — ganzes Testfenster für den Zusammenhang.
- Der `π`-Titel und die zwei Labels sind Demo-Daten im Test-Home (`feat-inbox`); der
  Repo-Zustand enthält sie nicht. Der 340-px-Beleg ist ein Ausschnitt der Liste aus dem
  Testfenster (2×-Retina, Zoom 1,2), kein zweites Fenster.

## Grenzen

- Die Inbox bleibt ein Popup mit fester Listenbreite 320; der schmale Beleg ist ein
  Ausschnitt, keine eigene Fensterbreite.
- Tooltips sind nur im Code belegt (Hintergrundfenster zeigt sie nicht).
- Kein Push.
