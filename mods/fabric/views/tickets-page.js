// Tickets: die vollständige Tabelle mit denselben Filtern wie das Board.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

function filters(app, cx, t) {
  return ui.fabricFilters(t, { app, cx, droppedKey: "showDropped" });
}

function cell(app, t, ticket, column) {
  if (column.key === "id") {
    return div().text_size(T.xs).text_color(t.dim).child(ticket.id);
  }
  if (column.key === "title") {
    return h_flex().min_w(0).gap(S.s).items_center()
      .child(ui.dot(t, ui.statusColor(t, ticket.status)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(ticket.title || "Ohne Titel")
        .tooltip(ticket.title || "Ohne Titel"))
      .when(ticket.waiting?.includes("mensch"), (el) => el.child(ui.chip(t, "wartet", t.accent)));
  }
  if (column.key === "status") {
    return ui.chip(t, model.statusWord(ticket.status), ui.statusColor(t, ticket.status));
  }
  if (column.key === "assignee") {
    if (!ticket.assignee) return div().text_size(T.xs).text_color(t.dim).truncate().child("Nicht zugewiesen");
    return h_flex().gap(S.s).items_center().min_w(0)
      .child(ui.avatar(t, ticket.assignee, app.agentColor(ticket.assignee), 18))
      .child(div().truncate().text_size(T.s).text_color(t.foreground).child(ticket.assignee));
  }
  if (column.key === "repo") {
    if (!ticket.repo) return div().text_size(T.xs).text_color(t.dim).child("—");
    return div().truncate().text_size(T.s).text_color(t.muted)
      .child(model.repoName(ticket.repo)).tooltip(ticket.repo);
  }
  if (column.key === "updated_at") {
    return div().text_size(T.s).text_color(t.muted)
      .child(model.relativeTime(ticket.updated_at))
      .tooltip(model.absoluteTime(ticket.updated_at));
  }
  return div().text_size(T.s).text_color(ticket.comment_count ? t.muted : t.dim)
    .child(String(ticket.comment_count ?? 0));
}

export function renderTicketsPage(app, cx, t) {
  const filtersValue = { ...app.filters(), includeDropped: app.showDropped };
  const rows = model.sortTickets(model.filterTickets(app.tickets, filtersValue), app.tableSort)
    .map((ticket) => ({ ...ticket, __selected: app.cursorId === ticket.id }));
  const scoped = model.fabricScopeTickets(app.tickets, app.fabricScope);
  const open = scoped.filter((ticket) => ticket.status !== "done" && ticket.status !== "dropped").length;
  const review = scoped.filter((ticket) => ticket.status === "review").length;
  const columns = app.compact
    ? model.TABLE_COLUMNS.filter((column) => column.key === "id" || column.key === "title" || column.key === "status")
    : model.TABLE_COLUMNS;

  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("tickets"), [
      div().text_size(T.xs).text_color(t.dim)
        .child(`${scoped.length} gesamt${app.fabricScope ? ` · Fabric ${app.fabricScope}` : ""}`),
    ], {
      iconName: "tickets",
      subtitle: `${open} offen · ${review} in Prüfung · Spaltenkopf sortiert`,
      compact: app.compact,
    }))
    .child(filters(app, cx, t))
    .when(Boolean(app.loadError), (el) => el.child(ui.notice(t, app.loadError)))
    .when(Boolean(app.flash?.text), (el) => el.child(ui.notice(t, app.flash.text, app.flash.level)))
    .child(
      !app.index ? ui.loading(t, "Tickets werden geladen …")
        : rows.length === 0
          ? ui.emptyState(t, {
            title: "Keine Tickets in dieser Auswahl",
            text: "Filter zurücksetzen oder ein neues Ticket anlegen.",
            action: ui.button(t, {
              id: "fabric-tickets-new",
              label: "Neues Ticket",
              icon: "plus",
              primary: true,
              onClick: (cx) => app.openNewTicket(cx),
            }),
          })
          : v_flex()
            .flex_1()
            .min_h(0)
            .overflow_y_scrollbar()
            .child(ui.table(t, {
              id: "fabric-ticket-table",
              columns,
              rows,
              sort: app.tableSort,
              onSort: (sort) => { app.tableSort = sort; cx.notify(); },
              onRow: (row, cx) => {
                app.cursorId = row.id;
                app.navigate("ticket", { id: row.id }, cx);
              },
              renderCell: (row, column) => cell(app, t, row, column),
            })),
    );
}
