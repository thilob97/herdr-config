// Der Fabrik-Graph als Baum von oben nach unten: eine Spalte je Wurzel, Agents
// eingerückt unter ihrem Parent, Sub-Agents unter ihrem Agenten. Jede Agent-Karte
// trägt einen Ticket-Knoten (den Chip), `blocked_by` wird zum dünnen Bogen
// zwischen zwei sichtbaren Chips; fehlt der Blocker im Scope, sagt der Chip
// „wartet auf …“. Reine Rechnung ohne App-Module (`node --test`), Zeiten in
// Sekunden, `null` heißt unbekannt.

export const CARD_W = 208, CARD_H = 70, TICKET_H = 18;
export const TICKET_X = 10, TICKET_Y = 42;
export const PAD = 12, GAP_Y = 16, GAP_X = 32, INDENT = 16;
export const GUTTER = 12;

/** Der Bogen einer Kante läuft links an den Karten vorbei; nie aus dem Canvas. */
export const edgeGutter = (x) => Math.max(4, x - GUTTER);

// Ticket-Kurz-ID wie auf Board-Karte und Timeline: erstes sinnvolles Wort, die
// Zahl am Ende bleibt (zwei Tickets desselben Themas bleiben unterscheidbar).
const STOP = new Set(["und", "im", "in", "der", "die", "das", "ein", "eine", "zu", "mit", "fur", "für", "von", "the", "a", "an", "of"]);
export function shortId(id) {
  const raw = String(id ?? "");
  const num = /(\d+)$/.exec(raw)?.[1];
  const words = raw.split("-").filter((p) => p && !STOP.has(p));
  let s = (words[0] || raw).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  if (num && !s.endsWith(num)) s = `${s.slice(0, 6)}-${num}`;
  return s || "TICKET";
}

/** `blocked_by` ist eine Liste mit Komma/Leerzeichen oder schon ein Array. */
const splitList = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map((s) => String(s).trim()).filter(Boolean);

/** Ein Segment wie in `lanes.js`: Anfang, Kontrollpunkte, Ende, gestrichelt.
 *  Der Renderer baut daraus einen `paint_path`, der Test prüft dieselben Zahlen. */
export const edgeSegments = (e) => [e.x1, e.y1, e.c1x, e.c1y, e.c2x, e.c2y, e.x2, e.y2, e.dashed];

const isOrchestrator = (lane) => lane?.kind === "orchestrator" || lane?.orchestrator === true;
const statusOf = (lane) => (["working", "blocked", "done", "idle"].includes(lane?.status)
  ? lane.status : lane?.start != null && lane?.end == null ? "working" : "done");

/**
 * @param {{lanes?: Array, tickets?: Array, windowStart?: number|null, now?: number,
 *          filter?: "all"|"working"|"blocked"|"done"}} o
 *   lanes: normalisierte Lanes aus `hub timeline --json` (Sekunden; `parent` ist
 *   eine Lane-ID, `subagents[].started/ended` in Sekunden). tickets: bereits auf
 *   den Workspace gescopt (`ui.inScope`) — ein Blocker außerhalb fehlt hier und
 *   wird deshalb zum Chip statt zum Bogen.
 * @returns {{columns: Array, nodes: Array, ticketNodes: Array, edges: Array,
 *            width: number, height: number, rows: number}}
 */
export function layoutGraph({ lanes = [], tickets = [], windowStart = null, now = 0, filter = "all" } = {}) {
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
  // Parent gehört zur Fabrik dieses Orchestrators, nicht in eine eigene Spalte.
  // Nur wenn keiner läuft, sind Agents eigene Wurzeln (eine Spalte je Wurzel).
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

  const nodes = [], ticketNodes = [], edges = [];
  const byId = new Map();
  const seen = new Set();

  const laneNode = (lane, depth, column, row) => {
    const node = {
      id: `lane:${lane.id}`, laneId: lane.id,
      kind: isOrchestrator(lane) ? "orchestrator" : "agent",
      label: label(lane), status: statusOf(lane), ticket: lane.ticket || null,
      terminal: lane.terminal ?? null, depth, column, row,
      x: PAD + column * (CARD_W + GAP_X) + depth * INDENT, y: PAD + row * (CARD_H + GAP_Y),
      w: CARD_W - depth * INDENT, h: CARD_H,
      started: lane.start ?? null, ended: lane.end ?? null,
      parent: parentOf.has(lane.id) ? `lane:${parentOf.get(lane.id)}` : null, waits: [],
    };
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  // Sub-Agents hängen unter ihrem Agenten und tragen dessen Ticket (Text, kein
  // zweiter Ticket-Knoten: sonst gäbe es zwei Chips je Ticket und doppelte Bögen).
  const subVisible = (sub) => {
    const ended = sub?.ended ?? null, started = sub?.started ?? null;
    const status = ended != null ? "done" : "working";
    if (filter !== "all" && status !== filter) return false;
    if (windowStart == null || started == null) return true;
    return !((ended ?? now) < windowStart || started > now);
  };

  const walk = (lane, depth, column) => {
    if (seen.has(lane.id)) return;
    seen.add(lane.id);
    const node = laneNode(lane, depth, column, nodes.length);
    for (const sub of lane.subagents ?? []) {
      if (!subVisible(sub)) continue;
      const id = `sub:${lane.id}:${sub.id}`;
      if (byId.has(id)) continue;
      const sn = {
        id, laneId: lane.id, kind: "subagent", label: String(sub.title ?? sub.id ?? "Sub-Agent"),
        status: sub.ended != null ? "done" : "working", ticket: lane.ticket || null,
        terminal: null, depth: depth + 1, column, row: nodes.length,
        x: PAD + column * (CARD_W + GAP_X) + (depth + 1) * INDENT, y: PAD + nodes.length * (CARD_H + GAP_Y),
        w: CARD_W - (depth + 1) * INDENT, h: CARD_H,
        started: sub.started ?? null, ended: sub.ended ?? null,
        parent: node.id, waits: [],
      };
      nodes.push(sn);
      byId.set(id, sn);
    }
    for (const child of kids.get(lane.id) ?? []) walk(child, depth + 1, column);
  };

  // 2. Eine Spalte je Wurzel; was durch einen Filter seine Wurzel verlor, wird
  // selbst Wurzel (eigene Spalte) statt zu verschwinden.
  const columns = [];
  const addColumn = (lane) => {
    if (seen.has(lane.id)) return;
    const rootNode = `lane:${lane.id}`;
    const from = nodes.length;
    walk(lane, 0, columns.length);
    columns.push({ index: columns.length, root: rootNode, nodes: nodes.slice(from).map((n) => n.id) });
  };
  for (const root of roots) addColumn(root);
  for (const lane of visible.slice().sort(order)) addColumn(lane);

  // 3. Pfeile des Baums: Dispatch aus dem Orchestrator, sonst Parent-Kante. Der
  // Bogen läuft links an den Karten vorbei (Gutter) statt quer durch sie: bei
  // einer Spalte liegt zwischen Parent und fernem Kind die halbe Kolonne.
  for (const node of nodes) {
    const parent = node.parent ? byId.get(node.parent) : null;
    if (!parent) continue;
    const x1 = parent.x, y1 = parent.y + parent.h - 4;
    const x2 = node.x, y2 = node.y + node.h / 2;
    const gx = edgeGutter(parent.x);
    edges.push({
      id: `e:${parent.id}->${node.id}`, kind: parent.kind === "orchestrator" ? "dispatch" : "parent",
      from: parent.id, to: node.id, dashed: false,
      x1, y1, c1x: gx, c1y: y1, c2x: gx, c2y: y2, x2, y2,
    });
  }

  // 4. Ticket-Knoten: ein Chip je Ticket, im ersten sichtbaren Agenten. Die
  // Breite folgt erst dem Text (Chip bei fehlendem Blocker länger).
  const chipByTicket = new Map();
  for (const node of nodes) {
    if (node.kind !== "agent" || !node.ticket || chipByTicket.has(node.ticket)) continue;
    const chip = {
      id: `ticket:${node.ticket}`, ticket: node.ticket, node: node.id,
      label: shortId(node.ticket), x: node.x + TICKET_X, y: node.y + TICKET_Y,
      w: 46, h: TICKET_H, waits: [],
    };
    chipByTicket.set(node.ticket, chip);
    ticketNodes.push(chip);
  }

  const ticketStatus = (id) => byTicket.get(id)?.status ?? null;
  const blockers = (id) => splitList(byTicket.get(id)?.blocked_by);

  // 5a. Fehlende Blocker werden zum Chip-Text (ein erledigter Blocker wartet
  // nicht mehr). Erst danach stehen die Chipbreiten fest — die Bögen hängen an
  // den Kanten der Chips.
  for (const chip of ticketNodes) {
    for (const b of blockers(chip.ticket)) {
      if (b === chip.ticket || chipByTicket.get(b)) continue;
      if (ticketStatus(b) !== "done" && !chip.waits.some((w) => w.id === b)) {
        const wait = { id: b, short: shortId(b) };
        chip.waits.push(wait);
        byId.get(chip.node)?.waits.push(wait);
      }
    }
  }
  for (const chip of ticketNodes) {
    if (chip.waits.length) chip.label = `wartet auf ${chip.waits.map((w) => w.short).join(", ")}`;
    // Innenabstand 6+6 plus die Status-Punkt-Lücke, 8 px je Zeichen (T_XS 10.5
    // läuft breiter als 6.6): der Text darf nicht im Kürzel abbrechen
    // („DEMO…“ statt „DEMO-1“, „wartet auf DEMO-1“ statt „wartet auf DEMO…“).
    chip.w = Math.max(52, Math.ceil(14 + chip.label.length * 8));
  }

  // 5b. blocked_by: Bogen nur zwischen zwei sichtbaren Chips. Gestrichelt, wenn
  // der Blocker erledigt ist.
  for (const chip of ticketNodes) {
    for (const b of blockers(chip.ticket)) {
      if (b === chip.ticket) continue;
      const from = chipByTicket.get(b);
      if (!from) continue;
      if (edges.some((e) => e.kind === "ticket" && e.from === from.id && e.to === chip.id)) continue;
      // Der Chip sitzt in der Karte, also zielt der Bogen auf deren linke Kante in
      // Höhe des Chips: so ist er (anders als hinter der Karte) ganz sichtbar.
      // Eigener Gutter links vom Baum-Gutter, damit sich beide nicht überdecken.
      const a = byId.get(from.node), z = byId.get(chip.node);
      const x1 = a.x, y1 = a.y + TICKET_Y + TICKET_H / 2;
      const x2 = z.x, y2 = z.y + TICKET_Y + TICKET_H / 2;
      const bow = Math.max(2, Math.min(x1, x2) - 2 * GUTTER);
      edges.push({
        id: `t:${from.ticket}->${chip.ticket}`, kind: "ticket",
        from: from.id, to: chip.id, dashed: ticketStatus(b) === "done",
        x1, y1, c1x: bow, c1y: y1, c2x: bow, c2y: y2, x2, y2,
      });
    }
  }

  // 6. Kantenmaß: das Rechteck, das alle Karten und Chips umschließt.
  let width = 0, height = 0, rows = 0;
  for (const n of [...nodes, ...ticketNodes]) {
    width = Math.max(width, n.x + n.w);
    height = Math.max(height, n.y + n.h);
  }
  for (const c of columns) rows = Math.max(rows, c.nodes.length);
  return {
    columns, nodes, ticketNodes, edges,
    width: nodes.length ? width + PAD : 0,
    height: nodes.length ? height + PAD : 0,
    rows,
  };
}
