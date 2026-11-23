"""Projekt-Steckbrief und Team-Brief als Prompt-Kontext (T-59).

`build_paths` bekommt (Titel, Text)-Abschnitte und kürzt sie sichtbar auf
die Zeichen-Obergrenze aus `fab settings set context_limit`. T-60 ergänzt
die Entscheidungen der Repos; T-61 nutzt dieselbe Ausgabe für die Vorschau.
"""
import os

from . import repos, teams
from .errors import FabError

DEFAULT_LIMIT = teams.DEFAULT_CONTEXT_LIMIT
PROJECT_TITLE = "Projekt-Steckbrief"
DECISION_TITLE = "Entscheidungen"
WISSEN_TITLE = "Wissensordner"
BRIEF_TITLE = "Team-Brief"
HINT = "[…] gekürzt, vollständig in {source}"
SHORT_HINT = "[…] gekürzt"
# Kürzester vollständiger Hinweis; `fab settings` weist kleinere Grenzen ab.
MIN_LIMIT = len(SHORT_HINT)
# Den Entscheidungen bleibt mindestens ein Viertel der Grenze.
DECISION_RESERVE = 4


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


def clip(text, maximum, source="", report=False):
    """Auf höchstens `maximum` Zeichen kürzen; der Hinweis nennt den Pfad.

    `maximum == 0` schaltet den Kontext ab. Liegt `maximum` unter der Länge
    des kürzesten Hinweises, bleibt der Hinweis trotzdem vollständig; `fab
    settings` weist solche Werte ab. Mit `report=True` kommt
    `{"text", "clipped"}` zurück; `clipped` stammt aus dem Kürzen selbst und
    nicht aus einer Textsuche.
    """
    def result(value, clipped):
        return {"text": value, "clipped": clipped} if report else value

    maximum = teams.check_context_limit(maximum)
    if maximum == 0:
        return result("", False)
    if len(text) <= maximum:
        return result(text, False)
    marker = "\n\n" + (
        HINT.format(source=source) if source else SHORT_HINT
    )
    if len(marker) > maximum:
        marker = SHORT_HINT
    room = maximum - len(marker)
    if room < 1:
        return result(marker, True)
    return result(text[:room].rstrip() + marker, True)


def _fit_block(text, room, source):
    """Block auf `room` Zeichen; ohne Platz für den Hinweis entfällt er ganz."""
    if not text:
        return "", False
    if len(text) <= room:
        return text, False
    if room < MIN_LIMIT:
        return "", True
    cut = clip(text, room, source, report=True)
    return cut["text"], cut["clipped"]


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


def _knowledge_sections(paths):
    """(Abschnitte, Ordnerpfade) für die Wissensordner der Repos.

    Der Abschnitt nennt nur den absoluten Ordnerpfad und die Dateinamen,
    keine Dateiinhalte.
    """
    found = []
    for raw in paths or ():
        top, folder = repos.knowledge_path(raw)
        if not folder:
            continue
        files = repos.knowledge_files(raw)
        if not files:
            continue
        label = os.path.basename(top or os.path.abspath(os.path.expanduser(str(raw))))
        found.append((label, folder, files))
    sections = [
        (
            WISSEN_TITLE if len(found) == 1 else f"{WISSEN_TITLE}: {label}",
            "\n\n".join(
                [folder, "\n".join(f"- {row['name']}" for row in files)]
            ),
        )
        for label, folder, files in found
    ]
    return sections, [folder for _label, folder, _files in found]


def _decision_block(lines):
    """Abschnitt aus Entscheidungszeilen (älteste zuerst); leer ohne Einträge."""
    if not lines:
        return ""
    return compose([(DECISION_TITLE, "\n".join(f"- {line}" for line in lines))])


def _clip_decisions(lines, maximum, source=""):
    """Entscheidungen auf `maximum`; die neuesten Einträge bleiben stehen."""
    text = _decision_block(lines)
    if len(text) <= maximum:
        return text, False
    marker = "\n\n" + (
        HINT.format(source=source) if source else SHORT_HINT
    )
    if len(marker) > maximum:
        marker = SHORT_HINT
    header = f"## {DECISION_TITLE}\n\n"
    room = maximum - len(header) - len(marker)
    if room < 1:
        return marker, True
    kept = []
    used = 0
    for line in reversed(lines):
        piece = f"- {line}"
        need = len(piece) + (1 if kept else 0)
        if used + need > room:
            break
        kept.append(piece)
        used += need
    if not kept:
        kept = [f"- {lines[-1]}"[:room]]
    return header + "\n".join(reversed(kept)) + marker, True


def build_paths(paths, brief="", maximum=DEFAULT_LIMIT, fallback_source="",
                report=False):
    """Steckbriefe, Entscheidungen, Wissensordner und Brief.

    Gesamtlänge zählt alle vier. Die neuesten Entscheidungen behalten
    mindestens `1/DECISION_RESERVE` der Grenze. Danach bekommt der
    Wissensordner seinen Platz (er ist nur ein Zeiger), dann der Steckbrief,
    zuletzt der Brief. Der Hinweis nennt nur die Quellen, deren Text
    tatsächlich fehlt.
    """
    maximum = teams.check_context_limit(maximum)
    sections, found = _project_sections(paths)
    project_text = compose(sections)
    brief_text = (brief or "").strip()
    brief_block = compose([(BRIEF_TITLE, brief_text)]) if brief_text else ""
    decision_lines = repos.decisions_many(paths, repos.DECISION_LIMIT)
    decision_text = _decision_block(decision_lines)
    decision_source = ", ".join(repos.decision_paths(paths))
    knowledge_sections, knowledge_found = _knowledge_sections(paths)
    knowledge_text = compose(knowledge_sections)
    knowledge_source = ", ".join(knowledge_found)
    brief_source = fallback_source if brief_block else ""
    project_source = ", ".join(found)
    if brief_block and fallback_source:
        project_source = ", ".join(list(found) + [fallback_source])

    if not maximum:
        return {"text": "", "clipped": False} if report else ""

    clipped = False
    blocks = [
        part
        for part in (project_text, decision_text, knowledge_text, brief_block)
        if part
    ]
    if len("\n\n".join(blocks)) > maximum:
        # Freier Platz nach dem Steckbrief, mindestens das reservierte Viertel.
        # Der Brief zählt nicht mit: er wird zuerst gekürzt und verdrängt
        # keine Entscheidungen.
        budget = max(
            maximum // DECISION_RESERVE,
            MIN_LIMIT,
            maximum - len(project_text) - (2 if project_text else 0),
        )
        if decision_lines:
            decision_text, clipped = _clip_decisions(
                decision_lines, budget, decision_source
            )

    room = maximum - len(decision_text)
    if decision_text:
        room -= 2
    room = max(room, 0)
    # Der Wissensordner ist nur ein Zeiger; er bekommt seinen Platz zuerst
    # und die Dateiliste wird vor dem Steckbrief gekürzt.
    if knowledge_text:
        knowledge_text, knowledge_clipped = _fit_block(
            knowledge_text, room, knowledge_source
        )
        clipped = clipped or knowledge_clipped
        if knowledge_text:
            room = max(room - len(knowledge_text) - 2, 0)
    if project_text and len(project_text) > room:
        project_text, project_clipped = _fit_block(
            project_text, room, project_source
        )
        clipped = clipped or project_clipped
        # Ohne Platz für den Steckbrief entfällt auch der Brief.
        brief_block = ""
    elif project_text:
        rest = room - len(project_text)
        if brief_block:
            rest = max(rest - 2, 0)
            brief_block, brief_clipped = _fit_block(
                brief_block, rest, brief_source
            )
            clipped = clipped or brief_clipped
    elif brief_block:
        brief_block, brief_clipped = _fit_block(
            brief_block, room, brief_source
        )
        clipped = clipped or brief_clipped

    text = "\n\n".join(
        part
        for part in (project_text, decision_text, knowledge_text, brief_block)
        if part
    )
    if report:
        return {"text": text, "clipped": clipped}
    return text


def team_of(roster, repo):
    """Team des Repos, sonst None; ein fremdes Team liefert keinen Brief."""
    return teams.team_for_repo(roster, repo) if repo else None


def for_entry(roster, entry, paths=None, report=False):
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
        report=report,
    )


def for_ticket(roster, ticket, report=False):
    """Kontext eines Agenten: Steckbrief des Ticket-Repos und Team-Brief."""
    repo = ticket.get("repo")
    entry = team_of(roster, repo)
    return for_entry(roster, entry, [repo] if repo else [], report=report)


def for_team(roster, name, report=False):
    """Kontext eines Orchestrators: Steckbriefe aller Team-Repos und Brief."""
    return for_entry(roster, teams.team(roster, name), report=report)
