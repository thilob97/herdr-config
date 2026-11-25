// Seite „Befehle“: jeder `fab`-Befehl als Formular mit Knopf. Der Katalog kommt
// aus `fab commands --json`, also direkt aus dem argparse-Baum; neue Befehle
// erscheinen hier ohne Änderung am Fenster.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const OUTPUT_LINES = 400;

function commandRow(app, t, entry) {
  const key = model.commandKey(entry);
  const active = app.commandSel === key;
  return h_flex()
    .id(`fabric-command-${key.replace(/\s+/g, "-")}`)
    .w_full()
    .px(S.s)
    .py(S.xs)
    .gap(S.s)
    .items_center()
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + ui.ALPHA.clear)
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); app.selectCommand(entry); })
    .child(div().flex_none().text_size(T.s).font_medium()
      .text_color(entry.danger ? t.blocked : t.foreground).child(entry.path.slice(1).join(" ") || entry.path[0]))
    .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.dim)
      .child(entry.help || "").tooltip(entry.help || ""));
}

function listPane(app, t) {
  const groups = model.commandGroups(app.commandCatalog, app.commandSearch.value());
  return v_flex()
    .w(ui.SIZE.listPane)
    .min_w(ui.SIZE.listPane)
    .h_full()
    .min_h(0)
    .border_r(1)
    .border_color(t.border)
    .child(div().flex_none().p(S.s).child(ui.input(t, app.commandSearch, {})))
    .child(
      v_flex().flex_1().min_h(0).overflow_y_scrollbar().px(S.s).pb(S.m).gap(S.s)
        .when(!groups.length, (el) => el.child(div().p(S.s).text_size(T.xs).text_color(t.dim)
          .child(app.commandCatalog ? "Kein Befehl passt." : "Befehle werden geladen …")))
        .children(groups.map((group) => v_flex().flex_none().w_full().gap(2)
          // Überschrift nur für Befehle mit Aktionen (fab team add …).
          .when(group.entries.some((entry) => entry.path.length > 1), (el) => el.child(
            div().px(S.s).pt(S.xs).text_size(T.xs).font_semibold().text_color(t.muted)
              .child(`fab ${group.name}`)))
          .children(group.entries.map((entry) => commandRow(app, t, entry))))),
    );
}

function argControl(app, t, entry, arg) {
  const key = model.commandKey(entry);
  if (arg.kind === "flag") {
    return ui.checkbox(t, {
      id: `fabric-cmd-${key.replace(/\s+/g, "-")}-${arg.dest}`,
      checked: Boolean(app.commandFlags[key]?.[arg.dest]),
      label: arg.flag,
      onChange: (on) => app.setCommandFlag(entry, arg.dest, on),
    });
  }
  if (arg.choices && arg.choices.length <= 8) {
    const current = app.commandChoices[key]?.[arg.dest] ?? "";
    return ui.tabs(t, {
      id: `fabric-cmd-${key.replace(/\s+/g, "-")}-${arg.dest}`,
      value: current,
      items: [
        ...(arg.required ? [] : [{ value: "", label: "–" }]),
        ...arg.choices.map((choice) => ({ value: choice, label: choice })),
      ],
      onPick: (value) => app.setCommandChoice(entry, arg.dest, value),
    });
  }
  return ui.input(t, app.commandInputs[key][arg.dest], {});
}

function argRow(app, t, entry, arg) {
  const name = arg.kind === "positional" ? arg.metavar : arg.kind === "flag" ? "Schalter" : `${arg.flag} ${arg.metavar}`;
  const hint = [
    arg.required ? "Pflicht" : arg.group ? (arg.group_required ? "eins aus der Gruppe" : "höchstens eins") : "optional",
    arg.multiple ? "mehrere mit Leerzeichen" : "",
    arg.help,
  ].filter(Boolean).join(" · ");
  return h_flex()
    .flex_none()
    .w_full()
    .gap(S.m)
    .items_start()
    .child(v_flex().flex_none().w(200).gap(2)
      .child(div().text_size(T.s).font_medium().text_color(t.foreground).child(name))
      .child(div().text_size(T.xs).text_color(t.dim).whitespace_normal().child(hint)))
    .child(div().flex_1().min_w(0).child(argControl(app, t, entry, arg)));
}

function outputPanel(app, t) {
  const result = app.commandResult;
  if (!result) return null;
  const lines = [
    ...String(result.stdout ?? "").split("\n").map((text) => ({ stream: "stdout", text })),
    ...String(result.stderr ?? "").split("\n").map((text) => ({ stream: "stderr", text })),
  ].filter((line, index, all) => line.text !== "" || index < all.length - 1);
  const shown = lines.slice(-OUTPUT_LINES);
  return v_flex()
    .flex_none()
    .w_full()
    .gap(S.s)
    .child(ui.sectionTitle(t, "Ausgabe", [
      ui.chip(t, result.code === 0 ? "Exit 0" : `Exit ${result.code}`, result.code === 0 ? t.done : t.blocked),
    ], `fab ${result.argv.join(" ")}`))
    .child(v_flex().w_full().p(S.s).gap(1).rounded(ui.RADIUS.m).bg(t.chrome)
      .when(!shown.length, (el) => el.child(div().text_size(T.xs).text_color(t.dim).child("Keine Ausgabe.")))
      .children(shown.map((line, index) => div().id(`fabric-cmd-out-${index}`).w_full().font_family("monospace")
        .text_size(T.xs).whitespace_normal()
        .text_color(line.stream === "stderr" ? t.blocked : t.muted)
        .child(line.text === "" ? " " : line.text))));
}

function detailPane(app, cx, t) {
  const entry = app.selectedCommand();
  if (!entry) {
    return div().flex_1().min_w(0).child(ui.emptyState(t, {
      title: "Befehl wählen",
      text: "Links stehen alle fab-Befehle. Jeder lässt sich hier mit seinen Argumenten ausführen.",
    }));
  }
  const key = model.commandKey(entry);
  const built = model.commandArgv(entry, app.commandValues(entry));
  const confirming = app.commandConfirm === key;
  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
    .min_h(0)
    .child(ui.detailHeader(t, `fab ${key}`, [
      ...(entry.danger ? [ui.chip(t, "folgenreich", t.blocked)] : []),
      ui.button(t, {
        id: "fabric-command-run",
        label: confirming ? "Wirklich ausführen" : "Ausführen",
        icon: "play",
        primary: !entry.danger,
        danger: entry.danger,
        small: true,
        busy: app.busy === "command",
        disabled: Boolean(app.busy) || !built.argv,
        reason: built.missing.length ? `Fehlt: ${built.missing.join(", ")}` : "",
        onClick: (clickCx) => clickCx.spawn(async () => { await app.runCommand(entry); }),
      }),
    ], { subtitle: entry.help }))
    .child(
      v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.l).gap(S.m)
        .when(!entry.args.length, (el) => el.child(div().text_size(T.s).text_color(t.dim)
          .child("Dieser Befehl hat keine Argumente.")))
        .children(entry.args.map((arg) => argRow(app, t, entry, arg)))
        .child(div().flex_none().w_full().p(S.s).rounded(ui.RADIUS.m).bg(t.chrome)
          .font_family("monospace").text_size(T.xs).whitespace_normal()
          .text_color(built.argv ? t.foreground : t.dim)
          .child(built.argv ? `fab ${built.argv.join(" ")}` : `Fehlt: ${built.missing.join(", ")}`))
        .when(Boolean(app.commandResult && app.commandResult.key === key), (el) => el.child(outputPanel(app, t))),
    );
}

export function renderCommandsPage(app, cx, t) {
  const count = app.commandCatalog?.length ?? 0;
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("commands"), [
      div().text_size(T.xs).text_color(t.dim).child(`${count} Befehle`),
      ui.iconButton(t, {
        id: "fabric-commands-reload",
        icon: "restart",
        tooltip: "Befehle neu laden",
        onClick: (cx) => cx.spawn(async () => { await app.loadCommands(true); }),
      }),
    ], { iconName: "terminal", subtitle: "Jeder fab-Befehl mit seinen Argumenten", compact: app.compact }))
    .when(Boolean(app.commandCatalogError), (el) => el.child(ui.notice(t, app.commandCatalogError)))
    .child(h_flex().flex_1().min_h(0).items_stretch()
      .child(listPane(app, t))
      .child(detailPane(app, cx, t)));
}
