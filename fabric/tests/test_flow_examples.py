"""Beispiel-Workflows: laden und Probelauf-Pfad (T-55)."""
import json
import os

from fabric.fablib import flows
from fabric.tests.support import FabricCase

FABRIC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(FABRIC, "flows")


class FlowExamplesCase(FabricCase):
    def example(self, name):
        return os.path.join(FLOWS, f"{name}.json")

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
