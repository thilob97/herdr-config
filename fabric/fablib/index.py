"""Lesemodell `index.json`: Tickets ohne Body/Kommentare, Inbox, Roster, Ereignisse.

`index.json` wird nach jeder Änderung atomar neu geschrieben und bleibt unter
1 MiB: keine Bodies, keine Kommentarlisten, höchstens 300 Ereignisse.
"""
import json

from . import agents, events, render, store, teams
from .errors import FabError

MAX_EVENTS = 300


def entry(ticket):
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


def _inbox(tickets, rows):
    entries = []
    stalled = set()
    now = store.now_ms()
    for ticket in tickets:
        stall = ticket.get("stall")
        if ticket.get("status") not in ("todo", "doing"):
            continue
        if not isinstance(stall, dict) or not stall.get("attention"):
            continue
        since = stall.get("since")
        if not isinstance(since, int):
            continue
        reason = stall.get("reason") or ""
        ticket_id = ticket["id"]
        entries.append(
            {
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
        stalled.add(ticket_id)
    for ticket in tickets:
        status = ticket.get("status")
        closed = status in ("done", "dropped")
        review = status == "review"
        last = ticket["comments"][-1] if ticket["comments"] else None
        # Pro Ticket höchstens ein Eintrag aus question/review: `review` hat Vorrang.
        if not closed and not review and "mensch" in ticket.get("waiting", []):
            entries.append(
                {
                    "kind": "question",
                    "ticket": ticket["id"],
                    "at": last.get("at") if last else ticket.get("updated_at"),
                    "from": (last.get("author") if last else ticket.get("assignee")) or "fab",
                    "text": ((last.get("text") if last else ticket.get("title")) or "")[:300],
                }
            )
        if review:
            entries.append(
                {
                    "kind": "review",
                    "ticket": ticket["id"],
                    "at": ticket.get("updated_at"),
                    "from": (last.get("author") if last else ticket.get("assignee")) or "fab",
                    "text": ((last.get("text") if last else ticket.get("title")) or "")[:300],
                }
            )

    per_ticket = {}
    for row in rows:
        per_ticket.setdefault(row.get("ticket"), []).append(row)
    for ticket_id, ticket_rows in per_ticket.items():
        if ticket_id in stalled:
            continue
        candidate = None
        for row in ticket_rows:
            if row.get("kind") == "wake" and row.get("text") in events.ATTENTION_TEXTS:
                candidate = row
            else:
                candidate = None
        if not candidate:
            continue
        text = candidate.get("text") or ""
        target = candidate.get("target") or ""
        reason = candidate.get("reason") or ""
        agent = ""
        if text == "unterdrückt: ping-pong":
            summary = f"Ping-Pong zwischen {candidate.get('actor')} und {candidate.get('target')}"
        elif text == "unterdrückt: voll":
            summary = f"Start fehlgeschlagen: {candidate.get('target')} (voll)"
        else:
            summary = f"Start fehlgeschlagen: {target}" + (
                f" — {reason}" if reason else ""
            )
            agent = target
        if not agent:
            reason = ""
        entries.append(
            {
                "kind": "attention",
                "ticket": ticket_id,
                "at": candidate.get("at"),
                "from": "fab",
                "text": summary,
                "agent": agent,
                "reason": reason,
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
    payload = {
        "version": 1,
        "generated_at": store.now_ms(),
        "tickets": [entry(ticket) for ticket in tickets],
        "inbox": _inbox(tickets, rows),
        "roster": agents.roster_rows(roster) if roster else [],
        "teams": _teams(roster) if roster else [],
        "events": rows[-MAX_EVENTS:],
    }
    return payload


def rebuild():
    payload = build()
    text = json.dumps(payload, ensure_ascii=False) + "\n"
    store.atomic_write(store.index_path(), text)
    return payload

