"""Erwähnungen (`@name`) und die Weckregeln aus Abschnitt 4 des Vertrags."""
import os
import re
import subprocess
import sys

from . import agents, events, git, hc, orchestrator, store, teams
from .errors import FabError, HcError

# Kein `@` direkt hinter einem E-Mail-Zeichen: `a@b.de` ist keine Erwähnung.
MENTION_RE = re.compile(r"(?<![A-Za-z0-9._%+-])@([a-z][a-z0-9_-]*)", re.IGNORECASE)
RESERVED = ("orchestrator", "mensch")
PING_WINDOW_MS = 10 * 60 * 1000
PING_LIMIT = 8
START_FAILED = "unterdrückt: start fehlgeschlagen"
FIRST_FAILED = "erster Versuch fehlgeschlagen"
START_RETRY = "zweiter Versuch erfolgreich"
RETRY_DELAY_DEFAULT = 5.0


def known_names(roster=None):
    """Alle Namen, die eine Erwähnung wecken oder in die Inbox legen können."""
    names = set(RESERVED)
    for entry in (roster or {}).get("agents") or []:
        name = str(entry.get("name") or "").lower()
        if name:
            names.add(name)
    for team_entry in (roster or {}).get("teams") or []:
        if not isinstance(team_entry, dict):
            continue
        for entry in teams.expand_team(roster, team_entry):
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
    ticket.pop("stall", None)
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


def _short_reason(text, limit=280):
    """Grund einzeilig und höchstens `limit` Zeichen; leer bleibt leer."""
    if not text:
        return ""
    collapsed = " ".join(str(text).split())
    return collapsed[:limit]


def _ticket_team(roster, ticket):
    """Team des Ticket-Repos; ohne Repo das Legacy-Team (erstes Team)."""
    repo = ticket.get("repo")
    if not repo:
        return teams.first_team(roster)
    return teams.team_for_repo(roster, repo)


def _orchestrator_wake(roster, text, team_entry=None, actor="fab"):
    """Weckt den Team-Orchestrator; startet ihn, wenn er nicht läuft.

    Ist der Zähler des Teams voll, wird ein laufender Orchestrator vorher neu
    gestartet; die Weckernachricht geht an die neue Session.

    Rückgabe: (ergebnis, adresse, grund). `grund` erklärt einen
    Startfehler und ist sonst "".
    """
    entry = team_entry if isinstance(team_entry, dict) else teams.first_team(roster)
    if not entry:
        return "unterdrückt: kein Team", None, ""
    team_name = str(entry.get("name") or "")
    try:
        live = hc.live()
    except HcError:
        live = {}
    due, reason = orchestrator.restart_due(roster, entry)
    for target in agents.orchestrator_targets(roster, team_name):
        row = live.get(target)
        if row:
            if due:
                try:
                    started = orchestrator.restart(roster, entry, reason, actor)
                except (FabError, HcError) as exc:
                    return START_FAILED, None, str(exc)
                ok, detail = hc.send_detail(
                    started.get("terminal") or started["name"], text
                )
                if ok:
                    return "gestartet", started["name"], ""
                return START_FAILED, None, detail
            address = row.get("address") or target
            ok, detail = hc.send_detail(address, text)
            if ok:
                return "geweckt", address, ""
            return START_FAILED, None, detail
    try:
        started = agents.start_orchestrator(roster, team_name)
    except (FabError, HcError) as exc:
        return START_FAILED, None, str(exc)
    ok, detail = hc.send_detail(
        started.get("terminal") or started["name"], text
    )
    if ok:
        return "gestartet", started["name"], ""
    return START_FAILED, None, detail


def _notify_orchestrator(roster, text, team_entry=None):
    """Eine Nachricht an den Team-Orchestrator, ohne Weckereignis (Ping-Pong-Bremse)."""
    entry = team_entry if isinstance(team_entry, dict) else teams.first_team(roster)
    if not entry:
        return False
    team_name = str(entry.get("name") or "")
    try:
        live = hc.live()
    except HcError:
        live = {}
    for target in agents.orchestrator_targets(roster, team_name):
        if target in live:
            return hc.send(live[target].get("address") or target, text)
    try:
        started = agents.start_orchestrator(roster, team_name)
    except (FabError, HcError):
        return False
    return hc.send(started["name"], text)


def _pingpong_notice(ticket, name, author, roster):
    """Beim ersten Ping-Pong eines Tickets genau eine Nachricht."""
    if events.has_text(ticket["id"], "unterdrückt: ping-pong"):
        return
    text = (
        f"Ping-Pong zwischen {author} und {name} in {ticket['id']}: mehr als "
        f"{PING_LIMIT} Weckungen in 10 Minuten. Bitte im Ticket klären "
        f"(`fab show {ticket['id']}`)."
    )
    _notify_orchestrator(roster, text, _ticket_team(roster, ticket))


def _one(ticket, name, author, text, roster, no_wake, message_for, send_text=None):
    """Eine Erwähnung.

    Rückgabe: (wake-text oder None, Zeile fürs Terminal, Adresse, Grund).
    """
    if name == "mensch" and not no_wake:
        conflict = ticket_conflict(ticket)
        if conflict is not None:
            base, files = conflict
            comment = conflict_text(ticket, base, files)
            add_comment(ticket, author, comment, roster)
            assignee = (ticket.get("assignee") or "").lower()
            if assignee and assignee in known_names(roster) and assignee != "mensch":
                event_text, line, address, reason = _one(
                    ticket, assignee, author, comment, roster, no_wake,
                    lambda _name: conflict_wake_text(ticket, base, files),
                )
                if event_text is not None:
                    events.append(
                        "wake", ticket["id"], author, assignee, event_text,
                        reason=_short_reason(reason),
                    )
                return None, f"Merge-Konflikt mit {base}: {line}", address, reason
            return None, f"Merge-Konflikt mit {base}: kein zuständiger Agent", None, ""
    if name == (author or "").lower():
        return None, "kein Wecken: du bist der Autor", None, ""
    if no_wake:
        return None, "kein Wecken (--no-wake)", None, ""
    if name == "mensch":
        if "mensch" not in ticket["waiting"]:
            ticket["waiting"].append("mensch")
        return "unterdrückt: mensch", "unterdrückt: mensch", None, ""
    if ticket.get("status") in ("done", "dropped"):
        return "unterdrückt: abgeschlossen", "unterdrückt: abgeschlossen", None, ""

    now = store.now_ms()
    if events.count_wakes(ticket["id"], name, now - PING_WINDOW_MS) > PING_LIMIT:
        _pingpong_notice(ticket, name, author, roster)
        return "unterdrückt: ping-pong", "unterdrückt: ping-pong", None, ""

    if send_text is None:
        send_text = message_for(name) if message_for else message(ticket, author, name, text)
    team_entry = _ticket_team(roster, ticket)

    if name == "orchestrator":
        if team_entry is None:
            return "unterdrückt: kein Team", "unterdrückt: kein Team", None, ""
        result, address, reason = _orchestrator_wake(
            roster, send_text, team_entry, author
        )
        line = f"{result} ({reason})" if reason else result
        return result, line, address, reason

    if team_entry is None:
        return "unterdrückt: kein Team", "unterdrückt: kein Team", None, ""
    team_name = str(team_entry.get("name") or "")
    try:
        agents.agent_in_team(roster, team_entry, name)
    except FabError:
        return "unterdrückt: nicht im Team", "unterdrückt: nicht im Team", None, ""

    targets = [hc.terminal_name(name, ticket["id"], team_name)]
    if team_name == teams.legacy_team_name(roster):
        targets.append(hc.terminal_name(name, ticket["id"]))
    try:
        live = hc.live()
    except HcError:
        live = {}
    for terminal_name in targets:
        if terminal_name in live:
            address = live[terminal_name].get("address") or terminal_name
            agents.remember_session(ticket, name, terminal_name, address)
            ok, detail = hc.send_detail(address, send_text)
            if ok:
                return "geweckt", "geweckt", address, ""
            line = f"{START_FAILED} ({detail})" if detail else START_FAILED
            return START_FAILED, line, None, detail

    if ticket.get("worktree"):
        try:
            started = agents.start_agent(roster, ticket, name)
        except (FabError, HcError) as exc:
            reason = str(exc)
            return START_FAILED, f"{START_FAILED} ({reason})", None, reason
        result = started["result"]
        reason = ""
        line = result
        if result == START_FAILED:
            reason = started.get("error") or ""
            if reason:
                line = f"{result} ({reason})"
        elif result == "gestartet":
            agents.remember_session(
                ticket, name, started["name"], started["terminal"]
            )
            if started.get("warning"):
                line = f"{result} ({started['warning']})"
        return result, line, started["terminal"], reason

    notice = (
        f"Ticket {ticket['id']} „{ticket['title']}“: @{author} hat @{name} erwähnt, "
        f"aber das Ticket hat keinen Worktree. Lies `fab show {ticket['id']}` und "
        f"entscheide (`fab dispatch {ticket['id']} --agent {name}`)."
    )
    result, address, reason = _orchestrator_wake(
        roster, notice, team_entry, author
    )
    if result in ("geweckt", "gestartet"):
        return "an orchestrator", "an orchestrator", address, ""
    line = f"{START_FAILED} ({reason})" if reason else START_FAILED
    return START_FAILED, line, None, reason


def once(ticket, name, author, text, roster):
    """Eine Aktion ohne Ereignis, Kommentar oder Retry.

    Rückgabe wie `_one`: (wake-text oder None, Zeile, Adresse, Grund).
    """
    return _one(ticket, name, author, text, roster, False, None, send_text=text)


def retry_delay():
    """Sekunden bis zum zweiten Versuch aus `FAB_WAKE_RETRY_DELAY` (Standard 5)."""
    raw = os.environ.get("FAB_WAKE_RETRY_DELAY")
    if raw is None:
        return RETRY_DELAY_DEFAULT
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return RETRY_DELAY_DEFAULT
    if value != value:  # NaN
        return RETRY_DELAY_DEFAULT
    return value if value > 0 else 0.0


def schedule_retry(ticket, name, send_text):
    """Zweiten Versuch im Hintergrund starten; ohne Rückkopplung auf `fab wake`.

    Rückgabe: True, wenn der Prozess gestartet wurde, sonst False.
    """
    folder = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
    argv = [
        sys.executable,
        os.path.join(folder, "fab"),
        "wake",
        ticket["id"],
        name,
        "--from",
        "fab",
        "--retry",
        "--",
        send_text,
    ]
    try:
        subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
        )
    except OSError:
        return False
    return True


def process(ticket, names, author, text, roster, no_wake=False, message_for=None,
            attempt=1, direct=False):
    """Jede Erwähnung nach den Regeln behandeln und je Ergebnis ein wake-Ereignis.

    Ein fehlgeschlagener Start wird genau einmal nach `retry_delay()` wiederholt;
    der zweite Versuch läuft als eigener Prozess mit `attempt=2`.

    Rückgabe: Liste von (Name, Ergebniszeile).
    """
    printed = []
    known = known_names(roster)
    for name in names:
        if name not in known:
            continue
        send_text = text if direct else (
            message_for(name) if message_for else message(ticket, author, name, text)
        )
        reason = ""
        try:
            event_text, line, _address, reason = _one(
                ticket, name, author, text, roster, no_wake, message_for,
                send_text=send_text,
            )
        except FabError as exc:
            event_text = START_FAILED
            reason = str(exc)
            line = f"{event_text} ({reason})"
        if event_text is None:
            printed.append((name, line))
            continue
        reason = _short_reason(reason)
        target = "Team-Orchestrator" if name == "orchestrator" else name
        if attempt == 1 and event_text == START_FAILED:
            detail = reason or "unbekannt"
            delay = retry_delay()
            scheduled = schedule_retry(ticket, name, send_text)
            if scheduled:
                add_comment(
                    ticket,
                    "fab",
                    f"Start fehlgeschlagen: {target} wurde nicht gestartet.\n"
                    f"Grund: {detail}\nZweiter Versuch in {delay:g} s.",
                    roster,
                )
                events.append(
                    "wake", ticket["id"], author, name, FIRST_FAILED, reason=reason
                )
            else:
                add_comment(
                    ticket,
                    "fab",
                    f"Start fehlgeschlagen: {target} wurde nicht gestartet.\n"
                    f"Grund: {detail}\nDie Wiederholung konnte nicht gestartet "
                    f"werden.",
                    roster,
                )
                events.append(
                    "wake", ticket["id"], author, name, START_FAILED, reason=reason
                )
        elif attempt == 2 and event_text == START_FAILED:
            detail = reason or "unbekannt"
            add_comment(
                ticket,
                "fab",
                f"Start endgültig fehlgeschlagen: {target} wurde auch im zweiten "
                f"Versuch nicht gestartet.\nGrund: {detail}\nIm Mod „Erneut "
                f"starten“ drücken oder `fab wake {ticket['id']} {name} "
                f"--from mensch`.",
                roster,
            )
            events.append("wake", ticket["id"], author, name, event_text, reason=reason)
        elif attempt == 2 and event_text in ("geweckt", "gestartet"):
            add_comment(
                ticket,
                "fab",
                f"zweiter Versuch erfolgreich: {target} läuft wieder.",
                roster,
            )
            events.append(
                "wake", ticket["id"], author, name, START_RETRY, reason=event_text
            )
        else:
            events.append("wake", ticket["id"], author, name, event_text, reason=reason)
        printed.append((name, line))
    return printed
