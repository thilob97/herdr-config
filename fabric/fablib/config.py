"""Roster und Einstellungen pflegen (Abschnitt 3b des Vertrags).

Jede Änderung läuft unter dem Lock aus `store`, schreibt atomar, lässt Felder
stehen, die `fab` nicht kennt, hängt ein `config`-Ereignis an und erzeugt
`index.json` neu. Alle Meldungen sind deutsch und für das UI gedacht.
"""
import json
import os
import re
import stat

from . import agents, events, git, hc, index, store
from .errors import FabError, HcError

NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,15}$")
RESERVED = ("orchestrator", "mensch", "fab", "preamble")
COLORS = ("c1", "c2", "c3", "c4", "c5", "c6")
SETTINGS = ("max_sessions", "reviewer", "orchestrator_argv")
MIN_SESSIONS = 1
MAX_SESSIONS = 16

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


def _entries(data):
    entries = data.get("agents")
    if entries is None:
        entries = []
        data["agents"] = entries
    if not isinstance(entries, list):
        raise FabError("Roster: „agents“ ist keine Liste")
    return entries


def _names(entries):
    return [
        str(entry.get("name"))
        for entry in entries
        if isinstance(entry, dict) and entry.get("name")
    ]


def _entry(entries, name):
    for entry in entries:
        if isinstance(entry, dict) and entry.get("name") == name:
            return entry
    known = ", ".join(_names(entries)) or "leer"
    raise FabError(f"Unbekannter Agent: {name} (Roster: {known})")


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


def _check_color(value):
    if value not in COLORS:
        raise FabError(
            f"Farbe „{value}“ gibt es nicht; erlaubt sind {', '.join(COLORS)}"
        )
    return value


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


def _check_role(raw):
    value = (raw or "").strip()
    if not value:
        raise FabError("Rolle fehlt: --role R, z. B. --role recherche")
    return value


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


def _running_sessions(name, live):
    prefix = f"fab-{name.lower()}-"
    return sorted(terminal for terminal in live if terminal.startswith(prefix))


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
        if terminal.startswith(prefix):
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
                "argv": list(entry["argv"]),
                "prompt": entry["prompt"],
                "program": program,
                "model": model,
                "flags": flags,
                "open_tickets": open_counts.get(entry["name"], 0),
                "sessions": _sessions(entry["name"], live),
            }
        )
    return {
        "path": roster["path"],
        "max_sessions": roster["max_sessions"],
        "reviewer": roster["reviewer"],
        "orchestrator": {
            "argv": list(roster["orchestrator"]["argv"]),
            "prompt": roster["orchestrator"]["prompt"],
        },
        "agents": rows,
    }


# ---------------------------------------------------------------- Agenten

def add(name, role, color, argv_json, prompt_text, actor):
    name = check_name(name)
    role = _check_role(role)
    argv = parse_argv(argv_json, "--argv-json")
    path, data = _load()
    entries = _entries(data)
    if name in _names(entries):
        raise FabError(
            f"Agent „{name}“ gibt es schon; nimm einen anderen Namen oder "
            f"fab agent edit {name}"
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
    _commit(
        path,
        data,
        actor,
        f"Agent {name} angelegt: Rolle {role}, Farbe {value}, Programm {argv[0]}",
        written=written,
    )
    return entry


def edit(name, rename=None, role=None, color=None, argv_json=None,
         prompt_text=None, actor=""):
    path, data = _load()
    entries = _entries(data)
    entry = _entry(entries, name)
    directory = os.path.dirname(path)

    target = name
    if rename is not None:
        candidate = rename.strip()
        if not candidate:
            raise FabError("Der neue Name ist leer")
        if candidate != name:
            target = check_name(candidate)
            if target in _names(entries):
                raise FabError(
                    f"Agent „{target}“ gibt es schon; wähle einen anderen Namen"
                )
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
        if str(data.get("reviewer") or "") == name:
            data["reviewer"] = target
            changes.append(f"reviewer → {target}")

    if not changes:
        raise FabError(
            "Nichts zu ändern: nutze --rename, --role, --color, --argv-json "
            "oder --prompt-text"
        )
    _commit(
        path, data, actor, f"Agent {name} geändert: " + ", ".join(changes),
        written=written,
    )
    return f"Agent „{target}“ geändert: " + ", ".join(changes)


def remove(name, actor):
    path, data = _load()
    entries = _entries(data)
    entry = _entry(entries, name)
    reasons = _busy_reasons(name, _live_checked())
    if str(data.get("reviewer") or "") == name:
        reasons.append("ist als Prüfer im Roster eingetragen (reviewer)")
    if reasons:
        raise FabError(
            f"Agent „{name}“ kann nicht entfernt werden:\n- "
            + "\n- ".join(reasons)
        )
    rel = str(entry.get("prompt") or f"prompts/{name}.md")
    entries.remove(entry)
    _commit(path, data, actor, f"Agent {name} entfernt; Prompt {rel} bleibt")
    return rel


# ---------------------------------------------------------------- Einstellungen

def set_setting(key, value, actor):
    raw = "" if value is None else str(value)
    path, data = _load()
    if key == "max_sessions":
        try:
            number = int(raw.strip())
        except ValueError:
            raise FabError(
                f"max_sessions muss eine ganze Zahl von {MIN_SESSIONS} bis "
                f"{MAX_SESSIONS} sein (ist: „{raw}“)"
            )
        if not MIN_SESSIONS <= number <= MAX_SESSIONS:
            raise FabError(
                f"max_sessions muss zwischen {MIN_SESSIONS} und {MAX_SESSIONS} "
                f"liegen (ist: {number})"
            )
        old = data.get("max_sessions")
        data["max_sessions"] = number
        text = f"max_sessions: {old} → {number}"
    elif key == "reviewer":
        name = raw.strip()
        names = _names(_entries(data))
        if name not in names:
            raise FabError(
                f"reviewer muss ein Agent aus dem Roster sein („{name}“ fehlt); "
                f"im Roster: {', '.join(names) or 'keine'}"
            )
        data["reviewer"] = name
        text = f"reviewer: {name}"
    elif key == "orchestrator_argv":
        argv = parse_argv(raw, "orchestrator_argv")
        orchestrator = data.get("orchestrator")
        if not isinstance(orchestrator, dict):
            orchestrator = {}
            data["orchestrator"] = orchestrator
        orchestrator["argv"] = argv
        text = "orchestrator_argv: " + " ".join(argv)
    else:
        raise FabError(
            f"Unbekannte Einstellung „{key}“; erlaubt: {', '.join(SETTINGS)}"
        )
    _commit(path, data, actor, text)
    return text
