"""Alarm-Engine: roter main, Pause, Stillstand und Quittieren."""
import json
import os
import re
from unittest import mock

from fabric.fablib import alarm, autopilot, index, store
from fabric.tests.support import FabricCase


class AlarmTests(FabricCase):
    def setUp(self):
        super().setUp()
        patcher = mock.patch.dict(
            os.environ,
            {"FAB_HOME": self.home, "FAB_NOW": ""},
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def main_run(
        self,
        state="fail",
        ticket="T-70",
        repo=None,
        head="",
        steps=(("mod-fabric", "fail"), ("check-fabric", "skipped")),
    ):
        with store.locked():
            run = store.pipeline_run_new(
                trigger="main",
                ticket=ticket or None,
                repo=repo or self.home,
                worktree=repo or self.home,
                branch="main",
                head=head,
            )
            for position, (name, step_state) in enumerate(steps):
                store.pipeline_step_add(
                    run, position, name, "sh", step_state,
                    exit_code=1 if step_state == "fail" else None,
                    stderr="not ok 7 - Alarm-Banner" if step_state == "fail" else "",
                )
            store.pipeline_run_finish(run, state, 1000)
        return run

    def run_at(self, now, **kwargs):
        with mock.patch.dict(os.environ, {"FAB_NOW": str(now)}):
            return self.main_run(**kwargs)

    def test_main_fail_erzeugt_alarm_mit_schritt_und_ticket(self):
        run = self.main_run(ticket="T-70")
        state = alarm.status()
        self.assertTrue(state["active"])
        self.assertEqual(state["count"], 1)
        item = state["alarms"][0]
        self.assertEqual(item["kind"], "main")
        self.assertEqual(item["id"], f"main:{run}")
        self.assertEqual(item["run"], run)
        self.assertEqual(item["ticket"], "T-70")
        self.assertEqual(item["step"], "mod-fabric")
        self.assertRegex(item["text"], r"\d{2}:\d{2}")
        self.assertIn("T-70", item["text"])
        self.assertIn("Schritt mod-fabric fehlgeschlagen", item["text"])
        self.assertEqual(item["actions"][-1], "ack")

    def test_revert_wird_aus_git_erkannt_und_ticket_aus_merge_titel(self):
        repo = self.make_repo("alarm-repo")
        self.git_out(repo, "checkout", "-q", "-b", "topic")
        self._write(os.path.join(repo, "topic.txt"), "thema\n")
        self.git_out(repo, "add", "topic.txt")
        self.git_out(repo, "commit", "-qm", "T-70 Thema")
        self.git_out(repo, "checkout", "-q", "main")
        self.git_out(
            repo, "merge", "--no-ff", "-m", "Merge fab/T-70-rot: Titel", "topic"
        )
        merge = self.git_out(repo, "rev-parse", "HEAD")
        self.git_out(repo, "revert", "-m", "1", "--no-edit", "HEAD")

        self.main_run(ticket="", repo=repo, head=merge)
        item = alarm.status()["alarms"][0]
        self.assertTrue(item["reverted"])
        self.assertEqual(item["ticket"], "T-70")
        self.assertIn("T-70 zurückgenommen", item["text"])

    def test_pause_alarm_und_unterdrueckung_durch_main(self):
        now = 1800000000000
        with mock.patch.dict(os.environ, {"FAB_NOW": str(now)}):
            autopilot.write_state("paused", reason="main nach Merge rot – Abnahmen pausiert")
        state = alarm.status()
        self.assertEqual([item["kind"] for item in state["alarms"]], ["pause"])
        item = state["alarms"][0]
        self.assertIn("Autopilot pausiert", item["text"])
        self.assertEqual(item["actions"], ["resume", "ack"])
        self.assertEqual(item["id"], f"pause:{now}")

        self.main_run(ticket="T-70")
        alarms = alarm.status()["alarms"]
        self.assertEqual([item["kind"] for item in alarms], ["main"])
        self.assertTrue(alarms[0]["paused"])
        self.assertIn("resume", alarms[0]["actions"])

    def test_ack_quittiert_auch_die_unterdrueckte_pause(self):
        with mock.patch.dict(os.environ, {"FAB_NOW": "1800000000000"}):
            autopilot.write_state("paused", reason="rot")
        self.main_run(ticket="T-70")
        self.assertEqual(len(alarm.status()["alarms"]), 1)
        acked = alarm.ack()
        self.assertEqual(len(acked), 2)
        self.assertTrue(any(item.startswith("main:") for item in acked))
        self.assertTrue(any(item.startswith("pause:") for item in acked))
        self.assertEqual(alarm.status()["alarms"], [])

    def test_naechster_gruener_main_lauf_loescht_den_alarm(self):
        self.main_run(state="fail")
        self.assertEqual(len(alarm.status()["alarms"]), 1)
        self.main_run(state="pass")
        self.assertFalse(alarm.status()["active"])

    def test_ack_gilt_nur_fuer_den_quittierten_lauf(self):
        first = self.main_run(state="fail")
        self.assertEqual(alarm.ack(), [f"main:{first}"])
        self.assertEqual(alarm.status()["alarms"], [])
        self.assertEqual(alarm.status()["alarms"], [])
        second = self.main_run(state="fail")
        self.assertNotEqual(first, second)
        self.assertEqual(
            [item["id"] for item in alarm.status()["alarms"]], [f"main:{second}"]
        )

    def test_inbox_hat_genau_einen_stabilen_alarm_eintrag(self):
        self.main_run(ticket="T-70")
        first = [row for row in index.build()["inbox"] if row.get("alarm")]
        second = [row for row in index.build()["inbox"] if row.get("alarm")]
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["id"], second[0]["id"])
        self.assertTrue(first[0]["id"].startswith("attention:main:"))
        self.assertEqual(first[0]["kind"], "attention")

        with store.locked():
            alarm.ack()
        after = [row for row in index.build()["inbox"] if row.get("alarm")]
        self.assertEqual(after, [])

    def test_tick_alarm_erscheint_in_inbox_und_verschwindet_nach_ack(self):
        now = 1800000000000
        last = now - 6 * 60 * 1000
        with store.locked():
            store.set_last_tick(last)
        with mock.patch.dict(os.environ, {"FAB_NOW": str(now)}):
            item = alarm.status()["alarms"][0]
            self.assertEqual(item["kind"], "tick")
            self.assertEqual(item["id"], f"tick:{last}")
            self.assertIn("fab tick", item["text"])

            inbox = [row for row in index.build()["inbox"] if row.get("alarm")]
            self.assertEqual(len(inbox), 1)
            self.assertEqual(inbox[0]["id"], f"attention:tick:{last}")
            self.assertEqual(inbox[0]["kind"], "attention")
            self.assertEqual(inbox[0]["since"], last)

            alarm.ack()
            self.assertEqual(alarm.status()["alarms"], [])
            self.assertEqual(
                [row for row in index.build()["inbox"] if row.get("alarm")], []
            )

    def test_main_pruefung_veroeffentlicht_alarm_im_index(self):
        self.main_run(ticket="T-70")
        autopilot._rebuild_index()
        payload = self.index()
        self.assertTrue(payload["alarm"]["active"])
        self.assertEqual(payload["alarm"]["alarms"][0]["id"], "main:1")

        self.main_run(state="pass")
        autopilot._rebuild_index()
        self.assertFalse(self.index()["alarm"]["active"])

    def test_pause_alarm_verschwindet_nach_resume_im_index(self):
        with mock.patch.dict(os.environ, {"FAB_NOW": "1800000000000"}):
            autopilot.write_state("paused", reason="rot")
            autopilot._rebuild_index()
        self.assertEqual(
            [item["kind"] for item in self.index()["alarm"]["alarms"]], ["pause"]
        )

        self.ok("autopilot", "resume")
        self.assertFalse(self.index()["alarm"]["active"])

    def test_verify_fail_erzeugt_keinen_alarm(self):
        with store.locked():
            run = store.pipeline_run_new(
                trigger="verify", ticket="T-1", repo=self.home,
                worktree=self.home, branch="fab/T-1", head="a" * 40,
            )
            store.pipeline_step_add(run, 0, "verify.sh", "./verify.sh", "fail")
            store.pipeline_run_finish(run, "fail", 100)
        self.assertEqual(alarm.status(), {"active": False, "count": 0, "alarms": []})
