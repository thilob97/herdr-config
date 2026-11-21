"""Gemeinsame Testhilfen: Temp-Home, Roster-Fixture, `hc`-Stub, Git-Repos."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

FAB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fab")
FABRIC = os.path.dirname(FAB)

STUB_HC = '''#!/usr/bin/env python3
"""hc-Stub: protokolliert Aufrufe, beantwortet `ls --json` aus einer Fixture."""
import json
import os
import sys

args = sys.argv[1:]
log = os.environ.get("HC_LOG")
if log:
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(args) + "\\n")

command = args[0] if args else ""
if command == "ls":
    fixture = os.environ.get("HC_LS")
    if fixture and os.path.isfile(fixture):
        with open(fixture, encoding="utf-8") as handle:
            sys.stdout.write(handle.read())
    else:
        sys.stdout.write('{"terminals": []}')
    sys.exit(0)
if command == "run":
    fail = os.environ.get("HC_RUN_FAIL")
    times = os.environ.get("HC_RUN_FAIL_TIMES")
    left = 0
    if times and os.path.isfile(times):
        with open(times, encoding="utf-8") as handle:
            try:
                left = int((handle.read() or "0").strip() or 0)
            except ValueError:
                left = 0
    if fail or left > 0:
        if left > 0:
            with open(times, "w", encoding="utf-8") as handle:
                handle.write(str(left - 1))
        print("Start fehlgeschlagen", file=sys.stderr)
        sys.exit(1)
    print(json.dumps({"address": "t900", "name": "stub", "state": "live"}))
    sys.exit(0)
if command == "send":
    marker = os.environ.get("HC_SEND_FAIL_ONCE")
    if marker and "--force" not in args and not os.path.exists(marker):
        open(marker, "w", encoding="utf-8").close()
        print("hc send: blockiert", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)
if command == "kill":
    if os.environ.get("HC_KILL_FAIL"):
        print("hc kill: Terminal beendet nicht", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)
sys.exit(0)
'''

STUB_HERDR = '''#!/usr/bin/env python3
"""herdr-app-Stub: protokolliert Aufrufe, beantwortet `ls` aus einer Fixture."""
import json
import os
import sys

args = sys.argv[1:]
log = os.environ.get("HERDR_LOG")
if log:
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(args) + "\\n")

if os.environ.get("HERDR_APP_FAIL"):
    print("herdr-app: kein Fenster", file=sys.stderr)
    sys.exit(1)
if args[:1] == ["ls"]:
    fixture = os.environ.get("HERDR_LS")
    if fixture and os.path.isfile(fixture):
        with open(fixture, encoding="utf-8") as handle:
            sys.stdout.write(handle.read())
    else:
        sys.stdout.write('{"spaces": []}')
    sys.exit(0)
if args[:1] == ["do"]:
    print(json.dumps({"ok": True}))
    sys.exit(0)
sys.exit(0)
'''

PREAMBLE = (
    "# Ticket {id}: {title}\n\n"
    "Du bist {agent} ({role}) im Worktree {worktree} auf {branch} (Basis {base}). "
    "Prüferin ist {reviewer}.\n"
)


class FabricCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fabtest-")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = os.path.join(self.tmp, "data")
        self.fake_home = os.path.join(self.tmp, "home")
        self.roster_dir = os.path.join(self.tmp, "fabric")
        self.bin = os.path.join(self.tmp, "bin")
        for folder in (
            self.home,
            self.fake_home,
            self.roster_dir,
            os.path.join(self.roster_dir, "prompts"),
            self.bin,
        ):
            os.makedirs(folder, exist_ok=True)
        self._write(os.path.join(self.roster_dir, "prompts", "preamble.md"), PREAMBLE)
        self._write(os.path.join(self.roster_dir, "prompts", "orchestrator.md"),
                    "Orchestrator-Rolle: formuliere aus und verteile.\n")
        self._write(os.path.join(self.roster_dir, "prompts", "zap.md"),
                    "Zap-Rolle: setze das Ticket um.\n")
        self._write(os.path.join(self.roster_dir, "prompts", "ada.md"),
                    "Ada-Rolle: prüfe das Ticket.\n")
        self.roster = os.path.join(self.roster_dir, "roster.json")
        self._owned_repos = []
        self.write_roster()
        self.hc_log = os.path.join(self.tmp, "hc.log")
        self.ls_json = os.path.join(self.tmp, "ls.json")
        self.claude_json = os.path.join(self.tmp, "claude.json")
        self.herdr_log = os.path.join(self.tmp, "herdr.log")
        self.herdr_ls = os.path.join(self.tmp, "herdr-ls.json")
        self._write(self.hc_log, "")
        self._write(self.herdr_log, "")
        self.set_live({})
        self.set_spaces([{"id": "sp-fabric", "name": "Fabric"}])
        stub = os.path.join(self.bin, "hc")
        self._write(stub, STUB_HC)
        os.chmod(stub, 0o755)
        stub = os.path.join(self.bin, "herdr-app")
        self._write(stub, STUB_HERDR)
        os.chmod(stub, 0o755)
        self.env = dict(os.environ)
        self.env.update(
            HOME=self.fake_home,
            FAB_HOME=self.home,
            FAB_ROSTER=self.roster,
            FAB_CLAUDE_JSON=self.claude_json,
            HC_LOG=self.hc_log,
            HC_LS=self.ls_json,
            HERDR_LOG=self.herdr_log,
            HERDR_LS=self.herdr_ls,
            PATH=self.bin + os.pathsep + os.environ.get("PATH", ""),
            GIT_CONFIG_NOSYSTEM="1",
        )

    # -- Grundlagen

    def _write(self, path, text):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)

    def _read(self, path):
        with open(path, encoding="utf-8") as handle:
            return handle.read()

    def write_roster(self, **overrides):
        data = {
            "max_sessions": 4,
            "reviewer": "ada",
            "orchestrator": {
                "argv": ["true"],
                "prompt": "prompts/orchestrator.md",
            },
            "agents": [
                {"name": "zap", "role": "umsetzer", "color": "c1",
                 "prompt": "prompts/zap.md", "argv": ["true"]},
                {"name": "ada", "role": "pruefer", "color": "c2",
                 "prompt": "prompts/ada.md", "argv": ["true"]},
            ],
        }
        data.update(overrides)
        if self._owned_repos:
            data["blueprints"] = [dict(entry) for entry in data["agents"]]
            data["teams"] = [
                {
                    "name": "herdr-app",
                    "repos": self._team_repos(),
                    "orchestrator": dict(data["orchestrator"]),
                    "members": [
                        {"blueprint": entry["name"]} for entry in data["agents"]
                    ],
                    "reviewer": data["reviewer"],
                    "max_sessions": data["max_sessions"],
                }
            ]
            data.setdefault("max_sessions_total", data["max_sessions"])
        self._write(self.roster, json.dumps(data, ensure_ascii=False, indent=2))
        return data

    def _team_repos(self):
        default = os.path.realpath(os.path.join(
            self.fake_home, ".config", "herdr-app"))
        repos = [default]
        for path in self._owned_repos:
            if path not in repos:
                repos.append(path)
        return repos

    def own_repo(self, repo, team="herdr-app"):
        """Repo dem Fixture-Team zuschlagen; danach ist es routingfähig."""
        path = os.path.realpath(os.path.abspath(repo))
        if path not in self._owned_repos:
            self._owned_repos.append(path)
        self.ok("roster", "--json")
        data = json.loads(self._read(self.roster))
        entry = next(item for item in data["teams"] if item["name"] == team)
        repos = list(entry.get("repos") or [])
        for candidate in [path, *self._team_repos()]:
            if candidate not in repos:
                repos.append(candidate)
        entry["repos"] = repos
        self._write(self.roster, json.dumps(data, ensure_ascii=False, indent=2))
        return path

    def default_repo(self):
        path = os.path.join(self.fake_home, ".config", "herdr-app")
        if not os.path.isdir(os.path.join(path, ".git")):
            self.init_repo(path)
        return path

    def cli(self, *args, env=None, cwd=None, input_text=None):
        merged = dict(self.env)
        merged.update(env or {})
        return subprocess.run(
            [sys.executable, FAB, *args],
            cwd=cwd or self.tmp,
            env=merged,
            input=input_text,
            capture_output=True,
            text=True,
        )

    def ok(self, *args, **kwargs):
        result = self.cli(*args, **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def wait_for(self, predicate, timeout=10.0):
        """Alle 0,05 s prüfen, bis `predicate` etwas Wahreres liefert."""
        deadline = time.time() + timeout
        while True:
            value = predicate()
            if value or time.time() >= deadline:
                return value
            time.sleep(0.05)

    # -- Fixtures

    def set_live(self, mapping):
        rows = [
            {"address": address, "name": name, "state": "live"}
            for name, address in mapping.items()
        ]
        self._write(self.ls_json, json.dumps({"terminals": rows}))

    def set_terminals(self, rows):
        self._write(self.ls_json, json.dumps({"terminals": rows}))

    def hc_calls(self, command=None):
        rows = [json.loads(line) for line in self._read(self.hc_log).splitlines() if line.strip()]
        if command:
            rows = [row for row in rows if row and row[0] == command]
        return rows

    def clear_log(self):
        self._write(self.hc_log, "")

    def set_spaces(self, rows):
        self._write(self.herdr_ls, json.dumps({"spaces": rows}))

    def herdr_calls(self, command=None):
        rows = [
            json.loads(line)
            for line in self._read(self.herdr_log).splitlines()
            if line.strip()
        ]
        if command:
            rows = [row for row in rows if row and row[:1] == [command]]
        return rows

    def clear_herdr_log(self):
        self._write(self.herdr_log, "")

    def events(self):
        path = os.path.join(self.home, "events.jsonl")
        rows = []
        for line in self._read(path).splitlines():
            if line.strip():
                rows.append(json.loads(line))
        return rows

    def wake_events(self, ticket=None):
        rows = [row for row in self.events() if row["kind"] == "wake"]
        if ticket:
            rows = [row for row in rows if row["ticket"] == ticket]
        return rows

    def add_events(self, rows):
        path = os.path.join(self.home, "events.jsonl")
        with open(path, "a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def mark(self):
        """Zahl der bisherigen Ereignisse; für Aussagen über neue Ereignisse."""
        return len(self.events())

    def events_since(self, mark, kind=None):
        rows = self.events()[mark:]
        if kind:
            rows = [row for row in rows if row["kind"] == kind]
        return rows

    def wake_since(self, mark, ticket=None):
        rows = self.events_since(mark, "wake")
        if ticket:
            rows = [row for row in rows if row["ticket"] == ticket]
        return rows

    def ticket(self, tid):
        with open(os.path.join(self.home, "tickets", f"{tid}.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def patch_ticket(self, tid, **fields):
        ticket = self.ticket(tid)
        ticket.update(fields)
        path = os.path.join(self.home, "tickets", f"{tid}.json")
        self._write(path, json.dumps(ticket, ensure_ascii=False, indent=2))
        return ticket

    def index(self):
        with open(os.path.join(self.home, "index.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def new(self, sentence="Test", repo=None, author=None):
        explicit = repo is not None
        repo = repo or self.default_repo()
        if explicit:
            self.own_repo(repo)
        args = ["new", sentence, "--repo", repo]
        if author:
            args += ["--from", author]
        result = self.ok(*args)
        return result.stdout.strip().splitlines()[-1]

    # -- Git

    def make_repo(self, name="repo"):
        return self.init_repo(os.path.join(self.tmp, name))

    def init_repo(self, path):
        os.makedirs(path, exist_ok=True)

        def git(*args):
            subprocess.run(
                ["git", *args], cwd=path, check=True, capture_output=True, text=True
            )

        git("init", "-q", "-b", "main")
        git("config", "user.email", "test@example.com")
        git("config", "user.name", "Test")
        self._write(os.path.join(path, "README.md"), "start\n")
        git("add", "README.md")
        git("commit", "-qm", "start")
        return path

    def git(self, repo, *args):
        return subprocess.run(
            ["git", *args], cwd=repo, capture_output=True, text=True
        )

    def git_out(self, repo, *args):
        result = self.git(repo, *args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def write_file(self, path, text):
        self._write(path, text)

    def ready_ticket(self, title="Kurzer Titel"):
        """Repo + verteiltes Ticket mit Worktree (Agent über den Stub gestartet)."""
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new(title)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("edit", tid, "--repo", repo, "--from", "mensch")
        self.ok(
            "edit", tid, "--body",
            "## Ziel\nEtwas tun.\n\n## Abnahmekriterien\n- [ ] es läuft\n\n## Grenzen\nkeine",
            "--from", "mensch",
        )
        started = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("verteilt", started.stdout)
        worktree = os.path.join(
            self.fake_home, ".herdr", "worktrees", "repo", f"fab-{tid}-kurzer-titel"
        )
        self.assertTrue(os.path.isdir(worktree))
        return repo, tid, worktree

    def commit_in(self, worktree, name="aenderung.txt", text="inhalt\n"):
        self._write(os.path.join(worktree, name), text)
        self.git(worktree, "add", name)
        result = self.git(worktree, "commit", "-qm", f"ändere {name}")
        self.assertEqual(result.returncode, 0, result.stderr)

    def passing_verify(self, worktree):
        path = os.path.join(worktree, ".fabric", "verify.sh")
        self._write(path, "#!/bin/sh\necho 'prüfung ok'\necho 'zweite zeile'\nexit 0\n")
