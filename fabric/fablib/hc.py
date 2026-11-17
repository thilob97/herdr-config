"""Die einzige Stelle, die `hc` (herdr-core) aufruft."""
import json
import re
import subprocess

from .errors import HcError

ORCHESTRATOR = "fab-orchestrator"
_NAME_OK = re.compile(r"[^a-z0-9-]")


def terminal_name(agent, tid):
    """`fab-<agent>-<id klein>`, nur a-z 0-9 - _ und höchstens 32 Zeichen."""
    raw = f"fab-{agent}-{tid}".lower()
    clean = _NAME_OK.sub("-", raw).strip("-")
    return clean[:32] or "fab-agent"


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


def live():
    """Name → Zeile für alle Terminals mit state == live."""
    return {
        row["name"]: row
        for row in ls()
        if isinstance(row, dict) and row.get("name") and row.get("state") == "live"
    }


def send(address, text):
    """hc send; ein blockierter Agent nimmt die Nachricht erst mit --force an."""
    result = _run(["send", str(address), text], timeout=120)
    if result.returncode != 0:
        result = _run(["send", str(address), text, "--force"], timeout=120)
    return result.returncode == 0


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
