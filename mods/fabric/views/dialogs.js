// Dialoge und der Agent-Drawer: Neues Ticket, Bestätigungen, Schutz vor Verlust.

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
  return ui.modal(t, {
    title: "Neues Ticket",
    detail: "Ein Satz genügt. Der Orchestrator formuliert Ziel, Kontext und Abnahmekriterien aus.",
    width: 580,
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
        disabled: Boolean(app.busy) || !(app.newSentence?.value().trim()),
        tooltip: "Ticket anlegen",
        onClick: (cx) => app.createTicket(cx),
      }),
    ],
  }, [
    v_flex().w_full().gap(S.s)
      .child(div().text_size(T.xs).text_color(t.dim).child("Auftrag"))
      .child(app.newSentence ? ui.input(t, app.newSentence, { focused: true }) : div())
      .when(app.mentionOpen("new"), (el) => el.child(app.mentionView("new", t)))
      .when(Boolean(app.newError), (el) => el.child(ui.notice(t, app.newError)))
      .child(div().pt(S.xs).text_size(T.xs).text_color(t.dim).child("Repo"))
      .child(ui.dropdown(t, {
        id: "fabric-new-repo",
        value: app.newRepo ? model.repoName(app.newRepo) : "Kein Repo",
        options,
        open: app.menu === "new-repo",
        width: 360,
        scrollHandle: app.dropdownScroll,
        onToggle: () => { app.menu = app.menu === "new-repo" ? null : "new-repo"; cx.notify(); },
        onPick: (value) => {
          app.menu = null;
          if (value === "__pick") app.pickNewRepo(cx);
          else { app.newRepo = value || null; cx.notify(); }
        },
      }))
      .when(Boolean(app.newRepo), (el) => el.child(ui.hint(t, app.newRepo)))
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
    width: 520,
    actions: [
      ui.button(t, { id: "fabric-accept-cancel", label: "Abbrechen", onClick: (cx) => { app.modal = null; cx.notify(); } }),
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
    width: 520,
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
      .child(div().text_size(T.xs).text_color(t.dim).child("Grund (steht im Verlauf)"))
      .child(app.modal.reason ? ui.input(t, app.modal.reason, { focused: true }) : div())
      .when(Boolean(app.errorFor("drop")), (el) => el.child(ui.notice(t, app.errorFor("drop").text))),
  ]);
}

function deleteAgentDialog(app, cx, t) {
  const agent = app.modal.agent ?? {};
  return ui.modal(t, {
    title: `Agent ${agent.name} löschen?`,
    detail: [
      `${agent.name} hat ${agent.open_tickets ?? 0} offene Tickets und ${(agent.sessions ?? []).length} laufende Sessions.`,
      "fab verweigert das Löschen, solange Tickets offen sind, eine Session läuft oder der Agent Prüfer ist.",
      "Die Promptdatei bleibt erhalten.",
    ].join("\n"),
    width: 520,
    actions: [
      ui.button(t, { id: "fabric-agent-delete-cancel", label: "Abbrechen", onClick: (cx) => { app.modal = null; cx.notify(); } }),
      ui.button(t, {
        id: "fabric-agent-delete-confirm",
        label: "Löschen",
        icon: "trash",
        danger: true,
        busy: app.busy === "agent-rm",
        disabled: Boolean(app.busy),
        tooltip: "Agent entfernen (fab agent rm)",
        onClick: (cx) => app.deleteAgent(cx),
      }),
    ],
  });
}

function unsavedDialog(app, cx, t) {
  const labels = (app.modal.dirty ?? []).map((entry) => `• ${entry.label}`).join("\n");
  return ui.modal(t, {
    title: "Ungespeicherte Änderungen",
    detail: `Diese Bereiche haben Änderungen:\n${labels}\n\nSpeichern, verwerfen oder hier bleiben.`,
    width: 520,
    actions: [
      ui.button(t, { id: "fabric-unsaved-cancel", label: "Abbrechen", onClick: (cx) => { app.modal = null; cx.notify(); } }),
      ui.button(t, {
        id: "fabric-unsaved-discard",
        label: "Verwerfen",
        icon: "undo",
        disabled: Boolean(app.busy),
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

export function renderDialogs(app, cx, t) {
  if (app.newOpen) return newTicketDialog(app, cx, t);
  if (!app.modal) return null;
  if (app.modal.kind === "accept") return acceptDialog(app, cx, t);
  if (app.modal.kind === "drop") return dropDialog(app, cx, t);
  if (app.modal.kind === "delete-agent") return deleteAgentDialog(app, cx, t);
  if (app.modal.kind === "unsaved" || app.modal.kind === "unsaved-close") return unsavedDialog(app, cx, t);
  return null;
}

function programOptions(app, current) {
  return model.programOptions(app.programs, current);
}

function colorRow(app, cx, t) {
  return h_flex().w_full().gap(6).items_center().children(COLORS.map((key) => {
    const active = app.agentColorKey === key;
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
      .on_click((_event, cx) => { cx.stop_propagation(); app.agentColorKey = key; app.teamDirty = true; cx.notify(); });
  }));
}

export function renderAgentDrawer(app, cx, t) {
  if (!app.teamDrawer) return null;
  const mode = app.teamDrawer.mode;
  const original = app.agentOriginal;
  const agent = app.agentFor(original);
  const parsed = model.argvParts(model.argvFromParts({
    program: app.agentProgram,
    model: app.agentModel?.value() ?? "",
    flags: app.agentFlags?.value() ?? "",
  }));
  const programRows = programOptions(app, app.agentProgram);
  const programLabel = programRows.find((row) => row.value === app.agentProgram)?.label ?? app.agentProgram;
  return ui.drawer(t, {
    title: mode === "new" ? "Neuer Agent" : `Agent ${original}`,
    subtitle: mode === "new" ? "Roster und Rollenprompt" : `${agent?.open_tickets ?? 0} offene Tickets`,
    onClose: (cx) => app.closeDrawer(cx),
    tooltip: "Drawer schließen (Esc)",
    width: 420,
    footer: [
      ...(mode === "edit" ? [ui.button(t, {
        id: "fabric-agent-delete",
        label: "Löschen",
        icon: "trash",
        danger: true,
        disabled: Boolean(app.busy),
        tooltip: "Agent löschen (fragt nach)",
        onClick: (cx) => app.confirmDeleteAgent(agent ?? { name: original }, cx),
      })] : []),
      ui.button(t, {
        id: "fabric-agent-cancel",
        label: "Abbrechen",
        onClick: (cx) => app.closeDrawer(cx),
      }),
      ui.button(t, {
        id: "fabric-agent-save",
        label: "Speichern",
        icon: "save",
        primary: true,
        busy: app.busy === "agent",
        disabled: Boolean(app.busy),
        tooltip: "Agent speichern (⌘S)",
        onClick: (cx) => app.saveAgent(cx),
      }),
    ],
  }, [
    ui.field(t, "Name", app.agentName ? ui.input(t, app.agentName, { focused: true }) : div(), {
      hint: "a–z, 0–9, _ und -, höchstens 16 Zeichen",
    }),
    ui.field(t, "Rolle", app.agentRole ? ui.input(t, app.agentRole) : div(), {
      hint: "z. B. umsetzer, pruefer, recherchierer",
    }),
    ui.field(t, "Farbe", colorRow(app, cx, t)),
    ui.field(t, "Programm", ui.dropdown(t, {
      id: "fabric-agent-program",
      value: programLabel,
      placeholder: app.programs ? "Programm wählen…" : "Programme werden geladen …",
      options: programRows,
      open: app.menu === "agent-program",
      width: 300,
      scrollHandle: app.dropdownScroll,
      onToggle: () => { app.menu = app.menu === "agent-program" ? null : "agent-program"; cx.notify(); },
      onPick: (value) => { app.menu = null; app.agentProgram = value; app.teamDirty = true; cx.notify(); },
    }), {
      hint: app.errorFor("programs")?.text
        ?? (Array.isArray(app.programs) && app.programs.length === 0
          ? "Keine installierten Programme gefunden; der bisherige Wert bleibt."
          : null),
    }),
    ui.field(t, "Modell", app.agentModel ? ui.input(t, app.agentModel) : div(), {
      hint: "Wird als --model=<Wert> gesetzt",
    }),
    ui.field(t, "Weitere Flags", app.agentFlags ? ui.input(t, app.agentFlags) : div(), {
      hint: `Shell-Regeln: Anführungszeichen bleiben zusammen · ${parsed.flags.length} erkannt`,
    }),
    div().w_full().h(1).bg(t.border),
    h_flex().w_full().items_center()
      .child(div().text_size(T.xs).text_color(t.dim).child("Rollenprompt"))
      .child(div().flex_1())
      .child(ui.chip(t, `prompts/${app.agentName?.value() || original || "name"}.md`, t.dim)),
    app.agentPrompt
      ? ui.editor(t, app.agentPrompt, { height: 220 })
      : ui.loading(t, "Prompt wird geladen …"),
    ui.hint(t, "Speichern ruft fab agent add bzw. fab agent edit. Die Promptdatei wird mitgeschrieben."),
    ...(app.errorFor("agent") || app.errorFor("agent-rm")
      ? [ui.notice(t, (app.errorFor("agent") || app.errorFor("agent-rm")).text,
        (app.errorFor("agent") || app.errorFor("agent-rm")).level)]
      : []),
  ]);
}
