"""Neustartregeln des Team-Orchestrators (T-31).

Der Kontext des Orchestrators bleibt begrenzt:

- Nach `dispatches` erfolgreichen `fab dispatch`-Aufrufen mit
  `--from orchestrator` wird er beim nächsten Wecken neu gestartet.
- Nach `idle_minutes` ohne fab-Aufruf und ohne Ausgabe startet `fab tick` ihn
  neu, sofern kein Ticket auf ihn wartet.

Zähler und Leerlauf werden aus dem Ereignisprotokoll und dem Terminalstatus
gelesen; nur Startzustand und Schlafzeit-Reset liegen als Meta-Zustand je Team.
Ein `orchestrator`-Ereignis mit `text = "neu gestartet"` markiert den Neustart
und setzt den Zähler zurück.
"""
import json
import re

from . import agents, events, hc, index, store
from .errors import FabError, HcError

DEFAULT_DISPATCHES = 5
DEFAULT_IDLE_MINUTES = 30
MINUTE = 60 * 1000
START_GRACE_MINUTES = 5
SLEEP_GAP_MINUTES = 10

_STARTED = ("gestartet", "neu gestartet")
_FAILED_DISPATCH = ("Start fehlgeschlagen", "automatisch nicht gestartet")
_MENTION = re.compile(
    r"(?<![A-Za-z0-9._%+-])@orchestrator(?![A-Za-z0-9_-])", re.IGNORECASE
)


def _number(value, default, maximum):
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return max(0, min(maximum, number))


def policy(team_entry):
    """(dispatches, idle_minutes) eines Teams; Teamwerte vor den Standards."""
    raw = team_entry.get("orchestrator") if isinstance(team_entry, dict) else None
    raw = raw if isinstance(raw, dict) else {}
    return (
        _number(raw.get("dispatches"), DEFAULT_DISPATCHES, 100),
        _number(raw.get("idle_minutes"), DEFAULT_IDLE_MINUTES, 1440),
    )


def _team_name(team_entry):
    return str((team_entry or {}).get("name") or "")


def _start_key(team_name):
    return f"orchestrator_start:{team_name}"


def _idle_reset_key(team_name):
    return f"orchestrator_idle_reset:{team_name}"


def start_state(team_entry):
    """Gespeicherter Startzustand des Teams, sonst None."""
    raw = store.meta_get(_start_key(_team_name(team_entry)))
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict) or not data.get("at"):
        return None
    if data.get("state") not in ("pending", "failed"):
        return None
    return data


def mark_start(team_entry, reason, attempt=1, terminal=""):
    """Merkt einen Start, dessen erster Turn noch aussteht."""
    state = {
        "at": store.now_ms(),
        "attempt": int(attempt),
        "state": "pending",
        "reason": str(reason or ""),
        "terminal": str(terminal or ""),
    }
    store.meta_set(
        _start_key(_team_name(team_entry)),
        json.dumps(state, ensure_ascii=False),
    )
    return state


def renew_start(team_entry, now=None):
    """Setzt die Frist eines offenen Starts nach einer Schlaflücke auf jetzt.

    Versuch, Grund und Terminal bleiben erhalten; nur `at` wandert auf den
    Aufwachzeitpunkt, damit `START_GRACE_MINUTES` neu beginnt. Ein bereits
    endgültig fehlgeschlagener Start bleibt unverändert.
    """
    state = start_state(team_entry)
    if not state or state.get("state") != "pending":
        return state
    now = store.now_ms() if now is None else now
    state["at"] = int(now)
    store.meta_set(
        _start_key(_team_name(team_entry)),
        json.dumps(state, ensure_ascii=False),
    )
    return state


def mark_start_failed(team_entry):
    """Markiert den Start als endgültig ohne Antwort; kein dritter Versuch."""
    state = start_state(team_entry) or {}
    now = store.now_ms()
    data = {
        "at": int(state.get("at") or now),
        "attempt": int(state.get("attempt") or 1),
        "state": "failed",
        "reason": str(state.get("reason") or ""),
        "terminal": str(state.get("terminal") or ""),
        "failed_at": now,
    }
    store.meta_set(
        _start_key(_team_name(team_entry)),
        json.dumps(data, ensure_ascii=False),
    )
    return data


def clear_start(team_entry):
    """Löscht den Startzustand des Teams."""
    store.meta_set(_start_key(_team_name(team_entry)), "")


def start_action(roster, team_entry, row, state, now=None):
    """Was mit einem offenen Startzustand geschieht.

    `answered` heißt: ein `orchestrator`-Ereignis des Teams seit dem Start
    oder ein beschäftigter Terminal-Status. `retry`/`fail` folgen erst nach
    `START_GRACE_MINUTES`; `failed` bleibt liegen, bis jemand eingreift.
    """
    if not state:
        return "answered"
    team_name = _team_name(team_entry)
    rows = events.read_all()
    answered = (
        _activity_ms(roster, team_name, rows) >= int(state.get("at") or 0)
        or agents.status(row) in agents.BUSY_STATUSES
    )
    if answered:
        return "answered"
    if state.get("state") == "failed":
        return "failed"
    now = store.now_ms() if now is None else now
    if now - int(state.get("at") or 0) < START_GRACE_MINUTES * MINUTE:
        return "wait"
    if int(state.get("attempt") or 1) <= 1:
        return "retry"
    return "fail"


def _ticket_teams(roster):
    """Ticket-ID → Teamname, damit Ereignisse dem richtigen Team zählen."""
    teams = {}
    for ticket in store.all_tickets():
        entry = agents.ticket_team(roster, ticket)
        teams[ticket["id"]] = _team_name(entry)
    return teams


def _start_marker(rows, team_name):
    """Index und Zeitpunkt des letzten Starts dieses Teams, sonst (-1, 0)."""
    marker = -1
    at = 0
    for position, row in enumerate(rows):
        if row.get("kind") != "orchestrator":
            continue
        target = str(row.get("target") or "")
        if target and target != team_name:
            continue
        text = str(row.get("text") or "")
        if text.startswith(_STARTED):
            marker = position
            at = int(row.get("at") or 0)
    return marker, at


def _is_team_event(row, team_name, ticket_teams):
    ticket = str(row.get("ticket") or "")
    if ticket:
        return ticket_teams.get(ticket) == team_name
    if row.get("kind") == "orchestrator":
        target = str(row.get("target") or "")
        return not target or target == team_name
    return False


def dispatches_since_start(roster, team_entry, rows=None):
    """Erfolgreiche Verteilungen mit `--from orchestrator` seit dem letzten Start."""
    team_name = _team_name(team_entry)
    rows = events.read_all() if rows is None else rows
    marker, _at = _start_marker(rows, team_name)
    ticket_teams = _ticket_teams(roster)
    total = 0
    for row in rows[marker + 1:]:
        if row.get("kind") != "dispatch":
            continue
        if str(row.get("actor") or "").lower() != "orchestrator":
            continue
        text = str(row.get("text") or "")
        if text.startswith(_FAILED_DISPATCH):
            continue
        if not _is_team_event(row, team_name, ticket_teams):
            continue
        total += 1
    return total


def restart_due(roster, team_entry, rows=None):
    """(fällig, Grund) für den Zähler; 0 schaltet die Regel ab."""
    dispatches, _idle = policy(team_entry)
    if dispatches <= 0:
        return False, ""
    count = dispatches_since_start(roster, team_entry, rows)
    if count < dispatches:
        return False, ""
    return True, f"Zähler: {count} Dispatches seit dem letzten Start"


def _activity_ms(roster, team_name, rows=None):
    """Letzte fab-Aktivität des Orchestrators dieses Teams."""
    rows = events.read_all() if rows is None else rows
    ticket_teams = _ticket_teams(roster)
    last = 0
    for row in rows:
        if str(row.get("actor") or "").lower() != "orchestrator":
            continue
        if not _is_team_event(row, team_name, ticket_teams):
            continue
        last = max(last, int(row.get("at") or 0))
    return last


def _terminal_activity(row):
    """Zeitpunkt der letzten Ausgabe laut `hc get`, 0 wenn unbekannt."""
    address = (row or {}).get("address")
    if not address:
        return 0
    try:
        data = hc.get(address)
    except HcError:
        return 0
    for key in ("status_ms", "created_ms"):
        value = data.get(key)
        if isinstance(value, int) and value > 0:
            return value
    return 0


def sleep_gap(team_entry, now=None):
    """Lag zwischen dem letzten `fab tick` und jetzt eine Schlaflücke?

    Jeder Abstand von mindestens `SLEEP_GAP_MINUTES` seit `store.last_tick()`
    gilt als Schlaf – auch wenn der Wächter nicht lief und `fab tick` nur von
    Hand aufgerufen wird. Diesen Fall deckt der Tick-Alarm (`stale`, älter als
    5 Minuten) ab; die Erkennung selbst bleibt davon unberührt.
    """
    last = store.last_tick()
    if last is None:
        return False
    now = store.now_ms() if now is None else now
    return now - int(last) >= SLEEP_GAP_MINUTES * MINUTE


def _idle_reset_ms(team_name):
    try:
        return int(store.meta_get(_idle_reset_key(team_name)) or 0)
    except (TypeError, ValueError):
        return 0


def reset_idle(team_entry, now=None):
    """Setzt den Leerlauf-Ursprung nach einer Schlaflücke auf jetzt."""
    now = store.now_ms() if now is None else now
    store.meta_set(_idle_reset_key(_team_name(team_entry)), int(now))
    return int(now)


def idle_due(roster, team_entry, row, now=None):
    """(fällig, Grund) für Leerlauf; nur bei lebendem, nicht beschäftigtem Terminal."""
    _dispatches, idle = policy(team_entry)
    if idle <= 0 or not row or agents.busy(row):
        return False, ""
    now = store.now_ms() if now is None else now
    team_name = _team_name(team_entry)
    rows = events.read_all()
    last = max(_activity_ms(roster, team_name, rows), _idle_reset_ms(team_name))
    if last <= 0 or now - last >= idle * MINUTE:
        last = max(last, _terminal_activity(row))
    if last <= 0:
        return False, ""
    if now - last < idle * MINUTE:
        return False, ""
    return True, f"Leerlauf: {idle} Min. ohne Ausgabe oder fab-Aufruf"


def _mentions_orchestrator(comment):
    for name in comment.get("mentions") or []:
        if str(name).lower() == "orchestrator":
            return True
    return bool(_MENTION.search(str(comment.get("text") or "")))


def waits_on_orchestrator(ticket, rows=None):
    """Wartet dieses Ticket noch auf eine Reaktion des Orchestrators?"""
    if any(
        str(name).lower() == "orchestrator"
        for name in ticket.get("waiting") or []
    ):
        return True
    comments = ticket.get("comments") or []
    mention_at = None
    for comment in reversed(comments):
        if _mentions_orchestrator(comment):
            mention_at = int(comment.get("at") or 0)
            break
    if mention_at is None:
        return False
    for comment in comments:
        if int(comment.get("at") or 0) < mention_at:
            continue
        if str(comment.get("author") or "").lower() == "orchestrator":
            return False
    rows = events.read_all() if rows is None else rows
    for row in rows:
        if str(row.get("ticket") or "") != ticket["id"]:
            continue
        if str(row.get("actor") or "").lower() != "orchestrator":
            continue
        if int(row.get("at") or 0) >= mention_at:
            return False
    return True


def waiting_tickets(roster, team_name, rows=None):
    """Offene Tickets dieses Teams, die auf den Orchestrator warten."""
    rows = events.read_all() if rows is None else rows
    waiting = []
    for ticket in store.all_tickets():
        if ticket.get("status") in ("done", "dropped"):
            continue
        entry = agents.ticket_team(roster, ticket)
        if _team_name(entry) != team_name:
            continue
        if waits_on_orchestrator(ticket, rows):
            waiting.append(ticket["id"])
    return waiting


def restart(roster, team_entry, reason, actor="fab", attempt=1):
    """Beendet den laufenden Orchestrator und startet ihn frisch.

    Schreibt ein `orchestrator`-Ereignis mit Grund; der Aufrufer hält den
    Store-Lock (oder ist `fab tick`, das ihn hält).
    """
    team_name = _team_name(team_entry)
    if not team_name:
        raise FabError("Kein Team im Roster; fab team add …")
    try:
        live = hc.live()
    except HcError:
        live = {}
    for target in agents.orchestrator_targets(roster, team_name):
        if target in live and not hc.kill(target):
            raise FabError(
                f"Orchestrator {team_name} ließ sich nicht beenden "
                f"(hc kill {target})"
            )
    started = agents.start_orchestrator(roster, team_name)
    mark_start(
        team_entry, reason, attempt=attempt, terminal=started.get("terminal")
    )
    text = "neu gestartet"
    warning = started.get("warning")
    if warning:
        text += f" ({warning})"
    events.append("orchestrator", "", actor, team_name, text, reason=reason)
    index.rebuild()
    return started
