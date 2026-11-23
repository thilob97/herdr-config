"""Systemweite Slots für gleichzeitige Prüfläufe (Ticket T-105).

Ein Slot ist eine exklusiv angelegte PID-Datei unter
`<FAB_HOME>/verify-slots/slot-<i>.lock`. PID-Dateien statt eines Zählers,
weil ein mit `kill -9` beendeter Prozess keinen Zähler dekrementiert: Der
nächste Wartende liest die PID und prüft mit `os.kill(pid, 0)`, ob sie noch
lebt; tote Slots werden freigegeben. Ein `flock` wäre ebenfalls möglich; die
PID-Prüfung ist hier bewusst gewählt, weil die Datei zugleich den Halter
benennt. Restrisiko: Eine wiederverwendete PID eines fremden Prozesses hält
den Slot scheinbar am Leben.
"""
import errno
import os
import time

from . import agents, store, teams

DEFAULT_MAX_VERIFY = 2
STALE_SECONDS = 5


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
    """Ein belegter Slot; `release()` ist idempotent und räumt die PID-Datei ab."""

    def __init__(self, index, path, fd=None):
        self.index = index
        self.path = path
        self._fd = fd
        self._released = False

    def release(self):
        if self._released:
            return
        self._released = True
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None
        try:
            os.unlink(self.path)
        except OSError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.release()
        return False

    def __repr__(self):
        return f"Slot({self.index}, {self.path!r})"


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError as exc:
        return exc.errno != errno.ESRCH
    return True


def _reap(path):
    """Toten oder kaputten Slot entfernen; True bedeutet: Datei ist weg."""
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read().strip()
    except FileNotFoundError:
        return True
    except OSError:
        return False
    try:
        pid = int(raw)
    except ValueError:
        # Gerade im Anlegen: leere/kaputte Dateien erst nach kurzer Frist räumen.
        try:
            age = time.time() - os.path.getmtime(path)
        except OSError:
            return False
        if age <= STALE_SECONDS:
            return False
        try:
            os.unlink(path)
        except OSError:
            return False
        return True
    if _pid_alive(pid):
        return False
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    except OSError:
        return False
    return True


def _try_acquire(directory, count):
    for index in range(count):
        path = os.path.join(directory, f"slot-{index}.lock")
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            continue
        try:
            os.write(fd, str(os.getpid()).encode("ascii"))
        except OSError:
            try:
                os.close(fd)
                os.unlink(path)
            except OSError:
                pass
            continue
        try:
            os.close(fd)
        except OSError:
            pass
        return Slot(index, path)
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
        for index in range(count):
            _reap(os.path.join(directory, f"slot-{index}.lock"))
        slot = _try_acquire(directory, count)
        if slot is not None:
            return slot
        if not announced:
            announced = True
            if on_wait is not None:
                on_wait()
        time.sleep(0.05)
