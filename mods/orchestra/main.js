// Team: the orchestrator on top (its card and tickets, hubview.js), then every
// agent on every space and machine as a graph: who started whom (hc run sets
// `parent`), grouped by space, with status and how long it has been in it.
// Select agents to message them all at once, interrupt them, or watch them as
// a team. Teams (shared "orchestra.groups", also made by the launcher) show
// above the graph; the status bar watches them. With props { role: "daemon" }
// (a 0px block in the elric layout) this mod only runs the orchestrator's watcher.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, run, hc, theme, shared, setShared, openOverlay, props } from "herdr";
import { HubDaemon, HubSection } from "./hubview.js";

const WC = "mods/workspace-chrome";
const RANK = { blocked: 4, error: 4, done: 3, working: 2, idle: 1 };
const WORD = { blocked: "wartet", error: "Fehler", done: "fertig", working: "arbeitet", idle: "ruhig" };
// omp task subagents: their job states, as the agent cards map them.
const SUB = { running: ["working", "läuft"], pending: ["idle", "wartet auf Start"], completed: ["done", "fertig"], failed: ["blocked", "fehlgeschlagen"], cancelled: ["blocked", "abgebrochen"], aborted: ["blocked", "abgebrochen"] };
const plain = (s) => (s ?? "").replace(/[\uE000-\uF8FF\u{10000}-\u{10FFFF}]\s*/gu, "").trim();
const machineOf = (a) => (a.includes("/") ? a.slice(0, a.indexOf("/")) : null);
function ago(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 60 ? "<1m" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Orchestra extends View {
  init(_props, cx) {
    if (props()?.role === "daemon") { this.daemon = new HubDaemon(cx); return; }
    this.hub = new HubSection(this, cx);
    this.selected = new Set();
    this.force = false;
    this.note = null;
    this.busy = false;
    this.hovered = null;
    this.message = InputState.new({ placeholder: "Nachricht an die Auswahl… (↵ senden)" });
    this.message.on("submit", (_e, cx) => this.broadcast(cx));
    // Durations move on their own: redraw once a minute.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  // Live agents and the terminals they started, with what the app knows about each.
  nodes() {
    const live = terminals().filter((x) => x.state === "live");
    const info = new Map(agents().map((a) => [a.address, a]));
    const since = shared("attention.since") ?? {};
    const byAddr = new Map(live.map((x) => [x.address, x]));
    const keep = new Set();
    for (const x of live) {
      if (!(info.has(x.address) || x.status || x.parent)) continue;
      // A node and everything above it, so a helper's parent agent shows too.
      for (let a = x.address; a && byAddr.has(a) && !keep.has(a); a = byAddr.get(a).parent) keep.add(a);
    }
    return [...keep].map((addr) => {
      const x = byAddr.get(addr), a = info.get(addr);
      const status = a?.status ?? x.status ?? null;
      const where = (x.where ?? "").split(" / ");
      return {
        address: addr, parent: byAddr.has(x.parent) ? x.parent : null, status,
        // A script run by a shell is named by the script, not "sh".
        name: a?.program?.name ?? x.name ?? x.template ?? (x.program?.shell ? x.agent : x.program?.name) ?? x.agent ?? addr,
        // omp prefixes its title with "π >": the name already says which agent it is.
        title: plain(a?.title ?? x.title ?? "").replace(/^π\s*>?\s*/, ""), program: a?.program ?? x.program, pane: a?.pane ?? null,
        orch: x.name === "orchestrator",
        space: x.name === "orchestrator" ? "Orchestrator" : a?.space_name ?? where[0] ?? "", tab: a?.tab_name ?? where[1] ?? "", machine: machineOf(addr),
        since: since[addr]?.status === status ? since[addr].at : null,
      };
    });
  }

  // Roots per space (machine first), each followed by its subtree with tree lines:
  // terminals it started (hc run) and the subagents omp's task tool started inside
  // it (shared "omp.subagents", published by agent-cards), nested as omp reports them.
  graph(nodes) {
    const omp = shared("omp.subagents") ?? {};
    const kids = (addr) => nodes.filter((n) => n.parent === addr).sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0));
    const children = (item) => item.n
      ? [...kids(item.n.address).map((n) => ({ n })), ...(omp[item.n.address] ?? []).map((s) => ({ s, owner: item.n.address, path: `${item.n.address}/${s.id}` }))]
      : (item.s.children ?? []).map((s) => ({ s, owner: item.owner, path: `${item.path}/${s.id}` }));
    const walk = (item, lead) => {
      const list = children(item);
      return list.flatMap((k, i) => {
        const last = i === list.length - 1;
        return [{ ...k, lines: [...lead, last ? "└" : "├"] }, ...walk(k, [...lead, last ? "" : "│"])];
      });
    };
    const groups = new Map();
    for (const r of nodes.filter((n) => !n.parent)) {
      const key = `${r.machine ?? ""}\u0000${r.space}`;
      if (!groups.has(key)) groups.set(key, { machine: r.machine, space: r.space, rows: [] });
      // The orchestrator has its own card above: here only its team, one level up.
      if (r.orch) groups.get(key).rows.push(...walk({ n: r }, []).map((row) => ({ ...row, lines: row.lines.slice(1) })));
      else groups.get(key).rows.push({ n: r, lines: [] }, ...walk({ n: r }, []));
    }
    return [...groups.values()].filter((g) => g.rows.length)
      .sort((a, b) => (b.space === "Orchestrator") - (a.space === "Orchestrator") || (a.machine ?? "").localeCompare(b.machine ?? "") || a.space.localeCompare(b.space));
  }

  groups() { return shared("orchestra.groups") ?? []; }
  setGroups(list) { setShared("orchestra.groups", list); }

  addGroup() {
    if (!this.selected.size) return;
    const d = new Date();
    const name = `Team ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    this.setGroups([...this.groups(), { id: `g${Date.now().toString(36)}`, name, members: [...this.selected], at: Date.now(), watch: true, notified: false }]);
    this.note = { ok: true, text: `${name} wird beobachtet` };
  }

  broadcast(cx) {
    const text = this.message.value().trim();
    if (!text || !this.selected.size || this.busy) return;
    const nodes = new Map(this.nodes().map((n) => [n.address, n]));
    const targets = [...this.selected].filter((a) => nodes.has(a));
    this.busy = true; this.note = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let sent = 0, skipped = 0;
      const failed = [];
      for (const a of targets) {
        const blocked = nodes.get(a).status === "blocked";
        if (blocked && !this.force) { skipped++; continue; }
        try {
          const r = await hc(["send", a, text, ...(blocked ? ["--force"] : [])]);
          if (r.code === 0) sent++;
          else failed.push(`${a}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
        } catch (e) { failed.push(`${a}: ${e?.message ?? e}`); }
      }
      if (!failed.length) this.message.set_value("");
      this.note = {
        ok: !failed.length,
        text: [`gesendet ${sent}`, skipped ? `${skipped} wartende übersprungen` : "", failed.length ? `Fehler: ${failed.join("; ").slice(0, 200)}` : ""].filter(Boolean).join(" · "),
      };
      this.busy = false;
      cx.notify();
    });
  }

  interrupt(cx) {
    const targets = [...this.selected];
    if (!targets.length || this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const out = await Promise.all(targets.map((a) => hc(["interrupt", a]).then((r) => r.code === 0, () => false)));
      this.note = { ok: out.every(Boolean), text: `unterbrochen ${out.filter(Boolean).length}/${targets.length}` };
      this.busy = false;
      cx.notify();
    });
    cx.notify();
  }

  open(n) {
    if (n.pane) run("pane.focus", { pane: n.pane });
    else run("terminal.peek", { terminal: n.address });
  }

  // ---------- view ----------

  status(t, st) {
    if (st === "working") return svg(`${WC}/spinner.svg`).size(11).flex_none().text_color(t.working).spin(900);
    if (st === "blocked" || st === "error") return div().relative().size(11).flex_none().flex().items_center().justify_center()
      .child(div().absolute().inset_0().rounded(6).bg(t.blocked + "55").loop("opacity", { from: 0, to: 1, period: 900 }))
      .child(div().size(7).rounded(4).bg(t.blocked));
    return div().size(11).flex_none().flex().items_center().justify_center().child(div().size(7).rounded(4).bg(t[st] ?? t.dim));
  }

  check(t, on) {
    return div().size(13).flex_none().rounded(4).border_1().border_color(on ? t.solid : t.input).bg(on ? t.solid : t.background)
      .flex().items_center().justify_center().when(on, (el) => el.child(svg(`${WC}/check.svg`).size(9).text_color(t.solid_foreground)));
  }

  iconBtn(t, id, path, tip, action) {
    return div().id(id).size(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim).tooltip(tip)
      .hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(path).size(12));
  }

  // One agent: click goes to it; the box on the left (on hover, or while
  // anything is selected) picks it for a message, a team or an interrupt.
  nodeRow(t, row) {
    const n = row.n, on = this.selected.has(n.address), hover = this.hovered === n.address;
    const picking = on || hover || this.selected.size > 0;
    const pic = icon(n.program, 14, t.muted);
    return h_flex().id(`or-${n.address}`).h(32).flex_none().pl(4).pr(6).gap(0).items_center().rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((h, cx) => { this.hovered = h ? n.address : this.hovered === n.address ? null : this.hovered; cx.notify(); })
      .on_click(() => this.open(n))
      .child(div().id(`or-pick-${n.address}`).w(20).h_full().flex_none().flex().items_center().justify_center()
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (on) this.selected.delete(n.address); else this.selected.add(n.address);
          cx.notify();
        })
        .when(picking, (el) => el.child(this.check(t, on))))
      .children(row.lines.map((l) => div().self_start().mt(-2).w(9).h(18).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .child(div().mr(7).child(this.status(t, n.status)))
      .when(Boolean(pic), (el) => el.child(div().mr(7).child(pic)))
      .child(h_flex().flex_1().min_w(0).gap(7).items_center()
        .child(div().flex_none().max_w(130).truncate().text_size(12.5).text_color(t.foreground).child(n.name))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(n.title || n.tab)))
      .child(hover
        ? h_flex().gap(1).flex_none().ml(4)
          .child(this.iconBtn(t, `or-rv-${n.address}`, "mods/review/icon.svg", "Review", () =>
            openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680, props: { terminal: n.address } })))
          .child(this.iconBtn(t, `or-int-${n.address}`, "mods/orchestra/icons/stop.svg", "Unterbrechen", () => hc(["interrupt", n.address]).catch(() => {})))
        : div().flex_none().ml(6).text_size(10.5).text_color(n.status === "blocked" ? t.blocked : n.status === "working" ? t.working : t.dim)
          .child(`${WORD[n.status] ?? ""}${n.since ? ` · ${ago(n.since)}` : ""}`));
  }

  // A subagent omp's task tool started: no terminal of its own, so nothing to
  // select or open; its task shows on hover, a click goes to the omp agent.
  ompRow(t, row) {
    const s = row.s, [st, word] = SUB[s.status] ?? ["idle", s.status ?? ""];
    const quiet = s.status === "completed";
    return h_flex().id(`or-sub-${row.path}`).h(26).flex_none().pl(26).pr(4).gap(0).items_center().rounded(7)
      .cursor_pointer().hover((x) => x.bg(t.hover)).when(quiet, (el) => el.opacity(0.6))
      .when(Boolean(s.description), (el) => el.tooltip(s.description))
      .on_click(() => { const n = this.nodes().find((x) => x.address === row.owner); if (n) this.open(n); })
      .children(row.lines.map((l) => div().self_start().mt(-2).w(9).h(15).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .child(div().mr(6).child(s.status === "failed" || s.status === "cancelled" || s.status === "aborted"
        ? div().size(11).flex_none().flex().items_center().justify_center().child(div().size(7).rounded(4).bg(t.blocked))
        : this.status(t, st)))
      .child(div().flex_none().mr(6).px(4).h(15).rounded(4).bg(t.raised).text_size(10).text_color(t.dim).flex().items_center().child(s.agent))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(s.description || s.id))
      .child(div().flex_none().ml(6).text_size(10.5).text_color(st === "blocked" ? t.blocked : t[st] ?? t.dim).child(word));
  }

  groupCard(t, g, nodes) {
    const byAddr = new Map(nodes.map((n) => [n.address, n]));
    const members = g.members.map((a) => ({ a, n: byAddr.get(a) }));
    const active = members.filter((m) => m.n && (m.n.status === "working" || m.n.status === "blocked")).length;
    const waiting = members.filter((m) => m.n?.status === "blocked").length;
    const done = members.length - active;
    const finished = active === 0;
    const all = members.every((m) => this.selected.has(m.a));
    const toggle = (patch) => this.setGroups(this.groups().map((x) => (x.id === g.id ? { ...x, ...patch } : x)));
    return v_flex().id(`grp-${g.id}`).flex_none().gap(6).p(9).rounded(8).bg(t.background).border(1).border_color(finished ? t.done : t.border)
      .child(h_flex().gap(7).items_center()
        .child(svg("mods/orchestra/icon.svg").size(12).text_color(finished ? t.done : t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).child(g.name))
        .child(div().text_size(10.5).text_color(finished ? t.done : waiting ? t.blocked : t.dim)
          .child(finished ? "alle fertig" : `${done}/${members.length} fertig${waiting ? ` · ${waiting} wartet` : ""}`))
        .child(this.iconBtn(t, `grp-sel-${g.id}`, `${WC}/check.svg`, all ? "Auswahl aufheben" : "Alle auswählen", (cx) => {
          for (const m of members) if (all) this.selected.delete(m.a); else if (m.n) this.selected.add(m.a);
          cx.notify();
        }))
        .child(this.iconBtn(t, `grp-watch-${g.id}`, `${WC}/${g.watch ? "pin" : "pin-off"}.svg`, g.watch ? "Wird beobachtet (Meldung, wenn alle fertig) – aus" : "Beobachten", () => toggle({ watch: !g.watch, notified: false })))
        .child(this.iconBtn(t, `grp-x-${g.id}`, `${WC}/x.svg`, "Team auflösen (Agents laufen weiter)", () => this.setGroups(this.groups().filter((x) => x.id !== g.id)))))
      // One segment per member: its status color, so progress and who is still busy read at once.
      .child(h_flex().h(4).gap(2).children(members.map((m) => div().flex_1().h(4).rounded(2)
        .bg(!m.n || m.n.status === "done" || m.n.status === "idle" ? t.done : m.n.status === "blocked" ? t.blocked : t.working))))
      .child(h_flex().flex_wrap().gap(4).children(members.map((m) => h_flex().id(`gm-${g.id}-${m.a}`).h(20).px(6).gap(4).items_center().rounded(5).bg(t.raised)
        .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(m.a)
        .on_click(() => m.n && this.open(m.n))
        .child(this.status(t, m.n?.status ?? "idle"))
        .child(div().text_size(10.5).text_color(m.n ? t.muted : t.dim).child(m.n?.name ?? `${m.a} (beendet)`)))));
  }

  label(t, text, n, color) {
    return h_flex().px(4).pt(10).pb(2).gap(6).items_center().text_size(11).font_medium()
      .child(div().text_color(color ?? t.muted).child(text))
      .when(n != null, (el) => el.child(div().text_color(t.dim).child(String(n))));
  }

  render(cx) {
    if (this.daemon) { this.daemon.watch(cx); return div(); }
    const t = theme();
    const nodes = this.nodes();
    for (const a of [...this.selected]) if (!nodes.some((n) => n.address === a)) this.selected.delete(a);
    const count = (s) => nodes.filter((n) => n.status === s).length;
    const graph = this.graph(nodes);
    const groups = this.groups();
    const sel = this.selected.size;
    const internal = graph.flatMap((g) => g.rows).filter((r) => r.s && r.s.status === "running").length;

    // Only what is there: "1 wartet · 2 arbeiten", each with its color.
    const parts = [["blocked", "wartet", "warten"], ["working", "arbeitet", "arbeiten"], ["done", "fertig", "fertig"]]
      .map(([s, one, many]) => [s, count(s), count(s) === 1 ? one : many]).filter(([, c]) => c > 0);
    const summary = h_flex().gap(10).items_center().text_size(11)
      .children(parts.map(([s, c, w]) => h_flex().gap(5).items_center()
        .child(div().size(6).rounded_full().bg(t[s])).child(div().text_color(s === "blocked" ? t.blocked : t.muted).child(`${c} ${w}`))))
      .when(internal > 0, (el) => el.child(div().text_color(t.dim).tooltip("omp-interne Subagents, die gerade laufen").child(`+${internal} intern`)));

    const body = v_flex().id("or-body").flex_1().min_h(0).overflow_y_scrollbar().px(10).pt(10).pb(10).gap(4)
      .child(this.hub.render(t))
      .when(groups.length > 0, (el) => el.child(this.label(t, "Teams", groups.length)).children(groups.map((g) => this.groupCard(t, g, nodes))))
      .child(this.label(t, "Agents", nodes.filter((n) => !n.orch).length))
      .when(!graph.length, (el) => el.child(div().px(4).py(6).text_size(11.5).text_color(t.dim).child("Keine Agents. Starte welche mit „Starten“ (⌘⇧N).")))
      .children(graph.map((g) => v_flex().gap(1)
        .child(h_flex().px(4).pt(6).pb(2).gap(6).items_center().text_size(10.5).text_color(t.dim)
          .child(svg(`${WC}/${g.machine ? "server" : g.space === "Orchestrator" ? "layers" : "monitor"}.svg`).size(11))
          .child(div().truncate().child(`${g.space || "ohne Space"}${g.machine ? ` · ${g.machine}` : ""}`)))
        .children(g.rows.map((r) => (r.s ? this.ompRow(t, r) : this.nodeRow(t, r))))));

    // Appears only with a selection.
    const actions = v_flex().flex_none().px(10).py(9).gap(7).border_t(1).border_color(t.border).bg(t.chrome)
      .child(h_flex().gap(8).items_center().text_size(11)
        .child(div().text_color(t.foreground).font_medium().child(`${sel} ausgewählt`))
        .when(Boolean(this.note), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(this.note.ok ? t.dim : t.blocked).child(this.note.text)))
        .when(!this.note, (el) => el.child(div().flex_1()))
        .child(div().id("or-clear").text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.selected.clear(); this.note = null; cx.notify(); }).child("Auswahl aufheben")))
      .child(h_flex().h(32).pl(10).pr(4).gap(6).items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.message).flex_1().h_full().text_size(12).text_color(t.foreground))
        .child(div().id("or-send").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .bg(this.busy ? t.raised : t.solid).text_color(this.busy ? t.dim : t.solid_foreground)
          .when(!this.busy, (e) => e.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.broadcast(cx)))
          .child(svg("mods/orchestra/icons/send.svg").size(12))))
      .child(h_flex().gap(5).items_center()
        .child(this.textBtn(t, "or-team", "Als Team beobachten", true, () => this.addGroup()))
        .child(this.textBtn(t, "or-int", "Unterbrechen", !this.busy, (cx) => this.interrupt(cx)))
        .child(div().flex_1())
        .child(h_flex().id("or-force").gap(5).items_center().cursor_pointer().tooltip("Auch Agents anschreiben, die auf eine Antwort warten (beantwortet ihren Dialog)")
          .on_click((_e, cx) => { this.force = !this.force; cx.notify(); })
          .child(this.check(t, this.force)).child(div().text_size(11).text_color(t.muted).child("auch wartende"))));

    return v_flex().id("orchestra").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Team"))
        .child(div().flex_1())
        .child(summary)
        .child(div().id("or-launch").ml(4).h(24).px(9).flex().items_center().gap(5).rounded(6).bg(t.raised).text_color(t.foreground).text_size(11.5)
          .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Agents von Hand starten (⌘⇧N)").on_click(() => run("mod.open", { name: "launcher" }))
          .child(svg("mods/launcher/icon.svg").size(12)).child("Starten")))
      .child(body)
      .when(sel > 0, (el) => el.child(actions));
  }

  textBtn(t, id, label, enabled, action, strong) {
    return div().id(id).h(24).px(8).flex().items_center().rounded(6).text_size(11.5)
      .bg(strong && enabled ? t.solid : t.raised).text_color(!enabled ? t.dim : strong ? t.solid_foreground : t.foreground)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => action(cx)))
      .child(label);
  }
}
