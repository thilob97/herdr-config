"""Neustartregeln des Team-Orchestrators (T-31).

Der Kontext des Orchestrators bleibt begrenzt:

- Nach `dispatches` erfolgreichen `fab dispatch`-Aufrufen mit
  `--from orchestrator` wird er beim nächsten Wecken neu gestartet.
- Nach `idle_minutes` ohne fab-Aufruf und ohne Ausgabe startet `fab tick` ihn
  neu, sofern kein Ticket auf ihn wartet.

Zähler und Leerlauf werden aus dem Ereignisprotokoll und dem Terminalstatus
gelesen; es gibt keinen zusätzlichen Zustand. Ein `orchestrator`-Ereignis mit
`text = "neu gestartet"` markiert den Neustart und setzt den Zähler zurück.
"""
import re

from . import agents, events, hc, index, store
from .errors import FabError, HcError

DEFAULT_DISPATCHES = 5
DEFAULT_IDLE_MINUTES = 30
MINUTE = 60 * 1000

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


def idle_due(roster, team_entry, row, now=None):
    """(fällig, Grund) für Leerlauf; nur bei lebendem, nicht beschäftigtem Terminal."""
    _dispatches, idle = policy(team_entry)
    if idle <= 0 or not row or agents.busy(row):
        return False, ""
    now = store.now_ms() if now is None else now
    team_name = _team_name(team_entry)
    rows = events.read_all()
    last = _activity_ms(roster, team_name, rows)
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


def restart(roster, team_entry, reason, actor="fab"):
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
    text = "neu gestartet"
    warning = started.get("warning")
    if warning:
        text += f" ({warning})"
    events.append("orchestrator", "", actor, team_name, text, reason=reason)
    index.rebuild()
    return started
