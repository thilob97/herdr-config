// Costs and budgets of the orchestrator's work. Every 30 s the watcher asks
// agent-cards' omp helper what each ticket agent's omp session has cost (and the
// orchestrator's), keeps the highest figure per ticket and terminal, and writes
// data/orchestra/costs.json (also read by `hub status`). Budgets live in shared
// "orchestra.budget" = { ticket, team } plus per-ticket raises in
// "orchestra.budgetExtra". Over a ticket's budget its agent is interrupted;
// over the team budget every working team agent and the orchestrator are.
// Agents other than omp report no cost here (shown as "—").
import { exec, hc, terminals, appHome, readTextFile, shared, setShared, notify } from "herdr";
import * as fs from "fs/promises";
import * as orch from "./orchestrator.js";
import * as ui from "./ui.js";

const HELPER = () => `${appHome()}/mods/agent-cards/helpers/omp-cards.py`;
const FILE = () => `${appHome()}/data/orchestra/costs.json`;
export const TICKET_STEPS = [1, 2, 3, 5, 10, 20];
export const TEAM_STEPS = [5, 10, 20, 50, 100];

export const budget = () => ({ ticket: 3, team: 20, ...(shared("orchestra.budget") ?? {}) });
export const extra = (id) => (shared("orchestra.budgetExtra") ?? {})[id] ?? 0;
export const ticketLimit = (id) => budget().ticket + extra(id);
export const costs = () => shared("orchestra.costs") ?? { tickets: {}, orchestrator: 0, orchestrators: {}, teamCost: 0, stopped: {} };

/** The orchestrator's cost in one space (`orchestrators` in costs.json). A file from
 *  before the split carries one number for the whole home: it belongs to that space —
 *  and to "no space" (""), where it is the sum. A space with its own entry never sees
 *  another space's money. */
export function orchestratorCost(sid = "") {
  const c = costs();
  const per = c.orchestrators ?? {};
  if (!Object.keys(per).length) return Number(c.orchestrator) || 0;
  return sid ? Number(per[sid]) || 0 : Number(c.orchestrator) || 0;
}

const machineOf = (a) => (a.includes("/") ? a.slice(0, a.indexOf("/")) : null);
const py = {};
let src = null;

// The helper's { "<terminal id>": { cost, ... } } for terminals on one machine.
async function ask(on, wanted) {
  py[on ?? ""] ??= exec("python3", ["-c", "1"], { on, timeout: 10000 }).then((r) => (r.code === 0 ? "python3" : "python"), () => "python");
  let argv = [HELPER(), encodeURIComponent(JSON.stringify(wanted))];
  if (on) {
    src ??= await readTextFile(HELPER()).catch(() => null);
    if (!src) return {};
    argv = ["-c", src, argv[1]];
  }
  const r = await exec(await py[on ?? ""], argv, { on, timeout: 20000 }).catch(() => null);
  try { return r?.code === 0 ? JSON.parse(r.stdout) : {}; } catch { return {}; }
}

async function titleOf(address) {
  const r = await hc(["get", address, "--json"]).catch(() => null);
  try { return r?.code === 0 ? JSON.parse(r.stdout).title ?? "" : ""; } catch { return ""; }
}

export async function load() {
  try { setShared("orchestra.costs", { ...costs(), ...JSON.parse(await fs.readFile(FILE(), "utf8")) }); } catch {}
}

// One round: read costs, store them, enforce budgets.
export async function poll() {
  const tickets = (shared("orchestra.tickets") ?? []).filter((t) => t.terminal && t.status !== "done");
  const live = new Set(terminals().filter((x) => x.state === "live").map((x) => x.address));
  // Every space's orchestrator, not only this window's: its money belongs to its space.
  const os = orch.all();
  const targets = [...tickets.filter((t) => live.has(t.terminal)).map((t) => t.terminal), ...os.map((x) => x.address)];
  const byMachine = new Map();
  for (const a of targets) {
    const on = machineOf(a);
    if (!byMachine.has(on)) byMachine.set(on, {});
    byMachine.get(on)[on ? a.slice(on.length + 1) : a] = await titleOf(a);
  }
  const found = {};
  await Promise.all([...byMachine].map(async ([on, wanted]) => {
    const got = await ask(on, wanted);
    for (const [id, info] of Object.entries(got ?? {})) if (info?.cost != null) found[on ? `${on}/${id}` : id] = info.cost;
  }));
  const prev = costs();
  const perTerminal = { ...(prev.perTerminal ?? {}) };
  for (const t of tickets) {
    const key = `${t.id}|${t.terminal}`;
    if (found[t.terminal] != null) perTerminal[key] = Math.max(perTerminal[key] ?? 0, found[t.terminal]);
  }
  const ticketCost = {};
  for (const [key, c] of Object.entries(perTerminal)) {
    const id = key.slice(0, key.indexOf("|"));
    ticketCost[id] = (ticketCost[id] ?? 0) + c;
  }
  const open = new Set((shared("orchestra.tickets") ?? []).filter((t) => t.status !== "done").map((t) => t.id));
  // Per space; the last known figure stays when an orchestrator is not live (as tickets do).
  const orchestrators = { ...(prev.orchestrators ?? {}) };
  for (const x of os) if (found[x.address] != null) orchestrators[x.spaceId ?? ""] = found[x.address];
  const orchestrator = Object.keys(orchestrators).length
    ? Object.values(orchestrators).reduce((n, x) => n + (Number(x) || 0), 0)
    : Number(prev.orchestrator) || 0;
  const teamCost = [...open].reduce((n, id) => n + (ticketCost[id] ?? 0), 0) + orchestrator;
  const b = budget();
  const next = { tickets: ticketCost, perTerminal, orchestrator, orchestrators, teamCost, ticketBudget: b.ticket, teamBudget: b.team, stopped: { ...(prev.stopped ?? {}) }, at: Date.now() };
  await enforce(next, tickets, live);
  if (JSON.stringify({ ...next, at: 0 }) !== JSON.stringify({ ...prev, at: 0 })) {
    setShared("orchestra.costs", next);
    await fs.mkdir(`${appHome()}/data/orchestra`, { recursive: true }).catch(() => {});
    await fs.writeFile(FILE(), JSON.stringify(next, null, 1)).catch(() => {});
  }
}

const money = (n) => `$${(n ?? 0).toFixed(2)}`;

async function enforce(c, tickets, live) {
  for (const t of tickets) {
    const spent = c.tickets[t.id] ?? 0, limit = ticketLimit(t.id);
    // Back under the limit (the budget was raised): the stop is over.
    if (spent <= limit) { if (c.stopped[t.id]) c.stopped[t.id] = false; continue; }
    if (c.stopped[t.id] || !live.has(t.terminal)) continue;
    c.stopped[t.id] = true;
    await hc(["interrupt", t.terminal]).catch(() => null);
    notify({ title: `Budget erreicht: ${t.title}`.slice(0, 90), body: `${money(spent)} von ${money(limit)} · Agent angehalten. Im Team-Panel freigeben.`,
      level: "warning", timeout: 30000, action: { name: "tabs-graph.panel-team" } });
    // The orchestrator of the ticket's workspace, never the active space's.
    const ws = ui.ticketWorkspace(t);
    if (orch.find(ws)) await orch.send(`Budget-Stopp: Ticket ${t.id} „${t.title}“ hat ${money(spent)} von ${money(limit)} verbraucht, sein Agent wurde angehalten. Schicke ihm nichts Neues, bis der Mensch das Budget erhöht.`, ws).catch(() => null);
  }
  if (c.teamCost <= c.teamBudget && c.stopped.__team) c.stopped.__team = false;
  if (c.teamCost > c.teamBudget && !c.stopped.__team) {
    c.stopped.__team = true;
    for (const t of tickets) if (live.has(t.terminal)) await hc(["interrupt", t.terminal]).catch(() => null);
    // Every factory stops, not only the one this window shows.
    for (const x of orch.all()) await hc(["interrupt", x.address]).catch(() => null);
    notify({ title: "Team-Budget erreicht", body: `${money(c.teamCost)} von ${money(c.teamBudget)} · Orchestrator und Team angehalten.`,
      level: "warning", timeout: 30000, action: { name: "tabs-graph.panel-team" } });
  }
}

// The person raises a budget: the stop is lifted and the orchestrator told to carry on.
export async function raiseTicket(t) {
  const step = budget().ticket;
  setShared("orchestra.budgetExtra", { ...(shared("orchestra.budgetExtra") ?? {}), [t.id]: extra(t.id) + step });
  const c = costs();
  setShared("orchestra.costs", { ...c, stopped: { ...(c.stopped ?? {}), [t.id]: false } });
  const ws = ui.ticketWorkspace(t);
  if (orch.find(ws)) await orch.send(`Budget für Ticket ${t.id} „${t.title}“ auf ${money(ticketLimit(t.id))} erhöht. Lass den Agent weitermachen.`, ws);
}

export function cycle(kind) {
  const b = budget(), steps = kind === "team" ? TEAM_STEPS : TICKET_STEPS;
  const next = steps[(steps.indexOf(b[kind]) + 1) % steps.length];
  setShared("orchestra.budget", { ...b, [kind]: next });
  // A higher team budget lifts the team stop.
  if (kind === "team") { const c = costs(); setShared("orchestra.costs", { ...c, teamBudget: next, stopped: { ...(c.stopped ?? {}), __team: false } }); }
}
