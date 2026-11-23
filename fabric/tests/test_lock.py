"""Sperre: kurz halten, Leser nie warten lassen, Konflikte erkennen.

Die globale Sperre (`data/fabric/lock`) darf nur für kurze Zustandsänderungen
gehalten werden. Lese-Befehle müssen auch dann durchlaufen, wenn ein anderer
Prozess sie gerade hält; Schreib-Befehle laufen nach `FAB_LOCK_TIMEOUT` in eine
Meldung mit dem Halter. `fab handover` und `fab accept` erledigen ihre lange
Arbeit (Merge-Prüfung, PR) ohne Sperre und brechen ab, wenn sich das Ticket
inzwischen geändert hat.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from unittest import mock

from fabric.fablib import store
from fabric.tests.support import FAB, FABRIC, FabricCase

REPO_ROOT = os.path.dirname(FABRIC)

HOLDER = '''
from fabric.fablib import store

with store.locked():
    print("locked", flush=True)
    import sys
    sys.stdin.read()
'''

STUB_GH = '''#!/usr/bin/env python3
"""gh-Stub: blockiert `pr create`, bis die Freigabedatei existiert."""
import json
import os
import sys
import time

args = sys.argv[1:]
log = os.environ.get("GH_LOG")
if log:
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(args) + "\\n")

URL = "https://github.com/test/repo/pull/7"
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


if args[:2] == ["auth", "status"]:
    sys.exit(0)

if args[:2] == ["pr", "view"]:
    state = read_state()
    if not state:
        print("no pull requests found", file=sys.stderr)
        sys.exit(1)
    if args[-1] == ".url":
        print(URL)
    elif args[-1] == ".state":
        print(state)
    else:
        sys.exit(1)
    sys.exit(0)

if args[:2] == ["pr", "create"]:
    started = os.environ.get("GH_CREATE_STARTED")
    release = os.environ.get("GH_CREATE_RELEASE")
    if started:
        with open(started, "w", encoding="utf-8"):
            pass
    while release and not os.path.exists(release):
        time.sleep(0.05)
    write_state("OPEN")
    print(URL)
    sys.exit(0)

if args[:2] == ["pr", "merge"]:
    write_state("MERGED")
    print("merged")
    sys.exit(0)

sys.exit(0)
'''

URL = "https://github.com/test/repo/pull/7"


class LockTests(FabricCase):
    def setUp(self):
        super().setUp()
        self.gh_log = os.path.join(self.tmp, "gh.log")
        self.gh_state = os.path.join(self.tmp, "gh.state")
        self.write_file(self.gh_log, "")
        stub = os.path.join(self.bin, "gh")
        self.write_file(stub, STUB_GH)
        os.chmod(stub, 0o755)

    # -- Hilfen

    def stop_process(self, proc):
        """Halter über stdin beenden, sonst terminieren; nie Zombies lassen."""
        if proc.stdin is not None:
            try:
                proc.stdin.close()
            except (OSError, ValueError):
                pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        for stream in (proc.stdout, proc.stderr):
            try:
                if stream is not None:
                    stream.close()
            except OSError:
                pass

    def start_holder(self):
        """Subprozess, der `store.locked()` hält und auf stdin wartet."""
        proc = subprocess.Popen(
            [sys.executable, "-c", HOLDER],
            cwd=REPO_ROOT,
            env=self.env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(self.stop_process, proc)
        line = proc.stdout.readline()
        if line.strip() != "locked":
            detail = proc.stderr.read() if proc.poll() is not None else ""
            self.fail(f"Halter meldet die Sperre nicht: {line!r} {detail}")
        return proc

    def cli_popen(self, *args, marker_env=None):
        env = dict(self.env)
        env.update(marker_env or {})
        proc = subprocess.Popen(
            [sys.executable, FAB, *args],
            cwd=self.tmp,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(self.stop_process, proc)
        return proc

    def blocking_verify(self, worktree, started, release):
        """Grünes Prüfskript, das nur mit gesetzten Markern blockiert."""
        path = os.path.join(worktree, ".fabric", "verify.sh")
        self.write_file(
            path,
            "#!/bin/sh\n"
            'if [ -n "$FAB_TEST_STARTED" ]; then\n'
            '  : > "$FAB_TEST_STARTED"\n'
            '  while [ ! -e "$FAB_TEST_RELEASE" ]; do sleep 0.05; done\n'
            "fi\n"
            "echo 'prüfung ok'\n"
            "exit 0\n",
        )
        self.git_out(worktree, "add", ".fabric/verify.sh")
        self.git_out(worktree, "commit", "-qm", "Prüfskript")

    def review_ticket(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        return repo, tid, worktree

    def blocking_review_ticket(self, started, release):
        """Review-Ticket, dessen committetes Prüfskript mit Markern blockiert."""
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.blocking_verify(worktree, started, release)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        return repo, tid, worktree

    def blocked_handover(self, started, release):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.blocking_verify(worktree, started, release)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        proc = self.cli_popen(
            "handover", tid, "--from", "zap", "Fertig",
            marker_env={
                "FAB_TEST_STARTED": started,
                "FAB_TEST_RELEASE": release,
            },
        )
        self.assertTrue(
            self.wait_for(lambda: os.path.exists(started), timeout=20),
            "Merge-Prüfung des Handovers hat nicht begonnen",
        )
        return repo, tid, worktree, proc

    def blocked_handover_roter_merge(self, started, release):
        """Handover, dessen Merge-Prüfung blockiert und danach rot endet."""
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        path = os.path.join(worktree, ".fabric", "verify.sh")
        self.write_file(
            path,
            "#!/bin/sh\n"
            'if [ -n "$FAB_TEST_STARTED" ]; then\n'
            '  : > "$FAB_TEST_STARTED"\n'
            '  while [ ! -e "$FAB_TEST_RELEASE" ]; do sleep 0.05; done\n'
            "fi\n"
            "test ! -f main-rot.txt\n",
        )
        self.git_out(worktree, "add", ".fabric/verify.sh")
        self.git_out(worktree, "commit", "-qm", "Prüfskript")
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.write_file(os.path.join(repo, "main-rot.txt"), "rot\n")
        self.git_out(repo, "add", "main-rot.txt")
        self.git_out(repo, "commit", "-qm", "main macht den Merge rot")
        proc = self.cli_popen(
            "handover", tid, "--from", "zap", "Fertig",
            marker_env={
                "FAB_TEST_STARTED": started,
                "FAB_TEST_RELEASE": release,
            },
        )
        self.assertTrue(
            self.wait_for(lambda: os.path.exists(started), timeout=20),
            "Merge-Prüfung des Handovers hat nicht begonnen",
        )
        return repo, tid, worktree, proc

    def follow_ticket(self, repo, blocker, title="Danach"):
        """Startbereites Folgeticket, das der Accept nach der Abnahme startet."""
        tid = self.new(title, repo=repo)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok(
            "edit", tid, "--body",
            "## Ziel\nEtwas tun.\n\n## Abnahmekriterien\n- [ ] es läuft\n",
            "--from", "mensch",
        )
        self.ok("status", tid, "todo", "--from", "mensch")
        self.ok("link", tid, "--blocked-by", blocker, "--from", "mensch")
        return tid

    def blockierendes_git(self):
        """PATH-Ordner mit `git`, das `worktree add` erst nach Freigabe ausführt."""
        real = shutil.which("git", path=self.env["PATH"])
        self.assertTrue(real, "git nicht gefunden")
        folder = os.path.join(self.tmp, "blockierendes-git")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "git")
        self.write_file(
            path,
            "#!/bin/sh\n"
            'if [ "$1" = "worktree" ] && [ "$2" = "add" ]; then\n'
            '  : > "$GIT_WORKTREE_STARTED"\n'
            '  while [ ! -e "$GIT_WORKTREE_RELEASE" ]; do sleep 0.05; done\n'
            "fi\n"
            'exec "$GIT_REAL" "$@"\n',
        )
        os.chmod(path, 0o755)
        return folder, real

    def assert_lock_free(self):
        """Beweist, dass die Sperre frei ist: in-process sofort erwerbbar."""
        began = time.monotonic()
        with self.store_env():
            with store.locked():
                pass
        elapsed = time.monotonic() - began
        self.assertLess(elapsed, 1.0, elapsed)

    def noshell_path(self):
        """PATH ohne `sh`, aber mit git und den Stubs; `sh` fehlt beim Prüfen."""
        folder = os.path.join(self.tmp, "noshell")
        os.makedirs(folder, exist_ok=True)
        for name in ("git", "hc", "herdr-app", "python3"):
            target = (
                sys.executable if name == "python3"
                else shutil.which(name, path=self.env["PATH"])
            )
            self.assertTrue(target, f"{name} nicht gefunden")
            link = os.path.join(folder, name)
            if not os.path.exists(link):
                os.symlink(target, link)
        return folder

    def setup_origin(self, repo, push_main=True):
        bare = os.path.join(self.tmp, "origin.git")
        subprocess.run(["git", "init", "--bare", "-q", bare], check=True)
        self.git(bare, "config", "receive.denyNonFastForwards", "true")
        self.git_out(repo, "remote", "add", "origin", "https://github.com/test/repo.git")
        self.git_out(
            repo, "config",
            f"url.{bare}.insteadOf", "https://github.com/test/repo.git",
        )
        if push_main:
            self.git_out(repo, "push", "-q", "origin", "main")
        return bare

    # 1 -- Schreibender bricht mit Halter-Meldung ab

    def test_schreiber_timeout_meldet_halter(self):
        _repo, tid, _worktree = self.ready_ticket()
        holder = self.start_holder()

        result = self.cli(
            "comment", tid, "--from", "mensch", "zu spät",
            env={"FAB_LOCK_TIMEOUT": "0.4"},
        )

        self.assertEqual(result.returncode, 1)
        self.assertRegex(
            result.stderr, r"gesperrt von PID \d+ \(.+\) seit \d+ s"
        )
        self.assertIn(str(holder.pid), result.stderr)

        with self.store_env():
            holder_file = store.lock_path() + ".holder"
        self.assertTrue(os.path.isfile(holder_file), holder_file)
        info = json.loads(self._read(holder_file))
        self.assertEqual(info["pid"], holder.pid)
        self.assertIsInstance(info["command"], str)
        self.assertTrue(info["command"])
        self.assertIsInstance(info["started"], (int, float))

    # 2 -- Leser warten nie

    def test_lesebefehle_ohne_sperre(self):
        _repo, tid, _worktree = self.ready_ticket()
        self.start_holder()

        commands = [
            ("list",),
            ("show", tid),
            ("inbox",),
            ("roster",),
            ("agents",),
            ("stats",),
            ("flow", "list"),
            ("autopilot", "status"),
        ]
        for args in commands:
            began = time.monotonic()
            result = self.cli(*args)
            elapsed = time.monotonic() - began
            self.assertEqual(result.returncode, 0, (args, result.stderr))
            self.assertLess(elapsed, 1.0, (args, elapsed))

    # 3 -- Langes Handover hält die Sperre nicht

    def test_handover_lange_pruefung_haelt_sperre_nicht(self):
        started = os.path.join(self.tmp, "handover-started")
        release = os.path.join(self.tmp, "handover-release")
        _repo, tid, _worktree, proc = self.blocked_handover(started, release)

        self.assert_lock_free()

        self.write_file(release, "")
        _out, err = proc.communicate(timeout=60)
        self.assertEqual(proc.returncode, 0, err)
        self.assertEqual(self.ticket(tid)["status"], "review")

    def test_revision_aendert_mit_jedem_feld(self):
        _repo, tid, _worktree = self.ready_ticket()
        with self.store_env():
            ticket = store.load(tid)
            first = store.revision(ticket)
            second = store.revision(dict(ticket))
        self.assertRegex(first, r"^[0-9a-f]{64}$")
        self.assertEqual(first, second)

        with self.store_env():
            ticket = store.load(tid)
            ticket["title"] = ticket["title"] + " (neu)"
            changed = store.revision(ticket)
        self.assertNotEqual(first, changed)

    # 4 -- Handover erkennt eine Änderung während der Prüfung

    def test_handover_konflikt_bei_aenderung(self):
        started = os.path.join(self.tmp, "handover-started")
        release = os.path.join(self.tmp, "handover-release")
        _repo, tid, _worktree, proc = self.blocked_handover(started, release)

        comment = self.cli("comment", tid, "--from", "mensch", "dazwischen")
        self.assertEqual(comment.returncode, 0, comment.stderr)

        self.write_file(release, "")
        _out, err = proc.communicate(timeout=60)

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("geändert", err)
        self.assertIn("nichts eingetragen", err)
        ticket = self.ticket(tid)
        self.assertNotEqual(ticket["status"], "review")
        texts = [row.get("text") or "" for row in ticket.get("comments") or []]
        self.assertIn("dazwischen", texts)

    # 5 -- Handover: rote Zweige brechen ab und lassen den Status stehen

    def test_handover_zweig_rot_bricht_ab(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.write_file(
            os.path.join(worktree, ".fabric", "verify.sh"),
            "#!/bin/sh\ntest ! -f main-rot.txt\n",
        )
        self.git_out(worktree, "add", ".fabric/verify.sh")
        self.git_out(worktree, "commit", "-qm", "Prüfskript")
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.write_file(os.path.join(repo, "main-rot.txt"), "rot\n")
        self.git_out(repo, "add", "main-rot.txt")
        self.git_out(repo, "commit", "-qm", "main macht den Merge rot")

        result = self.cli("handover", tid, "--from", "zap", "fertig")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Stand mit main ist rot", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("merge", ticket)
        self.assertNotIn("mensch", ticket["waiting"])

    def test_handover_zweig_konflikt_bricht_ab(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "vom branch\n")
        self.write_file(os.path.join(repo, "aenderung.txt"), "von main\n")
        self.git_out(repo, "add", "aenderung.txt")
        self.git_out(repo, "commit", "-qm", "main ändert dieselbe Datei")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")

        result = self.cli("handover", tid, "--from", "zap", "fertig")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Konflikt", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("merge", ticket)
        self.assertNotIn("mensch", ticket["waiting"])

    def test_handover_zweig_ohne_pruefskript_bricht_ab(self):
        _repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree, commit=False)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")

        result = self.cli("handover", tid, "--from", "zap", "fertig")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Stand mit main konnte nicht geprüft werden", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("merge", ticket)
        self.assertNotIn("mensch", ticket["waiting"])

    # 6 -- Accept erkennt eine Änderung während der Prüfung

    def test_accept_konflikt_bei_aenderung(self):
        started = os.path.join(self.tmp, "accept-started")
        release = os.path.join(self.tmp, "accept-release")
        repo, tid, _worktree = self.blocking_review_ticket(started, release)
        before = self.ticket(tid)
        self.write_file(os.path.join(repo, "fremd.txt"), "fremd\n")
        self.git_out(repo, "add", "fremd.txt")
        self.git_out(repo, "commit", "-qm", "main läuft weiter")
        mark = self.mark()
        # Die Prüferin ist erreichbar: ein Wecken vor dem Commit wäre ein `hc send`.
        self.set_live({"fab-herdr-app-ada-t-1": "t8"})
        self.clear_log()

        proc = self.cli_popen(
            "accept", tid,
            marker_env={
                "FAB_TEST_STARTED": started,
                "FAB_TEST_RELEASE": release,
            },
        )
        self.assertTrue(
            self.wait_for(lambda: os.path.exists(started), timeout=20),
            "Merge-Prüfung des Accepts hat nicht begonnen",
        )
        self.assert_lock_free()

        comment = self.cli("comment", tid, "--from", "mensch", "dazwischen")
        self.assertEqual(comment.returncode, 0, comment.stderr)

        self.write_file(release, "")
        _out, err = proc.communicate(timeout=60)

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("geändert", err)
        after = self.ticket(tid)
        self.assertEqual(after["status"], "review")
        self.assertEqual(after.get("verdict"), before.get("verdict"))
        self.assertEqual(after.get("merge"), before.get("merge"))
        self.assertEqual(self.events_since(mark, "accept"), [])
        self.assertEqual(self.hc_calls("send"), [])

    # 7 -- Accept per PR erkennt eine Änderung während des PR-Anlegens

    def test_accept_pr_weg_konflikt_bei_aenderung(self):
        repo, tid, _worktree = self.review_ticket()
        self.setup_origin(repo)
        started = os.path.join(self.tmp, "gh-started")
        release = os.path.join(self.tmp, "gh-release")

        proc = self.cli_popen(
            "accept", tid,
            marker_env={
                "GH_LOG": self.gh_log,
                "GH_STATE": self.gh_state,
                "GH_CREATE_STARTED": started,
                "GH_CREATE_RELEASE": release,
            },
        )
        self.assertTrue(
            self.wait_for(lambda: os.path.exists(started), timeout=20),
            "PR-Anlegen hat nicht begonnen",
        )
        self.assert_lock_free()

        comment = self.cli("comment", tid, "--from", "mensch", "dazwischen")
        self.assertEqual(comment.returncode, 0, comment.stderr)

        self.write_file(release, "")
        _out, err = proc.communicate(timeout=60)

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("geändert", err)
        ticket = self.ticket(tid)
        self.assertNotIn("pr", ticket)
        self.assertNotEqual(ticket["status"], "done")

    def test_accept_pr_weg_merge_konflikt_bricht_ab(self):
        repo, tid, _worktree = self.review_ticket()
        self.setup_origin(repo)
        self.write_file(os.path.join(repo, "aenderung.txt"), "von main\n")
        self.git_out(repo, "add", "aenderung.txt")
        self.git_out(repo, "commit", "-qm", "main ändert dieselbe Datei")
        mark = self.mark()

        result = self.cli(
            "accept", tid,
            env={"GH_LOG": self.gh_log, "GH_STATE": self.gh_state},
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Konflikt", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("pr", ticket)
        self.assertEqual(self.events_since(mark, "accept"), [])

    # 8 -- Accept: rote Zweige brechen ab, kein Accept-Ereignis

    def test_accept_zweig_roter_merge_stand_bricht_ab(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.write_file(
            os.path.join(worktree, ".fabric", "verify.sh"),
            "#!/bin/sh\ntest ! -f main-rot.txt\n",
        )
        self.git_out(worktree, "add", ".fabric/verify.sh")
        self.git_out(worktree, "commit", "-qm", "Prüfskript")
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("handover", tid, "--from", "zap", "fertig")
        self.write_file(os.path.join(repo, "main-rot.txt"), "rot\n")
        self.git_out(repo, "add", "main-rot.txt")
        self.git_out(repo, "commit", "-qm", "main macht den Merge rot")
        mark = self.mark()

        result = self.cli("accept", tid)

        self.assertNotEqual(result.returncode, 0)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(ticket["merge"]["state"], "fail")
        self.assertEqual(self.events_since(mark, "accept"), [])

    def test_accept_zweig_konflikt_bricht_ab(self):
        repo, tid, _worktree = self.review_ticket()
        self.write_file(os.path.join(repo, "aenderung.txt"), "von main\n")
        self.git_out(repo, "add", "aenderung.txt")
        self.git_out(repo, "commit", "-qm", "main ändert dieselbe Datei")
        mark = self.mark()

        result = self.cli("accept", tid)

        self.assertNotEqual(result.returncode, 0)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("merge", ticket)
        self.assertEqual(self.events_since(mark, "accept"), [])

    def test_accept_zweig_ohne_pruefskript_bricht_ab(self):
        repo, tid, _worktree = self.review_ticket()
        before = self.ticket(tid)
        # Ein neuer Merge-Stand, der die Prüfung nicht starten kann: `sh` fehlt.
        self.write_file(os.path.join(repo, "fremd.txt"), "fremd\n")
        self.git_out(repo, "add", "fremd.txt")
        self.git_out(repo, "commit", "-qm", "main läuft weiter")
        mark = self.mark()

        result = self.cli("accept", tid, env={"PATH": self.noshell_path()})

        self.assertNotEqual(result.returncode, 0)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertEqual(ticket.get("verdict"), before.get("verdict"))
        self.assertEqual(ticket.get("merge"), before.get("merge"))
        self.assertEqual(self.events_since(mark, "accept"), [])

    # 9 -- Autostart nach accept: Sperre frei während `hc run`

    def test_accept_autostart_haelt_sperre_waehrend_hc_run_nicht(self):
        repo, blocker, _worktree = self.review_ticket()
        follow = self.follow_ticket(repo, blocker)
        started = os.path.join(self.tmp, "run-started")
        release = os.path.join(self.tmp, "run-release")
        self.set_live({})
        self.clear_log()

        proc = self.cli_popen(
            "accept", blocker,
            marker_env={
                "HC_RUN_STARTED": started,
                "HC_RUN_RELEASE": release,
            },
        )
        self.assertTrue(
            self.wait_for(lambda: os.path.exists(started), timeout=20),
            "hc run des Autostarts hat nicht begonnen",
        )
        self.assert_lock_free()

        self.write_file(release, "")
        _out, err = proc.communicate(timeout=60)

        self.assertEqual(proc.returncode, 0, err)
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(len(ticket["sessions"]), 1)

    # 10 -- CAS-Konflikt in der Dispatch nach `git worktree add`

    def test_dispatch_cas_konflikt_nach_worktree_add_startet_keine_session(self):
        repo, blocker, _worktree = self.review_ticket()
        follow = self.follow_ticket(repo, blocker)
        started = os.path.join(self.tmp, "worktree-started")
        release = os.path.join(self.tmp, "worktree-release")
        folder, real = self.blockierendes_git()
        self.set_live({})
        self.clear_log()

        proc = self.cli_popen(
            "accept", blocker,
            marker_env={
                "PATH": folder + os.pathsep + self.env["PATH"],
                "GIT_REAL": real,
                "GIT_WORKTREE_STARTED": started,
                "GIT_WORKTREE_RELEASE": release,
            },
        )
        self.assertTrue(
            self.wait_for(lambda: os.path.exists(started), timeout=20),
            "worktree add des Autostarts hat nicht begonnen",
        )
        comment = self.cli("comment", follow, "--from", "mensch", "dazwischen")
        self.assertEqual(comment.returncode, 0, comment.stderr)

        self.write_file(release, "")
        _out, err = proc.communicate(timeout=60)

        self.assertEqual(proc.returncode, 0, err)
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "todo")
        self.assertIsNone(ticket.get("worktree"))
        self.assertEqual(ticket.get("sessions") or [], [])
        self.assertEqual(self.hc_calls("run"), [])
        notes = [
            row["text"] for row in self.events()
            if row["kind"] == "dispatch" and row["ticket"] == follow
        ]
        self.assertTrue(
            any("automatisch nicht gestartet" in text for text in notes), notes
        )

        # Der zweite Versuch nutzt den vorhandenen Worktree: eine Session.
        self.ok("dispatch", follow, "--from", "mensch")
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(len(ticket["sessions"]), 1)

    # 11 -- Migration wartet mit Zeitlimit und Halterinfo

    def test_migrationssperre_meldet_halter_nach_timeout(self):
        _repo, _tid, _worktree = self.ready_ticket()
        holder = self.start_holder()

        with self.store_env(), mock.patch.dict(
            os.environ, {"FAB_LOCK_TIMEOUT": "0.4"}
        ):
            began = time.monotonic()
            with self.assertRaises(store.FabError) as ctx:
                with store._flock():
                    pass
            elapsed = time.monotonic() - began

        self.assertLess(elapsed, 3.0, elapsed)
        self.assertIn("gesperrt von", str(ctx.exception))
        self.assertIn(f"PID {holder.pid}", str(ctx.exception))

    # 12 -- Handover weckt bei einem CAS-Konflikt nicht

    def test_handover_weckt_nicht_bei_cas_konflikt(self):
        started = os.path.join(self.tmp, "handover-rot-started")
        release = os.path.join(self.tmp, "handover-rot-release")
        _repo, tid, _worktree, proc = self.blocked_handover_roter_merge(
            started, release
        )
        # Zuständiger erreichbar: ein Wecken vor dem Commit wäre ein `hc send`.
        self.set_live({"fab-herdr-app-zap-t-1": "t7"})
        self.clear_log()

        comment = self.cli("comment", tid, "--from", "mensch", "dazwischen")
        self.assertEqual(comment.returncode, 0, comment.stderr)

        self.write_file(release, "")
        _out, err = proc.communicate(timeout=60)

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("geändert", err)
        self.assertEqual(self.hc_calls("send"), [])
        self.assertEqual(self.hc_calls("run"), [])

    # 13 -- Accept weckt Prüfer-Hinweise bei einem CAS-Konflikt nicht

    def test_accept_weckt_pruefer_hinweise_nicht_bei_cas_konflikt(self):
        _repo, tid, _worktree = self.review_ticket()
        self.ok("comment", tid, "--from", "ada", "Hinweis: Bitte Doku nachziehen")
        started = os.path.join(self.tmp, "kill-started")
        release = os.path.join(self.tmp, "kill-release")
        # Orchestrator erreichbar: ein Wecken vor dem Commit wäre ein `hc send`.
        self.set_live({"fab-herdr-app-orchestrator": "t11"})
        self.clear_log()

        proc = self.cli_popen(
            "accept", tid,
            marker_env={
                "HC_KILL_STARTED": started,
                "HC_KILL_RELEASE": release,
            },
        )
        self.assertTrue(
            self.wait_for(lambda: os.path.exists(started), timeout=20),
            "Session-Abbau des Accepts hat nicht begonnen",
        )

        comment = self.cli("comment", tid, "--from", "mensch", "dazwischen")
        self.assertEqual(comment.returncode, 0, comment.stderr)

        self.write_file(release, "")
        _out, err = proc.communicate(timeout=60)

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("geändert", err)
        self.assertEqual(self.hc_calls("send"), [])


if __name__ == "__main__":
    import unittest

    unittest.main()
