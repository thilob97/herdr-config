"""Vorschau-Instanz je Worktree: start, shot, stop und Prompt-Doku."""
import json
import os
import shutil

from fabric.tests.support import FABRIC, FabricCase


class PreviewTests(FabricCase):
    def preview_root(self, tid):
        return os.path.join(self.env["FAB_PREVIEW_ROOT"], tid)

    def preview_ticket(self):
        self.env["FAB_PREVIEW_ROOT"] = os.path.join(self.tmp, "preview")
        repo, tid, worktree = self.ready_ticket()
        self.write_file(
            os.path.join(worktree, "mods", "demo", "main.js"), "export default {}\n"
        )
        self.write_file(os.path.join(worktree, "mods", "demo", "mod.json"), "{}\n")
        self.write_file(os.path.join(worktree, "settings.json"), '{"a": 1}\n')
        self.write_file(os.path.join(worktree, "keys.json"), '{"k": "v"}\n')
        self.write_file(
            os.path.join(worktree, "layouts", "fabric.json"), '{"l": 1}\n'
        )
        root = self.preview_root(tid)
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self.addCleanup(self.cli, "preview", "stop", tid)
        shutil.rmtree(root, ignore_errors=True)
        return repo, tid, worktree

    def _bytes(self, path):
        with open(path, "rb") as handle:
            return handle.read()

    def _text(self, path):
        with open(path, encoding="utf-8") as handle:
            return handle.read()

    def test_start_kopiert_worktree_und_seedet_eigene_daten(self):
        repo, tid, worktree = self.preview_ticket()
        canary = os.path.join(
            self.fake_home, ".config", "herdr-app", "settings.json"
        )
        self.write_file(canary, '{"canary": true}\n')
        real_ticket = os.path.join(self.home, "tickets", f"{tid}.json")
        real_index = os.path.join(self.home, "index.json")
        canary_before = self._bytes(canary)
        ticket_before = self._bytes(real_ticket)
        index_before = self._bytes(real_index)

        result = self.ok("preview", "start", tid, env={"HERDR_APP_SLEEP": "1"})
        self.assertIn("Vorschau läuft", result.stdout)

        root = self.preview_root(tid)
        home = os.path.join(root, "home")
        self.assertEqual(
            self._text(os.path.join(home, "mods", "demo", "main.js")),
            "export default {}\n",
        )
        self.assertEqual(
            self._text(os.path.join(home, "settings.json")), '{"a": 1}\n'
        )
        self.assertEqual(self._text(os.path.join(home, "keys.json")), '{"k": "v"}\n')
        self.assertEqual(
            self._text(os.path.join(home, "layouts", "fabric.json")), '{"l": 1}\n'
        )

        fab_home = os.path.join(home, "data", "fabric")
        self.assertTrue(os.path.isdir(fab_home))
        tickets_dir = os.path.join(fab_home, "tickets")
        seeded = sorted(os.listdir(tickets_dir))
        self.assertTrue(seeded, tickets_dir)
        seeded_ticket = json.loads(
            self._text(os.path.join(tickets_dir, seeded[0]))
        )
        self.assertIn("Vorschau", seeded_ticket["title"])

        self.assertEqual(self._bytes(canary), canary_before)
        self.assertEqual(self._bytes(real_ticket), ticket_before)
        self.assertEqual(self._bytes(real_index), index_before)
        self.assertIn(["status"], self.herdr_calls())

    def test_shot_haengt_png_ans_ticket(self):
        repo, tid, worktree = self.preview_ticket()
        self.ok("preview", "start", tid, env={"HERDR_APP_SLEEP": "1"})
        result = self.ok("preview", "shot", tid)
        png = result.stdout.splitlines()[0]
        self.assertTrue(os.path.isabs(png), png)
        self.assertTrue(os.path.isfile(png), png)
        with open(png, "rb") as handle:
            self.assertEqual(handle.read(), b"\x89PNG\r\n\x1a\nstub")

        ticket = self.ticket(tid)
        self.assertTrue(ticket["attachments"])
        self.assertTrue(
            any(item["path"].endswith(".png") for item in ticket["attachments"]),
            ticket["attachments"],
        )
        self.assertIn("![", ticket["body"])
        self.assertIn("data/fabric/attachments/", result.stdout)

    def test_stop_beendet_prozess_und_raeumt_auf(self):
        repo, tid, worktree = self.preview_ticket()
        self.ok("preview", "start", tid, env={"HERDR_APP_SLEEP": "1"})
        root = self.preview_root(tid)
        state = json.loads(self._text(os.path.join(root, "preview.json")))
        pid = state["pid"]

        result = self.ok("preview", "stop", tid)
        self.assertIn("Vorschau beendet", result.stdout)
        self.assertFalse(os.path.exists(root))
        with self.assertRaises(OSError):
            os.kill(pid, 0)
        self.assertIn(["server", "stop"], self.hc_calls("server"))

    def test_start_seedet_repos_und_kontextseite(self):
        repo, tid, worktree = self.preview_ticket()
        shared_path = os.path.join(self.preview_root(tid), "home", "shared.json")
        self.ok(
            "preview", "start", tid, "--page", "repos",
            env={"HERDR_APP_SLEEP": "1"},
        )
        seeded = json.loads(self._text(shared_path))
        self.assertEqual(seeded["fabric.route"], {"page": "repos"})
        self.assertNotIn("fabric.contextPreview", seeded)

        self.ok("preview", "stop", tid)
        self.ok(
            "preview", "start", tid, "--page", "context",
            env={"HERDR_APP_SLEEP": "1"},
        )
        seeded = json.loads(self._text(shared_path))
        self.assertEqual(seeded["fabric.route"], {"page": "ticket"})
        preview = seeded["fabric.contextPreview"]
        self.assertEqual(preview["kind"], "ticket")
        self.assertEqual(preview["ref"], "T-1")
        self.assertIsInstance(preview["at"], int)
        self.assertGreater(preview["at"], 0)

    def test_preamble_erklaert_vorschau(self):
        text = self._text(os.path.join(FABRIC, "prompts", "preamble.md"))
        self.assertIn("fab preview", text)
        self.assertIn("fab preview shot", text)
