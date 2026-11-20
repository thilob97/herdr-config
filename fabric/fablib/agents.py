"""Roster, Agentenstart und Orchestrator-Terminal."""
import json
import os
import re
import stat

from . import claude, hc, herdr, render, store, teams
from .errors import FabError, HcError, HerdrError

ORCHESTRATOR = hc.ORCHESTRATOR
FABRIC_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


def roster_path():
    raw = os.environ.get("FAB_ROSTER")
    if raw:
        return os.path.abspath(os.path.expanduser(raw))
    return os.path.join(FABRIC_DIR, "roster.json")


def _mode(path, fallback):
    try:
        return stat.S_IMODE(os.stat(path).st_mode)
    except OSError:
        return fallback


def _read(path, required):
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        if required:
            raise FabError(f"Roster fehlt: {path}")
        return None
    except json.JSONDecodeError as exc:
        raise FabError(f"Roster {path} ist kein gültiges JSON: {exc}")
    if not isinstance(data, dict):
        raise FabError(f"Roster {path} ist kein JSON-Objekt")
    return data


def _migrate(path, data):
    """Altes Roster einmalig zu Blaupausen und Team `herdr-app` umschreiben.

    Läuft beim ersten Lesen; ein zweiter Lauf findet `teams` und schreibt
    nichts. Der Schreibvorgang steht unter dem Store-Lock und überschreibt
    keine parallele Migration: nach dem Lock wird die Datei neu gelesen.
    """
    if not teams.migrate(data):
        return data
    from . import git, index

    try:
        with store.locked():
            fresh = _read(path, required=False) or data
            if not teams.migrate(fresh):
                return fresh
            store.atomic_write(
                path,
                json.dumps(fresh, ensure_ascii=False, indent=2) + "\n",
                mode=_mode(path, 0o644),
            )
            git.commit_paths(
                path,
                [path],
                f"chore(roster): Roster zu Team {teams.DEFAULT_TEAM} migriert",
            )
            index.rebuild()
            return fresh
    except OSError as exc:
        raise FabError(f"Roster {path} nicht migrierbar: {exc}")


def load(required=True):
    path = roster_path()
    data = _read(path, required)
    if data is None:
        return None
    data = _migrate(path, data)
    expanded = teams.expansion(data)
    return {
        "path": path,
        "dir": os.path.dirname(path),
        "max_sessions": expanded["max_sessions"],
        "max_sessions_total": expanded["max_sessions_total"],
        "reviewer": expanded["reviewer"],
        "agents": expanded["agents"],
        "orchestrator": expanded["orchestrator"],
        "team": expanded.get("team"),
        "teams": list(data.get("teams") or []),
        "blueprints": list(data.get("blueprints") or []),
    }


def agent(name, roster=None):
    roster = roster or load()
    for entry in roster["agents"]:
        if entry["name"] == name:
            return entry
    known = ", ".join(entry["name"] for entry in roster["agents"]) or "leer"
    raise FabError(f"Unbekannter Agent: {name} (Roster: {known})")


def roster_rows(roster):
    rows = []
    for entry in roster["agents"]:
        program, model, _flags = split_argv(entry["argv"])
        rows.append(
            {
                "name": entry["name"],
                "role": entry["role"],
                "color": entry["color"],
                "program": program,
                "model": model,
            }
        )
    return rows


def split_argv(argv):
    """Programm, Modell und übrige Flags aus einem argv.

    Modell ist der Wert von `--model=<x>` oder `--model <x>`; Flags sind alle
    übrigen Argumente hinter dem Programm, in ihrer Reihenfolge.
    """
    parts = [str(part) for part in (argv or [])]
    program = parts[0] if parts else ""
    model = ""
    flags = []
    index = 1
    while index < len(parts):
        token = parts[index]
        if token == "--model" and index + 1 < len(parts):
            model = parts[index + 1]
            index += 2
            continue
        if token.startswith("--model="):
            model = token.split("=", 1)[1]
            index += 1
            continue
        flags.append(token)
        index += 1
    return program, model, flags


def prompt_text(roster, rel):
    path = rel if os.path.isabs(rel) else os.path.join(roster["dir"], rel)
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except FileNotFoundError:
        raise FabError(f"Prompt fehlt: {path}")


def _fill(text, values):
    return _PLACEHOLDER.sub(
        lambda match: str(values.get(match.group(1), match.group(0))), text
    )


def start_prompt(roster, ticket, entry):
    values = {
        "id": ticket["id"],
        "title": ticket["title"],
        "agent": entry["name"],
        "role": entry.get("role") or "",
        "worktree": ticket.get("worktree") or "",
        "branch": ticket.get("branch") or "",
        "base": ticket.get("base") or "",
        "reviewer": roster.get("reviewer") or "",
    }
    preamble = _fill(
        prompt_text(roster, os.path.join("prompts", "preamble.md")), values
    )
    role = _fill(prompt_text(roster, entry["prompt"]), values)
    ticket_text = render.ticket_text(ticket)
    return (
        preamble.rstrip()
        + "\n\n"
        + role.rstrip()
        + "\n\n## Ticket\n\n"
        + ticket_text.rstrip()
        + "\n"
    )


def running(live_terminals):
    """Laufende Agenten-Terminals: alle fab-* außer dem Orchestrator."""
    return {
        name: row
        for name, row in live_terminals.items()
        if name.startswith("fab-") and name != ORCHESTRATOR
    }


# Status, in denen eine Session arbeitet oder auf eine Antwort wartet.
BUSY_STATUSES = frozenset(("working", "blocked"))


def status(row):
    """Statuswort einer Session; None, wenn das Programm keins meldet."""
    raw = (row or {}).get("status")
    if isinstance(raw, dict):
        raw = raw.get("state")
    return str(raw or "").strip().lower() or None


def busy(row):
    """Arbeitet oder wartet die Session? Ohne Statuswort gilt sie als beschäftigt."""
    word = status(row)
    return word is None or word in BUSY_STATUSES


def closed_session_names():
    """Terminalnamen von Sessions aus done/dropped-Tickets."""
    names = set()
    for ticket in store.all_tickets():
        if ticket.get("status") not in ("done", "dropped"):
            continue
        for session in ticket.get("sessions") or []:
            name = (session or {}).get("name")
            if name:
                names.add(name)
    return names


def active(live_terminals):
    """Sessions, die einen Platz belegen: arbeitend/wartend, Ticket nicht fertig."""
    closed = closed_session_names()
    return {
        name: row
        for name, row in running(live_terminals).items()
        if name not in closed and busy(row)
    }


def _start_visible(name, cwd, argv, prompt, labels, tab_name):
    """Startet per `hc run` und hängt das Terminal in Herdrs Space „Fabric“.

    Fehlt das Fenster oder die Tab-Vergabe, läuft der Start trotzdem; der
    Fehler steht im zurückgegebenen `warning`.
    """
    warning = None
    place = None
    try:
        place = herdr.placement()
    except HerdrError as exc:
        warning = f"Herdr-Seitenleiste: {exc}"
    if place:
        labels = dict(labels)
        labels.update(herdr.labels(place))
    answer = hc.run(name=name, cwd=cwd, argv=argv, prompt=prompt, labels=labels)
    if place:
        try:
            herdr.finish(place, tab_name)
        except HerdrError as exc:
            warning = f"Herdr-Seitenleiste: {exc}"
    return answer, warning


def start_agent(roster, ticket, agent_name):
    """Startet einen Agenten im Worktree des Tickets.

    Ergebnis: {"result": "gestartet"|"unterdrückt: voll"|…, "terminal", "name"}.
    """
    entry = agent(agent_name, roster)
    try:
        live = hc.live()
    except HcError:
        live = {}
    limit = int(roster.get("max_sessions") or 4)
    if len(active(live)) >= limit:
        return {"result": "unterdrückt: voll", "terminal": None, "name": None}
    name = hc.terminal_name(agent_name, ticket["id"])
    if name in live:
        row = live[name]
        return {
            "result": "geweckt",
            "terminal": row.get("address") or name,
            "name": name,
            "already": True,
        }
    worktree = ticket.get("worktree")
    if not worktree or not os.path.isdir(worktree):
        raise FabError(
            f"{ticket['id']}: Worktree fehlt ({worktree or 'kein Pfad'}); "
            f"fab dispatch legt ihn an"
        )
    if not entry["argv"]:
        return {
            "result": "unterdrückt: start fehlgeschlagen",
            "terminal": None,
            "name": name,
            "error": f"Agent {agent_name} hat kein argv im Roster",
        }
    if claude.is_claude(entry["argv"]):
        claude.ensure_trust(worktree)
    try:
        answer, warning = _start_visible(
            name=name,
            cwd=worktree,
            argv=entry["argv"],
            prompt=start_prompt(roster, ticket, entry),
            labels={"fab.agent": agent_name, "fab.ticket": ticket["id"]},
            tab_name=ticket["id"],
        )
    except (HcError, FabError) as exc:
        return {
            "result": "unterdrückt: start fehlgeschlagen",
            "terminal": None,
            "name": name,
            "error": str(exc),
        }
    return {
        "result": "gestartet",
        "terminal": answer.get("address"),
        "name": name,
        "warning": warning,
    }


def orchestrator_dir():
    return os.path.expanduser("~/.herdr/fabric-orchestrator")


def start_orchestrator(roster):
    folder = orchestrator_dir()
    os.makedirs(folder, exist_ok=True)
    text = prompt_text(roster, roster["orchestrator"]["prompt"])
    with open(os.path.join(folder, "AGENTS.md"), "w", encoding="utf-8") as handle:
        handle.write(text)
    if not roster["orchestrator"]["argv"]:
        raise FabError("Orchestrator hat kein argv im Roster")
    if claude.is_claude(roster["orchestrator"]["argv"]):
        claude.ensure_trust(folder)
    answer, warning = _start_visible(
        name=ORCHESTRATOR,
        cwd=folder,
        argv=roster["orchestrator"]["argv"],
        prompt="Du bist der Fabric-Orchestrator. Lies AGENTS.md und dann fab inbox und fab list.",
        labels={"fab.role": "orchestrator"},
        tab_name="Orchestrator",
    )
    return {"terminal": answer.get("address"), "name": ORCHESTRATOR, "warning": warning}


def orchestrator_live():
    return ORCHESTRATOR in hc.live()
