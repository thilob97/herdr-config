// Reine Auswahl-Logik der normalen Agentenliste: ausgeblendet wird, was die
// Fabric-Seitenleiste (mods/fabric-sidebar) bereits als Karte zeigt. Die Regel
// selbst liegt dort; hier wird nur der veröffentlichte Shared-State-Snapshot
// angewandt. Keine herdr-Importe, damit die Regeln ohne Fenster testbar bleiben.

function addressSet(values) {
  const set = new Set();
  if (!Array.isArray(values)) return set;
  for (const value of values) {
    const address = String(value ?? "");
    if (address) set.add(address);
  }
  return set;
}

/** Ausgeblendete Adressen aus dem Snapshot `fabric.hiddenAgents`: `fabric` immer,
    `free` nur im Layout „fabric“. Robust gegen fehlende oder kaputte Werte. */
export function hiddenForLayout(snapshot, layoutName = "fabric") {
  const hidden = addressSet(snapshot?.fabric);
  if (String(layoutName) === "fabric") {
    for (const address of addressSet(snapshot?.free)) hidden.add(address);
  }
  return hidden;
}

/** Agentenliste ohne die Karten der Fabric-Seitenleiste. */
export function visibleAgents(list = [], snapshot = null, layoutName = "fabric") {
  const hidden = hiddenForLayout(snapshot, layoutName);
  const agents = Array.isArray(list) ? list : [];
  if (hidden.size === 0) return [...agents];
  return agents.filter((agent) => !hidden.has(String(agent?.address ?? "")));
}

/** Terminalliste ohne die Karten der Fabric-Seitenleiste (für Bäume). */
export function visibleTerminals(terminals = [], snapshot = null, layoutName = "fabric") {
  const hidden = hiddenForLayout(snapshot, layoutName);
  const rows = Array.isArray(terminals) ? terminals : [];
  if (hidden.size === 0) return [...rows];
  return rows.filter(
    (terminal) => !hidden.has(String(terminal?.address ?? terminal?.name ?? "")),
  );
}
