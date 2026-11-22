"""Datenhaltung: Counter unter Lock, parallele IDs, unbekannte Felder."""
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from unittest import mock

from fabric.fablib import store
from fabric.tests.support import FAB, FabricCase


class StoreTests(FabricCase):
    def test_locked_ist_im_prozess_reentrant(self):
        def scenario():
            with store.locked():
                with store.locked():
                    pass
            with store.locked():
                pass
            try:
                with store.locked():
                    with store.locked():
                        raise RuntimeError("innen")
            except RuntimeError:
                pass
            with store.locked():
                pass
            try:
                with store.locked():
                    raise RuntimeError("außen")
            except RuntimeError:
                pass
            with store.locked():
                pass

        errors = []

        def run():
            try:
                with mock.patch.dict(os.environ, {"FAB_HOME": self.home}):
                    scenario()
            except BaseException as exc:  # noqa: BLE001 - Fehler an den Test weiterreichen
                errors.append(exc)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        thread.join(20)
        self.assertFalse(thread.is_alive(), "verschachteltes locked() blockiert")
        if errors:
            raise errors[0]

    def test_ids_laufen_auch_parallel_fort(self):
        script = [sys.executable, FAB, "new", "Parallel", "--repo", self.default_repo()]
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
        self.assertTrue(os.path.isfile(os.path.join(self.home, "tickets", "T-1.json")))
        self.assertTrue(os.path.isfile(os.path.join(self.home, "tickets", "T-2.json")))
        third = self.new("Drittes")
        self.assertEqual(third, "T-3")

    def test_counter_vergibt_keine_nummer_zweimal(self):
        with self.store_env():
            with store.locked():
                first = store.next_id()
                second = store.next_id()
        self.assertEqual(first, "T-1")
        self.assertEqual(second, "T-2")

    def test_unbekannte_felder_bleiben_erhalten(self):
        tid = self.new("Felder")
        self.patch_ticket(tid, eigen={"x": [1, 2]}, notiz="bleibt")
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
        legacy = os.path.join(self.home, "legacy", "tickets", "T-1.json")
        self.assertTrue(os.path.isfile(legacy))
        self.assertIn("tickets", self.storage()["tables"])

    def test_index_ist_atomar_und_lesbar(self):
        tid = self.new("Atomar")
        payload = self.index()
        self.assertEqual(payload["tickets"][0]["id"], tid)
        self.assertFalse(os.path.exists(os.path.join(self.home, "index.json.tmp")))

    def test_jetzt_liest_naive_lokale_iso_zeit(self):
        with mock.patch.dict(os.environ, {"FAB_NOW": "2026-11-22T12:00:00"}):
            self.assertEqual(
                store.now_ms(),
                int(datetime(2026, 11, 22, 12, 0).timestamp() * 1000),
            )

    def test_jetzt_gibt_millisekunden_unveraendert_zurueck(self):
        with mock.patch.dict(os.environ, {"FAB_NOW": "1700000000123"}):
            self.assertEqual(store.now_ms(), 1700000000123)

    def test_jetzt_ohne_fab_now_nutzt_die_echte_uhr(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("FAB_NOW", None)
            before = time.time() * 1000
            value = store.now_ms()
            after = time.time() * 1000
        self.assertGreaterEqual(value, int(before))
        self.assertLessEqual(value, int(after))
