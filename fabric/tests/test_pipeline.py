"""Prüf-Pipelines: Schritte, Zustände und gespeicherte Läufe."""
import json
import os
from unittest import mock

from fabric.fablib import pipeline, store
from fabric.fablib.errors import FabError
from fabric.tests.support import FabricCase


class PipelineCase(FabricCase):
    def steps_file(self, repo, steps):
        return os.path.join(repo, ".fabric", "pipeline.json"), json.dumps(
            {"steps": steps}, ensure_ascii=False
        )

    def write_steps(self, repo, steps):
        path, text = self.steps_file(repo, steps)
        self._write(path, text)
        return path

    def run_pipeline(self, repo, **kwargs):
        with self.store_env():
            return pipeline.run(repo, **kwargs)


class PipelineTest(PipelineCase):
    def test_alle_schritte_gruen(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [
                {"name": "eins", "run": "printf 'eins-ok\\n'"},
                {"name": "zwei", "run": "printf 'zwei-ok\\n'"},
                {"name": "drei", "run": "printf 'drei-ok\\n'"},
            ],
        )

        result = self.run_pipeline(repo, ticket="T-7")

        self.assertEqual(result["state"], "pass")
        self.assertEqual(result["code"], 0)
        self.assertIsInstance(result["run_id"], int)
        self.assertIn("eins-ok", result["stdout"])
        self.assertIn("drei-ok", result["stdout"])
        self.assertEqual([step["state"] for step in result["steps"]], ["pass"] * 3)

        with self.store_env():
            stored = store.pipeline_steps(result["run_id"])
            run = store.pipeline_run_load(result["run_id"])
        self.assertEqual(run["state"], "pass")
        self.assertEqual(run["ticket"], "T-7")
        self.assertEqual([step["state"] for step in stored], ["pass"] * 3)
        self.assertIn("zwei-ok", stored[1]["stdout"])

    def test_fehlschlag_skippt_rest_und_nennt_exit(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [
                {"name": "eins", "run": "printf 'eins-ok\\n'"},
                {"name": "zwei", "run": "printf 'kaputt\\n' >&2; exit 3"},
                {"name": "drei", "run": "printf 'nie\\n'"},
            ],
        )

        result = self.run_pipeline(repo, ticket="T-8")

        self.assertEqual(result["state"], "fail")
        self.assertEqual(result["code"], 3)
        self.assertEqual(result["steps"][0]["state"], "pass")
        self.assertEqual(result["steps"][1]["state"], "fail")
        self.assertEqual(result["steps"][1]["exit_code"], 3)
        self.assertIn("kaputt", result["steps"][1]["stderr"])
        self.assertEqual(result["steps"][2]["state"], "skipped")

        with self.store_env():
            run = store.pipeline_run_load(result["run_id"])
            stored = store.pipeline_steps(result["run_id"])
        self.assertEqual(run["state"], "fail")
        self.assertEqual(stored[1]["state"], "fail")
        self.assertEqual(stored[1]["exit_code"], 3)
        self.assertEqual(stored[2]["state"], "skipped")

    def test_stdout_und_stderr_getrennt(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [
                {
                    "name": "beides",
                    "run": "printf 'auf-stdout\\n'; printf 'auf-stderr\\n' >&2",
                }
            ],
        )

        result = self.run_pipeline(repo)

        self.assertEqual(result["state"], "pass")
        self.assertIn("auf-stdout", result["stdout"])
        self.assertNotIn("auf-stderr", result["stdout"])
        self.assertIn("auf-stderr", result["stderr"])
        self.assertNotIn("auf-stdout", result["stderr"])

        with self.store_env():
            stored = store.pipeline_steps(result["run_id"])
        self.assertIn("auf-stdout", stored[0]["stdout"])
        self.assertIn("auf-stderr", stored[0]["stderr"])

    def test_fallback_ohne_pipeline_json(self):
        repo = self.make_repo()
        self._write(
            os.path.join(repo, ".fabric", "verify.sh"),
            "#!/bin/sh\nprintf 'verify-ok\\n'\n",
        )

        self.assertEqual(
            pipeline.load_steps(repo),
            [{"name": "verify.sh", "run": "sh .fabric/verify.sh"}],
        )
        result = self.run_pipeline(repo)

        self.assertEqual(result["state"], "pass")
        self.assertEqual(len(result["steps"]), 1)
        self.assertEqual(result["steps"][0]["name"], "verify.sh")
        self.assertIn("verify-ok", result["stdout"])

    def test_timeout_ist_exit_124(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "langsam", "run": "sleep 5"}])

        result = self.run_pipeline(repo, timeout=0.2)

        self.assertEqual(result["state"], "fail")
        self.assertEqual(result["code"], 124)
        self.assertEqual(result["steps"][0]["state"], "fail")
        self.assertEqual(result["steps"][0]["exit_code"], 124)
        self.assertIn("Timeout nach 0.2 s", result["steps"][0]["stderr"])

    def test_alle_schritte_sind_beim_start_pending(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [
                {"name": "eins", "run": "printf 'eins\\n'"},
                {"name": "zwei", "run": "printf 'zwei\\n'"},
                {"name": "drei", "run": "printf 'drei\\n'"},
            ],
        )
        seen = []
        real_update = store.pipeline_step_update

        def spy_update(run_id, position, **fields):
            if not seen:
                seen.extend(
                    (step["position"], step["state"])
                    for step in store.pipeline_steps(run_id)
                )
            return real_update(run_id, position, **fields)

        with mock.patch.object(store, "pipeline_step_update", side_effect=spy_update):
            result = self.run_pipeline(repo, ticket="T-9")

        self.assertEqual(seen, [(0, "pending"), (1, "pending"), (2, "pending")])
        self.assertEqual(result["state"], "pass")

    def test_ausnahme_beendet_den_lauf_als_fail(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "eins", "run": "true"}])

        with mock.patch.object(
            pipeline,
            "_execute",
            side_effect=FabError("sh ist nicht vorhanden"),
        ):
            with self.assertRaises(FabError):
                self.run_pipeline(repo, ticket="T-10")

        with self.store_env():
            run = store.pipeline_run_list("T-10")[-1]
        self.assertEqual(run["state"], "fail")
