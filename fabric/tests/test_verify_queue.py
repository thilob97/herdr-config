"""Warteschlange für Prüfläufe: höchstens `max_verify` gleichzeitig (T-105).

Die Tests starten echte Subprozesse, weil Slots prozessübergreifend wirken.
Zeitvergleiche nutzen ausschließlich `time.monotonic()`.
"""
import json
import os
import subprocess
import sys
import time
from unittest import mock

from fabric.fablib import agents, pipeline, store
from fabric.tests.support import FabricCase

ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

RUNNER = """
import sys

from fabric.fablib import pipeline

repo, ticket = sys.argv[1], sys.argv[2]
timeout = float(sys.argv[3]) if len(sys.argv) > 3 else None
result = pipeline.run(repo, ticket=ticket, repo=repo, timeout=timeout)
print(result["state"])
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

    def write_slot(self, index, pid):
        path = self.slot_path(index)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(str(pid))
        return path

    def remove_slots(self, *indexes):
        for index in indexes:
            try:
                os.unlink(self.slot_path(index))
            except FileNotFoundError:
                pass

    def start_runner(self, repo, ticket, timeout=None, env=None):
        merged = dict(self.env)
        merged.update(env or {})
        parts = [ROOT]
        if merged.get("PYTHONPATH"):
            parts.append(merged["PYTHONPATH"])
        merged["PYTHONPATH"] = os.pathsep.join(parts)
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

    def stop(self, proc):
        if proc.poll() is None:
            proc.kill()
        try:
            proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()

    def queued_run(self, ticket):
        with self.store_env():
            rows = store.pipeline_run_list(ticket)
        return next((row for row in rows if row["state"] == "queued"), None)


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
        self.write_slot(0, os.getpid())
        self.write_slot(1, os.getpid())
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

            self.remove_slots(0, 1)
            out, err = proc.communicate(timeout=30)
            self.assertEqual(proc.returncode, 0, err)
            self.assertIn("pass", out)
            self.assertIn("Warteschlange", err)
            self.assertEqual(err.count("Warteschlange"), 1)
        finally:
            self.stop(proc)
            self.remove_slots(0, 1)

    def test_slot_eines_getoeteten_prozesses_wird_frei(self):
        repo = self.make_repo()
        self.write_roster(max_verify=1)
        self.write_steps(repo, [{"name": "ok", "run": "true"}])

        victim = subprocess.Popen(["sleep", "60"])
        pid = victim.pid
        victim.kill()
        victim.wait(timeout=10)

        # Gegenprobe: Eine reine Zähler-Lösung bliebe hier hängen, weil ein mit
        # SIGKILL beendeter Prozess seinen Zähler nicht mehr dekrementiert.
        # Die PID-Prüfung gibt den Slot beim nächsten Versuch frei.
        self.write_slot(0, pid)

        with mock.patch.dict(os.environ, self.env):
            result = pipeline.run(repo, ticket="T-2", repo=repo)
        self.assertEqual(result["state"], "pass")
        self.assertFalse(os.path.exists(self.slot_path(0)))

    def test_wartezeit_zaehlt_nicht_ins_timeout(self):
        repo = self.make_repo()
        self.write_roster(max_verify=1)
        self.write_steps(repo, [{"name": "kurz", "run": "sleep 0.2"}])
        self.write_slot(0, os.getpid())
        proc = self.start_runner(repo, "T-3", timeout=1)
        try:
            self.assertTrue(
                self.wait_for(lambda: self.queued_run("T-3"), timeout=10)
            )
            # Deutlich länger als das Schritt-Timeout von 1 s.
            time.sleep(1.2)
            self.remove_slots(0)
            out, err = proc.communicate(timeout=10)
            self.assertEqual(proc.returncode, 0, err)
            self.assertIn("pass", out)
        finally:
            self.remove_slots(0)
            self.stop(proc)

    def test_store_sperre_bleibt_waehrend_des_wartens_frei(self):
        repo = self.make_repo()
        self.write_roster(max_verify=1)
        self.write_steps(repo, [{"name": "langsam", "run": "sleep 0.3"}])
        self.write_slot(0, os.getpid())
        proc = self.start_runner(repo, "T-4")
        try:
            self.assertTrue(
                self.wait_for(lambda: self.queued_run("T-4"), timeout=10)
            )

            started = time.monotonic()
            self.ok("list")
            self.assertLess(time.monotonic() - started, 1.5)

            started = time.monotonic()
            with self.store_env():
                with store.locked(timeout=1):
                    pass
            self.assertLess(time.monotonic() - started, 1.5)
        finally:
            self.remove_slots(0)
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
