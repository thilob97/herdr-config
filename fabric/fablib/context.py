"""Projekt-Steckbrief und Team-Brief als Prompt-Kontext (T-59).

`build` bekommt (Titel, Text)-Abschnitte und kürzt sie sichtbar auf die
Zeichen-Obergrenze aus `fab settings set context_limit`. T-60 ergänzt die
Entscheidungen der Repos; T-61 nutzt dieselbe Ausgabe für die Vorschau.
"""
import os

from . import repos, teams
from .errors import FabError

DEFAULT_LIMIT = teams.DEFAULT_CONTEXT_LIMIT
PROJECT_TITLE = "Projekt-Steckbrief"
DECISION_TITLE = "Entscheidungen"
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
    if len(marker) > maximum:
        marker = "[…] gekürzt"
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


def _decision_section(paths):
    """Entscheidungs-Abschnitt der Repos; leer, wenn es keine Einträge gibt."""
    lines = repos.decisions_many(paths, repos.DECISION_LIMIT)
    if not lines:
        return []
    return [(DECISION_TITLE, "\n".join(f"- {line}" for line in lines))]


def build_paths(paths, brief="", maximum=DEFAULT_LIMIT, fallback_source=""):
    """Steckbriefe, Entscheidungen und Brief; der Hinweis nennt alle Quellen.

    Der Brief steht hinten und wird darum zuerst gekürzt. Sobald er im
    Kontext steht, nennt der Hinweis deshalb auch `fallback_source`
    (die Team-Konfiguration), nicht nur die Steckbrief- und
    Entscheidungs-Pfade.
    """
    sections, found = _project_sections(paths)
    sections += _decision_section(paths)
    sources = list(found) + repos.decision_paths(paths)
    if (brief or "").strip() and fallback_source:
        sources.append(fallback_source)
    source = ", ".join(sources) or fallback_source
    return build(sections, brief, maximum, source)


def team_of(roster, repo):
    """Team des Repos, sonst None; ein fremdes Team liefert keinen Brief."""
    return teams.team_for_repo(roster, repo) if repo else None


def for_entry(roster, entry, paths=None):
    """Kontext eines Teams; ohne `paths` die Repos des Teams."""
    if not isinstance(entry, dict):
        raw = paths if paths is not None else ()
        brief = ""
    else:
        raw = paths if paths is not None else (entry.get("repos") or ())
        brief = str(entry.get("brief") or "")
    return build_paths(
        raw,
        brief,
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
