#!/usr/bin/env python3
"""Regression tests for `hub cleanup` scope and the CI binding in `hub land --merge`.

    python3 mods/orchestra/test/hub_cleanup_test.py

Every test builds a throwaway HOME with its own ticket store and its own worktree
root, so no real `~/.herdr/worktrees` is read or changed. `hc`, `herdr-app` and `gh`
are stubs on PATH: these tests must not contact a live Herdr window or GitHub.
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
  ls) if [ -n "$TEST_HC_JSON" ]; then printf '%s\\n' "$TEST_HC_JSON"; else echo '{"terminals":[]}'; fi ;;
  get) echo '{}'; exit 1 ;;
  *) exit 0 ;;
esac
"""

APP = """#!/bin/sh
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  do) exit 0 ;;
  *) exit 0 ;;
esac
"""

GH = """#!/bin/sh
case "$*" in
  "pr view"*) echo '{"url":"https://example.test/pr/1","state":"OPEN"}' ;;
  "pr checks"*) echo '[{"name":"ci","state":"SUCCESS","bucket":"pass","link":""}]' ;;
  *) exit 1 ;;
esac
"""


class HubCleanupTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-cleanup-")
        self.addCleanup(shutil.rmtree, self.base, True)
        self.home = os.path.join(self.base, "home")
        self.app = os.path.join(self.base, "app")
        self.app_b = os.path.join(self.base, "app-b")
        self.bin = os.path.join(self.base, "bin")
        self.root_a = os.path.join(self.base, "roots", "a")
        self.root_b = os.path.join(self.base, "roots", "b")
        self.repos = os.path.join(self.base, "repos")
        for d in (self.home, self.app, self.app_b, self.bin, self.root_a, self.root_b, self.repos):
            os.makedirs(d)
        for name, body in (("hc", HC), ("herdr-app", APP), ("gh", GH)):
            p = os.path.join(self.bin, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)
            os.chmod(p, 0o755)
        self.git_identity = {"GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.test",
                             "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.test"}
        self.git_env = {**os.environ, **self.git_identity}

    # ---- helpers

    def git(self, *args, cwd):
        return subprocess.run(["git", *args], cwd=cwd, env=self.git_env, capture_output=True, text=True, check=True)

    def repo(self, name):
        path = os.path.join(self.repos, name)
        os.makedirs(path)
        self.git("init", "-q", "-b", "main", cwd=path)
        with open(os.path.join(path, "f.txt"), "w", encoding="utf-8") as f:
            f.write(name + "\n")
        self.git("add", "f.txt", cwd=path)
        self.git("commit", "-q", "-m", "start", cwd=path)
        return path

    def worktree(self, repo, path, branch, commit="HEAD"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.git("worktree", "add", "-q", "-b", branch, path, commit, cwd=repo)
        return path

    def hub(self, *args, app=None, env_extra=None, cwd=None):
        env = dict(os.environ)
        env.update(HOME=self.home, HERDR_APP_HOME=app or self.app,
                   PATH=self.bin + os.pathsep + env.get("PATH", ""),
                   HUB_CI_POLL="0", HUB_CI_TIMEOUT="0",
                   # `hub land --merge` committet selbst; ohne Identität bricht git mit 128 ab
                   # und der Abbruch sähe wie ein Merge-Konflikt aus.
                   **self.git_identity)
        for k, v in (env_extra or {}).items():
            if v is None:  # None heißt: Variable entfernen, nicht auf leer setzen
                env.pop(k, None)
            else:
                env[k] = v
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True, env=env, cwd=cwd)

    def ticket(self, title, repo, branch="", status="done", app=None, **fields):
        r = self.hub("ticket", "new", "--title", title, "--repo", repo, app=app)
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = r.stdout.strip()
        pairs = [f"branch={branch}", f"status={status}"] + [f"{k}={v}" for k, v in fields.items()]
        r = self.hub("ticket", "set", tid, *pairs, app=app)
        self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def path_of(self, tid, app=None):
        return os.path.join(app or self.app, "data", "quests", "tickets", tid + ".md")

    def text_of(self, tid, app=None):
        with open(self.path_of(tid, app), encoding="utf-8") as f:
            return f.read()

    def own_path(self, repo, branch, root=None):
        return os.path.join(root or self.root_a, os.path.basename(repo), branch.replace("/", "-"))

    # ---- cleanup scope

    def test_cleanup_dry_run_lists_and_changes_nothing(self):
        repo = self.repo("repo-a")
        wt = self.worktree(repo, self.own_path(repo, "feat/own"), "feat/own")
        tid = self.ticket("Own", repo, branch="feat/own", worktree=wt)

        r = self.hub("cleanup", "--root", self.root_a)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isdir(wt), "Dry-Run darf nichts löschen")
        self.assertIn(tid, r.stdout)
        self.assertIn(wt, r.stdout)
        self.assertIn("feat/own", r.stdout)
        self.assertIn(self.root_a, r.stdout, "Dry-Run nennt den Bereich")
        self.assertIn("dry run", r.stdout)

    def test_cleanup_removes_only_this_homes_clean_leftovers(self):
        repo_a = self.repo("repo-a")
        own = self.worktree(repo_a, self.own_path(repo_a, "feat/own"), "feat/own")
        tid = self.ticket("Own", repo_a, branch="feat/own", worktree=own)

        # A checkout under the same root that no ticket of this home derives: never touched.
        orphan = self.worktree(repo_a, self.own_path(repo_a, "feat/orphan"), "feat/orphan")

        # An open ticket's worktree is in use.
        busy_wt = self.worktree(repo_a, self.own_path(repo_a, "feat/open"), "feat/open")
        self.ticket("Open", repo_a, branch="feat/open", status="doing", worktree=busy_wt)

        # A foreign home's ticket and worktree, under this root and under its own root.
        repo_b = self.repo("repo-b")
        foreign_root_a = self.own_path(repo_b, "feat/foreign", self.root_a)
        foreign_a = self.worktree(repo_b, foreign_root_a, "feat/foreign")
        self.ticket("Foreign", repo_b, branch="feat/foreign", worktree=foreign_a, app=self.app_b)
        foreign_root_b = self.own_path(repo_b, "feat/other", self.root_b)
        foreign_b = self.worktree(repo_b, foreign_root_b, "feat/other")
        self.ticket("Other world", repo_b, branch="feat/other", worktree=foreign_b, app=self.app_b)

        r = self.hub("cleanup", "--root", self.root_a, "--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(os.path.exists(own), "eigener Rest muss weg")
        self.assertIn(tid, r.stdout)
        self.assertTrue(os.path.isdir(orphan), "Worktree ohne Ticket bleibt stehen")
        self.assertTrue(os.path.isdir(busy_wt), "Worktree eines offenen Tickets bleibt stehen")
        self.assertIn("Ticket ist doing", r.stdout)
        self.assertTrue(os.path.isdir(foreign_a), "fremdes Ticket im selben Root bleibt stehen")
        self.assertTrue(os.path.isdir(foreign_b), "andere Welt bleibt stehen")

    def test_cleanup_keeps_dirty_worktree_and_reports_it(self):
        repo = self.repo("repo-a")
        wt = self.worktree(repo, self.own_path(repo, "feat/dirty"), "feat/dirty")
        self.ticket("Dirty", repo, branch="feat/dirty", worktree=wt)
        with open(os.path.join(wt, "f.txt"), "a", encoding="utf-8") as f:
            f.write("uncommitted\n")

        r = self.hub("cleanup", "--root", self.root_a, "--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isdir(wt), "Worktree mit Änderungen bleibt stehen")
        self.assertIn(wt, r.stdout)
        self.assertIn("uncommittete Änderungen", r.stdout)

    def test_cleanup_skips_worktree_with_live_terminal_cwd(self):
        repo = self.repo("repo-a")
        wt = self.worktree(repo, self.own_path(repo, "feat/live"), "feat/live")
        self.ticket("Live", repo, branch="feat/live", worktree=wt)
        terminals = json.dumps({"terminals": [{"address": "t1", "state": "live",
                                               "cwd": os.path.join(wt, "sub")}]})

        r = self.hub("cleanup", "--root", self.root_a, "--yes", env_extra={"TEST_HC_JSON": terminals})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isdir(wt), "lebendes Terminal im Worktree schützt ihn")
        self.assertIn("t1", r.stdout)
        self.assertIn("lebt", r.stdout)

    def test_cleanup_default_root_is_the_homes_worktrees(self):
        repo = self.repo("repo-a")
        default_root = os.path.join(self.home, ".herdr", "worktrees")
        wt = self.worktree(repo, os.path.join(default_root, os.path.basename(repo), "feat-default"), "feat/default")
        self.ticket("Default", repo, branch="feat/default", worktree=wt)

        r = self.hub("cleanup", "--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(os.path.exists(wt), "ohne --root gilt $HOME/.herdr/worktrees")

    # ---- CI bound to the commit

    def test_ci_records_ci_head(self):
        repo = self.repo("repo-ci")
        wt = self.worktree(repo, self.own_path(repo, "feat/ci"), "feat/ci")
        tid = self.ticket("Ci Head", repo, branch="feat/ci", status="doing", worktree=wt, pr="1")
        head = self.git("rev-parse", "HEAD", cwd=wt).stdout.strip()

        r = self.hub("ci", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        text = self.text_of(tid)
        self.assertIn(f"ci_head: {head}", text)
        self.assertIn("ci: pass", text)

    def test_land_merge_refuses_red_or_stale_ci(self):
        repo = self.repo("repo-land")
        wt = self.worktree(repo, self.own_path(repo, "feat/land"), "feat/land")
        with open(os.path.join(wt, "f.txt"), "a", encoding="utf-8") as f:
            f.write("work\n")
        self.git("commit", "-q", "-am", "work", cwd=wt)
        start = self.git("rev-parse", "HEAD", cwd=repo).stdout.strip()
        head = self.git("rev-parse", "HEAD", cwd=wt).stdout.strip()
        tid = self.ticket("Land Gate", repo, branch="feat/land", status="review", worktree=wt)

        self.hub("ticket", "set", tid, "ci=fail", f"ci_head={head}")
        r = self.hub("land", tid, "--merge")
        self.assertNotEqual(r.returncode, 0, "rotes CI darf nicht landen")
        self.assertIn("CI rot", r.stderr)
        self.assertEqual(start, self.git("rev-parse", "HEAD", cwd=repo).stdout.strip())

        self.hub("ticket", "set", tid, "ci=unknown", "ci_head=")
        r = self.hub("land", tid, "--merge")
        self.assertNotEqual(r.returncode, 0, "CI ohne HEAD darf nicht landen")
        self.assertIn("noch keine CI gelaufen", r.stderr)
        self.assertIn(f"hub ci {tid}", r.stderr)
        self.assertNotIn("keinen ,", r.stderr)
        self.assertNotIn("keinen Commit", r.stderr)
        self.assertEqual(start, self.git("rev-parse", "HEAD", cwd=repo).stdout.strip())

        self.hub("ticket", "set", tid, "ci=pass", f"ci_head={start}")
        r = self.hub("land", tid, "--merge")
        self.assertNotEqual(r.returncode, 0, "CI eines anderen Commits darf nicht landen")
        self.assertIn("gilt für", r.stderr)
        self.assertEqual(start, self.git("rev-parse", "HEAD", cwd=repo).stdout.strip())

        self.hub("ticket", "set", tid, f"ci_head={head}")
        r = self.hub("land", tid, "--merge")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("merged", r.stdout)
        self.assertNotEqual(start, self.git("rev-parse", "HEAD", cwd=repo).stdout.strip())
        self.assertFalse(os.path.exists(wt), "land entfernt nur den eigenen Worktree")

    def test_land_merge_names_missing_git_identity(self):
        """Ohne git-Identität bricht `git merge` mit 128 ab. Das darf nicht als
        Merge-Konflikt gelesen werden — sonst rebased ein Agent endlos gegen nichts."""
        repo = self.repo("repo-ident")
        wt = self.worktree(repo, self.own_path(repo, "feat/ident"), "feat/ident")
        with open(os.path.join(wt, "f.txt"), "a", encoding="utf-8") as f:
            f.write("work\n")
        self.git("commit", "-q", "-am", "work", cwd=wt)
        tid = self.ticket("Ident", repo, branch="feat/ident", status="review", worktree=wt)
        r = self.hub("land", tid, "--merge", env_extra={k: None for k in self.git_identity})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Identität", r.stderr)
        self.assertNotIn("merge conflict", r.stderr)

    def test_land_merge_force_needs_reason_and_lands(self):
        repo = self.repo("repo-force")
        wt = self.worktree(repo, self.own_path(repo, "feat/force"), "feat/force")
        with open(os.path.join(wt, "f.txt"), "a", encoding="utf-8") as f:
            f.write("work\n")
        self.git("commit", "-q", "-am", "work", cwd=wt)
        tid = self.ticket("Force Gate", repo, branch="feat/force", status="review", worktree=wt, ci="fail")

        r = self.hub("land", tid, "--merge", "--force")
        self.assertNotEqual(r.returncode, 0, "--force ohne --reason verweigert")
        self.assertIn("--reason", r.stderr)

        r = self.hub("land", tid, "--merge", "--force", "--reason", "CI defekt, Merge bewusst")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("merged", r.stdout)
        self.assertIn("CI-Gate überfahren", self.text_of(tid))


if __name__ == "__main__":
    unittest.main(verbosity=2)
