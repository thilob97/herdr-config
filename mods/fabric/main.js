// Fabric: Tickets, Posteingang und Zeitverlauf in einem Mod.
// Die Ansicht kommt aus props().view; geschrieben wird nur über fabric/fab.

import { View, div } from "gpui-kit";
import { InputState } from "gpui-base";
import {
  appHome, checking, exec, focused, layout, nextCommand, props, readTextFile, run,
  setShared, shared, watchFolder,
} from "herdr";
import * as ui from "./ui.js";
import * as model from "./model.js";
import { renderTickets } from "./views/tickets.js";
import { renderInbox } from "./views/inbox.js";
import { renderTimeline } from "./views/timeline.js";

function message(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
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

export default class Fabric extends View {
  init(_props, cx) {
    this.dir = `${appHome()}/data/fabric`;
    this.index = null;
    this.ready = false;
    this.loadError = null;
    this.ticket = null;
    this.ticketError = null;
    this.openId = null;
    this.flash = null;
    this.busy = "";
    this.doneOpen = false;
    this.hoverPoint = null;
    this.closed = false;
    this.watch = null;
    this.refreshing = false;
    this.pending = false;
    this.newInputFocused = false;
    this.commentFocused = false;

    this.newInput = InputState.new({ placeholder: "Neues Ticket in einem Satz…" });
    this.newInput.on("change", (_event, cx) => cx.notify());
    this.newInput.on("submit", (_event, cx) => this.create(cx));
    this.newInput.on("focus", (_event, cx) => { this.newInputFocused = true; cx.notify(); });
    this.newInput.on("blur", (_event, cx) => { this.newInputFocused = false; cx.notify(); });

    this.commentInput = InputState.new({ placeholder: "Kommentar … @name weckt" });
    this.commentInput.on("change", (_event, cx) => cx.notify());
    this.commentInput.on("submit", (_event, cx) => this.comment(cx));
    this.commentInput.on("focus", (_event, cx) => { this.commentFocused = true; cx.notify(); });
    this.commentInput.on("blur", (_event, cx) => { this.commentFocused = false; cx.notify(); });

    // `herdr-app check` lädt den Mod einmal: keine Dateien lesen, nichts starten.
    if (checking()) {
      this.ready = true;
      return;
    }

    cx.spawn(async (cx) => {
      await this.refresh(cx);
      this.watchLoop(cx);
      this.commandLoop(cx);
    });
    cx.timer.every(5000, (cx) => { if (!this.closed) this.refresh(cx); });
  }

  async close() {
    this.closed = true;
    this.watch?.cancel();
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

  async refresh(cx) {
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
      if (!this.closed) cx.notify();
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

    const selected = shared("fabric.selected");
    this.openId = typeof selected === "string" && selected ? selected : null;
    await this.loadTicket();
    // Ein Ticket, das die neue index.json nicht mehr kennt (gelöscht, anderer Stand),
    // darf das Panel nicht in einem Fehler festhalten.
    if (this.openId && this.index && !this.ticket
        && !this.index.tickets.some((ticket) => ticket?.id === this.openId)) {
      this.openId = null;
      this.ticketError = null;
      setShared("fabric.selected", null);
    }
    this.ready = true;
  }

  async loadTicket() {
    const id = this.openId;
    if (!id) {
      this.ticket = null;
      this.ticketError = null;
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
        await this.refresh(cx);
      }
    });
  }

  // ---------- Auswahl ----------

  select(id, cx) {
    const next = id || null;
    this.openId = next;
    this.ticket = null;
    this.ticketError = null;
    this.flash = null;
    this.commentInput.set_value("");
    setShared("fabric.selected", next);
    cx.notify();
    if (next) {
      cx.spawn(async (cx) => {
        await this.loadTicket();
        if (!this.closed) cx.notify();
      });
    }
  }

  back(cx) {
    this.select(null, cx);
  }

  // ---------- Aktionen (nur über fabric/fab) ----------

  async create(cx) {
    if (this.busy) return;
    const text = this.newInput.value().trim();
    if (!text) {
      this.flash = { level: "error", text: "Bitte einen Satz eingeben." };
      cx.notify();
      return;
    }
    this.busy = "new";
    this.flash = null;
    cx.notify();

    let repo = null;
    const cwd = focused()?.cwd;
    if (cwd) {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd }).catch(() => null);
      if (top?.code === 0 && top.stdout.trim()) repo = top.stdout.trim();
    }
    const args = ["new", text];
    if (repo) args.push("--repo", repo);
    const ok = await this.finish(cx, args, (result) => {
      const id = /T-\d+/.exec(result.stdout ?? "");
      if (id) {
        this.openId = id[0];
        setShared("fabric.selected", id[0]);
        return `Ticket ${id[0]} angelegt.`;
      }
      return "Ticket angelegt.";
    });
    if (ok) this.newInput.set_value("");
  }

  async comment(cx) {
    if (this.busy || !this.openId) return;
    const text = this.commentInput.value().trim();
    if (!text) {
      this.flash = { level: "error", text: "Bitte einen Kommentar schreiben." };
      cx.notify();
      return;
    }
    const id = this.openId;
    this.busy = `comment:${id}`;
    this.flash = null;
    cx.notify();
    const ok = await this.finish(cx, ["comment", id, "--from", "mensch", text], "Kommentar geschrieben.");
    if (ok) this.commentInput.set_value("");
  }

  async accept(cx) {
    if (this.busy || !this.openId) return;
    const id = this.openId;
    this.busy = `accept:${id}`;
    this.flash = null;
    cx.notify();
    await this.finish(cx, ["accept", id], `${id} abgenommen.`);
  }

  async reject(cx) {
    if (this.busy || !this.openId) return;
    const text = this.commentInput.value().trim();
    if (!text) {
      this.flash = { level: "error", text: "Bitte Feedback eingeben – es steht im Kommentarfeld." };
      cx.notify();
      return;
    }
    const id = this.openId;
    this.busy = `reject:${id}`;
    this.flash = null;
    cx.notify();
    const ok = await this.finish(cx, ["reject", id, text], `${id} mit Feedback zurückgegeben.`);
    if (ok) this.commentInput.set_value("");
  }

  /** Führt `fab` aus, zeigt stderr sichtbar und meldet Erfolg nur bei Code 0. */
  async finish(cx, args, success) {
    let result = null;
    let failure = null;
    try {
      // Im Ordner des fokussierten Terminals: `fab new` findet dort ohne --repo
      // dieselbe Git-Wurzel, und die übrigen Befehle hängen nicht am Ordner.
      result = await exec(`${appHome()}/fabric/fab`, args, {
        cwd: focused()?.cwd || appHome(),
        timeout: 120000,
      });
    } catch (error) {
      failure = `fab ließ sich nicht starten: ${message(error)}`;
    }
    this.busy = "";
    if (failure) {
      this.flash = { level: "error", text: failure };
    } else if (result.code !== 0) {
      this.flash = {
        level: "error",
        text: `fab endete mit Code ${result.code}: ${(result.stderr || "").trim() || "ohne Meldung"}`,
      };
    } else {
      const text = typeof success === "function" ? success(result) : success;
      this.flash = { level: "ok", text };
    }
    await this.refresh(cx);
    return result?.code === 0;
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
    if (command === "tickets") this.showStack("fabric-tickets");
    else if (command === "timeline") this.showStack("fabric-timeline");
    else if (command === "new") {
      this.showStack("fabric-tickets", true);
      cx.timer.after(150, () => this.newInput.focus());
    }
  }

  showStack(child, force = false) {
    const panel = findNode(layout(), "panel");
    const stack = findNode(layout(), "panel-body");
    // Dieselbe Taste schaltet das Panel wieder weg; "Neues Ticket" zeigt es immer.
    if (!force && panel && !panel.hidden && stack?.active === child) {
      run("layout.hide", { id: "panel" });
      return;
    }
    run("layout.show", { id: "panel" });
    run("layout.select", { stack: "panel-body", child });
  }

  // ---------- Anzeige ----------

  render(cx) {
    const t = ui.colors();
    const view = props()?.view ?? "tickets";
    if (!this.ready) {
      return ui.page(t, [
        ui.header(t, "Fabric"),
        div().flex_1().flex().items_center().justify_center().text_size(ui.FONT.s).text_color(t.dim).child("Lade …"),
      ]);
    }
    if (view === "inbox") return renderInbox(this, cx, t);
    if (view === "timeline") return renderTimeline(this, cx, t);
    return renderTickets(this, cx, t);
  }
}

