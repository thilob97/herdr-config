// Dialoge und der Blaupausen-Drawer: Neues Ticket, Bestätigungen, Schutz vor Verlust.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, terminals } from "herdr";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

const COLORS = ["c1", "c2", "c3", "c4", "c5", "c6"];


function newTicketDialog(app, cx, t) {
  const repos = [...new Set([
    ...(app.repos ?? []).map((repo) => repo.path),
    ...(app.newRepo ? [app.newRepo] : []),
    ...app.tickets.map((ticket) => ticket.repo).filter(Boolean),
  ])];
  const options = [
    { value: "", label: "Kein Repo", detail: "Der Orchestrator entscheidet", selected: !app.newRepo },
    ...repos.map((path) => ({
      value: path,
      label: model.repoName(path),
      detail: path,
      selected: path === app.newRepo,
    })),
    { value: "__pick", label: "Ordner wählen…", detail: "Systemdialog", selected: false },
  ];
  const templateOptions = [
    { value: "", label: "Ohne Vorlage", detail: "Freier Satz", selected: !app.newTemplate },
    ...model.sortTemplates(app.templateList ?? []).map((row) => ({
      value: String(row.name),
      label: model.templateLabel(row.name),
      detail: `${row.bytes ?? 0} B`,
      selected: row.name === app.newTemplate,
    })),
  ];
  const issueOptions = [
    { value: "", label: "Ohne Issue", detail: "Freier Satz", selected: app.newIssue == null },
    ...(app.newIssues ?? []).map((issue) => ({
      value: String(issue.number),
      label: model.issueLabel(issue),
      detail: "GitHub",
      selected: String(issue.number) === String(app.newIssue),
    })),
  ];
  const canCreate = Boolean(app.newSentence?.value().trim()) || app.newIssue != null;
  return ui.modal(t, {
    title: "Neues Ticket",
    detail: "Ein Satz oder ein Issue genügt. Der Orchestrator formuliert Ziel, Kontext und Abnahmekriterien aus.",
    width: ui.SIZE.modalWide,
    actions: [
      ui.button(t, {
        id: "fabric-new-cancel",
        label: "Abbrechen",
        onClick: (cx) => { app.newOpen = false; app.clearMentions(cx); cx.notify(); },
      }),
      ui.button(t, {
        id: "fabric-new-create",
        label: "Anlegen",
        icon: "plus",
        primary: true,
        busy: app.busy === "new",
        disabled: Boolean(app.busy) || !canCreate,
        tooltip: "Ticket anlegen",
        onClick: (cx) => app.createTicket(cx),
      }),
    ],
  }, [
    v_flex().w_full().gap(S.s)
      .child(ui.field(t, "Auftrag", app.newSentence ? ui.input(t, app.newSentence, { focused: true }) : div()))
      .when(app.mentionOpen("new"), (el) => el.child(app.mentionView("new", t)))
      .when(Boolean(app.newError), (el) => el.child(ui.notice(t, app.newError)))
      .child(ui.field(t, "Vorlage", ui.dropdown(t, {
        id: "fabric-new-template",
        value: app.newTemplate ? model.templateLabel(app.newTemplate) : "Ohne Vorlage",
        options: templateOptions,
        open: app.menu === "new-template",
        width: 360,
        scrollHandle: app.dropdownScroll,
        onToggle: (cx) => { app.menu = app.menu === "new-template" ? null : "new-template"; cx.notify(); },
        onPick: (value, cx) => {
          app.menu = null;
          app.newTemplate = value || null;
          if (value) app.newIssue = null;
          cx.notify();
        },
      })))
      .child(ui.field(t, "Repo", ui.dropdown(t, {
        id: "fabric-new-repo",
        value: app.newRepo ? model.repoName(app.newRepo) : "Kein Repo",
        options,
        open: app.menu === "new-repo",
        width: 360,
        scrollHandle: app.dropdownScroll,
        onToggle: (cx) => { app.menu = app.menu === "new-repo" ? null : "new-repo"; cx.notify(); },
        onPick: (value, cx) => {
          app.menu = null;
          if (value === "__pick") app.pickNewRepo(cx);
          else {
            app.newRepo = value || null;
            app.newIssue = null;
            app.newIssues = [];
            app.issuesError = null;
            cx.notify();
            cx.spawn((cx) => app.loadNewIssues(cx));
          }
        },
      })))
      .when(Boolean(app.newRepo), (el) => el.child(ui.hint(t, app.newRepo)))
      .child(ui.field(t, "Issue", app.newRepo ? ui.dropdown(t, {
        id: "fabric-new-issue",
        value: app.newIssue != null
          ? model.issueLabel((app.newIssues ?? []).find((issue) => String(issue.number) === String(app.newIssue)) ?? { number: app.newIssue })
          : "Ohne Issue",
        options: issueOptions,
        open: app.menu === "new-issue",
        width: 360,
        scrollHandle: app.dropdownScroll,
        onToggle: (cx) => { app.menu = app.menu === "new-issue" ? null : "new-issue"; cx.notify(); },
        onPick: (value, cx) => {
          app.menu = null;
          app.newIssue = value ? Number(value) : null;
          if (value) app.newTemplate = null;
          cx.notify();
        },
      }) : ui.hint(t, "Issues brauchen ein Repo.")))
      .when(Boolean(app.issuesError), (el) => el.child(ui.notice(t, app.issuesError, "warn")))
      .child(div().h(1).my(S.xs).bg(t.border))
      .child(ui.switchRow(t, {
        id: "fabric-new-wake",
        checked: app.newWake,
        label: "Orchestrator sofort ausformulieren lassen",
        detail: app.newWake
          ? "Legt an und kommentiert „@orchestrator bitte ausformulieren und verteilen“."
          : "Legt nur den Entwurf an (`--no-wake`) – niemand wird geweckt.",
        onChange: (value) => { app.newWake = value; cx.notify(); },
      })),
  ]);
}

function acceptDialog(app, cx, t) {
  const ticket = app.modal.ticket ?? {};
  const live = model.sessionChips(ticket.sessions, terminals(), agents(), ticket.id).filter((session) => !session.ended);
  const ended = (ticket.sessions ?? []).filter((session) => !live.some((row) => row.agent === session.agent));
  const detail = [
    `Merge von ${ticket.branch || "dem Branch"} in ${ticket.base || "die Basis"} im Haupt-Checkout.`,
    ticket.branch ? `Branch ${ticket.branch} wird nach dem Merge gelöscht.` : null,
    ticket.worktree ? `Worktree ${ticket.worktree} wird entfernt.` : null,
    live.length ? `Beendet werden: ${live.map((session) => session.name || session.agent).join(", ")}.`
      : "Es laufen keine Sessions.",
    ended.length ? `Bereits beendet: ${ended.map((session) => session.name || session.agent).join(", ")}.` : null,
    "Das Ticket steht danach auf Fertig.",
  ].filter(Boolean).join("\n");
  return ui.modal(t, {
    title: `${ticket.id ?? "Ticket"} abnehmen?`,
    detail,
    width: ui.SIZE.modal,
    actions: [
      ui.button(t, { id: "fabric-accept-cancel", label: "Abbrechen", onClick: (cx) => { app.modal = null; cx.notify(); } }),
      ui.button(t, {
        id: "fabric-accept-pr-open",
        label: "Nur PR öffnen",
        icon: "external",
        disabled: Boolean(app.busy),
        tooltip: "Erstellt oder öffnet den PR ohne Merge (fab accept --pr-only)",
        onClick: (cx) => app.acceptPrOnly(cx),
      }),
      ui.button(t, {
        id: "fabric-accept-confirm",
        label: "Abnehmen",
        icon: "check",
        primary: true,
        busy: app.busy === "accept",
        disabled: Boolean(app.busy),
        tooltip: "Merge und aufräumen (fab accept)",
        onClick: (cx) => app.accept(cx),
      }),
    ],
  });
}

function dropDialog(app, cx, t) {
  const ticket = app.modal.ticket ?? {};
  const live = model.sessionChips(ticket.sessions, terminals(), agents(), ticket.id).filter((session) => !session.ended);
  const sessions = live.map((session) => session.name || session.agent).filter(Boolean);
  const detail = [
    sessions.length ? `Beendet werden: ${sessions.join(", ")}.` : "Es laufen keine Sessions.",
    ticket.worktree ? `Der Worktree ${ticket.worktree} bleibt erhalten.` : null,
    "Ein verworfenes Ticket lässt sich wieder öffnen.",
  ].filter(Boolean).join("\n");
  return ui.modal(t, {
    title: `${ticket.id ?? "Ticket"} verwerfen?`,
    detail,
    width: ui.SIZE.modal,
    actions: [
      ui.button(t, { id: "fabric-drop-cancel", label: "Abbrechen", onClick: (cx) => { app.modal = null; cx.notify(); } }),
      ui.button(t, {
        id: "fabric-drop-confirm",
        label: "Verwerfen",
        icon: "trash",
        danger: true,
        busy: app.busy === "drop",
        disabled: Boolean(app.busy) || !(app.modal.reason?.value().trim()),
        tooltip: "Ticket verwerfen (fab drop)",
        onClick: (cx) => app.drop(cx),
      }),
    ],
  }, [
    v_flex().w_full().gap(S.xs)
      .child(ui.field(t, "Grund (steht im Verlauf)", app.modal.reason ? ui.input(t, app.modal.reason, { focused: true }) : div()))
      .when(Boolean(app.errorFor("drop")), (el) => el.child(ui.notice(t, app.errorFor("drop").text))),
  ]);
}

function deleteBlueprintDialog(app, cx, t) {
  const blueprint = app.modal.blueprint ?? {};
  const teams = blueprint.teams ?? [];
  const detail = [
    `Die Blaupause ${blueprint.name} wird aus dem Roster entfernt.`,
    teams.length
      ? `In Teams verwendet: ${teams.join(", ")}. fab verweigert das Löschen, solange sie dort Mitglied ist.`
      : "Sie ist in keinem Team Mitglied.",
    `Der Prompt ${blueprint.prompt || `prompts/${blueprint.name}.md`} bleibt erhalten.`,
  ].join("\n");
  const error = app.errorFor("blueprint-rm");
  return ui.modal(t, {
    title: `Blaupause ${blueprint.name} löschen?`,
    detail,
    width: ui.SIZE.modal,
    actions: [
      ui.button(t, { id: "fabric-blueprint-delete-cancel", label: "Abbrechen", tooltip: "Nicht löschen", onClick: (cx) => { app.modal = null; cx.notify(); } }),
      ui.button(t, {
        id: "fabric-blueprint-delete-confirm",
        label: "Löschen",
        icon: "trash",
        danger: true,
        busy: app.busy === "blueprint-rm",
        disabled: Boolean(app.busy),
        tooltip: "Blaupause entfernen (fab blueprint rm)",
        onClick: (cx) => app.deleteBlueprint(cx),
      }),
    ],
  }, error ? [ui.notice(t, error.text, error.level)] : []);
}

function unsavedDialog(app, cx, t) {
  const labels = (app.modal.dirty ?? []).map((entry) => `• ${entry.label}`).join("\n");
  return ui.modal(t, {
    title: "Ungespeicherte Änderungen",
    detail: `Diese Bereiche haben Änderungen:\n${labels}\n\nSpeichern, verwerfen oder hier bleiben.`,
    width: ui.SIZE.modal,
    actions: [
      ui.button(t, { id: "fabric-unsaved-cancel", label: "Abbrechen", tooltip: "Hier bleiben", onClick: (cx) => { app.modal = null; cx.notify(); } }),
      ui.button(t, {
        id: "fabric-unsaved-discard",
        label: "Verwerfen",
        icon: "undo",
        disabled: Boolean(app.busy),
        tooltip: "Änderungen verwerfen",
        onClick: (cx) => {
          const then = app.modal?.then;
          app.discardDirty(cx);
          app.modal = null;
          if (then) then();
          cx.notify();
        },
      }),
      ui.button(t, {
        id: "fabric-unsaved-save",
        label: "Speichern",
        icon: "save",
        primary: true,
        busy: Boolean(app.busy),
        disabled: Boolean(app.busy),
        tooltip: "Alle Änderungen speichern",
        onClick: (cx) => {
          cx.spawn(async (cx) => {
            const ok = await app.saveDirty(cx);
            if (!ok) return;
            const then = app.modal?.then;
            app.modal = null;
            if (then) then();
            cx.notify();
          });
        },
      }),
    ],
  });
}

function newTeamDialog(app, cx, t) {
  const used = new Set(app.newTeamRepos ?? []);
  const known = (app.repos ?? [])
    .map((repo) => repo.path)
    .filter((path) => path && !used.has(path));
  const repoOptions = [
    ...known.map((path) => ({
      value: path,
      label: model.repoName(path),
      detail: path,
      selected: false,
    })),
    { value: "__pick", label: "Ordner wählen…", detail: "Systemdialog", selected: false },
  ];
  const memberOptions = model.blueprintMemberOptions(
    app.roster?.blueprints ?? [], app.newTeamMembers ?? [],
  );
  const reviewerOptions = (app.newTeamMembers ?? []).map((name) => {
    const blueprint = app.blueprintFor(name);
    return {
      value: name,
      label: name,
      detail: blueprint?.role || "",
      selected: name === app.newTeamReviewer,
    };
  });
  const error = app.errorFor("team-add");
  const fabricRows = app.fabricScopeRows();
  const fabricOptions = (fabricRows.length ? fabricRows : [{ name: "standard", note: "" }]).map((row) => ({
    value: row.name,
    label: row.name,
    detail: row.default ? "Standard" : (row.note || null),
    selected: row.name === (app.newTeamFabric || "standard"),
  }));
  const fabricValue = app.newTeamFabric || "standard";
  return ui.modal(t, {
    title: "Neues Team",
    detail: "fab legt ein eigenes Team an und kopiert dafür einen eigenen Orchestrator-Prompt.",
    width: ui.SIZE.modalWide,
    actions: [
      ui.button(t, {
        id: "fabric-team-new-cancel",
        label: "Abbrechen",
        tooltip: "Ohne Anlegen schließen (Esc)",
        onClick: (cx) => app.closeNewTeam(cx),
      }),
      ui.button(t, {
        id: "fabric-team-new-create",
        label: "Anlegen",
        icon: "plus",
        primary: true,
        busy: app.busy === "team-add",
        disabled: Boolean(app.busy) || !(app.newTeamName?.value().trim()),
        tooltip: "Team anlegen (fab team add)",
        onClick: (cx) => app.createTeam(cx),
      }),
    ],
  }, [
    v_flex().w_full().gap(S.m)
      .child(ui.field(t, "Name", app.newTeamName ? ui.input(t, app.newTeamName, { focused: true }) : div(), {
        hint: "a–z, 0–9, _ und -, höchstens 16 Zeichen",
      }))
      .child(ui.field(t, "Fabric", ui.dropdown(t, {
        id: "fabric-team-new-fabric",
        value: fabricValue,
        placeholder: "Fabric wählen…",
        options: fabricOptions,
        open: app.menu === "new-team-fabric",
        width: 260,
        scrollHandle: app.dropdownScroll,
        empty: "Keine Fabrics",
        onToggle: () => {
          app.menu = app.menu === "new-team-fabric" ? null : "new-team-fabric";
          cx.notify();
        },
        onPick: (value) => app.setNewTeamFabric(value, cx),
      }), { hint: "Das Team wird dieser Fabric zugeordnet (fab team add --fabric)." }))
      .child(ui.field(t, "Repos", v_flex().w_full().gap(S.xs)
        .children((app.newTeamRepos ?? []).map((path, index) => h_flex()
          .w_full()
          .min_h(26)
          .gap(S.s)
          .items_center()
          .child(div().flex_none().text_color(t.dim).child(ui.icon("repo", 12)))
          .child(div().flex_1().min_w(0).truncate().text_size(T.xs).child(path).tooltip(path))
          .child(ui.iconButton(t, {
            id: `fabric-team-new-repo-remove-${index}`,
            icon: "close",
            size: 22,
            iconSize: 11,
            tooltip: `Repo ${path} entfernen`,
            onClick: (cx) => app.removeNewTeamRepo(path, cx),
          }))))
        .when((app.newTeamRepos ?? []).length === 0, (el) => el.child(ui.hint(t, "Mindestens ein Repo")))
        .child(ui.dropdown(t, {
          id: "fabric-team-new-repo-add",
          value: "",
          placeholder: "Repo hinzufügen…",
          options: repoOptions,
          open: app.menu === "new-team-repos",
          width: 360,
          scrollHandle: app.dropdownScroll,
          empty: app.reposError ?? "Keine bekannten Repos",
          onToggle: () => {
            app.menu = app.menu === "new-team-repos" ? null : "new-team-repos";
            cx.notify();
          },
          onPick: (value) => {
            app.menu = null;
            if (value === "__pick") app.pickNewTeamRepo(cx);
            else app.addNewTeamRepo(value, cx);
          },
        }))))
      .child(ui.field(t, "Mitglieder", v_flex().w_full().gap(S.xs)
        .children((app.newTeamMembers ?? []).map((name) => {
          const blueprint = app.blueprintFor(name) ?? { name, role: "", color: "c1" };
          return h_flex()
            .w_full()
            .min_h(26)
            .gap(S.s)
            .items_center()
            .child(ui.avatar(t, blueprint.name, blueprint.color || "c1", 24))
            .child(div().flex_1().min_w(0).truncate().text_size(T.xs).font_semibold()
              .child(blueprint.name).tooltip(blueprint.name))
            .child(div().flex_none().text_size(T.xs).text_color(t.dim).whitespace_nowrap()
              .child(blueprint.role || "ohne Rolle"))
            .child(ui.iconButton(t, {
              id: `fabric-team-new-member-remove-${name}`,
              icon: "close",
              size: 22,
              iconSize: 11,
              tooltip: `${name} aus dem Team entfernen`,
              onClick: (cx) => app.removeNewTeamMember(name, cx),
            }));
        }))
        .child(ui.dropdown(t, {
          id: "fabric-team-new-member-add",
          value: "",
          placeholder: "Mitglied hinzufügen…",
          options: memberOptions,
          open: app.menu === "new-team-members",
          width: 260,
          scrollHandle: app.dropdownScroll,
          empty: "Alle Blaupausen sind bereits Mitglied.",
          onToggle: () => {
            app.menu = app.menu === "new-team-members" ? null : "new-team-members";
            cx.notify();
          },
          onPick: (value) => {
            app.menu = null;
            app.addNewTeamMember(value, cx);
          },
        }))))
      .child(h_flex().w_full().gap(S.m).items_end().flex_wrap()
        .child(div().flex_1().min_w(180).child(ui.field(t, "Prüferin / Prüfer (nur Mitglieder)", ui.dropdown(t, {
            id: "fabric-team-new-reviewer",
            value: app.newTeamReviewer || "",
            placeholder: "Bitte wählen",
            options: reviewerOptions,
            open: app.menu === "new-team-reviewer",
            width: 220,
            scrollHandle: app.dropdownScroll,
            empty: "Erst Mitglieder hinzufügen",
            onToggle: () => {
              app.menu = app.menu === "new-team-reviewer" ? null : "new-team-reviewer";
              cx.notify();
            },
            onPick: (value) => {
              app.menu = null;
              app.setNewTeamReviewer(value, cx);
            },
          }))))
        .child(div().w(170).flex_none().child(ui.field(t, "Gleichzeitige Sessions (1–16)", ui.numberInput(t, app.newTeamSessions)))))
      .when(Boolean(error), (el) => el.child(ui.notice(t, error.text, error.level))),
  ]);
}

function deleteTeamDialog(app, cx, t) {
  const team = app.modal.team ?? {};
  const repos = team.repos ?? [];
  const detail = [
    repos.length ? `Repos: ${repos.join(", ")}.` : "Das Team hat keine Repos.",
    "fab verweigert das Löschen, solange Tickets offen sind (todo, doing, review) oder der Orchestrator läuft.",
  ].join("\n");
  const error = app.errorFor("team-rm");
  return ui.modal(t, {
    title: `Team ${team.name} löschen?`,
    detail,
    width: ui.SIZE.modal,
    actions: [
      ui.button(t, {
        id: "fabric-team-delete-cancel",
        label: "Abbrechen",
        tooltip: "Nicht löschen",
        onClick: (cx) => { app.modal = null; cx.notify(); },
      }),
      ui.button(t, {
        id: "fabric-team-delete-confirm",
        label: "Löschen",
        icon: "trash",
        danger: true,
        busy: app.busy === "team-rm",
        disabled: Boolean(app.busy),
        tooltip: "Team entfernen (fab team rm)",
        onClick: (cx) => app.deleteTeam(cx),
      }),
    ],
  }, error ? [ui.notice(t, error.text, error.level)] : []);
}


function newFabricDialog(app, cx, t) {
  const error = app.errorFor("fabric-add");
  return ui.modal(t, {
    title: "Neue Fabric",
    detail: "Eine Fabric gruppiert Teams. Sie liegt im selben Datenbestand wie alle anderen Fabrics; „standard“ bleibt bestehen.",
    width: ui.SIZE.modal,
    actions: [
      ui.button(t, {
        id: "fabric-new-cancel",
        label: "Abbrechen",
        tooltip: "Ohne Anlegen schließen (Esc)",
        onClick: (cx) => app.closeNewFabric(cx),
      }),
      ui.button(t, {
        id: "fabric-new-create",
        label: "Anlegen",
        icon: "plus",
        primary: true,
        busy: app.busy === "fabric-add",
        disabled: Boolean(app.busy) || !(app.newFabricName?.value().trim()),
        tooltip: "Fabric anlegen (fab fabric add)",
        onClick: (cx) => app.createFabric(cx),
      }),
    ],
  }, [
    ui.field(t, "Name", app.newFabricName ? ui.input(t, app.newFabricName, { focused: true }) : div(), {
      hint: "a–z, 0–9, _ und -, 1–16 Zeichen; beginnt mit einem Buchstaben",
    }),
    ui.field(t, "Notiz", app.newFabricNote ? ui.input(t, app.newFabricNote) : div(), {
      hint: "Optional, etwa der Zweck der Fabric.",
    }),
    ...(error ? [ui.notice(t, error.text, error.level)] : []),
  ]);
}

function deleteFabricDialog(app, cx, t) {
  const fabric = app.modal.fabric ?? {};
  const teams = (fabric.teams ?? []).join(", ");
  const detail = [
    teams
      ? `Zugewiesene Teams: ${teams}. fab verweigert das Löschen, solange sie zugeordnet sind.`
      : "Der Fabric sind keine Teams zugeordnet.",
    "„standard“ bleibt immer bestehen.",
  ].join("\n");
  const error = app.errorFor("fabric-rm");
  return ui.modal(t, {
    title: `Fabric ${fabric.name} löschen?`,
    detail,
    width: ui.SIZE.modal,
    actions: [
      ui.button(t, {
        id: "fabric-delete-cancel",
        label: "Abbrechen",
        tooltip: "Nicht löschen",
        onClick: (cx) => { app.modal = null; cx.notify(); },
      }),
      ui.button(t, {
        id: "fabric-delete-confirm",
        label: "Löschen",
        icon: "trash",
        danger: true,
        busy: app.busy === "fabric-rm",
        disabled: Boolean(app.busy),
        tooltip: "Fabric entfernen (fab fabric rm)",
        onClick: (cx) => cx.spawn(async () => { await app.deleteFabric(cx); }),
      }),
    ],
  }, error ? [ui.notice(t, error.text, error.level)] : []);
}

function knowledgeNoteDialog(app, cx, t) {
  const note = app.knowledgeNote;
  if (!note) return null;
  const name = note.name.value().trim();
  const text = note.text.value();
  const problem = model.knowledgeNameProblem(name);
  const fileName = name ? model.knowledgeNoteFile(name) : "";
  const error = app.errorFor("knowledge-note");
  return ui.modal(t, {
    title: "Notiz anlegen",
    detail: fileName ? `Wird als ${fileName} im Wissensordner gespeichert.` : "Name und Text der Notiz.",
    width: ui.SIZE.modalWide,
    actions: [
      ui.button(t, {
        id: "fabric-knowledge-note-cancel",
        label: "Abbrechen",
        tooltip: "Ohne Anlegen schließen",
        onClick: (cx) => { app.modal = null; app.knowledgeNote = null; cx.notify(); },
      }),
      ui.button(t, {
        id: "fabric-knowledge-note-create",
        label: "Anlegen",
        icon: "plus",
        primary: true,
        busy: app.busy === "knowledge-note",
        disabled: Boolean(app.busy) || Boolean(problem) || !text.trim(),
        reason: problem || (text.trim() ? "" : "Text fehlt."),
        tooltip: "Notiz im Wissensordner anlegen",
        onClick: (cx) => app.createKnowledgeNote(cx),
      }),
    ],
  }, [
    v_flex().w_full().gap(S.s)
      .child(ui.field(t, "Name", ui.input(t, note.name, { focused: true }), {
        hint: fileName ? `Datei: ${fileName}` : null,
      }))
      .child(ui.field(t, "Text", ui.textarea(t, note.text, { height: 140 })))
      .when(Boolean(problem), (el) => el.child(ui.notice(t, problem)))
      .when(Boolean(error), (el) => el.child(ui.notice(t, error.text, error.level))),
  ]);
}

function knowledgeRemoveDialog(app, cx, t) {
  const name = app.modal.name ?? "";
  const error = app.errorFor("knowledge-rm");
  return ui.modal(t, {
    title: `Eintrag ${name} entfernen?`,
    detail: "Die Datei wird aus dem Wissensordner gelöscht und die Löschung committet.",
    width: ui.SIZE.modal,
    actions: [
      ui.button(t, {
        id: "fabric-knowledge-rm-cancel",
        label: "Abbrechen",
        tooltip: "Nicht entfernen",
        onClick: (cx) => { app.modal = null; cx.notify(); },
      }),
      ui.button(t, {
        id: "fabric-knowledge-rm-confirm",
        label: "Entfernen",
        icon: "trash",
        danger: true,
        busy: app.busy === "knowledge-rm",
        disabled: Boolean(app.busy),
        tooltip: "Eintrag entfernen (fab knowledge rm)",
        onClick: (cx) => app.removeKnowledge(cx),
      }),
    ],
  }, error ? [ui.notice(t, error.text, error.level)] : []);
}

export function renderDialogs(app, cx, t) {
  if (app.newOpen) return newTicketDialog(app, cx, t);
  if (app.newTeamOpen) return newTeamDialog(app, cx, t);
  if (app.newFabricOpen) return newFabricDialog(app, cx, t);
  if (!app.modal) return null;
  if (app.modal.kind === "accept") return acceptDialog(app, cx, t);
  if (app.modal.kind === "drop") return dropDialog(app, cx, t);
  if (app.modal.kind === "delete-blueprint") return deleteBlueprintDialog(app, cx, t);
  if (app.modal.kind === "team-delete") return deleteTeamDialog(app, cx, t);
  if (app.modal.kind === "fabric-delete") return deleteFabricDialog(app, cx, t);
  if (app.modal.kind === "knowledge-note") return knowledgeNoteDialog(app, cx, t);
  if (app.modal.kind === "knowledge-remove") return knowledgeRemoveDialog(app, cx, t);
  if (app.modal.kind === "unsaved" || app.modal.kind === "unsaved-close") return unsavedDialog(app, cx, t);
  return null;
}

function programOptions(app, current) {
  return model.programOptions(app.programs, current);
}

function colorRow(app, cx, t) {
  // Klicks aus dem Elementbaum eines älteren Drawers dürfen nicht in den
  // inzwischen sichtbaren Drawer schreiben.
  const draftId = app.blueprintDraftId;
  return h_flex().w_full().gap(S.s).items_center().children(COLORS.map((key) => {
    const active = app.blueprintColorKey === key;
    const color = ui.roleColor(t, key);
    return h_flex()
      .id(`fabric-color-${key}`)
      .size(22)
      .rounded(11)
      .items_center()
      .justify_center()
      .bg(color)
      .when(active, (el) => el.border_2().border_color(t.foreground).text_color(t.background).child(ui.icon("check", 11)))
      .cursor_pointer()
      .tooltip(key)
      .on_click((_event, cx) => {
        cx.stop_propagation();
        if (app.blueprintDraftId !== draftId || !app.blueprintDrawer) return;
        app.blueprintColorKey = key;
        app.blueprintDirty = true;
        cx.notify();
      });
  }));
}

export function renderBlueprintDrawer(app, cx, t) {
  if (!app.blueprintDrawer) return null;
  const mode = app.blueprintDrawer.mode;
  const editable = mode !== "view";
  const draftId = app.blueprintDraftId;
  const original = app.blueprintOriginal;
  const blueprint = app.blueprintFor(original);
  const parsed = model.argvParts(model.argvFromParts({
    program: app.blueprintProgram,
    model: app.blueprintModel?.value() ?? "",
    flags: app.blueprintFlags?.value() ?? "",
  }));
  const programRows = programOptions(app, app.blueprintProgram);
  const programLabel = programRows.find((row) => row.value === app.blueprintProgram)?.label ?? app.blueprintProgram;
  const promptPath = app.blueprintPromptPath || `prompts/${app.blueprintName?.value() || original || "name"}.md`;
  return ui.drawer(t, {
    title: mode === "new" ? "Neue Blaupause" : `Blaupause ${original}`,
    subtitle: mode === "new"
      ? "Rolle, Farbe, Programm und Rollenprompt"
      : `${(blueprint?.teams ?? []).length} Team${(blueprint?.teams ?? []).length === 1 ? "" : "s"} · ${blueprint?.prompt ?? promptPath}`,
    onClose: (cx) => app.closeBlueprintDrawer(cx),
    tooltip: "Drawer schließen (Esc)",
    width: ui.SIZE.drawer,
    footer: [
      ...(mode === "edit" ? [ui.button(t, {
        id: "fabric-blueprint-delete",
        label: "Löschen",
        icon: "trash",
        danger: true,
        disabled: Boolean(app.busy),
        tooltip: "Blaupause löschen (fragt nach)",
        onClick: (cx) => app.confirmDeleteBlueprint(blueprint ?? { name: original, teams: [] }, cx),
      })] : []),
      ui.button(t, {
        id: "fabric-blueprint-cancel",
        label: editable ? "Abbrechen" : "Schließen",
        tooltip: "Drawer schließen (Esc)",
        onClick: (cx) => app.closeBlueprintDrawer(cx),
      }),
      ...(editable ? [ui.button(t, {
        id: "fabric-blueprint-save",
        label: "Speichern",
        icon: "save",
        primary: true,
        busy: app.busy === "blueprint",
        disabled: Boolean(app.busy),
        tooltip: "Blaupause speichern (⌘S)",
        onClick: (cx) => app.saveBlueprint(cx),
      })] : []),
    ],
  }, [
    ui.field(t, "Name", app.blueprintName ? ui.input(t, app.blueprintName, { focused: true }) : div(), {
      hint: "a–z, 0–9, _ und -, höchstens 16 Zeichen",
    }),
    ui.field(t, "Rolle", app.blueprintRole ? ui.input(t, app.blueprintRole) : div(), {
      hint: "z. B. umsetzer, pruefer, recherchierer",
    }),
    ui.field(t, "Farbe", colorRow(app, cx, t)),
    ui.field(t, "Programm", ui.dropdown(t, {
      id: "fabric-blueprint-program",
      value: programLabel,
      placeholder: app.programs ? "Programm wählen…" : "Programme werden geladen …",
      options: programRows,
      open: app.menu === "blueprint-program",
      width: 300,
      scrollHandle: app.dropdownScroll,
      onToggle: () => { app.menu = app.menu === "blueprint-program" ? null : "blueprint-program"; cx.notify(); },
      onPick: (value) => {
        app.menu = null;
        // Eine Auswahl aus einem offenen Menü darf nicht in einen neuen Drawer setzen.
        if (app.blueprintDraftId !== draftId || !app.blueprintDrawer) { cx.notify(); return; }
        app.blueprintProgram = value;
        app.blueprintDirty = true;
        cx.notify();
      },
    }), {
      hint: app.errorFor("programs")?.text
        ?? (Array.isArray(app.programs) && app.programs.length === 0
          ? "Keine installierten Programme gefunden; der bisherige Wert bleibt."
          : null),
    }),
    ui.field(t, "Modell", app.blueprintModel ? ui.input(t, app.blueprintModel) : div(), {
      hint: "Wird als --model=<Wert> gesetzt",
    }),
    ui.field(t, "Weitere Flags", app.blueprintFlags ? ui.input(t, app.blueprintFlags) : div(), {
      hint: `Shell-Regeln: Anführungszeichen bleiben zusammen · ${parsed.flags.length} erkannt`,
    }),
    div().w_full().h(1).bg(t.border),
    h_flex().w_full().items_center()
      .child(div().text_size(T.xs).text_color(t.dim).child("Rollenprompt"))
      .child(div().flex_1())
      .child(ui.chip(t, promptPath, t.dim, "fabric-blueprint-prompt-path", { tooltip: promptPath })),
    app.blueprintPrompt
      ? ui.editor(t, app.blueprintPrompt, { height: 220 })
      : ui.loading(t, "Prompt wird geladen …"),
    ui.hint(t, "Speichern ruft fab blueprint add bzw. fab blueprint edit. Die Promptdatei wird mitgeschrieben."),
    ...(app.errorFor("blueprint") || app.errorFor("blueprint-rm")
      ? [ui.notice(t, (app.errorFor("blueprint") || app.errorFor("blueprint-rm")).text,
        (app.errorFor("blueprint") || app.errorFor("blueprint-rm")).level)]
      : []),
  ]);
}
