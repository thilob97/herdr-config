// Fabric in Herdrs Seitenleiste: Orchestrator zuerst, Agenten eingerückt,
// mit Rolle, Status und Laufzeit. Klick öffnet das Terminal, der Ticket-Chip
// das Ticket im Fabric-Fenster. Reine Auswahl-/Textlogik: model.js.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  agents, appHome, checking, exec, fonts, openOverlay, run, setAgentOrder,
  setShared, settings, shared, spaces, terminals, theme,
} from "herdr";
import * as model from "./model.js";
import { createReader } from "./db.js";

const db = createReader(exec);

// Spiegel von mods/fabric/ui.js: gleiche Schriftgrößen, Abstände, Radien und
// Größen; Herdr erlaubt keine mod-übergreifenden Importe.
const FONT = { xs: 11, s: 12, m: 13 };
const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
const RADIUS = { s: 6, m: 8, l: 12 };
const SIZE = { rowTall: 44, nav: 34, chip: 20, badge: 18, dot: 8, buttonSmall: 24, iconSmall: 13, bullet: 6, hairline: 1 };
const ALPHA = { faint: "14", soft: "1c", tint: "24", border: "55" };

const SPRITE_DIR = "mods/fabric-sidebar/sprites";
// Eck-Symbole der Karten (die SVG-Sprites tragen die Figur).
const CORNER_GLYPH = { zzz: "z", note: "♪", play: "▸", clock: "◷", alert: "!", dot: "·" };

function message(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeIndex(raw) {
  return {
    tickets: Array.isArray(raw?.tickets) ? raw.tickets : [],
    inbox: Array.isArray(raw?.inbox) ? raw.inbox : [],
    roster: Array.isArray(raw?.roster) ? raw.roster : [],
    teams: Array.isArray(raw?.teams) ? raw.teams : [],
    fabrics: Array.isArray(raw?.fabrics) ? raw.fabrics : [],
    alarm: raw?.alarm ?? null,
  };
}

function dbPath() {
  return `${appHome()}/data/fabric/fabric.db`;
}

function statusColor(t, status) {
  return t[status] ?? t.dim;
}

// Derselbe Weg wie fabric/main.js openInWindow: erst die Route teilen, dann
// das Fenster öffnen; ist es schon offen, reicht der openRequest. Das Ticket
// trägt zusätzlich `fabric.selected`, damit die Inbox es markiert.
function openRoute(route) {
  if (route.page === "ticket" && route.id) setShared("fabric.selected", route.id);
  setShared("fabric.route", route);
  if (shared("fabric.window")?.id) {
    setShared("fabric.openRequest", { at: Date.now(), route });
    return;
  }
  const id = openOverlay({
    mod: "fabric",
    kind: "window",
    key: "fabric",
    keep: true,
    frame: "none",
    width: 0.86,
    height: 0.86,
    props: { view: "app" },
  });
  setShared("fabric.window", { id });
}

function openTicket(ticket) {
  openRoute({ page: "ticket", id: ticket });
}

function ticketChip(t, ticket) {
  return div()
    .id(`fabric-side-ticket-${ticket}`)
    .flex_none()
    .h(SIZE.chip)
    .px(SPACE.xs)
    .rounded(RADIUS.s)
    .bg(t.accent + ALPHA.tint)
    .text_size(FONT.xs)
    .text_color(t.accent)
    .flex()
    .items_center()
    .cursor_pointer()
    .tooltip(`Ticket ${ticket} öffnen`)
    .on_click((_event, cx) => {
      cx.stop_propagation();
      openTicket(ticket);
    })
    .child(ticket);
}

function orchestratorBadge(t) {
  return div()
    .flex_none()
    .h(SIZE.chip)
    .px(SPACE.xs)
    .rounded(RADIUS.s)
    .bg(t.accent + ALPHA.tint)
    .text_size(FONT.xs)
    .font_semibold()
    .text_color(t.accent)
    .flex()
    .items_center()
    .child("Orchestrator");
}

// Platzhalter für einen nicht laufenden Orchestrator eines Teams mit Agenten.
function stoppedOrchestrator(t, team) {
  return h_flex()
    .flex_none()
    .w_full()
    .px(SPACE.s)
    .py(SPACE.xs)
    .gap(SPACE.s)
    .items_center()
    .rounded(RADIUS.s)
    .tooltip(`Orchestrator von ${team} läuft nicht`)
    .child(image(`${SPRITE_DIR}/orchestrator.svg`).size(22).flex_none().opacity(0.45))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(FONT.s).font_semibold().text_color(t.dim).child(team))
      .child(div().text_size(FONT.xs).text_color(t.dim).child("Orchestrator · gestoppt")));
}

// Kleine Zahl-Pille im Fabric-Kopf.
function pill(t, text, color, tooltip) {
  return div()
    .flex_none()
    .h(SIZE.badge)
    .px(SPACE.xs + 2)
    .rounded(SIZE.badge / 2)
    .bg(color + ALPHA.tint)
    .text_size(FONT.xs)
    .font_semibold()
    .text_color(color)
    .flex()
    .items_center()
    .tooltip(tooltip)
    .child(text);
}

// Kopf einer Fabric: Pfeil und Name klappen ein und aus, der Filter-Knopf
// rechts setzt den Fabric-Filter und öffnet das Board.
function fabricHeader(t, fabric, { tint, collapsed, active, onToggle }) {
  const filterTip = active
    ? "Filter aufheben (Fenster zeigt wieder alle Fabrics)"
    : `Fenster auf ${fabric.name} filtern und Board öffnen`;
  return h_flex()
    .id(`fabric-sidebar-fabric-${fabric.name}`)
    .flex_none()
    .w_full()
    .h(32)
    .px(SPACE.s)
    .gap(SPACE.s)
    .items_center()
    .rounded(RADIUS.m)
    .cursor_pointer()
    .hover((style) => style.bg(tint + ALPHA.soft))
    .tooltip(`${fabric.name} · ${model.fabricSummary(fabric)} · Klick ${collapsed ? "klappt auf" : "klappt ein"}`)
    .on_click((_event, cx) => { cx.stop_propagation(); onToggle(cx); })
    .child(div().flex_none().text_color(t.dim)
      .child(svg(`mods/workspace-chrome/${collapsed ? "chevron-right" : "chevron-down"}.svg`).size(SIZE.iconSmall)))
    .child(div()
      .flex_none()
      .size(20)
      .rounded(RADIUS.s)
      .bg(tint + ALPHA.tint)
      .border_1()
      .border_color(tint + ALPHA.border)
      .flex()
      .items_center()
      .justify_center()
      .text_size(FONT.xs)
      .font_semibold()
      .text_color(tint)
      .child(fabric.name.slice(0, 1).toUpperCase()))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().text_size(FONT.s).font_semibold().text_color(t.foreground).child(fabric.name))
      .when(collapsed, (el) => el.child(div().truncate().text_size(FONT.xs).text_color(t.dim)
        .child(model.fabricSummary(fabric)))))
    .when(!collapsed && (fabric.agents ?? 0) > 0, (el) => el.child(
      pill(t, `● ${fabric.agents}`, t.working, `${fabric.agents} Sitzung${fabric.agents === 1 ? "" : "en"} aktiv`)))
    .when(!collapsed && (fabric.open ?? 0) > 0, (el) => el.child(
      pill(t, String(fabric.open), t.accent, `${fabric.open} offene Ticket${fabric.open === 1 ? "" : "s"}`)))
    .child(div()
      .id(`fabric-sidebar-filter-${fabric.name}`)
      .flex_none()
      .p(SPACE.xs)
      .rounded(RADIUS.s)
      .bg(active ? tint + ALPHA.tint : t.surface + "00")
      .text_color(active ? tint : t.dim)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover).text_color(t.foreground))
      .tooltip(filterTip)
      .on_click((_event, cx) => {
        cx.stop_propagation();
        setShared("fabric.scope", active ? "" : fabric.name);
        openRoute({ page: "board" });
      })
      .child(svg("mods/fabric/icons/filter.svg").size(SIZE.iconSmall).flex_none()));
}

// Eine Fabric als getönte Gruppe: Kopf, darunter (aufgeklappt) die
// Orchestratoren mit ihren Agenten an einer Baumlinie.
function fabricGroup(t, section, { scope, collapsed, first, onToggle }) {
  const tint = fabricTint(t, model.fabricTintIndex(section.name));
  const active = scope === section.name;
  const body = [];
  for (const group of section.groups) {
    if (!group.orchestrator) body.push(stoppedOrchestrator(t, group.name));
    for (const row of group.rows) {
      const depth = row.depth + (group.orchestrator ? 0 : 1);
      body.push(rowView(t, row, { depth, team: group.name, tint }));
    }
  }
  return v_flex()
    .flex_none()
    .mx(SPACE.xs)
    .when(!first, (el) => el.mt(SPACE.s))
    .p(2)
    .rounded(RADIUS.l)
    .border_1()
    .border_color(active ? tint : tint + ALPHA.border)
    .bg(tint + ALPHA.faint)
    .child(fabricHeader(t, section, { tint, collapsed, active, onToggle }))
    .when(!collapsed, (el) => el.child(
      v_flex()
        .w_full()
        .ml(SPACE.m)
        .pl(SPACE.xs)
        .pb(SPACE.xs)
        .pr(SPACE.m)
        .gap(2)
        .border_l(1)
        .border_color(tint + ALPHA.border)
        .when(body.length === 0, (inner) => inner.child(div().px(SPACE.s).py(SPACE.xs)
          .text_size(FONT.xs).text_color(t.dim).child("Keine aktiven Sitzungen")))
        .children(body),
    ));
}

// Farbton je Fabric: ohne Rot und Gelb, die für Fehler und „arbeitet“ stehen.
function fabricTint(t, index) {
  const palette = [t.accent, t.ansi5, t.ansi6, t.ansi2, t.ansi4, t.done];
  return palette[index % palette.length] ?? t.accent;
}

// Farbton je Maschinengruppe; alle Farben kommen aus theme().
function groupTint(t, index) {
  const palette = [t.accent, t.working, t.done, t.ansi5, t.ansi6, t.blocked];
  return palette[index % palette.length] ?? t.accent;
}

function monoFont() {
  const configured = settings()?.font_family;
  if (typeof configured === "string" && configured) return configured;
  return (fonts() ?? []).find((name) => /mono|menlo|courier/i.test(name)) ?? "";
}

// Abschnittskopf Agenten mit dem Aktiv-Zähler.
function agentsHeader(t, free) {
  return h_flex()
    .flex_none()
    .w_full()
    .px(SPACE.s)
    .pt(SPACE.xs)
    .pb(SPACE.xs)
    .gap(SPACE.xs)
    .items_center()
    .child(div().text_size(FONT.xs).font_semibold().text_color(t.muted).child("Agenten"))
    .child(div()
      .text_size(FONT.xs)
      .text_color(free.busy > 0 ? t.working : t.dim)
      .child(model.busyLabel(free.busy)));
}

// Maschinengruppe: farbiges Icon, Name, Trennlinie, rechts belegt/gesamt.
function freeGroupHeader(t, group, tint, first) {
  return h_flex()
    .flex_none()
    .w_full()
    .when(!first, (el) => el.mt(SPACE.xs).pt(SPACE.xs).border_t(1).border_color(t.border))
    .px(SPACE.s)
    .pb(SPACE.xs)
    .gap(SPACE.xs)
    .items_center()
    .child(div().size(SIZE.dot).flex_none().rounded(SIZE.dot / 2).bg(tint))
    .child(div().flex_none().text_size(FONT.xs).font_semibold().text_color(tint).child(group.name))
    .child(div().flex_1().min_w(SPACE.xs).h(1).bg(t.border))
    .child(div().flex_none().text_size(FONT.xs).text_color(t.dim)
      .child(`${group.busy}/${group.total}`));
}

// Anheften/Lösen einer freien Karte. Anders als im Agents-Mod gibt es hier
// keine Zweitliste: `herdr.pinned` ist die gemeinsame Wahrheit, der Befehl
// `terminal.pin` setzt oder entfernt sie.
function pinButton(t, card) {
  return div()
    .id(`free-pin-${card.address}`)
    .flex_none()
    .p(SPACE.xs)
    .rounded(RADIUS.s)
    .text_color(card.pinned ? t.accent : t.dim)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover).text_color(t.foreground))
    .tooltip(card.pinned ? "Nicht mehr anheften" : "Oben anheften")
    .on_click((_event, cx) => {
      cx.stop_propagation();
      const pin = model.pinCommand(card);
      run(pin.command, pin.args);
    })
    .child(svg(`mods/workspace-chrome/${card.pinned ? "pin-off" : "pin"}.svg`)
      .size(SIZE.iconSmall)
      .flex_none());
}

// Pixel-Karte: Avatar-Szene, Status-Badge, Eck-Symbol, Name, eine Aufgabenzeile.
// Der Pin erscheint nur unter dem Zeiger oder wenn die Karte angeheftet ist.
function freeCard(t, card, tint, mono, hovered, onHover) {
  const status = statusColor(t, card.status);
  return h_flex()
    .id(`free-agent-${card.address}`)
    .w_full()
    .flex_none()
    .gap(SPACE.s)
    .p(SPACE.s)
    .rounded(RADIUS.s)
    .border_1()
    .border_color(tint + ALPHA.border)
    .bg(tint + ALPHA.faint)
    .items_center()
    .cursor_pointer()
    .hover((style) => style.bg(tint + ALPHA.soft))
    .tooltip(`${card.name} öffnen`)
    .on_hover((on, cx) => onHover(card.address, on, cx))
    .on_click(() => run("agent.focus", { terminal: card.click.terminal }))
    .child(image(`${SPRITE_DIR}/${card.sprite}.svg`).w(SIZE.rowTall).h(SIZE.rowTall).flex_none())
    .child(
      v_flex().flex_1().min_w(0).gap(SPACE.xs)
        .child(
          h_flex().w_full().items_center().gap(SPACE.xs)
            .child(div()
              .h(SIZE.chip)
              .px(SPACE.xs)
              .rounded(SIZE.chip / 2)
              .bg(status + ALPHA.tint)
              .text_size(FONT.xs)
              .font_semibold()
              .text_color(status)
              .flex()
              .items_center()
              .child(card.badge))
            .child(div().flex_1())
            .child(div().text_size(FONT.xs).text_color(status)
              .child(CORNER_GLYPH[card.icon] ?? "·")),
        )
        .child(div().w_full().truncate().text_size(FONT.s).font_semibold()
          .when(Boolean(mono), (el) => el.font_family(mono))
          .child(card.name))
        .child(div().w_full().truncate().text_size(FONT.xs).text_color(t.dim)
          .tooltip(card.task).child(card.task)),
    )
    .when(card.pinned || hovered, (el) => el.child(pinButton(t, card)));
}

function metaLine(t, row) {
  return h_flex()
    .gap(SPACE.xs)
    .text_size(FONT.xs)
    .when(Boolean(row.role), (el) => el.child(div().text_color(t.dim).child(row.role)))
    .when(Boolean(row.role), (el) => el.child(div().text_color(t.dim).child("·")))
    .when(Boolean(row.statusWord), (el) => el.child(div().text_color(statusColor(t, row.status)).child(row.statusWord)))
    .when(Boolean(row.statusWord), (el) => el.child(div().text_color(t.dim).child("·")))
    .when(Boolean(row.runtime), (el) => el.child(div().text_color(t.dim).child(row.runtime)))
    .when(Boolean(row.runtime) && Boolean(row.costText), (el) => el.child(div().text_color(t.dim).child("·")))
    .when(Boolean(row.costText), (el) => el.child(div().text_color(t.dim).child(row.costText)));
}

// Zeile einer Sitzung in der Fabric-Gruppe. Orchestratoren tragen ihr
// Sprite und den Teamnamen, Agenten hängen eine Stufe tiefer (`depth`).
function rowView(t, row, { depth = 0, team = "", tint = t.accent } = {}) {
  const status = statusColor(t, row.status);
  return h_flex()
    .id(`fabric-side-${row.address}`)
    .flex_none()
    .w_full()
    .pl(SPACE.xs + depth * SPACE.m)
    .pr(SPACE.xs)
    .py(SPACE.xs)
    .gap(SPACE.s)
    .items_center()
    .rounded(RADIUS.s)
    .cursor_pointer()
    .hover((style) => style.bg(tint + ALPHA.soft))
    .tooltip(row.orchestrator ? `Orchestrator ${team} öffnen` : `${row.name} öffnen`)
    .on_click(() => run("agent.focus", { terminal: row.address }))
    .child(div().relative().flex_none()
      .child(image(`${SPRITE_DIR}/${row.orchestrator ? "orchestrator" : "agent-a"}.svg`).size(22))
      .child(div().absolute().right(-1).bottom(-1).size(SIZE.dot).rounded(SIZE.dot / 2)
        .border_1().border_color(t.background).bg(status)))
    .child(
      v_flex().flex_1().min_w(0)
        .child(h_flex().gap(SPACE.xs).items_center().min_w(0)
          .child(div().flex_1().min_w(0).truncate().text_size(FONT.s)
            .when(row.orchestrator, (el) => el.font_semibold())
            .child(row.orchestrator ? (team || "Orchestrator") : row.title))
          .when(Boolean(row.ticket), (el) => el.child(ticketChip(t, row.ticket))))
        .child(metaLine(t, row.orchestrator ? { ...row, role: "Orchestrator" } : row)),
    );
}

// Andere Mods (agents-filtered) bekommen die Kartenadressen nur über den
// Shared-State; die Regel selbst bleibt hier. Nur bei echter Änderung schreiben,
// damit der Snapshot keine überflüssigen Render-Schleifen auslöst.
function publishHiddenAgents(terms, listed) {
  if (checking()) return;
  const snapshot = model.hiddenAgentAddresses(terms, listed);
  if (JSON.stringify(shared("fabric.hiddenAgents")) !== JSON.stringify(snapshot)) {
    setShared("fabric.hiddenAgents", snapshot);
  }
}

// Alarm-Banner im Stil der Fenster-Notice: ein Block je Alarm, Text bricht um,
// je Aktion ein kleiner Knopf. Ein Schließen gibt es bewusst nicht; nur
// `fab alarm ack` räumt den Alarm auf. Unbekannte Aktionen fallen in
// `model.alarmButtons` weg.
function alarmBanner(t, alarm, onAction) {
  const buttons = model.alarmButtons(alarm);
  return v_flex()
    .flex_none()
    .w_full()
    .px(SPACE.l)
    .py(SPACE.s)
    .gap(SPACE.s)
    .items_start()
    .bg(t.blocked + ALPHA.soft)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex()
        .w_full()
        .gap(SPACE.s)
        .items_start()
        .child(div().flex_none().mt(SIZE.hairline).size(SIZE.bullet).rounded(SIZE.bullet / 2).bg(t.blocked))
        .child(div()
          .flex_1()
          .min_w(0)
          .whitespace_normal()
          .text_size(FONT.s)
          .text_color(t.blocked)
          .child(String(alarm.text ?? ""))),
    )
    .when(buttons.length > 0, (el) => el.child(
      h_flex()
        .w_full()
        .gap(SPACE.xs)
        .flex_wrap()
        .children(buttons.map(({ action, label }) => h_flex()
          .id(`fabric-alarm-${alarm.id ?? "?"}-${action}`)
          .flex_none()
          .h(SIZE.buttonSmall)
          .px(SPACE.s)
          .items_center()
          .justify_center()
          .rounded(RADIUS.m)
          .border_1()
          .border_color(t.input)
          .bg(t.raised)
          .text_size(FONT.s)
          .font_medium()
          .text_color(t.foreground)
          .cursor_pointer()
          .hover((style) => style.opacity(0.86))
          .on_click((_event, cx) => onAction(alarm, action, cx))
          .child(label))),
    ));
}

export default class FabricSidebar extends View {
  init(_props, cx) {
    this.index = null;
    this.loadError = null;
    this.loading = false;
    this.closed = false;
    this.hovered = null;
    // `undefined` = noch nie gelesen; `null` = Datenbank ohne `meta.rev`.
    this.rev = undefined;
    this.tickRunning = false;
    if (checking()) return;

    const reload = async (cx) => {
      const changed = await this.load();
      if (changed && !this.closed) cx.notify();
    };
    cx.spawn((cx) => reload(cx));
    // Fünf-Sekunden-Rückfall: prüft nur `meta.rev` und liest erst bei Änderung.
    cx.timer.every(5000, (cx) => {
      if (!this.closed) cx.spawn((cx) => reload(cx));
    });
    // Der Tick-Takt lebt hier, weil die Seitenleiste auch bei geschlossenem
    // Fabric-Fenster eingehängt ist. Beide Instanzen teilen den Versuch.
    cx.timer.every(10000, (cx) => {
      if (!this.closed) this.tick(cx);
    });
  }

  tick(cx) {
    if (this.tickRunning) return;
    const now = Date.now();
    if (!model.tickDue(shared("fabric.tickAttempt"), now)) return;
    setShared("fabric.tickAttempt", now);
    this.tickRunning = true;
    cx.spawn(async () => {
      const call = (args, timeout) => exec(`${appHome()}/fabric/fab`, args, {
        cwd: appHome(), timeout,
      });
      try {
        const result = await call(["tick"], 120000);
        // Scheitert der Lauf, bleibt `last_tick` stehen; der Index-Lauf
        // veröffentlicht den fälligen Alarm im Posteingang.
        if (result?.code !== 0) await call(["index"], 30000);
      } catch {
        try { await call(["index"], 30000); } catch { /* still */ }
      } finally {
        this.tickRunning = false;
      }
    });
  }

  pinHover(address, on, cx) {
    if (on) this.hovered = address;
    else if (this.hovered === address) this.hovered = null;
    cx.notify();
  }

  async close() {
    this.closed = true;
  }

  /** Liest den Index aus der Datenbank; true nur bei geändertem `rev`. */
  async load() {
    if (this.loading) return false;
    this.loading = true;
    try {
      let rev = null;
      try {
        rev = await db.metaValue(dbPath(), "rev");
      } catch {
        rev = null;
      }
      if (this.rev !== undefined && rev === this.rev && this.index !== null) return false;
      this.rev = rev;
      let text = null;
      try {
        text = await db.readModel(dbPath(), "index");
      } catch (error) {
        this.index = null;
        this.loadError = message(error);
        return true;
      }
      if (text == null) {
        this.index = null;
        this.loadError = "Die Fabric-Datenbank enthält noch keinen Index.";
        return true;
      }
      const raw = parseJson(text, null);
      if (!raw) {
        this.index = null;
        this.loadError = "Der Index in der Datenbank ist unlesbar.";
        return true;
      }
      this.index = normalizeIndex(raw);
      this.loadError = null;
      return true;
    } finally {
      this.loading = false;
    }
  }

  // `run` und `ticket` springen nur in die Fabric-Oberfläche; `resume` und
  // `ack` räumen serverseitig auf und laden den Index neu, damit der Banner
  // ohne den 5-s-Takt verschwindet. Fehler landen still im loadError.
  async activate(alarm, action, cx) {
    if (action === "run") {
      openRoute({ page: "pipelines", run: alarm.run });
      return;
    }
    if (action === "ticket") {
      if (alarm.ticket) openTicket(String(alarm.ticket));
      return;
    }
    const command = action === "ack" ? ["alarm", "ack"] : ["autopilot", "resume"];
    let failure = null;
    try {
      const result = await exec(`${appHome()}/fabric/fab`, command, {
        cwd: appHome(), timeout: 30000,
      });
      if (result?.code !== 0) {
        failure = (result?.stderr || "").trim() || (result?.stdout || "").trim()
          || `fab endete mit Code ${result?.code}.`;
      }
    } catch (error) {
      failure = message(error);
    }
    await this.load();
    if (failure) this.loadError = failure;
    if (!this.closed) cx.notify();
  }

  render(cx) {
    const t = theme();
    const terms = terminals();
    const listed = agents();
    publishHiddenAgents(terms, listed);
    const { rows, teams: groups } = model.fabricRows(
      terms,
      listed,
      this.index?.tickets ?? [],
      this.index?.roster ?? [],
      Date.now(),
      this.index?.teams ?? [],
    );
    const free = model.freeAgentCards(terms, listed, spaces(), shared("agents.sort"));
    const alarms = model.activeAlarms(this.index?.alarm);
    const inbox = model.inboxCount(this.index);
    // `agent.next`/`agent.prev` folgen der Reihenfolge, die hier steht: freie
    // Karten (angepinnt, wartend, arbeitend, untätig) und dann die Teams.
    // Ohne diesen Aufruf liefe die Tastaturbelegung ins Leere, weil der
    // Agents-Block in diesem Layout nicht mehr rendert.
    setAgentOrder([...free.cards, ...rows].map((item) => item.address));
    const sections = [];
    if (free.cards.length > 0) {
      const mono = monoFont();
      sections.push(agentsHeader(t, free));
      free.groups.forEach((group, index) => {
        const tint = groupTint(t, index);
        sections.push(freeGroupHeader(t, group, tint, index === 0));
        for (const card of group.cards) {
          sections.push(freeCard(t, card, tint, mono, this.hovered === card.address,
            (address, on, cx) => this.pinHover(address, on, cx)));
        }
      });
    }
    // Jede Fabric ist eine einklappbare Gruppe; Orchestratoren und Agenten
    // hängen darunter an einer Baumlinie.
    const scope = String(shared("fabric.scope") ?? "");
    const collapsed = model.collapsedNames(shared(model.COLLAPSED_KEY));
    const list = model.fabricList(this.index ?? {}, rows);
    model.fabricSections(groups, this.index?.teams ?? [], list).forEach((section, index) => {
      sections.push(fabricGroup(t, section, {
        scope,
        collapsed: collapsed.includes(section.name),
        first: index === 0 && free.cards.length === 0,
        onToggle: () => setShared(model.COLLAPSED_KEY, model.toggleCollapsed(shared(model.COLLAPSED_KEY), section.name)),
      }));
    });

    return v_flex()
      .size_full()
      .min_h(0)
      .text_color(t.foreground)
      .child(
        h_flex()
          .flex_none()
          .w_full()
          .h(SIZE.nav)
          .px(SPACE.s)
          .gap(SPACE.xs)
          .items_center()
          .child(div().text_size(FONT.xs).font_semibold().text_color(t.muted).child("Fabric"))
          // Kompakter Posteingang statt eines eigenen Blocks: Zahl der
          // offenen Einträge, Klick öffnet die Seite im Fabric-Fenster.
          .when(inbox > 0, (el) => el.child(
            h_flex()
              .id("fabric-sidebar-inbox")
              .flex_none()
              .h(SIZE.badge)
              .px(SPACE.xs)
              .gap(SPACE.xs)
              .items_center()
              .rounded(SIZE.badge / 2)
              .bg(t.accent + ALPHA.tint)
              .cursor_pointer()
              .hover((style) => style.opacity(0.86))
              .tooltip(`${inbox} im Posteingang · im Fenster öffnen`)
              .on_click((_event, cx) => {
                cx.stop_propagation();
                openRoute({ page: "inbox" });
              })
              .child(div().text_size(FONT.xs).font_semibold().text_color(t.accent).child("Posteingang"))
              .child(div()
                .min_w(SIZE.badge)
                .h(SIZE.badge)
                .px(SPACE.xs)
                .rounded(SIZE.badge / 2)
                .bg(t.accent)
                .text_size(FONT.xs)
                .font_semibold()
                .text_color(t.background)
                .flex()
                .items_center()
                .justify_center()
                .child(String(inbox))),
          )),
      )
      .when(alarms.length > 0, (el) => el.child(
        v_flex()
          .flex_none()
          .w_full()
          .px(SPACE.s)
          .pb(SPACE.xs)
          .gap(SPACE.xs)
          .children(alarms.map((alarm) => alarmBanner(t, alarm, (entry, action, eventCx) => {
            eventCx.spawn(async () => { await this.activate(entry, action, eventCx); });
          }))),
      ))
      .when(Boolean(this.loadError), (el) => el.child(
        h_flex()
          .flex_none()
          .w_full()
          .px(SPACE.l)
          .py(SPACE.s)
          .gap(SPACE.s)
          .items_start()
          .bg(t.blocked + ALPHA.soft)
          .border_b(1)
          .border_color(t.border)
          .child(div().flex_none().mt(SIZE.hairline).size(SIZE.bullet).rounded(SIZE.bullet / 2).bg(t.blocked))
          .child(div()
            .flex_1()
            .min_w(0)
            .whitespace_normal()
            .text_size(FONT.s)
            .text_color(t.blocked)
            .tooltip(this.loadError)
            .child("Ticketdaten nicht lesbar")),
      ))
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .w_full()
          .py(SPACE.xs)
          .overflow_y_scrollbar()
          .children(sections)
      );
  }
}
