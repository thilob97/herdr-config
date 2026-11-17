"""Claude-Vertrauensmarke in `~/.claude.json`, nur ein Schlüssel, atomar.

Claude Code merkt sich pro Projektordner, ob der Vertrauensdialog beantwortet
ist: `projects["<absoluter pfad>"].hasTrustDialogAccepted`. `fab` setzt diesen
Schlüssel vor dem Start eines Claude-Agenten, damit der Dialog nicht im
Hintergrundterminal hängt. Die Datei enthält Zugangsdaten; sie wird nur
gelesen, ein Feld geändert und atomar ersetzt.
"""
import json
import os
import stat
import sys
import tempfile

ATTEMPTS = 3
KEY = "hasTrustDialogAccepted"


def config_path():
    raw = os.environ.get("FAB_CLAUDE_JSON") or "~/.claude.json"
    return os.path.abspath(os.path.expanduser(raw))


def is_claude(argv):
    """Erkennt den Claude-Start am Programmnamen, auch wenn er ein Pfad ist."""
    return bool(argv) and os.path.basename(str(argv[0])) == "claude"


def _warn(text):
    print(f"Warnung: {text}", file=sys.stderr)


def _read(path):
    with open(path, "rb") as handle:
        return handle.read()


def _decode(raw):
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("kein JSON-Objekt")
    return data


def _mark(data, folder):
    projects = data.get("projects")
    if not isinstance(projects, dict):
        projects = {}
        data["projects"] = projects
    entry = projects.get(folder)
    if not isinstance(entry, dict):
        entry = {}
        projects[folder] = entry
    entry[KEY] = True


def _already_trusted(data, folder):
    projects = data.get("projects")
    if not isinstance(projects, dict):
        return False
    entry = projects.get(folder)
    return isinstance(entry, dict) and entry.get(KEY) is True


def ensure_trust(folder):
    """Markiert `folder` als vertraut. Gibt bei Erfolg True zurück, warnt sonst."""
    if not folder or not os.path.isdir(folder):
        return False
    folder = os.path.realpath(folder)
    path = config_path()
    for _attempt in range(ATTEMPTS):
        try:
            info = os.stat(path)
            raw = _read(path)
        except FileNotFoundError:
            _warn(f"{path} fehlt; Claude fragt beim Start nach dem Vertrauen")
            return False
        except OSError as exc:
            _warn(f"{path} ist nicht lesbar ({exc}); Claude fragt nach dem Vertrauen")
            return False
        try:
            data = _decode(raw)
        except (UnicodeDecodeError, ValueError) as exc:
            _warn(f"{path} ist kein gültiges JSON ({exc}); Datei bleibt unverändert")
            return False
        if _already_trusted(data, folder):
            return True
        _mark(data, folder)
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"

        folder_path = os.path.dirname(path) or "."
        try:
            handle, tmp = tempfile.mkstemp(prefix=".claude-", suffix=".json", dir=folder_path)
        except OSError as exc:
            _warn(f"{path}: kein temporärer Ordner zum Schreiben ({exc})")
            return False
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                stream.write(text)
            os.chmod(tmp, stat.S_IMODE(info.st_mode))
            try:
                unchanged = _read(path) == raw
            except OSError:
                unchanged = False
            if not unchanged:
                os.unlink(tmp)
                continue
            os.replace(tmp, path)
            return True
        except OSError as exc:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            _warn(f"{path} konnte nicht geschrieben werden ({exc}); Claude fragt nach dem Vertrauen")
            return False
    _warn(f"{path} hat sich {ATTEMPTS}-mal während des Schreibens geändert; Datei bleibt unverändert")
    return False
