"""Workflows: JSON-Graph, Läufe in SQLite und die Engine für `fab flow`/`fab tick`.

Eine Definition ist ein JSON-Objekt mit `name`, `nodes` und `edges`. Knoten
haben eine ID und einen Typ (`trigger`, `agent`, `action`, `condition`,
`approval`, `end`). Kanten verbinden `from` mit `to`; `when` wählt bei
Bedingungen und Agentenschritten den Ausgang (`pass`/`fail` bzw.
`done`/`dropped`), `max_loops` begrenzt eine Kante.

Läufe liegen in `flow_runs`/`flow_steps`, ihr Fortschritt im JSON-Feld `data`
(`current`, `outputs`, `tickets`, `loops`). Ein Lauf wird nur unter
`store.locked()` verändert; `tick` setzt offene Läufe nach einem Neustart an
ihrem Schritt fort.

Platzhalter `{{knoten.feld}}` werden aus den Ausgaben vorheriger Knoten
ersetzt. Eine Bedingung ist ein einfacher Vergleich (`{{a.status}} == done`)
und niemals `eval`; Ausgaben sind Zeichenketten, Zahlen werden numerisch
verglichen.
"""
import json
import os
import re
import shlex
import subprocess
import sys

from . import costs, events, git, store, templates
from .errors import FabError

NODE_TYPES = ("trigger", "agent", "action", "condition", "approval", "end")
TRIGGER_TYPES = ("manual", "cron", "ticket_done", "github_issue", "main_red")
ACTION_TYPES = ("shell", "fab", "notify")

PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)\s*\}\}")
_COMPARE = re.compile(r"^(.*?)\s*(==|!=|>=|<=|>|<|contains)\s*(.*)$", re.DOTALL)
_MAX_PLAN = 200


class FlowError(FabError):
    """Ungültige Workflow-Definition oder unbekannter Lauf."""


# ---------------------------------------------------------------- Definitionen


def _read_file(path):
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as handle:
            data = json.load(handle)
    except OSError as exc:
        raise FlowError(f"Workflow-Datei {path} nicht lesbar: {exc}")
    except json.JSONDecodeError as exc:
        raise FlowError(f"Workflow-Datei {path} ist kein gültiges JSON: {exc}")
    return data


def validate(definition):
    """Geprüfte, normalisierte Kopie; bricht mit `FlowError` ab."""
    if not isinstance(definition, dict):
        raise FlowError("Workflow-Definition ist kein JSON-Objekt")
    name = str(definition.get("name") or "").strip()
    if not name:
        raise FlowError("Workflow braucht einen Namen")
    raw_nodes = definition.get("nodes")
    raw_edges = definition.get("edges")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise FlowError(f"{name}: Knoten fehlen")
    if not isinstance(raw_edges, list):
        raise FlowError(f"{name}: Kanten fehlen")

    nodes = []
    by_id = {}
    for raw in raw_nodes:
        if not isinstance(raw, dict):
            raise FlowError(f"{name}: Knoten ist kein JSON-Objekt")
        node_id = str(raw.get("id") or "").strip()
        if not node_id:
            raise FlowError(f"{name}: Knoten ohne ID")
        if node_id in by_id:
            raise FlowError(f"{name}: Knoten {node_id} doppelt")
        kind = str(raw.get("type") or "").strip()
        if kind not in NODE_TYPES:
            raise FlowError(
                f"{name}: Knoten {node_id} hat unbekannten Typ {kind or '—'}"
            )
        node = dict(raw)
        node["id"] = node_id
        node["type"] = kind
        if kind == "trigger":
            trigger = str(node.get("trigger") or "").strip()
            if trigger not in TRIGGER_TYPES:
                raise FlowError(
                    f"{name}: Knoten {node_id} hat unbekannten Auslöser "
                    f"{trigger or '—'}"
                )
            node["trigger"] = trigger
            if trigger == "cron":
                try:
                    every = int(node.get("every_minutes") or 0)
                except (TypeError, ValueError):
                    every = 0
                if every <= 0:
                    raise FlowError(
                        f"{name}: cron-Auslöser {node_id} braucht "
                        f"every_minutes > 0"
                    )
                node["every_minutes"] = every
        elif kind == "action":
            action = str(node.get("action") or "").strip()
            if action not in ACTION_TYPES:
                raise FlowError(
                    f"{name}: Knoten {node_id} hat unbekannte Aktion "
                    f"{action or '—'}"
                )
            node["action"] = action
            if action in ("shell", "fab") and not str(
                node.get("command") or ""
            ).strip():
                raise FlowError(f"{name}: Aktion {node_id} braucht einen Befehl")
        elif kind == "condition":
            if not str(node.get("expr") or "").strip():
                raise FlowError(f"{name}: Bedingung {node_id} braucht einen Ausdruck")
        by_id[node_id] = node
        nodes.append(node)

    if not any(node["type"] == "trigger" for node in nodes):
        raise FlowError(f"{name}: Auslöser fehlt")
    if not any(node["type"] == "end" for node in nodes):
        raise FlowError(f"{name}: Ende fehlt")

    edges = []
    for raw in raw_edges:
        if not isinstance(raw, dict):
            raise FlowError(f"{name}: Kante ist kein JSON-Objekt")
        source = str(raw.get("from") or "").strip()
        target = str(raw.get("to") or "").strip()
        if source not in by_id:
            raise FlowError(f"{name}: Kante von unbekanntem Knoten {source or '—'}")
        if target not in by_id:
            raise FlowError(f"{name}: Kante auf unbekannten Knoten {target or '—'}")
        edge = dict(raw)
        edge["from"] = source
        edge["to"] = target
        if edge.get("max_loops") is not None:
            try:
                limit = int(edge["max_loops"])
            except (TypeError, ValueError):
                raise FlowError(
                    f"{name}: Kante {source} → {target} hat kein gültiges "
                    f"Schleifenlimit"
                )
            if limit <= 0:
                raise FlowError(
                    f"{name}: Kante {source} → {target} braucht max_loops > 0"
                )
            edge["max_loops"] = limit
        edges.append(edge)

    for cycle in _cycles(edges):
        if not any(edges[index].get("max_loops") for index in cycle):
            path = [edges[index]["from"] for index in cycle]
            path.append(edges[cycle[-1]]["to"])
            raise FlowError(
                f"{name}: Zyklus ohne Schleifenlimit: " + " → ".join(path)
            )

    limits = definition.get("limits")
    cleaned_limits = {}
    if limits is not None:
        if not isinstance(limits, dict):
            raise FlowError(f"{name}: limits ist kein JSON-Objekt")
        for key in ("max_cost", "max_minutes"):
            value = limits.get(key)
            if value in (None, ""):
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                raise FlowError(f"{name}: limits.{key} ist keine Zahl")
            if number < 0:
                raise FlowError(f"{name}: limits.{key} darf nicht negativ sein")
            cleaned_limits[key] = number
    result = dict(definition)
    result["name"] = name
    result["nodes"] = nodes
    result["edges"] = edges
    result["limits"] = cleaned_limits
    return result


def _cycles(edges):
    """Einfache Zyklen als Listen von Kantenindizes (ohne Drehungs-Dubletten)."""
    adjacency = {}
    for index, edge in enumerate(edges):
        adjacency.setdefault(edge["from"], []).append(index)
    found = []
    seen = set()

    def walk(start, node, path_nodes, path_edges):
        for index in adjacency.get(node, []):
            nxt = edges[index]["to"]
            if nxt == start:
                key = tuple(sorted(path_edges + [index]))
                if key not in seen:
                    seen.add(key)
                    found.append(path_edges + [index])
            elif nxt not in path_nodes:
                walk(start, nxt, path_nodes | {nxt}, path_edges + [index])

    for node in adjacency:
        walk(node, node, {node}, [])
    return found


def definitions():
    return store.flow_definitions()


def get(name):
    definition = store.flow_definition_load(str(name or "").strip())
    if definition is None:
        raise FlowError(f"Workflow „{name}“ gibt es nicht")
    return definition


def save(definition, actor="mensch"):
    cleaned = validate(definition)
    with store.locked():
        store.flow_definition_save(cleaned["name"], cleaned)
        store.meta_set(_done_marker_key(cleaned["name"]), str(_max_done_number()))
        events.append(
            "flow", "", actor, cleaned["name"], "Workflow gespeichert",
            reason=f"{len(cleaned['nodes'])} Knoten, {len(cleaned['edges'])} Kanten",
        )
    return cleaned


def add_file(path, actor="mensch"):
    return save(_read_file(path), actor)


def edit(name, path, actor="mensch"):
    data = _read_file(path)
    data["name"] = str(name or "").strip()
    return save(data, actor)


def remove(name, actor="mensch"):
    value = str(name or "").strip()
    with store.locked():
        if not store.flow_definition_delete(value):
            raise FlowError(f"Workflow „{value}“ gibt es nicht")
        events.append("flow", "", actor, value, "Workflow entfernt")
        store.meta_set(_done_marker_key(value), str(_max_done_number()))


# ---------------------------------------------------------------- Läufe


def start(name, actor="mensch", dry=False, now=None):
    """Lauf starten (oder mit `dry` nur den geplanten Pfad zeigen)."""
    now = int(now if now is not None else store.now_ms())
    definition = get(name)
    if dry:
        path = _plan(definition)
        return {
            "workflow": definition["name"],
            "run": None,
            "status": "dry",
            "lines": [
                f"trocken: Workflow „{definition['name']}“: " + " → ".join(path),
                "trocken: kein Ticket, kein Befehl",
            ],
        }
    with store.locked():
        return _start_locked(definition, actor, now)


def _start_locked(definition, actor, now):
    trigger = next(
        node for node in definition["nodes"] if node["type"] == "trigger"
    )
    data = {
        "current": trigger["id"],
        "outputs": {},
        "tickets": {},
        "loops": {},
        "repo": _repo_for(definition),
        "limits": dict(definition.get("limits") or {}),
        "started_at": now,
    }
    run_id = store.flow_run_new(definition["name"], data)
    events.append(
        "flow", "", actor, trigger["id"], f"Lauf {run_id} gestartet",
        reason=definition["name"],
    )
    run = store.flow_run_load(run_id)
    try:
        _advance(run, definition, now=now)
    except FlowError as exc:
        _finish(run, "failed", str(exc))
    lines = [
        f"Workflow „{definition['name']}“ gestartet: Lauf {run_id} "
        f"({run['status']})"
    ]
    if run["status"] == "failed" and run.get("reason"):
        lines.append(f"Lauf {run_id}: {run['reason']}")
    elif run["status"] == "running":
        node = _node(definition, run["data"].get("current"))
        waiting = (run["data"].get("tickets") or {}).get(node["id"]) if node else None
        if waiting:
            lines.append(
                f"Lauf {run_id}: wartet auf Ticket {waiting} "
                f"(Schritt {node['id']})"
            )
    return {
        "workflow": definition["name"],
        "run": run_id,
        "status": run["status"],
        "lines": lines,
    }


def tick(roster=None, dry=False, now=None):
    """Offene Läufe fortsetzen und Auslöser prüfen; Zeilen für `fab tick`."""
    now = int(now if now is not None else store.now_ms())
    lines = []
    with store.locked():
        by_name = {row["name"]: row for row in store.flow_definitions()}
        for run in store.flow_run_list():
            if run["status"] != "running":
                continue
            definition = by_name.get(run["workflow"])
            if definition is None:
                if not dry:
                    _finish(run, "failed", "Workflow fehlt")
                lines.append(f"Lauf {run['id']}: Workflow fehlt")
                continue
            if dry:
                lines.append(f"geplant: Lauf {run['id']} fortsetzen")
                continue
            try:
                changed = _advance(run, definition, now=now)
            except FlowError as exc:
                _finish(run, "failed", str(exc))
                changed = True
            if changed:
                detail = run["status"]
                if run.get("reason"):
                    detail += f" – {run['reason']}"
                lines.append(f"Lauf {run['id']}: {detail}")
        for definition in by_name.values():
            try:
                lines.extend(_triggers(definition, now, dry))
            except FlowError as exc:
                lines.append(f"Workflow „{definition['name']}“: Fehler: {exc}")
    return lines


def _triggers(definition, now, dry):
    lines = []
    name = definition["name"]
    for trigger in [
        node for node in definition["nodes"] if node["type"] == "trigger"
    ]:
        kind = trigger["trigger"]
        if kind == "manual":
            continue
        if kind == "cron":
            if _cron_due(definition, trigger, now):
                if dry:
                    lines.append(
                        f"geplant: Workflow „{name}“ starten (cron)"
                    )
                else:
                    lines.append(_started_line(_start_locked(definition, "tick", now)))
            continue
        if kind == "ticket_done":
            for ticket in _done_candidates(name):
                number = _number(ticket["id"])
                if _self_triggered(ticket, name):
                    if dry:
                        lines.append(
                            f"geplant: {ticket['id']} startet Workflow „{name}“ "
                            f"verweigert (Selbstauslösung)"
                        )
                    else:
                        store.meta_set(_done_marker_key(name), str(number))
                        lines.append(
                            f"{ticket['id']}: Selbstauslösung von „{name}“ "
                            f"verweigert"
                        )
                    continue
                if dry:
                    lines.append(
                        f"geplant: Workflow „{name}“ starten ({ticket['id']})"
                    )
                else:
                    lines.append(_started_line(_start_locked(definition, "tick", now)))
                    store.meta_set(_done_marker_key(name), str(number))
            continue
        if kind == "github_issue":
            if _issue_due(definition, trigger):
                if dry:
                    lines.append(
                        f"geplant: Workflow „{name}“ starten (GitHub-Issue)"
                    )
                else:
                    lines.append(_started_line(_start_locked(definition, "tick", now)))
            continue
        if kind == "main_red":
            if _main_red_due(definition):
                if dry:
                    lines.append(
                        f"geplant: Workflow „{name}“ starten (main rot)"
                    )
                else:
                    lines.append(_started_line(_start_locked(definition, "tick", now)))
    return lines


def _started_line(result):
    return result["lines"][0] + (
        " – " + result["lines"][1].split(": ", 1)[-1]
        if len(result["lines"]) > 1
        else ""
    )


def runs(workflow=None):
    rows = []
    for run in store.flow_run_list(workflow):
        data = run.get("data") if isinstance(run.get("data"), dict) else {}
        rows.append(
            {
                "id": run["id"],
                "workflow": run["workflow"],
                "status": run["status"],
                "reason": run.get("reason") or "",
                "current": data.get("current") or "",
                "started_at": run.get("started_at"),
                "updated_at": run.get("updated_at"),
            }
        )
    return rows


def pause(run_id, actor="mensch"):
    return _set_state(run_id, "paused", "pausiert", actor, paused_kind="manual")


def resume(run_id, actor="mensch"):
    """Einen pausierten Lauf fortsetzen; eine Freigabe gilt damit als erteilt."""
    run_id = _run_id(run_id)
    with store.locked():
        run = store.flow_run_load(run_id)
        if run is None:
            raise FlowError(f"Lauf {run_id} gibt es nicht")
        if run["status"] != "paused":
            raise FlowError(
                f"Lauf {run_id} ist nicht pausiert (Status {run['status']})"
            )
        definition = get(run["workflow"])
        data = run["data"]
        paused = data.pop("paused_at", None)
        if not isinstance(paused, dict):
            paused = {}
        run["status"] = "running"
        run["reason"] = ""
        events.append(
            "flow", "", actor,
            paused.get("node") or data.get("current") or "",
            f"Lauf {run_id} fortgesetzt", reason=run["workflow"],
        )
        if paused.get("kind") == "approval":
            node = _node(definition, paused.get("node") or data.get("current"))
            if node is not None:
                _step(run, node, "done", {})
                outgoing = _outgoing(definition, node["id"])
                if not outgoing:
                    _finish(run, "failed", f"kein Folgeknoten nach {node['id']}")
                else:
                    _traverse(run, definition, outgoing[0])
        store.flow_run_save(run)
        if run["status"] == "running":
            try:
                _advance(run, definition, now=store.now_ms())
            except FlowError as exc:
                _finish(run, "failed", str(exc))
    return _run_row(run)


def cancel(run_id, actor="mensch"):
    return _set_state(run_id, "cancelled", "abgebrochen", actor)


def _set_state(raw, status, word, actor, paused_kind=None):
    run_id = _run_id(raw)
    with store.locked():
        run = store.flow_run_load(run_id)
        if run is None:
            raise FlowError(f"Lauf {raw} gibt es nicht")
        if run["status"] in ("done", "failed", "cancelled"):
            raise FlowError(f"Lauf {run_id} ist bereits {run['status']}")
        if run["status"] == status:
            return _run_row(run)
        run["status"] = status
        run["reason"] = word
        data = run.get("data")
        if isinstance(data, dict):
            if status == "paused":
                data["paused_at"] = {
                    "node": data.get("current") or "",
                    "kind": paused_kind or "manual",
                }
            else:
                data.pop("paused_at", None)
        store.flow_run_save(run)
        events.append(
            "flow", "", actor, (run["data"] or {}).get("current") or "",
            f"Lauf {run_id} {word}", reason=run["workflow"],
        )
    return _run_row(run)


def _run_row(run):
    data = run.get("data") if isinstance(run.get("data"), dict) else {}
    return {
        "id": run["id"],
        "workflow": run["workflow"],
        "status": run["status"],
        "reason": run.get("reason") or "",
        "current": data.get("current") or "",
        "started_at": run.get("started_at"),
        "updated_at": run.get("updated_at"),
    }


def _run_id(raw):
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        raise FlowError(f"Ungültige Laufnummer: {raw!r} (erwartet eine Zahl)")


# ---------------------------------------------------------------- Engine


def _advance(run, definition, now):
    """Einen Lauf so weit führen, bis er wartet, endet oder scheitert."""
    changed = False
    guard = 0
    while run["status"] == "running":
        guard += 1
        if guard > _MAX_PLAN:
            _finish(run, "failed", "Schrittlimit des Laufs erreicht")
            return True
        data = run["data"]
        node = _node(definition, data.get("current"))
        if node is None:
            _finish(run, "failed", "Knoten fehlt")
            return True
        limit = _limit_reason(run, now)
        if limit:
            _finish(run, "failed", limit)
            return True
        kind = node["type"]
        if kind == "end":
            _step(run, node, "done", {})
            _finish(run, "done", "")
            return True
        if kind == "trigger":
            outgoing = _outgoing(definition, node["id"])
            if not outgoing:
                _finish(run, "failed", f"kein Folgeknoten nach {node['id']}")
                return True
            _step(run, node, "done", {})
            if not _traverse(run, definition, outgoing[0]):
                return True
            changed = True
            continue
        if kind == "agent":
            ticket_id = (data.get("tickets") or {}).get(node["id"])
            if not ticket_id:
                ticket_id = _ticket_create(run, definition, node)
                data["tickets"][node["id"]] = ticket_id
                store.flow_run_save(run)
                _step(run, node, "wartet", {"ticket": ticket_id})
                return True
            try:
                ticket = store.load(ticket_id)
            except FabError:
                _finish(run, "failed", f"Ticket {ticket_id} fehlt")
                return True
            status = str(ticket.get("status") or "")
            if status not in ("done", "dropped"):
                return changed
            data["outputs"][node["id"]] = _ticket_outputs(ticket)
            _step(run, node, "done", data["outputs"][node["id"]])
            edge = _pick_edge(definition, node["id"], status)
            if edge is None:
                _finish(run, "failed", f"kein Ausgang für {node['id']} ({status})")
                return True
            if not _traverse(run, definition, edge):
                return True
            changed = True
            continue
        if kind == "condition":
            passed = _evaluate(node.get("expr") or "", data.get("outputs") or {})
            data["outputs"][node["id"]] = {"pass": passed}
            _step(run, node, "pass" if passed else "fail", {"pass": passed})
            edge = _pick_edge(
                definition, node["id"], "pass" if passed else "fail"
            )
            if edge is None:
                _finish(
                    run, "failed",
                    f"kein Ausgang für {node['id']} ({'pass' if passed else 'fail'})",
                )
                return True
            if not _traverse(run, definition, edge):
                return True
            changed = True
            continue
        if kind == "action":
            output = _action(run, definition, node)
            data["outputs"][node["id"]] = output
            ok = int(output.get("code") or 0) == 0
            _step(run, node, "done" if ok else "fail", output)
            edge = _pick_edge(definition, node["id"], "pass" if ok else "fail")
            if edge is None:
                _finish(run, "failed", f"kein Ausgang für {node['id']}")
                return True
            if not _traverse(run, definition, edge):
                return True
            changed = True
            continue
        if kind == "approval":
            text = _resolve(node.get("text") or f"Freigabe für Lauf {run['id']}",
                            data.get("outputs") or {})
            _step(run, node, "wartet", {"text": text})
            events.append(
                "flow", "", "flow", node["id"], f"freigabe: {text}",
                reason=definition["name"],
            )
            run["status"] = "paused"
            run["reason"] = f"Freigabe offen: {text}"
            run["data"]["paused_at"] = {"node": node["id"], "kind": "approval"}
            store.flow_run_save(run)
            return True
    return changed


def _traverse(run, definition, edge):
    data = run["data"]
    key = f"{edge['from']}->{edge['to']}"
    used = int((data.get("loops") or {}).get(key, 0)) + 1
    limit = edge.get("max_loops")
    if limit is not None and used > int(limit):
        _finish(
            run, "failed",
            f"Schleifenlimit der Kante {key} erreicht ({limit})",
        )
        return False
    data.setdefault("loops", {})[key] = used
    data["current"] = edge["to"]
    return True


def _finish(run, status, reason):
    run["status"] = status
    run["reason"] = reason
    store.flow_run_save(run)
    text = f"Lauf {run['id']}: {status}"
    if reason:
        text += f" – {reason}"
    events.append(
        "flow", "", "flow", (run["data"] or {}).get("current") or "", text,
        reason=run["workflow"],
    )


def _step(run, node, status, data):
    store.flow_step_add(
        run["id"], node["id"], node["type"], status, data or {}
    )
    events.append(
        "flow", "", "flow", node["id"],
        f"Lauf {run['id']} {node['id']}: {status}",
        reason=run["workflow"],
    )


def _limit_reason(run, now):
    data = run["data"]
    limits = data.get("limits") or {}
    minutes = _number_or_none(limits.get("max_minutes"))
    started = int(data.get("started_at") or now)
    if minutes and now - started > int(minutes * 60000):
        return f"Zeitlimit überschritten ({int(minutes)} min)"
    cost_limit = _number_or_none(limits.get("max_cost"))
    if cost_limit:
        total = 0.0
        seen = set()
        for ticket_id in (data.get("tickets") or {}).values():
            if ticket_id in seen:
                continue
            seen.add(ticket_id)
            try:
                total += float(costs.collect(store.load(ticket_id)).get("total") or 0)
            except FabError:
                continue
        if total > cost_limit:
            return (
                f"Kostenlimit überschritten "
                f"({total:.4g} > {cost_limit:.4g} USD)"
            )
    return ""


# ---------------------------------------------------------------- Knoten


def _node(definition, node_id):
    for node in definition["nodes"]:
        if node["id"] == node_id:
            return node
    return None


def _outgoing(definition, node_id):
    return [edge for edge in definition["edges"] if edge["from"] == node_id]


def _pick_edge(definition, node_id, outcome):
    outgoing = _outgoing(definition, node_id)
    for edge in outgoing:
        if str(edge.get("when") or "") == outcome:
            return edge
    if len(outgoing) == 1:
        return outgoing[0]
    for edge in outgoing:
        if not edge.get("when"):
            return edge
    return None


def _plan(definition):
    """Vorschau: dem ersten Ausgang folgen, ohne etwas auszuführen."""
    nodes = {node["id"]: node for node in definition["nodes"]}
    start = next(node for node in definition["nodes"] if node["type"] == "trigger")
    path = [start["id"]]
    seen = set()
    node = start
    while len(path) < _MAX_PLAN:
        if node["id"] in seen:
            path.append("…")
            break
        seen.add(node["id"])
        if node["type"] == "end":
            break
        outgoing = _outgoing(definition, node["id"])
        if not outgoing:
            path.append("!")
            break
        edge = next(
            (item for item in outgoing if str(item.get("when") or "") == "pass"),
            outgoing[0],
        )
        node = nodes[edge["to"]]
        path.append(node["id"])
    return path


def _repo_for(definition):
    raw = definition.get("repo")
    if raw:
        return os.path.abspath(os.path.expanduser(str(raw)))
    return git.main_toplevel(os.getcwd()) or os.getcwd()


# ---------------------------------------------------------------- Ticket-Schritt


def _ticket_create(run, definition, node):
    outputs = run["data"].get("outputs") or {}
    prompt = _resolve(str(node.get("prompt") or ""), outputs)
    if node.get("template"):
        prompt = templates.render(
            templates.show(str(node["template"])),
            prompt or str(node.get("title") or definition["name"]),
        )
    title = _resolve(
        str(node.get("title") or f"{definition['name']}: {node['id']}"), outputs
    )
    title = " ".join(title.split())[:120] or definition["name"]
    ticket_id = store.next_id()
    ticket = store.blank_ticket(
        ticket_id,
        title=title,
        body=prompt,
        repo=run["data"].get("repo"),
        created_by="flow",
    )
    agent = str(node.get("agent") or "").strip()
    if agent:
        ticket["assignee"] = agent.lower()
    ticket["status"] = "todo"
    ticket["flow"] = {
        "workflow": definition["name"],
        "run": run["id"],
        "step": node["id"],
    }
    store.save(ticket)
    events.append("created", ticket_id, "flow", "", title)
    return ticket_id


def _ticket_outputs(ticket):
    ticket_id = ticket["id"]
    summary = ""
    try:
        for row in events.read_all():
            if row.get("ticket") == ticket_id and row.get("kind") == "handover":
                summary = str(row.get("text") or "")
    except FabError:
        summary = ""
    if not summary and ticket.get("comments"):
        summary = str(ticket["comments"][-1].get("text") or "")
    files = ""
    if ticket.get("repo") and ticket.get("base") and ticket.get("branch"):
        try:
            files = "\n".join(
                git.diff_paths(ticket["repo"], ticket["base"], ticket["branch"])
            )
        except FabError:
            files = ""
    attachments = "\n".join(
        str(item.get("path") or "") for item in ticket.get("attachments") or []
    )
    return {
        "status": str(ticket.get("status") or ""),
        "zusammenfassung": summary,
        "dateien": files,
        "branch": str(ticket.get("branch") or ""),
        "pr": str(ticket.get("pr") or ""),
        "anhaenge": attachments,
        "ticket": ticket_id,
    }


# ---------------------------------------------------------------- Aktionen


def _action(run, definition, node):
    outputs = run["data"].get("outputs") or {}
    kind = node["action"]
    if kind == "notify":
        text = _resolve(str(node.get("text") or ""), outputs)
        events.append(
            "flow", "", "flow", node["id"], f"Benachrichtigung: {text}",
            reason=definition["name"],
        )
        return {"code": 0, "ausgabe": text, "fehler": ""}
    command = _resolve(str(node.get("command") or ""), outputs, quote=True)
    repo = run["data"].get("repo") or os.getcwd()
    if kind == "shell":
        try:
            completed = subprocess.run(
                command, shell=True, cwd=repo, capture_output=True, text=True
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return {"code": 1, "ausgabe": "", "fehler": str(exc)}
    else:
        fab = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fab"
        )
        try:
            completed = subprocess.run(
                [sys.executable, fab, *shlex.split(command)],
                cwd=repo, capture_output=True, text=True,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return {"code": 1, "ausgabe": "", "fehler": str(exc)}
    return {
        "code": completed.returncode,
        "ausgabe": (completed.stdout or "").strip(),
        "fehler": (completed.stderr or "").strip(),
    }


# ---------------------------------------------------------------- Ausdrücke


def _resolve(text, outputs, quote=False):
    """Platzhalter ersetzen; mit `quote` als ein sicheres Shell-Argument."""

    def replace(match):
        node, field = match.group(1), match.group(2)
        values = outputs.get(node)
        if not isinstance(values, dict) or field not in values:
            return match.group(0)
        value = values[field]
        if isinstance(value, bool):
            value = "true" if value else "false"
        text_value = str(value)
        return shlex.quote(text_value) if quote else text_value

    return PLACEHOLDER.sub(replace, text)


def _evaluate(expr, outputs):
    text = _resolve(str(expr).strip(), outputs)
    lowered = text.lower()
    if lowered in ("pass", "wahr", "true", "ja"):
        return True
    if lowered in ("fail", "falsch", "false", "nein"):
        return False
    match = _COMPARE.match(text)
    if not match:
        raise FlowError(f"Bedingung nicht lesbar: {expr}")
    left = _unquote(match.group(1).strip())
    operator = match.group(2)
    right = _unquote(match.group(3).strip())
    if operator == "contains":
        return right in left
    left_number = _number_or_none(left)
    right_number = _number_or_none(right)
    if left_number is not None and right_number is not None:
        first, second = left_number, right_number
    else:
        first, second = left, right
    if operator == "==":
        return first == second
    if operator == "!=":
        return first != second
    try:
        if operator == ">":
            return first > second
        if operator == "<":
            return first < second
        if operator == ">=":
            return first >= second
        if operator == "<=":
            return first <= second
    except TypeError:
        return False
    raise FlowError(f"Bedingung nicht lesbar: {expr}")


def _unquote(text):
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        return text[1:-1]
    return text


def _number_or_none(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


# ---------------------------------------------------------------- Auslöser


def _done_marker_key(name):
    return f"flow_done:{name}"


def _issue_marker_key(name):
    return f"flow_issue:{name}"


def _red_marker_key(name):
    return f"flow_main_red:{name}"


def _done_marker(name):
    try:
        return int(str(store.meta_get(_done_marker_key(name), "0") or "0"))
    except (TypeError, ValueError):
        return 0


def _max_done_number():
    numbers = [
        _number(ticket["id"])
        for ticket in store.all_tickets()
        if ticket.get("status") == "done"
    ]
    return max(numbers) if numbers else 0


def _done_candidates(name):
    marker = _done_marker(name)
    rows = [
        ticket
        for ticket in store.all_tickets()
        if ticket.get("status") == "done" and _number(ticket["id"]) > marker
    ]
    rows.sort(key=lambda ticket: _number(ticket["id"]))
    return rows


def _number(ticket_id):
    try:
        return int(str(ticket_id).rsplit("-", 1)[-1])
    except (TypeError, ValueError):
        return 0


def _self_triggered(ticket, name):
    flow = ticket.get("flow")
    return isinstance(flow, dict) and flow.get("workflow") == name


def _cron_due(definition, trigger, now):
    latest = None
    for run in store.flow_run_list(definition["name"]):
        data = run.get("data") if isinstance(run.get("data"), dict) else {}
        stamp = int(data.get("started_at") or run.get("started_at") or 0)
        latest = stamp if latest is None else max(latest, stamp)
    if latest is None:
        return True
    return now - latest >= int(trigger["every_minutes"]) * 60000


def _issue_due(definition, trigger):
    repo = _repo_for(definition)
    label = str(trigger.get("label") or "").strip()
    try:
        if label:
            rows = git._gh_json(
                repo,
                [
                    "issue", "list", "--state", "open", "--label", label,
                    "--json", "number,title,url", "--limit", "1000",
                ],
                "GitHub-Issues nicht lesbar",
            )
        else:
            rows = git.gh_issue_list(repo)
    except FabError:
        return False
    if not isinstance(rows, list):
        return False
    numbers = [int(row.get("number") or 0) for row in rows if isinstance(row, dict)]
    if not numbers:
        return False
    marker_raw = store.meta_get(_issue_marker_key(definition["name"]))
    if marker_raw is None:
        store.meta_set(_issue_marker_key(definition["name"]), str(max(numbers)))
        return False
    try:
        marker = int(str(marker_raw) or "0")
    except (TypeError, ValueError):
        marker = 0
    newest = max(numbers)
    if newest > marker:
        store.meta_set(_issue_marker_key(definition["name"]), str(newest))
        return True
    return False


def _main_red_due(definition):
    repo = _repo_for(definition)
    try:
        completed = git._gh(
            repo,
            ["run", "list", "--branch", "main", "--limit", "1",
             "--json", "databaseId,conclusion"],
        )
    except FabError:
        return False
    if completed is None or completed.returncode != 0:
        return False
    try:
        rows = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError:
        return False
    if not isinstance(rows, list) or not rows:
        return False
    row = rows[0] if isinstance(rows[0], dict) else {}
    if str(row.get("conclusion") or "") != "failure":
        return False
    marker = str(row.get("databaseId") or "")
    if not marker or store.meta_get(_red_marker_key(definition["name"])) == marker:
        return False
    store.meta_set(_red_marker_key(definition["name"]), marker)
    return True
