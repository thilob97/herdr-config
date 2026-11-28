// Posteingang: was auf den Menschen wartet. Klick öffnet das Ticket im Fenster.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

// ---------- Seite im Fabric-Fenster ----------

function reviewPanel(app, cx, t, id) {
  const state = app.inboxDiff[id] ?? {};
  const files = state.data?.files ?? [];
  const rejecting = app.inboxRejectFor === id;
  const stop = (el) => el.on_click((_event, cx) => cx.stop_propagation());
  if (state.loading) return ui.loading(t, "Änderungen werden geladen …");
  if (state.error) return ui.notice(t, state.error);
  return stop(v_flex().id(`fabric-inbox-review-${id}`).w_full().gap(S.s).p(S.s).rounded(ui.RADIUS.m).bg(t.surface)
    .child(div().text_size(T.xs).text_color(t.dim)
      .child(`${files.length} Datei${files.length === 1 ? "" : "en"} · HEAD ${String(state.data?.head ?? "").slice(0, 7)}`))
    .children(files.slice(0, 12).map((file) => h_flex().w_full().gap(S.s).text_size(T.xs)
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(file.path))
      .child(div().flex_none().text_color(file.binary ? t.dim : t.done).child(file.binary ? "binär" : `+${file.added ?? 0}`))
      .child(div().flex_none().text_color(file.binary ? t.dim : t.blocked).child(file.binary ? "" : `−${file.deleted ?? 0}`))))
    .when(files.length > 12, (el) => el.child(div().text_size(T.xs).text_color(t.dim)
      .child(`… ${files.length - 12} weitere; alle im Ticket`)))
    .when(rejecting, (el) => el.child(ui.input(t, app.inboxReject, {})))
    .when(Boolean(app.errorFor("reject")) && rejecting, (el) => el.child(
      ui.notice(t, app.errorFor("reject").text, app.errorFor("reject").level)))
    .when(Boolean(app.errorFor("accept")), (el) => el.child(
      ui.notice(t, app.errorFor("accept").text, app.errorFor("accept").level)))
    .child(h_flex().gap(S.s).justify_end()
      .child(ui.button(t, {
        id: `fabric-inbox-reject-${id}`,
        label: rejecting ? "Zurückweisen senden" : "Zurückweisen…",
        small: true,
        danger: true,
        busy: app.busy === "reject",
        disabled: Boolean(app.busy),
        onClick: (cx) => {
          if (!rejecting) { app.inboxRejectFor = id; app.notifyNow(); return; }
          cx.spawn(async () => { await app.rejectFromInbox(id); });
        },
      }))
      .child(ui.button(t, {
        id: `fabric-inbox-accept-${id}`,
        label: "Abnehmen",
        small: true,
        primary: true,
        busy: app.busy === "accept",
        disabled: Boolean(app.busy) || !state.data?.head,
        tooltip: "fab accept: mergen, aufräumen, done",
        onClick: (cx) => cx.spawn(async () => { await app.acceptFromInbox(id); }),
      }))));
}

function pageRow(app, cx, t, entry, index) {
  const kind = model.INBOX_WORDS[entry.kind] ?? entry.kind ?? "Hinweis";
  const color = ui.inboxColor(t, entry.kind);
  const retry = model.inboxRetry(entry);
  // Einträge ohne Ticket sind Alarme (main rot, Pause, Wächter): Sie lassen
  // sich quittieren, aber nicht als Ticket öffnen.
  const alarm = !entry.ticket;
  const title = alarm ? "Alarm" : model.ticketTitle(app.tickets, entry.ticket);
  const open = (cx) => { if (!alarm) app.navigate("ticket", { id: entry.ticket }, cx); };
  return h_flex()
    .id(`fabric-inbox-page-${entry.ticket}-${index}`)
    .flex_none()
    .w_full()
    .px(S.l)
    .py(S.m)
    .gap(S.m)
    .items_start()
    .border_b(1)
    .border_color(t.border)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); open(cx); })
    .child(div().flex_none().w(112).child(ui.chip(t, kind, color)))
    .child(
      v_flex().flex_1().min_w(0).gap(S.xs)
        .child(
          h_flex().w_full().min_w(0).gap(S.s).items_center()
            .child(div().flex_none().text_size(T.xs).font_semibold().text_color(t.accent).child(entry.ticket ?? ""))
            .child(div().flex_1().min_w(0).truncate().text_size(T.s).font_medium().text_color(t.foreground)
              .child(title || "Ohne Titel").tooltip(title || "")),
        )
        .child(
          div().w_full().text_size(T.s).text_color(t.muted).line_height(1.4).max_h(60).overflow_hidden()
            .child(TextView.markdown(
              `fabric-inbox-page-text-${entry.ticket}-${index}`,
              model.plainMentionMarkdown(model.oneLine(entry.text, 400)),
            ).text_size(T.s).text_color(t.muted)),
        )
        .when(Boolean(retry), (el) => el.child(
          div().text_size(T.xs).text_color(t.dim)
            .child(`${entry.agent} · ${model.oneLine(entry.reason || "Grund unbekannt", 160)}`),
        ))
        .when(entry.kind === "review" && Boolean(app.inboxDiff[entry.ticket]?.open), (el) => el.child(
          reviewPanel(app, cx, t, entry.ticket),
        )),
    )
    .child(
      v_flex().flex_none().w(140).gap(S.s).items_end()
        .child(div().text_size(T.xs).text_color(t.dim)
          .child(`${entry.from ?? "fab"} · ${model.relativeTime(entry.at)}`)
          .tooltip(model.absoluteTime(entry.at)))
        .child(h_flex().gap(S.xs)
          .when(entry.kind === "review", (el) => el.child(ui.button(t, {
            id: `fabric-inbox-page-diff-${entry.ticket}-${index}`,
            label: app.inboxDiff[entry.ticket]?.open ? "Änderungen ▴" : "Änderungen",
            small: true,
            tooltip: "Geänderte Dateien zeigen; danach lässt sich hier abnehmen",
            onClick: (cx) => cx.spawn(async () => { await app.toggleInboxDiff(entry.ticket); }),
          })))
          .when(Boolean(retry), (el) => el.child(ui.button(t, {
            id: `fabric-inbox-page-retry-${entry.ticket}-${index}`,
            label: "Erneut starten",
            small: true,
            tooltip: "Den Agenten erneut starten und den Hinweis bei Erfolg entfernen",
            onClick: (cx) => app.retryAgent(entry, cx),
          })))
          .child(alarm
            ? ui.button(t, {
              id: `fabric-inbox-page-ack-${index}`,
              label: "Quittieren",
              small: true,
              tooltip: "fab alarm ack",
              onClick: (cx) => cx.spawn(async () => { await app.ackAlarms(); }),
            })
            : ui.button(t, {
              id: `fabric-inbox-page-open-${entry.ticket}-${index}`,
              label: entry.kind === "review" ? "Prüfen" : "Öffnen",
              small: true,
              primary: entry.kind === "review",
              onClick: open,
            }))),
    );
}

export function renderInboxPage(app, cx, t) {
  // Der globale Fabric-Filter gilt auch hier; Alarme ohne Ticket bleiben.
  const entries = model.fabricScopeByTicket(app.index?.inbox, app.tickets, app.fabricScope);
  const view = model.inboxPage(entries, app.inboxFilter);
  const cards = view.showCards
    ? model.inboxCards(entries, app.events).filter((card) => card.status === "open")
    : [];
  const openCards = cards.length;
  const total = view.filters[0].count;

  const filterBar = h_flex()
    .flex_none()
    .w_full()
    .px(S.l)
    .py(S.s)
    .gap(S.s)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(ui.tabs(t, {
      id: "fabric-inbox-filter",
      value: view.filter,
      items: view.filters.map((item) => ({
        value: item.key,
        label: item.count ? `${item.label} ${item.count}` : item.label,
      })),
      onPick: (value) => { app.inboxFilter = value; app.notifyNow(); },
    }));

  let body;
  if (!app.index) {
    body = app.loadError
      ? ui.emptyState(t, { title: "Posteingang nicht lesbar", text: "Der Index konnte nicht gelesen werden." })
      : ui.loading(t, "Posteingang wird geladen …");
  } else if (!cards.length && !view.entries.length) {
    body = ui.emptyState(t, {
      title: total ? "In diesem Filter ist nichts" : "Nichts zu tun",
      text: total
        ? "Ein anderer Filter zeigt die übrigen Einträge."
        : "Fragen, Prüfungen, Aufmerksamkeit und Entscheidungen erscheinen hier.",
      action: total
        ? ui.button(t, { id: "fabric-inbox-all", label: "Alle zeigen", onClick: () => { app.inboxFilter = "all"; app.notifyNow(); } })
        : ui.button(t, { id: "fabric-inbox-board", label: "Zum Board", icon: "board", onClick: (cx) => app.navigate("board", {}, cx) }),
    });
  } else {
    body = v_flex().flex_1().min_h(0).overflow_y_scrollbar()
      .when(cards.length > 0, (el) => el.child(
        // flex_none: Im scrollenden Spaltencontainer schrumpfte der Block
        // sonst und schnitt die erste Karte oben ab.
        v_flex().flex_none().w_full().px(S.l).py(S.m).gap(S.s).border_b(1).border_color(t.border)
          .child(ui.sectionTitle(t, "Zu entscheiden", [ui.badge(t, openCards, openCards ? t.working : t.dim)]))
          .children(cards.map((card) => ui.proposalCard(t, card, {
            compact: false,
            busy: app.busy === "proposal",
            onAccept: (cx) => app.applyProposal(card, "accept", cx),
            onReject: (cx) => app.applyProposal(card, "reject", cx),
            onOpenTicket: (cx) => app.navigate("ticket", { id: card.ticket }, cx),
          })))
          .when(Boolean(app.errorFor("proposal")), (el) => el.child(
            ui.notice(t, app.errorFor("proposal").text, app.errorFor("proposal").level))),
      ))
      .children(view.entries.map((entry, index) => pageRow(app, cx, t, entry, index)));
  }

  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("inbox"), [
      div().text_size(T.xs).text_color(t.dim)
        .child(total === 1 ? "1 Eintrag" : `${total} Einträge`),
    ], {
      iconName: "inbox",
      subtitle: `Was auf dich wartet: prüfen, antworten, entscheiden${app.fabricScope ? ` · Fabric ${app.fabricScope}` : ""}`,
      compact: app.compact,
    }))
    .when(Boolean(app.flash?.text), (el) => el.child(ui.notice(t, app.flash.text, app.flash.level)))
    .child(filterBar)
    .child(body);
}
