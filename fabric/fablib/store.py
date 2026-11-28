"""Zustand unter `$FAB_HOME`: SQLite ist die einzige Datenquelle.

Die Datenbank liegt in `data/fabric/fabric.db` (WAL). Die Lesemodelle für Mod
und Sidebar stehen in `read_models` (Schlüssel `index` und `ticket:<ID>`, Wert
jeweils das frühere JSON-Dokument). Schreibvorgänge laufen unter einem
prozessweiten, reentranten flock und genau einer SQLite-Transaktion; `meta.rev`
zählt jede Änderung an Lesemodellen, Autopilotstatus, Autopilotlog und
Wächtermarke.

Alle `sqlite3`-Aufrufe bleiben in diesem Modul. `events.py`, `herdr.py` und die
übrigen Fablib-Module sprechen ausschließlich über diese Schnittstelle.

Altbestand (`tickets/`, `counter`, `events.jsonl`, `herdr.json`, `index.json`,
`autopilot.json`, `autopilot.log`, `tick-off`, `autopilot-pause`) wird beim
ersten `ensure()` in eine temporäre Datenbank migriert, die Zählungen werden
exakt verglichen, erst dann ersetzt `os.replace` die Zieldatei. Schlägt die
Migration fehl, bleiben die Altdateien unangetastet und `ensure()` meldet den
Fehler; es gibt keinen Datei-Fallback mehr.
"""
import contextlib
import errno
import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime

from . import clock
from .errors import FabError


class PersistError(FabError):
    """Befehl scheitert, sein bisheriger Zustand soll aber festgeschrieben werden.

    Beispiel: `fab dispatch` legt Branch und Worktree an, der Agentenstart
    scheitert; beides bleibt für den zweiten Versuch erhalten.
    """

DEFAULT_HOME = "~/.config/herdr-app/data/fabric"
LOCK_TIMEOUT_DEFAULT = 30.0
_SCHEMA_VERSION = 4
STATUSES = ("draft", "todo", "doing", "review", "done", "dropped")
MAX_CHILDREN = 3
AUTOPILOT_LOG_MAX = 2000
_ID_RE = re.compile(r"^[Tt]-(\d+)$")
_TICKET_FILE_RE = re.compile(r"^T-(\d+)\.json$")

_MIGRATION_MARKER = "legacy_migrated"
CONFIG_MARKER = "config_imported"
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

_PIPELINE_SCHEMA = (
    """CREATE TABLE IF NOT EXISTS pipeline_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket TEXT,
        repo TEXT,
        worktree TEXT,
        branch TEXT,
        head TEXT,
        trigger TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at INTEGER,
        duration_ms INTEGER,
        reason TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS pipeline_runs_ticket ON pipeline_runs(ticket)",
    "CREATE INDEX IF NOT EXISTS pipeline_runs_trigger ON pipeline_runs(trigger)",
    "CREATE INDEX IF NOT EXISTS pipeline_runs_state ON pipeline_runs(state)",
    """CREATE TABLE IF NOT EXISTS pipeline_steps (
        run INTEGER NOT NULL,
        position INTEGER NOT NULL,
        name TEXT,
        command TEXT,
        state TEXT,
        duration_ms INTEGER,
        exit_code INTEGER,
        stdout TEXT,
        stderr TEXT,
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
        data BLOB,
        mime TEXT,
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
    """CREATE TABLE IF NOT EXISTS read_models (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS autopilot_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        line TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS prompts (
        path TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS templates (
        name TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )""",
    *_FLOW_SCHEMA,
    *_PIPELINE_SCHEMA,
)


# ---------------------------------------------------------------- Pfade


def home():
    raw = os.environ.get("FAB_HOME")
    if os.environ.get("FAB_TEST_GUARD"):
        # Tests dürfen niemals auf das Standard-Home fallen: dort liegen die
        # echten Daten des Menschen.
        if not raw:
            raise FabError(
                "Test ohne FAB_HOME: Fabric-Tests brauchen ein temporäres "
                "FAB_HOME unter dem Temp-Ordner"
            )
        resolved = os.path.realpath(os.path.abspath(os.path.expanduser(raw)))
        roots = {
            os.path.realpath(tempfile.gettempdir()),
            os.path.realpath("/tmp"),
            os.path.realpath("/private/tmp"),
            os.path.realpath("/var/folders"),
            os.path.realpath("/private/var/folders"),
        }
        if os.environ.get("FAB_TEST_ROOT"):
            roots.add(os.path.realpath(os.environ["FAB_TEST_ROOT"]))
        if not any(
            resolved == root or resolved.startswith(root + os.sep)
            for root in roots
        ):
            raise FabError(
                "Test-FAB_HOME muss unter einem Temp-Ordner liegen, "
                f"nicht {resolved}"
            )
    raw = raw or DEFAULT_HOME
    return os.path.abspath(os.path.expanduser(raw))


def tickets_dir():
    return os.path.join(home(), "tickets")


def counter_path():
    return os.path.join(home(), "counter")


def events_path():
    return os.path.join(home(), "events.jsonl")


def lock_path():
    return os.path.join(home(), "lock")


def holder_path():
    return lock_path() + ".holder"


def db_path():
    return os.path.join(home(), "fabric.db")


def legacy_dir():
    return os.path.join(home(), "legacy")


def backups_dir():
    return os.path.join(home(), "backups")


def attachments_dir(tid=None):
    """Ablage der Altdateien; nur noch die Migration liest von hier."""
    base = os.path.join(home(), "attachments")
    return os.path.join(base, tid) if tid else base


def cache_dir():
    return os.path.join(home(), "cache")


def now_ms():
    return clock.now_ms()


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
_fallback = set()       # home -> Migration/Upgrade scheiterte; ensure meldet den Fehler
_bootstrapped = set()   # home -> Bootstrap einmal versucht
_upgrading = 0          # Datei-Upgrade läuft; ensure nicht erneut anfordern
_bootstrapping = 0      # Migration hält den flock; kein zweites Mal anfordern
_deferred_events = None # aktiver Puffer für Ereignisse, die ein CAS verwerfen darf


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
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    if str(mode).lower() != "wal":
        conn.execute("PRAGMA journal_mode=WAL")
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(comments)")}
    if "data" not in columns:
        try:
            conn.execute("ALTER TABLE comments ADD COLUMN data TEXT")
        except sqlite3.OperationalError:
            pass
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    # Lesemodelle und Autopilotlog kamen mit Schema 4; bestehende Datenbanken
    # bekommen sie beim ersten Öffnen, ohne ihre Daten zu verlieren.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS read_models ("
        "key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS autopilot_log ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, "
        "line TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS config ("
        "key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS prompts ("
        "path TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS templates ("
        "name TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    )
    attachment_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(attachments)")
    }
    for column, kind in (("data", "BLOB"), ("mime", "TEXT")):
        if column not in attachment_columns:
            try:
                conn.execute(f"ALTER TABLE attachments ADD COLUMN {column} {kind}")
            except sqlite3.OperationalError:
                pass
    if version < _SCHEMA_VERSION:
        for statement in _FLOW_SCHEMA:
            conn.execute(statement)
        for statement in _PIPELINE_SCHEMA:
            conn.execute(statement)
        conn.execute(f"PRAGMA user_version={_SCHEMA_VERSION}")
    # T-127: Abbruchgrund je Lauf; bestehende Datenbanken bekommen die Spalte
    # wie `comments.data` per `ALTER TABLE` und behalten ihre Läufe.
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(pipeline_runs)")}
    if columns and "reason" not in columns:
        try:
            conn.execute("ALTER TABLE pipeline_runs ADD COLUMN reason TEXT")
        except sqlite3.OperationalError:
            pass
    _conn = conn
    _conn_home = current
    return conn


def _lock_timeout():
    """Zeitlimit für den flock aus `FAB_LOCK_TIMEOUT` (Sekunden, >= 0)."""
    raw = os.environ.get("FAB_LOCK_TIMEOUT")
    if raw is None or not str(raw).strip():
        return LOCK_TIMEOUT_DEFAULT
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return LOCK_TIMEOUT_DEFAULT
    return value if value >= 0 else LOCK_TIMEOUT_DEFAULT


def _holder_command():
    command = " ".join(sys.argv).strip() or "fab"
    return command[:120]


def _write_holder():
    """Halterinformation neben dem Lock hinterlegen (atomar)."""
    payload = {
        "pid": os.getpid(),
        "command": _holder_command(),
        "started": time.time(),
    }
    atomic_write(holder_path(), _json_line(payload))


def _read_holder():
    try:
        with open(holder_path(), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    pid = data.get("pid")
    if not isinstance(pid, int):
        return None
    command = data.get("command")
    if not isinstance(command, str) or not command:
        command = "fab"
    try:
        started = float(data.get("started"))
    except (TypeError, ValueError):
        started = None
    return {"pid": pid, "command": command, "started": started}


def _clear_holder():
    try:
        os.unlink(holder_path())
    except OSError:
        pass


def _lock_busy_text():
    holder = _read_holder()
    if holder is None:
        return "fabric-Lock gesperrt (Halter unbekannt)"
    age = 0
    if holder["started"] is not None:
        age = max(0, int(time.time() - holder["started"]))
    return (
        f"fabric-Lock gesperrt von PID {holder['pid']} "
        f"({holder['command']}) seit {age} s"
    )


def _acquire(handle, timeout=None):
    """flock mit Zeitlimit; schreibt bei Erfolg die Halterinformation."""
    limit = _lock_timeout() if timeout is None else float(timeout)
    if limit < 0:
        limit = 0.0
    deadline = time.monotonic() + limit
    while True:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if exc.errno not in (errno.EACCES, errno.EAGAIN):
                raise
            if time.monotonic() >= deadline:
                raise FabError(_lock_busy_text()) from None
            time.sleep(0.05)
        else:
            _write_holder()
            return


@contextlib.contextmanager
def _flock():
    """Bootstrap-/Migrations-Lock; nicht reentrant, nie innerhalb von `locked()`.

    Wie `locked()` wartet auch die Migration nur `FAB_LOCK_TIMEOUT` und meldet
    danach den Halter aus `lock.holder`, statt unbegrenzt zu blockieren.
    """
    os.makedirs(home(), exist_ok=True)
    handle = open(lock_path(), "a+", encoding="utf-8")
    try:
        _acquire(handle)
        try:
            yield
        finally:
            _clear_holder()
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


_LEGACY_FILES = (
    "counter",
    "events.jsonl",
    "index.json",
    "herdr.json",
    "autopilot.json",
    "autopilot.log",
    "autopilot-pause",
    "tick-off",
)


def _legacy_files_present():
    """Liegen noch Altdateien im Datenordner (Migration oder Datei-Upgrade)?"""
    if any(os.path.exists(os.path.join(home(), name)) for name in _LEGACY_FILES):
        return True
    folder = tickets_dir()
    if os.path.isdir(folder):
        return any(_TICKET_FILE_RE.match(name) for name in os.listdir(folder))
    return False


def ensure():
    """Verzeichnisse anlegen, DB aufbauen und Altdateien einmalig übernehmen."""
    _sync_home()
    current = home()
    os.makedirs(current, exist_ok=True)
    if current in _fallback:
        raise FabError(f"Fabric-Datenbank nicht verfügbar: {db_path()}")
    if os.path.exists(db_path()):
        if not (_upgrading or _bootstrapping or in_transaction()):
            _upgrade_legacy_files()
        return
    if current in _bootstrapped:
        return
    _bootstrapped.add(current)
    with _flock():
        if os.path.exists(db_path()):
            return
        if _legacy_files_present():
            report = _migrate_locked(force=True)
        else:
            _install_empty_db()
            report = None
        if report is not None and report["status"] == "failed":
            _fallback.add(current)
    if current in _fallback:
        raise FabError(
            "Migration nach SQLite fehlgeschlagen: "
            f"{report['error'] if report else 'unbekannter Fehler'}"
        )


def _install_empty_db():
    fd, tmp = tempfile.mkstemp(dir=home(), prefix=".fabric-", suffix=".db")
    os.close(fd)
    try:
        from . import prompts as prompts_mod
        from . import templates as templates_mod

        conn = sqlite3.connect(tmp, isolation_level=None)
        try:
            for statement in _SCHEMA:
                conn.execute(statement)
            conn.execute(f"PRAGMA user_version={_SCHEMA_VERSION}")
            at = now_ms()
            for key, text in prompts_mod.DEFAULTS.items():
                conn.execute(
                    "INSERT INTO prompts(path,text,updated_at) VALUES (?,?,?)",
                    (key, text, at),
                )
            for name, text in templates_mod.DEFAULTS.items():
                conn.execute(
                    "INSERT INTO templates(name,text,updated_at) VALUES (?,?,?)",
                    (name, text, at),
                )
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
def locked(timeout=None):
    """Exklusiver flock; im selben Prozess reentrant, äußerste Ebene = Transaktion."""
    global _lock_depth, _lock_handle, _tx_open

    ensure()
    if _lock_depth:
        _lock_depth += 1
        try:
            yield
        finally:
            _lock_depth -= 1
        return

    handle = open(lock_path(), "a+", encoding="utf-8")
    try:
        _acquire(handle, timeout)
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
            _flush_read_models()
            conn.execute("COMMIT")
            _tx_open = False
        except PersistError:
            _tx_open = False
            conn.execute("COMMIT")
            conn.execute("BEGIN IMMEDIATE")
            _flush_read_models()
            conn.execute("COMMIT")
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
    _clear_holder()
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
    """Von `index.rebuild()` aufgerufen: Lesemodell in der Transaktion vormerken."""
    global _pending_index, _index_dirty
    if in_transaction():
        _pending_index = payload
        _index_dirty = True
        return
    with _auto_tx():
        _pending_index = payload
        _index_dirty = True


REV_META_KEY = "rev"


def _bump_rev(conn):
    """`meta.rev` in derselben Transaktion fortschreiben; Rückgabe: neuer Wert."""
    row = conn.execute("SELECT value FROM meta WHERE key='rev'").fetchone()
    try:
        value = int(row["value"]) if row is not None else 0
    except (TypeError, ValueError):
        value = 0
    value += 1
    conn.execute(
        "INSERT INTO meta(key,value) VALUES ('rev',?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(value),),
    )
    return value


def rev():
    """Aktueller Stand von `meta.rev`; Mods pollen ihn zum Neuladen."""
    ensure()
    try:
        return int(meta_get(REV_META_KEY) or 0)
    except (TypeError, ValueError):
        return 0


def _reviewer():
    reviewer = "ada"
    try:
        from . import agents

        roster = agents.load(required=False)
        if roster:
            reviewer = str(roster.get("reviewer") or "ada")
    except FabError:
        pass
    return reviewer


def _model_write(conn, key, text):
    conn.execute(
        "INSERT INTO read_models(key,value,updated_at) VALUES (?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
        "updated_at=excluded.updated_at",
        (key, text, now_ms()),
    )


def ticket_model_key(tid):
    return f"ticket:{tid}"


def read_model(key, default=None):
    """Rohes Lesemodell (JSON-Text) aus `read_models`."""
    ensure()
    row = _connect().execute(
        "SELECT value FROM read_models WHERE key=?", (key,)
    ).fetchone()
    return row["value"] if row is not None else default


def read_model_json(key, default=None):
    raw = read_model(key)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except ValueError:
        return default


def _flush_read_models():
    """Lesemodelle und `meta.rev` in der laufenden Transaktion fortschreiben."""
    if not (_dirty_tickets or _index_dirty or _pending_index is not None):
        return
    conn = _connect()
    reviewer = _reviewer()
    for tid in sorted(_dirty_tickets, key=_number_of):
        _write_model(conn, load(tid), reviewer)
    payload = _pending_index
    if payload is None and _index_dirty:
        from . import index as index_mod

        payload = index_mod.build()
    if payload is not None:
        _model_write(conn, "index", _json_line(payload))
    _bump_rev(conn)


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


def _ticket_model(ticket, reviewer="ada"):
    """Lesemodell: Kosten bleiben gespeichert, Liegezeiten und Anhang-Cache kommen dazu."""
    from . import costs

    model = dict(ticket)
    model["waits"] = costs.waits(
        ticket, event_rows_for(ticket["id"]), reviewer
    )
    attachments = attachment_models(ticket["id"])
    if attachments:
        model["attachments"] = attachments
    return model


def _write_model(conn, ticket, reviewer="ada"):
    model = _ticket_model(ticket, reviewer)
    _model_write(
        conn, ticket_model_key(ticket["id"]), _ticket_text(model)
    )


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
    existing = {
        row["name"]: dict(row)
        for row in conn.execute(
            "SELECT position,name,data,mime FROM attachments WHERE ticket=?", (tid,)
        )
    }
    conn.execute("DELETE FROM attachments WHERE ticket=?", (tid,))
    for index, item in _iter_attachments(ticket):
        name = item.get("name")
        previous = existing.get(name) or {}
        position = int(item.get("position") or index)
        conn.execute(
            "INSERT INTO attachments(ticket,position,name,path,at,data,mime) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                tid,
                position,
                name,
                attachment_cache_rel(tid, position, name or "anhang"),
                item.get("at"),
                previous.get("data"),
                previous.get("mime"),
            ),
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
    path = os.path.join(tickets_dir(), f"{tid}.json")
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
    return _load_db(raw_id)


_REVISION_IGNORED = ("comments", "updated_at", "cost", "waits")


def revision(ticket):
    """Stabile SHA-256-Prüfsumme über den maßgeblichen Ticketinhalt.

    Kommentare, `updated_at`, `cost` und `waits` bleiben außen vor: Ein
    parallel geschriebener Kommentar oder eine nachgeführte Kosten-/Liegezeit
    darf keinen CAS-Konflikt auslösen. Feldänderungen (Status, Branch,
    Zuständiger, `accept` usw.) ändern die Revision weiterhin.
    """
    material = {
        key: value
        for key, value in ticket.items()
        if key not in _REVISION_IGNORED
    }
    canonical = json.dumps(
        material, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


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


def save(ticket, touch=True):
    ensure()
    with _auto_tx():
        _save_db(ticket, touch)


def next_id():
    """Nächste ID aus `counter`; innerhalb der laufenden Transaktion."""
    ensure()
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
    conn = _connect()
    return [
        _ticket_from_row(conn, row)
        for row in conn.execute("SELECT * FROM tickets ORDER BY number")
    ]


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
    conn = _connect()
    sql = f"SELECT * FROM tickets WHERE {_QUERIES[mode]} ORDER BY number"
    return [_ticket_from_row(conn, row) for row in conn.execute(sql)]


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


def _insert_event(conn, row):
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


@contextlib.contextmanager
def deferred_events():
    """Ereignisse sammeln, damit ein CAS-Konflikt sie verwerfen kann."""
    global _deferred_events

    _deferred_events = []
    try:
        yield _deferred_events
    finally:
        _deferred_events = None


def flush_deferred_events():
    """Gepufferte Ereignisse in die laufende Transaktion schreiben."""
    global _index_dirty

    buffer = _deferred_events
    if buffer is None:
        return
    if not buffer:
        return
    conn = _connect()
    for row in buffer:
        _insert_event(conn, row)
        _index_dirty = True
    buffer[:] = []


def discard_deferred_events():
    """Gepufferte Ereignisse verwerfen."""
    if _deferred_events is not None:
        _deferred_events[:] = []


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
    if _deferred_events is not None:
        _deferred_events.append(row)
        return row
    ensure()
    global _index_dirty
    with _auto_tx():
        conn = _connect()
        _insert_event(conn, row)
        _index_dirty = True
    return row


def event_rows(limit=None):
    ensure()
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
    rows = _connect().execute(
        "SELECT * FROM events WHERE ticket=? OR ticket='' ORDER BY id", (tid,)
    ).fetchall()
    return [_event_dict(row) for row in rows]


def event_rows_for_ticket(tid, kind=None):
    """Nur Ereignisse dieses Tickets (optional einer Art), über events_ticket."""
    ensure()
    tid = normalize_id(tid)
    if kind is None:
        rows = _connect().execute(
            "SELECT * FROM events WHERE ticket=? ORDER BY id", (tid,)
        ).fetchall()
    else:
        rows = _connect().execute(
            "SELECT * FROM events WHERE ticket=? AND kind=? ORDER BY id",
            (tid, kind),
        ).fetchall()
    return [_event_dict(row) for row in rows]


def event_has_text(ticket, text):
    ensure()
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
    row = _connect().execute("SELECT COALESCE(MAX(id),0) FROM events").fetchone()
    return int(row[0])


def event_clear():
    ensure()
    global _index_dirty
    with _auto_tx():
        _connect().execute("DELETE FROM events")
        _index_dirty = True


# ---------------------------------------------------------------- Metadaten


def meta_get(key, default=None):
    ensure()
    row = _connect().execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row is not None else default


def meta_set(key, value):
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute(
            "INSERT INTO meta(key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )
        if key in REV_KEYS:
            _index_dirty = True
            _bump_rev(conn)


def meta_delete(key):
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute("DELETE FROM meta WHERE key=?", (key,))
        if key in REV_KEYS:
            _index_dirty = True
            _bump_rev(conn)


TICK_ALARM_MS = 5 * 60 * 1000


def last_tick():
    """Zeitpunkt des letzten `fab tick` in Millisekunden, sonst `None`."""
    try:
        return int(meta_get("last_tick"))
    except (TypeError, ValueError):
        return None


def set_last_tick(at=None):
    meta_set("last_tick", now_ms() if at is None else int(at))


TICK_OFF_KEY = "tick_off"
AUTOPILOT_KEY = "autopilot"
AUTOPILOT_PAUSE_KEY = "autopilot_pause"
REV_KEYS = (AUTOPILOT_KEY, AUTOPILOT_PAUSE_KEY, TICK_OFF_KEY)


def tick_disabled():
    """Wächter absichtlich aus? Marke `meta.tick_off` statt der alten Datei."""
    ensure()
    return meta_get(TICK_OFF_KEY) is not None


def set_tick_off(value="1"):
    meta_set(TICK_OFF_KEY, value or "1")


def clear_tick_off():
    meta_delete(TICK_OFF_KEY)


ROSTER_CONFIG_KEY = "roster"


def roster_set(data):
    """Roster als JSON in die Konfiguration schreiben."""
    config_set(
        ROSTER_CONFIG_KEY,
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
    )


def config_export():
    """Roster, Prompts und Vorlagen der aktuellen DB als Daten (für die Vorschau)."""
    ensure()
    conn = _connect()
    roster = conn.execute("SELECT value FROM config WHERE key='roster'").fetchone()
    return {
        "roster": roster[0] if roster else None,
        "prompts": {row[0]: row[1] for row in conn.execute("SELECT path, text FROM prompts")},
        "templates": {row[0]: row[1] for row in conn.execute("SELECT name, text FROM templates")},
    }


def config_import(data):
    """Gegenstück zu `config_export`: Einträge in die aktuelle DB schreiben."""
    ensure()
    stamp = now_ms()
    with _auto_tx():
        conn = _connect()
        if data.get("roster"):
            conn.execute(
                "INSERT INTO config(key,value,updated_at) VALUES ('roster',?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (data["roster"], stamp),
            )
        for path, text in (data.get("prompts") or {}).items():
            conn.execute(
                "INSERT INTO prompts(path,text,updated_at) VALUES (?,?,?) "
                "ON CONFLICT(path) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at",
                (path, text, stamp),
            )
        for name, text in (data.get("templates") or {}).items():
            conn.execute(
                "INSERT INTO templates(name,text,updated_at) VALUES (?,?,?) "
                "ON CONFLICT(name) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at",
                (name, text, stamp),
            )
        conn.execute(
            "INSERT INTO meta(key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (CONFIG_MARKER, "1"),
        )
        _bump_rev(conn)


def config_get(key, default=None):
    """Rohtext aus der Konfiguration (etwa `roster` als JSON)."""
    ensure()
    row = _connect().execute(
        "SELECT value FROM config WHERE key=?", (key,)
    ).fetchone()
    return row["value"] if row is not None else default


def config_set(key, value):
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute(
            "INSERT INTO config(key,value,updated_at) VALUES (?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
            "updated_at=excluded.updated_at",
            (key, str(value), now_ms()),
        )
        _index_dirty = True
        _bump_rev(conn)


def config_delete(key):
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute("DELETE FROM config WHERE key=?", (key,))
        _index_dirty = True
        _bump_rev(conn)


def prompt_get(path, default=None):
    ensure()
    row = _connect().execute(
        "SELECT text FROM prompts WHERE path=?", (path,)
    ).fetchone()
    return row["text"] if row is not None else default


def prompt_set(path, text):
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute(
            "INSERT INTO prompts(path,text,updated_at) VALUES (?,?,?) "
            "ON CONFLICT(path) DO UPDATE SET text=excluded.text, "
            "updated_at=excluded.updated_at",
            (path, text, now_ms()),
        )
        _index_dirty = True
        _bump_rev(conn)


def prompt_delete(path):
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute("DELETE FROM prompts WHERE path=?", (path,))
        _index_dirty = True
        _bump_rev(conn)


def prompt_paths():
    ensure()
    return [
        row["path"]
        for row in _connect().execute("SELECT path FROM prompts ORDER BY path")
    ]


def template_get(name, default=None):
    ensure()
    row = _connect().execute(
        "SELECT text FROM templates WHERE name=?", (name,)
    ).fetchone()
    return row["text"] if row is not None else default


def template_names():
    ensure()
    return [
        row["name"]
        for row in _connect().execute("SELECT name FROM templates ORDER BY name")
    ]


def template_set(name, text):
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute(
            "INSERT INTO templates(name,text,updated_at) VALUES (?,?,?) "
            "ON CONFLICT(name) DO UPDATE SET text=excluded.text, "
            "updated_at=excluded.updated_at",
            (name, text, now_ms()),
        )
        _index_dirty = True
        _bump_rev(conn)


def template_delete(name):
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute("DELETE FROM templates WHERE name=?", (name,))
        _index_dirty = True
        _bump_rev(conn)


def autopilot_log_append(line, at=None):
    """Zeile ins Autopilotlog; hält die neuesten `AUTOPILOT_LOG_MAX` Zeilen."""
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute(
            "INSERT INTO autopilot_log(at,line) VALUES (?,?)",
            (now_ms() if at is None else int(at), str(line)),
        )
        conn.execute(
            "DELETE FROM autopilot_log WHERE id NOT IN ("
            "SELECT id FROM autopilot_log ORDER BY id DESC LIMIT ?)",
            (AUTOPILOT_LOG_MAX,),
        )
        _index_dirty = True
        _bump_rev(conn)


def autopilot_log_rows(limit=None, offset=0):
    """Logzeilen in Reihenfolge des Schreibens (älteste zuerst)."""
    ensure()
    conn = _connect()
    if limit is None:
        rows = conn.execute(
            "SELECT id,at,line FROM autopilot_log ORDER BY id"
        ).fetchall()
    else:
        if limit <= 0:
            return []
        rows = conn.execute(
            "SELECT id,at,line FROM autopilot_log "
            "ORDER BY id DESC LIMIT ? OFFSET ?",
            (int(limit), max(0, int(offset))),
        ).fetchall()
        rows = list(reversed(rows))
    return [{"id": row["id"], "at": row["at"], "line": row["line"]} for row in rows]


def autopilot_log_text(limit=200):
    """Log als Text; die neuesten `limit` Zeilen, älteste zuerst."""
    return "".join(row["line"] + "\n" for row in autopilot_log_rows(limit))


def autopilot_log_clear():
    global _index_dirty
    ensure()
    with _auto_tx():
        conn = _connect()
        conn.execute("DELETE FROM autopilot_log")
        _index_dirty = True
        _bump_rev(conn)


def tick_alarm(now=None, limit_ms=TICK_ALARM_MS):
    """Alarmzustand des Wächters: stale, sobald der letzte Tick zu alt ist.

    Ein absichtlich abgeschalteter Wächter ist nie stale.
    """
    last = last_tick()
    if last is None or tick_disabled():
        return {
            "last_tick": last,
            "age_ms": None,
            "limit_ms": limit_ms,
            "stale": False,
        }
    current = now_ms() if now is None else int(now)
    age = max(0, current - last)
    return {
        "last_tick": last,
        "age_ms": age,
        "limit_ms": limit_ms,
        "stale": age > limit_ms,
    }


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


# ---------------------------------------------------------------- Pipelines


_RUN_COLUMNS_PIPELINE = (
    "id,ticket,repo,worktree,branch,head,trigger,state,started_at,duration_ms,reason"
)

_STEP_COLUMNS_PIPELINE = (
    "run,position,name,command,state,duration_ms,exit_code,stdout,stderr"
)


def _pipeline_run_dict(row):
    return {
        "id": row["id"],
        "ticket": row["ticket"],
        "repo": row["repo"],
        "worktree": row["worktree"],
        "branch": row["branch"],
        "head": row["head"],
        "trigger": row["trigger"],
        "state": row["state"],
        "started_at": row["started_at"],
        "duration_ms": row["duration_ms"],
        "reason": row["reason"] or "",
    }


def _pipeline_step_dict(row):
    return {
        "run": row["run"],
        "position": row["position"],
        "name": row["name"],
        "command": row["command"],
        "state": row["state"],
        "duration_ms": row["duration_ms"],
        "exit_code": row["exit_code"],
        "stdout": row["stdout"],
        "stderr": row["stderr"],
    }


def pipeline_run_new(
    *, trigger, ticket=None, repo="", worktree="", branch="", head="", state="running"
):
    ensure()
    at = now_ms()
    with _auto_tx():
        cursor = _connect().execute(
            "INSERT INTO pipeline_runs("
            "ticket,repo,worktree,branch,head,trigger,state,started_at,duration_ms) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (ticket, repo, worktree, branch, head, trigger, state, at, 0),
        )
        return int(cursor.lastrowid)


def pipeline_run_start(run_id):
    """Einen vorgemerkten Lauf (`queued`) als `running` markieren."""
    ensure()
    with _auto_tx():
        _connect().execute(
            "UPDATE pipeline_runs SET state='running' WHERE id=?", (run_id,)
        )


def pipeline_run_finish(run_id, state, duration_ms, reason=""):
    """Lauf beenden und optional den Abbruchgrund (T-127) speichern."""
    ensure()
    with _auto_tx():
        _connect().execute(
            "UPDATE pipeline_runs SET state=?, duration_ms=?, reason=? WHERE id=?",
            (state, duration_ms, reason or "", run_id),
        )


def pipeline_run_finish_if_open(run_id, state, duration_ms, reason=""):
    """Einen noch offenen Lauf beenden; True, wenn er offen war.

    Die Bedingung steht im UPDATE, damit ein zwischenzeitlich fertig
    gewordener Lauf nicht überschrieben wird. Der Grund bleibt bei einem
    bereits beendeten Lauf unangetastet.
    """
    ensure()
    with _auto_tx():
        cursor = _connect().execute(
            "UPDATE pipeline_runs SET state=?, duration_ms=?, reason=? "
            "WHERE id=? AND state IN ('queued','running')",
            (state, duration_ms, reason or "", run_id),
        )
        return cursor.rowcount > 0


def pipeline_run_load(run_id):
    ensure()
    row = _connect().execute(
        f"SELECT {_RUN_COLUMNS_PIPELINE} FROM pipeline_runs WHERE id=?", (run_id,)
    ).fetchone()
    return _pipeline_run_dict(row) if row is not None else None


def pipeline_run_list(ticket=None):
    ensure()
    conn = _connect()
    if ticket is None:
        rows = conn.execute(
            f"SELECT {_RUN_COLUMNS_PIPELINE} FROM pipeline_runs ORDER BY id"
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {_RUN_COLUMNS_PIPELINE} FROM pipeline_runs "
            "WHERE ticket=? ORDER BY id",
            (ticket,),
        ).fetchall()
    return [_pipeline_run_dict(row) for row in rows]


def pipeline_step_add(
    run_id,
    position,
    name,
    command,
    state,
    duration_ms=None,
    exit_code=None,
    stdout="",
    stderr="",
):
    ensure()
    with _auto_tx():
        _connect().execute(
            "INSERT INTO pipeline_steps("
            "run,position,name,command,state,duration_ms,exit_code,stdout,stderr) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                run_id,
                position,
                name,
                command,
                state,
                duration_ms,
                exit_code,
                stdout,
                stderr,
            ),
        )


_PIPELINE_STEP_FIELDS = ("state", "duration_ms", "exit_code", "stdout", "stderr")


def pipeline_step_update(run_id, position, **fields):
    unknown = set(fields) - set(_PIPELINE_STEP_FIELDS)
    if unknown:
        raise ValueError(
            "Unbekannte Schrittfelder: " + ", ".join(sorted(unknown))
        )
    ensure()
    if not fields:
        return
    assignments = ", ".join(f"{name}=?" for name in fields)
    values = [fields[name] for name in fields]
    with _auto_tx():
        _connect().execute(
            f"UPDATE pipeline_steps SET {assignments} WHERE run=? AND position=?",
            (*values, run_id, position),
        )


def pipeline_step_transition(run_id, position, source, target):
    """Schritt nur umstellen, wenn er noch `source` ist; False sonst.

    Die Bedingung steht im UPDATE, damit ein zwischenzeitlich fertig
    geschriebener Schritt nicht überschrieben wird.
    """
    ensure()
    with _auto_tx():
        cursor = _connect().execute(
            "UPDATE pipeline_steps SET state=? "
            "WHERE run=? AND position=? AND state=?",
            (target, run_id, position, source),
        )
        return cursor.rowcount > 0


def pipeline_steps(run_id):
    ensure()
    rows = _connect().execute(
        f"SELECT {_STEP_COLUMNS_PIPELINE} FROM pipeline_steps "
        "WHERE run=? ORDER BY position",
        (run_id,),
    ).fetchall()
    return [_pipeline_step_dict(row) for row in rows]


# ---------------------------------------------------------------- Anhänge


CACHE_PREFIX = "data/fabric/cache/attachments"


def attachment_cache_rel(tid, position, name):
    """Pfad, den UI und Prompt nennen: relativ zum App-Home."""
    return f"{CACHE_PREFIX}/{tid}/{int(position)}-{name}"


def attachment_cache_abs(tid, position, name):
    """Tatsächlicher Ablageort im Wegwerf-Cache unter `$FAB_HOME`."""
    return os.path.join(
        cache_dir(), "attachments", tid, f"{int(position)}-{name}"
    )


def _mime(name):
    import mimetypes

    guessed, _encoding = mimetypes.guess_type(name or "")
    return guessed or "application/octet-stream"


def _materialize(tid, position, name, data):
    """Cache-Datei bei Bedarf schreiben; Rückgabe: relativer Pfad."""
    rel = attachment_cache_rel(tid, position, name)
    if data is None:
        return rel
    path = attachment_cache_abs(tid, position, name)
    try:
        if os.path.isfile(path) and os.path.getsize(path) == len(data):
            return rel
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(bytes(data))
    except OSError as exc:
        raise FabError(f"Anhang-Cache nicht schreibbar: {exc}")
    return rel


_ATTACHMENT_COLUMNS = "position,name,path,at,mime,data"


def attachment_rows(tid):
    """Alle Anhänge eines Tickets mit Bytes, in Positionsreihenfolge."""
    ensure()
    tid = normalize_id(tid)
    rows = _connect().execute(
        f"SELECT {_ATTACHMENT_COLUMNS} FROM attachments "
        "WHERE ticket=? ORDER BY position",
        (tid,),
    ).fetchall()
    return [
        {
            "position": row["position"],
            "name": row["name"],
            "at": row["at"],
            "mime": row["mime"] or _mime(row["name"]),
            "data": row["data"],
        }
        for row in rows
    ]


def attachment_models(tid, materialize=True):
    """Lesemodell-Einträge der Anhänge inklusive `cache_path`."""
    models = []
    for row in attachment_rows(tid):
        rel = (
            _materialize(tid, row["position"], row["name"], row["data"])
            if materialize
            else attachment_cache_rel(tid, row["position"], row["name"])
        )
        models.append(
            {
                "name": row["name"],
                "position": row["position"],
                "path": rel,
                "cache_path": rel,
                "at": row["at"],
                "mime": row["mime"],
            }
        )
    return models


def attachment_materialize(tid, position=None):
    """Cache schreiben (nur fehlende Dateien) und Pfade zurückgeben."""
    models = attachment_models(tid)
    if position is None:
        return models
    number = int(position)
    for row in models:
        if row["cache_path"].endswith(f"/{number}-{row['name']}"):
            return row
    raise FabError(f"Ticket {tid} hat keinen Anhang an Position {position}")


def _unique_name(conn, tid, wanted):
    stem, suffix = os.path.splitext(wanted or "bild")
    name = wanted or "bild"
    counter = 2
    while conn.execute(
        "SELECT 1 FROM attachments WHERE ticket=? AND name=?", (tid, name)
    ).fetchone() is not None:
        name = f"{stem}-{counter}{suffix}"
        counter += 1
    return name


def attachment_add(source, tid, wanted_name, dedupe=True):
    """Bild in die DB legen; liefert (Name, relativer `cache_path`)."""
    ensure()
    tid = normalize_id(tid)
    try:
        with open(source, "rb") as handle:
            data = handle.read()
    except OSError as exc:
        raise FabError(f"Datei nicht lesbar: {source}: {exc}")
    with _auto_tx():
        conn = _connect()
        if dedupe:
            existing = conn.execute(
                "SELECT position,name FROM attachments WHERE ticket=? AND data=?",
                (tid, data),
            ).fetchone()
            if existing is not None:
                name = existing["name"]
                rel = _materialize(tid, existing["position"], name, data)
                _dirty_tickets.add(tid)
                return name, rel
        name = _unique_name(conn, tid, wanted_name)
        row = conn.execute(
            "SELECT COALESCE(MAX(position),0)+1 FROM attachments WHERE ticket=?",
            (tid,),
        ).fetchone()
        position = int(row[0])
        rel = attachment_cache_rel(tid, position, name)
        conn.execute(
            "INSERT INTO attachments(ticket,position,name,path,at,data,mime) "
            "VALUES (?,?,?,?,?,?,?)",
            (tid, position, name, rel, now_ms(), sqlite3.Binary(data), _mime(name)),
        )
        _dirty_tickets.add(tid)
    return name, rel


# ---------------------------------------------------------------- Backup


_BACKUP_NAME = re.compile(r"^fabric-(\d{8}-\d{6}-\d{6})(?:-(\d+))?\.db$")


def _backup_order(path):
    """Erzeugungsreihenfolge: gleicher Stempel, Basis = 1, dann -2, -3, ..."""
    name = os.path.basename(path)
    match = _BACKUP_NAME.match(name)
    if match:
        return (match.group(1), int(match.group(2) or 1))
    return (name, 0)


def backup_files():
    folder = backups_dir()
    if not os.path.isdir(folder):
        return []
    names = [
        name
        for name in os.listdir(folder)
        if name.startswith("fabric-") and name.endswith(".db")
    ]
    return [os.path.join(folder, name) for name in sorted(names, key=_backup_order)]


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
    os.makedirs(backups_dir(), exist_ok=True)
    stamp = datetime.fromtimestamp(now_ms() / 1000).strftime("%Y%m%d-%H%M%S-%f")
    target = os.path.join(backups_dir(), f"fabric-{stamp}.db")
    suffix = 2
    while os.path.exists(target):
        target = os.path.join(backups_dir(), f"fabric-{stamp}-{suffix}.db")
        suffix += 1
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
    today = datetime.fromtimestamp(now_ms() / 1000).date().isoformat()
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


def _read_legacy_autopilot():
    """Altdateien des Autopiloten: Status, Logzeilen, Pause und Wächtermarke."""
    state = None
    path = os.path.join(home(), "autopilot.json")
    try:
        with open(path, encoding="utf-8") as handle:
            parsed = json.load(handle)
        if isinstance(parsed, dict):
            state = parsed
    except (OSError, ValueError):
        state = None
    lines = []
    try:
        with open(os.path.join(home(), "autopilot.log"), encoding="utf-8") as handle:
            lines = [line.rstrip("\n") for line in handle if line.strip()]
    except OSError:
        lines = []
    pause = None
    try:
        with open(os.path.join(home(), "autopilot-pause"), encoding="utf-8") as handle:
            pause = handle.read()
    except OSError:
        pause = None
    tick_off = os.path.exists(os.path.join(home(), "tick-off"))
    return state, lines, pause, tick_off


def _import_autopilot(conn):
    """Autopilotstatus, Log und Marken übernehmen, ohne Bestehendes zu überschreiben."""
    state, lines, pause, tick_off = _read_legacy_autopilot()
    if state is not None:
        conn.execute(
            "INSERT INTO meta(key,value) VALUES ('autopilot',?) "
            "ON CONFLICT(key) DO NOTHING",
            (json.dumps(state, ensure_ascii=False),),
        )
    rows = int(conn.execute("SELECT COUNT(*) FROM autopilot_log").fetchone()[0])
    if lines and rows == 0:
        for line in lines[-AUTOPILOT_LOG_MAX:]:
            conn.execute(
                "INSERT INTO autopilot_log(at,line) VALUES (?,?)",
                (now_ms(), line),
            )
    if tick_off:
        conn.execute(
            "INSERT INTO meta(key,value) VALUES ('tick_off','1') "
            "ON CONFLICT(key) DO NOTHING"
        )
    if pause is not None:
        conn.execute(
            "INSERT INTO meta(key,value) VALUES ('autopilot_pause',?) "
            "ON CONFLICT(key) DO NOTHING",
            (pause,),
        )


def _legacy_attachment_file(tid, name):
    for candidate in (
        os.path.join(attachments_dir(tid), name),
    ):
        if os.path.isfile(candidate):
            return candidate
    return None


def _import_legacy_attachments(conn):
    """Vorhandene Dateien unter `attachments/` in die BLOB-Spalte übernehmen."""
    rows = conn.execute(
        "SELECT ticket,position,name,data FROM attachments ORDER BY ticket,position"
    ).fetchall()
    for row in rows:
        if row["data"] is not None:
            continue
        source = _legacy_attachment_file(row["ticket"], row["name"])
        if source is None:
            continue
        try:
            with open(source, "rb") as handle:
                data = handle.read()
        except OSError:
            continue
        conn.execute(
            "UPDATE attachments SET data=?, mime=?, path=? "
            "WHERE ticket=? AND position=?",
            (
                sqlite3.Binary(data),
                _mime(row["name"]),
                attachment_cache_rel(row["ticket"], row["position"], row["name"]),
                row["ticket"],
                row["position"],
            ),
        )


def _legacy_roster_dir():
    """Ordner der Altkonfiguration: `FAB_ROSTER`-Pfad oder `<repo>/fabric/`."""
    raw = os.environ.get("FAB_ROSTER")
    if raw:
        path = os.path.abspath(os.path.expanduser(raw))
        return os.path.dirname(path)
    return os.path.dirname(os.path.dirname(os.path.realpath(__file__)))


def _import_legacy_config(conn, folder=None):
    """Roster, Prompts und Vorlagen aus Dateien übernehmen, falls die DB leer ist."""
    from . import prompts

    folder = folder or _legacy_roster_dir()
    roster_file = os.path.join(folder, "roster.json")
    has_roster = conn.execute(
        "SELECT 1 FROM config WHERE key='roster'"
    ).fetchone()
    if has_roster is None and os.path.isfile(roster_file):
        try:
            with open(roster_file, encoding="utf-8") as handle:
                raw = handle.read()
            json.loads(raw)
        except (OSError, ValueError):
            raw = None
        if raw:
            conn.execute(
                "INSERT INTO config(key,value,updated_at) VALUES ('roster',?,?)",
                (raw, now_ms()),
            )
    prompt_dir = os.path.join(folder, "prompts")
    if os.path.isdir(prompt_dir):
        for name in sorted(os.listdir(prompt_dir)):
            if not name.endswith(".md"):
                continue
            path = os.path.join(prompt_dir, name)
            if not os.path.isfile(path):
                continue
            key = f"prompts/{name}"
            if conn.execute(
                "SELECT 1 FROM prompts WHERE path=?", (key,)
            ).fetchone() is not None:
                continue
            try:
                with open(path, encoding="utf-8") as handle:
                    text = handle.read()
            except OSError:
                continue
            conn.execute(
                "INSERT INTO prompts(path,text,updated_at) VALUES (?,?,?)",
                (key, text, now_ms()),
            )
    template_dir = os.path.join(folder, "templates")
    if os.path.isdir(template_dir):
        for name in sorted(os.listdir(template_dir)):
            if not name.endswith(".md"):
                continue
            key = name[:-3]
            if conn.execute(
                "SELECT 1 FROM templates WHERE name=?", (key,)
            ).fetchone() is not None:
                continue
            try:
                with open(os.path.join(template_dir, name), encoding="utf-8") as handle:
                    text = handle.read()
            except OSError:
                continue
            conn.execute(
                "INSERT INTO templates(name,text,updated_at) VALUES (?,?,?)",
                (key, text, now_ms()),
            )
    # Mitgelieferte Prompts/Vorlagen als Untergrenze, wenn die DB nichts hat.
    from . import templates as templates_mod

    for key, text in prompts.DEFAULTS.items():
        if conn.execute(
            "SELECT 1 FROM prompts WHERE path=?", (key,)
        ).fetchone() is None:
            conn.execute(
                "INSERT INTO prompts(path,text,updated_at) VALUES (?,?,?)",
                (key, text, now_ms()),
            )
    for name, text in templates_mod.DEFAULTS.items():
        if conn.execute(
            "SELECT 1 FROM templates WHERE name=?", (name,)
        ).fetchone() is None:
            conn.execute(
                "INSERT INTO templates(name,text,updated_at) VALUES (?,?,?)",
                (name, text, now_ms()),
            )


_MOVE_LEGACY = (
    "tickets",
    "counter",
    "events.jsonl",
    "index.json",
    "herdr.json",
    "autopilot.json",
    "autopilot.log",
    "autopilot-pause",
    "tick-off",
    "attachments",
)


def _move_legacy():
    """Altdateien in `legacy/files-<stempel>/` verschieben; liefert die Namen."""
    names = [
        name for name in _MOVE_LEGACY if os.path.exists(os.path.join(home(), name))
    ]
    if not names:
        return []
    os.makedirs(legacy_dir(), exist_ok=True)
    stamp = datetime.fromtimestamp(now_ms() / 1000).strftime("%Y%m%d-%H%M%S")
    target_dir = os.path.join(legacy_dir(), f"files-{stamp}")
    suffix = 2
    while os.path.exists(target_dir):
        target_dir = os.path.join(legacy_dir(), f"files-{stamp}-{suffix}")
        suffix += 1
    os.makedirs(target_dir)
    moved = []
    for name in names:
        shutil.move(os.path.join(home(), name), os.path.join(target_dir, name))
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
    """Alle Lesemodelle aus der DB neu schreiben und `meta.rev` erhöhen."""
    global _bootstrapping
    previous = _bootstrapping
    _bootstrapping = 1
    try:
        from . import index as index_mod

        conn = _connect()
        conn.execute("BEGIN IMMEDIATE")
        try:
            reviewer = _reviewer()
            rows = conn.execute("SELECT * FROM tickets ORDER BY number").fetchall()
            for row in rows:
                _write_model(conn, _ticket_from_row(conn, row), reviewer)
            payload = index_mod.build()
            _model_write(conn, "index", _json_line(payload))
            _bump_rev(conn)
            conn.execute("COMMIT")
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
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
        _fallback.add(current)
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
        conn.row_factory = sqlite3.Row
        try:
            for statement in _SCHEMA:
                conn.execute(statement)
            conn.execute(f"PRAGMA user_version={_SCHEMA_VERSION}")
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
            _import_autopilot(conn)
            _import_legacy_attachments(conn)
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
        _fallback.add(current)
        return _report("failed", old=old, skipped=skipped, error=str(exc))

    # Ab hier ist die DB die Quelle.
    _fallback.discard(current)
    conn = _connect()
    conn.execute("PRAGMA journal_mode=WAL")
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
    conn.execute("BEGIN IMMEDIATE")
    try:
        _import_legacy_config(conn)
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    _regenerate_all()
    moved = _move_legacy()
    return _report("migrated", old=old, new=new, skipped=skipped, moved=moved)


def _needs_upgrade():
    if _legacy_files_present():
        return True
    if os.path.exists(db_path()):
        conn = _connect()
        if conn.execute(
            "SELECT 1 FROM meta WHERE key=?", (CONFIG_MARKER,)
        ).fetchone() is not None:
            return False
        if conn.execute("SELECT 1 FROM config WHERE key='roster'").fetchone() is None:
            return os.path.isfile(os.path.join(_legacy_roster_dir(), "roster.json"))
    return False


def _upgrade_legacy_files():
    """Altdateien einer bestehenden DB übernehmen und in `legacy/` verschieben."""
    global _upgrading
    if _upgrading or not _needs_upgrade():
        return
    _upgrading += 1
    try:
        with _flock():
            if not _needs_upgrade():
                return
            conn = _connect()
            conn.execute("BEGIN IMMEDIATE")
            try:
                _import_autopilot(conn)
                _import_legacy_attachments(conn)
                _import_legacy_config(conn)
                conn.execute(
                    "INSERT INTO meta(key,value) VALUES (?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (CONFIG_MARKER, "1"),
                )
                conn.execute("COMMIT")
            except BaseException:
                try:
                    conn.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise
            _regenerate_all()
            _move_legacy()
    finally:
        _upgrading -= 1


def migrate(force=False):
    """Altdateien einmalig in SQLite übernehmen; liefert den Bericht."""
    _sync_home()
    current = home()
    os.makedirs(current, exist_ok=True)
    if force:
        _fallback.discard(current)
        _bootstrapped.discard(current)
    with _flock():
        if os.path.exists(db_path()):
            if meta_get(_MIGRATION_MARKER) == "1":
                return _report("already", old=_counts_db(_connect()),
                               new=_counts_db(_connect()))
            return _report("empty", old=_counts_db(_connect()),
                           new=_counts_db(_connect()))
        if not _legacy_files_present():
            return _report("empty")
        report = _migrate_locked(force=force)
        return report


# ---------------------------------------------------------------- Übersicht


def storage_info():
    ensure()
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
