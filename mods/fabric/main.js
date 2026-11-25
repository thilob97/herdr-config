// Fabric: Board, Tickets, Team, Prompts, Repos und Einstellungen in einem Mod.
// Die Ansicht kommt aus props().view; geschrieben wird nur über fabric/fab.

import { View, div } from "gpui-kit";
import { InputState, TextareaState, EditorState, ScrollHandle, VirtualListScrollHandle, TextView, h_flex, v_flex, Popup } from "gpui-base";
import {
  appHome, checking, closeOverlay, exec, focused, knownAgents, layout, nextCommand, notify,
  openOverlay, pickFolder, playSound, props, readTextFile, run, setShared, shared, spaces, terminals,
  watchFolder, writeTextFile,
} from "herdr";
import * as ui from "./ui.js";
import * as model from "./model.js";
import { renderBoard } from "./views/board.js";
import { renderTicket } from "./views/ticket.js";
import { renderTicketsPage } from "./views/tickets-page.js";
import { renderTeam, renderTeamPromptDrawer } from "./views/team.js";
import { renderPrompts } from "./views/prompts.js";
import { renderTemplates } from "./views/templates.js";
import { renderRepos } from "./views/repos.js";
import { renderWorkflowsPage } from "./views/workflows.js";
import { renderPipelinesPage } from "./views/pipelines.js";
import { renderSettings } from "./views/settings.js";
import { renderTicketsPanel } from "./views/tickets.js";
import { renderInboxPanel as renderPosteingangPanel, renderInboxPage } from "./views/inbox.js";
import { renderCommandsPage } from "./views/commands.js";
import { renderTimelinePanel } from "./views/timeline.js";
import { renderSwitcher } from "./views/switcher.js";
import { renderDialogs, renderBlueprintDrawer } from "./views/dialogs.js";
import { renderContextPreview } from "./views/context.js";

const VIEWS = ["inbox", "commands", "board", "tickets", "ticket", "team", "workflows", "pipelines", "prompts", "templates", "repos", "settings"];
const NAV = [
  { page: "inbox", icon: "inbox" },
  { page: "board", icon: "board" },
  { page: "tickets", icon: "tickets" },
  { page: "workflows", icon: "play" },
  { page: "pipelines", icon: "terminal" },
  { page: "team", icon: "team" },
  { page: "prompts", icon: "prompt" },
  { page: "templates", icon: "prompt" },
  { page: "repos", icon: "repo" },
  { page: "commands", icon: "terminal" },
  { page: "settings", icon: "settings" },
];

// Die Tasten der Erwähnungsliste gehören der Anwendung, nicht dem Fenster:
// einmal binden, beide Wurzeln hängen ihre on_action-Handler daran.
let mentionKeysBound = false;

function message(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeIndex(raw) {
  return {
    generated_at: raw?.generated_at ?? null,
    tickets: Array.isArray(raw?.tickets) ? raw.tickets : [],
    inbox: Array.isArray(raw?.inbox) ? raw.inbox : [],
    roster: Array.isArray(raw?.roster) ? raw.roster : [],
    teams: Array.isArray(raw?.teams) ? raw.teams : [],
    events: Array.isArray(raw?.events) ? raw.events : [],
    alarm: raw?.alarm ?? null,
    paused: raw?.paused === true,
  };
}

function normalizeRoute(raw) {
  const page = VIEWS.includes(raw?.page) ? raw.page : "board";
  return { ...(raw ?? {}), page };
}

export default class Fabric extends View {
  init(_props, cx) {
    this.view = props()?.view ?? "tickets";
    this.isApp = this.view === "app";
    this.timelineAll = false;
    this.overlayId = props()?.overlay ?? null;
    this.dir = `${appHome()}/data/fabric`;
    this.fab = `${appHome()}/fabric/fab`;

    this.index = null;
    this.ready = false;
    this.loadError = null;
    this.ticket = null;
    this.ticketError = null;
    this.openId = null;
    this.flash = null;
    this.errors = {};
    this.busy = "";
    this.menu = null;
    this.modal = null;
    this.imageOpen = null;
    this.newOpen = false;
    this.inboxFilter = "all";
    this.autopilotOpen = false;
    this.autopilotSource = null;
    this.autopilotText = null;
    this.autopilotLogText = null;
    this.closed = false;
    this.watch = null;
    this.refreshing = false;
    this.pending = false;
    this.tickRunning = false;
    this.fieldFocused = false;
    this.cursorId = null;
    this.assigneeFilter = "all";
    this.repoFilter = "all";
    this.showDropped = false;
    this.tableSort = { key: "updated_at", dir: "desc" };
    this.bodyEditing = false;
    this.bodyFor = null;
    this.bodyEditor = null;
    this.bodySaved = "";
    this.titleEdit = null;
    this.titleSaved = "";
    this.mentions = { field: null, suggestions: [], index: 0, start: 0, end: 0 };
    this.focusedField = null;
    this.mentionClock = null;
    this.wakeOpen = false;
    this.wakeName = "";
    this.wakeText = null;
    this.checksOpen = false;
    this.changes = null;
    this.changesFor = null;
    this.changesAt = 0;
    this.changesLoading = false;
    this.changesOpen = false;
    this.changesSeenHead = "";
    this.changesFile = null;
    this.changesDiff = "";
    this.changesDiffFor = "";
    this.changesError = null;
    this.changesPending = null;
    this.changesLoadingFile = false;
    this.historyScroll = ScrollHandle.new();
    this.historyLastIndex = 1;
    this.propsScroll = ScrollHandle.new();
    this.propsEndIndex = 0;
    // Ein Dropdown ist zugleich offen; ein gemeinsamer Handle reicht.
    this.dropdownScroll = VirtualListScrollHandle.new();
    this.needsHistoryScroll = false;
    this.compact = false;
    this.windowWidth = 0;
    this.baseInput = InputState.new({ placeholder: "Basis-Branch, z. B. main" });
    this.baseInput.on("change", (_event, cx) => cx.notify());
    this.baseInput.on("submit", (_event, cx) => this.setBase(this.baseInput.value(), cx));
    this.track(this.baseInput);
    this.orchestratorGlobal = null;
    this.roster = null;
    this.rosterError = null;
    this.rosterAt = 0;
    this.promptList = null;
    this.promptError = null;
    this.promptName = null;
    this.promptKind = null;
    this.promptBytes = 0;
    this.promptEditor = null;
    this.promptSaved = "";
    this.promptWarnings = [];
    this.promptsAt = 0;
    this.templateList = null;
    this.templateError = null;
    this.templateName = null;
    this.templateBytes = 0;
    this.templateEditor = null;
    this.templateSaved = "";
    this.templatesAt = 0;
    this.repos = null;
    this.reposError = null;
    this.reposAt = 0;
    this.repoDetail = null;
    this.repoError = null;
    this.repoTab = "verify";
    this.knowledgeNote = null;
    this.verifyEditor = null;
    this.lessonsEditor = null;
    this.projectEditor = null;
    this.verifySaved = "";
    this.lessonsSaved = "";
    this.projectSaved = "";
    this.repoTest = null;
    this.repoTestBusy = false;
    this.contextPreview = null;
    this.contextPreviewId = 0;
    this.contextPreviewSeen = 0;
    this.flows = null;
    this.flowRuns = null;
    this.flowName = null;
    this.flowRunId = null;
    this.flowNode = null;
    this.flowError = null;
    this.flowRunsError = null;
    this.flowAt = 0;
    this.flowRunsAt = 0;
    this.flowMode = null;
    this.flowBuilder = null;
    this.flowPendingName = null;
    this.pipelineRuns = null;
    this.pipelineRunsError = null;
    this.pipelineRunsAt = 0;
    this.pipelineRunsLoading = false;
    this.pipelineRunId = null;
    this.pipelineDetail = null;
    this.pipelineDetailError = null;
    this.pipelineDetailLoading = null;
    this.pipelineOpen = {};
    this.pipelineFilter = null;
    this.pipelineLimit = model.PIPELINE_PAGE;
    this.commandCatalog = null;
    this.commandCatalogError = null;
    this.commandSel = null;
    this.commandInputs = {};
    this.commandFlags = {};
    this.commandChoices = {};
    this.commandResult = null;
    this.commandConfirm = null;
    this.commandSearch = InputState.new({ placeholder: "Befehl suchen…" });
    this.commandSearch.on("change", (_event, cx) => { this.notifyNow(); });
    this.track(this.commandSearch);
    this.inboxDiff = {};
    this.inboxRejectFor = null;
    this.inboxReject = InputState.new({ placeholder: "Feedback für den Umsetzer…" });
    this.inboxReject.on("change", (_event, cx) => { this.notifyNow(); });
    this.track(this.inboxReject);
    this.pipelineSearch = InputState.new({ placeholder: "Log durchsuchen…" });
    this.pipelineSearch.on("change", (_event, cx) => { this.notifyNow(); });
    this.track(this.pipelineSearch);
    this.version = null;
    this.versionError = null;
    this.programs = null;
    this.programsAt = 0;
    this.blueprintDrawer = null;
    this.blueprintName = null;
    this.blueprintRole = null;
    this.blueprintModel = null;
    this.blueprintFlags = null;
    this.blueprintPrompt = null;
    this.blueprintProgram = "";
    this.blueprintColorKey = "c1";
    this.blueprintOriginal = "";
    this.blueprintPromptPath = "";
    this.blueprintDraftId = 0;
    this.blueprintPromptLoading = false;
    this.blueprintDirty = false;
    this.blueprintSaving = false;
    this.teamForms = {};
    this.orchestrators = {};
    this.orchestratorErrors = {};
    this.teamPrompt = null;
    this.teamPromptId = 0;
    this.teamPromptLoading = false;
    this.newTeamOpen = false;
    this.newTeamId = 0;
    this.newTeamName = null;
    this.newTeamRepos = [];
    this.newTeamMembers = [];
    this.newTeamReviewer = "";
    this.newTeamSessions = null;
    this.newSentence = null;
    this.newRepo = null;
    this.newWake = true;
    this.newError = null;
    this.newReposLoading = false;
    this.newTemplate = null;
    this.newIssue = null;
    this.newIssues = [];
    this.issuesError = null;
    this.lastNewRequest = 0;
    this.lastOpenRequest = 0;
    this.lastCloseRequest = 0;

    this.searchFocused = false;
    this.search = InputState.new({ placeholder: "Tickets durchsuchen…" });
    this.search.on("change", (_event, cx) => { this.notifyNow(); });
    this.search.on("focus", (_event, cx) => { this.searchFocused = true; this.fieldFocused = true; this.notifyNow(); });
    this.search.on("blur", (_event, cx) => { this.searchFocused = false; this.fieldFocused = false; this.notifyNow(); });

    this.newInput = InputState.new({ placeholder: "Neues Ticket in einem Satz…" });
    this.newInput.on("submit", (_event, cx) => {
      if (this.consumeMentionSubmit("quick", cx)) return;
      this.createFromPanel(cx);
    });
    this.track(this.newInput);
    this.wireMentions("quick", this.newInput);

    this.commentInput = TextareaState.new({ placeholder: "Kommentar … @name weckt", rows: 3 });
    this.commentInput.on("submit", (_event, cx) => {
      if (this.consumeMentionSubmit("comment", cx)) return;
      this.comment(cx);
    });
    this.commentInput.on("paste_other", (_event, cx) => { this.pasteImage("comment", cx); });
    this.track(this.commentInput);
    this.wireMentions("comment", this.commentInput);
    this.search.on("focus", (_event, cx) => { this.fieldFocused = true; this.notifyNow(); });
    this.search.on("blur", (_event, cx) => { this.fieldFocused = false; this.notifyNow(); });

    this.appFocus = cx.focus_handle();
    this.mentionClock = cx;
    this.mentionKeyCount = 0;

    if (this.view === "switcher") {
      this.ready = true;
      return;
    }
    if (this.overlayId && shared("fabric.window")?.id !== this.overlayId) {
      setShared("fabric.window", { id: this.overlayId });
    }

    if (checking()) {
      this.ready = true;
      return;
    }

    cx.spawn(async (cx) => {
      this.asyncCx = cx;
      await this.refresh(cx);
      // Vorschau: das Fabric-Fenster nach dem Start einmal öffnen, damit
      // Screenshots ohne Mausklick dieselbe Ansicht wie im Alltag zeigen.
      if (!this.isApp && shared("fabric.previewWindow")) {
        setShared("fabric.previewWindow", null);
        this.openInWindow(this.currentRoute(), cx);
      }
      if (this.isApp) {
        this.appFocus.focus();
        cx.timer.after(120, () => this.appFocus.focus());
        await this.loadRoster(cx);
        await this.loadOrchestrators(cx);
        await this.loadVersion(cx);
        // Programme und bekannte Repos jetzt holen, nicht erst beim Öffnen von
        // Team/Drawer/Neuem Ticket: knownAgents kostet ~160 ms (Login-Shell)
        // und fab repos einen weiteren Lauf. Ohne Vorlauf fehlen dem Programm-
        // bzw. Repo-Dropdown beim ersten Klick die Optionen.
        this.ensurePrograms(cx);
        this.ensureReposQuiet(cx);
        this.ensurePage(cx);
      }
      this.watchLoop(cx);
      this.commandLoop(cx);
    });
    cx.timer.every(5000, (cx) => { if (!this.closed) this.refresh(cx); });
    if (this.isApp || this.view === "inbox") {
      // Der Posteingang-Block lebt in der Seitenleiste auch bei geschlossenem
      // Fabric-Fenster; dort läuft der Tick-Takt. Beide Instanzen teilen sich
      // den letzten Versuch, damit jede Minute genau ein Lauf startet.
      cx.timer.every(10000, (cx) => {
        if (this.closed || this.tickRunning) return;
        const now = Date.now();
        if (!model.tickDue(shared("fabric.tickAttempt"), now)) return;
        setShared("fabric.tickAttempt", now);
        this.tickRunning = true;
        cx.spawn(async () => {
          try {
            const result = await this.execFab(["tick"], { timeout: 120000 });
            // Scheitert der Lauf, bleibt `last_tick` stehen; der Index-Lauf
            // veröffentlicht den fälligen Alarm im Posteingang.
            if (result?.code !== 0) {
              await this.execFab(["index"], { timeout: 30000 });
            }
          } catch {
            try { await this.execFab(["index"], { timeout: 30000 }); } catch { /* still */ }
          } finally {
            this.tickRunning = false;
          }
        });
      });
    }
    if (this.isApp) {
      cx.timer.every(300, (cx) => {
        if (this.closed) return;
        const request = Number(shared("fabric.newRequest") ?? 0);
        if (request && request !== this.lastNewRequest) {
          this.lastNewRequest = request;
          setShared("fabric.newRequest", null);
          this.openNewTicket(cx);
        }
        const openRequest = shared("fabric.openRequest");
        const openAt = Number(openRequest?.at ?? 0);
        if (openAt && openAt !== this.lastOpenRequest) {
          this.lastOpenRequest = openAt;
          setShared("fabric.openRequest", null);
          if (openRequest.route) this.openRequested(openRequest.route, cx);
        }
        const closeRequest = shared("fabric.closeRequest");
        const closeAt = Number(closeRequest?.at ?? 0);
        if (closeAt && closeAt !== this.lastCloseRequest) {
          this.lastCloseRequest = closeAt;
          setShared("fabric.closeRequest", null);
          this.closeWindowWithGuard(cx);
        }
        const selected = this.selectedId();
        if (selected && selected !== this.openId && model.followsSelection(this.isApp, this.currentRoute())) {
          this.openId = selected;
          this.ticket = null;
          this.ticketError = null;
          this.resetTicketEditing();
          cx.spawn(async (cx) => {
            await this.loadTicket();
            if (!this.closed) this.notifyNow();
          });
        }
      });
    }
  }

  async close() {
    this.closed = true;
    this.watch?.cancel();
    if (this.overlayId && shared("fabric.window")?.id === this.overlayId) {
      setShared("fabric.window", null);
    }
  }

  track(state) {
    if (!state?.on) return state;
    state.on("focus", (_event, cx) => { this.fieldFocused = true; this.notifyNow(); });
    state.on("blur", (_event, cx) => { this.fieldFocused = false; this.notifyNow(); });
    return state;
  }

  // ---------- Daten ----------

  get tickets() {
    return this.index?.tickets ?? [];
  }

  get inbox() {
    return this.index?.inbox ?? [];
  }

  get events() {
    return this.index?.events ?? [];
  }

  get agents() {
    return this.roster?.agents ?? [];
  }

  ticketAgents(ticket = this.ticket) {
    return model.teamAgents(this.roster?.teams ?? [], ticket);
  }

  selectedId() {
    const value = shared("fabric.selected");
    return typeof value === "string" && value ? value : null;
  }

  currentRoute() {
    return normalizeRoute(shared("fabric.route"));
  }

  routeId() {
    if (!this.isApp) return null;
    const route = this.currentRoute();
    return route.page === "ticket" ? (route.id ?? this.selectedId()) : null;
  }

  activeTicketId() {
    return this.ticket?.id ?? this.openId;
  }

  resetTicketEditing() {
    this.imageOpen = null;
    this.titleEdit = null;
    this.bodyEditing = false;
    this.wakeOpen = false;
    this.checksOpen = false;
    this.clearMentions();
    this.bodyFor = null;
    this.bodyEditor = null;
    this.changes = null;
    this.changesFor = null;
    this.changesAt = 0;
    this.changesLoading = false;
    this.changesOpen = false;
    this.changesSeenHead = "";
    this.changesFile = null;
    this.changesDiff = "";
    this.changesDiffFor = "";
    this.changesError = null;
    this.changesLoadingFile = false;
    this.setError("changes", null);
    this.setError("accept", null);
  }

  agentNames() {
    return model.mentionNames(this.agents);
  }

  // ---------- Namensvorschläge hinter `@` ----------

  mentionInput(field) {
    switch (field) {
      case "comment": return this.commentInput;
      case "new": return this.newSentence;
      case "quick": return this.newInput;
      case "title": return this.titleEdit;
      case "wake": return this.wakeText;
      default: return null;
    }
  }

  mentionOpen(field) {
    return Boolean(field) && this.mentions.field === field && this.mentions.suggestions.length > 0;
  }

  clearMentions(cx) {
    this.mentions = { field: null, suggestions: [], index: 0, start: 0, end: 0 };
    this.focusedField = null;
    if (cx) cx.notify();
  }

  /** Ein Timer aus dem Besitz des Fensters; der `cx` eines Handlers trägt keinen. */
  mentionLater(ms, body) {
    const clock = this.asyncCx ?? this.mentionClock;
    if (clock?.timer?.after) {
      try {
        clock.timer.after(ms, () => { if (!this.closed) body(); });
        return;
      } catch {
        // Ein ersetzter Build hat keinen gültigen Timer mehr; dann sofort leeren.
      }
    }
    body();
  }

  wireMentions(field, state) {
    if (!state?.on) return;
    state.on("change", (_event, cx) => {
      this.focusedField = field;
      this.refreshMentions(field, cx);
    });
    state.on("focus", (_event, cx) => {
      this.focusedField = field;
      this.refreshMentions(field, cx);
    });
    state.on("blur", (_event, _cx) => {
      if (this.focusedField === field) this.focusedField = null;
      // Der Klick auf eine Vorschlagszeile kommt nach dem Blur; erst danach leeren.
      this.mentionLater(120, () => {
        if (this.focusedField === field || this.mentions.field !== field) return;
        this.mentions = { field: null, suggestions: [], index: 0, start: 0, end: 0 };
        this.notifyNow();
      });
    });
  }

  refreshMentions(field, cx) {
    const input = this.mentionInput(field);
    if (!input) {
      this.mentions = { field: null, suggestions: [], index: 0, start: 0, end: 0 };
      return;
    }
    const value = input.value();
    const range = input.selected_range();
    const caret = range?.end ?? String(value).length;
    // Ein Textarea fügt bei Enter zuerst den Zeilenumbruch ein und meldet
    // danach submit. Die Liste muss diesen Umbruch überleben, damit Enter
    // den Vorschlag übernimmt statt den Kommentar zu senden.
    const at = caret > 0 && value[caret - 1] === "\n" ? caret - 1 : caret;
    const query = model.mentionQuery(value, at);
    const suggestions = query ? model.mentionSuggestions(value, at, this.agentNames()) : [];
    const same = this.mentions.field === field && this.mentions.start === (query?.start ?? 0);
    const index = suggestions.length
      ? (same ? Math.min(this.mentions.index, suggestions.length - 1) : 0)
      : 0;
    if (suggestions.length) this.ensureMentionKeys(cx);
    this.mentions = {
      field: suggestions.length ? field : null,
      suggestions,
      index,
      start: query?.start ?? 0,
      end: query?.end ?? 0,
    };
    cx?.notify?.();
  }

  moveMention(delta, cx) {
    if (!this.mentionOpen(this.focusedField)) return;
    this.mentions.index = model.moveMentionIndex(
      this.mentions.index, this.mentions.suggestions.length, delta,
    );
    this.notifyNow();
  }

  acceptMention(field, name, cx) {
    const input = this.mentionInput(field);
    if (!input || !name || this.mentions.field !== field) return false;
    const value = input.value();
    let end = this.mentions.end;
    // Enter im Textfeld steht als Zeilenumbruch direkt hinter `end`.
    if (value[end] === "\n") end += 1;
    const next = model.replaceMention(value, { start: this.mentions.start, end }, name);
    this.mentions = { field: null, suggestions: [], index: 0, start: 0, end: 0 };
    this.focusedField = field;
    input.set_value(next.text);
    input.set_selected_range({ start: next.caret, end: next.caret });
    input.focus();
    this.notifyNow();
    return true;
  }

  consumeMentionSubmit(field, cx) {
    if (!this.mentionOpen(field)) return false;
    const suggestion = this.mentions.suggestions[this.mentions.index]
      ?? this.mentions.suggestions[0];
    if (!suggestion) return false;
    return this.acceptMention(field, suggestion.name, cx);
  }

  mentionAction(kind, cx) {
    const field = this.focusedField;
    const open = field && this.mentions.field === field && this.mentions.suggestions.length > 0;
    if (!open) {
      cx.propagate();
      return;
    }
    if (kind === "up" || kind === "down") {
      this.moveMention(kind === "up" ? -1 : 1, cx);
      return;
    }
    if (kind === "accept") {
      this.consumeMentionSubmit(field, cx);
      return;
    }
    this.mentions = { field: null, suggestions: [], index: 0, start: 0, end: 0 };
    this.notifyNow();
  }

  mentionActions(el) {
    return el
      .on_action("fabric-mention-up", (_event, cx) => this.mentionAction("up", cx))
      .on_action("fabric-mention-down", (_event, cx) => this.mentionAction("down", cx))
      .on_action("fabric-mention-accept", (_event, cx) => this.mentionAction("accept", cx))
      .on_action("fabric-mention-close", (_event, cx) => this.mentionAction("close", cx))
      // Auch ohne eigene Keymap-Bindung: die Textfelder dispatchten ihre
      // eigenen Aktionen. In der Capture-Phase an der Fabric-Wurzel fangen wir
      // sie ab, bevor das Feld Cursor/Zeilenumbruch/Einzug ausführt.
      .on_action("input::MoveUp", (_event, cx) => this.inputMentionAction("up", cx))
      .on_action("input::MoveDown", (_event, cx) => this.inputMentionAction("down", cx))
      .on_action("input::Enter", (_event, cx) => this.inputMentionAction("accept", cx))
      .on_action("input::IndentInline", (_event, cx) => this.inputMentionAction("accept", cx))
      .on_action("input::Indent", (_event, cx) => this.inputMentionAction("accept", cx))
      .on_action("input::Escape", (_event, cx) => this.inputMentionAction("close", cx));
  }

  inputMentionAction(kind, cx) {
    const field = this.focusedField;
    if (!field || this.mentions.field !== field || !this.mentions.suggestions.length) return;
    cx.stop_propagation();
    if (kind === "up" || kind === "down") {
      this.moveMention(kind === "up" ? -1 : 1, cx);
      return;
    }
    if (kind === "accept") {
      this.consumeMentionSubmit(field, cx);
      return;
    }
    this.clearMentions(cx);
  }

  /** Bindet die Tasten erst beim ersten Vorschlag – nach den Bindungen der
   *  Textfelder. Mit deren Kontext (`Input`, `Textarea`) und späterer
   *  Registrierung gewinnt die Liste den Gleichstand; ohne offene Liste
   *  reicht der Handler die Aktion per `cx.propagate()` weiter. */
  ensureMentionKeys(cx) {
    if (mentionKeysBound || !cx?.bind_keys) return;
    mentionKeysBound = true;
    try {
      // 0 ist kein Fehler: nach einem Reload liegen dieselben Bindungen schon
      // in der Keymap und werden nicht erneut gezählt.
      this.mentionKeyCount = cx.bind_keys(model.mentionKeyBindings());
    } catch (error) {
      mentionKeysBound = false;
      notify({
        title: "Tastatur für @-Vorschläge nicht gebunden",
        body: message(error),
        level: "error",
        timeout: 8000,
      });
    }
  }

  mentionView(field, t) {
    if (!this.mentionOpen(field)) return null;
    return ui.mentionList(t, field, this.mentions.suggestions, this.mentions.index,
      (name, cx) => this.acceptMention(field, name, cx));
  }

  agentColor(name) {
    const agent = this.agents.find((row) => row.name === name);
    if (agent) return agent.color;
    if (name === "orchestrator") return "c6";
    if (name === "mensch") return "c4";
    return "c1";
  }

  agentFor(name) {
    return this.agents.find((row) => row.name === name) ?? null;
  }

  async refresh(_cx) {
    if (this.closed) return;
    if (this.refreshing) {
      this.pending = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.pending = false;
        await this.readOnce();
      } while (this.pending && !this.closed);
      this.checkContextPreview(_cx);
    } finally {
      this.refreshing = false;
      this.notifyNow();
    }
  }

  async readOnce() {
    let text = null;
    try {
      text = await readTextFile(`${this.dir}/index.json`);
    } catch {
      text = null;
    }
    let autopilot = null;
    try {
      autopilot = await readTextFile(`${this.dir}/autopilot.json`);
    } catch {
      autopilot = null;
    }
    this.autopilotText = autopilot;
    if (this.autopilotOpen) await this.loadAutopilotLog();
    let next = null;
    this.loadError = null;
    if (text !== null) {
      try {
        next = normalizeIndex(JSON.parse(text));
      } catch (error) {
        this.loadError = `index.json ist unlesbar: ${message(error)}`;
      }
    }
    this.index = next;
    this.notifyPosteingang();

    const selected = this.selectedId();
    const wanted = model.ticketIdFor(this.isApp, this.currentRoute(), selected);
    if (wanted !== this.openId) {
      this.openId = wanted;
      this.resetTicketEditing();
    }
    await this.loadTicket();
    if (this.needsHistoryScroll && this.isApp) {
      this.needsHistoryScroll = false;
      try { this.historyScroll.scroll_to_item(this.historyLastIndex); } catch { /* noch kein Layout */ }
    }
    if (this.openId && this.index && !this.ticket
        && !this.index.tickets.some((ticket) => ticket?.id === this.openId)) {
      this.openId = null;
      this.ticketError = null;
      this.titleEdit = null;
      this.bodyEditor = null;
      if (this.selectedId() === wanted) setShared("fabric.selected", null);
    }
    this.ready = true;
  }

  async loadTicket() {
    const id = this.openId;
    if (!id) {
      this.ticket = null;
      this.ticketError = null;
      this.bodyEditor = null;
      this.bodyFor = null;
      return;
    }
    let text = null;
    try {
      text = await readTextFile(`${this.dir}/tickets/${id}.json`);
    } catch (error) {
      this.ticket = null;
      this.ticketError = `Ticket ${id} ist nicht lesbar: ${message(error)}`;
      return;
    }
    if (text === null) {
      this.ticket = null;
      this.ticketError = `Ticket ${id} wurde nicht gefunden.`;
      return;
    }
    try {
      this.ticket = JSON.parse(text);
      this.ticketError = null;
      if (this.bodyFor !== id) {
        this.bodyFor = id;
        this.bodySaved = this.ticket.body ?? "";
        this.bodyEditor = this.newEditor("markdown", this.bodySaved);
        this.bodyEditor.on("paste_other", (_event, cx) => { this.pasteImage("body", cx); });
        this.bodyEditing = false;
        const cards = model.ticketCards(this.ticket, this.events);
        // Mit offenen Karten beginnt das Ticket oben bei „Zu entscheiden“,
        // nicht am Ende des Verlaufs.
        this.needsHistoryScroll = !cards.some((card) => card.status === "open");
        this.historyLastIndex = model.historyEndIndex(this.ticket, this.events) + (cards.length ? 1 : 0);
      } else if (this.bodyEditor && !model.isDirty(this.bodyEditor.value(), this.bodySaved)) {
        this.bodySaved = this.ticket.body ?? "";
        this.bodyEditor.set_value(this.bodySaved);
      }
      if (this.titleEdit && !model.isDirty(this.titleEdit.value(), this.titleSaved)) {
        this.titleSaved = this.ticket.title ?? "";
      }
      if (!this.fieldFocused && this.baseInput.value() !== (this.ticket.base ?? "")) {
        this.baseInput.set_value(this.ticket.base ?? "");
      }
      if (this.changesApply()) {
        await this.loadChanges();
      } else {
        this.clearChanges();
      }
    } catch (error) {
      this.ticket = null;
      this.ticketError = `Ticket ${id} ist unlesbar: ${message(error)}`;
    }
  }

  changesApply(ticket = this.ticket) {
    return Boolean(ticket && ticket.status === "review" && ticket.branch);
  }

  clearChanges() {
    this.changes = null;
    this.changesFor = null;
    this.changesAt = 0;
    this.changesOpen = false;
    this.changesSeenHead = "";
    this.changesFile = null;
    this.changesDiff = "";
    this.changesDiffFor = "";
    this.changesError = null;
  }

  /** Änderungen des offenen Tickets: Dateien, Commits, Nachweise und HEAD. */
  async loadChanges({ force = false } = {}) {
    const id = this.openId;
    if (!id || !this.changesApply()) {
      this.clearChanges();
      return null;
    }
    if (this.changesLoading) return this.changesPending;
    if (!force && this.changesFor === id && Date.now() - this.changesAt < 5000) {
      return this.changes;
    }
    this.changesLoading = true;
    this.setError("changes", null);
    const pending = (async () => {
      let result;
      try {
        result = await this.execFab(model.diffArgs(id), { timeout: 30000 });
      } catch (error) {
        if (this.openId !== id) return null;
        this.changes = null;
        this.changesFor = id;
        this.changesAt = Date.now();
        this.changesError = `Änderungen nicht ladbar: ${message(error)}`;
        this.setError("changes", this.changesError);
        return null;
      }
      if (this.openId !== id) return null;
      this.changesFor = id;
      this.changesAt = Date.now();
      if (result.code !== 0) {
        this.changes = null;
        this.changesError = (result.stderr || "").trim() || `fab diff endete mit Code ${result.code}.`;
        this.changesSeenHead = "";
        this.setError("changes", this.changesError);
        return null;
      }
      const data = parseJson(result.stdout, null);
      if (!data || !data.head) {
        this.changes = null;
        this.changesError = "fab diff lieferte keine Änderungsdaten.";
        this.changesSeenHead = "";
        this.setError("changes", this.changesError);
        return null;
      }
      this.changes = data;
      this.changesError = null;
      // Ein neuer HEAD sperrt die Abnahme wieder: gesehen gilt nur für den
      // Stand, der beim Öffnen der Ansicht gelesen wurde.
      if (this.changesSeenHead && this.changesSeenHead !== data.head) {
        this.changesFile = null;
        this.changesDiff = "";
        this.changesDiffFor = "";
      }
      if (this.changesFile && !(data.files ?? []).some((file) => file.path === this.changesFile)) {
        this.changesFile = null;
        this.changesDiff = "";
        this.changesDiffFor = "";
      }
      return data;
    })();
    this.changesPending = pending;
    try {
      return await pending;
    } finally {
      this.changesPending = null;
      this.changesLoading = false;
      this.notifyNow();
    }
  }

  async openDiffFile(path) {
    const id = this.openId;
    if (!id || !path) return;
    this.changesFile = path;
    if (this.changesDiffFor === `${id}:${path}`) {
      this.notifyNow();
      return;
    }
    this.changesDiff = "";
    this.changesDiffFor = "";
    this.changesLoadingFile = true;
    this.setError("changes", null);
    this.notifyNow();
    let result;
    try {
      result = await this.execFab(model.diffFileArgs(id, path), { timeout: 30000 });
    } catch (error) {
      if (this.openId !== id || this.changesFile !== path) return;
      this.changesLoadingFile = false;
      this.setError("changes", `Diff nicht ladbar: ${message(error)}`);
      this.notifyNow();
      return;
    }
    if (this.openId !== id || this.changesFile !== path) return;
    this.changesLoadingFile = false;
    if (result.code !== 0) {
      this.setError(
        "changes",
        (result.stderr || "").trim() || `fab diff --file endete mit Code ${result.code}.`,
      );
    } else {
      this.changesDiff = result.stdout ?? "";
      this.changesDiffFor = `${id}:${path}`;
    }
    this.notifyNow();
  }

  async toggleChanges(cx) {
    const gate = model.changesGate(this.changes, this.changesSeenHead);
    if (this.changesOpen && gate.enabled) {
      this.changesOpen = false;
      this.notifyNow();
      return;
    }
    this.changesOpen = true;
    await this.loadChanges({ force: true });
    if (!this.changes) {
      this.notifyNow();
      return;
    }
    this.changesSeenHead = this.changes.head;
    this.setError("accept", null);
    const first = (this.changes.files ?? [])[0]?.path ?? null;
    if (first && this.changesFile !== first) await this.openDiffFile(first);
    this.notifyNow();
  }

  watchLoop(cx) {
    cx.spawn(async (cx) => {
      while (!this.closed) {
        let handle = null;
        try {
          handle = watchFolder(this.dir);
          this.watch = handle;
          await handle;
        } catch {
          await cx.sleep(5000);
        } finally {
          if (this.watch === handle) this.watch = null;
        }
        if (this.closed) return;
        await cx.sleep(250);
        await this.refresh(cx);
      }
    });
  }

  // ---------- fab ----------

  async execFab(args, { timeout = 120000, cwd = null } = {}) {
    return exec(this.fab, args, {
      cwd: cwd ?? focused()?.cwd ?? appHome(),
      timeout,
    });
  }

  setError(key, text, level = "error") {
    if (text) this.errors[key] = { text, level };
    else delete this.errors[key];
  }

  errorFor(key) {
    return this.errors[key] ?? null;
  }

  async action(key, args, {
    success = "Erledigt.", timeout = 120000, cwd = null, after = null,
    expected = 0,
  } = {}) {
    if (this.busy) return { ok: false, busy: true };
    this.busy = key;
    this.setError(key, null);
    this.flash = null;
    this.notifyNow();
    let result = null;
    let failure = null;
    try {
      result = await this.execFab(args, { timeout, cwd });
    } catch (error) {
      failure = `fab ließ sich nicht starten: ${message(error)}`;
    }
    this.busy = "";
    if (failure) {
      this.setError(key, failure);
      notify({ title: "Fabric", body: failure, level: "error" });
      this.notifyNow();
      return { ok: false, result: null };
    }
    if (result.code !== expected) {
      const text = (result.stderr || "").trim() || (result.stdout || "").trim()
        || `fab endete mit Code ${result.code}.`;
      this.setError(key, text);
      notify({ title: "Fabric", body: text, level: "error" });
      this.notifyNow();
      return { ok: false, result };
    }
    const okText = typeof success === "function" ? success(result) : success;
    const warning = (result.stderr || "").trim();
    if (warning) {
      this.setError(key, warning, "warn");
      notify({ title: "Fabric", body: warning, level: "warning" });
    } else if (okText) {
      notify({ title: "Fabric", body: okText, level: "success" });
    }
    await this.refresh();
    if (after) await after(result);
    this.notifyNow();
    return { ok: true, result, text: okText };
  }

  notifyNow() {
    // Nur der AsyncContext aus `init` lebt über ein `await` hinweg.
    if (this.asyncCx && !this.closed) {
      try { this.asyncCx.notify(); } catch { /* ersetzt oder geschlossen */ }
    }
  }

  // ---------- Befehle ----------

  async loadCommands(force = false) {
    if (this.commandCatalog && !force) return;
    try {
      const result = await this.execFab(["commands", "--json"], { timeout: 30000 });
      const data = result.code === 0 ? parseJson(result.stdout, null) : null;
      if (!Array.isArray(data)) throw new Error((result.stderr || "").trim() || "fab commands lieferte keine Liste");
      this.commandCatalog = data;
      this.commandCatalogError = null;
      // Rechts gleich ein Formular zeigen statt einer leeren Fläche.
      if (!this.selectedCommand() && data.length) this.selectCommand(data[0]);
    } catch (error) {
      this.commandCatalogError = `Befehle nicht ladbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  selectedCommand() {
    return (this.commandCatalog ?? []).find((entry) => model.commandKey(entry) === this.commandSel) ?? null;
  }

  /** Befehl wählen; Eingabefelder entstehen einmal je Befehl, vorbelegt mit Ticket und mensch. */
  selectCommand(entry) {
    const key = model.commandKey(entry);
    this.commandSel = key;
    this.commandConfirm = null;
    if (!this.commandInputs[key]) {
      const defaults = model.commandDefaults(entry, { ticket: this.selectedId() ?? "" });
      const inputs = {};
      for (const arg of entry.args) {
        if (arg.kind === "flag" || (arg.choices && arg.choices.length <= 8)) continue;
        const state = InputState.new({ placeholder: arg.metavar || arg.dest });
        if (defaults[arg.dest]) state.set_value(defaults[arg.dest]);
        state.on("change", () => { this.commandConfirm = null; this.notifyNow(); });
        this.track(state);
        inputs[arg.dest] = state;
      }
      this.commandInputs[key] = inputs;
      this.commandFlags[key] = {};
      this.commandChoices[key] = {};
    }
    this.notifyNow();
  }

  setCommandFlag(entry, dest, on) {
    const key = model.commandKey(entry);
    this.commandFlags[key] = { ...(this.commandFlags[key] ?? {}), [dest]: on };
    this.commandConfirm = null;
    this.notifyNow();
  }

  setCommandChoice(entry, dest, value) {
    const key = model.commandKey(entry);
    this.commandChoices[key] = { ...(this.commandChoices[key] ?? {}), [dest]: value };
    this.commandConfirm = null;
    this.notifyNow();
  }

  commandValues(entry) {
    const key = model.commandKey(entry);
    const values = { ...(this.commandFlags[key] ?? {}), ...(this.commandChoices[key] ?? {}) };
    for (const [dest, state] of Object.entries(this.commandInputs[key] ?? {})) values[dest] = state.value();
    return values;
  }

  /** Befehl ausführen; folgenreiche Befehle brauchen einen zweiten Klick. */
  async runCommand(entry) {
    const key = model.commandKey(entry);
    const built = model.commandArgv(entry, this.commandValues(entry));
    if (!built.argv || this.busy) return;
    if (entry.danger && this.commandConfirm !== key) {
      this.commandConfirm = key;
      this.notifyNow();
      return;
    }
    this.commandConfirm = null;
    this.busy = "command";
    this.notifyNow();
    try {
      const result = await this.execFab(built.argv, { timeout: 900000 });
      this.commandResult = { key, argv: built.argv, code: result.code, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      this.commandResult = { key, argv: built.argv, code: -1, stdout: "", stderr: message(error) };
    } finally {
      this.busy = null;
    }
    await this.refresh();
    this.notifyNow();
  }

  // ---------- Benachrichtigungen ----------

  notifySettings() {
    return model.normalizeNotifySettings(shared(model.NOTIFY_SETTINGS_KEY));
  }

  notifyPosteingang() {
    if (checking() || !this.index) return;
    const plan = model.inboxNotifications(
      this.inbox, shared(model.NOTIFY_SEEN_KEY), this.notifySettings(), Date.now());
    // Vor dem Senden beanspruchen: sonst meldet jede Mod-Kopie dieselben Einträge.
    if (plan.changed) setShared(model.NOTIFY_SEEN_KEY, plan.seen);
    const toasts = model.inboxToastPlan(plan.fresh);
    if (toasts.sound) playSound(toasts.sound);
    for (const entry of toasts.toasts) {
      const line = model.oneLine(entry.text, 140);
      notify({
        title: `Fabric · ${model.INBOX_WORDS[entry.kind] ?? "Hinweis"}`,
        body: entry.ticket ? `${entry.ticket} · ${line}` : line,
        level: model.inboxNotifyLevel(entry.kind),
        ...(entry.ticket ? { action: { name: "fabric.open", args: { ticket: entry.ticket } } } : {}),
        timeout: 12000,
      });
    }
    if (toasts.summary) {
      notify({ title: "Fabric · Posteingang", body: toasts.summary, level: "info", timeout: 12000 });
    }
  }

  /** Fabric pausieren bzw. fortsetzen (`fab pause` / `fab resume`). */
  async setPaused(on, cx) {
    await this.action("pause", [on ? "pause" : "resume", "--from", "mensch"], {
      success: on ? "Fabric pausiert." : "Fabric läuft wieder.",
      timeout: 180000,
    });
  }

  /** Änderungen eines Prüfungs-Eintrags im Posteingang laden bzw. zuklappen. */
  async toggleInboxDiff(id) {
    if (this.inboxDiff[id]?.open) {
      this.inboxDiff = { ...this.inboxDiff, [id]: { ...this.inboxDiff[id], open: false } };
      this.notifyNow();
      return;
    }
    this.inboxDiff = { ...this.inboxDiff, [id]: { open: true, loading: true } };
    this.notifyNow();
    let entry;
    try {
      const result = await this.execFab(model.diffArgs(id), { timeout: 30000 });
      const data = result.code === 0 ? parseJson(result.stdout, null) : null;
      entry = data?.head
        ? { open: true, data }
        : { open: true, error: (result.stderr || "").trim() || "fab diff lieferte keine Änderungen." };
    } catch (error) {
      entry = { open: true, error: `Änderungen nicht ladbar: ${message(error)}` };
    }
    this.inboxDiff = { ...this.inboxDiff, [id]: entry };
    this.notifyNow();
  }

  /** Abnahme aus dem Posteingang; erst nach angesehenen Änderungen (wie im Ticket). */
  async acceptFromInbox(id) {
    if (!this.inboxDiff[id]?.data?.head) return;
    await this.action("accept", model.acceptArgs(id), {
      success: `${id} abgenommen.`,
      timeout: 180000,
    });
  }

  async rejectFromInbox(id) {
    const text = this.inboxReject.value().trim();
    if (!text) {
      this.setError("reject", "Bitte Feedback eingeben.");
      this.notifyNow();
      return;
    }
    const result = await this.action("reject", model.rejectArgs(id, text), {
      success: `${id} zurückgewiesen.`,
    });
    if (result.ok) {
      this.inboxRejectFor = null;
      this.inboxReject.set_value("");
      this.notifyNow();
    }
  }

  setNotify(patch, cx) {
    const next = model.normalizeNotifySettings({ ...this.notifySettings(), ...patch });
    setShared(model.NOTIFY_SETTINGS_KEY, next);
    this.notifyNow();
    return next;
  }

  stepNotify(field, delta, cx) {
    if (field !== "quiet_from" && field !== "quiet_to") return;
    const current = this.notifySettings()[field];
    const minutes = (((current + delta) % 24) + 24) % 24;
    this.setNotify({ [field]: minutes }, cx);
  }

  // ---------- Auswahl und Navigation ----------

  select(id, cx) {
    this.lastCx = cx;
    const next = id || null;
    this.timelineAll = false;
    this.openId = next;
    this.ticket = null;
    this.ticketError = null;
    this.resetTicketEditing();
    this.flash = null;
    setShared("fabric.selected", next);
    if (this.isApp && next) setShared("fabric.route", { page: "ticket", id: next });
    this.notifyNow();
    if (next) {
      cx.spawn(async (cx) => {
        await this.loadTicket();
        this.scrollHistory(cx);
        if (!this.closed) this.notifyNow();
      });
    }
  }

  scrollHistory(cx) {
    if (!this.isApp) return;
    const toEnd = () => {
      try { this.historyScroll.scroll_to_item(this.historyLastIndex); } catch { /* noch kein Layout */ }
    };
    const timer = cx?.timer;
    toEnd();
    timer?.after(60, toEnd);
  }

  back(cx) {
    if (this.isApp) this.navigate(this.view === "app" ? "tickets" : "tickets", {}, cx);
    else this.select(null, cx);
  }

  navigate(page, extra = {}, cx) {
    this.lastCx = cx ?? this.lastCx;
    const target = { page, ...extra };
    const go = () => {
      this.menu = null;
      this.autopilotOpen = false;
      this.modal = null;
      if (page !== "team") {
        this.clearBlueprintDrawer();
        this.clearTeamPrompt();
      }
      if (page !== "ticket" || target.id !== this.openId) this.resetTicketEditing();
      if (target.id) setShared("fabric.selected", target.id);
      setShared("fabric.route", target);
      if (page === "ticket" && target.id) {
        this.openId = target.id;
        this.ticket = null;
        if (cx) cx.spawn(async (cx) => {
          await this.loadTicket();
          this.scrollHistory(cx);
          if (!this.closed) this.notifyNow();
        });
      }
      this.ensurePage(cx);
      if (cx) this.notifyNow();
    };
    this.guard(go, cx);
  }

  ensurePage(cx) {
    if (!this.isApp || !cx) return;
    this.checkContextPreview(cx);
    const route = this.currentRoute();
    if (route.page === "board" || route.page === "tickets" || route.page === "ticket") {
      this.ensurePipelineRuns(cx);
    }
    if (route.page === "team") {
      if (!this.roster || Date.now() - this.rosterAt > 15000) cx.spawn((cx) => this.loadRoster(cx));
      else this.syncTeamForms();
      cx.spawn((cx) => this.loadOrchestrators(cx));
      this.ensurePrograms(cx);
      this.ensureReposQuiet(cx);
    } else if (route.page === "prompts") {
      if (!this.promptList || Date.now() - this.promptsAt > 15000) {
        cx.spawn(async (cx) => {
          await this.loadPrompts(cx);
          if (!this.currentRoute().name) {
            const first = model.sortPrompts(this.promptList ?? [])[0];
            if (first) this.selectPrompt(first.name, cx, true);
          } else {
            await this.loadPrompt(this.currentRoute().name, cx);
          }
        });
      } else if (route.name && (!this.promptEditor || this.promptName !== route.name)) {
        cx.spawn((cx) => this.loadPrompt(route.name, cx));
      }
    } else if (route.page === "templates") {
      if (!this.templateList || Date.now() - this.templatesAt > 15000) {
        cx.spawn(async (cx) => {
          await this.loadTemplates(cx);
          if (!this.currentRoute().name) {
            const first = model.sortTemplates(this.templateList ?? [])[0];
            if (first) this.selectTemplate(first.name, cx, true);
          } else {
            await this.loadTemplate(this.currentRoute().name, cx);
          }
        });
      } else if (!route.name) {
        if (!this.templateEditor) {
          const first = model.sortTemplates(this.templateList ?? [])[0];
          if (first) this.selectTemplate(first.name, cx, true);
        }
      } else if (!this.templateEditor || this.templateName !== route.name) {
        cx.spawn((cx) => this.loadTemplate(route.name, cx));
      }
    } else if (route.page === "repos") {
      if (!this.repos || Date.now() - this.reposAt > 15000) {
        cx.spawn(async (cx) => {
          await this.loadRepos(cx);
          if (!this.currentRoute().path) {
            const first = (this.repos ?? [])[0];
            if (first) this.selectRepo(first.path, cx, true);
          } else {
            await this.loadRepo(this.currentRoute().path, cx);
          }
        });
      } else if (route.path && (!this.repoDetail || this.repoDetail.path !== route.path)) {
        cx.spawn((cx) => this.loadRepo(route.path, cx));
      }
    } else if (route.page === "workflows") {
      const flowsStale = !this.flows || Date.now() - this.flowAt > 15000;
      const runsStale = !this.flowRuns || Date.now() - this.flowRunsAt > 15000;
      if (flowsStale || runsStale) {
        cx.spawn(async (cx) => {
          if (flowsStale) await this.loadFlows(cx);
          if (runsStale) await this.loadFlowRuns(cx);
          this.syncFlowSelection(this.currentRoute(), cx);
          cx.notify();
        });
      } else {
        this.syncFlowSelection(route, cx);
      }
    } else if (route.page === "pipelines") {
      const stale = !this.pipelineRuns || Date.now() - this.pipelineRunsAt > 15000;
      if (stale) {
        cx.spawn(async (cx) => {
          await this.loadPipelineRuns(cx);
          this.syncPipelineSelection(this.currentRoute(), cx);
          cx.notify();
        });
      } else {
        this.syncPipelineSelection(route, cx);
      }
    } else if (route.page === "commands") {
      if (!this.commandCatalog) cx.spawn(async () => { await this.loadCommands(); });
    } else if (route.page === "settings") {
      if (!this.version) cx.spawn((cx) => this.loadVersion(cx));
    }
  }

  openInWindow(route, cx) {
    this.lastCx = cx;
    const target = normalizeRoute(route);
    if (this.isApp) {
      this.navigate(target.page, target.page === "ticket" ? { id: target.id } : target, cx);
      return;
    }
    const state = shared("fabric.window");
    if (state?.id) {
      setShared("fabric.openRequest", { at: Date.now(), route: target });
      return;
    }
    if (target.id) setShared("fabric.selected", target.id);
    setShared("fabric.route", target);
    const id = openOverlay({
      mod: "fabric",
      kind: "window",
      key: "fabric",
      keep: true,
      frame: "none",
      width: 0.86,
      height: 0.86,
      props: { view: "app" },
    });
    setShared("fabric.window", { id });
  }

  openRequested(route, cx) {
    const target = normalizeRoute(route);
    this.navigate(target.page, target.page === "ticket" ? { id: target.id } : target, cx);
  }

  toggleWindow(cx) {
    const state = shared("fabric.window");
    if (state?.id) {
      if (this.isApp) this.closeWindowWithGuard(cx);
      else setShared("fabric.closeRequest", { at: Date.now() });
      return;
    }
    this.openInWindow(this.currentRoute(), cx);
  }

  closeWindow(cx) {
    const id = this.overlayId ?? shared("fabric.window")?.id;
    if (id) closeOverlay(id);
    if (shared("fabric.window")?.id === id) setShared("fabric.window", null);
  }

  requestNewTicket(cx) {
    setShared("fabric.newRequest", Date.now());
    if (!shared("fabric.window")?.id) {
      this.openInWindow({ page: "board" }, cx);
      setShared("fabric.newRequest", Date.now());
    }
  }

  // ---------- Tasten ----------

  commandLoop(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        let command = null;
        try {
          command = await nextCommand();
        } catch {
          return;
        }
        if (this.closed) return;
        this.handleCommand(command, cx);
      }
    });
  }

  handleCommand(command, cx) {
    if (command === "open") {
      const request = shared("fabric.openRequest");
      if (request?.route) {
        setShared("fabric.openRequest", null);
        this.openInWindow(request.route, cx);
      }
      return;
    }
    if (command === "window") {
      this.toggleWindow(cx);
      return;
    }
    if (command === "tickets") this.showStack("fabric-tickets");
    else if (command === "timeline") this.showStack("fabric-timeline");
    else if (command === "new") {
      if (this.isApp) this.openNewTicket(cx);
      else {
        this.showStack("fabric-tickets", true);
        this.requestNewTicket(cx);
      }
    }
  }

  showStack(child, force = false) {
    const current = model.panelState(layout());
    if (!force && current.shown && current.active === child) {
      run("layout.hide", { id: "panel" });
      return;
    }
    run("layout.show", { id: "panel" });
    run("layout.select", { stack: "panel-body", child });
  }

  keys(event, cx) {
    const keystroke = event.keystroke;
    if (this.imageOpen) {
      cx.stop_propagation();
      if (keystroke === "escape") { this.imageOpen = null; this.notifyNow(); }
      return;
    }
    if (keystroke === "escape" && this.mentions.field && this.mentions.suggestions.length) {
      cx.stop_propagation();
      this.clearMentions(cx);
      return;
    }
    if (this.modal) {
      if (keystroke === "escape") {
        cx.stop_propagation();
        this.closeModal(cx);
      }
      return;
    }
    if (keystroke === "cmd-s") {
      cx.stop_propagation();
      this.saveActive(cx);
      return;
    }
    if (keystroke === "cmd-enter") {
      cx.stop_propagation();
      if (this.currentRoute().page === "ticket") this.comment(cx);
      return;
    }
    if (keystroke === "cmd-n") {
      cx.stop_propagation();
      this.openNewTicket(cx);
      return;
    }
    if (keystroke === "escape") {
      cx.stop_propagation();
      if (this.menu) { this.menu = null; this.notifyNow(); return; }
      if (this.autopilotOpen) { this.autopilotOpen = false; this.notifyNow(); return; }
      if (this.newTeamOpen) { this.closeNewTeam(cx); return; }
      if (this.newOpen) { this.newOpen = false; this.clearMentions(this.lastCx); this.notifyNow(); return; }
      if (this.blueprintDrawer) { this.closeBlueprintDrawer(cx); return; }
      if (this.contextPreview) { this.closeContextPreview(cx); return; }
      if (this.teamPrompt) { this.closeTeamPrompt(cx); return; }
      const route = this.currentRoute();
      if (route.page === "ticket") { this.navigate("tickets", {}, cx); return; }
      this.closeWindowWithGuard(cx);
      return;
    }
    if (!this.fieldFocused && keystroke === "/") {
      cx.stop_propagation();
      this.search.focus();
      return;
    }
    if (!this.fieldFocused && (keystroke === "up" || keystroke === "down")) {
      cx.stop_propagation();
      this.moveCursor(keystroke === "down" ? 1 : -1, cx);
      return;
    }
    if (!this.fieldFocused && keystroke === "enter" && this.cursorId) {
      cx.stop_propagation();
      this.navigate("ticket", { id: this.cursorId }, cx);
    }
  }

  listIds() {
    const route = this.currentRoute();
    const filters = this.filters();
    if (route.page === "board") {
      return model.boardColumns(this.tickets, filters).flatMap((column) => column.tickets.map((ticket) => ticket.id));
    }
    if (route.page === "tickets") {
      return model.sortTickets(model.filterTickets(this.tickets, filters), this.tableSort)
        .map((ticket) => ticket.id);
    }
    return [];
  }

  moveCursor(delta, cx) {
    const ids = this.listIds();
    if (!ids.length) return;
    const current = ids.indexOf(this.cursorId);
    const next = current < 0
      ? (delta > 0 ? 0 : ids.length - 1)
      : Math.max(0, Math.min(ids.length - 1, current + delta));
    this.cursorId = ids[next];
    this.notifyNow();
  }

  filters() {
    return {
      query: this.search.value(),
      assignee: this.assigneeFilter,
      repo: this.repoFilter,
      includeDropped: this.showDropped,
    };
  }

  saveActive(cx) {
    const route = this.currentRoute();
    if (this.titleEdit && model.isDirty(this.titleEdit.value(), this.titleSaved)) this.saveTitle(cx);
    else if (route.page === "ticket" && this.bodyEditor && this.bodyEditing
      && model.isDirty(this.bodyEditor.value(), this.bodySaved)) this.saveBody(cx);
    else if (route.page === "prompts") this.savePrompt(cx);
    else if (route.page === "templates") this.saveTemplate(cx);
    else if (route.page === "repos") this.saveRepo(cx);
    else if (this.blueprintDrawer) this.saveBlueprint(cx);
    else if (this.teamPrompt) this.saveTeamPrompt(cx);
    else if (route.page === "team") this.saveChangedTeams(cx);
  }

  // ---------- Änderungen schützen ----------

  dirtySections() {
    const entries = [];
    if (this.titleEdit && model.isDirty(this.titleEdit.value(), this.titleSaved)) {
      entries.push({ key: "title", label: "Titel des Tickets" });
    }
    if (this.bodyEditor && model.isDirty(this.bodyEditor.value(), this.bodySaved)) {
      entries.push({ key: "body", label: "Beschreibung des Tickets" });
    }
    if (this.promptEditor && model.isDirty(this.promptEditor.value(), this.promptSaved)) {
      entries.push({ key: "prompt", label: `Prompt ${this.promptName ?? ""}` });
    }
    if (this.templateEditor && model.isDirty(this.templateEditor.value(), this.templateSaved)) {
      entries.push({ key: "template", label: `Vorlage ${this.templateName ?? ""}` });
    }
    if (this.repoDetail) {
      if (this.verifyEditor && model.isDirty(this.verifyEditor.value(), this.verifySaved)) {
        entries.push({ key: "verify", label: "Prüfskript" });
      }
      if (this.lessonsEditor && model.isDirty(this.lessonsEditor.value(), this.lessonsSaved)) {
        entries.push({ key: "lessons", label: "Lernnotizen" });
      }
      if (this.projectEditor && model.isDirty(this.projectEditor.value(), this.projectSaved)) {
        entries.push({ key: "project", label: "Steckbrief" });
      }
    }
    if (this.blueprintDrawer && this.blueprintDirty) {
      entries.push({ key: "blueprint", label: "Blaupause im Drawer" });
    }
    if (this.teamPromptDirty()) {
      entries.push({ key: "team-prompt", label: `Orchestrator-Prompt ${this.teamPrompt.team}` });
    }
    for (const team of this.roster?.teams ?? []) {
      if (this.teamFormDirty(team.name)) {
        entries.push({ key: `team:${team.name}`, label: `Team ${team.name}` });
      }
    }
    return entries;
  }

  guard(action, cx) {
    const dirty = this.dirtySections();
    if (!dirty.length) {
      action();
      return;
    }
    this.modal = {
      kind: "unsaved",
      dirty,
      then: () => { this.modal = null; action(); },
    };
    cx?.notify();
  }

  async saveDirty(cx) {
    const dirty = this.dirtySections();
    let ok = true;
    for (const entry of dirty) {
      if (entry.key === "title") ok = await this.saveTitle(cx, true);
      if (entry.key === "body") ok = await this.saveBody(cx, true);
      if (entry.key === "prompt") ok = await this.savePrompt(cx, true);
      if (entry.key === "template") ok = await this.saveTemplate(cx, true);
      if (entry.key === "verify" || entry.key === "lessons" || entry.key === "project") ok = await this.saveRepo(cx, entry.key, true);
      if (entry.key === "blueprint") ok = await this.saveBlueprint(cx, true);
      if (entry.key === "team-prompt") ok = await this.saveTeamPrompt(cx, true);
      if (entry.key.startsWith("team:")) ok = await this.saveTeam(entry.key.slice(5), cx, true);
      if (!ok) break;
    }
    return ok;
  }

  discardDirty(cx) {
    if (this.titleEdit) this.titleEdit.set_value(this.titleSaved);
    if (this.bodyEditor) this.bodyEditor.set_value(this.bodySaved);
    if (this.promptEditor) this.promptEditor.set_value(this.promptSaved);
    if (this.templateEditor) this.templateEditor.set_value(this.templateSaved);
    if (this.verifyEditor) this.verifyEditor.set_value(this.verifySaved);
    if (this.lessonsEditor) this.lessonsEditor.set_value(this.lessonsSaved);
    if (this.projectEditor) this.projectEditor.set_value(this.projectSaved);
    if (this.blueprintDrawer) this.blueprintDirty = false;
    if (this.teamPrompt) this.teamPrompt.editor.set_value(this.teamPrompt.saved);
    this.resetTeamForms();
    this.titleEdit = null;
    this.bodyEditing = false;
    this.clearMentions();
    cx?.notify();
  }

  closeModal(cx) {
    const modal = this.modal;
    if (modal?.kind === "unsaved-close" || modal?.kind === "unsaved") {
      this.modal = null;
      this.notifyNow();
      return;
    }
    this.modal = null;
    this.notifyNow();
  }

  closeWindowWithGuard(cx) {
    const dirty = this.dirtySections();
    if (!dirty.length) {
      this.closeWindow(cx);
      return;
    }
    this.modal = {
      kind: "unsaved-close",
      dirty,
      then: () => { this.modal = null; this.closeWindow(cx); },
    };
    this.notifyNow();
  }

  // ---------- Konfiguration lesen ----------

  ensurePrograms(cx) {
    if (!cx) return;
    if (this.programs && Date.now() - this.programsAt < 60000) return;
    cx.spawn(async (cx) => {
      try {
        this.programs = await knownAgentsSafe();
        this.programsAt = Date.now();
      } catch (error) {
        this.programs = [];
        this.setError("programs", `Programme nicht lesbar: ${message(error)}`);
      }
      this.notifyNow();
    });
  }

  async loadRoster(cx) {
    try {
      const result = await this.execFab(["roster", "--json"]);
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!raw) throw new Error("roster --json lieferte kein JSON");
      this.roster = {
        max_sessions: raw.max_sessions ?? 4,
        reviewer: raw.reviewer ?? "",
        orchestrator: raw.orchestrator ?? { argv: [], prompt: "" },
        team: raw.team ?? (raw.teams ?? [])[0]?.name ?? null,
        agents: (raw.agents ?? []).map((agent) => {
          const parts = model.argvParts(agent.argv ?? []);
          return {
            ...agent,
            program: agent.program ?? parts.program,
            model: agent.model ?? parts.model,
            flags: agent.flags ?? parts.flags,
            open_tickets: agent.open_tickets ?? 0,
            sessions: agent.sessions ?? [],
            teams: agent.teams ?? [],
          };
        }),
        blueprints: (raw.blueprints ?? [])
          .filter((blueprint) => blueprint?.name)
          .map((blueprint) => ({
            ...blueprint,
            role: blueprint.role ?? "",
            color: blueprint.color ?? "",
            argv: blueprint.argv ?? [],
            teams: blueprint.teams ?? [],
            prompt: blueprint.prompt ?? "",
          })),
        teams: (raw.teams ?? [])
          .filter((team) => team?.name)
          .map((team) => ({
            ...team,
            repos: team.repos ?? [],
            members: (team.members ?? []).filter((member) => member?.blueprint),
            reviewer: team.reviewer ?? "",
            max_sessions: team.max_sessions ?? 4,
            orchestrator: team.orchestrator ?? { argv: [], prompt: "" },
            agents: team.agents ?? [],
          })),
      };
      this.rosterError = null;
      this.rosterAt = Date.now();
      this.syncTeamForms();
    } catch (error) {
      this.rosterError = `Roster nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  async loadPrompts(cx) {
    try {
      const result = await this.execFab(["prompt", "list", "--json"]);
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!Array.isArray(raw)) throw new Error("prompt list --json lieferte keine Liste");
      this.promptList = model.sortPrompts(raw);
      this.promptError = null;
      this.promptsAt = Date.now();
    } catch (error) {
      this.promptError = `Prompts nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  async loadPrompt(name, cx) {
    if (!name) return;
    if (this.promptEditor && this.promptName !== name && model.isDirty(this.promptEditor.value(), this.promptSaved)) {
      return;
    }
    const known = (this.promptList ?? []).find((prompt) => prompt.name === name);
    try {
      const result = await this.execFab(["prompt", "show", name], { timeout: 20000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      this.promptName = name;
      this.promptKind = known?.kind ?? (name === "orchestrator" || name === "preamble" ? name : "agent");
      this.promptBytes = known?.bytes ?? (result.stdout?.length ?? 0);
      this.promptSaved = result.stdout ?? "";
      this.promptEditor = this.newEditor("markdown", this.promptSaved);
      this.promptWarnings = model.unknownPlaceholders(this.promptSaved);
      this.promptError = null;
    } catch (error) {
      this.promptError = `Prompt ${name} nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  selectPrompt(name, cx, silent = false) {
    const go = () => {
      this.promptName = name;
      setShared("fabric.route", { page: "prompts", name });
      cx.spawn((cx) => this.loadPrompt(name, cx));
      this.notifyNow();
    };
    if (silent) go();
    else this.guard(go, cx);
  }

  async loadRepos(cx) {
    try {
      const folders = [...new Set(spaces()
        .filter((space) => space.machine == null && space.folder)
        .map((space) => space.folder))];
      const args = ["repos", "--json"];
      if (folders.length) args.push("--add", ...folders);
      const result = await this.execFab(args, { timeout: 30000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!Array.isArray(raw)) throw new Error("repos --json lieferte keine Liste");
      this.repos = raw;
      this.reposError = null;
      this.reposAt = Date.now();
    } catch (error) {
      this.reposError = `Repos nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  async loadRepo(path, cx) {
    if (!path) return;
    const previousPath = this.repoDetail?.path;
    try {
      const result = await this.execFab(["repo", "show", path, "--json"], { timeout: 30000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!raw) throw new Error("repo show --json lieferte kein JSON");
      this.repoDetail = raw;
      this.repoError = null;
      this.verifySaved = raw.verify?.text ?? "";
      this.lessonsSaved = raw.lessons?.text ?? "";
      this.projectSaved = raw.project?.text ?? "";
      this.verifyEditor = raw.verify?.exists ? this.newEditor("shell", this.verifySaved) : null;
      this.lessonsEditor = this.newEditor("markdown", this.lessonsSaved);
      this.projectEditor = raw.project?.exists ? this.newEditor("markdown", this.projectSaved) : null;
      this.repoTest = null;
      // Vorschau-Deeplink: einmal die gewünschte Datei zeigen, dann normal weiter.
      const wantedTab = shared("fabric.repoTab");
      this.repoTab = model.repoTabAfterLoad({ wanted: wantedTab, previousPath, path, current: this.repoTab });
      if (model.REPO_TABS.includes(wantedTab)) setShared("fabric.repoTab", null);
    } catch (error) {
      this.repoError = `Repo nicht lesbar: ${message(error)}`;
      this.repoDetail = null;
    }
    this.notifyNow();
  }

  selectRepo(path, cx, silent = false) {
    const go = () => {
      setShared("fabric.route", { page: "repos", path });
      cx.spawn((cx) => this.loadRepo(path, cx));
      this.notifyNow();
    };
    if (silent) go();
    else this.guard(go, cx);
  }

  // ---------- Workflows ----------

  async loadFlows(cx) {
    try {
      const result = await this.execFab(["flow", "list", "--json"]);
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!Array.isArray(raw)) throw new Error("flow list --json lieferte keine Liste");
      this.flows = raw;
      this.flowError = null;
      this.flowAt = Date.now();
    } catch (error) {
      this.flowError = `Workflows nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  async loadFlowRuns(cx) {
    try {
      const result = await this.execFab(["flow", "runs", "--json"]);
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!Array.isArray(raw)) throw new Error("flow runs --json lieferte keine Liste");
      this.flowRuns = raw;
      this.flowRunsError = null;
      this.flowRunsAt = Date.now();
    } catch (error) {
      this.flowRunsError = `Läufe nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  /** Auswahl aus Route und Bestand zusammenführen: Route gewinnt, sonst bleibt die Wahl. */
  syncFlowSelection(route = this.currentRoute(), cx = null) {
    const previousName = this.flowName;
    const flows = this.flows ?? [];
    let name = this.flowName;
    if (route.name && flows.some((flow) => flow.name === route.name)) name = route.name;
    if (!flows.some((flow) => flow.name === name)) {
      const withRuns = flows.find((flow) => (this.flowRuns ?? []).some((run) => run.workflow === flow.name));
      name = withRuns?.name ?? flows[0]?.name ?? null;
    }
    const runs = (this.flowRuns ?? []).filter((run) => run.workflow === name);
    let runId = this.flowRunId;
    if (route.run != null) {
      const wanted = Number(route.run);
      if (runs.some((run) => run.id === wanted)) runId = wanted;
    }
    if (!runs.some((run) => run.id === runId)) runId = runs[0]?.id ?? null;
    if (name !== this.flowName || runId !== this.flowRunId) this.flowNode = null;
    this.flowName = name;
    this.flowRunId = runId;
    const mode = route.mode === "builder" || route.mode === "run" ? route.mode : null;
    if (mode) this.flowMode = mode;
    else if (previousName !== name || this.flowMode == null) {
      this.flowMode = runs.length ? "run" : "builder";
    }
    if (this.flowMode === "builder") {
      this.ensureFlowBuilder(name, cx);
    } else if (this.flowBuilder && !this.flowBuilder.dirty && this.flowBuilder.original !== name) {
      this.flowBuilder = null;
    }
  }

  /** Beide Listen neu holen und die Auswahl an Route/Bestand angleichen. */
  async reloadFlows(cx) {
    await this.loadFlows(cx);
    await this.loadFlowRuns(cx);
    this.syncFlowSelection(this.currentRoute(), cx);
    this.notifyNow();
  }

  selectedFlowRun() {
    return (this.flowRuns ?? []).find(
      (run) => run.id === this.flowRunId && run.workflow === this.flowName,
    ) ?? null;
  }

  selectFlow(name, cx) {
    if (!name) return;
    if (name === this.flowName && !this.flowBuilder?.fresh) return;
    if (this.flowBuilder?.dirty) {
      this.flowPendingName = name;
      this.flash = {
        level: "warn",
        text: `Builder hat ungespeicherte Änderungen… „Verwerfen“ verwirft sie und wechselt zu „${name}“.`,
      };
      this.notifyNow();
      return;
    }
    this.flowPendingName = null;
    this.flowBuilder = null;
    this.flowName = name;
    this.flowNode = null;
    const runs = (this.flowRuns ?? []).filter((run) => run.workflow === name);
    this.flowRunId = runs[0]?.id ?? null;
    this.flowMode = runs.length ? "run" : "builder";
    if (this.flowMode === "builder") this.openFlowBuilder(name, cx);
    const route = { page: "workflows", name, mode: this.flowMode };
    if (this.flowMode === "run" && this.flowRunId != null) route.run = this.flowRunId;
    setShared("fabric.route", route);
    this.notifyNow();
    if (!this.flowRuns || Date.now() - this.flowRunsAt > 15000) {
      cx?.spawn?.(async (cx) => {
        await this.loadFlowRuns(cx);
        this.syncFlowSelection(this.currentRoute(), cx);
        cx.notify();
      });
    }
  }

  selectFlowRun(id, cx) {
    const runId = Number(id);
    if (!Number.isFinite(runId)) return;
    this.flowRunId = runId;
    this.flowNode = null;
    this.flowMode = "run";
    const route = { page: "workflows", run: runId, mode: "run" };
    if (this.flowName) route.name = this.flowName;
    setShared("fabric.route", route);
    this.notifyNow();
  }

  // ---------- Pipelines ----------

  async loadPipelineRuns(cx) {
    if (this.pipelineRunsLoading) return;
    this.pipelineRunsLoading = true;
    try {
      const result = await this.execFab(["runs", "--json"], { timeout: 30000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!Array.isArray(raw)) throw new Error("runs --json lieferte keine Liste");
      this.pipelineRuns = raw;
      this.pipelineRunsError = null;
      this.pipelineRunsAt = Date.now();
    } catch (error) {
      this.pipelineRunsError = `Läufe nicht lesbar: ${message(error)}`;
    } finally {
      this.pipelineRunsLoading = false;
      this.notifyNow();
    }
  }

  /** Läufe für Badges und die Pipeline-Seite im TTL-Fenster nachladen. */
  ensurePipelineRuns(cx) {
    if (!this.isApp || !cx || this.pipelineRunsLoading) return;
    if (this.pipelineRuns && Date.now() - this.pipelineRunsAt <= 15000) return;
    cx.spawn(async () => { await this.loadPipelineRuns(); });
  }

  /** Auswahl aus Route und Bestand zusammenführen; geladene Details bleiben stehen. */
  syncPipelineSelection(route = this.currentRoute(), cx = null) {
    this.pipelineFilter = route.ticket ? String(route.ticket) : null;
    const rows = model.pipelineRunsNewest(this.pipelineRuns ?? [])
      .filter((run) => !this.pipelineFilter || run.ticket === this.pipelineFilter);
    let wanted = null;
    if (route.run != null) {
      const number = Number(route.run);
      if (Number.isFinite(number)) wanted = number;
    }
    if (wanted == null) wanted = this.pipelineRunId;
    if (!rows.some((run) => run.id === wanted)) wanted = rows[0]?.id ?? null;
    if (wanted !== this.pipelineRunId) {
      this.pipelineRunId = wanted;
      this.pipelineDetail = null;
      this.pipelineDetailError = null;
      this.pipelineOpen = {};
    }
    if (wanted == null) return;
    if (this.pipelineDetail?.run?.id === wanted) return;
    if (this.pipelineDetailLoading === wanted) return;
    cx?.spawn?.(async () => { await this.loadPipelineRun(wanted); });
  }

  async loadPipelineRun(id, { resetSearch = true } = {}) {
    const runId = Number(id);
    if (!Number.isFinite(runId)) return;
    this.pipelineDetailLoading = runId;
    try {
      const result = await this.execFab(["run", "show", String(runId), "--json"], { timeout: 30000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!raw?.run || !Array.isArray(raw.steps)) {
        throw new Error("run show --json lieferte keinen Lauf");
      }
      if (this.pipelineRunId !== runId) return;
      this.pipelineDetail = raw;
      this.pipelineDetailError = null;
      this.pipelineOpen = model.pipelineOpenSteps(raw.steps);
      if (resetSearch) this.pipelineSearch.set_value("");
    } catch (error) {
      if (this.pipelineRunId === runId) {
        this.pipelineDetailError = `Lauf nicht lesbar: ${message(error)}`;
      }
    } finally {
      if (this.pipelineDetailLoading === runId) this.pipelineDetailLoading = null;
      this.notifyNow();
    }
  }

  selectPipelineRun(id, cx) {
    const runId = Number(id);
    if (!Number.isFinite(runId)) return;
    if (this.pipelineRunId !== runId) {
      this.pipelineDetail = null;
      this.pipelineDetailError = null;
      this.pipelineOpen = {};
    }
    this.pipelineRunId = runId;
    const route = { page: "pipelines", run: runId };
    if (this.pipelineFilter) route.ticket = this.pipelineFilter;
    setShared("fabric.route", route);
    cx?.spawn?.(async () => { await this.loadPipelineRun(runId); });
    this.notifyNow();
  }

  async reloadPipelines(cx) {
    this.pipelineRunsAt = 0;
    await this.loadPipelineRuns(cx);
    this.syncPipelineSelection(this.currentRoute(), cx);
    this.notifyNow();
  }

  /** Einziger Aufrufer von `fab run rerun`; wählt danach den neuen Lauf aus. */
  async rerunPipeline(id, cx) {
    if (this.busy) return;
    this.busy = "pipeline-rerun";
    this.setError("pipeline-rerun", null);
    this.notifyNow();
    let result = null;
    let failure = null;
    try {
      result = await this.execFab(["run", "rerun", String(id)], { timeout: 1300000 });
    } catch (error) {
      failure = `fab ließ sich nicht starten: ${message(error)}`;
    }
    if (failure) {
      this.setError("pipeline-rerun", failure);
      notify({ title: "Fabric", body: failure, level: "error" });
    } else {
      const out = (result.stdout || "").trim();
      if (result.code !== 0) {
        const text = out || (result.stderr || "").trim() || `Exit ${result.code}`;
        this.setError("pipeline-rerun", text, "warn");
        notify({ title: "Fabric", body: text, level: "warning" });
      } else {
        this.setError("pipeline-rerun", null);
        notify({ title: "Fabric", body: out || "Lauf wiederholt.", level: "success" });
      }
    }
    this.busy = "";
    await this.loadPipelineRuns(cx);
    this.notifyNow();
    if (failure || !result) return;
    const match = /→\s*#(\d+)/.exec(result.stdout || "");
    const newId = match
      ? Number(match[1])
      : model.pipelineRunsNewest(this.pipelineRuns ?? [])[0]?.id ?? null;
    if (!Number.isFinite(newId)) return;
    const route = { page: "pipelines", run: newId };
    if (this.pipelineFilter) route.ticket = this.pipelineFilter;
    setShared("fabric.route", route);
    this.pipelineRunId = newId;
    this.pipelineDetail = null;
    this.pipelineDetailError = null;
    this.pipelineOpen = {};
    await this.loadPipelineRun(newId);
    this.notifyNow();
  }

  // ---------- Workflow-Builder ----------

  setFlowMode(mode, cx) {
    if (mode !== "run" && mode !== "builder") return;
    this.flowMode = mode;
    if (mode === "builder") this.ensureFlowBuilder(this.flowName, cx);
    const route = { page: "workflows", mode };
    if (this.flowName) route.name = this.flowName;
    if (mode === "run" && this.flowRunId != null) route.run = this.flowRunId;
    setShared("fabric.route", route);
    this.notifyNow();
  }

  ensureFlowBuilder(name, cx) {
    const builder = this.flowBuilder;
    if (builder) {
      if (builder.dirty) return builder;
      if (builder.fresh) return builder;
      if (builder.original === name) return builder;
    }
    this.openFlowBuilder(name, cx);
    return this.flowBuilder;
  }

  flowNewName() {
    const names = new Set((this.flows ?? []).map((flow) => flow.name));
    let name = "neuer-workflow";
    let suffix = 2;
    while (names.has(name)) {
      name = `neuer-workflow-${suffix}`;
      suffix += 1;
    }
    return name;
  }

  /** Ein neuer Entwurf bekommt sofort Auslöser und Ende, damit er lauffähig ist. */
  flowBuilderStarter(draft) {
    if (Array.isArray(draft.nodes) && draft.nodes.length) return draft;
    let next = draft;
    const trigger = model.flowAddNode(next, "trigger");
    next = trigger.definition;
    const end = model.flowAddNode(next, "end");
    next = end.definition;
    if (trigger.id && end.id) next = model.flowConnect(next, trigger.id, end.id).definition;
    return next;
  }

  openFlowBuilder(name, cx) {
    const flow = name ? (this.flows ?? []).find((row) => row.name === name) ?? null : null;
    let draft = flow ? model.flowLoad(flow) : model.flowNewDefinition(name ?? this.flowNewName());
    if (!flow) draft = this.flowBuilderStarter(draft);
    const builder = {
      original: flow ? flow.name : null,
      fresh: !flow,
      draft,
      saved: model.flowSerialize(draft),
      selected: null,
      connectFrom: null,
      form: null,
      focusField: null,
      errors: [],
      dirty: false,
      saving: false,
      dropdown: null,
      placeholderHint: false,
    };
    this.flowBuilder = builder;
    builder.errors = model.flowValidate(draft).errors ?? [];
    // Ein neuer Entwurf startet mit dem Namen; bestehende zeigen den ersten
    // Agentenschritt, damit Prompt und Platzhalter sofort sichtbar sind.
    if (flow) {
      const first = (draft.nodes ?? []).find((node) => node.type === "agent")
        ?? (draft.nodes ?? [])[0] ?? null;
      if (first) builder.selected = { kind: "node", id: first.id };
    }
    this.flowBuilderBuildForm(cx);
    this.notifyNow();
  }

  newFlowBuilder(cx) {
    this.flowMode = "builder";
    this.flowBuilder = null;
    this.openFlowBuilder(null, cx);
    const route = { page: "workflows", mode: "builder" };
    if (this.flowName) route.name = this.flowName;
    setShared("fabric.route", route);
    this.notifyNow();
  }

  flowBuilderRefresh(cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    builder.errors = model.flowValidate(builder.draft).errors ?? [];
    builder.dirty = model.flowSerialize(builder.draft) !== builder.saved;
    if (cx) cx.notify();
    else this.notifyNow();
  }

  flowBuilderBuildForm(cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    const fields = {};
    const multiline = new Set(["prompt", "command", "text", "expr"]);
    const add = (name, value, options = {}) => {
      const state = multiline.has(name)
        ? TextareaState.new({
          value: value == null ? "" : String(value),
          placeholder: options.placeholder ?? "",
        })
        : InputState.new({
          value: value == null ? "" : String(value),
          placeholder: options.placeholder ?? "",
        });
      if (options.step != null && state.set_step) state.set_step(options.step);
      if (options.min != null && state.set_min) state.set_min(options.min);
      state.on("change", (_event, cx) => {
        builder.focusField = name;
        this.flowBuilderField(name, state.value(), cx);
      });
      state.on("focus", (_event, cx) => {
        builder.focusField = name;
        this.fieldFocused = true;
        cx.notify();
      });
      this.track(state);
      fields[name] = state;
    };
    const selected = builder.selected;
    if (selected?.kind === "node") {
      const node = (builder.draft.nodes ?? []).find((row) => row.id === selected.id) ?? null;
      if (node) {
        if (node.type === "trigger") {
          add("every_minutes", node.every_minutes ?? 60, {
            step: 1, min: 1, placeholder: "z. B. 60",
          });
        } else if (node.type === "agent") {
          add("agent", node.agent, { placeholder: "Team oder Agent" });
          add("title", node.title, { placeholder: "Titel des Tickets" });
          add("prompt", node.prompt, { placeholder: "Prompt für den Agenten" });
          add("template", node.template, { placeholder: "Vorlage (optional)" });
        } else if (node.type === "action") {
          add("command", node.command, { placeholder: "Befehl" });
          add("text", node.text, { placeholder: "Text der Benachrichtigung" });
        } else if (node.type === "condition") {
          add("expr", node.expr, { placeholder: "{{abnahme.status}} == done" });
        } else if (node.type === "approval") {
          add("text", node.text, { placeholder: "Freigabetext" });
        }
      }
    } else if (selected?.kind === "edge") {
      const edge = (builder.draft.edges ?? [])[selected.index] ?? null;
      if (edge) add("max_loops", edge.max_loops, { placeholder: "kein Limit" });
    } else if (builder.fresh) {
      add("name", builder.draft.name, { placeholder: "Workflow-Name" });
    }
    builder.form = {
      key: selected?.kind === "node"
        ? `node:${selected.id}`
        : selected?.kind === "edge" ? `edge:${selected.index}` : "flow",
      fields,
    };
    builder.focusField = null;
    builder.placeholderHint = false;
    if (cx) cx.notify();
  }

  flowBuilderSelectNode(id, cx) {
    const builder = this.flowBuilder;
    if (!builder || !id) return;
    builder.selected = { kind: "node", id };
    builder.connectFrom = null;
    builder.dropdown = null;
    this.flowBuilderBuildForm(cx);
    this.flowBuilderRefresh(cx);
  }

  flowBuilderSelectEdge(index, cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    const position = Number(index);
    if (!Number.isFinite(position)) return;
    builder.selected = { kind: "edge", index: position };
    builder.connectFrom = null;
    builder.dropdown = null;
    this.flowBuilderBuildForm(cx);
    this.flowBuilderRefresh(cx);
  }

  flowBuilderSelectClear(cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    builder.selected = null;
    builder.connectFrom = null;
    builder.dropdown = null;
    this.flowBuilderBuildForm(cx);
    this.flowBuilderRefresh(cx);
  }

  flowBuilderPlace(type, cx) {
    const builder = this.flowBuilder;
    if (!builder || !type) return;
    const result = model.flowAddNode(builder.draft, type);
    builder.draft = result.definition;
    builder.selected = result.id ? { kind: "node", id: result.id } : null;
    this.flowBuilderBuildForm(cx);
    this.flowBuilderRefresh(cx);
  }

  flowBuilderStartConnect(id, cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    builder.connectFrom = builder.connectFrom === id ? null : id;
    this.notifyNow();
  }

  flowBuilderClickNode(id, cx) {
    const builder = this.flowBuilder;
    if (!builder || !id) return;
    if (builder.connectFrom && builder.connectFrom !== id) {
      const result = model.flowConnect(builder.draft, builder.connectFrom, id);
      builder.draft = result.definition;
      builder.selected = { kind: "edge", index: result.index };
      builder.connectFrom = null;
      builder.dropdown = null;
      this.flowBuilderBuildForm(cx);
      this.flowBuilderRefresh(cx);
      return;
    }
    builder.connectFrom = null;
    this.flowBuilderSelectNode(id, cx);
  }

  flowBuilderPatchNode(patch, cx) {
    const builder = this.flowBuilder;
    if (!builder || builder.selected?.kind !== "node") return;
    builder.draft = model.flowPatchNode(builder.draft, builder.selected.id, patch);
    this.flowBuilderRefresh(cx);
  }

  flowBuilderField(name, value, cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    const selected = builder.selected;
    if (selected?.kind === "node") {
      let next = value;
      if (name === "every_minutes") {
        const raw = String(value).trim();
        const number = Number(raw);
        next = raw === "" ? null : Number.isFinite(number) ? number : raw;
      }
      this.flowBuilderPatchNode({ [name]: next }, cx);
      return;
    }
    if (selected?.kind === "edge") {
      let next = value;
      if (name === "max_loops") {
        const raw = String(value).trim();
        const number = Number(raw);
        next = raw === "" ? null : Number.isFinite(number) ? number : raw;
      }
      builder.draft = model.flowPatchEdge(builder.draft, selected.index, { [name]: next });
      this.flowBuilderRefresh(cx);
      return;
    }
    builder.draft = { ...builder.draft, name: String(value) };
    this.flowBuilderRefresh(cx);
  }

  flowBuilderSetTrigger(value, cx) {
    const builder = this.flowBuilder;
    if (!builder || builder.selected?.kind !== "node") return;
    builder.dropdown = null;
    const node = (builder.draft.nodes ?? []).find((row) => row.id === builder.selected.id);
    const patch = { trigger: value };
    if (value === "cron" && node && node.every_minutes == null) {
      const state = builder.form?.fields?.every_minutes;
      const number = Number(state?.value?.() ?? "");
      patch.every_minutes = Number.isFinite(number) && number > 0 ? number : 60;
    }
    this.flowBuilderPatchNode(patch, cx);
  }

  flowBuilderSetAction(value, cx) {
    const builder = this.flowBuilder;
    if (!builder || builder.selected?.kind !== "node") return;
    builder.dropdown = null;
    const patch = { action: value };
    if (value === "shell" || value === "fab") {
      const state = builder.form?.fields?.command;
      const text = String(state?.value?.() ?? "");
      if (text.trim()) patch.command = text;
    } else if (value === "notify") {
      const state = builder.form?.fields?.text;
      const text = String(state?.value?.() ?? "");
      if (text.trim()) patch.text = text;
    }
    this.flowBuilderPatchNode(patch, cx);
  }

  flowBuilderSetEdgeWhen(value, cx) {
    const builder = this.flowBuilder;
    if (!builder || builder.selected?.kind !== "edge") return;
    builder.dropdown = null;
    builder.draft = model.flowPatchEdge(builder.draft, builder.selected.index, {
      when: value ? value : null,
    });
    this.flowBuilderRefresh(cx);
  }

  flowBuilderDeleteNode(cx) {
    const builder = this.flowBuilder;
    if (!builder || builder.selected?.kind !== "node") return;
    builder.draft = model.flowRemoveNode(builder.draft, builder.selected.id);
    builder.selected = null;
    builder.connectFrom = null;
    builder.dropdown = null;
    this.flowBuilderBuildForm(cx);
    this.flowBuilderRefresh(cx);
  }

  flowBuilderDeleteEdge(index, cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    const position = Number(index);
    if (!Number.isFinite(position)) return;
    builder.draft = model.flowRemoveEdge(builder.draft, position);
    if (builder.selected?.kind === "edge") builder.selected = null;
    builder.dropdown = null;
    this.flowBuilderBuildForm(cx);
    this.flowBuilderRefresh(cx);
  }

  flowBuilderInsertPlaceholder(text, cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    const field = builder.focusField;
    const state = field ? builder.form?.fields?.[field] : null;
    if (!state) {
      builder.placeholderHint = true;
      this.notifyNow();
      return;
    }
    builder.placeholderHint = false;
    state.replace(text);
    this.flowBuilderField(field, state.value(), cx);
  }

  flowBuilderDiscard(cx) {
    const builder = this.flowBuilder;
    if (!builder) return;
    this.flowPendingName = null;
    this.flash = null;
    if (builder.original) {
      const flow = (this.flows ?? []).find((row) => row.name === builder.original);
      if (flow) {
        this.openFlowBuilder(flow.name, cx);
        return;
      }
    }
    this.flowBuilder = null;
    this.flowMode = (this.flowRuns ?? []).some((run) => run.workflow === this.flowName)
      ? "run" : "builder";
    if (this.flowMode === "builder") this.ensureFlowBuilder(this.flowName, cx);
    this.notifyNow();
  }

  flowBuilderDiscardPending(cx) {
    const name = this.flowPendingName;
    this.flowPendingName = null;
    this.flash = null;
    this.flowBuilder = null;
    if (name) this.selectFlow(name, cx);
    else this.notifyNow();
  }

  async saveFlowBuilder(cx) {
    const builder = this.flowBuilder;
    if (!builder || builder.saving || this.busy) return false;
    const name = String(builder.draft?.name ?? "").trim();
    const errors = [...(model.flowValidate(builder.draft).errors ?? [])];
    if (!name) errors.push("Workflow braucht einen Namen.");
    if (builder.fresh && name
      && (this.flows ?? []).some((flow) => flow.name === name)) {
      errors.push(`Workflow „${name}“ existiert bereits.`);
    }
    if (errors.length) {
      builder.errors = errors;
      builder.dirty = model.flowSerialize(builder.draft) !== builder.saved;
      this.notifyNow();
      return false;
    }
    builder.saving = true;
    this.setError("flow-save", null);
    this.notifyNow();
    const temp = `${this.dir}/.tmp/workflow-${Date.now()}.json`;
    const draft = { ...builder.draft, name };
    try {
      try {
        await exec("/bin/mkdir", ["-p", `${this.dir}/.tmp`]);
      } catch {
        // mkdir darf scheitern; writeTextFile meldet den eigentlichen Fehler.
      }
      await writeTextFile(temp, model.flowSerialize(draft), null);
      const args = builder.original
        ? ["flow", "edit", builder.original, temp, "--from=mensch"]
        : ["flow", "add", temp, "--from=mensch"];
      const result = await this.action("flow-save", args, {
        success: `Workflow „${name}“ gespeichert.`,
        after: async () => { await this.loadFlows(cx); },
      });
      if (!result.ok) return false;
      builder.original = name;
      builder.fresh = false;
      builder.draft = model.flowLoad(model.flowSerialize(draft));
      builder.saved = model.flowSerialize(builder.draft);
      builder.dirty = false;
      this.flowName = name;
      this.flowMode = "builder";
      this.flowPendingName = null;
      this.flash = null;
      this.flowBuilderRefresh(cx);
      setShared("fabric.route", { page: "workflows", name, mode: "builder" });
      this.notifyNow();
      return true;
    } catch (error) {
      const text = message(error);
      this.setError("flow-save", text);
      notify({ title: "Fabric", body: text, level: "error" });
      this.notifyNow();
      return false;
    } finally {
      try { await exec("/bin/rm", ["-f", temp]); } catch { /* egal */ }
      builder.saving = false;
      this.notifyNow();
    }
  }

  pauseFlowRun(cx) {
    const run = this.selectedFlowRun();
    if (!run || this.busy) return;
    this.action("flow-pause", ["flow", "pause", String(run.id), "--from=mensch"], {
      success: `Lauf ${run.id} pausiert.`,
      after: async () => { await this.loadFlowRuns(cx); },
    });
  }

  cancelFlowRun(cx) {
    const run = this.selectedFlowRun();
    if (!run || this.busy) return;
    this.action("flow-cancel", ["flow", "cancel", String(run.id), "--from=mensch"], {
      success: `Lauf ${run.id} abgebrochen.`,
      after: async () => { await this.loadFlowRuns(cx); },
    });
  }

  async rebuildIndex(cx) {
    await this.action("index", ["index"], { success: "index.json neu erzeugt." });
  }

  async loadVersion(cx) {
    try {
      const result = await this.execFab(["version"], { timeout: 20000 });
      this.version = result.code === 0 ? (result.stdout || "").trim() : null;
      this.versionError = result.code === 0 ? null : ((result.stderr || "").trim() || `Code ${result.code}`);
    } catch (error) {
      this.version = null;
      this.versionError = message(error);
    }
    this.notifyNow();
  }

  newEditor(language, value) {
    const t = ui.colors();
    const state = EditorState.new({
      language,
      value,
      line_numbers: false,
      folding: false,
      soft_wrap: true,
      font_size: ui.FONT.s,
      syntax: {
        keyword: t.ansi5,
        string: t.ansi2,
        comment: t.dim,
        function: t.ansi4,
        type: t.ansi6,
        number: t.ansi3,
        constant: t.ansi1,
        variable: t.foreground,
        operator: t.muted,
        boolean: t.ansi3,
        "string.escape": t.ansi1,
      },
    });
    return this.track(state);
  }

  // ---------- Tickets ----------

  async createFromPanel(cx) {
    if (this.busy) return;
    const sentence = this.newInput.value().trim();
    if (!sentence) {
      this.flash = { level: "error", text: "Bitte einen Satz eingeben." };
      this.notifyNow();
      return;
    }
    const result = await this.action("new", model.newArgs(sentence, { wake: false }), {
      success: (r) => {
        const match = /T-\d+/.exec(r.stdout ?? "");
        return match ? `Ticket ${match[0]} als Entwurf angelegt.` : "Ticket als Entwurf angelegt.";
      },
      after: (r) => {
        const match = /T-\d+/.exec(r.stdout ?? "");
        if (match) this.select(match[0], cx);
      },
    });
    if (result.ok) {
      this.newInput.set_value("");
      this.clearMentions();
    }
  }

  openNewTicket(cx) {
    this.guard(() => this.showNewTicket(cx), cx);
  }

  showNewTicket(cx) {
    this.lastCx = cx;
    this.newOpen = true;
    this.newError = null;
    this.newWake = true;
    this.newRepo = null;
    this.newTemplate = null;
    this.newIssue = null;
    this.newIssues = [];
    this.issuesError = null;
    if (this.newSentence) this.newSentence.release?.();
    this.newSentence = InputState.new({ placeholder: "Ein Satz genügt, z. B. „Login-Fehler beheben“" });
    this.newSentence.on("submit", (_event, cx) => {
      if (this.consumeMentionSubmit("new", cx)) return;
      this.createTicket(cx);
    });
    this.track(this.newSentence);
    this.wireMentions("new", this.newSentence);
    this.ensurePrograms(cx);
    this.ensureReposQuiet(cx);
    this.ensureTemplatesQuiet(cx);
    cx.spawn((cx) => this.loadNewIssues(cx));
    cx.spawn(async (cx) => {
      const cwd = focused()?.cwd;
      if (!cwd) return;
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
        if (top.code === 0 && top.stdout.trim() && !this.newRepo) {
          this.newRepo = top.stdout.trim();
          await this.loadNewIssues(cx);
          if (!this.closed) this.notifyNow();
        }
      } catch {
        // Kein Git-Ordner: Repo bleibt leer.
      }
    });
    cx.timer.after(120, () => this.newSentence?.focus());
    this.notifyNow();
  }

  ensureReposQuiet(cx) {
    if (this.repos && Date.now() - this.reposAt < 30000) return;
    cx.spawn((cx) => this.loadRepos(cx));
  }

  ensureTemplatesQuiet(cx) {
    if (this.templateList && Date.now() - this.templatesAt < 15000) return;
    cx.spawn((cx) => this.loadTemplates(cx));
  }

  async loadNewIssues(cx) {
    const repo = this.newRepo;
    if (!repo) {
      this.newIssues = [];
      this.issuesError = null;
      this.newIssue = null;
      this.notifyNow();
      return;
    }
    try {
      const result = await this.execFab(["issue", "list", `--repo=${repo}`, "--json"], { timeout: 30000 });
      if (this.newRepo !== repo) return;
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!Array.isArray(raw)) throw new Error("issue list --json lieferte keine Liste");
      this.newIssues = raw;
      this.issuesError = null;
      if (this.newIssue != null && !raw.some((issue) => String(issue.number) === String(this.newIssue))) {
        this.newIssue = null;
      }
    } catch (error) {
      if (this.newRepo !== repo) return;
      this.newIssues = [];
      this.newIssue = null;
      this.issuesError = `Issues nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  async createTicket(cx) {
    if (this.busy) return;
    const sentence = (this.newSentence?.value() ?? "").trim();
    const issue = this.newIssue;
    if (!sentence && issue == null) {
      this.newError = "Bitte einen Satz eingeben oder ein Issue wählen.";
      this.notifyNow();
      return;
    }
    const args = model.newArgs(sentence, {
      repo: this.newRepo,
      wake: this.newWake,
      template: this.newTemplate,
      issue,
    });
    const result = await this.action("new", args, {
      success: (r) => {
        const match = /T-\d+/.exec(r.stdout ?? "");
        return match ? `Ticket ${match[0]} angelegt.` : "Ticket angelegt.";
      },
    });
    if (result.ok) {
      const match = /T-\d+/.exec(result.result?.stdout ?? "");
      this.newOpen = false;
      this.newError = null;
      this.clearMentions();
      if (match) {
        if (this.isApp) this.navigate("ticket", { id: match[0] }, cx);
        else this.select(match[0], cx);
      } else if (this.isApp) {
        this.navigate("tickets", {}, cx);
      }
    } else {
      this.newError = this.errorFor("new")?.text ?? "Ticket konnte nicht angelegt werden.";
    }
    this.notifyNow();
  }

  async pickNewRepo(cx) {
    const folder = await pickFolder({ prompt: "Repo wählen" });
    if (!folder) return;
    this.newRepo = folder;
    this.newIssue = null;
    this.newIssues = [];
    this.issuesError = null;
    this.notifyNow();
    await this.loadNewIssues(cx);
  }

  async comment(cx, textOverride = null) {
    const id = this.activeTicketId();
    if (!id) return;
    const text = (textOverride ?? this.commentInput.value()).trim();
    if (!text) {
      this.setError("comment", "Bitte einen Kommentar schreiben.");
      this.notifyNow();
      return;
    }
    const result = await this.action("comment", model.commentArgs(id, text), {
      success: "Kommentar geschrieben.",
    });
    if (result.ok) {
      this.commentInput.set_value("");
      this.clearMentions();
      await this.loadTicket();
    }
    this.notifyNow();
  }

  /** Offene Entscheidungs- oder Lehren-Karte übernehmen bzw. ablehnen. */
  async applyProposal(card, action, cx) {
    const reject = action === "reject";
    const args = reject ? card?.rejectArgs : card?.acceptArgs;
    if (!args?.length) return;
    const kindWord = card.kindWord || model.PROPOSAL_WORDS[card.kind] || "Vorschlag";
    const result = await this.action("proposal", args, {
      success: `${kindWord} ${reject ? "abgelehnt" : "übernommen"}.`,
      after: async () => { await this.loadTicket(); },
    });
    if (result.ok) this.notifyNow();
  }


  async formulate(cx) {
    const id = this.activeTicketId();
    if (!id) return;
    await this.action("formulate", model.commentArgs(id, model.FORMULATE_COMMENT), {
      success: "Der Orchestrator wurde beauftragt.",
    });
  }

  async dispatch(cx) {
    const id = this.activeTicketId();
    if (!id) return;
    const ticket = this.ticket ?? {};
    const args = ["dispatch", id, "--from=mensch"];
    if (ticket.assignee) args.push(`--agent=${ticket.assignee}`);
    await this.action("dispatch", args, { success: `${id} verteilt.`, timeout: 180000 });
  }

  async verify(cx) {
    const id = this.activeTicketId();
    if (!id) return;
    await this.action("verify", ["verify", id, "--from=mensch"], {
      success: "Prüfung abgeschlossen.",
      timeout: 630000,
    });
    await this.loadPipelineRuns();
  }

  async setStatusOf(id, status, cx) {
    if (!id) return;
    await this.action("status", ["status", id, status, "--from=mensch"], {
      success: `Status: ${model.statusWord(status)}.`,
    });
  }

  async setStatus(status, cx) {
    if (status === this.ticket?.status) return;
    if (status === "dropped") {
      this.openDropModal(cx);
      return;
    }
    await this.setStatusOf(this.activeTicketId(), status, cx);
  }

  async setAssignee(name, cx) {
    const id = this.activeTicketId();
    if (!id) return;
    await this.action("assign", ["assign", id, name, "--from=mensch"], {
      success: `Zuständig: ${name}.`,
    });
  }

  async setRepo(path, cx) {
    if (!this.activeTicketId() || !path) return;
    await this.action("repo", model.editArgs(this.activeTicketId(), { repo: path }), {
      success: `Repo: ${model.repoName(path)}.`,
    });
  }

  copyText(cx, text, label = "Kopiert.") {
    if (!text) return;
    cx.write_to_clipboard(String(text));
    notify({ title: "Fabric", body: label, level: "success" });
  }

  openImage(image) {
    if (!image?.path) return;
    this.imageOpen = { path: image.path, alt: image.alt ?? "" };
    this.notifyNow();
  }

  async attachImage(sourcePath, target, cx) {
    if (this.busy) return false;
    const id = this.activeTicketId();
    if (!id) return false;
    if (!model.isImagePath(sourcePath)) {
      const text = `Nur Bilder: ${model.IMAGE_HINT}.`;
      this.setError("attach", text);
      notify({ title: "Fabric", body: text, level: "error" });
      this.notifyNow();
      return false;
    }
    this.busy = "attach";
    this.setError("attach", null);
    this.notifyNow();
    try {
      const result = await this.execFab(["attach", id, sourcePath, "--no-edit", "--from=mensch"]);
      if (result.code !== 0) {
        const text = (result.stderr || "").trim() || (result.stdout || "").trim()
          || `fab endete mit Code ${result.code}.`;
        this.setError("attach", text);
        notify({ title: "Fabric", body: text, level: "error" });
        return false;
      }
      const reference = (result.stdout ?? "").split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("!["));
      if (!reference) {
        const text = "fab lieferte keinen Bildverweis.";
        this.setError("attach", text);
        notify({ title: "Fabric", body: text, level: "error" });
        return false;
      }
      if (!this.insertImageRef(target, reference, cx)) return false;
      notify({ title: "Fabric", body: "Bild angehängt.", level: "success" });
      return true;
    } catch (error) {
      const text = `Bild anhängen ging nicht: ${message(error)}`;
      this.setError("attach", text);
      notify({ title: "Fabric", body: text, level: "error" });
      return false;
    } finally {
      this.busy = "";
      this.notifyNow();
    }
  }

  insertImageRef(target, reference, cx) {
    if (target === "body") {
      if (!this.bodyEditor) return false;
      const next = model.insertAttachment(
        this.bodyEditor.value(), this.bodyEditor.selected_range(), reference,
      );
      this.bodyEditor.set_value(next.text);
      this.bodyEditor.set_selected_range({ start: next.caret, end: next.caret });
      this.bodyEditing = true;
      this.bodyEditor.focus();
      this.notifyNow();
      return true;
    }
    if (target === "comment") {
      const next = model.insertAttachment(
        this.commentInput.value(), this.commentInput.selected_range(), reference,
      );
      this.commentInput.set_value(next.text);
      this.commentInput.set_selected_range({ start: next.caret, end: next.caret });
      this.commentInput.focus();
      this.refreshMentions("comment", cx);
      this.notifyNow();
      return true;
    }
    return false;
  }

  async pickImage(target, cx) {
    let result = null;
    try {
      result = await exec("/usr/bin/osascript", ["-e", 'POSIX path of (choose file with prompt "Bild wählen" of type {"public.png", "public.jpeg", "com.compuserve.gif", "org.webmproject.webp"})']);
    } catch (error) {
      const text = `Bild wählen ging nicht: ${message(error)}`;
      this.setError("attach", text);
      notify({ title: "Fabric", body: text, level: "error" });
      this.notifyNow();
      return false;
    }
    if (result.code === 0) {
      const path = (result.stdout || "").trim();
      if (!path) return false;
      return this.attachImage(path, target, cx);
    }
    const stderr = result.stderr || "";
    if (stderr.includes("User canceled") || stderr.includes("-128")) return false;
    const text = `Bild wählen ging nicht: ${stderr.trim() || `osascript endete mit Code ${result.code}.`}`;
    this.setError("attach", text);
    notify({ title: "Fabric", body: text, level: "error" });
    this.notifyNow();
    return false;
  }

  async pasteImage(target, cx) {
    const temp = `${this.dir}/.tmp/paste-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    try {
      try {
        await exec("/bin/mkdir", ["-p", `${this.dir}/.tmp`]);
      } catch {
        // mkdir darf scheitern; osascript meldet den eigentlichen Fehler.
      }
      let stored = false;
      try {
        const result = await exec("/usr/bin/osascript", [
          "-e", "on run argv",
          "-e", "set targetPath to item 1 of argv",
          "-e", "set pngData to the clipboard as «class PNGf»",
          "-e", "set fh to open for access (POSIX file targetPath) with write permission",
          "-e", "set eof fh to 0",
          "-e", "write pngData to fh",
          "-e", "close access fh",
          "-e", "end run",
          temp,
        ]);
        stored = result.code === 0;
      } catch {
        stored = false;
      }
      if (!stored) {
        const text = "Zwischenablage enthält kein Bild.";
        this.setError("attach", text);
        notify({ title: "Fabric", body: text, level: "error" });
        this.notifyNow();
        return false;
      }
      return await this.attachImage(temp, target, cx);
    } finally {
      try { await exec("/bin/rm", ["-f", temp]); } catch { /* egal */ }
    }
  }

  async dropImages(paths, target, cx) {
    const images = (paths ?? []).filter((path) => model.isImagePath(path));
    if (!images.length) {
      const text = `Nur Bilder: ${model.IMAGE_HINT}.`;
      this.setError("attach", text);
      notify({ title: "Fabric", body: text, level: "error" });
      this.notifyNow();
      return;
    }
    for (const path of images) await this.attachImage(path, target, cx);
  }

  async setBase(base, cx) {
    const id = this.activeTicketId();
    if (!id || !base.trim()) return;
    await this.action("base", model.editArgs(id, { base: base.trim() }), {
      success: `Basis: ${base.trim()}.`,
    });
  }

  async pickTicketRepo(cx) {
    const folder = await pickFolder({ prompt: "Repo wählen" });
    if (folder) await this.setRepo(folder, cx);
  }

  async addBlocker(id, cx) {
    const ticketId = this.activeTicketId();
    if (!ticketId || !id) return;
    await this.action("link", ["link", ticketId, "--blocked-by", id, "--from=mensch"], {
      success: `Blockiert durch ${id}.`,
    });
  }

  async removeBlocker(id, cx) {
    const ticketId = this.activeTicketId();
    if (!ticketId || !id) return;
    await this.action("link", ["link", ticketId, "--remove", id, "--from=mensch"], {
      success: `Blockade ${id} entfernt.`,
    });
  }

  async saveTitle(cx, silent = false) {
    if (!this.titleEdit || !this.activeTicketId()) return false;
    const title = this.titleEdit.value().trim();
    if (!title) {
      this.setError("title", "Der Titel darf nicht leer sein.");
      this.notifyNow();
      return false;
    }
    const result = await this.action("title", model.editArgs(this.activeTicketId(), { title }), {
      success: "Titel gespeichert.",
    });
    if (result.ok) {
      this.titleSaved = title;
      this.titleEdit = null;
      this.titleEditFocused = false;
      this.clearMentions();
      await this.loadTicket();
    }
    if (!silent) this.notifyNow();
    return result.ok;
  }

  startTitleEdit(cx) {
    if (!this.ticket) return;
    if (this.titleEdit) this.titleEdit.release?.();
    this.titleSaved = this.ticket.title ?? "";
    this.titleEdit = InputState.new({ value: this.titleSaved });
    this.titleEdit.on("submit", (_event, cx) => {
      if (this.consumeMentionSubmit("title", cx)) return;
      this.saveTitle(cx);
    });
    this.track(this.titleEdit);
    this.wireMentions("title", this.titleEdit);
    this.notifyNow();
    cx.timer.after(60, () => this.titleEdit?.focus());
  }

  cancelTitleEdit(cx) {
    this.titleEdit = null;
    this.clearMentions();
    this.setError("title", null);
    this.notifyNow();
  }

  async saveBody(cx, silent = false) {
    if (!this.bodyEditor || !this.activeTicketId()) return false;
    const text = this.bodyEditor.value();
    const result = await this.action("body", model.editArgs(this.activeTicketId(), { body: text }), {
      success: "Beschreibung gespeichert.",
    });
    if (result.ok) {
      this.bodySaved = text;
      this.bodyEditing = false;
      await this.loadTicket();
    }
    if (!silent) this.notifyNow();
    return result.ok;
  }

  discardBody(cx) {
    if (this.bodyEditor) this.bodyEditor.set_value(this.bodySaved);
    this.bodyEditing = false;
    this.setError("body", null);
    this.notifyNow();
  }

  async accept(cx) {
    const id = this.modal?.ticket?.id ?? this.activeTicketId();
    if (!id) return;
    await this.loadChanges({ force: true });
    const gate = model.changesGate(this.changes, this.changesSeenHead);
    if (!gate.enabled) {
      this.modal = null;
      this.setError("accept", gate.reason);
      this.notifyNow();
      return;
    }
    this.modal = null;
    await this.action("accept", model.acceptArgs(id), {
      success: `${id} abgenommen.`,
      timeout: 180000,
    });
  }

  async acceptPrOnly(cx) {
    const id = this.modal?.ticket?.id ?? this.activeTicketId();
    if (!id) return;
    this.modal = null;
    await this.action("accept-pr", model.acceptArgs(id, { prOnly: true }), {
      success: (result) => {
        const url = model.prUrl(result?.stdout ?? "");
        return url ? `PR bereit: ${url}` : `${id}: PR geöffnet.`;
      },
      timeout: 180000,
    });
  }

  async reject(cx) {
    const id = this.activeTicketId();
    if (!id) return;
    const text = this.commentInput.value().trim();
    if (!text) {
      this.setError("reject", "Bitte Feedback eingeben – es steht im Kommentarfeld.");
      this.notifyNow();
      return;
    }
    const result = await this.action("reject", model.rejectArgs(id, text), {
      success: `${id} mit Feedback zurückgegeben.`,
    });
    if (result.ok) {
      this.commentInput.set_value("");
      this.clearMentions();
    }
    this.notifyNow();
  }

  async drop(cx) {
    const id = this.modal?.ticket?.id ?? this.activeTicketId();
    if (!id || !this.modal?.reason) return;
    const reason = this.modal.reason.value().trim();
    if (!reason) {
      this.setError("drop", "Bitte einen Grund angeben.");
      this.notifyNow();
      return;
    }
    this.modal = null;
    await this.action("drop", model.dropArgs(id, reason), {
      success: `${id} verworfen.`,
    });
  }

  async reopen(cx) {
    await this.setStatus("draft", cx);
  }

  openWake(cx) {
    if (!this.ticket) return;
    this.wakeOpen = true;
    this.wakeName = this.ticket.assignee || this.ticketAgents()[0]?.name || this.agents[0]?.name || "";
    this.wakeText = InputState.new({ placeholder: "Was soll der Agent tun?" });
    this.wakeText.on("submit", (_event, cx) => {
      if (this.consumeMentionSubmit("wake", cx)) return;
      this.sendWake(cx);
    });
    this.track(this.wakeText);
    this.wireMentions("wake", this.wakeText);
    this.clearMentions();
    this.notifyNow();
    const revealWake = () => {
      try {
        (this.compact ? this.historyScroll : this.propsScroll).scroll_to_item(this.propsEndIndex);
      } catch { /* noch kein Layout */ }
    };
    cx.timer.after(60, () => {
      this.wakeText?.focus();
      revealWake();
    });
    // Das Textfeld bekommt den Fokus erst nach dem Layout; danach noch einmal
    // ans Panelende springen, damit das Formular vollständig sichtbar bleibt.
    cx.timer.after(260, () => { if (this.wakeOpen) revealWake(); });
  }

  closeWake(cx) {
    this.wakeOpen = false;
    this.wakeText = null;
    this.clearMentions();
    cx?.notify();
  }

  async sendWake(cx) {
    const id = this.activeTicketId();
    if (!id || !this.wakeName) return;
    const text = this.wakeText?.value().trim() ?? "";
    const args = model.wakeArgs(id, this.wakeName, "mensch", text);
    const result = await this.action("wake", args, { success: `${this.wakeName} geweckt.` });
    if (result.ok) {
      this.wakeOpen = false;
      this.wakeText = null;
      this.clearMentions();
    }
    this.notifyNow();
  }

  /** Fehlgeschlagenen Agentenstart aus dem Posteingang wiederholen. */
  async retryAgent(entry, cx) {
    const retry = model.inboxRetry(entry);
    if (!retry) return;
    const result = await this.action("retry", retry.args, {
      success: (result) => {
        const out = result?.stdout ?? "";
        if (out.includes("start fehlgeschlagen")) {
          return `Start weiterhin fehlgeschlagen - Grund im Ticket ${entry.ticket}.`;
        }
        return `${retry.agent === "orchestrator" ? "Team-Orchestrator" : retry.agent} erneut gestartet.`;
      },
    });
    if (result.ok) this.notifyNow();
  }

  async openAcceptModal(cx) {
    const ticket = this.ticket;
    if (!ticket) return;
    await this.loadChanges({ force: true });
    const gate = model.changesGate(this.changes, this.changesSeenHead);
    if (!gate.enabled) {
      this.setError("accept", gate.reason);
      this.notifyNow();
      return;
    }
    this.setError("accept", null);
    this.modal = { kind: "accept", ticket };
    this.notifyNow();
  }

  openDropModal(cx, ticket = this.ticket) {
    if (!ticket) return;
    const reason = InputState.new({ placeholder: "Grund für das Verwerfen" });
    reason.on("change", (_event, cx) => cx.notify());
    this.track(reason);
    this.modal = { kind: "drop", ticket, reason };
    this.notifyNow();
  }

  // ---------- Team ----------

  firstTeamName() {
    return this.roster?.teams?.[0]?.name ?? this.roster?.team ?? null;
  }

  teamFor(name) {
    return (this.roster?.teams ?? []).find((team) => team.name === name) ?? null;
  }

  blueprintFor(name) {
    return (this.roster?.blueprints ?? []).find((row) => row.name === name) ?? null;
  }

  openBlueprintDrawer(mode, blueprint, cx) {
    const next = { mode, original: blueprint?.name ?? "" };
    if (model.sameBlueprintDraft(this.blueprintDrawer, next)) {
      this.notifyNow();
      return;
    }
    if (this.teamPromptDirty()
      || model.blueprintSwitchNeedsConfirm(this.blueprintDrawer, next, this.blueprintDirty)) {
      // Der offene Drawer gehört einer anderen Blaupause oder einem Prompt; erst speichern oder verwerfen.
      this.guard(() => this.showBlueprintDrawer(mode, blueprint, cx), cx);
      return;
    }
    this.showBlueprintDrawer(mode, blueprint, cx);
  }

  showBlueprintDrawer(mode, blueprint, cx) {
    // Ein offenes Dropdown darf nicht in die neue Blaupause hineinwählen.
    this.menu = null;
    if (this.teamPrompt) this.clearTeamPrompt(cx);
    this.blueprintDraftId += 1;
    const draftId = this.blueprintDraftId;
    const draft = model.blueprintDraft(blueprint);
    this.blueprintDirty = false;
    this.blueprintDrawer = { mode, original: draft.original };
    this.blueprintOriginal = draft.original;
    this.blueprintPromptPath = draft.prompt;
    this.blueprintColorKey = blueprint?.color || this.nextBlueprintColor();
    this.blueprintProgram = draft.program;
    this.blueprintName = InputState.new({ value: draft.name });
    this.blueprintRole = InputState.new({ value: draft.role });
    this.blueprintModel = InputState.new({ value: draft.model });
    this.blueprintFlags = InputState.new({ value: draft.flags });
    this.blueprintPrompt = this.newEditor("markdown", "");
    for (const state of [this.blueprintName, this.blueprintRole, this.blueprintModel, this.blueprintFlags]) {
      state.on("change", (_event, cx) => { this.blueprintDirty = true; this.notifyNow(); });
      this.track(state);
    }
    this.blueprintPrompt.on("change", (_event, cx) => {
      if (this.blueprintPromptLoading) return;
      this.blueprintDirty = true;
      this.notifyNow();
    });
    const editor = this.blueprintPrompt;
    this.ensurePrograms(cx);
    this.notifyNow();
    if (blueprint?.name) {
      cx.spawn(async (cx) => {
        let text = null;
        try {
          const result = await this.execFab(["prompt", "show", blueprint.name], { timeout: 20000 });
          if (result.code === 0) text = result.stdout ?? "";
        } catch {
          // Ohne Promptdatei bleibt der Editor leer; fab legt sie beim Speichern an.
        }
        if (text === null) return;
        // Nur der Drawer, der diesen Lauf gestartet hat, darf ihn übernehmen.
        if (!model.promptLoadApplies(
          { draft: draftId, editor, name: blueprint.name },
          { draft: this.blueprintDraftId, editor: this.blueprintPrompt, name: this.blueprintOriginal },
        )) return;
        if (editor.value() !== "") return; // Nutzer tippt bereits im Feld
        const dirty = this.blueprintDirty;
        this.blueprintPromptLoading = true;
        editor.set_value(text);
        this.blueprintPromptLoading = false;
        this.blueprintDirty = dirty;
        this.notifyNow();
      });
    }
  }

  nextBlueprintColor() {
    const used = new Set((this.roster?.blueprints ?? []).map((row) => row.color));
    for (const key of ["c1", "c2", "c3", "c4", "c5", "c6"]) if (!used.has(key)) return key;
    return "c1";
  }

  clearBlueprintDrawer(cx) {
    this.blueprintDraftId += 1;
    this.blueprintDrawer = null;
    this.blueprintDirty = false;
    this.blueprintOriginal = "";
    this.blueprintPromptPath = "";
    this.blueprintName = null;
    this.blueprintRole = null;
    this.blueprintModel = null;
    this.blueprintFlags = null;
    this.blueprintPrompt = null;
    cx?.notify();
  }

  closeBlueprintDrawer(cx) {
    if (!this.blueprintDrawer) return;
    if (this.blueprintDirty) {
      this.modal = {
        kind: "unsaved",
        dirty: this.dirtySections(),
        then: () => this.clearBlueprintDrawer(cx),
      };
      cx?.notify();
    } else {
      this.clearBlueprintDrawer(cx);
    }
  }

  async saveBlueprint(cx, silent = false) {
    if (!this.blueprintDrawer || this.blueprintSaving) return false;
    const draftId = this.blueprintDraftId;
    const draft = {
      mode: this.blueprintDrawer.mode,
      original: this.blueprintOriginal,
      color: this.blueprintColorKey,
    };
    const plan = model.blueprintSaveArgs(draft, {
      name: this.blueprintName.value(),
      role: this.blueprintRole.value(),
      model: this.blueprintModel.value(),
      flags: this.blueprintFlags.value(),
      program: this.blueprintProgram,
      prompt: this.blueprintPrompt.value(),
    });
    if (plan.error) {
      this.setError("blueprint", plan.error);
      this.notifyNow();
      return false;
    }

    this.blueprintSaving = true;
    const result = await this.action("blueprint", plan.args, {
      success: draft.mode === "new"
        ? `Blaupause ${plan.name} angelegt.`
        : `Blaupause ${plan.name} gespeichert.`,
    });
    this.blueprintSaving = false;
    if (result.ok) {
      await this.loadRoster(cx);
      // Ein zwischenzeitlich geöffneter anderer Drawer bleibt stehen.
      if (this.blueprintDraftId === draftId) this.clearBlueprintDrawer();
    }
    if (!silent) this.notifyNow();
    return result.ok;
  }

  confirmDeleteBlueprint(blueprint, cx) {
    this.setError("blueprint-rm", null);
    this.modal = { kind: "delete-blueprint", blueprint };
    this.notifyNow();
  }

  async deleteBlueprint(cx) {
    const blueprint = this.modal?.blueprint;
    if (!blueprint) return;
    this.modal = null;
    const result = await this.action("blueprint-rm", ["blueprint", "rm", blueprint.name, "--from=mensch"], {
      success: `Blaupause ${blueprint.name} entfernt.`,
      after: (result) => {
        this.clearBlueprintDrawer();
        this.loadRoster(cx);
      },
    });
    if (!result.ok) this.modal = { kind: "delete-blueprint", blueprint };
    this.notifyNow();
  }

  // ---------- Teamkarten ----------

  memberForm(member) {
    const modelState = InputState.new({
      value: String(member?.model ?? ""),
      placeholder: "Modell (leer = keine Übersteuerung)",
    });
    const costState = InputState.new({
      value: member?.max_cost == null ? "" : String(member.max_cost),
      placeholder: "max-cost",
    });
    for (const state of [modelState, costState]) {
      state.on("change", (_event, cx) => cx.notify());
      this.track(state);
    }
    return { blueprint: String(member?.blueprint ?? ""), model: modelState, maxCost: costState };
  }

  buildTeamForm(team) {
    const draft = model.teamDraft(team);
    const name = InputState.new({ value: draft.name, placeholder: "Teamname" });
    name.on("change", (_event, cx) => cx.notify());
    this.track(name);
    const maxSessions = InputState.new({ value: String(draft.max_sessions) });
    maxSessions.set_step(1);
    maxSessions.set_min(1);
    maxSessions.set_max(16);
    maxSessions.on("change", (_event, cx) => cx.notify());
    maxSessions.on("submit", (_event, cx) => this.saveTeam(team.name, cx));
    this.track(maxSessions);
    const brief = TextareaState.new({
      value: draft.brief,
      placeholder: "Ziele, Prioritäten, Definition of Done, Glossar, Stil, Entscheider",
    });
    brief.on("change", (_event, cx) => cx.notify());
    this.track(brief);
    const orchestratorModel = InputState.new({
      value: draft.orchestrator_model,
      placeholder: "Standard des Programms",
    });
    orchestratorModel.on("change", (_event, cx) => cx.notify());
    orchestratorModel.on("submit", (_event, cx) => this.saveTeam(team.name, cx));
    this.track(orchestratorModel);
    return {
      name,
      brief,
      orchestratorModel,
      repos: [...draft.repos],
      reviewer: draft.reviewer,
      members: draft.members.map((member) => this.memberForm(member)),
      maxSessions,
      origin: model.teamDraft(team),
    };
  }

  teamFormValues(name) {
    const form = this.teamForms[name];
    if (!form) return null;
    return {
      name: form.name.value(),
      brief: form.brief.value(),
      repos: [...form.repos],
      members: form.members.map((member) => ({
        blueprint: member.blueprint,
        model: member.model.value(),
        max_cost: member.maxCost.value(),
      })),
      reviewer: form.reviewer,
      max_sessions: form.maxSessions.value(),
      orchestrator_model: form.orchestratorModel.value(),
    };
  }

  teamFormDirty(name) {
    const form = this.teamForms[name];
    if (!form) return false;
    return model.teamDirty(form.origin, this.teamFormValues(name));
  }

  /** Roster-Reload: unveränderte Formulare folgen dem neuen Stand, geänderte bleiben. */
  syncTeamForms() {
    const teams = this.roster?.teams ?? [];
    const seen = new Set();
    for (const team of teams) {
      seen.add(team.name);
      const form = this.teamForms[team.name];
      if (!form) {
        this.teamForms[team.name] = this.buildTeamForm(team);
        continue;
      }
      if (this.teamFormDirty(team.name)) continue;
      if (model.teamDirty(team, this.teamFormValues(team.name))) {
        this.teamForms[team.name] = this.buildTeamForm(team);
      }
    }
    for (const name of Object.keys(this.teamForms)) {
      if (!seen.has(name)) delete this.teamForms[name];
    }
  }

  resetTeamForms() {
    const next = {};
    for (const team of this.roster?.teams ?? []) next[team.name] = this.buildTeamForm(team);
    this.teamForms = next;
  }

  addTeamRepo(name, path, cx) {
    const form = this.teamForms[name];
    const clean = String(path ?? "").trim();
    if (!form || !clean || form.repos.includes(clean)) return;
    form.repos.push(clean);
    cx?.notify();
  }

  removeTeamRepo(name, path, cx) {
    const form = this.teamForms[name];
    if (!form) return;
    form.repos = form.repos.filter((repo) => repo !== path);
    cx?.notify();
  }

  async pickTeamRepo(name, cx) {
    const folder = await pickFolder({ prompt: `Repo für Team ${name} wählen` });
    if (folder) this.addTeamRepo(name, folder, cx);
  }

  addTeamMember(name, blueprint, cx) {
    const form = this.teamForms[name];
    if (!form || !blueprint || form.members.some((member) => member.blueprint === blueprint)) return;
    form.members.push(this.memberForm({ blueprint, model: "", max_cost: "" }));
    if (!form.reviewer) form.reviewer = blueprint;
    cx?.notify();
  }

  removeTeamMember(name, blueprint, cx) {
    const form = this.teamForms[name];
    if (!form) return;
    form.members = form.members.filter((member) => member.blueprint !== blueprint);
    cx?.notify();
  }

  setTeamReviewer(name, reviewer, cx) {
    const form = this.teamForms[name];
    if (!form) return;
    form.reviewer = reviewer;
    cx?.notify();
  }

  // ---------- Neues Team ----------

  openNewTeam(cx) {
    this.newTeamId += 1;
    const id = this.newTeamId;
    this.newTeamOpen = true;
    this.newTeamRepos = [];
    this.newTeamMembers = [];
    this.newTeamReviewer = "";
    this.setError("team-add", null);
    if (this.newTeamName) this.newTeamName.release?.();
    this.newTeamName = InputState.new({ placeholder: "z. B. zweit" });
    this.newTeamName.on("change", (_event, cx) => cx.notify());
    this.track(this.newTeamName);
    if (this.newTeamSessions) this.newTeamSessions.release?.();
    this.newTeamSessions = InputState.new({ value: "4" });
    this.newTeamSessions.set_step(1);
    this.newTeamSessions.set_min(1);
    this.newTeamSessions.set_max(16);
    this.newTeamSessions.on("change", (_event, cx) => cx.notify());
    this.newTeamSessions.on("submit", (_event, cx) => this.createTeam(cx));
    this.track(this.newTeamSessions);
    this.ensureReposQuiet(cx);
    cx.timer.after(120, () => {
      if (id === this.newTeamId && this.newTeamOpen) this.newTeamName?.focus();
    });
    this.notifyNow();
  }

  closeNewTeam(cx) {
    this.newTeamOpen = false;
    this.setError("team-add", null);
    this.notifyNow();
    cx?.notify();
  }

  addNewTeamRepo(path, cx) {
    const clean = String(path ?? "").trim();
    if (!clean || this.newTeamRepos.includes(clean)) return;
    this.newTeamRepos.push(clean);
    cx?.notify();
  }

  removeNewTeamRepo(path, cx) {
    this.newTeamRepos = this.newTeamRepos.filter((repo) => repo !== path);
    cx?.notify();
  }

  async pickNewTeamRepo(cx) {
    const folder = await pickFolder({ prompt: "Repo für das neue Team wählen" });
    if (folder) this.addNewTeamRepo(folder, cx);
  }

  addNewTeamMember(name, cx) {
    const clean = String(name ?? "").trim();
    if (!clean || this.newTeamMembers.includes(clean)) return;
    this.newTeamMembers.push(clean);
    cx?.notify();
  }

  removeNewTeamMember(name, cx) {
    this.newTeamMembers = this.newTeamMembers.filter((member) => member !== name);
    if (this.newTeamReviewer === name) this.newTeamReviewer = "";
    cx?.notify();
  }

  setNewTeamReviewer(name, cx) {
    this.newTeamReviewer = String(name ?? "");
    cx?.notify();
  }

  async createTeam(cx) {
    if (this.busy) return;
    const plan = model.teamAddArgs({
      name: this.newTeamName?.value() ?? "",
      repos: [...this.newTeamRepos],
      members: this.newTeamMembers.map((blueprint) => ({ blueprint, model: "", max_cost: "" })),
      reviewer: this.newTeamReviewer,
      max_sessions: this.newTeamSessions?.value() ?? "",
    });
    if (plan.error) {
      this.setError("team-add", plan.error);
      this.notifyNow();
      return;
    }
    const result = await this.action("team-add", plan.args, {
      success: `Team ${plan.name} angelegt.`,
      after: () => this.loadRoster(cx),
    });
    if (result.ok) {
      this.newTeamOpen = false;
      this.setError("team-add", null);
    }
    this.notifyNow();
  }

  confirmDeleteTeam(team, cx) {
    if (!team?.name) return;
    this.setError("team-rm", null);
    this.modal = { kind: "team-delete", team };
    this.notifyNow();
    cx?.notify();
  }

  async deleteTeam(cx) {
    const team = this.modal?.team;
    if (!team?.name || this.busy) return;
    const result = await this.action("team-rm", ["team", "rm", team.name, "--from=mensch"], {
      success: `Team ${team.name} entfernt.`,
      after: async () => {
        if (this.teamPrompt?.team === team.name) this.clearTeamPrompt(cx);
        await this.loadRoster(cx);
      },
    });
    if (!result.ok) this.modal = { kind: "team-delete", team };
    else if (this.modal?.kind === "team-delete") this.modal = null;
    this.notifyNow();
  }

  async saveTeam(name, cx, silent = false) {
    const form = this.teamForms[name];
    const team = this.teamFor(name);
    if (!form || !team) return false;
    const values = this.teamFormValues(name);
    const temp = `${this.dir}/.tmp/brief-${name}-${Date.now()}.md`;
    let wrote = false;
    try {
      try {
        await exec("/bin/mkdir", ["-p", `${this.dir}/.tmp`]);
      } catch {
        // mkdir darf scheitern; writeTextFile meldet den eigentlichen Fehler.
      }
      await writeTextFile(temp, String(values.brief ?? ""), null);
      wrote = true;
      const plan = model.teamSaveArgs(team, values, { briefFile: temp });
      if (plan.error) {
        this.setError(`team:${name}`, plan.error);
        this.notifyNow();
        return false;
      }
      const result = await this.action(`team:${name}`, plan.args, {
        success: `Team ${name} gespeichert.`,
        after: async () => {
          const current = this.teamForms[name];
          // Nach dem Schreiben ist der eingereichte Stand die neue Vergleichsbasis.
          if (current) current.origin = model.teamDraft(values);
          await this.loadRoster(cx);
        },
      });
      if (result.ok) {
        await this.loadOrchestrator(cx, name);
        this.syncTeamForms();
      }
      if (!silent) this.notifyNow();
      return result.ok;
    } catch (error) {
      const text = `Brief konnte nicht geschrieben werden: ${message(error)}`;
      this.setError(`team:${name}`, text);
      notify({ title: "Fabric", body: text, level: "error" });
      this.notifyNow();
      return false;
    } finally {
      if (wrote) {
        try { await exec("/bin/rm", ["-f", temp]); } catch { /* egal */ }
      }
    }
  }

  async saveChangedTeams(cx, silent = false) {
    const teams = (this.roster?.teams ?? []).filter((team) => this.teamFormDirty(team.name));
    let ok = true;
    for (const team of teams) {
      ok = await this.saveTeam(team.name, cx, true);
      if (!ok) break;
    }
    if (!silent) this.notifyNow();
    return ok;
  }

  // ---------- Kontextvorschau ----------

  toggleContextPreview(kind, ref, cx) {
    if (!kind || !ref) return;
    const current = this.contextPreview;
    if (current && current.kind === kind && current.ref === ref) {
      this.closeContextPreview(cx);
      return;
    }
    this.openContextPreview(kind, ref, cx);
  }

  async openContextPreview(kind, ref, cx) {
    if (!kind || !ref) return;
    const id = ++this.contextPreviewId;
    this.contextPreview = {
      kind,
      ref,
      title: kind === "team" ? `Team ${ref}` : `Ticket ${ref}`,
      loading: true,
      data: null,
      error: null,
    };
    this.notifyNow();
    try {
      const args = ["context", ...(kind === "team" ? ["--team", ref] : [ref]), "--json"];
      const result = await this.execFab(args, { timeout: 30000 });
      if (id !== this.contextPreviewId) return;
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("context --json lieferte kein JSON");
      }
      this.contextPreview = { ...this.contextPreview, loading: false, data: raw, error: null };
    } catch (error) {
      if (id !== this.contextPreviewId) return;
      this.contextPreview = {
        ...this.contextPreview,
        loading: false,
        data: null,
        error: `Kontext nicht lesbar: ${message(error)}`,
      };
    }
    this.notifyNow();
  }

  closeContextPreview(cx) {
    this.contextPreview = null;
    this.contextPreviewId += 1;
    this.notifyNow();
    cx?.notify?.();
  }

  /** Vorschau-Deeplink: einmal je `at`, nur im App-Fenster. */
  checkContextPreview(cx) {
    if (!this.isApp) return;
    const request = shared("fabric.contextPreview");
    if (!request || typeof request !== "object") return;
    if (!Number.isInteger(request.at) || request.at <= this.contextPreviewSeen) return;
    if (request.kind !== "ticket" && request.kind !== "team") return;
    if (!request.ref) return;
    this.contextPreviewSeen = request.at;
    this.openContextPreview(request.kind, request.ref, cx);
  }

  // ---------- Team-Prompt ----------

  teamPromptDirty() {
    return Boolean(this.teamPrompt)
      && model.isDirty(this.teamPrompt.editor.value(), this.teamPrompt.saved);
  }

  openTeamPrompt(name, cx) {
    if (!name) return;
    if (this.teamPrompt?.team === name) {
      this.notifyNow();
      return;
    }
    const go = () => this.showTeamPrompt(name, cx);
    if (this.teamPromptDirty() || (this.blueprintDrawer && this.blueprintDirty)) {
      this.guard(go, cx);
      return;
    }
    go();
  }

  showTeamPrompt(name, cx) {
    this.menu = null;
    if (this.blueprintDrawer) this.clearBlueprintDrawer(cx);
    this.teamPromptId += 1;
    const id = this.teamPromptId;
    this.setError("team-prompt", null);
    this.teamPromptLoading = true;
    this.teamPrompt = { team: name, editor: this.newEditor("markdown", ""), saved: "" };
    this.notifyNow();
    cx.spawn(async (cx) => {
      let text = null;
      try {
        const result = await this.execFab(["prompt", "show", "orchestrator", "--team", name], {
          timeout: 20000,
        });
        if (result.code === 0) text = result.stdout ?? "";
        else this.setError("team-prompt", (result.stderr || "").trim() || `Code ${result.code}`);
      } catch (error) {
        this.setError("team-prompt", `Prompt nicht lesbar: ${message(error)}`);
      }
      if (id !== this.teamPromptId || this.teamPrompt?.team !== name) return;
      this.teamPromptLoading = false;
      if (text !== null) {
        this.teamPrompt.saved = text;
        if (this.teamPrompt.editor.value() === "") this.teamPrompt.editor.set_value(text);
      }
      this.notifyNow();
    });
  }

  clearTeamPrompt(cx) {
    this.teamPromptId += 1;
    this.teamPrompt = null;
    this.teamPromptLoading = false;
    this.setError("team-prompt", null);
    cx?.notify();
  }

  closeTeamPrompt(cx) {
    if (!this.teamPrompt) return;
    if (this.teamPromptDirty()) {
      this.modal = {
        kind: "unsaved",
        dirty: this.dirtySections(),
        then: () => this.clearTeamPrompt(cx),
      };
      cx?.notify();
    } else {
      this.clearTeamPrompt(cx);
    }
  }

  async saveTeamPrompt(cx, silent = false) {
    if (!this.teamPrompt || !this.teamPrompt.editor || this.teamPromptLoading) return false;
    const team = this.teamPrompt.team;
    const text = this.teamPrompt.editor.value();
    const result = await this.action("team-prompt", [
      "prompt", "set", "orchestrator", `--text=${text}`, "--team", team, "--from=mensch",
    ], {
      success: `Orchestrator-Prompt für ${team} gespeichert.`,
    });
    if (result.ok && this.teamPrompt?.team === team) this.teamPrompt.saved = text;
    if (!silent) this.notifyNow();
    return result.ok;
  }

  // ---------- Orchestrator ----------

  async loadOrchestrator(cx, team = null) {
    const name = team ?? this.firstTeamName();
    const args = ["orchestrator", "status"];
    if (name) args.push(name);
    args.push("--json");
    try {
      const result = await this.execFab(args, { timeout: 20000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!raw) throw new Error("orchestrator status --json lieferte kein JSON");
      if (name) {
        this.orchestrators[name] = raw;
        delete this.orchestratorErrors[name];
      }
      if (!name || name === this.firstTeamName()) {
        this.orchestratorGlobal = raw;
      }
    } catch (error) {
      const text = `Orchestrator-Status nicht lesbar: ${message(error)}`;
      if (name) {
        this.orchestrators[name] = null;
        this.orchestratorErrors[name] = text;
      }
      if (!name || name === this.firstTeamName()) {
        this.orchestratorGlobal = null;
      }
    }
    this.notifyNow();
  }

  async loadOrchestrators(cx) {
    const teams = this.roster?.teams ?? [];
    if (!teams.length) {
      await this.loadOrchestrator(cx);
      return;
    }
    await Promise.all(teams.map((team) => this.loadOrchestrator(cx, team.name)));
  }

  async orchestrator(action, team, cx) {
    const name = team ?? this.firstTeamName();
    const args = ["orchestrator", action];
    if (name) args.push(name);
    if (action === "restart") args.push("--from=mensch");
    const success = action === "start" ? "Orchestrator gestartet."
      : action === "stop" ? "Orchestrator gestoppt." : "Orchestrator neu gestartet.";
    await this.action(`orchestrator:${name ?? ""}`, args, {
      success: name ? `${success.slice(0, -1)} (${name}).` : success,
      timeout: 120000,
      after: async () => {
        await this.loadOrchestrator(cx, name);
      },
    });
  }

  orchestratorState(team = null) {
    const name = team ?? this.firstTeamName();
    const state = name
      ? (this.orchestrators[name] ?? (name === this.firstTeamName() ? this.orchestratorGlobal : null))
      : this.orchestratorGlobal;
    return model.liveOrchestrator(state, terminals(), name ?? "");
  }

  peekOrchestrator(team, cx) {
    const terminal = this.orchestratorState(team).terminal;
    if (terminal) run("terminal.peek", { terminal });
  }


  // ---------- Prompts ----------

  async savePrompt(cx, silent = false) {
    if (!this.promptEditor || !this.promptName) return false;
    const text = this.promptEditor.value();
    const result = await this.action("prompt", model.promptSetArgs(this.promptName, text), {
      success: `Prompt ${this.promptName} gespeichert.`,
      after: (result) => {
        const warning = (result.stderr || "").trim();
        this.promptWarnings = model.unknownPlaceholders(text);
        if (!warning && this.promptWarnings.length) {
          this.setError("prompt", `Unbekannte Platzhalter: ${this.promptWarnings.join(", ")}.`, "warn");
        }
        this.loadPrompts(cx);
      },
    });
    if (result.ok) this.promptSaved = text;
    if (!silent) this.notifyNow();
    return result.ok;
  }

  discardPrompt(cx) {
    if (this.promptEditor) this.promptEditor.set_value(this.promptSaved);
    this.promptWarnings = model.unknownPlaceholders(this.promptSaved);
    this.setError("prompt", null);
    this.notifyNow();
  }

  // ---------- Vorlagen ----------

  async loadTemplates(cx) {
    try {
      const result = await this.execFab(["template", "list", "--json"]);
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!Array.isArray(raw)) throw new Error("template list --json lieferte keine Liste");
      this.templateList = model.sortTemplates(raw);
      this.templateError = null;
      this.templatesAt = Date.now();
    } catch (error) {
      this.templateError = `Vorlagen nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  async loadTemplate(name, cx) {
    if (!name) return;
    if (this.templateEditor && this.templateName !== name
      && model.isDirty(this.templateEditor.value(), this.templateSaved)) {
      return;
    }
    const known = (this.templateList ?? []).find((row) => row.name === name);
    try {
      const result = await this.execFab(["template", "show", name], { timeout: 20000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      this.templateName = name;
      this.templateBytes = known?.bytes ?? (result.stdout?.length ?? 0);
      this.templateSaved = result.stdout ?? "";
      this.templateEditor = this.newEditor("markdown", this.templateSaved);
      this.templateError = null;
    } catch (error) {
      this.templateError = `Vorlage ${name} nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  selectTemplate(name, cx, silent = false) {
    const go = () => {
      this.templateName = name;
      setShared("fabric.route", { page: "templates", name });
      cx.spawn((cx) => this.loadTemplate(name, cx));
      this.notifyNow();
    };
    if (silent) go();
    else this.guard(go, cx);
  }

  async saveTemplate(cx, silent = false) {
    if (!this.templateEditor || !this.templateName) return false;
    const text = this.templateEditor.value();
    const name = this.templateName;
    const result = await this.action("template", model.templateSetArgs(name, text), {
      success: `Vorlage ${name} gespeichert.`,
      after: async () => {
        await this.loadTemplates(cx);
        const known = (this.templateList ?? []).find((row) => row.name === name);
        if (known && this.templateName === name) this.templateBytes = known.bytes ?? 0;
      },
    });
    if (result.ok && this.templateName === name) this.templateSaved = text;
    if (!silent) this.notifyNow();
    return result.ok;
  }

  discardTemplate(cx) {
    if (this.templateEditor) this.templateEditor.set_value(this.templateSaved);
    this.setError("template", null);
    this.notifyNow();
  }

  // ---------- Repos ----------

  async saveRepo(cx, only = null, silent = false) {
    if (!this.repoDetail) return false;
    const key = only ?? this.repoTab;
    const editorKey = model.repoEditorKey(key);
    if (!editorKey) return false;
    const editor = editorKey === "verify" ? this.verifyEditor
      : editorKey === "project" ? this.projectEditor
        : this.lessonsEditor;
    if (!editor) {
      this.setError(editorKey, "Noch keine Datei angelegt.");
      this.notifyNow();
      return false;
    }
    const text = editor.value();
    const success = editorKey === "verify" ? "Prüfskript gespeichert."
      : editorKey === "project" ? "Steckbrief gespeichert."
        : "Lernnotizen gespeichert.";
    const result = await this.action("repo-set", model.repoSetArgs(this.repoDetail.path, editorKey, text), {
      success,
      after: () => {
        if (editorKey === "verify") {
          this.verifySaved = text;
          this.repoDetail.verify = { ...(this.repoDetail.verify ?? {}), exists: true, text };
        } else if (editorKey === "project") {
          this.projectSaved = text;
          this.repoDetail.project = { ...(this.repoDetail.project ?? {}), exists: true, text };
        } else {
          this.lessonsSaved = text;
          this.repoDetail.lessons = { ...(this.repoDetail.lessons ?? {}), exists: true, text };
        }
        if (this.repoDetail) {
          this.repos = (this.repos ?? []).map((repo) => repo.path === this.repoDetail.path
            ? {
              ...repo,
              verify_exists: Boolean(this.repoDetail.verify?.exists),
              lessons_exists: Boolean(this.repoDetail.lessons?.exists),
              project_exists: Boolean(this.repoDetail.project?.exists),
            }
            : repo);
        }
      },
    });
    if (result.ok) {
      if (editorKey === "verify") this.verifySaved = text;
      else if (editorKey === "project") this.projectSaved = text;
      else this.lessonsSaved = text;
    }
    if (!silent) this.notifyNow();
    return result.ok;
  }

  createVerify(cx) {
    this.repoTab = "verify";
    this.verifySaved = "";
    this.verifyEditor = this.newEditor("shell", model.verifyTemplate());
    this.verifyEditor.on("change", (_event, cx) => cx.notify());
    this.setError("repo", null);
    this.notifyNow();
  }

  createProject(cx) {
    this.repoTab = "project";
    this.projectSaved = "";
    this.projectEditor = this.newEditor("markdown", this.repoDetail?.project_template ?? "");
    this.projectEditor.on("change", (_event, cx) => cx.notify());
    this.setError("repo", null);
    this.notifyNow();
  }

  discardRepo(cx) {
    if (this.repoTab === "verify" && this.verifyEditor) this.verifyEditor.set_value(this.verifySaved);
    if (this.repoTab === "lessons" && this.lessonsEditor) this.lessonsEditor.set_value(this.lessonsSaved);
    if (this.repoTab === "project" && this.projectEditor) this.projectEditor.set_value(this.projectSaved);
    this.setError("repo-set", null);
    this.notifyNow();
  }

  // ---------- Wissensordner ----------

  async pickKnowledgeFile(cx) {
    let result = null;
    try {
      result = await exec("/usr/bin/osascript", [
        "-e", 'POSIX path of (choose file with prompt "Datei für den Wissensordner wählen")',
      ]);
    } catch (error) {
      const text = `Datei wählen ging nicht: ${message(error)}`;
      this.setError("knowledge-add", text);
      notify({ title: "Fabric", body: text, level: "error" });
      this.notifyNow();
      return false;
    }
    if (result.code === 0) {
      const path = (result.stdout || "").trim();
      if (!path) return false;
      return this.addKnowledgeFile(path, cx);
    }
    const stderr = result.stderr || "";
    if (stderr.includes("User canceled") || stderr.includes("-128")) return false;
    const text = `Datei wählen ging nicht: ${stderr.trim() || `osascript endete mit Code ${result.code}.`}`;
    this.setError("knowledge-add", text);
    notify({ title: "Fabric", body: text, level: "error" });
    this.notifyNow();
    return false;
  }

  async addKnowledgeFile(sourcePath, cx) {
    if (!this.repoDetail || !sourcePath) return false;
    const repoPath = this.repoDetail.path;
    const result = await this.action("knowledge-add", model.knowledgeAddArgs(repoPath, sourcePath), {
      success: "Datei zum Wissensordner hinzugefügt.",
      after: () => this.loadRepo(repoPath, cx),
    });
    return result.ok;
  }

  async dropKnowledgeFiles(paths, cx) {
    for (const path of paths ?? []) {
      if (!path) continue;
      await this.addKnowledgeFile(path, cx);
    }
  }

  openKnowledgeNoteModal(cx) {
    if (!this.repoDetail) return;
    const name = InputState.new({ placeholder: "z. B. ideen" });
    name.on("change", (_event, cx) => { this.notifyNow(); });
    this.track(name);
    const text = TextareaState.new({ placeholder: "Inhalt der Notiz …", rows: 5 });
    text.on("change", (_event, cx) => { this.notifyNow(); });
    this.track(text);
    this.knowledgeNote = { name, text };
    this.setError("knowledge-note", null);
    this.modal = { kind: "knowledge-note" };
    this.notifyNow();
  }

  async createKnowledgeNote(cx) {
    if (!this.repoDetail || !this.knowledgeNote) return false;
    const repoPath = this.repoDetail.path;
    const name = this.knowledgeNote.name.value().trim();
    const text = this.knowledgeNote.text.value();
    const problem = model.knowledgeNameProblem(name);
    if (problem) {
      this.setError("knowledge-note", problem);
      this.notifyNow();
      return false;
    }
    if (!text.trim()) {
      this.setError("knowledge-note", "Text fehlt.");
      this.notifyNow();
      return false;
    }
    const result = await this.action("knowledge-note", model.knowledgeNoteArgs(repoPath, name, text), {
      success: "Notiz im Wissensordner gespeichert.",
      after: () => this.loadRepo(repoPath, cx),
    });
    if (result.ok && this.modal?.kind === "knowledge-note") {
      this.modal = null;
      this.knowledgeNote = null;
    }
    this.notifyNow();
    return result.ok;
  }

  confirmKnowledgeRemove(name, cx) {
    this.setError("knowledge-rm", null);
    this.modal = { kind: "knowledge-remove", name };
    this.notifyNow();
  }

  async removeKnowledge(cx) {
    const name = this.modal?.name;
    if (!this.repoDetail || !name) return false;
    const repoPath = this.repoDetail.path;
    const result = await this.action("knowledge-rm", model.knowledgeRemoveArgs(repoPath, name), {
      success: "Eintrag entfernt.",
      after: () => this.loadRepo(repoPath, cx),
    });
    if (result.ok && this.modal?.kind === "knowledge-remove") this.modal = null;
    this.notifyNow();
    return result.ok;
  }

  async testRepo(cx) {
    if (!this.repoDetail || this.repoTestBusy) return;
    this.repoTestBusy = true;
    this.setError("repo-test", null);
    this.notifyNow();
    try {
      const result = await this.execFab(["repo", "test", this.repoDetail.path, "--json"], { timeout: 630000 });
      const parsed = parseJson(result.stdout, null);
      if (!parsed) {
        const text = (result.stderr || "").trim() || `Test endete mit Code ${result.code}.`;
        this.setError("repo-test", text);
        notify({ title: "Fabric", body: text, level: "error" });
      } else {
        this.repoTest = parsed;
        notify({
          title: "Fabric",
          body: parsed.exit === 0 ? "Prüfskript ist grün." : `Prüfskript endete mit ${parsed.exit}.`,
          level: parsed.exit === 0 ? "success" : "error",
        });
      }
    } catch (error) {
      this.setError("repo-test", `Test ließ sich nicht starten: ${message(error)}`);
    }
    this.repoTestBusy = false;
    this.notifyNow();
  }

  // ---------- Panels ----------

  showWindowButton() {
    return ui.iconButton(ui.colors(), {
      id: "fabric-open-window",
      icon: "external",
      tooltip: "Im Fenster öffnen (⌘⇧F)",
      onClick: (cx) => this.toggleWindow(cx),
    });
  }

  // ---------- Anzeige ----------

  render(cx) {
    this.lastCx = cx;
    const t = ui.colors();
    if (!this.ready) {
      return ui.page(t, [ui.header(t, "Fabric"), ui.loading(t)]);
    }
    if (this.view === "inbox") return renderPosteingangPanel(this, cx, t);
    if (this.view === "timeline") return renderTimelinePanel(this, cx, t);
    if (this.view === "switcher") return renderSwitcher(this, cx, t);
    if (this.view === "app") return this.renderWindow(cx, t);
    return renderTicketsPanel(this, cx, t);
  }

  renderWindow(cx, t) {
    const route = this.currentRoute();
    const page = route.page;
    const content = page === "inbox" ? renderInboxPage(this, cx, t)
      : page === "commands" ? renderCommandsPage(this, cx, t)
      : page === "board" ? renderBoard(this, cx, t)
      : page === "tickets" ? renderTicketsPage(this, cx, t)
        : page === "ticket" ? renderTicket(this, cx, t)
          : page === "team" ? renderTeam(this, cx, t)
            : page === "workflows" ? renderWorkflowsPage(this, cx, t)
              : page === "pipelines" ? renderPipelinesPage(this, cx, t)
              : page === "prompts" ? renderPrompts(this, cx, t)
              : page === "templates" ? renderTemplates(this, cx, t)
                : page === "repos" ? renderRepos(this, cx, t)
                  : renderSettings(this, cx, t);

    const lamp = model.autopilotLamp(this.autopilotText, Date.now(), this.index?.alarm);
    const state = this.orchestratorState();
    const statusWord = model.orchestratorWord(state);
    const statusColor = ui.orchestratorStatus(t, state).color;

    const nav = this.compact ? null : v_flex()
      .flex_none()
      .w(ui.SIZE.sidebar)
      .min_h(0)
      .p(ui.SPACE.s)
      .gap(ui.SPACE.xs)
      .border_r(1)
      .border_color(t.border)
      .bg(t.chrome)
      .child(
        v_flex()
          .w_full()
          .flex_none()
          .gap(ui.SPACE.xs)
          .child(
            h_flex()
              .w_full()
              .h(40)
              .px(ui.SPACE.s)
              .gap(ui.SPACE.s)
              .items_center()
              .child(div().flex_none().text_color(t.accent).child(ui.icon("fabric", 17)))
              .child(div().text_size(ui.FONT.m).font_semibold().child("Fabric")),
          ),
      )
      .children(NAV.map((item) => ui.navItem(t, {
        id: `fabric-nav-${item.page}`,
        icon: item.icon,
        label: model.pageWord(item.page),
        active: page === item.page || (page === "ticket" && item.page === "tickets"),
        onClick: (cx) => this.navigate(item.page, {}, cx),
        badge: this.navBadge(t, item.page),
      })))
      .child(div().flex_1())
      .child(
        ui.pill(t, {
          id: "fabric-orchestrator-pill",
          label: `Orchestrator: ${statusWord}`,
          color: statusColor,
          tooltip: state
            ? `Orchestrator ${statusWord} · ${state.name ?? ""} ${state.terminal ?? ""} · klicken für Team`
            : "Orchestrator-Status unbekannt · klicken für Team",
          onClick: (cx) => this.navigate("team", {}, cx),
        }),
      );

    const statusTip = state
      ? `Orchestrator ${statusWord} · ${state.name ?? ""} ${state.terminal ?? ""} · klicken für Team`
      : "Orchestrator-Status unbekannt · klicken für Team";
    const compactNav = this.compact ? h_flex()
      .flex_none()
      .w_full()
      .h(ui.SIZE.nav)
      .px(ui.SPACE.s)
      .gap(ui.SPACE.xs)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .bg(t.chrome)
      .children(NAV.map((item) => div().flex_1().min_w(0).child(ui.navItem(t, {
        id: `fabric-nav-${item.page}`,
        icon: item.icon,
        label: model.pageWord(item.page),
        active: page === item.page || (page === "ticket" && item.page === "tickets"),
        onClick: (cx) => this.navigate(item.page, {}, cx),
        badge: this.navBadge(t, item.page),
        compact: true,
      }))))
      .child(
        h_flex()
          .id("fabric-orchestrator-pill")
          .flex_none()
          .size(24)
          .items_center()
          .justify_center()
          .rounded(12)
          .bg(statusColor + ui.ALPHA.soft)
          .cursor_pointer()
          .tooltip(statusTip)
          .on_click((_event, cx) => {
            cx.stop_propagation();
            this.navigate("team", {}, cx);
          })
          .child(ui.dot(t, statusColor)),
      ) : null;

    const search = this.compact ? null : h_flex()
      .flex_1()
      .min_w(0)
      .max_w(440)
      .gap(ui.SPACE.s)
      .items_center()
      .child(div().flex_none().text_color(t.dim).child(ui.icon("search", 13)))
      .child(div().flex_1().min_w(0).child(ui.input(t, this.search, { focused: this.searchFocused })))
      .child(ui.keyHint(t, "/"));

    const top = h_flex()
      .flex_none()
      .w_full()
      .h(ui.SIZE.header)
      .px(ui.SPACE.l)
      .gap(ui.SPACE.m)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .bg(t.surface)
      .when(!this.compact, (el) => el.child(search))
      .child(div().flex_1())
      .when(this.compact, (el) => el.child(ui.iconButton(t, {
        id: "fabric-new-ticket",
        icon: "plus",
        tooltip: "Neues Ticket (⌘N)",
        onClick: (cx) => this.openNewTicket(cx),
      })))
      .when(!this.compact, (el) => el.child(ui.button(t, {
        id: "fabric-new-ticket",
        label: "Neues Ticket",
        icon: "plus",
        primary: true,
        tooltip: "Neues Ticket (⌘N)",
        onClick: (cx) => this.openNewTicket(cx),
      })))
      .child(this.autopilotTrigger(t, cx, {
        compact: this.compact,
        anchor: "bottom_left",
        popupId: "fabric-autopilot-panel",
        lamp,
      }))
      .child(this.inboxButton(t, cx, this.compact))
      .child(ui.iconButton(t, {
        id: "fabric-window-close",
        icon: "close",
        tooltip: "Fenster schließen (Esc)",
        onClick: (cx) => this.closeWindowWithGuard(cx),
      }));

    const contentPane = v_flex().flex_1().min_w(0).h_full().min_h(0).overflow_hidden().child(content);
    const drawerLayer = (node) => div().absolute().right_0().top_0().bottom_0().bg(t.surface).overflow_hidden().child(node);
    const body = v_flex()
      .flex_1()
      .min_h(0)
      .items_stretch()
      .when(this.compact, (el) => el.child(compactNav))
      .child(
        div()
          .relative()
          // Der Drawer-Host muss selbst ein Flex-Container sein: sonst kann die
          // innere Zeile (.flex_1) die Höhe nicht füllen, und .overflow_hidden
          // schneidet die Seite auf ihre Eigenhöhe ab (T-122).
          .flex()
          .flex_1()
          .min_w(0)
          .min_h(0)
          .child(
            h_flex()
              .flex_1()
              // Auch waagerecht schrumpfen lassen: sonst schiebt die
              // min-content-Breite der Seite den rechten Rand aus dem Fenster.
              .min_w(0)
              .min_h(0)
              .items_stretch()
              .when(!this.compact, (el) => el.child(nav))
              .child(contentPane),
          )
          .when(Boolean(this.blueprintDrawer), (el) => el.child(drawerLayer(renderBlueprintDrawer(this, cx, t))))
          .when(Boolean(this.teamPrompt), (el) => el.child(drawerLayer(renderTeamPromptDrawer(this, cx, t))))
          .when(Boolean(this.contextPreview), (el) => el.child(drawerLayer(renderContextPreview(this, cx, t)))),
      );

    const overlay = [];
    if (this.menu || this.autopilotOpen) {
      overlay.push(ui.backdrop(t, {
        dim: false,
        onClick: (cx) => {
          this.menu = null;
          this.autopilotOpen = false;
          this.notifyNow();
        },
      }));
    }
    if (this.newOpen || this.newTeamOpen || this.modal) overlay.push(renderDialogs(this, cx, t));
    if (this.imageOpen) overlay.push(ui.imageLightbox(t, { ...this.imageOpen, onClose: () => { this.imageOpen = null; this.notifyNow(); } }));

    const root = div()
      .relative()
      .size_full()
      .min_h(0)
      .rounded(ui.RADIUS.l)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .overflow_hidden()
      .on_size_change((size, cx) => {
        this.windowWidth = size.width;
        const compact = model.compactWidth(size.width);
        if (compact !== this.compact) {
          this.compact = compact;
          cx.notify();
        }
      })
      .track_focus(this.appFocus)
      .on_key_down((event, cx) => this.keys(event, cx))
      .child(
        v_flex().size_full().min_h(0)
          .when(Boolean(model.alarmActive(this.index?.alarm)), (el) => el.child(this.alarmBanner(t)))
          .when(Boolean(this.index?.paused), (el) => el.child(ui.notice(
            t,
            "Fabric pausiert – niemand wird geweckt oder gestartet.",
            "warning",
            {
              id: "fabric-paused-banner",
              actions: [ui.button(t, {
                id: "fabric-paused-resume",
                label: "Fortsetzen",
                small: true,
                disabled: Boolean(this.busy),
                onClick: (clickCx) => clickCx.spawn(async (clickCx) => { await this.setPaused(false, clickCx); }),
              })],
            },
          )))
          .child(
            h_flex().flex_none().w_full().child(
              div().flex_1().min_w(0).child(
                h_flex().flex_none().w_full().children([
                  div().flex_1().min_w(0).child(top),
                ]),
              ),
            ),
          )
          .child(body),
      )
      .children(overlay);
    return this.mentionActions(root);
  }

  // ---------- Alarme ----------

  alarmBanner(t) {
    const entries = model.alarmEntries(this.index?.alarm);
    if (entries.length === 0) return null;
    return v_flex()
      .id("fabric-alarm-banner")
      .flex_none()
      .w_full()
      .children(entries.map((item, index) => ui.notice(t, item.text || "Alarm", "error", {
        id: `fabric-alarm-${index}`,
        actions: item.buttons.map((button) => ui.button(t, {
          id: `fabric-alarm-${index}-${button.key}`,
          label: button.label,
          small: true,
          onClick: (clickCx) => clickCx.spawn(async (clickCx) => {
            await this.alarmAction(item, button.key, clickCx);
          }),
        })),
      })));
  }

  alarmAction(item, key, cx) {
    if (key === "run") return this.navigate("pipelines", { run: item.run }, cx);
    if (key === "ticket") {
      if (item.ticket) this.navigate("ticket", { id: item.ticket }, cx);
      return undefined;
    }
    if (key === "resume") return this.resumeAutopilot(cx);
    if (key === "ack") return this.ackAlarms(cx);
    return undefined;
  }

  async ackAlarms() {
    await this.action("alarm-ack", ["alarm", "ack"], { success: null });
  }

  // ---------- Autopilot ----------

  autopilotLogPath() {
    const info = model.autopilotPopover(this.autopilotText, null, Date.now());
    return info.logPath || `${this.dir}/autopilot.log`;
  }

  async loadAutopilotLog() {
    try {
      this.autopilotLogText = await readTextFile(this.autopilotLogPath());
    } catch {
      this.autopilotLogText = null;
    }
    this.notifyNow();
  }

  autopilotTrigger(t, cx, { compact = false, anchor = "bottom_left", popupId = "fabric-autopilot-panel", lamp = null } = {}) {
    const current = lamp ?? model.autopilotLamp(this.autopilotText, Date.now(), this.index?.alarm);
    const short = current.state === "running" ? "an"
      : current.state === "paused" ? "pausiert"
        : current.state === "alarm" ? "Alarm"
          : current.state === "stale" ? "keine Antwort"
          : "aus";
    const trigger = h_flex()
      .id(`${popupId}-trigger`)
      .flex_none()
      .h(ui.SIZE.button)
      .px(compact ? ui.SPACE.s : ui.SPACE.m)
      .gap(ui.SPACE.s)
      .items_center()
      .rounded(ui.RADIUS.m)
      .border_1()
      .border_color(this.autopilotOpen ? t.accent : t.input)
      .bg(this.autopilotOpen ? t.selected : t.raised)
      .cursor_pointer()
      .hover((s) => s.opacity(0.86))
      .tooltip(current.text)
      .accessibility_label(current.text)
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => {
        cx.stop_propagation();
        this.autopilotOpen = !this.autopilotOpen;
        this.autopilotSource = this.autopilotOpen ? popupId : null;
        this.menu = null;
        if (this.autopilotOpen) cx.spawn(async () => { await this.loadAutopilotLog(); });
        this.notifyNow();
      })
      .child(ui.autopilotDot(t, { color: current.color, pulse: current.pulse }))
      .child(div()
        .text_size(compact ? ui.FONT.xs : ui.FONT.s)
        .text_color(t.muted)
        .max_w(compact ? 110 : 220)
        .truncate()
        .child(compact || current.state === "alarm" ? short : current.text));

    const panel = this.autopilotPanel(t, popupId);
    const open = this.autopilotOpen && this.autopilotSource === popupId;
    return Popup.new(popupId, trigger).anchor(anchor).when(open, (el) => el.content(panel));
  }

  autopilotPanel(t, popupId) {
    const info = model.autopilotPopover(this.autopilotText, this.autopilotLogText, Date.now());
    const lamp = model.autopilotLamp(this.autopilotText, Date.now(), this.index?.alarm);
    const actions = model.autopilotActions(lamp, this.index?.alarm);
    const logPath = info.logPath || `${this.dir}/autopilot.log`;
    const logError = this.errorFor("autopilot-log");

    return ui.popoverPanel(t, [
      v_flex().w_full().px(ui.SPACE.m).pt(ui.SPACE.m).pb(ui.SPACE.s).gap(ui.SPACE.xs)
        .child(h_flex().w_full().gap(ui.SPACE.s).items_center()
          .child(ui.autopilotDot(t, { color: lamp.color, pulse: lamp.pulse }))
          .child(div().flex_1().text_size(ui.FONT.l).font_semibold().child("Autopilot")))
        .child(div()
          .text_size(ui.FONT.xs)
          .text_color(ui.autopilotColor(t, lamp.color))
          .whitespace_normal()
          .child(lamp.text))
        .when(Boolean(info.lastAction), (el) => el.child(div()
          .text_size(ui.FONT.xs)
          .text_color(t.muted)
          .whitespace_normal()
          .child(`Zuletzt: ${info.lastAction}`)))
        .when(Boolean(info.endLabel), (el) => el.child(div()
          .text_size(ui.FONT.xs)
          .text_color(t.dim)
          .child(info.endLabel)))
        .when(Boolean(logError), (el) => el.child(div()
          .text_size(ui.FONT.xs)
          .text_color(t.blocked)
          .whitespace_normal()
          .child(logError.text))),
      v_flex().w_full().when(actions.start, (row) => row.child(
        h_flex().w_full().px(ui.SPACE.m).pb(ui.SPACE.xs).gap(ui.SPACE.xs).items_center()
          .child(ui.button(t, {
            id: `${popupId}-start-0800`,
            label: "bis morgen 08:00",
            small: true,
            tooltip: "Autopilot bis morgen 08:00 starten",
            onClick: (cx) => cx.spawn(async (cx) => { await this.startAutopilot("08:00", cx); }),
          }))
          .child(ui.button(t, {
            id: `${popupId}-start-2359`,
            label: "bis heute 23:59",
            small: true,
            tooltip: "Autopilot bis heute 23:59 starten",
            onClick: (cx) => cx.spawn(async (cx) => { await this.startAutopilot("23:59", cx); }),
          }))
          .child(ui.button(t, {
            id: `${popupId}-start-done`,
            label: "bis alles fertig",
            small: true,
            tooltip: "Autopilot bis alles fertig starten",
            onClick: (cx) => cx.spawn(async (cx) => { await this.startAutopilot("done", cx); }),
          })))),
      h_flex().w_full().px(ui.SPACE.m).pb(ui.SPACE.s).gap(ui.SPACE.xs).items_center()
        .when(actions.resume, (el) => el.child(ui.button(t, {
          id: `${popupId}-resume`,
          label: "Pause aufheben",
          icon: "undo",
          small: true,
          tooltip: "Autopilot fortsetzen",
          onClick: (cx) => cx.spawn(async (cx) => { await this.resumeAutopilot(cx); }),
        })))
        .when(actions.stop, (el) => el.child(ui.button(t, {
          id: `${popupId}-stop`,
          label: "Stoppen",
          icon: "stop",
          small: true,
          danger: true,
          tooltip: "Autopilot stoppen",
          onClick: (cx) => cx.spawn(async (cx) => { await this.stopAutopilot(cx); }),
        })))
        .child(ui.button(t, {
          id: `${popupId}-log`,
          label: "Log öffnen",
          icon: "external",
          small: true,
          tooltip: "Autopilot-Log im Editor öffnen",
          onClick: (cx) => cx.spawn(async () => { await this.openAutopilotLog(); }),
        })),
      v_flex().w_full().border_t(1).border_color(t.border).p(ui.SPACE.m).gap(ui.SPACE.xs)
        .child(div()
          .text_size(ui.FONT.xs)
          .text_color(t.dim)
          .whitespace_nowrap()
          .truncate()
          .tooltip(logPath)
          .child(logPath))
        .when(info.lines.length > 0, (el) => el.child(
          div()
            .w_full()
            .max_h(300)
            .overflow_y_scrollbar()
            .overflow_x_scrollbar()
            .child(v_flex().flex_none().gap(0).children(info.lines.map((line, index) => div()
              .id(`${popupId}-log-${index}`)
              .flex_none()
              .font_family("monospace")
              .text_size(ui.FONT.xs)
              .text_color(t.muted)
              .whitespace_nowrap()
              .child(line === "" ? " " : line)))),
        ))
        .when(info.lines.length === 0, (el) => el.child(div()
          .text_size(ui.FONT.xs)
          .text_color(t.dim)
          .child("Noch kein Log."))),
    ], 380, 420);
  }

  async startAutopilot(until, cx) {
    const result = await this.action(`autopilot-start-${until}`, ["autopilot", "start", "--until", until], {
      success: until === "done" ? "Autopilot startet bis alles fertig." : `Autopilot startet bis ${until}.`,
      cwd: appHome(),
      after: async () => {
        this.autopilotOpen = false;
        await this.refresh(cx);
      },
    });
    if (result.ok) this.autopilotOpen = false;
    this.notifyNow();
  }

  async resumeAutopilot(cx) {
    const result = await this.action("autopilot-resume", ["autopilot", "resume"], {
      success: "Autopilot fortgesetzt.",
      cwd: appHome(),
      after: async () => {
        this.autopilotOpen = false;
        await this.refresh(cx);
      },
    });
    if (result.ok) this.autopilotOpen = false;
    this.notifyNow();
  }

  async stopAutopilot(cx) {
    const result = await this.action("autopilot-stop", ["autopilot", "stop"], {
      success: "Autopilot gestoppt.",
      cwd: appHome(),
      after: async () => {
        this.autopilotOpen = false;
        await this.refresh(cx);
      },
    });
    if (result.ok) this.autopilotOpen = false;
    this.notifyNow();
  }

  async openAutopilotLog() {
    const logPath = this.autopilotLogPath();
    let text = null;
    try {
      text = await readTextFile(logPath);
    } catch {
      text = null;
    }
    if (text === null) {
      const hintText = `Kein Log unter ${logPath}.`;
      this.setError("autopilot-log", hintText);
      notify({ title: "Fabric", body: hintText, level: "warning" });
      this.notifyNow();
      return;
    }
    this.autopilotLogText = text;
    this.setError("autopilot-log", null);
    try {
      await exec("/usr/bin/open", [logPath]);
    } catch (error) {
      const failure = `Log ließ sich nicht öffnen: ${message(error)}`;
      this.setError("autopilot-log", failure);
      notify({ title: "Fabric", body: failure, level: "error" });
    }
    this.notifyNow();
  }

  /** Kopf-Knopf „Posteingang“: führt zur Posteingang-Seite (kein Popover mehr). */
  inboxButton(t, cx, compact = false) {
    const active = this.currentRoute().page === "inbox";
    return h_flex()
      .id("fabric-inbox-button")
      .flex_none()
      .h(ui.SIZE.button)
      .px(ui.SPACE.m)
      .gap(ui.SPACE.s)
      .items_center()
      .rounded(ui.RADIUS.m)
      .border_1()
      .border_color(active ? t.accent : t.input)
      .bg(active ? t.selected : t.raised)
      .cursor_pointer()
      .hover((s) => s.opacity(0.86))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        this.navigate("inbox", {}, cx);
      })
      .child(div().flex_none().text_color(t.muted).child(ui.icon("inbox", 14)))
      .when(!compact, (el) => el.child(div().text_size(ui.FONT.s).text_color(t.muted).child("Posteingang")))
      .child(ui.badge(t, this.inbox.length, this.inbox.length ? t.accent : t.dim))
      .tooltip("Posteingang öffnen");
  }

  /** Zähler in der Navigation; nur der Posteingang trägt einen. */
  navBadge(t, page) {
    if (page !== "inbox" || !this.inbox.length) return null;
    return ui.badge(t, this.inbox.length, t.accent);
  }

}

async function knownAgentsSafe() {
  try {
    return await knownAgents();
  } catch {
    return [];
  }
}
