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
        "tick": {
            key: value for key, value in data.items() if key.startswith("tick_")
        },
    }


def agent(name, roster=None):
    roster = roster or load()
    for entry in roster["agents"]:
        if entry["name"] == name:
            return entry
    known = ", ".join(entry["name"] for entry in roster["agents"]) or "leer"
    raise FabError(f"Unbekannter Agent: {name} (Roster: {known})")


def ticket_team(roster, ticket):
    """Team des Ticket-Repos; ohne Repo das Legacy-Team (erstes Team)."""
    repo = ticket.get("repo")
    if not repo:
        return teams.first_team(roster)
    return teams.team_for_repo(roster, repo)


def team_for_ticket(roster, ticket):
    """Team des Ticket-Repos oder ein FabError mit dem `fab team edit`-Hinweis."""
    entry = ticket_team(roster, ticket)
    if entry is None:
        raise FabError(teams.no_team_message(ticket.get("repo")))
    return entry


def agent_in_team(roster, team_entry, name):
    """Aufgelöster Agent (mit Team-Übersteuerungen) oder FabError."""
    team_name = str(team_entry.get("name") or "")
    expanded = teams.expand_team(roster, team_entry)
    for entry in expanded:
        if entry["name"] == name:
            return entry
    known = ", ".join(entry["name"] for entry in expanded) or "leer"
    raise FabError(
        f"Agent {name} gehört nicht zu Team {team_name} "
        f"(Mitglieder: {known})"
    )


def _team_names(roster, team_name):
    """Aktueller Teamname plus frühere Namen (dedupliziert, ohne Leerstrings).

    Ein früherer Name, der inzwischen ein anderes existierendes Team ist, zählt
    nicht als Alias dieses Teams. Fehlendes Team oder Roster wirft nicht.
    """
    name = str(team_name or "").strip()
    names = [name] if name else []
    if not isinstance(roster, dict):
        return names
    entries = roster.get("teams")
    if not isinstance(entries, list):
        return names
    existing = set()
    previous = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        other = str(entry.get("name") or "")
        if other:
            existing.add(other)
        if other != name:
            continue
        raw = entry.get("previous_names")
        if isinstance(raw, list):
            previous = [item for item in raw if isinstance(item, str)]
    for item in previous:
        candidate = item.strip()
        if not candidate or candidate in names or candidate in existing:
            continue
        names.append(candidate)
    return names


def _prefix_owners(roster):
    """(Alias, Teamname)-Paare aller Teams, inklusive früherer Namen."""
    pairs = []
    if not isinstance(roster, dict):
        return pairs
    entries = roster.get("teams")
    if not isinstance(entries, list):
        return pairs
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        owner = str(entry.get("name") or "")
        if not owner:
            continue
        for alias in _team_names(roster, owner):
            pairs.append((alias, owner))
    return pairs


def _prefix_owner(terminal, pairs):
    """Team mit dem längsten passenden `fab-<alias>-`-Präfix, sonst ""."""
    best_alias = -1
    best_owner = ""
    for alias, owner in pairs:
        if len(alias) > best_alias and terminal.startswith(f"fab-{alias}-"):
            best_alias = len(alias)
            best_owner = owner
    return best_owner


def team_live(roster, team_name):
    """Live-Terminals eines Teams: Orchestrator, Labels, Tickets und Namen.

    Erfasst auch Terminale früherer Teamnamen. Ein Namenspräfix zählt nur,
    wenn kein längeres Team oder Alias eines anderen Teams genauer passt
    (`herdr` beansprucht keine `fab-herdr-app-…`-Terminale). `hc.live` wird
    direkt abgefragt; ein HcError ergibt eine leere Menge.
    """
    try:
        live = hc.live()
    except HcError:
        live = {}
    names = _team_names(roster, team_name)
    owners = _session_teams(roster)
    orchestrators = {hc.orchestrator_name(alias) for alias in names}
    legacy = teams.legacy_team_name(roster) if isinstance(roster, dict) else ""
    if legacy and legacy in names:
        orchestrators.add(ORCHESTRATOR)
    owner = str(team_name or "")
    pairs = _prefix_owners(roster)
    rows = {}
    for name, row in live.items():
        labels = (row or {}).get("labels")
        label_team = ""
        if isinstance(labels, dict):
            label_team = str(labels.get("fab.team") or "")
        if (
            name in orchestrators
            or label_team in names
            or owners.get(name) == owner
            or _prefix_owner(name, pairs) == owner
        ):
            rows[name] = row
    return rows


def _session_teams(roster):
    """Terminalname → Team für Sessions, die in Tickets vermerkt sind."""
    owners = {}
    if not roster:
        return owners
    for ticket in store.all_tickets():
        entry = ticket_team(roster, ticket)
        if entry is None:
            continue
        for session in ticket.get("sessions") or []:
            name = (session or {}).get("name")
            if name:
                owners[name] = str(entry.get("name") or "")
    return owners


def _team_of(name, row, roster, owners):
    labels = (row or {}).get("labels")
    if isinstance(labels, dict) and labels.get("fab.team"):
        return str(labels["fab.team"])
    if name in owners:
        return owners[name]
    if roster:
        known = [
            str(entry.get("name"))
            for entry in roster.get("teams") or []
            if isinstance(entry, dict) and entry.get("name")
        ]
        matches = [team for team in known if name.startswith(f"fab-{team}-")]
        if matches:
            return max(matches, key=len)
        legacy = teams.legacy_team_name(roster)
        if legacy:
            return legacy
    return None


def at_limit(roster, live_terminals, team_entry):
    """Globales und Team-Limit erreicht?"""
    team_name = str(team_entry.get("name") or "")
    limit = teams.team_limit(team_entry)
    total = int(roster.get("max_sessions_total") or limit)
    if len(active(live_terminals, roster)) >= total:
        return True
    return len(active(live_terminals, roster, team_name)) >= limit


def roster_rows(roster):
    """Alle Blaupausen mit ihren Teams; vor der Migration die Agenten."""
    entries = roster.get("blueprints") or roster["agents"]
    membership = {}
    for team_entry in roster.get("teams") or []:
        if not isinstance(team_entry, dict) or not team_entry.get("name"):
            continue
        for member in team_entry.get("members") or []:
            if not isinstance(member, dict) or not member.get("blueprint"):
                continue
            membership.setdefault(str(member["blueprint"]), []).append(
                str(team_entry["name"])
            )
    rows = []
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        name = str(entry["name"])
        program, model, _flags = split_argv(entry.get("argv"))
        rows.append(
            {
                "name": name,
                "role": str(entry.get("role") or ""),
                "color": str(entry.get("color") or ""),
                "program": program,
                "model": model,
                "teams": membership.get(name, []),
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


def start_prompt(roster, ticket, entry, reviewer=None):
    values = {
        "id": ticket["id"],
        "title": ticket["title"],
        "agent": entry["name"],
        "role": entry.get("role") or "",
        "worktree": ticket.get("worktree") or "",
        "branch": ticket.get("branch") or "",
        "base": ticket.get("base") or "",
        "reviewer": reviewer if reviewer is not None else roster.get("reviewer") or "",
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
    """Laufende Agenten-Terminals: alle fab-* außer Orchestratoren."""
    return {
        name: row
        for name, row in live_terminals.items()
        if name.startswith("fab-") and not hc.is_orchestrator(name)
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


def active(live_terminals, roster=None, team=None):
    """Sessions, die einen Platz belegen: arbeitend/wartend, Ticket nicht fertig.

    `team` zählt nur die Sessions dieses Teams; ohne `team` alle Teams zusammen.
    """
    closed = closed_session_names()
    owners = _session_teams(roster)
    rows = {}
    for name, row in running(live_terminals).items():
        if name in closed or not busy(row):
            continue
        if team is not None and _team_of(name, row, roster, owners) != team:
            continue
        rows[name] = row
    return rows


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
    Team, Übersteuerungen (Modell, max-cost) und Limits kommen aus dem Team des
    Ticket-Repos; ein Agent außerhalb des Teams wird abgelehnt.
    """
    team_entry = team_for_ticket(roster, ticket)
    team_name = str(team_entry.get("name") or "")
    entry = agent_in_team(roster, team_entry, agent_name)
    try:
        live = hc.live()
    except HcError:
        live = {}
    name = hc.terminal_name(agent_name, ticket["id"], team_name)
    legacy = hc.terminal_name(agent_name, ticket["id"])
    targets = [name]
    if team_name == teams.legacy_team_name(roster):
        targets.append(legacy)
    for target in targets:
        if target in live:
            row = live[target]
            return {
                "result": "geweckt",
                "terminal": row.get("address") or target,
                "name": target,
                "already": True,
            }
    if at_limit(roster, live, team_entry):
        return {"result": "unterdrückt: voll", "terminal": None, "name": None}
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
            prompt=start_prompt(roster, ticket, entry, team_entry.get("reviewer")),
            labels={
                "fab.agent": agent_name,
                "fab.ticket": ticket["id"],
                "fab.team": team_name,
            },
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


def orchestrator_dir(team=None):
    base = os.path.expanduser("~/.herdr/fabric-orchestrator")
    return os.path.join(base, team) if team else base


def start_orchestrator(roster, team_name=None):
    entry = teams.team(roster, team_name) if team_name else teams.first_team(roster)
    if not isinstance(entry, dict) or not entry.get("name"):
        raise FabError("Kein Team im Roster; fab team add …")
    team_name = str(entry["name"])
    config = teams.orchestrator_config(entry)
    folder = orchestrator_dir(team_name)
    os.makedirs(folder, exist_ok=True)
    text = prompt_text(roster, config["prompt"])
    with open(os.path.join(folder, "AGENTS.md"), "w", encoding="utf-8") as handle:
        handle.write(text)
    if not config["argv"]:
        raise FabError(f"Team {team_name}: Orchestrator hat kein argv im Roster")
    if claude.is_claude(config["argv"]):
        claude.ensure_trust(folder)
    name = hc.orchestrator_name(team_name)
    answer, warning = _start_visible(
        name=name,
        cwd=folder,
        argv=config["argv"],
        prompt=(
            f"Du bist der Fabric-Orchestrator für Team {team_name}. "
            "Lies AGENTS.md und dann fab inbox --team "
            f"{team_name} und fab list --team {team_name}."
        ),
        labels={"fab.role": "orchestrator", "fab.team": team_name},
        tab_name="Orchestrator",
    )
    return {"terminal": answer.get("address"), "name": name, "warning": warning}


def orchestrator_targets(roster, team_name):
    """Orchestrator-Terminale: aktueller Name, frühere Namen, ggf. das alte globale.

    Die Reihenfolge ist aktueller Teamname, dann frühere Namen, dann für das
    Legacy-Team das alte globale Terminal `fab-orchestrator`.
    """
    aliases = _team_names(roster, team_name)
    targets = []
    for alias in aliases:
        target = hc.orchestrator_name(alias)
        if target not in targets:
            targets.append(target)
    legacy = teams.legacy_team_name(roster) if isinstance(roster, dict) else ""
    if legacy and legacy in aliases and ORCHESTRATOR not in targets:
        targets.append(ORCHESTRATOR)
    return targets


def live_orchestrator(roster, team_name):
    """(Name, Zeile) des laufenden Team-Orchestrators, sonst (None, None)."""
    try:
        live = hc.live()
    except HcError:
        live = {}
    for target in orchestrator_targets(roster, team_name):
        if target in live:
            return target, live[target]
    return None, None


def orchestrator_live(roster=None, team_name=None):
    if roster is None or team_name is None:
        try:
            live = hc.live()
        except HcError:
            live = {}
        return any(hc.is_orchestrator(name) for name in live)
    return live_orchestrator(roster, team_name)[0] is not None
