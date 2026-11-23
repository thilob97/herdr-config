// Ticket-Detail: links Titel, Beschreibung und Verlauf, rechts alle Eigenschaften.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { agents, appHome, run, terminals } from "herdr";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

function segmented(app, cx, t, value, onPick) {
  return ui.tabs(t, {
    id: "fabric-body-tabs",
    value,
    items: [{ value: "view", label: "Ansicht" }, { value: "edit", label: "Bearbeiten" }],
    onPick,
  });
}

function headBadge(app, ticket) {
  return model.pipelineBadge(app.pipelineRuns ?? [], ticket.id);
}

function ticketHeader(app, cx, t, ticket) {
  const badge = headBadge(app, ticket);
  const right = [
    ui.chip(t, model.statusWord(ticket.status), ui.statusColor(t, ticket.status)),
  ];
  if (ticket.waiting?.includes("mensch")) right.push(ui.chip(t, "wartet auf dich", t.accent));
  if (badge) {
    right.push(ui.pill(t, {
      id: "fabric-ticket-pipeline",
      label: `Lauf ${badge.word}`,
      color: ui.pipelineColor(t, badge.state),
      tooltip: `Letzter Lauf #${badge.run.id} · ${model.pipelineTriggerWord(badge.run.trigger)} · ${model.relativeTime(badge.run.started_at)}`,
      onClick: (cx) => app.navigate("pipelines", {
        ticket: ticket.id,
        run: badge.run.id,
      }, cx),
    }));
  } else {
    // Ohne Pipeline-Pill bleibt der Verweis auf die Läufe als einziger Einstieg.
    right.push(ui.chip(t, "Läufe", t.muted, "fabric-ticket-pipelines", {
      tooltip: "Läufe dieses Tickets (Pipelines)",
      onClick: (cx) => app.navigate("pipelines", { ticket: ticket.id }, cx),
    }));
  }
  right.push(ui.button(t, {
    id: "fabric-ticket-context",
    label: app.compact ? "Kontext" : "Was sieht der Agent?",
    icon: "eye",
    small: true,
    tooltip: "Kontextvorschau des Tickets öffnen",
    onClick: (cx) => app.toggleContextPreview("ticket", ticket.id, cx),
  }));
  right.push(app.compact
    ? ui.iconButton(t, {
      id: "fabric-ticket-back",
      icon: "chevron-left",
      tooltip: "Zurück zur Liste (Esc)",
      onClick: (cx) => app.navigate("tickets", {}, cx),
    })
    : ui.button(t, {
      id: "fabric-ticket-back",
      label: "Zurück",
      icon: "chevron-left",
      small: true,
      tooltip: "Zurück zur Liste (Esc)",
      onClick: (cx) => app.navigate("tickets", {}, cx),
    }));
  return ui.header(t, model.pageWord("ticket"), right, {
    iconName: "tickets",
    subtitle: ticket.id,
    compact: app.compact,
  });
}

/** Titelzeile unter dem Seitenkopf; Branch und Läufe stehen nicht mehr redundant hier. */
function titleBlock(app, cx, t, ticket) {
  return v_flex()
    .flex_none()
    .w_full()
    .px(S.l)
    .pt(S.m)
    .pb(S.xs)
    .gap(S.s)
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

function proofName(proof) {
  return proof?.name || String(proof?.path ?? "").split("/").pop() || "Nachweis";
}

/** `image()` löst relativ zum App-Verzeichnis auf; alles außerhalb bleibt Datei. */
function appImagePath(path) {
  const root = String(appHome() ?? "").replace(/\/+$/, "");
  const value = String(path ?? "");
  if (!root || !value) return "";
  if (value.startsWith(`${root}/`)) return value.slice(root.length + 1);
  return value.startsWith("/") ? "" : value;
}

function changesFiles(app, cx, t, data) {
  const files = data.files ?? [];
  if (!files.length) return ui.hint(t, "Keine Dateien gegenüber der Basis.");
  return v_flex().w_full().gap(S.xs).children(files.map((file, index) => {
    const selected = app.changesFile === file.path;
    return h_flex()
      .id(`fabric-changes-file-${index}`)
      .w_full()
      .h(24)
      .px(S.s)
      .gap(S.s)
      .items_center()
      .rounded(ui.RADIUS.s)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .when(selected, (el) => el.bg(t.raised))
      .on_click((_event, clickCx) => {
        clickCx.stop_propagation();
        app.openDiffFile(file.path);
      })
      .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.foreground)
        .child(file.path).tooltip(file.path))
      .child(div().flex_none().text_size(T.xs).text_color(file.binary ? t.dim : t.done)
        .child(file.binary ? "binär" : `+${file.added ?? 0}`))
      .child(div().flex_none().text_size(T.xs).text_color(file.binary ? t.dim : t.blocked)
        .child(file.binary ? "" : `−${file.deleted ?? 0}`));
  }));
}

function diffLine(t, line, index) {
  const kind = line.startsWith("@@") ? "hunk"
    : line.startsWith("+") ? "add"
      : line.startsWith("-") ? "del" : "";
  const color = kind === "add" ? t.done
    : kind === "del" ? t.blocked
      : kind === "hunk" ? t.accent : t.muted;
  return div()
    .id(`fabric-changes-diff-${index}`)
    .flex_none()
    .font_family("monospace")
    .text_size(T.xs)
    .text_color(color)
    .whitespace_nowrap()
    .child(line === "" ? " " : line);
}

function changesDiff(app, cx, t) {
  if (!app.changesFile) return null;
  const lines = String(app.changesDiff ?? "").split("\n");
  const shown = lines.slice(0, 2000);
  return v_flex().w_full().gap(S.xs)
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(T.xs).font_semibold().text_color(t.muted)
        .child(app.changesFile))
      .when(app.changesLoadingFile, (el) => el.child(ui.spinner(t))))
    .child(
      div()
        .w_full()
        .max_h(320)
        .overflow_y_scrollbar()
        .overflow_x_scrollbar()
        .rounded(ui.RADIUS.s)
        .border_1()
        .border_color(t.border)
        .bg(t.background)
        .p(S.s)
        .child(v_flex().gap(S.xs).children(shown.map((line, index) => diffLine(t, line, index)))),
    )
    .when(lines.length > shown.length, (el) =>
      el.child(ui.hint(t, `… ${lines.length - shown.length} weitere Zeilen`)))
    .when(!app.changesDiff && !app.changesLoadingFile, (el) =>
      el.child(ui.hint(t, "Keine Textänderung – binär oder leer.")));
}

function changesCommits(t, data) {
  const commits = data.commits ?? [];
  if (!commits.length) return ui.hint(t, "Keine Commits.");
  return v_flex().w_full().gap(S.xs).children(commits.map((commit, index) => h_flex()
    .id(`fabric-changes-commit-${index}`)
    .w_full()
    .gap(S.s)
    .items_center()
    .child(div().flex_none().font_family("monospace").text_size(T.xs).text_color(t.accent)
      .child(commit.short ?? String(commit.hash ?? "").slice(0, 7)))
    .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.foreground)
      .child(commit.subject ?? "Ohne Betreff").tooltip(commit.subject ?? ""))
    .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(commit.author ?? ""))));
}

function changesProofs(app, cx, t, data) {
  const proofs = data.proofs ?? [];
  if (!proofs.length) return ui.hint(t, "Keine Nachweise im Handover oder als Anhang.");
  const images = proofs
    .filter((proof) => proof.image && proof.exists)
    .map((proof) => ({ path: appImagePath(proof.path), alt: proofName(proof) }))
    .filter((proof) => proof.path);
  const files = proofs.filter((proof) => !proof.exists || !proof.image || !appImagePath(proof.path));
  return v_flex().w_full().gap(S.s)
    .when(images.length > 0, (el) => el.child(
      ui.imageGallery(
        t,
        images,
        (bild) => app.openImage(bild),
        "fabric-changes-proof",
      ),
    ))
    .children(files.map((proof, index) => h_flex()
      .id(`fabric-changes-proof-file-${index}`)
      .w_full()
      .gap(S.s)
      .items_center()
      .child(div().flex_none().text_color(proof.exists ? t.muted : t.dim)
        .child(ui.icon(proof.image ? "image" : "folder", 12)))
      .child(div().flex_1().min_w(0).truncate().text_size(T.xs)
        .text_color(proof.exists ? t.foreground : t.dim)
        .child(proofName(proof)).tooltip(proof.path ?? ""))
      .when(!proof.exists, (el) => el.child(ui.chip(t, "fehlt", t.dim)))));
}

function changesSection(app, cx, t, ticket) {
  const data = app.changes;
  const gate = model.changesGate(data, app.changesSeenHead);
  const head = data?.head ? String(data.head).slice(0, 7) : "—";
  const totals = (data?.files ?? []).reduce((sum, file) => ({
    added: sum.added + (Number(file.added) || 0),
    deleted: sum.deleted + (Number(file.deleted) || 0),
  }), { added: 0, deleted: 0 });
  const buttonLabel = !app.changesOpen ? "Ansehen"
    : gate.enabled ? "Ausblenden" : "Neu ansehen";
  return v_flex()
    .id("fabric-changes")
    .flex_none()
    .w_full()
    .p(S.l)
    .gap(S.s)
    .border_b(1)
    .border_color(t.border)
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(div().text_size(T.s).font_semibold().text_color(t.muted).child("Änderungen"))
      .child(ui.chip(t, `HEAD ${head}`, gate.enabled ? t.done : t.dim))
      .when(Boolean(data?.files?.length), (el) => el
        .child(div().text_size(T.xs).text_color(t.done).child(`+${totals.added}`))
        .child(div().text_size(T.xs).text_color(t.blocked).child(`−${totals.deleted}`)))
      .child(div().flex_1())
      .child(ui.button(t, {
        id: "fabric-changes-toggle",
        label: buttonLabel,
        icon: "code",
        small: true,
        busy: app.changesLoading,
        tooltip: gate.enabled
          ? "Änderungen für diesen HEAD sind angesehen"
          : "Dateien, Diff, Commits und Nachweise ansehen; schaltet „Abnehmen“ frei",
        onClick: (cx) => app.toggleChanges(cx),
      })))
    .when(!app.changesOpen, (el) => el.child(div()
      .w_full()
      .text_size(T.xs)
      .text_color(gate.enabled ? t.done : t.dim)
      .whitespace_normal()
      .child(gate.enabled
        ? "Für diesen HEAD angesehen – „Abnehmen“ ist frei."
        : "Vor dem Abnehmen ansehen: Dateien, Diff, Commits und Nachweise.")))
    .when(app.changesOpen && Boolean(data), (el) => el
      .child(changesFiles(app, cx, t, data))
      .when(Boolean(app.changesFile), (inner) => inner.child(changesDiff(app, cx, t)))
      .child(div().w_full().h(1).bg(t.border))
      .child(div().text_size(T.xs).font_semibold().text_color(t.dim).child("Commits"))
      .child(changesCommits(t, data))
      .child(div().w_full().h(1).bg(t.border))
      .child(div().text_size(T.xs).font_semibold().text_color(t.dim).child("Nachweise"))
      .child(changesProofs(app, cx, t, data)))
    .when(Boolean(app.errorFor("changes")), (el) =>
      el.child(ui.notice(t, app.errorFor("changes").text, app.errorFor("changes").level)));
}

function historyRow(app, cx, t, row, index, cards = []) {
  if (row.kind === "wake") {
    return h_flex()
      .id(`fabric-wake-${index}`)
      .w_full()
      .px(S.l)
      .py(S.xs)
      .gap(S.s)
      .items_center()
      .child(div().flex_none().text_color(ui.kindColor(t, "wake")).child(ui.icon("bell", 11)))
      .child(div().text_size(T.xs).text_color(t.dim).child(model.wakeLine(row.event)));
  }
  const comment = row.comment;
  const images = model.imageRefs(comment.text ?? "");
  const hint = model.commentDecisionHint(comment, cards);
  return v_flex()
    .id(`fabric-entry-${comment.n ?? index}`)
    .w_full()
    .px(S.l)
    .py(S.s)
    .gap(S.xs)
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(ui.avatar(t, comment.author || "—", app.agentColor(comment.author), 22))
        .child(div().text_size(T.s).font_semibold().text_color(t.muted).child(comment.author || "unbekannt"))
        .child(div().text_size(T.xs).text_color(t.dim)
          .child(model.relativeTime(comment.at))
          .tooltip(model.absoluteTime(comment.at)))
        .child(div().flex_1()),
    )
    .child(
      div().pl(S.xl).w_full()
        .child(TextView.markdown(`fabric-comment-${comment.n ?? index}`, ui.mentionMarkdown(comment.text))
          .w_full().text_size(T.s).text_color(t.foreground).whitespace_normal().selectable(true)),
    )
    .when(Boolean(hint), (el) => el.child(
      div().pl(S.xl).w_full().text_size(T.xs).text_color(t.dim)
        .whitespace_normal().child(hint.decidedAt
          ? `${hint.text} · ${model.relativeTime(hint.decidedAt)}`
          : hint.text)))
    .when(images.length > 0, (el) => el.child(
      div().pl(S.xl).w_full()
        .child(ui.imageGallery(t, images, (image) => app.openImage(image),
          `fabric-comment-image-${comment.n ?? index}`)),
    ));
}

/** Offene und entschiedene Vorschläge des Tickets, offene zuerst. */
function decisionsSection(app, cx, t, cards) {
  if (!cards.length) return null;
  const error = app.errorFor("proposal");
  const open = cards.filter((card) => card.status === "open").length;
  const decided = cards.length - open;
  const busy = app.busy === "proposal";
  return v_flex()
    .w_full()
    .px(S.l)
    .py(S.m)
    .gap(S.s)
    .border_b(1)
    .border_color(t.border)
    .child(ui.sectionTitle(t, "Zu entscheiden", [
      ui.badge(t, open, open ? t.working : t.dim),
      ...(decided
        ? [ui.chip(t, `${decided} entschieden`, t.dim, "fabric-proposals-decided",
          { tooltip: "Bereits übernommene oder abgelehnte Vorschläge" })]
        : []),
    ]))
    .children(cards.map((card) => ui.proposalCard(t, card, {
      compact: app.compact,
      busy,
      onAccept: (cx) => app.applyProposal(card, "accept", cx),
      onReject: (cx) => app.applyProposal(card, "reject", cx),
    })))
    .when(Boolean(error), (el) => el.child(ui.notice(t, error.text, error.level)));
}

function history(app, cx, t, ticket, cards = []) {
  const rows = model.history(ticket, app.events);
  const header = h_flex().w_full().px(S.l).py(S.xs).items_center()
    .child(div().text_size(T.s).font_semibold().text_color(t.muted).child("Verlauf"))
    .child(div().flex_1())
    .child(div().text_size(T.xs).text_color(t.dim).child(`${ticket.comments?.length ?? 0} Kommentare`));
  if (rows.length === 0) {
    return [
      header,
      div().w_full().h(160).child(ui.emptyState(t, {
        title: "Noch kein Verlauf",
        text: "Kommentare, Wecken und Statuswechsel erscheinen hier.",
        compact: true,
      })),
    ];
  }
  return [header, ...rows.map((row, index) => historyRow(app, cx, t, row, index, cards))];
}

function commentBox(app, cx, t, ticket) {
  const text = app.commentInput.value();
  const pending = app.mentionOpen("comment") ? app.mentions : null;
  const preview = model.wakeSummary(text, app.agentNames(), "mensch", pending);

  const inputBox = v_flex()
    .w_full()
    .gap(S.xs)
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
        .when(!app.compact, (el) => el
          .child(ui.keyHint(t, "⌘⏎"))
          .child(div().flex_1())
          .child(ui.hint(t, "„@name“ weckt. „@mensch“ landet im Posteingang.")))
        .when(app.compact, (el) => el.child(div().flex_1())),
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
    onPick: (value) => {
      app.menu = null;
      if (options.find((option) => option.key === value)?.drop) app.openDropModal(cx, ticket);
      else app.setStatus(value, cx);
    },
  }));
}

function assigneeField(app, cx, t, ticket) {
  const options = app.ticketAgents(ticket).map((agent) => ({
    value: agent.name,
    label: agent.name,
    detail: model.roleLabel(agent.role),
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
  return ui.field(t, "Blockiert durch", v_flex().w_full().gap(S.s)
    .when(blocked.length === 0, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Keine Blockaden")))
    .children(blocked.map((id) => h_flex()
      .id(`fabric-blocker-${id}`)
      .w_full()
      .h(24)
      .px(S.s)
      .gap(S.s)
      .items_center()
      .rounded(ui.RADIUS.s)
      .bg(t.blocked + ui.ALPHA.faint)
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
  return ui.field(t, "Unter-Tickets", v_flex().w_full().gap(S.s)
    .child(h_flex().w_full().gap(S.s).items_center()
      .child(div().text_size(T.xs).text_color(t.dim).child(`${progress.closed}/${progress.total} erledigt`))
      .child(div().flex_1())
      .when(progress.open > 0, (el) => el.child(ui.chip(t, `${progress.open} offen`, t.working))))
    .children(children.map((child) => h_flex()
      .id(`fabric-child-${child.id}`)
      .w_full()
      .h(24)
      .px(S.s)
      .gap(S.s)
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
      .child(h_flex().w_full().gap(S.s).items_center()
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
  return ui.field(t, "Urteil", v_flex().w_full().gap(S.xs)
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

function sessionCost(ticket, session, raw) {
  const rows = Array.isArray(ticket?.cost?.sessions) ? ticket.cost.sessions : [];
  const byName = session.name ? rows.find((row) => row.name && row.name === session.name) : null;
  if (byName) return byName;
  if (!Number.isFinite(raw?.started_at)) return null;
  return rows.find((row) => row.agent === (session.agent || null) && row.started_at === raw.started_at) ?? null;
}

function sessionsField(app, cx, t, ticket) {
  const sources = (ticket.sessions ?? []).filter(Boolean);
  const chips = model.sessionChips(ticket.sessions, terminals(), agents(), ticket.id);
  return ui.field(t, "Sessions", v_flex().w_full().gap(S.s)
    .when(chips.length === 0, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Keine Session")))
    .when(chips.length > 0, (el) => el.child(h_flex().w_full().gap(S.xs).flex_wrap()
      .children(chips.map((session, index) => {
        const row = sessionCost(ticket, session, sources[index]);
        const cost = row ? ` · ${model.formatCost(row.cost)}` : "";
        return ui.chip(t,
          `${session.agent || "Agent"} · ${session.word}${cost}`,
          ui.sessionColor(t, session.color),
          `fabric-session-${ticket.id}-${session.terminal || session.name || index}`,
          {
            tooltip: row ? `${session.tooltip} · ${model.formatCost(row.cost)}` : session.tooltip,
            onClick: session.ended ? null : (cx) => run("terminal.peek", { terminal: session.terminal }),
          });
      }))))
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
      v_flex().w_full().gap(S.s).p(S.s).rounded(ui.RADIUS.m).border_1().border_color(t.border).bg(t.raised)
        .child(ui.dropdown(t, {
          id: "fabric-wake-name",
          value: app.wakeName,
          placeholder: "Agent",
          options: app.ticketAgents(ticket).map((agent) => ({
            value: agent.name, label: agent.name, detail: model.roleLabel(agent.role), selected: agent.name === app.wakeName,
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

function costRow(t, label, value) {
  return h_flex().w_full().min_h(20).gap(S.s).items_center()
    .child(div().text_size(T.xs).text_color(t.dim).child(label))
    .child(div().flex_1())
    .child(div().text_size(T.xs).text_color(t.foreground).child(value));
}

function costField(t, ticket) {
  const cost = model.ticketCost(ticket);
  const rows = Array.isArray(ticket.cost?.sessions) ? ticket.cost.sessions : [];
  const limit = Number.isFinite(ticket.max_cost) ? model.formatCost(ticket.max_cost) : "—";
  return ui.field(t, "Kosten", v_flex().w_full().gap(S.xs)
    .when(rows.length === 0, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Keine Kosten erfasst")))
    .children(rows.map((row, index) => h_flex().w_full().min_h(20).gap(S.xs).items_center()
      .child(div().text_size(T.xs).text_color(t.muted).truncate()
        .child(`${row.agent || "Agent"} · ${row.name || `Session ${index + 1}`}`))
      .when(Boolean(row.source), (el) => el.child(ui.chip(t, row.source, t.dim)))
      .child(div().flex_1())
      .child(div().text_size(T.xs).text_color(t.foreground).child(model.formatCost(row.cost)))))
    .child(costRow(t, "Summe", `${model.formatCost(cost.total)} · heute ${model.formatCost(cost.today)}`))
    .child(costRow(t, "Limit", limit)));
}

function waitsField(t, ticket) {
  const stages = Array.isArray(ticket.waits?.stages) ? ticket.waits.stages : [];
  return ui.field(t, "Liegezeiten", v_flex().w_full().gap(S.xs)
    .when(stages.length === 0, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("—")))
    .children(stages.map((stage) => h_flex().w_full().min_h(20).gap(S.xs).items_center()
      .child(div().text_size(T.xs).text_color(t.muted).child(stage.label))
      .when(Boolean(stage.open), (el) => el.child(ui.chip(t, "offen", t.working)))
      .child(div().flex_1())
      .child(div().text_size(T.xs).text_color(t.dim).child(model.formatDuration(stage.ms)))))
    .child(costRow(t, "Gesamt", model.formatDuration(ticket.waits?.total_ms))), { hint: "Verweildauer je Stufe (Liegezeit)" });
}

function properties(app, cx, t, ticket, { compact = false } = {}) {
  const problem = app.errorFor("status") || app.errorFor("assign") || app.errorFor("repo")
    || app.errorFor("base") || app.errorFor("link");
  const fields = [
    statusField(app, cx, t, ticket),
    assigneeField(app, cx, t, ticket),
    repoField(app, cx, t, ticket),
    ui.field(t, "Basis", ui.input(t, app.baseInput)),
    readonlyValue(app, cx, t, "Branch", ticket.branch),
    readonlyValue(app, cx, t, "Worktree", ticket.worktree),
    blockerField(app, cx, t, ticket),
  ];
  if (ticket.parent) fields.push(parentField(app, cx, t, ticket));
  if (model.childrenOf(app.tickets, ticket.id).length > 0) fields.push(childrenField(app, cx, t, ticket));
  fields.push(div().w_full().h(1).bg(t.border));
  fields.push(checksField(app, cx, t, ticket));
  fields.push(verdictField(app, cx, t, ticket));
  fields.push(sessionsField(app, cx, t, ticket));
  fields.push(costField(t, ticket));
  fields.push(waitsField(t, ticket));
  fields.push(div().w_full().h(1).bg(t.border));
  fields.push(h_flex().w_full().gap(S.s).items_center()
    .child(div().text_size(T.xs).text_color(t.dim).child(`Angelegt von ${ticket.created_by ?? "—"}`))
    .child(div().flex_1())
    .child(div().text_size(T.xs).text_color(t.dim)
      .child(model.relativeTime(ticket.created_at)).tooltip(model.absoluteTime(ticket.created_at))));
  fields.push(h_flex().w_full().gap(S.s).items_center()
    .child(div().text_size(T.xs).text_color(t.dim).child("Aktualisiert"))
    .child(div().flex_1())
    .child(div().text_size(T.xs).text_color(t.dim)
      .child(model.relativeTime(ticket.updated_at)).tooltip(model.absoluteTime(ticket.updated_at))));
  if (problem) fields.push(ui.notice(t, problem.text, problem.level));

  if (compact) {
    const embedded = fields.map((field) => div().w_full().px(S.l).py(S.xs).child(field));
    app.propsEndIndex = model.propertiesEndIndex(app.historyLastIndex, embedded.length, true);
    return embedded;
  }
  app.propsEndIndex = model.propertiesEndIndex(0, fields.length, false);
  return v_flex()
    .flex_none()
    .w(ui.SIZE.inspector)
    .min_w(ui.SIZE.inspector)
    .h_full()
    .border_l(1)
    .border_color(t.border)
    .child(
      v_flex()
        .flex_1()
        .min_h(0)
        .w_full()
        .p(S.l)
        .gap(S.m)
        .overflow_y_scrollbar()
        .track_scroll(app.propsScroll)
        .children(fields),
    );
}

function actionBar(app, cx, t, ticket) {
  const actions = model.actionBar(ticket, app.tickets, app.changes, app.changesSeenHead);
  const error = ["accept", "accept-pr", "reject", "drop", "verify", "wake", "status", "dispatch", "formulate"]
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
    const error = app.ticketError;
    return v_flex()
      .size_full()
      .min_h(0)
      .child(ui.header(t, model.pageWord("ticket"), [
        ui.button(t, {
          id: "fabric-ticket-back-empty",
          label: "Zurück",
          icon: "chevron-left",
          small: true,
          tooltip: "Zurück zur Liste (Esc)",
          onClick: (cx) => app.navigate("tickets", {}, cx),
        }),
      ], { iconName: "tickets", compact: app.compact }))
      .when(Boolean(error), (el) => el.child(ui.notice(t, error)))
      .child(ui.emptyState(t, {
        title: error ? "Ticket nicht lesbar" : "Ticket wird geladen …",
        text: error
          ? "Wähle ein anderes Ticket oder lade die Liste neu."
          : "Beschreibung, Verlauf und Eigenschaften erscheinen gleich.",
        compact: app.compact,
        action: error
          ? ui.button(t, {
            id: "fabric-ticket-error-back",
            label: "Zurück zur Liste",
            icon: "chevron-left",
            onClick: (cx) => app.navigate("tickets", {}, cx),
          })
          : null,
      }));
  }
  const headBlock = ticketHeader(app, cx, t, ticket);
  const titleBar = titleBlock(app, cx, t, ticket);
  const cards = model.ticketCards(ticket, app.events ?? []);
  const decisions = decisionsSection(app, cx, t, cards);
  if (app.compact) {
    return v_flex()
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .child(headBlock)
      .child(titleBar)
      .child(
        v_flex()
          .id("fabric-ticket-scroll")
          .flex_1()
          .min_h(0)
          .w_full()
          .overflow_y_scrollbar()
          .track_scroll(app.historyScroll)
          .when(Boolean(decisions), (el) => el.child(decisions))
          .child(body(app, cx, t, ticket))
          .when(ticket.status === "review" && Boolean(ticket.branch), (el) =>
            el.child(changesSection(app, cx, t, ticket)))
          .children(history(app, cx, t, ticket, cards))
          .children(properties(app, cx, t, ticket, { compact: true })),
      )
      .child(commentBox(app, cx, t, ticket))
      .child(actionBar(app, cx, t, ticket));
  }
  return v_flex()
    .size_full()
    .min_h(0)
    .overflow_hidden()
    .child(headBlock)
    .child(titleBar)
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
                .when(Boolean(decisions), (el) => el.child(decisions))
                .child(body(app, cx, t, ticket))
                .when(ticket.status === "review" && Boolean(ticket.branch), (el) =>
                  el.child(changesSection(app, cx, t, ticket)))
                .children(history(app, cx, t, ticket, cards)),
            )
            .child(commentBox(app, cx, t, ticket)),
        )
        .child(properties(app, cx, t, ticket)),
    )
    .child(actionBar(app, cx, t, ticket));
}
