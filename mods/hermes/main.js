// Hermes: a chat with the Hermes agent (Nous Research) in a window at the
// top right. `hermes.toggle` (keys.json) opens it and, pressed again, closes it.
//
// Two roles, from props:
// - "host": an invisible full-width 0 px block in the layout. It receives
//   hermes.toggle, measures the window width (so the chat sits top right) and
//   opens/closes the window.
// - "titlebar": the window's drag bar with the close button. It marks the
//   window open in shared("hermes.open") while it exists, so the host knows
//   when it was closed some other way (close button, Hermes exiting).
//
// Hermes runs in one hidden core terminal named "hermes" (no Herdr space or
// tab). Closing the window keeps it running, so reopening shows the same
// session; it ends only when Hermes itself exits (then the window closes and
// the next toggle starts a new one).

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, hc, exec, terminals, openOverlay, closeOverlay, shared, setShared, theme, settings, notify, nextCommand, readTextFile, appHome } from "herdr";

const NAME = "hermes";
const WIDTH = 480, HEIGHT = 600;
const TOP = 78; // below the tab bar, level with the panes' top edge
const MARGIN = 12;
const BAR = 42;

const find = () => terminals().find((t) => t.name === NAME && t.state === "live") ?? null;

// Hermes in the user's login shell (PATH, API keys from the shell profile),
// in the home folder; the terminal ends when Hermes does.
async function start() {
  const sh = await exec("sh", ["-c", 'printf %s "${SHELL:-/bin/sh}"']);
  const shell = sh.stdout.trim() || "/bin/sh";
  // An early failure stays on screen (exit code, Enter closes) instead of
  // the window vanishing with the terminal.
  const script = 'cd ~ && "$(command -v hermes || echo "$HOME/.hermes/hermes-agent/hermes")"; c=$?; '
    + 'if [ $c -ne 0 ]; then printf "\\n[Hermes beendet mit Code %s. Enter schließt.]\\n" $c; read -r _; fi; exit $c';
  const r = await hc(["run", "--bg", "--json", "--no-parent", "--name", NAME, "--", shell, "-lic", script]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
  return JSON.parse(r.stdout).address;
}

export default class Hermes extends View {
  init(_props, cx) {
    this.role = props()?.role;
    if (this.role === "titlebar") { setShared("hermes.open", props().overlay); return; }
    if (this.role !== "host") return;
    this.width = null;
    this.overlay = null;
    cx.spawn(async () => {
      // Until the block has been measured: the window's last saved size.
      const saved = await readTextFile(`${appHome()}/window.json`).catch(() => null);
      try { this.width ??= JSON.parse(saved ?? "null")?.bounds?.[2] ?? null; } catch { /* keep null: centered */ }
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") await this.toggle();
      }
    });
  }

  async close() {
    if (this.role === "titlebar" && shared("hermes.open") === props().overlay) setShared("hermes.open", null);
  }

  isOpen() { return this.overlay !== null && shared("hermes.open") === this.overlay; }

  async toggle() {
    if (this.isOpen()) {
      closeOverlay(this.overlay);
      this.overlay = null;
      return;
    }
    let address = find()?.address;
    try {
      if (!address) address = await start();
    } catch (e) {
      notify({ title: "Hermes startet nicht", body: String(e?.message ?? e), level: "error" });
      return;
    }
    // `at` is in window pixels, WIDTH in layout units: the zoom scales the window,
    // so a 480-unit chat is 576 px wide at zoom 1.2 and must start that much earlier.
    const zoom = settings()?.zoom ?? 1;
    const x = this.width ? Math.max(0, this.width - WIDTH * zoom - MARGIN) : undefined;
    this.overlay = openOverlay({
      kind: "window", key: "hermes", width: WIDTH, height: HEIGHT,
      ...(x !== undefined ? { at: { x, y: TOP } } : {}),
      layout: {
        type: "column",
        children: [
          { type: "block", size: { px: BAR }, content: { mod: "hermes", props: { role: "titlebar" } } },
          { id: "hermes-terminal", type: "block", content: { terminal: address } },
        ],
      },
    });
    // The window can't be given the keyboard from here: pane.focus only
    // reaches tab panes and layout blocks, not overlay terminals. One click
    // into the chat focuses it.
  }

  render() {
    if (this.role === "titlebar") return this.titlebar();
    // The host: nothing to see, only its width.
    return div().id("hermes-host").size_full().on_size_change((size) => {
      if (size.width > 0 && size.width !== this.width) this.width = size.width;
    });
  }

  // Title row (5.6): h 42, px 14, the title at T_L; no icon, the close button as
  // an icon button with its shortcut in the tooltip.
  titlebar() {
    const t = theme();
    const overlay = props().overlay;
    return h_flex().id("hermes-bar").size_full().px(14).gap(8).items_center().bg(t.chrome)
      .border_b(1).border_color(t.border)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Hermes"))
      .child(div().flex_1())
      .child(div().id("hermes-close").size(22).flex().items_center().justify_center().rounded(4).text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Schließen (⌘⇧H)")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => closeOverlay(overlay))
        .child(svg("mods/pane/close.svg").size(12)));
  }
}
