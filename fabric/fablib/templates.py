"""Ticket-Vorlagen lesen, zeigen und speichern (T-37).

Vorlagen liegen neben dem aktiven Roster (`FAB_ROSTER` bzw. `templates/` im
Fabric-Ordner); fehlt eine Vorlage dort, gilt die mitgelieferte Fassung aus
`fabric/templates/`. `list` führt beide Quellen zusammen, lokal gewinnt.
"""
import os
import re
import stat

from . import agents, events, git, index, store
from .errors import FabError

NAME_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
DEFAULT_ORDER = ("bug", "feature", "refactor", "chore")
PLACEHOLDER = "{satz}"


def validate_name(name):
    value = (name or "").strip()
    if not NAME_RE.match(value):
        raise FabError(
            f"Ungültiger Vorlagename: „{name}“ "
            f"(erlaubt: Buchstabe, dann Buchstaben, Ziffern, _ und -)"
        )
    return value


def directory():
    """Ordner der aktiven Vorlagen: `FAB_TEMPLATES` oder neben dem Roster."""
    raw = os.environ.get("FAB_TEMPLATES")
    if raw:
        return os.path.abspath(os.path.expanduser(raw))
    return os.path.join(os.path.dirname(agents.roster_path()), "templates")


def packaged_directory():
    """Mitgelieferte Vorlagen im Fabric-Code."""
    return os.path.join(agents.FABRIC_DIR, "templates")


def _path(where, name):
    return os.path.join(where, f"{name}.md")


def _mode(path, fallback):
    try:
        return stat.S_IMODE(os.stat(path).st_mode)
    except OSError:
        return fallback


def _read(path):
    with open(path, "rb") as handle:
        return handle.read()


def _candidates(name):
    """Vorhandene Dateien in Reihenfolge: aktiv, dann mitgeliefert."""
    found = []
    for where in (directory(), packaged_directory()):
        path = _path(where, name)
        if os.path.isfile(path):
            found.append(path)
    return found


def _sort_key(row):
    name = row["name"]
    if name in DEFAULT_ORDER:
        return (0, DEFAULT_ORDER.index(name), name)
    return (1, 0, name)


def entries():
    """Alle Vorlagen, lokal vor mitgeliefert, in fester Reihenfolge."""
    rows = {}
    for where in (directory(), packaged_directory()):
        try:
            names = sorted(os.listdir(where))
        except OSError:
            continue
        for filename in names:
            if not filename.endswith(".md"):
                continue
            name = filename[:-3]
            if not NAME_RE.match(name) or name in rows:
                continue
            path = _path(where, name)
            try:
                raw = _read(path)
            except OSError:
                continue
            rows[name] = {
                "name": name,
                "path": os.path.abspath(path),
                "bytes": len(raw),
            }
    return sorted(rows.values(), key=_sort_key)


def show(name):
    """Rohtext der Vorlage; unbekannt → FabError mit vorhandenen Namen."""
    value = validate_name(name)
    for path in _candidates(value):
        try:
            with open(path, encoding="utf-8") as handle:
                return handle.read()
        except OSError as exc:
            raise FabError(f"Vorlage nicht lesbar: {path}: {exc}")
    known = [row["name"] for row in entries()]
    if not known:
        raise FabError(f"Unbekannte Vorlage „{value}“; es gibt keine Vorlagen")
    raise FabError(
        f"Unbekannte Vorlage „{value}“; vorhanden: {', '.join(known)}"
    )


def save(name, text, actor):
    """Speichert die Vorlage atomar im aktiven Ordner. Rückgabe: (Pfad, Bytes)."""
    value = validate_name(name)
    path = _path(directory(), value)
    store.atomic_write(path, text, mode=_mode(path, 0o644))
    size = len(text.encode("utf-8"))
    events.append("config", "", actor, "", f"Vorlage {value} gespeichert ({size} Bytes)")
    index.rebuild()
    git.commit_paths(
        path,
        [path],
        f"chore(template): templates/{value}.md gespeichert ({size} Bytes)",
    )
    return path, size


def render(text, sentence):
    """Setzt `{satz}` in der Vorlage ein."""
    return (text or "").replace(PLACEHOLDER, sentence or "")
