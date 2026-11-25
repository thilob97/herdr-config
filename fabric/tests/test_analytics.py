"""Statistik-Seite: Kennzahlen aus Tickets, Ereignissen und Läufen."""
import unittest
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


if __name__ == "__main__":
    unittest.main()
