"""Prüf-Pipelines: Schritte aus `.fabric/pipeline.json` einzeln ausführen.

Ein Lauf gehört zu genau einem Ticket/Repo/Worktree und speichert jeden Schritt
mit Zustand, Dauer, Exit-Code und getrennter Ausgabe. Beim Laufstart entstehen
alle Schritte als `pending`; nach dem ersten Fehler werden die restlichen als
`skipped` festgehalten. Systemweit laufen höchstens `max_verify` Läufe
gleichzeitig: Der Lauf steht zuerst als `queued` in der Ablage, belegt dann
einen Slot (Abschnitt `verifyslots`) und wird erst danach `running`. Die
Wartezeit zählt nicht ins Schritt-Timeout. Bricht die Ausführung ab, endet der
Lauf als `fail`. Kann ein getöteter Prozess das nicht mehr selbst schreiben,
setzt der nächste Laufstart den verwaisten Lauf beim Aufräumen auf `fail`. Die
Besitzdatei des Laufs zeigt dabei, ob sein Prozess noch lebt.
"""
import json
import os
import subprocess
import sys

from . import git, store, verifyslots
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


def _reap_abandoned():
    """Läufe ohne lebenden Besitzer auf einen Endstatus setzen (T-113).

    Ein per `SIGKILL` beendeter Lauf kann seine Schritte und seinen Endstatus
    nicht mehr selbst schreiben. Der Kernel hat seine Besitzdatei aus
    `verifyslots` freigegeben; bekommt der nächste Laufstart sie, ist der Lauf
    verwaist. Er endet wie im Ausnahme-Aufräumen von `run()`: `running`-Schritte
    `fail`, `pending`-Schritte `skipped`, Lauf `fail`. Lebende Läufe behalten
    ihre Sperre und bleiben unberührt.

    Die Liste und die Besitzprüfung sind nur ein Vorfilter: Zwischen beiden
    kann der Besitzer fertig werden. Geschrieben wird deshalb ausschließlich
    bedingt (`pipeline_step_transition`, `pipeline_run_finish_if_open`) – ein
    bereits beendeter Lauf samt fertigen Schritten bleibt unangetastet.
    """
    for row in store.pipeline_run_list():
        if row.get("state") not in ("queued", "running"):
            continue
        try:
            if not verifyslots.abandoned(row["id"]):
                continue
            for step in store.pipeline_steps(row["id"]):
                wanted = {"running": "fail", "pending": "skipped"}.get(
                    step["state"]
                )
                if wanted is not None:
                    store.pipeline_step_transition(
                        row["id"], step["position"], step["state"], wanted
                    )
            started = row.get("started_at") or store.now_ms()
            store.pipeline_run_finish_if_open(
                row["id"], "fail", max(0, store.now_ms() - started)
            )
        except Exception as error:  # noqa: BLE001 - Aufräumen darf nichts klemmen
            print(
                f"Pipeline {row.get('id')}: Aufräumen eines verwaisten Laufs "
                f"fehlgeschlagen: {type(error).__name__}: {error}",
                file=sys.stderr,
            )


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
    step_timeout = DEFAULT_TIMEOUT if timeout is None else timeout
    repo = repo or worktree
    branch = branch or git.branch(worktree)
    head_before = head or git.head(worktree)

    _reap_abandoned()
    start = store.now_ms()

    executed = []
    out_parts = []
    err_parts = []
    combined = []
    first_code = None
    failed = False
    slot = None
    owner = None
    run_id = None

    try:
        run_id = store.pipeline_run_new(
            trigger=trigger,
            ticket=ticket,
            repo=repo,
            worktree=worktree,
            branch=branch,
            head=head_before,
            state="queued",
        )
        # Besitz sofort nach dem Einreihen: Auch ein wartender Lauf lebt, und
        # der nächste Start darf ihn nicht für verwaist halten. Zwischen
        # Einreihen und Belegen liegt nur ein Statement; räumt ein anderer
        # Start genau dieses Fenster ab, schreibt dieser Lauf seinen Zustand
        # danach ohnehin selbst.
        owner = verifyslots.claim_run(run_id)
        for position, step in enumerate(steps):
            store.pipeline_step_add(
                run_id, position, step["name"], step["run"], "pending"
            )
        capacity = verifyslots.limit()
        slot = verifyslots.acquire(
            capacity,
            on_wait=lambda: print(
                f"Lauf #{run_id}: in der Warteschlange "
                f"(max. {capacity} gleichzeitig)",
                file=sys.stderr,
                flush=True,
            ),
        )
        store.pipeline_run_start(run_id)
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
            code, out, err = _execute(command, worktree, step_timeout)
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
    except BaseException as exc:
        # Jeder Aufräumschritt zählt einzeln: Ein Fehler beim Speichern darf
        # weder den Lauf auf `running` lassen noch die ursprüngliche Ausnahme
        # verdecken. Aufräumfehler gehen an stderr und als `__cause__` mit.
        if run_id is None:
            raise
        cleanup_errors = []

        def attempt(label, action):
            try:
                action()
            except BaseException as error:
                cleanup_errors.append(error)
                print(
                    f"Pipeline {run_id}: Aufräumen fehlgeschlagen ({label}): "
                    f"{type(error).__name__}: {error}",
                    file=sys.stderr,
                )

        def mark_steps():
            for step_row in store.pipeline_steps(run_id):
                state = step_row["state"]
                if state == "running":
                    wanted = "fail"
                elif state == "pending":
                    wanted = "skipped"
                else:
                    continue
                position = step_row["position"]
                attempt(
                    f"Schritt {position} auf {wanted}",
                    lambda position=position, wanted=wanted: (
                        store.pipeline_step_update(
                            run_id, position, state=wanted
                        )
                    ),
                )

        attempt("Schritte lesen", mark_steps)
        attempt(
            "Lauf auf fail",
            lambda: store.pipeline_run_finish(
                run_id, "fail", store.now_ms() - start
            ),
        )
        if cleanup_errors:
            raise exc from cleanup_errors[-1]
        raise
    else:
        # Endstatus vor dem Freigeben des Besitzes: Solange der Lauf offen ist,
        # hält dieser Prozess seine Besitzdatei, und kein Aufräumen greift ein.
        store.pipeline_run_finish(
            run_id, "fail" if failed else "pass", store.now_ms() - start
        )
    finally:
        if owner is not None:
            owner.release()
        if slot is not None:
            slot.release()

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
