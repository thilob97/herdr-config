"""Blaupausen und Teams im Roster (Ticket T-17).

Blaupausen ersetzen die früheren Agenten: Name, Rolle, Farbe, Promptpfad und
argv. Ein Team verweist mit seinen Mitgliedern auf Blaupausen und darf Modell
und Kosten je Mitglied übersteuern. `teams`/`blueprints` sind die Quelle,
die Legacy-Felder (`agents`, `reviewer`, `orchestrator`, `max_sessions`)
bleiben für die Migration erhalten. Alle Meldungen sind deutsch und für das
UI gedacht.
"""
import json
import os
import re

from .errors import FabError

NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,15}$")
RESERVED = ("orchestrator", "mensch", "fab", "preamble")
COLORS = ("c1", "c2", "c3", "c4", "c5", "c6")

DEFAULT_TEAM = "herdr-app"
DEFAULT_REPO = "~/.config/herdr-app"
GLOBAL_KEY = "max_sessions_total"
MIN_SESSIONS, MAX_SESSIONS = 1, 16
MAX_SESSIONS_TOTAL = 64
DEFAULT_MAX_SESSIONS = 4
DEFAULT_ORCHESTRATOR_PROMPT = "prompts/orchestrator.md"


# ---------------------------------------------------------------- Prüfungen

def check_name(raw):
    value = (raw or "").strip()
    if not value:
        raise FabError("Der Agentname ist leer")
    if value in RESERVED or value.lower() in RESERVED:
        raise FabError(
            f"Der Name „{value}“ ist reserviert; erlaubt sind Agentennamen wie "
            f"„zap“ oder „ada“"
        )
    if not NAME_RE.match(value):
        raise FabError(
            f"Agentname „{value}“ ist ungültig: 1–16 Zeichen, nur Kleinbuchstaben, "
            f"Ziffern, „_“ und „-“, beginnend mit einem Buchstaben "
            f"(Muster ^[a-z][a-z0-9_-]{{0,15}}$)"
        )
    return value


def check_color(value):
    if value not in COLORS:
        raise FabError(
            f"Farbe „{value}“ gibt es nicht; erlaubt sind {', '.join(COLORS)}"
        )
    return value


def check_role(raw):
    value = (raw or "").strip()
    if not value:
        raise FabError("Rolle fehlt: --role R, z. B. --role recherche")
    return value


def check_sessions(raw, what="max_sessions"):
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        raise FabError(
            f"{what} muss eine ganze Zahl zwischen {MIN_SESSIONS} und "
            f"{MAX_SESSIONS} sein"
        )
    if value < MIN_SESSIONS or value > MAX_SESSIONS:
        raise FabError(
            f"{what} muss zwischen {MIN_SESSIONS} und {MAX_SESSIONS} liegen, "
            f"nicht {value}"
        )
    return value


def check_total_sessions(raw):
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        raise FabError(
            f"{GLOBAL_KEY} muss eine ganze Zahl zwischen {MIN_SESSIONS} und "
            f"{MAX_SESSIONS_TOTAL} sein"
        )
    if value < MIN_SESSIONS or value > MAX_SESSIONS_TOTAL:
        raise FabError(
            f"{GLOBAL_KEY} muss zwischen {MIN_SESSIONS} und {MAX_SESSIONS_TOTAL} "
            f"liegen, nicht {value}"
        )
    return value


def normalize_repo(raw):
    value = str(raw or "").strip()
    if not value:
        raise FabError("Repo-Pfad ist leer")
    return os.path.realpath(
        os.path.abspath(os.path.normpath(os.path.expanduser(value)))
    )


def parse_argv(raw, what="argv"):
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise FabError(f"{what} ist kein gültiges JSON: {exc}")
    if not isinstance(data, list) or not data:
        raise FabError(
            f'{what} muss eine nicht-leere JSON-Liste sein, z. B. ["omp", "--model=…"]'
        )
    parts = []
    for part in data:
        if not isinstance(part, str):
            raise FabError(f"{what} enthält keinen String: {part!r}")
        if not part.strip():
            raise FabError(f"{what} enthält einen leeren Eintrag")
        parts.append(part)
    return parts


def parse_members(raw, what="--members-json"):
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise FabError(f"{what} ist kein gültiges JSON: {exc}")
    if not isinstance(data, list):
        raise FabError(
            f'{what} muss eine JSON-Liste sein, z. B. [{{"blueprint": "zap"}}]'
        )
    members = []
    seen = set()
    for item in data:
        if not isinstance(item, dict):
            raise FabError(f"{what} enthält kein Objekt: {item!r}")
        unknown = [key for key in item if key not in ("blueprint", "model", "max_cost")]
        if unknown:
            raise FabError(
                f"{what}: unbekannter Schlüssel „{unknown[0]}“ "
                f"(erlaubt: blueprint, model, max_cost)"
            )
        name = item.get("blueprint")
        if not isinstance(name, str) or not name.strip():
            raise FabError(f"{what}: „blueprint“ fehlt oder ist leer")
        name = name.strip()
        if name in seen:
            raise FabError(f"{what}: Blaupause „{name}“ ist doppelt")
        seen.add(name)
        member = {"blueprint": name}
        if "model" in item:
            model = item["model"]
            if not isinstance(model, str) or not model.strip():
                raise FabError(f"{what}: „model“ muss ein nicht-leerer String sein")
            member["model"] = model.strip()
        if "max_cost" in item:
            member["max_cost"] = _check_cost(item["max_cost"], what)
        members.append(member)
    return members


def _check_cost(raw, what):
    if isinstance(raw, bool):
        raise FabError(f"{what}: „max_cost“ muss eine ganze Zahl ≥ 0 sein")
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str):
        try:
            value = int(raw.strip())
        except ValueError:
            raise FabError(f"{what}: „max_cost“ muss eine ganze Zahl ≥ 0 sein")
    else:
        raise FabError(f"{what}: „max_cost“ muss eine ganze Zahl ≥ 0 sein")
    if value < 0:
        raise FabError(f"{what}: „max_cost“ muss eine ganze Zahl ≥ 0 sein")
    return value


# ---------------------------------------------------------------- Nachschlagen

def _entries(data, key):
    value = data.get(key) if isinstance(data, dict) else None
    return value if isinstance(value, list) else []


def _strings(value):
    return [str(part) for part in value] if isinstance(value, list) else []


def _prompt(entry, name):
    return str(entry.get("prompt") or f"prompts/{name}.md")


def blueprint(data, name):
    entries = _entries(data, "blueprints")
    for entry in entries:
        if isinstance(entry, dict) and entry.get("name") == name:
            return entry
    known = ", ".join(
        str(entry.get("name"))
        for entry in entries
        if isinstance(entry, dict) and entry.get("name")
    ) or "leer"
    raise FabError(f"Unbekannte Blaupause: {name} (vorhanden: {known})")


def team(data, name):
    entries = _entries(data, "teams")
    for entry in entries:
        if isinstance(entry, dict) and entry.get("name") == name:
            return entry
    known = ", ".join(
        str(entry.get("name"))
        for entry in entries
        if isinstance(entry, dict) and entry.get("name")
    ) or "leer"
    raise FabError(f"Unbekanntes Team: {name} (vorhanden: {known})")


def first_team(data):
    for entry in _entries(data, "teams"):
        if isinstance(entry, dict):
            return entry
    return None


def is_migrated(data):
    return bool(_entries(data, "teams"))


def repo_owner(data, repo, ignore=None):
    target = normalize_repo(repo)
    for entry in _entries(data, "teams"):
        if not isinstance(entry, dict):
            continue
        if ignore is not None and entry.get("name") == ignore:
            continue
        for candidate in _strings(entry.get("repos")):
            try:
                if normalize_repo(candidate) == target:
                    return entry
            except FabError:
                continue
    return None


def team_for_repo(data, repo):
    """Team-Eintrag zum Checkout oder None (auch bei leerem/ungültigem Pfad)."""
    if not repo:
        return None
    try:
        return repo_owner(data, repo)
    except FabError:
        return None


def legacy_team_name(data):
    """Das Team, dem die alten, teamlosen Terminals zugerechnet werden."""
    entry = first_team(data)
    return str(entry.get("name") or "") if isinstance(entry, dict) else ""


def no_team_message(repo):
    shown = repo or "—"
    return (
        f"Repo „{shown}“ gehört keinem Team; "
        f"fab team edit <team> --repo {shown} --from mensch"
    )


def team_limit(entry):
    return _team_limit(entry)


def orchestrator_config(entry):
    raw = entry.get("orchestrator") if isinstance(entry, dict) else None
    return _orchestrator(raw)


# ---------------------------------------------------------------- Migration

def migrate(data):
    if not isinstance(data, dict):
        return False
    has_agents = isinstance(data.get("agents"), list)
    has_blueprints = isinstance(data.get("blueprints"), list)
    if not has_agents and not has_blueprints:
        return False
    if isinstance(data.get("teams"), list):
        # Auch ein leeres `teams` ist die neue Form; sonst würde `fab team rm`
        # des letzten Teams die Migration sofort wieder auslösen.
        return False

    blueprints = list(data.get("blueprints") or [])
    known = {
        str(entry.get("name"))
        for entry in blueprints
        if isinstance(entry, dict) and entry.get("name")
    }
    members = []
    for entry in _entries(data, "agents"):
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        name = str(entry["name"]).strip()
        if not name:
            continue
        members.append({"blueprint": name})
        if name in known:
            continue
        known.add(name)
        carried = {
            key: value
            for key, value in entry.items()
            if key not in ("name", "role", "color", "prompt", "argv")
        }
        carried.update(
            {
                "name": name,
                "role": str(entry.get("role") or ""),
                "color": str(entry.get("color") or ""),
                "prompt": _prompt(entry, name),
                "argv": _strings(entry.get("argv")),
            }
        )
        blueprints.append(carried)

    legacy_limit = data.get("max_sessions")
    try:
        max_sessions = (
            DEFAULT_MAX_SESSIONS if legacy_limit is None
            else check_sessions(legacy_limit)
        )
    except FabError:
        max_sessions = DEFAULT_MAX_SESSIONS
    raw_total = data.get(GLOBAL_KEY)
    try:
        total = max_sessions if raw_total is None else check_total_sessions(raw_total)
    except FabError:
        total = max_sessions

    names = {member["blueprint"] for member in members}
    reviewer = str(data.get("reviewer") or "").strip()
    if reviewer not in names:
        reviewer = ""

    orchestrator = data.get("orchestrator")
    if not isinstance(orchestrator, dict):
        orchestrator = {}

    data["blueprints"] = blueprints
    data["teams"] = [
        {
            "name": DEFAULT_TEAM,
            "repos": [normalize_repo(DEFAULT_REPO)],
            "orchestrator": {
                "argv": _strings(orchestrator.get("argv")),
                "prompt": str(
                    orchestrator.get("prompt") or DEFAULT_ORCHESTRATOR_PROMPT
                ),
            },
            "members": members,
            "reviewer": reviewer,
            "max_sessions": max_sessions,
        }
    ]
    data[GLOBAL_KEY] = total
    return True


# ---------------------------------------------------------------- Prüfen

def validate_team(data, name, repos, members, reviewer, max_sessions, ignore=None):
    check_name(name)

    if not isinstance(repos, list) or not repos:
        raise FabError("Team braucht mindestens ein Repo")
    seen = set()
    for repo in repos:
        path = normalize_repo(repo)
        if path in seen:
            raise FabError(f"Repo „{path}“ ist im Team doppelt")
        seen.add(path)
        owner = repo_owner(data, path, ignore=ignore)
        if owner is not None:
            raise FabError(
                f"Repo „{path}“ gehört bereits zu Team {owner.get('name')}"
            )

    if not isinstance(members, list):
        raise FabError("Team braucht eine Mitgliederliste")
    names = []
    for entry in members:
        if not isinstance(entry, dict) or not entry.get("blueprint"):
            raise FabError(f"Mitglied ohne Blaupause: {entry!r}")
        found = blueprint(data, entry["blueprint"])
        names.append(str(found.get("name")))

    reviewer = str(reviewer or "").strip()
    if not reviewer or reviewer not in names:
        raise FabError("Prüfer muss Mitglied des Teams sein")

    check_sessions(max_sessions)


# ---------------------------------------------------------------- Expansion

def _replace_flag(parts, flag, value):
    prefix = flag + "="
    for index, part in enumerate(parts):
        if part.startswith(prefix):
            parts[index] = prefix + value
            return parts
    if flag in parts:
        index = parts.index(flag)
        if index + 1 < len(parts) and not parts[index + 1].startswith("--"):
            parts[index + 1] = value
        else:
            parts.insert(index + 1, value)
        return parts
    parts.append(prefix + value)
    return parts


def expand_argv(argv, model=None, max_cost=None):
    parts = [str(part) for part in (argv or [])]
    if model:
        parts = _replace_flag(parts, "--model", str(model))
    if max_cost is not None and max_cost != "":
        parts = _replace_flag(parts, "--max-cost", str(max_cost))
    return parts


def expand_team(data, team_entry):
    expanded = []
    for member in team_entry.get("members") or []:
        if not isinstance(member, dict) or not member.get("blueprint"):
            continue
        base = blueprint(data, member["blueprint"])
        name = str(base.get("name"))
        row = {
            key: value
            for key, value in base.items()
            if key not in ("name", "role", "color", "prompt", "argv")
        }
        row.update(
            {
                "name": name,
                "role": str(base.get("role") or ""),
                "color": str(base.get("color") or ""),
                "prompt": _prompt(base, name),
                "argv": expand_argv(
                    base.get("argv"), member.get("model"), member.get("max_cost")
                ),
            }
        )
        expanded.append(row)
    return expanded


def _team_limit(entry):
    limit = entry.get("max_sessions")
    return DEFAULT_MAX_SESSIONS if limit is None else check_sessions(limit)


def _team_total(data):
    total = 0
    for entry in _entries(data, "teams"):
        if not isinstance(entry, dict):
            continue
        try:
            total += _team_limit(entry)
        except FabError:
            total += DEFAULT_MAX_SESSIONS
    return max(MIN_SESSIONS, total)


def _total(data, fallback):
    raw = data.get(GLOBAL_KEY) if isinstance(data, dict) else None
    if raw is not None:
        try:
            return check_total_sessions(raw)
        except FabError:
            pass
    return max(MIN_SESSIONS, fallback)


def _orchestrator(raw):
    entry = raw if isinstance(raw, dict) else {}
    return {
        "argv": _strings(entry.get("argv")),
        "prompt": str(entry.get("prompt") or DEFAULT_ORCHESTRATOR_PROMPT),
    }


def _legacy_agents(data):
    rows = []
    for entry in _entries(data, "agents"):
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        name = str(entry["name"])
        rows.append(
            {
                "name": name,
                "role": str(entry.get("role") or ""),
                "color": str(entry.get("color") or ""),
                "prompt": _prompt(entry, name),
                "argv": _strings(entry.get("argv")),
            }
        )
    return rows


def expansion(data):
    if is_migrated(data):
        entry = first_team(data) or {}
        max_sessions = _team_limit(entry)
        return {
            "max_sessions": max_sessions,
            "max_sessions_total": _total(data, _team_total(data)),
            "reviewer": str(entry.get("reviewer") or ""),
            "orchestrator": _orchestrator(entry.get("orchestrator")),
            "agents": expand_team(data, entry),
            "team": str(entry.get("name") or "") or None,
        }

    raw_limit = data.get("max_sessions") if isinstance(data, dict) else None
    max_sessions = (
        DEFAULT_MAX_SESSIONS if raw_limit is None else check_sessions(raw_limit)
    )
    return {
        "max_sessions": max_sessions,
        "max_sessions_total": _total(data, max_sessions),
        "reviewer": str(data.get("reviewer") or "") if isinstance(data, dict) else "",
        "orchestrator": _orchestrator(
            data.get("orchestrator") if isinstance(data, dict) else None
        ),
        "agents": _legacy_agents(data),
        "team": None,
    }


# ---------------------------------------------------------------- Zeilen fürs UI

def blueprint_rows(data):
    teams = _entries(data, "teams")
    rows = []
    for entry in _entries(data, "blueprints"):
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        name = str(entry["name"])
        used = []
        for team_entry in teams:
            if not isinstance(team_entry, dict):
                continue
            for member in team_entry.get("members") or []:
                if isinstance(member, dict) and member.get("blueprint") == name:
                    used.append(str(team_entry.get("name") or ""))
                    break
        rows.append(
            {
                "name": name,
                "role": str(entry.get("role") or ""),
                "color": str(entry.get("color") or ""),
                "prompt": _prompt(entry, name),
                "argv": _strings(entry.get("argv")),
                "teams": used,
            }
        )
    return rows


def team_rows(data):
    rows = []
    for entry in _entries(data, "teams"):
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        members = [
            dict(member)
            for member in (entry.get("members") or [])
            if isinstance(member, dict)
        ]
        rows.append(
            {
                "name": str(entry["name"]),
                "repos": _strings(entry.get("repos")),
                "orchestrator": _orchestrator(entry.get("orchestrator")),
                "members": members,
                "reviewer": str(entry.get("reviewer") or ""),
                "max_sessions": _team_limit(entry),
                "agents": expand_team(data, entry),
            }
        )
    return rows
