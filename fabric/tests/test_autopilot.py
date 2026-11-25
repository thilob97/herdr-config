"""Autopilot: Statusdatei, CLI und Schleife mit gepatchter Zeit."""
import datetime
import glob
import json
import os
import re
import shutil
import subprocess
import unittest
from unittest import mock

from fabric.fablib import alarm, autopilot, git, store
from fabric.fablib.errors import FabError
from fabric.tests.support import FabricCase

HEAD = "abc123def456"
OTHER = "999999999999"

# Eingefrorene Ausgabe von Python 3.11.9 (`python3 … -v`, stderr): zwei
# fehlgeschlagene Asserts mit Caret-Zeilen, langen Pfaden und mehr als
# QUOTE_MAX_LINES/QUOTE_MAX_CHARS Zeichen.
PYTHON311_DIR = (
    "/tmp/fab-tests-python311/"
    "very_long_directory_name_for_paths_with_many_more_characters"
)
PYTHON311_LONG_PATHS = f"""test_alpha (__main__.Zeichenfolgen.test_alpha) ... FAIL
test_beta (__main__.Zeichenfolgen.test_beta) ... FAIL

======================================================================
FAIL: test_alpha (__main__.Zeichenfolgen.test_alpha)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "{PYTHON311_DIR}/test_long_paths.py", line 6, in test_alpha
    self.assertEqual(
AssertionError: 'ein sehr langer erwarteter text mit vielen zeichen' != 'ein sehr langer tatsaechlicher text mit vielen zeichen'
- ein sehr langer erwarteter text mit vielen zeichen
?                   --------
+ ein sehr langer tatsaechlicher text mit vielen zeichen
?                 ++++++++++++


======================================================================
FAIL: test_beta (__main__.Zeichenfolgen.test_beta)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "{PYTHON311_DIR}/test_long_paths.py", line 12, in test_beta
    self.assertEqual(
AssertionError: {{'schluessel': 'ein sehr langer wert mit vielen zeichen'}} != {{'schluessel': 'ein anderer sehr langer wert mit zeichen'}}
- {{'schluessel': 'ein sehr langer wert mit vielen zeichen'}}
?                                         -------

+ {{'schluessel': 'ein anderer sehr langer wert mit zeichen'}}
?                     ++++++++


----------------------------------------------------------------------
Ran 2 tests in 0.001s

FAILED (failures=2)
"""


STUB_GH = '''#!/usr/bin/env python3
"""gh-Stub für die Autopilot-Abnahme: Zustand in GH_STATE, Aufrufe in GH_LOG."""
import json
import os
import subprocess
import sys

URL = "https://github.com/test/repo/pull/7"
args = sys.argv[1:]
log = os.environ.get("GH_LOG")
if log:
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(args) + "\\n")

state_file = os.environ.get("GH_STATE")


def read_state():
    if state_file and os.path.isfile(state_file):
        with open(state_file, encoding="utf-8") as handle:
            return handle.read().strip()
    return ""


def write_state(value):
    if state_file:
        with open(state_file, "w", encoding="utf-8") as handle:
            handle.write(value)


def fields():
    if "--json" in args:
        return args[args.index("--json") + 1].split(",")
    return []


if args[:2] == ["auth", "status"]:
    sys.exit(1 if os.environ.get("GH_AUTH_FAIL") else 0)

if args[:2] == ["pr", "view"]:
    state = read_state()
    if os.environ.get("GH_VIEW_FAIL") or not state:
        print("kein PR gefunden", file=sys.stderr)
        sys.exit(1)
    wanted = fields()
    if "mergeCommit" in wanted:
        oid = ""
        bare = os.environ.get("GH_BARE")
        head = os.environ.get("GH_HEAD")
        if bare and head:
            sha = subprocess.run(
                ["git", "--git-dir", bare, "rev-parse", f"refs/heads/{head}"],
                capture_output=True, text=True,
            )
            if sha.returncode == 0:
                oid = sha.stdout.strip()
        print(json.dumps({
            "state": state,
            "number": 7,
            "mergeCommit": {"oid": oid} if oid else None,
        }))
    elif "url" in wanted:
        print(URL)
    elif "state" in wanted:
        print(state)
    else:
        print(json.dumps({"state": state, "number": 7, "mergeCommit": None}))
    sys.exit(0)

if args[:2] == ["pr", "create"]:
    if os.environ.get("GH_CREATE_FAIL"):
        print("create abgelehnt", file=sys.stderr)
        sys.exit(1)
    write_state("OPEN")
    print(URL)
    sys.exit(0)

if args[:2] == ["pr", "merge"]:
    if os.environ.get("GH_MERGE_FAIL"):
        print("merge abgelehnt", file=sys.stderr)
        sys.exit(1)
    write_state("MERGED")
    print("merged")
    sys.exit(0)

sys.exit(0)
'''


class AutopilotCase(FabricCase):
    def setUp(self):
        super().setUp()
        autopilot.reset()
        self.addCleanup(autopilot.reset)
        env = mock.patch.dict(os.environ, {"FAB_HOME": self.home, "FAB_NOW": ""})
        env.start()
        self.addCleanup(env.stop)
        self.repo = self.make_repo()

    # -- Fixtures

    def ticket(self, **overrides):
        data = {
            "id": "T-1",
            "status": "review",
            "repo": self.repo,
            "worktree": "/worktree",
            "assignee": "zap",
            "checks": {"state": "pass", "head": HEAD},
            "verdict": {"state": "pass", "head": HEAD},
        }
        data.update(overrides)
        return data

    def shell(self, accept=(0, "ok"), verify=(0, "grün")):
        calls = []

        def fake(*args, **kwargs):
            calls.append((args, kwargs))
            if args[:2] == ("sh", ".fabric/verify.sh"):
                return verify
            if args[:2] == ("fab", "accept"):
                return accept
            return 0, ""

        return fake, calls

    def called(self, calls, *start):
        return [args for args, _ in calls if args[:len(start)] == start]

    def set_now(self, moment):
        """Zentrale Uhr über `FAB_NOW` auf `moment` stellen."""
        os.environ["FAB_NOW"] = str(int(moment.timestamp() * 1000))

    # -- Abnahme über GitHub

    def stored(self, tid):
        """Ticket direkt aus dem Store lesen (self.ticket ist die Fixture)."""
        with open(
            os.path.join(self.home, "tickets", f"{tid}.json"), encoding="utf-8"
        ) as handle:
            return json.load(handle)

    def setup_origin(self, repo):
        """Bare-Remote als origin; die GitHub-URL wird darauf umgebogen."""
        bare = os.path.join(self.tmp, "origin.git")
        subprocess.run(["git", "init", "--bare", "-q", bare], check=True)
        self.git_out(repo, "remote", "add", "origin", "https://github.com/test/repo.git")
        self.git_out(
            repo, "config", f"url.{bare}.insteadOf", "https://github.com/test/repo.git"
        )
        self.git_out(repo, "push", "-q", "origin", "main")
        return bare

    def add_git_shim(self):
        """`git branch -D` scheitert, solange GIT_FAIL_BRANCH_DELETE gesetzt ist."""
        real_git = shutil.which("git")
        self.assertTrue(real_git, "git nicht gefunden")
        shim = os.path.join(self.bin, "git")
        self._write(
            shim,
            "#!/bin/sh\n"
            'if [ "$1" = "branch" ] && [ "$2" = "-D" ] '
            '&& [ -n "${GIT_FAIL_BRANCH_DELETE:-}" ]; then\n'
            '  echo "Branch kann nicht gelöscht werden" >&2\n'
            "  exit 1\n"
            "fi\n"
            f'exec "{real_git}" "$@"\n',
        )
        os.chmod(shim, 0o755)
        return shim

    def gh_env(self, bare, branch):
        return {
            "GH_LOG": os.path.join(self.tmp, "gh.log"),
            "GH_STATE": os.path.join(self.tmp, "gh.state"),
            "GH_BARE": bare,
            "GH_HEAD": branch,
        }

    def gh_calls(self):
        with open(os.path.join(self.tmp, "gh.log"), encoding="utf-8") as handle:
            return [
                json.loads(line) for line in handle.read().splitlines() if line.strip()
            ]

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
        self.set_now(stamp)
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
        with mock.patch.object(
                autopilot.hc, "live", return_value={}), \
                mock.patch.object(
                    autopilot.hc, "run", return_value={"address": "t1"}
                ) as run:
            result = autopilot.start("08:00", cwd=self.tmp)
        self.assertTrue(result["started"])
        self.assertEqual(result["repo"], os.path.abspath(self.tmp))
        run.assert_called_once_with(
            name="autopilot",
            cwd=os.path.abspath(self.tmp),
            argv=[autopilot.sys.executable, autopilot.FAB, "autopilot", "run", "--until", "08:00"],
            prompt=None,
            labels={"fab.role": "autopilot"},
        )
        self.assertEqual(autopilot.read_state()["state"], "running")
        self.assertTrue(autopilot.read_state()["end"])

    def test_start_twice_aborts_with_message(self):
        self.set_live({"autopilot": "t9"})
        result = self.cli("autopilot", "start", "--until", "08:00")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("Autopilot läuft schon", result.stderr)
        self.assertEqual(autopilot.read_state(), {})

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
        self.assertEqual(autopilot.resume(), "resumed")
        self.assertFalse(os.path.exists(autopilot.pause_path()))
        state = autopilot.read_state()
        self.assertEqual(state["state"], "running")
        self.assertEqual(state["reason"], "")

    def test_resume_keeps_stopped_state_and_reports_nothing_paused(self):
        autopilot.write_state("stopped", reason="gestoppt", end="2026-01-01T08:00")
        before = autopilot.read_state()
        with open(autopilot.pause_path(), "w", encoding="utf-8") as stream:
            stream.write("rot")
        self.assertEqual(autopilot.resume(), "not-paused")
        self.assertFalse(os.path.exists(autopilot.pause_path()))
        self.assertEqual(autopilot.read_state(), before)
        result = self.ok("autopilot", "resume")
        self.assertIn("nichts pausiert", result.stdout)
        self.assertEqual(autopilot.read_state()["state"], "stopped")

    def test_status_json_is_exactly_the_file(self):
        autopilot.write_state("running", end="2026-01-01T08:00")
        payload = json.loads(self.ok("autopilot", "status", "--json").stdout)
        self.assertEqual(payload, autopilot.read_state())

    def test_status_text_reports_live_terminal(self):
        autopilot.write_state("paused", reason="rot", end="2026-01-01T08:00")
        self.set_live({"autopilot": "t9"})
        result = self.ok("autopilot", "status")
        self.assertIn("paused", result.stdout)
        self.assertIn("rot", result.stdout)
        self.assertIn("läuft", result.stdout)

    # -- Abnahme

    def test_accept_only_on_matching_passing_head(self):
        fake, calls = self.shell()
        with mock.patch.object(autopilot, "head", return_value=HEAD), \
                mock.patch.object(autopilot, "ensure_clean_main", return_value=True), \
                mock.patch.object(
                    autopilot, "check_main", return_value=(True, "grün", "", 1)
                ), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertTrue(autopilot.try_accept(self.ticket()))
        self.assertEqual(len(self.called(calls, "fab", "accept")), 1)

        for changed in (
            self.ticket(checks={"state": "fail", "head": HEAD}),
            self.ticket(verdict={"state": "fail", "head": HEAD}),
            self.ticket(checks={"state": "pass", "head": "anderer"}),
            self.ticket(checks={"state": "pass", "head": ""}),
            self.ticket(verdict={"state": "pass", "head": OTHER}),
        ):
            autopilot.reset()
            fake, calls = self.shell()
            with mock.patch.object(autopilot, "head", return_value=HEAD), \
                    mock.patch.object(autopilot, "ensure_clean_main", return_value=True), \
                    mock.patch.object(
                        autopilot, "check_main", return_value=(True, "grün", "", 1)
                    ), \
                    mock.patch.object(autopilot, "_sh", side_effect=fake):
                self.assertFalse(autopilot.try_accept(changed))
            self.assertEqual(self.called(calls, "fab", "accept"), [])

    def test_stored_no_change_with_new_commits_checks_live(self):
        fake, calls = self.shell()
        ticket = self.ticket(
            no_change=True,
            base="main",
            branch="fab/T-1",
            checks={"state": "fail", "head": HEAD},
            verdict={"state": "fail", "head": HEAD},
        )
        with mock.patch.object(autopilot, "head", return_value=HEAD), \
                mock.patch.object(
                    autopilot.git, "branch_exists", return_value=True
                ), \
                mock.patch.object(
                    autopilot.git, "commit_count", return_value=1
                ) as count, \
                mock.patch.object(autopilot, "ensure_clean_main", return_value=True), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertFalse(autopilot.try_accept(ticket))
        count.assert_called_once_with(os.path.realpath(self.repo), "main", "fab/T-1")
        self.assertEqual(self.called(calls, "fab", "accept"), [])

    def test_stored_no_change_with_commits_and_passing_checks_accepts(self):
        fake, calls = self.shell()
        ticket = self.ticket(no_change=True, base="main", branch="fab/T-1")
        with mock.patch.object(autopilot, "head", return_value=HEAD), \
                mock.patch.object(autopilot.git, "branch_exists", return_value=True), \
                mock.patch.object(autopilot.git, "commit_count", return_value=1), \
                mock.patch.object(
                    autopilot, "ensure_clean_main", return_value=True
                ) as clean, \
                mock.patch.object(
                    autopilot, "check_main", return_value=(True, "grün", "", 1)
                ), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertTrue(autopilot.try_accept(ticket))
        clean.assert_called_once_with(os.path.realpath(self.repo))
        self.assertEqual(len(self.called(calls, "fab", "accept")), 1)

    def test_accept_resumes_after_branch_delete_failure(self):
        """Abbruch nach `pr_merged`; der zweite Lauf über den Autopilot schließt ab."""
        # setUp hat bereits ein Repo unter self.tmp/repo angelegt; ready_ticket
        # kopiert dorthin und scheitert an den schreibgeschützten git-Objekten.
        shutil.rmtree(self.repo)
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        branch = self.stored(tid)["branch"]

        gh_log = os.path.join(self.tmp, "gh.log")
        self._write(gh_log, "")
        stub = os.path.join(self.bin, "gh")
        self._write(stub, STUB_GH)
        os.chmod(stub, 0o755)
        bare = self.setup_origin(repo)
        self.add_git_shim()
        env = self.gh_env(bare, branch)
        self.env.update(env)

        first = self.cli("accept", tid, env=dict(env, GIT_FAIL_BRANCH_DELETE="1"))
        self.assertNotEqual(first.returncode, 0, first.stdout)
        ticket = self.stored(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertIn("pr_merged", ticket["accept"]["steps"])
        self.assertFalse(os.path.exists(worktree))

        autopilot.reset()
        calls = []

        def sh(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("fab", "accept"):
                result = self.cli(*args[1:])
                return result.returncode, result.stdout + result.stderr
            return 0, ""

        with mock.patch.object(
                autopilot, "fab_json", return_value=self.stored(tid)
            ), \
                mock.patch.object(autopilot, "_sh", side_effect=sh), \
                mock.patch.object(
                    autopilot, "ensure_clean_main", return_value=True
                ), \
                mock.patch.object(
                    autopilot, "check_main", return_value=(True, "", "", 0)
                ), \
                mock.patch.object(autopilot, "write_state"):
            self.assertTrue(autopilot.try_accept(self.stored(tid)))

        self.assertEqual(
            [args for args in calls if args[:2] == ("fab", "accept")],
            [("fab", "accept", tid)],
        )
        ticket = self.stored(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertIn("done", ticket["accept"]["steps"])
        merges = [call for call in self.gh_calls() if call[:2] == ["pr", "merge"]]
        self.assertEqual(len(merges), 1)

    def test_accept_does_not_run_when_paused(self):
        autopilot.reset()
        autopilot._paused = True
        fake, calls = self.shell()
        with mock.patch.object(autopilot, "head", return_value=HEAD), \
                mock.patch.object(autopilot, "ensure_clean_main", return_value=True), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertFalse(autopilot.try_accept(self.ticket()))
        self.assertEqual(self.called(calls, "fab", "accept"), [])

    # -- main-Prüfung

    def test_second_verify_green_does_not_revert(self):
        self._write(
            os.path.join(self.repo, ".fabric", "verify.sh"),
            "#!/bin/sh\nexit 0\n",
        )
        results = iter([(1, "rot", "fehler"), (0, "grün", "")])

        def fake(command, cwd, timeout):
            return next(results)

        with mock.patch.object(autopilot.pipeline, "_execute", side_effect=fake), \
                mock.patch.object(autopilot.time, "sleep") as sleep, \
                mock.patch.object(autopilot.git, "git") as git_cmd:
            ok, out, err, run_id = autopilot.check_main(self.repo)
        self.assertTrue(ok)
        self.assertEqual(out, "grün")
        self.assertEqual(err, "")
        self.assertIsNotNone(run_id)
        sleep.assert_called_once_with(60)
        self.assertNotIn(
            mock.call(["revert", "-m", "1", "--no-edit", "HEAD"], self.repo),
            git_cmd.call_args_list,
        )

    def test_second_verify_red_reverts_merge(self):
        self._write(
            os.path.join(self.repo, ".fabric", "verify.sh"),
            "#!/bin/sh\nexit 1\n",
        )

        def fake(command, cwd, timeout):
            return 1, "rot", "fehler"

        revert = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(autopilot.pipeline, "_execute", side_effect=fake), \
                mock.patch.object(autopilot.time, "sleep"), \
                mock.patch.object(autopilot.git, "git", return_value=revert) as git_cmd:
            ok, out, err, run_id = autopilot.check_main(self.repo)
        self.assertFalse(ok)
        self.assertEqual(out, "rot")
        self.assertEqual(err, "fehler")
        self.assertIsNotNone(run_id)
        self.assertIn(
            mock.call(["revert", "-m", "1", "--no-edit", "HEAD"], self.repo),
            git_cmd.call_args_list,
        )

    def test_revert_failure_still_pauses_and_reports_once(self):
        tid = self.new("Roter main")
        self._write(
            os.path.join(self.repo, ".fabric", "verify.sh"),
            "#!/bin/sh\nexit 1\n",
        )
        calls = []

        def fake_sh(*args, **kwargs):
            calls.append(args)
            return 0, ""

        def fake_execute(command, cwd, timeout):
            return 1, "rot", "fehler"

        revert = mock.Mock(returncode=1, stdout="", stderr="kaputt")
        with mock.patch.object(autopilot, "head", return_value=HEAD), \
                mock.patch.object(autopilot, "ensure_clean_main", return_value=True), \
                mock.patch.object(autopilot.pipeline, "_execute", side_effect=fake_execute), \
                mock.patch.object(autopilot, "_sh", side_effect=fake_sh), \
                mock.patch.object(autopilot.time, "sleep"), \
                mock.patch.object(autopilot.git, "git", return_value=revert):
            self.assertFalse(
                autopilot.try_accept(dict(self.ticket(), id=tid))
            )
        self.assertTrue(autopilot._paused)
        self.assertTrue(os.path.exists(autopilot.pause_path()))
        comments = [args for args in calls if args[:2] == ("fab", "comment")]
        self.assertEqual(len(comments), 1)
        self.assertIn("--no-wake", comments[0])

    def test_main_check_on_real_no_ff_merge_commit(self):
        """Lehre: Revert und main-Prüfung gegen einen echten Merge-Commit."""
        verify = os.path.join(self.repo, ".fabric", "verify.sh")
        self._write(verify, "#!/bin/sh\nexit 0\n")
        self.git_out(self.repo, "add", ".fabric/verify.sh")
        self.git_out(self.repo, "commit", "-qm", "verify")
        self.git_out(self.repo, "checkout", "-qb", "topic")
        self._write(os.path.join(self.repo, "topic.txt"), "inhalt\n")
        self.git_out(self.repo, "add", "topic.txt")
        self.git_out(self.repo, "commit", "-qm", "topic")
        self.git_out(self.repo, "checkout", "-q", "main")
        self.git_out(self.repo, "merge", "--no-ff", "-q", "-m", "Merge topic", "topic")

        merge_head = self.git_out(self.repo, "rev-parse", "HEAD")
        parents = self.git_out(
            self.repo, "rev-list", "--parents", "-n", "1", "HEAD"
        ).split()
        self.assertEqual(len(parents), 3)  # echter Merge-Commit mit zwei Eltern

        with mock.patch.object(autopilot.time, "sleep"):
            ok, _out, _err, _run = autopilot.check_main(self.repo)
        self.assertTrue(ok)

        # Rot ohne den Merge zu ändern: der Revert muss den Merge zurücknehmen.
        self._write(verify, "#!/bin/sh\nexit 1\n")
        with mock.patch.object(autopilot.time, "sleep"):
            ok, _out, _err, run_id = autopilot.check_main(self.repo)
        self.assertFalse(ok)
        self.assertIsNotNone(run_id)
        self.assertEqual(
            self.git_out(self.repo, "rev-parse", "HEAD^"), merge_head
        )
        self.assertFalse(os.path.exists(os.path.join(self.repo, "topic.txt")))
        self.assertEqual(
            self.git_out(self.repo, "log", "-1", "--pretty=%s"), "Revert \"Merge topic\""
        )

    # -- Roter main: Anhänge und Fehlerzitat

    def red_run(self, stdout, stderr):
        """`try_accept` mit rotem main; liefert (Ticket, Anhänge, Kommentar)."""
        tid = self.new("Roter main")
        self._write(
            os.path.join(self.repo, ".fabric", "verify.sh"),
            "#!/bin/sh\nexit 1\n",
        )
        calls = []

        def fake_execute(command, cwd, timeout):
            return 1, stdout, stderr

        def fake_sh(*args, **kwargs):
            calls.append(args)
            return 0, ""

        revert = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(autopilot, "head", return_value=HEAD), \
                mock.patch.object(autopilot, "ensure_clean_main", return_value=True), \
                mock.patch.object(autopilot.pipeline, "_execute", side_effect=fake_execute), \
                mock.patch.object(autopilot, "_sh", side_effect=fake_sh), \
                mock.patch.object(autopilot.time, "sleep"), \
                mock.patch.object(autopilot.git, "git", return_value=revert):
            self.assertFalse(autopilot.try_accept(dict(self.ticket(), id=tid)))
        with self.store_env():
            ticket = store.load(tid)
        comments = [args[-1] for args in calls if args[:2] == ("fab", "comment")]
        self.assertEqual(len(comments), 1)
        return ticket, comments[0]

    def test_red_main_attaches_full_streams_and_quotes_first_error(self):
        marker = "x" * (1024 * 1024 + 4096)
        stdout = (
            "Zeile eins\nZeile zwei\n"
            "FAIL: test_bruch (test_mod.TestFall)\n"
            "  Datei test_mod.py, Zeile 7\n"
            "Traceback (most recent call last):\n"
            f"{marker}\nSTDOUT-ENDE"
        )
        stderr = "ERROR: test_zweit (test_mod.TestFall)\nkurz\n" + "E" * 5000

        ticket, comment = self.red_run(stdout, stderr)

        self.assertEqual(len(ticket["attachments"]), 2)
        names = {item["name"]: item["path"] for item in ticket["attachments"]}
        stdout_name = next(name for name in names if name.endswith("-stdout.log"))
        stderr_name = next(name for name in names if name.endswith("-stderr.log"))
        for name, expected in ((stdout_name, stdout), (stderr_name, stderr)):
            with open(
                os.path.join(self.home, "attachments", ticket["id"], name),
                encoding="utf-8",
            ) as handle:
                self.assertEqual(handle.read(), expected)

        self.assertIn("Anhänge:", comment)
        self.assertIn(names[stdout_name], comment)
        self.assertIn(names[stderr_name], comment)
        self.assertIn("Fehlerzeilen:", comment)
        self.assertIn("FAIL: test_bruch", comment)
        self.assertIn("ERROR: test_zweit", comment)
        self.assertNotIn("STDOUT-ENDE", comment)

        show = self.ok("show", ticket["id"]).stdout
        self.assertIn("## Anhänge", show)
        self.assertIn(stdout_name, show)
        self.assertIn(stderr_name, show)

    def test_red_main_without_error_line_quotes_end_with_hint(self):
        stdout = "viele Zeilen ohne Befund\n" * 50 + "STDOUT-ENDE"
        stderr = "STDERR-ENDE"

        _ticket, comment = self.red_run(stdout, stderr)

        self.assertIn("keine Fehlerzeile erkannt", comment)
        self.assertIn("STDERR-ENDE", comment)
        self.assertNotIn("Fehlerzeilen:", comment)

    def test_red_main_comment_links_stored_run(self):
        ticket, comment = self.red_run("rot\n", "fehler\n")

        match = re.search(r"Lauf: #(\d+)", comment)
        self.assertIsNotNone(match, comment)
        run_id = int(match.group(1))
        self.assertIn(f"Lauf: #{run_id} (fab run show {run_id})", comment)

        with self.store_env():
            run = store.pipeline_run_load(run_id)
            steps = store.pipeline_steps(run_id)
        self.assertIsNotNone(run)
        self.assertEqual(run["trigger"], "main")
        self.assertEqual(run["state"], "fail")
        self.assertTrue(steps)

    def test_run_captures_stdout_and_stderr_separately(self):
        code, out, err = autopilot._run(
            "sh", "-c", "printf 'aus\\n'; printf 'fehler\\n' >&2", timeout=30
        )
        self.assertEqual(code, 0)
        self.assertEqual(out, "aus\n")
        self.assertEqual(err, "fehler\n")

    def test_run_timeout_decodes_bytes_and_returns_124(self):
        expired = subprocess.TimeoutExpired(
            ["langsam"], 5, output=b"teil\n", stderr=b"fehler\n"
        )
        with mock.patch.object(autopilot.subprocess, "run", side_effect=expired):
            code, out, err = autopilot._run("langsam", timeout=5)
        self.assertEqual(code, 124)
        self.assertEqual(out, "teil\n")
        self.assertEqual(err, "fehler\n\nTimeout nach 5s")

    def test_quote_contains_all_unittest_failures(self):
        text = """F.
======================================================================
FAIL: test_alpha (tests.test_mod.Fall.test_alpha)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/tests/test_mod.py", line 8, in test_alpha
    self.assertEqual(1, 2)
AssertionError: 1 != 2

======================================================================
FAIL: test_beta (tests.test_mod.Fall.test_beta)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/tests/test_mod.py", line 11, in test_beta
    self.assertEqual('a', 'b')
AssertionError: 'a' != 'b'

----------------------------------------------------------------------
Ran 2 tests in 0.001s

FAILED (failures=2)
"""
        quote = autopilot._first_errors(text)
        self.assertIn("FAIL: test_alpha", quote)
        self.assertIn("FAIL: test_beta", quote)
        self.assertIn("AssertionError: 1 != 2", quote)
        self.assertIn("AssertionError: 'a' != 'b'", quote)

    def test_quote_contains_node_test_yaml_message(self):
        text = """not ok 1 - bricht bei ungleichen Werten ab
  ---
  duration_ms: 12.3
  type: 'test'
  location: '/tmp/test.mjs:4:3'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    1 !== 2

  code: 'ERR_ASSERTION'
  expected: 1
  actual: 2
  operator: 'strictEqual'
  ...
1..1
# tests 1
# pass 0
# fail 1
"""
        quote = autopilot._first_errors(text)
        self.assertIn("not ok 1 - bricht bei ungleichen Werten ab", quote)
        self.assertIn("1 !== 2", quote)
        self.assertNotIn("1..1", quote)

    def test_quote_is_capped_at_max_lines(self):
        text = "\n".join(f"ERROR: fehler_{number} (test_mod.Fall)" for number in range(30))
        quote = autopilot._first_errors(text)
        self.assertLessEqual(len(quote.splitlines()), autopilot.QUOTE_MAX_LINES)
        self.assertIn("ERROR: fehler_0", quote)
        self.assertIn("weitere Zeilen", quote)
        self.assertNotIn("Zeichen gekürzt", quote)

    def test_quote_names_line_and_char_truncation(self):
        """Eingefrorene Python-3.11-Ausgabe: zwei Fehler, Caret-Zeilen, lange Pfade."""
        text = PYTHON311_LONG_PATHS
        self.assertEqual(text.count("FAIL: "), 2)
        self.assertIn("\n? ", text)
        self.assertIn(PYTHON311_DIR, text)
        self.assertGreater(len(text.splitlines()), autopilot.QUOTE_MAX_LINES)
        self.assertGreater(len(text), autopilot.QUOTE_MAX_CHARS)
        quote = autopilot._first_errors(text)
        self.assertIn("FAIL: test_alpha", quote)
        self.assertIn("AssertionError", quote)
        self.assertRegex(quote, r"… \(\d+ weitere Zeilen, Zeichen gekürzt\)")
        self.assertLessEqual(len(quote), autopilot.QUOTE_MAX_CHARS)

    def test_quote_is_capped_at_max_chars(self):
        text = "ERROR: " + "x" * 2000
        quote = autopilot._first_errors(text)
        self.assertLessEqual(len(quote), autopilot.QUOTE_MAX_CHARS)
        self.assertIn("Zeichen gekürzt", quote)
        self.assertNotIn("weitere Zeilen", quote)
        self.assertTrue(quote.startswith("ERROR: x"))

    def test_quote_contains_node_spec_reporter_failure(self):
        text = """✖ bricht bei ungleichen Werten ab (1.417583ms)
✖ zweiter Fehler (1.366209ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 93.049291

✖ failing tests:

test at fail.mjs:3:1
✖ bricht bei ungleichen Werten ab (1.417583ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  1 !== 2
  
      at TestContext.<anonymous> (file:///private/tmp/t84/fail.mjs:4:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.start (node:internal/test_runner/test:1096:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:385:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 2,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at fail.mjs:6:1
✖ zweiter Fehler (1.366209ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    {
  +   a: 1
  -   a: 2
    }
  
      at TestContext.<anonymous> (file:///private/tmp/t84/fail.mjs:7:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: { a: 1 },
    expected: { a: 2 },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
"""
        quote = autopilot._first_errors(text)
        self.assertIn("✖ bricht bei ungleichen Werten ab", quote)
        self.assertIn("✖ zweiter Fehler", quote)
        self.assertEqual(quote.count("AssertionError [ERR_ASSERTION]"), 2)
        self.assertIn("1 !== 2", quote)
        self.assertNotIn("    at ", quote)
        self.assertNotIn("generatedMessage", quote)
        self.assertNotIn("weitere Zeilen", quote)
        self.assertNotIn("failing tests:", quote)

    def test_spec_section_keeps_message_line_starting_with_at(self):
        text = """✖ schlägt fehl (1.0ms)
ℹ fail 1

✖ failing tests:

test at fail.mjs:3:1
✖ schlägt fehl (1.0ms)
  AssertionError [ERR_ASSERTION]: ungleiche Werte:
  at least one value differs
  
      at TestContext.<anonymous> (/pfad/x.test.js:5:1)
"""
        quote = autopilot._first_errors(text)
        self.assertIn("at least one value differs", quote)

    def test_spec_section_drops_stack_frames(self):
        text = """✖ schlägt fehl (1.0ms)
ℹ fail 1

✖ failing tests:

test at fail.mjs:3:1
✖ schlägt fehl (1.0ms)
  AssertionError [ERR_ASSERTION]: ungleiche Werte:
  at least one value differs
  
    at TestContext.<anonymous> (/pfad/x.test.js:5:1)
    at /pfad/x.test.js:5:1
    at Test.runInAsyncScope (node:async_hooks:226:14)
"""
        quote = autopilot._first_errors(text)
        self.assertIn("at least one value differs", quote)
        self.assertNotIn("TestContext.<anonymous>", quote)
        self.assertNotIn("at /pfad/x.test.js:5:1", quote)
        self.assertNotIn("runInAsyncScope", quote)

    def test_error_quote_names_each_truncated_stream(self):
        stdout = "\n".join(f"ERROR: stdout_{number}" for number in range(30))
        stderr = "\n".join(f"ERROR: stderr_{number}" for number in range(30))
        quote = autopilot._error_quote(stdout, stderr)
        self.assertIn("stdout:", quote)
        self.assertIn("stderr:", quote)
        self.assertEqual(quote.count("weitere Zeilen"), 2)

    def test_attach_output_keeps_equal_streams_separate(self):
        cases = (("leer", "", ""), ("gleich", "gleicher Text\n", "gleicher Text\n"))
        for case, stdout, stderr in cases:
            tid = self.new(f"Anhänge {case}")
            paths = autopilot._attach_output(tid, stdout, stderr)
            names = [os.path.basename(path) for path in paths]
            self.assertEqual(len(names), 2, case)
            self.assertTrue(names[0].endswith("-stdout.log"), names)
            self.assertTrue(names[1].endswith("-stderr.log"), names)
            for name, expected in ((names[0], stdout), (names[1], stderr)):
                with open(
                    os.path.join(self.home, "attachments", tid, name),
                    encoding="utf-8",
                ) as handle:
                    self.assertEqual(handle.read(), expected)
            with self.store_env():
                self.assertEqual(len(store.load(tid)["attachments"]), 2, case)

    # -- Konflikt und Rückfrage

    def test_conflict_is_reported_once_per_head(self):
        fake, calls = self.shell(accept=(1, "not mergeable"))
        with mock.patch.object(autopilot, "head", return_value=HEAD), \
                mock.patch.object(autopilot, "ensure_clean_main", return_value=True), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertFalse(autopilot.try_accept(self.ticket()))
            self.assertFalse(autopilot.try_accept(self.ticket()))
        self.assertEqual(len(self.called(calls, "fab", "comment")), 1)
        self.assertEqual(len(self.called(calls, "fab", "accept")), 1)

    def test_forward_question_only_once(self):
        ticket = self.ticket(status="todo", waiting=["mensch"])
        fake, calls = self.shell()
        with mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertTrue(autopilot.forward_question(ticket))
            self.assertFalse(autopilot.forward_question(ticket))
        comments = self.called(calls, "fab", "comment")
        self.assertEqual(len(comments), 1)
        self.assertIn("@orchestrator", comments[0][-1])

    # -- Wecken und Verteilen

    def test_nudge_over_20_minutes_wakes_and_under_does_not(self):
        fake, calls = self.shell()
        ticket = self.ticket(status="doing")
        with mock.patch.object(autopilot, "last_event_age_min", return_value=19), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertFalse(autopilot.nudge(ticket, []))
        self.assertEqual(self.called(calls, "fab", "wake"), [])
        autopilot.reset()
        fake, calls = self.shell()
        with mock.patch.object(autopilot, "last_event_age_min", return_value=21), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertTrue(autopilot.nudge(ticket, []))
        self.assertEqual(len(self.called(calls, "fab", "wake")), 1)

    def test_nudge_three_times_then_orchestrator(self):
        moment = datetime.datetime(2026, 1, 1, 10, 0)
        self.set_now(moment)
        fake, calls = self.shell()
        ticket = self.ticket(status="doing")
        with mock.patch.object(autopilot, "last_event_age_min", return_value=30), \
                mock.patch.object(autopilot, "_sh", side_effect=fake):
            for _ in range(4):
                moment += datetime.timedelta(minutes=31)
                self.set_now(moment)
                self.assertTrue(autopilot.nudge(ticket, []))
        targets = [args[3] for args in self.called(calls, "fab", "wake")]
        self.assertEqual(targets, ["zap", "zap", "zap", "orchestrator"])

    def test_dispatch_nudge_only_once_per_window(self):
        self.set_now(datetime.datetime(2026, 1, 1, 10, 0))
        fake, calls = self.shell()
        tickets = [{"id": "T-1", "status": "todo", "blocked_by": []}]
        with mock.patch.object(autopilot, "_sh", side_effect=fake):
            self.assertTrue(autopilot.nudge_dispatch(tickets, []))
            self.assertFalse(autopilot.nudge_dispatch(tickets, []))
        comments = self.called(calls, "fab", "comment")
        self.assertEqual(len(comments), 1)
        self.assertIn("@orchestrator", comments[0][-1])

    # -- Schleife

    def test_once_stops_when_nothing_is_open(self):
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
        moment = datetime.datetime(2026, 1, 1, 7, 59)
        self.set_now(moment)

        def sleep(seconds):
            nonlocal moment
            moment += datetime.timedelta(seconds=seconds)
            self.set_now(moment)

        with mock.patch.object(autopilot, "once", return_value=True), \
                mock.patch.object(autopilot.time, "sleep", side_effect=sleep) as pause:
            self.assertEqual(autopilot.run("08:00"), 0)
        pause.assert_called_once_with(autopilot.INTERVAL)
        data = autopilot.read_state()
        self.assertEqual(data["state"], "stopped")
        self.assertEqual(data["reason"], "Endzeit erreicht")
        self.assertEqual(data["end"], "2026-01-01T08:00")

    def test_run_reads_pause_marker_again_each_round(self):
        """`resume` in einem anderen Prozess muss die laufende Schleife lösen."""
        moment = datetime.datetime(2026, 1, 1, 7, 57)
        self.set_now(moment)
        with open(autopilot.pause_path(), "w", encoding="utf-8") as stream:
            stream.write("rot")

        def sleep(seconds):
            nonlocal moment
            moment += datetime.timedelta(seconds=seconds)
            self.set_now(moment)

        seen = []

        def once():
            seen.append(autopilot._paused)
            if len(seen) == 1:
                os.unlink(autopilot.pause_path())
            return True

        with mock.patch.object(autopilot, "once", side_effect=once), \
                mock.patch.object(autopilot.time, "sleep", side_effect=sleep):
            self.assertEqual(autopilot.run("08:00"), 0)
        self.assertEqual(seen, [True, False])

    def test_last_event_age_uses_store_events(self):
        stamp = datetime.datetime(2026, 1, 1, 10, 0, 0)
        at = int(datetime.datetime(2026, 1, 1, 9, 50, 0).timestamp() * 1000)
        store.event_append("comment", "T-1", "zap", at=at)
        self.set_now(stamp)
        age = autopilot.last_event_age_min("T-1")
        self.assertAlmostEqual(age, 10.0, places=3)

    def app_repo(self, name="app-config"):
        """Repo mit getrackter App-Konfiguration als Ausgangslage."""
        repo = self.make_repo(name)
        for relative in ("settings.json", "keys.json", "layouts/fabric.json"):
            path = os.path.join(repo, relative)
            folder = os.path.dirname(path)
            if folder:
                os.makedirs(folder, exist_ok=True)
            self.write_file(path, "{}\n")
        self.git_out(repo, "add", ".")
        self.git_out(repo, "commit", "-qm", "config")
        return repo

    def test_ensure_clean_main_commits_settings_json(self):
        repo = self.app_repo()
        before = self.git_out(repo, "rev-parse", "HEAD")
        path = os.path.join(repo, "settings.json")
        self.write_file(path, '{"theme": "dark"}\n')
        self.assertTrue(autopilot.ensure_clean_main(repo))
        self.assertNotEqual(self.git_out(repo, "rev-parse", "HEAD"), before)
        with open(path, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), '{"theme": "dark"}\n')
        self.assertEqual(git.pending_paths(repo), [])

    def test_ensure_clean_main_blocks_foreign_changes(self):
        repo = self.app_repo("app-blocked")
        before = self.git_out(repo, "rev-parse", "HEAD")
        self.write_file(os.path.join(repo, "settings.json"), '{"a": 1}\n')
        self.write_file(os.path.join(repo, "README.md"), "anders\n")
        self.assertFalse(autopilot.ensure_clean_main(repo))
        self.assertEqual(self.git_out(repo, "rev-parse", "HEAD"), before)
        self.assertEqual(
            sorted(git.pending_paths(repo)), ["README.md", "settings.json"]
        )

    def test_ensure_clean_main_commits_keys_and_layouts(self):
        for position, relative in enumerate(("keys.json", "layouts/fabric.json")):
            with self.subTest(path=relative):
                repo = self.app_repo(f"app-single-{position}")
                path = os.path.join(repo, relative)
                self.write_file(path, '{"neu": true}\n')
                self.assertTrue(autopilot.ensure_clean_main(repo))
                self.assertEqual(git.pending_paths(repo), [])
                with open(path, encoding="utf-8") as handle:
                    self.assertEqual(handle.read(), '{"neu": true}\n')

    def test_skips_alarm_after_three_rounds_once(self):
        repo = self.app_repo("app-skip")
        moment = datetime.datetime(2026, 1, 2, 10, 0)
        self.set_now(moment)
        since = int(moment.timestamp() * 1000)
        self.write_file(os.path.join(repo, "README.md"), "blockiert\n")

        def skip_alarms():
            return [
                item for item in alarm.status()["alarms"] if item["kind"] == "skip"
            ]

        def round_():
            """Eine Runde mit drei abnahmebereiten Tickets."""
            autopilot.begin_round()
            for _ in range(3):
                self.assertFalse(autopilot.ensure_clean_main(repo))
            return autopilot.end_round()

        with mock.patch.object(autopilot, "_wake_orchestrator") as wake:
            self.assertEqual(round_(), 1)
            self.assertEqual(round_(), 2)
            self.assertEqual(skip_alarms(), [])
            wake.assert_not_called()

            self.assertEqual(round_(), 3)
            alarms = skip_alarms()
            self.assertEqual(len(alarms), 1)
            self.assertEqual(alarms[0]["id"], f"skip:{since}")
            self.assertIn("README.md", alarms[0]["text"])
            self.assertIn("3", alarms[0]["text"])
            wake.assert_called_once()

            self.assertEqual(round_(), 4)
            self.assertEqual([item["id"] for item in skip_alarms()], [f"skip:{since}"])
            wake.assert_called_once()

            # Ohne Bereinigung bleibt der Alarm; refresh_skip hebt nichts auf.
            self.assertFalse(autopilot.refresh_skip())
            self.assertEqual([item["id"] for item in skip_alarms()], [f"skip:{since}"])

        self.git_out(repo, "checkout", "--", "README.md")
        self.assertTrue(autopilot.refresh_skip())
        self.assertEqual(skip_alarms(), [])
        self.assertEqual(autopilot.skip_state()["paths"], [])
        self.assertTrue(autopilot.ensure_clean_main(repo))

    def test_three_calls_in_one_round_count_one_skip(self):
        repo = self.app_repo("app-rounds")
        self.set_now(datetime.datetime(2026, 1, 2, 12, 0))
        self.write_file(os.path.join(repo, "README.md"), "blockiert\n")

        with mock.patch.object(autopilot, "_wake_orchestrator"):
            autopilot.begin_round()
            for _ in range(3):
                self.assertFalse(autopilot.ensure_clean_main(repo))
            self.assertEqual(autopilot.skip_state()["count"], 0)
            self.assertEqual(autopilot.end_round(), 1)
            self.assertEqual(autopilot.skip_state()["count"], 1)

            # Außerhalb einer Runde zählt ein Aufruf sofort als eigene Runde.
            self.assertFalse(autopilot.ensure_clean_main(repo))
            self.assertEqual(autopilot.skip_state()["count"], 2)

    def test_settings_commit_clears_skip_state(self):
        repo = self.app_repo("app-clear")
        self.set_now(datetime.datetime(2026, 1, 2, 11, 0))
        self.write_file(os.path.join(repo, "settings.json"), '{"x": 2}\n')
        self.assertTrue(autopilot.ensure_clean_main(repo))
        self.assertEqual(autopilot.skip_state()["count"], 0)
        self.assertEqual(autopilot.skip_state()["paths"], [])


if __name__ == "__main__":
    unittest.main()
