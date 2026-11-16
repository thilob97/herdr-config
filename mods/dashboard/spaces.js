// Bereichswahl und Space-Summen des Dashboards (Workspace-Fabrik 3). Ein Space ist der
// Schlüssel, an dem Tickets, Lanes und Events hängen (docs/ui/notes-SPACE.md): Das
// Dashboard legt mehrere Spaces übereinander und zeigt die Summe ihrer Fabriken.
//
// Warum eine eigene Datei: main.js ist die Ansicht; hier steht die reine Regel —
// Auswahl, Farben, Zuordnung eines Tickets, Summe mehrerer `hub stats`. Damit ist sie
// ohne Fenster prüfbar (test/spaces.test.mjs).

// "own" = dieser Workspace (Vorgabe), "some" = die gewählten IDs, "all" = alle.
export const OWN = "own", SOME = "some", ALL = "all";

// Die Serie der App (c1…c6), wie das Team-Panel die Agent-Farben nimmt.
export const SERIES = ["c1", "c2", "c3", "c4", "c5", "c6"];
const THEME = { c1: "accent", c2: "working", c3: "done", c4: "blocked", c5: "solid", c6: "muted" };

/** Die Theme-Farbe einer Serienfarbe; das Theme entscheidet, wie sie aussieht. */
export const spColor = (t, key) => t[THEME[key] ?? "accent"] ?? t.accent;

const hash = (s) => {
  let h = 0;
  for (const ch of String(s ?? "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
};

/** Farbpunkt je Space-ID: stabil (der Hash der ID entscheidet) und ohne Doppelung,
 *  solange es höchstens sechs Spaces gibt — ein belegter Platz rückt weiter. Die
 *  Reihenfolge der Liste ändert nichts, also trägt ein Space überall denselben Punkt. */
export function seriesOf(ids) {
  const out = new Map(), taken = new Set();
  for (const id of [...new Set(ids)].filter(Boolean).sort()) {
    let i = hash(id) % SERIES.length;
    for (let n = 0; n < SERIES.length && taken.has(SERIES[i]); n++) i = (i + 1) % SERIES.length;
    taken.add(SERIES[i]);
    out.set(id, SERIES[i]);
  }
  return out;
}

/** `shared("dashboard.spaces")` lesen: fehlt es oder ist es Unsinn, gilt "Dieser
 *  Workspace". Eine leere Mehrfachauswahl fällt ebenfalls darauf zurück — nie nichts. */
export function pickOf(value) {
  if (value?.mode === ALL) return { mode: ALL, ids: [] };
  if (value?.mode === SOME) {
    const ids = (Array.isArray(value.ids) ? value.ids : []).map(String).filter(Boolean);
    if (ids.length) return { mode: SOME, ids };
  }
  return { mode: OWN, ids: [] };
}

/** Die Space-IDs, die eine Auswahl zeigt. Ohne eigenen Space zeigt "Dieser Workspace"
 *  alles, statt eine leere Fläche zu behaupten (erste Sekunde, Hub ohne Antwort). */
export function effective(pick, ownId, allIds) {
  if (pick.mode === ALL) return new Set(allIds);
  if (pick.mode === SOME) return new Set(pick.ids);
  return new Set(ownId ? [ownId] : allIds);
}

/** Ein Chip-Klick: dieser Space an oder aus. Bleibt nichts übrig, gilt wieder "Dieser
 *  Workspace"; sind danach alle an, wird daraus "Alle" (dessen Chip leuchtet). */
export function toggle(pick, id, ownId, allIds) {
  const next = effective(pick, ownId, allIds);
  if (next.has(id)) next.delete(id); else next.add(id);
  if (!next.size) return { mode: OWN, ids: [] };
  const all = new Set(allIds);
  if (all.size && next.size === all.size && [...next].every((x) => all.has(x))) return { mode: ALL, ids: [] };
  return { mode: SOME, ids: [...next].sort() };
}

// ---------- Zuordnung eines Tickets ----------

const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

/** Ein Agent-Space ist der Wegwerf-Space eines Tickets, kein Workspace. Die Auswahl
 *  im Kopf und die Workspaces-Karte zeigen nur `kind: workspace`. */
export const isAgent = (r) => r?.kind === "agent";

/** Nur die Workspaces einer `hub spaces --json`-Liste (die Gruppe "ohne Workspace"
 *  trägt keine ID und bleibt darin). */
export function workspaceRows(rows) {
  return (rows ?? []).filter((r) => !isAgent(r));
}

/** Der Workspace hinter einer Space-ID: ein Agent-Space nennt ihn in `workspace`,
 *  jeder andere Space ist sein eigener. */
export function workspaceOf(rows, sid) {
  const id = String(sid ?? "");
  if (!id) return "";
  const row = (rows ?? []).find((r) => r?.id === id && isAgent(r));
  return row?.workspace || id;
}

/** Der Workspace einer Agent-Zeile: der seines Tickets (die Agent-Space-Kennung zählt
 *  nicht), sonst der ihres Herdr-Space bzw. der eigene. Das Ticket ist die Wahrheit,
 *  auch wenn sein Agent schon fertig ist. */
export function agentWorkspace(a, tickets, rows, ownId) {
  const tk = (tickets ?? []).find((x) => x?.terminal && x.terminal === a?.address);
  if (tk) {
    const sid = ticketSpace(tk, workspaceRows(rows));
    if (sid) return sid;
  }
  return workspaceOf(rows, a?.space ?? a?.space_id) || ownId || "";
}

/** Der Space eines Tickets: sein `space`, wenn es einen Namen trägt. Ein Alt-Ticket
 *  (ohne `space_name`) gehört dem Space, dessen Ordner sein `repo` enthält — wie
 *  `hub` es rechnet; ohne Ordner bleibt es "" („ohne Workspace"). */
export function ticketSpace(tk, rows) {
  const sid = String(tk?.space ?? "").trim();
  if (sid && String(tk?.space_name ?? "").trim()) return sid;
  const repo = String(tk?.repo ?? "").trim();
  if (!repo) return "";
  const hits = (rows ?? []).filter((r) => r.folder && inside(repo, r.folder)
    && (!tk.machine || r.machine === tk.machine));
  return hits.sort((x, y) => y.folder.length - x.folder.length)[0]?.id ?? "";
}

// ---------- Summe mehrerer Spaces ----------

/** Offene Kosten eines Space: `cost_open` aus `hub spaces` zählt nur Tickets, die
 *  nicht done sind — dieselbe Regel wie „offen bisher" in `hub status`. Ein älteres
 *  hub kennt nur `cost` (alles); dann bleibt das die beste Antwort. */
export const openCost = (r) => Number(r?.cost_open ?? r?.cost ?? 0) || 0;

/** Alle Ticket-Kosten eines Space, auch erledigte (`cost` aus `hub spaces`). */
export const totalCost = (r) => Number(r?.cost ?? 0) || 0;

/** Die Orchestrator-Kosten eines Space (costs.json `orchestrators`, wie
 *  mods/orchestra/costs.js sie führt). Ein älteres Home hat nur eine Zahl: sie gehört
 *  dem eigenen Space und „Alle"; "" ist dort die Summe. */
export function orchestratorCost(spaceId, { orchestrators = {}, orchestrator = 0 } = {}) {
  const per = orchestrators ?? {};
  if (!Object.keys(per).length) return Number(orchestrator) || 0;
  return spaceId ? Number(per[spaceId]) || 0 : Number(orchestrator) || 0;
}

/** Kosten der gewählten Spaces: die offenen Ticket-Kosten je Space plus der
 *  Orchestrator jedes gewählten Space. `orchestrators` ist die Karte aus costs.json;
 *  ein altes File mit nur `orchestrator` zählt einmal, wie der Team-Panel-Kopf.
 *  `orchParts` nennt je gewähltem Space mit Orchestrator-Kosten seinen Anteil; eine
 *  Kostenzeile ohne Space-Label (`""`) gehört dem eigenen Workspace und zählt einmal. */
export function costSplit(rows, { all = false, ids = new Set(), ownId = "",
  orchestrators = {}, orchestrator = 0 } = {}) {
  const picked = (rows ?? []).filter((r) => all || !ids.size || ids.has(r.id));
  const tickets = picked.reduce((n, r) => n + openCost(r), 0);
  const per = orchestrators ?? {};
  const split = Object.keys(per).length > 0;
  const picks = all || !ids.size || ids.has(ownId);
  const orchParts = [];
  if (split) {
    const seen = new Set();
    for (const r of picked) {
      const sid = r.id;
      if (!sid || seen.has(sid) || !(Number(per[sid]) > 0)) continue;
      seen.add(sid);
      orchParts.push({ name: r.name || sid, cost: r2(Number(per[sid])) });
    }
    // Die Zeile ohne Label entstand vor den Space-Labels (oder an einem Home ohne
    // Labels): wie der alte eine `orchestrator`-Wert gehört sie dem eigenen Workspace.
    if (picks && Number(per[""]) > 0) {
      orchParts.push({ name: picked.find((r) => r.id === ownId)?.name || ownId || "ohne Workspace",
        cost: r2(Number(per[""])) });
    }
  }
  const orch = split ? orchParts.reduce((n, p) => n + p.cost, 0)
    : (picks ? Number(orchestrator) || 0 : 0);
  return {
    team: r2(tickets + orch),
    parts: picked.filter((r) => openCost(r) > 0).map((r) => ({ name: r.name || r.id, cost: openCost(r) })),
    orch,
    orchParts,
  };
}

/** Median wie `hub stats` (eine Nachkommastelle); null ohne Wert. */
export function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return Math.round((a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) * 10) / 10;
}

// `hub stats` zählt in Sekunden (Ticket-Stempel); Date rechnet in Millisekunden.
const dayOf = (t) => {
  const d = new Date(t > 1e11 ? t : t * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const r2 = (n) => Math.round(n * 100) / 100;

/** Ein einzelnes `hub stats` unverändert, mehrere als Summe: Zähler und Kosten addieren,
 *  der Median ist der Median der vereinigten erledigten Tickets (die Summe von Medianen
 *  wäre keine Kennzahl). Die Tagesreihe entsteht aus den Zeilen, die hub je Space liefert. */
export function mergeStats(list) {
  const outs = (list ?? []).filter(Boolean);
  if (!outs.length) return null;
  if (outs.length === 1) return outs[0];
  const rows = outs.flatMap((o) => o.tickets ?? []);
  const leadsOn = (date) => rows.filter((r) => r.done_at && dayOf(r.done_at) === date).map((r) => r.lead_min);
  const sum = (pick) => r2(outs.reduce((n, o) => n + (Number(pick(o)) || 0), 0));
  const today = outs[0].today?.date ?? dayOf(Date.now());
  const history = (outs[0].history ?? []).map((h, i) => ({
    date: h.date,
    done: outs.reduce((n, o) => n + (o.history?.[i]?.done ?? 0), 0),
    rework: outs.reduce((n, o) => n + (o.history?.[i]?.rework ?? 0), 0),
    cost: r2(outs.reduce((n, o) => n + (o.history?.[i]?.cost ?? 0), 0)),
    median_min: median(leadsOn(h.date)),
  }));
  return {
    space: "", space_name: "", at: Math.max(...outs.map((o) => o.at ?? 0)),
    today: {
      date: today,
      done: sum((o) => o.today?.done),
      rework: sum((o) => o.today?.rework),
      cost: sum((o) => o.today?.cost),
      median_min: median(leadsOn(today)),
    },
    history,
    summary: {
      tickets: sum((o) => o.summary?.tickets),
      done: sum((o) => o.summary?.done),
      rework: sum((o) => o.summary?.rework),
      cost: sum((o) => o.summary?.cost),
    },
    tickets: rows,
  };
}
