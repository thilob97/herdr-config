"""Beispiel-Workflows: laden und Probelauf-Pfad (T-55)."""
import json
import os
import subprocess

from fabric.fablib import flows
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

    def test_deps_montag_loads_and_plans(self):
        result = self.add("deps-montag")
        self.assertIn("Workflow „deps-montag“ gespeichert", result.stdout)
        self.assertIn(
            "start → montag → deps → verify → freigabe → ende",
            self.dry("deps-montag"),
        )

    def test_both_files_validate(self):
        for name in ("nachtschicht", "deps-montag"):
            with open(self.example(name), encoding="utf-8") as handle:
                definition = json.load(handle)
            cleaned = flows.validate(definition)
            self.assertEqual(cleaned["name"], name)
            self.assertEqual(len(cleaned["nodes"]), len(definition["nodes"]))

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
