"""Vorschau-Instanz je Worktree: start, shot, stop und Prompt-Doku."""
import contextlib
import io
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from unittest import mock

from fabric.fablib import preview as preview_mod
from fabric.fablib.errors import FabError
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

    def preview_area(self):
        root = os.path.join(self.tmp, "preview")
        self.env["FAB_PREVIEW_ROOT"] = root
        previous = os.environ.get("FAB_PREVIEW_ROOT")
        os.environ["FAB_PREVIEW_ROOT"] = root

        def restore():
            if previous is None:
                os.environ.pop("FAB_PREVIEW_ROOT", None)
            else:
                os.environ["FAB_PREVIEW_ROOT"] = previous

        self.addCleanup(restore)
        return root

    def _kill(self, proc):
        if preview_mod._pid_alive(proc.pid):
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

    def spawn(self, code, *, cwd=None, marker=None, arg=None):
        env = dict(self.env)
        if marker is not None:
            env[preview_mod.MARKER_ENV] = marker
        proc = subprocess.Popen(
            [sys.executable, "-c", code, arg or self.tmp],
            cwd=cwd or self.tmp,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        self.addCleanup(self._kill, proc)
        return proc

    def identity_state(self, tid, proc, *, marker, started=None, home=None):
        root = self.preview_root(tid)
        home = home or os.path.join(root, "home")
        os.makedirs(home, exist_ok=True)
        state = {
            "ticket": tid,
            "pid": proc.pid,
            "pgid": os.getpgid(proc.pid),
            "started": (
                started if started is not None
                else preview_mod._process_started(proc.pid)
            ),
            "marker": marker,
            "session": preview_mod._session_name(tid),
            "home": home,
            "userhome": os.path.join(root, "userhome"),
            "fab_home": os.path.join(home, "data", "fabric"),
            "log": os.path.join(root, "app.log"),
        }
        preview_mod._write_state(tid, state)
        return state

    def stop_quietly(self, tid):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            preview_mod.stop(tid)
        return err.getvalue()

    def test_stop_beendet_fremden_prozess_mit_gleicher_pid_nicht(self):
        self.preview_area()
        tid = "T-1"
        proc = self.spawn("import time; time.sleep(60)")
        self.identity_state(tid, proc, marker="nicht-der-fremde-prozess")

        notice = self.stop_quietly(tid)

        self.assertTrue(preview_mod._pid_alive(proc.pid))
        self.assertFalse(
            os.path.exists(os.path.join(self.preview_root(tid), "preview.json"))
        )
        self.assertIn("kein Signal", notice)

    def test_stop_prueft_startzeit(self):
        self.preview_area()
        tid = "T-1"
        proc = self.spawn("import time; time.sleep(60)", marker="marker-1")
        self.identity_state(
            tid, proc, marker="marker-1", started="Mon Jan  1 00:00:00 2001"
        )

        self.stop_quietly(tid)

        self.assertTrue(preview_mod._pid_alive(proc.pid))
        self.assertFalse(
            os.path.exists(os.path.join(self.preview_root(tid), "preview.json"))
        )

    def test_stop_ohne_marker_sendet_kein_signal(self):
        self.preview_area()
        tid = "T-1"
        proc = self.spawn("import time; time.sleep(60)", marker="marker-1")
        state = self.identity_state(tid, proc, marker="")

        preview_mod._terminate(state)

        self.assertTrue(preview_mod._pid_alive(proc.pid))

    def test_stop_beendet_eigenen_prozess_mit_kind(self):
        self.preview_area()
        tid = "T-1"
        root = self.preview_root(tid)
        home = os.path.join(root, "home")
        os.makedirs(home, exist_ok=True)
        child_file = os.path.join(self.tmp, "child.pid")
        code = (
            "import subprocess, sys, time\n"
            "p = subprocess.Popen(['sleep', '60'])\n"
            "open(sys.argv[1], 'w').write(str(p.pid))\n"
            "time.sleep(60)\n"
        )
        proc = self.spawn(code, cwd=home, marker="marker-1", arg=child_file)
        self.assertTrue(
            self.wait_for(lambda: os.path.isfile(child_file) and self._text(child_file))
        )
        child = int(self._text(child_file))
        self.identity_state(tid, proc, marker="marker-1", home=home)

        self.stop_quietly(tid)

        self.assertTrue(self.wait_for(lambda: proc.poll() is not None))
        self.assertTrue(self.wait_for(lambda: not preview_mod._pid_alive(child)))
        self.assertFalse(os.path.exists(root))

    def test_sigkill_nach_erneuter_identitaetspruefung(self):
        self.preview_area()
        tid = "T-1"
        root = self.preview_root(tid)
        home = os.path.join(root, "home")
        os.makedirs(home, exist_ok=True)
        pid_file = os.path.join(self.tmp, "pid")
        code = (
            "import os, signal, sys, time\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "open(sys.argv[1], 'w').write(str(os.getpid()))\n"
            "time.sleep(60)\n"
        )
        proc = self.spawn(code, cwd=home, marker="marker-1", arg=pid_file)
        self.assertTrue(self.wait_for(lambda: os.path.isfile(pid_file)))
        state = self.identity_state(tid, proc, marker="marker-1", home=home)

        preview_mod._terminate(state, timeout=0.2)

        self.assertTrue(self.wait_for(lambda: proc.poll() is not None))

    def test_startfehler_beendet_eigenen_prozess(self):
        self.preview_area()
        tid = "T-1"
        root = self.preview_root(tid)
        home = os.path.join(root, "home")
        os.makedirs(home, exist_ok=True)
        proc = self.spawn("import time; time.sleep(60)", cwd=home, marker="marker-1")
        state = self.identity_state(tid, proc, marker="marker-1", home=home)

        with mock.patch.dict(os.environ, {"HERDR_APP_FAIL": "1"}), \
                mock.patch.object(preview_mod, "START_TIMEOUT", 0.05), \
                mock.patch.object(preview_mod, "POLL", 0.01):
            with self.assertRaises(FabError):
                preview_mod._wait_ready(state, tid)

        self.assertTrue(self.wait_for(lambda: proc.poll() is not None))

    def test_is_running_meldet_fremden_prozess_als_beendet(self):
        self.preview_area()
        tid = "T-1"
        proc = self.spawn("import time; time.sleep(60)")
        preview_mod._write_state(tid, {"pid": proc.pid, "ticket": tid})

        self.assertFalse(preview_mod.is_running(tid))
        self.assertTrue(preview_mod._pid_alive(proc.pid))

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
