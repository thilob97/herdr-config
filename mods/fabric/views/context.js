// Kontextvorschau: was der Agent für ein Ticket oder Team tatsächlich sieht.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const S = ui.SPACE;

export function renderContextPreview(app, cx, t) {
  const preview = app.contextPreview;
  if (!preview) return null;
  const shown = model.contextDisplay(preview.data);
  const subtitle = preview.kind === "team" ? `Team ${preview.ref}` : `Ticket ${preview.ref}`;
  const color = shown.over ? t.blocked : shown.clipped ? t.working : t.dim;
  const close = (cx) => app.closeContextPreview(cx);
  return ui.drawer(t, {
    title: "Was sieht der Agent?",
    subtitle,
    onClose: close,
    tooltip: "Drawer schließen (Esc)",
    width: 560,
    footer: [
      ui.button(t, {
        id: "fabric-context-close",
        label: "Schließen",
        tooltip: "Drawer schließen (Esc)",
        onClick: close,
      }),
    ],
  }, [
    preview.loading
      ? ui.loading(t, "Kontext wird geladen …")
      : preview.error
        ? ui.notice(t, preview.error)
        : v_flex()
          .w_full()
          .gap(S.m)
          .child(
            h_flex().w_full().gap(S.s).items_center()
              .child(ui.chip(t, shown.label, color, "fabric-context-label", {
                tooltip: shown.over
                  ? "Der Kontext ist länger als die Obergrenze und wird gekürzt."
                  : shown.clipped
                    ? "Der Kontext wurde an der Obergrenze gekürzt."
                    : "Zeichen im Kontext und Obergrenze der Rolle",
              }))
              .child(div().flex_1())
              .when(shown.limit > 0, (el) => el.child(
                div().flex_none().text_size(ui.FONT.xs).text_color(t.dim)
                  .child(`${Math.round(shown.ratio * 100)} %`),
              )),
          )
          .child(shown.empty
            ? ui.hint(t, "Noch kein Kontext — der Agent sieht für diesen Bezug nichts.")
            : ui.markdown("fabric-context-preview", shown.text)),
  ]);
}
