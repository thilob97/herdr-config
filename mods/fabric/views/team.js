// Team: Agentenkarten im responsiven Raster, Orchestrator, Drawer und Einstellungen.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, terminals } from "herdr";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const CARD_MIN = 280;

/** Eine Definitionszeile: Label links, Wert rechts, lang -> gekürzt + Tooltip. */
function definition(t, label, value, tooltip = null) {
  const shown = value == null || value === "" ? "—" : String(value);
  return h_flex()
    .w_full()
    .min_h(22)
    .gap(S.s)
    .items_center()
    .child(div().flex_none().w(72).text_size(T.xs).text_color(t.dim).whitespace_nowrap().child(label))
    .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.foreground)
      .child(shown).tooltip(tooltip ?? shown));
}

function sessionChip(t, session, index, id) {
  const look = model.sessionStatus(session.status);
  const color = ui.sessionColor(t, look.color);
  return ui.chip(t, `${session.name || session.terminal || "Session"} · ${look.word}`, color, `${id}-${index}`, {
    tooltip: session.terminal
      ? `Terminal ${session.terminal} · ${look.word} · klicken zum Öffnen`
      : `${session.name ?? "Session"} · ${look.word}`,
    onClick: session.terminal ? (cx) => run("terminal.peek", { terminal: session.terminal }) : null,
  });
}

function agentCard(app, cx, t, agent) {
  const parts = model.argvParts(agent.argv ?? []);
  const program = agent.program ?? parts.program;
  const modelName = agent.model ?? parts.model;
  const flags = agent.flags ?? parts.flags;
  const sessions = model.liveAgentSessions(agent.name, terminals());
  const reviewer = app.roster?.reviewer === agent.name;
  return ui.card(t, [
    h_flex().w_full().gap(S.s).items_center()
      .child(ui.avatar(t, agent.name, agent.color, 32))
      .child(v_flex().flex_1().min_w(0).gap(0)
        .child(h_flex().gap(6).items_center()
          .child(div().text_size(T.m).font_semibold().whitespace_nowrap().child(agent.name))
          .when(reviewer, (el) => el.child(ui.chip(t, "Prüferin/Prüfer", t.done))))
        .child(div().text_size(T.xs).text_color(t.dim).truncate()
          .child(agent.role || "ohne Rolle").tooltip(agent.role || "ohne Rolle"))),
    v_flex().w_full().gap(1)
      .child(definition(t, "Programm", program, model.argvSummary(program, modelName, flags)))
      .child(definition(t, "Modell", modelName, modelName))
      .child(definition(t, "Flags", model.flagsText(flags), model.flagsText(flags))),
    h_flex().w_full().gap(6).items_center().flex_wrap()
      .child(ui.chip(t, `${agent.open_tickets ?? 0} offen`, (agent.open_tickets ?? 0) ? t.accent : t.dim))
      .child(ui.chip(t, `${sessions.length} Session${sessions.length === 1 ? "" : "s"}`, sessions.length ? t.working : t.dim))
      .child(div().flex_1())
      .child(ui.button(t, {
        id: `fabric-agent-edit-${agent.name}`,
        label: "Bearbeiten",
        icon: "edit",
        small: true,
        tooltip: `Agent ${agent.name} bearbeiten`,
        onClick: (cx) => app.openAgentDrawer("edit", agent, cx),
      })),
    h_flex().w_full().gap(4).flex_wrap()
      .when(sessions.length === 0, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Keine laufende Session")))
      .children(sessions.map((session, index) => sessionChip(t, session, index, `fabric-agent-session-${agent.name}`))),
  ], { id: `fabric-agent-card-${agent.name}`, padding: S.m, gap: S.s });
}

function orchestratorCard(app, cx, t) {
  const state = app.orchestratorState();
  const live = ui.orchestratorStatus(t, state);
  const argv = app.roster?.orchestrator?.argv ?? state?.argv ?? [];
  const parts = model.argvParts(argv);
  const started = state?.started_at
    ? `Gestartet ${model.relativeTime(state.started_at)}`
    : state?.live ? `Läuft · ${state.terminal ?? "Terminal"}` : "Noch nicht gestartet";
  return ui.card(t, [
    h_flex().w_full().gap(S.s).items_center()
      .child(div().flex_none().text_color(t.foreground).child(ui.icon("fabric", 16)))
      .child(div().text_size(T.m).font_semibold().whitespace_nowrap().child("Orchestrator"))
      .child(ui.pill(t, { label: live.word, color: live.color, tooltip: state?.terminal ? `Terminal ${state.terminal}` : "Kein Terminal" }))
      .child(div().flex_1())
      .child(div().max_w(220).min_w(0).truncate().text_size(T.xs).text_color(t.dim)
        .child(state?.terminal ?? "kein Terminal").tooltip(state?.terminal ?? "kein Terminal")),
    v_flex().w_full().gap(1)
      .child(definition(t, "Programm", parts.program, parts.program))
      .child(definition(t, "Modell", parts.model, parts.model))
      .child(definition(t, "Flags", model.flagsText(parts.flags), model.flagsText(parts.flags))),
    h_flex().w_full().gap(S.s).items_center().flex_wrap()
      .child(ui.button(t, {
        id: "fabric-orchestrator-prompt",
        label: "Prompt",
        icon: "prompt",
        small: true,
        tooltip: "Orchestrator-Prompt öffnen",
        onClick: (cx) => app.navigate("prompts", { name: "orchestrator" }, cx),
      }))
      .child(ui.button(t, {
        id: "fabric-orchestrator-start",
        label: "Start",
        icon: "play",
        small: true,
        busy: app.busy === "orchestrator",
        disabled: Boolean(app.busy) || Boolean(state?.live),
        reason: state?.live ? "Läuft bereits" : "",
        tooltip: "Orchestrator starten (fab orchestrator start)",
        onClick: (cx) => app.orchestrator("start", cx),
      }))
      .child(ui.button(t, {
        id: "fabric-orchestrator-stop",
        label: "Stopp",
        icon: "stop",
        small: true,
        disabled: Boolean(app.busy) || !state?.live,
        reason: state?.live ? "" : "Läuft nicht",
        tooltip: "Orchestrator stoppen (fab orchestrator stop)",
        onClick: (cx) => app.orchestrator("stop", cx),
      }))
      .child(ui.button(t, {
        id: "fabric-orchestrator-restart",
        label: "Neu starten",
        icon: "restart",
        small: true,
        busy: app.busy === "orchestrator",
        disabled: Boolean(app.busy),
        tooltip: "Orchestrator neu starten (fab orchestrator restart)",
        onClick: (cx) => app.orchestrator("restart", cx),
      }))
      .child(ui.button(t, {
        id: "fabric-orchestrator-terminal",
        label: "Terminal öffnen",
        icon: "terminal",
        small: true,
        disabled: !state?.terminal,
        reason: state?.terminal ? "" : "Kein laufendes Terminal",
        tooltip: "Orchestrator-Terminal zeigen",
        onClick: (cx) => app.peekOrchestrator(cx),
      })),
    ...(app.errorFor("orchestrator") || app.orchestratorError
      ? [ui.notice(t, (app.errorFor("orchestrator") || { text: app.orchestratorError }).text,
        (app.errorFor("orchestrator") || { level: "error" }).level)] : []),
    h_flex().w_full().gap(6).items_center()
      .child(div().text_size(T.xs).text_color(t.dim).whitespace_nowrap().child(started))
      .child(div().flex_1())
      .child(div().text_size(T.xs).text_color(t.dim).truncate()
        .child(model.oneLine(app.roster?.orchestrator?.prompt ?? "", 40))
        .tooltip(app.roster?.orchestrator?.prompt ?? "")),
  ], { id: "fabric-orchestrator-card", padding: S.m, gap: S.s });
}

function settingsCard(app, cx, t) {
  const roster = app.roster;
  const agents = app.agents;
  const dirty = app.teamSettingsDirty();
  const reviewer = app.reviewerDraft ?? roster?.reviewer ?? "";
  return ui.card(t, [
    h_flex().w_full().items_center().gap(S.s)
      .child(div().text_size(T.m).font_semibold().whitespace_nowrap().child("Team-Einstellungen"))
      .child(div().flex_1())
      .when(dirty, (el) => el.child(ui.chip(t, "ungespeichert", t.working))),
    h_flex().w_full().gap(S.m).items_end().flex_wrap()
      .child(v_flex().flex_1().min_w(220).gap(5)
        .child(div().text_size(T.xs).text_color(t.dim).whitespace_nowrap().child("Prüferin / Prüfer"))
        .child(ui.dropdown(t, {
          id: "fabric-team-reviewer",
          value: reviewer,
          placeholder: "Niemand",
          options: agents.map((agent) => ({
            value: agent.name,
            label: agent.name,
            detail: agent.role,
            selected: agent.name === reviewer,
          })),
          open: app.menu === "team-reviewer",
          width: 220,
          scrollHandle: app.dropdownScroll,
          onToggle: () => { app.menu = app.menu === "team-reviewer" ? null : "team-reviewer"; cx.notify(); },
          onPick: (value) => { app.menu = null; app.reviewerDraft = value; cx.notify(); },
        })))
      .child(v_flex().w(220).flex_none().gap(5)
        .child(div().text_size(T.xs).text_color(t.dim).whitespace_nowrap().child("Gleichzeitige Sessions (1–16)"))
        .child(app.maxSessions ? ui.numberInput(t, app.maxSessions) : div())),
    h_flex().w_full().gap(S.s).items_center()
      .child(ui.button(t, {
        id: "fabric-team-save",
        label: "Speichern",
        icon: "save",
        small: true,
        primary: true,
        busy: app.busy === "settings",
        disabled: Boolean(app.busy) || !dirty,
        tooltip: "Prüfer und maximale Sessions speichern (⌘S)",
        onClick: (cx) => app.saveTeamSettings(cx),
      }))
      .child(div().flex_1())
      .child(ui.hint(t, "Prüfer und Sessions werden nacheinander gespeichert; scheitert der zweite Schritt, bleibt der erste gespeichert.")),
    ...(app.errorFor("settings") ? [ui.notice(t, app.errorFor("settings").text, app.errorFor("settings").level)] : []),
    ...(app.rosterError ? [ui.hint(t, app.rosterError)] : []),
  ], { id: "fabric-team-settings", padding: S.m, gap: S.s });
}

export function renderTeam(app, cx, t) {
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, "Team", [
      div().text_size(T.xs).text_color(t.dim).child(
        `${app.agents.length} Agent${app.agents.length === 1 ? "" : "en"} · max. ${app.roster?.max_sessions ?? "—"} Sessions`,
      ),
      ui.button(t, {
        id: "fabric-agent-new",
        label: "Neuer Agent",
        icon: "plus",
        primary: true,
        tooltip: "Agent anlegen",
        onClick: (cx) => app.openAgentDrawer("new", null, cx),
      }),
    ], { iconName: "team", subtitle: "Roster, Sessions und Orchestrator pflegen" }))
    .when(Boolean(app.rosterError), (el) => el.child(ui.notice(t, app.rosterError)))
    .when(Boolean(app.flash?.text), (el) => el.child(ui.notice(t, app.flash.text, app.flash.level)))
    .child(
      app.roster
        ? v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.l).gap(S.m)
          .child(orchestratorCard(app, cx, t))
          .child(
            h_flex().w_full().gap(S.m).items_stretch().flex_wrap()
              .children(app.agents.map((agent) => div()
                .flex_basis(CARD_MIN)
                .flex_grow(1)
                .flex_shrink(1)
                .min_w(CARD_MIN)
                .child(agentCard(app, cx, t, agent)))),
          )
          .child(settingsCard(app, cx, t))
        : ui.loading(t, "Roster wird geladen …"),
    );
}
