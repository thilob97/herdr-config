"""Auswertungen für die Statistik-Seite: Durchsatz, Kosten, Prüfungen, Läufe, Liegezeiten.

Alles wird aus der vollständigen Ablage berechnet (Tickets, alle Ereignisse,
alle Pipeline-Läufe), nicht aus dem auf 300 Ereignisse gekürzten Index.
Tage sind Kalendertage in der Zeitzone des Rechners.
"""
from datetime import datetime, timedelta

from . import clock, costs

DONE_KINDS = ("accept", "accept_noop")
STALE_VERDICT = "Das bisherige Urteil wird verworfen"
TOP = 10


def _day(ms):
    return datetime.fromtimestamp(int(ms) / 1000).strftime("%Y-%m-%d")


def _days(now, count):
    today = datetime.fromtimestamp(now / 1000).date()
    return [(today - timedelta(days=offset)).isoformat() for offset in range(count - 1, -1, -1)]


def _start_ms(now, count):
    first = datetime.fromtimestamp(now / 1000).date() - timedelta(days=count - 1)
    return int(datetime(first.year, first.month, first.day).timestamp() * 1000)


def _median(values):
    ordered = sorted(values)
    if not ordered:
        return 0
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) // 2


def _number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _trim(path):
    return str(path or "").rstrip("/")


def _ticket_cost(ticket, fresh, now):
    if fresh and ticket.get("worktree") and ticket.get("sessions"):
        return costs.collect(ticket, now=now)
    return ticket.get("cost") if isinstance(ticket.get("cost"), dict) else {}


def _range_cost(cost, in_range):
    return sum(
        _number(session.get("cost"))
        for session in cost.get("sessions") or []
        if isinstance(session, dict) and in_range(session.get("started_at"))
    )


def _team_rows(tickets, team_of, cost_of, events, in_range):
    """Je Team: Kosten im Zeitraum, neue und fertige Tickets (für die Fabric-Sicht)."""
    rows = {}

    def row(name):
        return rows.setdefault(name, {"name": name, "cost_range": 0.0, "created": 0, "done": 0,
                                      "open": 0})

    for ticket in tickets:
        entry = row(team_of.get(ticket.get("id"), ""))
        entry["cost_range"] += _range_cost(cost_of(ticket), in_range)
        if ticket.get("status") not in ("done", "dropped"):
            entry["open"] += 1
    for event in events or []:
        if not in_range(event.get("at")):
            continue
        tid = event.get("ticket") or ""
        if tid not in team_of:
            continue
        if event.get("kind") == "created":
            row(team_of[tid])["created"] += 1
        elif event.get("kind") in DONE_KINDS:
            row(team_of[tid])["done"] += 1
    return [
        dict(entry, cost_range=round(entry["cost_range"], 6))
        for entry in sorted(rows.values(), key=lambda item: (not item["name"], item["name"]))
    ]


def report(tickets, events, runs, reviewer="ada", days=14, now=None, fresh=True,
           roster=None, team=None):
    """Kennzahlen über `days` Kalendertage bis heute (einschließlich).

    `fresh` liest Sessionkosten wie `fab stats` neu aus den Session-Logs; der
    gespeicherte Schnappschuss im Ticket hinkt sonst hinterher. `team`
    beschränkt alles auf die Tickets dieses Teams („" = ohne Team) und die
    Läufe seiner Tickets und Repos; ohne `team` gilt die ganze Fabric und
    `teams` vergleicht die Teams.
    """
    now = clock.now_ms() if now is None else int(now)
    days = max(1, int(days))
    day_list = _days(now, days)
    since = _start_ms(now, days)
    in_range = lambda at: int(at or 0) >= since  # noqa: E731

    tickets = [ticket for ticket in tickets or [] if isinstance(ticket, dict)]
    team_of = {ticket.get("id"): costs.team_name(roster, ticket) for ticket in tickets}
    cache = {}

    def cost_of(ticket):
        key = ticket.get("id")
        if key not in cache:
            cache[key] = _ticket_cost(ticket, fresh, now)
        return cache[key]

    teams = None if team is not None else _team_rows(tickets, team_of, cost_of, events, in_range)
    if team is not None:
        tickets = [ticket for ticket in tickets if team_of.get(ticket.get("id")) == team]
        ids = {ticket.get("id") for ticket in tickets}
        events = [row for row in events or [] if row.get("ticket") in ids]
        repos = {
            _trim(repo)
            for entry in (roster or {}).get("teams") or []
            if isinstance(entry, dict) and entry.get("name") == team
            for repo in entry.get("repos") or []
        }
        runs = [
            run for run in runs or []
            if run.get("ticket") in ids or (not run.get("ticket") and _trim(run.get("repo")) in repos)
        ]
    by_id = {ticket["id"]: ticket for ticket in tickets if ticket.get("id")}
    rows_by_ticket = {}
    for row in events or []:
        rows_by_ticket.setdefault(row.get("ticket") or "", []).append(row)

    # -- Durchsatz
    created_at, done_at = {}, {}
    per_day = {day: {"day": day, "created": 0, "done": 0, "dropped": 0} for day in day_list}
    for row in events or []:
        at = int(row.get("at") or 0)
        tid = row.get("ticket") or ""
        kind = row.get("kind")
        if kind == "created":
            created_at.setdefault(tid, at)
        if kind in DONE_KINDS:
            done_at[tid] = at
        if not in_range(at):
            continue
        bucket = per_day.get(_day(at))
        if bucket is None:
            continue
        if kind == "created":
            bucket["created"] += 1
        elif kind in DONE_KINDS:
            bucket["done"] += 1
        elif kind == "drop":
            bucket["dropped"] += 1
    cycles = [
        done_at[tid] - created_at[tid]
        for tid in done_at
        if tid in created_at and in_range(done_at[tid]) and done_at[tid] >= created_at[tid]
    ]
    status_counts = {}
    for ticket in tickets:
        status = ticket.get("status") or "?"
        status_counts[status] = status_counts.get(status, 0) + 1

    # -- Kosten (Sessions mit Startzeit im Zeitraum; Gesamtsumme über alles)
    agents, ticket_costs = {}, []
    cost_days = {day: {} for day in day_list}
    total_cost = 0.0
    range_cost = 0.0
    for ticket in tickets:
        cost = cost_of(ticket)
        total = _number(cost.get("total"))
        total_cost += total
        ticket_range = 0.0
        for session in cost.get("sessions") or []:
            if not isinstance(session, dict):
                continue
            amount = _number(session.get("cost"))
            name = str(session.get("agent") or "?")
            started = int(session.get("started_at") or 0)
            row = agents.setdefault(name, {"name": name, "total": 0.0, "range": 0.0,
                                           "sessions": 0, "tickets": set()})
            row["total"] += amount
            row["tickets"].add(ticket.get("id"))
            if in_range(started):
                row["range"] += amount
                row["sessions"] += 1
                ticket_range += amount
                day = cost_days.get(_day(started))
                if day is not None:
                    day[name] = day.get(name, 0.0) + amount
        range_cost += ticket_range
        if ticket_range > 0:
            ticket_costs.append({"id": ticket.get("id"), "title": ticket.get("title") or "",
                                 "cost": round(ticket_range, 6)})
    agent_rows = sorted(
        (
            {
                "name": row["name"],
                "total": round(row["total"], 6),
                "range": round(row["range"], 6),
                "sessions": row["sessions"],
                "tickets": len(row["tickets"]),
                "share": round(row["range"] / range_cost, 4) if range_cost else 0.0,
            }
            for row in agents.values()
        ),
        key=lambda item: (-item["range"], -item["total"], item["name"]),
    )

    # -- Prüfungen
    verdicts = {"pass": 0, "fail": 0}
    rounds, stale, rejects = {}, 0, 0
    for row in events or []:
        if not in_range(row.get("at")):
            continue
        kind = row.get("kind")
        text = str(row.get("text") or "")
        if kind == "verdict":
            state = "pass" if text.startswith("pass") else "fail"
            verdicts[state] += 1
            tid = row.get("ticket") or ""
            rounds[tid] = rounds.get(tid, 0) + 1
        elif kind == "reject":
            rejects += 1
        elif kind == "comment" and STALE_VERDICT in text:
            stale += 1
    top_rounds = sorted(
        ({"id": tid, "title": (by_id.get(tid) or {}).get("title", ""), "verdicts": count}
         for tid, count in rounds.items()),
        key=lambda item: (-item["verdicts"], item["id"]),
    )[:TOP]

    # -- Prüfläufe
    run_days = {day: {"day": day, "pass": 0, "fail": 0, "aborted": 0} for day in day_list}
    run_counts = {"pass": 0, "fail": 0, "aborted": 0, "open": 0}
    durations, reasons, triggers = [], {}, {}
    for run in runs or []:
        started = int(run.get("started_at") or 0)
        if not in_range(started):
            continue
        state = run.get("state")
        reason = str(run.get("reason") or "")
        aborted = state == "fail" and reason.startswith("Abbruch")
        key = "aborted" if aborted else state if state in ("pass", "fail") else "open"
        run_counts[key] += 1
        trigger = run.get("trigger") or "?"
        triggers[trigger] = triggers.get(trigger, 0) + 1
        bucket = run_days.get(_day(started))
        if bucket is not None and key in bucket:
            bucket[key] += 1
        if state == "pass" and run.get("duration_ms"):
            durations.append(int(run["duration_ms"]))
        if aborted:
            label = reason.split("(")[0].strip()
            reasons[label] = reasons.get(label, 0) + 1
    finished = run_counts["pass"] + run_counts["fail"] + run_counts["aborted"]

    # -- Liegezeiten der im Zeitraum abgeschlossenen Tickets
    stage_sum, stage_count, wait_totals = {}, {}, []
    labels = {}
    for tid, at in done_at.items():
        ticket = by_id.get(tid)
        if ticket is None or not in_range(at):
            continue
        waits = costs.waits(ticket, rows_by_ticket.get(tid, []), reviewer, now=now)
        wait_totals.append(int(waits.get("total_ms") or 0))
        for stage in waits.get("stages") or []:
            key = stage.get("key")
            labels[key] = stage.get("label") or key
            stage_sum[key] = stage_sum.get(key, 0) + int(stage.get("ms") or 0)
            stage_count[key] = stage_count.get(key, 0) + 1

    return {
        "generated_at": now,
        "days": days,
        "team": team,
        "teams": teams,
        "since": since,
        "overview": {
            "tickets": len(tickets),
            "status": status_counts,
            "created": sum(day["created"] for day in per_day.values()),
            "done": sum(day["done"] for day in per_day.values()),
            "cost_range": round(range_cost, 6),
            "cost_total": round(total_cost, 6),
            "cycle_median_ms": _median(cycles),
            "cycle_avg_ms": (sum(cycles) // len(cycles)) if cycles else 0,
            "pass_rate": round(run_counts["pass"] / finished, 4) if finished else None,
        },
        "throughput": [per_day[day] for day in day_list],
        "costs": {
            "agents": agent_rows,
            "per_day": [
                {"day": day, "agents": {k: round(v, 6) for k, v in sorted(cost_days[day].items())},
                 "total": round(sum(cost_days[day].values()), 6)}
                for day in day_list
            ],
            "top_tickets": sorted(ticket_costs, key=lambda item: -item["cost"])[:TOP],
        },
        "reviews": {
            "verdicts": verdicts,
            "rejects": rejects,
            "stale_verdicts": stale,
            "rounds_avg": round(sum(rounds.values()) / len(rounds), 2) if rounds else 0,
            "top_rounds": top_rounds,
        },
        "pipelines": {
            "counts": run_counts,
            "per_day": [run_days[day] for day in day_list],
            "triggers": dict(sorted(triggers.items())),
            "duration_median_ms": _median(durations),
            "abort_reasons": sorted(
                ({"reason": key, "count": value} for key, value in reasons.items()),
                key=lambda item: -item["count"],
            )[:TOP],
        },
        "waits": {
            "tickets": len(wait_totals),
            "avg_total_ms": (sum(wait_totals) // len(wait_totals)) if wait_totals else 0,
            "stages": [
                {"key": key, "label": labels[key], "avg_ms": stage_sum[key] // stage_count[key]}
                for key in stage_sum
            ],
        },
    }
