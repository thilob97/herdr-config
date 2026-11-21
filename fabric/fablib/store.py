"""Zustand unter `$FAB_HOME`: SQLite als Quelle, JSON nur als Lesemodell.

Die Datenbank liegt in `data/fabric/fabric.db` (WAL). `tickets/<id>.json` und
`index.json` werden nach jedem Commit aus der Datenbank neu erzeugt, damit Mod
und Sidebar unverändert weiterlesen können. Schreibvorgänge laufen unter einem
prozessweiten, reentranten flock und genau einer SQLite-Transaktion.

Alle `sqlite3`-Aufrufe bleiben in diesem Modul. `events.py`, `herdr.py` und die
übrigen Fablib-Module sprechen ausschließlich über diese Schnittstelle.

Altbestand (`tickets/`, `counter`, `events.jsonl`, `herdr.json`) wird beim
ersten `ensure()` in eine temporäre Datenbank migriert, die Zählungen werden
exakt verglichen, erst dann ersetzt `os.replace` die Zieldatei. Schlägt die
Migration fehl, bleiben die Altdateien unangetastet und der alte Dateipfad
dient weiter (Fallback).
"""
import contextlib
import fcntl
import json
import os
import re
import shutil
import sqlite3
import tempfile
import time
from datetime import date, datetime

from .errors import FabError


class PersistError(FabError):
    """Befehl scheitert, sein bisheriger Zustand soll aber festgeschrieben werden.

    Beispiel: `fab dispatch` legt Branch und Worktree an, der Agentenstart
    scheitert; beides bleibt für den zweiten Versuch erhalten.
    """

DEFAULT_HOME = "~/.config/herdr-app/data/fabric"
STATUSES = ("draft", "todo", "doing", "review", "done", "dropped")
MAX_CHILDREN = 3
_ID_RE = re.compile(r"^[Tt]-(\d+)$")
_TICKET_FILE_RE = re.compile(r"^T-(\d+)\.json$")

_MIGRATION_MARKER = "legacy_migrated"
_TABLES = ("tickets", "comments", "sessions", "attachments", "events", "counter", "meta")

_FLOW_SCHEMA = (
    """CREATE TABLE IF NOT EXISTS workflows (
        name TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS flow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        dry INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        started_at INTEGER,
        updated_at INTEGER
    )""",
    "CREATE INDEX IF NOT EXISTS flow_runs_workflow ON flow_runs(workflow)",
    "CREATE INDEX IF NOT EXISTS flow_runs_status ON flow_runs(status)",
    """CREATE TABLE IF NOT EXISTS flow_steps (
        run INTEGER NOT NULL,
        position INTEGER NOT NULL,
        node TEXT,
        kind TEXT,
        status TEXT,
        data TEXT,
        at INTEGER,
        PRIMARY KEY (run, position)
    )""",
)

_SCHEMA = (
    """CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        number INTEGER NOT NULL,
        data TEXT NOT NULL,
        title TEXT,
        status TEXT,
        parent TEXT,
        assignee TEXT,
        repo TEXT,
        branch TEXT,
        worktree TEXT,
        updated_at INTEGER,
        created_at INTEGER,
        waiting_mensch INTEGER NOT NULL DEFAULT 0,
        stall_rule TEXT,
        stall_attention INTEGER NOT NULL DEFAULT 0,
        stall_since INTEGER,
        stall_reason TEXT,
        stall_agent TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS tickets_number ON tickets(number)",
    "CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status)",
    "CREATE INDEX IF NOT EXISTS tickets_parent ON tickets(parent)",
    """CREATE TABLE IF NOT EXISTS comments (
        ticket TEXT NOT NULL,
        n INTEGER NOT NULL,
        at INTEGER,
        author TEXT,
        text TEXT,
        mentions TEXT,
        data TEXT,
        PRIMARY KEY (ticket, n)
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        ticket TEXT NOT NULL,
        position INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (ticket, position)
    )""",
    """CREATE TABLE IF NOT EXISTS attachments (
        ticket TEXT NOT NULL,
        position INTEGER NOT NULL,
        name TEXT,
        path TEXT,
        at INTEGER,
        PRIMARY KEY (ticket, position)
    )""",
    """CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER,
        kind TEXT,
        ticket TEXT,
        actor TEXT,
        target TEXT,
        text TEXT,
        reason TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS events_ticket ON events(ticket)",
    "CREATE INDEX IF NOT EXISTS events_kind_text ON events(kind, text)",
    """CREATE TABLE IF NOT EXISTS counter (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value INTEGER NOT NULL
    )""",
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)",
    *_FLOW_SCHEMA,
)


# ---------------------------------------------------------------- Pfade


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


def db_path():
    return os.path.join(home(), "fabric.db")


def legacy_dir():
    return os.path.join(home(), "legacy")


def backups_dir():
    return os.path.join(home(), "backups")


def attachments_dir(tid=None):
    base = os.path.join(home(), "attachments")
    return os.path.join(base, tid) if tid else base


def ticket_path(tid):
    return os.path.join(tickets_dir(), f"{tid}.json")


def now_ms():
    return int(time.time() * 1000)


# ---------------------------------------------------------------- Zustand

_conn = None
_conn_home = None
_state_home = None
_lock_depth = 0
_lock_handle = None
_tx_open = False
_dirty_tickets = set()
_index_dirty = False
_pending_index = None
_fallback = {}          # home -> True, wenn Bootstrap/Migration scheiterte
_bootstrapped = set()   # home -> Bootstrap einmal versucht
_legacy_meta = {}       # home -> {key: value} für den Datei-Fallback
_bootstrapping = 0      # Migration hält den flock; kein zweites Mal anfordern


def bootstrap_active():
    """Läuft eine Migration unter dem Bootstrap-Lock?"""
    return bool(_bootstrapping)


def _sync_home():
    """Verbindung und Puffer wechseln, wenn FAB_HOME sich ändert (Tests)."""
    global _state_home
    current = home()
    if _state_home == current:
        return
    _close_conn()
    _reset_pending()
    _state_home = current


def _close_conn():
    global _conn, _conn_home
    if _conn is not None:
        try:
            _conn.close()
        except sqlite3.Error:
            pass
    _conn = None
    _conn_home = None


def _reset_pending():
    global _dirty_tickets, _index_dirty, _pending_index
    _dirty_tickets = set()
    _index_dirty = False
    _pending_index = None


def _db_ready():
    return os.path.exists(db_path()) and not _fallback.get(home())


def _connect():
    global _conn, _conn_home
    current = home()
    if _conn is not None and _conn_home == current:
        return _conn
    _close_conn()
    conn = sqlite3.connect(db_path(), isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(comments)")}
    if "data" not in columns:
        try:
            conn.execute("ALTER TABLE comments ADD COLUMN data TEXT")
        except sqlite3.OperationalError:
            pass
    for statement in _FLOW_SCHEMA:
        conn.execute(statement)
    _conn = conn
    _conn_home = current
    return conn


@contextlib.contextmanager
def _flock():
    """Bootstrap-/Migrations-Lock; nicht reentrant, nie innerhalb von `locked()`."""
    os.makedirs(home(), exist_ok=True)
    handle = open(lock_path(), "a+", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _has_legacy():
    if os.path.exists(counter_path()) or os.path.exists(events_path()):
        return True
    if os.path.exists(os.path.join(home(), "herdr.json")):
        return True
    folder = tickets_dir()
    if os.path.isdir(folder):
        return any(_TICKET_FILE_RE.match(name) for name in os.listdir(folder))
    return False


def ensure():
    """Verzeichnisse anlegen und beim ersten Aufruf DB bzw. Migration aufbauen."""
    _sync_home()
    current = home()
    os.makedirs(current, exist_ok=True)
    if os.path.exists(db_path()):
        _fallback.pop(current, None)
        return
    if _fallback.get(current):
        return
    if current in _bootstrapped:
        return
    _bootstrapped.add(current)
    with _flock():
        if os.path.exists(db_path()):
            _fallback.pop(current, None)
            return
        try:
            if _has_legacy():
                report = _migrate_locked(force=True)
                if report["status"] == "failed":
                    _fallback[current] = True
            else:
                _install_empty_db()
        except Exception:  # noqa: BLE001 - jeder Fehler führt in den Fallback
            if not os.path.exists(db_path()):
                _fallback[current] = True
    if _fallback.get(current):
        _legacy_prepare()


def _legacy_prepare():
    os.makedirs(tickets_dir(), exist_ok=True)
    path = events_path()
    if not os.path.exists(path):
        with open(path, "a", encoding="utf-8"):
            pass


def _install_empty_db():
    fd, tmp = tempfile.mkstemp(dir=home(), prefix=".fabric-", suffix=".db")
    os.close(fd)
    try:
        conn = sqlite3.connect(tmp, isolation_level=None)
        try:
            for statement in _SCHEMA:
                conn.execute(statement)
        finally:
            conn.close()
        _close_conn()
        os.replace(tmp, db_path())
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- Lock/Transaktion


@contextlib.contextmanager
def locked():
    """Exklusiver flock; im selben Prozess reentrant, äußerste Ebene = Transaktion."""
    global _lock_depth, _lock_handle, _tx_open

    ensure()
    if not _db_ready():
        if _lock_depth == 0:
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
            if _lock_depth == 0 and _lock_handle is not None:
                _unlock()
        return

    if _lock_depth:
        _lock_depth += 1
        try:
            yield
        finally:
            _lock_depth -= 1
        return

    handle = open(lock_path(), "a+", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    except BaseException:
        handle.close()
        raise
    _lock_handle = handle
    _lock_depth = 1
    _reset_pending()
    conn = None
    try:
        _maybe_daily_backup()
        conn = _connect()
        conn.execute("BEGIN IMMEDIATE")
        _tx_open = True
        try:
            yield
            conn.execute("COMMIT")
            _tx_open = False
        except PersistError:
            _tx_open = False
            conn.execute("COMMIT")
            _flush_read_models()
            _reset_pending()
            raise
        except BaseException:
            _tx_open = False
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            _reset_pending()
            raise
        _flush_read_models()
        _reset_pending()
    finally:
        _tx_open = False
        _lock_depth = 0
        _unlock()


def _unlock():
    global _lock_handle
    handle = _lock_handle
    _lock_handle = None
    if handle is None:
        return
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


@contextlib.contextmanager
def _auto_tx():
    if _lock_depth:
        yield
    else:
        with locked():
            yield


def in_transaction():
    return bool(_tx_open and _lock_depth)


def defer_index(payload):
    """Von `index.rebuild()` innerhalb einer Transaktion aufgerufen."""
    global _pending_index, _index_dirty
    if in_transaction():
        _pending_index = payload
        _index_dirty = True
        return
    atomic_write(index_path(), _json_line(payload))


def _flush_read_models():
    reviewer = "ada"
    try:
        from . import agents

        roster = agents.load(required=False)
        if roster:
            reviewer = str(roster.get("reviewer") or "ada")
    except FabError:
        pass
    for tid in sorted(_dirty_tickets, key=_number_of):
        _write_model(load(tid), reviewer)
    payload = _pending_index
    if payload is None and _index_dirty:
        from . import index as index_mod

        payload = index_mod.build()
    if payload is not None:
        atomic_write(index_path(), _json_line(payload))


# ---------------------------------------------------------------- Dateien


def atomic_write(path, text, mode=None):
    """Erst in eine temporäre Datei, dann mit os.replace an ihren Platz."""
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


def _json_line(value):
    return json.dumps(value, ensure_ascii=False) + "\n"


def _ticket_text(ticket):
    return json.dumps(ticket, ensure_ascii=False, indent=2) + "\n"


def _write_model(ticket, reviewer="ada"):
    """Lesemodell schreiben: Kosten bleiben gespeichert, Liegezeiten kommen dazu."""
    from . import costs

    model = dict(ticket)
    model["waits"] = costs.waits(
        ticket, event_rows_for(ticket["id"]), reviewer
    )
    atomic_write(ticket_path(ticket["id"]), _ticket_text(model))


# ---------------------------------------------------------------- Ticket-Modell


def normalize_id(raw):
    match = _ID_RE.match((raw or "").strip())
    if not match:
        raise FabError(f"Ungültige Ticket-ID: {raw!r} (erwartet T-1)")
    return f"T-{int(match.group(1))}"


def _number_of(tid):
    match = _ID_RE.match(tid or "")
    return int(match.group(1)) if match else 0


def blank_ticket(tid, title="", body="", repo=None, created_by=""):
    at = now_ms()
    return {
        "id": tid,
        "title": title,
        "status": "draft",
        "body": body,
        "parent": None,
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
        "issue": None,
        "max_cost": None,
    }


def _with_defaults(tid, data):
    for key, value in blank_ticket(tid).items():
        data.setdefault(key, value)
    data["id"] = tid
    return data


def _iter_comments(ticket):
    """(n, Kommentar); `n` bleibt die gespeicherte Nummer, nur fehlende bekommen die Position."""
    used = set()
    for index, comment in enumerate(ticket.get("comments") or [], start=1):
        if not isinstance(comment, dict):
            continue
        number = comment.get("n")
        if (not isinstance(number, int) or isinstance(number, bool)
                or number < 1 or number in used):
            number = index
            while number in used:
                number += 1
        used.add(number)
        yield number, comment


def _iter_sessions(ticket):
    for index, session in enumerate(ticket.get("sessions") or [], start=1):
        if isinstance(session, dict):
            yield index, session


def _iter_attachments(ticket):
    for index, item in enumerate(ticket.get("attachments") or [], start=1):
        if isinstance(item, dict):
            yield index, item


def _row_values(tid, ticket):
    number = _number_of(tid)
    stall = ticket.get("stall")
    if not isinstance(stall, dict):
        stall = {}
    waiting = ticket.get("waiting") or []
    data = {
        key: value
        for key, value in ticket.items()
        if key not in ("comments", "sessions", "attachments")
    }
    return (
        tid,
        number,
        json.dumps(data, ensure_ascii=False),
        ticket.get("title"),
        ticket.get("status"),
        ticket.get("parent"),
        ticket.get("assignee"),
        ticket.get("repo"),
        ticket.get("branch"),
        ticket.get("worktree"),
        ticket.get("updated_at"),
        ticket.get("created_at"),
        1 if "mensch" in waiting else 0,
        stall.get("rule"),
        1 if stall.get("attention") else 0,
        stall.get("since"),
        stall.get("reason"),
        stall.get("agent"),
    )


_TICKET_UPSERT = """INSERT INTO tickets (
    id, number, data, title, status, parent, assignee, repo, branch, worktree,
    updated_at, created_at, waiting_mensch, stall_rule, stall_attention,
    stall_since, stall_reason, stall_agent
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
    number=excluded.number, data=excluded.data, title=excluded.title,
    status=excluded.status, parent=excluded.parent, assignee=excluded.assignee,
    repo=excluded.repo, branch=excluded.branch, worktree=excluded.worktree,
    updated_at=excluded.updated_at, created_at=excluded.created_at,
    waiting_mensch=excluded.waiting_mensch, stall_rule=excluded.stall_rule,
    stall_attention=excluded.stall_attention, stall_since=excluded.stall_since,
    stall_reason=excluded.stall_reason, stall_agent=excluded.stall_agent"""


def _write_ticket(conn, tid, ticket):
    conn.execute(_TICKET_UPSERT, _row_values(tid, ticket))
    conn.execute("DELETE FROM comments WHERE ticket=?", (tid,))
    for number, comment in _iter_comments(ticket):
        conn.execute(
            "INSERT INTO comments(ticket,n,at,author,text,mentions,data) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                tid,
                number,
                comment.get("at"),
                comment.get("author"),
                comment.get("text"),
                json.dumps(comment.get("mentions") or [], ensure_ascii=False),
                json.dumps(comment, ensure_ascii=False),
            ),
        )
    conn.execute("DELETE FROM sessions WHERE ticket=?", (tid,))
    for index, session in _iter_sessions(ticket):
        conn.execute(
            "INSERT INTO sessions(ticket,position,data) VALUES (?,?,?)",
            (tid, index, json.dumps(session, ensure_ascii=False)),
        )
    conn.execute("DELETE FROM attachments WHERE ticket=?", (tid,))
    for index, item in _iter_attachments(ticket):
        conn.execute(
            "INSERT INTO attachments(ticket,position,name,path,at) VALUES (?,?,?,?,?)",
            (tid, index, item.get("name"), item.get("path"), item.get("at")),
        )


def _ticket_from_row(conn, row):
    tid = row["id"]
    try:
        data = json.loads(row["data"] or "{}")
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    ticket = _with_defaults(tid, dict(data))

    comments = []
    for item in conn.execute(
        "SELECT n,at,author,text,mentions,data FROM comments WHERE ticket=? ORDER BY n",
        (tid,),
    ):
        comment = None
        if item["data"]:
            try:
                parsed = json.loads(item["data"])
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                comment = parsed
        if comment is None:
            try:
                mentions = json.loads(item["mentions"] or "[]")
            except json.JSONDecodeError:
                mentions = []
            comment = {
                "at": item["at"],
                "author": item["author"],
                "text": item["text"],
                "mentions": mentions if isinstance(mentions, list) else [],
            }
        comment["n"] = item["n"]
        comments.append(comment)
    ticket["comments"] = comments

    sessions = []
    for item in conn.execute(
        "SELECT data FROM sessions WHERE ticket=? ORDER BY position", (tid,)
    ):
        try:
            session = json.loads(item["data"] or "{}")
        except json.JSONDecodeError:
            continue
        if isinstance(session, dict):
            sessions.append(session)
    ticket["sessions"] = sessions

    attachments = []
    for item in conn.execute(
        "SELECT name,path,at FROM attachments WHERE ticket=? ORDER BY position", (tid,)
    ):
        attachments.append(
            {"name": item["name"], "path": item["path"], "at": item["at"]}
        )
    if attachments:
        ticket["attachments"] = attachments
    return ticket


def _load_db(raw_id):
    tid = normalize_id(raw_id)
    conn = _connect()
    row = conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
    if row is None:
        raise FabError(f"Ticket {tid} gibt es nicht")
    return _ticket_from_row(conn, row)


def _legacy_load(raw_id):
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
    return _with_defaults(tid, data)


def load(raw_id):
    ensure()
    if _db_ready():
        return _load_db(raw_id)
    return _legacy_load(raw_id)


def _save_db(ticket, touch):
    global _index_dirty
    tid = normalize_id(ticket.get("id"))
    ticket["id"] = tid
    if touch:
        ticket["updated_at"] = now_ms()
    if ticket.get("sessions") and ticket.get("worktree"):
        from . import costs

        ticket["cost"] = costs.collect(ticket)
    _write_ticket(_connect(), tid, ticket)
    _dirty_tickets.add(tid)
    _index_dirty = True


def _legacy_save(ticket, touch):
    tid = normalize_id(ticket.get("id"))
    ticket["id"] = tid
    if touch:
        ticket["updated_at"] = now_ms()
    if ticket.get("sessions") and ticket.get("worktree"):
        from . import costs

        ticket["cost"] = costs.collect(ticket)
    atomic_write(ticket_path(tid), _ticket_text(ticket))


def save(ticket, touch=True):
    ensure()
    if _db_ready():
        with _auto_tx():
            _save_db(ticket, touch)
        return
    _legacy_save(ticket, touch)


def next_id():
    """Nächste ID aus `counter`; innerhalb der laufenden Transaktion."""
    ensure()
    if _db_ready():
        with _auto_tx():
            conn = _connect()
            row = conn.execute("SELECT value FROM counter WHERE id=1").fetchone()
            if row is None:
                value = 1
                conn.execute("INSERT INTO counter(id,value) VALUES (1,?)", (value + 1,))
            else:
                value = int(row["value"])
                conn.execute("UPDATE counter SET value=? WHERE id=1", (value + 1,))
            if value < 1:
                raise FabError(f"counter enthält keine gültige Nummer: {db_path()}")
            return f"T-{value}"
    return _legacy_next_id()


def _legacy_next_id():
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


def _all_ids():
    conn = _connect()
    return [
        row["id"]
        for row in conn.execute("SELECT id FROM tickets ORDER BY number")
    ]


def _legacy_ticket_files():
    folder = tickets_dir()
    if not os.path.isdir(folder):
        return []
    found = []
    for name in os.listdir(folder):
        match = _TICKET_FILE_RE.match(name)
        if match:
            found.append((int(match.group(1)), name))
    found.sort()
    return [name for _, name in found]


def all_tickets():
    ensure()
    if _db_ready():
        conn = _connect()
        return [
            _ticket_from_row(conn, row)
            for row in conn.execute("SELECT * FROM tickets ORDER BY number")
        ]
    tickets = []
    for name in _legacy_ticket_files():
        try:
            tickets.append(_legacy_load(name[:-5]))
        except FabError:
            continue
    return tickets


_QUERIES = {
    "open": "status NOT IN ('done','dropped')",
    # `open` meint hier „nicht abgeschlossen“ wie in `_open_blockers`; der
    # Wächter filtert draft/review selbst über `FROZEN`.
    "stalled": "status IN ('todo','doing') AND stall_attention=1 AND stall_since IS NOT NULL",
    "question": "status NOT IN ('done','dropped','review') AND waiting_mensch=1",
    "review": "status='review'",
}


def _query_tickets(mode):
    ensure()
    if _db_ready():
        conn = _connect()
        sql = f"SELECT * FROM tickets WHERE {_QUERIES[mode]} ORDER BY number"
        return [_ticket_from_row(conn, row) for row in conn.execute(sql)]
    return [ticket for ticket in all_tickets() if _match(ticket, mode)]


def _match(ticket, where):
    status = ticket.get("status")
    stall = ticket.get("stall") if isinstance(ticket.get("stall"), dict) else {}
    if where == "open":
        return status not in ("done", "dropped")
    if where == "stalled":
        return (
            status in ("todo", "doing")
            and bool(stall.get("attention"))
            and stall.get("since") is not None
        )
    if where == "question":
        return status not in ("done", "dropped", "review") and "mensch" in (
            ticket.get("waiting") or []
        )
    if where == "review":
        return status == "review"
    return False


def open_tickets():
    return _query_tickets("open")


def stalled_tickets():
    return _query_tickets("stalled")


def question_tickets():
    return _query_tickets("question")


def review_tickets():
    return _query_tickets("review")


def children_of(tickets, parent_id):
    """Tickets, die `parent_id` als Eltern-Ticket nennen; Reihenfolge der Eingabe."""
    return [ticket for ticket in tickets if ticket.get("parent") == parent_id]


# ---------------------------------------------------------------- Ereignisse


def _legacy_event_rows():
    try:
        handle = open(events_path(), encoding="utf-8")
    except FileNotFoundError:
        return []
    rows = []
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and "kind" in row:
                rows.append(row)
    return rows


def _event_dict(row):
    return {
        "at": row["at"],
        "kind": row["kind"],
        "ticket": row["ticket"],
        "actor": row["actor"],
        "target": row["target"],
        "text": row["text"],
        "reason": row["reason"],
    }


def event_append(kind, ticket, actor="", target="", text="", reason="", at=None):
    row = {
        "at": now_ms() if at is None else int(at),
        "kind": kind,
        "ticket": ticket or "",
        "actor": actor or "",
        "target": target or "",
        "text": text or "",
        "reason": reason or "",
    }
    ensure()
    if _db_ready():
        global _index_dirty
        with _auto_tx():
            conn = _connect()
            conn.execute(
                "INSERT INTO events(at,kind,ticket,actor,target,text,reason) "
                "VALUES (?,?,?,?,?,?,?)",
                (
                    row["at"],
                    row["kind"],
                    row["ticket"],
                    row["actor"],
                    row["target"],
                    row["text"],
                    row["reason"],
                ),
            )
            _index_dirty = True
        return row
    with open(events_path(), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def event_rows(limit=None):
    ensure()
    if not _db_ready():
        rows = _legacy_event_rows()
        return rows[-limit:] if limit is not None else rows
    conn = _connect()
    if limit is None:
        rows = conn.execute("SELECT * FROM events ORDER BY id").fetchall()
    else:
        if limit <= 0:
            return []
        rows = conn.execute(
            "SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        rows = list(reversed(rows))
    return [_event_dict(row) for row in rows]


def event_tail(limit):
    return event_rows(limit)


def event_rows_for(tid):
    """Alle Ereignisse eines Tickets; Zeilen ohne Ticket-ID gelten mit."""
    ensure()
    tid = normalize_id(tid)
    if not _db_ready():
        return [
            row
            for row in _legacy_event_rows()
            if not row.get("ticket") or row.get("ticket") == tid
        ]
    rows = _connect().execute(
        "SELECT * FROM events WHERE ticket=? OR ticket='' ORDER BY id", (tid,)
    ).fetchall()
    return [_event_dict(row) for row in rows]


def event_has_text(ticket, text):
    ensure()
    if not _db_ready():
        return any(
            row.get("kind") == "wake"
            and row.get("ticket") == ticket
            and row.get("text") == text
            for row in _legacy_event_rows()
        )
    row = _connect().execute(
        "SELECT 1 FROM events WHERE kind='wake' AND ticket=? AND text=? LIMIT 1",
        (ticket, text),
    ).fetchone()
    return row is not None


def event_count_wakes(ticket, target, since_ms, texts):
    ensure()
    texts = list(texts)
    if not texts:
        return 0
    if not _db_ready():
        return sum(
            1
            for row in _legacy_event_rows()
            if row.get("kind") == "wake"
            and row.get("ticket") == ticket
            and row.get("target") == target
            and row.get("text") in texts
            and int(row.get("at") or 0) >= since_ms
        )
    marks = ",".join("?" for _ in texts)
    sql = (
        "SELECT COUNT(*) FROM events WHERE kind='wake' AND ticket=? AND target=? "
        f"AND at>=? AND text IN ({marks})"
    )
    return int(
        _connect()
        .execute(sql, [ticket, target, int(since_ms), *texts])
        .fetchone()[0]
    )


def attention_event_rows(texts):
    """Nur die letzte Ereigniszeile je Ticket, wenn sie eine Aufmerksamkeits-Weckung ist."""
    ensure()
    texts = list(texts)
    if not texts:
        return []
    if not _db_ready():
        rows = []
        per_ticket = {}
        for row in _legacy_event_rows():
            per_ticket[row.get("ticket")] = row
        for row in per_ticket.values():
            if row.get("kind") == "wake" and row.get("text") in texts:
                rows.append(row)
        rows.sort(key=lambda row: (_number_of(row.get("ticket") or ""),))
        return rows
    marks = ",".join("?" for _ in texts)
    sql = (
        "SELECT e.* FROM events e JOIN ("
        "  SELECT ticket, MAX(id) AS last_id FROM events GROUP BY ticket"
        ") last ON e.id = last.last_id "
        "LEFT JOIN tickets t ON t.id = e.ticket "
        f"WHERE e.kind='wake' AND e.text IN ({marks}) "
        "ORDER BY COALESCE(t.number, 0), e.id"
    )
    return [_event_dict(row) for row in _connect().execute(sql, texts)]


def event_marker():
    ensure()
    if not _db_ready():
        return len(_legacy_event_rows())
    row = _connect().execute("SELECT COALESCE(MAX(id),0) FROM events").fetchone()
    return int(row[0])


def event_clear():
    ensure()
    if not _db_ready():
        atomic_write(events_path(), "")
        return
    global _index_dirty
    with _auto_tx():
        _connect().execute("DELETE FROM events")
        _index_dirty = True


# ---------------------------------------------------------------- Metadaten


def _legacy_meta_get(key, default):
    if key == "herdr_space":
        try:
            with open(os.path.join(home(), "herdr.json"), encoding="utf-8") as handle:
                data = json.load(handle)
        except (FileNotFoundError, json.JSONDecodeError):
            return default
        space = data.get("space") if isinstance(data, dict) else None
        return space if isinstance(space, str) and space else default
    return _legacy_meta.get(home(), {}).get(key, default)


def _legacy_meta_set(key, value):
    if key == "herdr_space":
        path = os.path.join(home(), "herdr.json")
        atomic_write(path, _json_line({"space": value}))
        return
    _legacy_meta.setdefault(home(), {})[key] = value


def meta_get(key, default=None):
    ensure()
    if not _db_ready():
        return _legacy_meta_get(key, default)
    row = _connect().execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row is not None else default


def meta_set(key, value):
    ensure()
    if not _db_ready():
        _legacy_meta_set(key, value)
        return
    with _auto_tx():
        _connect().execute(
            "INSERT INTO meta(key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )


# ---------------------------------------------------------------- Workflows


def _flow_json(data):
    return json.dumps(data, ensure_ascii=False)


def _flow_parse(raw, default=None):
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def flow_definition_save(name, data):
    """Workflow-Definition anlegen/ersetzen; data ist das JSON-Objekt."""
    ensure()
    at = now_ms()
    with _auto_tx():
        _connect().execute(
            "INSERT INTO workflows(name,data,created_at,updated_at) VALUES (?,?,?,?) "
            "ON CONFLICT(name) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            (name, _flow_json(data), at, at),
        )


def flow_definition_load(name):
    ensure()
    row = _connect().execute(
        "SELECT name,data,updated_at FROM workflows WHERE name=?", (name,)
    ).fetchone()
    if row is None:
        return None
    data = _flow_parse(row["data"], {})
    if not isinstance(data, dict):
        data = {}
    data["name"] = row["name"]
    data["updated_at"] = row["updated_at"]
    return data


def flow_definitions():
    ensure()
    rows = _connect().execute(
        "SELECT name,data,updated_at FROM workflows ORDER BY name"
    ).fetchall()
    definitions = []
    for row in rows:
        data = _flow_parse(row["data"])
        if not isinstance(data, dict):
            continue
        data["name"] = row["name"]
        data["updated_at"] = row["updated_at"]
        definitions.append(data)
    return definitions


def flow_definition_delete(name):
    ensure()
    with _auto_tx():
        cursor = _connect().execute("DELETE FROM workflows WHERE name=?", (name,))
    return cursor.rowcount > 0


def _flow_run_dict(row):
    data = _flow_parse(row["data"], {})
    if not isinstance(data, dict):
        data = {}
    return {
        "id": row["id"],
        "workflow": row["workflow"],
        "status": row["status"],
        "reason": row["reason"] or "",
        "dry": bool(row["dry"]),
        "data": data,
        "started_at": row["started_at"],
        "updated_at": row["updated_at"],
    }


_RUN_COLUMNS = "id,workflow,status,reason,dry,data,started_at,updated_at"


def flow_run_new(workflow, data, dry=False):
    ensure()
    at = now_ms()
    with _auto_tx():
        cursor = _connect().execute(
            "INSERT INTO flow_runs(workflow,status,reason,dry,data,started_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (workflow, "running", "", 1 if dry else 0, _flow_json(data), at, at),
        )
        return int(cursor.lastrowid)


def flow_run_load(run_id):
    ensure()
    row = _connect().execute(
        f"SELECT {_RUN_COLUMNS} FROM flow_runs WHERE id=?", (run_id,)
    ).fetchone()
    return _flow_run_dict(row) if row is not None else None


def flow_run_save(run):
    ensure()
    with _auto_tx():
        _connect().execute(
            "UPDATE flow_runs SET data=?, status=?, reason=?, updated_at=? WHERE id=?",
            (
                _flow_json(run.get("data")),
                run.get("status") or "",
                run.get("reason") or "",
                now_ms(),
                run.get("id"),
            ),
        )


def flow_run_list(workflow=None):
    ensure()
    conn = _connect()
    if workflow is None:
        rows = conn.execute(
            f"SELECT {_RUN_COLUMNS} FROM flow_runs ORDER BY id"
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {_RUN_COLUMNS} FROM flow_runs WHERE workflow=? ORDER BY id",
            (workflow,),
        ).fetchall()
    return [_flow_run_dict(row) for row in rows]


def flow_step_add(run_id, node, kind, status, data=None):
    ensure()
    with _auto_tx():
        conn = _connect()
        row = conn.execute(
            "SELECT COALESCE(MAX(position),-1)+1 FROM flow_steps WHERE run=?",
            (run_id,),
        ).fetchone()
        position = int(row[0])
        conn.execute(
            "INSERT INTO flow_steps(run,position,node,kind,status,data,at) "
            "VALUES (?,?,?,?,?,?,?)",
            (run_id, position, node or "", kind or "", status or "", _flow_json(data), now_ms()),
        )
        return position


def flow_steps(run_id):
    ensure()
    rows = _connect().execute(
        "SELECT run,position,node,kind,status,data,at FROM flow_steps "
        "WHERE run=? ORDER BY position",
        (run_id,),
    ).fetchall()
    return [
        {
            "run": row["run"],
            "position": row["position"],
            "node": row["node"],
            "kind": row["kind"],
            "status": row["status"],
            "data": _flow_parse(row["data"], {}),
            "at": row["at"],
        }
        for row in rows
    ]


def flow_approvals():
    """Offene Freigaben: nur Läufe, die genau an einem Freigabe-Knoten pausieren."""
    ensure()
    rows = []
    for row in _connect().execute(
        "SELECT id,workflow,status,reason,data,updated_at FROM flow_runs "
        "WHERE status='paused' ORDER BY id"
    ):
        data = _flow_parse(row["data"], {})
        paused = data.get("paused_at") if isinstance(data, dict) else None
        if not isinstance(paused, dict) or paused.get("kind") != "approval":
            continue
        text = row["reason"] or ""
        prefix = "Freigabe offen: "
        if text.startswith(prefix):
            text = text[len(prefix):]
        rows.append(
            {
                "id": row["id"],
                "at": row["updated_at"],
                "kind": "flow",
                "ticket": "",
                "actor": "flow",
                "target": paused.get("node") or "",
                "text": text,
                "reason": row["workflow"],
            }
        )
    return rows


# ---------------------------------------------------------------- Anhänge


def _copy_attachment(source, tid, wanted):
    folder = attachments_dir(tid)
    os.makedirs(folder, exist_ok=True)
    try:
        with open(source, "rb") as handle:
            data = handle.read()
    except OSError as exc:
        raise FabError(f"Datei nicht lesbar: {source}: {exc}")
    for name in sorted(os.listdir(folder)):
        target = os.path.join(folder, name)
        if not os.path.isfile(target):
            continue
        try:
            with open(target, "rb") as handle:
                if handle.read() == data:
                    return name
        except OSError:
            continue
    stem, suffix = os.path.splitext(wanted)
    counter = 2
    while True:
        target = os.path.join(folder, wanted)
        if not os.path.exists(target):
            with open(target, "wb") as handle:
                handle.write(data)
            return wanted
        wanted = f"{stem}-{counter}{suffix}"
        counter += 1


def attachment_add(source, tid, wanted_name):
    """Bildkopie plus Anhangszeile; liefert (Name, relativer Pfad)."""
    ensure()
    tid = normalize_id(tid)
    name = _copy_attachment(source, tid, wanted_name)
    relative = f"data/fabric/attachments/{tid}/{name}"
    if _db_ready():
        with _auto_tx():
            conn = _connect()
            existing = conn.execute(
                "SELECT 1 FROM attachments WHERE ticket=? AND path=?", (tid, relative)
            ).fetchone()
            if existing is None:
                row = conn.execute(
                    "SELECT COALESCE(MAX(position),0)+1 FROM attachments WHERE ticket=?",
                    (tid,),
                ).fetchone()
                conn.execute(
                    "INSERT INTO attachments(ticket,position,name,path,at) VALUES (?,?,?,?,?)",
                    (tid, int(row[0]), name, relative, now_ms()),
                )
            _dirty_tickets.add(tid)
    else:
        ticket = _legacy_load(tid)
        items = ticket.setdefault("attachments", [])
        if not any(item.get("path") == relative for item in items):
            items.append({"name": name, "path": relative, "at": now_ms()})
            _legacy_save(ticket, touch=False)
    return name, relative


# ---------------------------------------------------------------- Backup


def backup_files():
    folder = backups_dir()
    if not os.path.isdir(folder):
        return []
    names = [
        name
        for name in os.listdir(folder)
        if name.startswith("fabric-") and name.endswith(".db")
    ]
    return [os.path.join(folder, name) for name in sorted(names)]


def prune_backups(keep=14):
    files = backup_files()
    if keep < 0:
        keep = 0
    for old in files[:-keep] if keep else files:
        try:
            os.unlink(old)
        except OSError:
            pass


def backup():
    ensure()
    if not _db_ready():
        return ""
    os.makedirs(backups_dir(), exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    target = os.path.join(backups_dir(), f"fabric-{stamp}.db")
    fd, tmp = tempfile.mkstemp(dir=backups_dir(), prefix=".fabric-", suffix=".tmp")
    os.close(fd)
    try:
        dest = sqlite3.connect(tmp)
        try:
            _connect().backup(dest)
        finally:
            dest.close()
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    prune_backups(14)
    return target


def _maybe_daily_backup():
    if not _db_ready():
        return
    today = date.today().isoformat()
    conn = _connect()
    row = conn.execute("SELECT value FROM meta WHERE key='last_backup_day'").fetchone()
    if row is not None and row["value"] == today:
        return
    tickets = int(conn.execute("SELECT COUNT(*) FROM tickets").fetchone()[0])
    events = int(conn.execute("SELECT COUNT(*) FROM events").fetchone()[0])
    if tickets == 0 and events == 0:
        return
    try:
        backup()
    except Exception:  # noqa: BLE001 - Sicherung darf Schreiben nicht blockieren
        return
    conn.execute(
        "INSERT INTO meta(key,value) VALUES ('last_backup_day',?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (today,),
    )


# ---------------------------------------------------------------- Migration


def _empty_counts():
    return {
        "tickets": 0,
        "comments": 0,
        "sessions": 0,
        "events": 0,
        "attachments": 0,
        "counter": 0,
    }


def _counts_db(conn):
    counts = {}
    for name in ("tickets", "comments", "sessions", "events", "attachments"):
        counts[name] = int(conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0])
    row = conn.execute("SELECT value FROM counter WHERE id=1").fetchone()
    counts["counter"] = int(row[0]) if row is not None else 1
    return counts


def _read_legacy_tickets():
    tickets = []
    for name in _legacy_ticket_files():
        path = os.path.join(tickets_dir(), name)
        tid = f"T-{int(_TICKET_FILE_RE.match(name).group(1))}"
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except json.JSONDecodeError as exc:
            raise FabError(f"Ticket {tid} ist kein gültiges JSON: {exc}")
        except OSError as exc:
            raise FabError(f"Ticket {tid} ist nicht lesbar: {exc}")
        if not isinstance(data, dict):
            raise FabError(f"Ticket {tid} ist kein JSON-Objekt")
        tickets.append((tid, _with_defaults(tid, data)))
    return tickets


def _read_legacy_counter():
    path = counter_path()
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read().strip()
    except FileNotFoundError:
        return 1
    except OSError as exc:
        raise FabError(f"counter ist nicht lesbar: {exc}")
    try:
        value = int(raw or "1")
    except ValueError:
        raise FabError(f"counter enthält keine Zahl: {path}")
    if value < 1:
        raise FabError(f"counter enthält keine gültige Nummer: {path}")
    return value


def _read_legacy_events():
    rows = []
    skipped = 0
    try:
        handle = open(events_path(), encoding="utf-8")
    except FileNotFoundError:
        return rows, skipped
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            if not isinstance(row, dict) or "kind" not in row:
                skipped += 1
                continue
            rows.append(row)
    return rows, skipped


def _move_legacy():
    os.makedirs(legacy_dir(), exist_ok=True)
    moved = []
    for name in ("tickets", "counter", "events.jsonl", "index.json", "herdr.json"):
        source = os.path.join(home(), name)
        if not os.path.exists(source):
            continue
        target = os.path.join(legacy_dir(), name)
        if os.path.exists(target):
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            candidate = f"{target}-{stamp}"
            suffix = 2
            while os.path.exists(candidate):
                candidate = f"{target}-{stamp}-{suffix}"
                suffix += 1
            target = candidate
        shutil.move(source, target)
        moved.append(name)
    return moved


def _report(status, old=None, new=None, skipped=0, moved=None, error=""):
    return {
        "status": status,
        "db": str(db_path()),
        "legacy": str(legacy_dir()),
        "old": old or _empty_counts(),
        "new": new or _empty_counts(),
        "skipped_events": int(skipped),
        "moved": list(moved or []),
        "error": error,
    }


def _legacy_space():
    try:
        with open(os.path.join(home(), "herdr.json"), encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    space = data.get("space") if isinstance(data, dict) else None
    return space if isinstance(space, str) and space else None


def _regenerate_all():
    global _bootstrapping
    previous = _bootstrapping
    _bootstrapping = 1
    try:
        conn = _connect()
        ids = [row["id"] for row in conn.execute("SELECT id FROM tickets ORDER BY number")]
        for tid in ids:
            _write_model(_ticket_from_row(conn, conn.execute(
                "SELECT * FROM tickets WHERE id=?", (tid,)
            ).fetchone()))
        from . import index as index_mod

        index_mod.rebuild()
    finally:
        _bootstrapping = previous


def _migrate_locked(force=False):
    """Migration unter gehaltenem flock; DB existiert noch nicht."""
    current = home()
    try:
        tickets = _read_legacy_tickets()
        counter_value = _read_legacy_counter()
        events, skipped = _read_legacy_events()
    except BaseException as exc:
        _fallback[current] = True
        return _report("failed", error=str(exc))
    space = _legacy_space()

    old = _empty_counts()
    old["tickets"] = len(tickets)
    old["counter"] = counter_value
    for _, ticket in tickets:
        old["comments"] += sum(1 for _ in _iter_comments(ticket))
        old["sessions"] += sum(1 for _ in _iter_sessions(ticket))
        old["attachments"] += sum(1 for _ in _iter_attachments(ticket))
    old["events"] = len(events)

    fd, tmp = tempfile.mkstemp(dir=current, prefix=".fabric-", suffix=".db")
    os.close(fd)
    try:
        conn = sqlite3.connect(tmp, isolation_level=None)
        try:
            for statement in _SCHEMA:
                conn.execute(statement)
            conn.execute("BEGIN IMMEDIATE")
            for tid, ticket in tickets:
                _write_ticket(conn, tid, ticket)
            conn.execute("INSERT INTO counter(id,value) VALUES (1,?)", (counter_value,))
            for row in events:
                conn.execute(
                    "INSERT INTO events(at,kind,ticket,actor,target,text,reason) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (
                        row.get("at"),
                        row.get("kind"),
                        row.get("ticket") or "",
                        row.get("actor") or "",
                        row.get("target") or "",
                        row.get("text") or "",
                        row.get("reason") or "",
                    ),
                )
            new = _counts_db(conn)
            conn.execute("COMMIT")
        finally:
            conn.close()
        if new != old:
            raise FabError(
                "Migration: Zählungen weichen ab "
                f"(alt {old}, neu {new})"
            )
        _close_conn()
        os.replace(tmp, db_path())
    except BaseException as exc:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        _fallback[current] = True
        return _report("failed", old=old, skipped=skipped, error=str(exc))

    # Ab hier ist die DB die Quelle.
    _fallback.pop(current, None)
    conn = _connect()
    conn.execute("PRAGMA journal_mode=WAL")
    moved = _move_legacy()
    if space:
        conn.execute(
            "INSERT INTO meta(key,value) VALUES ('herdr_space',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (space,),
        )
    conn.execute(
        "INSERT INTO meta(key,value) VALUES (?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (_MIGRATION_MARKER, "1"),
    )
    _regenerate_all()
    return _report("migrated", old=old, new=new, skipped=skipped, moved=moved)


def migrate(force=False):
    """Altdateien einmalig in SQLite übernehmen; liefert den Bericht."""
    _sync_home()
    current = home()
    os.makedirs(current, exist_ok=True)
    if force:
        _fallback.pop(current, None)
        _bootstrapped.discard(current)
    with _flock():
        if os.path.exists(db_path()):
            _fallback.pop(current, None)
            if meta_get(_MIGRATION_MARKER) == "1":
                return _report("already", old=_counts_db(_connect()),
                               new=_counts_db(_connect()))
            return _report("empty", old=_counts_db(_connect()),
                           new=_counts_db(_connect()))
        if not _has_legacy():
            return _report("empty")
        _fallback.pop(current, None)
        report = _migrate_locked(force=force)
        if report["status"] == "failed":
            _fallback[current] = True
            _legacy_prepare()
        return report


# ---------------------------------------------------------------- Übersicht


def storage_info():
    ensure()
    if not _db_ready():
        return {
            "path": str(db_path()),
            "journal_mode": "none",
            "tables": [],
            "counts": _empty_counts(),
        }
    conn = _connect()
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    tables = [
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    counts = _counts_db(conn)
    return {
        "path": str(db_path()),
        "journal_mode": str(mode).lower(),
        "tables": tables,
        "counts": counts,
    }
