#!/usr/bin/env python3
"""Regression tests for the force counter: every overridden gate leaves a `force` line
in events.jsonl, and `hub stats` reports it — total, per site and per repo.

    python3 mods/orchestra/test/hub_force_test.py

A gate that is bypassed silently is decoration. The number these tests pin down is the
one that says whether the gates hold or whether `--force --reason` became the normal path.

Every test builds a throwaway HOME with its own ticket store and git repository.
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


class HubForceTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-force-")
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

    def ticket(self, title, repo, body="", **fields):
        r = self.hub("ticket", "new", "--title", title, "--repo", repo, "--body", body)
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = r.stdout.strip()
        pairs = [f"{k}={v}" for k, v in fields.items()]
        if pairs:
            r = self.hub("ticket", "set", tid, *pairs)
            self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def events(self):
        path = os.path.join(self.app, "data", "orchestra", "events.jsonl")
        if not os.path.exists(path):
            return []
        with open(path, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    def stats(self):
        r = self.hub("stats", "--json", "--all")
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    # ---- tests

    def test_dispatch_force_writes_one_force_event(self):
        """Ohne Abnahmekriterium greift das Spec-Gate; `--force --reason` überfährt es
        und muss als `force` mit Ort `start` im Log stehen."""
        repo = self.repo()
        tid = self.ticket("Ohne Kriterien", repo)
        r = self.hub("dispatch", tid, "--agent", "omp", "--force", "--reason", "Testfall")
        forces = [e for e in self.events() if e.get("kind") == "force"]
        self.assertEqual(len(forces), 1, f"erwartet 1 force-Event, gefunden {forces}\n{r.stdout}\n{r.stderr}")
        self.assertEqual(forces[0]["ticket"], tid)
        self.assertTrue(forces[0]["text"].startswith("start:"), forces[0]["text"])
        self.assertIn("Testfall", forces[0]["text"])

    def test_force_without_reason_is_refused_and_logs_nothing(self):
        repo = self.repo()
        tid = self.ticket("Ohne Kriterien", repo)
        r = self.hub("dispatch", tid, "--agent", "omp", "--force")
        self.assertNotEqual(r.returncode, 0, "ohne --reason darf das Gate nicht weichen")
        self.assertEqual([e for e in self.events() if e.get("kind") == "force"], [])

    def test_stats_counts_force_by_site_and_repo(self):
        """Die Auswertung zählt synthetische `force`-Zeilen: gesamt, je Ort, je Repo."""
        repo_a = self.repo("alpha")
        repo_b = self.repo("beta")
        self.ticket("A", repo_a)
        self.ticket("B", repo_b)
        path = os.path.join(self.app, "data", "orchestra", "events.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        now = int(time.time() * 1000)
        rows = [
            {"at": now, "kind": "force", "ticket": "", "agent": "hub", "terminal": "", "text": "start: x", "space": ""},
            {"at": now, "kind": "force", "ticket": "", "agent": "hub", "terminal": "", "text": "review: y", "space": ""},
            {"at": now, "kind": "force", "ticket": "", "agent": "hub", "terminal": "", "text": "ci: z", "space": ""},
            {"at": now - 90 * 24 * 3600 * 1000, "kind": "force", "ticket": "", "agent": "hub",
             "terminal": "", "text": "start: alt", "space": ""},
        ]
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(json.dumps(r) for r in rows) + "\n")

        out = self.stats()
        self.assertEqual(out["force"]["total"], 3, "das alte Event liegt außerhalb des Fensters")
        self.assertEqual(out["force"]["sites"]["start"], 1)
        self.assertEqual(out["force"]["sites"]["review"], 1)
        self.assertEqual(out["force"]["sites"]["ci"], 1)
        self.assertEqual(out["force"]["sites"]["station"], 0)

    def test_stats_text_names_the_count(self):
        repo = self.repo()
        self.ticket("A", repo)
        path = os.path.join(self.app, "data", "orchestra", "events.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"at": int(time.time() * 1000), "kind": "force", "ticket": "",
                                "agent": "hub", "terminal": "", "text": "start: x", "space": ""}) + "\n")
        r = self.hub("stats", "--all")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout, r"Überfahren: 1 \(start 1\)")


if __name__ == "__main__":
    unittest.main(verbosity=2)
