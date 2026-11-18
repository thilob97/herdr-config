// Reine Logik der Fabric-Seitenleiste: welche Terminals zu Fabric gehören, wie
// sie heißen und was Status, Rolle und Laufzeit sagen. Keine herdr-/gpui-Importe,
// damit die Regeln ohne Fenster testbar bleiben.

export const STATUS_WORDS = {
  working: "arbeitet",
  blocked: "wartet",
  done: "fertig",
  idle: "bereit",
  error: "Fehler",
};

export function statusWord(status) {
  return STATUS_WORDS[status] ?? (status ? String(status) : "unbekannt");
}

/** `fab-zap-t-12` → `T-12`; nur der Rückfall, wenn das Label `fab.ticket` fehlt. */
export function ticketFromName(name) {
  const match = /^fab-(.+?)-(t-\d+)$/i.exec(String(name ?? ""));
  return match ? match[2].toUpperCase() : null;
}

/** Fabric-Terminal oder null. Orchestrator: Label `fab.role=orchestrator` oder Name. */
export function fabricEntry(terminal) {
  if (!terminal || typeof terminal !== "object") return null;
  const labels = terminal.labels && typeof terminal.labels === "object" ? terminal.labels : {};
  const name = String(terminal.name ?? "");
  const role = String(labels["fab.role"] ?? "");
  const orchestrator = role === "orchestrator" || name === "fab-orchestrator";
  const agent = labels["fab.agent"] ? String(labels["fab.agent"]) : "";
  const rawTicket = labels["fab.ticket"] ? String(labels["fab.ticket"]) : ticketFromName(name);
  if (!orchestrator && !agent) return null;
  return {
    address: String(terminal.address ?? name),
    name,
    agent: orchestrator ? "orchestrator" : agent,
    ticket: rawTicket ? rawTicket.toUpperCase() : null,
    orchestrator,
  };
}

/** Kosten nur, wenn Herdr sie für das Terminal meldet (heute: nicht). */
export function costOf(terminal) {
  for (const key of ["cost_usd", "cost", "spend_usd", "spend"]) {
    const value = terminal?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function costText(value) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "";
}

/** Laufzeit seit dem Start; leer, wenn Herdr keinen Startzeitpunkt liefert. */
export function runtimeText(created, now) {
  if (!Number.isFinite(created) || !Number.isFinite(now) || now < created) return "";
  const minutes = Math.floor((now - created) / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ticketNumber(ticket) {
  const match = /^T-(\d+)$/.exec(String(ticket ?? ""));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** Kind eines Fabric-Terminals ohne eigene Labels: `hc run`-Subagenten tragen nur
    `parent`. Name und Ticket erben vom Elternagenten, der Name des Terminals
    bleibt sichtbar. */
function inheritedEntry(terminal, parent, address) {
  const name = String(terminal.name ?? "");
  return {
    address,
    name,
    agent: name || `${parent.agent}+`,
    ticket: parent.ticket,
    orchestrator: false,
    inherited: true,
  };
}

/** Zeilen für die Seitenleiste: Orchestrator zuerst, Agenten darunter eingerückt.

    Eltern sind, in dieser Reihenfolge: ein Fabric-Terminal aus `parent` (echte
    Subagenten, `hc run` ohne `--no-parent`), sonst der Orchestrator. Fabric
    startet Agenten mit `--no-parent`; sie stehen deshalb als Kinder des
    Orchestrators, nicht als dessen Geschwister. Subagenten tragen keine
    `fab.*`-Labels und werden über ihre `parent`-Kette aufgenommen. */
export function fabricRows(terminals = [], listed = [], tickets = [], roster = [], now = Date.now()) {
  const statuses = new Map(
    (listed ?? []).filter(Boolean).map((agent) => [agent.address, agent.status]),
  );
  const titles = new Map(
    (tickets ?? []).filter((ticket) => ticket?.id).map((ticket) => [ticket.id, ticket.title ?? ""]),
  );
  const roles = new Map(
    (roster ?? []).filter((row) => row?.name).map((row) => [row.name, row.role ?? ""]),
  );

  const live = (terminals ?? [])
    .filter((terminal) => terminal && (terminal.state === undefined || terminal.state === "live"));
  const included = new Map();
  for (const terminal of live) {
    const entry = fabricEntry(terminal);
    if (entry) included.set(entry.address, { terminal, entry });
  }
  // Bis alle Nachfahren bekannter Fabric-Terminals eingesammelt sind; ein
  // Subagent kann wiederum Subagenten haben.
  for (let changed = true; changed;) {
    changed = false;
    for (const terminal of live) {
      const address = String(terminal.address ?? terminal.name);
      if (included.has(address)) continue;
      const parentAddress = typeof terminal.parent === "string" ? terminal.parent : "";
      const parent = parentAddress ? included.get(parentAddress) : null;
      if (!parent) continue;
      included.set(address, { terminal, entry: inheritedEntry(terminal, parent.entry, address) });
      changed = true;
    }
  }

  const nodes = [...included.values()].map(({ terminal, entry }) => ({
    ...entry,
    parent: typeof terminal.parent === "string" && terminal.parent ? terminal.parent : null,
    status: statuses.get(entry.address) ?? terminal.status ?? null,
    created: Number.isFinite(terminal.created_ms) ? terminal.created_ms : null,
    cost: costOf(terminal),
  }));

  const orchestrator = nodes.find((node) => node.orchestrator) ?? null;
  const agents = nodes.filter((node) => !node.orchestrator);
  const known = new Set(agents.map((node) => node.address));
  const root = orchestrator?.address ?? null;

  const children = new Map();
  for (const node of agents) {
    const parent = node.parent && known.has(node.parent) && node.parent !== node.address
      ? node.parent
      : root;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  const order = (a, b) => ticketNumber(a.ticket) - ticketNumber(b.ticket)
    || String(a.agent).localeCompare(String(b.agent))
    || a.address.localeCompare(b.address);
  for (const list of children.values()) list.sort(order);

  const rows = [];
  const push = (node, depth) => {
    const runtime = runtimeText(node.created, now);
    const cost = costText(node.cost);
    const status = node.status ? statusWord(node.status) : "";
    const title = node.orchestrator
      ? "Orchestrator"
      : node.ticket
        ? `${node.agent} · ${titles.get(node.ticket) ? `${node.ticket} ${titles.get(node.ticket)}` : node.ticket}`
        : node.agent;
    const meta = [
      node.orchestrator ? "" : roles.get(node.agent) || "",
      status,
      runtime,
      cost,
    ].filter(Boolean).join(" · ");
    rows.push({
      ...node,
      depth,
      role: node.orchestrator ? "" : roles.get(node.agent) || "",
      title,
      meta,
      statusWord: status,
      runtime,
      costText: cost,
    });
    for (const child of children.get(node.address) ?? []) push(child, depth + 1);
  };

  if (orchestrator) {
    push(orchestrator, 0);
  } else {
    for (const node of children.get(null) ?? []) push(node, 0);
  }

  return { orchestrator, rows };
}
