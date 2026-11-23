// Repos: bekannte Checkouts, .fabric/verify.sh und .fabric/lessons.md pflegen.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as model from "../model.js";
import * as ui from "../ui.js";

const T = ui.FONT;
const S = ui.SPACE;
const LIST = ui.SIZE.listPane;

const KNOWLEDGE_KIND_WORDS = {
  markdown: "Markdown",
  pdf: "PDF",
  text: "Text",
  image: "Bild",
  bild: "Bild",
};

/** Dateityp im Wissensordner deutsch; unbekannte Schlüssel bleiben roh. */
function knowledgeKindWord(kind) {
  const raw = String(kind ?? "");
  return KNOWLEDGE_KIND_WORDS[raw] ?? raw;
}

function repoRow(app, cx, t, repo) {
  const active = app.repoDetail?.path === repo.path;
  return v_flex()
    .id(`fabric-repo-${repo.path}`)
    .w_full()
    .p(S.s)
    .gap(S.xs)
    .rounded(ui.RADIUS.s)
    .bg(active ? t.selected : t.surface + ui.ALPHA.clear)
    .cursor_pointer()
    .hover((style) => style.bg(active ? t.selected : t.hover))
    .on_click((_event, cx) => { cx.stop_propagation(); app.selectRepo(repo.path, cx); })
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(div().flex_none().text_color(active ? t.accent : t.dim).child(ui.icon("repo", 13)))
        .child(div().flex_1().min_w(0).truncate().text_size(T.s)
          .text_color(active ? t.foreground : t.muted).child(model.repoName(repo.path)))
        .when((repo.open_tickets ?? 0) > 0, (el) => el.child(ui.badge(t, repo.open_tickets, t.accent))),
    )
    .child(
      h_flex().w_full().gap(S.s).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(T.xs).text_color(t.dim)
          .child(repo.branch || "kein Branch").tooltip(repo.path))
        .child(ui.chip(t, repo.verify_exists ? "Prüfskript" : "kein Prüfskript", repo.verify_exists ? t.done : t.dim,
          null, { tooltip: repo.verify_exists ? ".fabric/verify.sh vorhanden" : ".fabric/verify.sh fehlt" }))
        .when(repo.lessons_exists, (el) => el.child(ui.chip(t, "Lernnotizen", t.muted, null, { tooltip: ".fabric/lessons.md vorhanden" })))
        .when(repo.project_exists, (el) => el.child(ui.chip(t, "Steckbrief", t.muted, null, { tooltip: ".fabric/project.md vorhanden" }))),
    );
}

function list(app, cx, t) {
  const repos = app.repos ?? [];
  if (!repos.length) {
    return v_flex().w(LIST).min_w(LIST).h_full().border_r(1).border_color(t.border)
      .child(ui.emptyState(t, {
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
    .child(div().px(S.m).py(S.s).text_size(T.xs).text_color(t.dim).child(`${repos.length} ${repos.length === 1 ? "Repo" : "Repos"}`))
    .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(S.xs).gap(S.xs)
      .children(repos.map((repo) => repoRow(app, cx, t, repo))));
}

function testOutput(app, cx, t) {
  if (!app.repoTest && !app.errorFor("repo-test") && !app.repoTestBusy) return null;
  return v_flex()
    .w_full()
    .gap(S.s)
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
          .child(ui.chip(t, `Exit ${app.repoTest.exit}`, app.repoTest.exit === 0 ? t.done : t.blocked))),
    )
    .when(Boolean(app.errorFor("repo-test")), (el) => el
      .child(ui.notice(t, app.errorFor("repo-test").text, app.errorFor("repo-test").level)))
    .when(Boolean(app.repoTest?.tail), (el) => el
      .child(div().w_full().max_h(180).overflow_y_scrollbar().p(S.s).rounded(ui.RADIUS.s)
        .bg(t.surface).text_size(T.xs).text_color(t.muted).whitespace_normal().child(app.repoTest.tail)));
}

function knowledgeRow(app, cx, t, file, index) {
  return h_flex()
    .id(`fabric-knowledge-${index}`)
    .w_full()
    .gap(S.s)
    .items_center()
    .p(S.xs)
    .rounded(ui.RADIUS.s)
    .hover((style) => style.bg(t.hover))
    .child(div().flex_none().text_color(t.muted).child(ui.icon("markdown", 13)))
    .child(div().flex_1().min_w(0).truncate().text_size(T.s).child(file.name).tooltip(file.name))
    .child(div().flex_none().text_size(T.xs).text_color(t.dim).child(model.knowledgeSize(file.size)))
    .child(ui.chip(t, knowledgeKindWord(file.kind), t.muted))
    .child(ui.iconButton(t, {
      id: `fabric-knowledge-rm-${index}`,
      icon: "trash",
      tooltip: `Eintrag ${file.name} entfernen`,
      onClick: (cx) => app.confirmKnowledgeRemove(file.name, cx),
    }));
}

function knowledgeSection(app, cx, t) {
  const files = app.repoDetail?.knowledge?.files ?? [];
  return v_flex()
    .w_full()
    .flex_1()
    .min_h(0)
    .gap(S.s)
    .on_drop((event, cx) => app.dropKnowledgeFiles(event.paths, cx))
    .child(
      files.length
        ? v_flex().w_full().flex_1().min_h(0).overflow_y_scrollbar().gap(S.xs)
          .children(files.map((file, index) => knowledgeRow(app, cx, t, file, index)))
        : div().w_full().flex_1().min_h(0).child(ui.emptyState(t, {
          title: "Noch keine Dateien im Wissensordner.",
          text: "Dateien hierher ziehen oder oben „Datei hinzufügen“. Höchstens 20 MB je Datei. Notiznamen ohne Pfadtrenner, nicht mit Punkt beginnend und ohne „..“.",
        })),
    );
}

function detailProblem(app) {
  return app.errorFor("repo-set") || app.errorFor("repo") || app.errorFor("verify") || app.errorFor("lessons")
    || app.errorFor("knowledge-add") || app.errorFor("knowledge-note") || app.errorFor("knowledge-rm");
}

function detail(app, cx, t) {
  if (!app.repoDetail) {
    if (app.repoError) {
      return ui.emptyState(t, { title: "Repo nicht lesbar", text: "Der Fehler steht oben." });
    }
    return ui.loading(t, "Repo wird geladen …");
  }
  const repo = app.repoDetail;
  const tab = app.repoTab;
  const editor = tab === "verify" ? app.verifyEditor
    : tab === "project" ? app.projectEditor
      : tab === "lessons" ? app.lessonsEditor
        : null;
  const saved = tab === "verify" ? app.verifySaved
    : tab === "project" ? app.projectSaved
      : tab === "lessons" ? app.lessonsSaved
        : "";
  const dirty = editor ? model.isDirty(editor.value(), saved) : false;
  const missingVerify = !repo.verify?.exists;
  const missingProject = !repo.project?.exists;
  const activeMissing = (tab === "verify" && missingVerify && !app.verifyEditor)
    || (tab === "project" && missingProject && !app.projectEditor);
  const output = tab === "verify" ? testOutput(app, cx, t) : null;
  const openTickets = app.repos?.find((row) => row.path === repo.path)?.open_tickets;
  const files = repo.knowledge?.files ?? [];

  return v_flex()
    .flex_1()
    .min_w(ui.SIZE.inspector)
    .h_full()
    .min_h(0)
    .child(ui.detailHeader(t, model.repoName(repo.path), [
      ui.chip(t, repo.branch || "kein Branch", t.muted),
      ...(openTickets ? [ui.chip(t, `${openTickets} offen`, t.accent)] : []),
      ui.iconButton(t, {
        id: "fabric-repo-copy-path",
        icon: "copy",
        tooltip: "Pfad kopieren",
        onClick: (cx) => app.copyText(cx, repo.path, "Repo-Pfad kopiert."),
      }),
    ], { subtitle: repo.path }))
    .child(
      v_flex().flex_1().min_h(0).p(S.l).gap(S.m)
        .child(
          h_flex().w_full().gap(S.s).items_center()
            .child(ui.tabs(t, {
              id: "fabric-repo-tabs",
              value: tab,
              items: [
                { value: "verify", label: "Prüfskript" },
                { value: "lessons", label: "Lernnotizen" },
                { value: "project", label: "Steckbrief" },
                { value: "wissen", label: "Wissen" },
              ],
              onPick: (value) => { app.repoTab = value; cx.notify(); },
            }))
            .when(dirty, (el) => el.child(ui.chip(t, "ungespeichert", t.working)))
            .child(div().flex_1())
            .when(tab === "wissen", (el) => el
              .child(ui.chip(t, `${files.length} ${files.length === 1 ? "Datei" : "Dateien"}`, t.muted))
              .child(ui.button(t, {
                id: "fabric-knowledge-add",
                label: "Datei hinzufügen",
                icon: "plus",
                small: true,
                busy: app.busy === "knowledge-add",
                disabled: Boolean(app.busy),
                tooltip: "Datei in den Wissensordner legen",
                onClick: (cx) => app.pickKnowledgeFile(cx),
              }))
              .child(ui.button(t, {
                id: "fabric-knowledge-note",
                label: "Notiz",
                icon: "edit",
                small: true,
                disabled: Boolean(app.busy),
                tooltip: "Notiz als Markdown anlegen",
                onClick: (cx) => app.openKnowledgeNoteModal(cx),
              })))
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
            .when(tab !== "wissen", (el) => el
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
              }))),
        )
        .when(tab === "verify", (el) => el.child(ui.hint(t, "Ausführbares sh-Skript im Haupt-Checkout. Exit 0 heißt grün.")))
        .when(tab === "lessons", (el) => el.child(ui.hint(t, "Gelerntes für dieses Repo, Markdown. Leer heißt: noch nichts notiert.")))
        .when(tab === "project", (el) => el.child(ui.hint(t,
          "Steckbrief des Projekts, Markdown: Ziele, Prioritäten, Definition of Done, Glossar, Stil und Entscheider. Er ist Prompt-Kontext für den Agenten; Speichern ruft fab repo set … project.")))
        .when(activeMissing, (el) => el.child(
          div().w_full().flex_1().min_h(0).child(ui.emptyState(t, {
            title: tab === "project" ? ".fabric/project.md fehlt" : ".fabric/verify.sh fehlt",
            text: tab === "project"
              ? "Eine Vorlage mit den üblichen Abschnitten einsetzen, anpassen und speichern."
              : "Eine Vorlage einsetzen, anpassen und speichern. Sie wird ausführbar geschrieben.",
            action: ui.button(t, {
              id: tab === "project" ? "fabric-repo-create-project" : "fabric-repo-create-verify",
              label: "Fehlt – anlegen",
              icon: "plus",
              primary: true,
              tooltip: "Vorlage einsetzen",
              onClick: (cx) => (tab === "project" ? app.createProject(cx) : app.createVerify(cx)),
            }),
          })),
        ))
        .when(tab === "wissen", (el) => el.child(knowledgeSection(app, cx, t)))
        .when(tab !== "wissen" && !activeMissing, (el) => el
          .child(editor ? ui.editor(t, editor, { fill: true }) : ui.loading(t, "Datei wird geladen …")))
        .when(Boolean(output), (el) => el.child(output)),
    );
}

export function renderRepos(app, cx, t) {
  const problem = detailProblem(app);
  return v_flex()
    .size_full()
    .min_h(0)
    .child(ui.header(t, "Repos", [
      div().text_size(T.xs).text_color(t.dim).child(`${(app.repos ?? []).length} ${(app.repos ?? []).length === 1 ? "Repo" : "Repos"}`),
      ui.iconButton(t, {
        id: "fabric-repos-refresh",
        icon: "restart",
        tooltip: "Repos und Space-Ordner neu lesen",
        onClick: (cx) => app.loadRepos(cx),
      }),
    ], { iconName: "repo", subtitle: "Prüfskripte und Lernnotizen je Checkout" }))
    .when(Boolean(app.reposError), (el) => el.child(ui.notice(t, app.reposError)))
    .when(Boolean(app.repoError), (el) => el.child(ui.notice(t, app.repoError)))
    .when(Boolean(problem), (el) => el.child(ui.notice(t, problem.text, problem.level)))
    .child(
      !app.repos
        ? (app.reposError
          ? ui.emptyState(t, { title: "Repos nicht lesbar", text: "Details stehen oben." })
          : ui.loading(t, "Repos werden geladen …"))
        : h_flex().flex_1().min_h(0).items_stretch()
          .child(list(app, cx, t))
          .child(detail(app, cx, t)),
    );
}
