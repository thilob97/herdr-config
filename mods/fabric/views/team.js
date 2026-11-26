// Team: Blaupausen und Teamkarten mit Orchestrator, Repos, Mitgliedern und Prüfer.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

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

function argvSummary(argv) {
  const parts = model.argvParts(argv ?? []);
  return model.argvSummary(parts.program, parts.model, parts.flags);
}

function sectionHead(t, title, right = []) {
  return h_flex().w_full().gap(S.s).items_center()
    .child(div().text_size(T.s).font_semibold().whitespace_nowrap().child(title))
    .child(div().flex_1())
    .children(right);
}

function blueprintRow(app, cx, t, blueprint) {
  const parts = model.argvParts(blueprint.argv ?? []);
  const teams = (blueprint.teams ?? []).join(", ") || "—";
  const summary = model.argvSummary(parts.program, parts.model, parts.flags);
  if (app.compact) {
    return v_flex()
      .id(`fabric-blueprint-${blueprint.name}`)
      .w_full()
      .min_w(0)
      .gap(S.xs)
      .py(S.s)
      .border_b(1)
      .border_color(t.border)
      .child(h_flex().w_full().min_w(0).gap(S.s).items_center()
        .child(ui.avatar(t, blueprint.name, blueprint.color || "c1", 28))
        .child(div().flex_1().min_w(0).truncate().text_size(T.m).font_semibold()
          .child(blueprint.name).tooltip(blueprint.name))
        .child(ui.iconButton(t, {
          id: `fabric-blueprint-edit-${blueprint.name}`,
          icon: "edit",
          size: 22,
          iconSize: 12,
          tooltip: `Blaupause ${blueprint.name} bearbeiten`,
          disabled: Boolean(app.busy),
          onClick: (cx) => app.openBlueprintDrawer("edit", blueprint, cx),
        }))
        .child(ui.iconButton(t, {
          id: `fabric-blueprint-delete-${blueprint.name}`,
          icon: "trash",
          size: 22,
          iconSize: 12,
          tooltip: `Blaupause ${blueprint.name} löschen (fragt nach)`,
          disabled: Boolean(app.busy),
          onClick: (cx) => app.confirmDeleteBlueprint(blueprint, cx),
        })))
      .child(h_flex().w_full().min_w(0).gap(S.s).items_center().pl(S.xl)
        .child(ui.chip(t, model.roleLabel(blueprint.role), t.dim,
          `fabric-blueprint-role-${blueprint.name}`,
          { tooltip: model.roleLabel(blueprint.role) }))
        .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.dim)
          .child(`Teams: ${teams}`).tooltip(`Teams: ${teams}`)))
      .child(div().w_full().min_w(0).truncate().pl(S.xl).text_size(T.xs).text_color(t.dim)
        .child(summary).tooltip(summary));
  }
  return h_flex()
    .id(`fabric-blueprint-${blueprint.name}`)
    .w_full()
    .min_h(44)
    .gap(S.s)
    .items_center()
    .py(S.xs)
    .border_b(1)
    .border_color(t.border)
    .child(ui.avatar(t, blueprint.name, blueprint.color || "c1", 28))
    .child(v_flex().flex_1().min_w(0).gap(S.xs)
      .child(h_flex().min_w(0).gap(S.s).items_center()
        .child(div().min_w(0).truncate().text_size(T.m).font_semibold().child(blueprint.name)
          .tooltip(blueprint.name))
        .child(ui.chip(t, model.roleLabel(blueprint.role), t.dim,
          `fabric-blueprint-role-${blueprint.name}`,
          { tooltip: model.roleLabel(blueprint.role) })))
      .child(div().text_size(T.xs).text_color(t.dim).truncate()
        .child(model.argvSummary(parts.program, parts.model, parts.flags))
        .tooltip(model.argvSummary(parts.program, parts.model, parts.flags))))
    .child(div().max_w(220).min_w(0).truncate().text_size(T.xs).text_color(t.dim)
      .child(`Teams: ${teams}`).tooltip(`Teams: ${teams}`))
    .child(ui.iconButton(t, {
      id: `fabric-blueprint-edit-${blueprint.name}`,
      icon: "edit",
      tooltip: `Blaupause ${blueprint.name} bearbeiten`,
      disabled: Boolean(app.busy),
      onClick: (cx) => app.openBlueprintDrawer("edit", blueprint, cx),
    }))
    .child(ui.iconButton(t, {
      id: `fabric-blueprint-delete-${blueprint.name}`,
      icon: "trash",
      tooltip: `Blaupause ${blueprint.name} löschen (fragt nach)`,
      disabled: Boolean(app.busy),
      onClick: (cx) => app.confirmDeleteBlueprint(blueprint, cx),
    }));
}

function blueprintCard(app, cx, t) {
  const blueprints = app.roster?.blueprints ?? [];
  return ui.card(t, [
    sectionHead(t, "Blaupausen", [
      ui.chip(t, String(blueprints.length), t.dim, "fabric-blueprints-count", {
        tooltip: `${blueprints.length} Blaupause${blueprints.length === 1 ? "" : "n"}`,
      }),
    ]),
    blueprints.length
      ? v_flex().w_full().gap(0).children(blueprints.map((blueprint) => blueprintRow(app, cx, t, blueprint)))
      : ui.emptyState(t, {
        title: "Noch keine Blaupausen",
        text: "Eine Blaupause beschreibt Rolle, Farbe, Programm und Prompt einer Sitzung.",
        compact: true,
        action: ui.button(t, {
          id: "fabric-blueprint-empty-new",
          label: "Neue Blaupause",
          icon: "plus",
          small: true,
          tooltip: "Blaupause anlegen",
          onClick: (cx) => app.openBlueprintDrawer("new", null, cx),
        }),
      }),
  ], { id: "fabric-blueprints", padding: S.m, gap: S.xs });
}

// Programm, Modell und Flags des Orchestrators: Teil des Teamformulars,
// gespeichert mit dem Team (fab team edit --orchestrator-argv-json); wirken
// beim nächsten (Neu-)Start.
function settingRow(t, label, child) {
  return h_flex()
    .w_full()
    .min_h(26)
    .gap(S.s)
    .items_center()
    .child(div().flex_none().w(72).text_size(T.xs).text_color(t.dim).whitespace_nowrap().child(label))
    .child(child);
}

function orchestratorSettings(app, cx, t, team, parts) {
  const form = app.teamForms[team.name];
  if (!form?.orchestratorModel) {
    return [
      definition(t, "Programm", parts.program, parts.program),
      definition(t, "Modell", parts.model, parts.model),
    ];
  }
  const menu = `orchestrator-program:${team.name}`;
  const rows = model.programOptions(app.programs, form.orchestratorProgram);
  const label = rows.find((row) => row.value === form.orchestratorProgram)?.label ?? form.orchestratorProgram;
  const changed = model.argvFromParts({
    program: form.orchestratorProgram,
    model: form.orchestratorModel.value(),
    flags: form.orchestratorFlags.value(),
  }).join("\u0000") !== model.argvFromParts({
    program: parts.program, model: parts.model, flags: model.flagsText(parts.flags),
  }).join("\u0000");
  return [
    settingRow(t, "Programm", ui.dropdown(t, {
      id: `fabric-team-orchestrator-program-${team.name}`,
      value: label,
      placeholder: app.programs ? "Programm wählen…" : "Programme werden geladen …",
      options: rows,
      open: app.menu === menu,
      width: 240,
      scrollHandle: app.dropdownScroll,
      onToggle: () => { app.menu = app.menu === menu ? null : menu; cx.notify(); },
      onPick: (value) => {
        app.menu = null;
        const current = app.teamForms[team.name];
        if (current) current.orchestratorProgram = value;
        cx.notify();
      },
    })),
    settingRow(t, "Modell", div().flex_1().min_w(120).max_w(360).id(`fabric-team-orchestrator-model-${team.name}`)
      .child(ui.input(t, form.orchestratorModel))
      .tooltip("Leer = Standardmodell des Programms; wird als --model=<Wert> gesetzt")),
    settingRow(t, "Flags", div().flex_1().min_w(120).max_w(360).id(`fabric-team-orchestrator-flags-${team.name}`)
      .child(ui.input(t, form.orchestratorFlags))
      .tooltip("Weitere Argumente nach Shell-Regeln, z. B. --approval-mode=yolo")),
    ...(changed ? [div().text_size(T.xs).text_color(t.working)
      .child("Geändert: Speichern, dann Orchestrator neu starten.")] : []),
  ];
}

function orchestratorBlock(app, cx, t, team) {
  const state = app.orchestratorState(team.name);
  const live = ui.orchestratorStatus(t, state);
  const parts = model.argvParts(team.orchestrator?.argv ?? []);
  const busy = app.busy === `orchestrator:${team.name}`;
  const blocked = Boolean(app.busy);
  const started = state?.started_at
    ? `Gestartet ${model.relativeTime(state.started_at)}`
    : state?.live ? `Läuft · ${state.terminal ?? "Terminal"}` : "Noch nicht gestartet";
  const error = app.errorFor(`orchestrator:${team.name}`) ?? app.orchestratorErrors?.[team.name];
  return v_flex()
    .w_full()
    .gap(S.s)
    .p(S.s)
    .rounded(ui.RADIUS.m)
    .bg(t.surface)
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(div().flex_none().text_color(t.foreground).child(ui.icon("fabric", 15)))
      .child(div().text_size(T.s).font_semibold().whitespace_nowrap().child("Orchestrator"))
      .child(ui.pill(t, {
        label: live.word,
        color: live.color,
        id: `fabric-team-orchestrator-pill-${team.name}`,
        tooltip: state?.terminal ? `Terminal ${state.terminal}` : "Kein Terminal",
      }))
      .child(div().flex_1())
      .child(div().max_w(240).min_w(0).truncate().text_size(T.xs).text_color(t.dim)
        .child(state?.terminal ?? "kein Terminal").tooltip(state?.terminal ?? "kein Terminal")))
    .children(orchestratorSettings(app, cx, t, team, parts))
    .child(definition(t, "Prompt", team.orchestrator?.prompt, team.orchestrator?.prompt))
    .child(h_flex().w_full().gap(S.s).items_center().flex_wrap()
      .child(ui.button(t, {
        id: `fabric-team-orchestrator-start-${team.name}`,
        label: "Start",
        icon: "play",
        small: true,
        busy,
        disabled: blocked || Boolean(state?.live),
        reason: state?.live ? "Läuft bereits" : "",
        tooltip: `Orchestrator ${team.name} starten (fab orchestrator start ${team.name})`,
        onClick: (cx) => app.orchestrator("start", team.name, cx),
      }))
      .child(ui.button(t, {
        id: `fabric-team-orchestrator-stop-${team.name}`,
        label: "Stoppen",
        icon: "stop",
        small: true,
        disabled: blocked || !state?.live,
        reason: state?.live ? "" : "Läuft nicht",
        tooltip: `Orchestrator ${team.name} stoppen (fab orchestrator stop ${team.name})`,
        onClick: (cx) => app.orchestrator("stop", team.name, cx),
      }))
      .child(ui.button(t, {
        id: `fabric-team-orchestrator-restart-${team.name}`,
        label: "Neu starten",
        icon: "restart",
        small: true,
        busy,
        disabled: blocked,
        tooltip: `Orchestrator ${team.name} neu starten (fab orchestrator restart ${team.name})`,
        onClick: (cx) => app.orchestrator("restart", team.name, cx),
      }))
      .child(ui.button(t, {
        id: `fabric-team-orchestrator-terminal-${team.name}`,
        label: "Terminal öffnen",
        icon: "terminal",
        small: true,
        disabled: !state?.terminal,
        reason: state?.terminal ? "" : "Kein laufendes Terminal",
        tooltip: "Orchestrator-Terminal zeigen",
        onClick: (cx) => app.peekOrchestrator(team.name, cx),
      }))
      .child(ui.button(t, {
        id: `fabric-team-orchestrator-prompt-${team.name}`,
        label: "Prompt bearbeiten",
        icon: "prompt",
        small: true,
        tooltip: `Orchestrator-Prompt für ${team.name} bearbeiten`,
        onClick: (cx) => app.openTeamPrompt(team.name, cx),
      })))
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(div().text_size(T.xs).text_color(t.dim).whitespace_nowrap().child(started))
      .child(div().flex_1()))
    .when(Boolean(error), (el) => el.child(ui.notice(t, error.text ?? String(error),
      error.level ?? "error")));
}

function reposBlock(app, cx, t, team, form) {
  const used = new Set(form.repos);
  const known = (app.repos ?? []).map((repo) => repo.path).filter((path) => path && !used.has(path));
  const options = [
    ...known.map((path) => ({
      value: path,
      label: model.repoName(path),
      detail: path,
      selected: false,
    })),
    { value: "__pick", label: "Ordner wählen…", detail: "Systemdialog", selected: false },
  ];
  return v_flex()
    .w_full()
    .gap(S.xs)
    .child(sectionHead(t, "Repos", [
      ui.chip(t, String(form.repos.length), t.dim, `fabric-team-repos-count-${team.name}`, {
        tooltip: `${form.repos.length} Repo${form.repos.length === 1 ? "" : "s"}`,
      }),
    ]))
    .children(form.repos.map((path, index) => h_flex()
      .w_full()
      .min_h(26)
      .gap(S.s)
      .items_center()
      .child(div().flex_none().text_color(t.dim).child(ui.icon("repo", 12)))
      .child(div().flex_1().min_w(0).truncate().text_size(T.xs).child(path).tooltip(path))
      .child(ui.iconButton(t, {
        id: `fabric-team-repo-remove-${team.name}-${index}`,
        icon: "close",
        size: 22,
        iconSize: 11,
        tooltip: `Repo ${path} entfernen`,
        onClick: (cx) => app.removeTeamRepo(team.name, path, cx),
      }))))
    .when(form.repos.length === 0, (el) => el.child(ui.hint(t, "Mindestens ein Repo ist nötig.")))
    .child(ui.dropdown(t, {
      id: `fabric-team-repo-add-${team.name}`,
      value: "",
      placeholder: "Repo hinzufügen…",
      options,
      open: app.menu === `team-repos-${team.name}`,
      width: 360,
      scrollHandle: app.dropdownScroll,
      empty: app.reposError ?? "Keine bekannten Repos",
      onToggle: () => {
        const key = `team-repos-${team.name}`;
        app.menu = app.menu === key ? null : key;
        cx.notify();
      },
      onPick: (value) => {
        app.menu = null;
        if (value === "__pick") app.pickTeamRepo(team.name, cx);
        else app.addTeamRepo(team.name, value, cx);
      },
    }));
}

function memberRow(app, cx, t, team, form, member) {
  const blueprint = app.blueprintFor(member.blueprint) ?? { name: member.blueprint, role: "", color: "c1" };
  const remove = ui.iconButton(t, {
    id: `fabric-team-member-remove-${team.name}-${member.blueprint}`,
    icon: "close",
    size: 22,
    iconSize: 11,
    tooltip: `${member.blueprint} aus dem Team entfernen`,
    onClick: (cx) => app.removeTeamMember(team.name, member.blueprint, cx),
  });
  const nameLine = app.compact ? h_flex().w_full().gap(S.s).items_center()
    .child(ui.avatar(t, blueprint.name, blueprint.color || "c1", 24))
    .child(v_flex().flex_1().min_w(0).gap(0)
      .child(div().text_size(T.xs).font_semibold().truncate()
        .child(blueprint.name).tooltip(blueprint.name))
      .child(div().text_size(T.xs).text_color(t.dim).truncate()
        .child(model.roleLabel(blueprint.role)).tooltip(model.roleLabel(blueprint.role))))
    .child(remove) : null;
  if (app.compact) {
    return v_flex()
      .w_full()
      .gap(S.s)
      .p(S.s)
      .rounded(ui.RADIUS.m)
      .border_1()
      .border_color(t.border)
      .child(nameLine)
      .child(ui.field(t, "Modell-Übersteuerung", ui.input(t, member.model)))
      .child(ui.field(t, "Kostenlimit ($)", ui.input(t, member.maxCost)));
  }
  return h_flex()
    .w_full()
    .gap(S.s)
    .items_center()
    .child(ui.avatar(t, blueprint.name, blueprint.color || "c1", 24))
    .child(v_flex().flex_none().w(110).min_w(0).gap(0)
      .child(div().text_size(T.xs).font_semibold().truncate()
        .child(blueprint.name).tooltip(blueprint.name))
      .child(div().text_size(T.xs).text_color(t.dim).truncate()
        .child(model.roleLabel(blueprint.role)).tooltip(model.roleLabel(blueprint.role))))
    .child(div().flex_1().min_w(120).child(ui.input(t, member.model)))
    .child(div().flex_none().w(92).child(ui.input(t, member.maxCost)))
    .child(remove);
}

function membersBlock(app, cx, t, team, form) {
  const addOptions = model.blueprintMemberOptions(app.roster?.blueprints ?? [], form.members);
  const reviewerOptions = form.members.map((member) => {
    const blueprint = app.blueprintFor(member.blueprint);
    return {
      value: member.blueprint,
      label: member.blueprint,
      detail: model.roleLabel(blueprint?.role),
      selected: member.blueprint === form.reviewer,
    };
  });
  return v_flex()
    .w_full()
    .gap(S.s)
    .child(sectionHead(t, "Mitglieder", [
      ui.chip(t, String(form.members.length), t.dim, `fabric-team-members-count-${team.name}`, {
        tooltip: `${form.members.length} Mitglied${form.members.length === 1 ? "" : "er"}`,
      }),
    ]))
    .when(!app.compact && form.members.length > 0, (el) => el.child(
      h_flex().w_full().gap(S.s).items_center()
        .child(div().flex_none().w(ui.SIZE.avatar))
        .child(div().flex_none().w(110).min_w(0).text_size(T.xs).text_color(t.dim).child("Mitglied"))
        .child(div().flex_1().min_w(120).text_size(T.xs).text_color(t.dim).child("Modell-Übersteuerung"))
        .child(div().flex_none().w(92).text_size(T.xs).text_color(t.dim).child("Kostenlimit ($)"))
        .child(div().flex_none().w(22)),
    ))
    .children(form.members.map((member) => memberRow(app, cx, t, team, form, member)))
    .child(ui.dropdown(t, {
      id: `fabric-team-member-add-${team.name}`,
      value: "",
      placeholder: "Mitglied hinzufügen…",
      options: addOptions,
      open: app.menu === `team-members-${team.name}`,
      width: ui.SIZE.listPane,
      scrollHandle: app.dropdownScroll,
      empty: "Alle Blaupausen sind bereits Mitglied.",
      onToggle: () => {
        const key = `team-members-${team.name}`;
        app.menu = app.menu === key ? null : key;
        cx.notify();
      },
      onPick: (value) => {
        app.menu = null;
        app.addTeamMember(team.name, value, cx);
      },
    }))
    .child(h_flex().w_full().gap(S.m).items_end().flex_wrap()
      .child(v_flex().flex_1().min_w(180).gap(S.s)
        .child(div().text_size(T.xs).text_color(t.dim).whitespace_nowrap()
          .child("Prüferin / Prüfer (nur Mitglieder)"))
        .child(ui.dropdown(t, {
          id: `fabric-team-reviewer-${team.name}`,
          value: form.reviewer || "",
          placeholder: "Bitte wählen",
          options: reviewerOptions,
          open: app.menu === `team-reviewer-${team.name}`,
          width: 220,
          scrollHandle: app.dropdownScroll,
          empty: "Erst Mitglieder hinzufügen",
          onToggle: () => {
            const key = `team-reviewer-${team.name}`;
            app.menu = app.menu === key ? null : key;
            cx.notify();
          },
          onPick: (value) => {
            app.menu = null;
            app.setTeamReviewer(team.name, value, cx);
          },
        })))
      .child(v_flex().w(170).flex_none().gap(S.s)
        .child(div().text_size(T.xs).text_color(t.dim).whitespace_nowrap()
          .child("Gleichzeitige Sessions (1–16)"))
        .child(ui.numberInput(t, form.maxSessions))));
}

function briefBlock(app, cx, t, team, form) {
  const chars = [...form.brief.value()].length;
  return v_flex()
    .w_full()
    .gap(S.s)
    .child(sectionHead(t, "Brief", [
      ui.chip(t, `${chars} Zeichen`, t.dim, `fabric-team-brief-count-${team.name}`, {
        tooltip: "Zeichen im Brief",
      }),
    ]))
    .child(ui.textarea(t, form.brief, { height: 110 }))
    .child(ui.hint(t,
      "Der Brief ist Prompt-Kontext für den Agenten und zählt gegen die Obergrenze context_limit."));
}

function fabricRow(app, cx, t, team) {
  const current = model.teamFabric(team);
  const names = app.fabricScopeRows().map((row) => row.name);
  if (!names.includes(current)) names.push(current);
  const options = names.map((name) => ({
    value: name,
    label: name,
    detail: name === "standard" ? "Standard" : null,
    selected: name === current,
  }));
  const key = `team-fabric-${team.name}`;
  return h_flex().w_full().gap(S.s).items_center().flex_wrap()
    .child(div().flex_none().text_size(T.xs).text_color(t.dim).child("Fabric"))
    .child(div().w(190).flex_none().child(ui.dropdown(t, {
      id: `fabric-team-fabric-${team.name}`,
      value: current,
      placeholder: "Fabric wählen…",
      options,
      open: app.menu === key,
      width: 210,
      scrollHandle: app.dropdownScroll,
      empty: "Keine Fabrics",
      onToggle: () => {
        app.menu = app.menu === key ? null : key;
        cx.notify();
      },
      onPick: (value) => cx.spawn(async () => { await app.moveTeamFabric(team.name, value, cx); }),
    })))
    .child(div().flex_1().min_w(0).child(ui.hint(t,
      "Umhängen ändert nur die Fabric; Repos, Mitglieder und Sessions bleiben.")));
}

function teamCard(app, cx, t, team) {
  const form = app.teamForms[team.name];
  if (!form) return null;
  const dirty = app.teamFormDirty(team.name);
  const busy = app.busy === `team:${team.name}`;
  const error = app.errorFor(`team:${team.name}`);
  const promptPath = team.orchestrator?.prompt ?? `prompts/orchestrator-${team.name}.md`;
  const sharedWith = (team.shared_with ?? []).join(", ");
  const sharedTip = `Prompt ${promptPath} wird auch von ${sharedWith || "anderen Teams"} verwendet. Änderungen wirken auf diese Teams.`;
  const blockedReason = form.repos.length
    ? (!dirty ? "Keine Änderungen" : "")
    : "Mindestens ein Repo ist nötig.";
  const nameBox = app.compact
    ? div().flex_1().min_w(0)
    : div().w(220).flex_none();
  return ui.card(t, [
    h_flex().w_full().gap(S.s).items_center().flex_wrap()
      .child(nameBox.id(`fabric-team-name-${team.name}`).child(ui.input(t, form.name)))
      .when(Boolean(team.prompt_shared), (el) => el.child(ui.chip(t, "Prompt geteilt", t.working,
        `fabric-team-prompt-shared-${team.name}`, { tooltip: sharedTip })))
      .child(div().flex_1())
      .child(ui.button(t, {
        id: `fabric-team-context-${team.name}`,
        label: app.compact ? "Kontext" : "Was sieht der Agent?",
        icon: "eye",
        small: true,
        tooltip: "Kontextvorschau des Teams öffnen",
        onClick: (cx) => app.toggleContextPreview("team", team.name, cx),
      }))
      .when(dirty, (el) => el.child(ui.chip(t, "ungespeichert", t.working,
        `fabric-team-dirty-${team.name}`, { tooltip: "Änderungen sind noch nicht gespeichert" })))
      .child(ui.button(t, {
        id: `fabric-team-delete-${team.name}`,
        label: "Team löschen",
        icon: "trash",
        danger: true,
        small: true,
        disabled: Boolean(app.busy),
        tooltip: `Team ${team.name} löschen (fragt nach)`,
        onClick: (cx) => app.confirmDeleteTeam(team, cx),
      })),
    fabricRow(app, cx, t, team),
    orchestratorBlock(app, cx, t, team),
    briefBlock(app, cx, t, team, form),
    reposBlock(app, cx, t, team, form),
    membersBlock(app, cx, t, team, form),
    h_flex().w_full().gap(S.s).items_center()
      .child(ui.button(t, {
        id: `fabric-team-save-${team.name}`,
        label: "Speichern",
        icon: "save",
        small: true,
        primary: true,
        busy,
        disabled: Boolean(app.busy) || !dirty || form.repos.length === 0,
        reason: blockedReason,
        tooltip: `Team ${team.name} speichern (⌘S)`,
        onClick: (cx) => app.saveTeam(team.name, cx),
      }))
      .child(div().flex_1())
      .child(ui.hint(t, "Speichern ersetzt Repos und Mitglieder als ganze Liste (fab team edit).")),
    ...(error ? [ui.notice(t, error.text, error.level)] : []),
  ], { id: `fabric-team-card-${team.name}`, padding: S.m, gap: S.m });
}

export function renderTeam(app, cx, t) {
  const teams = model.scopeTeams(app.roster?.teams, app.fabricScope);
  const blueprints = app.roster?.blueprints ?? [];
  // Bei offenem Drawer bleibt neben dem Inhalt zu wenig Platz für volle Knopftexte.
  const narrow = app.compact || Boolean(app.blueprintDrawer || app.teamPrompt);
  const newTeam = narrow
    ? ui.iconButton(t, {
      id: "fabric-team-new",
      icon: "plus",
      tooltip: "Neues Team",
      onClick: (cx) => app.openNewTeam(cx),
    })
    : ui.button(t, {
      id: "fabric-team-new",
      label: "Neues Team",
      icon: "plus",
      primary: true,
      tooltip: "Team anlegen (fab team add)",
      onClick: (cx) => app.openNewTeam(cx),
    });
  const newBlueprint = narrow
    ? ui.iconButton(t, {
      id: "fabric-blueprint-new",
      icon: "plus",
      tooltip: "Neue Blaupause",
      onClick: (cx) => app.openBlueprintDrawer("new", null, cx),
    })
    : ui.button(t, {
      id: "fabric-blueprint-new",
      label: "Neue Blaupause",
      icon: "plus",
      primary: false,
      tooltip: "Blaupause anlegen",
      onClick: (cx) => app.openBlueprintDrawer("new", null, cx),
    });
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("team"), [
      ...(narrow ? [] : [
        div().text_size(T.xs).text_color(t.dim).child(
          `${blueprints.length} Blaupause${blueprints.length === 1 ? "" : "n"} · ${teams.length} Team${teams.length === 1 ? "" : "s"}`
          + (app.fabricScope ? ` in ${app.fabricScope}` : ""),
        ),
      ]),
      newTeam,
      newBlueprint,
    ], { iconName: "team", subtitle: "Blaupausen pflegen und Teams steuern", compact: narrow }))
    .when(Boolean(app.rosterError), (el) => el.child(ui.notice(t, app.rosterError)))
    .when(Boolean(app.flash?.text), (el) => el.child(ui.notice(t, app.flash.text, app.flash.level)))
    .when(Boolean(app.errorFor("fabric-move")),
      (el) => el.child(ui.notice(t, app.errorFor("fabric-move").text, app.errorFor("fabric-move").level)))
    .child(
      app.roster
        ? (blueprints.length === 0 && (app.roster?.teams ?? []).length === 0
          ? ui.emptyState(t, {
            title: "Noch keine Blaupausen und Teams",
            text: "Eine Blaupause beschreibt Rolle, Farbe, Programm und Prompt einer Sitzung. Ein Team verbindet Repos, Blaupausen, einen Prüfer und einen Orchestrator.",
            action: h_flex().gap(S.s).items_center()
              .child(ui.button(t, {
                id: "fabric-blueprint-empty-new",
                label: "Neue Blaupause",
                icon: "plus",
                onClick: (cx) => app.openBlueprintDrawer("new", null, cx),
              }))
              .child(ui.button(t, {
                id: "fabric-team-empty-new",
                label: "Neues Team",
                icon: "plus",
                primary: true,
                onClick: (cx) => app.openNewTeam(cx),
              })),
          })
          : v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.l).gap(S.m)
            .child(blueprintCard(app, cx, t))
            .when(teams.length === 0, (el) => el.child(ui.emptyState(t, {
              title: app.fabricScope ? `Keine Teams in ${app.fabricScope}` : "Noch keine Teams",
              text: app.fabricScope
                ? "Ein anderes Team umhängen oder hier ein neues Team anlegen; der Fabric-Filter steht oben im Fenster."
                : "Ein Team verbindet Repos, Blaupausen, einen Prüfer und einen Orchestrator.",
              compact: true,
              action: ui.button(t, {
                id: "fabric-team-empty-new",
                label: "Neues Team",
                icon: "plus",
                small: true,
                tooltip: "Team anlegen (fab team add)",
                onClick: (cx) => app.openNewTeam(cx),
              }),
            })))
            .children(teams.map((team) => teamCard(app, cx, t, team)).filter(Boolean)))
        : (app.rosterError
          ? ui.emptyState(t, { title: "Roster nicht lesbar", text: app.rosterError })
          : ui.loading(t, "Roster wird geladen …")),
    );
}

export function renderTeamPromptDrawer(app, cx, t) {
  const prompt = app.teamPrompt;
  if (!prompt) return null;
  const team = app.teamFor(prompt.team);
  const path = team?.orchestrator?.prompt ?? "prompts/orchestrator.md";
  const busy = app.busy === "team-prompt";
  return ui.drawer(t, {
    title: `Orchestrator-Prompt · ${prompt.team}`,
    subtitle: "Gilt nur für dieses Team",
    onClose: (cx) => app.closeTeamPrompt(cx),
    tooltip: "Drawer schließen (Esc)",
    width: ui.SIZE.drawer,
    footer: [
      ui.button(t, {
        id: "fabric-team-prompt-cancel",
        label: "Abbrechen",
        tooltip: "Abbrechen (Esc)",
        onClick: (cx) => app.closeTeamPrompt(cx),
      }),
      ui.button(t, {
        id: "fabric-team-prompt-save",
        label: "Speichern",
        icon: "save",
        primary: true,
        busy,
        disabled: Boolean(app.busy) || app.teamPromptLoading,
        reason: app.teamPromptLoading ? "Prompt wird noch geladen" : "",
        tooltip: "Prompt speichern (⌘S)",
        onClick: (cx) => app.saveTeamPrompt(cx),
      }),
    ],
  }, [
    h_flex().w_full().items_center().gap(S.s)
      .child(ui.chip(t, path, t.dim, "fabric-team-prompt-path", { tooltip: path }))
      .child(div().flex_1())
      .when(app.teamPromptDirty(), (el) => el.child(ui.chip(t, "ungespeichert", t.working,
        "fabric-team-prompt-dirty", { tooltip: "Änderungen sind noch nicht gespeichert" }))),
    app.teamPromptLoading
      ? ui.loading(t, "Prompt wird geladen …")
      : ui.editor(t, prompt.editor, { height: 360 }),
    ui.hint(t, "Speichern ruft fab prompt set orchestrator --team und schreibt nur diesen Prompt."),
    ...(app.errorFor("team-prompt")
      ? [ui.notice(t, app.errorFor("team-prompt").text, app.errorFor("team-prompt").level)]
      : []),
  ]);
}
