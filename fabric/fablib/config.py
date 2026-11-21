"""Roster und Einstellungen pflegen (Abschnitt 3b des Vertrags).

Jede Änderung läuft unter dem Lock aus `store`, schreibt atomar, lässt Felder
stehen, die `fab` nicht kennt, hängt ein `config`-Ereignis an und erzeugt
`index.json` neu. Quelle sind Blaupausen und Teams; die Legacy-Felder
(`agents`, `reviewer`, `orchestrator`, `max_sessions`) werden gespiegelt.
Alle Meldungen sind deutsch und für das UI gedacht.
"""
import json
import os
import stat

from . import agents, events, git, hc, index, store, teams
from .errors import FabError, HcError

NAME_RE = teams.NAME_RE
RESERVED = teams.RESERVED
COLORS = teams.COLORS
TICK_KEYS = (
    "tick_doing_minutes",
    "tick_mention_minutes",
    "tick_review_minutes",
    "tick_blocked_minutes",
    "tick_retry_minutes",
)
TICK_MAX_MINUTES = 1440
ORCHESTRATOR_KEYS = {
    "orchestrator_dispatches": ("dispatches", 100),
    "orchestrator_idle_minutes": ("idle_minutes", TICK_MAX_MINUTES),
}
SETTINGS = (
    "max_sessions",
    "reviewer",
    "orchestrator_argv",
    "max_sessions_total",
    *TICK_KEYS,
    *ORCHESTRATOR_KEYS,
)
MIN_SESSIONS = teams.MIN_SESSIONS
MAX_SESSIONS = teams.MAX_SESSIONS

check_name = teams.check_name
parse_argv = teams.parse_argv
_check_color = teams.check_color
_check_role = teams.check_role

TEMPLATE = """# {name}

Rolle: {role}.

Lies dein Ticket mit `fab show <ID>`. Antworte im Ticket mit
`fab comment <ID> --from {name} "…"` und tagge, wen du brauchst. Neue Arbeit
ist ein neues Ticket mit `--blocked-by`, keine Nachricht.
"""


# ---------------------------------------------------------------- Datei

def _mode(path, fallback):
    try:
        return stat.S_IMODE(os.stat(path).st_mode)
    except OSError:
        return fallback


def _load():
    path = agents.roster_path()
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        raise FabError(f"Roster fehlt: {path}")
    except json.JSONDecodeError as exc:
        raise FabError(f"Roster {path} ist kein gültiges JSON: {exc}")
    if not isinstance(data, dict):
        raise FabError(f"Roster {path} ist kein JSON-Objekt")
    return path, data


def _migrate(data):
    """Migration nur im Speicher; geschrieben wird erst nach `_commit`."""
    for key in ("agents", "blueprints"):
        value = data.get(key)
        if value is not None and not isinstance(value, list):
            raise FabError(f"Roster: „{key}“ ist keine Liste")
    if teams.migrate(data) or teams.is_migrated(data):
        return data
    data.setdefault("blueprints", [])
    data.setdefault("agents", [])
    teams.migrate(data)
    return data


def _blueprints(data):
    entries = data.get("blueprints")
    if not isinstance(entries, list):
        raise FabError("Roster: „blueprints“ ist keine Liste")
    return entries


def _team_entries(data):
    entries = data.get("teams")
    if not isinstance(entries, list):
        raise FabError("Roster: „teams“ ist keine Liste")
    return entries


def _blueprint_teams(data, name):
    used = []
    for team_entry in _team_entries(data):
        if not isinstance(team_entry, dict):
            continue
        for member in team_entry.get("members") or []:
            if isinstance(member, dict) and member.get("blueprint") == name:
                used.append(str(team_entry.get("name") or ""))
                break
    return used


def _team_orchestrator(team_entry):
    orchestrator = team_entry.get("orchestrator")
    if not isinstance(orchestrator, dict):
        orchestrator = {}
        team_entry["orchestrator"] = orchestrator
    return orchestrator


def _legacy_orchestrator(data):
    orchestrator = data.get("orchestrator")
    return orchestrator if isinstance(orchestrator, dict) else {}


def _member_names(members):
    return [
        str(member.get("blueprint"))
        for member in members or []
        if isinstance(member, dict) and member.get("blueprint")
    ]


def _member_descriptions(members):
    """Mitglieder mit Übersteuerungen, damit Änderungen an model/max_cost sichtbar sind."""
    rows = []
    for member in members or []:
        if not isinstance(member, dict) or not member.get("blueprint"):
            continue
        extras = []
        if member.get("model"):
            extras.append(f"modell {member['model']}")
        if member.get("max_cost") is not None:
            extras.append(f"max-cost {member['max_cost']}")
        suffix = f" ({', '.join(extras)})" if extras else ""
        rows.append(str(member["blueprint"]) + suffix)
    return rows


def _abs(directory, rel):
    return rel if os.path.isabs(rel) else os.path.join(directory, rel)


def _commit(path, data, actor, text, written=()):
    store.atomic_write(
        path,
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        mode=_mode(path, 0o644),
    )
    events.append("config", "", actor, "", text)
    index.rebuild()
    # Nur die Dateien dieses Befehls committen; False ist kein Fehler.
    git.commit_paths(path, [path, *written], f"chore(roster): {text}")


def _sync_legacy(data):
    """Legacy-Felder aus dem ersten Team spiegeln, Zusatzfelder erhalten."""
    if not teams.is_migrated(data):
        return
    expanded = teams.expansion(data)
    # `teams` ist abgeleitet und bleibt eine UI-Angabe; die Legacy-Spiegelung
    # behält die alte Form der `agents`-Einträge.
    data["agents"] = [
        {key: value for key, value in row.items() if key != "teams"}
        for row in expanded["agents"]
    ]
    data["reviewer"] = expanded["reviewer"]
    data["max_sessions"] = expanded["max_sessions"]
    data[teams.GLOBAL_KEY] = expanded["max_sessions_total"]
    orchestrator = data.get("orchestrator")
    if not isinstance(orchestrator, dict):
        orchestrator = {}
        data["orchestrator"] = orchestrator
    orchestrator["argv"] = expanded["orchestrator"]["argv"]
    orchestrator["prompt"] = expanded["orchestrator"]["prompt"]


# ---------------------------------------------------------------- Farben

def _next_color(entries):
    used = {
        str(entry.get("color") or "")
        for entry in entries
        if isinstance(entry, dict)
    }
    for color in COLORS:
        if color not in used:
            return color
    raise FabError(
        f"Alle Farben {', '.join(COLORS)} sind belegt; gib eine Farbe mit --color an"
    )


# ---------------------------------------------------------------- Laufendes

def _live_checked():
    try:
        return hc.live()
    except HcError as exc:
        raise FabError(f"Laufende Sessions sind nicht prüfbar: {exc}")


def _live_quiet():
    try:
        return hc.live()
    except HcError:
        return {}


def _open_tickets(name):
    return [
        ticket
        for ticket in store.all_tickets()
        if ticket.get("assignee") == name
        and ticket.get("status") not in ("done", "dropped")
    ]


def _agent_of(terminal, row, name):
    labels = (row or {}).get("labels")
    if isinstance(labels, dict) and labels.get("fab.agent"):
        return str(labels["fab.agent"])
    return None


def _running_sessions(name, live):
    prefix = f"fab-{name.lower()}-"
    return sorted(
        terminal
        for terminal, row in live.items()
        if terminal.startswith(prefix) or _agent_of(terminal, row, name) == name
    )


def _busy_reasons(name, live):
    reasons = []
    tickets = _open_tickets(name)
    if tickets:
        reasons.append(
            "offene Tickets: "
            + ", ".join(f"{ticket['id']} ({ticket['status']})" for ticket in tickets)
        )
    running = _running_sessions(name, live)
    if running:
        reasons.append("laufende Sessions: " + ", ".join(running))
    return reasons


def _sessions(name, live):
    prefix = f"fab-{name.lower()}-"
    rows = []
    for terminal, row in live.items():
        if not (terminal.startswith(prefix) or _agent_of(terminal, row, name) == name):
            continue
        rows.append(
            {
                "name": terminal,
                "terminal": row.get("address") or terminal,
                "status": row.get("status"),
            }
        )
    rows.sort(key=lambda row: row["name"])
    return rows


# ---------------------------------------------------------------- Lesen

def payload():
    """Kompletter Roster für das UI, inklusive der abgeleiteten Felder."""
    roster = agents.load()
    live = _live_quiet()
    open_counts = {}
    for ticket in store.all_tickets():
        if ticket.get("status") in ("done", "dropped"):
            continue
        assignee = ticket.get("assignee")
        if assignee:
            open_counts[assignee] = open_counts.get(assignee, 0) + 1
    rows = []
    for entry in roster["agents"]:
        program, model, flags = agents.split_argv(entry["argv"])
        rows.append(
            {
                "name": entry["name"],
                "role": entry["role"],
                "color": entry["color"],
                "teams": list(entry.get("teams") or []),
                "argv": list(entry["argv"]),
                "prompt": entry["prompt"],
                "program": program,
                "model": model,
                "flags": flags,
                "open_tickets": open_counts.get(entry["name"], 0),
                "sessions": _sessions(entry["name"], live),
            }
        )
    blueprint_data = {
        "blueprints": roster["blueprints"],
        "teams": roster["teams"],
    }
    return {
        "path": roster["path"],
        "max_sessions": roster["max_sessions"],
        "max_sessions_total": roster["max_sessions_total"],
        "reviewer": roster["reviewer"],
        "orchestrator": {
            "argv": list(roster["orchestrator"]["argv"]),
            "prompt": roster["orchestrator"]["prompt"],
        },
        "team": roster.get("team"),
        "agents": rows,
        "blueprints": teams.blueprint_rows(blueprint_data),
        "teams": teams.team_rows(blueprint_data),
    }


# ---------------------------------------------------------------- Blaupausen

def _add_blueprint(path, data, name, role, color, argv_json, prompt_text):
    name = check_name(name)
    role = _check_role(role)
    argv = parse_argv(argv_json, "--argv-json")
    entries = _blueprints(data)
    known = [
        str(entry.get("name"))
        for entry in entries
        if isinstance(entry, dict) and entry.get("name")
    ]
    if name in known:
        raise FabError(
            f"„{name}“ gibt es schon; nimm einen anderen Namen oder "
            f"fab blueprint edit {name}"
        )
    value = _check_color(color) if color is not None else _next_color(entries)
    directory = os.path.dirname(path)
    rel = f"prompts/{name}.md"
    target = _abs(directory, rel)
    written = []
    if prompt_text is not None:
        store.atomic_write(target, prompt_text, mode=_mode(target, 0o644))
        written.append(target)
    elif not os.path.exists(target):
        store.atomic_write(
            target, TEMPLATE.format(name=name, role=role), mode=0o644
        )
        written.append(target)
    entry = {
        "name": name,
        "role": role,
        "color": value,
        "prompt": rel,
        "argv": argv,
    }
    entries.append(entry)
    return entry, written


def _edit_blueprint(path, data, name, rename, role, color, argv_json,
                    prompt_text):
    entries = _blueprints(data)
    entry = teams.blueprint(data, name)
    directory = os.path.dirname(path)

    target = name
    if rename is not None:
        candidate = rename.strip()
        if not candidate:
            raise FabError("Der neue Name ist leer")
        if candidate != name:
            target = check_name(candidate)
            if any(
                isinstance(item, dict) and item.get("name") == target
                for item in entries
            ):
                raise FabError(
                    f"Agent „{target}“ gibt es schon; wähle einen anderen Namen"
                )
            if _blueprint_teams(data, name):
                reasons = _busy_reasons(name, _live_checked())
                if reasons:
                    raise FabError(
                        f"Agent „{name}“ kann nicht umbenannt werden:\n- "
                        + "\n- ".join(reasons)
                    )

    current_rel = str(entry.get("prompt") or f"prompts/{name}.md")
    final_rel = current_rel
    move = None
    if target != name and current_rel == f"prompts/{name}.md":
        final_rel = f"prompts/{target}.md"
        new_abs = _abs(directory, final_rel)
        if os.path.exists(new_abs) and prompt_text is None:
            raise FabError(
                f"Promptdatei {final_rel} gibt es schon; wähle einen anderen "
                f"Namen oder gib mit --prompt-text einen neuen Text"
            )
        move = (_abs(directory, current_rel), new_abs)

    changes = []
    written = []
    if role is not None:
        value = _check_role(role)
        if value != entry.get("role"):
            changes.append(f"Rolle {entry.get('role') or '—'} → {value}")
        entry["role"] = value
    if color is not None:
        value = _check_color(color)
        if value != entry.get("color"):
            changes.append(f"Farbe {entry.get('color') or '—'} → {value}")
        entry["color"] = value
    if argv_json is not None:
        argv = parse_argv(argv_json, "--argv-json")
        if argv != entry.get("argv"):
            changes.append("argv " + " ".join(argv))
        entry["argv"] = argv

    if move is not None:
        if os.path.exists(move[0]):
            os.replace(move[0], move[1])
            written.extend(move)
    if target != name:
        changes.append(f"Name {name} → {target}")
    if prompt_text is not None:
        prompt_abs = _abs(directory, final_rel)
        store.atomic_write(
            prompt_abs, prompt_text, mode=_mode(prompt_abs, 0o644)
        )
        written.append(prompt_abs)
        changes.append(f"Prompt {final_rel}")
    if entry.get("prompt") != final_rel:
        entry["prompt"] = final_rel
    if target != name:
        entry["name"] = target
        renamed_reviewer = False
        for team_entry in _team_entries(data):
            if not isinstance(team_entry, dict):
                continue
            for member in team_entry.get("members") or []:
                if isinstance(member, dict) and member.get("blueprint") == name:
                    member["blueprint"] = target
            if str(team_entry.get("reviewer") or "") == name:
                team_entry["reviewer"] = target
                renamed_reviewer = True
        if renamed_reviewer:
            changes.append(f"Prüfer → {target}")

    if not changes:
        raise FabError(
            "Nichts zu ändern: nutze --rename, --role, --color, --argv-json "
            "oder --prompt-text"
        )
    return changes, target, written


def add_blueprint(name, role, color, argv_json, prompt_text, actor):
    path, data = _load()
    _migrate(data)
    entry, written = _add_blueprint(
        path, data, name, role, color, argv_json, prompt_text
    )
    _sync_legacy(data)
    _commit(
        path,
        data,
        actor,
        f"Blaupause {entry['name']} angelegt: Rolle {entry['role']}, "
        f"Farbe {entry['color']}, Programm {entry['argv'][0]}",
        written=written,
    )
    return entry


def edit_blueprint(name, rename=None, role=None, color=None, argv_json=None,
                   prompt_text=None, actor=""):
    path, data = _load()
    _migrate(data)
    changes, target, written = _edit_blueprint(
        path, data, name, rename, role, color, argv_json, prompt_text
    )
    _sync_legacy(data)
    _commit(
        path, data, actor,
        f"Blaupause {name} geändert: " + ", ".join(changes),
        written=written,
    )
    return f"Blaupause „{target}“ geändert: " + ", ".join(changes)


def remove_blueprint(name, actor):
    path, data = _load()
    _migrate(data)
    entry = teams.blueprint(data, name)
    used = _blueprint_teams(data, name)
    if used:
        raise FabError(
            f"Blaupause „{name}“ wird im Team „{used[0]}“ genutzt und kann "
            f"nicht entfernt werden"
        )
    rel = str(entry.get("prompt") or f"prompts/{name}.md")
    _blueprints(data).remove(entry)
    _sync_legacy(data)
    _commit(path, data, actor, f"Blaupause {name} entfernt; Prompt {rel} bleibt")
    return rel


# ---------------------------------------------------------------- Agenten (Legacy)

def add(name, role, color, argv_json, prompt_text, actor):
    path, data = _load()
    _migrate(data)
    entry, written = _add_blueprint(
        path, data, name, role, color, argv_json, prompt_text
    )
    first = teams.first_team(data)
    if isinstance(first, dict):
        members = first.get("members")
        if not isinstance(members, list):
            members = []
            first["members"] = members
        members.append({"blueprint": entry["name"]})
    _sync_legacy(data)
    _commit(
        path,
        data,
        actor,
        f"Agent {entry['name']} angelegt: Rolle {entry['role']}, "
        f"Farbe {entry['color']}, Programm {entry['argv'][0]}",
        written=written,
    )
    return entry


def edit(name, rename=None, role=None, color=None, argv_json=None,
         prompt_text=None, actor=""):
    path, data = _load()
    _migrate(data)
    changes, target, written = _edit_blueprint(
        path, data, name, rename, role, color, argv_json, prompt_text
    )
    _sync_legacy(data)
    _commit(
        path, data, actor,
        f"Agent {name} geändert: " + ", ".join(changes),
        written=written,
    )
    return f"Agent „{target}“ geändert: " + ", ".join(changes)


def remove(name, actor):
    path, data = _load()
    _migrate(data)
    entry = teams.blueprint(data, name)
    reasons = _busy_reasons(name, _live_checked())
    used = _blueprint_teams(data, name)
    if any(
        isinstance(team_entry, dict)
        and str(team_entry.get("reviewer") or "") == name
        for team_entry in _team_entries(data)
    ):
        reasons.append("ist als Prüfer im Roster eingetragen (reviewer)")
    if len(used) > 1:
        reasons.append(
            "wird in mehreren Teams genutzt: " + ", ".join(used)
        )
    if reasons:
        raise FabError(
            f"Agent „{name}“ kann nicht entfernt werden:\n- "
            + "\n- ".join(reasons)
        )
    rel = str(entry.get("prompt") or f"prompts/{name}.md")
    for team_entry in _team_entries(data):
        if not isinstance(team_entry, dict):
            continue
        members = team_entry.get("members")
        if isinstance(members, list):
            team_entry["members"] = [
                member
                for member in members
                if not (
                    isinstance(member, dict)
                    and member.get("blueprint") == name
                )
            ]
    _blueprints(data).remove(entry)
    _sync_legacy(data)
    _commit(path, data, actor, f"Agent {name} entfernt; Prompt {rel} bleibt")
    return rel


# ---------------------------------------------------------------- Teams

def _team_repos(entry):
    return [
        teams.normalize_repo(repo)
        for repo in (entry.get("repos") or [])
    ]


def add_team(name, repos, members_json, orchestrator_argv_json=None,
             orchestrator_prompt=None, reviewer=None, max_sessions=None,
             actor=""):
    path, data = _load()
    _migrate(data)
    name = check_name(name)
    if not repos:
        raise FabError("Fehlt: --repo PFAD")
    normalized = [teams.normalize_repo(repo) for repo in repos]
    members = teams.parse_members(members_json)
    if reviewer is None or not str(reviewer).strip():
        raise FabError("Fehlt: --reviewer NAME")
    reviewer = str(reviewer).strip()
    limit = (
        teams.DEFAULT_MAX_SESSIONS
        if max_sessions is None or not str(max_sessions).strip()
        else teams.check_sessions(max_sessions)
    )
    if any(
        isinstance(entry, dict) and entry.get("name") == name
        for entry in _team_entries(data)
    ):
        raise FabError(f"Team „{name}“ gibt es schon; wähle einen anderen Namen")
    legacy = _legacy_orchestrator(data)
    if orchestrator_argv_json is not None:
        argv = parse_argv(orchestrator_argv_json, "--orchestrator-argv-json")
    else:
        argv = [str(part) for part in (legacy.get("argv") or [])]
        if not argv:
            raise FabError(
                "--orchestrator-argv-json fehlt: Team braucht ein "
                "Orchestrator-Programm"
            )
    explicit_prompt = str(orchestrator_prompt or "").strip()
    if explicit_prompt:
        prompt = str(orchestrator_prompt)
        template = None
    else:
        prompt = f"prompts/orchestrator-{name}.md"
        template = str(
            legacy.get("prompt") or teams.DEFAULT_ORCHESTRATOR_PROMPT
        )
    teams.validate_team(data, name, normalized, members, reviewer, limit)
    written = []
    if template is not None:
        directory = os.path.dirname(path)
        source = _abs(directory, template)
        target = _abs(directory, prompt)
        if not os.path.exists(target):
            if not os.path.isfile(source):
                raise FabError(
                    f"Orchestrator-Vorlage fehlt: {source}; lege sie an oder "
                    "gib --orchestrator-prompt PFAD an"
                )
            with open(source, encoding="utf-8") as handle:
                raw = handle.read()
            store.atomic_write(
                target, raw, mode=_mode(target, _mode(source, 0o644))
            )
            written.append(target)
    entry = {
        "name": name,
        "repos": normalized,
        "orchestrator": {"argv": argv, "prompt": prompt},
        "members": members,
        "reviewer": reviewer,
        "max_sessions": limit,
    }
    _team_entries(data).append(entry)
    _sync_legacy(data)
    _commit(
        path,
        data,
        actor,
        f"Team {name} angelegt: {len(normalized)} Repo(s), Mitglieder "
        f"{', '.join(_member_descriptions(members))}, Prüfer {reviewer}, "
        f"max_sessions {limit}",
        written=written,
    )
    return entry


def _live_blockers(live, name):
    """Meldungen für laufende Orchestratoren und Agenten-Sessions eines Teams."""
    orchestrators = sorted(
        terminal for terminal in live if hc.is_orchestrator(terminal)
    )
    sessions = sorted(
        terminal for terminal in live if not hc.is_orchestrator(terminal)
    )
    blockers = []
    if orchestrators:
        blockers.append(
            f"Orchestrator {', '.join(orchestrators)} läuft (stoppe ihn zuerst "
            f"mit fab orchestrator stop {name})"
        )
    if sessions:
        blockers.append(
            "laufende Sessions " + ", ".join(sessions)
            + " (beende sie zuerst mit hc kill <terminal>)"
        )
    return blockers


def edit_team(name, rename=None, repos=None, members_json=None,
              orchestrator_argv_json=None, orchestrator_prompt=None,
              reviewer=None, max_sessions=None, actor=""):
    path, data = _load()
    _migrate(data)
    entry = teams.team(data, name)

    target = name
    if rename is not None:
        candidate = rename.strip()
        if not candidate:
            raise FabError("Der neue Name ist leer")
        if candidate != name:
            target = check_name(candidate)
            if any(
                isinstance(item, dict) and item.get("name") == target
                for item in _team_entries(data)
            ):
                raise FabError(
                    f"Team „{target}“ gibt es schon; wähle einen anderen Namen"
                )
            live = agents.team_live(data, name)
            if live:
                raise FabError(
                    f"Team „{name}“ lässt sich nicht umbenennen: "
                    + "; ".join(_live_blockers(live, name))
                    + "."
                )

    old_repos = _team_repos(entry)
    final_repos = old_repos
    if repos is not None:
        if not repos:
            raise FabError("Fehlt: --repo PFAD")
        final_repos = [teams.normalize_repo(repo) for repo in repos]

    old_members = [
        dict(member)
        for member in (entry.get("members") or [])
        if isinstance(member, dict)
    ]
    final_members = old_members
    if members_json is not None:
        final_members = teams.parse_members(members_json)

    old_reviewer = str(entry.get("reviewer") or "")
    final_reviewer = old_reviewer
    if reviewer is not None:
        final_reviewer = str(reviewer).strip()
        if not final_reviewer:
            raise FabError("Fehlt: --reviewer NAME")

    old_limit = entry.get("max_sessions")
    old_limit = (
        teams.DEFAULT_MAX_SESSIONS
        if old_limit is None
        else teams.check_sessions(old_limit)
    )
    final_limit = old_limit
    if max_sessions is not None:
        final_limit = teams.check_sessions(max_sessions)

    orchestrator = _team_orchestrator(entry)
    old_argv = [str(part) for part in (orchestrator.get("argv") or [])]
    final_argv = old_argv
    if orchestrator_argv_json is not None:
        final_argv = parse_argv(
            orchestrator_argv_json, "--orchestrator-argv-json"
        )
    old_prompt = str(
        orchestrator.get("prompt") or teams.DEFAULT_ORCHESTRATOR_PROMPT
    )
    final_prompt = old_prompt
    if orchestrator_prompt is not None:
        final_prompt = str(orchestrator_prompt)

    teams.validate_team(
        data, target, final_repos, final_members, final_reviewer, final_limit,
        ignore=name,
    )

    changes = []
    if target != name:
        changes.append(f"Name {name} → {target}")
    if final_repos != old_repos:
        changes.append(
            f"Repos {', '.join(old_repos) or '—'} → "
            f"{', '.join(final_repos)}"
        )
    if final_members != old_members:
        changes.append(
            f"Mitglieder {', '.join(_member_descriptions(old_members)) or '—'} → "
            f"{', '.join(_member_descriptions(final_members))}"
        )
    if final_reviewer != old_reviewer:
        changes.append(
            f"Prüfer {old_reviewer or '—'} → {final_reviewer}"
        )
    if final_limit != old_limit:
        changes.append(f"max_sessions {old_limit} → {final_limit}")
    if final_argv != old_argv:
        changes.append("orchestrator argv " + " ".join(final_argv))
    if final_prompt != old_prompt:
        changes.append(f"orchestrator_prompt {final_prompt}")
    if not changes:
        raise FabError(
            "Nichts zu ändern: nutze --rename, --repo, --members-json, "
            "--reviewer, --max-sessions, --orchestrator-argv-json oder "
            "--orchestrator-prompt"
        )

    entry["name"] = target
    if target != name:
        raw_previous = entry.get("previous_names")
        previous = [
            item.strip()
            for item in (raw_previous if isinstance(raw_previous, list) else [])
            if isinstance(item, str) and item.strip()
        ]
        previous.append(name)
        entry["previous_names"] = [
            alias for alias in dict.fromkeys(previous) if alias != target
        ]
    entry["repos"] = final_repos
    entry["members"] = final_members
    entry["reviewer"] = final_reviewer
    entry["max_sessions"] = final_limit
    orchestrator["argv"] = final_argv
    orchestrator["prompt"] = final_prompt
    _sync_legacy(data)
    text = f"Team {name} geändert: " + ", ".join(changes)
    _commit(path, data, actor, text)
    return text


def remove_team(name, actor):
    path, data = _load()
    _migrate(data)
    entry = teams.team(data, name)
    repos = _team_repos(entry)
    blockers = []
    tickets = [
        ticket
        for ticket in store.all_tickets()
        if ticket.get("status") in ("todo", "doing", "review")
        and ticket.get("repo")
        and teams.normalize_repo(ticket["repo"]) in repos
    ]
    if tickets:
        blockers.append(
            "offene Tickets "
            + ", ".join(
                f"{ticket['id']} ({ticket['status']})" for ticket in tickets
            )
        )
    live = agents.team_live(data, name)
    blockers.extend(_live_blockers(live, name))
    if blockers:
        raise FabError(
            f"Team „{name}“ lässt sich nicht löschen: "
            + "; ".join(blockers)
            + "."
        )
    _team_entries(data).remove(entry)
    if teams.is_migrated(data):
        _sync_legacy(data)
    else:
        # Ohne Team darf die alte Spiegelung keine Agenten wiederbeleben.
        data["agents"] = []
        data["reviewer"] = ""
    _commit(path, data, actor, f"Team {name} entfernt")
    return name


# ---------------------------------------------------------------- Einstellungen

def set_setting(key, value, actor, team=None):
    raw = "" if value is None else str(value)
    path, data = _load()
    _migrate(data)
    if team and key not in ORCHESTRATOR_KEYS:
        raise FabError(
            f"--team gilt nur für {', '.join(ORCHESTRATOR_KEYS)}"
        )
    if key == "max_sessions":
        number = teams.check_sessions(raw)
        first = teams.first_team(data)
        old = data.get("max_sessions")
        if isinstance(first, dict):
            if first.get("max_sessions") is not None:
                old = first.get("max_sessions")
            first["max_sessions"] = number
        data["max_sessions"] = number
        text = f"max_sessions: {old} → {number}"
    elif key == "reviewer":
        name = raw.strip()
        first = teams.first_team(data)
        names = _member_names(
            first.get("members") if isinstance(first, dict) else []
        )
        if name not in names:
            raise FabError(
                f"reviewer muss ein Agent aus dem Roster sein („{name}“ fehlt); "
                f"im Roster: {', '.join(names) or 'keine'}"
            )
        if isinstance(first, dict):
            first["reviewer"] = name
        data["reviewer"] = name
        text = f"reviewer: {name}"
    elif key == "orchestrator_argv":
        argv = parse_argv(raw, "orchestrator_argv")
        first = teams.first_team(data)
        if isinstance(first, dict):
            _team_orchestrator(first)["argv"] = argv
        orchestrator = _legacy_orchestrator(data)
        if not orchestrator:
            data["orchestrator"] = orchestrator
        orchestrator["argv"] = argv
        text = "orchestrator_argv: " + " ".join(argv)
    elif key == "max_sessions_total":
        number = teams.check_total_sessions(raw)
        old = data.get(teams.GLOBAL_KEY)
        data[teams.GLOBAL_KEY] = number
        text = (
            f"max_sessions_total: {old if old is not None else '—'} → {number}"
        )
    elif key in TICK_KEYS:
        try:
            number = int(raw.strip())
        except (TypeError, ValueError):
            raise FabError(
                f"{key} muss eine ganze Zahl zwischen 0 und {TICK_MAX_MINUTES} sein"
            )
        if number < 0 or number > TICK_MAX_MINUTES:
            raise FabError(
                f"{key} muss zwischen 0 und {TICK_MAX_MINUTES} liegen, "
                f"nicht {number}"
            )
        old = data.get(key)
        data[key] = number
        text = f"{key}: {old if old is not None else '—'} → {number}"
    elif key in ORCHESTRATOR_KEYS:
        field, maximum = ORCHESTRATOR_KEYS[key]
        try:
            number = int(raw.strip())
        except (TypeError, ValueError):
            raise FabError(
                f"{key} muss eine ganze Zahl zwischen 0 und {maximum} sein"
            )
        if number < 0 or number > maximum:
            raise FabError(
                f"{key} muss zwischen 0 und {maximum} liegen, nicht {number}"
            )
        entry = teams.team(data, team) if team else teams.first_team(data)
        if not isinstance(entry, dict) or not entry.get("name"):
            raise FabError("Kein Team im Roster; fab team add …")
        orchestrator = _team_orchestrator(entry)
        old = orchestrator.get(field)
        orchestrator[field] = number
        text = (
            f"{key} ({entry['name']}): {old if old is not None else '—'} "
            f"→ {number}"
        )
    else:
        raise FabError(
            f"Unbekannte Einstellung „{key}“; erlaubt: {', '.join(SETTINGS)}"
        )
    _sync_legacy(data)
    _commit(path, data, actor, text)
    return text
