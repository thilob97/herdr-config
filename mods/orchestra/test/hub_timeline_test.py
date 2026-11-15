#!/usr/bin/env python3
"""Regression tests for the event log and `hub timeline`.

    python3 mods/orchestra/test/hub_timeline_test.py

Every test builds a throwaway HOME with its own ticket store and git repositories.
`hc` is a stub on PATH: `get` answers from $HC_GET_FILE (address -> JSON), `ls` from
$HC_LS_FILE, `run` reports a fake terminal. No real Herdr window, agent or GitHub is
touched.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "hub")

HC = """#!/usr/bin/env python3
import json, os, sys
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "ls":
    path = os.environ.get("HC_LS_FILE")
    if path and os.path.exists(path):
        sys.stdout.write(open(path, encoding="utf-8").read())
    else:
        print('{"terminals":[]}')
elif cmd == "get":
    path = os.environ.get("HC_GET_FILE")
    rows = json.load(open(path, encoding="utf-8")) if path and os.path.exists(path) else {}
    info = rows.get(sys.argv[2]) if len(sys.argv) > 2 else None
    if info is None:
        print("{}")
        sys.exit(1)
    print(json.dumps(info))
elif cmd == "run":
    log = os.environ.get("HC_RUN_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(" ".join(sys.argv[1:]) + "\\n")
    print('{"address":"t-new"}')
elif cmd == "send":
    log = os.environ.get("HC_SEND_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(" ".join(sys.argv[1:]) + "\\n")
sys.exit(0)
"""

APP = """#!/bin/sh
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  *) exit 0 ;;
esac
"""


class HubTimelineTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-timeline-")
        self.addCleanup(shutil.rmtree, self.base, True)
        self.home = os.path.join(self.base, "home")
        self.app = os.path.join(self.base, "app")
        self.bin = os.path.join(self.base, "bin")
        self.repos = os.path.join(self.base, "repos")
        for d in (self.home, self.app, self.bin, self.repos):
            os.makedirs(d)
        for name, body in (("hc", HC), ("herdr-app", APP)):
            p = os.path.join(self.bin, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)
            os.chmod(p, 0o755)
        self.get_file = os.path.join(self.base, "hc-get.json")
        self.ls_file = os.path.join(self.base, "hc-ls.json")
        self.run_log = os.path.join(self.base, "hc-run.log")
        self.git_env = {**os.environ, "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.test",
                        "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.test"}
        self.write_json(self.get_file, {})
        self.write_json(self.ls_file, {"terminals": []})

    # ---- helpers

    def write_json(self, path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return data

    def git(self, *args, cwd):
        return subprocess.run(["git", *args], cwd=cwd, env=self.git_env,
                              capture_output=True, text=True, check=True)

    def repo(self, name="repo"):
        path = os.path.join(self.repos, name)
        os.makedirs(path)
        self.git("init", "-q", "-b", "main", cwd=path)
        with open(os.path.join(path, "f.txt"), "w", encoding="utf-8") as f:
            f.write(name + "\n")
        self.git("add", "f.txt", cwd=path)
        self.git("commit", "-q", "-m", "start", cwd=path)
        return path

    def verify_repo(self, name="repo"):
        path = self.repo(name)
        os.makedirs(os.path.join(path, ".herdr"))
        with open(os.path.join(path, ".herdr", "verify.sh"), "w", encoding="utf-8") as f:
            f.write("#!/bin/sh\necho verify-ok\n")
        self.git("add", ".herdr/verify.sh", cwd=path)
        self.git("commit", "-q", "-m", "verify", cwd=path)
        return path

    def hub(self, *args, env=None):
        e = dict(os.environ)
        e.update(HOME=self.home, HERDR_APP_HOME=self.app,
                 PATH=self.bin + os.pathsep + e.get("PATH", ""),
                 HC_GET_FILE=self.get_file, HC_LS_FILE=self.ls_file, HC_RUN_LOG=self.run_log,
                 HUB_NIGHT_STEP="0")
        e.update(env or {})
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True, env=e)

    def ticket(self, title, repo, body="", status="todo", **fields):
        r = self.hub("ticket", "new", "--title", title, "--repo", repo, "--body", body)
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = r.stdout.strip()
        pairs = [f"status={status}"] + [f"{k}={v}" for k, v in fields.items()]
        r = self.hub("ticket", "set", tid, *pairs)
        self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def criteria_ticket(self, title, repo, **fields):
        return self.ticket(title, repo, body="## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n", **fields)

    def events(self):
        path = os.path.join(self.app, "data", "orchestra", "events.jsonl")
        try:
            with open(path, encoding="utf-8") as f:
                return [json.loads(line) for line in f.read().splitlines() if line.strip()]
        except OSError:
            return []

    def timeline(self, *args):
        r = self.hub("timeline", "--json", *args)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def terminal(self, address, **info):
        rows = {}
        try:
            with open(self.get_file, encoding="utf-8") as f:
                rows = json.load(f)
        except (OSError, ValueError):
            pass
        rows[address] = info
        self.write_json(self.get_file, rows)

    def orchestrator(self, address="t-orch", **info):
        self.terminal(address, labels={"hub.role": "orchestrator"}, state="live",
                      name="orchestrator", created_ms=int(time.time() * 1000) - 86400_000, **info)
        self.write_json(self.ls_file, {"terminals": [{"address": address,
                                                      "labels": {"hub.role": "orchestrator"}}]})
        return address

    def costs(self, **data):
        path = os.path.join(self.app, "data", "orchestra", "costs.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.write_json(path, data)

    # ---- the event log

    def test_dispatch_writes_exactly_one_dispatch_event(self):
        repo = self.repo()
        tid = self.criteria_ticket("Eins", repo)
        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertEqual(r.returncode, 0, r.stderr)

        rows = self.events()
        self.assertEqual([x["kind"] for x in rows], ["dispatch"])
        self.assertEqual(rows[0]["ticket"], tid)
        self.assertEqual(rows[0]["terminal"], "t-new")
        self.assertEqual(rows[0]["agent"], "omp")
        self.assertRegex(str(rows[0]["at"]), r"^\d{13}$", "at ist in Millisekunden")

    def test_review_verify_and_land_write_one_event_each(self):
        repo = self.verify_repo()
        wt = os.path.join(self.base, "wt")
        self.git("worktree", "add", "-q", "-b", "feat/one", wt, cwd=repo)
        head = self.git("rev-parse", "HEAD", cwd=wt).stdout.strip()
        tid = self.ticket("Gelandet", repo, body="## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n",
                          status="doing", worktree=wt, branch="feat/one", base="main",
                          checks="pass", checks_head=head, review="pass", review_head=head,
                          evidence="/tmp/beleg.png")
        self.assertEqual(self.hub("ticket", "comment", tid, "--from", "bob", "Fertig.").returncode, 0)

        r = self.hub("verify", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = self.hub("review", tid, "--summary", "Fertig.")
        self.assertEqual(r.returncode, 0, r.stderr)
        r = self.hub("land", tid, "--merge", "--keep-worktree", "--keep-space")
        self.assertEqual(r.returncode, 0, r.stderr)

        kinds = [x["kind"] for x in self.events()]
        self.assertEqual(kinds.count("verify"), 1)
        self.assertEqual(kinds.count("review"), 1)
        self.assertEqual(kinds.count("land"), 1)
        for row in self.events():
            self.assertTrue({"at", "kind", "ticket", "agent", "terminal", "text"} <= set(row))
        self.assertIn("done", self.text_of(tid))

    def test_log_rotates_to_the_last_2000_lines_past_5000(self):
        repo = self.repo()
        tid = self.ticket("Rotiert", repo)
        path = os.path.join(self.app, "data", "orchestra", "events.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            for i in range(5000):
                f.write(json.dumps({"at": 1000 + i, "kind": "comment", "ticket": "alt",
                                    "agent": "", "terminal": "", "text": f"alt {i}"}) + "\n")

        r = self.hub("ticket", "comment", tid, "--from", "bob", "neu")
        self.assertEqual(r.returncode, 0, r.stderr)

        rows = self.events()
        self.assertEqual(len(rows), 2000, "über 5000 Zeilen bleiben die letzten 2000")
        self.assertNotEqual(rows[0]["text"], "alt 0", "die ältesten fallen raus")
        self.assertEqual(rows[-1]["kind"], "comment")
        self.assertEqual(rows[-1]["text"], "neu")

    def test_night_writes_start_and_stop_per_started_ticket(self):
        repo = self.verify_repo("night")
        tid = self.criteria_ticket("Nachts", repo)
        r = self.hub("night", "--max", "1", "--for", "5")
        self.assertEqual(r.returncode, 0, r.stderr)

        rows = [x for x in self.events() if x["kind"] in ("night", "dispatch")]
        self.assertEqual([x["kind"] for x in rows], ["dispatch", "night", "night"],
                         "Reihenfolge: dispatch, Start, Stopp")
        self.assertEqual(rows[1]["text"], "Start")
        self.assertEqual(rows[2]["text"], "Stopp")
        self.assertTrue(all(x["ticket"] == tid for x in rows))

    # ---- lanes

    def test_lanes_from_two_tickets_carry_terminal_metadata_and_cost(self):
        repo = self.repo()
        now = int(time.time() * 1000)
        orch = self.orchestrator()
        a = self.criteria_ticket("Läuft", repo, status="doing", terminal="t-a", agent="moxie",
                                 review_terminal="t-r", reviewer="claude",
                                 status_log=f"todo@{self.at(now - 7200_000)}|doing@{self.at(now - 3600_000)}")
        b = self.criteria_ticket("Fertig", repo, status="done", terminal="t-b", agent="byte",
                                 status_log=f"todo@{self.at(now - 9000_000)}|doing@{self.at(now - 8000_000)}"
                                            f"|done@{self.at(now - 1800_000)}")
        self.terminal("t-a", name="Moxie", state="live", created_ms=now - 3600_000, parent=orch,
                      labels={"hub.ticket": a}, status={"state": "working"})
        self.terminal("t-r", name="Prüfer", state="live", created_ms=now - 1800_000, parent=orch,
                      labels={"hub.ticket": a}, status={"state": "waiting"})
        self.terminal("t-b", name="Byte", state="finished", created_ms=now - 8000_000,
                      finished_ms=now - 1800_000, parent=orch, labels={"hub.ticket": b},
                      status={"state": "done"})
        self.costs(tickets={a: 1.25, b: 2.5}, perTerminal={f"{a}|t-a": 1.25, f"{b}|t-b": 2.5},
                   orchestrator=0.5)

        report = self.timeline()
        lanes = {l["terminal"]: l for l in report["lanes"]}
        orch_lane = next(l for l in report["lanes"] if l["kind"] == "orchestrator")
        self.assertEqual(orch_lane["terminal"], orch)
        self.assertEqual(orch_lane["cost"], 0.5)

        live = lanes["t-a"]
        self.assertEqual(live["kind"], "agent")
        self.assertEqual(live["ticket"], a)
        self.assertEqual(live["label"], "Moxie")
        self.assertEqual(live["parent"], orch_lane["id"], "Parent verweist auf die Lane")
        self.assertEqual(live["start"], now - 3600_000)
        self.assertGreaterEqual(live["end"], now - 5000, "live heißt: Ende ist jetzt")
        self.assertEqual(live["status"], "working")
        self.assertEqual(live["cost"], 1.25)
        self.assertTrue(any(e["text"] == "doing" and e["kind"] == "status" for e in live["events"]),
                        "status_log wird als Ereignis gezeigt")

        done = lanes["t-b"]
        self.assertEqual(done["end"], now - 1800_000)
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["cost"], 2.5)
        review = lanes["t-r"]
        self.assertEqual(review["kind"], "reviewer")
        self.assertEqual(review["ticket"], a)
        self.assertEqual(review["parent"], orch_lane["id"])
        self.assertEqual(review["status"], "waiting")
        self.assertEqual(report["since"], 0)
        self.assertRegex(str(report["now"]), r"^\d{13}$")

    def test_since_filters_old_lanes_and_events(self):
        repo = self.repo()
        now = int(time.time() * 1000)
        orch = self.orchestrator()
        old = self.criteria_ticket("Alt", repo, status="done", terminal="t-old",
                                   status_log=f"todo@{self.at(now - 3 * 86400_000)}"
                                              f"|done@{self.at(now - 3 * 86400_000)}")
        fresh = self.criteria_ticket("Frisch", repo, status="doing", terminal="t-fresh",
                                     status_log=f"doing@{self.at(now - 300_000)}")
        self.terminal("t-old", name="Alt", state="finished", created_ms=now - 3 * 86400_000,
                      finished_ms=now - 3 * 86400_000 + 600_000, parent=orch)
        self.terminal("t-fresh", name="Frisch", state="live", created_ms=now - 300_000, parent=orch,
                      status={"state": "working"})

        report = self.timeline("--since", "1h")
        terminals = {l["terminal"] for l in report["lanes"]}
        self.assertIn("t-fresh", terminals)
        self.assertNotIn("t-old", terminals)
        self.assertEqual({e["ticket"] for e in report["events"]}, {fresh})
        self.assertGreaterEqual(report["since"], now - 3700_000)

        everything = self.timeline("--since", "all")
        self.assertIn("t-old", {l["terminal"] for l in everything["lanes"]})

        r = self.hub("timeline", "--since", "gestern")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--since", r.stderr)

    def test_ticket_filter_reduces_lanes_and_events(self):
        repo = self.repo()
        now = int(time.time() * 1000)
        orch = self.orchestrator()
        a = self.criteria_ticket("A", repo, status="doing", terminal="t-a")
        b = self.criteria_ticket("B", repo, status="doing", terminal="t-b")
        for addr in ("t-a", "t-b"):
            self.terminal(addr, name=addr, state="live", created_ms=now - 600_000, parent=orch)
        self.hub("ticket", "comment", a, "--from", "bob", "nur A")
        self.hub("ticket", "comment", b, "--from", "bob", "nur B")

        report = self.timeline("--ticket", a)
        self.assertEqual({l["ticket"] for l in report["lanes"]}, {a})
        self.assertEqual({e["ticket"] for e in report["events"]}, {a})
        self.assertNotIn("orchestrator", {l["kind"] for l in report["lanes"]})

        unknown = self.hub("timeline", "--ticket", "gibt-es-nicht")
        self.assertNotEqual(unknown.returncode, 0)

    def test_subagents_attach_to_their_lane(self):
        repo = self.repo()
        now = int(time.time() * 1000)
        orch = self.orchestrator()
        tid = self.criteria_ticket("Mit Sub", repo, status="doing", terminal="t-a")
        self.terminal("t-a", name="Moxie", state="live", created_ms=now - 600_000, parent=orch)
        path = os.path.join(self.app, "data", "agent-cards", "subagents.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"id": "s1", "title": "Scout", "started": now - 300_000,
                                "ended": now - 200_000, "terminal": "t-a"}) + "\n")
            f.write(json.dumps({"id": "s2", "title": "Fremd", "started": now,
                                "ended": now, "terminal": "t-other"}) + "\n")

        lane = next(l for l in self.timeline("--ticket", tid)["lanes"] if l["terminal"] == "t-a")
        self.assertEqual(len(lane["subagents"]), 1)
        self.assertEqual(lane["subagents"][0], {"id": "s1", "title": "Scout",
                                               "started": now - 300_000, "ended": now - 200_000})

    def test_write_makes_a_self_contained_html_with_both_lanes(self):
        repo = self.repo()
        now = int(time.time() * 1000)
        orch = self.orchestrator()
        a = self.criteria_ticket("Links", repo, status="doing", terminal="t-a")
        b = self.criteria_ticket("Rechts", repo, status="done", terminal="t-b")
        self.terminal("t-a", name="Moxie", state="live", created_ms=now - 600_000, parent=orch,
                      status={"state": "working"})
        self.terminal("t-b", name="Byte", state="finished", created_ms=now - 900_000,
                      finished_ms=now - 300_000, parent=orch, status={"state": "done"})

        r = self.hub("timeline", "--write")
        self.assertEqual(r.returncode, 0, r.stderr)
        path = os.path.join(self.app, "data", "orchestra", "timeline.html")
        self.assertEqual(r.stdout.strip().splitlines()[-1], path)
        with open(path, encoding="utf-8") as f:
            page = f.read()
        for needle in ("Moxie", "Byte", a, b, "<table", "</html>"):
            self.assertIn(needle, page)
        for forbidden in ("http://", "https://", "<script", "src="):
            self.assertNotIn(forbidden, page, "keine externe Ressource")

    def at(self, ms):
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000))

    def text_of(self, tid):
        with open(os.path.join(self.app, "data", "quests", "tickets", tid + ".md"), encoding="utf-8") as f:
            return f.read()


if __name__ == "__main__":
    unittest.main()
