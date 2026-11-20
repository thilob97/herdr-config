"""Zustand unter `$FAB_HOME`: Lock, Counter, Tickets, atomares Schreiben.

Ein Ticket ist eine JSON-Datei `tickets/T-<n>.json`. Alle Felder aus dem Vertrag
sind vorhanden; Felder, die `fab` nicht kennt, bleiben beim Lesen und Schreiben
erhalten. IDs kommen ausschließlich aus `counter`.
"""
import contextlib
import fcntl
import json
import os
import re
import tempfile
import time

from .errors import FabError

DEFAULT_HOME = "~/.config/herdr-app/data/fabric"
STATUSES = ("draft", "todo", "doing", "review", "done", "dropped")
_ID_RE = re.compile(r"^[Tt]-(\d+)$")


def home():
    raw = os.environ.get("FAB_HOME") or DEFAULT_HOME
    return os.path.abspath(os.path.expanduser(raw))


def tickets_dir():
    return os.path.join(home(), "tickets")


def counter_path():
    return os.path.join(home(), "counter")


def events_path():
    return os.path.join(home(), "events.jsonl")


def index_path():
    return os.path.join(home(), "index.json")


def lock_path():
    return os.path.join(home(), "lock")


def now_ms():
    return int(time.time() * 1000)


def ensure():
    os.makedirs(tickets_dir(), exist_ok=True)
    path = events_path()
    if not os.path.exists(path):
        with open(path, "a", encoding="utf-8"):
            pass


_lock_depth = 0
_lock_handle = None


@contextlib.contextmanager
def locked():
    """Exklusives flock für alle Schreibvorgänge; im selben Prozess reentrant."""
    global _lock_depth, _lock_handle
    if _lock_depth == 0:
        ensure()
        handle = open(lock_path(), "a+", encoding="utf-8")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        except BaseException:
            handle.close()
            raise
        _lock_handle = handle
    _lock_depth += 1
    try:
        yield
    finally:
        _lock_depth -= 1
        if _lock_depth == 0:
            handle = _lock_handle
            _lock_handle = None
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            finally:
                handle.close()


def atomic_write(path, text, mode=None):
    """Erst in eine temporäre Datei, dann mit os.replace an ihren Platz.

    `mode` setzt die Dateirechte der neuen Datei (sonst 0600 aus mkstemp).
    """
    folder = os.path.dirname(path) or "."
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".fab-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def normalize_id(raw):
    match = _ID_RE.match((raw or "").strip())
    if not match:
        raise FabError(f"Ungültige Ticket-ID: {raw!r} (erwartet T-1)")
    return f"T-{int(match.group(1))}"


def ticket_path(tid):
    return os.path.join(tickets_dir(), f"{tid}.json")


def blank_ticket(tid, title="", body="", repo=None, created_by=""):
    at = now_ms()
    return {
        "id": tid,
        "title": title,
        "status": "draft",
        "body": body,
        "repo": repo,
        "base": None,
        "branch": None,
        "worktree": None,
        "assignee": None,
        "blocked_by": [],
        "waiting": [],
        "created_at": at,
        "updated_at": at,
        "created_by": created_by,
        "comments": [],
        "sessions": [],
        "checks": None,
        "verdict": None,
    }


def next_id():
    """Nächste ID vergeben. Nur unter `locked()` aufrufen."""
    path = counter_path()
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read().strip()
        number = int(raw or "1")
    except FileNotFoundError:
        number = 1
    except ValueError:
        raise FabError(f"counter enthält keine Zahl: {path}")
    if number < 1:
        raise FabError(f"counter enthält keine gültige Nummer: {path}")
    atomic_write(path, f"{number + 1}\n")
    return f"T-{number}"


def load(raw_id):
    tid = normalize_id(raw_id)
    path = ticket_path(tid)
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        raise FabError(f"Ticket {tid} gibt es nicht")
    except json.JSONDecodeError as exc:
        raise FabError(f"Ticket {tid} ist kein gültiges JSON: {exc}")
    if not isinstance(data, dict):
        raise FabError(f"Ticket {tid} ist kein JSON-Objekt")
    for key, value in blank_ticket(tid).items():
        data.setdefault(key, value)
    data["id"] = tid
    return data


def save(ticket):
    tid = normalize_id(ticket.get("id"))
    ticket["id"] = tid
    ticket["updated_at"] = now_ms()
    text = json.dumps(ticket, ensure_ascii=False, indent=2) + "\n"
    atomic_write(ticket_path(tid), text)


def _ticket_files():
    ensure()
    found = []
    for name in os.listdir(tickets_dir()):
        match = re.match(r"^T-(\d+)\.json$", name)
        if match:
            found.append((int(match.group(1)), name))
    found.sort()
    return [name for _, name in found]


def all_tickets():
    tickets = []
    for name in _ticket_files():
        try:
            tickets.append(load(name[:-5]))
        except FabError:
            # Eine kaputte Datei darf die Ansicht nicht blockieren.
            continue
    return tickets
