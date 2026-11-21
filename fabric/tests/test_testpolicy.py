"""Testmuster (T-33): Übergabe verlangt zu Logik auch Tests."""
import json
import os

from fabric.tests.support import FabricCase


class TestPolicyTests(FabricCase):
    def vorbereiten(self, *pfade):
        """Ticket mit committeten Änderungen, grünem Verify und Urteil."""
        repo, tid, worktree = self.ready_ticket()
        for pfad in pfade:
            self.commit_in(worktree, pfad)
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        return repo, tid, worktree

    def test_logik_ohne_test_verweigert(self):
        repo, tid, worktree = self.vorbereiten("fabric/fablib/logik.py")
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Logik ohne Test", result.stderr)
        self.assertIn("fabric/fablib/logik.py", result.stderr)
        self.assertIn("Testmuster:", result.stderr)
        self.assertIn("Quelle: Standardmuster", result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "doing")

    def test_logik_mit_test_geht_durch(self):
        repo, tid, worktree = self.vorbereiten(
            "fabric/fablib/logik.py", "fabric/tests/test_logik.py"
        )
        result = self.ok("handover", tid, "--from", "zap", "fertig")
        self.assertIn("review", result.stdout)
        self.assertEqual(self.ticket(tid)["status"], "review")

    def test_default_muster_nehmen_ansichten_aus(self):
        repo, tid, worktree = self.vorbereiten("mods/fabric/views/board.js")
        self.ok("handover", tid, "--from", "zap", "fertig")
        self.assertEqual(self.ticket(tid)["status"], "review")

    def test_mod_logik_ohne_test_verweigert(self):
        repo, tid, worktree = self.vorbereiten("mods/fabric/main.js")
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Logik ohne Test", result.stderr)
        self.assertIn("mods/fabric/main.js", result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "doing")

    def test_ohne_logikdateien_unveraendert(self):
        repo, tid, worktree = self.vorbereiten("aenderung.txt")
        self.ok("handover", tid, "--from", "zap", "fertig")
        self.assertEqual(self.ticket(tid)["status"], "review")

    def test_eigene_muster_im_haupt_checkout(self):
        repo, tid, worktree = self.ready_ticket()
        policy = os.path.join(repo, ".fabric", "testpolicy.json")
        os.makedirs(os.path.dirname(policy), exist_ok=True)
        self.write_file(
            policy, json.dumps({"logic": ["app/*.rb"], "tests": ["spec/**"]})
        )
        for pfad in (
            "app/rechner.rb",
            "fabric/fablib/logik.py",
            "fabric/tests/test_logik.py",
        ):
            self.commit_in(worktree, pfad)
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Logik ohne Test", result.stderr)
        self.assertIn("app/rechner.rb", result.stderr)
        self.assertNotIn("fabric/fablib/logik.py", result.stderr)
        self.assertIn("Testmuster: spec/**", result.stderr)
        quelle = os.path.join(os.path.realpath(repo), ".fabric", "testpolicy.json")
        self.assertIn(f"Quelle: {quelle}", result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "doing")
        # Der Test macht die Übergabe möglich.
        self.commit_in(worktree, "spec/rechner_spec.rb")
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("handover", tid, "--from", "zap", "fertig")
        self.assertEqual(self.ticket(tid)["status"], "review")

    def test_kaputtes_json_verweigert_mit_pfad(self):
        repo, tid, worktree = self.vorbereiten("fabric/fablib/logik.py")
        policy = os.path.join(repo, ".fabric", "testpolicy.json")
        os.makedirs(os.path.dirname(policy), exist_ok=True)
        self.write_file(policy, "{kaputt")
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(policy, result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "doing")
