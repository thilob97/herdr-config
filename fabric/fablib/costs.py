"""Kosten und Liegezeiten je Ticket aus den Session-Protokollen.

Die Kosten stehen in den JSONL-Dateien von omp (`FAB_OMP_SESSIONS`, sonst
`~/.omp/agent/sessions`) und Claude (`FAB_CLAUDE_PROJECTS`, sonst
`~/.claude/projects`). Beide Wurzeln enthalten je Projekt einen Ordner: omp
zieht das Home-Präfix ab und ersetzt nur `/` durch `-`, Claude ersetzt jedes
Zeichen außer `[A-Za-z0-9]` durch `-`. Dateien werden über ihr Startdatum dem
passenden Session-Fenster zugeordnet: Fenster i beginnt zehn Minuten vor dem
i-ten Session-Start und endet mit dem nächsten Start, das letzte Fenster
reicht bis jetzt.

`waits()` spielt die Ereignisse eines Tickets nach und misst die Zeit in den
drei Stufen „doing“, „review“ und „mensch“. Offene Intervalle enden bei `now`
und bleiben als offen markiert.
"""
import bisect
import json
import os
import re
from datetime import datetime, timezone

from . import clock

FOLDER_RE = re.compile(r"[^A-Za-z0-9]")
START_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z")
WINDOW_MS = 600_000

STAGES = (
    ("doing", "In Arbeit"),
    ("review", "Prüfung bei {reviewer}"),
    ("mensch", "wartet auf mensch"),
)


def _now(now=None):
    return clock.now_ms() if now is None else int(now)


def _number(value):
    """Nur echte Zahlen, keine Wahrheitswerte."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _cost_of(value):
    return float(value) if _number(value) else None


def _local_day(ms):
    return datetime.fromtimestamp(ms / 1000).date()


def _iso_ms(text):
    """ISO-Zeitstempel nach Millisekunden; ohne Zone gilt UTC."""
    if not isinstance(text, str) or not text.strip():
        return None
    value = text.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def _name_ms(path):
    """Start aus dem Dateinamen `YYYY-MM-DDTHH-MM-SS-mmmZ`."""
    match = START_RE.search(os.path.basename(path))
    if not match:
        return None
    parts = [int(part) for part in match.groups()]
    try:
        parsed = datetime(*parts, tzinfo=timezone.utc)
    except ValueError:
        return None
    return int(parsed.timestamp() * 1000)


def _mtime_ms(path):
    try:
        return int(os.path.getmtime(path) * 1000)
    except OSError:
        return 0


def _lines(path):
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                if isinstance(obj, dict):
                    yield obj
    except OSError:
        return


def _usage_cost(container):
    """Kosten aus `usage.cost.total`, falls vorhanden."""
    usage = container.get("usage") if isinstance(container, dict) else None
    if isinstance(usage, dict):
        entry = usage.get("cost")
        if isinstance(entry, dict):
            return _cost_of(entry.get("total"))
    return None


def _omp_record(path):
    """omp: Kosten je Zeile summieren, Start aus Session-Kopf oder Dateiname.

    Die Hauptunterhaltung trägt ihre Kosten in `message.usage.cost.total`,
    Subagenten und Richter in `usage.cost.total` auf oberster Ebene.
    """
    cost = 0.0
    start = None
    for obj in _lines(path):
        if start is None and obj.get("type") == "session":
            start = _iso_ms(obj.get("timestamp"))
        message = obj.get("message")
        total = _usage_cost(message) if isinstance(message, dict) else None
        if total is None:
            total = _usage_cost(obj)
        if total is None and obj.get("type") != "model_usage":
            entry = obj.get("cost")
            if isinstance(entry, dict):
                total = _cost_of(entry.get("total"))
        if total is not None:
            cost += total
    if start is None:
        start = _name_ms(path)
    if start is None:
        start = _name_ms(os.path.dirname(path))
    if start is None:
        start = _mtime_ms(path)
    return {"start": start, "cost": cost, "source": "omp"}


def _claude_record(path):
    """claude: letztes `totalCostUSD`, sonst letzter `cost-state`-Block."""
    total_cost = None
    fallback = None
    start = None
    for obj in _lines(path):
        if obj.get("type") == "cost-state":
            if _number(obj.get("startTime")):
                start = int(obj["startTime"])
            usage = obj.get("modelUsage")
            if isinstance(usage, dict):
                fallback = sum(
                    value
                    for entry in usage.values()
                    if isinstance(entry, dict)
                    for value in [_cost_of(entry.get("costUSD"))]
                    if value is not None
                )
        value = _cost_of(obj.get("totalCostUSD"))
        if value is not None:
            total_cost = value
    if total_cost is None:
        total_cost = fallback or 0.0
    if start is None:
        start = _mtime_ms(path)
    return {"start": start, "cost": total_cost, "source": "claude"}


def _root(name, default):
    return os.path.expanduser(os.environ.get(name) or default)


def _omp_key(path):
    """omp: Home-Präfix abziehen, dann nur `/` durch `-` ersetzen.

    `~/.omp/agent/sessions/-.herdr-…` entsteht aus `~/.herdr/…`; Punkte
    bleiben stehen. Außerhalb des Homes bleibt der absolute Pfad.
    """
    value = str(path)
    home = os.path.expanduser("~").rstrip(os.sep)
    if home and (value == home or value.startswith(home + os.sep)):
        value = value[len(home):]
    return value.replace(os.sep, "-")


def _claude_key(path):
    """claude: jedes Zeichen außer `[A-Za-z0-9]` wird zu `-`."""
    return FOLDER_RE.sub("-", str(path))


def _roots():
    return (
        (_root("FAB_OMP_SESSIONS", "~/.omp/agent/sessions"), _omp_record, _omp_key),
        (_root("FAB_CLAUDE_PROJECTS", "~/.claude/projects"), _claude_record, _claude_key),
    )


def _keys(worktree, keyfn):
    keys = []
    for path in (worktree, os.path.realpath(worktree)):
        key = keyfn(path)
        if key not in keys:
            keys.append(key)
    return keys


def _records(worktree):
    """Alle Protokolldateien des Worktrees, auch Unterordner von Subagenten."""
    found = []
    for root, parse, keyfn in _roots():
        seen = set()
        for key in _keys(worktree, keyfn):
            directory = os.path.join(root, key)
            real = os.path.realpath(directory)
            if real in seen or not os.path.isdir(directory):
                continue
            seen.add(real)
            for folder, names, files in os.walk(directory):
                names.sort()
                for name in sorted(files):
                    if not name.endswith(".jsonl"):
                        continue
                    path = os.path.join(folder, name)
                    if os.path.isfile(path):
                        found.append(parse(path))
    return found


def _attach(records, starts):
    """Ordnet Dateien den Session-Fenstern zu; frühe an die erste, späte an die letzte."""
    if not starts:
        return []
    order = sorted(range(len(starts)), key=lambda index: (starts[index], index))
    bounds = [starts[index] - WINDOW_MS for index in order]
    targets = [0] * len(records)
    for position, record in enumerate(records):
        slot = bisect.bisect_right(bounds, record["start"]) - 1
        slot = min(max(slot, 0), len(order) - 1)
        targets[position] = order[slot]
    return targets


def collect(ticket, now=None):
    """Kosten eines Tickets je Session, gesamt und für den heutigen Tag."""
    now = _now(now)
    entries = list(ticket.get("sessions") or [])
    rows = [
        {
            "agent": entry.get("agent"),
            "name": entry.get("name"),
            "started_at": int(entry.get("started_at") or 0),
            "cost": 0.0,
            "source": "",
            "files": 0,
        }
        for entry in entries
    ]
    total = 0.0
    today = 0.0
    worktree = ticket.get("worktree")
    if worktree and rows:
        records = _records(worktree)
        starts = [row["started_at"] for row in rows]
        targets = _attach(records, starts)
        sources = [set() for _ in rows]
        costs = [0.0 for _ in rows]
        counts = [0 for _ in rows]
        for record, target in zip(records, targets):
            sources[target].add(record["source"])
            costs[target] += record["cost"]
            counts[target] += 1
        day = _local_day(now)
        for index, row in enumerate(rows):
            row["cost"] = round(costs[index], 6)
            row["files"] = counts[index]
            row["source"] = "omp+claude" if len(sources[index]) == 2 else (
                next(iter(sources[index])) if sources[index] else ""
            )
            total += costs[index]
            if _local_day(row["started_at"]) == day:
                today += costs[index]
    return {
        "currency": "USD",
        "total": round(total, 6),
        "today": round(today, 6),
        "sessions": rows,
        "at": now,
    }


def _new_status(text):
    """Zielstatus aus dem Ereignistext `alt → neu`."""
    for separator in ("→", "->"):
        if separator in text:
            return text.rsplit(separator, 1)[1].strip()
    return ""


def waits(ticket, rows, reviewer="ada", now=None):
    """Liegezeiten je Stufe aus dem Ereignisverlauf eines Tickets."""
    now = _now(now)
    ticket_id = ticket.get("id")
    ordered = sorted(
        enumerate(rows or []),
        key=lambda item: (int(item[1].get("at") or 0), item[0]),
    )
    started = {key: None for key, _ in STAGES}
    spent = {key: 0 for key, _ in STAGES}

    def open_stage(key, at):
        if started[key] is None:
            started[key] = at

    def close_stage(key, at):
        if started[key] is not None:
            spent[key] += max(at - started[key], 0)
            started[key] = None

    def close_all(at):
        for key, _ in STAGES:
            close_stage(key, at)

    for _, row in ordered:
        other = row.get("ticket")
        if ticket_id and other and other != ticket_id:
            continue
        at = int(row.get("at") or 0)
        kind = row.get("kind")
        if kind == "status":
            status = _new_status(str(row.get("text") or ""))
            if status == "doing":
                open_stage("doing", at)
            elif status in ("done", "dropped"):
                close_all(at)
            else:
                close_stage("doing", at)
        elif kind == "dispatch":
            open_stage("doing", at)
        elif kind == "handover":
            close_stage("doing", at)
            close_stage("review", at)
            open_stage("mensch", at)
        elif kind == "verdict":
            close_stage("review", at)
            if str(row.get("text") or "").startswith("fail"):
                close_stage("mensch", at)
                open_stage("doing", at)
        elif kind == "wake":
            target = row.get("target") or ""
            if target == reviewer:
                open_stage("review", at)
            elif target == "mensch":
                open_stage("mensch", at)
        elif kind == "comment":
            if row.get("actor") == "mensch":
                close_stage("mensch", at)
        elif kind in ("accept", "reject", "drop"):
            close_all(at)

    stages = []
    for key, label in STAGES:
        open_now = started[key] is not None
        if open_now:
            spent[key] += max(now - started[key], 0)
        stages.append(
            {
                "key": key,
                "label": label.format(reviewer=reviewer),
                "ms": int(spent[key]),
                "open": open_now,
            }
        )
    return {
        "total_ms": sum(stage["ms"] for stage in stages),
        "stages": stages,
    }


def team_name(roster, ticket):
    if not roster or not ticket.get("repo"):
        return ""
    from . import agents

    entry = agents.ticket_team(roster, ticket)
    if isinstance(entry, dict):
        return str(entry.get("name") or "")
    return str(entry or "")


def _snapshot(ticket):
    cost = ticket.get("cost")
    return cost if isinstance(cost, dict) else {}


def stats(tickets, roster=None, team=None, today=False, now=None):
    """Kosten je Team über die übergebenen Ticket-Lesemodelle."""
    now = _now(now)
    buckets = {}
    for ticket in tickets or []:
        name = team_name(roster, ticket)
        if team is not None and name != team:
            continue
        snapshot = _snapshot(ticket)
        if ticket.get("worktree") and ticket.get("sessions"):
            fresh = collect(ticket, now=now)
            total = fresh["total"]
            day = fresh["today"]
        else:
            total = _cost_of(snapshot.get("total")) or 0.0
            day = _cost_of(snapshot.get("today")) or 0.0
        bucket = buckets.setdefault(name, {"total": 0.0, "today": 0.0, "tickets": 0})
        bucket["total"] += total
        bucket["today"] += day
        if (day if today else total) != 0:
            bucket["tickets"] += 1
    rows = [
        {
            "name": name,
            "total": round(bucket["total"], 6),
            "today": round(bucket["today"], 6),
            "tickets": bucket["tickets"],
        }
        for name, bucket in sorted(buckets.items())
    ]
    field = "today" if today else "total"
    return {
        "generated_at": now,
        "currency": "USD",
        "teams": rows,
        "total": round(sum(row[field] for row in rows), 6),
        "today": round(sum(row["today"] for row in rows), 6),
    }


def format_cost(value):
    """Kosten für die Anzeige: ganze Dollar oder vier Nachkommastellen."""
    if value is None:
        return "—"
    value = float(value)
    if abs(value) >= 1:
        return f"${value:.2f}"
    if value > 0:
        return f"${value:.4f}"
    return "$0.00"


def format_duration(ms):
    """Dauer knapp: Minuten bis zur Stunde, danach Stunden und Minuten."""
    if ms is None:
        return "—"
    ms = int(ms)
    if ms == 0:
        return "0 min"
    if ms < 60_000:
        return "< 1 min"
    if ms < 3_600_000:
        return f"{ms // 60_000} min"
    hours, rest = divmod(ms, 3_600_000)
    return f"{hours} h {rest // 60_000:02d} min"
