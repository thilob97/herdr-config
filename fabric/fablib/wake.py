"""Erwähnungen (`@name`) und die Weckregeln aus Abschnitt 4 des Vertrags."""
import re

from . import agents, events, git, hc, store
from .errors import FabError, HcError

# Kein `@` direkt hinter einem E-Mail-Zeichen: `a@b.de` ist keine Erwähnung.
MENTION_RE = re.compile(r"(?<![A-Za-z0-9._%+-])@([a-z][a-z0-9_-]*)", re.IGNORECASE)
RESERVED = ("orchestrator", "mensch")
PING_WINDOW_MS = 10 * 60 * 1000
PING_LIMIT = 8


def known_names(roster=None):
    """Alle Namen, die eine Erwähnung wecken oder in die Inbox legen können."""
    names = set(RESERVED)
    for entry in (roster or {}).get("agents") or []:
        name = str(entry.get("name") or "").lower()
        if name:
            names.add(name)
    return names


def mentions(text, known=None):
    """Jeder bekannte Name höchstens einmal, in der Reihenfolge des Textes."""
    found = []
    for match in MENTION_RE.finditer(text or ""):
        name = match.group(1).lower()
        if known is not None and name not in known:
            continue
        if name not in found:
            found.append(name)
    return found


def add_comment(ticket, author, text, roster=None):
    """Kommentar anhängen, Autor aus waiting nehmen, comment-Ereignis schreiben."""
    at = store.now_ms()
    if roster is None:
        roster = agents.load(required=False)
    found = mentions(text, known_names(roster))
    ticket["comments"].append(
        {
            "n": len(ticket["comments"]) + 1,
            "at": at,
            "author": author,
            "text": text,
            "mentions": found,
        }
    )
    ticket["waiting"] = [
        waiting for waiting in ticket["waiting"] if waiting.lower() != author.lower()
    ]
    events.append("comment", ticket["id"], author, "", text)
    return found


def ticket_conflict(ticket):
    """(basis, dateien) bei Merge-Konflikt des Ticket-Branches mit der Basis, sonst None."""
    base = ticket.get("base")
    branch_name = ticket.get("branch")
    repo = ticket.get("repo")
    if not base or not branch_name or not repo:
        return None
    try:
        files = git.merge_conflicts(repo, base, branch_name)
    except FabError:
        return None
    if not files:
        return None
    return base, files


def conflict_text(ticket, base, files):
    """Kommentar an den zuständigen Agenten mit Dateiliste und Bitte, die Basis einzumergen."""
    assignee = ticket.get("assignee") or "zuständig"
    branch_name = ticket.get("branch") or ""
    lines = [f"@{assignee} Merge-Konflikt mit {base} beim Mergen von {branch_name}:"]
    lines.extend(f"- {name}" for name in files)
    lines.append(
        f"Bitte `{base}` in den Ticket-Branch einmergen, die Konflikte auflösen, "
        f"dann `fab verify {ticket['id']}` und erneut "
        f"`fab handover {ticket['id']}`."
    )
    return "\n".join(lines)


def conflict_wake_text(ticket, base, files):
    """Einzeilige Wecknachricht: Merge-Konflikt, Dateien, Nacharbeitsbitte."""
    return (
        f"Ticket {ticket['id']} „{ticket['title']}“: Merge-Konflikt mit {base} "
        f"beim Mergen von {ticket.get('branch') or ''}. Betroffene Dateien: "
        f"{', '.join(files)}. Bitte `{base}` in den Ticket-Branch einmergen, die "
        f"Konflikte auflösen, dann `fab verify {ticket['id']}` und erneut "
        f"`fab handover {ticket['id']}`."
    )


def message(ticket, author, name, text):
    snippet = " ".join((text or "").split())[:300]
    return (
        f"Ticket {ticket['id']} „{ticket['title']}“: @{author} hat dich erwähnt: "
        f"„{snippet}“. Lies `fab show {ticket['id']}`, arbeite an diesem Ticket weiter "
        f"und antworte im Ticket mit `fab comment {ticket['id']} --from {name} \"…\"`."
    )


def _orchestrator_wake(roster, text):
    """Weckt das Orchestrator-Terminal; startet es, wenn es nicht läuft."""
    try:
        live = hc.live()
    except HcError:
        live = {}
    row = live.get(agents.ORCHESTRATOR)
    if row:
        address = row.get("address") or agents.ORCHESTRATOR
        if hc.send(address, text):
            return "geweckt", address
        return "unterdrückt: start fehlgeschlagen", None
    try:
        agents.start_orchestrator(roster)
    except (FabError, HcError):
        return "unterdrückt: start fehlgeschlagen", None
    return "gestartet", agents.ORCHESTRATOR


def _notify_orchestrator(roster, text):
    """Eine Nachricht an den Orchestrator, ohne Weckereignis (Ping-Pong-Bremse)."""
    try:
        live = hc.live()
    except HcError:
        live = {}
    row = live.get(agents.ORCHESTRATOR)
    if row:
        return hc.send(row.get("address") or agents.ORCHESTRATOR, text)
    try:
        agents.start_orchestrator(roster)
    except (FabError, HcError):
        return False
    return hc.send(agents.ORCHESTRATOR, text)


def _pingpong_notice(ticket, name, author, roster):
    """Beim ersten Ping-Pong eines Tickets genau eine Nachricht."""
    if events.has_text(ticket["id"], "unterdrückt: ping-pong"):
        return
    text = (
        f"Ping-Pong zwischen {author} und {name} in {ticket['id']}: mehr als "
        f"{PING_LIMIT} Weckungen in 10 Minuten. Bitte im Ticket klären "
        f"(`fab show {ticket['id']}`)."
    )
    _notify_orchestrator(roster, text)


def _one(ticket, name, author, text, roster, no_wake, message_for):
    """Eine Erwähnung. Rückgabe: (wake-text oder None, Zeile fürs Terminal, Adresse)."""
    if name == (author or "").lower():
        return None, "kein Wecken: du bist der Autor", None
    if no_wake:
        return None, "kein Wecken (--no-wake)", None
    if name == "mensch":
        conflict = ticket_conflict(ticket)
        if conflict is not None:
            base, files = conflict
            comment = conflict_text(ticket, base, files)
            add_comment(ticket, author, comment, roster)
            assignee = (ticket.get("assignee") or "").lower()
            if assignee and assignee in known_names(roster) and assignee != "mensch":
                event_text, line, address = _one(
                    ticket, assignee, author, comment, roster, no_wake,
                    lambda _name: conflict_wake_text(ticket, base, files),
                )
                if event_text is not None:
                    events.append("wake", ticket["id"], author, assignee, event_text)
                return None, f"Merge-Konflikt mit {base}: {line}", address
            return None, f"Merge-Konflikt mit {base}: kein zuständiger Agent", None
        if "mensch" not in ticket["waiting"]:
            ticket["waiting"].append("mensch")
        return "unterdrückt: mensch", "unterdrückt: mensch", None
    if ticket.get("status") in ("done", "dropped"):
        return "unterdrückt: abgeschlossen", "unterdrückt: abgeschlossen", None

    now = store.now_ms()
    if events.count_wakes(ticket["id"], name, now - PING_WINDOW_MS) > PING_LIMIT:
        _pingpong_notice(ticket, name, author, roster)
        return "unterdrückt: ping-pong", "unterdrückt: ping-pong", None

    send_text = message_for(name) if message_for else message(ticket, author, name, text)

    if name == "orchestrator":
        result, address = _orchestrator_wake(roster, send_text)
        return result, result, address

    entry = next((item for item in roster["agents"] if item["name"] == name), None)
    if entry is None:
        return "unterdrückt: unbekannt", "unterdrückt: unbekannt", None

    terminal_name = hc.terminal_name(name, ticket["id"])
    try:
        live = hc.live()
    except HcError:
        live = {}
    if terminal_name in live:
        address = live[terminal_name].get("address") or terminal_name
        if hc.send(address, send_text):
            return "geweckt", "geweckt", address
        return "unterdrückt: start fehlgeschlagen", "unterdrückt: start fehlgeschlagen", None

    if ticket.get("worktree"):
        try:
            started = agents.start_agent(roster, ticket, name)
        except (FabError, HcError):
            result = "unterdrückt: start fehlgeschlagen"
            return result, result, None
        result = started["result"]
        line = result
        if result == "gestartet":
            ticket["sessions"].append(
                {
                    "agent": name,
                    "terminal": started["terminal"],
                    "name": started["name"],
                    "started_at": store.now_ms(),
                }
            )
            if started.get("warning"):
                line = f"{result} ({started['warning']})"
        return result, line, started["terminal"]

    notice = (
        f"Ticket {ticket['id']} „{ticket['title']}“: @{author} hat @{name} erwähnt, "
        f"aber das Ticket hat keinen Worktree. Lies `fab show {ticket['id']}` und "
        f"entscheide (`fab dispatch {ticket['id']} --agent {name}`)."
    )
    result, address = _orchestrator_wake(roster, notice)
    if result in ("geweckt", "gestartet"):
        return "an orchestrator", "an orchestrator", address
    return "unterdrückt: start fehlgeschlagen", "unterdrückt: start fehlgeschlagen", None


def process(ticket, names, author, text, roster, no_wake=False, message_for=None):
    """Jede Erwähnung nach den Regeln behandeln und je Ergebnis ein wake-Ereignis.

    Rückgabe: Liste von (Name, Ergebniszeile).
    """
    printed = []
    known = known_names(roster)
    for name in names:
        if name not in known:
            continue
        try:
            event_text, line, _address = _one(
                ticket, name, author, text, roster, no_wake, message_for
            )
        except FabError as exc:
            event_text = "unterdrückt: start fehlgeschlagen"
            line = f"{event_text} ({exc})"
        if event_text is not None:
            events.append("wake", ticket["id"], author, name, event_text)
        printed.append((name, line))
    return printed
