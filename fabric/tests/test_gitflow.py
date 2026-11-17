"""Prüfen, Urteil, Übergabe-Gate, Abnahme, Zurückweisen, Verwerfen."""
import os

from fabric.tests.support import FabricCase


class GitflowTests(FabricCase):
    def review_ticket(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        return repo, tid, worktree

    def test_verify_schreibt_checks_auf_head(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        head = self.git_out(worktree, "rev-parse", "HEAD")
        result = self.ok("verify", tid)
        self.assertIn("checks pass", result.stdout)
        self.assertIn("prüfung ok", result.stdout)
        checks = self.ticket(tid)["checks"]
        self.assertEqual(checks["state"], "pass")
        self.assertEqual(checks["head"], head)
        self.assertIn("prüfung ok", checks["tail"])
        self.assertIn("zweite zeile", checks["tail"])
        self.assertEqual([row["kind"] for row in self.events()][-1], "verify")

    def test_verify_ohne_skript(self):
        repo, tid, worktree = self.ready_ticket()
        result = self.cli("verify", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(os.path.join(worktree, ".fabric", "verify.sh"), result.stderr)
        self.assertIsNone(self.ticket(tid)["checks"])

    def test_verify_meldet_fehlschlag(self):
        repo, tid, worktree = self.ready_ticket()
        path = os.path.join(worktree, ".fabric", "verify.sh")
        self.write_file(path, "#!/bin/sh\necho 'test rot'\nexit 3\n")
        result = self.cli("verify", tid)
        self.assertEqual(result.returncode, 1)
        checks = self.ticket(tid)["checks"]
        self.assertEqual(checks["state"], "fail")
        self.assertIn("test rot", checks["tail"])

    def test_verdict_fail_weckt_den_zustaendigen(self):
        repo, tid, worktree = self.ready_ticket()
        head = self.git_out(worktree, "rev-parse", "HEAD")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("verdict", tid, "fail", "--from", "ada", "Bitte Tests ergänzen")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["verdict"]["state"], "fail")
        self.assertEqual(ticket["verdict"]["by"], "ada")
        self.assertEqual(ticket["verdict"]["head"], head)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(ticket["comments"][-1]["author"], "ada")
        self.assertIn("Bitte Tests ergänzen", ticket["comments"][-1]["text"])
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t7")
        self.assertIn("Urteil fail", sends[0][2])
        self.assertEqual(self.wake_events(tid)[-1]["text"], "geweckt")

    def test_handover_gate_zaehlt_nur_aktuellen_head(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.commit_in(worktree, "nachher.txt")
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Checks gelten für HEAD", result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "doing")
        # Auf dem aktuellen HEAD prüfen, dann geht die Übergabe durch.
        self.ok("verify", tid)
        result = self.ok("handover", tid, "--from", "zap", "fertig")
        self.assertIn("review", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertIn("mensch", ticket["waiting"])
        self.assertEqual(ticket["comments"][-1]["author"], "zap")
        self.assertEqual([row["kind"] for row in self.events()][-1], "handover")

    def test_handover_ohne_urteil(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("kein Urteil", result.stderr)

    def test_handover_mit_rotem_urteil(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "fail", "--from", "ada", "nicht gut")
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Urteil steht auf fail", result.stderr)

    def test_accept_mergt_und_raeumt_auf(self):
        repo, tid, worktree = self.review_ticket()
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("accept", tid)
        self.assertIn("angenommen", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertEqual(ticket["waiting"], [])
        self.assertIn(
            "Merge fab/T-1-kurzer-titel",
            self.git_out(repo, "log", "--merges", "--oneline", "-n", "1"),
        )
        self.assertTrue(os.path.isfile(os.path.join(repo, "aenderung.txt")))
        self.assertEqual(self.git_out(repo, "branch", "--list", "fab/T-1-kurzer-titel"), "")
        self.assertFalse(os.path.exists(worktree))
        kills = self.hc_calls("kill")
        self.assertTrue(any("t900" in call for call in kills), kills)
        self.assertEqual([row["kind"] for row in self.events()][-1], "accept")

    def test_accept_verweigert_falschen_branch_und_schmutz(self):
        repo, tid, worktree = self.review_ticket()
        self.git(repo, "checkout", "-q", "-b", "andere")
        result = self.cli("accept", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("steht auf andere", result.stderr)
        self.git(repo, "checkout", "-q", "main")
        self.write_file(os.path.join(repo, "README.md"), "geändert\n")
        result = self.cli("accept", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht sauber", result.stderr)
        self.assertTrue(os.path.isdir(worktree))
        self.assertEqual(self.ticket(tid)["status"], "review")

    def test_accept_nur_im_status_review(self):
        repo, tid, worktree = self.ready_ticket()
        result = self.cli("accept", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nur im Status review", result.stderr)

    def test_reject_weckt_den_zustaendigen(self):
        repo, tid, worktree = self.review_ticket()
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("reject", tid, "Bitte mehr Tests")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(ticket["comments"][-1]["author"], "mensch")
        self.assertIn("Bitte mehr Tests", ticket["comments"][-1]["text"])
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t7")
        self.assertEqual(self.wake_events(tid)[-1]["text"], "geweckt")
        self.assertEqual([row["kind"] for row in self.events()][-1], "reject")

    def test_drop_beendet_sessions_und_behaelt_worktree(self):
        repo, tid, worktree = self.ready_ticket()
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        self.ok("drop", tid, "--from", "mensch", "nicht mehr nötig")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "dropped")
        self.assertTrue(os.path.isdir(worktree))
        self.assertTrue(self.ticket(tid)["comments"])
        self.assertTrue(self.hc_calls("kill"))
        self.assertEqual([row["kind"] for row in self.events()][-1], "drop")
