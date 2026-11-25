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
import signal
import subprocess
import sys
import time

from . import git, store, verifyslots
from .errors import FabError

DEFAULT_TIMEOUT = 1200
STEPS_FILE = ".fabric/pipeline.json"
VERIFY_SCRIPT = ".fabric/verify.sh"
TRIGGERS = ("verify", "main", "repo-test", "autopilot")
OPEN_STATES = ("queued", "running")

# T-127: Ein Abbruch (Signal, Zeitlimit, verwaister Lauf) bekommt einen
# gespeicherten Grund. `run_parallel.py` beendet sich bei einem von außen
# getöteten Testprozess mit `ABORT_EXIT` und schreibt `Abbruch: Signal …`.
ABORT_EXIT = 3
ABORT_PREFIX = "Abbruch: "
TAIL_LINES = 20

# T-145: Ein Schritt ohne neue Ausgabe gilt nach dieser Frist als stillstehend
# und wird samt seiner Prozessgruppe beendet. `FAB_VERIFY_STALL` (Sekunden)
# überschreibt den Standard.
STALL_DEFAULT = 600.0
STALL_EXIT = 125
STALL_MARK = "Stillstand: "
KILL_GRACE = 5.0
POLL = 0.1


def stall_seconds():
    """Stillstands-Frist eines Schritts in Sekunden; 0 schaltet sie ab."""
    raw = os.environ.get("FAB_VERIFY_STALL")
    if raw is None or not str(raw).strip():
        return STALL_DEFAULT
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return STALL_DEFAULT
    return value if value >= 0 else STALL_DEFAULT


def _step_base(run_id, position):
    return os.path.join(verifyslots.run_dir(), f"run-{int(run_id)}-{int(position)}")


def _group_path(run_id):
    return os.path.join(verifyslots.run_dir(), f"run-{int(run_id)}.pgid")


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


def _size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def _read_text(path):
    try:
        with open(path, "rb") as handle:
            return handle.read().decode("utf-8", "replace")
    except OSError:
        return ""


def _remove(*paths):
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass


def _group_alive(pgid):
    try:
        os.killpg(pgid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    return True


def _kill_group(pgid, grace=KILL_GRACE, proc=None):
    """Prozessgruppe mit SIGTERM beenden, nach `grace` Sekunden mit SIGKILL.

    `proc` ist der eigene Kindprozess der Gruppe; er wird beim Warten
    eingesammelt, sonst hielte sein Zombie die Gruppe scheinbar am Leben.
    """
    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        if proc is not None:
            proc.poll()
        if not _group_alive(pgid):
            return
        time.sleep(POLL)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def test_jobs(slots=None):
    """Testprozesse je Prüflauf: die CPU-Kerne geteilt durch die Prüfplätze.

    `run_parallel.py` nimmt sonst alle Kerne, und zwei gleichzeitige Läufe
    starteten doppelt so viele Prozesse wie Kerne (Load 50–80 am 24./25.11.).
    """
    slots = verifyslots.limit() if slots is None else slots
    return max(2, (os.cpu_count() or 2) // max(1, int(slots)))


def _step_env():
    env = dict(os.environ)
    if not (env.get("FAB_TEST_JOBS") or "").strip():
        env["FAB_TEST_JOBS"] = str(test_jobs())
    return env


def _execute(command, cwd, timeout, run_id=None, position=None, stall=None, env=None):
    """(code, stdout, stderr) eines Schritts.

    Der Schritt läuft in einer eigenen Prozessgruppe und schreibt in Dateien
    statt in Pipes (T-145): Ein hängender Enkelprozess mit offener Pipe hält
    den Lauf so nicht fest. Zeitlimit (124, Hinweis `Timeout nach …`) und
    Stillstand (`STALL_EXIT`, Hinweis `Stillstand: …`, keine neue Ausgabe für
    `stall` Sekunden) beenden die ganze Gruppe. Nach dem Ende wird die Gruppe
    ebenfalls beendet, damit keine Reste des Schritts weiterlaufen.
    """
    stall = stall_seconds() if stall is None else stall
    if run_id is not None and position is not None:
        base = _step_base(run_id, position)
    else:
        base = os.path.join(
            verifyslots.run_dir(), f"step-{os.getpid()}-{time.time_ns()}"
        )
    out_path, err_path = base + ".out", base + ".err"
    try:
        with open(out_path, "wb") as out_file, open(err_path, "wb") as err_file:
            proc = subprocess.Popen(
                ["sh", "-c", command],
                cwd=cwd,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=out_file,
                stderr=err_file,
                start_new_session=True,
            )
    except FileNotFoundError:
        _remove(out_path, err_path)
        raise FabError("sh ist nicht vorhanden")
    if run_id is not None:
        store.atomic_write(_group_path(run_id), f"{proc.pid}\n")
    began = time.monotonic()
    last = began
    seen = -1
    outcome = None
    try:
        while proc.poll() is None:
            now = time.monotonic()
            current = _size(out_path) + _size(err_path)
            if current != seen:
                seen = current
                last = now
            if timeout is not None and now - began >= timeout:
                outcome = "timeout"
                break
            if stall and now - last >= stall:
                outcome = "stall"
                break
            time.sleep(POLL)
    finally:
        # Auch bei einem Abbruch von außen (KeyboardInterrupt, SIGTERM als
        # Ausnahme) bleibt nichts von diesem Schritt am Leben; nach einem
        # normalen Ende enden übrig gebliebene Enkel der Gruppe.
        _kill_group(proc.pid, proc=proc)
        try:
            proc.wait(timeout=KILL_GRACE)
        except subprocess.TimeoutExpired:
            pass
        out = _read_text(out_path)
        err = _read_text(err_path)
        _remove(out_path, err_path)
        if run_id is not None:
            _remove(_group_path(run_id))
    if outcome == "timeout":
        return 124, out, err + f"\nTimeout nach {timeout} s"
    if outcome == "stall":
        return STALL_EXIT, out, err + f"\n{STALL_MARK}{stall:g} s ohne Ausgabe"
    return proc.returncode, out, err


def _tail(parts, limit=TAIL_LINES):
    text = "\n".join(parts).strip()
    return "\n".join(text.splitlines()[-limit:])


def _abort_reason(name, code, out, err, timeout):
    """Grund für einen Abbruch dieses Schritts; "" bei gewöhnlichem Rot (T-127).

    Erkannt werden vier Arten, die kein Testfehler sind: das Zeitlimit des
    Schritts (124 mit Hinweis), ein Stillstand ohne Ausgabe (`STALL_EXIT` mit
    Hinweis, T-145), ein per Signal beendeter Schrittprozess (negativer
    Rückgabewert) und ein von `run_parallel.py` gemeldeter Signalabbruch
    (`ABORT_EXIT` mit `Abbruch: `-Zeile).
    """
    if code < 0:
        return f"{ABORT_PREFIX}Signal {-code} im Schritt {name}"
    if code == 124 and f"Timeout nach {timeout} s" in (err or ""):
        return f"{ABORT_PREFIX}Zeitlimit nach {timeout} s im Schritt {name}"
    if code == STALL_EXIT:
        for line in (err or "").splitlines():
            if line.startswith(STALL_MARK):
                detail = line[len(STALL_MARK):].strip()
                return f"{ABORT_PREFIX}stillstehender Lauf ({detail}) im Schritt {name}"
    if code == ABORT_EXIT:
        for line in (out or "").splitlines() + (err or "").splitlines():
            if line.startswith(ABORT_PREFIX):
                return line.strip()
    return ""


def _close_run(row, reason):
    """Offene Schritte und den Lauf bedingt auf ihren Abbruch-Endstatus setzen."""
    for step in store.pipeline_steps(row["id"]):
        wanted = {"running": "fail", "pending": "skipped"}.get(step["state"])
        if wanted is not None:
            store.pipeline_step_transition(
                row["id"], step["position"], step["state"], wanted
            )
    started = row.get("started_at") or store.now_ms()
    store.pipeline_run_finish_if_open(
        row["id"], "fail", max(0, store.now_ms() - started), reason
    )


def _last_activity(run_id, position):
    """Letzte Ausgabe (mtime, Sekunden) des laufenden Schritts; None ohne Datei."""
    base = _step_base(run_id, position)
    times = []
    for path in (base + ".out", base + ".err"):
        try:
            times.append(os.path.getmtime(path))
        except OSError:
            pass
    return max(times) if times else None


def _read_pid(path):
    try:
        with open(path, encoding="ascii") as handle:
            text = handle.read().strip()
    except OSError:
        return None
    return int(text) if text.isdigit() else None


def _stalled(row, stall, now):
    """Steht der Lauf eines lebenden Besitzers seit mehr als der Frist still?

    Normalerweise beendet der Besitzer einen stillen Schritt selbst nach
    `stall` Sekunden. Erst wenn das deutlich länger ausbleibt (Besitzer hängt),
    greift das Aufräumen ein.
    """
    if not stall or row.get("state") != "running":
        return False
    running = [
        step for step in store.pipeline_steps(row["id"])
        if step["state"] == "running"
    ]
    if not running:
        return False
    last = _last_activity(row["id"], running[0]["position"])
    if last is None:
        return False
    return now - last > stall + 2 * KILL_GRACE + 60


def _reap_abandoned(stall=None, now=None):
    """Verwaiste und stillstehende Läufe auf einen Endstatus setzen (T-113, T-145).

    Ein per `SIGKILL` beendeter Lauf kann seine Schritte und seinen Endstatus
    nicht mehr selbst schreiben. Der Kernel hat seine Besitzdatei aus
    `verifyslots` freigegeben; bekommt der nächste Laufstart sie, ist der Lauf
    verwaist. Er endet wie im Ausnahme-Aufräumen von `run()`: `running`-Schritte
    `fail`, `pending`-Schritte `skipped`, Lauf `fail`.

    Ein lebender Besitzer, dessen laufender Schritt länger als die
    Stillstands-Frist keine Ausgabe geschrieben hat, hängt selbst (T-145): Seine
    Schritt-Prozessgruppe und er selbst werden beendet, der Lauf endet mit
    `Abbruch: stillstehender Lauf …` und gibt seinen Prüfplatz frei. Gesunde
    lebende Läufe bleiben unberührt.

    Die Liste und die Besitzprüfung sind nur ein Vorfilter: Zwischen beiden
    kann der Besitzer fertig werden. Geschrieben wird deshalb ausschließlich
    bedingt (`pipeline_step_transition`, `pipeline_run_finish_if_open`) – ein
    bereits beendeter Lauf samt fertigen Schritten bleibt unangetastet.
    """
    stall = stall_seconds() if stall is None else stall
    now = time.time() if now is None else now
    for row in store.pipeline_run_list():
        if row.get("state") not in OPEN_STATES:
            continue
        try:
            if verifyslots.abandoned(row["id"]):
                _close_run(
                    row,
                    f"{ABORT_PREFIX}verwaister Lauf (Besitzer ohne Endstatus beendet)",
                )
                continue
            if not _stalled(row, stall, now):
                continue
            group = _read_pid(_group_path(row["id"]))
            if group is not None:
                _kill_group(group)
            owner = _read_pid(verifyslots.run_path(row["id"]))
            if owner is not None and owner != os.getpid():
                try:
                    os.kill(owner, signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    pass
            _close_run(
                row,
                f"{ABORT_PREFIX}stillstehender Lauf (über {stall:g} s ohne "
                "Ausgabe, Besitzer reagierte nicht)",
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
    on_start=None,
):
    """Alle Schritte ausführen und den Lauf speichern.

    `on_start` bekommt die Lauf-Id, sobald der Lauf samt Besitzdatei steht
    (T-143). `fab verify` startet den Lauf in einem gelösten Kind und reicht
    die Id damit an den Aufrufer weiter; der Aufrufer kann sterben, ohne den
    Lauf zu verlieren.
    """
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
    reason = ""
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
        if on_start is not None:
            on_start(run_id)
        for position, step in enumerate(steps):
            store.pipeline_step_add(
                run_id, position, step["name"], step["run"], "pending"
            )
        capacity = verifyslots.limit()
        slot = verifyslots.acquire(
            capacity,
            on_poll=_reap_abandoned,
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
            code, out, err = _execute(
                command, worktree, step_timeout, run_id=run_id, position=position,
                env=_step_env(),
            )
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
                reason = _abort_reason(name, code, out, err, step_timeout)
    except BaseException as exc:
        # Jeder Aufräumschritt zählt einzeln: Ein Fehler beim Speichern darf
        # weder den Lauf auf `running` lassen noch die ursprüngliche Ausnahme
        # verdecken. Aufräumfehler gehen an stderr und als `__cause__` mit.
        if run_id is None:
            raise
        if not reason:
            reason = f"{ABORT_PREFIX}unterbrochen ({type(exc).__name__})"
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
                run_id, "fail", store.now_ms() - start, reason
            ),
        )
        if cleanup_errors:
            raise exc from cleanup_errors[-1]
        raise
    else:
        # Endstatus vor dem Freigeben des Besitzes: Solange der Lauf offen ist,
        # hält dieser Prozess seine Besitzdatei, und kein Aufräumen greift ein.
        store.pipeline_run_finish(
            run_id, "fail" if failed else "pass", store.now_ms() - start, reason
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
        "reason": reason,
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


def open_run(ticket, head):
    """Jüngster offener Lauf für Ticket und HEAD; sonst None (T-143).

    `fab verify` nimmt so einen laufenden oder wartenden Lauf wieder auf,
    statt einen zweiten für denselben Stand zu starten.
    """
    for row in reversed(store.pipeline_run_list(ticket)):
        if row["state"] in OPEN_STATES and (row.get("head") or "") == (head or ""):
            return row
    return None


def result_of(run_id):
    """Gespeichertes Laufergebnis in der Form von `run()` (T-143).

    Der gelöste Lauf schreibt Schritte und Endstatus in die Ablage; der
    Aufrufer liest das Ergebnis daraus, auch wenn er den Lauf nicht selbst
    ausgeführt hat.
    """
    row = store.pipeline_run_load(run_id)
    if row is None:
        raise FabError(f"Pipeline-Lauf {run_id} existiert nicht")
    steps = store.pipeline_steps(run_id)
    out_parts = [step.get("stdout") or "" for step in steps]
    err_parts = [step.get("stderr") or "" for step in steps]
    combined = []
    for out, err in zip(out_parts, err_parts):
        combined.append(out)
        combined.append(err)
    code = 0
    for step in steps:
        if step["state"] == "fail":
            code = step.get("exit_code")
            code = 1 if code is None else code
            break
    return {
        "state": row["state"],
        "head": row.get("head") or "",
        "tail": _tail(combined),
        "code": code if row["state"] == "fail" else 0,
        "reason": row.get("reason") or "",
        "run_id": run_id,
        "stdout": "".join(out_parts),
        "stderr": "".join(err_parts),
        "steps": [
            {
                "position": step["position"],
                "name": step["name"],
                "command": step["command"],
                "state": step["state"],
                "duration_ms": step["duration_ms"],
                "exit_code": step["exit_code"],
                "stdout": step.get("stdout") or "",
                "stderr": step.get("stderr") or "",
            }
            for step in steps
        ],
    }


def wait_run(run_id, poll=0.05, on_queue=None):
    """Warten, bis der Lauf einen Endstatus hat, und ihn zurückgeben (T-143).

    Der Aufrufer ist nicht der Besitzer; lebt der Besitzer nicht mehr, wird der
    Lauf wie beim nächsten Start aufgeräumt (`_reap_abandoned`) und endet als
    Abbruch mit Grund. `on_queue` läuft genau einmal, sobald der Lauf in der
    Warteschlange steht.
    """
    announced = False
    while True:
        row = store.pipeline_run_load(run_id)
        if row is None:
            raise FabError(f"Pipeline-Lauf {run_id} existiert nicht")
        if row["state"] not in OPEN_STATES:
            return result_of(run_id)
        if row["state"] == "queued" and on_queue is not None and not announced:
            announced = True
            on_queue(row)
        if verifyslots.abandoned(run_id):
            _reap_abandoned()
        time.sleep(poll)

