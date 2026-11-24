"""Alarme aus Pipeline-, Autopilot- und Wächterzustand.

Die UI liest `index.json["alarm"]`; derselbe Zustand speist die Alarm-Einträge
der Inbox. Quittiert wird über den Meta-Schlüssel `alarm_ack` (JSON-Liste),
damit ein Alarm nicht bei jeder Neuberechnung erneut als Banner erscheint.
"""
import json
import re
from datetime import datetime

from . import autopilot, git, store
from .errors import FabError

ACK_KEY = "alarm_ack"
ACK_LIMIT = 100
_TICKET = re.compile(r"T-\d+")
_ORDER = {"main": 0, "pause": 1, "orchestrator": 2, "tick": 3}


def _now(now=None):
    return store.now_ms() if now is None else int(now)


def _clock(at):
    try:
        return datetime.fromtimestamp(int(at) / 1000).strftime("%H:%M")
    except (TypeError, ValueError, OSError):
        return "00:00"


def _age_text(since, now):
    """Alter auf Deutsch, wie `relativeTime` im Mod."""
    minutes = max(0, int(now) - int(since)) // 60000
    if minutes < 1:
        return "gerade eben"
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} h"
    return f"{hours // 24} Tagen"


def _acked_ids():
    raw = store.meta_get(ACK_KEY)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    return [str(item) for item in data]


def _save_acked(ids):
    merged = []
    for item in ids:
        if item not in merged:
            merged.append(item)
    merged = merged[-ACK_LIMIT:]
    store.meta_set(ACK_KEY, json.dumps(merged, ensure_ascii=False))
    return merged


def _git_text(repo, *args):
    if not repo:
        return ""
    try:
        result = git.git(list(args), repo, timeout=30)
    except (FabError, OSError):
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout or ""


def _last_main_run():
    runs = [
        run for run in store.pipeline_run_list()
        if run.get("trigger") == "main"
    ]
    return runs[-1] if runs else None


def _ticket_of(run):
    ticket = str(run.get("ticket") or "").strip()
    if ticket:
        return ticket
    head = str(run.get("head") or "").strip()
    if not head:
        return ""
    subject = _git_text(run.get("repo") or "", "log", "-1", "--format=%s", head).strip()
    match = _TICKET.search(subject)
    return match.group(0) if match else ""


def _was_reverted(run):
    head = str(run.get("head") or "").strip()
    if not head:
        return False
    body = _git_text(run.get("repo") or "", "log", "-n", "50", "--format=%B")
    return f"This reverts commit {head}" in body


def _main_alarm(run, paused):
    steps = store.pipeline_steps(run["id"])
    failed = next((step for step in steps if step.get("state") == "fail"), None)
    step = str((failed or {}).get("name") or "")
    ticket = _ticket_of(run)
    reverted = _was_reverted(run)
    at = int(run.get("started_at") or 0)

    text = f"main rot seit {_clock(at)}"
    if reverted:
        text += f" – {ticket} zurückgenommen" if ticket else " – Merge zurückgenommen"
    elif ticket:
        text += f" – {ticket}"
    if step:
        text += f" – Schritt {step} fehlgeschlagen"

    actions = []
    if run.get("id") is not None:
        actions.append("run")
    if ticket:
        actions.append("ticket")
    if paused:
        actions.append("resume")
    actions.append("ack")

    return {
        "id": f"main:{run['id']}",
        "kind": "main",
        "at": at,
        "since": at,
        "ticket": ticket,
        "run": run.get("id"),
        "step": step,
        "reverted": reverted,
        "paused": paused,
        "reason": "",
        "text": text,
        "actions": actions,
    }


def _pause_alarm(state):
    since = state.get("paused_since") or state.get("updated_at") or 0
    try:
        since = int(since)
    except (TypeError, ValueError):
        since = 0
    reason = str(state.get("reason") or "")
    text = f"Autopilot pausiert seit {_clock(since)}"
    if reason:
        text += f" – {reason}"
    return {
        "id": f"pause:{since}",
        "kind": "pause",
        "at": since,
        "since": since,
        "ticket": "",
        "run": None,
        "step": "",
        "reverted": False,
        "paused": True,
        "reason": reason,
        "text": text,
        "actions": ["resume", "ack"],
    }


def _tick_alarm(now):
    state = store.tick_alarm(now)
    if not state.get("stale"):
        return None
    last = state["last_tick"]
    age = _age_text(last, now)
    return {
        "id": f"tick:{last}",
        "kind": "tick",
        "at": int(last) + int(state["limit_ms"]),
        "since": int(last),
        "ticket": "",
        "run": None,
        "step": "",
        "reverted": False,
        "paused": False,
        "reason": "",
        "text": f"fab tick seit {age} nicht gelaufen – Stillstands-Wächter prüfen",
        "actions": ["ack"],
    }


def _orchestrator_alarms():
    """Alarme für Orchestrator-Starts, die ohne Turn endgültig scheiterten."""
    from . import agents, orchestrator

    roster = agents.load(required=False)
    if not roster:
        return []
    alarms = []
    for entry in roster.get("teams") or []:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        state = orchestrator.start_state(entry)
        if not state or state.get("state") != "failed":
            continue
        team = str(entry.get("name") or "")
        at = int(state.get("failed_at") or state.get("at") or 0)
        attempt = int(state.get("attempt") or 1)
        alarms.append({
            "id": f"orchestrator:{team}:{at}",
            "kind": "orchestrator",
            "at": at,
            "since": at,
            "ticket": "",
            "run": None,
            "step": "",
            "reverted": False,
            "paused": False,
            "reason": "Start ohne Antwort",
            "text": (
                f"Orchestrator {team}: Start ohne Antwort nach {attempt} "
                "Versuchen – Terminal prüfen"
            ),
            "actions": ["ack"],
        })
    return alarms


def _derive(now):
    """Alle aktuell abgeleiteten Alarme, auch die von main unterdrückte Pause."""
    alarms = []
    paused_state = autopilot.status()
    paused = paused_state.get("state") == "paused"
    run = _last_main_run()
    main = _main_alarm(run, paused) if run and run.get("state") == "fail" else None
    if main is not None:
        alarms.append(main)
    if paused:
        alarms.append(_pause_alarm(paused_state))
    alarms.extend(_orchestrator_alarms())
    tick = _tick_alarm(now)
    if tick is not None:
        alarms.append(tick)
    alarms.sort(key=lambda item: _ORDER.get(item["kind"], 99))
    return alarms


def status(now=None):
    """Aktiver Alarmzustand; quittierte Alarme und die unterdrückte Pause fehlen."""
    now = _now(now)
    acked = set(_acked_ids())
    alarms = [item for item in _derive(now) if item["id"] not in acked]
    if any(item["kind"] == "main" for item in alarms):
        alarms = [item for item in alarms if item["kind"] != "pause"]
    return {
        "active": bool(alarms),
        "count": len(alarms),
        "alarms": alarms,
    }


def ack():
    """Alle aktuell abgeleiteten Alarme quittieren; liefert ihre IDs."""
    ids = [item["id"] for item in _derive(_now())]
    if ids:
        existing = [item for item in _acked_ids() if item not in ids]
        _save_acked([*existing, *ids])
    return ids
