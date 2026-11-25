"""Prüf-Pipelines: Schritte, Zustände und gespeicherte Läufe."""
import contextlib
import io
import json
import os
import subprocess
import sys
import time
from unittest import mock

from fabric.fablib import pipeline, store, verifyslots
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
        self.assertEqual(
            result["reason"], "Abbruch: Zeitlimit nach 0.2 s im Schritt langsam"
        )
        with self.store_env():
            run = store.pipeline_run_load(result["run_id"])
        self.assertEqual(run["reason"], result["reason"])

    # -- Stillstand (T-145)

    def test_stiller_schritt_bricht_ab_und_gibt_den_platz_frei(self):
        repo = self.make_repo()
        marker = os.path.join(self.tmp, "enkel-lebt")
        # Ein Enkel hält die Ausgabe offen und schreibt nichts mehr; das ist
        # der Fall vom 25.11. (hängende Testprozesse unter run_parallel).
        self.write_steps(
            repo,
            [{"name": "haengt", "run": (
                f"echo los; (sleep 60; touch {marker}) & sleep 60"
            )}],
        )
        with mock.patch.dict(os.environ, {"FAB_VERIFY_STALL": "0.5"}):
            started = time.monotonic()
            result = self.run_pipeline(repo, ticket="T-45")
            elapsed = time.monotonic() - started

        self.assertLess(elapsed, 20)
        self.assertEqual(result["state"], "fail")
        self.assertTrue(
            result["reason"].startswith("Abbruch: stillstehender Lauf"),
            result["reason"],
        )
        self.assertIn("im Schritt haengt", result["reason"])
        self.assertIn("los", result["stdout"])
        with self.store_env():
            run = store.pipeline_run_load(result["run_id"])
            self.assertEqual(run["reason"], result["reason"])
            # Beide Plätze sind frei: Ein neuer Lauf belegt sofort einen.
            for _ in range(verifyslots.limit()):
                slot = verifyslots.acquire(verifyslots.limit(), timeout=0)
                self.addCleanup(slot.release)
        self.assertFalse(os.path.exists(marker))

    def test_gesunder_schritt_mit_laufender_ausgabe_bleibt(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [{"name": "zaehlt", "run": (
                "for i in $(seq 1 15); do echo $i; sleep 0.2; done"
            )}],
        )
        # Der Schritt läuft länger als die Frist, schreibt aber laufend.
        with mock.patch.dict(os.environ, {"FAB_VERIFY_STALL": "2"}):
            result = self.run_pipeline(repo, ticket="T-46")
        self.assertEqual(result["state"], "pass", result["reason"])
        self.assertEqual(result["reason"], "")
        self.assertIn("15", result["stdout"])

    def test_haengender_besitzer_wird_beim_naechsten_zugriff_abgeraeumt(self):
        repo = self.make_repo()
        with self.store_env():
            run_id = store.pipeline_run_new(
                trigger="verify", ticket="T-47", repo=repo, worktree=repo,
                branch="main", head="abc", state="queued",
            )
            store.pipeline_step_add(run_id, 0, "unittest", "true", "pending")
            store.pipeline_run_start(run_id)
            store.pipeline_step_update(run_id, 0, state="running")
            # Ein lebender Besitzer hält die Besitzdatei, schreibt aber nichts.
            owner = subprocess.Popen(
                [sys.executable, "-c", (
                    "import fcntl, os, sys, time\n"
                    "fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR)\n"
                    "fcntl.flock(fd, fcntl.LOCK_EX)\n"
                    "os.ftruncate(fd, 0); os.write(fd, str(os.getpid()).encode())\n"
                    "print('bereit', flush=True)\n"
                    "time.sleep(120)\n"
                ), verifyslots.run_path(run_id)],
                stdout=subprocess.PIPE, text=True, start_new_session=True,
            )
            self.addCleanup(owner.stdout.close)
            self.addCleanup(lambda: owner.poll() is None and owner.kill())
            self.assertEqual(owner.stdout.readline().strip(), "bereit")
            base = pipeline._step_base(run_id, 0)
            for suffix in (".out", ".err"):
                self._write(base + suffix, "alt\n")
                os.utime(base + suffix, (1000, 1000))

            # Frisch geschrieben: gesund, bleibt unberührt.
            pipeline._reap_abandoned(stall=600, now=1000 + 30)
            self.assertEqual(store.pipeline_run_load(run_id)["state"], "running")
            self.assertIsNone(owner.poll())

            # Weit über der Frist: Besitzer beendet, Lauf mit Grund zu.
            pipeline._reap_abandoned(stall=600, now=1000 + 3600)
            run = store.pipeline_run_load(run_id)
        self.assertEqual(run["state"], "fail")
        self.assertTrue(
            run["reason"].startswith("Abbruch: stillstehender Lauf"), run["reason"]
        )
        owner.wait(timeout=10)
        with self.store_env():
            self.assertTrue(verifyslots.abandoned(run_id))
            self.assertEqual(store.pipeline_steps(run_id)[0]["state"], "fail")

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

    def test_abbruch_mitten_im_schritt_markiert_rest(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [
                {"name": "eins", "run": "true"},
                {"name": "zwei", "run": "true"},
                {"name": "drei", "run": "true"},
            ],
        )
        calls = []

        def abort(command, cwd, timeout, **_step):
            calls.append(command)
            if len(calls) == 2:
                raise FabError("abgebrochen")
            return 0, "ok", ""

        with mock.patch.object(pipeline, "_execute", side_effect=abort):
            with self.assertRaises(FabError):
                self.run_pipeline(repo, ticket="T-11")

        with self.store_env():
            run = store.pipeline_run_list("T-11")[-1]
            steps = store.pipeline_steps(run["id"])
        self.assertEqual(run["state"], "fail")
        self.assertEqual(
            [step["state"] for step in steps], ["pass", "fail", "skipped"]
        )
        self.assertNotIn(
            "running", [step["state"] for step in steps]
        )
        self.assertNotIn(
            "pending", [step["state"] for step in steps]
        )

    def test_aufraeumfehler_verdeckt_ursache_nicht(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [
                {"name": "eins", "run": "true"},
                {"name": "zwei", "run": "true"},
            ],
        )
        original = KeyboardInterrupt("Abbruch")
        cleanup = FabError("Datenbank gesperrt")
        cleaning = {"active": False}
        real_update = store.pipeline_step_update

        def execute(command, cwd, timeout, **_step):
            cleaning["active"] = True
            raise original

        def update(run_id, position, **fields):
            if cleaning["active"]:
                raise cleanup
            return real_update(run_id, position, **fields)

        stderr = io.StringIO()
        with mock.patch.object(pipeline, "_execute", side_effect=execute), \
                mock.patch.object(
                    store, "pipeline_step_update", side_effect=update
                ), \
                contextlib.redirect_stderr(stderr):
            with self.assertRaises(KeyboardInterrupt) as caught:
                self.run_pipeline(repo, ticket="T-12")

        self.assertIs(caught.exception, original)
        self.assertIs(caught.exception.__cause__, cleanup)
        self.assertIn("Datenbank gesperrt", stderr.getvalue())

        with self.store_env():
            run = store.pipeline_run_list("T-12")[-1]
        self.assertEqual(run["state"], "fail")

    def test_schritte_lesen_fehler_verdeckt_ursache_nicht(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [
                {"name": "eins", "run": "true"},
                {"name": "zwei", "run": "true"},
            ],
        )
        original = FabError("abgebrochen")
        cleanup = FabError("Datenbank gesperrt")

        stderr = io.StringIO()
        with mock.patch.object(
            pipeline, "_execute", side_effect=original
        ), mock.patch.object(
            store, "pipeline_steps", side_effect=cleanup
        ), contextlib.redirect_stderr(stderr):
            with self.assertRaises(FabError) as caught:
                self.run_pipeline(repo, ticket="T-15")

        self.assertIs(caught.exception, original)
        self.assertIs(caught.exception.__cause__, cleanup)
        self.assertIn(
            "Aufräumen fehlgeschlagen (Schritte lesen)", stderr.getvalue()
        )
        self.assertIn("Datenbank gesperrt", stderr.getvalue())

        with self.store_env():
            run = store.pipeline_run_list("T-15")[-1]
        self.assertEqual(run["state"], "fail")

    def test_finish_fehler_laesst_ursache_durch(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "eins", "run": "true"}])
        original = FabError("ursprünglich")
        cleanup = RuntimeError("Speicher gesperrt")

        stderr = io.StringIO()
        with mock.patch.object(
            pipeline, "_execute", side_effect=original
        ), mock.patch.object(
            store, "pipeline_run_finish", side_effect=cleanup
        ), contextlib.redirect_stderr(stderr):
            with self.assertRaises(FabError) as caught:
                self.run_pipeline(repo, ticket="T-13")

        self.assertIs(caught.exception, original)
        self.assertIs(caught.exception.__cause__, cleanup)
        self.assertIn("Speicher gesperrt", stderr.getvalue())

    def test_rerun_meldet_aufraeumfehler_und_endet_fail(self):
        repo = self.make_repo()
        self.write_steps(
            repo,
            [
                {"name": "eins", "run": "true"},
                {"name": "zwei", "run": "true"},
            ],
        )
        with self.store_env():
            first = pipeline.run(repo, "verify", ticket="T-14")
        self.assertEqual(first["state"], "pass")

        original = KeyboardInterrupt("Abbruch")
        cleanup = FabError("Datenbank gesperrt")
        cleaning = {"active": False}
        real_update = store.pipeline_step_update

        def execute(command, cwd, timeout, **_step):
            cleaning["active"] = True
            raise original

        def update(run_id, position, **fields):
            if cleaning["active"]:
                raise cleanup
            return real_update(run_id, position, **fields)

        stderr = io.StringIO()
        with mock.patch.object(pipeline, "_execute", side_effect=execute), \
                mock.patch.object(
                    store, "pipeline_step_update", side_effect=update
                ), \
                contextlib.redirect_stderr(stderr), self.store_env():
            with self.assertRaises(KeyboardInterrupt) as caught:
                pipeline.rerun(first["run_id"])

        self.assertIs(caught.exception, original)
        self.assertIs(caught.exception.__cause__, cleanup)
        self.assertIn("Datenbank gesperrt", stderr.getvalue())

        with self.store_env():
            run = store.pipeline_run_list("T-14")[-1]
        self.assertNotEqual(run["id"], first["run_id"])
        self.assertEqual(run["state"], "fail")

    # -- Abbruchgrund (T-127)

    def test_signalender_schritt_hat_abbruchgrund(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "toter", "run": "kill -TERM $$"}])

        result = self.run_pipeline(repo, ticket="T-21")

        self.assertEqual(result["state"], "fail")
        self.assertEqual(result["code"], -15)
        self.assertTrue(result["reason"].startswith("Abbruch:"), result["reason"])
        self.assertIn("Signal 15", result["reason"])
        self.assertIn("toter", result["reason"])
        with self.store_env():
            run = store.pipeline_run_load(result["run_id"])
        self.assertEqual(run["reason"], result["reason"])

    def test_gewöhnlicher_roter_schritt_hat_leeren_grund(self):
        repo = self.make_repo()
        self.write_steps(
            repo, [{"name": "rot", "run": "printf 'kaputt\\n' >&2; exit 1"}]
        )

        result = self.run_pipeline(repo, ticket="T-22")

        self.assertEqual(result["state"], "fail")
        self.assertEqual(result["code"], 1)
        self.assertEqual(result["reason"], "")
        with self.store_env():
            run = store.pipeline_run_load(result["run_id"])
        self.assertEqual(run["reason"], "")

    def test_testlaeufer_signal_hat_abbruchgrund(self):
        repo = self.make_repo()
        fixture = os.path.join(repo, "test_dauerhaft_signal.py")
        self._write(
            fixture,
            "import os\nimport signal\n\n"
            "os.kill(os.getpid(), signal.SIGTERM)\n",
        )
        runner = os.path.join(
            os.path.dirname(os.path.abspath(pipeline.__file__)),
            "..",
            "tests",
            "run_parallel.py",
        )
        self.write_steps(
            repo,
            [{"name": "unittest", "run": f"{sys.executable} {runner} {fixture}"}],
        )

        result = self.run_pipeline(repo, ticket="T-23")

        self.assertEqual(result["state"], "fail")
        self.assertEqual(result["code"], pipeline.ABORT_EXIT)
        self.assertTrue(result["reason"].startswith("Abbruch:"), result["reason"])
        self.assertIn("Signal 15", result["reason"])
        with self.store_env():
            run = store.pipeline_run_load(result["run_id"])
        self.assertEqual(run["reason"], result["reason"])

    def test_verwaister_lauf_hat_abbruchgrund_und_show_zeile(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "eins", "run": "true"}])
        with self.store_env():
            run_id = store.pipeline_run_new(
                trigger="verify",
                ticket="T-24",
                repo=repo,
                worktree=repo,
                branch="main",
                head="b" * 40,
                state="queued",
            )
            store.pipeline_step_add(run_id, 0, "eins", "true", "pending")
            store.pipeline_run_start(run_id)
            store.pipeline_step_update(run_id, 0, state="running")
            with mock.patch.object(verifyslots, "abandoned", return_value=True):
                pipeline._reap_abandoned()
            run = store.pipeline_run_load(run_id)
            steps = store.pipeline_steps(run_id)

        self.assertEqual(run["state"], "fail")
        self.assertTrue(run["reason"].startswith("Abbruch:"), run["reason"])
        self.assertIn("verwaister Lauf", run["reason"])
        self.assertEqual([step["state"] for step in steps], ["fail"])

        shown = self.cli("run", "show", str(run_id))
        self.assertEqual(shown.returncode, 0, shown.stderr)
        self.assertIn("Grund: Abbruch:", shown.stdout)

    def test_fertiger_lauf_zwischen_snapshot_und_schreiben_bleibt_ohne_grund(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "eins", "run": "true"}])
        with self.store_env():
            run_id = store.pipeline_run_new(
                trigger="verify",
                ticket="T-25",
                repo=repo,
                worktree=repo,
                branch="main",
                head="c" * 40,
                state="queued",
            )
            store.pipeline_step_add(run_id, 0, "eins", "true", "pending")
            store.pipeline_run_start(run_id)
            store.pipeline_step_update(run_id, 0, state="running")
            real_steps = store.pipeline_steps

            def stale_steps(target):
                snapshot = real_steps(target)
                # Der Besitzer wird genau zwischen Snapshot und Aufräumen
                # fertig; das Aufräumen arbeitet mit veralteten Zuständen.
                store.pipeline_step_update(target, 0, state="pass", exit_code=0)
                store.pipeline_run_finish(target, "pass", 9)
                return snapshot

            with mock.patch.object(
                verifyslots, "abandoned", return_value=True
            ), mock.patch.object(
                store, "pipeline_steps", side_effect=stale_steps
            ):
                pipeline._reap_abandoned()

            run = store.pipeline_run_load(run_id)
            steps = store.pipeline_steps(run_id)

        self.assertEqual(run["state"], "pass")
        self.assertEqual(run["duration_ms"], 9)
        self.assertEqual(run["reason"], "")
        self.assertEqual([step["state"] for step in steps], ["pass"])

    def test_unittest_fehler_mit_signalendem_unterprozess_hat_abbruchgrund(self):
        repo = self.make_repo()
        fixture = os.path.join(repo, "test_unterprozess_signal.py")
        self._write(
            fixture,
            "import subprocess\n"
            "import sys\n"
            "import unittest\n"
            "\n"
            "\n"
            "class Inner(unittest.TestCase):\n"
            "    def test_unterprozess(self):\n"
            "        code = subprocess.run(\n"
            "            [sys.executable, '-c',\n"
            "             'import os, signal; os.kill(os.getpid(), signal.SIGTERM)'],\n"
            "        ).returncode\n"
            "        self.assertEqual(code, 0, '')\n",
        )
        runner = os.path.join(
            os.path.dirname(os.path.abspath(pipeline.__file__)),
            "..",
            "tests",
            "run_parallel.py",
        )
        self.write_steps(
            repo,
            [{"name": "unittest", "run": f"{sys.executable} {runner} {fixture}"}],
        )

        result = self.run_pipeline(repo, ticket="T-26")

        self.assertEqual(result["state"], "fail")
        self.assertEqual(result["code"], pipeline.ABORT_EXIT)
        self.assertTrue(result["reason"].startswith("Abbruch:"), result["reason"])
        self.assertIn("Signal 15", result["reason"])
        with self.store_env():
            run = store.pipeline_run_load(result["run_id"])
        self.assertEqual(run["reason"], result["reason"])


class TestJobsTest(PipelineCase):
    def test_testprozesse_teilen_sich_die_kerne_mit_den_pruefplaetzen(self):
        with mock.patch.object(pipeline.os, "cpu_count", return_value=12):
            self.assertEqual(pipeline.test_jobs(2), 6)
            self.assertEqual(pipeline.test_jobs(4), 3)
            self.assertEqual(pipeline.test_jobs(12), 2, "mindestens zwei")
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "jobs", "run": "echo jobs=$FAB_TEST_JOBS"}])
        env = {k: v for k, v in os.environ.items() if k != "FAB_TEST_JOBS"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(pipeline, "test_jobs", return_value=5):
            result = self.run_pipeline(repo)
        self.assertIn("jobs=5", result["stdout"])
        with mock.patch.dict(os.environ, {"FAB_TEST_JOBS": "3"}):
            result = self.run_pipeline(repo)
        self.assertIn("jobs=3", result["stdout"], "ein gesetzter Wert bleibt")
