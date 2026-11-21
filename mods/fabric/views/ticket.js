// Ticket-Detail: links Titel, Beschreibung und Verlauf, rechts alle Eigenschaften.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { agents, run, terminals } from "herdr";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const PROPS = 320;

function segmented(app, cx, t, value, onPick) {
  return ui.tabs(t, {
    id: "fabric-body-tabs",
    value,
    items: [{ value: "view", label: "Ansicht" }, { value: "edit", label: "Bearbeiten" }],
    onPick,
  });
}

function head(app, cx, t, ticket) {
  return v_flex()
    .flex_none()
    .w_full()
    .px(S.l)
    .py(S.m)
    .gap(S.s)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(ui.button(t, {
          id: "fabric-ticket-back",
          label: "Zurück",
          icon: "chevron-left",
          small: true,
          tooltip: "Zurück zur Liste (Esc)",
          onClick: (cx) => app.navigate("tickets", {}, cx),
        }))
        .child(div().text_size(T.xs).text_color(t.dim).child(ticket.id))
        .child(ui.chip(t, model.statusWord(ticket.status), ui.statusColor(t, ticket.status)))
        .when(ticket.waiting?.includes("mensch"), (el) => el.child(ui.chip(t, "wartet auf dich", t.accent)))
        .child(div().flex_1())
        .when(Boolean(ticket.branch), (el) => el.child(ui.chip(t, ticket.branch, t.muted))),
    )
    .child(
      app.titleEdit
        ? h_flex().w_full().gap(S.s).items_center()
          .child(div().flex_1().min_w(0).child(ui.input(t, app.titleEdit, { focused: true })))
          .child(ui.iconButton(t, {
            id: "fabric-title-save",
            icon: "save",
            tooltip: "Titel speichern (⌘S)",
            disabled: Boolean(app.busy),
            onClick: (cx) => app.saveTitle(cx),
          }))
          .child(ui.iconButton(t, {
            id: "fabric-title-cancel",
            icon: "close",
            tooltip: "Titel verwerfen (Esc)",
            onClick: (cx) => app.cancelTitleEdit(cx),
          }))
        : h_flex().w_full().gap(S.s).items_start()
          .child(div().flex_1().min_w(0).text_size(T.xl).font_semibold().line_height(1.25)
            .whitespace_normal().child(ticket.title || "Ohne Titel"))
          .child(ui.iconButton(t, {
            id: "fabric-title-edit",
            icon: "edit",
            tooltip: "Titel bearbeiten",
            onClick: (cx) => app.startTitleEdit(cx),
          })),
    )
    .when(app.titleEdit && app.mentionOpen("title"), (el) => el.child(app.mentionView("title", t)))
    .when(Boolean(app.errorFor("title")), (el) =>
      el.child(ui.notice(t, app.errorFor("title").text, app.errorFor("title").level)));
}

function body(app, cx, t, ticket) {
  const dirty = app.bodyEditor ? model.isDirty(app.bodyEditor.value(), app.bodySaved) : false;
  const images = ticket.body ? model.imageRefs(ticket.body) : [];
  const toolbar = h_flex()
    .flex_none()
    .w_full()
    .items_center()
    .gap(S.s)
    .child(div().text_size(T.s).font_semibold().text_color(t.muted).child("Beschreibung"))
    .when(dirty, (el) => el.child(ui.chip(t, "ungespeichert", t.working)))
    .child(div().flex_1())
    .child(segmented(app, cx, t, app.bodyEditing ? "edit" : "view", (value) => {
      if (value === "edit") {
        app.bodyEditing = true;
      } else {
        app.bodyEditing = false;
      }
      cx.notify();
    }))
    .when(app.bodyEditing, (el) => el
      .child(ui.button(t, {
        id: "fabric-body-save",
        label: "Speichern",
        icon: "save",
        primary: true,
        busy: app.busy === "body",
        disabled: Boolean(app.busy),
        tooltip: "Speichern (⌘S)",
        onClick: (cx) => app.saveBody(cx),
      }))
      .child(ui.button(t, {
        id: "fabric-body-discard",
        label: "Verwerfen",
        icon: "undo",
        disabled: Boolean(app.busy) || !dirty,
        tooltip: "Änderungen verwerfen",
        onClick: (cx) => app.discardBody(cx),
      }))
      .child(ui.button(t, {
        id: "fabric-body-image",
        label: "Bild",
        icon: "image",
        tooltip: "Bild anhängen",
        onClick: (cx) => app.pickImage("body", cx),
      })));

  return v_flex()
    .flex_none()
    .w_full()
    .p(S.l)
    .gap(S.s)
    .border_b(1)
    .border_color(t.border)
    .child(toolbar)
    .when(Boolean(app.errorFor("body")), (el) =>
      el.child(ui.notice(t, app.errorFor("body").text, app.errorFor("body").level)))
    .when(app.bodyEditing, (el) => el
      .child(
        div().w_full().on_drop((event, cx) => app.dropImages(event.paths, "body", cx))
          .child(ui.editor(t, app.bodyEditor, { height: 260 })),
      )
      .child(ui.hint(t, "Markdown. ## Ziel, ## Kontext, ## Abnahmekriterien, ## Grenzen.")))
    .when(!app.bodyEditing, (el) => el
      .child(
        ticket.body
          ? div().w_full().p(S.m).gap(S.s).rounded(ui.RADIUS.m).border_1().border_color(t.border).bg(t.background)
            .child(TextView.markdown(`fabric-body-${ticket.id}`, model.stripImages(ticket.body))
              .w_full().text_size(T.s).text_color(t.foreground).whitespace_normal().selectable(true))
            .when(images.length > 0, (inner) => inner.child(
              ui.imageGallery(t, images, (image) => app.openImage(image), `fabric-body-image-${ticket.id}`)))
          : ui.emptyState(t, {
            title: "Keine Beschreibung",
            text: "Der Orchestrator formuliert das Ticket aus – oder du schreibst selbst.",
            action: ui.button(t, {
              id: "fabric-body-start",
              label: "Beschreibung schreiben",
              icon: "edit",
              onClick: (cx) => { app.bodyEditing = true; cx.notify(); },
            }),
          }),
      ));
}

function historyRow(app, cx, t, row, index) {
  if (row.kind === "wake") {
    return h_flex()
      .id(`fabric-wake-${index}`)
      .w_full()
      .px(S.l)
      .py(2)
      .gap(5)
      .items_center()
      .child(div().flex_none().text_color(ui.kindColor(t, "wake")).child(ui.icon("bell", 11)))
      .child(div().text_size(T.xs).text_color(t.dim).child(model.wakeLine(row.event)));
  }
  const comment = row.comment;
  const images = model.imageRefs(comment.text ?? "");
  return v_flex()
    .id(`fabric-entry-${comment.n ?? index}`)
    .w_full()
    .px(S.l)
    .py(6)
    .gap(4)
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(ui.avatar(t, comment.author || "—", app.agentColor(comment.author), 22))
        .child(div().text_size(T.s).font_semibold().text_color(t.muted).child(comment.author || "unbekannt"))
        .child(div().text_size(T.xs).text_color(t.dim)
          .child(model.relativeTime(comment.at))
          .tooltip(model.absoluteTime(comment.at)))
        .child(div().flex_1())
        .when(Boolean(comment.mentions?.length), (el) => el.child(ui.chip(t, `${comment.mentions.length} Erwähnung${comment.mentions.length === 1 ? "" : "en"}`, t.muted))),
    )
    .child(
      div().pl(30).w_full()
        .child(TextView.markdown(`fabric-comment-${comment.n ?? index}`, ui.mentionMarkdown(comment.text))
          .w_full().text_size(T.s).text_color(t.foreground).whitespace_normal().selectable(true)),
    )
    .when(images.length > 0, (el) => el.child(
      div().pl(30).w_full()
        .child(ui.imageGallery(t, images, (image) => app.openImage(image),
          `fabric-comment-image-${comment.n ?? index}`)),
    ));
}

function history(app, cx, t, ticket) {
  const rows = model.history(ticket, app.events);
  const header = h_flex().w_full().px(S.l).py(S.xs).items_center()
    .child(div().text_size(T.s).font_semibold().text_color(t.muted).child("Verlauf"))
    .child(div().flex_1())
    .child(div().text_size(T.xs).text_color(t.dim).child(`${ticket.comments?.length ?? 0} Kommentare`));
  if (rows.length === 0) {
    return [
      header,
      div().px(S.l).py(S.m).text_size(T.s).text_color(t.dim).child("Noch kein Verlauf."),
    ];
  }
  return [header, ...rows.map((row, index) => historyRow(app, cx, t, row, index))];
}

function commentBox(app, cx, t, ticket) {
  const text = app.commentInput.value();
  const preview = model.wakeSummary(text, app.agentNames(), "mensch");

  const inputBox = v_flex()
    .w_full()
    .gap(4)
    .child(
      div().w_full().on_drop((event, cx) => app.dropImages(event.paths, "comment", cx))
        .child(ui.textarea(t, app.commentInput, { focused: app.fieldFocused, height: 84 })),
    )
    .when(app.mentionOpen("comment"), (el) => el.child(app.mentionView("comment", t)))
    .child(
      h_flex().w_full().gap(S.xs).items_center()
        .child(div().flex_1().min_w(0).child(ui.hint(t, preview)))
        .child(ui.iconButton(t, {
          id: "fabric-comment-image",
          icon: "image",
          tooltip: "Bild anhängen (Einfügen, Ablegen oder wählen)",
          size: 24,
          iconSize: 13,
          onClick: (cx) => app.pickImage("comment", cx),
        })),
    );

  return v_flex()
    .flex_none()
    .w_full()
    .p(S.l)
    .gap(S.s)
    .border_t(1)
    .border_color(t.border)
    .bg(t.surface)
    .child(inputBox)
    .when(Boolean(app.errorFor("comment")), (el) =>
      el.child(ui.notice(t, app.errorFor("comment").text, app.errorFor("comment").level)))
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(ui.button(t, {
          id: "fabric-comment-send",
          label: "Senden",
          icon: "send",
          primary: true,
          busy: app.busy === "comment",
          disabled: Boolean(app.busy) || !text.trim(),
          tooltip: "Kommentar senden (⌘⏎)",
          onClick: (cx) => app.comment(cx),
        }))
        .child(ui.keyHint(t, "⌘⏎"))
        .child(div().flex_1())
        .child(ui.hint(t, "„@name“ weckt. „@mensch“ landet in der Inbox.")),
    );
}

function readonlyValue(app, cx, t, label, value, { copyLabel = "Kopieren" } = {}) {
  if (!value) return ui.field(t, label, div().text_size(T.xs).text_color(t.dim).child("—"));
  return ui.field(t, label, h_flex().w_full().gap(S.xs).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(T.s).text_color(t.foreground).child(value).tooltip(value))
    .child(ui.iconButton(t, {
      id: `fabric-copy-${label}`,
      icon: "copy",
      tooltip: copyLabel,
      size: 24,
      iconSize: 12,
      onClick: (cx) => app.copyText(cx, value, `${label} kopiert.`),
    })));
}

function statusField(app, cx, t, ticket) {
  const options = model.statusOptions(ticket.status)
    .map((option) => ({ ...option, selected: option.key === ticket.status }));
  return ui.field(t, "Status", ui.dropdown(t, {
    id: "fabric-detail-status",
    value: model.statusWord(ticket.status),
    options,
    open: app.menu === "detail-status",
    width: 190,
    scrollHandle: app.dropdownScroll,
    onToggle: () => { app.menu = app.menu === "detail-status" ? null : "detail-status"; cx.notify(); },
    onPick: (value) => { app.menu = null; app.setStatus(value, cx); },
  }));
}

function assigneeField(app, cx, t, ticket) {
  const options = app.ticketAgents(ticket).map((agent) => ({
    value: agent.name,
    label: agent.name,
    detail: agent.role,
    selected: agent.name === ticket.assignee,
  }));
  return ui.field(t, "Zuständig", ui.dropdown(t, {
    id: "fabric-detail-assignee",
    value: ticket.assignee || "",
    placeholder: "Niemand",
    options,
    open: app.menu === "detail-assignee",
    width: 210,
    scrollHandle: app.dropdownScroll,
    empty: "Kein Team für dieses Repo",
    onToggle: () => { app.menu = app.menu === "detail-assignee" ? null : "detail-assignee"; cx.notify(); },
    onPick: (value) => { app.menu = null; app.setAssignee(value, cx); },
  }), { hint: app.rosterError ?? null });
}

function repoField(app, cx, t, ticket) {
  const known = new Set([
    ...(app.repos ?? []).map((repo) => repo.path),
    ...app.tickets.map((row) => row.repo).filter(Boolean),
  ]);
  if (ticket.repo) known.add(ticket.repo);
  const options = [...known].map((path) => ({
    value: path,
    label: model.repoName(path),
    detail: path,
    selected: path === ticket.repo,
  }));
  options.push({ value: "__pick", label: "Ordner wählen…", detail: "" });
  return ui.field(t, "Repo", ui.dropdown(t, {
    id: "fabric-detail-repo",
    value: ticket.repo ? model.repoName(ticket.repo) : "",
    placeholder: "Kein Repo",
    options,
    open: app.menu === "detail-repo",
    width: 280,
    scrollHandle: app.dropdownScroll,
    onToggle: () => { app.menu = app.menu === "detail-repo" ? null : "detail-repo"; cx.notify(); },
    onPick: (value) => {
      app.menu = null;
      if (value === "__pick") app.pickTicketRepo(cx);
      else app.setRepo(value, cx);
    },
  }));
}

function blockerField(app, cx, t, ticket) {
  const blocked = ticket.blocked_by ?? [];
  const candidates = app.tickets.filter((row) => row.id !== ticket.id
    && row.status !== "done" && row.status !== "dropped" && !blocked.includes(row.id));
  return ui.field(t, "Blockiert durch", v_flex().w_full().gap(5)
    .when(blocked.length === 0, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Keine Blockaden")))
    .children(blocked.map((id) => h_flex()
      .id(`fabric-blocker-${id}`)
      .w_full()
      .h(24)
      .px(6)
      .gap(5)
      .items_center()
      .rounded(ui.RADIUS.s)
      .bg(t.blocked + "18")
      .child(ui.chip(t, id, t.blocked))
      .child(div().flex_1())
      .child(ui.iconButton(t, {
        id: `fabric-blocker-remove-${id}`,
        icon: "close",
        tooltip: `Blockade ${id} entfernen`,
        size: 20,
        iconSize: 10,
        onClick: (cx) => app.removeBlocker(id, cx),
      }))))
    .child(ui.dropdown(t, {
      id: "fabric-detail-blocker",
      value: "",
      placeholder: candidates.length ? "Ticket hinzufügen…" : "Kein offenes Ticket",
      options: candidates.map((row) => ({ value: row.id, label: `${row.id} · ${row.title}`, selected: false })),
      open: app.menu === "detail-blocker",
      width: 300,
      scrollHandle: app.dropdownScroll,
      disabled: candidates.length === 0,
      empty: "Kein offenes Ticket",
      onToggle: () => { app.menu = app.menu === "detail-blocker" ? null : "detail-blocker"; cx.notify(); },
      onPick: (value) => { app.menu = null; app.addBlocker(value, cx); },
    })));
}

function parentField(app, cx, t, ticket) {
  const parent = app.tickets.find((row) => row.id === ticket.parent);
  return ui.field(t, "Eltern-Ticket", h_flex().w_full().gap(S.xs).items_center()
    .child(ui.chip(t, ticket.parent, t.muted, `fabric-parent-${ticket.parent}`, {
      tooltip: parent?.title || ticket.parent,
      onClick: (cx) => app.select(ticket.parent, cx),
    }))
    .when(Boolean(parent), (el) => el.child(div().flex_1().min_w(0).truncate()
      .text_size(T.s).text_color(t.foreground).child(parent.title || "Ohne Titel")
      .tooltip(parent.title || ""))));
}

function childrenField(app, cx, t, ticket) {
  const children = model.childrenOf(app.tickets, ticket.id);
  const progress = model.childProgress(children);
  return ui.field(t, "Unter-Tickets", v_flex().w_full().gap(5)
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(div().text_size(T.xs).text_color(t.dim).child(`${progress.closed}/${progress.total} erledigt`))
      .child(div().flex_1())
      .when(progress.open > 0, (el) => el.child(ui.chip(t, `${progress.open} offen`, t.working))))
    .children(children.map((child) => h_flex()
      .id(`fabric-child-${child.id}`)
      .w_full()
      .h(24)
      .px(6)
      .gap(5)
      .items_center()
      .rounded(ui.RADIUS.s)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click((_event, cx) => { cx.stop_propagation(); app.select(child.id, cx); })
      .child(ui.dot(t, ui.statusColor(t, child.status)))
      .child(div().w(34).flex_none().text_size(T.xs).text_color(t.dim).child(child.id))
      .child(div().flex_1().min_w(0).truncate().text_size(T.s).text_color(t.foreground)
        .child(child.title || "Ohne Titel").tooltip(child.title || ""))
      .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(model.statusWord(child.status))))));
}

function checksField(app, cx, t, ticket) {
  const checks = ticket.checks ?? null;
  const state = checks?.state;
  const action = model.actionBar(ticket, app.tickets).find((entry) => entry.id === "verify");
  return ui.field(t, "Checks", v_flex().w_full().gap(S.xs)
    .child(h_flex().w_full().gap(S.s).items_center()
      .when(Boolean(state), (el) => el.child(ui.chip(t,
        `Checks ${model.CHECK_WORDS[state] ?? state}`,
        state === "pass" ? t.done : t.blocked)))
      .when(!state, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Noch nicht geprüft")))
      .child(div().flex_1())
      .child(ui.button(t, {
        id: "fabric-checks-run",
        label: "Prüfen",
        icon: "check",
        small: true,
        busy: app.busy === "verify",
        disabled: Boolean(app.busy) || action?.disabled,
        reason: action?.reason,
        tooltip: "Prüfskript ausführen (fab verify)",
        onClick: (cx) => app.verify(cx),
      })))
    .when(Boolean(state), (el) => el
      .child(h_flex().w_full().gap(6).items_center()
        .child(div().text_size(T.xs).text_color(t.dim).child(`HEAD ${String(checks.head ?? "").slice(0, 7)}`))
        .child(div().text_size(T.xs).text_color(t.dim).child(model.relativeTime(checks.at)).tooltip(model.absoluteTime(checks.at)))
        .child(div().flex_1())
        .when(Boolean(checks.tail), (el) => el.child(ui.button(t, {
          id: "fabric-checks-toggle",
          label: app.checksOpen ? "Ausgabe verbergen" : "Ausgabe",
          icon: "eye",
          small: true,
          onClick: (cx) => { app.checksOpen = !app.checksOpen; cx.notify(); },
        }))))
      .when(app.checksOpen && Boolean(checks.tail), (el) => el.child(
        div().w_full().max_h(180).overflow_y_scrollbar().p(S.s).rounded(ui.RADIUS.s)
          .border_1().border_color(t.border).bg(t.background)
          .text_size(T.xs).text_color(t.muted).whitespace_normal().child(checks.tail))))
    .when(Boolean(app.errorFor("verify")), (el) =>
      el.child(ui.notice(t, app.errorFor("verify").text, app.errorFor("verify").level))));
}

function verdictField(app, cx, t, ticket) {
  const verdict = ticket.verdict ?? null;
  return ui.field(t, "Urteil", v_flex().w_full().gap(4)
    .when(Boolean(verdict?.state), (el) => el
      .child(h_flex().w_full().gap(S.s).items_center()
        .child(ui.chip(t, model.VERDICT_WORDS[verdict.state] ?? verdict.state,
          verdict.state === "pass" ? t.done : t.blocked))
        .child(div().text_size(T.xs).text_color(t.dim).child(`von ${verdict.by ?? "—"}`))
        .child(div().flex_1())
        .child(div().text_size(T.xs).text_color(t.dim).child(model.relativeTime(verdict.at)).tooltip(model.absoluteTime(verdict.at))))
      .when(Boolean(verdict.summary), (el) => el.child(
        div().w_full().text_size(T.xs).text_color(t.muted).line_height(1.35)
          .max_h(90).overflow_hidden().whitespace_normal().child(verdict.summary).tooltip(verdict.summary))))
    .when(!verdict?.state, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Noch kein Urteil"))));
}

function sessionsField(app, cx, t, ticket) {
  const chips = model.sessionChips(ticket.sessions, terminals(), agents(), ticket.id);
  return ui.field(t, "Sessions", v_flex().w_full().gap(S.s)
    .when(chips.length === 0, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Keine Session")))
    .when(chips.length > 0, (el) => el.child(h_flex().w_full().gap(4).flex_wrap()
      .children(chips.map((session, index) => ui.chip(t,
        `${session.agent || "Agent"} · ${session.word}`,
        ui.sessionColor(t, session.color),
        `fabric-session-${ticket.id}-${session.terminal || session.name || index}`,
        {
          tooltip: session.tooltip,
          onClick: session.ended ? null : (cx) => run("terminal.peek", { terminal: session.terminal }),
        })))))
    .child(ui.button(t, {
      id: "fabric-wake-open",
      label: "Wecken…",
      icon: "bell",
      small: true,
      disabled: Boolean(app.busy) || !ticket.assignee,
      reason: ticket.assignee ? "" : "Kein Zuständiger",
      tooltip: "Agent von Hand wecken",
      onClick: (cx) => app.openWake(cx),
    }))
    .when(app.wakeOpen, (el) => el.child(
      v_flex().w_full().gap(5).p(S.s).rounded(ui.RADIUS.m).border_1().border_color(t.border).bg(t.raised)
        .child(ui.dropdown(t, {
          id: "fabric-wake-name",
          value: app.wakeName,
          placeholder: "Agent",
          options: app.ticketAgents(ticket).map((agent) => ({
            value: agent.name, label: agent.name, detail: agent.role, selected: agent.name === app.wakeName,
          })),
          open: app.menu === "wake-name",
          width: 220,
          scrollHandle: app.dropdownScroll,
          onToggle: () => { app.menu = app.menu === "wake-name" ? null : "wake-name"; cx.notify(); },
          onPick: (value) => { app.menu = null; app.wakeName = value; cx.notify(); },
        }))
        .child(app.wakeText ? ui.input(t, app.wakeText, { focused: true }) : div())
        .when(app.mentionOpen("wake"), (el) => el.child(app.mentionView("wake", t)))
        .child(h_flex().w_full().gap(S.s).justify_end()
          .child(ui.button(t, { id: "fabric-wake-cancel", label: "Abbrechen", small: true, onClick: (cx) => app.closeWake(cx) }))
          .child(ui.button(t, {
            id: "fabric-wake-send",
            label: "Wecken",
            icon: "bell",
            primary: true,
            small: true,
            busy: app.busy === "wake",
            disabled: Boolean(app.busy) || !app.wakeName,
            onClick: (cx) => app.sendWake(cx),
          }))))));
}

function properties(app, cx, t, ticket) {
  const problem = app.errorFor("status") || app.errorFor("assign") || app.errorFor("repo")
    || app.errorFor("base") || app.errorFor("link");
  const column = v_flex()
    .flex_1()
    .min_h(0)
    .overflow_y_scrollbar()
    .p(S.l)
    .gap(S.m)
    .child(statusField(app, cx, t, ticket))
    .child(assigneeField(app, cx, t, ticket))
    .child(repoField(app, cx, t, ticket))
    .child(ui.field(t, "Basis", ui.input(t, app.baseInput)))
    .child(readonlyValue(app, cx, t, "Branch", ticket.branch))
    .child(readonlyValue(app, cx, t, "Worktree", ticket.worktree))
    .child(blockerField(app, cx, t, ticket))
    .when(Boolean(ticket.parent), (el) => el.child(parentField(app, cx, t, ticket)))
    .when(model.childrenOf(app.tickets, ticket.id).length > 0, (el) => el.child(childrenField(app, cx, t, ticket)))
    .child(div().w_full().h(1).bg(t.border))
    .child(checksField(app, cx, t, ticket))
    .child(verdictField(app, cx, t, ticket))
    .child(sessionsField(app, cx, t, ticket))
    .child(div().w_full().h(1).bg(t.border))
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(div().text_size(T.xs).text_color(t.dim).child(`Angelegt von ${ticket.created_by ?? "—"}`))
      .child(div().flex_1())
      .child(div().text_size(T.xs).text_color(t.dim)
        .child(model.relativeTime(ticket.created_at)).tooltip(model.absoluteTime(ticket.created_at))))
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(div().text_size(T.xs).text_color(t.dim).child("Aktualisiert"))
      .child(div().flex_1())
      .child(div().text_size(T.xs).text_color(t.dim)
        .child(model.relativeTime(ticket.updated_at)).tooltip(model.absoluteTime(ticket.updated_at))));
  const withProblem = problem ? column.child(ui.notice(t, problem.text, problem.level)) : column;
  return v_flex()
    .flex_none()
    .w(PROPS)
    .min_w(PROPS)
    .h_full()
    .border_l(1)
    .border_color(t.border)
    .child(withProblem);
}

function actionBar(app, cx, t, ticket) {
  const actions = model.actionBar(ticket, app.tickets);
  const error = ["accept", "reject", "drop", "verify", "wake", "status", "dispatch", "formulate"]
    .map((key) => app.errorFor(key)).find(Boolean);
  return v_flex()
    .flex_none()
    .w_full()
    .border_t(1)
    .border_color(t.border)
    .bg(t.chrome)
    .when(Boolean(error), (el) => el.child(ui.notice(t, error.text, error.level)))
    .child(
      h_flex()
        .w_full()
        .px(S.l)
        .py(S.s)
        .gap(S.s)
        .items_center()
        .children(actions.map((action) => ui.button(t, {
          id: `fabric-action-${action.id}`,
          label: action.label,
          icon: action.icon,
          primary: action.kind === "primary",
          danger: action.kind === "danger",
          busy: app.busy === busyKey(action.id) || (action.id === "reopen" && app.busy === "status"),
          disabled: Boolean(app.busy) || action.disabled,
          reason: action.reason,
          tooltip: action.desc ?? action.label,
          onClick: (cx) => runAction(app, action, cx),
        })))
        .child(div().flex_1())
        .when(ticket.status === "review", (el) => el.child(ui.hint(t, "Zurück mit Feedback nutzt den Text aus dem Kommentarfeld."))),
    );
}

function busyKey(id) {
  if (id === "reopen") return "status";
  return id;
}

function runAction(app, action, cx) {
  if (action.id === "formulate") app.formulate(cx);
  else if (action.id === "dispatch") app.dispatch(cx);
  else if (action.id === "verify") app.verify(cx);
  else if (action.id === "wake") app.openWake(cx);
  else if (action.id === "accept") app.openAcceptModal(cx);
  else if (action.id === "reject") app.reject(cx);
  else if (action.id === "drop") app.openDropModal(cx);
  else if (action.id === "reopen") app.reopen(cx);
}

export function renderTicket(app, cx, t) {
  const ticket = app.ticket;
  if (!ticket) {
    return v_flex()
      .size_full()
      .min_h(0)
      .child(ui.header(t, "Ticket", [
        ui.button(t, { id: "fabric-ticket-back-empty", label: "Zurück", icon: "chevron-left", tooltip: "Zurück (Esc)", onClick: (cx) => app.navigate("tickets", {}, cx) }),
      ], { iconName: "tickets" }))
      .child(ui.loading(t, app.ticketError ?? "Das Ticket wird geladen …"));
  }
  return v_flex()
    .size_full()
    .min_h(0)
    .overflow_hidden()
    .child(head(app, cx, t, ticket))
    .child(
      h_flex()
        .w_full()
        .flex_1()
        .min_h(0)
        .overflow_hidden()
        .items_stretch()
        .child(
          v_flex().flex_1().min_w(0).min_h(0).h_full().overflow_hidden()
            .child(
              v_flex()
                .id("fabric-ticket-scroll")
                .flex_1()
                .min_h(0)
                .w_full()
                .overflow_y_scrollbar()
                .track_scroll(app.historyScroll)
                .child(body(app, cx, t, ticket))
                .children(history(app, cx, t, ticket)),
            )
            .child(commentBox(app, cx, t, ticket)),
        )
        .child(properties(app, cx, t, ticket)),
    )
    .child(actionBar(app, cx, t, ticket));
}
