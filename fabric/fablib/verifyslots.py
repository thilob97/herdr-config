"""Systemweite Slots für gleichzeitige Prüfläufe (Ticket T-105).

Ein Slot ist eine dauerhafte Datei unter `<FAB_HOME>/verify-slots/slot-<i>.lock`,
die exklusiv per `flock` belegt wird. Die Sperre hält der Kernel und gibt sie
beim Prozessende frei – auch nach `SIGKILL`. Ein getöteter Lauf kann den Slot
damit nicht blockieren. Die Dateien werden bewusst nie gelöscht: Wartende
können Deskriptoren auf dieselbe Datei offen halten, und ein Unlink mit
Neuanlegen würde ein zweites Lock auf einer neuen Datei erlauben – das Limit
wäre gebrochen. Die PID im Inhalt dient nur der Diagnose; PID-Wiederverwendung
ist damit unkritisch.
"""
import errno
import fcntl
import os
import time

from . import agents, store, teams

DEFAULT_MAX_VERIFY = 2


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


class Slot:
    """Ein belegter Slot; `release()` ist idempotent und gibt das flock frei."""

    def __init__(self, index, path, fd=None):
        self.index = index
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

    def __repr__(self):
        return f"Slot({self.index}, {self.path!r})"


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


def acquire(limit, on_wait=None):
    """Einen Slot belegen; `on_wait` läuft genau einmal, bevor gewartet wird."""
    try:
        count = int(limit)
    except (TypeError, ValueError):
        count = DEFAULT_MAX_VERIFY
    count = max(teams.MIN_VERIFY, count)
    directory = slot_dir()
    announced = False
    while True:
        slot = _try_acquire(directory, count)
        if slot is not None:
            return slot
        if not announced:
            announced = True
            if on_wait is not None:
                on_wait()
        time.sleep(0.05)
