"""`fab verify` löst den Lauf vom Aufrufer und nimmt ihn wieder auf (T-143).

Die Tests starten echte `fab verify`-Aufrufe als Unterprozess. Beendet das
Werkzeug-Zeitlimit des Agenten den Aufrufer per SIGTERM, muss der Lauf
weiterlaufen und seinen Endstatus schreiben; ein zweiter Aufruf auf demselben
Ticket und HEAD wartet auf diesen Lauf, statt einen neuen zu starten.
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time

from fabric.fablib import store
from fabric.tests.support import FAB, FabricCase

SLOW_STEP = '''
import os
import sys
import time

started, release = sys.argv[1], sys.argv[2]
open(started, "w").close()
deadline = time.time() + 120
while not os.path.exists(release):
    if time.time() > deadline:
        raise SystemExit(9)
    time.sleep(0.02)
print("langsam ok")
'''

OPEN = ("queued", "running")


class VerifyDetachCase(FabricCase):
    def slow_verify(self, worktree):
        """Pipeline mit einem Schritt, der auf eine Freigabedatei wartet."""
        helper = os.path.join(self.tmp, "langsam.py")
        self.write_file(helper, SLOW_STEP)
        started = os.path.join(self.tmp, "gestartet")
        release = os.path.join(self.tmp, "freigabe")
        steps = {
            "steps": [
                {
                    "name": "langsam",
                    "run": f"{sys.executable} {helper} {started} {release}",
                }
            ]
        }
        self.write_file(
            os.path.join(worktree, ".fabric", "pipeline.json"),
            json.dumps(steps, ensure_ascii=False),
        )
        return started, release

    def start_verify(self, tid):
        return subprocess.Popen(
            [sys.executable, FAB, "verify", tid],
            cwd=self.tmp,
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def runs(self, tid):
        with self.store_env():
            return store.pipeline_run_list(tid)

    def final_run(self, tid):
        rows = self.runs(tid)
        if not rows or rows[-1]["state"] in OPEN:
            return None
        return rows[-1]

    def steps(self, run_id):
        with self.store_env():
            return store.pipeline_steps(run_id)

    def checks(self, tid):
        return self.ticket(tid)["checks"] or {}

    def stop(self, proc):
        if proc is not None and proc.poll() is None:
            proc.kill()
        if proc is not None:
            proc.communicate()

    def release(self, path):
        if not os.path.exists(path):
            open(path, "w").close()


class SigtermTest(VerifyDetachCase):
    def test_sigterm_am_aufrufer_beendet_den_lauf_nicht(self):
        _repo, tid, worktree = self.ready_ticket()
        started, release = self.slow_verify(worktree)
        caller = self.start_verify(tid)
        try:
            self.assertTrue(
                self.wait_for(lambda: os.path.exists(started), timeout=30),
                "Lauf startete nicht",
            )
            self.assertTrue(self.wait_for(lambda: self.runs(tid), timeout=10))
            run = self.runs(tid)[-1]
            self.assertEqual(run["state"], "running")

            # Das Werkzeug-Zeitlimit des Agenten beendet den Aufrufer.
            caller.terminate()
            out, err = caller.communicate(timeout=20)
            self.assertEqual(caller.returncode, -signal.SIGTERM, err)
            self.assertEqual(self.runs(tid)[-1]["state"], "running")

            # Der gelöste Lauf läuft weiter und bekommt seinen Endstatus.
            self.release(release)
            final = self.wait_for(lambda: self.final_run(tid), timeout=60)
            self.assertIsNotNone(final, "Lauf endete nicht")
            self.assertEqual(final["state"], "pass", final["reason"])
            self.assertEqual(final["reason"], "")
            self.assertEqual([step["state"] for step in self.steps(final["id"])], ["pass"])

            # Auch die Checks schreibt der Lauf selbst, ohne den toten Aufrufer.
            self.assertTrue(
                self.wait_for(
                    lambda: self.checks(tid).get("run_id") == final["id"], timeout=30
                ),
                "Checks wurden nicht geschrieben",
            )
            self.assertEqual(self.checks(tid)["state"], "pass")
            self.assertNotIn("verwaister Lauf", final["reason"])
        finally:
            self.release(release)
            self.stop(caller)


class AttachTest(VerifyDetachCase):
    def test_zweites_verify_wartet_auf_denselben_lauf(self):
        _repo, tid, worktree = self.ready_ticket()
        started, release = self.slow_verify(worktree)
        first = self.start_verify(tid)
        second = None
        lines = []

        def read_stderr():
            for line in second.stderr:
                lines.append(line)

        try:
            self.assertTrue(
                self.wait_for(lambda: os.path.exists(started), timeout=30),
                "Lauf startete nicht",
            )
            self.assertTrue(self.wait_for(lambda: self.runs(tid), timeout=10))
            run = self.runs(tid)[-1]
            self.assertEqual(run["state"], "running")

            second = self.start_verify(tid)
            threading.Thread(target=read_stderr, daemon=True).start()
            self.assertTrue(
                self.wait_for(
                    lambda: any("läuft bereits" in line for line in lines), timeout=30
                ),
                "Zweiter Aufruf nahm den Lauf nicht wieder auf",
            )

            # Solange der erste Lauf lebt, entsteht kein zweiter für denselben Stand.
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                self.assertEqual(len(self.runs(tid)), 1)
                self.assertIsNone(second.poll(), "Zweiter Aufruf endete zu früh")
                time.sleep(0.05)
            self.assertEqual(self.runs(tid)[-1]["state"], "running")

            self.release(release)
            out_first, err_first = first.communicate(timeout=60)
            second.wait(timeout=60)
            out_second = second.stdout.read()
            self.assertEqual(first.returncode, 0, err_first)
            self.assertEqual(second.returncode, 0, "".join(lines))
            self.assertIn(f"Lauf #{run['id']}", out_first)
            self.assertIn(f"Lauf #{run['id']}", out_second)
            self.assertIn("checks pass", out_second)
            self.assertEqual(len(self.runs(tid)), 1)
            self.assertEqual(self.runs(tid)[-1]["state"], "pass")
            self.assertEqual(self.checks(tid)["run_id"], run["id"])
            self.assertEqual(self.checks(tid)["state"], "pass")
        finally:
            self.release(release)
            self.stop(first)
            self.stop(second)


class RealAbortTest(VerifyDetachCase):
    def test_getoeteter_lauf_bleibt_ein_abbruch(self):
        """Stirbt der Laufprozess selbst, endet der Wartende als Abbruch."""
        _repo, tid, worktree = self.ready_ticket()
        started, release = self.slow_verify(worktree)
        caller = self.start_verify(tid)
        try:
            self.assertTrue(
                self.wait_for(lambda: os.path.exists(started), timeout=30),
                "Lauf startete nicht",
            )
            self.assertTrue(self.wait_for(lambda: self.runs(tid), timeout=10))
            run = self.runs(tid)[-1]
            lock = os.path.join(self.home, "verify-runs", f"run-{run['id']}.lock")
            with open(lock, encoding="ascii") as handle:
                owner = int(handle.read().strip())
            os.kill(owner, signal.SIGKILL)

            out, err = caller.communicate(timeout=60)
            self.assertEqual(caller.returncode, 1, err)
            self.assertIn("checks fail", out)
            final = self.runs(tid)[-1]
            self.assertEqual(final["state"], "fail")
            self.assertIn("verwaister Lauf", final["reason"])
            self.assertEqual(self.checks(tid)["state"], "fail")
        finally:
            self.release(release)
            self.stop(caller)
