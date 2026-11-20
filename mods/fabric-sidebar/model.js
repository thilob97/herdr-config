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

/** Fabric-Terminal oder null. Orchestrator: Label `fab.role=orchestrator` oder
    Name `fab-orchestrator` (alt) bzw. `fab-<team>-orchestrator`. */
export function fabricEntry(terminal) {
  if (!terminal || typeof terminal !== "object") return null;
  const labels = terminal.labels && typeof terminal.labels === "object" ? terminal.labels : {};
  const name = String(terminal.name ?? "");
  const role = String(labels["fab.role"] ?? "");
  const orchestrator = role === "orchestrator"
    || name === "fab-orchestrator"
    || /^fab-.+-orchestrator$/.test(name);
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

/** Team aus dem Terminalnamen `fab-<team>-…`; der längste bekannte Name gewinnt. */
function teamFromName(name, known) {
  const value = String(name ?? "");
  if (!value.startsWith("fab-")) return null;
  let best = "";
  for (const team of known) {
    if (team.length > best.length && value.startsWith(`fab-${team}-`)) best = team;
  }
  return best || null;
}

/** Zeilen für die Seitenleiste, nach Team gruppiert; je Team der Orchestrator
    zuerst, Agenten darunter eingerückt.

    Team: Label `fab.team`, sonst vom Elternknoten, sonst aus dem Terminalnamen
    `fab-<team>-…`, sonst das Legacy-Team (erstes Team im Roster, sonst
    `"Fabric"`). Eltern sind, in dieser Reihenfolge: ein Fabric-Terminal aus
    `parent` (echte Subagenten, `hc run` ohne `--no-parent`), sonst der
    Orchestrator des Teams. Fabric startet Agenten mit `--no-parent`; sie stehen
    deshalb als Kinder ihres Team-Orchestrators. Subagenten tragen keine
    `fab.*`-Labels und werden über ihre `parent`-Kette aufgenommen. */
export function fabricRows(
  terminals = [], listed = [], tickets = [], roster = [], now = Date.now(), teams = [],
) {
  const statuses = new Map(
    (listed ?? []).filter(Boolean).map((agent) => [agent.address, agent.status]),
  );
  const titles = new Map(
    (tickets ?? []).filter((ticket) => ticket?.id).map((ticket) => [ticket.id, ticket.title ?? ""]),
  );
  const roles = new Map(
    (roster ?? []).filter((row) => row?.name).map((row) => [row.name, row.role ?? ""]),
  );

  const teamNames = (Array.isArray(teams) ? teams : [])
    .map((team) => String((typeof team === "string" ? team : team?.name) ?? "").trim())
    .filter(Boolean);
  const rosterTeams = (roster ?? [])
    .filter((row) => row && typeof row === "object")
    .flatMap((row) => (Array.isArray(row.teams) ? row.teams : []))
    .map((name) => String(name ?? "").trim())
    .filter(Boolean);
  const knownTeams = [...new Set([...teamNames, ...rosterTeams])];
  const legacyTeam = teamNames[0]
    || String(roster?.[0]?.teams?.[0] ?? "").trim()
    || "Fabric";

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

  const resolvedTeams = new Map();
  const resolving = new Set();
  const teamOf = (address) => {
    if (resolvedTeams.has(address)) return resolvedTeams.get(address);
    const item = included.get(address);
    if (!item) return legacyTeam;
    if (resolving.has(address)) return legacyTeam;
    resolving.add(address);
    const labels = item.terminal.labels && typeof item.terminal.labels === "object"
      ? item.terminal.labels
      : {};
    let team = String(labels["fab.team"] ?? "").trim();
    if (!team) {
      const parentAddress = typeof item.terminal.parent === "string" ? item.terminal.parent : "";
      if (parentAddress && included.has(parentAddress)) team = teamOf(parentAddress);
    }
    if (!team) team = teamFromName(item.terminal.name, knownTeams) ?? legacyTeam;
    resolving.delete(address);
    resolvedTeams.set(address, team);
    return team;
  };

  const nodes = [...included.entries()].map(([address, { terminal, entry }]) => ({
    ...entry,
    parent: typeof terminal.parent === "string" && terminal.parent ? terminal.parent : null,
    status: statuses.get(entry.address) ?? terminal.status ?? null,
    created: Number.isFinite(terminal.created_ms) ? terminal.created_ms : null,
    cost: costOf(terminal),
    team: teamOf(address),
  }));

  const grouped = new Map();
  for (const node of nodes) {
    if (!grouped.has(node.team)) grouped.set(node.team, []);
    grouped.get(node.team).push(node);
  }
  const orderedTeams = [];
  for (const name of teamNames) {
    if (grouped.has(name) && !orderedTeams.includes(name)) orderedTeams.push(name);
  }
  for (const name of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    if (!orderedTeams.includes(name)) orderedTeams.push(name);
  }

  const order = (a, b) => ticketNumber(a.ticket) - ticketNumber(b.ticket)
    || String(a.agent).localeCompare(String(b.agent))
    || a.address.localeCompare(b.address);

  const makeRow = (node, depth) => {
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
    return {
      ...node,
      depth,
      role: node.orchestrator ? "" : roles.get(node.agent) || "",
      title,
      meta,
      statusWord: status,
      runtime,
      costText: cost,
    };
  };

  const rows = [];
  const groups = [];
  let orchestrator = null;

  for (const name of orderedTeams) {
    const groupNodes = grouped.get(name) ?? [];
    if (groupNodes.length === 0) continue;
    const heads = groupNodes.filter((node) => node.orchestrator);
    // Das alte globale `fab-orchestrator` weicht dem Team-Orchestrator.
    const head = heads.find((node) => node.name !== "fab-orchestrator") ?? heads[0] ?? null;
    if (!orchestrator && head) orchestrator = head;

    const agents = groupNodes.filter((node) => !node.orchestrator);
    const known = new Set(agents.map((node) => node.address));
    const root = head?.address ?? null;
    const children = new Map();
    for (const node of agents) {
      const parent = node.parent && known.has(node.parent) && node.parent !== node.address
        ? node.parent
        : root;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(node);
    }
    for (const list of children.values()) list.sort(order);

    const groupRows = [];
    const push = (node, depth) => {
      groupRows.push(makeRow(node, depth));
      for (const child of children.get(node.address) ?? []) push(child, depth + 1);
    };
    if (head) {
      push(head, 0);
    } else {
      for (const node of children.get(null) ?? []) push(node, 0);
    }

    rows.push(...groupRows);
    groups.push({ name, orchestrator: head, rows: groupRows, count: groupRows.length });
  }

  return { orchestrator, rows, teams: groups };
}
