// Fabric: Board, Tickets, Team, Prompts, Repos und Einstellungen in einem Mod.
// Die Ansicht kommt aus props().view; geschrieben wird nur über fabric/fab.

import { View, div } from "gpui-kit";
import { InputState, TextareaState, EditorState, ScrollHandle, TextView, h_flex, v_flex, Popup } from "gpui-base";
import {
  appHome, checking, closeOverlay, exec, focused, knownAgents, layout, nextCommand, notify,
  openOverlay, pickFolder, props, readTextFile, run, setShared, shared, spaces, terminals, watchFolder,
} from "herdr";
import * as ui from "./ui.js";
import * as model from "./model.js";
import { renderBoard } from "./views/board.js";
import { renderTicket } from "./views/ticket.js";
import { renderTicketsPage } from "./views/tickets-page.js";
import { renderTeam } from "./views/team.js";
import { renderPrompts } from "./views/prompts.js";
import { renderRepos } from "./views/repos.js";
import { renderSettings } from "./views/settings.js";
import { renderTicketsPanel } from "./views/tickets.js";
import { renderInboxPanel } from "./views/inbox.js";
import { renderTimelinePanel } from "./views/timeline.js";
import { renderSwitcher } from "./views/switcher.js";
import { renderDialogs, renderAgentDrawer } from "./views/dialogs.js";

const VIEWS = ["board", "tickets", "ticket", "team", "prompts", "repos", "settings"];
const NAV = [
  { page: "board", icon: "board", label: "Board" },
  { page: "tickets", icon: "tickets", label: "Tickets" },
  { page: "team", icon: "team", label: "Team" },
  { page: "prompts", icon: "prompt", label: "Prompts" },
  { page: "repos", icon: "repo", label: "Repos" },
  { page: "settings", icon: "settings", label: "Einstellungen" },
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
    events: Array.isArray(raw?.events) ? raw.events : [],
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
    this.inboxOpen = false;
    this.closed = false;
    this.watch = null;
    this.refreshing = false;
    this.pending = false;
    this.fieldFocused = false;
    this.cursorId = null;
    this.assigneeFilter = "all";
    this.repoFilter = "all";
    this.showDropped = false;
    this.includeDroppedTable = false;
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
    this.historyScroll = ScrollHandle.new();
    // Ein Dropdown ist zugleich offen; ein gemeinsamer Handle reicht.
    this.dropdownScroll = ScrollHandle.new();
    this.needsHistoryScroll = false;
    this.baseInput = InputState.new({ placeholder: "Basis-Branch, z. B. main" });
    this.baseInput.on("change", (_event, cx) => cx.notify());
    this.baseInput.on("submit", (_event, cx) => this.setBase(this.baseInput.value(), cx));
    this.track(this.baseInput);
    this.orchestrator = null;
    this.orchestratorError = null;
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
    this.repos = null;
    this.reposError = null;
    this.reposAt = 0;
    this.repoDetail = null;
    this.repoError = null;
    this.repoTab = "verify";
    this.verifyEditor = null;
    this.lessonsEditor = null;
    this.verifySaved = "";
    this.lessonsSaved = "";
    this.repoTest = null;
    this.repoTestBusy = false;
    this.version = null;
    this.versionError = null;
    this.programs = null;
    this.programsAt = 0;
    this.teamDrawer = null;
    this.agentName = null;
    this.agentRole = null;
    this.agentModel = null;
    this.agentFlags = null;
    this.agentPrompt = null;
    this.agentProgram = "";
    this.agentColorKey = "c1";
    this.agentOriginal = "";
    this.agentDraftId = 0;
    this.agentPromptLoading = false;
    this.teamDirty = false;
    this.teamSaving = false;
    this.maxSessions = null;
    this.reviewerDraft = null;
    this.newSentence = null;
    this.newRepo = null;
    this.newWake = true;
    this.newError = null;
    this.newReposLoading = false;
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
      if (this.isApp) {
        this.appFocus.focus();
        cx.timer.after(120, () => this.appFocus.focus());
        await this.loadRoster(cx);
        await this.loadOrchestrator(cx);
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

    const selected = this.selectedId();
    const wanted = model.ticketIdFor(this.isApp, this.currentRoute(), selected);
    if (wanted !== this.openId) {
      this.openId = wanted;
      this.resetTicketEditing();
    }
    await this.loadTicket();
    if (this.needsHistoryScroll && this.isApp) {
      this.needsHistoryScroll = false;
      try { this.historyScroll.scroll_to_bottom(); } catch { /* noch kein Layout */ }
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
        this.needsHistoryScroll = true;
        this.historyLastIndex = 1 + model.history(this.ticket, this.events).length;
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
    } catch (error) {
      this.ticket = null;
      this.ticketError = `Ticket ${id} ist unlesbar: ${message(error)}`;
    }
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
    cx?.timer.after(60, () => {
      try { this.historyScroll.scroll_to_bottom(); } catch { /* noch kein Layout */ }
    });
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
      this.inboxOpen = false;
      this.modal = null;
      if (page !== "team") this.clearAgentDrawer();
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
    const route = this.currentRoute();
    if (route.page === "team") {
      if (!this.roster || Date.now() - this.rosterAt > 15000) cx.spawn((cx) => this.loadRoster(cx));
      cx.spawn((cx) => this.loadOrchestrator(cx));
      this.ensurePrograms(cx);
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
      if (this.inboxOpen) { this.inboxOpen = false; this.notifyNow(); return; }
      if (this.newOpen) { this.newOpen = false; this.clearMentions(this.lastCx); this.notifyNow(); return; }
      if (this.teamDrawer) { this.closeDrawer(cx); return; }
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
      return model.sortTickets(model.filterTickets(this.tickets, {
        ...filters, includeDropped: this.includeDroppedTable,
      }), this.tableSort).map((ticket) => ticket.id);
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
    else if (route.page === "repos") this.saveRepo(cx);
    else if (this.teamDrawer) this.saveAgent(cx);
    else if (route.page === "team") this.saveTeamSettings(cx);
  }

  // ---------- Änderungen schützen ----------

  teamSettingsDirty() {
    const roster = this.roster;
    if (!roster) return false;
    const reviewer = this.reviewerDraft ?? roster.reviewer ?? "";
    if (reviewer !== (roster.reviewer ?? "")) return true;
    if (!this.maxSessions) return false;
    return String(this.maxSessions.value()).trim() !== String(roster.max_sessions ?? "");
  }

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
    if (this.repoDetail) {
      if (this.verifyEditor && model.isDirty(this.verifyEditor.value(), this.verifySaved)) {
        entries.push({ key: "verify", label: "Prüfskript" });
      }
      if (this.lessonsEditor && model.isDirty(this.lessonsEditor.value(), this.lessonsSaved)) {
        entries.push({ key: "lessons", label: "Lernnotizen" });
      }
    }
    if (this.teamDrawer && this.teamDirty) {
      entries.push({ key: "agent", label: "Agent im Drawer" });
    }
    if (this.teamSettingsDirty()) {
      entries.push({ key: "settings", label: "Team-Einstellungen" });
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
      if (entry.key === "verify" || entry.key === "lessons") ok = await this.saveRepo(cx, entry.key, true);
      if (entry.key === "agent") ok = await this.saveAgent(cx, true);
      if (entry.key === "settings") ok = await this.saveTeamSettings(cx, true);
      if (!ok) break;
    }
    return ok;
  }

  discardDirty(cx) {
    if (this.titleEdit) this.titleEdit.set_value(this.titleSaved);
    if (this.bodyEditor) this.bodyEditor.set_value(this.bodySaved);
    if (this.promptEditor) this.promptEditor.set_value(this.promptSaved);
    if (this.verifyEditor) this.verifyEditor.set_value(this.verifySaved);
    if (this.lessonsEditor) this.lessonsEditor.set_value(this.lessonsSaved);
    if (this.teamDrawer) this.teamDirty = false;
    this.reviewerDraft = this.roster?.reviewer ?? "";
    if (this.maxSessions) this.maxSessions.set_value(String(this.roster?.max_sessions ?? 4));
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
        agents: (raw.agents ?? []).map((agent) => {
          const parts = model.argvParts(agent.argv ?? []);
          return {
            ...agent,
            program: agent.program ?? parts.program,
            model: agent.model ?? parts.model,
            flags: agent.flags ?? parts.flags,
            open_tickets: agent.open_tickets ?? 0,
            sessions: agent.sessions ?? [],
          };
        }),
      };
      this.rosterError = null;
      this.rosterAt = Date.now();
      if (!this.maxSessions) {
        this.maxSessions = InputState.new({ value: String(this.roster.max_sessions ?? 4) });
        this.maxSessions.set_step(1);
        this.maxSessions.set_min(1);
        this.maxSessions.set_max(16);
        this.maxSessions.on("change", (_event, cx) => cx.notify());
        this.maxSessions.on("submit", (_event, cx) => this.saveSetting("max_sessions", this.maxSessions.value(), cx));
        this.track(this.maxSessions);
      }
      if (!this.teamSettingsDirty()) {
        this.reviewerDraft = this.roster.reviewer ?? "";
        if (this.maxSessions && !this.fieldFocused) {
          this.maxSessions.set_value(String(this.roster.max_sessions ?? 4));
        }
      }
    } catch (error) {
      this.rosterError = `Roster nicht lesbar: ${message(error)}`;
    }
    this.notifyNow();
  }

  async loadOrchestrator(cx) {
    try {
      const result = await this.execFab(["orchestrator", "status", "--json"], { timeout: 20000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      this.orchestrator = parseJson(result.stdout, null);
      this.orchestratorError = null;
    } catch (error) {
      this.orchestratorError = `Orchestrator-Status nicht lesbar: ${message(error)}`;
      this.orchestrator = null;
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
    try {
      const result = await this.execFab(["repo", "show", path, "--json"], { timeout: 30000 });
      if (result.code !== 0) throw new Error((result.stderr || "").trim() || `Code ${result.code}`);
      const raw = parseJson(result.stdout, null);
      if (!raw) throw new Error("repo show --json lieferte kein JSON");
      this.repoDetail = raw;
      this.repoError = null;
      this.verifySaved = raw.verify?.text ?? "";
      this.lessonsSaved = raw.lessons?.text ?? "";
      this.verifyEditor = raw.verify?.exists ? this.newEditor("shell", this.verifySaved) : null;
      this.lessonsEditor = this.newEditor("markdown", this.lessonsSaved);
      this.repoTest = null;
      this.repoTab = "verify";
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
    cx.spawn(async (cx) => {
      const cwd = focused()?.cwd;
      if (!cwd) return;
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
        if (top.code === 0 && top.stdout.trim() && !this.newRepo) {
          this.newRepo = top.stdout.trim();
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

  async createTicket(cx) {
    if (this.busy) return;
    const sentence = (this.newSentence?.value() ?? "").trim();
    if (!sentence) {
      this.newError = "Bitte einen Satz eingeben.";
      this.notifyNow();
      return;
    }
    const args = model.newArgs(sentence, { repo: this.newRepo, wake: this.newWake });
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
    this.notifyNow();
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
  }

  async setStatusOf(id, status, cx) {
    if (!id) return;
    await this.action("status", ["status", id, status, "--from=mensch"], {
      success: `Status: ${model.statusWord(status)}.`,
    });
  }

  async setStatus(status, cx) {
    if (status === this.ticket?.status) return;
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
    this.modal = null;
    await this.action("accept", ["accept", id], {
      success: `${id} abgenommen.`,
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
    this.wakeName = this.ticket.assignee || this.agents[0]?.name || "";
    this.wakeText = InputState.new({ placeholder: "Was soll der Agent tun?" });
    this.wakeText.on("submit", (_event, cx) => {
      if (this.consumeMentionSubmit("wake", cx)) return;
      this.sendWake(cx);
    });
    this.track(this.wakeText);
    this.wireMentions("wake", this.wakeText);
    this.clearMentions();
    this.notifyNow();
    cx.timer.after(60, () => this.wakeText?.focus());
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

  openAcceptModal(cx) {
    const ticket = this.ticket;
    if (!ticket) return;
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

  openAgentDrawer(mode, agent, cx) {
    const next = { mode, original: agent?.name ?? "" };
    if (model.sameAgentDraft(this.teamDrawer, next)) {
      this.notifyNow();
      return;
    }
    if (model.agentSwitchNeedsConfirm(this.teamDrawer, next, this.teamDirty)) {
      // Der offene Drawer gehört einem anderen Agenten; erst speichern oder verwerfen.
      this.guard(() => this.showAgentDrawer(mode, agent, cx), cx);
      return;
    }
    this.showAgentDrawer(mode, agent, cx);
  }

  showAgentDrawer(mode, agent, cx) {
    // Ein offenes Dropdown darf nicht in den neuen Agenten hineinwählen.
    this.menu = null;
    this.agentDraftId += 1;
    const draftId = this.agentDraftId;
    const draft = model.agentDraft(agent);
    this.teamDirty = false;
    this.teamDrawer = { mode, original: draft.original };
    this.agentOriginal = draft.original;
    this.agentColorKey = agent?.color ?? this.nextColor();
    this.agentProgram = draft.program;
    this.agentName = InputState.new({ value: draft.name });
    this.agentRole = InputState.new({ value: draft.role });
    this.agentModel = InputState.new({ value: draft.model });
    this.agentFlags = InputState.new({ value: draft.flags });
    this.agentPrompt = this.newEditor("markdown", "");
    for (const state of [this.agentName, this.agentRole, this.agentModel, this.agentFlags]) {
      state.on("change", (_event, cx) => { this.teamDirty = true; this.notifyNow(); });
      this.track(state);
    }
    this.agentPrompt.on("change", (_event, cx) => {
      if (this.agentPromptLoading) return;
      this.teamDirty = true;
      this.notifyNow();
    });
    const editor = this.agentPrompt;
    this.ensurePrograms(cx);
    this.notifyNow();
    if (agent?.name) {
      cx.spawn(async (cx) => {
        let text = null;
        try {
          const result = await this.execFab(["prompt", "show", agent.name], { timeout: 20000 });
          if (result.code === 0) text = result.stdout ?? "";
        } catch {
          // Ohne Promptdatei bleibt der Editor leer; fab legt sie beim Speichern an.
        }
        if (text === null) return;
        // Nur der Drawer, der diesen Lauf gestartet hat, darf ihn übernehmen.
        if (!model.promptLoadApplies(
          { draft: draftId, editor, name: agent.name },
          { draft: this.agentDraftId, editor: this.agentPrompt, name: this.agentOriginal },
        )) return;
        if (editor.value() !== "") return; // Nutzer tippt bereits im Feld
        const dirty = this.teamDirty;
        this.agentPromptLoading = true;
        editor.set_value(text);
        this.agentPromptLoading = false;
        this.teamDirty = dirty;
        this.notifyNow();
      });
    }
  }

  nextColor() {
    const used = new Set(this.agents.map((agent) => agent.color));
    for (const key of ["c1", "c2", "c3", "c4", "c5", "c6"]) if (!used.has(key)) return key;
    return "c1";
  }

  clearAgentDrawer(cx) {
    this.agentDraftId += 1;
    this.teamDrawer = null;
    this.teamDirty = false;
    this.agentName = null;
    this.agentRole = null;
    this.agentModel = null;
    this.agentFlags = null;
    this.agentPrompt = null;
    cx?.notify();
  }

  closeDrawer(cx) {
    if (!this.teamDrawer) return;
    if (this.teamDirty) {
      this.modal = {
        kind: "unsaved",
        dirty: this.dirtySections(),
        then: () => this.clearAgentDrawer(cx),
      };
      cx?.notify();
    } else {
      this.clearAgentDrawer(cx);
    }
  }

  async saveAgent(cx, silent = false) {
    if (!this.teamDrawer || this.teamSaving) return false;
    const draftId = this.agentDraftId;
    const draft = {
      mode: this.teamDrawer.mode,
      original: this.agentOriginal,
      color: this.agentColorKey,
    };
    const plan = model.agentSaveArgs(draft, {
      name: this.agentName.value(),
      role: this.agentRole.value(),
      model: this.agentModel.value(),
      flags: this.agentFlags.value(),
      program: this.agentProgram,
      prompt: this.agentPrompt.value(),
    });
    if (plan.error) {
      this.setError("agent", plan.error);
      this.notifyNow();
      return false;
    }

    this.teamSaving = true;
    const result = await this.action("agent", plan.args, {
      success: draft.mode === "new" ? `Agent ${plan.name} angelegt.` : `Agent ${plan.name} gespeichert.`,
    });
    this.teamSaving = false;
    if (result.ok) {
      await this.loadRoster(cx);
      // Ein zwischenzeitlich geöffneter anderer Drawer bleibt stehen.
      if (this.agentDraftId === draftId) this.clearAgentDrawer();
    }
    if (!silent) this.notifyNow();
    return result.ok;
  }

  confirmDeleteAgent(agent, cx) {
    this.modal = { kind: "delete-agent", agent };
    this.notifyNow();
  }

  async deleteAgent(cx) {
    const agent = this.modal?.agent;
    if (!agent) return;
    this.modal = null;
    await this.action("agent-rm", ["agent", "rm", agent.name, "--from=mensch"], {
      success: `Agent ${agent.name} entfernt.`,
      after: (result) => {
        this.clearAgentDrawer();
        this.loadRoster(cx);
      },
    });
    this.notifyNow();
  }

  async saveSetting(key, value, cx, { silentSuccess = false } = {}) {
    const result = await this.action("settings", ["settings", "set", key, String(value), "--from=mensch"], {
      success: silentSuccess ? "" : (key === "reviewer" ? `Prüfer: ${value}.` : `Maximale Sessions: ${value}.`),
      after: (result) => this.loadRoster(cx),
    });
    return result.ok;
  }

  async saveTeamSettings(cx, silent = false) {
    const roster = this.roster;
    if (!roster) return false;
    const reviewer = this.reviewerDraft ?? roster.reviewer ?? "";
    const sessions = String(this.maxSessions?.value() ?? roster.max_sessions ?? "");
    const reviewerChanged = reviewer !== (roster.reviewer ?? "");
    const sessionsChanged = sessions !== String(roster.max_sessions ?? "");
    if (!reviewerChanged && !sessionsChanged) return true;
    let ok = true;
    if (reviewerChanged) {
      ok = await this.saveSetting("reviewer", reviewer, cx, { silentSuccess: true });
    }
    if (ok && sessionsChanged) {
      ok = await this.saveSetting("max_sessions", sessions, cx, { silentSuccess: true });
      if (!ok) {
        const failure = this.errorFor("settings")?.text ?? "unbekannter Fehler";
        this.setError("settings",
          `Der Prüfer wurde bereits gespeichert; die Sessions nicht: ${failure}`);
      }
    }
    if (ok) {
      this.reviewerDraft = this.roster?.reviewer ?? reviewer;
      notify({ title: "Fabric", body: "Team-Einstellungen gespeichert.", level: "success" });
    }
    if (!silent) this.notifyNow();
    return ok;
  }

  async orchestrator(action, cx) {
    const args = ["orchestrator", action];
    if (action === "restart") args.push("--from=mensch");
    await this.action("orchestrator", args, {
      success: action === "start" ? "Orchestrator gestartet."
        : action === "stop" ? "Orchestrator gestoppt." : "Orchestrator neu gestartet.",
      timeout: 120000,
      after: (result) => this.loadOrchestrator(cx),
    });
  }

  orchestratorState() {
    return model.liveOrchestrator(this.orchestrator, terminals());
  }

  peekOrchestrator(cx) {
    const terminal = this.orchestratorState().terminal;
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

  // ---------- Repos ----------

  async saveRepo(cx, only = null, silent = false) {
    if (!this.repoDetail) return false;
    const key = only ?? this.repoTab;
    const editor = key === "verify" ? this.verifyEditor : this.lessonsEditor;
    if (!editor) {
      this.setError(key === "verify" ? "verify" : "lessons", "Noch keine Datei angelegt.");
      this.notifyNow();
      return false;
    }
    const text = editor.value();
    const result = await this.action("repo-set", model.repoSetArgs(this.repoDetail.path, key, text), {
      success: key === "verify" ? "Prüfskript gespeichert." : "Lernnotizen gespeichert.",
      after: () => {
        if (key === "verify") {
          this.verifySaved = text;
          this.repoDetail.verify = { ...(this.repoDetail.verify ?? {}), exists: true, text };
        } else {
          this.lessonsSaved = text;
          this.repoDetail.lessons = { ...(this.repoDetail.lessons ?? {}), exists: true, text };
        }
        if (this.repoDetail) {
          this.repos = (this.repos ?? []).map((repo) => repo.path === this.repoDetail.path
            ? { ...repo, verify_exists: Boolean(this.repoDetail.verify?.exists), lessons_exists: Boolean(this.repoDetail.lessons?.exists) }
            : repo);
        }
      },
    });
    if (result.ok) {
      if (key === "verify") this.verifySaved = text;
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

  discardRepo(cx) {
    if (this.repoTab === "verify" && this.verifyEditor) this.verifyEditor.set_value(this.verifySaved);
    if (this.repoTab === "lessons" && this.lessonsEditor) this.lessonsEditor.set_value(this.lessonsSaved);
    this.setError("repo-set", null);
    this.notifyNow();
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
    if (this.view === "inbox") return renderInboxPanel(this, cx, t);
    if (this.view === "timeline") return renderTimelinePanel(this, cx, t);
    if (this.view === "switcher") return renderSwitcher(this, cx, t);
    if (this.view === "app") return this.renderWindow(cx, t);
    return renderTicketsPanel(this, cx, t);
  }

  renderWindow(cx, t) {
    const route = this.currentRoute();
    const page = route.page;
    const content = page === "board" ? renderBoard(this, cx, t)
      : page === "tickets" ? renderTicketsPage(this, cx, t)
        : page === "ticket" ? renderTicket(this, cx, t)
          : page === "team" ? renderTeam(this, cx, t)
            : page === "prompts" ? renderPrompts(this, cx, t)
              : page === "repos" ? renderRepos(this, cx, t)
                : renderSettings(this, cx, t);

    const state = this.orchestratorState();
    const statusWord = model.orchestratorWord(state);
    const statusColor = ui.orchestratorStatus(t, state).color;

    const nav = v_flex()
      .flex_none()
      .w(ui.SIZE.sidebar)
      .min_h(0)
      .p(ui.SPACE.s)
      .gap(2)
      .border_r(1)
      .border_color(t.border)
      .bg(t.chrome)
      .child(
        h_flex()
          .w_full()
          .h(40)
          .px(8)
          .gap(8)
          .items_center()
          .child(div().flex_none().text_color(t.accent).child(ui.icon("fabric", 17)))
          .child(div().text_size(ui.FONT.m).font_semibold().child("Fabric")),
      )
      .children(NAV.map((item) => ui.navItem(t, {
        id: `fabric-nav-${item.page}`,
        icon: item.icon,
        label: item.label,
        active: page === item.page || (page === "ticket" && item.page === "tickets"),
        onClick: (cx) => this.navigate(item.page, {}, cx),
        badge: null,
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
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .max_w(440)
          .gap(6)
          .items_center()
          .child(div().flex_none().text_color(t.dim).child(ui.icon("search", 13)))
          .child(div().flex_1().min_w(0).child(ui.input(t, this.search, { focused: this.searchFocused })))
          .child(ui.keyHint(t, "/")),
      )
      .child(div().flex_1())
      .child(ui.button(t, {
        id: "fabric-new-ticket",
        label: "Neues Ticket",
        icon: "plus",
        primary: true,
        tooltip: "Neues Ticket (⌘N)",
        onClick: (cx) => this.openNewTicket(cx),
      }))
      .child(this.inboxButton(t, cx))
      .child(ui.iconButton(t, {
        id: "fabric-window-close",
        icon: "close",
        tooltip: "Fenster schließen (Esc)",
        onClick: (cx) => this.closeWindowWithGuard(cx),
      }));

    const body = h_flex()
      .flex_1()
      .min_h(0)
      .items_stretch()
      .child(nav)
      .child(v_flex().flex_1().min_w(0).h_full().min_h(0).overflow_hidden().child(content))
      .when(Boolean(this.teamDrawer), (el) => el.child(renderAgentDrawer(this, cx, t)));

    const overlay = [];
    if (this.menu || this.inboxOpen) {
      overlay.push(ui.backdrop(t, {
        dim: false,
        onClick: (cx) => { this.menu = null; this.inboxOpen = false; this.notifyNow(); },
      }));
    }
    if (this.newOpen || this.modal) overlay.push(renderDialogs(this, cx, t));
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
      .track_focus(this.appFocus)
      .on_key_down((event, cx) => this.keys(event, cx))
      .child(
        v_flex().size_full().min_h(0)
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

  inboxButton(t, cx) {
    const trigger = h_flex()
      .id("fabric-inbox-button")
      .flex_none()
      .h(ui.SIZE.button)
      .px(9)
      .gap(6)
      .items_center()
      .rounded(ui.RADIUS.m)
      .border_1()
      .border_color(this.inboxOpen ? t.accent : t.input)
      .bg(this.inboxOpen ? t.selected : t.raised)
      .cursor_pointer()
      .hover((s) => s.opacity(0.86))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => {
        cx.stop_propagation();
        this.inboxOpen = !this.inboxOpen;
        this.menu = null;
        this.notifyNow();
      })
      .child(div().flex_none().text_color(t.muted).child(ui.icon("inbox", 14)))
      .child(div().text_size(ui.FONT.s).text_color(t.muted).child("Inbox"))
      .child(ui.badge(t, this.inbox.length, this.inbox.length ? t.accent : t.dim))
      .tooltip("Posteingang");

    const panel = v_flex()
      .w(360)
      .max_h(420)
      .rounded(ui.RADIUS.l)
      .border_1()
      .border_color(t.border)
      .bg(t.popover)
      .child(
        h_flex().w_full().px(ui.SPACE.m).h(38).items_center().border_b(1).border_color(t.border)
          .child(div().flex_1().text_size(ui.FONT.s).font_semibold().child("Posteingang"))
          .child(ui.badge(t, this.inbox.length, t.accent)),
      )
      .child(
        this.inbox.length
          ? v_flex().max_h(360).overflow_y_scrollbar().children(model.sortInbox(this.inbox).map((entry, index) =>
            h_flex()
              .id(`fabric-inbox-pop-${entry.ticket}-${index}`)
              .w_full()
              .px(ui.SPACE.m)
              .py(7)
              .gap(ui.SPACE.s)
              .items_start()
              .border_b(1)
              .border_color(t.border)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .on_click((_event, cx) => {
                cx.stop_propagation();
                this.inboxOpen = false;
                this.openInWindow({ page: "ticket", id: entry.ticket }, cx);
              })
              .child(ui.chip(t, model.INBOX_WORDS[entry.kind] ?? entry.kind, ui.inboxColor(t, entry.kind)))
              .child(v_flex().flex_1().min_w(0).gap(1)
                .child(h_flex().gap(6).text_size(ui.FONT.xs).text_color(t.dim)
                  .child(entry.ticket ?? "")
                  .child(`· ${entry.from ?? "fab"}`)
                  .child(`· ${model.relativeTime(entry.at)}`))
                .child(div().text_size(ui.FONT.s).text_color(t.foreground).truncate()
                  .child(TextView.markdown(
                    `fabric-inbox-pop-text-${entry.ticket}-${index}`,
                    model.plainMentionMarkdown(model.oneLine(entry.text, 120)),
                  ).text_size(ui.FONT.s).text_color(t.foreground).whitespace_nowrap())))))
          : ui.emptyState(t, { title: "Nichts zu tun", text: "Der Posteingang ist leer." }),
      );

    return PopupWrapper(t, "fabric-inbox-panel", trigger, this.inboxOpen, panel);
  }

}

function PopupWrapper(t, id, trigger, open, content) {
  return Popup.new(id, trigger).anchor("bottom_right").when(open, (el) => el.content(content));
}

async function knownAgentsSafe() {
  try {
    return await knownAgents();
  } catch {
    return [];
  }
}
