"""Lesemodell `index.json`: Tickets ohne Body/Kommentare, Inbox, Roster, Ereignisse.

`index.json` wird nach jeder Änderung atomar neu geschrieben und bleibt unter
1 MiB: keine Bodies, keine Kommentarlisten, höchstens 300 Ereignisse.
"""
import json

from . import agents, costs, events, render, store, teams
from .errors import FabError

MAX_EVENTS = 300


def _cost_snapshot(ticket):
    raw = ticket.get("cost")
    if not isinstance(raw, dict):
        raw = {}
    return {
        "currency": str(raw.get("currency") or "USD"),
        "total": float(raw.get("total") or 0),
        "today": float(raw.get("today") or 0),
    }


def _reviewer():
    roster = agents.load(required=False)
    return str((roster or {}).get("reviewer") or "ada")


def entry(ticket, waits=None, team=None):
    if waits is None:
        waits = costs.waits(ticket, store.event_rows_for(ticket["id"]), _reviewer())
    last = ticket["comments"][-1] if ticket["comments"] else None
    return {
        "id": ticket["id"],
        "title": ticket["title"],
        "status": ticket["status"],
        "parent": ticket.get("parent"),
        "assignee": ticket.get("assignee"),
        "repo": ticket.get("repo"),
        "branch": ticket.get("branch"),
        "updated_at": ticket.get("updated_at"),
        "comment_count": len(ticket["comments"]),
        "waiting": list(ticket.get("waiting") or []),
        "blocked_by": list(ticket.get("blocked_by") or []),
        "checks": (ticket.get("checks") or {}).get("state"),
        "verdict": (ticket.get("verdict") or {}).get("state"),
        "stall": _stall_entry(ticket),
        "last_comment": (
            {
                "author": last.get("author"),
                "at": last.get("at"),
                "text": (last.get("text") or "")[:500],
                "mentions": list(last.get("mentions") or []),
            }
            if last
            else None
        ),
        "sessions": [
            {
                "agent": session.get("agent"),
                "name": session.get("name"),
                "terminal": session.get("terminal"),
            }
            for session in ticket.get("sessions") or []
        ],
        "team": str(team or ""),
        "max_cost": ticket.get("max_cost"),
        "cost": _cost_snapshot(ticket),
        "waits": waits,
    }


def _stall_entry(ticket):
    """Stillstand fürs Lesemodell; nur offene Arbeitsstufen tragen ihn."""
    if ticket.get("status") not in ("todo", "doing"):
        return None
    stall = ticket.get("stall")
    if not isinstance(stall, dict):
        return None
    return {
        "rule": stall.get("rule"),
        "since": stall.get("since"),
        "attempts": stall.get("attempts"),
        "attention": bool(stall.get("attention")),
        "reason": stall.get("reason") or "",
    }


def _stall_age(since, now):
    """Dauer eines Stillstands auf Deutsch, wie `relativeTime` im Mod."""
    minutes = max(0, now - since) // 60000
    if minutes < 1:
        return "gerade eben"
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} h"
    return f"{hours // 24} Tagen"


def _ticket_number(ticket):
    try:
        return int(str(ticket.get("id") or "").split("-")[-1])
    except ValueError:
        return 0


def _waiting_entries(questions, reviews):
    """question/review in Ticket-Reihenfolge: `review` hat Vorrang, beide schließen sich aus."""
    for ticket in sorted([*questions, *reviews], key=_ticket_number):
        last = ticket["comments"][-1] if ticket["comments"] else None
        if ticket.get("status") == "review":
            yield "review", ticket, last, ticket.get("updated_at")
        else:
            yield "question", ticket, last, (
                last.get("at") if last else ticket.get("updated_at")
            )


def _inbox(stalled, questions, reviews, rows, tickets=(), approvals=()):
    entries = []
    stalled_ids = set()
    now = store.now_ms()
    for ticket in stalled:
        stall = ticket.get("stall")
        if not isinstance(stall, dict) or not stall.get("attention"):
            continue
        since = stall.get("since")
        if not isinstance(since, int):
            continue
        reason = stall.get("reason") or ""
        ticket_id = ticket["id"]
        entries.append(
            {
                "id": f"attention:{ticket_id}:{since}",
                "kind": "attention",
                "ticket": ticket_id,
                "at": since,
                "from": "fab",
                "text": f"stockt seit {_stall_age(since, now)} – {reason}",
                "agent": stall.get("agent") or "orchestrator",
                "reason": reason,
                "since": since,
            }
        )
        stalled_ids.add(ticket_id)
    for kind, ticket, last, at in _waiting_entries(questions, reviews):
        entries.append(
            {
                "id": f"{kind}:{ticket['id']}:{at}",
                "kind": kind,
                "ticket": ticket["id"],
                "at": at,
                "from": (last.get("author") if last else ticket.get("assignee")) or "fab",
                "text": ((last.get("text") if last else ticket.get("title")) or "")[:300],
            }
        )

    for candidate in rows:
        ticket_id = candidate.get("ticket")
        if ticket_id in stalled_ids:
            continue
        text = candidate.get("text") or ""
        target = candidate.get("target") or ""
        reason = candidate.get("reason") or ""
        agent = ""
        if text == "unterdrückt: ping-pong":
            summary = f"Ping-Pong zwischen {candidate.get('actor')} und {candidate.get('target')}"
        elif text == "unterdrückt: voll":
            summary = f"Start fehlgeschlagen: {candidate.get('target')} (voll)"
        elif text == "rücksetzen: check rot":
            summary = f"Merge zurückgesetzt: {reason}"
            agent = target
        else:
            summary = f"Start fehlgeschlagen: {target}" + (
                f" — {reason}" if reason else ""
            )
            agent = target
        if not agent:
            reason = ""
        entries.append(
            {
                "id": f"attention:{ticket_id}:{candidate.get('at')}:{target}:{summary}",
                "kind": "attention",
                "ticket": ticket_id,
                "at": candidate.get("at"),
                "from": "fab",
                "text": summary,
                "agent": agent,
                "reason": reason,
            }
        )

    for row in approvals:
        entries.append(
            {
                "id": f"approval:{row['id']}",
                "kind": "approval",
                "ticket": "",
                "at": row.get("at"),
                "from": row.get("actor") or "fab",
                "text": row.get("text") or "",
                "run": row.get("target") or "",
                "reason": row.get("reason") or "",
            }
        )

    for ticket in tickets:
        for proposal in ticket.get("lesson_proposals") or []:
            if not isinstance(proposal, dict):
                continue
            entries.append(
                {
                    "id": f"lesson:{ticket['id']}:{proposal.get('id')}",
                    "kind": "lesson",
                    "ticket": ticket["id"],
                    "at": proposal.get("at"),
                    "from": proposal.get("by") or "fab",
                    "text": str(proposal.get("text") or ""),
                    "proposal": proposal.get("id"),
                    "repo": ticket.get("repo") or "",
                }
            )

    entries.sort(key=lambda item: item.get("at") or 0, reverse=True)
    return entries


def _teams(roster):
    rows = []
    for entry in roster.get("teams") or []:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        try:
            limit = teams.team_limit(entry)
        except FabError:
            limit = teams.DEFAULT_MAX_SESSIONS
        rows.append(
            {
                "name": str(entry["name"]),
                "reviewer": str(entry.get("reviewer") or ""),
                "max_sessions": limit,
                "orchestrator": teams.orchestrator_config(entry),
            }
        )
    return rows


def build():
    tickets = store.all_tickets()
    rows = events.read_all()
    roster = agents.load(required=False)
    reviewer = str((roster or {}).get("reviewer") or "ada")
    grouped = {}
    shared = []
    for row in rows:
        ticket_id = row.get("ticket") or ""
        if ticket_id:
            grouped.setdefault(ticket_id, []).append(row)
        else:
            shared.append(row)
    entries = []
    for ticket in tickets:
        ticket_rows = list(grouped.get(ticket["id"]) or [])
        if shared:
            ticket_rows = shared + ticket_rows
        team_entry = agents.ticket_team(roster, ticket) if roster else None
        entries.append(
            entry(
                ticket,
                waits=costs.waits(ticket, ticket_rows, reviewer),
                team=str((team_entry or {}).get("name") or ""),
            )
        )
    inbox = _inbox(
        store.stalled_tickets(),
        store.question_tickets(),
        store.review_tickets(),
        store.attention_event_rows(events.ATTENTION_TEXTS),
        tickets,
        approvals=store.flow_approvals(),
    )
    payload = {
        "version": 1,
        "generated_at": store.now_ms(),
        "tickets": entries,
        "inbox": inbox,
        "roster": agents.roster_rows(roster) if roster else [],
        "teams": _teams(roster) if roster else [],
        "events": rows[-MAX_EVENTS:],
    }
    return payload


def rebuild():
    payload = build()
    if store.in_transaction():
        store.defer_index(payload)
        return payload
    text = json.dumps(payload, ensure_ascii=False) + "\n"
    store.atomic_write(store.index_path(), text)
    return payload

