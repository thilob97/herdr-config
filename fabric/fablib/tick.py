"""Stillstands-Wächter `fab tick`: Regeln 1–6 aus Abschnitt 4 des Vertrags.

Ein Lauf prüft jedes offene Ticket (`todo`/`doing`) und führt höchstens eine
Regel aus. `draft`, `review`, `done` und `dropped` bleiben unangetastet.
Jede Aktion schreibt ein `tick`-Ereignis; zugestellte Aktionen zusätzlich ein
`wake`-Ereignis, damit die Ping-Pong-Bremse sie zählt. Ein Neustart des
Team-Orchestrators wegen Leerlauf schreibt stattdessen ein
`orchestrator`-Ereignis mit Grund.
"""
import os
import plistlib
import subprocess
import sys

from . import (
    agents,
    costs,
    events,
    flows,
    hc,
    index,
    orchestrator,
    sessions,
    store,
    teams,
    wake,
)
from .errors import FabError, HcError

DEFAULTS = {"doing": 10, "mention": 5, "review": 5, "blocked": 30, "retry": 5}
SETTING_KEYS = {
    "doing": "tick_doing_minutes",
    "mention": "tick_mention_minutes",
    "review": "tick_review_minutes",
    "blocked": "tick_blocked_minutes",
    "retry": "tick_retry_minutes",
}
MINUTES = 60 * 1000
MAX_MINUTES = 1440

OPEN = ("todo", "doing")
FROZEN = ("draft", "review", "done", "dropped")
RULE_NUMBERS = {"doing": 1, "mention": 2, "review": 3, "todo": 4, "blocked": 5}
COOLDOWN = {
    "doing": "doing",
    "mention": "mention",
    "review": "review",
    "todo": "retry",
    "blocked": "blocked",
}
DELIVERED = ("geweckt", "gestartet", "an orchestrator")
SILENT = ("unterdrückt: voll", "unterdrückt: ping-pong")
NOBODY = ("orchestrator", "mensch", "fab")

LABEL = "de.herdr.fabric.tick"
INTERVAL = 60


class Result(list):
    """Ausgabezeilen eines Laufs; `changed` sagt, ob etwas geschrieben wurde."""

    changed = False


def settings(roster):
    """Schwellen in Minuten aus `roster["tick"]`, sonst die Defaults."""
    raw = (roster or {}).get("tick") or {}
    values = {}
    for rule, default in DEFAULTS.items():
        key = SETTING_KEYS[rule]
        try:
            number = int(str(raw.get(key, default)).strip())
        except (TypeError, ValueError):
            number = default
        values[rule] = max(0, min(MAX_MINUTES, number))
    return values


def run(roster, dry=False):
    """Alle offenen Tickets prüfen; Rückgabe: eine Zeile je Aktion.

    Unter `store.locked()` aufrufen. Mit `dry` werden nur lesende Aufrufe
    (`hc.live()`/`hc.get`/`events.read_all`/`agents.at_limit`) benutzt und
    nichts geschrieben.
    """
    result = Result()
    cfg = settings(roster)
    try:
        live = hc.live()
    except HcError:
        live = {}
    tickets = store.all_tickets()
    by_id = {ticket["id"]: ticket for ticket in tickets}
    open_tickets = store.open_tickets()
    ended, sessions_changed = sessions.report(
        open_tickets, live, result, dry
    )
    for ticket in open_tickets:
        try:
            changed = _tick_ticket(
                ticket, roster or {}, live, cfg, by_id, result, dry,
                ended.get(ticket["id"]) or (),
            )
        except (FabError, HcError) as exc:
            result.append(f"{ticket['id']}: Fehler: {exc}")
            continue
        if ticket["id"] in sessions_changed:
            changed = True
        if changed and not dry:
            store.save(ticket)
            result.changed = True
    _end_closed_sessions(tickets, live, result, dry)
    for team_entry in _teams(roster):
        try:
            if _tick_orchestrator(roster or {}, team_entry, live, result, dry):
                result.changed = True
        except (FabError, HcError) as exc:
            result.append(f"{team_entry.get('name')}: Fehler: {exc}")
    try:
        lines = flows.tick(roster or {}, dry=dry)
    except FabError as exc:
        result.append(f"flow: Fehler: {exc}")
    else:
        for line in lines:
            result.append(line)
            if not dry:
                result.changed = True
    if not dry:
        # Jeder echte Lauf hält die Uhr frisch; war der Alarm vorher schon
        # gesetzt, muss der Index den verschwundenen Eintrag neu schreiben.
        if store.tick_alarm()["stale"]:
            result.changed = True
        store.set_last_tick()
    return result


def _end_closed_sessions(tickets, live, lines, dry):
    """Lebende Sessions zu done/dropped-Tickets beenden und melden.

    Erfasst auch Sessions ohne Eintrag unter `## Sessions` über das
    `fab.ticket`-Label oder den Terminalnamen (`fab-…-t-<n>`).
    """
    for ticket in tickets:
        if ticket.get("status") not in ("done", "dropped"):
            continue
        for name in agents.ticket_terminals(ticket, live):
            if dry:
                lines.append(f"{ticket['id']}: geplant: Session {name} beenden")
                continue
            if hc.kill(name):
                lines.append(f"{ticket['id']}: Session {name} beendet")
            else:
                lines.append(
                    f"{ticket['id']}: Session {name} ließ sich nicht beenden"
                )


def _teams(roster):
    return [
        entry
        for entry in (roster or {}).get("teams") or []
        if isinstance(entry, dict) and entry.get("name")
    ]


def _tick_orchestrator(roster, team_entry, live, lines, dry):
    """Start, Schlaflücke oder Leerlauf eines Team-Orchestrators.

    Rückgabe: wurde etwas geschrieben bzw. neu gestartet?
    """
    team_name = str(team_entry.get("name") or "")
    row = None
    for target in agents.orchestrator_targets(roster, team_name):
        if target in live:
            row = live[target]
            break
    state = orchestrator.start_state(team_entry)
    if state:
        now = store.now_ms()
        if state.get("state") == "pending" and orchestrator.sleep_gap(
            team_entry, now
        ):
            if dry:
                lines.append(
                    f"{team_name}: geplant: Schlafzeit – Startfrist beginnt neu"
                )
                return False
            orchestrator.renew_start(team_entry, now)
            orchestrator.reset_idle(team_entry, now)
            lines.append(
                f"{team_name}: Schlafzeit seit dem letzten tick – "
                "Startfrist beginnt neu"
            )
            return True
        action = orchestrator.start_action(roster, team_entry, row, state)
        if action == "answered":
            if not dry:
                orchestrator.clear_start(team_entry)
            lines.append(f"{team_name}: Orchestrator antwortet wieder")
            return False
        if action == "wait":
            return False
        if action == "retry":
            reason = "Start ohne Antwort: zweiter Versuch"
            if dry:
                lines.append(
                    f"{team_name}: geplant: Orchestrator neu starten – {reason}"
                )
                return False
            orchestrator.restart(
                roster, team_entry, reason, "tick", attempt=2
            )
            lines.append(f"{team_name}: Orchestrator neu gestartet – {reason}")
            return True
        if action == "fail":
            if dry:
                lines.append(
                    f"{team_name}: geplant: Start ohne Antwort – "
                    "zwei Versuche ohne Turn"
                )
                return False
            orchestrator.mark_start_failed(team_entry)
            events.append(
                "orchestrator", "", "tick", team_name, "Start ohne Antwort",
                reason="zwei Startversuche ohne fab-Aufruf oder Arbeits-Status",
            )
            index.rebuild()
            lines.append(
                f"{team_name}: Start ohne Antwort – zwei Versuche ohne Turn"
            )
            return True
        if action == "failed":
            return False
    if row is None:
        return False
    now = store.now_ms()
    if orchestrator.sleep_gap(team_entry, now):
        if dry:
            lines.append(
                f"{team_name}: geplant: Schlafzeit – Leerlauf beginnt neu"
            )
            return False
        orchestrator.reset_idle(team_entry, now)
        lines.append(
            f"{team_name}: Schlafzeit seit dem letzten tick – "
            "Leerlauf beginnt neu"
        )
        return True
    due, reason = orchestrator.idle_due(roster, team_entry, row, now)
    if not due:
        return False
    waiting = orchestrator.waiting_tickets(roster, team_name)
    if waiting:
        lines.append(
            f"{team_name}: Orchestrator bleibt – wartet auf {', '.join(waiting)}"
        )
        return False
    if dry:
        lines.append(f"{team_name}: geplant: Orchestrator neu starten – {reason}")
        return False
    orchestrator.restart(roster, team_entry, reason, "tick")
    lines.append(f"{team_name}: Orchestrator neu gestartet – {reason}")
    return True


# ---------------------------------------------------------------- Prüfen

def _tick_ticket(ticket, roster, live, cfg, by_id, lines, dry, ended=()):
    """Ein Ticket; Rückgabe: wurde das Ticket geändert?"""
    status = ticket.get("status")
    if status in FROZEN or status not in OPEN:
        return False
    blocked, cost_changed = _cost_limit(ticket, lines, dry)
    if blocked:
        return cost_changed
    now = store.now_ms()
    changed = False
    stall = ticket.get("stall")
    if not isinstance(stall, dict) or not stall.get("rule"):
        stall = None
    team = agents.ticket_team(roster, ticket)
    team_name = str((team or {}).get("name") or "")

    blockers = _open_blockers(ticket, by_id)
    if blockers:
        if stall and stall.get("rule") != "blocked":
            changed = _dissolve(ticket, lines, dry) or changed
            stall = None
        stalled = [
            blocker for blocker in blockers if _stalled(blocker, by_id, now, cfg)
        ]
        if not stalled:
            if stall and stall.get("rule") == "blocked":
                changed = _dissolve(ticket, lines, dry) or changed
            return changed
        agent = _assignee(ticket) or "orchestrator"
        since = min(_stamp(blocker) for blocker in stalled)
        return _attention(
            ticket, "blocked", agent, _blocked_reason(stalled, now), lines,
            dry, since=since,
        ) or changed

    if stall and stall.get("rule") == "blocked":
        changed = _dissolve(ticket, lines, dry) or changed
        stall = None

    # Beendete Session eines doing-Tickets sofort melden – aber nur ohne
    # Sonderzustand. Nach dem Entstören (z. B. Kommentar löscht `stall`) muss
    # die Meldung wiederkommen, nicht erst nach der Frist von Regel 1.
    if (
        status == "doing"
        and not _live_session(ticket, live)
        and "mensch" not in (ticket.get("waiting") or [])
        and _assignee(ticket) != "mensch"
    ):
        pending = ended
        if not pending and stall is None:
            pending = sessions.ended(ticket)
        if pending:
            handled = _attention(
                ticket,
                "doing",
                _assignee(ticket) or "orchestrator",
                _ended_reason(pending),
                lines,
                dry,
                number=1,
            )
            # Ein frisches Ende und die Entstörung melden sofort; ein bereits
            # gesetzter `stall` fällt durch, damit Regel 1 nach der Frist
            # wieder weckt.
            if dry or ended or handled:
                return handled or changed or cost_changed

    working = _working_session(ticket, live)
    chosen = None
    if (
        status == "doing"
        and "mensch" not in (ticket.get("waiting") or [])
        and not working
    ):
        assignee = _assignee(ticket)
        if not assignee or assignee == "mensch":
            # Ohne Zuständigen weckt Regel 1 nie; die Sofortmeldung an den
            # Orchestrator bleibt stehen, bis das Ticket übernommen wird.
            keep = not assignee and (stall or {}).get("rule") == "doing"
            if stall and not keep and not _live_session(ticket, live):
                changed = _dissolve(ticket, lines, dry) or changed
            return changed
        chosen = (
            "doing",
            {"agent": assignee, "activity": _last_activity(ticket, live)},
        )

    if chosen is None:
        found = _review_request(ticket, roster, team_name, live)
        if found is not None:
            chosen = ("review", found)
    if chosen is None:
        found = _mention_request(ticket, roster, team_name, live)
        if found is not None:
            chosen = ("mention", found)
    if chosen is None and status == "todo" and not _live_session(ticket, live):
        chosen = ("todo", {"agent": "orchestrator"})

    if chosen is None:
        if stall and not _live_session(ticket, live):
            changed = _dissolve(ticket, lines, dry) or changed
        return changed

    rule, payload = chosen
    if stall and stall.get("rule") != rule:
        changed = _dissolve(ticket, lines, dry) or changed
        stall = None

    number = RULE_NUMBERS[rule]
    agent, reason, text, age = _plan(ticket, rule, payload, now)

    if stall and stall.get("last_attempt"):
        wait = cfg[COOLDOWN[rule]] * MINUTES
        if now - int(stall["last_attempt"]) < wait:
            return changed

    if stall and int(stall.get("attempts") or 0) >= 2:
        reason = f"{reason}; {stall.get('attempts')} Versuche ohne Erfolg"
        return _attention(
            ticket, rule, agent, reason, lines, dry, number=6
        ) or changed

    if rule in ("doing", "mention", "review") and age < cfg[rule] * MINUTES:
        return changed

    if dry:
        silent = _planned_suppression(ticket, rule, agent, roster, live, now)
        if silent:
            lines.append(_line(ticket, number, rule, silent, reason))
        else:
            lines.append(
                _line(ticket, number, rule, f"geplant: @{agent} wecken", reason)
            )
        return changed

    result, detail, _address, error = _deliver(
        ticket, rule, agent, text, roster, live
    )
    if result in SILENT:
        lines.append(_line(ticket, number, rule, result, reason))
        return changed
    if result in DELIVERED:
        state = _stall_for(ticket, rule, agent, now)
        state["attempts"] = int(state.get("attempts") or 0) + 1
        state["last_attempt"] = now
        state["attention"] = False
        state["reason"] = reason
        state["agent"] = agent
        events.append(
            "tick", ticket["id"], "tick", agent, result,
            reason=_event_reason(number, rule, reason),
        )
        events.append("wake", ticket["id"], "tick", agent, result)
        lines.append(_line(ticket, number, rule, f"{result} → @{agent}", reason))
        return True
    if result == wake.START_FAILED:
        state = _stall_for(ticket, rule, agent, now)
        attempts = int(state.get("attempts") or 0) + 1
        state["attempts"] = attempts
        state["last_attempt"] = now
        state["reason"] = reason
        state["agent"] = agent
        if attempts >= 2:
            state["attention"] = True
            failure = error or "unbekannt"
            state["reason"] = f"{reason}; Start fehlgeschlagen: {failure}"
            events.append(
                "tick", ticket["id"], "tick", agent, "attention",
                reason=_event_reason(6, rule, state["reason"]),
            )
            lines.append(_line(ticket, 6, rule, "attention", state["reason"]))
        else:
            lines.append(_line(ticket, number, rule, result, reason))
        return True

    lines.append(_line(ticket, number, rule, result, reason))
    return changed


def _cost_limit(ticket, lines, dry):
    """Kostenlimit prüfen; (blockiert, geändert) – blockiert überspringt die Regeln."""
    limit = ticket.get("max_cost")
    if limit is None:
        return False, False
    try:
        limit = float(limit)
    except (TypeError, ValueError):
        return False, False
    total = float(costs.collect(ticket).get("total") or 0)
    if total <= limit:
        return False, False
    reason = (
        f"Kostenlimit überschritten: {costs.format_cost(total)} > "
        f"{costs.format_cost(limit)}"
    )
    if dry:
        lines.append(_line(ticket, 6, "doing", "geplant: attention", reason))
        return True, False
    for session in ticket.get("sessions") or []:
        targets = [session.get("terminal"), session.get("name")]
        for target in dict.fromkeys(item for item in targets if item):
            if hc.kill(target):
                break
    changed = False
    waiting = list(ticket.get("waiting") or [])
    if "mensch" not in waiting:
        waiting.append("mensch")
        ticket["waiting"] = waiting
        changed = True
    agent = _assignee(ticket) or "mensch"
    return True, _attention(
        ticket, "doing", agent, reason, lines, False, number=6
    ) or changed


def _plan(ticket, rule, payload, now):
    """(agent, reason, wecktext, alter in ms) für die gewählte Regel."""
    title = ticket.get("title") or ""
    tid = ticket["id"]
    if rule == "doing":
        age = max(0, now - int(payload["activity"] or 0))
        entry = _last_entry(ticket)
        reason = f"keine Aktivität seit {_mins(age)}; letzter Verlauf: {entry}"
        text = (
            f"Ticket {tid} „{title}“ wartet seit {_mins(age)} in `doing` ohne "
            f"laufende Session. Letzter Verlauf: {entry}. Bitte arbeite weiter "
            f"oder schreibe im Ticket mit `fab comment {tid} --from "
            f"{payload['agent']} \"…\"`."
        )
        return payload["agent"], reason, text, age
    if rule == "mention":
        age = max(0, now - int(payload["at"] or 0))
        reason = (
            f"unbeantwortete Erwähnung von {payload['author']} an "
            f"{payload['agent']} seit {_mins(age)}"
        )
        text = wake.message(
            ticket, payload["author"], payload["agent"], payload["text"]
        )
        return payload["agent"], reason, text, age
    if rule == "review":
        age = max(0, now - int(payload["at"] or 0))
        reason = (
            f"Prüferwunsch von {payload['author']} an {payload['agent']} "
            f"seit {_mins(age)}"
        )
        text = (
            f"Ticket {tid} „{title}“: @{payload['author']} bittet um Prüfung: "
            f"„{_snippet(payload['text'])}“. Lies `fab show {tid}`, prüfe den "
            f"Stand und schreibe ein Urteil mit `fab verdict {tid} pass|fail "
            f"--from {payload['agent']} \"…\"`."
        )
        return payload["agent"], reason, text, age
    reason = f"todo ohne Blocker und Session seit {_mins(now - _stamp(ticket))}"
    text = (
        f"Ticket {tid} „{title}“ ist `todo`, hat keine Blocker und keine "
        f"laufende Session. Bitte dispatch den zuständigen Agenten und "
        f"koordiniere den Start (`fab dispatch {tid} --from "
        f"{ticket.get('assignee') or 'mensch'}`)."
    )
    return "orchestrator", reason, text, 0


def _planned_suppression(ticket, rule, agent, roster, live, now):
    """Was ein echter Lauf voraussichtlich unterdrückt (nur für `--dry-run`)."""
    if rule == "todo":
        entry = agents.ticket_team(roster, ticket)
        if entry is None:
            return "unterdrückt: kein Team"
        targets = agents.orchestrator_targets(roster, str(entry.get("name") or ""))
        if not any(target in live for target in targets) and agents.at_limit(
            roster, live, entry
        ):
            return "unterdrückt: voll"
        return ""
    if (
        events.count_wakes(
            ticket["id"], agent, now - wake.PING_WINDOW_MS
        )
        > wake.PING_LIMIT
    ):
        return "unterdrückt: ping-pong"
    return ""


def _deliver(ticket, rule, agent, text, roster, live):
    """Eine Aktion zustellen; bei `todo` vorher Orchestrator und Limit prüfen."""
    if rule == "todo":
        try:
            entry = agents.team_for_ticket(roster, ticket)
        except FabError as exc:
            return "unterdrückt: kein Team", "", None, str(exc)
        targets = agents.orchestrator_targets(roster, str(entry.get("name") or ""))
        if not any(target in live for target in targets) and agents.at_limit(
            roster, live, entry
        ):
            return "unterdrückt: voll", "", None, ""
    return wake.once(ticket, agent, "tick", text, roster)


# ---------------------------------------------------------------- Zustand

def _attention(ticket, rule, agent, reason, lines, dry, number=None,
               since=None):
    """`attention` setzen (kein Wecken); Rückgabe: geändert?"""
    number = number or RULE_NUMBERS[rule]
    stall = ticket.get("stall")
    if (
        isinstance(stall, dict)
        and stall.get("rule") == rule
        and stall.get("attention")
    ):
        return False
    if dry:
        lines.append(_line(ticket, number, rule, "geplant: attention", reason))
        return False
    now = store.now_ms()
    if since is None:
        since = now
    if not isinstance(stall, dict) or stall.get("rule") != rule:
        stall = {
            "rule": rule,
            "since": since,
            "attempts": 0,
            "last_attempt": 0,
            "attention": True,
            "reason": reason,
            "agent": agent,
        }
        ticket["stall"] = stall
    else:
        stall["attention"] = True
        stall["reason"] = reason
        stall["agent"] = agent
    events.append(
        "tick", ticket["id"], "tick", agent, "attention",
        reason=_event_reason(number, rule, reason),
    )
    lines.append(_line(ticket, number, rule, "attention", reason))
    return True


def _dissolve(ticket, lines, dry):
    """`stall` entfernen und genau einmal `gelöst` melden."""
    stall = ticket.get("stall")
    if not isinstance(stall, dict) or not stall.get("rule"):
        return False
    rule = str(stall.get("rule"))
    number = RULE_NUMBERS.get(rule, 1)
    agent = stall.get("agent") or "orchestrator"
    if dry:
        lines.append(
            _line(ticket, number, rule, "geplant: gelöst", "Bedingung entfallen")
        )
        return False
    ticket.pop("stall", None)
    events.append(
        "tick", ticket["id"], "tick", agent, "gelöst",
        reason=_event_reason(number, rule, "Bedingung entfallen"),
    )
    lines.append(_line(ticket, number, rule, "gelöst", "Bedingung entfallen"))
    return True


def _stall_for(ticket, rule, agent, now):
    stall = ticket.get("stall")
    if isinstance(stall, dict) and stall.get("rule") == rule:
        return stall
    stall = {
        "rule": rule,
        "since": now,
        "attempts": 0,
        "last_attempt": 0,
        "attention": False,
        "reason": "",
        "agent": agent,
    }
    ticket["stall"] = stall
    return stall


# ---------------------------------------------------------------- Regeln

def _review_request(ticket, roster, team_name, live):
    entry = _team(roster, ticket)
    reviewer = str((entry or {}).get("reviewer") or "").strip().lower()
    if not reviewer:
        return None
    mention = _last_mention(ticket, roster, (reviewer,))
    if mention is None:
        return None
    comment, at = mention
    verdict = ticket.get("verdict")
    if isinstance(verdict, dict) and int(verdict.get("at") or 0) >= at:
        return None
    if _agent_live(ticket, reviewer, team_name, roster, live):
        return None
    return {
        "agent": reviewer,
        "at": at,
        "author": comment.get("author") or "?",
        "text": comment.get("text") or "",
    }


def _mention_request(ticket, roster, team_name, live):
    reviewer = str(((_team(roster, ticket) or {}).get("reviewer")) or "").lower()
    names = []
    for comment in reversed(ticket.get("comments") or []):
        for name in _comment_mentions(comment, roster):
            if name in NOBODY or name == reviewer:
                continue
            names.append((comment, name))
        if names:
            break
    for comment, name in names:
        at = int(comment.get("at") or 0)
        if _answered(ticket, comment, name):
            continue
        if _agent_live(ticket, name, team_name, roster, live):
            continue
        return {
            "agent": name,
            "at": at,
            "author": comment.get("author") or "?",
            "text": comment.get("text") or "",
        }
    return None


def _last_mention(ticket, roster, wanted):
    for comment in reversed(ticket.get("comments") or []):
        found = _comment_mentions(comment, roster)
        for name in wanted:
            if name in found:
                return comment, int(comment.get("at") or 0)
    return None


def _answered(ticket, mention, name):
    seen = False
    for comment in ticket.get("comments") or []:
        if comment is mention:
            seen = True
        if seen and str(comment.get("author") or "").lower() == name:
            return True
    return False


def _comment_mentions(comment, roster):
    raw = comment.get("mentions")
    if isinstance(raw, list) and raw:
        return [str(name).lower() for name in raw]
    return wake.mentions(comment.get("text") or "", wake.known_names(roster))


# ---------------------------------------------------------------- Helfer

def _ended_reason(items):
    """Einzeiliger Grund für die Sofort-Meldung beendeter Sessions."""
    parts = []
    for item in items:
        name = (item.get("session") or {}).get("name") or "Session"
        summary = item.get("summary") or "beendet"
        parts.append(f"{name}: {summary}")
    return "beendet: " + "; ".join(parts)


def _open_blockers(ticket, by_id):
    found = []
    for blocker_id in ticket.get("blocked_by") or []:
        blocker = by_id.get(blocker_id)
        if blocker is None:
            found.append({"id": blocker_id, "status": "fehlt", "updated_at": 0})
            continue
        if blocker.get("status") not in ("done", "dropped"):
            found.append(blocker)
    return found


def _stalled(blocker, by_id, now, cfg):
    """Stockt dieser Vorgänger, statt planmäßig in der Kette zu warten?

    Planmäßig wartet nur ein `todo`, das selbst noch offene Vorgänger hat;
    dort greift Regel 4 am Ticket selbst. `doing`, `review`, `draft` und
    `todo` ohne eigene Blocker gelten nach der Schwelle als stockend,
    ein fehlender Vorgänger sofort.
    """
    status = blocker.get("status")
    if status == "fehlt":
        return True
    if status == "todo" and _open_blockers(blocker, by_id):
        return False
    return now - _stamp(blocker) >= cfg["blocked"] * MINUTES


def _blocked_reason(blockers, now):
    parts = []
    for blocker in blockers:
        status = blocker.get("status")
        if status == "fehlt":
            parts.append(f"{blocker['id']} (fehlt)")
        else:
            parts.append(
                f"{blocker['id']} ({status}) seit "
                f"{_mins(now - _stamp(blocker))}"
            )
    return "offene Blocker: " + ", ".join(parts)


def _stamp(item):
    return int(
        (item or {}).get("updated_at")
        or (item or {}).get("created_at")
        or 0
    )


def _assignee(ticket):
    return str(ticket.get("assignee") or "").strip().lower()


def _team(roster, ticket):
    return agents.ticket_team(roster, ticket)


def _live_session(ticket, live):
    for session in ticket.get("sessions") or []:
        if (session or {}).get("name") in live:
            return True
    return False


def _working_session(ticket, live):
    for session in ticket.get("sessions") or []:
        row = live.get((session or {}).get("name"))
        if row is not None and agents.busy(row):
            return True
    return False


def _agent_live(ticket, name, team_name, roster, live):
    targets = {hc.terminal_name(name, ticket["id"], team_name or None)}
    if team_name and team_name == teams.legacy_team_name(roster):
        targets.add(hc.terminal_name(name, ticket["id"]))
    for session in ticket.get("sessions") or []:
        if (session or {}).get("agent") == name and session.get("name"):
            targets.add(session["name"])
    return any(target in live for target in targets if target)


def _last_activity(ticket, live):
    """Letzte Aktivität; tote Sessions zählen nicht mehr als Arbeit."""
    stamps = [int(ticket.get("updated_at") or 0)]
    stamps.extend(int(row.get("at") or 0) for row in ticket.get("comments") or [])
    stamps.extend(
        int(row.get("started_at") or 0)
        for row in ticket.get("sessions") or []
        if (row or {}).get("name") in live
    )
    return max(stamps) if stamps else 0


def _last_entry(ticket):
    comments = ticket.get("comments") or []
    if not comments:
        return "keine Kommentare"
    last = comments[-1]
    return f"{last.get('author') or '?'}: „{_snippet(last.get('text') or '')}“"


def _snippet(text, limit=120):
    return " ".join(str(text or "").split())[:limit]


def _mins(ms):
    return f"{max(0, int(ms)) // MINUTES} Min."


def _line(ticket, number, rule, text, reason):
    return f"{ticket['id']}: Regel {number} ({rule}): {text} – {reason}"


def _event_reason(number, rule, reason):
    return f"Regel {number} ({rule}): {reason}"


# ---------------------------------------------------------------- launchd

AUTOSTART_ENV = "FAB_TICK_AUTOSTART"
LAUNCH_AGENTS_ENV = "FAB_LAUNCH_AGENTS_DIR"
_OFF = ("0", "false", "off", "no")
_ON = ("1", "true", "on", "yes")


def launch_agents_dir():
    """LaunchAgents-Verzeichnis; `FAB_LAUNCH_AGENTS_DIR` lenkt Tests um."""
    raw = (os.environ.get(LAUNCH_AGENTS_ENV) or "").strip()
    if raw:
        return os.path.abspath(os.path.expanduser(raw))
    return os.path.join(os.path.expanduser("~"), "Library", "LaunchAgents")


def plist_path():
    return os.path.join(launch_agents_dir(), f"{LABEL}.plist")


def program_path():
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "fab"
    )


def standard_home():
    """Datenort ohne `FAB_HOME`; launchd startet ohne die Shell-Umgebung."""
    return os.path.abspath(os.path.expanduser(store.DEFAULT_HOME))


def _home_deviation():
    """Grund, warum dieser Aufruf keinen Auftrag schreiben darf, sonst `None`."""
    current = store.home()
    standard = standard_home()
    if current != standard:
        return (
            f"FAB_HOME {current} weicht vom Standard-Home {standard} ab; "
            "Auftrag nicht angelegt"
        )
    return None


def autostart_enabled():
    """Darf dieser Aufruf den launchd-Auftrag selbst anlegen?

    Nur unter macOS, abschaltbar über `FAB_TICK_AUTOSTART=0`. Ohne ausdrückliche
    Freigabe (`=1`) bleibt ein Aufruf aus einem Worktree außen vor: dessen Pfad
    verschwindet beim Aufräumen, der Auftrag zeigte danach ins Leere.
    """
    raw = (os.environ.get(AUTOSTART_ENV) or "").strip().lower()
    if raw in _OFF:
        return False
    if sys.platform != "darwin":
        return False
    if raw in _ON:
        return True
    return "/worktrees/" not in program_path()


def ensure_installed():
    """Fehlenden Auftrag anlegen; Rückgabe: Pfad oder `None`.

    Idempotent: eine vorhandene Plist mit Standard-Home wird weder neu
    geschrieben noch erneut bei launchd angemeldet. Trägt sie ein abweichendes
    `FAB_HOME`, wird der Auftrag zuvor entfernt und frisch angelegt. Ein Aufruf
    mit abweichendem `FAB_HOME` (Vorschau/Test) lässt den Auftrag unberührt.
    """
    if not autostart_enabled():
        return None
    if _home_deviation():
        return None
    target = plist_path()
    if os.path.exists(target):
        if _plist_home(target) == standard_home():
            return None
        uninstall()
        path, _ok, _detail = install()
        return path
    path, _ok, _detail = install()
    return path


def _plist_home(path):
    """`FAB_HOME` aus einer vorhandenen Plist; `""` bei kaputter Datei."""
    try:
        with open(path, "rb") as handle:
            data = plistlib.load(handle)
    except (OSError, ValueError, plistlib.InvalidFileException):
        return ""
    return str((data.get("EnvironmentVariables") or {}).get("FAB_HOME") or "")


def payload():
    """Inhalt des launchd-Auftrags.

    `FAB_HOME` steht fest auf dem Standard-Home: launchd startet ohne
    `FAB_HOME`, und ein Shell-Wert aus einem Test- oder Vorschauaufruf darf
    nicht in den Dauerauftrag wandern.
    """
    return {
        "Label": LABEL,
        "ProgramArguments": [program_path(), "tick"],
        "StartInterval": INTERVAL,
        "RunAtLoad": False,
        "EnvironmentVariables": {
            "FAB_HOME": standard_home(),
            "FAB_ROSTER": agents.roster_path(),
            "PATH": os.environ.get("PATH") or "/usr/local/bin:/usr/bin:/bin",
        },
    }


def install():
    """Plist schreiben und `launchctl bootstrap` versuchen.

    Rückgabe: (Pfad, bootstrap_ok, Hinweis). Ein Bootstrap-Fehler ist nur ein
    Hinweis; die Datei bleibt liegen. Weicht `FAB_HOME` vom Standard ab, wird
    nichts geschrieben und `(None, False, Grund)` zurückgegeben.
    """
    reason = _home_deviation()
    if reason:
        return None, False, reason
    target = plist_path()
    text = plistlib.dumps(payload(), sort_keys=True).decode("utf-8")
    store.atomic_write(target, text, mode=0o644)
    ok, detail = _launchctl("bootstrap", f"gui/{os.getuid()}", target)
    return target, ok, detail


def uninstall():
    """`launchctl bootout` versuchen und die Plist löschen."""
    target = plist_path()
    ok, detail = _launchctl("bootout", f"gui/{os.getuid()}", target)
    try:
        os.remove(target)
    except FileNotFoundError:
        pass
    return target, ok, detail


def _launchctl(*args):
    if os.environ.get("FAB_TICK_NO_LAUNCHCTL"):
        return False, "FAB_TICK_NO_LAUNCHCTL gesetzt"
    try:
        answer = subprocess.run(
            ["launchctl", *args], capture_output=True, text=True, timeout=60
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    if answer.returncode == 0:
        return True, ""
    return False, (answer.stderr or answer.stdout).strip() or (
        f"Exit {answer.returncode}"
    )
