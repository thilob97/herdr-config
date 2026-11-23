"""Abnahme ohne Änderung: 0 Commits über der Basis schließen lokal ab."""
import os
from unittest import mock

from fabric.fablib import autopilot
from fabric.tests.support import FabricCase


class AcceptNoopTests(FabricCase):
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

    def test_accept_ohne_commits_schliesst_lokal_ohne_merge(self):
        repo, tid, worktree = self.ready_ticket()
        self.ok("handover", tid, "--from", "zap", "Keine Änderung nötig")
        main_head = self.git_out(repo, "rev-parse", "HEAD")
        mark = self.mark()

        result = self.ok("accept", tid)

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
        env = mock.patch.dict(os.environ, {"FAB_HOME": self.home})
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
                    autopilot, "check_main", return_value=(True, "", "", 0)
                ), \
                mock.patch.object(autopilot, "write_state"):
            autopilot.once()
            autopilot.once()

        self.assertEqual(len(accept_calls), 1)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertNotEqual(ticket["status"], "dropped")
