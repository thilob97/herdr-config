"""Beispiel-Workflows: laden und Probelauf-Pfad (T-55)."""
import json
import os
import subprocess

from fabric.fablib import flows, store
from fabric.tests.support import FabricCase

FABRIC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(FABRIC, "flows")


class FlowExamplesCase(FabricCase):
    def example(self, name):
        return os.path.join(FLOWS, f"{name}.json")

    def node(self, name, node_id):
        with open(self.example(name), encoding="utf-8") as handle:
            definition = json.load(handle)
        return next(node for node in definition["nodes"] if node["id"] == node_id)

    def add(self, name):
        return self.ok("flow", "add", self.example(name))

    def dry(self, name):
        return self.ok("flow", "run", name, "--dry").stdout

    def test_nachtschicht_loads_and_plans(self):
        result = self.add("nachtschicht")
        self.assertIn("Workflow „nachtschicht“ gespeichert", result.stdout)
        self.assertIn(
            "start → nachtfenster → pause-pruefen → abnahme → main-pruefen → wache → ende",
            self.dry("nachtschicht"),
        )

    def test_projektkarte_loads_and_plans(self):
        result = self.add("projektkarte")
        self.assertIn("Workflow „projektkarte“ gespeichert", result.stdout)
        self.assertIn(
            "start → nachtfenster → karte → ende",
            self.dry("projektkarte"),
        )

    def test_deps_montag_loads_and_plans(self):
        result = self.add("deps-montag")
        self.assertIn("Workflow „deps-montag“ gespeichert", result.stdout)
        self.assertIn(
            "start → montag → deps → verify → freigabe → ende",
            self.dry("deps-montag"),
        )

    def test_both_files_validate(self):
        for name in ("nachtschicht", "deps-montag", "projektkarte"):
            with open(self.example(name), encoding="utf-8") as handle:
                definition = json.load(handle)
            cleaned = flows.validate(definition)
            self.assertEqual(cleaned["name"], name)
            self.assertEqual(len(cleaned["nodes"]), len(definition["nodes"]))

    def nachtfenster_at(self, clock):
        bindir = os.path.join(self.tmp, f"clock-{clock}")
        os.makedirs(bindir, exist_ok=True)
        fake_date = os.path.join(bindir, "date")
        self.write_file(fake_date, f"#!/bin/sh\necho {clock}\n")
        os.chmod(fake_date, 0o755)
        env = dict(self.env, PATH=bindir + os.pathsep + self.env.get("PATH", ""))
        command = self.node("nachtschicht", "nachtfenster")["command"]
        return subprocess.run(
            command, shell=True, cwd=self.tmp, env=env,
            capture_output=True, text=True,
        )

    def test_nachtfenster_only_runs_in_night_window(self):
        for clock in ("0000", "1200", "1759", "2330", "2359"):
            with self.subTest(clock=clock):
                self.assertNotEqual(
                    self.nachtfenster_at(clock).returncode, 0,
                    f"{clock} liegt außerhalb des Nachtfensters",
                )
        for clock in ("1800", "2000", "2329"):
            with self.subTest(clock=clock):
                self.assertEqual(
                    self.nachtfenster_at(clock).returncode, 0,
                    f"{clock} liegt im Nachtfenster",
                )

    def test_nachtschicht_outside_window_ends_without_ticket(self):
        self.add("nachtschicht")
        bindir = os.path.join(self.tmp, "clock-1200")
        os.makedirs(bindir, exist_ok=True)
        fake_date = os.path.join(bindir, "date")
        self.write_file(fake_date, "#!/bin/sh\necho 1200\n")
        os.chmod(fake_date, 0o755)
        env = {"PATH": bindir + os.pathsep + self.env.get("PATH", "")}

        result = self.ok("flow", "run", "nachtschicht", env=env)
        self.assertIn("Lauf 1", result.stdout)

        with self.store_env():
            runs = store.flow_run_list("nachtschicht")
            self.assertEqual(len(runs), 1)
            self.assertEqual(runs[0]["status"], "done")
            self.assertEqual(runs[0]["reason"], "")
            self.assertEqual(runs[0]["data"].get("current"), "ende")
            steps = [(step["node"], step["status"])
                     for step in store.flow_steps(runs[0]["id"])]
            self.assertIn(("nachtfenster", "fail"), steps)
            self.assertIn(("ende", "done"), steps)
            self.assertNotIn("pause-pruefen", [node for node, _ in steps])
            self.assertNotIn("abnahme", [node for node, _ in steps])
            self.assertEqual(store.all_tickets(), [])

    def projektkarte_env(self, clock):
        bindir = os.path.join(self.tmp, f"projektkarte-clock-{clock}")
        os.makedirs(bindir, exist_ok=True)
        fake_date = os.path.join(bindir, "date")
        self.write_file(fake_date, f"#!/bin/sh\necho {clock}\n")
        os.chmod(fake_date, 0o755)
        return {"PATH": bindir + os.pathsep + self.env.get("PATH", "")}

    def test_projektkarte_only_runs_in_window(self):
        for clock in ("0200", "0230", "0259"):
            with self.subTest(clock=clock):
                result = subprocess.run(
                    self.node("projektkarte", "nachtfenster")["command"],
                    shell=True, cwd=self.tmp,
                    env=dict(self.env, **self.projektkarte_env(clock)),
                    capture_output=True, text=True,
                )
                self.assertEqual(
                    result.returncode, 0,
                    f"{clock} liegt im Projektkarte-Fenster",
                )
        for clock in ("0000", "0159", "0300", "1200", "2359"):
            with self.subTest(clock=clock):
                result = subprocess.run(
                    self.node("projektkarte", "nachtfenster")["command"],
                    shell=True, cwd=self.tmp,
                    env=dict(self.env, **self.projektkarte_env(clock)),
                    capture_output=True, text=True,
                )
                self.assertNotEqual(
                    result.returncode, 0,
                    f"{clock} liegt außerhalb des Projektkarte-Fensters",
                )

    def test_projektkarte_runs_in_window_and_commits_map(self):
        repo = self.make_repo()
        self.add("projektkarte")
        result = self.ok(
            "flow", "run", "projektkarte",
            env=self.projektkarte_env("0230"), cwd=repo,
        )
        self.assertIn("Lauf 1", result.stdout)
        self.assertTrue(os.path.isfile(os.path.join(repo, ".fabric", "map.md")))
        self.assertEqual(self.git_out(repo, "status", "--porcelain"), "")
        self.assertEqual(
            self.git_out(repo, "ls-files", ".fabric/map.md"), ".fabric/map.md"
        )

    def test_projektkarte_outside_window_skips_map(self):
        repo = self.make_repo()
        self.add("projektkarte")
        result = self.ok(
            "flow", "run", "projektkarte",
            env=self.projektkarte_env("1200"), cwd=repo,
        )
        self.assertIn("Lauf 1", result.stdout)
        self.assertFalse(os.path.exists(os.path.join(repo, ".fabric", "map.md")))

        with self.store_env():
            runs = store.flow_run_list("projektkarte")
            self.assertEqual(len(runs), 1)
            self.assertEqual(runs[0]["status"], "done")
            self.assertEqual(runs[0]["data"].get("current"), "ende")
            nodes = [step["node"] for step in store.flow_steps(runs[0]["id"])]
        self.assertNotIn("karte", nodes)

    def test_revert_command_handles_merge_commit(self):
        repo = self.make_repo()
        self.git_out(repo, "checkout", "-q", "-b", "feature")
        self.write_file(os.path.join(repo, "feature.txt"), "neu\n")
        self.git_out(repo, "add", "feature.txt")
        self.git_out(repo, "commit", "-qm", "feature")
        self.git_out(repo, "checkout", "-q", "main")
        self.write_file(os.path.join(repo, "main.txt"), "main\n")
        self.git_out(repo, "add", "main.txt")
        self.git_out(repo, "commit", "-qm", "main")
        self.git_out(repo, "merge", "--no-ff", "-m", "merge feature", "feature")

        command = self.node("nachtschicht", "revert")["command"]
        result = subprocess.run(
            command, shell=True, cwd=repo, env=dict(self.env, HOME=self.fake_home),
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(
            os.path.exists(os.path.join(self.fake_home, ".herdr", "autopilot-pause"))
        )
        self.assertEqual(self.git_out(repo, "status", "--porcelain"), "")
