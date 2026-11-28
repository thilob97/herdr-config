// Fabric in Herdrs Seitenleiste: Orchestrator zuerst, Agenten eingerückt,
// mit Rolle, Status und Laufzeit. Klick öffnet das Terminal, der Ticket-Chip
// das Ticket im Fabric-Fenster. Reine Auswahl-/Textlogik: model.js.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  agents, appHome, checking, exec, fonts, openOverlay, readTextFile, run, setAgentOrder,
  setShared, settings, shared, spaces, terminals, theme,
} from "herdr";
import * as model from "./model.js";

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
    roster: Array.isArray(raw?.roster) ? raw.roster : [],
    teams: Array.isArray(raw?.teams) ? raw.teams : [],
    fabrics: Array.isArray(raw?.fabrics) ? raw.fabrics : [],
    alarm: raw?.alarm ?? null,
  };
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

// Team-Überschrift: dezent, mit Anzahl; nur die erste Gruppe ohne Trennlinie.
function teamHeader(t, group, first) {
  return h_flex()
    .flex_none()
    .w_full()
    .when(!first, (el) => el.mt(SPACE.xs).pt(SPACE.xs).border_t(1).border_color(t.border))
    .px(SPACE.s)
    .pb(SPACE.xs)
    .gap(SPACE.xs)
    .items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(FONT.xs).font_semibold().text_color(t.dim)
      .child(group.name))
    .child(div().flex_none().text_size(FONT.xs).text_color(t.dim).child(String(group.count)));
}

// Fabric als Überschrift ihrer Teams; Klick setzt den Fabric-Filter und
// öffnet das Board, ein zweiter Klick auf die aktive Fabric hebt ihn auf.
function fabricRow(t, fabric, scope, first) {
  const active = scope === fabric.name;
  const detail = `${fabric.teams ?? 0} Team${fabric.teams === 1 ? "" : "s"} · ${fabric.open ?? 0} offen · ${fabric.agents ?? 0} Agent${fabric.agents === 1 ? "" : "en"}`;
  return h_flex()
    .id(`fabric-sidebar-fabric-${fabric.name}`)
    .flex_none()
    .w_full()
    .h(26)
    .when(!first, (el) => el.mt(SPACE.xs))
    .px(SPACE.s)
    .gap(SPACE.xs)
    .items_center()
    .rounded(RADIUS.s)
    .bg(active ? t.selected : t.surface + "00")
    .cursor_pointer()
    .hover((s) => s.bg(active ? t.selected : t.hover))
    .tooltip(`${fabric.name}: ${detail} · Klick ${active ? "hebt den Filter auf" : "filtert das Fenster"}`)
    .on_click(() => {
      setShared("fabric.scope", active ? "" : fabric.name);
      openRoute({ page: "board" });
    })
    .child(div().flex_none().size(6).rounded(3).bg(active ? t.accent : t.muted))
    .child(div().flex_1().min_w(0).truncate().text_size(FONT.s).font_semibold()
      .text_color(active ? t.foreground : t.muted).child(fabric.name))
    .when((fabric.agents ?? 0) > 0, (el) => el.child(div().flex_none().text_size(FONT.xs).text_color(t.working)
      .child(`${fabric.agents} ●`)))
    .child(div().flex_none().text_size(FONT.xs).text_color(t.dim).child(String(fabric.open ?? 0)));
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

function rowView(t, row) {
  return h_flex()
    .id(`fabric-side-${row.address}`)
    .w_full()
    .flex_none()
    .pl(SPACE.s + row.depth * SPACE.m)
    .pr(SPACE.s)
    .py(SPACE.xs)
    .gap(SPACE.xs)
    .items_center()
    .rounded(RADIUS.s)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .tooltip(row.orchestrator ? "Orchestrator öffnen" : `${row.name} öffnen`)
    .on_click(() => run("agent.focus", { terminal: row.address }))
    .child(div().size(SIZE.dot).flex_none().rounded(SIZE.dot / 2).bg(statusColor(t, row.status)))
    .child(
      v_flex().flex_1().min_w(0).gap(SPACE.xs)
        .child(
          h_flex().gap(SPACE.xs).items_center().min_w(0)
            .when(row.orchestrator, (el) => el.child(orchestratorBadge(t)))
            .when(!row.orchestrator, (el) => el
              .child(div().flex_1().min_w(0).truncate().text_size(FONT.s).child(row.title))),
        )
        .child(metaLine(t, row)),
    )
    .when(Boolean(row.ticket), (el) => el.child(ticketChip(t, row.ticket)));
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
    if (checking()) return;

    const reload = async (cx) => {
      await this.load();
      if (!this.closed) cx.notify();
    };
    cx.spawn((cx) => reload(cx));
    // Index und Laufzeit: die Datei ist klein; ein 5-s-Takt hält beides frisch.
    cx.timer.every(5000, (cx) => {
      if (!this.closed) cx.spawn((cx) => reload(cx));
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

  async load() {
    if (this.loading) return;
    this.loading = true;
    try {
      const text = await readTextFile(`${appHome()}/data/fabric/index.json`);
      if (text == null) {
        this.index = null;
        this.loadError = "index.json fehlt";
        return;
      }
      const raw = parseJson(text, null);
      if (!raw) {
        this.index = null;
        this.loadError = "index.json ist unlesbar";
        return;
      }
      this.index = normalizeIndex(raw);
      this.loadError = null;
    } catch (error) {
      this.index = null;
      this.loadError = message(error);
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
    // Jede Fabric ist Überschrift (Klick filtert das Fenster); ihre Teams und
    // Agenten stehen eingerückt darunter.
    const scope = String(shared("fabric.scope") ?? "");
    const list = model.fabricList(this.index ?? {}, rows);
    for (const section of model.fabricSections(groups, this.index?.teams ?? [], list)) {
      sections.push(fabricRow(t, section, scope, sections.length === 0));
      section.groups.forEach((group, index) => {
        sections.push(v_flex().w_full().pl(SPACE.s).child(teamHeader(t, group, index === 0)));
        for (const row of group.rows) sections.push(v_flex().w_full().pl(SPACE.s).child(rowView(t, row)));
      });
    }

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
          .child(
            div()
              .min_w(SIZE.badge)
              .h(SIZE.badge)
              .px(SPACE.xs)
              .rounded(SIZE.badge / 2)
              .bg(t.raised)
              .text_size(FONT.xs)
              .text_color(t.dim)
              .flex()
              .items_center()
              .justify_center()
              .child(String(rows.length)),
          ),
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
          .when(rows.length === 0 && free.cards.length === 0, (el) => el.child(
            v_flex()
              .px(SPACE.m)
              .py(SPACE.s)
              .gap(SPACE.xs)
              .child(div().text_size(FONT.xs).text_color(t.muted).child("Keine Agenten aktiv"))
              .child(div().text_size(FONT.xs).text_color(t.dim)
                .child("fab dispatch startet einen.")),
          )),
      );
  }
}
