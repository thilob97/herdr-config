"""Die einzige Stelle, die `hc` (herdr-core) aufruft."""
import hashlib
import json
import re
import subprocess

from .errors import HcError

ORCHESTRATOR = "fab-orchestrator"
ORCHESTRATOR_SUFFIX = "-orchestrator"
NAME_LIMIT = 32
_NAME_OK = re.compile(r"[^a-z0-9-]")


def _clean(raw):
    return _NAME_OK.sub("-", str(raw).lower()).strip("-")


def _digest(raw):
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:6]


def terminal_name(agent, tid, team=None):
    """`fab-<team>-<agent>-<id>` oder alt `fab-<agent>-<id>`, höchstens 32 Zeichen.

    Zu lange Namen behalten die Ticket-ID vollständig und bekommen einen
    Kurz-Hash der vollen Identität, damit zwei Tickets nie kollidieren.
    """
    tid = _clean(tid)
    agent = _clean(agent)
    team = _clean(team) if team else ""
    raw = f"fab-{team}-{agent}-{tid}" if team else f"fab-{agent}-{tid}"
    if len(raw) <= NAME_LIMIT:
        return raw
    tail = f"-{_digest(raw)}-{tid}"
    room = max(1, NAME_LIMIT - len("fab-") - len(tail))
    core = (f"{team}-{agent}" if team else agent)[:room].rstrip("-")
    return f"fab-{core}{tail}"


_TICKET_TAIL = re.compile(r"-t-(\d+)$")


def ticket_of(name):
    """Ticket-ID aus einem Fab-Terminalnamen (`fab-…-t-<n>`), sonst None.

    Der Name bleibt der einzige Rückfall, wenn eine Session nie im Ticket
    vermerkt wurde: `hc ls --json` liefert keine Labels. Auch lange Namen
    behalten die Ticket-ID am Ende (siehe `terminal_name`).
    """
    match = _TICKET_TAIL.search(str(name or "").lower())
    return f"T-{match.group(1)}" if match else None


def orchestrator_name(team):
    """`fab-<team>-orchestrator`; das alte globale Terminal bleibt `fab-orchestrator`."""
    team = _clean(team)
    raw = f"fab-{team}{ORCHESTRATOR_SUFFIX}"
    if len(raw) <= NAME_LIMIT:
        return raw
    tail = f"{ORCHESTRATOR_SUFFIX}"
    room = max(1, NAME_LIMIT - len("fab-") - len(tail) - 1 - 6)
    core = f"{team[:room]}-{_digest(raw)}"
    return f"fab-{core}{tail}"


def is_orchestrator(name):
    """Orchestrator-Terminal, neu (`fab-<team>-orchestrator`) oder alt."""
    value = str(name or "")
    return value == ORCHESTRATOR or value.endswith(ORCHESTRATOR_SUFFIX)


def _run(args, timeout=120):
    try:
        return subprocess.run(["hc", *args], capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise HcError("hc ist nicht im PATH")
    except subprocess.TimeoutExpired:
        raise HcError(f"hc {' '.join(args)} hat zu lange gedauert")


def ls():
    result = _run(["ls", "--json"], timeout=60)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or f"Exit {result.returncode}"
        raise HcError(f"hc ls: {detail}")
    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        raise HcError("hc ls --json liefert kein JSON")
    rows = data.get("terminals") if isinstance(data, dict) else None
    return rows or []


def get(target, timeout=60):
    """`hc get <t> --json` als Dict; für Zeitstempel der letzten Ausgabe."""
    result = _run(["get", str(target), "--json"], timeout=timeout)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or f"Exit {result.returncode}"
        raise HcError(f"hc get: {detail}")
    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        raise HcError("hc get --json liefert kein JSON")
    return data if isinstance(data, dict) else {}


def live():
    """Name → Zeile für alle Terminals mit state == live."""
    return {
        row["name"]: row
        for row in ls()
        if isinstance(row, dict) and row.get("name") and row.get("state") == "live"
    }


def send_detail(address, text):
    """hc send; ein blockierter Agent nimmt die Nachricht erst mit --force an.

    Rückgabe: (ok, detail). `detail` ist die knappe Meldung, wenn beide
    Versuche scheitern, sonst "".
    """
    result = _run(["send", str(address), text], timeout=120)
    if result.returncode != 0:
        result = _run(["send", str(address), text, "--force"], timeout=120)
    if result.returncode == 0:
        return True, ""
    detail = (result.stderr or result.stdout).strip() or f"Exit {result.returncode}"
    return False, detail


def send(address, text):
    """hc send; nur das Ergebnis, Details über `send_detail`."""
    return send_detail(address, text)[0]


def run(name, cwd, argv, prompt, labels=None, want_json=True):
    """`hc run --bg …`; gibt die JSON-Antwort zurück (mit `address`)."""
    if not argv:
        raise HcError("Startbefehl fehlt (argv im Roster)")
    args = ["run", "--bg"]
    if want_json:
        args.append("--json")
    args += ["--name", name, "--cwd", cwd]
    for key, value in (labels or {}).items():
        args += ["--label", f"{key}={value}"]
    args += ["--no-parent", "--outlive-parent", "--", *argv, prompt]
    result = _run(args, timeout=120)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or f"Exit {result.returncode}"
        raise HcError(f"hc run: {detail}")
    if not want_json:
        return {}
    try:
        answer = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        raise HcError("hc run --json liefert kein JSON")
    if not answer.get("address"):
        raise HcError("hc run --json nennt keine Terminaladresse")
    return answer


def kill(target):
    if not target:
        return False
    result = _run(["kill", str(target)], timeout=60)
    return result.returncode == 0
