"""Datenhaltung: Counter unter Lock, parallele IDs, unbekannte Felder."""
import json
import os
import subprocess
import sys

from fabric.tests.support import FAB, FabricCase


class StoreTests(FabricCase):
    def test_ids_laufen_auch_parallel_fort(self):
        script = [sys.executable, FAB, "new", "Parallel"]
        first = subprocess.Popen(script, cwd=self.tmp, env=self.env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        second = subprocess.Popen(script, cwd=self.tmp, env=self.env,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        results = []
        for process in (first, second):
            out, err = process.communicate(timeout=120)
            self.assertEqual(process.returncode, 0, err)
            results.append(out.strip())
        self.assertEqual(sorted(results), ["T-1", "T-2"])
        tickets = sorted(
            name for name in os.listdir(os.path.join(self.home, "tickets"))
            if name.endswith(".json")
        )
        self.assertEqual(tickets, ["T-1.json", "T-2.json"])
        with open(os.path.join(self.home, "counter"), encoding="utf-8") as handle:
            self.assertEqual(handle.read().strip(), "3")

    def test_counter_vergibt_keine_nummer_zweimal(self):
        first = self.new("Eins")
        self.assertEqual(first, "T-1")
        os.unlink(os.path.join(self.home, "tickets", f"{first}.json"))
        second = self.new("Zwei")
        self.assertEqual(second, "T-2")

    def test_unbekannte_felder_bleiben_erhalten(self):
        tid = self.new("Felder")
        ticket = self.ticket(tid)
        ticket["eigen"] = {"x": [1, 2]}
        ticket["notiz"] = "bleibt"
        path = os.path.join(self.home, "tickets", f"{tid}.json")
        self.write_file(path, json.dumps(ticket, ensure_ascii=False, indent=2))
        self.ok("status", tid, "doing", "--from", "mensch")
        self.ok("comment", tid, "--from", "zap", "hallo", "--no-wake")
        fresh = self.ticket(tid)
        self.assertEqual(fresh["eigen"], {"x": [1, 2]})
        self.assertEqual(fresh["notiz"], "bleibt")
        self.assertEqual(fresh["status"], "doing")
        self.assertEqual(len(fresh["comments"]), 2)

    def test_fehlende_felder_werden_ergaenzt(self):
        path = os.path.join(self.home, "tickets", "T-1.json")
        self.write_file(path, json.dumps({"id": "T-1", "title": "Alt"}))
        result = self.ok("show", "T-1", "--json")
        ticket = json.loads(result.stdout)
        for field in (
            "id", "title", "status", "body", "repo", "base", "branch", "worktree",
            "assignee", "blocked_by", "waiting", "created_at", "updated_at",
            "created_by", "comments", "sessions", "checks", "verdict",
        ):
            self.assertIn(field, ticket)
        self.assertEqual(ticket["status"], "draft")
        self.assertEqual(ticket["blocked_by"], [])
        self.assertIsNone(ticket["checks"])

    def test_index_ist_atomar_und_lesbar(self):
        tid = self.new("Atomar")
        payload = self.index()
        self.assertEqual(payload["tickets"][0]["id"], tid)
        self.assertFalse(os.path.exists(os.path.join(self.home, "index.json.tmp")))
