"""Statistik-Seite: Kennzahlen aus Tickets, Ereignissen und Läufen."""
import unittest
from unittest import mock
from datetime import datetime

from fabric.fablib import analytics

HOUR = 3_600_000


def _ms(day, hour=12):
    return int(datetime(2026, 11, day, hour).timestamp() * 1000)


NOW = _ms(20, 18)


def _event(ticket, kind, at, text="", by="fab"):
    return {"ticket": ticket, "kind": kind, "at": at, "text": text, "by": by}


class ReportCase(unittest.TestCase):
    def report(self, **kwargs):
        tickets = [
            {"id": "T-1", "title": "Alt", "status": "done", "cost": {"total": 5, "sessions": [
                {"agent": "zap", "cost": 1.0, "started_at": _ms(10)},
                {"agent": "ada", "cost": 4.0, "started_at": _ms(10)},
            ]}},
            {"id": "T-2", "title": "Neu", "status": "done", "cost": {"total": 6, "sessions": [
                {"agent": "zap", "cost": 2.0, "started_at": _ms(19)},
                {"agent": "ada", "cost": 3.0, "started_at": _ms(19)},
                {"agent": "ada", "cost": 1.0, "started_at": _ms(20)},
            ]}},
            {"id": "T-3", "title": "Offen", "status": "doing", "cost": {}},
        ]
        events = [
            _event("T-1", "created", _ms(9)),
            _event("T-1", "accept", _ms(10)),
            _event("T-2", "created", _ms(19, 8)),
            _event("T-2", "status", _ms(19, 9), "todo → doing"),
            _event("T-2", "status", _ms(19, 11), "doing → review"),
            _event("T-2", "verdict", _ms(19, 12), "fail: Test fehlt", "ada"),
            _event("T-2", "comment", _ms(19, 13),
                   "Merge-Stand mit main weicht ab. Das bisherige Urteil wird verworfen.", "fab"),
            _event("T-2", "verdict", _ms(20, 10), "pass", "ada"),
            _event("T-2", "accept", _ms(20, 12)),
            _event("T-3", "created", _ms(20, 13)),
            _event("T-3", "reject", _ms(20, 14), "nein", "mensch"),
        ]
        runs = [
            {"state": "pass", "started_at": _ms(19), "duration_ms": 4 * 60_000, "trigger": "main"},
            {"state": "pass", "started_at": _ms(20), "duration_ms": 6 * 60_000, "trigger": "ticket"},
            {"state": "fail", "started_at": _ms(20), "reason": "unittest rot", "trigger": "ticket"},
            {"state": "fail", "started_at": _ms(20), "reason": "Abbruch: neuer Stand (T-2)",
             "trigger": "ticket"},
            {"state": "pass", "started_at": _ms(5), "duration_ms": 1, "trigger": "main"},
        ]
        return analytics.report(tickets, events, runs, reviewer="ada", now=NOW,
                                fresh=False, **kwargs)

    def test_window_limits_throughput_costs_and_runs(self):
        data = self.report(days=3)
        self.assertEqual([day["day"] for day in data["throughput"]],
                         ["2026-11-18", "2026-11-19", "2026-11-20"])
        over = data["overview"]
        self.assertEqual((over["created"], over["done"]), (2, 1))
        self.assertEqual(over["cycle_median_ms"], _ms(20, 12) - _ms(19, 8))
        # Nur Sessions im Zeitraum; T-1 (Tag 10) zählt nur in der Gesamtsumme.
        self.assertEqual(over["cost_range"], 6.0)
        self.assertEqual(over["cost_total"], 11.0)
        agents = {row["name"]: row for row in data["costs"]["agents"]}
        self.assertEqual(agents["ada"]["range"], 4.0)
        self.assertEqual(agents["ada"]["total"], 8.0)
        self.assertEqual(agents["ada"]["sessions"], 2)
        self.assertAlmostEqual(agents["ada"]["share"], 4 / 6, places=3)
        self.assertEqual(data["costs"]["agents"][0]["name"], "ada")
        per_day = {row["day"]: row for row in data["costs"]["per_day"]}
        self.assertEqual(per_day["2026-11-19"]["agents"], {"ada": 3.0, "zap": 2.0})
        self.assertEqual(data["costs"]["top_tickets"], [{"id": "T-2", "title": "Neu", "cost": 6.0}])

    def test_reviews_count_rounds_and_stale_verdicts(self):
        reviews = self.report(days=3)["reviews"]
        self.assertEqual(reviews["verdicts"], {"pass": 1, "fail": 1})
        self.assertEqual(reviews["stale_verdicts"], 1)
        self.assertEqual(reviews["rejects"], 1)
        self.assertEqual(reviews["top_rounds"], [{"id": "T-2", "title": "Neu", "verdicts": 2}])

    def test_runs_split_aborts_from_red(self):
        pipes = self.report(days=3)["pipelines"]
        self.assertEqual(pipes["counts"], {"pass": 2, "fail": 1, "aborted": 1, "open": 0})
        self.assertEqual(pipes["abort_reasons"], [{"reason": "Abbruch: neuer Stand", "count": 1}])
        self.assertEqual(pipes["duration_median_ms"], 5 * 60_000)
        self.assertEqual(self.report(days=3)["overview"]["pass_rate"], 0.5)

    def test_waits_average_over_tickets_done_in_window(self):
        waits = self.report(days=3)["waits"]
        self.assertEqual(waits["tickets"], 1)
        stages = {stage["key"]: stage["avg_ms"] for stage in waits["stages"]}
        # 2 h bis zur Prüfung, nach dem fail-Urteil wieder in Arbeit bis zur Abnahme.
        self.assertEqual(stages["doing"], 2 * HOUR + 24 * HOUR)
        self.assertGreater(waits["avg_total_ms"], 0)


class TeamCase(unittest.TestCase):
    """Team-Sicht filtert Tickets, Ereignisse und Läufe; Fabric-Sicht vergleicht Teams."""

    def setUp(self):
        self.roster = {
            "fabrics": [
                {"name": "standard", "note": ""},
                {"name": "privat", "note": "Privat"},
            ],
            "teams": [
                {"name": "web", "repos": ["/r/web/"], "fabric": "standard"},
                {"name": "api", "repos": ["/r/api"], "fabric": "privat"},
            ],
        }
        self.tickets = [
            {"id": "T-1", "repo": "/r/web", "status": "done", "cost": {"sessions": [
                {"agent": "zap", "cost": 2.0, "started_at": _ms(20)}]}},
            {"id": "T-2", "repo": "/r/api", "status": "doing", "cost": {"sessions": [
                {"agent": "ada", "cost": 5.0, "started_at": _ms(20)}]}},
        ]
        self.events = [
            _event("T-1", "created", _ms(19)), _event("T-1", "accept", _ms(20)),
            _event("T-2", "created", _ms(20)), _event("T-2", "verdict", _ms(20), "fail"),
        ]
        self.runs = [
            {"ticket": "T-1", "state": "pass", "started_at": _ms(20), "duration_ms": 1},
            {"ticket": None, "repo": "/r/web", "state": "fail", "started_at": _ms(20), "reason": "rot"},
            {"ticket": "T-2", "state": "fail", "started_at": _ms(20), "reason": "rot"},
        ]

    def report(self, team=None, fabric=None):
        with mock.patch.object(analytics.costs, "team_name",
                               lambda roster, ticket: {"/r/web": "web", "/r/api": "api"}[ticket["repo"]]):
            return analytics.report(self.tickets, self.events, self.runs, now=NOW, days=3,
                                    fresh=False, roster=self.roster, team=team, fabric=fabric)

    def test_team_view_filters_everything(self):
        data = self.report("web")
        self.assertEqual(data["team"], "web")
        self.assertIsNone(data["teams"])
        self.assertEqual(data["overview"]["cost_range"], 2.0)
        self.assertEqual([row["name"] for row in data["costs"]["agents"]], ["zap"])
        self.assertEqual(data["reviews"]["verdicts"], {"pass": 0, "fail": 0})
        # Eigener Ticketlauf plus main-Lauf im Team-Repo, nicht der Lauf von api.
        self.assertEqual(data["pipelines"]["counts"], {"pass": 1, "fail": 1, "aborted": 0, "open": 0})

    def test_fabric_view_compares_teams(self):
        data = self.report()
        self.assertIsNone(data["fabric"])
        rows = {row["name"]: row for row in data["teams"]}
        self.assertEqual(rows["web"], {"name": "web", "fabric": "standard", "cost_range": 2.0,
                                       "created": 1, "done": 1, "open": 0})
        self.assertEqual(rows["api"], {"name": "api", "fabric": "privat", "cost_range": 5.0,
                                       "created": 1, "done": 0, "open": 1})
        self.assertEqual(data["overview"]["cost_range"], 7.0)

    def test_fabric_filter_limits_teams_tickets_events_and_runs(self):
        data = self.report(fabric="privat")
        self.assertEqual(data["fabric"], "privat")
        self.assertIsNone(data["team"])
        self.assertEqual(
            [row["name"] for row in data["teams"]], ["api"])
        self.assertEqual(data["teams"][0]["fabric"], "privat")
        self.assertEqual(data["overview"]["cost_range"], 5.0)
        self.assertEqual([row["name"] for row in data["costs"]["agents"]], ["ada"])
        # Nur der Ticketlauf von T-2; der main-Lauf im Repo von web gehört standard.
        self.assertEqual(data["pipelines"]["counts"],
                         {"pass": 0, "fail": 1, "aborted": 0, "open": 0})
        self.assertEqual(data["reviews"]["verdicts"], {"pass": 0, "fail": 1})

    def test_fabric_standard_keeps_main_runs_of_its_repos(self):
        data = self.report(fabric="standard")
        self.assertEqual([row["name"] for row in data["teams"]], ["web"])
        self.assertEqual(data["pipelines"]["counts"],
                         {"pass": 1, "fail": 1, "aborted": 0, "open": 0})


if __name__ == "__main__":
    unittest.main()
