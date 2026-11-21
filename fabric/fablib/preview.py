"""Vorschau-Instanz je Worktree: eigenes Home, eigener Core, eigene Screenshots.

Die Vorschau läuft unter `/tmp/fab-preview/<ID>` und sieht weder das Fenster
noch die echten Ticketdaten des Menschen.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime

from .errors import FabError

APP = "herdr-app"
HC = "hc"
POLL = 0.25
START_TIMEOUT = 30.0
STOP_TIMEOUT = 5.0
CHECK_TIMEOUT = 600
COPY_ITEMS = ("settings.json", "keys.json", "layouts", "mods", "fabric")
FAB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "fab"
)


def root(ticket_id):
    # Bewusst /tmp statt tempfile: unter macOS liegt TMPDIR so tief, dass der
    # Core-Socket-Pfad der Vorschau das Systemlimit überschreitet.
    return os.path.join("/tmp", "fab-preview", str(ticket_id))


def home(ticket_id):
    return os.path.join(root(ticket_id), "home")


def fab_home(ticket_id):
    return os.path.join(home(ticket_id), "data", "fabric")


def state_path(ticket_id):
    return os.path.join(root(ticket_id), "preview.json")


def load_state(ticket_id):
    try:
        with open(state_path(ticket_id), encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, NotADirectoryError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _write_state(ticket_id, state):
    path = state_path(ticket_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False)
    os.replace(temporary, path)


def _pid_alive(pid):
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def is_running(ticket_id):
    state = load_state(ticket_id)
    if not state:
        return False
    if _pid_alive(state.get("pid")):
        return True
    try:
        result = subprocess.run(
            [APP, "status"],
            cwd=state["home"],
            env=environment(state),
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def environment(state):
    """Umgebung der Vorschau: eigenes Home, eigener Core, eigenes Roster.

    Ein geerbtes `HC_TERMINAL_SOCKET` würde die Vorschau an den Core des
    Menschen hängen; es wird deshalb entfernt, damit `HC_SESSION` greift.
    """
    env = dict(os.environ)
    for key in ("HC_TERMINAL_SOCKET", "HC_SCOPE", "HC_TERMINAL_ID"):
        env.pop(key, None)
    roster = os.path.join(state["home"], "fabric", "roster.json")
    if os.path.isfile(roster):
        env["FAB_ROSTER"] = roster
    else:
        env.pop("FAB_ROSTER", None)
    env.update(
        {
            "HOME": state["userhome"],
            "HERDR_APP_HOME": state["home"],
            "FAB_HOME": state["fab_home"],
            "HC_SESSION": state["session"],
        }
    )
    return env


def _session_name(ticket_id):
    # Kurz halten: HC_SESSION steckt im Unix-Socket-Pfad, der auf macOS
    # höchstens 103 Bytes lang sein darf.
    return "fabp-" + re.sub(r"[^a-z0-9]", "-", str(ticket_id).lower())


def _detail(result):
    return (result.stderr or result.stdout).strip() or f"Exit {result.returncode}"


def _terminate(pid, timeout=STOP_TIMEOUT):
    if not _pid_alive(pid):
        return
    try:
        os.kill(int(pid), signal.SIGTERM)
    except (ProcessLookupError, ValueError):
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _pid_alive(pid):
            return
        time.sleep(0.1)
    try:
        os.kill(int(pid), signal.SIGKILL)
    except (ProcessLookupError, ValueError):
        pass


def _copy_worktree(worktree, target):
    for name in COPY_ITEMS:
        source = os.path.join(worktree, name)
        if not os.path.exists(source):
            continue
        destination = os.path.join(target, name)
        if os.path.isdir(source):
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)


def _seed_window(state, page="board"):
    """Erste Ansicht ohne Willkommens-Overlay: gewünschte Fabric-Seite."""
    path = os.path.join(state["home"], "shared.json")
    if os.path.exists(path):
        return
    payload = {
        "frame.welcomed": "finished",
        "layout": "fabric",
        "fabric.route": {"page": page or "board"},
        "fabric.selected": "T-1",
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)


def _seed_metrics(state):
    """Demodaten für Kosten und Liegezeiten; nur im Vorschau-Home."""
    folder = os.path.join(state["fab_home"], "tickets")
    path = os.path.join(folder, "T-1.json")
    if not os.path.isfile(path):
        return
    now = int(time.time() * 1000)
    sessions = [
        {
            "agent": "zap",
            "name": "fab-herdr-app-zap-t-1",
            "terminal": "t1",
            "started_at": now - 3300000,
        },
        {
            "agent": "ada",
            "name": "fab-herdr-app-ada-t-1",
            "terminal": "t2",
            "started_at": now - 1500000,
        },
    ]
    cost = {
        "currency": "USD",
        "total": 0.42,
        "today": 0.42,
        "sessions": [
            {
                "agent": "zap",
                "name": sessions[0]["name"],
                "started_at": sessions[0]["started_at"],
                "cost": 0.31,
                "source": "omp",
                "files": 1,
            },
            {
                "agent": "ada",
                "name": sessions[1]["name"],
                "started_at": sessions[1]["started_at"],
                "cost": 0.11,
                "source": "claude",
                "files": 1,
            },
        ],
        "at": now,
    }
    waits = {
        "total_ms": 5400000,
        "stages": [
            {"key": "doing", "label": "In Arbeit", "ms": 3600000, "open": False},
            {"key": "review", "label": "Prüfung bei ada", "ms": 1200000, "open": True},
            {"key": "mensch", "label": "wartet auf mensch", "ms": 600000, "open": False},
        ],
    }
    try:
        with open(path, encoding="utf-8") as handle:
            ticket = json.load(handle)
        if isinstance(ticket, dict):
            ticket["sessions"] = sessions
            ticket["max_cost"] = 5
            ticket["cost"] = cost
            ticket["waits"] = waits
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(ticket, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
    except (OSError, json.JSONDecodeError):
        return
    index_path = os.path.join(state["fab_home"], "index.json")
    if not os.path.isfile(index_path):
        return
    try:
        with open(index_path, encoding="utf-8") as handle:
            index = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(index, dict):
        return
    for row in index.get("tickets") or []:
        if isinstance(row, dict) and row.get("id") == "T-1":
            row["team"] = "herdr-app"
            row["max_cost"] = 5
            row["cost"] = {
                "currency": "USD",
                "total": cost["total"],
                "today": cost["today"],
            }
            row["waits"] = waits
    with open(index_path, "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False)
        handle.write("\n")


def _seed(state, ticket, worktree):
    env = environment(state)
    env["FAB_ROSTER"] = os.path.join(root(ticket["id"]), "keine-roster.json")
    title = ticket.get("title") or ""
    command = [
        sys.executable,
        FAB,
        "new",
        f"Vorschau {ticket['id']}: {title}",
        "--no-wake",
    ]
    try:
        result = subprocess.run(
            command,
            cwd=worktree,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError:
        raise FabError("python3 ist nicht im PATH")
    except subprocess.TimeoutExpired:
        raise FabError(f"{ticket['id']}: Testdaten anzulegen hat zu lange gedauert")
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or f"Exit {result.returncode}"
        raise FabError(f"{ticket['id']}: Testdaten nicht angelegt: {detail}")


def _wait_ready(state, ticket_id):
    env = environment(state)
    deadline = time.monotonic() + START_TIMEOUT
    while True:
        try:
            result = subprocess.run(
                [APP, "status"],
                cwd=state["home"],
                env=env,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except FileNotFoundError:
            raise FabError("herdr-app ist nicht im PATH")
        except subprocess.TimeoutExpired:
            result = None
        if result is not None and result.returncode == 0:
            return
        if time.monotonic() >= deadline:
            _terminate(state.get("pid"))
            raise FabError(
                f"{ticket_id}: Vorschau-Core wurde in {int(START_TIMEOUT)} s nicht bereit"
            )
        time.sleep(POLL)


def start(ticket, page="board"):
    ticket_id = ticket["id"]
    worktree = ticket.get("worktree")
    if not worktree or not os.path.isdir(worktree):
        raise FabError(
            f"{ticket_id}: Worktree fehlt ({worktree or 'kein Pfad'}); "
            f"fab dispatch legt ihn an"
        )
    if load_state(ticket_id) is not None:
        stop(ticket_id)
    elif os.path.isdir(root(ticket_id)):
        shutil.rmtree(root(ticket_id), ignore_errors=True)
    base = root(ticket_id)
    state = {
        "ticket": ticket_id,
        "pid": None,
        "session": _session_name(ticket_id),
        "home": home(ticket_id),
        "userhome": os.path.join(base, "userhome"),
        "fab_home": fab_home(ticket_id),
        "log": os.path.join(base, "app.log"),
        "page": page or "board",
        "started_at": int(time.time() * 1000),
    }
    for folder in (
        state["home"],
        os.path.join(state["home"], "data"),
        state["fab_home"],
        state["userhome"],
        os.path.join(base, "shots"),
    ):
        os.makedirs(folder, exist_ok=True)
    _copy_worktree(worktree, state["home"])
    _seed_window(state, page)
    _seed(state, ticket, worktree)
    _seed_metrics(state)
    with open(state["log"], "a", encoding="utf-8") as log:
        try:
            process = subprocess.Popen(
                [APP],
                cwd=state["home"],
                env=environment(state),
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except FileNotFoundError:
            raise FabError("herdr-app ist nicht im PATH")
    state["pid"] = process.pid
    _write_state(ticket_id, state)
    _wait_ready(state, ticket_id)
    return state


def shot(ticket):
    ticket_id = ticket["id"]
    state = load_state(ticket_id)
    if not state:
        raise FabError(f"{ticket_id}: keine Vorschau")
    shots = os.path.join(root(ticket_id), "shots")
    os.makedirs(shots, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    png = os.path.join(shots, f"{stamp}-{state.get('pid')}.png")
    try:
        result = subprocess.run(
            [APP, "shot", png],
            cwd=state["home"],
            env=environment(state),
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        raise FabError("herdr-app ist nicht im PATH")
    except subprocess.TimeoutExpired:
        raise FabError(f"{ticket_id}: Screenshot hat zu lange gedauert")
    if result.returncode != 0:
        raise FabError(f"{ticket_id}: Screenshot fehlgeschlagen: {_detail(result)}")
    if not os.path.isfile(png):
        raise FabError(f"{ticket_id}: Screenshot fehlt: {png}")
    return png


def stop(ticket_id):
    state = load_state(ticket_id)
    base = root(ticket_id)
    if state is None:
        if not os.path.isdir(base):
            raise FabError(f"{ticket_id}: keine Vorschau")
        state = {
            "ticket": ticket_id,
            "pid": None,
            "session": _session_name(ticket_id),
            "home": home(ticket_id),
            "userhome": os.path.join(base, "userhome"),
            "fab_home": fab_home(ticket_id),
            "log": os.path.join(base, "app.log"),
        }
        keep = {}
    else:
        keep = state
    _terminate(state.get("pid"))
    try:
        subprocess.run(
            [HC, "server", "stop"],
            cwd=state["home"] if os.path.isdir(state["home"]) else base,
            env=environment(state),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    shutil.rmtree(base, ignore_errors=True)
    return keep


def check_mods(repo_top):
    folder = os.path.join(repo_top, "mods")
    names = []
    if os.path.isdir(folder):
        names = sorted(
            name
            for name in os.listdir(folder)
            if os.path.isfile(os.path.join(folder, name, "main.js"))
        )
    rows = []
    lines = []
    for name in names:
        path = os.path.abspath(os.path.join(folder, name))
        try:
            result = subprocess.run(
                [APP, "check", path],
                cwd=repo_top,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=CHECK_TIMEOUT,
            )
            output = (result.stdout or "").strip()
            ok = result.returncode == 0
        except FileNotFoundError:
            rows = [
                {
                    "name": APP,
                    "path": "",
                    "ok": False,
                    "output": "herdr-app ist nicht im PATH",
                }
            ]
            lines = ["herdr-app ist nicht im PATH"]
            break
        except subprocess.TimeoutExpired:
            output = f"Timeout nach {CHECK_TIMEOUT} s"
            ok = False
        rows.append({"name": name, "path": path, "ok": ok, "output": output})
        if ok:
            lines.append(f"mods/{name}: ok")
        else:
            lines.append(f"mods/{name}: rot" + (f"\n{output}" if output else ""))
    passed = all(row["ok"] for row in rows)
    return {
        "ok": passed,
        "state": "pass" if passed else "fail",
        "output": "\n".join(lines),
        "mods": rows,
    }
