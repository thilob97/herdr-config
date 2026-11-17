"""Dispatch: Vorbedingungen, Branch und Worktree, Start statt Wecken."""
import os

from fabric.tests.support import FabricCase

BODY = "## Ziel\nEtwas.\n\n## Abnahmekriterien\n- [ ] es läuft\n"


class DispatchTests(FabricCase):
    def prepared_ticket(self, repo, title="Kurzer Titel"):
        tid = self.new(title)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("edit", tid, "--repo", repo, "--from", "mensch")
        self.ok("edit", tid, "--body", BODY, "--from", "mensch")
        return tid

    def test_dispatch_verlangt_repo(self):
        tid = self.new("Ohne Repo")
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("kein Agent", result.stderr)
        self.ok("assign", tid, "zap", "--from", "mensch")
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("kein Repo", result.stderr)

    def test_dispatch_verlangt_abnahmekriterien(self):
        repo = self.make_repo()
        tid = self.new("Ohne Kriterien")
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("edit", tid, "--repo", repo, "--from", "mensch")
        self.ok("edit", tid, "--body", "## Ziel\nNur ein Ziel.\n", "--from", "mensch")
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Abnahmekriterien", result.stderr)
        self.assertIsNone(self.ticket(tid)["worktree"])

    def test_dispatch_verlangt_freie_blocker(self):
        repo = self.make_repo()
        first = self.prepared_ticket(repo, "Erstes")
        second = self.new("Zweites")
        self.ok("assign", second, "zap", "--from", "mensch")
        self.ok("edit", second, "--repo", repo, "--from", "mensch")
        self.ok("edit", second, "--body", BODY, "--from", "mensch")
        self.ok("link", second, "--blocked-by", first, "--from", "mensch")
        result = self.cli("dispatch", second, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"blockiert durch {first}", result.stderr)

    def test_dispatch_legt_branch_und_worktree_an(self):
        repo = self.make_repo()
        base_head = self.git_out(repo, "rev-parse", "HEAD")
        tid = self.prepared_ticket(repo)
        self.set_live({})
        self.clear_log()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("verteilt", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(ticket["assignee"], "zap")
        self.assertEqual(ticket["base"], "main")
        self.assertEqual(ticket["branch"], "fab/T-1-kurzer-titel")
        expected = os.path.join(
            self.fake_home, ".herdr", "worktrees", "repo", "fab-T-1-kurzer-titel"
        )
        self.assertEqual(ticket["worktree"], expected)
        self.assertTrue(os.path.isdir(expected))
        self.assertEqual(
            self.git_out(expected, "rev-parse", "--abbrev-ref", "HEAD"),
            "fab/T-1-kurzer-titel",
        )
        self.assertEqual(self.git_out(expected, "rev-parse", "HEAD"), base_head)
        self.assertEqual(len(ticket["sessions"]), 1)
        self.assertEqual(ticket["sessions"][0]["terminal"], "t900")
        runs = self.hc_calls("run")
        self.assertEqual(len(runs), 1)
        args = runs[0]
        self.assertEqual(args[args.index("--name") + 1], "fab-zap-t-1")
        self.assertEqual(args[args.index("--cwd") + 1], expected)
        self.assertIn("fab.agent=zap", args)
        self.assertIn(f"fab.ticket={tid}", args)
        self.assertIn("--no-parent", args)
        self.assertIn("--outlive-parent", args)
        dispatched = [row for row in self.events() if row["kind"] == "dispatch"]
        self.assertEqual(len(dispatched), 1)
        self.assertEqual(dispatched[0]["target"], "zap")

    def test_laufender_agent_wird_geweckt_statt_gestartet(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.ok("dispatch", tid, "--from", "mensch")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("läuft schon", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t7")

    def test_max_sessions_verhindert_dispatch(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.set_live(
            {
                "fab-ada-t-1": "t1",
                "fab-ada-t-2": "t2",
                "fab-ada-t-3": "t3",
                "fab-ada-t-4": "t4",
            }
        )
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Maximale Zahl", result.stderr)
        self.assertIsNone(self.ticket(tid)["worktree"])

    def test_dispatch_meldet_startfehler_und_behaelt_worktree(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        result = self.cli("dispatch", tid, "--from", "mensch", env={"HC_RUN_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht gestartet", result.stderr)
        ticket = self.ticket(tid)
        self.assertTrue(os.path.isdir(ticket["worktree"]))
        self.assertEqual(ticket["status"], "draft")
        self.assertEqual(ticket["sessions"], [])
        # Ein zweiter Versuch benutzt Worktree und Branch weiter.
        self.ok("dispatch", tid, "--from", "mensch")
        self.assertEqual(self.ticket(tid)["status"], "doing")
        self.assertEqual(len(self.ticket(tid)["sessions"]), 1)
