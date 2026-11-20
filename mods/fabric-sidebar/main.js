// Fabric in Herdrs Seitenleiste: Orchestrator zuerst, Agenten eingerückt,
// mit Rolle, Status und Laufzeit. Klick öffnet das Terminal, der Ticket-Chip
// das Ticket im Fabric-Fenster. Reine Auswahl-/Textlogik: model.js.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  agents, appHome, checking, openOverlay, readTextFile, run, setShared, shared,
  terminals, theme,
} from "herdr";
import * as model from "./model.js";

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

export default class FabricSidebar extends View {
  init(_props, cx) {
    this.index = null;
    this.loadError = null;
    this.loading = false;
    this.closed = false;

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
    const { rows, teams: groups } = model.fabricRows(
      terminals(),
      agents(),
      this.index?.tickets ?? [],
      this.index?.roster ?? [],
      Date.now(),
      this.index?.teams ?? [],
    );
    const sections = [];
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
          .when(rows.length === 0, (el) => el.child(
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
