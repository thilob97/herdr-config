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

const ROLE_WORDS = {
  umsetzer: "Umsetzer",
  pruefer: "Prüferin / Prüfer",
  orchestrator: "Orchestrator",
  mensch: "Mensch",
};

/** Rollenbezeichnung aus der Begriffstabelle; Unbekanntes bleibt unverändert. */
export function roleLabel(role) {
  if (!role) return "";
  return ROLE_WORDS[role] ?? String(role);
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
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} T`;
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
    const role = node.orchestrator ? "" : roleLabel(roles.get(node.agent) || "");
    const title = node.orchestrator
      ? "Orchestrator"
      : node.ticket
        ? `${node.agent} · ${titles.get(node.ticket) ? `${node.ticket} ${titles.get(node.ticket)}` : node.ticket}`
        : node.agent;
    const meta = [
      role,
      status,
      runtime,
      cost,
    ].filter(Boolean).join(" · ");
    return {
      ...node,
      depth,
      role,
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

// --- Freie Agenten ohne Fabric-Team -----------------------------------------
// Eigener Agenten-Abschnitt: Terminals, deren Programm einen Status meldet
// (OSC 7501) und die weder ein `fab.*`-Label noch einen `fab-…`-Namen tragen
// und auch nicht über `parent` an einem Fabric-Terminal hängen. Der
// Space-Orchestrator wird über `hub.role` oder den Namen `orchestrator` erkannt.

export const FREE_STATUS_WORDS = {
  working: "arbeitet",
  blocked: "wartet",
  done: "fertig",
  idle: "bereit",
  error: "Fehler",
};

export const FREE_SPRITES = ["agent-a", "agent-b"];

export function freeStatusWord(status) {
  return FREE_STATUS_WORDS[status] ?? (status ? String(status) : "bereit");
}

export function busyLabel(busy) {
  return `${Number(busy) || 0} aktiv`;
}

/** Eck-Symbol oben rechts; `z` schläft, `note` ist fertig, `clock` wartet. */
export function freeCornerIcon(status) {
  switch (status) {
    case "idle": return "zzz";
    case "done": return "note";
    case "working": return "play";
    case "blocked": return "clock";
    case "error": return "alert";
    default: return "dot";
  }
}

/** Orchestrator-Motiv für den Space-Orchestrator, sonst abwechselnd eines der
    beiden Agenten-Motive; `index` zählt die Agenten einer Gruppe durch. */
export function freeSpriteKey(entry, index = 0) {
  if (entry?.orchestrator) return "orchestrator";
  return FREE_SPRITES[Math.abs(Number(index) || 0) % FREE_SPRITES.length] ?? FREE_SPRITES[0];
}

/** Einzeilige Aufgabe; lange Titel werden an der Wortgrenze gekürzt. */
export function truncateTask(text, max = 42) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function labelsOf(terminal) {
  return terminal?.labels && typeof terminal.labels === "object" ? terminal.labels : {};
}

function addressOf(terminal) {
  return String(terminal?.address ?? terminal?.name ?? "");
}

/** Fabric-Terminal samt Nachfahren über `parent`; dieselbe Abgrenzung wie in
    `mods/agents-filtered` und `fabricRows`. */
export function fabricAddresses(terminals = []) {
  const direct = new Set();
  for (const terminal of terminals ?? []) {
    if (!terminal || typeof terminal !== "object") continue;
    const labels = labelsOf(terminal);
    const name = String(terminal.name ?? "");
    if (labels["fab.agent"] || labels["fab.role"] || /^fab-/i.test(name)) {
      direct.add(addressOf(terminal));
    }
  }
  const hidden = new Set(direct);
  for (let changed = true; changed;) {
    changed = false;
    for (const terminal of terminals ?? []) {
      if (!terminal || typeof terminal !== "object") continue;
      const address = addressOf(terminal);
      if (!address || hidden.has(address)) continue;
      const parent = typeof terminal.parent === "string" ? terminal.parent : "";
      if (parent && hidden.has(parent)) {
        hidden.add(address);
        changed = true;
      }
    }
  }
  return hidden;
}

/** Der Herdr-Space-Orchestrator: `hub.role=orchestrator` oder Name `orchestrator`. */
export function freeOrchestrator(terminal) {
  const labels = labelsOf(terminal);
  const role = String(labels["hub.role"] ?? "").trim().toLowerCase();
  const name = String(terminal?.name ?? "").trim().toLowerCase();
  return role === "orchestrator" || role === "space-orchestrator" || name === "orchestrator";
}

/** Maschine eines Terminals: Feld, Adresspräfix `maschine/t7`, sonst der Space. */
export function machineOf(terminal, spaces = []) {
  if (typeof terminal?.machine === "string" && terminal.machine) return terminal.machine;
  const address = String(terminal?.address ?? "");
  const slash = address.indexOf("/");
  if (slash > 0) return address.slice(0, slash);
  const spaceId = String(terminal?.space ?? "");
  if (spaceId) {
    const space = (spaces ?? []).find((row) => String(row?.id ?? "") === spaceId);
    if (space && typeof space.machine === "string" && space.machine) return space.machine;
  }
  return null;
}

export function machineLabel(machine) {
  return machine ? String(machine) : "Dieser Rechner";
}

/** Anheften/Lösen als reine Umschaltung; `main.js` führt den Befehl aus. */
export function pinCommand(card) {
  return {
    command: "terminal.pin",
    args: { terminal: String(card?.address ?? ""), pinned: !card?.pinned },
  };
}

// Dringlichkeit der freien Karten: Wartende zuerst, dann Fertige, Arbeitende,
// Untätige. `error` zählt wie `blocked`, weil beides jemanden braucht.
const FREE_RANK = { blocked: 4, error: 4, done: 3, working: 2, idle: 1 };

/** Freie Agenten: Terminal live, Status gemeldet, nicht Teil eines Fabric-Teams.
    Eine Regelquelle für Karten (`freeAgentCards`) und Filter (`hiddenAgentAddresses`). */
function freeAgentEntries(terminals = [], listed = []) {
  const hidden = fabricAddresses(terminals);
  const reported = new Map(
    (listed ?? []).filter(Boolean).map((agent) => [String(agent.address ?? ""), agent]),
  );
  const entries = [];

  for (const terminal of terminals ?? []) {
    if (!terminal || typeof terminal !== "object") continue;
    if (terminal.state !== undefined && terminal.state !== "live") continue;
    const address = addressOf(terminal);
    if (!address || hidden.has(address)) continue;
    const agent = reported.get(address) ?? null;
    const status = String(agent?.status ?? terminal.status ?? (terminal.report ? "idle" : ""));
    // Freier Agent heißt: das Programm meldet einen Status. Reine Shells
    // und fremde, statuslose Programme bleiben draußen.
    if (!agent && !status) continue;
    // `agents()` ist die frischeste Quelle; das Label deckt Terminals ohne
    // Agenteneintrag (nur gemeldeter Status) ab.
    const pinned = agent ? Boolean(agent.pinned) : Boolean(labelsOf(terminal)["herdr.pinned"]);
    entries.push({ terminal, agent, status, address, pinned });
  }

  return entries;
}

/** Adressen der freien Karten; dieselbe Auswahl wie `freeAgentCards`. */
export function freeAgentAddresses(terminals = [], listed = []) {
  return freeAgentEntries(terminals, listed).map((entry) => entry.address);
}

/** Adressen, die die normale Agentenliste ausblenden soll: Fabric-Terminals samt
    Nachfahren und freie Karten. Herdr erlaubt keine mod-übergreifenden Importe,
    deshalb geht der Schnappschuss über den Shared-State. */
export function hiddenAgentAddresses(terminals = [], listed = []) {
  return {
    fabric: [...fabricAddresses(terminals)],
    free: freeAgentAddresses(terminals, listed),
  };
}

/** Kartenname: Label vor Terminalname vor Programm; der Ticket-Titel benennt die
    Aufgabe, nicht den Agenten. */
function freeAgentName(terminal, agent) {
  const labels = labelsOf(terminal);
  for (const label of ["hub.name", "hub.role"]) {
    const value = String(labels[label] ?? "").trim();
    if (value) return value;
  }
  const name = String(terminal?.name ?? "").trim();
  if (name) return name;
  const app = String(agent?.app ?? terminal?.app ?? "").trim();
  if (app) return app;
  const title = String(terminal?.title ?? "").trim();
  return title || addressOf(terminal);
}

const LEADING_GLYPHS =
  /^[\p{Extended_Pictographic}\p{So}\u2800-\u28FF\uFE0F\u200D]+\s*/gu;
const PROGRAM_SEPARATOR = /^[^\s]{1,3}\s*>\s*/u;
const PROGRAM_GLYPH = /^[^\s]{1,3}\s+(?=[\u2800-\u28FF])/u;
const INNER_EMOJI =
  /\p{Extended_Pictographic}|\uFE0F|\u200D|\p{Emoji_Modifier}/gu;

/** Aufgabenzeile aus dem Programmtitel: Programmpräfix, Statusglyphen und Emoji
    weg; ein Rest, der nur den Agentennamen wiederholt, entfällt. */
export function freeAgentTask(title, name) {
  let value = String(title ?? "").replace(/\s+/g, " ").trim();
  value = value.replace(LEADING_GLYPHS, "");
  value = value.replace(PROGRAM_SEPARATOR, "");
  value = value.replace(PROGRAM_GLYPH, "");
  value = value.replace(LEADING_GLYPHS, "");
  value = value.replace(INNER_EMOJI, "").replace(/\s+/g, " ").trim();
  const task = truncateTask(value);
  return task && task !== name ? task : "";
}

/** Karten und Gruppen des Agenten-Abschnitts. `listed` ist `agents()` aus Herdr:
    nur Terminals mit gemeldetem Status sind freie Agenten. `sort` übernimmt die
    Einstellung `agents.sort`: `priority` (Standard, Wartende zuerst) oder
    `grouped` (nach Maschinengruppe). Angeheftete bleiben in beiden Fällen vorn. */
export function freeAgentCards(terminals = [], listed = [], spaces = [], sort = "priority") {
  const cards = [];

  for (const { terminal, agent, status, address, pinned } of freeAgentEntries(terminals, listed)) {
    const name = freeAgentName(terminal, agent);
    const app = String(agent?.app ?? terminal.agent ?? terminal.report ?? "");
    const machine = machineOf(terminal, spaces);
    const orchestrator = freeOrchestrator(terminal);
    const task = freeAgentTask(agent?.title || terminal.title || "", name);
    cards.push({
      address,
      name,
      app,
      status,
      machine,
      group: machineLabel(machine),
      orchestrator,
      pinned,
      badge: freeStatusWord(status),
      icon: freeCornerIcon(status),
      sprite: null,
      task,
      click: { kind: "terminal", terminal: address },
    });
  }

  // Angeheftete zuerst. Danach `priority`: Dringlichkeit, dann Orchestrator,
  // Name und Adresse; `grouped`: Maschinengruppe, Name, Adresse.
  const byName = (a, b) => Number(b.pinned) - Number(a.pinned)
    || String(a.group).localeCompare(String(b.group))
    || a.name.localeCompare(b.name)
    || a.address.localeCompare(b.address);
  const byPriority = (a, b) => Number(b.pinned) - Number(a.pinned)
    || (FREE_RANK[b.status] ?? 0) - (FREE_RANK[a.status] ?? 0)
    || Number(b.orchestrator) - Number(a.orchestrator)
    || a.name.localeCompare(b.name)
    || a.address.localeCompare(b.address);
  cards.sort(String(sort) === "grouped" ? byName : byPriority);

  let agentIndex = 0;
  for (const card of cards) {
    card.sprite = freeSpriteKey(card, agentIndex);
    if (!card.orchestrator) agentIndex += 1;
  }

  const groups = [];
  for (const card of cards) {
    let group = groups.find((row) => row.name === card.group);
    if (!group) {
      group = { name: card.group, machine: card.machine, cards: [], busy: 0, total: 0 };
      groups.push(group);
    }
    group.cards.push(card);
    group.total += 1;
    if (card.status === "working") group.busy += 1;
  }
  groups.sort((a, b) => Number(a.machine !== null) - Number(b.machine !== null)
    || a.name.localeCompare(b.name));

  const busy = cards.filter((card) => card.status === "working").length;
  return { cards, groups, busy };
}

// --- Alarme aus index.json (`alarm`) ---------------------------------------
// Der Index veröffentlicht die Alarme bereits fertig beschriftet; hier bleibt
// nur, welche gezeigt werden und in welcher Reihenfolge ihre Knöpfe stehen.

const ALARM_LABELS = {
  run: "Lauf ansehen",
  ticket: "Ticket öffnen",
  resume: "Pause aufheben",
  ack: "Quittieren",
};

/** Alarme für den Banner: ohne `active` oder mit leerer Liste nichts. */
export function activeAlarms(alarm) {
  if (!alarm || alarm.active === false) return [];
  const list = Array.isArray(alarm.alarms) ? alarm.alarms : [];
  return list.filter((entry) => entry && typeof entry === "object");
}

/** Knöpfe eines Alarms: bekannte Aktionen in der Reihenfolge des Alarms,
    Unbekanntes entfällt, `Quittieren` steht immer zuletzt. */
export function alarmButtons(alarm) {
  const actions = Array.isArray(alarm?.actions) ? alarm.actions : [];
  const known = [];
  for (const action of actions) {
    if (!Object.hasOwn(ALARM_LABELS, action) || known.includes(action)) continue;
    known.push(action);
  }
  const ordered = known.filter((action) => action !== "ack");
  if (known.includes("ack")) ordered.push("ack");
  return ordered.map((action) => ({ action, label: ALARM_LABELS[action] }));
}
