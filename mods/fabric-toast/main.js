// Fabric-Variante der Benachrichtigungen: wie der mitgelieferte Toast, aber
// Inbox-Einträge aus Fabric bekommen einen sichtbaren „Öffnen“-Knopf, der das
// Ticket im Fabric-Fenster zeigt. Alles andere bleibt beim alten Verhalten.

import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, run, theme, setShared } from "herdr";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

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
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(open)
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      )
      .when(Boolean(openTicket), (el) => el.child(
        div().id("fabric-toast-open").flex_none().px(8).py(4).rounded(4).bg(t.raised)
          .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); open(); })
          .child("Öffnen"),
      ));
  }
}
