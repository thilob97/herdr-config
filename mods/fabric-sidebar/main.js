// Fabric in Herdrs Seitenleiste: Orchestrator zuerst, Agenten eingerückt,
// mit Rolle, Status und Laufzeit. Klick öffnet das Terminal, der Ticket-Chip
// das Ticket im Fabric-Fenster. Reine Auswahl-/Textlogik: model.js.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  agents, appHome, checking, fonts, openOverlay, readTextFile, run, setAgentOrder, setShared,
  settings, shared, spaces, terminals, theme,
} from "herdr";
import * as model from "./model.js";

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
  };
}

function statusColor(t, status) {
  return t[status] ?? t.dim;
}

// Derselbe Weg wie fabric/main.js openInWindow: erst die Route teilen, dann
// das Fenster öffnen; ist es schon offen, reicht der openRequest.
function openTicket(ticket) {
  const route = { page: "ticket", id: ticket };
  setShared("fabric.selected", ticket);
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

function ticketChip(t, ticket) {
  return div()
    .id(`fabric-side-ticket-${ticket}`)
    .flex_none()
    .h(17)
    .px(5)
    .rounded(4)
    .bg(t.accent + "1a")
    .text_size(10)
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
    .h(17)
    .px(6)
    .rounded(4)
    .bg(t.accent + "26")
    .text_size(10)
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
    .when(!first, (el) => el.mt(4).pt(6).border_t(1).border_color(t.border))
    .px(10)
    .pb(2)
    .gap(6)
    .items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(10.5).font_semibold().text_color(t.dim)
      .child(group.name))
    .child(div().flex_none().text_size(10).text_color(t.dim).child(String(group.count)));
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

// Abschnittskopf AGENTS mit dem BUSY-Zähler.
function agentsHeader(t, free) {
  return h_flex()
    .flex_none()
    .w_full()
    .px(10)
    .pt(6)
    .pb(2)
    .gap(6)
    .items_center()
    .child(div().text_size(10).font_semibold().text_color(t.muted).child("AGENTS"))
    .child(div()
      .text_size(10)
      .text_color(free.busy > 0 ? t.working : t.dim)
      .child(model.busyLabel(free.busy)));
}

// Maschinengruppe: farbiges Icon, Name, Trennlinie, rechts belegt/gesamt.
function freeGroupHeader(t, group, tint, first) {
  return h_flex()
    .flex_none()
    .w_full()
    .when(!first, (el) => el.mt(5).pt(6).border_t(1).border_color(t.border))
    .px(10)
    .pb(3)
    .gap(6)
    .items_center()
    .child(div().size(7).flex_none().rounded(1).bg(tint))
    .child(div().flex_none().text_size(10).font_semibold().text_color(tint).child(group.name))
    .child(div().flex_1().min_w(4).h(1).bg(t.border))
    .child(div().flex_none().text_size(10).text_color(t.dim)
      .child(`${group.busy}/${group.total}`));
}

// Anheften/Lösen einer freien Karte. Anders als im Agents-Mod gibt es hier
// keine Zweitliste: `herdr.pinned` ist die gemeinsame Wahrheit, der Befehl
// `terminal.pin` setzt oder entfernt sie.
function pinButton(t, card) {
  return div()
    .id(`free-pin-${card.address}`)
    .flex_none()
    .p(3)
    .rounded(4)
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
      .size(13)
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
    .gap(8)
    .p(6)
    .rounded(6)
    .border_1()
    .border_color(tint + "40")
    .bg(tint + "12")
    .items_center()
    .cursor_pointer()
    .hover((style) => style.bg(tint + "1e"))
    .tooltip(`${card.name} öffnen`)
    .on_hover((on, cx) => onHover(card.address, on, cx))
    .on_click(() => run("agent.focus", { terminal: card.click.terminal }))
    .child(image(`${SPRITE_DIR}/${card.sprite}.svg`).w(44).h(44).flex_none())
    .child(
      v_flex().flex_1().min_w(0).gap(2)
        .child(
          h_flex().w_full().items_center().gap(4)
            .child(div()
              .h(14)
              .px(4)
              .rounded(3)
              .bg(status + "26")
              .text_size(8.5)
              .font_semibold()
              .text_color(status)
              .flex()
              .items_center()
              .child(card.badge))
            .child(div().flex_1())
            .child(div().text_size(10).text_color(status)
              .child(CORNER_GLYPH[card.icon] ?? "·")),
        )
        .child(div().w_full().truncate().text_size(11).font_semibold()
          .when(Boolean(mono), (el) => el.font_family(mono))
          .child(card.name))
        .child(div().w_full().truncate().text_size(9.5).text_color(t.dim)
          .tooltip(card.task).child(card.task)),
    )
    .when(card.pinned || hovered, (el) => el.child(pinButton(t, card)));
}

function metaLine(t, row) {
  return h_flex()
    .gap(4)
    .text_size(10.5)
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
    .pl(8 + row.depth * 14)
    .pr(8)
    .py(4)
    .gap(6)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .tooltip(row.orchestrator ? "Orchestrator öffnen" : `${row.name} öffnen`)
    .on_click(() => run("agent.focus", { terminal: row.address }))
    .child(div().size(7).flex_none().rounded(4).bg(statusColor(t, row.status)))
    .child(
      v_flex().flex_1().min_w(0).gap(1)
        .child(
          h_flex().gap(5).items_center().min_w(0)
            .when(row.orchestrator, (el) => el.child(orchestratorBadge(t)))
            .when(!row.orchestrator, (el) => el
              .child(div().flex_1().min_w(0).truncate().text_size(12).child(row.title))),
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

export default class FabricSidebar extends View {
  init(_props, cx) {
    this.index = null;
    this.loadError = null;
    this.loading = false;
    this.closed = false;
    this.hovered = null;
    // Alte Anheftungen aus `localStorage` (agents-filtered) übernehmen, bis der
    // Core das Label `herdr.pinned` bestätigt. Im Layout fabric lief bisher der
    // Agents-Block; ohne ihn wäre diese Migration sonst verloren.
    try { this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]"); } catch { this.pendingPins = []; }
    if (!Array.isArray(this.pendingPins)) this.pendingPins = [];
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();

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

  // Offline-Anheftungen bleiben, bis ihr Terminal zurückkommt; eine angefragte
  // bleibt stehen, bis der Core das Label zurückspiegelt. Derselbe Ablauf wie
  // in `mods/agents-filtered/main.js`.
  migratePins(all) {
    const listed = new Map(all.filter((terminal) => terminal.state === "live")
      .map((terminal) => [terminal.address, terminal]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
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

  render(cx) {
    const t = theme();
    const terms = terminals();
    const listed = agents();
    publishHiddenAgents(terms, listed);
    if (this.pendingPins.length) this.migratePins(terms);
    const { rows, teams: groups } = model.fabricRows(
      terms,
      listed,
      this.index?.tickets ?? [],
      this.index?.roster ?? [],
      Date.now(),
      this.index?.teams ?? [],
    );
    const free = model.freeAgentCards(terms, listed, spaces(), shared("agents.sort"));
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
    for (const group of groups) {
      if (group.rows.length === 0) continue;
      sections.push(teamHeader(t, group, sections.length === 0));
      for (const row of group.rows) sections.push(rowView(t, row));
    }

    return v_flex()
      .size_full()
      .min_h(0)
      .text_color(t.foreground)
      .child(
        h_flex()
          .flex_none()
          .w_full()
          .h(34)
          .px(10)
          .gap(6)
          .items_center()
          .child(div().text_size(11).font_semibold().text_color(t.muted).child("Fabric"))
          .child(
            div()
              .min_w(18)
              .h(16)
              .px(5)
              .rounded(8)
              .bg(t.raised)
              .text_size(10)
              .text_color(t.dim)
              .flex()
              .items_center()
              .justify_center()
              .child(String(rows.length)),
          ),
      )
      .when(Boolean(this.loadError), (el) => el.child(
        div()
          .flex_none()
          .px(10)
          .pb(4)
          .text_size(10.5)
          .text_color(t.blocked)
          .tooltip(this.loadError)
          .child("Ticketdaten nicht lesbar"),
      ))
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .w_full()
          .py(2)
          .overflow_y_scrollbar()
          .when(rows.length === 0 && free.cards.length === 0, (el) => el.child(
            v_flex()
              .px(12)
              .py(8)
              .gap(2)
              .child(div().text_size(11.5).text_color(t.muted).child("Keine Fabric-Agenten"))
              .child(div().text_size(10.5).text_color(t.dim)
                .child("fab dispatch startet einen.")),
          ))
          .children(sections),
      );
  }
}
