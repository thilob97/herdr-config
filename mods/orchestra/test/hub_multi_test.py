#!/usr/bin/env python3
"""Regression tests for several orchestrators in one home: identity, ownership, WIP, lock.

    python3 mods/orchestra/test/hub_multi_test.py

Every test builds a throwaway HOME with its own ticket store and git repositories.
`hc` is a stub on PATH: `get`/`ls` answer from a small state directory keyed by
terminal address, `run` reports a fake agent terminal, `send` logs. No real Herdr
window, agent or GitHub is touched.
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
  ls)
    if [ -n "$HC_STATE" ] && [ -f "$HC_STATE/ls.json" ]; then cat "$HC_STATE/ls.json"
    else echo '{"terminals":[]}'; fi ;;
  get)
    if [ -n "$HC_STATE" ] && [ -f "$HC_STATE/get-$2.json" ]; then cat "$HC_STATE/get-$2.json"
    else echo '{}'; exit 1; fi ;;
  run) echo '{"address":"t-agent-1"}' ;;
  send) if [ -n "$HC_SEND_LOG" ]; then printf '%s\\n' "$*" >> "$HC_SEND_LOG"; fi ;;
  *) exit 0 ;;
esac
"""

APP = """#!/bin/sh
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  *) exit 0 ;;
esac
"""

ORCH_A, ORCH_B = "t-orch-a", "t-orch-b"


class HubMultiTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-multi-")
        self.addCleanup(shutil.rmtree, self.base, True)
        self.home = os.path.join(self.base, "home")
        self.app = os.path.join(self.base, "app")
        self.bin = os.path.join(self.base, "bin")
        self.repos = os.path.join(self.base, "repos")
        self.state = os.path.join(self.base, "hc-state")
        for d in (self.home, self.app, self.bin, self.repos, self.state):
            os.makedirs(d)
        for name, body in (("hc", HC), ("herdr-app", APP)):
            p = os.path.join(self.bin, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)
            os.chmod(p, 0o755)
        self.send_log = os.path.join(self.base, "hc-send.log")
        self.git_env = {**os.environ, "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.test",
                        "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.test"}
        for addr, name in ((ORCH_A, "orch-a"), (ORCH_B, "orch-b")):
            self.write_state(f"get-{addr}.json", {"address": addr, "name": name, "state": "live",
                                                  "labels": {"hub.role": "orchestrator"}})
        self.write_state("ls.json", {"terminals": [
            {"address": ORCH_A, "name": "orch-a", "labels": {"hub.role": "orchestrator"}},
            {"address": ORCH_B, "name": "orch-b", "labels": {"hub.role": "orchestrator"}}]})

    # ---- helpers

    def write_state(self, name, data):
        with open(os.path.join(self.state, name), "w", encoding="utf-8") as f:
            json.dump(data, f)

    def git(self, *args, cwd):
        return subprocess.run(["git", *args], cwd=cwd, env=self.git_env, capture_output=True, text=True, check=True)

    def repo(self, name="repo"):
        path = os.path.join(self.repos, name)
        os.makedirs(path)
        self.git("init", "-q", "-b", "main", cwd=path)
        with open(os.path.join(path, "f.txt"), "w", encoding="utf-8") as f:
            f.write(name + "\n")
        self.git("add", "f.txt", cwd=path)
        self.git("commit", "-q", "-m", "start", cwd=path)
        return path

    def env_for(self, who=None):
        env = {**os.environ, "HOME": self.home, "HERDR_APP_HOME": self.app,
               "PATH": self.bin + os.pathsep + os.environ.get("PATH", ""),
               "HC_STATE": self.state, "HC_SEND_LOG": self.send_log}
        env.pop("HC_TERMINAL_ID", None)
        if who:
            env["HC_TERMINAL_ID"] = who
        return env

    def hub(self, *args, who=None):
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True,
                              env=self.env_for(who))

    def ticket(self, title, repo, who=None, body="", status=None):
        r = self.hub("ticket", "new", "--title", title, "--repo", repo, "--body", body, who=who)
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = r.stdout.strip()
        if status:
            r = self.hub("ticket", "set", tid, f"status={status}", who=who)
            self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def criteria(self, title, repo, who=None, status=None):
        return self.ticket(title, repo, who=who, status=status,
                           body="## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n")

    def fields(self, tid):
        with open(os.path.join(self.app, "data", "quests", "tickets", tid + ".md"), encoding="utf-8") as f:
            text = f.read()
        meta = {}
        for line in text.split("---\n", 2)[1].splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        return meta, text

    # ---- identity and ownership

    def test_whoami_and_owner_stay_with_their_own_orchestrator(self):
        repo = self.repo()
        a = self.ticket("Von A", repo, who=ORCH_A)
        b = self.ticket("Von B", repo, who=ORCH_B)
        self.assertEqual(self.fields(a)[0]["owner"], ORCH_A)
        self.assertEqual(self.fields(b)[0]["owner"], ORCH_B)

        r = self.hub("whoami", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        who_a = json.loads(r.stdout)
        self.assertEqual(who_a["orchestrator"], ORCH_A)
        self.assertEqual(who_a["name"], "orch-a")
        self.assertEqual(who_a["tickets"], 1, "nur das eigene offene Ticket")
        self.assertEqual(who_a["wip"]["arbeit"]["count"], 0)

        who_b = json.loads(self.hub("whoami", who=ORCH_B).stdout)
        self.assertEqual(who_b["orchestrator"], ORCH_B)
        self.assertEqual(who_b["name"], "orch-b")
        self.assertEqual(who_b["tickets"], 1)

        own = self.hub("status", who=ORCH_A)
        self.assertEqual(own.returncode, 0, own.stderr)
        self.assertIn(a, own.stdout)
        self.assertNotIn(b, own.stdout, "das fremde Ticket bleibt draußen")

        all_rows = self.hub("status", "--all", who=ORCH_A)
        self.assertIn(a, all_rows.stdout)
        self.assertIn(b, all_rows.stdout)
        self.assertIn(ORCH_B, all_rows.stdout, "unter --all steht der fremde Besitzer")
        self.assertIn("Besitzer", all_rows.stdout)

    def test_dispatch_fills_a_missing_owner(self):
        repo = self.repo()
        tid = self.criteria("Ohne Besitzer", repo, who=ORCH_A)
        r = self.hub("ticket", "set", tid, "owner=", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("owner", self.fields(tid)[0])
        r = self.hub("dispatch", tid, "--no-worktree", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.fields(tid)[0]["owner"], ORCH_A)

    # ---- night

    def test_night_dry_run_does_not_take_foreign_tickets(self):
        repo = self.repo()
        a = self.criteria("A startbar", repo, who=ORCH_A)
        b = self.criteria("B startbar", repo, who=ORCH_B)
        r = self.hub("night", "--dry-run", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(a, r.stdout)
        self.assertNotIn(b, r.stdout, "das fremde startbare Ticket wird nicht eingeplant")
        self.assertNotIn("B startbar", r.stdout)

    # ---- the lock

    def test_twenty_parallel_comments_all_survive(self):
        repo = self.repo()
        tid = self.ticket("Viel Kommentar", repo, who=ORCH_A)
        procs = []
        for i in range(20):
            procs.append(subprocess.Popen(
                [sys.executable, HUB, "ticket", "comment", tid, "--from", f"agent-{i}",
                 f"Beitrag-{i}-x"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env_for(ORCH_A)))
        results = [(p.wait(), p.communicate()) for p in procs]
        for code, (out, err) in results:
            self.assertEqual(code, 0, err or out)

        _meta, text = self.fields(tid)
        verlauf = text.split("## Verlauf", 1)[1]
        for i in range(20):
            self.assertEqual(verlauf.count(f"Beitrag-{i}-x"), 1, f"Beitrag {i} fehlt")
        self.assertEqual(sum(1 for line in verlauf.splitlines() if "· agent-" in line), 20,
                         "20 Einträge im Verlauf")

    # ---- WIP per orchestrator

    def test_wip_counts_only_the_orchestrators_own_tickets(self):
        repo = self.repo()
        self.ticket("A läuft", repo, who=ORCH_A, status="doing")
        self.ticket("B läuft", repo, who=ORCH_B, status="doing")
        r = self.hub("wip", "arbeit=2", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)

        for who in (ORCH_A, ORCH_B):
            r = self.hub("wip", who=who)
            self.assertIn("arbeit 1/2", r.stdout, "nur das eigene Ticket zählt")
        r = self.hub("wip", "--all", who=ORCH_A)
        self.assertIn("arbeit 2/2", r.stdout, "--all zeigt die globale Summe")

        fresh = self.criteria("A neu", repo, who=ORCH_A)
        r = self.hub("dispatch", fresh, "--no-worktree", who=ORCH_A)
        self.assertEqual(r.returncode, 0,
                         r.stderr + "\n1 eigenes + 1 fremdes Ticket in Arbeit blockiert nicht bei Limit 2")

    def test_wip_mine_sets_only_the_own_limit(self):
        r = self.hub("wip", "--mine", "arbeit=1", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(self.app, "data", "orchestra", "wip.json"), encoding="utf-8") as f:
            data = json.load(f)
        self.assertTrue(data["per_orchestrator"])
        self.assertEqual(data["mine"][ORCH_A], {"arbeit": 1})
        r = self.hub("wip", "--json", who=ORCH_A)
        self.assertEqual(json.loads(r.stdout), {"arbeit": 1, "pruefung": 2})
        r = self.hub("wip", "--json", who=ORCH_B)
        self.assertEqual(json.loads(r.stdout), {"arbeit": 3, "pruefung": 2},
                         "der Standard bleibt für neue Orchestratoren")

    # ---- nudge

    def test_nudge_refuses_a_foreign_ticket_without_force(self):
        repo = self.repo()
        tid = self.ticket("B Arbeit", repo, who=ORCH_B)
        r = self.hub("nudge", tid, "--text", "Stand?", who=ORCH_A)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(ORCH_B, r.stderr)
        self.assertIn("--force", r.stderr)
        self.assertNotIn("Stand abgefragt", self.fields(tid)[1], "nichts geschrieben")

        r = self.hub("nudge", tid, "--text", "Stand?", "--force", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Stand abgefragt", self.fields(tid)[1])


if __name__ == "__main__":
    unittest.main()
