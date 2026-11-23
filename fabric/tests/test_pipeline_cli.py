"""Pipeline-CLI: Läufe aus verify und repo test sowie runs/run show/rerun."""
import json
import os

from fabric.fablib import store
from fabric.tests.support import FabricCase


class PipelineCliCase(FabricCase):
    def runs(self, ticket=None):
        with self.store_env():
            return store.pipeline_run_list(ticket)

    def run_load(self, run_id):
        with self.store_env():
            return store.pipeline_run_load(run_id)


class VerifyRunTest(PipelineCliCase):
    def test_verify_legt_lauf_an_und_nennt_id(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        result = self.ok("verify", tid)
        runs = self.runs(tid)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["trigger"], "verify")
        self.assertEqual(runs[0]["ticket"], tid)
        self.assertEqual(runs[0]["state"], "pass")
        self.assertIn(f"Lauf #{runs[0]['id']}", result.stdout)
        self.assertEqual(self.run_load(runs[0]["id"])["state"], "pass")


class RepoTestRunTest(PipelineCliCase):
    def test_repo_test_legt_lauf_an(self):
        repo = self.make_repo()
        self.passing_verify(repo)
        result = self.ok("repo", "test", repo)
        runs = self.runs()
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["trigger"], "repo-test")
        self.assertEqual(runs[0]["state"], "pass")
        self.assertEqual(runs[0]["repo"], os.path.realpath(repo))
        self.assertIn(f"Lauf #{runs[0]['id']}", result.stdout)
        self.assertIn("Prüfskript: Exit 0", result.stdout)


class RunsListTest(PipelineCliCase):
    def test_runs_listet_und_filtert(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        other = self.make_repo("other")
        self.passing_verify(other)
        self.ok("repo", "test", other)

        rows = json.loads(self.ok("runs", "--json").stdout)
        self.assertEqual(len(rows), 2)
        only = json.loads(self.ok("runs", "--ticket", tid, "--json").stdout)
        self.assertEqual([row["ticket"] for row in only], [tid])

        text = self.ok("runs").stdout
        self.assertIn(f"#{rows[0]['id']}", text)
        self.assertIn("verify", text)
        self.assertIn("repo-test", text)


class RunShowTest(PipelineCliCase):
    def setUp(self):
        super().setUp()
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.run_id = self.runs(tid)[0]["id"]

    def test_text_zeigt_schritte_und_getrennte_ausgabe(self):
        text = self.ok("run", "show", str(self.run_id)).stdout
        self.assertIn(f"Lauf #{self.run_id}", text)
        self.assertIn("[1] verify.sh", text)
        self.assertIn("prüfung ok", text)
        self.assertIn("zweite zeile", text)

    def test_json_struktur(self):
        data = json.loads(
            self.ok("run", "show", f"#{self.run_id}", "--json").stdout
        )
        self.assertEqual(set(data), {"run", "steps"})
        self.assertEqual(data["run"]["id"], self.run_id)
        self.assertEqual([step["name"] for step in data["steps"]], ["verify.sh"])

    def test_step_filtert_exakt(self):
        data = json.loads(
            self.ok(
                "run", "show", str(self.run_id), "--step", "verify.sh", "--json"
            ).stdout
        )
        self.assertEqual([step["name"] for step in data["steps"]], ["verify.sh"])
        missing = self.cli(
            "run", "show", str(self.run_id), "--step", "gibt-es-nicht"
        )
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("verify.sh", missing.stderr)

    def test_unbekannter_lauf_scheitert(self):
        result = self.cli("run", "show", "9999")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("9999", result.stderr)


class RunRerunTest(PipelineCliCase):
    def test_rerun_erzeugt_zweiten_lauf(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        first = self.runs(tid)[0]["id"]
        result = self.ok("run", "rerun", str(first))
        runs = self.runs(tid)
        self.assertEqual(len(runs), 2)
        second = [row["id"] for row in runs if row["id"] != first][0]
        self.assertIn(f"#{first}", result.stdout)
        self.assertIn(f"#{second}", result.stdout)
        self.assertIn("pass", result.stdout)
        self.assertEqual(self.run_load(second)["state"], "pass")
        self.assertEqual(result.returncode, 0)

    def test_unbekannter_lauf_scheitert(self):
        result = self.cli("run", "rerun", "9999")
        self.assertNotEqual(result.returncode, 0)
