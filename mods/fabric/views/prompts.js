// Prompts: Liste links, Markdown-Editor rechts, Platzhalter-Legende bei der Präambel.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LIST = ui.SIZE.listPane;

function promptLabel(prompt) {
  if (prompt.kind === "orchestrator") return "Orchestrator";
  if (prompt.kind === "preamble") return "Präambel";
  return prompt.name;
}

function promptList(app, cx, t) {
  const prompts = app.promptList ?? [];
  if (!prompts.length) {
    return v_flex().w(LIST).min_w(LIST).h_full().border_r(1).border_color(t.border)
      .child(ui.emptyState(t, {
        title: "Keine Prompts",
        text: "fab liefert die Liste über `prompt list --json`.",
      }));
  }
  return v_flex()
    .w(LIST)
    .min_w(LIST)
    .h_full()
    .border_r(1)
    .border_color(t.border)
    .child(div().px(S.m).py(S.s).text_size(T.xs).text_color(t.dim).child("Prompt-Dateien"))
    .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.xs).gap(S.xs)
      .children(prompts.map((prompt) => {
        const active = app.promptName === prompt.name;
        return h_flex()
          .id(`fabric-prompt-${prompt.name}`)
          .w_full()
          .min_h(38)
          .px(S.s)
          .py(S.s)
          .gap(S.s)
          .items_center()
          .rounded(ui.RADIUS.s)
          .bg(active ? t.selected : t.surface + ui.ALPHA.clear)
          .cursor_pointer()
          .hover((style) => style.bg(active ? t.selected : t.hover))
          .on_click((_event, cx) => { cx.stop_propagation(); app.selectPrompt(prompt.name, cx); })
          .child(v_flex().flex_1().min_w(0).gap(S.xs)
            .child(div().text_size(T.s).text_color(active ? t.foreground : t.muted).truncate().child(promptLabel(prompt)))
            .child(div().text_size(T.xs).text_color(t.dim).truncate()
              .child(`${model.promptKindWord(prompt.kind)} · ${model.knowledgeSize(prompt.bytes)}`)))
          .when(Boolean(prompt.placeholders?.length), (el) => el.child(ui.badge(t, prompt.placeholders.length, t.dim)));
      })));
}

function legend(t) {
  return v_flex()
    .w_full()
    .gap(S.s)
    .p(S.m)
    .rounded(ui.RADIUS.m)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .child(div().text_size(T.xs).font_semibold().text_color(t.muted).child("Platzhalter der Präambel"))
    .child(h_flex().w_full().gap(S.s).flex_wrap().children(Object.entries(model.PLACEHOLDERS).map(([key, meaning]) =>
      h_flex().gap(S.xs).items_center()
        .child(ui.chip(t, `{${key}}`, t.accent))
        .child(div().text_size(T.xs).text_color(t.dim).child(meaning)))));
}

function editorPane(app, cx, t) {
  if (!app.promptName) {
    return ui.emptyState(t, {
      title: "Prompt wählen",
      text: "Links steht der Orchestrator, die Präambel und jeder Agent.",
    });
  }
  const dirty = app.promptEditor ? model.isDirty(app.promptEditor.value(), app.promptSaved) : false;
  const unknown = app.promptEditor
    ? model.unknownPlaceholders(app.promptEditor.value())
    : app.promptWarnings;
  const title = app.promptName === "orchestrator" ? "Orchestrator"
    : app.promptName === "preamble" ? "Präambel" : app.promptName;
  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
    .min_h(0)
    .child(ui.detailHeader(t, title, [
      ...(dirty ? [ui.chip(t, "ungespeichert", t.working)] : []),
      ui.button(t, {
        id: "fabric-prompt-save",
        label: "Speichern",
        icon: "save",
        primary: true,
        busy: app.busy === "prompt",
        disabled: Boolean(app.busy) || !dirty,
        tooltip: "Prompt speichern (⌘S)",
        onClick: (cx) => app.savePrompt(cx),
      }),
      ui.button(t, {
        id: "fabric-prompt-discard",
        label: "Verwerfen",
        icon: "undo",
        disabled: Boolean(app.busy) || !dirty,
        tooltip: "Änderungen verwerfen",
        onClick: (cx) => app.discardPrompt(cx),
      }),
    ], {
      subtitle: `${model.promptKindWord(app.promptKind ?? "agent")} · ${model.knowledgeSize(app.promptBytes)}`,
    }))
    .child(
      v_flex().flex_1().min_h(0).p(S.l).gap(S.m)
        .when(unknown.length > 0, (el) => el.child(ui.notice(t,
          `Unbekannte Platzhalter: ${unknown.map((name) => `{${name}}`).join(", ")}. fab speichert trotzdem und warnt.`, "warn")))
        .when(app.promptName === "preamble", (el) => el.child(legend(t)))
        .child(app.promptEditor
          ? ui.editor(t, app.promptEditor, { fill: true })
          : ui.loading(t, "Prompt wird geladen …"))
        .child(ui.hint(t, "Markdown. Speichern schreibt die Datei über `fab prompt set`.")),
    );
}

export function renderPrompts(app, cx, t) {
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("prompts"), [
      div().text_size(T.xs).text_color(t.dim).child(`${(app.promptList ?? []).length} Dateien`),
      ui.iconButton(t, {
        id: "fabric-prompts-refresh",
        icon: "restart",
        tooltip: "Liste neu lesen",
        onClick: (cx) => app.loadPrompts(cx),
      }),
    ], { iconName: "prompt", subtitle: "Orchestrator, Präambel und Rollenprompts" }))
    .when(Boolean(app.promptError), (el) => el.child(ui.notice(t, app.promptError)))
    .when(Boolean(app.errorFor("prompt")), (el) =>
      el.child(ui.notice(t, app.errorFor("prompt").text, app.errorFor("prompt").level)))
    .when(Boolean(app.loadError), (el) => el.child(ui.notice(t, app.loadError)))
    .child(
      !app.promptList
        ? (app.promptError
          ? ui.emptyState(t, { title: "Prompts nicht lesbar", text: "Details stehen oben." })
          : ui.loading(t, "Prompts werden geladen …"))
        : h_flex().flex_1().min_h(0).items_stretch()
          .child(promptList(app, cx, t))
          .child(editorPane(app, cx, t)),
    );
}
