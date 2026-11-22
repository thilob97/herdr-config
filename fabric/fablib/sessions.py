"""Beendete Agenten-Sessions erkennen und je Session genau einmal melden.

Gelesen wird `hc ls --all --json` (Zustand, Exit-Code) plus `hc get` (Endzeit,
Grund) und `hc read` (letzte Bildschirmzeilen). Ein Vermerk am Session-Eintrag
(`ended`, `seen_live`) macht die Meldung idempotent; er lebt im Ticket und
überlebt so jeden Tick.
"""
import time

from . import events, hc, store
from .errors import HcError

OPEN = ("todo", "doing")
LAST_LINES = 20
LAST_CHARS = 2000


def report(tickets, live, lines=None, dry=False):
    """Offene Tickets prüfen; Rückgabe: (ende je Ticket, geänderte Ticket-IDs).

    `lines` nimmt lesbare Zeilen auf. Im Trockenlauf wird nichts geschrieben.
    Ist `hc` nicht erreichbar, bleibt alles unverändert: ohne Beobachtung kein
    falsches „nie sichtbar“.
    """
    lines = lines if lines is not None else []
    try:
        rows = hc.ls(all=True)
    except HcError:
        return {}, set()
    by_address, by_name = _index(rows)
    ended = {}
    changed = set()
    for ticket in tickets:
        if (ticket or {}).get("status") not in OPEN:
            continue
        found, dirty = _ticket(ticket, live, by_address, by_name, lines, dry)
        if found:
            ended[ticket["id"]] = found
        if dirty:
            changed.add(ticket["id"])
    return ended, changed


def _index(rows):
    by_address = {}
    by_name = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        address = row.get("address")
        name = row.get("name")
        if address:
            by_address[address] = row
        if name:
            by_name.setdefault(name, []).append(row)
    return by_address, by_name


def _ticket(ticket, live, by_address, by_name, lines, dry):
    """(Treffer, geändert?) für ein Ticket."""
    found = []
    dirty = False
    for session in ticket.get("sessions") or []:
        if not isinstance(session, dict):
            continue
        name = str(session.get("name") or "")
        if not name:
            continue
        if name in live:
            if not session.get("seen_live"):
                if not dry:
                    session["seen_live"] = True
                    dirty = True
            continue
        if isinstance(session.get("ended"), dict):
            continue
        row = _row(session, by_address, by_name)
        if row is not None:
            if row.get("state") != "finished":
                continue
            item = _finished(ticket, session, row, lines, dry)
        elif not session.get("seen_live"):
            item = _missing(ticket, session, lines, dry)
        else:
            # War schon sichtbar und ist ohne Terminalzeile verschwunden:
            # als beendet melden, aber ohne belegbaren Fehlstart.
            item = _vanished(ticket, session, lines, dry)
        if item:
            found.append(item)
            dirty = True
    return found, dirty


def _row(session, by_address, by_name):
    """Terminalzeile der Session: zuerst dieselbe Adresse, sonst der Name."""
    address = session.get("terminal")
    if address and address in by_address:
        return by_address[address]
    rows = by_name.get(str(session.get("name") or "")) or []
    return rows[-1] if rows else None


def _finished(ticket, session, row, lines, dry):
    name = str(session.get("name") or "")
    address = row.get("address") or session.get("terminal")
    detail, tail = {}, ""
    if not dry:
        try:
            detail = hc.get(address)
        except HcError:
            detail = {}
        tail = hc.read(address)
    code = detail.get("exit_code", row.get("exit_code"))
    finished_ms = detail.get("finished_ms")
    reason = str(detail.get("reason") or row.get("reason") or "").strip()
    summary = _summary(code, finished_ms, reason)
    if dry:
        lines.append(
            f"{ticket['id']}: geplant: session_ended für {name} – {summary}"
        )
        return {"session": session, "summary": summary, "line": ""}
    text = _clip(tail)
    events.append("session_ended", ticket["id"], "fab", name, text, reason=summary)
    session["ended"] = {
        "at": finished_ms or store.now_ms(),
        "code": code,
        "reason": reason,
        "terminal": address,
    }
    line = f"{ticket['id']}: Session {name} beendet – {summary}"
    lines.append(line)
    return {"session": session, "summary": summary, "line": line}


def _missing(ticket, session, lines, dry):
    name = str(session.get("name") or "")
    summary = "Fehlstart: Session nie sichtbar"
    if dry:
        lines.append(
            f"{ticket['id']}: geplant: session_ended für {name} – {summary}"
        )
        return {"session": session, "summary": summary, "line": ""}
    events.append("session_ended", ticket["id"], "fab", name, "", reason=summary)
    session["ended"] = {
        "at": store.now_ms(),
        "code": None,
        "reason": summary,
        "terminal": session.get("terminal"),
    }
    line = f"{ticket['id']}: Session {name} – {summary}"
    lines.append(line)
    return {"session": session, "summary": summary, "line": line}


def _vanished(ticket, session, lines, dry):
    """Sichtbare Session ohne Terminalzeile: beendet, aber kein Fehlstart."""
    name = str(session.get("name") or "")
    summary = "Verschwunden ohne Abschlusszeile"
    if dry:
        lines.append(
            f"{ticket['id']}: geplant: session_ended für {name} – {summary}"
        )
        return {"session": session, "summary": summary, "line": ""}
    events.append("session_ended", ticket["id"], "fab", name, "", reason=summary)
    session["ended"] = {
        "at": store.now_ms(),
        "code": None,
        "reason": summary,
        "terminal": session.get("terminal"),
    }
    line = f"{ticket['id']}: Session {name} beendet – {summary}"
    lines.append(line)
    return {"session": session, "summary": summary, "line": line}


def ended(ticket):
    """Zuletzt beendete Session eines Tickets als Meldung, sonst []."""
    best = None
    best_at = None
    for session in (ticket or {}).get("sessions") or []:
        if not isinstance(session, dict):
            continue
        marker = session.get("ended")
        if not isinstance(marker, dict):
            continue
        at = int(marker.get("at") or 0)
        if best_at is None or at >= best_at:
            best_at = at
            best = (session, marker)
    if best is None:
        return []
    session, marker = best
    summary = _summary(
        marker.get("code"),
        marker.get("at"),
        str(marker.get("reason") or "").strip(),
    )
    return [{"session": session, "summary": summary, "line": ""}]


def _summary(code, finished_ms, reason):
    parts = [f"Exit {code}" if code is not None else "Exit unbekannt"]
    if finished_ms:
        parts.append("Ende " + _when(finished_ms))
    if reason:
        parts.append(f"Grund {reason}")
    return " · ".join(parts)


def _when(ms):
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ms) / 1000))


def _clip(text, limit_lines=LAST_LINES, limit_chars=LAST_CHARS):
    """Letzte Zeilen; der Hinweis nennt die tatsächlich gekürzte Quelle."""
    lines = [line.rstrip() for line in str(text or "").splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    cut_lines = len(lines) > limit_lines
    cut_chars = False
    if cut_lines:
        lines = lines[-limit_lines:]
    out = "\n".join(lines)
    if len(out) > limit_chars:
        out = out[-limit_chars:]
        cut_chars = True
    if cut_lines or cut_chars:
        parts = []
        if cut_lines:
            parts.append(f"letzte {limit_lines} Zeilen")
        if cut_chars:
            parts.append(f"letzte {limit_chars} Zeichen")
        note = "[… gekürzt: hc read, " + " und ".join(parts) + "]"
        out = f"{out}\n{note}" if out else note
    return out
