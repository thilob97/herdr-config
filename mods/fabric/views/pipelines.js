// Pipelines: Läufe links, rechts Laufkopf, Schritte und die Ausgabe des
// geöffneten Schritts. Die Suche im Log bleibt über Schritte hinweg bestehen.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;

function stateGlyph(t, state) {
  const color = ui.pipelineColor(t, state);
  switch (state) {
    case "pass":
      return div().flex_none().text_color(color).child(ui.icon("check", 13));
    case "fail":
      return div().flex_none().text_color(color).child(ui.icon("close", 13));
    case "running":
      return div().flex_none().text_color(color).child(ui.icon("play", 11));
    case "skipped":
      return div().flex_none().text_color(color).child(ui.dot(t, color));
    default:
      return div().flex_none().text_color(color).child(ui.icon("clock", 12));
  }
}

function stateChip(t, state) {
  return ui.chip(t, model.pipelineStateWord(state), ui.pipelineColor(t, state));
}

function startedText(run) {
  const rel = model.relativeTime(run.started_at);
  return rel || "—";
}

function runRow(app, cx, t, run) {
  const state = model.pipelineState(run);
  const active = run.id === app.pipelineRunId;
  return v_flex()
    .id(`fabric-pipeline-run-${run.id}`)
    .w_full()
    .p(S.s)
    .gap(S.xs)
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + ui.ALPHA.clear)
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); app.selectPipelineRun(run.id, cx); })
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center()
        .child(stateGlyph(t, state))
        .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(`#${run.id}`))
        .child(stateChip(t, state))
        .child(div().flex_1())
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(startedText(run))
          .tooltip(model.absoluteTime(run.started_at) || "Unbekannter Start")),
    )
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center().pl(S.xl)
        .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.muted)
          .child(model.pipelineRunTarget(run)).tooltip(model.pipelineRunTarget(run)))
        .child(ui.chip(t, model.pipelineTriggerWord(run.trigger), t.dim))
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(model.pipelineRunDuration(run))),
    );
}

function leftPane(app, cx, t, rows) {
  const all = app.pipelineRuns;
  let body;
  if (!all) {
    body = div().px(S.m).pb(S.s).text_size(T.xs).text_color(t.dim)
      .child(app.pipelineRunsLoading ? "Läufe werden geladen …" : "Keine Läufe");
  } else if (rows.length === 0) {
    body = div().px(S.m).pb(S.s).text_size(T.xs).text_color(t.dim).whitespace_normal()
      .child(app.pipelineFilter ? `Keine Läufe für ${app.pipelineFilter}` : "Keine Läufe");
  } else {
    // Nur die jüngsten Läufe zeichnen (T-135): Alle 250+ Zeilen auf einmal
    // kosteten unter Last so viel, dass der Render-Schritt abbrach.
    const page = model.pipelineVisibleRuns(rows, app.pipelineLimit);
    body = v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.xs).gap(S.xs)
      .children(page.visible.map((run) => runRow(app, cx, t, run)))
      .when(page.hidden > 0, (el) => el.child(
        div().w_full().py(S.s).flex().justify_center().child(ui.button(t, {
          id: "fabric-pipeline-more",
          label: `Mehr laden (${page.next} von ${page.hidden})`,
          small: true,
          onClick: (cx) => { app.pipelineLimit = page.visible.length + page.next; cx.notify(); },
        })),
      ));
  }

  return v_flex()
    .w(ui.SIZE.listPane)
    .min_w(ui.SIZE.listPane)
    .h_full()
    .min_h(0)
    .border_r(1)
    .border_color(t.border)
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center().px(S.m).py(S.s)
        .child(div().flex_1().min_w(0).text_size(T.xs).text_color(t.dim)
          .child(`${rows.length} ${rows.length === 1 ? "Lauf" : "Läufe"}`))
        .when(Boolean(app.pipelineFilter), (el) => el
          .child(ui.chip(t, `Ticket ${app.pipelineFilter}`, t.accent, null,
            { tooltip: `Nur Läufe für Ticket ${app.pipelineFilter}` }))
          .child(ui.iconButton(t, {
            id: "fabric-pipeline-filter-clear",
            icon: "close",
            size: 18,
            iconSize: 10,
            tooltip: "Ticket-Filter entfernen",
            onClick: (cx) => app.navigate("pipelines", { run: app.pipelineRunId }, cx),
          }))),
    )
    .child(body);
}

function detailHead(app, cx, t, run) {
  const state = model.pipelineState(run);
  const ticket = run.ticket ? String(run.ticket) : "";
  const head = typeof run.head === "string" ? run.head : "";
  const branch = typeof run.branch === "string" ? run.branch : "";
  const subtitle = `Branch ${branch || "—"} · ${model.pipelineRunDuration(run)} · ${startedText(run)}`;
  return ui.detailHeader(t, `Lauf #${run.id}`, [
    stateChip(t, state),
    ui.chip(t, model.pipelineTriggerWord(run.trigger), t.muted),
    ...(ticket
      ? [ui.chip(t, ticket, t.accent, null, {
        tooltip: `Ticket ${ticket} öffnen`,
        onClick: (cx) => app.navigate("ticket", { id: ticket }, cx),
      })]
      : []),
    ...(!ticket && head ? [ui.chip(t, head.slice(0, 8), t.dim, null, { tooltip: head })] : []),
    ui.button(t, {
      id: "fabric-pipeline-rerun",
      label: "Erneut ausführen",
      icon: "restart",
      small: true,
      busy: app.busy === "pipeline-rerun",
      disabled: Boolean(app.busy),
      tooltip: "Diesen Lauf auf dem aktuellen HEAD wiederholen",
      onClick: (cx) => app.rerunPipeline(run.id, cx),
    }),
  ], { subtitle });
}

function logLine(t, line, index) {
  return h_flex()
    .id(`fabric-pipeline-log-${index}`)
    .flex_none()
    .w_full()
    .gap(S.s)
    .items_start()
    .child(div().flex_none().w(22).text_size(T.xs).text_color(t.dim).font_family("monospace")
      .child(line.stream === "stderr" ? "err" : "out"))
    .child(div().flex_1().min_w(0).whitespace_nowrap().font_family("monospace")
      .text_size(T.xs).text_color(line.stream === "stderr" ? t.blocked : t.muted)
      .child(line.text === "" ? " " : line.text));
}

function logPanel(app, cx, t, step) {
  const query = app.pipelineSearch.value();
  const lines = model.pipelineLogLines(step);
  const search = model.pipelineLogSearch(lines, query);
  const hasQuery = query.trim() !== "";
  const empty = search.lines.length === 0;
  // Feste Höhe je Zeilenzahl: ein scrollbarer Block ohne eigene Höhe fällt
  // sonst auf min_h zusammen und schneidet die letzte Zeile ab.
  const height = Math.min(280, Math.max(60, search.lines.length * 18 + 16));
  return v_flex()
    .w_full()
    .gap(S.s)
    .child(
      h_flex().w_full().min_w(0).gap(S.s).items_center()
        .child(div().flex_none().text_color(t.dim).child(ui.icon("search", 12)))
        .child(div().flex_1().min_w(0).child(
          ui.input(t, app.pipelineSearch, { focused: app.fieldFocused }),
        ))
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(!hasQuery ? "" : search.count === 0 ? "keine Treffer" : `${search.count} Treffer`))
        .when(hasQuery, (el) => el.child(ui.iconButton(t, {
          id: "fabric-pipeline-search-clear",
          icon: "close",
          size: 22,
          iconSize: 11,
          tooltip: "Suche leeren",
          onClick: (cx) => { app.pipelineSearch.set_value(""); cx.notify(); },
        }))),
    )
    .child(
      div()
        .w_full()
        .h(height)
        .overflow_y_scrollbar()
        .overflow_x_scrollbar()
        .rounded(ui.RADIUS.s)
        .border_1()
        .border_color(t.border)
        .bg(t.background)
        .p(S.s)
        .child(empty
          ? div().text_size(T.xs).text_color(t.dim)
            .child(search.total === 0 ? "Keine Ausgabe." : "Keine Treffer.")
          : v_flex().gap(S.xs).children(search.lines.map((line, index) => logLine(t, line, index)))),
    );
}

function stepCard(app, cx, t, step) {
  const position = Number(step.position);
  const open = Boolean(app.pipelineOpen[position]);
  const state = model.pipelineState(step);
  const exit = Number.isFinite(step.exit_code) ? step.exit_code : null;
  return v_flex()
    .id(`fabric-pipeline-step-${position}`)
    .w_full()
    .gap(0)
    .rounded(ui.RADIUS.m)
    .border_1()
    .border_color(open ? t.input : t.border)
    .bg(open ? t.raised : t.surface)
    .child(
      h_flex()
        .w_full()
        .min_w(0)
        .gap(S.s)
        .items_center()
        .px(S.s)
        .py(S.s)
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click((_event, cx) => {
          cx.stop_propagation();
          // Ein Accordion: die Log-Suche ist ein Feld und darf nicht in
          // mehreren offenen Schritten gleichzeitig gebunden werden.
          app.pipelineOpen = open ? {} : { [position]: true };
          cx.notify();
        })
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(open ? "▾" : "▸"))
        .child(div().flex_none().w(20).text_size(T.xs).text_color(t.dim)
          .child(String(position + 1)))
        .child(div().flex_1().min_w(0).truncate().text_size(T.s).text_color(t.foreground)
          .child(step.name || "Ohne Namen").tooltip(step.name || "Ohne Namen"))
        .child(stateChip(t, state))
        .when(exit != null, (el) => el.child(div().flex_none().text_size(T.xs)
          .text_color(exit === 0 ? t.dim : t.blocked).child(`Exit ${exit}`)))
        .child(div().flex_none().text_size(T.xs).text_color(t.dim)
          .child(model.pipelineDuration(step.duration_ms))),
    )
    .when(open, (el) => el.child(
      v_flex().w_full().gap(S.s).px(S.s).pb(S.s)
        .child(div().w_full().whitespace_nowrap().font_family("monospace")
          .text_size(T.xs).text_color(t.dim)
          .child(step.command || "—").tooltip(step.command || "Kein Befehl"))
        .child(logPanel(app, cx, t, step)),
    ));
}

function stepsSection(app, cx, t, steps) {
  const ordered = [...steps].sort((left, right) => Number(left.position) - Number(right.position));
  const summary = model.pipelineStepSummary(ordered);
  return v_flex()
    .w_full()
    .gap(S.s)
    .p(S.m)
    .child(ui.sectionTitle(t, "Schritte", [
      ui.chip(t, `${summary.pass} grün`, ui.pipelineColor(t, "pass")),
      ui.chip(t, `${summary.fail} rot`, ui.pipelineColor(t, "fail")),
      ui.chip(t, `${summary.skipped} übersprungen`, ui.pipelineColor(t, "skipped")),
    ], `${summary.total} Schritt${summary.total === 1 ? "" : "e"}`))
    .child(
      ordered.length === 0
        ? ui.hint(t, "Dieser Lauf hat keine Schritte.")
        : v_flex().w_full().gap(S.xs)
          .children(ordered.map((step) => stepCard(app, cx, t, step))),
    );
}

function detail(app, cx, t) {
  const loaded = app.pipelineDetail
    && app.pipelineDetail.run
    && app.pipelineDetail.run.id === app.pipelineRunId
    ? app.pipelineDetail
    : null;
  if (!loaded) {
    if (app.pipelineDetailLoading != null) return ui.loading(t, "Lauf wird geladen …");
    if (app.pipelineRuns?.length) {
      return ui.emptyState(t, {
        title: "Kein Lauf gewählt",
        text: "Wähle links einen Lauf für Schritte und Ausgabe.",
      });
    }
    return ui.emptyState(t, {
      title: "Noch kein Lauf",
      text: "Sobald `fab verify` einen Lauf anlegt, stehen hier Schritte, Log und Ausgabe.",
      action: ui.button(t, {
        id: "fabric-pipelines-empty-reload",
        label: "Läufe laden",
        icon: "restart",
        onClick: (cx) => app.reloadPipelines(cx),
      }),
    });
  }
  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
    .min_h(0)
    .child(detailHead(app, cx, t, loaded.run))
    .child(
      v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .child(stepsSection(app, cx, t, loaded.steps ?? [])),
    );
}

export function renderPipelinesPage(app, cx, t) {
  const all = app.pipelineRuns ?? [];
  const rows = model.pipelineRunsNewest(all)
    .filter((run) => !app.pipelineFilter || run.ticket === app.pipelineFilter);
  const running = all.filter((run) => model.pipelineState(run) === "running").length;
  const queued = all.filter((run) => model.pipelineState(run) === "queued").length;

  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("pipelines"), [
      ...(app.compact ? [] : [
        div().text_size(T.xs).text_color(t.dim)
          .child(`${all.length} Läufe${running ? ` · ${running} läuft` : ""}${queued ? ` · ${queued} in Warteschlange` : ""}`),
      ]),
      ui.iconButton(t, {
        id: "fabric-pipelines-refresh",
        icon: "restart",
        tooltip: "Läufe neu laden",
        disabled: Boolean(app.busy),
        onClick: (cx) => app.reloadPipelines(cx),
      }),
    ], { iconName: "terminal", subtitle: "Läufe, Schritte und Ausgabe", compact: app.compact }))
    .when(Boolean(app.pipelineRunsError), (el) => el.child(ui.notice(t, app.pipelineRunsError)))
    .when(Boolean(app.pipelineDetailError), (el) => el.child(ui.notice(t, app.pipelineDetailError)))
    .when(Boolean(app.errorFor("pipeline-rerun")), (el) => el.child(
      ui.notice(t, app.errorFor("pipeline-rerun").text, app.errorFor("pipeline-rerun").level),
    ))
    .child(
      h_flex()
        .flex_1()
        .min_h(0)
        .items_stretch()
        .child(leftPane(app, cx, t, rows))
        .child(detail(app, cx, t)),
    );
}
