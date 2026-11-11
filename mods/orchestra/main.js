// Team: every agent on every space and machine as a graph: who started whom
// (hc run sets `parent`), grouped by space, with status and how long it has
// been in it. Select agents to message them all at once, interrupt them, or
// watch them as a team. Teams (shared "orchestra.groups", also made by the
// launcher) show on top; the status bar watches them and says when a whole
// team is finished, so that works while this panel is hidden.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, run, hc, theme, shared, setShared, openOverlay } from "herdr";

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
        title: plain(a?.title ?? x.title ?? ""), program: a?.program ?? x.program, pane: a?.pane ?? null,
        space: a?.space_name ?? where[0] ?? "", tab: a?.tab_name ?? where[1] ?? "", machine: machineOf(addr),
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
      groups.get(key).rows.push({ n: r, lines: [] }, ...walk({ n: r }, []));
    }
    return [...groups.values()].sort((a, b) => (a.machine ?? "").localeCompare(b.machine ?? "") || a.space.localeCompare(b.space));
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

  nodeRow(t, row) {
    const n = row.n, on = this.selected.has(n.address), hover = this.hovered === n.address;
    return h_flex().id(`or-${n.address}`).h(30).flex_none().pl(6).pr(4).gap(0).items_center().rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((h, cx) => { this.hovered = h ? n.address : this.hovered === n.address ? null : this.hovered; cx.notify(); })
      .on_click((e, cx) => {
        if (e.click_count === 2) return this.open(n);
        if (on) this.selected.delete(n.address); else this.selected.add(n.address);
        cx.notify();
      })
      .child(div().mr(7).child(this.check(t, on)))
      .children(row.lines.map((l) => div().self_start().mt(-2).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .child(div().mr(6).child(this.status(t, n.status)))
      .child(icon(n.program, 13, t.muted) ? div().mr(6).child(icon(n.program, 13, t.muted)) : div())
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_none().max_w(120).truncate().text_size(12).text_color(t.foreground).child(n.name))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(n.title || n.tab))))
      .child(hover
        ? h_flex().gap(1).flex_none()
          .child(this.iconBtn(t, `or-go-${n.address}`, `${WC}/terminal.svg`, n.pane ? "Hingehen" : "Ansehen (Peek)", () => this.open(n)))
          .child(this.iconBtn(t, `or-rv-${n.address}`, "mods/review/icon.svg", "Review", () =>
            openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680, props: { terminal: n.address } })))
          .child(this.iconBtn(t, `or-int-${n.address}`, `${WC}/square.svg`, "Unterbrechen", () => hc(["interrupt", n.address]).catch(() => {})))
        : div().flex_none().text_size(10.5).text_color(t[n.status] ?? t.dim).child(`${WORD[n.status] ?? ""}${n.since ? ` ${ago(n.since)}` : ""}`));
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

  render(cx) {
    const t = theme();
    const nodes = this.nodes();
    for (const a of [...this.selected]) if (!nodes.some((n) => n.address === a)) this.selected.delete(a);
    const count = (s) => nodes.filter((n) => n.status === s).length;
    const graph = this.graph(nodes);
    const groups = this.groups();
    const sel = this.selected.size;
    const internal = graph.flatMap((g) => g.rows).filter((r) => r.s && r.s.status === "running").length;

    const summary = h_flex().gap(10).items_center().text_size(11)
      .child(h_flex().gap(4).items_center().child(this.status(t, "blocked")).child(div().text_color(t.blocked).child(String(count("blocked")))))
      .child(h_flex().gap(4).items_center().child(this.status(t, "working")).child(div().text_color(t.working).child(String(count("working")))))
      .child(h_flex().gap(4).items_center().child(this.status(t, "done")).child(div().text_color(t.done).child(String(count("done")))))
      .child(h_flex().gap(4).items_center().child(this.status(t, "idle")).child(div().text_color(t.dim).child(String(nodes.length - count("blocked") - count("working") - count("done")))))
      .when(internal > 0, (el) => el.child(div().text_color(t.working).tooltip("omp-interne Subagents, die gerade laufen").child(`+${internal} intern`)));

    const body = v_flex().id("or-body").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).gap(8)
      .when(groups.length > 0, (el) => el.child(div().pt(4).text_size(10.5).font_semibold().text_color(t.dim).child("TEAMS"))
        .children(groups.map((g) => this.groupCard(t, g, nodes))))
      .child(div().pt(4).text_size(10.5).font_semibold().text_color(t.dim).child("GRAPH · WER HAT WEN GESTARTET"))
      .when(!graph.length, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child("Keine Agents. Starte welche mit „Starten“ (⌘⇧N).")))
      .children(graph.map((g) => v_flex().gap(1)
        .child(h_flex().px(6).pt(4).pb(2).gap(6).items_center().text_size(11).text_color(t.dim)
          .child(svg(`${WC}/${g.machine ? "server" : "monitor"}.svg`).size(11))
          .child(div().truncate().child(`${g.space || "ohne Space"}${g.machine ? ` · ${g.machine}` : ""}`)))
        .children(g.rows.map((r) => (r.s ? this.ompRow(t, r) : this.nodeRow(t, r))))));

    const actions = v_flex().flex_none().p(8).gap(6).border_t(1).border_color(t.border).bg(t.chrome)
      .when(Boolean(this.note), (el) => el.child(div().text_size(11).truncate().text_color(this.note.ok ? t.done : t.blocked).child(this.note.text)))
      .child(h_flex().h(30).px(9).gap(6).items_center().rounded(7).border_1().border_color(sel ? t.input : t.border).bg(t.background)
        .child(div().flex_none().text_size(11).text_color(t.dim).child(sel ? `${sel} →` : "0 →"))
        .child(Input.new(this.message).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().gap(4).items_center().flex_wrap()
        .child(this.textBtn(t, "or-send", this.busy ? "sende…" : "Senden", sel > 0 && !this.busy, (cx) => this.broadcast(cx), true))
        .child(this.textBtn(t, "or-team", "Als Team beobachten", sel > 0, () => this.addGroup()))
        .child(this.textBtn(t, "or-int", "Unterbrechen", sel > 0 && !this.busy, (cx) => this.interrupt(cx)))
        .child(this.textBtn(t, "or-clear", sel ? "Leeren" : "Alle", nodes.length > 0, (cx) => {
          if (sel) this.selected.clear(); else for (const n of nodes) this.selected.add(n.address);
          cx.notify();
        }))
        .child(h_flex().id("or-force").gap(5).items_center().cursor_pointer().on_click((_e, cx) => { this.force = !this.force; cx.notify(); })
          .child(this.check(t, this.force)).child(div().text_size(11).text_color(t.muted).child("auch wartende"))));

    return v_flex().id("orchestra").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/orchestra/icon.svg").size(14).text_color(t.muted))
        .child(div().font_semibold().text_size(13).child("Team"))
        .child(div().flex_1())
        .child(summary)
        .child(div().id("or-launch").ml(4).h(24).px(8).flex().items_center().gap(5).rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(11.5)
          .cursor_pointer().hover((s) => s.opacity(0.85)).on_click(() => run("mod.open", { name: "launcher" }))
          .child(svg("mods/launcher/icon.svg").size(12)).child("Starten")))
      .child(body)
      .child(actions);
  }

  textBtn(t, id, label, enabled, action, strong) {
    return div().id(id).h(24).px(8).flex().items_center().rounded(6).text_size(11.5)
      .bg(strong && enabled ? t.solid : t.raised).text_color(!enabled ? t.dim : strong ? t.solid_foreground : t.foreground)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => action(cx)))
      .child(label);
  }
}
