"""Promptdateien lesen, zeigen und schreiben (Abschnitt 3b des Vertrags)."""
import os
import re
import stat

from . import events, git, index, store
from .errors import FabError

PLACEHOLDER_RE = re.compile(r"\{([a-z][a-z0-9_-]*)\}")
# Platzhalter, die `agents.start_prompt` füllt (Abschnitt 5 des Vertrags).
KNOWN = ("id", "title", "agent", "role", "worktree", "branch", "base", "reviewer")
ORCHESTRATOR = "orchestrator"
PREAMBLE = "preamble"
PREAMBLE_PATH = "prompts/preamble.md"


def placeholders(text):
    """Alle `{platzhalter}` in der Reihenfolge des ersten Vorkommens."""
    found = []
    for match in PLACEHOLDER_RE.finditer(text or ""):
        name = match.group(1)
        if name not in found:
            found.append(name)
    return found


def unknown_placeholders(text):
    return [name for name in placeholders(text) if name not in KNOWN]


def _mode(path, fallback):
    try:
        return stat.S_IMODE(os.stat(path).st_mode)
    except OSError:
        return fallback


def _abs(roster, rel):
    return rel if os.path.isabs(rel) else os.path.join(roster["dir"], rel)


def _resolve(roster, name):
    """→ (kind, relativer Pfad) für `orchestrator`, `preamble` oder einen Agenten."""
    value = (name or "").strip()
    if not value:
        raise FabError("Prompt-Name fehlt")
    if value == ORCHESTRATOR:
        return ORCHESTRATOR, roster["orchestrator"]["prompt"]
    if value == PREAMBLE:
        return PREAMBLE, PREAMBLE_PATH
    for entry in roster["agents"]:
        if entry["name"] == value:
            return "agent", entry["prompt"]
    known = [ORCHESTRATOR, PREAMBLE] + [entry["name"] for entry in roster["agents"]]
    raise FabError(
        f"Unbekannter Prompt „{value}“; vorhanden: {', '.join(known)}"
    )


def entries(roster):
    rows = []
    sources = [
        (ORCHESTRATOR, ORCHESTRATOR, roster["orchestrator"]["prompt"]),
        (PREAMBLE, PREAMBLE, PREAMBLE_PATH),
    ]
    sources += [
        (entry["name"], "agent", entry["prompt"]) for entry in roster["agents"]
    ]
    for name, kind, rel in sources:
        path = _abs(roster, rel)
        try:
            with open(path, "rb") as handle:
                raw = handle.read()
        except OSError:
            raw = b""
        rows.append(
            {
                "name": name,
                "kind": kind,
                "path": os.path.abspath(path),
                "bytes": len(raw),
                "placeholders": placeholders(raw.decode("utf-8", "replace")),
            }
        )
    return rows


def show(roster, name):
    _kind, rel = _resolve(roster, name)
    path = _abs(roster, rel)
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except FileNotFoundError:
        raise FabError(f"Prompt fehlt: {path}")
    except OSError as exc:
        raise FabError(f"Prompt nicht lesbar: {path}: {exc}")


def save(roster, name, text, actor):
    """Speichert den Rohtext atomar. Rückgabe: (Pfad, Bytes, unbekannte Platzhalter)."""
    _kind, rel = _resolve(roster, name)
    path = _abs(roster, rel)
    store.atomic_write(path, text, mode=_mode(path, 0o644))
    size = len(text.encode("utf-8"))
    events.append("config", "", actor, "", f"Prompt {rel} gespeichert ({size} Bytes)")
    index.rebuild()
    git.commit_paths(
        path, [path], f"chore(prompt): {rel} gespeichert ({size} Bytes)"
    )
    return path, size, unknown_placeholders(text)
