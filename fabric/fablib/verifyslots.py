"""Systemweite Slots für gleichzeitige Prüfläufe (Ticket T-105).

Ein Slot ist eine dauerhafte Datei unter `<FAB_HOME>/verify-slots/slot-<i>.lock`,
die exklusiv per `flock` belegt wird. Die Sperre hält der Kernel und gibt sie
beim Prozessende frei – auch nach `SIGKILL`. Ein getöteter Lauf kann den Slot
damit nicht blockieren. Die Dateien werden bewusst nie gelöscht: Wartende
können Deskriptoren auf dieselbe Datei offen halten, und ein Unlink mit
Neuanlegen würde ein zweites Lock auf einer neuen Datei erlauben – das Limit
wäre gebrochen. Die PID im Inhalt dient nur der Diagnose; PID-Wiederverwendung
ist damit unkritisch.

Ein Lauf belegt zusätzlich eine Besitzdatei
`<FAB_HOME>/verify-runs/run-<id>.lock` (Ticket T-113). Auch sie hält der
Kernel: Ein später startender Lauf erkennt daran, dass der Besitzer eines
`queued`/`running`-Laufs nicht mehr lebt, und kann den Lauf aufräumen.
"""
import errno
import fcntl
import os
import re
import time
from contextlib import contextmanager

from . import agents, store, teams
from .errors import FabError

DEFAULT_MAX_VERIFY = 2
WAIT_TIMEOUT_DEFAULT = 1800.0


def wait_timeout():
    """Zeitlimit fürs Warten auf einen Slot aus `FAB_VERIFY_WAIT` (Sekunden)."""
    raw = os.environ.get("FAB_VERIFY_WAIT")
    if raw is None or not str(raw).strip():
        return WAIT_TIMEOUT_DEFAULT
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return WAIT_TIMEOUT_DEFAULT
    return value if value >= 0 else WAIT_TIMEOUT_DEFAULT


def limit(roster=None):
    """Systemweites Limit; fehlt oder ungültig ⇒ 2. Wirft nie nach außen."""
    try:
        data = roster if roster is not None else agents.load(required=False)
        raw = (data or {}).get("max_verify")
        return teams.check_verify(raw)
    except Exception:  # noqa: BLE001 - ein kaputter Roster darf nicht klemmen
        return DEFAULT_MAX_VERIFY


def slot_dir():
    path = os.path.join(store.home(), "verify-slots")
    os.makedirs(path, exist_ok=True)
    return path


def run_dir():
    path = os.path.join(store.home(), "verify-runs")
    os.makedirs(path, exist_ok=True)
    return path


def run_path(run_id):
    return os.path.join(run_dir(), f"run-{int(run_id)}.lock")


def start_dir():
    path = os.path.join(store.home(), "verify-starts")
    os.makedirs(path, exist_ok=True)
    return path


def start_path(ticket, head):
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", f"{ticket}-{head or 'ohne-head'}")
    return os.path.join(start_dir(), f"{safe}.lock")


@contextmanager
def start_claim(ticket, head):
    """Startfenster für Ticket und HEAD serialisieren (T-143).

    Zwischen „kein offener Lauf“ und „Lauf samt Besitzdatei angelegt“ darf kein
    zweiter Aufrufer einen zweiten Lauf für denselben Stand starten. Die Sperre
    hält nur dieses kurze Fenster, nicht den Lauf; den hält seine Besitzdatei.
    Wie die Slotdateien wird sie nie gelöscht: Ein Unlink mit Neuanlegen würde
    zwei Sperren auf zwei Dateien erlauben.
    """
    fd = os.open(start_path(ticket, head), os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            os.ftruncate(fd, 0)
            os.write(fd, str(os.getpid()).encode("ascii"))
        except OSError:
            pass
        yield
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass


class _LockFile:
    """Eine gehaltene `flock`-Datei; `release()` ist idempotent."""

    def __init__(self, path, fd=None):
        self.path = path
        self._fd = fd
        self._released = False

    def release(self):
        if self._released:
            return
        self._released = True
        fd = self._fd
        self._fd = None
        if fd is None:
            return
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.release()
        return False


class Slot(_LockFile):
    """Ein belegter Slot."""

    def __init__(self, index, path, fd=None):
        super().__init__(path, fd)
        self.index = index

    def __repr__(self):
        return f"Slot({self.index}, {self.path!r})"


class RunLock(_LockFile):
    """Besitz eines Laufs; existiert genau so lange wie sein Prozess."""

    def __init__(self, run_id, path, fd=None):
        super().__init__(path, fd)
        self.run_id = run_id

    def __repr__(self):
        return f"RunLock({self.run_id}, {self.path!r})"


def claim_run(run_id):
    """Besitzdatei eines Laufs belegen; der Prozess hält sie bis zum Ende.

    Die Lauf-Id ist prozessweit eindeutig, es gibt also keinen Wettbewerb um
    dieselbe Datei – `flock` blockiert hier nie.
    """
    path = run_path(run_id)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o644)
    fcntl.flock(fd, fcntl.LOCK_EX)
    try:
        os.ftruncate(fd, 0)
        os.write(fd, str(os.getpid()).encode("ascii"))
    except OSError:
        pass
    return RunLock(run_id, path, fd)


def abandoned(run_id):
    """True, wenn kein lebender Prozess den Lauf mehr besitzt.

    Belegen wir das `flock`, ist der Besitzer tot – auch nach `SIGKILL` gibt
    der Kernel es frei. Ein lebender Besitzer hält es, dann bleibt es bei
    False. Die Datei wird dabei höchstens angelegt, nie gelöscht.
    """
    fd = os.open(run_path(run_id), os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        os.close(fd)
        if exc.errno in (errno.EACCES, errno.EAGAIN):
            return False
        raise
    try:
        fcntl.flock(fd, fcntl.LOCK_UN)
    except OSError:
        pass
    os.close(fd)
    return True


def _try_acquire(directory, count):
    for index in range(count):
        path = os.path.join(directory, f"slot-{index}.lock")
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(fd)
            if exc.errno in (errno.EACCES, errno.EAGAIN):
                continue
            raise
        try:
            os.ftruncate(fd, 0)
            os.write(fd, str(os.getpid()).encode("ascii"))
        except OSError:
            pass
        return Slot(index, path, fd)
    return None


def acquire(limit, on_wait=None, timeout=None, on_poll=None, poll_every=30.0):
    """Einen Slot belegen; `on_wait` läuft genau einmal, bevor gewartet wird.

    `timeout` ist das Warte-Zeitlimit in Sekunden (Standard: `wait_timeout()`).
    Danach endet der Aufruf mit `FabError` statt endlos zu hängen; der Lauf
    wird dadurch als `fail` gespeichert. `on_poll` läuft beim Warten alle
    `poll_every` Sekunden, damit ein stillstehender Lauf seinen Slot an den
    Wartenden freigeben muss (T-145).
    """
    try:
        count = int(limit)
    except (TypeError, ValueError):
        count = DEFAULT_MAX_VERIFY
    count = max(teams.MIN_VERIFY, count)
    if timeout is None:
        limit_seconds = wait_timeout()
    else:
        try:
            limit_seconds = float(timeout)
        except (TypeError, ValueError):
            limit_seconds = wait_timeout()
    directory = slot_dir()
    announced = False
    began = time.monotonic()
    polled = began
    while True:
        slot = _try_acquire(directory, count)
        if slot is not None:
            return slot
        waited = time.monotonic() - began
        if limit_seconds is not None and waited >= limit_seconds:
            raise FabError(
                f"Warteschlange: nach {waited:.0f} s kein Prüfslot frei "
                f"(max. {count} gleichzeitig). Laufende Prüfläufe abwarten "
                f"oder FAB_VERIFY_WAIT erhöhen."
            )
        if not announced:
            announced = True
            if on_wait is not None:
                on_wait()
        if on_poll is not None and time.monotonic() - polled >= poll_every:
            polled = time.monotonic()
            on_poll()
        time.sleep(0.05)
