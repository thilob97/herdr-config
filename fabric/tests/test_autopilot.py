"""Autopilot: Statusdatei, CLI und Schleife mit gepatchter Zeit."""
import datetime
import glob
import json
import os
import unittest
from unittest import mock

from fabric.fablib import autopilot, store
from fabric.fablib.errors import FabError
from fabric.tests.support import FabricCase

HEAD = "abc123def456"


class AutopilotCase(FabricCase):
    def setUp(self):
        super().setUp()
        autopilot.reset()
        self.addCleanup(autopilot.reset)
        env = mock.patch.dict(os.environ, {"FAB_HOME": self.home})
        env.start()
        self.addCleanup(env.stop)

    # -- Fixtures

    def ticket(self, **overrides):
        data = {
            "id": "T-1",
            "status": "review",
            "worktree": "/worktree",
            "assignee": "zap",
            "checks": {"state": "pass", "head": HEAD},
            "verdict": {"state": "pass", "head": HEAD},
        }
        data.update(overrides)
        return data

    def shell(self, head=HEAD, status="", verify=(0, "grün"), accept=(0, "ok")):
        calls = []

        def fake(*args, **kwargs):
            calls.append((args, kwargs))
            if args[:3] == ("git", "-C", "/worktree"):
                return 0, head
            if args[:3] == ("git", "status", "--porcelain"):
                return 0, status
            if args[:2] == ("sh", ".fabric/verify.sh"):
                return verify
            if args[:2] == ("fab", "accept"):
                return accept
            return 0, ""

        return fake, calls

    def called(self, calls, *start):
        return [args for args, _ in calls if args[:len(start)] == start]

    def clock(self, *values):
        state = {"now": values[0] if values else datetime.datetime(2026, 1, 1, 7, 0)}
        return state

    def fake_now(self, state):
        return lambda: state["now"]

    # -- parse_until

    def test_parse_until(self):
        at = datetime.datetime(2026, 1, 1, 7, 30)
        self.assertIsNone(autopilot.parse_until("", at))
        self.assertIsNone(autopilot.parse_until("done", at))
        self.assertEqual(
            autopilot.parse_until("08:00", at),
            datetime.datetime(2026, 1, 1, 8, 0),
        )
        self.assertEqual(
            autopilot.parse_until("07:30", at),
            datetime.datetime(2026, 1, 2, 7, 30),
        )
        with self.assertRaises(FabError):
            autopilot.parse_until("25:00", at)
        with self.assertRaises(FabError):
            autopilot.parse_until("morgen", at)

    # -- Statusdatei und Log

    def test_state_is_atomic_and_has_contract_fields(self):
        stamp = datetime.datetime(2026, 1, 1, 7, 0, 0)
        with mock.patch.object(autopilot, "now", return_value=stamp):
            autopilot.log("hallo")
            autopilot.write_state(
                "running", reason="Test", end="2026-01-01T08:00", last_action="x"
            )
        state = autopilot.read_state()
        self.assertEqual(state["state"], "running")
        self.assertEqual(state["reason"], "Test")
        self.assertEqual(state["end"], "2026-01-01T08:00")
        self.assertEqual(state["updated_at"], int(stamp.timestamp() * 1000))
        self.assertEqual(state["last_action"], "x")
        self.assertEqual(state["log"], autopilot.log_path())
        self.assertEqual(state["pid"], os.getpid())
        self.assertEqual(glob.glob(os.path.join(self.home, ".autopilot-*")), [])
        with open(autopilot.log_path(), encoding="utf-8") as stream:
            self.assertEqual(stream.read(), "07:00:00 hallo\n")

    def test_read_state_tolerates_missing_and_broken_files(self):
        self.assertEqual(autopilot.read_state(), {})
        with open(autopilot.state_path(), "w", encoding="utf-8") as stream:
            stream.write("{kaputt")
        self.assertEqual(autopilot.read_state(), {})

    # -- start/stop/resume/status

    def test_start_uses_terminal_without_prompt(self):
        with mock.patch.object(autopilot, "_sh", return_value=(0, "/repo")) as shell, \
                mock.patch.object(autopilot.hc, "live", return_value={}), \
                mock.patch.object(
                    autopilot.hc, "run", return_value={"address": "t1"}
                ) as run:
            result = autopilot.start("08:00", cwd=self.tmp)
        self.assertTrue(result["started"])
        self.assertEqual(result["repo"], "/repo")
        shell.assert_called_once_with(
            "git", "-C", os.path.abspath(self.tmp), "rev-parse", "--show-toplevel"
        )
        run.assert_called_once_with(
            name="autopilot",
            cwd="/repo",
            argv=[autopilot.sys.executable, autopilot.FAB, "autopilot", "run", "--until", "08:00"],
            prompt=None,
            labels={"fab.role": "autopilot"},
        )

    def test_hc_run_omits_missing_prompt(self):
        from fabric.fablib import hc

        answer = mock.Mock(returncode=0, stdout='{"address": "t1"}', stderr="")
        with mock.patch.object(hc, "_run", return_value=answer) as shell:
            hc.run(name="autopilot", cwd="/repo", argv=["fab"], prompt=None)
            args = shell.call_args[0][0]
            self.assertEqual(args[-2:], ["--", "fab"])
            hc.run(name="autopilot", cwd="/repo", argv=["fab"], prompt="Text")
            args = shell.call_args[0][0]
            self.assertEqual(args[-1], "Text")

    def test_start_does_not_start_twice(self):
        with mock.patch.object(autopilot, "_sh", return_value=(0, "/repo")), \
                mock.patch.object(
                    autopilot.hc,
                    "live",
                    return_value={"autopilot": {"name": "autopilot", "state": "live"}},
                ), \
                mock.patch.object(autopilot.hc, "run") as run:
            result = autopilot.start("done", cwd=self.tmp)
        self.assertFalse(result["started"])
        run.assert_not_called()

    def test_stop_writes_stopped_and_clears_pause(self):
        autopilot.write_state("running", end="2099-01-01T08:00")
        with open(autopilot.pause_path(), "w", encoding="utf-8") as stream:
            stream.write("pausiert")
        with mock.patch.object(autopilot.hc, "kill", return_value=True) as kill:
            state = autopilot.stop()
        kill.assert_called_once_with("autopilot")
        self.assertEqual(state["state"], "stopped")
        self.assertEqual(state["reason"], "gestoppt")
        self.assertEqual(state["end"], "2099-01-01T08:00")
        self.assertFalse(os.path.exists(autopilot.pause_path()))
        self.assertEqual(autopilot.read_state()["state"], "stopped")

    def test_resume_clears_pause_and_sets_running(self):
        autopilot.write_state("paused", reason="rot", end="2026-01-01T08:00")
        with open(autopilot.pause_path(), "w", encoding="utf-8") as stream:
            stream.write("rot")
        self.assertTrue(autopilot.resume())
        self.assertFalse(os.path.exists(autopilot.pause_path()))
        state = autopilot.read_state()
        self.assertEqual(state["state"], "running")
        self.assertEqual(state["reason"], "")

    def test_status_adds_live_flag(self):
        autopilot.write_state("running", end="2026-01-01T08:00")
        with mock.patch.object(
            autopilot.hc, "live", return_value={"autopilot": {"state": "live"}}
        ):
            state = autopilot.status()
        self.assertEqual(state["state"], "running")
        self.assertTrue(state["live"])
        payload = json.loads(self.ok("autopilot", "status", "--json").stdout)
        self.assertEqual(payload["state"], "running")
        self.assertFalse(payload["live"])

    # -- Abnahme

    def test_accept_only_on_matching_passing_head(self):
        fake, calls = self.shell()
        with mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertTrue(autopilot.try_accept(self.ticket()))
        self.assertEqual(len(self.called(calls, "fab", "accept")), 1)
        self.assertEqual(len(self.called(calls, "sh", ".fabric/verify.sh")), 1)

        for changed in (
            self.ticket(checks={"state": "fail", "head": HEAD}),
            self.ticket(verdict={"state": "fail", "head": HEAD}),
            self.ticket(checks={"state": "pass", "head": "anderer"}),
            self.ticket(checks={"state": "pass", "head": ""}),
        ):
            autopilot.reset()
            fake, calls = self.shell()
            with mock.patch.object(autopilot, "_sh", side_effect=fake):
                self.assertFalse(autopilot.try_accept(changed))
            self.assertEqual(self.called(calls, "fab", "accept"), [])

    def test_second_red_verify_reverts_and_pauses(self):
        autopilot.reset()
        fake, calls = self.shell(verify=(1, "rot"))
        with mock.patch.object(autopilot, "_sh", side_effect=fake), \
                mock.patch.object(autopilot.time, "sleep") as sleep:
            self.assertFalse(autopilot.try_accept(self.ticket()))
        self.assertEqual(len(self.called(calls, "sh", ".fabric/verify.sh")), 2)
        sleep.assert_called_once_with(60)
        self.assertEqual(
            self.called(calls, "git", "revert", "-m", "1", "--no-edit", "HEAD")[0],
            ("git", "revert", "-m", "1", "--no-edit", "HEAD"),
        )
        self.assertTrue(os.path.exists(autopilot.pause_path()))
        self.assertTrue(autopilot._paused)
        comments = self.called(calls, "fab", "comment")
        self.assertEqual(len(comments), 1)
        self.assertIn("--no-wake", comments[0])

    def test_conflict_is_reported_once_per_head(self):
        fake, calls = self.shell(accept=(1, "not mergeable"))
        with mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertFalse(autopilot.try_accept(self.ticket()))
            self.assertFalse(autopilot.try_accept(self.ticket()))
        self.assertEqual(len(self.called(calls, "fab", "comment")), 1)
        self.assertEqual(len(self.called(calls, "fab", "accept")), 1)

    # -- Rückfragen, Wecken, Verteilen

    def test_forward_question_only_once(self):
        ticket = self.ticket(status="todo", waiting=["mensch"])
        fake, calls = self.shell()
        with mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertTrue(autopilot.forward_question(ticket))
            self.assertFalse(autopilot.forward_question(ticket))
        comments = self.called(calls, "fab", "comment")
        self.assertEqual(len(comments), 1)
        self.assertIn("@orchestrator", comments[0][-1])

    def test_nudge_three_times_then_orchestrator(self):
        state = self.clock(datetime.datetime(2026, 1, 1, 10, 0))
        fake, calls = self.shell()
        ticket = self.ticket(status="doing")
        with mock.patch.object(autopilot, "now", side_effect=self.fake_now(state)), \
                mock.patch.object(autopilot, "last_event_age_min", return_value=30), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            for _ in range(4):
                state["now"] += datetime.timedelta(minutes=31)
                self.assertTrue(autopilot.nudge(ticket, []))
        targets = [args[3] for args in self.called(calls, "fab", "wake")]
        self.assertEqual(targets, ["zap", "zap", "zap", "orchestrator"])

    def test_dispatch_nudge_only_once_per_window(self):
        state = self.clock(datetime.datetime(2026, 1, 1, 10, 0))
        fake, calls = self.shell()
        tickets = [{"id": "T-1", "status": "todo", "blocked_by": []}]
        with mock.patch.object(autopilot, "now", side_effect=self.fake_now(state)), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertTrue(autopilot.nudge_dispatch(tickets, []))
            self.assertFalse(autopilot.nudge_dispatch(tickets, []))
        comments = self.called(calls, "fab", "comment")
        self.assertEqual(len(comments), 1)
        self.assertIn("@orchestrator", comments[0][-1])

    # -- Schleife

    def test_once_stops_on_unassigned_drafts(self):
        draft = {"id": "T-1", "status": "draft"}
        with mock.patch.object(autopilot, "live_sessions", return_value=[]), \
                mock.patch.object(autopilot, "ticket_ids", return_value=["T-1"]), \
                mock.patch.object(autopilot, "fab_json", return_value=draft):
            self.assertFalse(autopilot.once())
        state = autopilot.read_state()
        self.assertEqual(state["state"], "stopped")
        self.assertEqual(state["reason"], "nichts mehr offen")

        autopilot.reset()
        assigned = dict(draft, assignee="zap")
        with mock.patch.object(autopilot, "live_sessions", return_value=[]), \
                mock.patch.object(autopilot, "ticket_ids", return_value=["T-1"]), \
                mock.patch.object(autopilot, "fab_json", return_value=assigned):
            self.assertTrue(autopilot.once())

    def test_run_ends_at_until(self):
        state = self.clock(datetime.datetime(2026, 1, 1, 7, 59))

        def sleep(seconds):
            state["now"] += datetime.timedelta(seconds=seconds)

        with mock.patch.object(autopilot, "now", side_effect=self.fake_now(state)), \
                mock.patch.object(autopilot, "once", return_value=True), \
                mock.patch.object(autopilot.time, "sleep", side_effect=sleep) as pause:
            self.assertEqual(autopilot.run("08:00"), 0)
        pause.assert_called_once_with(autopilot.INTERVAL)
        data = autopilot.read_state()
        self.assertEqual(data["state"], "stopped")
        self.assertEqual(data["reason"], "Endzeit erreicht")
        self.assertEqual(data["end"], "2026-01-01T08:00")

    def test_run_reads_pause_marker_again_each_round(self):
        """`resume` in einem anderen Prozess muss die laufende Schleife lösen."""
        state = self.clock(datetime.datetime(2026, 1, 1, 7, 57))
        with open(autopilot.pause_path(), "w", encoding="utf-8") as stream:
            stream.write("rot")

        def sleep(seconds):
            state["now"] += datetime.timedelta(seconds=seconds)

        seen = []

        def once():
            seen.append(autopilot._paused)
            if len(seen) == 1:
                os.unlink(autopilot.pause_path())
            return True

        with mock.patch.object(autopilot, "now", side_effect=self.fake_now(state)), \
                mock.patch.object(autopilot, "once", side_effect=once), \
                mock.patch.object(autopilot.time, "sleep", side_effect=sleep):
            self.assertEqual(autopilot.run("08:00"), 0)
        self.assertEqual(seen, [True, False])

    def test_last_event_age_uses_store_events(self):
        stamp = datetime.datetime(2026, 1, 1, 10, 0, 0)
        at = int(datetime.datetime(2026, 1, 1, 9, 50, 0).timestamp() * 1000)
        store.event_append("comment", "T-1", "zap", at=at)
        with mock.patch.object(autopilot, "now", return_value=stamp):
            age = autopilot.last_event_age_min("T-1")
        self.assertAlmostEqual(age, 10.0, places=3)


if __name__ == "__main__":
    unittest.main()
