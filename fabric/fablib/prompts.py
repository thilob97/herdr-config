"""Promptdateien lesen, zeigen und schreiben (Abschnitt 3b des Vertrags)."""
import os
import re
import stat

from . import events, git, index, store, teams
from .errors import FabError

PLACEHOLDER_RE = re.compile(r"\{([a-z][a-z0-9_-]*)\}")
# Platzhalter, die `agents.start_prompt` füllt (Abschnitt 5 des Vertrags).
KNOWN = (
    "id", "title", "agent", "role", "worktree", "branch", "base", "reviewer",
    "lessons", "context",
)
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


def _team_entry(roster, team):
    """Team-Eintrag zum Namen; nur der Orchestrator-Prompt ist teamweit."""
    if not team:
        return None
    for entry in roster.get("teams") or []:
        if isinstance(entry, dict) and entry.get("name") == team:
            return entry
    known = [
        str(entry.get("name"))
        for entry in roster.get("teams") or []
        if isinstance(entry, dict) and entry.get("name")
    ] or ["keins"]
    raise FabError(f"Unbekanntes Team: {team} (vorhanden: {', '.join(known)})")


def _agents(roster):
    """Alle Blaupausen; vor der Migration die expandierten Agenten."""
    entries = roster.get("blueprints")
    return entries if isinstance(entries, list) and entries else roster["agents"]


def _resolve(roster, name, team=None):
    """→ (kind, relativer Pfad) für `orchestrator`, `preamble` oder eine Blaupause."""
    value = (name or "").strip()
    if not value:
        raise FabError("Prompt-Name fehlt")
    if value == ORCHESTRATOR:
        entry = _team_entry(roster, team)
        if entry is not None:
            return ORCHESTRATOR, teams.orchestrator_config(entry)["prompt"]
        return ORCHESTRATOR, roster["orchestrator"]["prompt"]
    if value == PREAMBLE:
        return PREAMBLE, PREAMBLE_PATH
    for entry in _agents(roster):
        if entry.get("name") == value:
            return "agent", str(entry.get("prompt") or f"prompts/{value}.md")
    known = [ORCHESTRATOR, PREAMBLE] + [
        str(entry.get("name")) for entry in _agents(roster) if entry.get("name")
    ]
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
        (entry["name"], "agent", entry["prompt"]) for entry in _agents(roster)
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


def show(roster, name, team=None):
    _kind, rel = _resolve(roster, name, team)
    path = _abs(roster, rel)
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except FileNotFoundError:
        raise FabError(f"Prompt fehlt: {path}")
    except OSError as exc:
        raise FabError(f"Prompt nicht lesbar: {path}: {exc}")


def save(roster, name, text, actor, team=None):
    """Speichert den Rohtext atomar. Rückgabe: (Pfad, Bytes, unbekannte Platzhalter)."""
    _kind, rel = _resolve(roster, name, team)
    path = _abs(roster, rel)
    store.atomic_write(path, text, mode=_mode(path, 0o644))
    size = len(text.encode("utf-8"))
    events.append("config", "", actor, "", f"Prompt {rel} gespeichert ({size} Bytes)")
    index.rebuild()
    git.commit_paths(
        path, [path], f"chore(prompt): {rel} gespeichert ({size} Bytes)"
    )
    return path, size, unknown_placeholders(text)
