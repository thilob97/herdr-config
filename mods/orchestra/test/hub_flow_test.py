#!/usr/bin/env python3
"""Regression tests for the five findings of the real A-Z flow run:

    python3 mods/orchestra/test/hub_flow_test.py

  1. `hub preflight` checks main (or the repo HEAD) when the ticket has no base yet,
     and writes only the report, never base/base_head.
  2. `hub spec` appends only missing sections; an existing `## Grenzen` (also with a
     colon or CRLF) stays single and untouched.
  3. `hub review-start` refuses the implementer's own terminal unless --force --reason.
  4. `hub stats` counts a fail round as rework even when the status log has no
     review→doing move (the status was still doing).
  5. `hub done` keeps uncommitted evidence readable (repo/.herdr/evidence/<id>/) and
     commits the rest on the ticket branch, then removes the worktree.

Every test builds a throwaway HOME with its own ticket store and git repository.
`hc` is a stub on PATH; no real Herdr window, agent or GitHub is touched.
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
def log(path, line):
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\\n")
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
    log(os.environ.get("HC_RUN_LOG"), json.dumps(sys.argv[1:]))
    count = os.environ.get("HC_RUN_COUNT") or os.path.join(os.environ["HOME"], "hc-run-count")
    n = int(open(count).read().strip() or 0) + 1 if os.path.exists(count) else 1
    with open(count, "w", encoding="utf-8") as f:
        f.write(str(n))
    print(json.dumps({"address": "t-review-%d" % n}))
elif cmd == "kill":
    log(os.environ.get("HC_KILL_LOG"), sys.argv[2] if len(sys.argv) > 2 else "")
elif cmd == "send":
    log(os.environ.get("HC_SEND_LOG"), " ".join(sys.argv[1:]))
sys.exit(0)
"""

APP = """#!/bin/sh
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  *) exit 0 ;;
esac
"""


class HubFlowTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-flow-")
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
        self.kill_log = os.path.join(self.base, "hc-kill.log")
        self.write_json(self.get_file, {})
        self.write_json(self.ls_file, {"terminals": []})
        self.git_identity = {"GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.test",
                             "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.test"}
        self.git_env = {**os.environ, **self.git_identity}

    # ---- helpers

    def write_json(self, path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return data

    def git(self, *args, cwd):
        r = subprocess.run(["git", *args], cwd=cwd, env=self.git_env,
                           capture_output=True, text=True, check=True)
        return r

    def repo(self, name="repo", verify="echo verify-ok"):
        path = os.path.join(self.repos, name)
        os.makedirs(path)
        self.git("init", "-q", "-b", "main", cwd=path)
        with open(os.path.join(path, "f.txt"), "w", encoding="utf-8") as f:
            f.write(name + "\n")
        if verify:
            os.makedirs(os.path.join(path, ".herdr"))
            with open(os.path.join(path, ".herdr", "verify.sh"), "w", encoding="utf-8") as f:
                f.write("#!/bin/sh\n" + verify + "\n")
        self.git("add", "-A", cwd=path)
        self.git("commit", "-q", "-m", "start", cwd=path)
        return path

    def worktree(self, repo, path, branch, commit="HEAD"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.git("worktree", "add", "-q", "-b", branch, path, commit, cwd=repo)
        return path

    def hub(self, *args, env=None):
        e = dict(os.environ)
        e.update(HOME=self.home, HERDR_APP_HOME=self.app,
                 PATH=self.bin + os.pathsep + e.get("PATH", ""),
                 HC_GET_FILE=self.get_file, HC_LS_FILE=self.ls_file,
                 HC_RUN_LOG=self.run_log, HC_KILL_LOG=self.kill_log,
                 # `hub done` committet uncommittete Nachweise selbst; ohne Identität
                 # scheitert das und der Worktree bleibt mit "would be overwritten" stehen.
                 **self.git_identity)
        e.pop("HC_TERMINAL_ID", None)
        e.update(env or {})
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True, env=e)

    def ticket(self, title, repo, body="", **fields):
        r = self.hub("ticket", "new", "--title", title, "--repo", repo, "--body", body)
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = r.stdout.strip()
        if fields:
            pairs = [f"{k}={v}" for k, v in fields.items()]
            r = self.hub("ticket", "set", tid, *pairs)
            self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def path_of(self, tid):
        return os.path.join(self.app, "data", "quests", "tickets", tid + ".md")

    def text_of(self, tid):
        with open(self.path_of(tid), encoding="utf-8") as f:
            return f.read()

    def meta_of(self, tid):
        m = re.match(r"^---\n(.*?)\n---\n", self.text_of(tid), re.S)
        return dict(line.split(": ", 1) for line in (m.group(1) if m else "").splitlines() if ": " in line)

    def run_lines(self):
        try:
            with open(self.run_log, encoding="utf-8") as f:
                return [line for line in f.read().splitlines() if line.strip()]
        except OSError:
            return []

    # ---- 1: preflight without a base checks main, writes no base

    def test_preflight_without_base_checks_main_and_writes_no_base(self):
        repo = self.repo("ohne-basis")
        tid = self.ticket("Ohne Basis", repo, body="## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n")
        self.assertNotIn("base", self.meta_of(tid))

        r = self.hub("preflight", tid, "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["preflight"], "pass")
        self.assertIn("verify-ok", out["tail"])
        meta = self.meta_of(tid)
        self.assertNotIn("base", meta, "preflight schreibt keine Basis")
        self.assertNotIn("base_head", meta, "preflight schreibt keinen Basis-Commit")
        text = self.text_of(tid)
        self.assertIn("preflight: pass", text)
        self.assertIn("## Preflight", text)

    # ---- 2: spec only adds missing sections

    def test_spec_adds_only_missing_sections(self):
        repo = self.repo("spec")
        tid = self.ticket("Spec", repo, body="## Ziel\n\nschon da\n\n## Grenzen:\n\n- bleibt\n")
        r = self.hub("spec", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        body = self.text_of(tid).split("---\n", 2)[2]
        self.assertEqual(len(re.findall(r"(?m)^##\s*Grenzen\b", body)), 1,
                         "der ausgefüllte Grenzen-Abschnitt wird nicht dupliziert")
        self.assertIn("schon da", body)
        self.assertIn("- bleibt", body)
        self.assertIn("## Abnahmekriterien", body)

        crlf = self.ticket("Spec CRLF", repo, body="## Ziel\r\n\r\nda\r\n\r\n## Grenzen\r\n\r\n- b\r\n")
        r = self.hub("spec", crlf)
        self.assertEqual(r.returncode, 0, r.stderr)
        body = self.text_of(crlf).split("---\n", 2)[2]
        self.assertEqual(len(re.findall(r"(?m)^##\s*Grenzen\b", body)), 1,
                         "auch ein CRLF-Abschnitt bleibt einmalig")
        self.assertIn("- b", body)

    # ---- 3: the implementer does not start its own review rounds

    def review_ticket(self):
        repo = self.repo("review")
        self.git("branch", "feat/x", cwd=repo)
        wt = os.path.join(self.base, "wt")
        self.git("worktree", "add", "-q", "--detach", wt, "feat/x", cwd=repo)
        tid = self.ticket("Umsetzer", repo, body="## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n",
                          status="doing", terminal="t-agent", branch="feat/x",
                          worktree=wt, base="main")
        r = self.hub("verify", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def test_review_start_refuses_the_implementer(self):
        tid = self.review_ticket()
        r = self.hub("review-start", tid, "--agent", "true", env={"HC_TERMINAL_ID": "t-agent"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("Prüfrunden startet der Orchestrator", r.stderr)
        self.assertEqual(self.run_lines(), [], "der Umsetzer startet keinen Reviewer")

        r = self.hub("review-start", tid, "--agent", "true", "--force",
                     env={"HC_TERMINAL_ID": "t-agent"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("--reason", r.stderr)

        r = self.hub("review-start", tid, "--agent", "true", "--force", "--reason", "Ausnahme",
                     env={"HC_TERMINAL_ID": "t-agent"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.run_lines()), 1)
        self.assertIn("vom Umsetzer selbst gestartet", self.text_of(tid))

        r = self.hub("review-start", tid, "--agent", "true", "--restart",
                     env={"HC_TERMINAL_ID": "t-orch"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.run_lines()), 2)

    # ---- 4: a fail round counts as rework

    def test_stats_counts_rework_after_a_fail_round(self):
        repo = self.repo("stats")
        stamp = time.strftime("%Y-%m-%d %H:%M")
        back = self.ticket("Nacharbeit", repo, status="doing",
                           status_log=f"todo@{stamp}|doing@{stamp}", review_rounds="2",
                           review_at=stamp)
        logged = self.ticket("Log-Rückläufer", repo, status="doing",
                             status_log=f"todo@{stamp}|doing@{stamp}|review@{stamp}|doing@{stamp}",
                             review_rounds="1")

        r = self.hub("stats", "--json", "--all", "--days", "14")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        rows = {row["id"]: row for row in out["tickets"]}
        self.assertGreaterEqual(rows[back]["rework"], 1, "zwei Runden = eine Nacharbeit")
        self.assertGreaterEqual(rows[logged]["rework"], 1, "review→doing im Log zählt weiter")
        self.assertGreaterEqual(out["summary"]["rework"], 2)

    # ---- 5: done keeps uncommitted evidence readable

    def test_done_keeps_uncommitted_evidence_readable(self):
        repo = self.repo("done")
        wt = self.worktree(repo, os.path.join(self.base, "wt-done"), "feat/wip")
        evidence = os.path.join(wt, "evidence.txt")
        with open(evidence, "w", encoding="utf-8") as f:
            f.write("beweis\n")
        with open(os.path.join(wt, "other.txt"), "w", encoding="utf-8") as f:
            f.write("rest\n")
        tid = self.ticket("Nachweise", repo, status="doing", branch="feat/wip",
                          worktree=wt, evidence=evidence)

        r = self.hub("done", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = self.meta_of(tid)
        self.assertEqual(meta["status"], "done")
        self.assertFalse(os.path.isdir(wt), "der Worktree ist aufgeräumt")
        kept = meta["evidence"]
        want = os.path.join(repo, ".herdr", "evidence", tid) + os.sep
        self.assertTrue(os.path.realpath(kept).startswith(os.path.realpath(want)), kept)
        with open(kept, encoding="utf-8") as f:
            self.assertEqual(f.read(), "beweis\n", "der Nachweis bleibt lesbar")
        log = self.git("log", "--oneline", "-1", "feat/wip", cwd=repo).stdout
        self.assertIn("wip: Nachweise", log)


if __name__ == "__main__":
    unittest.main()
