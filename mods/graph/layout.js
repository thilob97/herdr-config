// Der Fabrik-Graph als Baum von oben nach unten: der Orchestrator ist die Wurzel
// oben mittig, jeder Agent bekommt eine Spalte über die Panelbreite, Sub-Agents
// hängen eingerückt unter ihrem Parent. Jede Agent-Karte ist kompakt (Avatar,
// Name, Status), ihr Ticket-Chip sitzt als eigene Zeile direkt darunter.
// `blocked_by` wird zum Pfeil zwischen zwei sichtbaren Ticket-Chips; fehlt der
// Blocker im Scope, sagt der Chip „wartet auf …“. Reine Rechnung ohne
// App-Module (`node --test`), Zeiten in Sekunden, `null` heißt unbekannt.

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
export const GAP_X = 40;         // breiter Gang: Platz für Leitungen neben den Karten
export const BAND_GAP = 30;       // zwischen zwei Agenten derselben Spalte
export const SUB_GAP = 10;
export const DISPATCH_GAP = 26;   // Wurzel-Unterkante bis erste Agentenzeile
export const MIN_COLS = 2;
export const NARROW_W = 520;      // darunter schmalere Karten (eine Zeile bleibt)
const MIN_CARD_W = 96;
const EDGE_LANE = 10;             // Abstand einer Kante zur Kartenkante

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

/** `blocked_by` ist eine Liste mit Komma/Leerzeichen oder schon ein Array. */
const splitList = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map((s) => String(s).trim()).filter(Boolean);

const isOrchestrator = (lane) => lane?.kind === "orchestrator" || lane?.orchestrator === true;
const statusOf = (lane) => (["working", "blocked", "done", "idle"].includes(lane?.status)
  ? lane.status : lane?.start != null && lane?.end == null ? "working" : "done");

/** Ein Kantenzug: Anfang, Knickpunkte, Ende. Der Renderer rundet die Ecken und
 *  setzt die Pfeilspitze in Richtung des letzten Segments. */
const addEdge = (edges, id, kind, from, to, points, { dashed = false, faint = false } = {}) => {
  const clean = [];
  for (const p of points) {
    const prev = clean[clean.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < 0.5 && Math.abs(prev[1] - p[1]) < 0.5) continue;
    clean.push(p);
  }
  edges.push({ id, kind, from, to, points: clean, dashed, faint });
};

/**
 * @param {{lanes?: Array, tickets?: Array, windowStart?: number|null, now?: number,
 *          filter?: "all"|"working"|"blocked"|"done", width?: number}} o
 *   lanes: normalisierte Lanes aus `hub timeline --json` (Sekunden; `parent` ist
 *   eine Lane-ID, `subagents[].started/ended` in Sekunden). tickets: bereits auf
 *   den Workspace gescopt (`ui.inScope`) — ein Blocker außerhalb fehlt hier und
 *   wird deshalb zum Chip statt zum Pfeil. width: verfügbare Panelbreite in
 *   Layout-Einheiten (vor dem Zoom), damit die Spalten über die Breite verteilt
 *   werden.
 * @returns {{columns: Array, nodes: Array, ticketNodes: Array, edges: Array,
 *            width: number, height: number, rows: number, narrow: boolean,
 *            cardW: number}}
 */
export function layoutGraph({ lanes = [], tickets = [], windowStart = null, now = 0, filter = "all", width = 760 } = {}) {
  const byTicket = new Map();
  for (const tk of tickets ?? []) if (tk?.id && !byTicket.has(tk.id)) byTicket.set(tk.id, tk);

  // 1. Zeitfenster und Statusfilter. Der Orchestrator bleibt als Wurzel stehen:
  // ohne ihn hinge der Baum in der Luft.
  const visible = [];
  for (const lane of lanes ?? []) {
    if (!lane?.id) continue;
    if (windowStart != null) {
      if (lane.start == null) {
        // Ohne Start (hc liefert für Demo-Terminals kein created_ms) zählt das
        // Ereignis im Fenster — oder der laufende Status: der Agent arbeitet jetzt.
        const hit = statusOf(lane) === "working"
          || (lane.events ?? []).some((e) => e?.at != null && e.at >= windowStart && e.at <= now);
        if (!hit) continue;
      } else {
        const end = lane.end ?? (statusOf(lane) === "done" ? lane.start : now);
        if (lane.start > now || end < windowStart) continue;
      }
    }
    if (filter !== "all" && statusOf(lane) !== filter && !isOrchestrator(lane)) continue;
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

  const laneNode = (lane, depth, column, band, x, y, w) => {
    const node = {
      id: `lane:${lane.id}`, laneId: lane.id,
      kind: isOrchestrator(lane) ? "orchestrator"
        : lane.kind === "sub-orchestrator" ? "sub-orchestrator" : "agent",
      label: label(lane), status: statusOf(lane), ticket: lane.ticket || null,
      terminal: lane.terminal ?? null, depth, column, band, row: band,
      x, y, w, h: nodeH(lane), narrow,
      started: lane.start ?? null, ended: lane.end ?? null,
      parent: parentOf.has(lane.id) ? `lane:${parentOf.get(lane.id)}` : null, waits: [],
      subtitle: null, ownsTicket: false,
    };
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  const nodeH = (lane) => (isOrchestrator(lane) ? ROOT_H : cardH);

  const subVisible = (sub) => {
    const ended = sub?.ended ?? null, started = sub?.started ?? null;
    const status = ended != null ? "done" : "working";
    if (filter !== "all" && status !== filter) return false;
    if (windowStart == null || started == null) return true;
    return !((ended ?? now) < windowStart || started > now);
  };

  const rootW = Math.min(ROOT_W_MAX, contentW);
  const rootX = PAD + (contentW - rootW) / 2;
  let rootNode = null;

  // 2. Die Wurzel mittig, dann je Agent eine Spalte. Innerhalb der Spalte stehen
  // Karte, Ticket-Chip und der ganze Sub-Baum untereinander.
  const colX = (col) => PAD + col * (slotW + GAP_X);
  const colCardX = (col) => colX(col) + Math.max(0, (slotW - cardW) / 2);
  // Leitungen im Spaltengang: dispatch nah an der eigenen Spalte, Ticket-Kanten
  // weiter hinten, damit sich beide nie überdecken.
  const innerGapX = (col, frac) => (col < cols - 1
    ? colCardX(col) + cardW + GAP_X * frac : colCardX(col) - GAP_X * frac);
  const firstBandTop = orch ? PAD + ROOT_H + DISPATCH_GAP : PAD;
  const cursor = Array.from({ length: cols }, () => firstBandTop);

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
    const children = [];
    for (const sub of lane.subagents ?? []) {
      if (!subVisible(sub)) continue;
      const id = `sub:${lane.id}:${sub.id}`;
      if (byId.has(id)) continue;
      children.push({ sub, id });
    }
    for (const { sub, id } of children) {
      const childIndent = Math.min((depth) * INDENT, Math.max(0, w - MIN_CARD_W));
      const sn = {
        id, laneId: lane.id, kind: "subagent", label: String(sub.title ?? sub.id ?? "Sub-Agent"),
        status: sub.ended != null ? "done" : "working", ticket: lane.ticket || null,
        terminal: null, depth: depth + 1, column, band, row: band,
        x: x + childIndent, y: nextTop, w: Math.max(MIN_CARD_W, w - childIndent), h: cardH, narrow,
        started: sub.started ?? null, ended: sub.ended ?? null,
        parent: node.id, waits: [], subtitle: null, ownsTicket: false,
      };
      nodes.push(sn);
      byId.set(id, sn);
      if (sn.ticket && !claimedTicket.has(sn.ticket)) {
        claimedTicket.add(sn.ticket);
        sn.ownsTicket = true;
      }
      nextTop = sn.y + sn.h + (sn.ownsTicket ? CHIP_GAP + TICKET_H : 0) + SUB_GAP;
    }
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

  // 3. Ticket-Chips direkt unter ihrer Karte, in derselben Spalte. Der Chip ist
  // der Knoten der blocked_by-Pfeile; seine Breite folgt erst dem Text.
  for (const node of nodes) {
    if (!node.ownsTicket || !node.ticket) continue;
    const chip = {
      id: `ticket:${node.ticket}`, ticket: node.ticket, node: node.id,
      column: node.column, status: byTicket.get(node.ticket)?.status ?? null,
      label: shortId(node.ticket), x: node.x + CHIP_INSET, y: node.y + node.h + CHIP_GAP,
      w: 52, h: TICKET_H, waits: [], labelW: 0,
    };
    ticketNodes.push(chip);
    chipById.set(chip.id, chip);
    byId.get(node.id).chip = chip.id;
  }
  const chipByTicket = new Map(ticketNodes.map((c) => [c.ticket, c]));

  const ticketStatus = (id) => byTicket.get(id)?.status ?? null;
  const blockers = (id) => splitList(byTicket.get(id)?.blocked_by);

  // 4a. Fehlende Blocker werden zum Chip-Text (ein erledigter Blocker wartet
  // nicht mehr). Erst danach stehen die Chipbreiten fest.
  for (const chip of ticketNodes) {
    for (const b of blockers(chip.ticket)) {
      if (b === chip.ticket || chipByTicket.get(b)) continue;
      if (ticketStatus(b) !== "done" && !chip.waits.some((w) => w.id === b)) {
        chip.waits.push({ id: b, short: shortId(b) });
        byId.get(chip.node)?.waits.push(chip.waits[chip.waits.length - 1]);
      }
    }
  }
  for (const chip of ticketNodes) {
    if (chip.waits.length) chip.label = `wartet auf ${chip.waits.map((w) => w.short).join(", ")}`;
    // Innenabstand plus Status-Punkt und Lücke; 7 px je Zeichen T_XS.
    chip.w = Math.min(Math.max(58, 20 + chip.label.length * 7), Math.max(58, byId.get(chip.node).w - 2 * CHIP_INSET));
  }

  // 5. Baum-Kanten: Unterkante Parent → Oberkante Kind, orthogonal mit Knick.
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

  // 6. blocked_by: Pfeil vom wartenden Ticket-Chip zum Blocker-Chip. Zwischen
  // benachbarten Spalten durch den Spaltengang, in derselben Spalte seitlich um
  // die Karte, weiter weg oben herum. Gestrichelt nur eine erledigte Abhängigkeit.
  const topLane = orch ? PAD + ROOT_H + 8 : PAD + 8;
  const gapRight = (col) => innerGapX(col, 0.68);
  const gapLeft = (col) => colCardX(col) - GAP_X * 0.68;
  // Gleiche Spalte: 20 px neben der Karte im Spaltengang, nie am Panelrand und
  // nie in der Nähe der Kartenkante (dort sähe die Leitung wie ein Durchlauf aus).
  const ticketSide = (node) => (node.column < cols - 1
    ? colCardX(node.column) + cardW + 20 : colCardX(node.column) - 20);
  for (const chip of ticketNodes) {
    for (const b of blockers(chip.ticket)) {
      if (b === chip.ticket) continue;
      const target = chipByTicket.get(b);
      if (!target) continue;
      if (edges.some((e) => e.kind === "ticket" && e.from === chip.id && e.to === target.id)) continue;
      const a = byId.get(chip.node), z = byId.get(target.node);
      const right = z.x > a.x;
      const sx = right ? chip.x + chip.w : chip.x;
      const tx = right ? target.x : target.x + target.w;
      const sy = chip.y + chip.h / 2, ty = target.y + target.h / 2;
      const points = [];
      if (a.column === z.column) {
        // Gleiche Spalte: im Spaltengang neben der Kolonne vorbei, nicht am Rand
        // und nie quer durch eine Karte.
        const sideX = ticketSide(a);
        points.push([sx, sy], [sideX, sy], [sideX, ty], [tx, ty]);
      } else if (Math.abs(a.column - z.column) === 1) {
        const gapX = right ? gapRight(a.column) : gapLeft(a.column);
        points.push([sx, sy], [gapX, sy], [gapX, ty], [tx, ty]);
      } else {
        const outX = right ? gapRight(a.column) : gapLeft(a.column);
        const inX = right ? gapLeft(z.column) : gapRight(z.column);
        points.push([sx, sy], [outX, sy], [outX, topLane], [inX, topLane], [inX, ty], [tx, ty]);
      }
      const doneA = ticketStatus(chip.ticket) === "done", doneB = ticketStatus(b) === "done";
      addEdge(edges, `t:${chip.ticket}->${target.ticket}`, "ticket", chip.id, target.id, points,
        { dashed: doneB, faint: doneA && doneB });
    }
  }

  // 7. Kantenmaß: Rechteck um alle Karten und Chips, mindestens die Panelbreite.
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
    rows, narrow, cardW,
  };
}
