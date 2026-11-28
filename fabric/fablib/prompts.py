"""Prompts aus der Datenbank lesen, zeigen und schreiben (Abschnitt 3b)."""
import re

from . import events, index, store, teams
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
ORCHESTRATOR_PATH = "prompts/orchestrator.md"

# Untergrenze für eine frische Datenbank; bestehende Installationen migrieren
# ihre Dateien aus dem Rosterordner.
DEFAULTS = {
    PREAMBLE_PATH: (
        "# Ticket {id}: {title}\n\n"
        "Du bist {agent} ({role}) im Worktree {worktree} auf {branch} "
        "(Basis {base}). Prüferin ist {reviewer}.\n"
    ),
    ORCHESTRATOR_PATH: (
        "# Orchestrator\n\n"
        "Du formulierst den Satz des Menschen zu ausführbarer Arbeit um und "
        "verteilst sie an das Team. Du schreibst keinen Produktcode, du prüfst "
        "nicht selbst und du nimmst nichts ab: `accept` und `reject` gehören "
        "dem Menschen. Kein Merge, kein Push.\n\n"
        "## Lehren\n\n{lessons}\n\n## Kontext\n\n{context}\n"
    ),
}


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
    """→ (kind, relativer Schlüssel) für `orchestrator`, `preamble` oder eine Blaupause."""
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


def text(_roster, rel):
    """Prompttext aus der DB; fehlt er, ein deutscher Fehler."""
    stored = store.prompt_get(rel)
    if stored is None:
        raise FabError(f"Prompt fehlt: {rel}")
    return stored


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
        raw = store.prompt_get(rel) or ""
        rows.append(
            {
                "name": name,
                "kind": kind,
                "path": rel,
                "bytes": len(raw.encode("utf-8")),
                "placeholders": placeholders(raw),
            }
        )
    return rows


def show(roster, name, team=None):
    _kind, rel = _resolve(roster, name, team)
    return text(roster, rel)


def save(roster, name, text_value, actor, team=None):
    """Speichert den Rohtext in der DB. Rückgabe: (Schlüssel, Bytes, unbekannte Platzhalter)."""
    _kind, rel = _resolve(roster, name, team)
    store.prompt_set(rel, text_value)
    size = len(text_value.encode("utf-8"))
    events.append("config", "", actor, "", f"Prompt {rel} gespeichert ({size} Bytes)")
    index.rebuild()
    return rel, size, unknown_placeholders(text_value)
