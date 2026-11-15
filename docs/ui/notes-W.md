# Notizen W: WIP-Limits, Spec-Gate, Definition of Done

Branch `feat/flow` (Basis `main`, `3611729`). Grundlage `docs/factory-research.md` §3 und §4.
`hub` setzt die Regeln durch, Board und Review-Fenster zeigen sie.

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | `wip` (lesen/setzen), `spec` (fehlende Abschnitte als Vorlage), Spec- und WIP-Gate in `dispatch` (mit `--force --reason`), DoD in `gate`/`gate --json` und als Verweigerung in `review` |
| `mods/board/main.js` | `hub wip --json` alle 30 s; Spaltenkopf `n/limit` für In Arbeit (`arbeit`) und Prüfung (`pruefung`), Zähler in der Wartet-Farbe und Stufenname gedimmt, wenn voll |
| `mods/review/main.js` | Block „Definition of Done" unter der Zusammenfassung: ✓/– je Punkt mit Tooltip, Zähler `n/6 erfüllt`, bei Lücken ein Satz „Fehlt: …"; `loadGate` lädt das Gate auch für fertige Tickets |
| `mods/orchestra/test/hub_wip_test.py` | Regressionstests für `wip`, `spec`, das Dispatch-Gate und die DoD in `review` (Wegwerf-Home, `hc`-Stub) |
| `docs/ui/notes-W.md` | diese Notizen |

Nicht angefasst: `mods/tabs-graph`, Theme, README (Abschnitt schreibt der Orchestrator),
`layouts/*.json`.

## Entscheidungen

**Ablage der Limits: Datei, nicht `shared`.** `data/orchestra/wip.json` (`{"arbeit": 3,
"pruefung": 2}`) ist die eine Quelle. `hub` ist der einzige Schreiber und läuft als
Python-CLI ohne App-Prozess; `shared("…")` lebt nur im Fenster. Das Board liest die Datei
über `hub wip --json`, so wie es Tickets und Gates über `hub` liest. Eine fehlende oder
kaputte Datei fällt still auf 3/2 zurück.

**WIP zählt Arbeitseinheiten, keine Agents.** Gezählt werden die Ticketdateien dieses
Homes mit `status: doing` bzw. `review`; fremde Homes zählen nicht. Beim Dispatch bleibt
das Ticket selbst aus der Zählung, damit ein toter `doing`-Agent neu startbar ist.
`hub wip` akzeptiert ganze Zahlen 0–99; alles andere (Buchstaben, negativ, `foo=…`,
fehlendes `=`) endet mit Exit 1 und lässt die Datei unberührt.

**Spec-Vorlage ist ein Platzhalter.** `hub spec <id>` ergänzt fehlende `## Ziel`,
`## Abnahmekriterien`, `## Grenzen` in dieser Reihenfolge am Body-Ende (vor `## Verlauf`);
vorhandene Abschnitte bleiben Byte für Byte stehen. Die Abnahme-Vorlage ist
`- [ ] <was von außen prüfbar ist>` — eine Zeile in spitzen Klammern zählt **nicht** als
Kriterium, sonst würde die Vorlage ihr eigenes Gate erfüllen.

**`--force --reason` gilt für beide Start-Gates.** Ein überfahrener Start schreibt
`Start-Gate überfahren (…): <Grund>` in den Verlauf; ohne `--reason` bricht `dispatch` ab.

**DoD ist eine Funktion in `hub gate`.** Sechs feste Punkte, jeder `{key,label,ok,why}`:

| Punkt | erfüllt wenn |
|---|---|
| `kriterien` | mindestens eine `- [ ]`/`- [x]`-Zeile mit Text unter `## Abnahmekriterien` |
| `verify` | die aufgezeichnete Prüfung ist `pass` und gehört zum HEAD (`gate.ok`) |
| `pruefung` | das Prüfstation-Urteil ist `pass` für den HEAD (`gate.review.ok`) |
| `ci` | `ci` ist `pass` oder gar nicht gesetzt (kein PR = nicht nötig) |
| `nachweise` | `evidence` hat mindestens einen Pfad |
| `abschluss` | der Verlauf enthält einen Abschlussbericht: Rolle nicht `hub`/`orchestrator`/`review`/`ci`/`mensch` und Text mit `fertig`, `blockiert`, `abgeschlossen`, `erledigt`, `done` oder `blocked` |

`hub gate --json` trägt `dod` und `dod_ok`; `hub review` verweigert mit „Definition of
Done: <Punkt> — <Grund>" (und nennt bei `--force` im Verlauf, was fehlte). `--evidence`
wird **vor** dem Gate übernommen, damit die in diesem Aufruf übergebenen Nachweise zählen.
`hub gates` (Team-Panel) trägt dieselbe Liste, weil es `gate` aufruft.

## Prüfung

- `python3 mods/orchestra/test/hub_wip_test.py` → 9 Tests grün (Standard 3/2, ungültige
  Werte, Zählung nur im eigenen Home, Verweigerung bei 3/3 mit Namen der Tickets,
  `--force --reason` im Verlauf, Spec ergänzt nur Fehlendes, Platzhalter zählt nicht,
  Review ohne Nachweise/Abschluss verweigert).
- `python3 mods/orchestra/test/hub_cleanup_test.py` → 8 Tests grün (unverändert).
- `herdr-app check mods/orchestra`, `mods/board`, `mods/review` → `check passed`.
  (`herdr-app check` nimmt ein Verzeichnis je Aufruf; die drei Aufrufe sind der Check
  aus dem Ticket.)
- Testfenster `~/.herdr/ui-preview/feat-flow` (eigener Core, Demo-Welt, 1710×1010).
  `data/orchestra/wip.json` im **Test-Home** auf `{"arbeit": 1, "pruefung": 1}`, `demo-1`
  mit Kriterien, `checks`/`review` auf den Worktree-HEAD gesetzt und `evidence` gesetzt,
  aber ohne Abschluss im Verlauf.
  - Belege `/tmp/ui-flow/`: `board-wip.png` („In Arbeit 1/1", „Prüfung 1/1" in der
    Wartet-Farbe, beide Stufennamen gedimmt, „Fertig" bleibt blau), `review-dod.png`
    („Definition of Done 5/6 erfüllt", fünf ✓, ein – bei „Verlauf enthält einen Abschluss",
    darunter „Fehlt: Verlauf enthält einen Abschluss — hub review demo-1 verweigert bis
    dahin.", `beleg.png` als Nachweis).
  - Für den Ticket-Modus des Review-Fensters wurde im **Test-Home** `props.ticket ??
    "demo-1"` injiziert und danach `docs/ui-preview.sh sync` gefahren; der Worktree ist
    unverändert. Testfenster mit `docs/ui-preview.sh down` beendet.

## Offen

- Das Board liest die Limits alle 30 s; nach `hub wip …` im Terminal kann der Spaltenkopf
  bis zu einem halben Refresh hinterherhängen.
- `hub review --force` schreibt die verfehlte DoD als Kommentar, setzt aber `status:
  review`; die Punkte bleiben in `gate --json` als `ok: false` sichtbar.
- `hub spec` hängt fehlende Abschnitte ans Body-Ende (vor `## Verlauf`), nicht zwischen
  bestehende Themenabschnitte; ein späteres Umsortieren bleibt Handarbeit.
