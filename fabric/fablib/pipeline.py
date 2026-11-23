"""Prüf-Pipelines: Schritte aus `.fabric/pipeline.json` einzeln ausführen.

Ein Lauf gehört zu genau einem Ticket/Repo/Worktree und speichert jeden Schritt
mit Zustand, Dauer, Exit-Code und getrennter Ausgabe. Beim Laufstart entstehen
alle Schritte als `pending`; nach dem ersten Fehler werden die restlichen als
`skipped` festgehalten. Bricht die Ausführung ab, endet der Lauf als `fail`.
"""
import json
import os
import subprocess

from . import git, store
from .errors import FabError

DEFAULT_TIMEOUT = 1200
STEPS_FILE = ".fabric/pipeline.json"
VERIFY_SCRIPT = ".fabric/verify.sh"
TRIGGERS = ("verify", "main", "repo-test", "autopilot")

TAIL_LINES = 20


def _steps_path(worktree):
    return os.path.join(worktree, STEPS_FILE)


def _script_path(worktree):
    return os.path.join(worktree, VERIFY_SCRIPT)


def _load_entries(path):
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as exc:
        raise FabError(f"{path} ist nicht lesbar: {exc}") from exc
    steps = data.get("steps") if isinstance(data, dict) else None
    if not isinstance(steps, list):
        raise FabError(f"{path}: erwartet wird ein Objekt mit dem Feld 'steps'")
    result = []
    for raw in steps:
        name = raw.get("name") if isinstance(raw, dict) else None
        command = raw.get("run") if isinstance(raw, dict) else None
        if not isinstance(name, str) or not name.strip():
            raise FabError(f"{path}: jeder Schritt braucht einen nicht-leeren 'name'")
        if not isinstance(command, str) or not command.strip():
            raise FabError(f"{path}: Schritt {name!r} braucht einen nicht-leeren 'run'")
        result.append({"name": name, "run": command})
    return result


def load_steps(worktree):
    """Schritte des Worktrees; ohne `pipeline.json` zählt `verify.sh` als ein Schritt."""
    path = _steps_path(worktree)
    if os.path.isfile(path):
        return _load_entries(path)
    script = _script_path(worktree)
    if os.path.isfile(script):
        return [{"name": "verify.sh", "run": f"sh {VERIFY_SCRIPT}"}]
    raise FabError(
        f"Keine Pipeline: {path} fehlt und {script} fehlt. Der Agent legt eine "
        f"von beiden an und committet sie."
    )


def _decode(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value or ""


def _execute(command, cwd, timeout):
    """(code, stdout, stderr); Timeout endet mit 124 und einem Hinweis auf stderr."""
    try:
        result = subprocess.run(
            ["sh", "-c", command],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, result.stdout or "", result.stderr or ""
    except subprocess.TimeoutExpired as exc:
        out = _decode(exc.stdout)
        err = _decode(exc.stderr)
        err += f"\nTimeout nach {timeout} s"
        return 124, out, err
    except FileNotFoundError:
        raise FabError("sh ist nicht vorhanden")


def _tail(parts, limit=TAIL_LINES):
    text = "\n".join(parts).strip()
    return "\n".join(text.splitlines()[-limit:])


def run(
    worktree,
    trigger="verify",
    *,
    ticket=None,
    repo="",
    branch="",
    head="",
    timeout=None,
    tail_lines=TAIL_LINES,
):
    """Alle Schritte ausführen und den Lauf speichern."""
    if trigger not in TRIGGERS:
        raise FabError(
            f"Unbekannter Auslöser {trigger!r}; erlaubt: {', '.join(TRIGGERS)}"
        )
    steps = load_steps(worktree)
    limit = DEFAULT_TIMEOUT if timeout is None else timeout
    repo = repo or worktree
    branch = branch or git.branch(worktree)
    head_before = head or git.head(worktree)

    start = store.now_ms()
    run_id = store.pipeline_run_new(
        trigger=trigger,
        ticket=ticket,
        repo=repo,
        worktree=worktree,
        branch=branch,
        head=head_before,
    )
    for position, step in enumerate(steps):
        store.pipeline_step_add(
            run_id, position, step["name"], step["run"], "pending"
        )

    executed = []
    out_parts = []
    err_parts = []
    combined = []
    first_code = None
    failed = False

    try:
        for position, step in enumerate(steps):
            name = step["name"]
            command = step["run"]
            if failed:
                store.pipeline_step_update(run_id, position, state="skipped")
                executed.append(
                    {
                        "position": position,
                        "name": name,
                        "command": command,
                        "state": "skipped",
                        "duration_ms": None,
                        "exit_code": None,
                        "stdout": "",
                        "stderr": "",
                    }
                )
                continue

            store.pipeline_step_update(run_id, position, state="running")
            step_start = store.now_ms()
            code, out, err = _execute(command, worktree, limit)
            duration = store.now_ms() - step_start
            state = "pass" if code == 0 else "fail"
            store.pipeline_step_update(
                run_id,
                position,
                state=state,
                duration_ms=duration,
                exit_code=code,
                stdout=out,
                stderr=err,
            )
            out_parts.append(out)
            err_parts.append(err)
            combined.append(out)
            combined.append(err)
            executed.append(
                {
                    "position": position,
                    "name": name,
                    "command": command,
                    "state": state,
                    "duration_ms": duration,
                    "exit_code": code,
                    "stdout": out,
                    "stderr": err,
                }
            )
            if code != 0:
                failed = True
                first_code = code
    except BaseException:
        store.pipeline_run_finish(run_id, "fail", store.now_ms() - start)
        raise

    store.pipeline_run_finish(
        run_id, "fail" if failed else "pass", store.now_ms() - start
    )

    return {
        "state": "fail" if failed else "pass",
        "head": head_before,
        "tail": _tail(combined, tail_lines),
        "code": first_code if failed else 0,
        "run_id": run_id,
        "stdout": "".join(out_parts),
        "stderr": "".join(err_parts),
        "steps": executed,
    }


def rerun(run_id, timeout=None):
    """Einen gespeicherten Lauf im selben Worktree mit denselben Angaben wiederholen."""
    row = store.pipeline_run_load(run_id)
    if row is None:
        raise FabError(f"Pipeline-Lauf {run_id} existiert nicht")
    worktree = row.get("worktree") or row.get("repo")
    if not worktree or not os.path.isdir(worktree):
        raise FabError(
            f"Lauf {run_id}: Worktree fehlt ({worktree or 'kein Pfad'})"
        )
    return run(
        worktree,
        row["trigger"],
        ticket=row["ticket"],
        repo=row["repo"],
        branch=row["branch"],
        timeout=timeout,
    )
