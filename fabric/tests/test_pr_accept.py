"""Abnahme per GitHub-PR: `fab accept` mit und ohne `--pr-only`."""
import json
import os
import shutil
import subprocess

from fabric.tests.support import FabricCase

STUB_GH = '''#!/usr/bin/env python3
"""gh-Stub: protokolliert Aufrufe und spielt PR-Zustand."""
import json
import os
import subprocess
import sys

args = sys.argv[1:]
log = os.environ.get("GH_LOG")
if log:
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(args) + "\\n")

URL = "https://github.com/test/repo/pull/7"
state_file = os.environ.get("GH_STATE")


def read_state():
    if state_file and os.path.isfile(state_file):
        with open(state_file, encoding="utf-8") as handle:
            return handle.read().strip()
    return ""


def write_state(value):
    if state_file:
        with open(state_file, "w", encoding="utf-8") as handle:
            handle.write(value)


if args[:2] == ["auth", "status"]:
    sys.exit(1 if os.environ.get("GH_AUTH_FAIL") else 0)

if args[:2] == ["pr", "view"]:
    state = read_state()
    if not state:
        print("no pull requests found", file=sys.stderr)
        sys.exit(1)
    if args[-1] == ".url":
        print(URL)
    elif args[-1] == ".state":
        print(state)
    else:
        sys.exit(1)
    sys.exit(0)

if args[:2] == ["pr", "create"]:
    if os.environ.get("GH_CREATE_FAIL"):
        print("create abgelehnt", file=sys.stderr)
        sys.exit(1)
    write_state("OPEN")
    print(URL)
    sys.exit(0)

if args[:2] == ["pr", "merge"]:
    if os.environ.get("GH_MERGE_FAIL"):
        print("merge abgelehnt", file=sys.stderr)
        sys.exit(1)
    write_state("MERGED")
    bare = os.environ.get("GH_BARE")
    head = os.environ.get("GH_HEAD")
    if bare and head:
        sha = subprocess.run(
            ["git", "--git-dir", bare, "rev-parse", f"refs/heads/{head}"],
            capture_output=True, text=True,
        )
        if sha.returncode == 0 and os.environ.get("GH_MERGE_COMMIT"):
            base = subprocess.run(
                ["git", "--git-dir", bare, "rev-parse", "refs/heads/main"],
                capture_output=True, text=True,
            )
            tree = subprocess.run(
                [
                    "git", "--git-dir", bare, "merge-tree", "--write-tree",
                    base.stdout.strip(), sha.stdout.strip(),
                ],
                capture_output=True, text=True,
            )
            if base.returncode == 0 and tree.returncode == 0:
                tree_sha = (tree.stdout.strip().splitlines() or [""])[0]
                commit = subprocess.run(
                    [
                        "git", "--git-dir", bare,
                        "-c", "user.name=Test", "-c", "user.email=test@example.com",
                        "commit-tree", tree_sha,
                        "-p", base.stdout.strip(),
                        "-p", sha.stdout.strip(),
                        "-m", "Merge PR",
                    ],
                    capture_output=True, text=True,
                )
                if commit.returncode == 0:
                    subprocess.run(
                        ["git", "--git-dir", bare, "update-ref",
                         "refs/heads/main", commit.stdout.strip()],
                        check=False,
                    )
        elif sha.returncode == 0:
            subprocess.run(
                ["git", "--git-dir", bare, "update-ref",
                 "refs/heads/main", sha.stdout.strip()],
                check=False,
            )
    print("merged")
    sys.exit(0)

sys.exit(0)
'''

URL = "https://github.com/test/repo/pull/7"
BRANCH = "fab/T-1-kurzer-titel"


class PrAcceptTests(FabricCase):
    def setUp(self):
        super().setUp()
        self.gh_log = os.path.join(self.tmp, "gh.log")
        self.gh_state = os.path.join(self.tmp, "gh.state")
        self.write_file(self.gh_log, "")
        stub = os.path.join(self.bin, "gh")
        self.write_file(stub, STUB_GH)
        os.chmod(stub, 0o755)

    def review_ticket(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        return repo, tid, worktree

    def add_git_shim(self):
        """`git branch -D` einmalig scheitern lassen, alles andere durchreichen."""
        real_git = shutil.which("git")
        self.assertTrue(real_git, "git nicht gefunden")
        shim = os.path.join(self.bin, "git")
        self.write_file(
            shim,
            "#!/bin/sh\n"
            'if [ "$1" = "branch" ] && [ "$2" = "-D" ] '
            '&& [ -n "${GIT_FAIL_BRANCH_DELETE:-}" ]; then\n'
            '  echo "Branch kann nicht gelöscht werden" >&2\n'
            "  exit 1\n"
            "fi\n"
            f'exec "{real_git}" "$@"\n',
        )
        os.chmod(shim, 0o755)
        return shim

    def setup_origin(self, repo, push_main=True):
        bare = os.path.join(self.tmp, "origin.git")
        subprocess.run(["git", "init", "--bare", "-q", bare], check=True)
        self.git(bare, "config", "receive.denyNonFastForwards", "true")
        self.git_out(repo, "remote", "add", "origin", "https://github.com/test/repo.git")
        self.git_out(
            repo, "config", f"url.{bare}.insteadOf", "https://github.com/test/repo.git"
        )
        if push_main:
            self.git_out(repo, "push", "-q", "origin", "main")
        return bare

    def gh_env(self, bare="", **extra):
        env = {
            "GH_LOG": self.gh_log,
            "GH_STATE": self.gh_state,
            "GH_BARE": bare,
            "GH_HEAD": BRANCH,
        }
        env.update(extra)
        return env

    def gh_calls(self):
        return [
            json.loads(line)
            for line in self._read(self.gh_log).splitlines()
            if line.strip()
        ]

    def bare_branch(self, bare, name):
        return (
            self.git(bare, "rev-parse", "--verify", f"refs/heads/{name}").returncode == 0
        )

    def test_accept_oeffnet_und_mergt_pr(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo)
        branch_head = self.git_out(worktree, "rev-parse", "HEAD")
        result = self.ok("accept", tid, env=self.gh_env(bare))
        self.assertIn(URL, result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertEqual(ticket["pr"]["url"], URL)
        self.assertEqual(ticket["pr"]["state"], "merged")
        self.assertRegex(ticket["pr"]["commit"], r"^[0-9a-f]{40}$")
        self.assertEqual(ticket["waiting"], [])
        self.assertFalse(os.path.exists(worktree))
        self.assertEqual(
            self.git_out(repo, "branch", "--list", BRANCH), ""
        )
        self.assertFalse(self.bare_branch(bare, BRANCH))
        self.assertEqual(self.git_out(repo, "rev-parse", "HEAD"), branch_head)
        texts = [comment["text"] for comment in ticket["comments"]]
        self.assertTrue(any(URL in text for text in texts), texts)
        pr_rows = [row for row in self.events() if row["kind"] == "pr"]
        self.assertTrue(pr_rows)
        self.assertIn(URL, pr_rows[-1]["text"])
        accept_rows = [row for row in self.events() if row["kind"] == "accept"]
        self.assertIn(URL, accept_rows[-1]["text"])

    def test_accept_ohne_commits_oeffnet_keinen_pr(self):
        repo, tid, worktree = self.ready_ticket()
        bare = self.setup_origin(repo)
        main_before = self.git_out(repo, "rev-parse", "HEAD")
        self.ok("handover", tid, "--from", "zap", "Nur Begründung")
        mark = self.mark()

        result = self.ok("accept", tid, env=self.gh_env(bare))

        self.assertNotIn(URL, result.stdout)
        creates = [
            call for call in self.gh_calls() if call[:2] == ["pr", "create"]
        ]
        self.assertEqual(creates, [])
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertTrue(ticket.get("no_change"))
        self.assertNotIn("pr", ticket)
        self.assertEqual(self.git_out(repo, "rev-parse", "HEAD"), main_before)
        self.assertFalse(os.path.exists(worktree))
        self.assertEqual(self.git_out(repo, "branch", "--list", BRANCH), "")
        self.assertFalse(self.bare_branch(bare, BRANCH))
        noop = self.events_since(mark, "accept_noop")
        self.assertEqual(len(noop), 1)
        self.assertIn("ohne Änderung abgeschlossen", noop[0]["text"])
        texts = [comment["text"] for comment in ticket.get("comments") or []]
        self.assertTrue(
            any("ohne Änderung abgeschlossen" in text for text in texts), texts
        )

    def test_accept_nach_gemergtem_pr_haengt_bei_geloeschtem_branch(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo)
        self.add_git_shim()

        result = self.cli(
            "accept", tid, env=self.gh_env(bare, GIT_FAIL_BRANCH_DELETE="1")
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("konnte nicht gelöscht werden", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertEqual(ticket["pr"]["url"], URL)
        self.assertEqual(ticket["pr"]["state"], "merged")
        self.assertRegex(ticket["pr"]["commit"], r"^[0-9a-f]{40}$")
        self.assertFalse(os.path.exists(worktree))
        self.assertNotEqual(self.git_out(repo, "branch", "--list", BRANCH), "")
        texts = [comment["text"] for comment in ticket["comments"]]
        self.assertTrue(
            any("PR gemergt, Aufräumen unvollständig" in text for text in texts), texts
        )

        merges_before = [
            call for call in self.gh_calls() if call[:2] == ["pr", "merge"]
        ]
        second = self.ok("accept", tid, env=self.gh_env(bare))
        self.assertNotIn("nicht lesbar", second.stderr)
        self.assertIn("angenommen", second.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertEqual(ticket["pr"]["url"], URL)
        self.assertEqual(ticket["pr"]["state"], "merged")
        self.assertRegex(ticket["pr"]["commit"], r"^[0-9a-f]{40}$")
        self.assertEqual(self.git_out(repo, "branch", "--list", BRANCH), "")
        self.assertFalse(os.path.exists(worktree))
        merges_after = [
            call for call in self.gh_calls() if call[:2] == ["pr", "merge"]
        ]
        self.assertEqual(merges_after, merges_before)

    def test_wiederholung_scheitert_erneut_beim_aufraeumen(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo)
        self.add_git_shim()

        first = self.cli(
            "accept", tid, env=self.gh_env(bare, GIT_FAIL_BRANCH_DELETE="1")
        )
        self.assertEqual(first.returncode, 1)
        second = self.cli(
            "accept", tid, env=self.gh_env(bare, GIT_FAIL_BRANCH_DELETE="1")
        )

        self.assertNotEqual(second.returncode, 0)
        self.assertIn("konnte nicht gelöscht werden", second.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertEqual(ticket["pr"]["state"], "merged")
        texts = [comment["text"] for comment in ticket["comments"]]
        failures = [
            text for text in texts if "PR gemergt, Aufräumen unvollständig" in text
        ]
        self.assertEqual(len(failures), 2, texts)
        pr_rows = [row for row in self.events() if row["kind"] == "pr"]
        self.assertIn("Aufräumen unvollständig", pr_rows[-1]["text"])

    def test_wiederholung_meldet_den_merge_commit(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo)
        self.add_git_shim()

        first = self.cli(
            "accept", tid,
            env=self.gh_env(bare, GIT_FAIL_BRANCH_DELETE="1", GH_MERGE_COMMIT="1"),
        )
        self.assertEqual(first.returncode, 1)
        merge_commit = self.git_out(bare, "rev-parse", "refs/heads/main")
        self.commit_in(repo, "spaeter.txt", "main läuft weiter\n")
        local_head = self.git_out(repo, "rev-parse", "HEAD")
        self.assertNotEqual(local_head, merge_commit)

        second = self.ok("accept", tid, env=self.gh_env(bare))

        self.assertIn(merge_commit[:7], second.stdout)
        self.assertNotIn(local_head[:7], second.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertEqual(ticket["pr"]["commit"], merge_commit)
        accept_rows = [row for row in self.events() if row["kind"] == "accept"]
        self.assertIn(merge_commit[:7], accept_rows[-1]["text"])

    def test_erster_lauf_pusht_basis_nach_origin(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo, push_main=False)
        self.assertFalse(self.bare_branch(bare, "main"))
        result = self.ok("accept", tid, env=self.gh_env(bare))
        self.assertIn(URL, result.stdout)
        self.assertTrue(self.bare_branch(bare, "main"))
        self.assertEqual(self.ticket(tid)["status"], "done")

    def test_pr_traegt_handover_checks_urteil_und_ticket(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo)
        self.ok("accept", tid, env=self.gh_env(bare))
        create = next(
            call for call in self.gh_calls() if call[:2] == ["pr", "create"]
        )
        self.assertIn("T-1: Kurzer Titel", create)
        body = create[create.index("--body") + 1]
        self.assertIn("Fertig", body)
        self.assertIn("## Checks", body)
        self.assertIn("## Urteil", body)
        self.assertIn("Ticket: T-1", body)
        self.assertIn("fab/T-1-kurzer-titel → main", body)

    def test_pr_body_closes_verknuepftes_issue(self):
        repo, tid, worktree = self.review_ticket()
        self.patch_ticket(
            tid,
            issue={
                "number": 12,
                "url": "https://github.com/test/repo/issues/12",
                "title": "Knopf defekt",
            },
        )
        bare = self.setup_origin(repo)
        self.ok("accept", tid, env=self.gh_env(bare))
        create = next(
            call for call in self.gh_calls() if call[:2] == ["pr", "create"]
        )
        body = create[create.index("--body") + 1]
        self.assertIn("Closes #12", body)

    def test_merge_fehlschlag_laesst_ticket_in_review(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo)
        result = self.cli(
            "accept", tid, env=self.gh_env(bare, GH_MERGE_FAIL="1")
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("PR-Merge ist fehlgeschlagen", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertEqual(ticket["pr"], {"url": URL, "state": "open"})
        self.assertTrue(os.path.isdir(worktree))
        self.assertTrue(self.bare_branch(bare, BRANCH))
        texts = [comment["text"] for comment in ticket["comments"]]
        self.assertTrue(
            any("pull/7" in text and "merge abgelehnt" in text for text in texts), texts
        )
        pr_rows = [row for row in self.events() if row["kind"] == "pr"]
        self.assertIn("pull/7", pr_rows[-1]["text"])
        self.assertIn("merge abgelehnt", pr_rows[-1]["text"])

    def test_accept_rot_setzt_pr_merge_zurueck(self):
        repo, tid, worktree = self.review_ticket()
        self.write_file(
            os.path.join(worktree, "mods", "demo", "main.js"), "export default {}\n"
        )
        self.write_file(os.path.join(worktree, "mods", "demo", "mod.json"), "{}\n")
        self.write_file(
            os.path.join(worktree, "mods", "demo", "test", "demo.test.mjs"),
            "// Test für die Logik\n",
        )
        self.git_out(worktree, "add", "mods")
        commit = self.git(worktree, "commit", "-qm", "mods")
        self.assertEqual(commit.returncode, 0, commit.stderr)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Nachtrag geprüft")
        self.ok("handover", tid, "--from", "zap", "Nachtrag")
        bare = self.setup_origin(repo)

        result = self.cli(
            "accept",
            tid,
            env=self.gh_env(bare, HERDR_APP_FAIL="1", GH_MERGE_COMMIT="1"),
        )
        self.assertNotEqual(result.returncode, 0)

        self.assertEqual(self.ticket(tid)["status"], "review")
        self.assertTrue(os.path.isdir(worktree))
        self.assertTrue(self.bare_branch(bare, BRANCH))
        self.assertTrue(self.git_out(repo, "branch", "--list", BRANCH))
        self.assertNotEqual(
            self.git(bare, "cat-file", "-e", "refs/heads/main:aenderung.txt").returncode,
            0,
        )

        rows = json.loads(self.ok("inbox", "--json").stdout)
        attention = [
            row
            for row in rows
            if row.get("kind") == "attention" and row.get("ticket") == tid
        ]
        self.assertEqual(len(attention), 1, rows)
        self.assertTrue(attention[0]["text"].startswith("Merge zurückgesetzt:"))
        self.assertIn("kein Fenster", attention[0]["text"])

    def test_ohne_gh_anmeldung_lokaler_merge(self):
        repo, tid, worktree = self.review_ticket()
        self.setup_origin(repo)
        result = self.ok("accept", tid, env=self.gh_env(GH_AUTH_FAIL="1"))
        self.assertIn("angenommen", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertNotIn("pr", ticket)
        self.assertFalse(
            [call for call in self.gh_calls() if call[:2] == ["pr", "create"]]
        )

    def test_accept_weckt_orchestrator_mit_pruefer_hinweisen(self):
        repo, tid, worktree = self.review_ticket()
        self.ok(
            "comment", tid, "--from", "ada",
            "hinweis fabric/fablib/store.py:596 — Hinweis eins",
        )
        self.ok(
            "comment", tid, "--from", "ada",
            "hinweis fabric/tests/test_sqlite.py:261 — Hinweis zwei",
        )
        mark = self.mark()
        self.clear_log()

        result = self.ok("accept", tid)

        self.assertIn("angenommen", result.stdout)
        self.assertEqual(self.ticket(tid)["status"], "done")
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1, sends)
        text = sends[0][2]
        self.assertIn("store.py:596", text)
        self.assertIn("test_sqlite.py:261", text)
        self.assertIn(tid, text)
        wakes = [
            row
            for row in self.wake_since(mark, tid)
            if row["target"] == "orchestrator"
        ]
        self.assertEqual(len(wakes), 1, wakes)

    def test_accept_ohne_pruefer_hinweis_weckt_orchestrator_nicht(self):
        repo, tid, worktree = self.review_ticket()
        self.ok(
            "comment", tid, "--from", "ada",
            "blocker fabric/fablib/store.py:596 — das ist blockierend",
        )
        mark = self.mark()
        self.clear_log()

        result = self.ok("accept", tid)

        self.assertIn("angenommen", result.stdout)
        self.assertEqual(self.ticket(tid)["status"], "done")
        self.assertEqual(self.hc_calls("send"), [])
        self.assertEqual(
            [
                row
                for row in self.wake_since(mark, tid)
                if row["target"] == "orchestrator"
            ],
            [],
        )

    def test_lokaler_accept_prueft_die_lokale_basis_trotz_origin(self):
        repo, tid, worktree = self.review_ticket()
        recorded = self.ticket(tid)["merge"]["tree"]
        bare = self.setup_origin(repo)
        clone = os.path.join(self.tmp, "clone-lokal")
        subprocess.run(["git", "clone", "-q", bare, clone], check=True)
        self.git(clone, "config", "user.email", "test@example.com")
        self.git(clone, "config", "user.name", "Test")
        self.write_file(os.path.join(clone, "nur-origin.txt"), "origin\n")
        self.git_out(clone, "add", "nur-origin.txt")
        self.git_out(clone, "commit", "-qm", "origin läuft weiter")
        self.git_out(clone, "push", "-q", "origin", "main")

        result = self.ok("accept", tid, env=self.gh_env(GH_AUTH_FAIL="1"))

        self.assertIn("angenommen", result.stdout)
        self.assertEqual(self.ticket(tid)["status"], "done")
        self.assertEqual(self.git_out(repo, "rev-parse", "main^{tree}"), recorded)
        self.assertFalse(
            [call for call in self.gh_calls() if call[:2] == ["pr", "create"]]
        )

    def test_pr_accept_prueft_die_lokale_basis_vor_origin(self):
        repo, tid, worktree = self.ready_ticket()
        bare = self.setup_origin(repo)
        self.write_file(os.path.join(repo, "chore.txt"), "nur lokal\n")
        self.git_out(repo, "add", "chore.txt")
        self.git_out(repo, "commit", "-qm", "chore: lokal noch nicht gepusht")
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("handover", tid, "--from", "zap", "fertig")

        result = self.ok("accept", tid, env=self.gh_env(bare, GH_MERGE_COMMIT="1"))

        self.assertIn(URL, result.stdout)
        self.assertEqual(self.ticket(tid)["status"], "done")
        self.assertEqual(
            self.git(bare, "cat-file", "-e", "refs/heads/main:chore.txt").returncode,
            0,
        )

    def test_pr_accept_verweigert_neuen_merge_tree(self):
        repo, tid, worktree = self.review_ticket()
        old_tree = self.ticket(tid)["merge"]["tree"]
        bare = self.setup_origin(repo)
        self.write_file(os.path.join(repo, "fremd.txt"), "fremd\n")
        self.git_out(repo, "add", "fremd.txt")
        self.git_out(repo, "commit", "-qm", "main läuft weiter")
        self.git_out(repo, "push", "-q", "origin", "main")
        self.set_live({"fab-ada-t-1": "t1"})
        self.clear_log()
        mark = self.mark()

        result = self.cli("accept", tid, env=self.gh_env(bare))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Stand", result.stderr)
        self.assertIn("nicht abgenommen", result.stderr)
        self.assertFalse(
            [call for call in self.gh_calls() if call[:2] == ["pr", "merge"]]
        )
        self.assertFalse(
            [call for call in self.gh_calls() if call[:2] == ["pr", "create"]]
        )
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertIsNone(ticket.get("verdict"))
        self.assertNotEqual(ticket["merge"]["tree"], old_tree)
        self.assertEqual(ticket["merge"]["state"], "pass")
        self.assertEqual(
            [row["target"] for row in self.wake_since(mark, tid)], ["ada"]
        )
        self.assertFalse(self.bare_branch(bare, BRANCH))
        self.assertTrue(os.path.isdir(worktree))

    def test_nicht_fast_forward_basis_bricht_ab(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo)
        clone = os.path.join(self.tmp, "clone")
        subprocess.run(["git", "clone", "-q", bare, clone], check=True)
        self.git(clone, "config", "user.email", "test@example.com")
        self.git(clone, "config", "user.name", "Test")
        self.write_file(os.path.join(clone, "fremd.txt"), "fremd\n")
        self.git_out(clone, "add", "fremd.txt")
        self.git_out(clone, "commit", "-qm", "fremder commit")
        self.git_out(clone, "push", "-q", "origin", "main")
        result = self.cli("accept", tid, env=self.gh_env(bare))
        self.assertEqual(result.returncode, 1)
        self.assertIn("fast-forward", result.stderr)
        self.assertFalse(self.bare_branch(bare, BRANCH))
        self.assertEqual(self.ticket(tid)["status"], "review")
        self.assertTrue(os.path.isdir(worktree))

    def test_pr_only_oeffnet_nur_den_pr(self):
        repo, tid, worktree = self.review_ticket()
        bare = self.setup_origin(repo)
        main_before = self.git_out(bare, "rev-parse", "refs/heads/main")
        result = self.ok("accept", tid, "--pr-only", env=self.gh_env(bare))
        self.assertIn(URL, result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertEqual(ticket["pr"], {"url": URL, "state": "open"})
        self.assertTrue(self.bare_branch(bare, BRANCH))
        self.assertEqual(
            self.git_out(bare, "rev-parse", "refs/heads/main"), main_before
        )
        self.assertTrue(os.path.isdir(worktree))
        texts = [comment["text"] for comment in ticket["comments"]]
        self.assertTrue(any(URL in text for text in texts), texts)
        pr_rows = [row for row in self.events() if row["kind"] == "pr"]
        self.assertIn(URL, pr_rows[-1]["text"])

    def test_pr_only_ohne_github_remote_bricht_ab(self):
        repo, tid, worktree = self.review_ticket()
        result = self.cli("accept", tid, "--pr-only", env=self.gh_env())
        self.assertEqual(result.returncode, 1)
        self.assertIn("--pr-only", result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "review")

    def test_ohne_github_remote_lokaler_merge(self):
        repo, tid, worktree = self.review_ticket()
        bare = os.path.join(self.tmp, "origin.git")
        subprocess.run(["git", "init", "--bare", "-q", bare], check=True)
        self.git_out(repo, "remote", "add", "origin", bare)
        result = self.ok("accept", tid, env=self.gh_env())
        self.assertIn("angenommen", result.stdout)
        self.assertNotIn("bleibt offen", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertNotIn("pr", ticket)
        self.assertFalse(os.path.exists(worktree))

    def test_lokaler_merge_meldet_offenes_issue(self):
        repo, tid, worktree = self.review_ticket()
        self.patch_ticket(
            tid,
            issue={
                "number": 12,
                "url": "https://github.com/test/repo/issues/12",
                "title": "Knopf defekt",
            },
        )
        bare = os.path.join(self.tmp, "origin.git")
        subprocess.run(["git", "init", "--bare", "-q", bare], check=True)
        self.git_out(repo, "remote", "add", "origin", bare)
        result = self.ok("accept", tid, env=self.gh_env())
        self.assertIn("angenommen", result.stdout)
        self.assertIn("Issue #12 bleibt offen", result.stdout)
        self.assertIn("kein PR-Merge ohne GitHub-Remote/gh", result.stdout)
        self.assertEqual(self.ticket(tid)["status"], "done")
        self.assertFalse(os.path.exists(worktree))
