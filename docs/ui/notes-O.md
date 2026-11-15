# Notizen O: Runde-3-Minors — Fabrik und Review-Fenster

Branch `feat/minors-a`. Die Minor- und Nit-Befunde aus `docs/ui/review3.md` für das Team-Panel,
das Review-Fenster und die Inbox. Kein neues Verhalten außerhalb dieser Flächen; die Sprache
folgt jetzt zwei Begriffen: **Prüfung** (Prüfstation, grün/rot) und **Abnahme** (Mensch,
offen/abgenommen). „Review“ bleibt der Name des Fensters und der Mod-Aufruf (§5.7).

## Dateien

| Datei | Inhalt |
|---|---|
| `mods/orchestra/bin/hub` | `reviewer_name` beim Start; „Urteil:“ aus der Zusammenfassung; `gate`/`review_gate` werten gelandete Tickets nicht mehr am Merge-Commit; `stale` und `landed` im Gate-JSON; `base.ok = null` bei `done` |
| `mods/orchestra/tickets.js` | `reviewer_name` überlebt den Quests-Writeback |
| `mods/orchestra/ui.js`, `mods/review/ui.js` | Gate-Chips: `Checks –` in `muted`, ✗ nur rot/veraltet; `Prüfung …`, `Abnahme offen`, `abgenommen`; `reviewerChip` aus `reviewer_name`; `windowHeader` mit `metaTip` |
| `mods/orchestra/hubview.js` | Prüfer-Chip statt Terminal-Adresse; PR/Merge als eigener Gate-Chip; Verlaufs-Vorschau zwei Zeilen mit „…“ |
| `mods/review/main.js` | Zeile **Checks** (hub verify) und **Prüfung** (Urteil) getrennt; gelandete Tickets zeigen das aufgezeichnete Urteil; Lehre sekundär; Meta nennt `gemergt in …` |
| `mods/inbox/main.js`, `mods/inbox/ui.js` | Kopf nennt `+ n Verlauf`; keine rohe Adresse mehr im Detailkopf; `Abnahme offen` |
| `docs/ui-spec.md` | §7.3: Zähler bleibt `blocked + review`; Verlaufs-Fragen erscheinen als Zeile, der Kopf nennt die Differenz |
| `docs/ui/notes-O.md` | diese Notizen |

## Befunde

**R3-06 Prüfer-Identität.** `hub review-start` schreibt neben `reviewer` (Programmschlüssel) ein
`reviewer_name` ins Ticket (`Claude`, `Codex`, `Oh My Pi`, sonst der Programm-Basename). Der
Prüfer-Chip nimmt bei laufendem Terminal dessen Identität, sonst `reviewer_name`; `review_terminal`
dient nur noch dem Live-Zustand. Aus „t8 (beendet)“ wird **Claude**.

**R3-07 Checks ohne Angabe.** `gateChip` zeigt ohne aufgezeichnete Prüfung `Checks –` in `muted`;
`✗` bleibt `checks=fail` und dem veralteten HEAD vorbehalten (`gate.stale`, jetzt im Gate-JSON).
Ein fehlender Worktree ist ebenfalls `–`, nicht `✗`, und nennt den Grund im Tooltip.

**R3-08 Gelandet ist kein neuer Prüfstand.** `gate` liest bei `status=done` keinen HEAD mehr und
wertet die Aufzeichnung: `ok` aus `checks`, `review.ok` aus dem Urteil, `base.ok = null`. Das
Review-Fenster nimmt für gelandete Tickets `this.gate` nicht mehr (`verifyRow` tat das schon) und
zeigt **Prüfung grün (aufgezeichnet)**. Der Merge-Commit auf `main` erzeugt kein „neuer Commit“.

**R3-09 Inbox-Zähler.** Badge und Tab-Leiste bleiben `blocked + review`; die Verlaufs-Frage ist eine
eigene Zeile unter „Rückfragen“. Der Inbox-Kopf nennt die Differenz wie das Dashboard
(**„+ 1 Verlauf“**, Tooltip mit der vollen Rechnung), §7.3 beschreibt es. Die Alternative — die
Frage in die Formel aufnehmen — hätte die Tab-Leiste (`mods/tabs-graph`, außerhalb der Grenzen)
abweichen lassen.

**R3-10 Ein Primärknopf.** „Lehre übernehmen“ ist sekundär; „Mergen“ bleibt der Primärknopf der
Abnahme.

**R3-12 PR ist ein Gate.** `PR offen` und `gemergt main@…` sitzen als eigene Chips in der
Gate-Zeile, der Lehren-Zähler steht allein in der Metazeile. Der Merge-Chip nennt Branch und Pfad
im Tooltip.

**R3-15 Zwei Wörter.** Gate-Chips heißen **Prüfung läuft/grün/rot/–**, **Abnahme offen**,
**abgenommen**; die Zeile im Review-Fenster heißt **Prüfung**, die Verify-Zeile **Checks**, das
Label im Team-Panel **Prüfer**. „Review“ bleibt der Fenstername.

**R3-16 Adresse nur im Tooltip.** Der Inbox-Detailkopf zeigt Identitäts-Chip und Space/Tab; die
Adresse steht im Tooltip des Chips.

**R3-17 „Urteil“ einmal.** `hub review-verdict` entfernt ein führendes `Urteil:` aus der
Zusammenfassung, bevor es den Verlaufseintrag schreibt. Aus
`Urteil: pass (Runde 1) · Urteil: pass — …` wird `Urteil: pass (Runde 1) · pass — …`.

**R3-18 Vorschau mit Ellipsis.** Die eingeklappte Verlaufs-Vorschau hat zwei Textzeilen Platz
(`max_h(48)`) und schneidet am Wort mit „…“ (`previewText`, 84 Zeichen). Kein stilles Kappen mehr.

**R3-20 Meta nach dem Merge.** Im Zustand `done` nennt die Fenster-Meta `gemergt in main@…`
(oder PR/Branch); der entfernte Pfad steht nur im Tooltip. `windowHeader` trägt dafür `metaTip`.

## Prüfung

Wegwerf-Home (`/tmp/minors-hubtest`, echtes Git, Fake-`hc` für `review-start`):

- `hub gate done-1 --json` bei `status=done`: `ok: true`, `review.ok: true`, `stale: false`,
  `base.ok: null` — obwohl das Repo-HEAD der Merge-Commit ist; die Textausgabe sagt
  „aufgezeichnetes Urteil (Ticket ist fertig)“.
- `hub gate open-1 --json` mit Prüfung auf älterem Commit: `stale: true` für Checks und Urteil,
  Grund mit beiden Kürzeln.
- `hub gate fresh-1 --json` ohne Prüfung: `checks: null`, `ok: false` → `Checks –` in der UI.
- `hub review-start start-1 --agent claude` schreibt `reviewer: claude`,
  `reviewer_name: Claude`, `review_terminal: t9`.
- `hub review-verdict … --summary "Urteil: pass — 0 Blocker"` schreibt
  `review_summary: pass — 0 Blocker` und den Verlaufseintrag mit genau einem „Urteil:“.
- `hub gates --json` trägt `stale`/`landed` je Zeile.

Testfenster (`docs/ui-preview.sh up`, Demo-Welt, Tickets im Test-Home gesetzt):

| Screenshot `/tmp/ui-minors/` | Befund |
|---|---|
| `06-reviewer-chip.png` | Prüfer-Chip **Claude** statt Terminal-Adresse |
| `07-checks-keine.png` | `Checks –` und `Prüfung –` in `muted` |
| `08-done-gate.png` | gelandetes Ticket: Kopf **Prüfung grün/abgenommen**, Station **grün (aufgezeichnet)** |
| `09-inbox-zaehler.png` | Inbox-Kopf **3 + 1 Verlauf** |
| `10-lehre-sekundaer.png` | **Lehre übernehmen** sekundär, **Mergen** primär |
| `12-pr-chip.png` | **PR offen** als Chip in der Gate-Zeile, **Lehren 2** allein |
| `15-pruefung-abnahme.png` | Prüfung/Prüfer/Abnahme in einer Fläche |
| `16-inbox-adresse.png` | Detailkopf ohne rohe Adresse |
| `17-urteil-einmal.png` | Verlauf mit einem „Urteil:“ |
| `18-verlauf-clamp.png` | zwei Zeilen mit „…“ |
| `20-done-meta.png` | Meta **gemergt in main@fdbe41f** |

`herdr-app check mods/orchestra mods/review mods/inbox`: je `check passed`.
Testfenster mit `docs/ui-preview.sh down` beendet, kein Push.

## Offen

`docs/ui-spec.md` §5.6 nennt im Gate-Chip noch `Review offen`/`abgenommen`; §7.3 war die einzige
erlaubte Spec-Stelle dieses Tickets. Die Wörter dort beim nächsten Spec-Durchgang nachziehen.
