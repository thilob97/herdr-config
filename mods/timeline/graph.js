// Der Timeline-Graph als Baum von oben nach unten — dieselbe Rechnung wie im
// Fabrik-Graph (`mods/graph/layout.js`), erweitert um die Daten der Timeline:
// der Orchestrator ist die Wurzel oben mittig, jeder Agent bekommt eine Spalte
// über die Breite, Sub-Agents hängen eingerückt unter ihrem Parent — auch
// mehrstufig (`subagents[].parent` nennt den Sub-Agent-Parent, sonst hängt der
// Sub-Agent direkt an seiner Lane). Jede Agent-Karte ist kompakt (Avatar, Name,
// Status), der Ticket-Chip sitzt als eigene Zeile darunter und trägt das
// Triage-Maß als Suffix („KÜRZEL · S/M/L“).
//
// Rückläufer: Ein `fail`-Urteil (Event `verdict`) oder ein Statuswechsel
// `review → doing` im `status_log` eröffnet eine Prüfrunde. Je Runde zieht eine
// gestrichelte Kante vom Reviewer-/Urteils-Knoten zurück zum Ticket-Chip; ein
// späteres `pass` färbt nur die Pfeilspitze in die Erfolgsfarbe, die Kante
// bleibt gestrichelt. Reine Rechnung ohne App-Module (`node --test`), Zeiten in
// Sekunden, `null` heißt unbekannt.

export const PAD = 20;            // Rand: Platz für Leitungen außen an den Spalten
export const CARD_W = 200;        // bevorzugte Spaltenbreite
export const CARD_W_MAX = 260;    // breiter wird eine Karte nicht
export const CARD_H = 36;         // eine Zeile: Avatar, Name, Status
export const ROOT_H = 44;
export const ROOT_W_MAX = 280;
export const TICKET_H = 16;
export const CHIP_GAP = 4;
export const CHIP_INSET = 10;
export const INDENT = 22;         // je Ebene nach rechts, Karte wird schmaler
export const GAP_X = 40;          // breiter Gang: Platz für Leitungen neben den Karten
export const BAND_GAP = 30;       // zwischen zwei Agenten derselben Spalte
export const SUB_GAP = 10;
export const DISPATCH_GAP = 26;   // Wurzel-Unterkante bis erste Agentenzeile
export const MIN_COLS = 2;
export const NARROW_W = 520;      // darunter schmalere Karten (eine Zeile bleibt)
const MIN_CARD_W = 96;
const EDGE_LANE = 10;             // Abstand einer Kante zur Kartenkante
// Ein Urteil und der Wechsel zurück in die Arbeit gehören zu derselben Runde; die
// beiden Quellen (Event und status_log) schreiben Minuten auseinander.
const ROUND_DEDUPE = 15 * 60;
// Je Runde rückt die Rückläufer-Leitung ein Stück weiter in den Spaltengang.
const ROUND_STEP = 6;

/** Ticket-Kurz-ID wie auf Board-Karte und Timeline: erstes sinnvolles Wort, die
 *  Zahl am Ende bleibt (zwei Tickets desselben Themas bleiben unterscheidbar). */
const STOP = new Set(["und", "im", "in", "der", "die", "das", "ein", "eine", "zu", "mit", "fur", "für", "von", "the", "a", "an", "of"]);
export function shortId(id) {
  const raw = String(id ?? "");
  const num = /(\d+)$/.exec(raw)?.[1];
  const words = raw.split("-").filter((p) => p && !STOP.has(p));
  let s = (words[0] || raw).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  if (num && !s.endsWith(num)) s = `${s.slice(0, 6)}-${num}`;
  else if (!num && words[1] && s.length <= 6) s = `${s}-${words[1].slice(0, 2).toUpperCase()}`;
  return s || "TICKET";
}

/** Triage-Maß S/M/L eines Tickets; fehlt das Feld, trägt es ein Label `size-s`. */
export function sizeOf(tk) {
  const direct = String(tk?.size ?? "").trim().toUpperCase();
  if (["S", "M", "L"].includes(direct)) return direct;
  const m = /(?:^|[,\s])size-([sml])(?:$|[,\s])/i.exec(String(tk?.labels ?? ""));
  return m ? m[1].toUpperCase() : "";
}

const isOrchestrator = (lane) => lane?.kind === "orchestrator" || lane?.orchestrator === true;
const statusOf = (lane) => (["working", "blocked", "done", "idle"].includes(lane?.status)
  ? lane.status : lane?.start != null && lane?.end == null ? "working" : "done");

/** Ein Kantenzug: Anfang, Knickpunkte, Ende. Der Renderer rundet die Ecken und
 *  setzt die Pfeilspitze in Richtung des letzten Segments. `tone`/`arrow` sind
 *  Rollen, keine Farben: der Renderer löst sie im Theme auf. */
const addEdge = (edges, id, kind, from, to, points, { dashed = false, faint = false, tone = null, arrow = null, tip = null, badge = null } = {}) => {
  const clean = [];
  for (const p of points) {
    const prev = clean[clean.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < 0.5 && Math.abs(prev[1] - p[1]) < 0.5) continue;
    clean.push(p);
  }
  edges.push({ id, kind, from, to, points: clean, dashed, faint, tone, arrow, tip, badge });
};

// ---- Runden --------------------------------------------------------------

const STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
/** `status_log`-Zeitstempel („JJJJ-MM-TT HH:MM“, lokal) als Sekunden. */
function stampSec(ts) {
  const m = STAMP.exec(String(ts ?? "").trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() / 1000;
}

/** Die Statuswechsel eines Tickets, älteste zuerst. */
const movesOf = (tk) => String(tk?.status_log ?? "").split("|").map((part) => {
  const at = part.lastIndexOf("@");
  if (at < 0) return null;
  const state = part.slice(0, at).trim();
  const sec = stampSec(part.slice(at + 1));
  return state && sec != null ? { state, at: sec } : null;
}).filter(Boolean).sort((a, b) => a.at - b.at);

/** Jeder Wechsel `review → doing` ist eine Nacharbeit nach einer Prüfung. */
function reworkTimes(tk) {
  const out = [];
  let reviewed = false;
  for (const m of movesOf(tk)) {
    if (m.state === "review") reviewed = true;
    else if (m.state === "doing" && reviewed) { out.push(m.at); reviewed = false; }
  }
  return out;
}

/**
 * Prüfrunden je Ticket aus beiden Quellen: `fail`-Urteile der Ereignisse und
 * `review → doing` im `status_log`. Beide schreiben dieselbe Runde mit ein paar
 * Minuten Abstand — deshalb verschmilzt, was innerhalb von `ROUND_DEDUPE` liegt.
 * @returns {Map<string, Array<{n: number, at: number, terminal: string|null,
 *          lane: string|null, pass: boolean}>>}
 */
export function feedbackRounds(lanes = [], tickets = []) {
  const fails = new Map(), verdicts = new Map(), seen = new Set();
  const push = (map, key, value) => { const list = map.get(key) ?? []; list.push(value); map.set(key, list); };
  for (const lane of lanes ?? []) {
    for (const ev of lane?.events ?? []) {
      if (ev?.kind !== "verdict" || !ev.ticket || ev.at == null) continue;
      const key = `${ev.ticket}|${Math.round(ev.at)}|${ev.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = String(ev.text ?? "").toLowerCase();
      const fail = /\bfail\b|failed|rot\b/.test(text);
      const pass = /\bpass\b|passed|gr[üu]n\b/.test(text);
      if (!fail && !pass) continue;
      push(verdicts, ev.ticket, { at: ev.at, pass });
      if (fail) push(fails, ev.ticket, { at: ev.at, terminal: ev.terminal || lane.terminal || null, lane: lane.id });
    }
  }

  const out = new Map();
  for (const tk of tickets ?? []) {
    if (!tk?.id) continue;
    const f = (fails.get(tk.id) ?? []).slice().sort((a, b) => a.at - b.at);
    const times = f.map((x) => x.at);
    for (const at of reworkTimes(tk)) {
      // Nur ein `fail`-Urteil derselben Runde verschmilzt; zwei Nacharbeiten
      // hintereinander sind zwei Runden.
      if (!f.some((x) => Math.abs(x.at - at) <= ROUND_DEDUPE)) times.push(at);
    }
    if (!times.length) continue;
    times.sort((a, b) => a - b);
    const said = (verdicts.get(tk.id) ?? []).slice().sort((a, b) => a.at - b.at);
    out.set(tk.id, times.map((at, i) => {
      const hit = f.find((x) => Math.abs(x.at - at) <= ROUND_DEDUPE) ?? null;
      // Das Urteil, das diese Runde beendet: erst der nächste `pass` macht die
      // Rückläufer-Kante grün; ein weiteres `fail` hält sie in der Blocked-Farbe.
      const next = said.find((v) => v.at > at) ?? null;
      return { n: i + 1, at, terminal: hit?.terminal ?? null, lane: hit?.lane ?? null,
        pass: Boolean(next?.pass) };
    }));
  }
  return out;
}

// ---- Layout --------------------------------------------------------------

/**
 * @param {{lanes?: Array, tickets?: Array, windowStart?: number|null, now?: number,
 *          ticket?: string|null, width?: number}} o
 *   lanes: normalisierte Lanes aus `hub timeline --json` (Sekunden; `parent` ist
 *   eine Lane-ID, `subagents[].parent` optional der Parent-Sub-Agent). tickets:
 *   bereits auf den Workspace gescopt (`ui.inScope`), damit der Chip die
 *   Triage-Größe und Rückläufer-Runden kennt. windowStart/now: dasselbe
 *   Zeitfenster wie die Balken. ticket: der Ticket-Filter der Kopfzeile.
 *   width: verfügbare Fläche in Layout-Einheiten.
 * @returns {{columns: Array, nodes: Array, ticketNodes: Array, edges: Array,
 *            width: number, height: number, rows: number, narrow: boolean,
 *            cardW: number, rounds: number}}
 */
export function layoutGraph({ lanes = [], tickets = [], windowStart = null, now = 0, ticket = null, width = 760 } = {}) {
  const byTicket = new Map();
  for (const tk of tickets ?? []) if (tk?.id && !byTicket.has(tk.id)) byTicket.set(tk.id, tk);

  // Der Ticket-Filter der Timeline: Treffer plus ihre Lane-Kinder (Sub-Agents),
  // damit der Baum eines Tickets nicht seine eigenen Kinder verliert.
  let ticketIds = null;
  if (ticket) {
    ticketIds = new Set(lanes.filter((l) => l?.ticket === ticket).map((l) => l.id));
    for (let changed = true; changed;) {
      changed = false;
      for (const l of lanes) {
        if (!ticketIds.has(l.id) && l.parent && ticketIds.has(l.parent)) { ticketIds.add(l.id); changed = true; }
      }
    }
  }

  // 1. Zeitfenster und Ticket-Filter — dieselbe Regel wie die Balken: eine Lane
  // ohne Start zählt über ihr Ereignis im Fenster, eine beendete über ihre
  // Überlappung. Der Orchestrator bleibt als Wurzel stehen.
  const visible = [];
  for (const lane of lanes ?? []) {
    if (!lane?.id) continue;
    if (ticketIds && !ticketIds.has(lane.id)) continue;
    if (windowStart != null) {
      if (lane.start == null) {
        const hit = statusOf(lane) === "working"
          || (lane.events ?? []).some((e) => e?.at != null && e.at >= windowStart && e.at <= now);
        if (!hit) continue;
      } else {
        const end = lane.end ?? (lane.status === "done" ? lane.start : now);
        if (lane.start > now || end < windowStart) continue;
      }
    }
    visible.push(lane);
  }

  const ids = new Set(visible.map((l) => l.id));
  const parentOf = new Map();
  for (const lane of visible) {
    const p = lane.parent;
    if (p && p !== lane.id && ids.has(p)) parentOf.set(lane.id, p);
  }
  // „Oben der Orchestrator, darunter seine Agents“: ein Agent ohne (sichtbaren)
  // Parent gehört zur Fabrik dieses Orchestrators. Nur wenn keiner läuft, sind
  // Agents eigene Wurzeln.
  const orch = visible.find(isOrchestrator);
  if (orch) {
    for (const lane of visible) {
      if (lane === orch || parentOf.has(lane.id) || isOrchestrator(lane)) continue;
      parentOf.set(lane.id, orch.id);
    }
  }
  const kids = new Map();
  for (const lane of visible) {
    const p = parentOf.get(lane.id);
    if (!p) continue;
    const list = kids.get(p) ?? [];
    list.push(lane);
    kids.set(p, list);
  }

  const start = (l) => (l?.start ?? Infinity);
  const label = (l) => String(l?.label ?? l?.id ?? "");
  const order = (a, b) => start(a) - start(b) || label(a).localeCompare(label(b), "de");
  for (const list of kids.values()) list.sort(order);

  const roots = visible.filter((l) => !parentOf.has(l.id)).sort((a, b) =>
    (isOrchestrator(a) ? 0 : 1) - (isOrchestrator(b) ? 0 : 1) || order(a, b));

  const avail = Math.max(240, Math.round(Number(width) || 760));
  const narrow = avail < NARROW_W;
  const cardH = CARD_H;
  const contentW = avail - 2 * PAD;
  const direct = orch ? (kids.get(orch.id) ?? []) : roots;
  const directCount = direct.length;

  // Spaltenzahl: so viele Agents wie möglich bekommen eine eigene Spalte,
  // mindestens zwei, solange die Spalte nicht unter MIN_CARD_W fällt.
  const fit = Math.max(MIN_COLS, Math.floor((contentW + GAP_X) / (CARD_W + GAP_X)));
  const cols = directCount === 0 ? 0 : Math.min(directCount, Math.max(directCount > 1 ? MIN_COLS : 1,
    Math.min(fit, Math.floor((contentW + GAP_X) / (MIN_CARD_W + GAP_X)))));
  const slotW = cols ? (contentW - (cols - 1) * GAP_X) / cols : contentW;
  const cardW = cols ? Math.min(CARD_W_MAX, slotW) : 0;

  const nodes = [], ticketNodes = [], edges = [];
  const byId = new Map();
  const seen = new Set();
  const claimedTicket = new Set();

  const nodeH = (lane) => (isOrchestrator(lane) ? ROOT_H : cardH);

  const laneNode = (lane, depth, column, band, x, y, w) => {
    const node = {
      id: `lane:${lane.id}`, laneId: lane.id,
      kind: isOrchestrator(lane) ? "orchestrator" : "agent",
      label: label(lane), status: statusOf(lane), ticket: lane.ticket || null,
      terminal: lane.terminal ?? null, depth, column, band, row: band,
      x, y, w, h: nodeH(lane), narrow,
      started: lane.start ?? null, ended: lane.end ?? null,
      parent: parentOf.has(lane.id) ? `lane:${parentOf.get(lane.id)}` : null,
      ownsTicket: false, subtitle: null,
    };
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  const subVisible = (sub) => {
    const ended = sub?.ended ?? null, started = sub?.started ?? null;
    if (windowStart == null || started == null) return true;
    return !((ended ?? now) < windowStart || started > now);
  };

  const subOrder = (a, b) => ((a.started ?? Infinity) - (b.started ?? Infinity))
    || String(a.title ?? a.id ?? "").localeCompare(String(b.title ?? b.id ?? ""), "de");

  /** Sub-Agents unter ihrem Parent: `parent` nennt den Sub-Agent-Parent, alles
   *  andere hängt direkt an der Lane. Ein Zyklus bleibt eine Karte, kein Lauf. */
  const subTree = (lane) => {
    const subs = (lane.subagents ?? []).filter(subVisible);
    const known = new Set(subs.map((s) => String(s.id)));
    const childOf = new Map(), roots = [];
    for (const s of subs) {
      const p = s.parent == null ? "" : String(s.parent);
      if (p && p !== String(s.id) && known.has(p)) {
        const list = childOf.get(p) ?? [];
        list.push(s);
        childOf.set(p, list);
      } else roots.push(s);
    }
    for (const list of childOf.values()) list.sort(subOrder);
    roots.sort(subOrder);
    return { childOf, roots };
  };

  const rootW = Math.min(ROOT_W_MAX, contentW);
  const rootX = PAD + (contentW - rootW) / 2;
  let rootNode = null;

  // 2. Die Wurzel mittig, dann je Agent eine Spalte. Innerhalb der Spalte stehen
  // Karte, Ticket-Chip und der ganze Sub-Baum untereinander.
  const colX = (col) => PAD + col * (slotW + GAP_X);
  const colCardX = (col) => colX(col) + Math.max(0, (slotW - cardW) / 2);
  const innerGapX = (col, frac) => (col < cols - 1
    ? colCardX(col) + cardW + GAP_X * frac : colCardX(col) - GAP_X * frac);
  const firstBandTop = orch ? PAD + ROOT_H + DISPATCH_GAP : PAD;
  const cursor = Array.from({ length: cols }, () => firstBandTop);

  /** Der Sub-Baum einer Lane: je Ebene eine Karte, eingerückt unter ihrem
   *  Parent, mit dem ganzen Zweig unter sich. `top` wächst über den Rekursions-
   *  rückgabewert, damit Geschwister nie überlappen. */
  const subNodes = (lane, parentNode, depth, column, band, x, y, w, placed) => {
    const { childOf, roots: tops } = subTree(lane);
    let top = y;
    const walk = (sub, parent, level, sx, sw) => {
      const id = `sub:${lane.id}:${sub.id}`;
      if (placed.has(id)) return;
      placed.add(id);
      const indent = Math.min(INDENT, Math.max(0, sw - MIN_CARD_W));
      const node = {
        id, laneId: lane.id, kind: "subagent", label: String(sub.title ?? sub.id ?? "Sub-Agent"),
        status: sub.ended != null ? "done" : "working", ticket: lane.ticket || null,
        terminal: null, depth: level, column, band, row: band,
        x: sx + indent, y: top, w: Math.max(MIN_CARD_W, sw - indent), h: cardH, narrow,
        started: sub.started ?? null, ended: sub.ended ?? null,
        parent: parent.id, ownsTicket: false, subtitle: null,
      };
      nodes.push(node);
      byId.set(id, node);
      top = node.y + node.h + SUB_GAP;
      for (const child of childOf.get(String(sub.id)) ?? []) walk(child, node, level + 1, node.x, node.w);
    };
    for (const sub of tops) walk(sub, parentNode, depth + 1, x, w);
    return top;
  };

  const place = (lane, depth, column, band, x, y, w) => {
    if (seen.has(lane.id)) return y;
    seen.add(lane.id);
    const node = laneNode(lane, depth, column, band, x, y, w);
    let below = y + node.h;
    // Ein Chip je Ticket, direkt unter der ersten sichtbaren Karte dieses Tickets.
    if (node.ticket && !claimedTicket.has(node.ticket)) {
      claimedTicket.add(node.ticket);
      node.ownsTicket = true;
      below += CHIP_GAP + TICKET_H;
    }
    let nextTop = below + SUB_GAP;
    nextTop = subNodes(lane, node, depth, column, band, x, nextTop, w, seen);
    for (const child of kids.get(lane.id) ?? []) {
      const childIndent = Math.min(depth * INDENT, Math.max(0, w - MIN_CARD_W));
      const childW = Math.max(MIN_CARD_W, w - childIndent);
      nextTop = place(child, depth + 1, column, band, x + childIndent, nextTop, childW) + SUB_GAP;
    }
    return Math.max(below, nextTop - SUB_GAP);
  };

  if (orch) {
    seen.add(orch.id);
    rootNode = laneNode(orch, 0, -1, 0, rootX, PAD, rootW);
    rootNode.subtitle = /:\s*(.+)$/.exec(label(orch))?.[1] ?? `verteilt ${directCount} Agent${directCount === 1 ? "" : "en"}`;
    if (rootNode.ticket && !claimedTicket.has(rootNode.ticket)) {
      claimedTicket.add(rootNode.ticket);
      rootNode.ownsTicket = true;
    }
    if (rootNode.ownsTicket) cursor.fill(PAD + ROOT_H + CHIP_GAP + TICKET_H + DISPATCH_GAP);
  }

  const columns = Array.from({ length: cols }, (_, col) => ({
    index: col, x: colX(col), w: cardW, root: null, nodes: [],
  }));

  direct.forEach((lane, i) => {
    const col = i % cols;
    const band = Math.floor(i / cols);
    const bottom = place(lane, 1, col, band, colCardX(col), cursor[col], cardW);
    cursor[col] = bottom + BAND_GAP;
    const owner = byId.get(`lane:${lane.id}`);
    if (columns[col] && !columns[col].root) columns[col].root = owner?.id ?? null;
  });
  // Was durch den Filter seine Wurzel verlor, wird selbst Wurzel (eigene Spalte).
  for (const lane of visible.slice().sort(order)) {
    if (seen.has(lane.id) || cols === 0) continue;
    const col = seen.size % cols;
    const band = Math.floor(seen.size / cols);
    const bottom = place(lane, 1, col, band, colCardX(col), cursor[col], cardW);
    cursor[col] = bottom + BAND_GAP;
  }
  for (const col of columns) col.nodes = nodes.filter((n) => n.column === col.index).map((n) => n.id);

  const chipById = new Map();

  // 3. Ticket-Chips direkt unter ihrer Karte, in derselben Spalte. Der Chip trägt
  // Kürzel und Triage-Maß; seine Breite folgt erst dem Text.
  for (const node of nodes) {
    if (!node.ownsTicket || !node.ticket) continue;
    const tk = byTicket.get(node.ticket);
    const size = sizeOf(tk);
    const chip = {
      id: `ticket:${node.ticket}`, ticket: node.ticket, node: node.id,
      column: node.column, status: tk?.status ?? null, size,
      label: shortId(node.ticket) + (size ? ` · ${size}` : ""),
      x: node.x + CHIP_INSET, y: node.y + node.h + CHIP_GAP,
      w: 52, h: TICKET_H, rounds: [],
    };
    ticketNodes.push(chip);
    chipById.set(chip.id, chip);
    byId.get(node.id).chip = chip.id;
  }

  for (const chip of ticketNodes) {
    // Innenabstand plus Status-Punkt und Lücke; 7 px je Zeichen T_XS.
    chip.w = Math.min(Math.max(58, 20 + chip.label.length * 7), Math.max(58, byId.get(chip.node).w - 2 * CHIP_INSET));
  }

  // 4. Baum-Kanten: Unterkante Parent → Oberkante Kind, orthogonal mit Knick.
  // Die Wurzel dispatcht über eine gemeinsame Bus-Zeile unter sich; tiefer
  // liegende Spalten laufen im Spaltengang neben den Karten nach unten.
  const bottomAnchorX = (node) => {
    const chip = node.chip ? chipById.get(node.chip) : null;
    if (!chip) return node.x + node.w / 2;
    return Math.min(node.x + node.w - 10, Math.max(node.x + 10, chip.x + chip.w + 6));
  };
  const busY = orch ? PAD + ROOT_H + 10 : 0;
  const firstInColumn = new Map();
  for (const node of nodes) {
    if (node.kind === "orchestrator") continue;
    const parent = node.parent ? byId.get(node.parent) : null;
    if (!parent) continue;
    const x1 = bottomAnchorX(parent), y1 = parent.y + parent.h;
    const x2 = node.x + node.w / 2, y2 = node.y;
    if (parent.kind === "orchestrator") {
      const col = node.column;
      if (!firstInColumn.has(col)) {
        firstInColumn.set(col, node.id);
        addEdge(edges, `e:${parent.id}->${node.id}`, "dispatch", parent.id, node.id,
          [[x1, y1], [x1, busY], [x2, busY], [x2, y2]],
          { faint: parent.status === "done" && node.status === "done" });
      } else {
        // Außen liegende Spalten führen ihre Leitung im Rand: dort läuft sie an
        // keiner Karte vorbei. Nur eine mittlere Spalte braucht den Gang.
        const railX = col === 0 ? 6 : col === cols - 1 ? avail - 6 : innerGapX(col, 0.5);
        // Je Spalte eine eigene Höhe: sonst verschmelzen die Querungen zweier
        // Nachbarspalten zu einer Linie, die durch die Karten zu laufen scheint.
        const topY = node.y - EDGE_LANE - (col % 2) * 6;
        addEdge(edges, `e:${parent.id}->${node.id}`, "dispatch", parent.id, node.id,
          [[x1, y1], [x1, busY], [railX, busY], [railX, topY], [x2, topY], [x2, y2]],
          { faint: parent.status === "done" && node.status === "done" });
      }
    } else {
      // Erst unter den Ticket-Chip des Parents, dann in einer eigenen Gasse
      // rechts neben den Kindkarten nach unten: so kreuzt die Kante keinen
      // älteren Sub-Agent, der in derselben Spalte darüber steht.
      const belowY = y1 + (parent.ownsTicket ? CHIP_GAP + TICKET_H : 0) + 4;
      const laneX = node.x + node.w + 6, laneY = node.y - 6;
      addEdge(edges, `e:${parent.id}->${node.id}`, "parent", parent.id, node.id,
        [[x1, y1], [x1, belowY], [laneX, belowY], [laneX, laneY], [x2, laneY], [x2, y2]],
        { faint: parent.status === "done" && node.status === "done" });
    }
  }

  // 5. Rückläufer: je Runde eine gestrichelte Kante vom Urteils-Knoten zurück
  // zum Ticket-Chip. Bevorzugt der Reviewer desselben Tickets, sonst die Karte,
  // die den Chip trägt. Die Leitung läuft außen an den Karten vorbei; je Runde
  // rückt sie ein Stück in den Spaltengang. Ein späteres `pass` färbt die
  // Pfeilspitze, die Kante bleibt gestrichelt.
  const roundsByTicket = feedbackRounds(visible, tickets);
  const reviewerNode = (id, terminal) => {
    const lanes = visible.filter((l) => l.ticket === id && byId.has(`lane:${l.id}`));
    const hit = lanes.find((l) => terminal && l.terminal === terminal)
      ?? lanes.find((l) => l.kind === "reviewer") ?? lanes[0];
    return hit ? byId.get(`lane:${hit.id}`) : null;
  };
  const topLane = (rootNode?.ownsTicket ? PAD + ROOT_H + CHIP_GAP + TICKET_H + 8 : PAD + ROOT_H + 8);
  const gapRight = (col) => innerGapX(col, 0.68);
  const railSide = (node) => (node.column < cols - 1
    ? colCardX(node.column) + cardW + 20 : colCardX(node.column) - 20);
  let roundCount = 0;
  for (const chip of ticketNodes) {
    const rounds = roundsByTicket.get(chip.ticket) ?? [];
    chip.rounds = rounds;
    roundCount += rounds.length;
    if (!rounds.length) continue;
    const owner = byId.get(chip.node);
    for (const round of rounds) {
      const verdictLane = round.lane ? byId.get(`lane:${round.lane}`) : null;
      const source = (verdictLane && verdictLane.kind !== "orchestrator" ? verdictLane : null)
        ?? reviewerNode(chip.ticket, round.terminal) ?? owner;
      if (!source) continue;
      const right = source.x + source.w / 2 <= chip.x + chip.w / 2;
      const sx = right ? source.x + source.w : source.x;
      const sy = source.y + source.h / 2;
      // Der Pfeil tritt auf der Seite in den Chip, auf der die Leitung läuft — nie
      // quer über den Chip-Text.
      const chipEdge = (railX) => (railX >= chip.x + chip.w / 2 ? chip.x + chip.w : chip.x);
      // Zwei Runden enden nicht im selben Punkt: je Runde ein paar Pixel versetzt,
      // innerhalb der Chip-Höhe, damit beide Pfeile sichtbar bleiben.
      const spread = rounds.length > 1 ? ((round.n - (rounds.length + 1) / 2) * 4) : 0;
      const ty = chip.y + chip.h / 2 + Math.max(-chip.h / 2 + 2, Math.min(chip.h / 2 - 2, spread));
      const out = ROUND_STEP * (round.n - 1);
      const points = [];
      let badge = null;
      if (source.kind === "orchestrator") {
        // Die Wurzel dispatcht über ihre Unterkante; die Rückläufer-Leitung läuft
        // unter der Wurzel entlang und dann im Spaltengang neben dem Chip hinab.
        const x1 = bottomAnchorX(source);
        const inX = owner.column < cols - 1 ? gapRight(owner.column) : innerGapX(owner.column, 0.32);
        // Unter der Wurzel verläuft die Leitung unter ihr; ohne Wurzel über der
        // ersten Kartenzeile, damit sie keine fremde Karte kreuzt.
        const laneY = orch ? topLane + out : Math.max(2, PAD - 4 - (rounds.length - round.n) * ROUND_STEP);
        const tx = chipEdge(inX);
        points.push([x1, source.y + source.h], [x1, laneY], [inX, laneY], [inX, ty], [tx, ty]);
        badge = [inX, laneY];
      } else if (source.column === chip.column) {
        const railX = railSide(owner) + (right ? out : -out);
        const tx = chipEdge(railX);
        points.push([sx, sy], [railX, sy], [railX, ty], [tx, ty]);
        badge = [railX, (sy + ty) / 2];
      } else if (Math.abs(source.column - owner.column) === 1) {
        const railX = (right ? gapRight(Math.min(source.column, owner.column)) : innerGapX(Math.min(source.column, owner.column), 0.32)) + (right ? out : -out);
        const tx = chipEdge(railX);
        points.push([sx, sy], [railX, sy], [railX, ty], [tx, ty]);
        badge = [railX, (sy + ty) / 2];
      } else {
        const outX = right ? gapRight(source.column) : innerGapX(source.column, 0.32);
        const inX = right ? innerGapX(owner.column, 0.32) : gapRight(owner.column);
        const laneY = topLane + out;
        const tx = chipEdge(inX);
        points.push([sx, sy], [outX, sy], [outX, laneY], [inX, laneY], [inX, ty], [tx, ty]);
        badge = [inX, laneY];
      }
      addEdge(edges, `f:${chip.ticket}:${round.n}`, "feedback", source.id, chip.id, points, {
        dashed: true, tone: "blocked", arrow: round.pass ? "success" : "blocked",
        tip: `Runde ${round.n}: fail → Nacharbeit`, badge,
      });
    }
  }

  // 6. Kantenmaß: Rechteck um alle Karten und Chips, mindestens die Panelbreite.
  let maxRight = 0, maxBottom = 0;
  for (const n of [...nodes, ...ticketNodes]) {
    maxRight = Math.max(maxRight, n.x + n.w);
    maxBottom = Math.max(maxBottom, n.y + n.h);
  }
  let rows = 0;
  for (const col of columns) rows = Math.max(rows, col.nodes.length);
  return {
    columns, nodes, ticketNodes, edges,
    width: nodes.length ? Math.max(avail, maxRight + PAD) : 0,
    height: nodes.length ? maxBottom + PAD : 0,
    rows, narrow, cardW, rounds: roundCount,
  };
}
