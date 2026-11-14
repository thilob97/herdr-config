// How notifications look. Anything can post one with notify({ title, body,
// level, icon, action }); replace this mod to restyle them all. Click to
// run its action (e.g. go to the agent) and dismiss it.
// toast-review: Herdr's "agent finished" toasts also get a Review button that
// opens the review window (mods/review) for that agent's changes.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, panes, openOverlay } from "herdr";
import * as ui from "./ui.js";
import { T_S, T_M } from "./ui.js";

// The agent a toast is about: its action names the terminal (or its pane).
function agentOf(p) {
  const args = p.action?.args ?? {};
  return args.terminal ?? (args.pane ? panes().find((x) => x.pane === args.pane)?.terminal : null) ?? null;
}

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

export default class Toast extends View {
  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const address = login ? null : agentOf(p);
    const who = address ? ui.identity(address) : null;
    // German and with the identity the person knows (B3): the core's title names the
    // program, and its body the place.
    const waiting = Boolean(who) && (who.status === "blocked" || /needs you|braucht dich/i.test(p.title ?? ""));
    const finished = Boolean(who) && !waiting && (who.status === "done" || /finish|fertig/i.test(p.title ?? ""));
    const review = who && !login ? address : null;
    const title = login ? `${login[1]} braucht eine Anmeldung:`
      : waiting ? `${who.name} wartet auf dich`
      : finished ? `${who.name} ist fertig`
      : p.title ?? "";
    // The core places the toast at the window's bottom right, over the supply row.
    // The visible surface is an inner card that keeps 36 px (row 28 + 8) free (B4);
    // one row: who (identity chip), the title with its body under it, and Review as
    // an icon button (5.6), so the name in the title is not cut.
    return div().id("toast").size_full().flex().flex_col().justify_end().px(ui.GAP_M).pb(36)
      .child(h_flex().id("toast-card")
        .gap(ui.GAP_M)
        .items_center()
        .px(ui.GAP_M)
        .rounded(8)
        .bg(t.popover)
        .border_1()
        .border_color(t.border)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click(() => {
          if (p.action?.name) run(p.action.name, p.action.args ?? {});
          closeOverlay(p.overlay);
        })
        .when(Boolean(who), (el) => el.child(ui.identityChip(t, "toast-who", address)))
        .when(!who && Boolean(p.icon), (el) => el.child(image(p.icon).w(16).h(16).flex_none()))
        .when(!who && !p.icon, (el) => el.child(div().size(7).rounded_full().flex_none().bg(t[DOT[p.level] ?? "accent"])))
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(0)
            .overflow_hidden()
            .child(div().truncate().font_semibold().text_size(T_M).text_color(t.foreground).child(title))
            .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(T_S).text_color(t.muted).child(p.body ?? "")))
            .when(Boolean(login), (el) => el.child(div().truncate().tooltip(command).text_size(T_S).text_color(t.muted).child(command))))
        .when(Boolean(review), (el) => el.child(ui.iconButton(t, "toast-review", "mods/review/icon.svg",
          "Änderungen dieses Agents im Review-Fenster prüfen", () => {
            closeOverlay(p.overlay);
            openOverlay({ mod: "review", kind: "window", key: "review", width: 960, height: 680, props: { terminal: review } });
          }, { small: true })))
        .when(Boolean(login), (el) => el.child(ui.iconButton(t, "toast-login-copy", "mods/workspace-chrome/files.svg",
          this.copied ? "Kopiert" : "Befehl in die Zwischenablage kopieren", (cx) => {
            cx.write_to_clipboard(command);
            this.copied = true;
            cx.notify();
          }, { small: true }))));
  }
}
