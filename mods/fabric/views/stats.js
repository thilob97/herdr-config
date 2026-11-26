// Statistik: Durchsatz, Kosten je Agent und Tag, Prüfungen, Prüfläufe und
// Liegezeiten über einen wählbaren Zeitraum. Daten aus `fab report --json`.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const CHART_H = 110;

function tile(t, { id, label, value, sub = "", color = null }) {
  return v_flex()
    .id(id)
    .flex_1()
    .min_w(130)
    .gap(2)
    .p(S.m)
    .rounded(ui.RADIUS.m)
    .bg(t.surface)
    .border_1()
    .border_color(t.border)
    .child(div().text_size(T.xs).text_color(t.dim).whitespace_nowrap().child(label))
    .child(div().text_size(T.l).font_semibold().text_color(color ?? t.foreground).whitespace_nowrap().child(value))
    // Leere Unterzeile hält alle Kacheln einer Reihe gleich hoch.
    .child(div().text_size(T.xs).text_color(t.dim).truncate().child(sub || "\u00a0").tooltip(sub || label));
}

function legend(t, items) {
  return h_flex().gap(S.m).flex_wrap().children(items.map((item) => h_flex().gap(4).items_center()
    .child(div().size(8).rounded(2).bg(item.color))
    .child(div().text_size(T.xs).text_color(t.dim).child(item.label))));
}

/** Säulen je Tag. Gestapelt: Segmente bilden eine Summe (Kosten je Agent).
 *  Gruppiert: unabhängige Größen nebeneinander (neu und fertig). */
function dayChart(t, { id, days, segments, format, grouped = false }) {
  const totals = days.map((day) => (grouped
    ? Math.max(0, ...segments(day).map((part) => part.value || 0))
    : segments(day).reduce((sum, part) => sum + (part.value || 0), 0)));
  const max = Math.max(0, ...totals);
  const step = model.reportLabelStep(days.length);
  return v_flex().w_full().gap(4)
    .child(h_flex().id(id).w_full().h(CHART_H).items_end().gap(2)
      .children(days.map((day, index) => {
        const parts = segments(day).filter((part) => part.value > 0);
        const tip = `${model.reportDayLabel(day.day)}: ${parts.length
          ? parts.map((part) => `${part.label} ${format(part.value)}`).join(" · ")
          : "nichts"}`;
        const column = grouped
          ? h_flex().items_end().gap(1).children(segments(day).map((part) => div()
            .flex_1()
            .min_w(0)
            .h(model.reportBar(part.value, max, CHART_H))
            .bg(part.color)))
          : v_flex().justify_end().children(parts.slice().reverse().map((part) => div()
            .w_full()
            .h(model.reportBar(part.value, max, CHART_H))
            .bg(part.color)));
        return column
          .id(`${id}-${index}`)
          .flex_1()
          .min_w(0)
          .h_full()
          .rounded(2)
          .hover((s) => s.bg(t.hover))
          .tooltip(tip);
      })))
    .child(h_flex().w_full().gap(2)
      .children(days.map((day, index) => div().flex_1().min_w(0).text_size(T.xs).text_color(t.dim)
        .whitespace_nowrap()
        .child(index % step === 0 ? model.reportDayLabel(day.day) : ""))))
    .child(div().text_size(T.xs).text_color(t.dim).child(`Höchster Tag: ${format(max)}`));
}

/** Waagerechter Balken mit Beschriftung links und Wert rechts. */
function barRow(t, { id, label, fraction, value, color, onClick = null, tooltip = null }) {
  const row = h_flex()
    .id(id)
    .w_full()
    .min_h(24)
    .gap(S.s)
    .items_center()
    .child(div().w(150).flex_none().truncate().text_size(T.xs).text_color(t.foreground)
      .child(label).tooltip(tooltip ?? label))
    .child(h_flex().flex_1().min_w(60).h(8).rounded(4).bg(t.raised)
      .child(div().h_full().rounded(4).bg(color)
        .w(`${Math.max(0, Math.min(100, Math.round(fraction * 100)))}%`)))
    .child(div().w(150).flex_none().text_size(T.xs).text_color(t.dim).whitespace_nowrap()
      .text_right().child(value));
  return onClick
    ? row.cursor_pointer().rounded(ui.RADIUS.s).hover((s) => s.bg(t.hover))
      .on_click((_event, cx) => { cx.stop_propagation(); onClick(cx); })
    : row;
}

function empty(t, text) {
  return div().text_size(T.xs).text_color(t.dim).child(text);
}

function section(t, id, title, hint, children) {
  return ui.card(t, [ui.sectionTitle(t, title, [], hint), ...children], { id, padding: S.m, gap: S.s });
}

function throughputCard(app, t, report) {
  const days = report.throughput ?? [];
  return section(t, "fabric-stats-throughput", "Durchsatz", "Neue und fertige Tickets je Tag", [
    legend(t, [{ label: "neu", color: t.muted }, { label: "fertig", color: t.done }, { label: "verworfen", color: t.blocked }]),
    dayChart(t, {
      id: "fabric-stats-throughput-chart",
      days,
      grouped: true,
      format: (value) => String(value),
      segments: (day) => [
        { label: "neu", value: day.created, color: t.muted },
        { label: "fertig", value: day.done, color: t.done },
        { label: "verworfen", value: day.dropped, color: t.blocked },
      ],
    }),
  ]);
}

function costCards(app, t, report) {
  const blueprints = app.roster?.blueprints ?? [];
  const agents = report.costs?.agents ?? [];
  const colorOf = (name) => ui.roleColor(t, model.reportAgentColor(name, blueprints));
  const max = Math.max(0, ...agents.map((agent) => agent.range));
  const top = report.costs?.top_tickets ?? [];
  const topMax = Math.max(0, ...top.map((row) => row.cost));
  return [
    section(t, "fabric-stats-cost-days", "Kosten je Tag", "Nach Agent gestapelt; Session zählt am Tag ihres Starts", [
      legend(t, agents.filter((agent) => agent.range > 0).map((agent) => ({ label: agent.name, color: colorOf(agent.name) }))),
      dayChart(t, {
        id: "fabric-stats-cost-chart",
        days: report.costs?.per_day ?? [],
        format: model.formatCost,
        segments: (day) => agents.map((agent) => ({
          label: agent.name,
          value: day.agents?.[agent.name] ?? 0,
          color: colorOf(agent.name),
        })),
      }),
    ]),
    h_flex().w_full().gap(S.m).items_start().flex_wrap()
      .child(div().flex_1().min_w(320).child(section(t, "fabric-stats-cost-agents", "Kosten je Agent", "Zeitraum; in Klammern alles", [
        ...(agents.some((agent) => agent.range > 0)
          ? agents.filter((agent) => agent.range > 0 || agent.total > 0).map((agent) => barRow(t, {
            id: `fabric-stats-agent-${agent.name}`,
            label: agent.name,
            fraction: max > 0 ? agent.range / max : 0,
            color: colorOf(agent.name),
            value: `${model.formatCost(agent.range)} · ${model.reportPercent(agent.share, 1)} (${model.formatCost(agent.total)})`,
            tooltip: `${agent.name}: ${agent.sessions} Sessions im Zeitraum, ${agent.tickets} Tickets insgesamt`,
          }))
          : [empty(t, "Keine Kosten im Zeitraum.")]),
      ])))
      .child(div().flex_1().min_w(320).child(section(t, "fabric-stats-cost-top", "Teuerste Tickets", "Zeitraum; Klick öffnet das Ticket", [
        ...(top.length
          ? top.map((row) => barRow(t, {
            id: `fabric-stats-top-${row.id}`,
            label: `${row.id} ${row.title}`,
            fraction: topMax > 0 ? row.cost / topMax : 0,
            color: t.working,
            value: model.formatCost(row.cost),
            onClick: (cx) => app.navigate("ticket", { id: row.id }, cx),
          }))
          : [empty(t, "Keine Kosten im Zeitraum.")]),
      ]))),
  ];
}

function reviewCard(app, t, report) {
  const reviews = report.reviews ?? {};
  const pass = reviews.verdicts?.pass ?? 0;
  const fail = reviews.verdicts?.fail ?? 0;
  const top = reviews.top_rounds ?? [];
  const topMax = Math.max(0, ...top.map((row) => row.verdicts));
  return section(t, "fabric-stats-reviews", "Prüfungen", "Urteile der Prüferin im Zeitraum", [
    h_flex().w_full().gap(S.s).flex_wrap()
      .child(tile(t, { id: "fabric-stats-review-pass", label: "pass", value: String(pass), color: t.done }))
      .child(tile(t, { id: "fabric-stats-review-fail", label: "fail", value: String(fail), color: fail ? t.blocked : null }))
      .child(tile(t, { id: "fabric-stats-review-rounds", label: "Urteile je Ticket", value: String(reviews.rounds_avg ?? 0) }))
      .child(tile(t, {
        id: "fabric-stats-review-stale",
        label: "verworfen",
        value: String(reviews.stale_verdicts ?? 0),
        sub: "Urteil ungültig: main bewegt",
      }))
      .child(tile(t, { id: "fabric-stats-review-rejects", label: "zurückgewiesen", value: String(reviews.rejects ?? 0) })),
    div().text_size(T.xs).text_color(t.dim).child("Meiste Prüfrunden"),
    ...(top.length
      ? top.map((row) => barRow(t, {
        id: `fabric-stats-rounds-${row.id}`,
        label: `${row.id} ${row.title}`,
        fraction: topMax > 0 ? row.verdicts / topMax : 0,
        color: t.accent,
        value: `${row.verdicts} Urteil${row.verdicts === 1 ? "" : "e"}`,
        onClick: (cx) => app.navigate("ticket", { id: row.id }, cx),
      }))
      : [empty(t, "Keine Urteile im Zeitraum.")]),
  ]);
}

function pipelineCard(app, t, report) {
  const pipes = report.pipelines ?? {};
  const counts = pipes.counts ?? {};
  const reasons = pipes.abort_reasons ?? [];
  const reasonMax = Math.max(0, ...reasons.map((row) => row.count));
  const finished = (counts.pass ?? 0) + (counts.fail ?? 0) + (counts.aborted ?? 0);
  return section(t, "fabric-stats-pipelines", "Prüfläufe", "Läufe nach Start im Zeitraum", [
    h_flex().w_full().gap(S.s).flex_wrap()
      .child(tile(t, { id: "fabric-stats-runs-pass", label: "grün", value: String(counts.pass ?? 0), color: t.done }))
      .child(tile(t, { id: "fabric-stats-runs-fail", label: "rot", value: String(counts.fail ?? 0), color: counts.fail ? t.blocked : null }))
      .child(tile(t, { id: "fabric-stats-runs-aborted", label: "abgebrochen", value: String(counts.aborted ?? 0) }))
      .child(tile(t, { id: "fabric-stats-runs-rate", label: "Anteil grün", value: model.reportPercent(counts.pass ?? 0, finished) }))
      .child(tile(t, { id: "fabric-stats-runs-duration", label: "Dauer grün (Median)", value: model.formatDuration(pipes.duration_median_ms ?? 0) })),
    legend(t, [{ label: "grün", color: t.done }, { label: "rot", color: t.blocked }, { label: "abgebrochen", color: t.dim }]),
    dayChart(t, {
      id: "fabric-stats-runs-chart",
      days: pipes.per_day ?? [],
      format: (value) => String(value),
      segments: (day) => [
        { label: "grün", value: day.pass, color: t.done },
        { label: "rot", value: day.fail, color: t.blocked },
        { label: "abgebrochen", value: day.aborted, color: t.dim },
      ],
    }),
    ...(reasons.length
      ? [div().text_size(T.xs).text_color(t.dim).child("Abbruchgründe"),
        ...reasons.map((row, index) => barRow(t, {
          id: `fabric-stats-abort-${index}`,
          label: row.reason,
          fraction: reasonMax > 0 ? row.count / reasonMax : 0,
          color: t.dim,
          value: String(row.count),
        }))]
      : []),
  ]);
}

function waitCard(app, t, report) {
  const waits = report.waits ?? {};
  const stages = waits.stages ?? [];
  const max = Math.max(0, ...stages.map((stage) => stage.avg_ms));
  const color = (key) => (key === "doing" ? t.working : key === "review" ? t.accent : t.blocked);
  return section(t, "fabric-stats-waits", "Liegezeiten",
    `Ø je Stufe über ${waits.tickets ?? 0} im Zeitraum fertige Tickets; gesamt Ø ${model.formatDuration(waits.avg_total_ms ?? 0)}`,
    stages.length
      ? stages.map((stage) => barRow(t, {
        id: `fabric-stats-wait-${stage.key}`,
        label: stage.label,
        fraction: max > 0 ? stage.avg_ms / max : 0,
        color: color(stage.key),
        value: model.formatDuration(stage.avg_ms),
      }))
      : [empty(t, "Keine fertigen Tickets im Zeitraum.")]);
}

function overview(app, t, report) {
  const over = report.overview ?? {};
  const days = report.days ?? app.reportDays;
  return h_flex().w_full().gap(S.s).flex_wrap()
    .child(tile(t, {
      id: "fabric-stats-kpi-cost",
      label: `Kosten ${days} Tage`,
      value: model.formatCost(over.cost_range ?? 0),
      sub: `gesamt ${model.formatCost(over.cost_total ?? 0)}`,
    }))
    .child(tile(t, { id: "fabric-stats-kpi-done", label: "Fertig", value: String(over.done ?? 0), sub: `${over.created ?? 0} neu` }))
    .child(tile(t, {
      id: "fabric-stats-kpi-cycle",
      label: "Durchlauf (Median)",
      value: model.formatDuration(over.cycle_median_ms ?? 0),
      sub: `Ø ${model.formatDuration(over.cycle_avg_ms ?? 0)}, angelegt bis fertig`,
    }))
    .child(tile(t, {
      id: "fabric-stats-kpi-cost-ticket",
      label: "Kosten je fertigem Ticket",
      value: over.done ? model.formatCost((over.cost_range ?? 0) / over.done) : "—",
    }))
    .child(tile(t, {
      id: "fabric-stats-kpi-rate",
      label: "Läufe grün",
      value: over.pass_rate == null ? "—" : model.reportPercent(over.pass_rate, 1),
    }));
}

/** Vergleich der Teams in der Fabric-Sicht; Klick wechselt in die Team-Sicht. */
function teamsCard(app, t, report) {
  const rows = report.teams ?? [];
  if (rows.length < 2) return null;
  const max = Math.max(0, ...rows.map((row) => row.cost_range));
  return section(t, "fabric-stats-teams", "Teams", "Zeitraum; Klick zeigt die Statistik des Teams", rows.map((row) => barRow(t, {
    id: `fabric-stats-team-${row.name || "ohne"}`,
    label: row.name || "ohne Team",
    fraction: max > 0 ? row.cost_range / max : 0,
    color: t.accent,
    value: `${model.formatCost(row.cost_range)} · ${row.done} fertig · ${row.open} offen`,
    tooltip: `${row.name || "ohne Team"}: ${row.created} neu, ${row.done} fertig, ${row.open} offen`,
    onClick: row.name ? () => app.setReportScope({ team: row.name }) : null,
  })));
}

export function renderStatsPage(app, cx, t) {
  const report = app.report;
  const teams = (app.roster?.teams ?? []).map((team) => team.name).filter(Boolean);
  const scope = app.reportTeam ? `Team ${app.reportTeam}` : "ganze Fabric";
  const stamp = app.reportAt ? `Stand ${model.relativeTime(app.reportAt)}` : "";
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, model.pageWord("stats"), [
      ...(app.reportLoading ? [ui.spinner(t)] : stamp ? [div().text_size(T.xs).text_color(t.dim).child(stamp)] : []),
      ui.tabs(t, {
        id: "fabric-stats-range",
        items: model.REPORT_RANGES.map((days) => ({ value: days, label: `${days} Tage` })),
        value: app.reportDays,
        onPick: (days) => app.setReportScope({ days }),
      }),
      ui.iconButton(t, {
        id: "fabric-stats-reload",
        icon: "restart",
        tooltip: "Neu berechnen (fab report)",
        onClick: (cx) => cx.spawn(async () => { await app.loadReport(); }),
      }),
    ], { iconName: "chart", subtitle: `Durchsatz, Kosten, Prüfungen, Läufe und Liegezeiten · ${scope}`, compact: app.compact }))
    .when(teams.length > 0, (el) => el.child(h_flex().w_full().px(S.l).pt(S.s).gap(S.s).items_center()
      .child(div().text_size(T.xs).text_color(t.dim).child("Sicht"))
      .child(ui.tabs(t, {
        id: "fabric-stats-scope",
        items: [{ value: "", label: "Fabric" }, ...teams.map((name) => ({ value: name, label: name }))],
        value: app.reportTeam,
        onPick: (team) => app.setReportScope({ team }),
      }))))
    .when(Boolean(app.reportError), (el) => el.child(ui.notice(t, app.reportError)))
    .child(!report
      ? ui.loading(t, "Statistik wird berechnet …")
      : v_flex().id("fabric-stats-scroll").flex_1().min_h(0).overflow_y_scrollbar().p(S.l).gap(S.m)
        .child(v_flex().w_full().max_w(1100).gap(S.m)
          .child(overview(app, t, report))
          .children([teamsCard(app, t, report)].filter(Boolean))
          .children(costCards(app, t, report))
          .child(throughputCard(app, t, report))
          .child(reviewCard(app, t, report))
          .child(waitCard(app, t, report))
          .child(pipelineCard(app, t, report))));
}
