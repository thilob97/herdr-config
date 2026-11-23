// Fabric-Variante der Benachrichtigungen: wie der mitgelieferte Toast, aber
// Inbox-Einträge aus Fabric bekommen einen sichtbaren „Öffnen“-Knopf, der das
// Ticket im Fabric-Fenster zeigt. Alles andere bleibt beim alten Verhalten.

import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, run, theme, setShared } from "herdr";

// Spiegel von mods/fabric/ui.js: Herdr erlaubt keine mod-übergreifenden Importe.
const FONT = { xs: 11, s: 12, m: 13 };
const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
const RADIUS = { s: 6, m: 8, l: 12 };
const SIZE = { buttonSmall: 24, icon: 18, dot: 8 };

const TONE = { error: "blocked", warning: "working", success: "done", info: "accent" };

export default class FabricToast extends View {
  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const action = p.action;
    const openTicket = action?.name === "fabric.open" ? action.args?.ticket : null;
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;

    const open = () => {
      if (openTicket) {
        setShared("fabric.openRequest", { at: Date.now(), route: { page: "ticket", id: openTicket } });
        run("fabric.open");
      } else if (action?.name) {
        run(action.name, action.args ?? {});
      }
      closeOverlay(p.overlay);
    };

    return h_flex()
      .id("toast")
      .size_full()
      .px(SPACE.l)
      .gap(SPACE.m)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(open)
      .child(p.icon ? image(p.icon).w(SIZE.icon).h(SIZE.icon).flex_none() : div().size(SIZE.dot).rounded(SIZE.dot / 2).flex_none().bg(t[TONE[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(FONT.m).text_color(t.foreground).child(login ? `${login[1]} braucht eine Anmeldung:` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(FONT.s).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(SPACE.s).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(FONT.s).text_color(t.muted).child(command))
            .child(h_flex().id("toast-login-copy").flex_none().h(SIZE.buttonSmall).px(SPACE.s).rounded(RADIUS.m)
              .items_center().justify_center().border_1().border_color(t.input).bg(t.raised)
              .text_size(FONT.s).text_color(t.foreground).font_medium()
              .cursor_pointer().hover(s => s.opacity(0.86))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Kopiert" : "Kopieren")))),
      )
      .when(Boolean(openTicket), (el) => el.child(
        h_flex().id("fabric-toast-open").flex_none().h(SIZE.buttonSmall).px(SPACE.s).rounded(RADIUS.m)
          .items_center().justify_center().border_1().border_color(t.input).bg(t.raised)
          .text_size(FONT.s).text_color(t.foreground).font_medium()
          .cursor_pointer().hover(s => s.opacity(0.86))
          .on_click((_e, cx) => { cx.stop_propagation(); open(); })
          .child("Öffnen"),
      ));
  }
}
