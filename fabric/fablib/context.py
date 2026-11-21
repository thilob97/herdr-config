"""Projekt-Steckbrief und Team-Brief als Prompt-Kontext (T-59).

`build` bekommt (Titel, Text)-Abschnitte und kürzt sie sichtbar auf die
Zeichen-Obergrenze aus `fab settings set context_limit`. T-60 hängt dort
weitere Abschnitte an; T-61 nutzt dieselbe Ausgabe für die Vorschau.
"""
import os

from . import repos, teams
from .errors import FabError

DEFAULT_LIMIT = teams.DEFAULT_CONTEXT_LIMIT
PROJECT_TITLE = "Projekt-Steckbrief"
BRIEF_TITLE = "Team-Brief"
HINT = "[…] gekürzt, vollständig in {source}"


def limit(roster):
    """Obergrenze aus dem geladenen Roster; ungültige Werte fallen zurück."""
    raw = roster.get("context_limit") if isinstance(roster, dict) else None
    if raw is None:
        return DEFAULT_LIMIT
    try:
        return teams.check_context_limit(raw)
    except FabError:
        return DEFAULT_LIMIT


def compose(sections):
    """(Titel, Text)-Abschnitte zu Markdown; leere Abschnitte fallen weg."""
    parts = []
    for title, body in sections:
        text = (body or "").strip()
        if text:
            parts.append(f"## {title}\n\n{text}")
    return "\n\n".join(parts)


def clip(text, maximum, source=""):
    """Auf höchstens `maximum` Zeichen kürzen; der Hinweis nennt den Pfad."""
    maximum = teams.check_context_limit(maximum)
    if len(text) <= maximum:
        return text
    marker = "\n\n" + (
        HINT.format(source=source) if source else "[…] gekürzt"
    )
    room = maximum - len(marker)
    if room < 1:
        return marker[:maximum]
    return text[:room].rstrip() + marker


def build(sections, brief="", maximum=DEFAULT_LIMIT, source=""):
    """Kontext aus Abschnitten plus Team-Brief; sichtbar gekürzt."""
    entries = list(sections)
    if (brief or "").strip():
        entries.append((BRIEF_TITLE, brief))
    return clip(compose(entries), maximum, source)


def _project_sections(paths):
    """(Abschnitte, gefundene Pfade) für die Steckbriefe der Repos."""
    found = []
    for raw in paths or ():
        text = repos.project_text(raw)
        if not text or not text.strip():
            continue
        top, path = repos.project_path(raw)
        label = os.path.basename(top or os.path.abspath(os.path.expanduser(str(raw))))
        found.append((label, path, text))
    sections = [
        (
            PROJECT_TITLE if len(found) == 1 else f"{PROJECT_TITLE}: {label}",
            text,
        )
        for label, _path, text in found
    ]
    return sections, [path for _label, path, _text in found if path]


def build_paths(paths, brief="", maximum=DEFAULT_LIMIT, fallback_source=""):
    """Steckbriefe der Repos plus Brief; Hinweis auf den ersten gefundenen Pfad."""
    sections, found = _project_sections(paths)
    source = ", ".join(found) if found else fallback_source
    return build(sections, brief, maximum, source)


def team_of(roster, repo):
    """Team des Repos; ohne Treffer das erste Team, sonst None."""
    entry = teams.team_for_repo(roster, repo) if repo else None
    return entry if entry is not None else teams.first_team(roster)


def for_entry(roster, entry, paths=None):
    """Kontext eines Teams; ohne `paths` die Repos des Teams."""
    if not isinstance(entry, dict):
        return build([], "", limit(roster))
    raw = paths if paths is not None else (entry.get("repos") or ())
    return build_paths(
        raw,
        str(entry.get("brief") or ""),
        limit(roster),
        roster.get("path") or "",
    )


def for_ticket(roster, ticket):
    """Kontext eines Agenten: Steckbrief des Ticket-Repos und Team-Brief."""
    repo = ticket.get("repo")
    entry = team_of(roster, repo)
    return for_entry(roster, entry, [repo] if repo else [])


def for_team(roster, name):
    """Kontext eines Orchestrators: Steckbriefe aller Team-Repos und Brief."""
    return for_entry(roster, teams.team(roster, name))
