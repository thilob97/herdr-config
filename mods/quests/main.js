// Quests: tickets from GitHub issues, Asana, Trilium and local markdown files, the factory's
// signals. Every ticket goes on through the Auftrag dialog (mods/launcher): "Orchestrator"
// hands it to the team, "Start" starts agents by hand; both open the dialog with the ticket
// filled in. What the dialog started comes back here through shared "quests.handover"
// (written by the launcher, see its HANDOVER): Quests records it (data/quests/started.json),
// makes a local ticket the orchestrator's (by: orchestrator) and tells the source (comment /
// label / status, unless switched off; global dry run in the settings).
// props.view picks the face: "panel" (elric's side panel), "page" (the quests layout's three
// columns), "bar" (that layout's title bar), and the dialogs "settings" and "edit" {id?}.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { props, theme, run, spaces, agents, terminals, notify, openOverlay, closeOverlay, shared, setShared, window as host } from "herdr";
import * as store from "./store.js";
import * as ui from "./ui.js";
import { T_XS, T_S, T_M, T_L } from "./ui.js";
import { SOURCES, label, stage, load, writeback, place, errorText } from "./sources.js";

const WC = "mods/workspace-chrome";
const SPINNER = `${WC}/spinner.svg`;
// Copies (panel, page, dialogs) tell each other to re-read the files: { at, scope: "local" | "all" }. No data in it.
const REV = "quests.rev";
const bump = (scope) => setShared(REV, { at: Date.now(), scope });
// The page's selected ticket key ("github:owner/repo#1").
const SEL = "quests.selected";
// What the Auftrag dialog started for a ticket (see the header).
const HANDOVER = "quests.handover";
// Handovers to the orchestrator without a ticket yet (read by the Inbox, pruned here).
const PENDING = "quests.pending";
const keyOf = (t) => `${t.source}:${t.id}`;
// One language with the Team panel and the Inbox (B1): Geplant / In Arbeit / Prüfung / Fertig.
const STAGE_WORD = { todo: "Geplant", doing: "In Arbeit", review: "Prüfung", done: "Fertig" };
// A team ticket's status as a pipeline stage (unknown values run).
const pipeline = (s2) => (["todo", "review", "done"].includes(s2) ? s2 : "doing");

// ---- small pieces

function btn(t, id, text, onClick, { primary, danger, icon, disabled, tip } = {}) {
  const el = ui.button(t, id, text, (cx) => onClick(cx), { kind: primary ? "primary" : "secondary", enabled: !disabled, tip, icon });
  return danger && !disabled ? el.text_color(t.blocked) : el;
}

const iconBtn = (t, id, icon, tip, onClick, small = false) => ui.iconButton(t, id, icon, tip, (cx) => onClick(cx), { small });

function toggle(t, id, on, text, onClick, disabled = false) {
  return h_flex().id(id).gap(ui.GAP_M).items_center().cursor_pointer().when(disabled, (el) => el.opacity(0.45))
    .on_click((_e, cx) => { if (!disabled) onClick(cx); })
    .child(h_flex().flex_none().w(28).h(16).p(2).rounded(8).bg(on ? t.solid : t.border).when(on, (el) => el.justify_end())
      .child(div().size(12).rounded_full().bg(on ? t.solid_foreground : t.muted)))
    .child(div().flex_1().min_w(0).text_size(T_M).text_color(on ? t.foreground : t.muted).child(text));
}

const chip = (t, id, text, color) => div().id(id).flex_none().max_w(120).truncate().px(6).h(ui.H_CHIP).flex().items_center().rounded(4)
  .bg(t.raised).text_size(T_XS).text_color(color ?? t.muted).child(text);

const field = (t, text, el) => v_flex().gap(ui.GAP_XS).child(div().text_size(T_S).font_medium().text_color(t.muted).child(text)).child(el);

const styled = (t, el, focused = false) => el.h(ui.H_INPUT).px(10).rounded(6).border_1().border_color(focused ? t.accent : t.input).bg(t.background).text_size(T_M).text_color(t.foreground);

const spinner = (t, color) => svg(SPINNER).size(12).flex_none().text_color(color ?? t.working).spin(900);

// Ein Start als Identität: Avatar und Name aus agent-cards, sonst der Programmname.
// Das Modell steht nur im Tooltip; eine Kommandozeile wird nie angezeigt.
const KNOWN_PROGRAM = /^(omp|claude|codex|pi|hermes|aider)$/i;
function recordIdentity(t, rec, id) {
  const who = ui.identity(rec.terminal);
  const named = who.name && who.name !== rec.terminal ? who.name : null;
  const raw = String(rec.agent ?? "").trim();
  const key = raw.split(/\s+/)[0];
  const program = who.program?.name ?? (KNOWN_PROGRAM.test(key) ? key : null);
  const name = named || program || (raw && !/\s/.test(raw) ? raw : null);
  if (!name) return null;
  const model = rec.model ?? /--model[=\s]+([^\s]+)/.exec(raw)?.[1] ?? null;
  const p = who.program;
  const pic = who.avatar ? image(who.avatar).w(16).h(16).flex_none()
    : p?.icon ? (p.tint ? svg(p.icon).size(16).flex_none().text_color(t.muted) : image(p.icon).w(16).h(16).flex_none())
      : null;
  const tip = [name, program && program !== name ? program : null, model && `Modell ${model}`, rec.terminal].filter(Boolean).join(" · ");
  return h_flex().id(id).flex_none().max_w(190).h(16).gap(ui.GAP_XS).items_center().tooltip(tip)
    .when(Boolean(pic), (el) => el.child(pic))
    .child(div().min_w(0).truncate().text_size(T_S).text_color(t.foreground).child(name))
    .when(Boolean(program) && Boolean(named) && program !== name, (el) => el.child(div().flex_none().truncate().text_size(T_XS).text_color(t.dim).child(program)));
}

const area = (t, state, h, focused = false) => Textarea.new(state).h(h).px(10).py(6).rounded(6).border_1().border_color(focused ? t.accent : t.input).bg(t.background).text_size(T_M).text_color(t.foreground);

// A started quest now: its agent's status, or just whether its tab is still there.
function liveState(rec) {
  if (!rec) return null;
  const a = agents().find((x) => x.address === rec.terminal);
  // Handed to the orchestrator: a terminal without a tab of its own.
  const term = a ? null : terminals().find((x) => x.address === rec.terminal && x.state === "live");
  return { status: a?.status ?? term?.status ?? null, alive: Boolean(a || term) || spaces().some((s) => s.tabs.some((c) => c.id === rec.tab)) };
}

function lastRecord(list, key) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].key === key) return list[i];
  return null;
}

function openRecord(rec, fromPage) {
  if (fromPage) run("layout.switch", { name: "elric" });
  if (!rec.space) return run("terminal.peek", { terminal: rec.terminal });
  run("space.select", { id: rec.space });
  run("tab.select", { id: rec.tab });
}

// feat/… unless the labels say it's a fix; GitHub issues carry their number.
function branchFor(tk) {
  const fix = tk.labels.some((l) => /bug|fix|defect|hotfix/i.test(l));
  return `${fix ? "fix" : "feat"}/${tk.source === "github" ? `${tk.number}-` : ""}${store.slug(tk.title, 40) || "quest"}`;
}

const WRITEBACK = {
  github: "Kommentar ans Issue und mir zuweisen",
  asana: "Kommentar an die Asana-Aufgabe",
  trilium: "Labels questStatus=doing und questBranch an der Notiz setzen",
  plain: "Status des Tickets auf doing setzen",
};

// ---- panel and page: the tickets of every enabled source

class Board {
  constructor(view, cx) {
    this.view = view;
    this.settings = null;
    this.src = {}; // source key -> { tickets, error, note, loading }
    this.started = [];
    this.repos = [];
    this.filter = "";
    this.only = localStorage.getItem("only") || null;
    // Geplant / In Arbeit (mit Prüfung) / Alle — the same words the rows use (N6).
    const st = localStorage.getItem("stage");
    this.stage = st === "todo" || st === "doing" ? st : "all";
    this.folded = new Set();
    this.hovered = null;
    // The page comes back fresh after every layout switch: shared selection.
    this.selected = view === "page" ? shared(SEL) ?? null : null;
    this.gen = 0;
    this.input = InputState.new({ placeholder: "Quests filtern …" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().trim().toLowerCase(); cx.notify(); });
    this.focus = ui.focusFields();
    this.focus.track(this.input, "q-filter");
    this.rev = shared(REV)?.at ?? 0;
    this.reload(cx, true);
  }

  reload(cx, remote) {
    const gen = ++this.gen;
    cx.spawn(async (cx) => {
      const settings = await store.loadSettings();
      const started = await store.loadStarted();
      if (gen !== this.gen) return;
      this.settings = settings;
      this.started = started;
      cx.notify();
      await Promise.all(SOURCES.map(async ({ key }) => {
        if (!settings[key].enabled) { delete this.src[key]; return; }
        if (!remote && key !== "plain" && this.src[key]) return;
        this.src[key] = { ...(this.src[key] ?? { tickets: [] }), loading: true };
        cx.notify();
        let next;
        try {
          const r = await load(key, settings);
          if (r.repos) this.repos = r.repos;
          next = { tickets: r.tickets, error: r.error ? store.mask(r.error, settings) : null, note: r.note ?? null, loading: false };
        } catch (e) { next = { tickets: [], error: store.mask(errorText(e), settings), loading: false }; }
        if (gen !== this.gen) return;
        this.src[key] = next;
        cx.notify();
      }));
    });
  }

  all() { return SOURCES.flatMap((s) => this.src[s.key]?.tickets ?? []); }

  record(tk) { return lastRecord(this.started, keyOf(tk)); }

  // The team's ticket for this quest, when the orchestrator took it: by source URL, for a
  // local ticket by the same id. Its status is what Quests shows (B1, one language).
  team(tk) {
    return (shared("orchestra.tickets") ?? []).find((x) => (tk.source === "plain" ? x.id === tk.id : Boolean(tk.url) && x.source === tk.url)) ?? null;
  }

  // The stage a quest is in: the team's, when it has one, else its source's.
  stageOf(tk) { const team = this.team(tk); return team ? pipeline(team.status) : stage(tk); }

  matches(tk) {
    // Nur die lokale Quelle ist eine Fabrik-Liste: GitHub-, Asana- und Trilium-Quests
    // gehören keinem Workspace. Lokale Tickets ohne `space` (Altbestand) bleiben sichtbar.
    if (tk.source === "plain" && !ui.inScope(tk)) return false;
    const st = this.stageOf(tk);
    if (this.stage === "todo" && st !== "todo") return false;
    if (this.stage === "doing" && st !== "doing" && st !== "review" && !liveState(this.record(tk))?.alive) return false;
    if (!this.filter) return true;
    return [tk.title, tk.id, tk.project, tk.assignee, ...tk.labels].some((s) => String(s ?? "").toLowerCase().includes(this.filter));
  }

  // The space to start in: the one whose checkout is the issue's repo, else the one a hint names.
  suggest(tk) {
    if (tk.source === "github") return this.repos.find((r) => r.repo.toLowerCase() === tk.repo.toLowerCase())?.space ?? null;
    const hint = String(tk.repo || tk.project || "").trim().toLowerCase().replace(/\\/g, "/");
    if (!hint) return null;
    return spaces().find((s) => {
      const at = String(place(s) ?? "").toLowerCase().replace(/\\/g, "/");
      return s.name.toLowerCase() === hint || at === hint || at.endsWith(`/${hint}`);
    })?.id ?? null;
  }

  // The local checkout a ticket belongs to, as the orchestrator needs it.
  checkout(tk) {
    const sp = spaces().find((s) => s.id === this.suggest(tk));
    return { sp, repo: tk.source === "plain" && tk.repo ? tk.repo : sp ? place(sp) : null };
  }

  // The Auftrag dialog with this ticket: mode "team" (the orchestrator), "self", or
  // none (the dialog picks: team when an orchestrator runs).
  auftrag(tk, mode) {
    const { sp, repo } = this.checkout(tk);
    const where = repo ? `Lokaler Checkout: ${repo}${sp?.machine ? ` auf Maschine ${sp.machine}` : ""}` : "Lokaler Checkout: unbekannt, finde ihn über die Herdr-Spaces (herdr-app ls) oder frag mich.";
    const src = tk.source === "plain" ? `lokales Quests-Ticket ${tk.id}` : `${label(tk.source)} ${tk.source === "github" ? `#${tk.number} in ${tk.repo}` : tk.id}${tk.url ? ` (${tk.url})` : ""}`;
    const how = tk.source === "plain"
      ? `Es ist schon dein Ticket \`${tk.id}\` (hub ticket show ${tk.id}); setze repo/machine, falls sie fehlen.`
      : `Lege es mit \`hub ticket new --source "${tk.url || tk.id}" …\` an.`;
    const team = `Neues Ticket aus Quests: „${tk.title}“\nQuelle: ${src}\n${where}\n\n${(tk.body ?? "").trim().slice(0, 4000) || "(keine Beschreibung)"}\n\n---\n${how} Plane es, verteile es ans Team und gib es mir wie gewohnt erst geprüft zum Review.`;
    // {branch} and {folder} stay until start: only the dialog knows them.
    const message = store.fill(this.settings?.template ?? store.TEMPLATE, {
      title: tk.title, body: tk.body?.trim() || "(keine Beschreibung)", url: tk.source === "plain" ? "" : tk.url,
      source: label(tk.source), id: tk.source === "github" ? `#${tk.number} in ${tk.repo}` : tk.id, labels: tk.labels.join(", "),
    });
    const wb = WRITEBACK[tk.source];
    openOverlay({ mod: "launcher", kind: "dialog", width: 860, height: 680, props: {
      ...(mode ? { mode } : {}),
      ticket: {
        id: tk.id, title: tk.title, url: tk.url ?? "", source: tk.source, body: tk.body ?? "", repo: repo ?? tk.repo ?? "",
        quest: tk, team, message, tab: `${tk.source === "github" ? `#${tk.number} ` : ""}${tk.title}`.slice(0, 40), branch: branchFor(tk),
        space: sp?.id ?? null, writeback: wb ? `${wb}${this.settings?.dryRun ? " (Probelauf)" : ""}` : null,
      },
    } });
  }

  // Takes what the Auftrag dialog started out of the queue (first copy to render wins) and
  // records it: started.json, a local ticket becomes the orchestrator's, writeback.
  takeHandover(cx) {
    const queue = shared(HANDOVER) ?? [];
    if (!queue.length || !this.settings) return;
    setShared(HANDOVER, []);
    cx.spawn(async (cx) => {
      for (const h of queue) {
        const tk = h.quest;
        try {
          if (h.mode === "team") {
            const { sp, repo } = this.checkout(tk);
            if (tk.source === "plain") {
              const cur = await store.readPlain(tk.id);
              await store.savePlain(tk.id, { ...cur, extra: { ...cur.extra, by: "orchestrator" } });
            }
            await store.addStarted({ key: keyOf(tk), source: tk.source, id: tk.id, title: tk.title, url: tk.url, branch: "beim Orchestrator", worktree: false,
              folder: repo ?? "", machine: sp?.machine ?? null, space: null, tab: null, terminal: h.terminal, agent: "Orchestrator", at: h.at });
            setShared(PENDING, [...(shared(PENDING) ?? []).filter((p) => p.key !== keyOf(tk)),
              { key: keyOf(tk), id: tk.id, url: tk.url ?? "", source: tk.source, title: tk.title, at: h.at ?? Date.now() }]);
            notify({ title: "An den Orchestrator übergeben", body: tk.title, level: "success", timeout: 6000, action: { name: "tabs-graph.panel-team" } });
          } else {
            let lines = [], wrote = false;
            for (const s of h.starts ?? []) {
              const rec = { key: keyOf(tk), source: tk.source, id: tk.id, title: tk.title, url: tk.url, ...s, at: Date.now() };
              await store.addStarted(rec);
              // One writeback per start, even when it fanned out to several agents.
              if (h.writeback && !wrote) {
                wrote = true;
                try { lines = await writeback(tk, rec, this.settings); }
                catch (e) { notify({ title: "Quest gestartet, Writeback fehlgeschlagen", body: store.mask(errorText(e), this.settings).slice(0, 600), level: "warning", timeout: 15000 }); }
              }
            }
            const first = h.starts?.[0];
            notify({
              title: `Quest gestartet: ${tk.title}`.slice(0, 90), body: [`${first?.branch ?? ""} · ${(h.starts ?? []).map((s) => s.agent).join(", ")}`, ...lines].join("\n").slice(0, 900),
              level: "success", timeout: 12000, ...(first?.space ? { action: { name: "space.select", args: { id: first.space } } } : {}),
            });
          }
        } catch (e) { notify({ title: "Quest nicht festgehalten", body: store.mask(errorText(e), this.settings).slice(0, 600), level: "error", timeout: 15000 }); }
      }
      bump("local");
      cx.notify();
    });
  }

  select(tk, cx) {
    if (this.selected === keyOf(tk)) return;
    this.selected = keyOf(tk);
    setShared(SEL, this.selected);
    cx.notify();
  }

  // Drops pending handovers once the team has a ticket for them (or after 15 minutes).
  prunePending() {
    const list = shared(PENDING) ?? [];
    if (!list.length) return;
    const team = shared("orchestra.tickets") ?? [];
    const keep = list.filter((p) => Date.now() - (p.at ?? 0) < 15 * 60000
      && !team.some((x) => (p.source === "plain" ? x.id === p.id : Boolean(p.url) && x.source === p.url)));
    if (keep.length !== list.length) setShared(PENDING, keep);
  }

  sync(cx) {
    this.prunePending();
    const rev = shared(REV);
    if (rev && rev.at !== this.rev) { this.rev = rev.at; this.reload(cx, rev.scope === "all"); }
    if (this.view === "page") this.selected = shared(SEL) ?? null;
    this.takeHandover(cx);
  }

  // Status, its word and whether something runs for this ticket.
  // The word is the pipeline stage (one language with Team and Inbox); the icon shows
  // the agent's live status while one runs. Only a start without a team ticket says
  // "beendet", because the stage would claim work that is no longer there.
  look(t, tk, rec) {
    const live = liveState(rec);
    const st = this.stageOf(tk);
    const status = live?.alive ? live.status ?? "idle" : st === "review" ? "blocked" : st === "done" ? "done" : null;
    const ended = Boolean(rec) && !live?.alive && !this.team(tk) && st !== "done";
    return { status, live, text: ended ? "beendet" : STAGE_WORD[st], color: st === "review" ? t.blocked : st === "done" ? t.done : t.muted };
  }

  // One ticket: a two-line row; on hover the ways on (Orchestrator, Start, or its open tab).
  card(t, tk) {
    const k = keyOf(tk);
    const rec = this.record(tk);
    const l = this.look(t, tk, rec);
    const sel = this.view === "page" && this.selected === k;
    const hov = this.hovered === k;
    // A local ticket's project is its repo path: its last folder says enough here.
    // Ein Start zeigt seine Identität (Avatar, Name, Programm), nicht die Kommandozeile.
    const who = rec ? recordIdentity(t, rec, `q-who-${k}`) : null;
    const meta = [tk.source === "github" ? `#${tk.number}` : null, String(tk.project ?? "").replace(/\/+$/, "").split("/").pop(), tk.due && `bis ${tk.due}`, tk.assignee,
      rec?.branch].filter(Boolean).join(" · ") || label(tk.source);
    const alive = Boolean(l.live?.alive);
    const right = hov
      ? h_flex().flex_none().gap(ui.GAP_XS).items_center()
        // Running work: go to it, do not start it again (B2). Only then is there a primary button.
        .when(alive, (el) => el
          .child(btn(t, `open-${k}`, "Zum Agent", () => openRecord(rec, this.view === "page"), { primary: true, tip: "Zum laufenden Agent dieses Tickets" }))
          .child(iconBtn(t, `orch-${k}`, "mods/orchestra/icon.svg", "An Orchestrator: was noch fehlt (er plant, verteilt und bringt es geprüft zur Abnahme)", () => this.auftrag(tk, "team"), true)))
        .when(!alive, (el) => el
          .child(iconBtn(t, `orch-${k}`, "mods/orchestra/icon.svg", "Orchestrator: Auftrag ans Team (er plant, verteilt und bringt es geprüft zur Abnahme)", () => this.auftrag(tk, "team"), true))
          .child(iconBtn(t, `start-${k}`, "mods/orchestra/icons/play.svg", "Start: selbst Agents starten (Branch, Worktree, Agent)", () => this.auftrag(tk, "self"), true)))
      : div().flex_none().text_size(T_S).text_color(l.color).child(l.text);
    return v_flex().id(`q-${k}`).h(ui.H_ROW2).flex_none().px(8).gap(2).justify_center().rounded(6).cursor_pointer()
      .when(sel, (el) => el.bg(t.selected)).when(!sel, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((on, cx) => { if (on) this.hovered = k; else if (this.hovered === k) this.hovered = null; cx.notify(); })
      .on_click((_e, cx) => (this.view === "page" ? this.select(tk, cx) : this.auftrag(tk)))
      .child(h_flex().h(ui.H_BTN_S).gap(ui.GAP_M).items_center()
        .child(l.status ? ui.statusIcon(t, l.status) : div().size(12).flex_none())
        .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(this.stageOf(tk) === "done" ? t.muted : t.foreground).child(tk.title))
        .child(right))
      .child(h_flex().pl(20).gap(ui.GAP_XS).items_center().min_w(0)
        .when(Boolean(who), (el) => el.child(who))
        .child(div().flex_shrink(1).min_w(0).truncate().text_size(T_S).text_color(t.muted).child(meta))
        .children(tk.labels.slice(0, 3).map((x, i) => chip(t, `${k}-l${i}`, x))));
  }

  list(t) {
    const out = [];
    for (const { key } of SOURCES) {
      const S = this.src[key];
      if (!S || (this.only && this.only !== key)) continue;
      const shown = S.tickets.filter((tk) => this.matches(tk));
      const open = !this.folded.has(key);
      out.push(ui.sectionHeader(t, label(key), {
        id: `g-${key}`, count: shown.length, open, px: 8,
        onClick: (cx) => { open ? this.folded.add(key) : this.folded.delete(key); cx.notify(); },
        right: S.loading ? spinner(t) : key === "plain" ? iconBtn(t, "g-plain-new", `${WC}/plus.svg`, "Neues lokales Ticket", () => openEdit(), true) : null,
      }));
      if (!open) continue;
      if (S.error) {
        out.push(h_flex().id(`err-${key}`).h(ui.H_ROW).flex_none().px(8).gap(ui.GAP_M).items_center().rounded(6)
          .text_size(T_S).text_color(t.muted).tooltip(S.error)
          .child(ui.statusIcon(t, "error"))
          .child(div().flex_1().min_w(0).truncate().child(S.error.split("\n")[0])));
      }
      out.push(...shown.map((tk) => this.card(t, tk)));
      if (!shown.length && !S.loading && !S.error) out.push(div().px(8).child(ui.empty(t, S.note ?? (S.tickets.length ? "Nichts passt zum Filter." : "Keine offenen Tickets."), { row: true })));
    }
    if (!out.length) out.push(this.settings ? ui.empty(t, "Keine Quelle eingeschaltet: öffne die Einstellungen.", { icon: "mods/quests/icon.svg" }) : div().p(ui.GAP_M).child(ui.loading(t)));
    return out;
  }

  stageSeg(t) {
    return ui.segment(t, "q-stage", [
      { value: "todo", label: "Geplant", tip: "Noch nicht begonnen" },
      { value: "doing", label: "In Arbeit", tip: "In Arbeit und Prüfung, oder mit laufendem Agent" },
      { value: "all", label: "Alle" },
    ], this.stage, (value, cx) => { this.stage = value; localStorage.setItem("stage", value); cx.notify(); });
  }

  header(t, title) {
    return ui.panelHeader(t, title, [ui.spaceChip(t),
      iconBtn(t, "h-new", `${WC}/plus.svg`, "Neues lokales Ticket", () => openEdit()),
      iconBtn(t, "h-refresh", "mods/orchestra/icons/restart.svg", "Neu laden", (cx) => this.reload(cx, true)),
      iconBtn(t, "h-settings", `${WC}/settings.svg`, "Quellen und Zugangsdaten", () => openSettings()),
      ...(this.view === "panel" ? [btn(t, "h-page", "Seite", () => run("layout.switch", { name: "quests" }), { tip: "Quests als ganze Seite (Layout quests, ⌃⇧Q)" })] : []),
    ].filter(Boolean));
  }

  filterRow(t) {
    return h_flex().px(ui.INSET_PANEL).pt(ui.GAP_L).pb(ui.GAP_S).gap(ui.GAP_M).flex_none().items_center()
      .child(div().flex_1().min_w(0).child(ui.inputBox(t, "q-filter", Input.new(this.input), { focused: this.focus.has("q-filter") })))
      .child(this.stageSeg(t));
  }

  render(cx) {
    this.sync(cx);
    const t = theme();
    const box = (id) => v_flex().id(id).min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border);
    const listCol = v_flex().id("q-list").flex_1().min_h(0).px(6).pb(ui.GAP_M).overflow_y_scrollbar().children(this.list(t));
    if (this.view === "panel") {
      return box("quests").size_full().text_color(t.foreground).text_size(T_M)
        .child(this.header(t, "Quests")).child(this.filterRow(t)).child(listCol);
    }
    return h_flex().id("quests-page").size_full().min_h(0).gap(ui.GAP_M).text_color(t.foreground).text_size(T_M)
      .child(box("q-left").w(240).flex_none().h_full().child(this.sourcesCol(t)))
      .child(box("q-mid").flex_1().min_w(280).h_full().child(this.header(t, "Tickets")).child(this.filterRow(t)).child(listCol))
      .child(box("q-right").w(500).flex_none().h_full().child(this.detail(t)));
  }

  sourcesCol(t) {
    const row = (key, text, S, enabled) => {
      const on = this.only === key;
      const count = key ? (S?.tickets.length ?? 0) : this.all().length;
      return h_flex().id(`src-${key ?? "all"}`).h(ui.H_ROW).flex_none().px(8).gap(ui.GAP_M).items_center().rounded(6).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => {
          if (key && !enabled) return openSettings();
          this.only = key; localStorage.setItem("only", key ?? ""); cx.notify();
        })
        .child(ui.statusIcon(t, !key || enabled ? (S?.error ? "error" : "done") : "idle"))
        .child(div().flex_1().text_size(T_M).text_color(on ? t.foreground : enabled || !key ? t.muted : t.dim).child(text))
        .when(Boolean(S?.loading), (el) => el.child(spinner(t)))
        .child(div().text_size(T_XS).text_color(t.dim).child(key && !enabled ? "aus" : String(count)));
    };
    const recent = this.started.slice(-12).reverse();
    return v_flex().size_full().min_h(0)
      .child(ui.panelHeader(t, "Quellen"))
      .child(v_flex().px(6).pt(ui.GAP_M).gap(2).flex_none()
        .child(row(null, "Alle Quellen", null, true))
        .children(SOURCES.map((s) => row(s.key, s.label, this.src[s.key], Boolean(this.settings?.[s.key]?.enabled)))))
      .child(h_flex().px(ui.INSET_PANEL).py(ui.GAP_M).gap(ui.GAP_S).flex_none()
        .child(btn(t, "l-new", "Neues Ticket", () => openEdit(), { icon: `${WC}/plus.svg`, tip: "Neues lokales Ticket" }))
        .child(btn(t, "l-settings", "Quellen", () => openSettings(), { icon: `${WC}/settings.svg`, tip: "Quellen und Zugangsdaten" })))
      .child(div().px(ui.INSET_PANEL).child(ui.sectionHeader(t, "Gestartet", { count: recent.length })))
      .child(v_flex().id("l-started").flex_1().min_h(0).px(6).pb(ui.GAP_M).overflow_y_scrollbar()
        .when(!recent.length, (el) => el.child(div().px(8).child(ui.empty(t, "Noch nichts gestartet.", { row: true }))))
        .children(recent.map((rec) => {
          const live = liveState(rec);
          return v_flex().id(`r-${rec.at}`).h(ui.H_ROW2).flex_none().px(8).justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .tooltip(live?.alive ? "Zeigen" : "Nicht mehr da")
            .on_click(() => { if (live?.alive) openRecord(rec, true); })
            .child(h_flex().gap(ui.GAP_M).items_center()
              .child(live?.alive ? ui.statusIcon(t, live.status ?? "idle") : div().size(12).flex_none())
              .child(div().flex_1().min_w(0).truncate().text_size(T_M).text_color(live?.alive ? t.foreground : t.dim).child(rec.title)))
            .child(div().pl(20).truncate().text_size(T_S).text_color(t.muted)
              .child(`${rec.branch} · ${live?.status ? ui.STATUS_WORD[live.status] : live?.alive ? "läuft" : "beendet"}`));
        })));
  }

  detail(t) {
    const tk = this.all().find((x) => keyOf(x) === this.selected);
    if (!tk) return ui.empty(t, "Wähle ein Ticket: hier stehen seine Beschreibung und die Wege weiter.", { icon: "mods/quests/icon.svg" });
    const k = keyOf(tk);
    const recs = this.started.filter((r) => r.key === k).reverse();
    const meta = [label(tk.source), tk.source === "github" ? `#${tk.number} · ${tk.repo}` : tk.source === "plain" ? `${tk.id}.md` : tk.id,
      STAGE_WORD[this.stageOf(tk)], tk.assignee, tk.due && `bis ${tk.due}`, tk.source !== "github" && String(tk.project ?? "").replace(/\/+$/, "").split("/").pop()].filter(Boolean);
    return v_flex().size_full().min_h(0)
      .child(ui.panelHeader(t, "Ticket", [
        ...(tk.source === "plain" ? [iconBtn(t, "d-edit", `${WC}/square-pen.svg`, "Lokales Ticket bearbeiten", () => openEdit(tk.id))] : []),
        ...(tk.source !== "plain" && tk.url ? [iconBtn(t, "d-url", "mods/orchestra/icons/open.svg", `Im Browser öffnen: ${tk.url}`, (cx) => cx.open_url(tk.url))] : []),
      ]))
      .child(v_flex().id("q-detail").flex_1().min_h(0).overflow_y_scrollbar().px(ui.INSET_PANEL).py(ui.GAP_L).gap(ui.GAP_L)
        .child(div().text_size(T_L).font_semibold().child(tk.title))
        .child(h_flex().flex_wrap().gap(ui.GAP_XS).items_center()
          .child(div().text_size(T_S).text_color(t.muted).child(meta.join(" · ")))
          .children(tk.labels.map((x, i) => chip(t, `d-l${i}`, x))))
        .child(h_flex().gap(ui.GAP_M).items_center()
          .when(Boolean(liveState(this.record(tk))?.alive), (el) => el
            .child(btn(t, "d-open", "Zum Agent", () => openRecord(this.record(tk), true), { primary: true, tip: "Zum laufenden Agent dieses Tickets" }))
            .child(btn(t, "d-orch", "An Orchestrator", () => this.auftrag(tk, "team"), { tip: "Was noch fehlt, an das Team geben" })))
          .when(!liveState(this.record(tk))?.alive, (el) => el
            .child(btn(t, "d-orch", "An Orchestrator", () => this.auftrag(tk, "team"), { primary: true, tip: "Auftrag ans Team: er plant, verteilt und bringt es geprüft zur Abnahme" }))
            .child(btn(t, "d-start", "Start", () => this.auftrag(tk, "self"), { tip: "Selbst Agents starten: Branch, Worktree, Agent" }))))
        .children(recs.map((rec) => {
          const l = this.look(t, tk, rec);
          const who = recordIdentity(t, rec, `dr-who-${rec.at}`);
          return h_flex().id(`dr-${rec.at}`).h(ui.H_ROW).flex_none().px(8).gap(ui.GAP_M).items_center().rounded(6).bg(t.surface)
            .child(l.live?.alive ? ui.statusIcon(t, l.status ?? "idle") : div().size(12).flex_none())
            .when(Boolean(who), (el) => el.child(who))
            .child(div().flex_1().min_w(0).truncate().text_size(T_S).text_color(t.muted).child(`${rec.branch} · ${rec.machine ?? "dieser Rechner"} · ${l.text}`))
            .when(Boolean(l.live?.alive), (el) => el.child(iconBtn(t, `dr-open-${rec.at}`, "mods/orchestra/icons/open.svg", "Öffnen", () => openRecord(rec, true), true)))
            .child(iconBtn(t, `dr-x-${rec.at}`, `${WC}/x.svg`, "Diesen Start vergessen (Worktree und Tab bleiben)", (cx) => cx.spawn(async () => { await store.forgetStarted(rec.at); bump("local"); }), true));
        }))
        .child(div().rounded(8).bg(t.surface).border_1().border_color(t.border).px(12).py(ui.GAP_M).text_size(T_M)
          .child(tk.body?.trim() ? TextView.markdown(`md-${k}`, tk.body).selectable(true) : div().text_color(t.dim).child("Keine Beschreibung."))));
  }
}

const openEdit = (id) => openOverlay({ mod: "quests", kind: "dialog", width: 620, height: 0.85, props: { view: "edit", id: id ?? null } });
const openSettings = () => openOverlay({ mod: "quests", kind: "dialog", width: 620, height: 0.9, props: { view: "settings" } });

// ---- dialogs

const closeSelf = () => closeOverlay(props().overlay);

function dialog(t, id, title, body, footer) {
  return v_flex().id(id).size_full().min_h(0).p(ui.GAP_XL).gap(ui.GAP_L).bg(t.popover).text_color(t.foreground).text_size(T_M)
    .child(ui.dialogHeader(t, title, closeSelf))
    .child(v_flex().id(`${id}-body`).flex_1().min_h(0).overflow_y_scrollbar().gap(ui.GAP_L).child(body))
    .when(Boolean(footer), (el) => el.child(h_flex().flex_none().gap(ui.GAP_M).items_center().justify_end().child(footer)));
}

class Settings {
  constructor(cx) {
    this.s = null;
    this.error = "";
    this.clear = new Set();
    const I = (placeholder) => InputState.new({ placeholder });
    this.in = {
      ghRepos: I("owner/repo weiteres/repo"), asanaToken: I("Personal Access Token"), asanaApi: I(store.DEFAULTS.asana.api),
      asanaWs: I("Workspace-GID (leer: dein erster)"), asanaProjects: I("Projekt-GIDs (leer: mir zugewiesene Aufgaben)"),
      triliumUrl: I("http://localhost:8080"), triliumToken: I("ETAPI-Token"), triliumQuery: I("#quest"),
    };
    this.in.asanaToken.set_masked(true);
    this.in.triliumToken.set_masked(true);
    this.template = TextareaState.new({ rows: 8 });
    this.focus = ui.focusFields();
    for (const [k, state] of Object.entries(this.in)) this.focus.track(state, `s-${k}`);
    this.focus.track(this.template, "s-template");
    cx.spawn(async (cx) => {
      const s = (this.s = await store.loadSettings());
      this.in.ghRepos.set_value(s.github.repos);
      this.in.asanaApi.set_value(s.asana.api);
      this.in.asanaWs.set_value(s.asana.workspace);
      this.in.asanaProjects.set_value(s.asana.projects);
      this.in.triliumUrl.set_value(s.trilium.url);
      this.in.triliumQuery.set_value(s.trilium.query);
      this.template.set_value(s.template);
      cx.notify();
    });
  }

  save(cx) {
    const s = this.s;
    if (!s) return;
    const v = (k) => this.in[k].value().trim();
    // Typed replaces, empty keeps, Clear removes; the saved token never comes back into an input.
    const token = (k, src) => v(k) || (this.clear.has(src) ? "" : s[src].token);
    const url = (x) => !x || /^https?:\/\/[^\s]+$/.test(x);
    if (!url(v("asanaApi")) || !url(v("triliumUrl"))) { this.error = "URLs beginnen mit http:// oder https://."; cx.notify(); return; }
    const next = {
      ...s, template: this.template.value().trim() || store.TEMPLATE,
      github: { ...s.github, repos: v("ghRepos") },
      asana: { ...s.asana, token: token("asanaToken", "asana"), api: v("asanaApi") || store.DEFAULTS.asana.api, workspace: v("asanaWs"), projects: v("asanaProjects") },
      trilium: { ...s.trilium, token: token("triliumToken", "trilium"), url: v("triliumUrl"), query: v("triliumQuery") || "#quest" },
    };
    cx.spawn(async (cx) => {
      try { await store.saveSettings(next); bump("all"); closeSelf(); }
      catch (e) { this.error = errorText(e); cx.notify(); }
    });
  }

  render() {
    const t = theme();
    const s = this.s;
    if (!s) return dialog(t, "q-settings", "Quellen", ui.loading(t));
    const flip = (obj, k) => (cx) => { obj[k] = !obj[k]; cx.notify(); };
    const input = (k) => styled(t, Input.new(this.in[k]), this.focus.has(`s-${k}`));
    const tokenField = (k, src, text) => {
      const saved = Boolean(s[src].token) && !this.clear.has(src);
      return field(t, `${text}${saved ? " · gespeichert, tippen ersetzt" : ""}`, h_flex().gap(ui.GAP_S).items_center()
        .child(input(k).flex_1())
        .when(saved, (el) => el.child(btn(t, `clear-${src}`, "Löschen", (cx) => { this.clear.add(src); this.in[k].set_value(""); cx.notify(); }, { danger: true }))));
    };
    const section = (id, text, enabled, flipIt, body) => v_flex().id(id).gap(ui.GAP_M).p(ui.INSET_CARD).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(h_flex().items_center().child(div().flex_1().text_size(T_L).font_semibold().child(text)).child(toggle(t, `${id}-on`, enabled, enabled ? "an" : "aus", flipIt)))
      .when(enabled, (el) => el.child(body));
    const body = v_flex().gap(ui.GAP_L)
      .child(div().text_size(T_S).text_color(t.muted).child(`Nur auf diesem Rechner gespeichert, in ${store.dir()}/settings.json (git-ignoriert). Tokens werden nie wieder angezeigt.`))
      .child(section("s-gh", "GitHub-Issues (gh CLI)", s.github.enabled, flip(s.github, "enabled"), v_flex().gap(ui.GAP_M)
        .child(field(t, "Weitere Repositories (die GitHub-Checkouts deiner Spaces sind immer dabei)", input("ghRepos")))
        .child(toggle(t, "s-gh-mine", s.github.mine, "Nur mir zugewiesene Issues", flip(s.github, "mine")))))
      .child(section("s-asana", "Asana", s.asana.enabled, flip(s.asana, "enabled"), v_flex().gap(ui.GAP_M)
        .child(tokenField("asanaToken", "asana", "Personal Access Token"))
        .child(field(t, "Workspace", input("asanaWs")))
        .child(field(t, "Projekte", input("asanaProjects")))
        .child(field(t, "API-URL", input("asanaApi")))))
      .child(section("s-tri", "Trilium (ETAPI)", s.trilium.enabled, flip(s.trilium, "enabled"), v_flex().gap(ui.GAP_M)
        .child(field(t, "Server-URL", input("triliumUrl")))
        .child(tokenField("triliumToken", "trilium", "ETAPI-Token"))
        .child(field(t, "Suche (Notizen, die Quests sind)", input("triliumQuery")))))
      .child(section("s-plain", "Lokale Tickets (Markdown-Dateien)", s.plain.enabled, flip(s.plain, "enabled"),
        div().text_size(T_S).text_color(t.muted).child(`${store.dir()}/tickets/*.md`)))
      .child(v_flex().gap(ui.GAP_M).p(ui.INSET_CARD).rounded(8).bg(t.surface).border_1().border_color(t.border)
        .child(div().text_size(T_L).font_semibold().child("Starten"))
        .child(toggle(t, "s-dry", s.dryRun, "Writeback als Probelauf: zeigen, was geschrieben würde, nichts ändern", flip(s, "dryRun")))
        .child(field(t, "Vorlage der ersten Nachricht: {title} {body} {url} {source} {id} {labels}, beim Start {branch} {folder}", area(t, this.template, 170, this.focus.has("s-template")))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).text_size(T_M).child(this.error)));
    return dialog(t, "q-settings", "Quellen", body, h_flex().gap(ui.GAP_M)
      .child(btn(t, "s-cancel", "Abbrechen", closeSelf))
      .child(btn(t, "s-save", "Speichern", (cx) => this.save(cx), { primary: true })));
  }
}

class Edit {
  constructor(cx) {
    this.id = props()?.id ?? null;
    this.status = "todo";
    this.error = "";
    this.asking = false;
    this.ready = !this.id;
    this.title = InputState.new({ placeholder: "Was zu tun ist" });
    this.repo = InputState.new({ placeholder: "Space-Name, Repo-Ordner oder Pfad (optional)" });
    this.labels = InputState.new({ placeholder: "bug, ui (optional)" });
    this.due = InputState.new({ placeholder: "JJJJ-MM-TT (optional)" });
    this.body = TextareaState.new({ rows: 12, placeholder: "Markdown: was, warum, Abnahmekriterien …" });
    this.focus = ui.focusFields();
    for (const [id, state] of [["e-title", this.title], ["e-repo", this.repo], ["e-labels", this.labels], ["e-due", this.due], ["e-body", this.body]]) this.focus.track(state, id);
    if (this.id) {
      cx.spawn(async (cx) => {
        try {
          const tk = await store.readPlain(this.id);
          this.title.set_value(tk.title);
          this.repo.set_value(tk.repo);
          this.labels.set_value(tk.labels.join(", "));
          this.due.set_value(tk.due ?? "");
          this.body.set_value(tk.body);
          this.extra = tk.extra ?? {};
          this.status = stage(tk);
          this.ready = true;
        } catch (e) { this.error = errorText(e); }
        cx.notify();
      });
    } else this.title.focus();
  }

  save(cx) {
    const title = this.title.value().trim();
    if (!title) { this.error = "Gib ihm einen Titel."; cx.notify(); return; }
    const t = {
      title, status: this.status, repo: this.repo.value().trim(), due: this.due.value().trim(),
      labels: this.labels.value().split(",").map((l) => l.trim()).filter(Boolean), body: this.body.value(), extra: this.extra ?? {},
    };
    cx.spawn(async (cx) => {
      try { await store.savePlain(this.id, t); bump("local"); closeSelf(); }
      catch (e) { this.error = errorText(e); cx.notify(); }
    });
  }

  remove(cx) {
    cx.spawn(async (cx) => {
      try { await store.deletePlain(this.id); bump("local"); closeSelf(); }
      catch (e) { this.error = errorText(e); cx.notify(); }
    });
  }

  render() {
    const t = theme();
    const body = v_flex().gap(ui.GAP_L)
      .child(field(t, "Titel", styled(t, Input.new(this.title), this.focus.has("e-title"))))
      .child(field(t, "Status", h_flex().child(ui.segment(t, "e-status", ["todo", "doing", "done"].map((v) => ({ value: v, label: STAGE_WORD[v] })),
        this.status, (v, cx) => { this.status = v; cx.notify(); }))))
      .child(field(t, "Repository-Hinweis", styled(t, Input.new(this.repo), this.focus.has("e-repo"))))
      .child(h_flex().gap(ui.GAP_M)
        .child(div().flex_1().child(field(t, "Labels", styled(t, Input.new(this.labels), this.focus.has("e-labels")))))
        .child(div().w(170).child(field(t, "Fällig", styled(t, Input.new(this.due), this.focus.has("e-due"))))))
      .child(field(t, "Beschreibung", area(t, this.body, 220, this.focus.has("e-body"))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).text_size(T_M).child(this.error)));
    const footer = h_flex().gap(ui.GAP_M).flex_1().items_center()
      .when(Boolean(this.id) && !this.asking, (el) => el.child(btn(t, "e-del", "Löschen", (cx) => { this.asking = true; cx.notify(); }, { danger: true })))
      .when(this.asking, (el) => el.child(div().text_size(T_M).text_color(t.blocked).child("Ticket-Datei löschen?"))
        .child(btn(t, "e-del-yes", "Löschen", (cx) => this.remove(cx), { danger: true }))
        .child(btn(t, "e-del-no", "Behalten", (cx) => { this.asking = false; cx.notify(); })))
      .child(div().flex_1())
      .child(btn(t, "e-cancel", "Abbrechen", closeSelf))
      .child(btn(t, "e-save", "Speichern", (cx) => this.save(cx), { primary: true, disabled: !this.ready }));
    return dialog(t, "q-edit", this.id ? "Lokales Ticket bearbeiten" : "Neues lokales Ticket", body, footer);
  }
}

// The quests layout's title bar: back to elric and, where the system draws none, the window buttons.
class Bar {
  render() {
    const t = theme();
    const w = host();
    const win = (id, icon, tip, cmd) => iconBtn(t, id, icon, tip, () => run(cmd));
    return h_flex().size_full().px(ui.INSET_PANEL).gap(ui.GAP_M).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().text_size(T_L).font_semibold().text_color(t.foreground).child("Quests"))
      .child(div().text_size(T_S).text_color(t.muted).child("Ticket wählen · ans Team geben oder selbst starten"))
      .child(div().flex_1())
      .child(btn(t, "bar-back", "Zurück zu Elric", () => run("layout.switch", { name: "elric" }), { icon: `${WC}/chevron-left.svg`, tip: "Zurück zum Layout elric (⌃⇧Q)" }))
      .when(Boolean(w?.buttons), (el) => el
        .child(win("minimize", "mods/tabs-graph/win-min.svg", "Minimieren", "window.minimize"))
        .child(win("maximize", `mods/tabs-graph/${w.maximized ? "win-restore" : "win-max"}.svg`, "Maximieren", "window.maximize"))
        .child(win("close-window", "mods/tabs-graph/win-close.svg", "Schließen", "window.close")));
  }
}

export default class Quests extends View {
  init(_props, cx) {
    const view = props()?.view ?? "panel";
    this.screen = view === "bar" ? new Bar()
      : view === "settings" ? new Settings(cx)
      : view === "edit" ? new Edit(cx)
      : new Board(view === "page" ? "page" : "panel", cx);
  }

  render(cx) {
    return this.screen.render(cx);
  }
}
