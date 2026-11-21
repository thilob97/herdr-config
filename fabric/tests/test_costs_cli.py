"""Kosten und Liegezeiten in der CLI: show, stats, edit --max-cost, tick."""
import json
import os
import re
import time
from unittest import mock

from fabric.tests.support import FabricCase

DAY = 24 * 60 * 60 * 1000


def _stamp(ms):
    seconds = time.strftime("%Y-%m-%dT%H-%M-%S", time.gmtime(ms / 1000))
    return f"{seconds}-{int(ms) % 1000:03d}Z"


class CostsCliCase(FabricCase):
    def setUp(self):
        super().setUp()
        self.omp_root = os.path.join(self.tmp, "omp-sessions")
        self.claude_root = os.path.join(self.tmp, "claude-projects")
        os.makedirs(self.omp_root, exist_ok=True)
        os.makedirs(self.claude_root, exist_ok=True)
        self.env["FAB_OMP_SESSIONS"] = self.omp_root
        self.env["FAB_CLAUDE_PROJECTS"] = self.claude_root
        patcher = mock.patch.dict(
            os.environ,
            {
                "FAB_OMP_SESSIONS": self.omp_root,
                "FAB_CLAUDE_PROJECTS": self.claude_root,
            },
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def now(self):
        return int(time.time() * 1000)

    def escaped(self, path):
        return re.sub(r"[^A-Za-z0-9]", "-", path)

    def worktree(self, tid):
        return os.path.join(self.tmp, f"wt-{tid}")

    def write_omp(self, worktree, started_at, cost):
        """Eine omp-Protokolldatei im Worker-Fenster des Worktrees."""
        keys = []
        for path in (worktree, os.path.realpath(worktree)):
            key = self.escaped(path)
            if key not in keys:
                keys.append(key)
        folder = os.path.join(self.omp_root, keys[0])
        os.makedirs(folder, exist_ok=True)
        name = f"{_stamp(started_at)}-test.jsonl"
        iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(started_at / 1000))
        lines = [
            {"type": "session", "timestamp": iso + ".000Z"},
            {"type": "model_usage", "usage": {"cost": {"total": cost}}},
        ]
        self._write(
            os.path.join(folder, name),
            "\n".join(json.dumps(line) for line in lines) + "\n",
        )

    def prepare(self, max_cost=None, status="doing", cost=0.42):
        tid = self.new("Kosten")
        folder = self.worktree(tid)
        os.makedirs(folder, exist_ok=True)
        started = self.now() - 3_600_000
        self.add_events(
            [
                {"kind": "status", "ticket": tid, "text": "todo → doing",
                 "at": started},
                {"kind": "handover", "ticket": tid, "at": started + 1_800_000},
                {"kind": "wake", "ticket": tid, "target": "ada",
                 "at": started + 2_400_000},
            ]
        )
        self.write_omp(folder, started, cost)
        self.patch_ticket(
            tid,
            status=status,
            assignee="zap",
            worktree=folder,
            sessions=[
                {
                    "agent": "zap",
                    "name": f"fab-herdr-app-zap-{tid.lower()}",
                    "terminal": "t1",
                    "started_at": started,
                }
            ],
            max_cost=max_cost,
        )
        return tid

    def test_show_zeigt_kosten_summe_limit_und_liegezeiten(self):
        tid = self.prepare(max_cost=5)
        result = self.ok("show", tid)
        self.assertIn("## Kosten", result.stdout)
        self.assertIn("$0.4200", result.stdout)
        self.assertIn("Summe: $0.4200 · Limit: $5.00", result.stdout)
        self.assertIn("## Liegezeiten", result.stdout)
        self.assertIn("In Arbeit:", result.stdout)
        self.assertIn("Prüfung bei ada:", result.stdout)
        payload = json.loads(self.ok("show", tid, "--json").stdout)
        self.assertEqual(payload["max_cost"], 5)
        self.assertEqual(payload["cost"]["total"], 0.42)
        self.assertEqual(payload["cost"]["today"], 0.42)
        self.assertEqual(payload["cost"]["sessions"][0]["cost"], 0.42)
        self.assertEqual(payload["cost"]["sessions"][0]["source"], "omp")
        stages = {row["key"]: row for row in payload["waits"]["stages"]}
        self.assertEqual(list(stages), ["doing", "review", "mensch"])
        self.assertGreater(stages["doing"]["ms"], 0)
        self.assertGreater(stages["review"]["ms"], 0)
        model = self.ticket(tid)
        self.assertEqual(model["cost"]["total"], 0.42)
        self.assertEqual(
            [stage["key"] for stage in model["waits"]["stages"]],
            ["doing", "review", "mensch"],
        )
        self.assertGreater(model["waits"]["total_ms"], 0)

    def test_stats_team_heute_json_und_mensch(self):
        self.prepare(max_cost=5)
        payload = json.loads(self.ok("stats", "--team", "herdr-app", "--json").stdout)
        self.assertEqual(payload["currency"], "USD")
        self.assertEqual(payload["teams"][0]["name"], "herdr-app")
        self.assertEqual(payload["teams"][0]["total"], 0.42)
        self.assertEqual(payload["teams"][0]["tickets"], 1)
        self.assertEqual(payload["total"], 0.42)
        today = json.loads(self.ok("stats", "--today", "--json").stdout)
        self.assertEqual(today["today"], 0.42)
        human = self.ok("stats", "--team", "herdr-app").stdout
        self.assertIn("herdr-app", human)
        self.assertIn("$0.4200", human)
        self.assertIn("Gesamt", human)
        bad = self.cli("stats", "--team", "quatsch")
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("Unbekanntes Team", bad.stderr)

    def test_edit_kostenlimit_setzen_loeschen_und_pruefen(self):
        tid = self.new("Limit")
        self.ok("edit", tid, "--max-cost", "5,5", "--from", "mensch")
        self.assertEqual(self.ticket(tid)["max_cost"], 5.5)
        self.ok("edit", tid, "--max-cost=", "--from", "mensch")
        self.assertIsNone(self.ticket(tid)["max_cost"])
        for value in ("abc", "-2"):
            bad = self.cli("edit", tid, f"--max-cost={value}", "--from", "mensch")
            self.assertNotEqual(bad.returncode, 0, value)
            self.assertIn("Kostenlimit", bad.stderr)
        empty = self.cli("edit", tid, "--from", "mensch")
        self.assertNotEqual(empty.returncode, 0)
        self.assertIn("--max-cost", empty.stderr)

    def test_tick_kostenlimit_beendet_sessions_und_meldet_einmal(self):
        tid = self.prepare(max_cost=0.10)
        self.clear_log()
        result = self.ok("tick")
        self.assertIn("Kostenlimit überschritten", result.stdout)
        self.assertIn("$0.4200", result.stdout)
        self.assertIn("$0.1000", result.stdout)
        self.assertTrue(self.hc_calls("kill"))
        ticket = self.ticket(tid)
        self.assertIn("mensch", ticket["waiting"])
        attention = [row for row in self.index()["inbox"] if row["kind"] == "attention"]
        self.assertEqual(len(attention), 1)
        self.assertIn("Kostenlimit überschritten", attention[0]["text"])
        self.assertIn("$0.4200", attention[0]["text"])
        self.assertIn("$0.1000", attention[0]["text"])
        self.ok("tick")
        again = [row for row in self.index()["inbox"] if row["kind"] == "attention"]
        self.assertEqual(len(again), 1)
        self.assertEqual(ticket["cost"]["total"], 0.42)
        self.assertIn("waits", self.ticket(tid))
