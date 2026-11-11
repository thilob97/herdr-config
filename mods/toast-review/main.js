// How notifications look. Anything can post one with notify({ title, body,
// level, icon, action }); replace this mod to restyle them all. Click to
// run its action (e.g. go to the agent) and dismiss it.
// toast-review: Herdr's "agent finished" toasts also get a Review button that
// opens the review window (mods/review) for that agent's changes.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, agents, panes, openOverlay } from "herdr";

// The agent a toast is about, when it finished: its action names the terminal
// (or its pane), and the agent is done now or the title says it finished.
function finishedAgent(p) {
  const args = p.action?.args ?? {};
  const terminal = args.terminal ?? (args.pane ? panes().find((x) => x.pane === args.pane)?.terminal : null);
  if (!terminal) return null;
  const a = agents().find((x) => x.address === terminal);
  return a?.status === "done" || /finish|fertig/i.test(p.title ?? "") ? terminal : null;
}

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

export default class Toast extends View {
  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const review = login ? null : finishedAgent(p);
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
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
      .when(Boolean(review), (el) => el.child(div().id("toast-review").flex_none().px(8).py(4).rounded(5).bg(t.raised)
        .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.selected))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          closeOverlay(p.overlay);
          openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680, props: { terminal: review } });
        })
        .child("Review")));
  }
}
