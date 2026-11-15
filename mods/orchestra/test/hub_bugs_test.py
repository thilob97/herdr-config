#!/usr/bin/env python3
"""Regression tests for the hub bug batch: agent name vs. start command, `--since`
clamping, the compact review refusal, `spec` on closed tickets and `verify`'s message.

    python3 mods/orchestra/test/hub_bugs_test.py

Every test builds a throwaway HOME with its own ticket store and git repositories.
`hc` is a stub on PATH: `run` reports a fake terminal, `get`/`ls` answer from
$HC_GET_FILE/$HC_LS_FILE. No real Herdr window, agent or GitHub is touched.
"""
import json
import os
import re
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


class HubBugsTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-bugs-")
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

    def hub(self, *args, env=None):
        e = dict(os.environ)
        e.update(HOME=self.home, HERDR_APP_HOME=self.app,
                 PATH=self.bin + os.pathsep + e.get("PATH", ""),
                 HC_GET_FILE=self.get_file, HC_LS_FILE=self.ls_file,
                 HC_RUN_LOG=self.run_log, HUB_NIGHT_STEP="0")
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

    def text_of(self, tid):
        with open(os.path.join(self.app, "data", "quests", "tickets", tid + ".md"), encoding="utf-8") as f:
            return f.read()

    def meta_of(self, tid):
        m = re.match(r"^---\n(.*?)\n---\n", self.text_of(tid), re.S)
        return dict(line.split(": ", 1) for line in (m.group(1) if m else "").splitlines() if ": " in line)

    def at(self, ms):
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000))

    def terminal(self, address, **info):
        try:
            with open(self.get_file, encoding="utf-8") as f:
                rows = json.load(f)
        except (OSError, ValueError):
            rows = {}
        rows[address] = info
        self.write_json(self.get_file, rows)

    def orchestrator(self, address="t-orch", **info):
        now = int(time.time() * 1000)
        self.terminal(address, labels={"hub.role": "orchestrator"}, state="live", name="orchestrator",
                      created_ms=now - 17 * 3600_000, **info)
        self.write_json(self.ls_file, {"terminals": [{"address": address,
                                                      "labels": {"hub.role": "orchestrator"}}]})
        return address

    def timeline(self, *args):
        r = self.hub("timeline", "--json", *args)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    # ---- 1: dispatch writes the display name, the command gets its own field

    def test_dispatch_writes_agent_name_and_agent_cmd(self):
        repo = self.repo()
        tid = self.criteria_ticket("Start", repo)
        r = self.hub("dispatch", tid, "--no-worktree", "--agent", "true")
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = self.meta_of(tid)
        self.assertEqual(meta["agent"], "true")
        self.assertEqual(meta["agent_cmd"], "true")

    def test_dispatch_with_a_command_keeps_it_in_agent_cmd(self):
        repo = self.repo()
        tid = self.criteria_ticket("Kommando", repo)
        r = self.hub("dispatch", tid, "--no-worktree", "--agent", "omp --model=opencode-go/x")
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = self.meta_of(tid)
        self.assertEqual(meta["agent"], "omp")
        self.assertEqual(meta["agent_cmd"], "omp --model=opencode-go/x")

    # ---- 2: old tickets with the command in `agent` read as the program

    def test_legacy_agent_command_reads_as_the_program(self):
        repo = self.repo()
        tid = self.ticket("Alt", repo, agent="omp --model=opencode-go/x --approval-mode=yolo")
        listed = self.hub("ticket", "list").stdout.splitlines()
        line = next(x for x in listed if x.startswith(tid))
        self.assertIn(" omp ", line)
        self.assertNotIn("--model", line)
        shown = self.hub("ticket", "show", tid).stdout
        self.assertIn("agent: omp\n", shown)
        self.assertNotIn("agent: omp --model", shown)

    # ---- 3: --since cuts the lanes at the window, drops subagents outside it

    def test_since_clamps_every_lane_and_filters_subagents(self):
        repo = self.repo()
        now = int(time.time() * 1000)
        orch = self.orchestrator()
        tid = self.criteria_ticket("Läuft", repo, status="doing", terminal="t-a",
                                   status_log=f"doing@{self.at(now - 16 * 3600_000)}")
        self.terminal("t-a", name="Moxie", state="live", created_ms=now - 2 * 3600_000,
                      parent=orch, status={"state": "working"})
        path = os.path.join(self.app, "data", "agent-cards", "subagents.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"id": "s-old", "title": "Alt", "started": now - 3 * 3600_000,
                                "ended": now - 3 * 3600_000, "terminal": "t-a"}) + "\n")
            f.write(json.dumps({"id": "s-new", "title": "Neu", "started": now - 30 * 60_000,
                                "ended": None, "terminal": "t-a"}) + "\n")

        report = self.timeline("--since", "1h")
        floor = report["since"]
        self.assertTrue(report["lanes"])
        for lane in report["lanes"]:
            self.assertGreaterEqual(lane["start"], floor, f"{lane['label']} beginnt vor dem Fenster")
            self.assertLessEqual(lane["start"], lane["end"])
        lane = next(l for l in report["lanes"] if l["terminal"] == "t-a")
        self.assertEqual([s["id"] for s in lane["subagents"]], ["s-new"])
        self.assertGreaterEqual(lane["subagents"][0]["started"], floor)
        self.assertTrue(all(e["at"] >= floor for e in report["events"]))
        orch_lane = next(l for l in report["lanes"] if l["kind"] == "orchestrator")
        self.assertEqual(orch_lane["start"], floor, "die Orchestrator-Lane beginnt am Fenster")

    # ---- 4: review refuses compactly, one line per missing point

    def test_review_refusal_is_short_and_names_each_gap_once(self):
        repo = self.repo()
        head = self.git("rev-parse", "HEAD", cwd=repo).stdout.strip()
        tid = self.criteria_ticket("Übergabe", repo, status="doing",
                                   checks="pass", checks_head=head, review="fail")
        r = self.hub("review", tid, "--summary", "Fertig.")
        self.assertNotEqual(r.returncode, 0)
        lines = r.stderr.splitlines()
        self.assertLessEqual(len(lines), 4, r.stderr)
        self.assertTrue(lines[0].startswith(f"hub: {tid}: Verweigert: "), lines[0])
        details = [x for x in lines[1:] if x.startswith("  ")]
        self.assertEqual(len(details), 3, r.stderr)
        self.assertEqual(len({x.split(":", 1)[0] for x in details}), 3, "jeder Punkt genau einmal")
        self.assertIn(f"hub review-start {tid}", r.stderr)
        self.assertIn(f"hub review {tid} --evidence PATH", r.stderr)
        self.assertIn("Abnahme im Verlauf", r.stderr)
        self.assertNotIn("Definition of Done", r.stderr)
        self.assertNotIn("status: review", self.text_of(tid), "das Ticket bleibt in Arbeit")

    # ---- 5: spec refuses closed tickets unless --force

    def test_spec_refuses_done_and_review_without_force(self):
        repo = self.repo()
        for status in ("done", "review"):
            with self.subTest(status=status):
                tid = self.ticket("Geschlossen", repo, body="## Ziel\n\nEtwas.\n", status=status)
                before = self.text_of(tid)
                r = self.hub("spec", tid)
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("--force", r.stderr)
                self.assertIn(status, r.stderr)
                self.assertEqual(self.text_of(tid), before, "ohne --force bleibt das Ticket unverändert")
                forced = self.hub("spec", tid, "--force")
                self.assertEqual(forced.returncode, 0, forced.stderr)
                self.assertIn("## Abnahmekriterien", self.text_of(tid))

    # ---- 6: verify names the missing repo in German, git's text stays in the log

    def test_verify_reports_a_missing_repository_without_git_noise(self):
        folder = os.path.join(self.base, "kein-repo")
        os.makedirs(folder)
        tid = self.ticket("Kein Repo", folder)
        r = self.hub("verify", tid)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("kein Git-Repository", r.stderr)
        self.assertNotIn("fatal:", r.stderr)
        text = self.text_of(tid)
        self.assertIn("## Prüfung", text, "die Prüfung zeichnet den Fehlschlag auf")
        self.assertIn("fatal:", text, "die technische Zeile steht im Log, nicht in der Meldung")
        self.assertIn("checks: fail", text)


if __name__ == "__main__":
    unittest.main()
