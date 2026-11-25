// Schmale Leiste neben der Tab-Leiste: Panels und Fabric-Fenster sichtbar schalten.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run } from "herdr";
import * as ui from "../ui.js";
import * as model from "../model.js";

const S = ui.SPACE;

function state() {
  return model.panelState(layout());
}

function toggle(child) {
  for (const command of model.panelToggle(layout(), child)) run(command.name, command.args);
}

export function renderSwitcher(app, cx, t) {
  const current = state();
  return h_flex()
    .size_full()
    .pl(S.s)
    .pr(S.xs)
    .gap(S.xs)
    .items_center()
    .justify_end()
    .bg(t.chrome)
    .border_l(1)
    .border_color(t.border)
    .child(ui.iconButton(t, {
      id: "fabric-switch-tickets",
      icon: "tickets",
      tooltip: "Panel Tickets (⌘⇧1)",
      active: current.shown && current.active === "fabric-tickets",
      onClick: (cx) => { toggle("fabric-tickets"); cx.notify(); },
    }))
    .child(ui.iconButton(t, {
      id: "fabric-switch-timeline",
      icon: "clock",
      tooltip: "Panel Zeitverlauf (⌘⇧2)",
      active: current.shown && current.active === "fabric-timeline",
      onClick: (cx) => { toggle("fabric-timeline"); cx.notify(); },
    }))
    .child(div().w(1).h(18).bg(t.border))
    .child(ui.iconButton(t, {
      id: "fabric-switch-window",
      icon: "fabric",
      tooltip: "Fabric öffnen (⌘⇧F)",
      onClick: (cx) => app.toggleWindow(cx),
    }));
}
