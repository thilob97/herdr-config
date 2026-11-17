"""Herdrs Fenster: gemeinsamer Space „Fabric“ und ein Tab je Agent.

Ein selbst gestartetes Terminal erscheint genau dann im Fenster, wenn es beim
Start die Labels `herdr.space` und `herdr.tab` trägt. Herdr hängt es dann ohne
Fokuswechsel in diesen Space und Tab (`adopt`). `terminal.keep` wäre der
falsche Weg: Es nimmt den gerade gezeigten Space und fokussiert den neuen Tab.
"""
import json
import os
import secrets
import subprocess
import time

from . import store
from .errors import HerdrError

SPACE = "Fabric"
_STATE = "herdr.json"
_WAIT = 2.0
_POLL = 0.1


def _run(args, timeout=10):
    try:
        return subprocess.run(
            ["herdr-app", *args], capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError:
        raise HerdrError("herdr-app ist nicht im PATH")
    except subprocess.TimeoutExpired:
        raise HerdrError(f"herdr-app {' '.join(args)} hat zu lange gedauert")
    except OSError as exc:
        raise HerdrError(f"herdr-app: {exc}")


def _detail(result):
    return (result.stderr or result.stdout).strip() or f"Exit {result.returncode}"


def spaces():
    """Alle Spaces des laufenden Fensters; ohne Fenster: HerdrError."""
    result = _run(["ls"], timeout=10)
    if result.returncode != 0:
        raise HerdrError(f"herdr-app ls: {_detail(result)}")
    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        raise HerdrError("herdr-app ls liefert kein JSON")
    rows = data.get("spaces") if isinstance(data, dict) else None
    return [row for row in rows or [] if isinstance(row, dict) and row.get("id")]


def _state_path():
    return os.path.join(store.home(), _STATE)


def _saved_space():
    try:
        with open(_state_path(), encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    space = data.get("space") if isinstance(data, dict) else None
    return space if isinstance(space, str) and space else None


def _save_space(space):
    store.ensure()
    path = _state_path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump({"space": space}, handle)
        handle.write("\n")
    os.replace(tmp, path)


def _new_id(prefix):
    return prefix + secrets.token_hex(16)


def placement():
    """Space- und frische Tab-ID für einen Agentenstart.

    Der Space heißt „Fabric“; fehlt er, legt Herdr ihn beim Übernehmen des
    Terminals an. Die ID wird gemerkt, damit parallele und spätere Starts
    denselben Space treffen. Ohne erreichbares Fenster: HerdrError.
    """
    listed = spaces()
    saved = _saved_space()
    known = {row["id"] for row in listed}
    if saved in known:
        return {"space": saved, "tab": _new_id("tb"), "new_space": False}
    for row in listed:
        if row.get("name") == SPACE:
            _save_space(row["id"])
            return {"space": row["id"], "tab": _new_id("tb"), "new_space": False}
    space = saved or _new_id("sp")
    _save_space(space)
    return {"space": space, "tab": _new_id("tb"), "new_space": True}


def labels(placement):
    return {
        "herdr.space": placement["space"],
        "herdr.tab": placement["tab"],
    }


def finish(placement, tab_name):
    """Benennt Space und Tab nach der Übernahme; wartet kurz auf Herdr."""
    error = None
    if placement.get("new_space"):
        try:
            _rename("space.rename", placement["space"], SPACE)
        except HerdrError as exc:
            error = exc
    try:
        _rename("tab.rename", placement["tab"], tab_name)
    except HerdrError as exc:
        error = error or exc
    if error:
        raise error


def _rename(command, target, name):
    args = ["do", command, "--id", target, "--name", name]
    deadline = time.monotonic() + _WAIT
    while True:
        result = _run(args)
        if result.returncode == 0:
            return
        if time.monotonic() >= deadline:
            raise HerdrError(f"herdr-app {command}: {_detail(result)}")
        time.sleep(_POLL)
