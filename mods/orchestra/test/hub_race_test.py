#!/usr/bin/env python3
"""Race tests for the hub write paths: atomic ticket ids and one lock per mutator.

    python3 mods/orchestra/test/hub_race_test.py

Every test starts real `hub` processes in parallel; each one works in a throwaway HOME
with its own ticket store. `hc` is a stub on PATH, so no Herdr window, agent or GitHub
is touched. The tests are the reproductions from the ticket:

  5 parallel `ticket new`      -> 5 tickets (not 1: the last writer used to win)
  6 parallel `lesson add`      -> 6 lines (not 1)
  4 parallel `agent add`       -> 1 entry, 3 refusals with exit 1
 10 parallel `ticket set`      -> no field lost to another write
  spec + assign in parallel    -> both changes survive
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "hub")

HC = """#!/bin/sh
case "$1" in
  ls) echo '{"terminals":[]}' ;;
  get) echo '{}'; exit 1 ;;
  run) echo '{"address":"t-agent-1"}' ;;
  send) ;;
  *) exit 0 ;;
esac
"""

APP_STUB = """#!/bin/sh
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  *) exit 0 ;;
esac
"""


class HubRaceTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-race-")
        self.addCleanup(shutil.rmtree, self.base, True)
        self.home = os.path.join(self.base, "home")
        self.app = os.path.join(self.base, "app")
        self.bin = os.path.join(self.base, "bin")
        self.repo = os.path.join(self.base, "repo")
        self.tickets = os.path.join(self.app, "data", "quests", "tickets")
        for d in (self.home, self.app, self.bin, self.repo):
            os.makedirs(d)
        for name, body in (("hc", HC), ("herdr-app", APP_STUB)):
            p = os.path.join(self.bin, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)
            os.chmod(p, 0o755)

    # ---- helpers

    def env(self):
        env = {**os.environ, "HOME": self.home, "HERDR_APP_HOME": self.app,
               "PATH": self.bin + os.pathsep + os.environ.get("PATH", "")}
        env.pop("HC_TERMINAL_ID", None)
        return env

    def hub(self, *args):
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True,
                              env=self.env())

    def parallel(self, calls):
        """Every call in its own process, all started before the first one is waited on."""
        procs = [subprocess.Popen([sys.executable, HUB, *call], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, env=self.env())
                 for call in calls]
        return [(p.wait(), *p.communicate()) for p in procs]

    def ticket(self, title, body=""):
        r = self.hub("ticket", "new", "--title", title, "--body", body)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def fields(self, tid):
        with open(os.path.join(self.tickets, tid + ".md"), encoding="utf-8") as f:
            text = f.read()
        meta = {}
        for line in text.split("---\n", 2)[1].splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        return meta, text

    def assert_all_ok(self, results):
        for code, out, err in results:
            self.assertEqual(code, 0, err or out)

    # ---- ticket ids

    def test_five_parallel_ticket_new_makes_five_tickets(self):
        results = self.parallel([("ticket", "new", "--title", "Gleich")] * 5)
        self.assert_all_ok(results)

        names = sorted(n[:-3] for n in os.listdir(self.tickets) if n.endswith(".md"))
        self.assertEqual(len(names), 5, names)
        ids = [out.strip() for _code, out, _err in results]
        self.assertEqual(len(set(ids)), 5, f"doppelte ID: {ids}")
        self.assertEqual(sorted(ids), names, "jeder Aufruf meldet sein eigenes Ticket")
        for tid in ids:
            meta, _text = self.fields(tid)
            self.assertEqual(meta["title"], "Gleich", tid)

    # ---- lessons

    def test_six_parallel_lessons_all_survive(self):
        results = self.parallel([("lesson", "add", self.repo, "--from", "review", f"Lehre {i}")
                                 for i in range(1, 7)])
        self.assert_all_ok(results)

        path = os.path.join(self.repo, ".herdr", "lessons.md")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        lines = [line for line in text.splitlines() if line.strip()]
        self.assertEqual(len(lines), 6, text)
        for i in range(1, 7):
            self.assertEqual(text.count(f"Lehre {i}"), 1, f"Lehre {i} fehlt:\n{text}")

    def test_lesson_add_on_readonly_repo_fails_cleanly(self):
        if os.geteuid() == 0:
            self.skipTest("root schreibt trotz Modus 0555")
        ro = os.path.join(self.base, "readonly")
        os.makedirs(ro)
        os.chmod(ro, 0o555)
        self.addCleanup(os.chmod, ro, 0o755)

        r = self.hub("lesson", "add", ro, "--from", "review", "Lehre")
        self.assertEqual(r.returncode, 1)
        self.assertIn("nicht schreibbar", r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    # ---- roster

    def test_four_parallel_agent_add_one_wins_three_fail(self):
        results = self.parallel([("agent", "add", "Neo")] * 4)
        codes = [code for code, _out, _err in results]
        self.assertEqual(codes.count(0), 1, results)
        for code, out, err in results:
            if code == 0:
                continue
            self.assertEqual(code, 1, err or out)
            self.assertIn("Agent 'Neo' gibt es schon", err)

        with open(os.path.join(self.app, "agents", "roster.json"), encoding="utf-8") as f:
            rows = json.load(f)
        self.assertEqual([r["name"] for r in rows], ["Neo"])

    # ---- field-level writes on one ticket

    def test_ten_parallel_sets_lose_no_field(self):
        tid = self.ticket("Feldtest")
        pairs = [("title", "Neu"), ("repo", self.repo), ("labels", "a, b"),
                 ("due", "2026-01-02"), ("source", "signal"), ("type", "bug"),
                 ("size", "M"), ("priority", "p1"), ("tags", "x"),
                 ("evidence", "docs/x.md")]
        results = self.parallel([("ticket", "set", tid, f"{k}={v}") for k, v in pairs])
        self.assert_all_ok(results)

        meta, _text = self.fields(tid)
        for k, v in pairs:
            self.assertEqual(meta.get(k), v, f"{k} ging bei einem parallelen Schreiben verloren: {meta}")

    def test_parallel_spec_and_assign_keep_both(self):
        tid = self.ticket("Spec und Assign")
        results = self.parallel([("spec", tid), ("ticket", "assign", tid, "bob")])
        self.assert_all_ok(results)

        meta, text = self.fields(tid)
        self.assertEqual(meta.get("assignee"), "bob")
        self.assertIn("## Ziel", text)
        self.assertIn("## Abnahmekriterien", text)


if __name__ == "__main__":
    unittest.main()
