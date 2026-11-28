// Einstellungen: Datenordner, Zähler, Version, Datenbankpfad und Tasten.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { notify, shared } from "herdr";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

const KEYS = [
  ["⌘⇧F", "Fabric-Fenster öffnen und schließen"],
  ["⌘⇧N", "Neues Ticket (Panel und Layout)"],
  ["⌘⇧1", "Panel Tickets zeigen oder verbergen"],
  ["⌘⇧2", "Panel Zeitverlauf zeigen oder verbergen"],
  ["⌘N", "Neues Ticket im Fenster"],
  ["⌘S", "Aktiven Editor speichern"],
  ["⌘⏎", "Kommentar senden"],
  ["/", "Suche fokussieren"],
  ["↑ ↓", "In Listen wandern"],
  ["⏎", "Gewähltes Ticket öffnen"],
  ["Esc", "Zurück, Dialog schließen, Fenster schließen"],
];

function infoRow(app, t, label, value, { copy = null, mono = false } = {}) {
  return h_flex()
    .w_full()
    .min_h(28)
    .gap(S.s)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(div().w(150).flex_none().text_size(T.xs).text_color(t.dim).child(label))
    .child(div().flex_1().min_w(0).truncate().text_size(T.s).text_color(t.foreground)
      .when(mono, (el) => el.font_family("monospace")).child(value ?? "—").tooltip(String(value ?? "")))
    .when(Boolean(copy), (el) => el.child(ui.iconButton(t, {
      id: `fabric-info-copy-${label}`,
      icon: "copy",
      tooltip: `${label} kopieren`,
      size: 24,
      iconSize: 12,
      onClick: (cx) => app.copyText(cx, copy, `${label} kopiert.`),
    })));
}

function dataCard(app, cx, t) {
  const counts = model.groupByStage(app.tickets).map((stage) => `${stage.tickets.length} ${stage.label}`);
  return ui.card(t, [
    ui.sectionTitle(t, "Daten", [
      ui.button(t, {
        id: "fabric-settings-index",
        label: "Index neu erzeugen",
        icon: "restart",
        small: true,
        busy: app.busy === "index",
        disabled: Boolean(app.busy),
        tooltip: "fab index",
        onClick: (cx) => app.rebuildIndex(cx),
      }),
    ]),
    infoRow(app, t, "Datenordner", app.dir, { copy: app.dir, mono: true }),
    infoRow(app, t, "Tickets", String(app.tickets.length)),
    infoRow(app, t, "Ereignisse", String(app.events.length)),
    infoRow(app, t, "Stand des Index", model.absoluteTime(app.index?.generated_at) || "—"),
    div().text_size(T.xs).text_color(t.dim).whitespace_normal()
      .child(`Stufen: ${counts.join(" · ")}`),
  ], { id: "fabric-settings-data", padding: S.m, gap: S.xs });
}

function metricsCard(app, t) {
  const totals = model.costTotals(app.tickets);
  const limitHint = totals.overLimit > 0
    ? `${totals.overLimit} Ticket${totals.overLimit === 1 ? "" : "s"} über dem Kostenlimit`
    : "";
  return ui.card(t, [
    ui.sectionTitle(t, "Kosten", [], "Aus dem Index; aktualisiert sich mit ihm."),
    infoRow(app, t, "Gesamt", model.formatCost(totals.total)),
    infoRow(app, t, "Heute", model.formatCost(totals.today)),
    ...totals.teams.map((team) => infoRow(app, t, team.name,
      `${model.formatCost(team.total)} · heute ${model.formatCost(team.today)} · ${team.tickets} Ticket${team.tickets === 1 ? "" : "s"}`)),
    ...totals.agents.map((agent) => infoRow(app, t, `· ${agent.name}`,
      `${model.formatCost(agent.total)} · ${agent.tickets} Ticket${agent.tickets === 1 ? "" : "s"} · ${totals.total > 0 ? Math.round((agent.total / totals.total) * 100) : 0} %`)),
    ...(limitHint ? [div().text_size(T.xs).text_color(t.blocked).whitespace_normal().child(limitHint)] : []),
  ], { id: "fabric-settings-cost", padding: S.m, gap: S.xs });
}

function versionCard(app, cx, t) {
  return ui.card(t, [
    ui.sectionTitle(t, "Fabric"),
    infoRow(app, t, "Version", app.version || (app.versionError ? `nicht lesbar: ${app.versionError}` : "wird gelesen …"), { mono: true }),
    infoRow(app, t, "Datenbank", `${app.dir}/fabric.db`, {
      copy: `${app.dir}/fabric.db`, mono: true,
    }),
    infoRow(app, t, "CLI", `${app.dir.replace(/\/data\/fabric$/, "")}/fabric/fab`, {
      copy: `${app.dir.replace(/\/data\/fabric$/, "")}/fabric/fab`, mono: true,
    }),
    infoRow(app, t, "Agenten", `${app.agents.length} im Roster · Prüfer ${app.roster?.reviewer ?? "—"}`),
  ], { id: "fabric-settings-version", padding: S.m, gap: S.xs });
}

function keysCard(app, cx, t) {
  return ui.card(t, [
    ui.sectionTitle(t, "Tasten", [], "Alle Aktionen haben auch einen sichtbaren Knopf."),
    ...KEYS.map(([key, action]) => h_flex()
      .w_full()
      .min_h(26)
      .gap(S.s)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().w(70).flex_none().child(ui.keyHint(t, key)))
      .child(div().flex_1().text_size(T.s).text_color(t.muted).child(action))),
  ], { id: "fabric-settings-keys", padding: S.m, gap: S.xs });
}

function notifyCard(app, cx, t, settings) {
  const hour = (value) => `${String(value).padStart(2, "0")}:00`;
  const stepper = (field, label) => {
    const id = `fabric-notify-${field.replace("_", "-")}`;
    const title = `Ruhezeit ${label === "bis" ? "bis" : "von"}`;
    return h_flex()
      .w_full()
      .min_h(28)
      .gap(S.s)
      .items_center()
      .child(div().w(150).flex_none().text_size(T.xs).text_color(t.dim).child(label))
      .child(ui.button(t, {
        id: `${id}-minus`,
        label: "−",
        small: true,
        tooltip: `${title}: eine Stunde früher`,
        onClick: (cx) => app.stepNotify(field, -1, cx),
      }))
      .child(div().w(52).text_size(T.s).text_color(t.foreground).child(hour(settings[field])))
      .child(ui.button(t, {
        id: `${id}-plus`,
        label: "+",
        small: true,
        tooltip: `${title}: eine Stunde später`,
        onClick: (cx) => app.stepNotify(field, 1, cx),
      }));
  };
  return ui.card(t, [
    ui.sectionTitle(t, "Benachrichtigungen", [], "Neue Posteingang-Einträge melden sich einmal, mit Ton."),
    ui.switchRow(t, {
      id: "fabric-notify-enabled",
      checked: settings.enabled,
      label: "Toasts für neue Posteingang-Einträge",
      detail: "In der Ruhezeit kommen keine Toasts; der Eintrag bleibt im Posteingang.",
      onChange: (enabled) => app.setNotify({ enabled }, cx),
    }),
    stepper("quiet_from", "Ruhezeit von"),
    stepper("quiet_to", "bis"),
  ], { id: "fabric-settings-notify", padding: S.m, gap: S.xs });
}

function pauseCard(app, cx, t) {
  const paused = Boolean(app.index?.paused);
  return ui.card(t, [
    ui.sectionTitle(t, "Betrieb", [
      ui.chip(t, paused ? "pausiert" : "läuft", paused ? t.working : t.done),
    ], "Pausiert weckt und startet die Fabric niemanden: kein fab tick, kein Autopilot, kein Orchestrator, keine Agenten."),
    ui.switchRow(t, {
      id: "fabric-paused",
      checked: paused,
      label: "Fabric pausieren",
      detail: paused
        ? "Ausschalten startet Wächter und Orchestrator wieder (fab resume); den Autopiloten startest du getrennt."
        : "Einschalten beendet Autopilot, Orchestrator und laufende Agenten-Sessions (fab pause).",
      disabled: Boolean(app.busy),
      onChange: (on) => app.setPaused(on, cx),
    }),
  ], { id: "fabric-settings-pause", padding: S.m, gap: S.xs });
}

export function renderSettings(app, cx, t) {
  const settings = model.normalizeNotifySettings(shared(model.NOTIFY_SETTINGS_KEY));
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("settings"), [
      ui.iconButton(t, {
        id: "fabric-settings-refresh",
        icon: "restart",
        tooltip: "Version und Zähler neu lesen",
        onClick: (cx) => { app.loadVersion(cx); app.refresh(cx); },
      }),
    ], { iconName: "settings", subtitle: "Daten, Version und Tastenbelegung" }))
    .when(Boolean(app.loadError), (el) => el.child(ui.notice(t, app.loadError)))
    .when(Boolean(app.errorFor("index")), (el) => el.child(ui.notice(t, app.errorFor("index").text, app.errorFor("index").level)))
    .when(Boolean(app.flash?.text), (el) => el.child(ui.notice(t, app.flash.text, app.flash.level)))
    .child(
      v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.l).gap(S.m)
        .child(v_flex().w_full().max_w(900).gap(S.m)
          .child(h_flex().w_full().gap(S.m).items_start().flex_wrap()
            .child(div().flex_1().min_w(280).child(dataCard(app, cx, t)))
            .child(div().flex_1().min_w(280).child(metricsCard(app, t)))
            .child(div().flex_1().min_w(280).child(versionCard(app, cx, t))))
          .child(pauseCard(app, cx, t))
          .child(notifyCard(app, cx, t, settings))
          .child(keysCard(app, cx, t))),
    );
}
