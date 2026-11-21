"""Kosten und Liegezeiten: Protokolle, Fenster, Ereignis-Replay, Formate."""
import json
import os
import re
import tempfile
import unittest
from datetime import datetime, timezone
from unittest import mock

from fabric.fablib import costs


def _iso(ms):
    moment = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(ms) % 1000:03d}Z"


class CostsCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.omp = os.path.join(self.tmp, "omp-sessions")
        self.claude = os.path.join(self.tmp, "claude-projects")
        os.makedirs(self.omp)
        os.makedirs(self.claude)
        self.env = mock.patch.dict(
            os.environ,
            {
                "FAB_OMP_SESSIONS": self.omp,
                "FAB_CLAUDE_PROJECTS": self.claude,
            },
        )
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self._tmp.cleanup()

    def write_jsonl(self, root, key, name, lines):
        directory = os.path.join(root, key)
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, name)
        with open(path, "w", encoding="utf-8") as handle:
            for line in lines:
                if isinstance(line, str):
                    handle.write(line + "\n")
                else:
                    handle.write(json.dumps(line) + "\n")
        return path

    def omp_key(self, path):
        return str(path).replace("/", "-")

    def claude_key(self, path):
        return re.sub(r"[^A-Za-z0-9]", "-", str(path))


class CollectTests(CostsCase):
    def fixture(self, worktree):
        now = int(datetime(2026, 11, 21, 12, 0).timestamp() * 1000)
        hour = 3_600_000
        a = now - 3 * hour
        b = now - 1 * hour
        c = now - 13 * hour
        key = self.omp_key(worktree)
        claude = self.claude_key(worktree)
        real_key = self.claude_key(os.path.realpath(worktree))

        # omp: usage-Kosten, cost-Kosten ohne model_usage, model_usage ignoriert.
        self.write_jsonl(
            self.omp, key, "o_a.jsonl",
            [
                {"type": "session", "timestamp": _iso(a)},
                {"type": "assistant", "usage": {"cost": {"total": 1.5}}},
                {"type": "model_usage", "cost": {"total": 99}},
                {"type": "assistant", "cost": {"total": 0.25}},
                "kaputt",
            ],
        )
        self.write_jsonl(
            self.omp, key, "o_b.jsonl",
            [
                {"type": "session", "timestamp": _iso(now - 65 * 60_000)},
                {"type": "assistant", "usage": {"cost": {"total": 0.5}}},
            ],
        )
        self.write_jsonl(
            self.omp, key, "o_c.jsonl",
            [
                {"type": "session", "timestamp": _iso(c)},
                {"type": "assistant", "usage": {"cost": {"total": 9.0}}},
            ],
        )
        # ältere Datei vor dem ersten Fenster landet in der ersten Session
        self.write_jsonl(
            self.omp, key, "o_early.jsonl",
            [
                {"type": "session", "timestamp": _iso(now - 20 * hour)},
                {"type": "assistant", "usage": {"cost": {"total": 0.2}}},
            ],
        )
        # spätere Datei nach dem letzten Start landet in der letzten Session
        self.write_jsonl(
            self.omp, key, "o_late.jsonl",
            [
                {"type": "session", "timestamp": _iso(now + 2 * hour)},
                {"type": "assistant", "usage": {"cost": {"total": 0.1}}},
            ],
        )
        # claude: letztes totalCostUSD gewinnt
        self.write_jsonl(
            self.claude, claude, "c_a.jsonl",
            [
                {"type": "cost-state", "startTime": a, "modelUsage": {}},
                {"totalCostUSD": 2.0},
                {"totalCostUSD": 2.5},
            ],
        )
        # claude: ohne totalCostUSD zählt der letzte cost-state-Block
        self.write_jsonl(
            self.claude, claude, "c_fallback.jsonl",
            [
                {
                    "type": "cost-state",
                    "startTime": now - 3 * hour - 5 * 60_000,
                    "modelUsage": {
                        "m1": {"costUSD": 0.3},
                        "m2": {"costUSD": 0.2},
                    },
                }
            ],
        )
        # realpath-Ordner wird ebenfalls gelesen (Symlink-Auflösung)
        self.write_jsonl(
            self.claude, real_key, "c_real.jsonl",
            [
                {
                    "type": "cost-state",
                    "startTime": now - 3 * hour - 6 * 60_000,
                    "modelUsage": {"m1": {"costUSD": 1.0}},
                }
            ],
        )
        ticket = {
            "id": "T-1",
            "worktree": worktree,
            "sessions": [
                {"agent": "zap", "name": "fab-zap-1", "started_at": a},
                {"agent": "ada", "name": "fab-ada-2", "started_at": b},
                {"agent": "zap", "name": "fab-zap-3", "started_at": c},
            ],
        }
        return costs.collect(ticket, now=now), ticket, now, a, b, c

    def test_kosten_je_session_und_fenster(self):
        real = os.path.join(self.tmp, "repo.dir", "wt")
        os.makedirs(real)
        link = os.path.join(self.tmp, "link.wt")
        os.symlink(real, link)
        self.assertIn("repo-dir-wt", self.claude_key(real))

        result, _ticket, now, a, b, c = self.fixture(link)
        self.assertEqual(result["currency"], "USD")
        self.assertEqual(result["at"], now)
        self.assertEqual(result["total"], 15.55)
        self.assertEqual(result["today"], 6.35)
        self.assertEqual(
            result["sessions"],
            [
                {
                    "agent": "zap",
                    "name": "fab-zap-1",
                    "started_at": a,
                    "cost": 5.75,
                    "source": "omp+claude",
                    "files": 4,
                },
                {
                    "agent": "ada",
                    "name": "fab-ada-2",
                    "started_at": b,
                    "cost": 0.6,
                    "source": "omp",
                    "files": 2,
                },
                {
                    "agent": "zap",
                    "name": "fab-zap-3",
                    "started_at": c,
                    "cost": 9.2,
                    "source": "omp",
                    "files": 2,
                },
            ],
        )

    def test_ohne_worktree_und_ohne_sessions(self):
        now = 1_700_000_000_000
        ticket = {
            "id": "T-2",
            "sessions": [
                {"agent": "zap", "name": "fab-zap-9", "started_at": now}
            ],
        }
        result = costs.collect(ticket, now=now)
        self.assertEqual(result["total"], 0.0)
        self.assertEqual(result["today"], 0.0)
        self.assertEqual(
            result["sessions"],
            [
                {
                    "agent": "zap",
                    "name": "fab-zap-9",
                    "started_at": now,
                    "cost": 0.0,
                    "source": "",
                    "files": 0,
                }
            ],
        )
        empty = costs.collect({"id": "T-3", "worktree": self.tmp}, now=now)
        self.assertEqual(empty["sessions"], [])
        self.assertEqual(empty["total"], 0.0)


class WaitsTests(unittest.TestCase):
    def test_verlauf_und_offene_intervalle(self):
        rows = [
            {"kind": "dispatch", "ticket": "T-1", "at": 0},
            {"kind": "wake", "ticket": "T-1", "target": "ada", "at": 10_000},
            {"kind": "verdict", "ticket": "T-1", "text": "pass: ok", "at": 20_000},
            {"kind": "handover", "ticket": "T-1", "at": 30_000},
            {"kind": "comment", "ticket": "T-1", "actor": "mensch", "at": 40_000},
            {"kind": "accept", "ticket": "T-1", "at": 50_000},
            {"kind": "dispatch", "ticket": "T-2", "at": 0},
        ]
        result = costs.waits({"id": "T-1"}, rows, now=60_000)
        self.assertEqual(result["total_ms"], 50_000)
        self.assertEqual(
            result["stages"],
            [
                {"key": "doing", "label": "In Arbeit", "ms": 30_000, "open": False},
                {
                    "key": "review",
                    "label": "Prüfung bei ada",
                    "ms": 10_000,
                    "open": False,
                },
                {
                    "key": "mensch",
                    "label": "wartet auf mensch",
                    "ms": 10_000,
                    "open": False,
                },
            ],
        )

    def test_offene_stufen_enden_bei_now(self):
        rows = [
            {"kind": "dispatch", "ticket": "T-1", "at": 0},
            {"kind": "wake", "ticket": "T-1", "target": "ada", "at": 5_000},
            {"kind": "handover", "ticket": "T-1", "at": 20_000},
        ]
        result = costs.waits({"id": "T-1"}, rows, now=100_000)
        self.assertEqual(
            [(stage["key"], stage["ms"], stage["open"]) for stage in result["stages"]],
            [("doing", 20_000, False), ("review", 15_000, False), ("mensch", 80_000, True)],
        )
        self.assertEqual(result["total_ms"], 115_000)


class StatsTests(unittest.TestCase):
    def test_team_filter_und_heute(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_a = os.path.join(tmp, "repo-a")
            repo_b = os.path.join(tmp, "repo-b")
            os.makedirs(repo_a)
            os.makedirs(repo_b)
            roster = {
                "teams": [
                    {"name": "alpha", "repos": [repo_a]},
                    {"name": "beta", "repos": [repo_b]},
                ]
            }
            tickets = [
                {"id": "T-1", "repo": repo_a, "cost": {"total": 3.0, "today": 1.0}},
                {"id": "T-2", "repo": repo_b, "cost": {"total": 2.0, "today": 0.0}},
                {"id": "T-3", "repo": "", "cost": {"total": 1.5, "today": 0.5}},
                {"id": "T-4", "repo": repo_a, "cost": {"total": 0.0, "today": 0.0}},
            ]
            result = costs.stats(tickets, roster=roster, now=1_700_000_000_000)
            self.assertEqual(result["currency"], "USD")
            self.assertEqual(result["generated_at"], 1_700_000_000_000)
            self.assertEqual(
                result["teams"],
                [
                    {"name": "", "total": 1.5, "today": 0.5, "tickets": 1},
                    {"name": "alpha", "total": 3.0, "today": 1.0, "tickets": 1},
                    {"name": "beta", "total": 2.0, "today": 0.0, "tickets": 1},
                ],
            )
            self.assertEqual(result["total"], 6.5)
            self.assertEqual(result["today"], 1.5)

            day = costs.stats(tickets, roster=roster, today=True)
            self.assertEqual(
                [(row["name"], row["tickets"]) for row in day["teams"]],
                [("", 1), ("alpha", 1), ("beta", 0)],
            )
            self.assertEqual(day["total"], 1.5)
            self.assertEqual(day["today"], 1.5)

            only = costs.stats(tickets, roster=roster, team="alpha")
            self.assertEqual(
                only["teams"],
                [{"name": "alpha", "total": 3.0, "today": 1.0, "tickets": 1}],
            )
            self.assertEqual(only["total"], 3.0)


class FormatTests(unittest.TestCase):
    def test_kosten(self):
        self.assertEqual(costs.format_cost(None), "—")
        self.assertEqual(costs.format_cost(1.234), "$1.23")
        self.assertEqual(costs.format_cost(2), "$2.00")
        self.assertEqual(costs.format_cost(0.0012), "$0.0012")
        self.assertEqual(costs.format_cost(0.00004), "$0.0000")
        self.assertEqual(costs.format_cost(0), "$0.00")

    def test_dauer(self):
        self.assertEqual(costs.format_duration(None), "—")
        self.assertEqual(costs.format_duration(0), "0 min")
        self.assertEqual(costs.format_duration(59_999), "< 1 min")
        self.assertEqual(costs.format_duration(60_000), "1 min")
        self.assertEqual(costs.format_duration(3_599_999), "59 min")
        self.assertEqual(costs.format_duration(3_600_000), "1 h 00 min")
        self.assertEqual(costs.format_duration(5_400_000), "1 h 30 min")
        self.assertEqual(costs.format_duration(90_061_000), "25 h 01 min")


if __name__ == "__main__":
    unittest.main()
