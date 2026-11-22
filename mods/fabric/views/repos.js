// Repos: bekannte Checkouts, .fabric/verify.sh und .fabric/lessons.md pflegen.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LIST = 260;

function repoRow(app, cx, t, repo) {
  const active = app.repoDetail?.path === repo.path;
  return v_flex()
    .id(`fabric-repo-${repo.path}`)
    .w_full()
    .p(S.s)
    .gap(3)
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + "00")
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); app.selectRepo(repo.path, cx); })
    .child(
      h_flex().w_full().gap(5).items_center()
        .child(div().flex_none().text_color(active ? t.accent : t.dim).child(ui.icon("repo", 13)))
        .child(div().flex_1().min_w(0).truncate().text_size(T.s)
          .text_color(active ? t.foreground : t.muted).child(model.repoName(repo.path)))
        .when((repo.open_tickets ?? 0) > 0, (el) => el.child(ui.badge(t, repo.open_tickets, t.accent))),
    )
    .child(
      h_flex().w_full().gap(5).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.dim)
          .child(repo.branch || "kein Branch").tooltip(repo.path))
        .child(ui.chip(t, repo.verify_exists ? "verify" : "kein verify", repo.verify_exists ? t.done : t.dim,
          null, { tooltip: repo.verify_exists ? ".fabric/verify.sh vorhanden" : ".fabric/verify.sh fehlt" }))
        .when(repo.lessons_exists, (el) => el.child(ui.chip(t, "lessons", t.muted, null, { tooltip: ".fabric/lessons.md vorhanden" })))
        .when(repo.project_exists, (el) => el.child(ui.chip(t, "Steckbrief", t.muted, null, { tooltip: ".fabric/project.md vorhanden" }))),
    );
}

function list(app, cx, t) {
  const repos = app.repos ?? [];
  if (!repos.length) {
    return v_flex().w(LIST).min_w(LIST).h_full().border_r(1).border_color(t.border)
      .child(app.reposError ? ui.notice(t, app.reposError) : ui.emptyState(t, {
        title: "Keine Repos",
        text: "Repos kommen aus Tickets und aus den Ordnern der Spaces.",
      }));
  }
  return v_flex()
    .w(LIST)
    .min_w(LIST)
    .h_full()
    .border_r(1)
    .border_color(t.border)
    .child(div().px(S.m).py(S.s).text_size(T.xs).text_color(t.dim).child(`${repos.length} Repos`))
    .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.xs).gap(2)
      .children(repos.map((repo) => repoRow(app, cx, t, repo))));
}

function testOutput(app, cx, t) {
  if (!app.repoTest && !app.errorFor("repo-test") && !app.repoTestBusy) return null;
  return v_flex()
    .w_full()
    .gap(5)
    .p(S.s)
    .rounded(ui.RADIUS.m)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(div().text_size(T.xs).font_semibold().text_color(t.muted).child("Testlauf"))
        .when(app.repoTestBusy, (el) => el.child(ui.spinner(t, 12)))
        .when(Boolean(app.repoTest), (el) => el
          .child(ui.chip(t, `Exit ${app.repoTest.exit}`, app.repoTest.exit === 0 ? t.done : t.blocked))
          .child(ui.chip(t, "jetzt", t.dim))),
    )
    .when(Boolean(app.errorFor("repo-test")), (el) => el
      .child(ui.notice(t, app.errorFor("repo-test").text, app.errorFor("repo-test").level)))
    .when(Boolean(app.repoTest?.tail), (el) => el
      .child(div().w_full().max_h(180).overflow_y_scrollbar().p(S.s).rounded(ui.RADIUS.s)
        .bg(t.surface).text_size(T.xs).text_color(t.muted).whitespace_normal().child(app.repoTest.tail)));
}

function detail(app, cx, t) {
  if (app.repoError) {
    return v_flex().flex_1().min_w(0).child(ui.notice(t, app.repoError));
  }
  if (!app.repoDetail) {
    return v_flex().flex_1().min_w(0).child(ui.loading(t, "Repo wird geladen …"));
  }
  const repo = app.repoDetail;
  const tab = app.repoTab;
  const editor = tab === "verify" ? app.verifyEditor
    : tab === "project" ? app.projectEditor
      : app.lessonsEditor;
  const saved = tab === "verify" ? app.verifySaved
    : tab === "project" ? app.projectSaved
      : app.lessonsSaved;
  const dirty = editor ? model.isDirty(editor.value(), saved) : false;
  const missingVerify = !repo.verify?.exists;
  const missingProject = !repo.project?.exists;
  const activeMissing = (tab === "verify" && missingVerify && !app.verifyEditor)
    || (tab === "project" && missingProject && !app.projectEditor);
  const output = tab === "verify" ? testOutput(app, cx, t) : null;

  return v_flex()
    .flex_1()
    .min_w(0)
    .h_full()
    .min_h(0)
    .p(S.l)
    .gap(S.m)
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(v_flex().flex_1().min_w(0).gap(0)
          .child(h_flex().gap(6).items_center()
            .child(div().text_size(T.l).font_semibold().child(model.repoName(repo.path)))
            .child(ui.chip(t, repo.branch || "kein Branch", t.muted))
            .when(Boolean(app.repos?.find((row) => row.path === repo.path)?.open_tickets), (el) =>
              el.child(ui.chip(t, `${app.repos.find((row) => row.path === repo.path).open_tickets} offen`, t.accent))))
          .child(div().text_size(T.xs).text_color(t.dim).truncate().child(repo.path).tooltip(repo.path)))
        .child(ui.iconButton(t, {
          id: "fabric-repo-copy-path",
          icon: "copy",
          tooltip: "Pfad kopieren",
          onClick: (cx) => app.copyText(cx, repo.path, "Repo-Pfad kopiert."),
        })),
    )
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(ui.tabs(t, {
          id: "fabric-repo-tabs",
          value: tab,
          items: [
            { value: "verify", label: "Prüfskript" },
            { value: "lessons", label: "Lernnotizen" },
            { value: "project", label: "Steckbrief" },
          ],
          onPick: (value) => { app.repoTab = value; cx.notify(); },
        }))
        .when(dirty, (el) => el.child(ui.chip(t, "ungespeichert", t.working)))
        .child(div().flex_1())
        .when(tab === "verify", (el) => el.child(ui.button(t, {
          id: "fabric-repo-test",
          label: "Jetzt testen",
          icon: "play",
          small: true,
          busy: app.repoTestBusy,
          disabled: Boolean(app.busy) || app.repoTestBusy || missingVerify,
          reason: missingVerify ? "Prüfskript fehlt" : "",
          tooltip: "Prüfskript im Haupt-Checkout ausführen (bis 10 min)",
          onClick: (cx) => app.testRepo(cx),
        })))
        .child(ui.button(t, {
          id: "fabric-repo-save",
          label: "Speichern",
          icon: "save",
          primary: true,
          small: true,
          busy: app.busy === "repo-set",
          disabled: Boolean(app.busy) || !editor || !dirty,
          tooltip: "Speichern (⌘S)",
          onClick: (cx) => app.saveRepo(cx),
        }))
        .child(ui.button(t, {
          id: "fabric-repo-discard",
          label: "Verwerfen",
          icon: "undo",
          small: true,
          disabled: Boolean(app.busy) || !dirty,
          tooltip: "Änderungen verwerfen",
          onClick: (cx) => app.discardRepo(cx),
        })),
    )
    .when(Boolean(app.errorFor("repo-set") || app.errorFor("repo") || app.errorFor("verify") || app.errorFor("lessons")), (el) => {
      const problem = app.errorFor("repo-set") || app.errorFor("repo") || app.errorFor("verify") || app.errorFor("lessons");
      return el.child(ui.notice(t, problem.text, problem.level));
    })
    .when(tab === "verify", (el) => el.child(ui.hint(t, "Ausführbares sh-Skript im Haupt-Checkout. Exit 0 heißt grün.")))
    .when(tab === "lessons", (el) => el.child(ui.hint(t, "Gelerntes für dieses Repo, Markdown. Leer heißt: noch nichts notiert.")))
    .when(tab === "project", (el) => el.child(ui.hint(t,
      "Steckbrief des Projekts, Markdown: Ziele, Prioritäten, Definition of Done, Glossar, Stil und Entscheider. Er ist Prompt-Kontext für den Agenten; Speichern ruft fab repo set … project.")))
    .when(activeMissing, (el) => el.child(
      v_flex().w_full().gap(S.s).p(S.m).rounded(ui.RADIUS.m)
        .border_1().border_color(t.border).bg(t.raised)
        .child(div().text_size(T.s).text_color(t.foreground)
          .child(tab === "project" ? ".fabric/project.md fehlt" : ".fabric/verify.sh fehlt"))
        .child(ui.hint(t, tab === "project"
          ? "Eine Vorlage mit den üblichen Abschnitten einsetzen, anpassen und speichern."
          : "Eine Vorlage einsetzen, anpassen und speichern. Sie wird ausführbar geschrieben."))
        .child(h_flex().gap(S.s)
          .child(ui.button(t, {
            id: tab === "project" ? "fabric-repo-create-project" : "fabric-repo-create-verify",
            label: "Fehlt – anlegen",
            icon: "plus",
            primary: true,
            tooltip: "Vorlage einsetzen",
            onClick: (cx) => (tab === "project" ? app.createProject(cx) : app.createVerify(cx)),
          })))),
    )
    .when(!activeMissing, (el) => el
      .child(editor ? ui.editor(t, editor, { fill: true }) : ui.loading(t, "Datei wird geladen …")))
    .when(Boolean(output), (el) => el.child(output));
}

export function renderRepos(app, cx, t) {
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, "Repos", [
      div().text_size(T.xs).text_color(t.dim).child(`${(app.repos ?? []).length} Repos`),
      ui.iconButton(t, {
        id: "fabric-repos-refresh",
        icon: "restart",
        tooltip: "Repos und Space-Ordner neu lesen",
        onClick: (cx) => app.loadRepos(cx),
      }),
    ], { iconName: "repo", subtitle: "Prüfskripte und Lernnotizen je Checkout" }))
    .when(Boolean(app.reposError), (el) => el.child(ui.notice(t, app.reposError)))
    .child(
      !app.repos
        ? ui.loading(t, "Repos werden geladen …")
        : h_flex().flex_1().min_h(0).items_stretch()
          .child(list(app, cx, t))
          .child(detail(app, cx, t)),
    );
}
