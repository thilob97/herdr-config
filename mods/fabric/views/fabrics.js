// Fabrics: benannte Gruppen von Teams im einen Fabric-Datenbestand.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LIST = ui.SIZE.listPane;

function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function fabricMeta(row) {
  const teams = row.teams?.length ?? 0;
  const repos = row.repos?.length ?? 0;
  return `${count(teams, "Team", "Teams")} · ${count(repos, "Repo", "Repos")} · ${count(row.open_tickets, "offenes Ticket", "offene Tickets")}`;
}

function fabricRow(app, cx, t, row, active) {
  return v_flex()
    .id(`fabric-list-${row.name}`)
    .w_full()
    .p(S.s)
    .gap(2)
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + ui.ALPHA.clear)
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      app.selectFabric(row.name, cx);
    })
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(div().flex_none().text_color(active ? t.accent : t.dim).child(ui.icon("fabric", 13)))
        .child(div().flex_1().min_w(0).truncate().text_size(T.s)
          .text_color(active ? t.foreground : t.muted).child(row.name))
        .when(row.default, (el) => el.child(ui.chip(t, "Standard", t.muted))),
    )
    .when(Boolean(row.note), (el) => el.child(div().w_full().truncate().text_size(T.xs).text_color(t.muted)
      .child(row.note).tooltip(row.note)))
    .child(div().w_full().truncate().text_size(T.xs).text_color(t.dim).child(fabricMeta(row)));
}

function list(app, cx, t, rows, selected) {
  return v_flex()
    .w(LIST)
    .min_w(LIST)
    .h_full()
    .border_r(1)
    .border_color(t.border)
    .child(
      h_flex().w_full().px(S.m).py(S.s).gap(S.s).items_center()
        .child(div().flex_1())
        .child(ui.button(t, {
          id: "fabric-new",
          label: "Neue Fabric",
          icon: "plus",
          small: true,
          primary: true,
          tooltip: "Fabric anlegen (fab fabric add)",
          onClick: (cx) => app.openNewFabric(cx),
        })),
    )
    .child(
      rows.length
        ? v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.xs).gap(S.xs)
          .children(rows.map((row) => fabricRow(app, cx, t, row, row.name === selected)))
        : v_flex().flex_1().min_h(0).p(S.s).child(ui.emptyState(t, {
          title: "Noch keine Fabrics",
          text: "Eine Fabric gruppiert Teams. „standard“ wird von fab angelegt.",
          compact: true,
          action: ui.button(t, {
            id: "fabric-empty-new",
            label: "Neue Fabric",
            icon: "plus",
            onClick: (cx) => app.openNewFabric(cx),
          }),
        })),
    );
}

function teamCard(app, cx, t, team) {
  const repos = team.repos ?? [];
  const members = (team.members ?? []).map((member) => member?.blueprint).filter(Boolean);
  const state = app.orchestratorState(team.name);
  const status = ui.orchestratorStatus(t, state);
  const reviewers = team.reviewer ? `Prüfer: ${team.reviewer}` : "Prüfer: offen";
  return ui.card(t, [
    h_flex().w_full().gap(S.s).items_center().flex_wrap()
      .child(div().flex_none().text_color(t.dim).child(ui.icon("team", 13)))
      .child(div().flex_1().min_w(80).truncate().text_size(T.s).font_medium().text_color(t.foreground)
        .child(team.name))
      .child(ui.pill(t, {
        id: `fabric-team-pill-${team.name}`,
        label: `Orchestrator: ${model.orchestratorWord(state)}`,
        color: status.color,
        tooltip: state
          ? `Orchestrator ${model.orchestratorWord(state)} · ${state.name ?? ""} ${state.terminal ?? ""}`
          : "Orchestrator-Status unbekannt",
      }))
      .when(!state?.live, (el) => el.child(ui.button(t, {
        id: `fabric-team-start-${team.name}`,
        label: "Starten",
        icon: "play",
        small: true,
        busy: app.busy === `orchestrator:${team.name}`,
        disabled: Boolean(app.busy),
        tooltip: `Orchestrator für ${team.name} starten (fab orchestrator start ${team.name})`,
        onClick: (cx) => app.orchestrator("start", team.name, cx),
      }))),
    h_flex().w_full().gap(S.xs).items_center().flex_wrap()
      .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(
        repos.length ? "Repos" : "Keine Repos",
      ))
      .children(repos.slice(0, 3).map((path, index) => ui.chip(t, model.repoName(path), t.muted,
        `fabric-team-repo-${team.name}-${index}`, { tooltip: path })))
      .when(repos.length > 3, (el) => el.child(ui.chip(t, `+${repos.length - 3}`, t.dim))),
    h_flex().w_full().gap(S.s).items_center().flex_wrap()
      .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.dim)
        .child(members.length ? `Mitglieder: ${members.join(", ")}` : "Keine Mitglieder")
        .tooltip(members.join(", ") || "Keine Mitglieder"))
      .child(div().flex_none().text_size(T.xs).text_color(t.dim)
        .child(`${reviewers} · ${count(team.max_sessions ?? 4, "Session", "Sessions")}`)),
  ], {
    padding: S.s,
    gap: S.xs,
    id: `fabric-team-card-${team.name}`,
    hover: true,
    onClick: (cx) => app.navigate("team", {}, cx),
  });
}

function editForm(app, cx, t, row) {
  const rename = app.fabricRename;
  const note = app.fabricNote;
  const nameValue = rename?.value() ?? row.name;
  const noteValue = note?.value() ?? row.note;
  const dirty = model.isDirty(nameValue, row.name) || model.isDirty(noteValue, row.note);
  const busy = app.busy === `fabric:${row.name}`;
  const error = app.errorFor(`fabric:${row.name}`);
  return ui.card(t, [
    ui.sectionTitle(t, row.default ? "Notiz" : "Name und Notiz", [],
      row.default ? "Die Standard-Fabric behält ihren Namen." : null),
    ...(row.default ? [] : [ui.field(t, "Name", rename ? ui.input(t, rename) : div(), {
      hint: "Kleinbuchstaben, Ziffern, „_“ und „-“, 1–16 Zeichen",
    })]),
    row.default ? (note ? ui.input(t, note) : div()) : ui.field(t, "Notiz", note ? ui.input(t, note) : div()),
    h_flex().w_full().gap(S.s).items_center()
      .child(ui.button(t, {
        id: `fabric-save-${row.name}`,
        label: "Speichern",
        icon: "save",
        primary: true,
        small: true,
        busy,
        disabled: Boolean(app.busy) || !dirty,
        reason: dirty ? "" : "Keine Änderungen",
        tooltip: "Name und Notiz speichern (fab fabric edit)",
        onClick: (cx) => cx.spawn(async () => { await app.saveFabric(cx); }),
      }))
      .when(dirty, (el) => el.child(ui.chip(t, "ungespeichert", t.working))),
    ...(error ? [ui.notice(t, error.text, error.level)] : []),
  ], { padding: S.m, gap: S.s, id: `fabric-edit-${row.name}` });
}

function teamsSection(app, cx, t, row, teams) {
  const otherTeams = (app.roster?.teams ?? [])
    .filter((team) => team?.name && model.teamFabric(team) !== row.name)
    .map((team) => ({
      value: team.name,
      label: team.name,
      detail: `Fabric ${model.teamFabric(team)}`,
      selected: false,
    }));
  const moveKey = `fabric-assign-${row.name}`;
  const error = app.errorFor("fabric-move");
  return v_flex().w_full().gap(S.s)
    .child(
      h_flex().w_full().gap(S.s).items_center().flex_wrap()
        .child(div().flex_1().min_w(80).text_size(T.s).font_semibold().text_color(t.muted).child("Teams"))
        .child(ui.button(t, {
          id: `fabric-team-new-${row.name}`,
          label: "Neues Team in dieser Fabric",
          icon: "plus",
          small: true,
          tooltip: `Neues Team mit Fabric ${row.name} (fab team add)`,
          onClick: (cx) => app.openNewTeam(cx, row.name),
        }))
        .child(div().w(190).flex_none().child(ui.dropdown(t, {
          id: moveKey,
          value: "",
          placeholder: "Team zuweisen…",
          options: otherTeams,
          open: app.menu === moveKey,
          width: 230,
          scrollHandle: app.dropdownScroll,
          empty: "Keine Teams in anderen Fabrics.",
          onToggle: () => {
            app.menu = app.menu === moveKey ? null : moveKey;
            cx.notify();
          },
          onPick: (value) => cx.spawn(async () => { await app.moveTeamFabric(value, row.name, cx); }),
        }))),
    )
    .when(Boolean(error), (el) => el.child(ui.notice(t, error.text, error.level)))
    .children(teams.length
      ? teams.map((team) => teamCard(app, cx, t, team))
      : [ui.emptyState(t, {
        title: "Noch keine Teams in dieser Fabric",
        text: "Ein Team verbindet Repos, Blaupausen und einen Prüfer. Teams lassen sich hier anlegen oder aus einer anderen Fabric zuweisen.",
        compact: true,
        action: ui.button(t, {
          id: `fabric-team-empty-new-${row.name}`,
          label: "Neues Team",
          icon: "plus",
          onClick: (cx) => app.openNewTeam(cx, row.name),
        }),
      })]);
}

function reposSection(t, repos) {
  return ui.card(t, [
    ui.sectionTitle(t, "Repos", [], count(repos.length, "Repo", "Repos")),
    ...(repos.length
      ? repos.map((path, index) => h_flex()
        .id(`fabric-repo-${index}`)
        .w_full()
        .gap(S.s)
        .items_center()
        .child(div().flex_none().text_color(t.dim).child(ui.icon("repo", 12)))
        .child(div().flex_1().min_w(0).truncate().text_size(T.s).text_color(t.muted)
          .child(model.repoName(path)).tooltip(path))
        .child(div().flex_none().max_w(260).truncate().text_size(T.xs).text_color(t.dim)
          .child(path).tooltip(path)))
      : [ui.hint(t, "Sobald ein Team Repos hat, erscheinen sie auch hier.")]),
  ], { padding: S.m, gap: S.xs, id: "fabric-repos" });
}

function detail(app, cx, t, row) {
  if (!row) {
    return v_flex().flex_1().min_h(0).child(ui.emptyState(t, {
      title: "Keine Fabric gewählt",
      text: "Links eine Fabric wählen oder eine neue anlegen.",
      action: ui.button(t, {
        id: "fabric-detail-new",
        label: "Neue Fabric",
        icon: "plus",
        primary: true,
        onClick: (cx) => app.openNewFabric(cx),
      }),
    }));
  }
  app.ensureFabricForm(row.name);
  const rosterTeams = app.roster?.teams ?? [];
  const teams = row.teamRows.length
    ? row.teamRows
    : (row.teams ?? []).map((name) => rosterTeams.find((team) => team.name === name)).filter(Boolean);
  const repos = [...new Set([
    ...(row.repos ?? []),
    ...teams.flatMap((team) => team.repos ?? []),
  ])].filter(Boolean);
  return v_flex()
    .flex_1()
    .min_w(ui.SIZE.inspector)
    .h_full()
    .min_h(0)
    .child(ui.detailHeader(t, row.name, [
      ...(row.default ? [ui.chip(t, "Standard", t.muted, null, { tooltip: "Teams ohne eigene Fabric landen hier; sie lässt sich nicht löschen." })] : [ui.button(t, {
        id: `fabric-delete-${row.name}`,
        label: "Löschen",
        icon: "trash",
        danger: true,
        small: true,
        disabled: Boolean(app.busy),
        tooltip: `Fabric ${row.name} löschen (fragt nach)`,
        onClick: (cx) => app.confirmDeleteFabric(row, cx),
      })]),
    ], { subtitle: [row.note, fabricMeta(row)].filter(Boolean).join(" · ") }))
    .child(
      v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.l).gap(S.m)
        .child(v_flex().w_full().max_w(980).gap(S.m)
          .child(editForm(app, cx, t, row))
          .child(teamsSection(app, cx, t, row, teams))
          .child(reposSection(t, repos))),
    );
}

export function renderFabricsPage(app, cx, t) {
  const rows = app.fabricRows();
  const selected = app.fabricSelectedName();
  const row = rows.find((item) => item.name === selected) ?? null;
  return v_flex()
    .size_full()
    .min_h(0)
    .child(app.areaHeader(t, cx, []))
    .when(Boolean(app.fabricListError), (el) => el.child(ui.notice(t, app.fabricListError)))
    .when(Boolean(app.rosterError), (el) => el.child(ui.notice(t, app.rosterError)))
    .child(
      !app.roster && !app.fabricList
        ? (app.rosterError
          ? ui.emptyState(t, { title: "Fabrics nicht lesbar", text: "Details stehen oben." })
          : ui.loading(t, "Fabrics werden geladen …"))
        : h_flex().flex_1().min_h(0).items_stretch()
          .child(list(app, cx, t, rows, selected))
          .child(detail(app, cx, t, row)),
    );
}
