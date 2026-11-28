"""Gemeinsame Testhilfen: Temp-Home, Roster-Fixture, `hc`-Stub, Git-Repos."""
import atexit
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from fabric.fablib import store

# Scharfschaltung: `store.home()` bricht ab, wenn ein Test ohne temporäres
# FAB_HOME läuft. Die echten Daten unter dem Standard-Home bleiben unberührt.
os.environ["FAB_TEST_GUARD"] = "1"

FAB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fab")
FABRIC = os.path.dirname(FAB)

_TEMPLATE_LOCK = threading.Lock()
_TEMPLATE_REPO = None


def _git_at(path, *args):
    subprocess.run(
        ["git", *args], cwd=path, check=True, capture_output=True, text=True
    )


def template_repo():
    """Ein vorbereitetes Git-Repo; `init_repo` kopiert es statt neu zu bauen.

    Vier Git-Aufrufe je Fixture-Repo summieren sich über die Suite. Das
    Template entsteht einmal je Testprozess und enthält nur den Start-Commit.
    """
    global _TEMPLATE_REPO
    with _TEMPLATE_LOCK:
        if _TEMPLATE_REPO and os.path.isdir(_TEMPLATE_REPO):
            return _TEMPLATE_REPO
        path = tempfile.mkdtemp(prefix="fabtest-git-")
        _git_at(path, "init", "-q", "-b", "main")
        _git_at(path, "config", "user.email", "test@example.com")
        _git_at(path, "config", "user.name", "Test")
        with open(os.path.join(path, "README.md"), "w", encoding="utf-8") as handle:
            handle.write("start\n")
        _git_at(path, "add", "README.md")
        _git_at(path, "commit", "-qm", "start")
        atexit.register(shutil.rmtree, path, ignore_errors=True)
        _TEMPLATE_REPO = path
        return path

STUB_HC = '''#!/usr/bin/env python3
"""hc-Stub: protokolliert Aufrufe, beantwortet `ls --json` aus einer Fixture."""
import json
import os
import sys
import time

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
if command == "get":
    fixture = os.environ.get("HC_GET")
    entries = {}
    if fixture and os.path.isfile(fixture):
        try:
            with open(fixture, encoding="utf-8") as handle:
                entries = json.load(handle)
        except ValueError:
            entries = {}
    row = entries.get(args[1]) if isinstance(entries, dict) else None
    sys.stdout.write(json.dumps(row or {}))
    sys.exit(0)
if command == "read":
    fixture = os.environ.get("HC_READ")
    entries = {}
    if fixture and os.path.isfile(fixture):
        try:
            with open(fixture, encoding="utf-8") as handle:
                entries = json.load(handle)
        except ValueError:
            entries = {}
    text = entries.get(args[1], "") if isinstance(entries, dict) else ""
    sys.stdout.write(json.dumps({"text": text}))
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
    started = os.environ.get("HC_RUN_STARTED")
    release = os.environ.get("HC_RUN_RELEASE")
    if started:
        with open(started, "w", encoding="utf-8"):
            pass
    while release and not os.path.exists(release):
        time.sleep(0.05)
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
    started = os.environ.get("HC_KILL_STARTED")
    release = os.environ.get("HC_KILL_RELEASE")
    if started:
        with open(started, "w", encoding="utf-8"):
            pass
    while release and not os.path.exists(release):
        time.sleep(0.05)
    sys.exit(0)
sys.exit(0)
'''

STUB_HERDR = '''#!/usr/bin/env python3
"""herdr-app-Stub: protokolliert Aufrufe, beantwortet `ls` aus einer Fixture."""
import json
import os
import sys
import time

args = sys.argv[1:]
log = os.environ.get("HERDR_LOG")
if log:
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(args) + "\\n")

if os.environ.get("HERDR_APP_FAIL"):
    print("herdr-app: kein Fenster", file=sys.stderr)
    sys.exit(1)
if args[:1] == ["check"]:
    if os.environ.get("HERDR_CHECK_FAIL"):
        print("mod rot", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)
if args[:1] == ["shot"]:
    path = os.path.abspath(args[1])
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(b"\\x89PNG\\r\\n\\x1a\\nstub")
    print(path)
    sys.exit(0)
if not args:
    if os.environ.get("HERDR_APP_SLEEP"):
        time.sleep(60)
    sys.exit(0)
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
        os.environ["FAB_TEST_ROOT"] = self.tmp
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = os.path.join(self.tmp, "data")
        self.fake_home = os.path.join(self.tmp, "home")
        self.roster_dir = os.path.join(self.tmp, "fabric")
        self.bin = os.path.join(self.tmp, "bin")
        self.tmpdir = os.path.join(self.tmp, "tmp")
        for folder in (
            self.home,
            self.fake_home,
            self.roster_dir,
            os.path.join(self.roster_dir, "prompts"),
            self.bin,
            self.tmpdir,
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
        self._config_seen = {}
        self._config_paths = {}
        self.write_roster()
        self.hc_log = os.path.join(self.tmp, "hc.log")
        self.ls_json = os.path.join(self.tmp, "ls.json")
        self.get_json = os.path.join(self.tmp, "get.json")
        self.read_json = os.path.join(self.tmp, "read.json")
        self.claude_json = os.path.join(self.tmp, "claude.json")
        self.herdr_log = os.path.join(self.tmp, "herdr.log")
        self.herdr_ls = os.path.join(self.tmp, "herdr-ls.json")
        self._write(self.hc_log, "")
        self._write(self.herdr_log, "")
        self.set_live({})
        self.set_gets({})
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
            FAB_CLAUDE_JSON=self.claude_json,
            HC_LOG=self.hc_log,
            HC_LS=self.ls_json,
            HC_GET=self.get_json,
            HC_READ=self.read_json,
            HERDR_LOG=self.herdr_log,
            HERDR_LS=self.herdr_ls,
            FAB_TICK_AUTOSTART="0",
            TMPDIR=self.tmpdir,
            PATH=self.bin + os.pathsep + os.environ.get("PATH", ""),
            GIT_CONFIG_NOSYSTEM="1",
        )
        self._sync_config()

    # -- Grundlagen

    def _sync_config(self):
        """Datei-Fixture (Roster, Prompts, Vorlagen) in die Test-DB übernehmen.

        Die Tests arbeiten weiter mit Dateien im Rosterordner; der Fab-Betrieb
        liest SQLite. Geändert wird nur, wenn sich eine Datei seit dem letzten
        Lauf bewegt hat — so überschreibt das Seeden keine DB-Änderung einer
        vorherigen `fab`-Ausführung. Verschwundene Dateien löschen den Eintrag.
        """
        files = []
        if os.path.isfile(self.roster):
            files.append(("roster", self.roster, None))
        for folder, kind in (
            (os.path.join(self.roster_dir, "prompts"), "prompt"),
            (os.path.join(self.roster_dir, "templates"), "template"),
        ):
            if not os.path.isdir(folder):
                continue
            for name in sorted(os.listdir(folder)):
                if name.endswith(".md"):
                    files.append((kind, os.path.join(folder, name), name[:-3]))
        pending = []
        for kind, path, name in files:
            self._config_paths[path] = (kind, name)
            stat = os.stat(path)
            stamp = (stat.st_mtime_ns, stat.st_size)
            if self._config_seen.get(path) == stamp:
                continue
            try:
                with open(path, encoding="utf-8") as handle:
                    text = handle.read()
            except OSError:
                continue
            pending.append((kind, path, name, text, stamp, False))
        for path, (kind, name) in self._config_paths.items():
            if not os.path.exists(path):
                pending.append((kind, path, name, None, None, True))
        if not pending:
            return
        with mock.patch.dict(os.environ, {"FAB_HOME": self.home, "HOME": self.fake_home}):
            with store.locked():
                for kind, path, name, text, stamp, deleted in pending:
                    if deleted:
                        if kind == "roster":
                            store.config_delete(store.ROSTER_CONFIG_KEY)
                        elif kind == "prompt":
                            store.prompt_delete(f"prompts/{name}.md")
                        else:
                            store.template_delete(name)
                        self._config_seen.pop(path, None)
                        continue
                    if kind == "roster":
                        try:
                            store.roster_set(json.loads(text))
                        except ValueError:
                            continue
                    elif kind == "prompt":
                        store.prompt_set(f"prompts/{name}.md", text)
                    else:
                        store.template_set(name, text)
                    self._config_seen[path] = stamp

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
        with self.store_env():
            data = json.loads(store.config_get(store.ROSTER_CONFIG_KEY) or "{}")
        if not data.get("teams"):
            # Die Datei-Fixture in `write_roster` legt Teams erst an, sobald
            # ein Repo gehört wird. Der erste `own_repo`-Aufruf füllt das
            # deshalb nach, statt am fehlenden Schlüssel zu scheitern.
            agents = data.get("agents") or []
            data["blueprints"] = [dict(entry) for entry in agents]
            data["teams"] = [
                {
                    "name": team,
                    "repos": self._team_repos(),
                    "orchestrator": dict(data.get("orchestrator") or {}),
                    "members": [{"blueprint": entry["name"]} for entry in agents],
                    "reviewer": data.get("reviewer"),
                    "max_sessions": data.get("max_sessions", 4),
                }
            ]
            data.setdefault("max_sessions_total", data.get("max_sessions", 4))
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

    def cli(self, *args, env=None, cwd=None, input_text=None, timeout=None):
        self._sync_config()
        merged = dict(self.env)
        merged.update(env or {})
        return subprocess.run(
            [sys.executable, FAB, *args],
            cwd=cwd or self.tmp,
            env=merged,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
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

    def set_gets(self, rows):
        """Antworten für `hc get <name> --json` (Name → Dict)."""
        self._write(self.get_json, json.dumps(rows))

    def set_reads(self, rows):
        """Antworten für `hc read <name> --json` (Name → Text)."""
        self._write(self.read_json, json.dumps(rows))

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

    def store_env(self):
        """`store` im Fixture-Home ausführen, ohne Subprozess."""
        self._sync_config()
        return mock.patch.dict(os.environ, {"FAB_HOME": self.home, "HOME": self.fake_home})

    def meta(self, key):
        with self.store_env():
            return store.meta_get(key)

    def storage(self):
        with self.store_env():
            return store.storage_info()

    def events(self):
        with self.store_env():
            return store.event_rows()

    def wake_events(self, ticket=None):
        rows = [row for row in self.events() if row["kind"] == "wake"]
        if ticket:
            rows = [row for row in rows if row["ticket"] == ticket]
        return rows

    def add_events(self, rows):
        with self.store_env():
            with store.locked():
                for row in rows:
                    store.event_append(
                        row.get("kind"),
                        row.get("ticket", ""),
                        actor=row.get("actor", ""),
                        target=row.get("target", ""),
                        text=row.get("text", ""),
                        reason=row.get("reason", ""),
                        at=row.get("at"),
                    )

    def clear_events(self):
        with self.store_env():
            with store.locked():
                store.event_clear()

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
        with self.store_env():
            payload = store.read_model_json(store.ticket_model_key(tid))
        if payload is None:
            raise FileNotFoundError(f"Ticket {tid} hat kein Lesemodell")
        return payload

    def patch_ticket(self, tid, **fields):
        with self.store_env():
            with store.locked():
                ticket = store.load(tid)
                ticket.update(fields)
                store.save(ticket, touch=False)
        return ticket

    def index(self):
        with self.store_env():
            payload = store.read_model_json("index")
        if payload is None:
            raise FileNotFoundError("index hat kein Lesemodell")
        return payload

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
        shutil.copytree(template_repo(), path, dirs_exist_ok=True)
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
        tid = self.new(title, repo=repo)
        self.ok("assign", tid, "zap", "--from", "mensch")
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

    LISTE = "".join(f"zeile {n}\n" for n in range(1, 9))

    def shared_review_ticket(self):
        """Ticket in review, das `liste.txt` in Zeile 1 ändert; main kann Zeile 8
        derselben Datei ohne Konflikt ändern (überlappende Dateien)."""
        repo, tid, worktree = self.ready_ticket()
        self._write(os.path.join(repo, "liste.txt"), self.LISTE)
        self.git(repo, "add", "liste.txt")
        self.git(repo, "commit", "-qm", "liste anlegen")
        merged = self.git(worktree, "merge", "-q", "--no-edit", "main")
        self.assertEqual(merged.returncode, 0, merged.stderr)
        self.commit_in(worktree, "liste.txt", self.LISTE.replace("zeile 1\n", "zeile eins\n"))
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        return repo, tid, worktree

    def main_changes_shared_file(self, repo):
        """main ändert Zeile 8 von `liste.txt` – dieselbe Datei wie das Ticket."""
        self._write(os.path.join(repo, "liste.txt"), self.LISTE.replace("zeile 8\n", "zeile acht\n"))
        self.git(repo, "add", "liste.txt")
        self.git(repo, "commit", "-qm", "main läuft weiter")

    def passing_verify(self, worktree, commit=True):
        """Grünes Prüfskript anlegen; standardmäßig committen, damit es auch im
        temporären Merge-Worktree (nur committete Dateien) vorhanden ist."""
        path = os.path.join(worktree, ".fabric", "verify.sh")
        self._write(path, "#!/bin/sh\necho 'prüfung ok'\necho 'zweite zeile'\nexit 0\n")
        if commit:
            self.git(worktree, "add", ".fabric/verify.sh")
            result = self.git(worktree, "commit", "-qm", "Prüfskript")
            self.assertEqual(result.returncode, 0, result.stderr)
