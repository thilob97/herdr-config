"""Testmuster: welche Dateien gelten als Logik, welche als Test (T-33).

Die Muster stehen optional in `.fabric/testpolicy.json` im Haupt-Checkout;
ohne Datei gelten die Standardmuster. `classify` ordnet geänderte Pfade den
beiden Gruppen zu; ein Eintrag mit `!` schließt Pfade aus.
"""
import json
import os
import re
from functools import lru_cache

from . import git
from .errors import FabError

POLICY = ".fabric/testpolicy.json"

DEFAULTS = {
    "logic": ["fabric/fablib/**/*.py", "mods/*/**/*.js", "!mods/*/views/**"],
    "tests": ["fabric/tests/test_*.py", "mods/*/test/**"],
}

STANDARD_SOURCE = "Standardmuster"


class Policy:
    """Geladene Testmuster: `logic`, `tests` und `source`."""

    def __init__(self, logic, tests, source):
        self.logic = list(logic)
        self.tests = list(tests)
        self.source = source


def _translate(pattern):
    """Glob zu Regex: `*` bleibt in einem Segment, `**` quert Segmente."""
    parts = ["^"]
    index = 0
    while index < len(pattern):
        if pattern.startswith("**/", index):
            parts.append("(?:.*/)?")
            index += 3
        elif pattern.startswith("**", index):
            parts.append(".*")
            index += 2
        elif pattern[index] == "*":
            parts.append("[^/]*")
            index += 1
        elif pattern[index] == "?":
            parts.append("[^/]")
            index += 1
        else:
            parts.append(re.escape(pattern[index]))
            index += 1
    parts.append("$")
    return "".join(parts)


@lru_cache(maxsize=None)
def _compiled(pattern):
    return re.compile(_translate(pattern))


def _normal(path):
    value = (path or "").replace(os.sep, "/")
    while value.startswith("./"):
        value = value[2:]
    return value


def _matches(patterns, path):
    """Positivmuster bejahen, `!`-Einträge schließen aus; case-sensitiv."""
    included = False
    for entry in patterns:
        if not entry:
            continue
        excluded = entry.startswith("!")
        pattern = entry[1:] if excluded else entry
        if not pattern or not _compiled(pattern).match(path):
            continue
        if excluded:
            return False
        included = True
    return included


def classify(policy, paths):
    """Teilt `paths` in (Logikdateien, Testdateien); Reihenfolge bleibt."""
    logic = []
    tests = []
    for raw in paths:
        path = _normal(raw)
        if not path:
            continue
        if _matches(policy.logic, path):
            logic.append(raw)
        if _matches(policy.tests, path):
            tests.append(raw)
    return logic, tests


def _patterns(data, key, path):
    if key not in data:
        return list(DEFAULTS[key])
    value = data[key]
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise FabError(
            f"Testmuster {path}: Feld {key!r} muss eine Liste von Mustern sein"
        )
    return list(value)


def load(repo):
    """Muster aus dem Haupt-Checkout lesen; ohne Datei gelten die Standards."""
    root = git.main_toplevel(repo) or repo
    path = os.path.join(root, POLICY)
    if not os.path.isfile(path):
        return Policy(DEFAULTS["logic"], DEFAULTS["tests"], STANDARD_SOURCE)
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except OSError as exc:
        raise FabError(f"Testmuster {path} ist nicht lesbar: {exc}")
    except ValueError as exc:
        raise FabError(f"Testmuster {path}: ungültiges JSON ({exc})")
    if not isinstance(data, dict):
        raise FabError(f"Testmuster {path}: erwartet ein JSON-Objekt")
    return Policy(
        _patterns(data, "logic", path),
        _patterns(data, "tests", path),
        os.path.abspath(path),
    )
