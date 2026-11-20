"""Textausgaben für Menschen: Ticket, Liste, Zeit."""
import json
import time

from . import store


def fmt_ms(ms):
    if not ms:
        return "—"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ms) / 1000))


def short_head(head):
    return (head or "—")[:7]


def ticket_json(ticket):
    return json.dumps(ticket, ensure_ascii=False, indent=2)


def ticket_text(ticket):
    lines = [f"# {ticket['id']} {ticket['title']}", ""]
    meta = [
        f"Status: {ticket['status']}",
        f"Zuständig: {ticket.get('assignee') or '—'}",
        f"Repo: {ticket.get('repo') or '—'}",
        f"Basis: {ticket.get('base') or '—'}",
        f"Branch: {ticket.get('branch') or '—'}",
        f"Worktree: {ticket.get('worktree') or '—'}",
    ]
    lines.extend(meta)
    if ticket.get("waiting"):
        lines.append("Wartet auf: " + ", ".join(ticket["waiting"]))
    if ticket.get("blocked_by"):
        lines.append("Blockiert durch: " + ", ".join(ticket["blocked_by"]))
    checks = ticket.get("checks") or {}
    if checks:
        lines.append(
            f"Checks: {checks.get('state')} auf HEAD {short_head(checks.get('head'))}"
            f" ({fmt_ms(checks.get('at'))})"
        )
    verdict = ticket.get("verdict") or {}
    if verdict:
        lines.append(
            f"Urteil: {verdict.get('state')} von {verdict.get('by')} auf HEAD "
            f"{short_head(verdict.get('head'))} ({fmt_ms(verdict.get('at'))})"
        )
    lines.append("")
    lines.append((ticket.get("body") or "").rstrip())
    attachments = ticket.get("attachments") or []
    if attachments:
        lines.extend(["", "## Anhänge"])
        for item in attachments:
            lines.append(f"- ![{item.get('name')}]({item.get('path')})")
    if ticket.get("checks") and ticket["checks"].get("tail"):
        lines.extend(["", "## Letzter Prüflauf", "", "```", ticket["checks"]["tail"], "```"])
    if ticket.get("sessions"):
        lines.extend(["", "## Sessions"])
        for session in ticket["sessions"]:
            lines.append(
                f"- {session.get('agent')} · {session.get('name')} · "
                f"{session.get('terminal')} · {fmt_ms(session.get('started_at'))}"
            )
    if ticket.get("comments"):
        lines.extend(["", "## Verlauf"])
        for comment in ticket["comments"]:
            lines.append(
                f"- {fmt_ms(comment.get('at'))} · {comment.get('author')}: {comment.get('text')}"
            )
    return "\n".join(lines).rstrip() + "\n"


def ticket_line(ticket):
    return (
        f"{ticket['id']:<6} {ticket['status']:<8} "
        f"{(ticket.get('assignee') or '—'):<10} {ticket['title']}"
    )


def inbox_line(entry):
    return (
        f"[{entry.get('kind')}] {entry.get('ticket')} · {entry.get('from')} · "
        f"{fmt_ms(entry.get('at'))}: {entry.get('text')}"
    )

