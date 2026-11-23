"""Textausgaben für Menschen: Ticket, Liste, Zeit."""
import json
import time

from . import costs, store


def fmt_ms(ms):
    if not ms:
        return "—"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ms) / 1000))


def short_head(head):
    return (head or "—")[:7]


def ticket_json(ticket):
    return json.dumps(ticket, ensure_ascii=False, indent=2)


def _cost_rows(ticket, cost):
    """Kostenzeilen zu Sessions: gleicher Name, sonst gleiche Position."""
    rows = list(cost.get("sessions") or [])
    used = [False] * len(rows)
    pairs = []
    for index, session in enumerate(ticket.get("sessions") or []):
        row = None
        name = session.get("name")
        if name:
            for position, candidate in enumerate(rows):
                if not used[position] and candidate.get("name") == name:
                    used[position] = True
                    row = candidate
                    break
        if row is None and index < len(rows) and not used[index]:
            used[index] = True
            row = rows[index]
        if row is None:
            for position in range(len(rows)):
                if not used[position]:
                    used[position] = True
                    row = rows[position]
                    break
        pairs.append((session, row))
    return pairs


def _cost_section(ticket, cost):
    lines = ["", "## Kosten"]
    for session, row in _cost_rows(ticket, cost):
        source = (row or {}).get("source")
        text = (
            f"- {session.get('agent') or '—'} · {session.get('name') or '—'} · "
            f"{costs.format_cost((row or {}).get('cost'))}"
        )
        if source:
            text += f" · {source}"
        lines.append(text)
    summary = f"Summe: {costs.format_cost(cost.get('total'))}"
    if ticket.get("max_cost") is not None:
        summary += f" · Limit: {costs.format_cost(ticket.get('max_cost'))}"
    lines.extend(["", summary])
    return lines


def _wait_section(waits):
    lines = ["", "## Liegezeiten"]
    for stage in waits.get("stages") or []:
        lines.append(
            f"- {stage.get('label')}: {costs.format_duration(stage.get('ms'))}"
        )
    return lines


def ticket_text(ticket, children=None, cost=None, waits=None, events=None):
    lines = [f"# {ticket['id']} {ticket['title']}", ""]
    meta = [
        f"Status: {ticket['status']}",
        f"Zuständig: {ticket.get('assignee') or '—'}",
        f"Repo: {ticket.get('repo') or '—'}",
        f"Basis: {ticket.get('base') or '—'}",
        f"Branch: {ticket.get('branch') or '—'}",
        f"Worktree: {ticket.get('worktree') or '—'}",
    ]
    if ticket.get("no_change"):
        meta.append("ohne Änderung: keine Commits über der Basis")
    if ticket.get("parent"):
        meta.append(f"Eltern-Ticket: {ticket['parent']}")
    flow = ticket.get("flow")
    if isinstance(flow, dict) and flow.get("workflow"):
        meta.append(
            f"gehört zu Workflow {flow['workflow']}, Lauf {flow['run']}, "
            f"Schritt {flow['step']}"
        )
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
    if children:
        done = sum(
            1 for child in children if child.get("status") in ("done", "dropped")
        )
        lines.extend(["", f"## Unter-Tickets ({done}/{len(children)} erledigt)"])
        for child in children:
            lines.append(
                f"- {child['id']} · {child.get('status')} · {child.get('title')}"
            )
    if ticket.get("sessions"):
        lines.extend(["", "## Sessions"])
        for session in ticket["sessions"]:
            lines.append(
                f"- {session.get('agent')} · {session.get('name')} · "
                f"{session.get('terminal')} · {fmt_ms(session.get('started_at'))}"
            )
    ended = [
        row for row in (events or [])
        if isinstance(row, dict) and row.get("kind") == "session_ended"
    ]
    if ended:
        lines.extend(["", "## Beendete Sessions"])
        for row in ended:
            head = f"- {fmt_ms(row.get('at'))} · {row.get('target') or '—'}"
            reason = str(row.get("reason") or "").strip()
            if reason:
                head += f": {reason}"
            lines.append(head)
            for text_line in str(row.get("text") or "").splitlines():
                lines.append(f"  {text_line}")
    snapshot = cost if cost is not None else ticket.get("cost")
    if isinstance(snapshot, dict):
        lines.extend(_cost_section(ticket, snapshot))
    elif ticket.get("max_cost") is not None:
        lines.extend(_cost_section(ticket, {}))
    spans = waits if waits is not None else ticket.get("waits")
    if isinstance(spans, dict) and spans.get("stages"):
        lines.extend(_wait_section(spans))
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


def ticket_tree(tickets):
    """Tickets als eingerückte Liste; Kinder unter ihrem Eltern-Ticket."""
    by_parent = {}
    for ticket in tickets:
        by_parent.setdefault(ticket.get("parent"), []).append(ticket)
    present = {ticket["id"] for ticket in tickets}
    lines = []
    seen = set()

    def walk(ticket, depth):
        if ticket["id"] in seen:
            return
        seen.add(ticket["id"])
        lines.append("  " * depth + ticket_line(ticket))
        for child in by_parent.get(ticket["id"], []):
            walk(child, depth + 1)

    for ticket in tickets:
        parent = ticket.get("parent")
        if parent and parent in present:
            continue
        walk(ticket, 0)
    for ticket in tickets:
        walk(ticket, 0)
    return "\n".join(lines)


def inbox_line(entry):
    return (
        f"[{entry.get('kind')}] {entry.get('ticket')} · {entry.get('from')} · "
        f"{fmt_ms(entry.get('at'))}: {entry.get('text')}"
    )

