// Vorlagen: Liste links, Markdown-Editor rechts, Hinweis auf {satz}.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LIST = 250;

function templateList(app, cx, t) {
  const rows = model.sortTemplates(app.templateList ?? []);
  if (!rows.length) {
    return v_flex().w(LIST).min_w(LIST).h_full().border_r(1).border_color(t.border)
      .child(app.templateError ? ui.notice(t, app.templateError) : ui.emptyState(t, {
        title: "Keine Vorlagen",
        text: "fab liefert die Liste über `template list --json`.",
      }));
  }
  return v_flex()
    .w(LIST)
    .min_w(LIST)
    .h_full()
    .border_r(1)
    .border_color(t.border)
    .child(div().px(S.m).py(S.s).text_size(T.xs).text_color(t.dim).child("Vorlagen"))
    .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.xs).gap(2)
      .children(rows.map((row) => {
        const active = app.templateName === row.name;
        return h_flex()
          .id(`fabric-template-${row.name}`)
          .w_full()
          .min_h(38)
          .px(S.s)
          .py(5)
          .gap(S.s)
          .items_center()
          .rounded(ui.RADIUS.s)
          .bg(active ? t.selected : t.surface + "00")
          .cursor_pointer()
          .hover((style) => style.bg(active ? t.selected : t.hover))
          .on_click((_event, cx) => { cx.stop_propagation(); app.selectTemplate(row.name, cx); })
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(div().text_size(T.s).text_color(active ? t.foreground : t.muted).truncate()
              .child(model.templateLabel(row.name)))
            .child(div().text_size(T.xs).text_color(t.dim).truncate()
              .child(`${row.bytes ?? 0} B`)));
      })));
}

function editorPane(app, cx, t) {
  if (!app.templateName) {
    return ui.emptyState(t, {
      title: "Vorlage wählen",
      text: "Links stehen Bug, Feature, Refactor und Chore.",
    });
  }
  const dirty = app.templateEditor ? model.isDirty(app.templateEditor.value(), app.templateSaved) : false;
  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
    .min_h(0)
    .p(S.l)
    .gap(S.m)
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(div().text_size(T.l).font_semibold().child(model.templateLabel(app.templateName)))
        .child(ui.chip(t, "Vorlage", t.muted))
        .child(div().text_size(T.xs).text_color(t.dim).child(`${app.templateBytes} Bytes`))
        .when(dirty, (el) => el.child(ui.chip(t, "ungespeichert", t.working)))
        .child(div().flex_1())
        .child(ui.button(t, {
          id: "fabric-template-save",
          label: "Speichern",
          icon: "save",
          primary: true,
          busy: app.busy === "template",
          disabled: Boolean(app.busy) || !dirty,
          tooltip: "Vorlage speichern (⌘S)",
          onClick: (cx) => app.saveTemplate(cx),
        }))
        .child(ui.button(t, {
          id: "fabric-template-discard",
          label: "Verwerfen",
          icon: "undo",
          disabled: Boolean(app.busy) || !dirty,
          tooltip: "Änderungen verwerfen",
          onClick: (cx) => app.discardTemplate(cx),
        })),
    )
    .when(Boolean(app.templateError), (el) => el.child(ui.notice(t, app.templateError)))
    .when(Boolean(app.errorFor("template")), (el) =>
      el.child(ui.notice(t, app.errorFor("template").text, app.errorFor("template").level)))
    .child(app.templateEditor
      ? ui.editor(t, app.templateEditor, { fill: true })
      : ui.loading(t, "Vorlage wird geladen …"))
    .child(ui.hint(t,
      "Markdown. `{satz}` wird beim Anlegen durch den Satz des Tickets ersetzt; Speichern schreibt die Datei über `fab template set`."));
}

export function renderTemplates(app, cx, t) {
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, "Vorlagen", [
      div().text_size(T.xs).text_color(t.dim).child(`${(app.templateList ?? []).length} Dateien`),
      ui.iconButton(t, {
        id: "fabric-templates-refresh",
        icon: "restart",
        tooltip: "Liste neu lesen",
        onClick: (cx) => app.loadTemplates(cx),
      }),
    ], { iconName: "prompt", subtitle: "Markdown-Gerüste für neue Tickets" }))
    .when(Boolean(app.loadError), (el) => el.child(ui.notice(t, app.loadError)))
    .child(
      !app.templateList
        ? ui.loading(t, "Vorlagen werden geladen …")
        : h_flex().flex_1().min_h(0).items_stretch()
          .child(templateList(app, cx, t))
          .child(editorPane(app, cx, t)),
    );
}
