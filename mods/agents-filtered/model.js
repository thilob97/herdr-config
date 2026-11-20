// Reine Auswahl-Logik der normalen Agentenliste im Layout „fabric“: alles, was
// fab gestartet hat (Orchestrator, Ticket-Agenten, deren Subagenten), bleibt
// draußen. Die Fabric-Seitenleiste (mods/fabric-sidebar) zeigt diese Agenten.
// Keine herdr-Importe, damit die Regeln ohne Fenster testbar bleiben.

/** Fab-Terminal? Erkennungsmerkmale aus fabric/fablib/agents.py: Labels
    `fab.agent`/`fab.role`, sonst der von `hc.terminal_name` vergebene Name
    `fab-*` (Orchestrator: `fab-orchestrator` = hc.ORCHESTRATOR). */
export function fabricTerminal(terminal) {
  if (!terminal || typeof terminal !== "object") return false;
  const labels = terminal.labels && typeof terminal.labels === "object" ? terminal.labels : {};
  const agent = String(labels["fab.agent"] ?? "");
  const role = String(labels["fab.role"] ?? "");
  if (agent || role) return true;
  return /^fab-/i.test(String(terminal.name ?? ""));
}

/** Adressen aller Fab-Terminals samt Nachfahren. `hc run`-Subagenten tragen
    keine `fab.*`-Labels; sie hängen nur über `parent` am Elternagenten. */
export function fabricAddresses(terminals = []) {
  const parents = new Map();
  const found = new Set();
  for (const terminal of terminals ?? []) {
    if (!terminal || typeof terminal !== "object") continue;
    const address = String(terminal.address ?? terminal.name ?? "");
    if (!address) continue;
    parents.set(
      address,
      typeof terminal.parent === "string" && terminal.parent ? terminal.parent : null,
    );
    if (fabricTerminal(terminal)) found.add(address);
  }
  // Bis alle Nachfahren gefunden sind; ein Subagent kann wieder Subagenten haben.
  for (let changed = true; changed;) {
    changed = false;
    for (const [address, parent] of parents) {
      if (found.has(address) || !parent || !found.has(parent)) continue;
      found.add(address);
      changed = true;
    }
  }
  return found;
}

/** Agentenliste ohne Fab-Terminals und ohne deren Nachfahren. */
export function visibleAgents(list = [], terminals = []) {
  const hidden = fabricAddresses(terminals);
  if (hidden.size === 0) return [...(list ?? [])];
  return (list ?? []).filter((agent) => !hidden.has(String(agent?.address ?? "")));
}

/** Terminalliste ohne Fab-Terminals und ohne deren Nachfahren (für Bäume). */
export function visibleTerminals(terminals = []) {
  const hidden = fabricAddresses(terminals);
  if (hidden.size === 0) return [...(terminals ?? [])];
  return (terminals ?? []).filter(
    (terminal) => !hidden.has(String(terminal?.address ?? terminal?.name ?? "")),
  );
}
