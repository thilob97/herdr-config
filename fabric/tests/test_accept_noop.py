"""Abnahme ohne Änderung: 0 Commits über der Basis schließen lokal ab."""
import json
import os
import subprocess
from unittest import mock

from fabric.fablib import autopilot, store
from fabric.tests.support import FabricCase

URL = "https://github.com/test/repo/pull/7"

STUB_GH = '''#!/usr/bin/env python3
"""gh-Stub: `pr view` liefert den gesetzten PR-Zustand als JSON."""
import json
import os
import sys

args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    sys.exit(1 if os.environ.get("GH_AUTH_FAIL") else 0)
if args[:2] == ["pr", "view"]:
    if os.environ.get("GH_VIEW_FAIL"):
        print("PR-Ansicht nicht verfügbar", file=sys.stderr)
        sys.exit(1)
    state_file = os.environ.get("GH_STATE")
    state = "OPEN"
    if state_file and os.path.isfile(state_file):
        with open(state_file, encoding="utf-8") as handle:
            state = handle.read().strip() or "OPEN"
    if "state,number,mergeCommit" in args:
        commit = os.environ.get("GH_COMMIT") or ""
        print(json.dumps({
            "state": state,
            "number": 7,
            "mergeCommit": {"oid": commit} if commit else None,
        }))
        sys.exit(0)
    if args[-1] == ".url":
        print("https://github.com/test/repo/pull/7")
        sys.exit(0)
    if args[-1] == ".state":
        print(state)
        sys.exit(0)
sys.exit(0)
'''


class AcceptNoopTests(FabricCase):
    def setUp(self):
        super().setUp()
        self.gh_state = os.path.join(self.tmp, "gh.state")
        self.write_file(self.gh_state, "")
        stub = os.path.join(self.bin, "gh")
        self.write_file(stub, STUB_GH)
        os.chmod(stub, 0o755)

    def setup_origin(self, repo):
        bare = os.path.join(self.tmp, "origin.git")
        subprocess.run(["git", "init", "--bare", "-q", bare], check=True)
        self.git_out(repo, "remote", "add", "origin", "https://github.com/test/repo.git")
        self.git_out(
            repo, "config", f"url.{bare}.insteadOf", "https://github.com/test/repo.git"
        )
        self.git_out(repo, "push", "-q", "origin", "main")
        return bare

    def pr_env(self, commit=""):
        return {"GH_STATE": self.gh_state, "GH_COMMIT": commit}

    def test_handover_verweigert_no_change_mit_uncommitteten_aenderungen(self):
        _repo, tid, worktree = self.ready_ticket()
        self.write_file(os.path.join(worktree, "README.md"), "geändert\n")

        result = self.cli("handover", tid, "--from", "zap", "Keine Änderung nötig")

        self.assertNotEqual(result.returncode, 0, result.stdout)
        out = result.stdout + result.stderr
        self.assertIn("uncommittete Änderungen", out)
        self.assertIn("committen", out)
        ticket = self.ticket(tid)
        self.assertNotIn("no_change", ticket)
        self.assertEqual(ticket["status"], "doing")

    def test_handover_ohne_commits_setzt_no_change(self):
        _repo, tid, _worktree = self.ready_ticket()
        self.ok("handover", tid, "--from", "zap", "Keine Änderung nötig")

        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertTrue(ticket.get("no_change"))
        texts = [comment["text"] for comment in ticket.get("comments") or []]
        self.assertTrue(
            any("ohne Änderung" in text for text in texts), texts
        )
        self.assertIn("ohne Änderung", self.ok("show", tid).stdout)

    def test_revision_ignoriert_kommentare_und_zaehlt_felder(self):
        _repo, tid, _worktree = self.ready_ticket()
        with self.store_env():
            ticket = store.load(tid)
            first = store.revision(ticket)
            self.assertRegex(first, r"^[0-9a-f]{64}$")

            with_comment = json.loads(json.dumps(ticket))
            with_comment.setdefault("comments", []).append(
                {"at": 1, "author": "ada", "text": "dazwischen"}
            )
            with_comment["updated_at"] = 123
            with_comment["cost"] = {"tokens": 1}
            with_comment["waits"] = [{"at": 2}]
            self.assertEqual(first, store.revision(with_comment))

            for field, value in (
                ("status", "done"),
                ("branch", "fab/T-1-anderer-branch"),
                ("assignee", "ada"),
                ("title", "Anderer Titel"),
            ):
                changed = json.loads(json.dumps(with_comment))
                changed[field] = value
                self.assertNotEqual(first, store.revision(changed), field)

    def test_accept_ohne_commits_schliesst_lokal_ohne_merge(self):
        repo, tid, worktree = self.ready_ticket()
        self.ok("handover", tid, "--from", "zap", "Keine Änderung nötig")
        main_head = self.git_out(repo, "rev-parse", "HEAD")
        # Liegengebliebene Vorschau des Tickets: verschwindet mit der Abnahme.
        previews = os.path.join(self.tmp, "previews")
        preview_dir = os.path.join(previews, tid)
        os.makedirs(os.path.join(preview_dir, "home"))
        mark = self.mark()

        result = self.ok("accept", tid, env={"FAB_PREVIEW_ROOT": previews})
        self.assertFalse(os.path.exists(preview_dir))

        self.assertIn("ohne Änderung abgeschlossen", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertTrue(ticket.get("no_change"))
        self.assertEqual(ticket["waiting"], [])
        self.assertNotIn("pr", ticket)
        self.assertNotIn("merge", ticket)
        self.assertEqual(self.git_out(repo, "rev-parse", "HEAD"), main_head)
        self.assertFalse(os.path.exists(worktree))
        self.assertEqual(
            self.git_out(repo, "branch", "--list", ticket["branch"]), ""
        )

        noop = self.events_since(mark, "accept_noop")
        self.assertEqual(len(noop), 1)
        self.assertIn("ohne Änderung abgeschlossen", noop[0]["text"])
        self.assertEqual(self.events_since(mark, "accept"), [])
        texts = [comment["text"] for comment in ticket.get("comments") or []]
        self.assertTrue(
            any("ohne Änderung abgeschlossen" in text for text in texts), texts
        )
        self.assertNotEqual(ticket["status"], "dropped")
        self.assertNotIn("dropped", [row["kind"] for row in self.events()])

    def test_noop_braucht_einen_existierenden_branch(self):
        repo, tid, worktree = self.ready_ticket()
        self.ok("handover", tid, "--from", "zap", "Keine Änderung nötig")
        branch = self.ticket(tid)["branch"]
        self.git_out(repo, "worktree", "remove", "--force", worktree)
        self.git_out(repo, "branch", "-D", branch)

        result = self.cli("accept", tid)

        self.assertNotEqual(result.returncode, 0)
        out = result.stdout + result.stderr
        self.assertIn("existiert nicht", out)
        self.assertIn("kein PR ist gemergt", out)
        self.assertNotIn("ohne Änderung abgeschlossen", out)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertFalse(os.path.exists(worktree))

    def test_gemergter_pr_ist_kein_noop(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("handover", tid, "--from", "zap", "fertig")
        head = self.git_out(worktree, "rev-parse", "HEAD")
        self.setup_origin(repo)
        self.patch_ticket(
            tid, pr={"url": URL, "state": "merged", "commit": head}
        )
        self.write_file(self.gh_state, "MERGED")

        result = self.ok("accept", tid, env=self.pr_env(head))

        self.assertNotIn("ohne Änderung abgeschlossen", result.stdout)
        self.assertIn("über PR", result.stdout)
        self.assertIn(URL, result.stdout)
        self.assertEqual(self.ticket(tid)["status"], "done")

    def test_t115_ohne_branch_meldet_nicht_ohne_aenderung(self):
        repo, tid, worktree = self.ready_ticket()
        self.ok("handover", tid, "--from", "zap", "Keine Änderung nötig")
        branch = self.ticket(tid)["branch"]
        head = self.git_out(worktree, "rev-parse", "HEAD")
        self.setup_origin(repo)
        self.git_out(repo, "worktree", "remove", "--force", worktree)
        self.git_out(repo, "branch", "-D", branch)
        self.patch_ticket(tid, pr={"url": URL, "state": "open"})
        self.write_file(self.gh_state, "MERGED")

        result = self.ok("accept", tid, env=self.pr_env(head))

        out = result.stdout + result.stderr
        self.assertIn("über PR", out)
        self.assertNotIn("ohne Änderung", out)
        self.assertNotIn("unknown revision", out)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertFalse(os.path.exists(worktree))

    def test_mit_commits_bleibt_normaler_merge(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")

        ticket = self.ticket(tid)
        self.assertNotIn("no_change", ticket)

        self.ok("accept", tid)

        parents = self.git_out(
            repo, "rev-list", "--parents", "-n", "1", "HEAD"
        ).split()
        self.assertEqual(len(parents), 3)
        self.assertEqual(
            self.git(repo, "cat-file", "-e", "HEAD:aenderung.txt").returncode, 0
        )
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertNotIn("no_change", ticket)
        self.assertNotEqual(ticket["status"], "dropped")

    def test_autopilot_nimmt_ohne_aenderung_genau_einmal_ab(self):
        _repo, tid, _worktree = self.ready_ticket()
        self.ok("handover", tid, "--from", "zap", "Keine Änderung nötig")

        autopilot.reset()
        self.addCleanup(autopilot.reset)
        env = self.store_env()
        env.start()
        self.addCleanup(env.stop)
        accept_calls = []

        def fake_sh(*args, **kwargs):
            if args[:2] == ("fab", "accept"):
                accept_calls.append(args)
                result = self.cli(*args[1:])
                return (
                    result.returncode,
                    (result.stdout + result.stderr).strip(),
                )
            return 0, ""

        with mock.patch.object(autopilot, "ticket_ids", return_value=[tid]), \
                mock.patch.object(
                    autopilot, "fab_json",
                    side_effect=lambda *args, **kwargs: self.ticket(tid),
                ), \
                mock.patch.object(autopilot, "_sh", side_effect=fake_sh), \
                mock.patch.object(
                    autopilot, "ensure_clean_main", return_value=True
                ), \
                mock.patch.object(
                    autopilot, "check_main", return_value=(True, "", "", 0, "")
                ), \
                mock.patch.object(autopilot, "write_state"):
            autopilot.once()
            autopilot.once()

        self.assertEqual(len(accept_calls), 1)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertNotEqual(ticket["status"], "dropped")


class CloseTests(FabricCase):
    def test_close_schliesst_ticket_ab_dessen_arbeit_auf_main_liegt(self):
        repo = self.default_repo()
        tid = self.ok("new", "Direkt auf main", "--repo", repo, "--no-wake").stdout.strip().splitlines()[-1]
        self.patch_ticket(tid, status="todo", assignee="zap")
        self._write(os.path.join(repo, "direkt.txt"), "fertig\n")
        self.git(repo, "add", "direkt.txt")
        self.git(repo, "commit", "-qm", "direkt auf main")
        commit = self.git_out(repo, "rev-parse", "HEAD")

        result = self.ok("close", tid, "--commit", commit, "--note", "ohne Branch")

        self.assertIn("abgeschlossen", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertTrue(any(commit[:7] in c["text"] and "ohne Branch" in c["text"]
                            for c in ticket["comments"]))

    def test_close_verweigert_commit_der_nicht_auf_main_liegt(self):
        repo = self.default_repo()
        tid = self.ok("new", "Fremd", "--repo", repo, "--no-wake").stdout.strip().splitlines()[-1]
        self.git(repo, "checkout", "-qb", "seitenzweig")
        self._write(os.path.join(repo, "seite.txt"), "x\n")
        self.git(repo, "add", "seite.txt")
        self.git(repo, "commit", "-qm", "seitenzweig")
        commit = self.git_out(repo, "rev-parse", "HEAD")
        self.git(repo, "checkout", "-q", "main")

        result = self.cli("close", tid, "--commit", commit)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("liegt nicht auf main", result.stderr)
        self.assertNotEqual(self.ticket(tid)["status"], "done")
