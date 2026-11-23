"""Warteschlange für Prüfläufe: höchstens `max_verify` gleichzeitig (T-105).

Die Tests starten echte Subprozesse, weil Slots per `flock` prozessübergreifend
wirken. Zeitvergleiche nutzen ausschließlich `time.monotonic()`.
"""
import json
import os
import subprocess
import sys
import time
from unittest import mock

from fabric.fablib import agents, pipeline, store, verifyslots
from fabric.fablib.errors import FabError
from fabric.tests.support import FabricCase

ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

RUNNER = """
import sys

from fabric.fablib import pipeline
from fabric.fablib.errors import FabError

repo, ticket = sys.argv[1], sys.argv[2]
timeout = float(sys.argv[3]) if len(sys.argv) > 3 else None
try:
    result = pipeline.run(repo, ticket=ticket, repo=repo, timeout=timeout)
except FabError as exc:
    print(f"Fehler: {exc}", file=sys.stderr)
    sys.exit(2)
print(result["state"])
"""

HOLDER = """
import sys
import time

from fabric.fablib import verifyslots

count = int(sys.argv[1])
ready = sys.argv[2]
slots = [verifyslots.acquire(count) for _ in range(count)]
open(ready, "w").close()
time.sleep(120)
"""

HELPER = """
import os
import time

path = os.environ["EVENT_FILE"]
with open(path, "a", encoding="utf-8") as handle:
    handle.write("enter %d %.6f\\n" % (os.getpid(), time.monotonic()))
time.sleep(0.4)
with open(path, "a", encoding="utf-8") as handle:
    handle.write("exit %d %.6f\\n" % (os.getpid(), time.monotonic()))
"""


class VerifyQueueCase(FabricCase):
    def write_steps(self, repo, steps):
        path = os.path.join(repo, ".fabric", "pipeline.json")
        self._write(path, json.dumps({"steps": steps}, ensure_ascii=False))
        return path

    def slot_path(self, index):
        return os.path.join(self.home, "verify-slots", f"slot-{index}.lock")

    def child_env(self):
        merged = dict(self.env)
        parts = [ROOT]
        if merged.get("PYTHONPATH"):
            parts.append(merged["PYTHONPATH"])
        merged["PYTHONPATH"] = os.pathsep.join(parts)
        return merged

    def start_runner(self, repo, ticket, timeout=None, env=None):
        merged = self.child_env()
        merged.update(env or {})
        args = [sys.executable, "-c", RUNNER, repo, ticket]
        if timeout is not None:
            args.append(str(timeout))
        return subprocess.Popen(
            args,
            cwd=repo,
            env=merged,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def start_holder(self, count, home=None):
        """Subprozess, der `count` Slots per flock hält, bis er getötet wird."""
        ready = os.path.join(self.tmp, f"holder-{count}-{time.time_ns()}.ready")
        env = self.child_env()
        if home is not None:
            env["FAB_HOME"] = home
        proc = subprocess.Popen(
            [sys.executable, "-c", HOLDER, str(count), ready],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if not self.wait_for(lambda: os.path.exists(ready), timeout=10):
            self.stop(proc)
            self.fail("Slot-Halter wurde nicht bereit")
        return proc

    def stop(self, proc):
        if proc.poll() is None:
            proc.kill()
        try:
            proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()

    def lock_is_free(self):
        """Sperre in-process ohne Wartezeit prüfen (`FAB_LOCK_TIMEOUT=0`)."""
        with self.store_env(), mock.patch.dict(
            os.environ, {"FAB_LOCK_TIMEOUT": "0"}
        ):
            try:
                with store.locked():
                    pass
            except FabError:
                return False
        return True

    def queued_run(self, ticket):
        with self.store_env():
            rows = store.pipeline_run_list(ticket)
        return next((row for row in rows if row["state"] == "queued"), None)

    def running_run(self, ticket):
        """(Lauf, Schritte), sobald der Lauf samt einem Schritt `running` ist."""
        with self.store_env():
            rows = store.pipeline_run_list(ticket)
            if not rows:
                return None
            run = rows[-1]
            steps = store.pipeline_steps(run["id"])
        if run["state"] != "running":
            return None
        if not any(step["state"] == "running" for step in steps):
            return None
        return run, steps


class VerifyQueueTest(VerifyQueueCase):
    def test_hoechstens_zwei_gleichzeitig_und_dritter_startet_danach(self):
        repo = self.make_repo()
        events = os.path.join(self.tmp, "events.log")
        helper = os.path.join(self.tmp, "step.py")
        self._write(helper, HELPER)
        self.write_steps(
            repo, [{"name": "langsam", "run": f"{sys.executable} {helper}"}]
        )
        procs = []
        try:
            for _ in range(3):
                procs.append(
                    self.start_runner(repo, "T-1", env={"EVENT_FILE": events})
                )
            for proc in procs:
                out, err = proc.communicate(timeout=30)
                self.assertEqual(proc.returncode, 0, err)
                self.assertIn("pass", out)
        finally:
            for proc in procs:
                self.stop(proc)

        enters = []
        exits = []
        for line in self._read(events).splitlines():
            kind, _pid, at = line.split()
            target = enters if kind == "enter" else exits
            target.append(float(at))
        self.assertEqual(len(enters), 3)
        self.assertEqual(len(exits), 3)

        points = sorted(
            [(at, 1) for at in enters] + [(at, -1) for at in exits],
            key=lambda item: (item[0], item[1]),
        )
        running = 0
        peak = 0
        for _at, delta in points:
            running += delta
            peak = max(peak, running)
        self.assertLessEqual(peak, 2)

        # Die Warteschlange wirkt: Der dritte Start liegt nach einem Ende.
        self.assertGreater(sorted(enters)[2], min(exits))

    def test_wartender_lauf_ist_queued_und_in_fab_runs(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "kurz", "run": "sleep 0.3"}])
        holder = self.start_holder(2)
        proc = self.start_runner(repo, "T-9")
        try:
            self.assertTrue(
                self.wait_for(lambda: self.queued_run("T-9"), timeout=10)
            )

            data = json.loads(
                self.ok("runs", "--ticket", "T-9", "--json").stdout
            )
            self.assertEqual([row["state"] for row in data], ["queued"])

            text = self.ok("runs", "--ticket", "T-9").stdout
            self.assertIn("Warteschlange", text)
            self.assertNotIn("queued", text)

            self.stop(holder)
            out, err = proc.communicate(timeout=30)
            self.assertEqual(proc.returncode, 0, err)
            self.assertIn("pass", out)
            self.assertIn("Warteschlange", err)
            self.assertEqual(err.count("Warteschlange"), 1)

            # Slots werden nie gelöscht; nur das flock fällt weg.
            self.assertTrue(os.path.exists(self.slot_path(0)))
            self.assertTrue(os.path.exists(self.slot_path(1)))
        finally:
            self.stop(holder)
            self.stop(proc)

    def test_slot_eines_getoeteten_prozesses_wird_frei(self):
        repo = self.make_repo()
        self.write_roster(max_verify=1)
        self.write_steps(
            repo,
            [
                {"name": "lang", "run": "sleep 60"},
                {"name": "danach", "run": "true"},
            ],
        )
        killed = self.start_runner(repo, "T-5")
        second = None
        try:
            state = self.wait_for(lambda: self.running_run("T-5"), timeout=10)
            self.assertTrue(state, "Lauf startete nicht")
            run, _steps = state

            killed.kill()
            killed.wait(timeout=10)

            # Der zweite Runner startet erst nach dem Umschreiben der Pipeline.
            self.write_steps(repo, [{"name": "kurz", "run": "true"}])
            second = self.start_runner(repo, "T-6")
            out, err = second.communicate(timeout=10)
            self.assertEqual(second.returncode, 0, err)
            self.assertIn("pass", out)

            # Gegenprobe: Eine reine Zähler-Lösung bliebe hier hängen, weil der
            # per SIGKILL beendete Lauf seinen Zähler nicht freigibt. Das flock
            # fällt mit dem Prozess weg, der Slot ist also sofort frei.
            with self.store_env():
                killed_row = store.pipeline_run_load(run["id"])
                killed_steps = {
                    row["position"]: row["state"]
                    for row in store.pipeline_steps(run["id"])
                }
            # Der getötete Lauf kann seinen Endstatus nicht selbst schreiben;
            # der nächste Laufstart setzt ihn auf `fail` und räumt seine
            # Schritte auf.
            self.assertEqual(killed_row["state"], "fail")
            self.assertEqual(killed_steps, {0: "fail", 1: "skipped"})
        finally:
            self.stop(killed)
            if second is not None:
                self.stop(second)

    def test_laufender_lauf_wird_nicht_aufgeraeumt(self):
        repo = self.make_repo()
        self.write_roster(max_verify=2)
        self.write_steps(repo, [{"name": "lang", "run": "sleep 60"}])
        live = self.start_runner(repo, "T-7")
        second = None
        try:
            state = self.wait_for(lambda: self.running_run("T-7"), timeout=10)
            self.assertTrue(state, "Lauf startete nicht")
            run, _steps = state

            # Der zweite Start räumt verwaiste Läufe ab; dieser lebt noch.
            self.write_steps(repo, [{"name": "kurz", "run": "true"}])
            second = self.start_runner(repo, "T-8")
            out, err = second.communicate(timeout=15)
            self.assertEqual(second.returncode, 0, err)
            self.assertIn("pass", out)

            with self.store_env():
                live_row = store.pipeline_run_load(run["id"])
                live_steps = [
                    row["state"] for row in store.pipeline_steps(run["id"])
                ]
            self.assertEqual(live_row["state"], "running")
            self.assertEqual(live_steps, ["running"])
        finally:
            self.stop(live)
            if second is not None:
                self.stop(second)

    def test_wartender_getoeteter_lauf_endet_als_fail(self):
        repo = self.make_repo()
        self.write_roster(max_verify=1)
        self.write_steps(repo, [{"name": "lang", "run": "sleep 60"}])
        holder = self.start_holder(1)
        killed = self.start_runner(repo, "T-11")
        second = None
        try:
            def waiting():
                with self.store_env():
                    row = self.queued_run("T-11")
                    if not row:
                        return None
                    steps = store.pipeline_steps(row["id"])
                return row if steps else None

            queued = self.wait_for(waiting, timeout=10)
            self.assertTrue(queued, "Lauf wartete nicht")

            killed.kill()
            killed.wait(timeout=10)
            self.stop(holder)

            # Der nächste Start findet den verwaisten Wartenden und räumt ihn ab.
            self.write_steps(repo, [{"name": "kurz", "run": "true"}])
            second = self.start_runner(repo, "T-12")
            out, err = second.communicate(timeout=10)
            self.assertEqual(second.returncode, 0, err)
            self.assertIn("pass", out)

            with self.store_env():
                killed_row = store.pipeline_run_load(queued["id"])
                killed_steps = [
                    row["state"] for row in store.pipeline_steps(queued["id"])
                ]
            self.assertEqual(killed_row["state"], "fail")
            self.assertEqual(killed_steps, ["skipped"])
        finally:
            self.stop(holder)
            self.stop(killed)
            if second is not None:
                self.stop(second)

    def test_fertiger_lauf_wird_nicht_als_verwaist_ueberschrieben(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "eins", "run": "true"}])
        with self.store_env():
            run_id = store.pipeline_run_new(
                trigger="verify",
                ticket="T-2",
                repo=repo,
                worktree=repo,
                branch="main",
                head="a" * 40,
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
                store.pipeline_run_finish(target, "pass", 7)
                return snapshot

            with mock.patch.object(
                verifyslots, "abandoned", return_value=True
            ), mock.patch.object(
                store, "pipeline_steps", side_effect=stale_steps
            ):
                pipeline._reap_abandoned()

            row = store.pipeline_run_load(run_id)
            steps = store.pipeline_steps(run_id)

        self.assertEqual(row["state"], "pass")
        self.assertEqual(row["duration_ms"], 7)
        self.assertEqual([step["state"] for step in steps], ["pass"])

    def test_besitz_wird_erst_nach_dem_endstatus_freigegeben(self):
        repo = self.make_repo()
        self.write_steps(repo, [{"name": "eins", "run": "true"}])
        seen = {}
        real_finish = store.pipeline_run_finish

        def spy_finish(run_id, state, duration_ms):
            seen["state"] = state
            seen["abandoned"] = verifyslots.abandoned(run_id)
            return real_finish(run_id, state, duration_ms)

        with self.store_env(), mock.patch.dict(
            os.environ, {"FAB_ROSTER": self.roster}
        ), mock.patch.object(
            store, "pipeline_run_finish", side_effect=spy_finish
        ):
            result = pipeline.run(repo, "verify", ticket="T-2")

        self.assertEqual(result["state"], "pass")
        self.assertEqual(seen["state"], "pass")
        self.assertFalse(
            seen["abandoned"], "Besitz war beim Endstatus schon frei"
        )

    def test_wartezeit_zaehlt_nicht_ins_timeout(self):
        repo = self.make_repo()
        self.write_roster(max_verify=1)
        self.write_steps(repo, [{"name": "kurz", "run": "sleep 0.2"}])
        holder = self.start_holder(1)
        proc = self.start_runner(repo, "T-3", timeout=1)
        try:
            self.assertTrue(
                self.wait_for(lambda: self.queued_run("T-3"), timeout=10)
            )
            # Deutlich länger als das Schritt-Timeout von 1 s.
            time.sleep(1.2)
            self.stop(holder)
            out, err = proc.communicate(timeout=10)
            self.assertEqual(proc.returncode, 0, err)
            self.assertIn("pass", out)
        finally:
            self.stop(holder)
            self.stop(proc)

    def test_store_sperre_bleibt_waehrend_des_wartens_frei(self):
        repo = self.make_repo()
        self.write_roster(max_verify=1)
        self.write_steps(repo, [{"name": "langsam", "run": "sleep 0.3"}])
        holder = self.start_holder(1)
        proc = self.start_runner(repo, "T-4")
        try:
            self.assertTrue(
                self.wait_for(lambda: self.queued_run("T-4"), timeout=10)
            )

            # Der Runner schreibt Lauf und Schritte kurz vor dem Warten. Erst
            # wenn diese kurzen Transaktionen durch sind, muss die Sperre
            # dauerhaft frei sein – ohne Wanduhrbudget für die Sperre selbst.
            self.assertTrue(
                self.wait_for(self.lock_is_free, timeout=30),
                "Store-Sperre blieb belegt, während der Lauf wartet",
            )
            result = self.cli("list", timeout=120)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(self.queued_run("T-4"), "Lauf wartet nicht mehr")
            self.assertTrue(self.lock_is_free(), "Store-Sperre ist belegt")
        finally:
            self.stop(holder)
            self.stop(proc)

    def test_roster_max_verify_einstellbar(self):
        result = self.ok(
            "settings", "set", "max_verify", "3", "--from", "mensch"
        )
        self.assertIn("max_verify: — → 3", result.stdout)

        with mock.patch.dict(os.environ, self.env):
            self.assertEqual(agents.load()["max_verify"], 3)
        payload = json.loads(self.ok("roster", "--json").stdout)
        self.assertEqual(payload["max_verify"], 3)

        before = self._read(self.roster)
        for value in ("0", "17", "x"):
            bad = self.cli(
                "settings", "set", "max_verify", value, "--from", "mensch"
            )
            self.assertNotEqual(bad.returncode, 0, value)
            self.assertIn("max_verify", bad.stderr, value)
            self.assertEqual(self._read(self.roster), before, value)

    def test_wartezeit_limit_endet_mit_klarer_meldung(self):
        repo = self.make_repo()
        self.write_roster(max_verify=1)
        self.write_steps(repo, [{"name": "kurz", "run": "true"}])
        holder = self.start_holder(1)
        proc = self.start_runner(repo, "T-2", env={"FAB_VERIFY_WAIT": "0.5"})
        try:
            out, err = proc.communicate(timeout=30)
            self.assertEqual(proc.returncode, 2, err)
            self.assertIn("Warteschlange", err)
            self.assertIn("kein Prüfslot frei", err)
            self.assertNotIn("pass", out)
            with self.store_env():
                rows = store.pipeline_run_list("T-2")
            self.assertEqual([row["state"] for row in rows], ["fail"])
        finally:
            self.stop(holder)
            self.stop(proc)

    def test_belegter_echter_slot_blockiert_testlauf_nicht(self):
        """Die echte, systemweite Warteschlange liegt in einem eigenen Home."""
        real_home = os.path.join(self.tmp, "echtes-home")
        os.makedirs(real_home, exist_ok=True)
        holder = self.start_holder(2, home=real_home)
        try:
            repo = self.make_repo()
            self.write_steps(repo, [{"name": "kurz", "run": "true"}])
            proc = self.start_runner(repo, "T-8")
            try:
                out, err = proc.communicate(timeout=30)
            finally:
                self.stop(proc)
            self.assertEqual(proc.returncode, 0, err)
            self.assertIn("pass", out)

            # Der Lauf nutzt Slotdateien im Test-Home, nicht im echten Home.
            self.assertTrue(os.path.exists(self.slot_path(0)))
            self.assertTrue(
                os.path.exists(
                    os.path.join(real_home, "verify-slots", "slot-0.lock")
                )
            )
        finally:
            self.stop(holder)
