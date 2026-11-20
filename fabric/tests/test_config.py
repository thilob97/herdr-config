"""Pflegebefehle aus Abschnitt 3b: Roster, Agenten, Einstellungen, Prompts, Repos."""
import json
import os
import stat
from unittest import mock

from fabric.fablib import config
from fabric.fablib.errors import FabError
from fabric.tests.support import FabricCase


class ConfigCase(FabricCase):
    def mark(self):
        if not os.path.exists(os.path.join(self.home, "events.jsonl")):
            return 0
        return super().mark()

    def roster_json(self):
        return json.loads(self._read(self.roster))

    def write_raw_roster(self, data):
        self._write(self.roster, json.dumps(data, ensure_ascii=False, indent=2))

    def prompt_path(self, name):
        return os.path.join(self.roster_dir, "prompts", f"{name}.md")

    def config_call(self, function, *args, **kwargs):
        """Ruft die config-API im Fixture-Umfeld auf (ohne Subprozess)."""
        with mock.patch.dict(os.environ, self.env):
            return function(*args, **kwargs)


class RosterTests(ConfigCase):
    def test_roster_json_mit_abgeleiteten_feldern(self):
        self.write_roster(
            agents=[
                {"name": "zap", "role": "umsetzer", "color": "c1",
                 "prompt": "prompts/zap.md",
                 "argv": ["omp", "--model=foo/bar", "--max-cost=5"]},
                {"name": "ada", "role": "pruefer", "color": "c2",
                 "prompt": "prompts/ada.md",
                 "argv": ["claude", "--model", "opus"]},
            ]
        )
        tid = self.new("Offen")
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.set_terminals(
            [
                {"address": "t5", "name": "fab-zap-t-1", "state": "live",
                 "status": "working"},
                {"address": "t0", "name": "fab-orchestrator", "state": "live",
                 "status": "idle"},
            ]
        )
        payload = json.loads(self.ok("roster", "--json").stdout)
        self.assertEqual(payload["path"], self.roster)
        self.assertEqual(payload["max_sessions"], 4)
        self.assertEqual(payload["reviewer"], "ada")
        self.assertEqual(
            payload["orchestrator"],
            {"argv": ["true"], "prompt": "prompts/orchestrator.md"},
        )
        rows = {row["name"]: row for row in payload["agents"]}
        zap = rows["zap"]
        self.assertEqual(zap["argv"], ["omp", "--model=foo/bar", "--max-cost=5"])
        self.assertEqual(zap["program"], "omp")
        self.assertEqual(zap["model"], "foo/bar")
        self.assertEqual(zap["flags"], ["--max-cost=5"])
        self.assertEqual(zap["prompt"], "prompts/zap.md")
        self.assertEqual(zap["open_tickets"], 1)
        self.assertEqual(
            zap["sessions"],
            [{"name": "fab-zap-t-1", "terminal": "t5", "status": "working"}],
        )
        ada = rows["ada"]
        self.assertEqual((ada["program"], ada["model"], ada["flags"]),
                         ("claude", "opus", []))
        self.assertEqual(ada["sessions"], [])
        self.assertEqual(ada["open_tickets"], 0)

        roster_index = {row["name"]: row for row in self.index()["roster"]}
        self.assertEqual(roster_index["zap"]["program"], "omp")
        self.assertEqual(roster_index["zap"]["model"], "foo/bar")
        self.assertEqual(roster_index["ada"]["model"], "opus")
        text = self.ok("roster").stdout
        self.assertIn("zap", text)
        self.assertIn("ada", text)

    def test_roster_json_ohne_hc(self):
        result = self.ok("roster", "--json", env={"PATH": "/usr/bin:/bin"})
        payload = json.loads(result.stdout)
        self.assertEqual([row["name"] for row in payload["agents"]], ["zap", "ada"])
        self.assertEqual(payload["agents"][0]["sessions"], [])

    def test_roster_fehlt(self):
        os.unlink(self.roster)
        result = self.cli("roster", "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Roster fehlt", result.stderr)


class AgentTests(ConfigCase):
    def test_agent_add_legt_prompt_und_eintrag_an(self):
        self.write_roster(
            agents=[
                {"name": "zap", "role": "umsetzer", "color": "c1",
                 "prompt": "prompts/zap.md", "argv": ["true"]},
                {"name": "ada", "role": "pruefer", "color": "c3",
                 "prompt": "prompts/ada.md", "argv": ["true"]},
            ]
        )
        mark = self.mark()
        result = self.ok(
            "agent", "add", "mira", "--role", "recherche",
            "--argv-json", '["pi", "--model", "sonnet", "--flag"]',
            "--from", "mensch",
        )
        self.assertIn("mira", result.stdout)
        data = self.roster_json()
        self.assertEqual(
            data["agents"][-1],
            {
                "name": "mira",
                "role": "recherche",
                "color": "c2",
                "prompt": "prompts/mira.md",
                "argv": ["pi", "--model", "sonnet", "--flag"],
            },
        )
        text = self._read(self.prompt_path("mira"))
        self.assertIn("mira", text)
        self.assertIn("recherche", text)
        payload = json.loads(self.ok("roster", "--json").stdout)
        mira = [row for row in payload["agents"] if row["name"] == "mira"][0]
        self.assertEqual(
            (mira["program"], mira["model"], mira["flags"]),
            ("pi", "sonnet", ["--flag"]),
        )
        self.assertIn("mira", [row["name"] for row in self.index()["roster"]])
        configs = self.events_since(mark, "config")
        self.assertEqual(len(configs), 1)
        self.assertIn("mira", configs[0]["text"])

    def test_agent_add_erhaelt_unbekannte_felder(self):
        data = self.write_roster()
        data["extra"] = {"a": 1}
        data["agents"][1]["note"] = "bleibt"
        self.write_raw_roster(data)
        self.ok("agent", "add", "mira", "--role", "recherche",
                "--argv-json", '["pi"]', "--from", "mensch")
        fresh = self.roster_json()
        self.assertEqual(fresh["extra"], {"a": 1})
        self.assertEqual(fresh["agents"][1]["note"], "bleibt")
        self.assertEqual([row["name"] for row in fresh["agents"]],
                         ["zap", "ada", "mira"])

    def test_agent_add_nutzt_bestehenden_prompt(self):
        before = self._read(self.prompt_path("zap"))
        self.ok("agent", "rm", "zap", "--from", "mensch")
        self.ok("agent", "add", "zap", "--role", "umsetzer",
                "--argv-json", '["true"]', "--from", "mensch")
        self.assertEqual(self._read(self.prompt_path("zap")), before)
        self.assertEqual(self.roster_json()["agents"][-1]["prompt"], "prompts/zap.md")

    def test_agent_add_mit_prompt_text(self):
        self.ok(
            "agent", "add", "mira", "--role", "recherche",
            "--argv-json", '["pi"]', "--prompt-text", "Eigene Rolle\n",
            "--from", "mensch",
        )
        self.assertEqual(self._read(self.prompt_path("mira")), "Eigene Rolle\n")

    def test_agent_add_weist_ungueltiges_ab(self):
        cases = [
            (("add", "Mira", "--role", "r", "--argv-json", '["x"]'),
             "ungültig"),
            (("add", "1zap", "--role", "r", "--argv-json", '["x"]'),
             "ungültig"),
            (("add", "a" * 17, "--role", "r", "--argv-json", '["x"]'),
             "ungültig"),
            (("add", "orchestrator", "--role", "r", "--argv-json", '["x"]'),
             "reserviert"),
            (("add", "mensch", "--role", "r", "--argv-json", '["x"]'),
             "reserviert"),
            (("add", "fab", "--role", "r", "--argv-json", '["x"]'),
             "reserviert"),
            (("add", "preamble", "--role", "r", "--argv-json", '["x"]'),
             "reserviert"),
            (("add", "zap", "--role", "r", "--argv-json", '["x"]'),
             "gibt es schon"),
            (("add", "mira", "--role", "r", "--argv-json", '["x"]',
              "--color", "c9"), "Farbe"),
            (("add", "mira", "--role", "r", "--argv-json", "[]"),
             "nicht-leere"),
            (("add", "mira", "--role", "r", "--argv-json", '[""]'),
             "leeren Eintrag"),
            (("add", "mira", "--role", "r", "--argv-json", "[1]"),
             "keinen String"),
            (("add", "mira", "--role", "r", "--argv-json", "kein json"),
             "kein gültiges JSON"),
            (("add", "mira", "--role", " ", "--argv-json", '["x"]'),
             "Rolle"),
        ]
        before = self._read(self.roster)
        for args, message in cases:
            result = self.cli("agent", args[0], *args[1:], "--from", "mensch")
            self.assertNotEqual(result.returncode, 0, args)
            self.assertIn(message, result.stderr, args)
            self.assertEqual(self._read(self.roster), before, args)
        result = self.cli("agent", "add", "mira", "--role", "r",
                          "--argv-json", '["x"]')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--from", result.stderr)

    def test_agent_edit_erhaelt_unbekannte_felder(self):
        data = self.write_roster()
        data["unknown_top"] = {"keep": True}
        data["agents"][0]["notes"] = "bleibt"
        self.write_raw_roster(data)
        mark = self.mark()
        result = self.ok(
            "agent", "edit", "zap", "--role", "pruefer", "--color", "c5",
            "--argv-json", '["claude", "--model", "opus"]', "--from", "mensch",
        )
        self.assertIn("zap", result.stdout)
        fresh = self.roster_json()
        self.assertEqual(fresh["unknown_top"], {"keep": True})
        zap = fresh["agents"][0]
        self.assertEqual(zap["notes"], "bleibt")
        self.assertEqual(zap["role"], "pruefer")
        self.assertEqual(zap["color"], "c5")
        self.assertEqual(zap["argv"], ["claude", "--model", "opus"])
        self.ok("agent", "edit", "zap", "--prompt-text", "Neue Rolle\n",
                "--from", "mensch")
        self.assertEqual(self._read(self.prompt_path("zap")), "Neue Rolle\n")
        self.assertEqual(len(self.events_since(mark, "config")), 2)
        result = self.cli("agent", "edit", "zap", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Nichts zu ändern", result.stderr)
        result = self.cli("agent", "edit", "zap", "--color", "c9",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Farbe", result.stderr)

    def test_agent_edit_rename_zieht_prompt_und_reviewer_nach(self):
        self.ok("agent", "edit", "ada", "--rename", "pruefer", "--from", "mensch")
        data = self.roster_json()
        self.assertEqual([row["name"] for row in data["agents"]],
                         ["zap", "pruefer"])
        self.assertEqual(data["reviewer"], "pruefer")
        self.assertEqual(data["agents"][1]["prompt"], "prompts/pruefer.md")
        self.assertTrue(os.path.isfile(self.prompt_path("pruefer")))
        self.assertFalse(os.path.exists(self.prompt_path("ada")))

    def test_agent_edit_rename_verweigert_bei_arbeit(self):
        before = self._read(self.roster)
        self.set_live({"fab-zap-t-1": "t5"})
        result = self.cli("agent", "edit", "zap", "--rename", "zoe",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht umbenannt", result.stderr)
        self.assertIn("laufende Sessions: fab-zap-t-1", result.stderr)
        self.assertEqual(self._read(self.roster), before)

        self.set_live({})
        tid = self.new("Offen")
        self.ok("assign", tid, "zap", "--from", "mensch")
        result = self.cli("agent", "edit", "zap", "--rename", "zoe",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"offene Tickets: {tid} (draft)", result.stderr)

        result = self.cli("agent", "edit", "zap", "--rename", "ada",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gibt es schon", result.stderr)
        result = self.cli("agent", "edit", "zap", "--rename", "Zoe",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ungültig", result.stderr)

    def test_agent_rm_entfernt_nur_freie_agenten(self):
        mark = self.mark()
        result = self.cli("agent", "rm", "ada", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Prüfer", result.stderr)
        result = self.ok("agent", "rm", "zap", "--from", "mensch")
        self.assertEqual([row["name"] for row in self.roster_json()["agents"]],
                         ["ada"])
        self.assertIn("prompts/zap.md", result.stdout)
        self.assertTrue(os.path.isfile(self.prompt_path("zap")))
        self.assertEqual(len(self.events_since(mark, "config")), 1)

    def test_agent_rm_nennt_alle_gruende(self):
        tid = self.new("Offen")
        self.ok("assign", tid, "ada", "--from", "mensch")
        self.set_live({"fab-ada-t-1": "t5"})
        result = self.cli("agent", "rm", "ada", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        for part in ("Prüfer", f"{tid} (draft)", "fab-ada-t-1"):
            self.assertIn(part, result.stderr)
        self.assertEqual([row["name"] for row in self.roster_json()["agents"]],
                         ["zap", "ada"])


class SettingsTests(ConfigCase):
    def test_settings_set_max_sessions_und_reviewer(self):
        mark = self.mark()
        self.ok("settings", "set", "max_sessions", "3", "--from", "mensch")
        self.assertEqual(self.roster_json()["max_sessions"], 3)
        self.ok("settings", "set", "reviewer", "zap", "--from", "mensch")
        self.assertEqual(self.roster_json()["reviewer"], "zap")
        texts = [row["text"] for row in self.events_since(mark, "config")]
        self.assertEqual(texts, ["max_sessions: 4 → 3", "reviewer: zap"])
        for value in ("0", "17", "viele"):
            result = self.cli("settings", "set", "max_sessions", value,
                              "--from", "mensch")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("max_sessions", result.stderr)
        result = self.cli("settings", "set", "reviewer", "fremd",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Roster", result.stderr)
        result = self.cli("settings", "set", "quatsch", "1", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekannte Einstellung", result.stderr)

    def test_settings_orchestrator_argv_erhaelt_felder(self):
        data = self.write_roster()
        data["orchestrator"]["extra"] = "bleibt"
        data["unknown"] = [1, 2]
        self.write_raw_roster(data)
        self.ok(
            "settings", "set", "orchestrator_argv",
            '["omp", "--approval-mode=always-ask-cached"]', "--from", "mensch",
        )
        fresh = self.roster_json()
        self.assertEqual(
            fresh["orchestrator"]["argv"],
            ["omp", "--approval-mode=always-ask-cached"],
        )
        self.assertEqual(fresh["orchestrator"]["extra"], "bleibt")
        self.assertEqual(fresh["orchestrator"]["prompt"], "prompts/orchestrator.md")
        self.assertEqual(fresh["unknown"], [1, 2])
        result = self.cli("settings", "set", "orchestrator_argv", "[]",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht-leere", result.stderr)


class PromptTests(ConfigCase):
    def test_prompt_list_und_show(self):
        rows = json.loads(self.ok("prompt", "list", "--json").stdout)
        self.assertEqual([row["name"] for row in rows],
                         ["orchestrator", "preamble", "zap", "ada"])
        self.assertEqual([row["kind"] for row in rows],
                         ["orchestrator", "preamble", "agent", "agent"])
        preamble = rows[1]
        self.assertEqual(
            preamble["path"],
            os.path.abspath(os.path.join(self.roster_dir, "prompts", "preamble.md")),
        )
        self.assertEqual(preamble["bytes"], os.path.getsize(preamble["path"]))
        self.assertEqual(
            preamble["placeholders"],
            ["id", "title", "agent", "role", "worktree", "branch", "base",
             "reviewer"],
        )
        self.assertEqual(rows[0]["placeholders"], [])
        self.assertEqual(self.ok("prompt", "show", "preamble").stdout,
                         self._read(preamble["path"]))
        self.assertIn("Zap-Rolle", self.ok("prompt", "show", "zap").stdout)
        self.assertIn("Orchestrator-Rolle",
                      self.ok("prompt", "show", "orchestrator").stdout)
        result = self.cli("prompt", "show", "fremd")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("orchestrator, preamble, zap, ada", result.stderr)
        os.unlink(self.prompt_path("ada"))
        rows = {row["name"]: row
                for row in json.loads(self.ok("prompt", "list", "--json").stdout)}
        self.assertEqual(rows["ada"]["bytes"], 0)
        self.assertEqual(rows["ada"]["placeholders"], [])

    def test_prompt_set_warnt_bei_unbekannten_platzhaltern(self):
        mark = self.mark()
        result = self.ok(
            "prompt", "set", "preamble",
            "--text", "# {id} von {agent}\n\nUnbekannt: {quatsch}\n",
            "--from", "mensch",
        )
        self.assertIn("Warnung", result.stderr)
        self.assertIn("{quatsch}", result.stderr)
        self.assertIn("bekannt sind", result.stderr)
        self.assertEqual(
            self._read(self.prompt_path("preamble")),
            "# {id} von {agent}\n\nUnbekannt: {quatsch}\n",
        )
        configs = self.events_since(mark, "config")
        self.assertEqual(len(configs), 1)
        self.assertIn("preamble", configs[0]["text"])
        result = self.ok("prompt", "set", "zap", "--text", "Nur {id}\n",
                         "--from", "mensch")
        self.assertNotIn("Warnung", result.stderr)
        rows = {row["name"]: row
                for row in json.loads(self.ok("prompt", "list", "--json").stdout)}
        self.assertEqual(rows["zap"]["placeholders"], ["id"])
        self.assertEqual(rows["preamble"]["placeholders"], ["id", "agent", "quatsch"])

    def test_prompt_je_team_und_blueprint_ausserhalb_des_ersten_teams(self):
        self.ok("roster", "--json")
        data = self.roster_json()
        data["teams"].append({
            "name": "zweit",
            "repos": [os.path.join(self.tmp, "zweit-repo")],
            "orchestrator": {"argv": ["true"],
                             "prompt": "prompts/zweit-orchestrator.md"},
            "members": [{"blueprint": "ada"}, {"blueprint": "nur"}],
            "reviewer": "ada",
            "max_sessions": 2,
        })
        data["blueprints"].append({
            "name": "nur", "role": "recherche", "color": "c6",
            "prompt": "prompts/nur.md", "argv": ["true"],
        })
        data["max_sessions_total"] = 6
        self.write_raw_roster(data)
        self._write(self.prompt_path("zweit-orchestrator"), "Zweites Team.\n")
        self._write(self.prompt_path("nur"), "Nur-Rolle.\n")

        self.assertEqual(
            self.ok("prompt", "show", "orchestrator", "--team", "zweit").stdout,
            "Zweites Team.\n",
        )
        self.assertIn(
            "Orchestrator-Rolle",
            self.ok("prompt", "show", "orchestrator").stdout,
        )
        self.assertEqual(self.ok("prompt", "show", "nur").stdout, "Nur-Rolle.\n")

        self.ok("prompt", "set", "orchestrator", "--team", "zweit",
                "--text", "Neu für zwei.\n", "--from", "mensch")
        self.assertEqual(
            self._read(self.prompt_path("zweit-orchestrator")), "Neu für zwei.\n")
        self.assertIn(
            "Orchestrator-Rolle",
            self._read(self.prompt_path("orchestrator")),
        )
        result = self.cli("prompt", "show", "orchestrator", "--team", "fehlt")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekanntes Team", result.stderr)


class OrchestratorTests(ConfigCase):
    def test_status_json_ohne_lauf(self):
        payload = json.loads(self.ok("orchestrator", "status", "--json").stdout)
        self.assertEqual(
            payload,
            {"team": "herdr-app", "live": False,
             "name": "fab-herdr-app-orchestrator", "terminal": None,
             "status": None, "started_at": None},
        )
        self.assertIn("läuft nicht", self.ok("orchestrator", "status").stdout)

    def test_status_json_mit_lauf(self):
        self.ok("orchestrator", "start")
        self.set_terminals(
            [{"address": "t0", "name": "fab-orchestrator", "state": "live",
              "status": "working"}]
        )
        payload = json.loads(self.ok("orchestrator", "status", "--json").stdout)
        self.assertTrue(payload["live"])
        self.assertEqual(payload["terminal"], "t0")
        self.assertEqual(payload["status"], "working")
        self.assertIsInstance(payload["started_at"], int)
        self.assertIn("läuft (t0)", self.ok("orchestrator", "status").stdout)

    def test_status_ohne_hc(self):
        payload = json.loads(
            self.ok("orchestrator", "status", "--json",
                    env={"PATH": "/usr/bin:/bin"}).stdout
        )
        self.assertFalse(payload["live"])

    def test_restart_bricht_ab_wenn_kill_scheitert(self):
        self.set_live({"fab-herdr-app-orchestrator": "t0"})
        self.clear_log()
        result = self.cli(
            "orchestrator", "restart", "--from", "mensch",
            env={"HC_KILL_FAIL": "1"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ließ sich nicht beenden", result.stderr)
        self.assertEqual(self.hc_calls("run"), [])

    def test_restart_mit_from(self):
        self.set_live({"fab-orchestrator": "t0"})
        mark = self.mark()
        self.clear_log()
        result = self.ok("orchestrator", "restart", "--from", "mensch")
        self.assertIn("neu gestartet", result.stdout)
        calls = self._read(self.hc_log)
        self.assertIn('"kill"', calls)
        self.assertIn('"run"', calls)
        kinds = [row["kind"] for row in self.events_since(mark)]
        self.assertIn("config", kinds)
        self.assertIn("orchestrator", kinds)
        result = self.cli("orchestrator", "restart")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--from", result.stderr)


class RepoTests(ConfigCase):
    def test_repos_json_aus_tickets_und_add(self):
        repo = self.make_repo()
        second = self.make_repo("zwei")
        plain = os.path.join(self.tmp, "kein-repo")
        os.makedirs(plain)
        self.new("Ticket mit Repo", repo=repo)
        rows = json.loads(
            self.ok("repos", "--json", "--add", second, plain, repo).stdout
        )
        paths = [row["path"] for row in rows]
        self.assertEqual(
            paths, sorted([os.path.realpath(repo), os.path.realpath(second)])
        )
        self.assertEqual(len(paths), len(set(paths)))
        first = [row for row in rows if row["path"] == os.path.realpath(repo)][0]
        self.assertEqual(first["branch"], "main")
        self.assertEqual(first["open_tickets"], 1)
        self.assertFalse(first["verify_exists"])
        self.assertFalse(first["lessons_exists"])
        second_row = [row for row in rows if row["path"] != first["path"]][0]
        self.assertEqual(second_row["open_tickets"], 0)
        self.assertIn(os.path.realpath(second),
                      self.ok("repos", "--add", second).stdout)

    def test_repo_show_set_und_test(self):
        repo = self.make_repo()
        data = json.loads(self.ok("repo", "show", repo, "--json").stdout)
        self.assertEqual(data["path"], os.path.realpath(repo))
        self.assertEqual(data["branch"], "main")
        self.assertEqual(data["verify"], {"exists": False, "text": None})
        self.assertEqual(data["lessons"], {"exists": False, "text": None})

        mark = self.mark()
        self.ok("repo", "set", repo, "verify",
                "--text", "#!/bin/sh\necho 'ok'\nexit 0\n", "--from", "mensch")
        script = os.path.join(repo, ".fabric", "verify.sh")
        self.assertTrue(os.path.isfile(script))
        self.assertEqual(stat.S_IMODE(os.stat(script).st_mode), 0o755)
        self.assertEqual(
            stat.S_IMODE(os.stat(os.path.join(repo, ".fabric")).st_mode), 0o755
        )
        self.ok("repo", "set", repo, "lessons", "--text", "# Notizen\n",
                "--from", "mensch")
        lessons = os.path.join(repo, ".fabric", "lessons.md")
        self.assertEqual(stat.S_IMODE(os.stat(lessons).st_mode), 0o644)
        self.assertEqual(len(self.events_since(mark, "config")), 2)

        shown = json.loads(self.ok("repo", "show", repo, "--json").stdout)
        self.assertTrue(shown["verify"]["exists"])
        self.assertIn("echo 'ok'", shown["verify"]["text"])
        self.assertEqual(shown["lessons"]["text"], "# Notizen\n")

        result = self.ok("repo", "test", repo, "--json")
        self.assertEqual(json.loads(result.stdout)["exit"], 0)
        text = self.ok("repo", "test", repo).stdout
        self.assertIn("Exit 0", text)
        self.assertIn("ok", text)

    def test_repo_test_ohne_skript_und_mit_fehler(self):
        repo = self.make_repo()
        result = self.cli("repo", "test", repo, "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Prüfskript fehlt", result.stderr)
        self.assertIn("verify.sh", result.stderr)
        lines = "\n".join(f"zeile {number}" for number in range(1, 51))
        self.ok(
            "repo", "set", repo, "verify",
            "--text", f"#!/bin/sh\ncat <<'EOF'\n{lines}\nEOF\nexit 3\n",
            "--from", "mensch",
        )
        payload = json.loads(self.ok("repo", "test", repo, "--json").stdout)
        self.assertEqual(payload["exit"], 3)
        tail = payload["tail"].splitlines()
        self.assertEqual(len(tail), 40)
        self.assertEqual(tail[0], "zeile 11")
        self.assertEqual(tail[-1], "zeile 50")

    def test_repo_set_verweigert_symlink_fabric(self):
        repo = self.make_repo()
        outside = os.path.join(self.tmp, "aussen")
        os.makedirs(outside)
        os.chmod(outside, 0o700)
        os.symlink(outside, os.path.join(repo, ".fabric"))
        for kind in ("verify", "lessons"):
            result = self.cli("repo", "set", repo, kind, "--text", "x",
                              "--from", "mensch")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("kein echtes Verzeichnis", result.stderr)
        self.assertEqual(os.listdir(outside), [])
        # chmod darf nur das eigene, echte .fabric treffen
        self.assertEqual(stat.S_IMODE(os.stat(outside).st_mode), 0o700)

    def test_repo_set_laesst_bestehende_rechte(self):
        repo = self.make_repo()
        folder = os.path.join(repo, ".fabric")
        os.makedirs(folder)
        os.chmod(folder, 0o700)
        self.ok("repo", "set", repo, "lessons", "--text", "x", "--from", "mensch")
        self.assertEqual(stat.S_IMODE(os.stat(folder).st_mode), 0o700)

    def test_repo_set_verweigert_ziel_ausserhalb(self):
        repo = self.make_repo()
        os.makedirs(os.path.join(repo, ".fabric"))
        outside = os.path.join(self.tmp, "ziel.sh")
        self.write_file(outside, "bleibt\n")
        os.symlink(outside, os.path.join(repo, ".fabric", "verify.sh"))
        result = self.cli("repo", "set", repo, "verify", "--text", "neu\n",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("außerhalb", result.stderr)
        self.assertEqual(self._read(outside), "bleibt\n")

    def test_repo_befehle_nutzen_den_haupt_checkout(self):
        repo = self.make_repo()
        linked = os.path.join(self.tmp, "linked")
        self.git_out(repo, "worktree", "add", "-q", linked, "-b", "neben")
        shown = json.loads(self.ok("repo", "show", linked, "--json").stdout)
        self.assertEqual(shown["path"], os.path.realpath(repo))
        rows = json.loads(self.ok("repos", "--json", "--add", linked).stdout)
        self.assertEqual([row["path"] for row in rows], [os.path.realpath(repo)])
        self.ok("repo", "set", linked, "verify",
                "--text", "#!/bin/sh\nexit 0\n", "--from", "mensch")
        self.assertTrue(
            os.path.isfile(os.path.join(repo, ".fabric", "verify.sh"))
        )
        self.assertFalse(os.path.exists(os.path.join(linked, ".fabric")))
        self.assertEqual(
            json.loads(self.ok("repo", "test", linked, "--json").stdout)["exit"], 0
        )

    def test_repo_verweigert_ausserhalb_von_git(self):
        folder = os.path.join(self.tmp, "nur-ordner")
        os.makedirs(folder)
        result = self.cli("repo", "set", folder, "verify", "--text", "x",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("keine Git-Wurzel", result.stderr)
        result = self.cli("repo", "show", folder, "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("keine Git-Wurzel", result.stderr)
        result = self.cli("repo", "test", folder)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("keine Git-Wurzel", result.stderr)
        repo = self.make_repo()
        result = self.cli("repo", "set", repo, "quatsch", "--text", "x",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ungültige Auswahl", result.stderr)


class TicketPflegeTests(ConfigCase):
    def test_link_remove(self):
        first = self.new("A")
        second = self.new("B")
        third = self.new("C")
        self.ok("link", first, "--blocked-by", second, third, "--from", "mensch")
        mark = self.mark()
        result = self.ok("link", first, "--remove", second, "--from", "mensch")
        self.assertIn(third, result.stdout)
        self.assertEqual(self.ticket(first)["blocked_by"], [third])
        self.assertEqual(len(self.events_since(mark, "config")), 1)
        result = self.cli("link", first, "--remove", second, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nichts zu entfernen", result.stderr)
        self.assertEqual(self.ticket(first)["blocked_by"], [third])

    def test_new_no_wake_legt_nur_entwurf(self):
        self.clear_log()
        mark = self.mark()
        result = self.ok("new", "Nur ein Entwurf", "--no-wake",
                         "--repo", self.default_repo())
        tid = result.stdout.strip().splitlines()[-1]
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "draft")
        self.assertEqual(ticket["comments"], [])
        self.assertEqual(self.wake_since(mark), [])
        self.assertEqual(self.hc_calls("run"), [])
        created = self.events_since(mark, "created")
        self.assertEqual(created[-1]["ticket"], tid)

class FreitextTests(ConfigCase):
    """Texte mit führendem `-`: `--flag=…` bei Optionen, `--` vor Positionals."""

    MARKS = ("-wichtig", "---")

    def test_new_nimmt_fuehrende_striche(self):
        for mark in self.MARKS:
            result = self.ok("new", "--no-wake", "--repo", self.default_repo(),
                             "--", mark)
            ticket = self.ticket(result.stdout.strip().splitlines()[-1])
            self.assertEqual(ticket["title"], mark)
            self.assertEqual(ticket["body"], f"## Auftrag\n{mark}")

    def test_comment_nimmt_dashdash(self):
        tid = self.new("Kommentar")
        for mark in self.MARKS:
            self.ok("comment", tid, "--from", "zap", "--", mark)
            self.assertEqual(self.ticket(tid)["comments"][-1]["text"], mark)

    def test_edit_optionen_mit_gleichheitszeichen(self):
        tid = self.new("Titel")
        for title, body in zip(self.MARKS, reversed(self.MARKS)):
            self.ok("edit", tid, f"--title={title}", f"--body={body}",
                    "--from", "mensch")
            ticket = self.ticket(tid)
            self.assertEqual(ticket["title"], title)
            self.assertEqual(ticket["body"], body)

    def test_prompt_set_und_repo_set_mit_gleichheitszeichen(self):
        for mark in self.MARKS:
            self.ok("prompt", "set", "preamble", f"--text={mark}\n",
                    "--from", "mensch")
            self.assertEqual(self._read(self.prompt_path("preamble")), f"{mark}\n")
        repo = self.make_repo()
        for mark in self.MARKS:
            self.ok("repo", "set", repo, "lessons", f"--text={mark}",
                    "--from", "mensch")
            self.assertEqual(
                self._read(os.path.join(repo, ".fabric", "lessons.md")), mark
            )

    def test_wake_nimmt_dashdash(self):
        tid = self.new("Hand")
        for mark in self.MARKS:
            result = self.ok("wake", tid, "mensch", "--from", "zap", "--", mark)
            self.assertIn("@mensch: unterdrückt: mensch", result.stdout)

    def test_wake_schickt_den_text_mit(self):
        tid = self.new("Hand")
        self.set_live({"fab-zap-t-1": "t7"})
        for mark in self.MARKS:
            self.ok("wake", tid, "zap", "--from", "mensch", "--", mark)
            self.assertIn(f"„{mark}“", self.hc_calls("send")[-1][-1])

    def test_wake_ohne_dashdash_bleibt_moeglich(self):
        tid = self.new("Hand")
        self.ok("wake", tid, "mensch", "--from", "zap")
        self.set_live({"fab-zap-t-1": "t7"})
        self.ok("wake", tid, "zap", "--from", "mensch", "hallo welt")
        self.assertIn("„hallo welt“", self.hc_calls("send")[-1][-1])

    def test_verdict_und_handover_nehmen_dashdash(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree)
        self.passing_verify(worktree)
        self.ok("verify", tid)
        for mark in self.MARKS:
            self.ok("verdict", tid, "pass", "--from", "ada", "--", mark)
            self.assertEqual(self.ticket(tid)["verdict"]["summary"], mark)
        result = self.ok("handover", tid, "--from", "zap", "--", "---")
        self.assertIn("übergeben", result.stdout)
        self.assertEqual(self.ticket(tid)["comments"][-1]["text"], "---")

    def test_reject_und_drop_nehmen_dashdash(self):
        for mark in self.MARKS:
            tid = self.new("Zurück")
            self.patch_ticket(tid, status="review")
            self.ok("reject", tid, "--", mark)
            ticket = self.ticket(tid)
            self.assertEqual(ticket["status"], "doing")
            self.assertEqual(ticket["comments"][-1]["text"], mark)
            tid = self.new("Weg")
            self.ok("drop", tid, "--from", "zap", "--", mark)
            ticket = self.ticket(tid)
            self.assertEqual(ticket["status"], "dropped")
            self.assertEqual(ticket["comments"][-1]["text"], mark)


class VersionTests(ConfigCase):
    def test_version_nennt_datum_und_head(self):
        result = self.ok("version")
        self.assertRegex(result.stdout.strip(),
                         r"^fab \d{4}-\d{2}-\d{2} · [0-9a-f]{7,}$")


class AutoCommitTests(ConfigCase):
    """Schreibbefehle committen nur ihre eigenen Dateien (Ticket T-9)."""

    def git_roster_repo(self):
        self.git_out(self.roster_dir, "init", "-q", "-b", "main")
        self.git_out(self.roster_dir, "config", "user.email", "test@example.com")
        self.git_out(self.roster_dir, "config", "user.name", "Test")
        self.git_out(self.roster_dir, "add", "roster.json", "prompts")
        self.git_out(self.roster_dir, "commit", "-qm", "start")

    def head_files(self):
        raw = self.git_out(
            self.roster_dir, "show", "--name-only", "--format=", "HEAD"
        )
        return [line for line in raw.splitlines() if line.strip()]

    def status(self):
        return self.git_out(self.roster_dir, "status", "--porcelain")

    def test_settings_committet_nur_den_roster(self):
        self.git_roster_repo()
        self.write_file(self.prompt_path("ada"), "lokal\n")
        before = self.git_out(self.roster_dir, "rev-parse", "HEAD")
        self.ok("settings", "set", "max_sessions", "5", "--from", "mensch")
        after = self.git_out(self.roster_dir, "rev-parse", "HEAD")
        self.assertNotEqual(before, after)
        self.assertEqual(self.head_files(), ["roster.json"])
        subject = self.git_out(self.roster_dir, "log", "-1", "--format=%s")
        self.assertIn("chore(roster): max_sessions: 4 → 5", subject)
        self.assertEqual(self.status(), "M prompts/ada.md")

    def test_prompt_set_committet_nur_die_promptdatei(self):
        self.git_roster_repo()
        self.write_file(self.prompt_path("ada"), "lokal\n")
        self.ok(
            "prompt", "set", "zap", "--text", "Neuer Text\n", "--from", "mensch"
        )
        self.assertEqual(self.head_files(), ["prompts/zap.md"])
        subject = self.git_out(self.roster_dir, "log", "-1", "--format=%s")
        self.assertTrue(
            subject.startswith("chore(prompt): prompts/zap.md gespeichert")
        )
        self.assertEqual(self.status(), "M prompts/ada.md")

    def test_agent_add_committet_roster_und_prompt(self):
        self.git_roster_repo()
        self.write_file(self.prompt_path("ada"), "lokal\n")
        self.ok(
            "agent", "add", "mira", "--role", "recherche",
            "--argv-json", '["true"]', "--from", "mensch",
        )
        self.assertEqual(
            sorted(self.head_files()), ["prompts/mira.md", "roster.json"]
        )
        self.assertEqual(self.status(), "M prompts/ada.md")

    def test_agent_edit_rename_committet_promptdatei(self):
        self.git_roster_repo()
        self.ok("agent", "edit", "ada", "--rename", "pruefer", "--from", "mensch")
        files = self.head_files()
        self.assertIn("roster.json", files)
        self.assertIn("prompts/pruefer.md", files)
        self.assertNotIn("prompts/ada.md", files)
        self.assertEqual(self.status(), "")

    def test_kein_commit_ausserhalb_des_basis_branches(self):
        self.git_roster_repo()
        self.git_out(self.roster_dir, "checkout", "-q", "-b", "arbeit")
        before = self.git_out(self.roster_dir, "rev-parse", "HEAD")
        self.ok("settings", "set", "max_sessions", "6", "--from", "mensch")
        after = self.git_out(self.roster_dir, "rev-parse", "HEAD")
        self.assertEqual(before, after)
        self.assertIn("roster.json", self.status())


class MigrationTests(ConfigCase):
    """Legacy-Roster wird beim ersten Lesen zu Blaupausen und Team."""

    def git_roster_repo(self):
        self.git_out(self.roster_dir, "init", "-q", "-b", "main")
        self.git_out(self.roster_dir, "config", "user.email", "test@example.com")
        self.git_out(self.roster_dir, "config", "user.name", "Test")
        self.git_out(self.roster_dir, "add", "roster.json", "prompts")
        self.git_out(self.roster_dir, "commit", "-qm", "start")

    def test_migration_beim_lesen_schreibt_einmal(self):
        self.write_roster(max_sessions=10)
        self.git_roster_repo()
        self.ok("roster", "--json")
        data = self.roster_json()
        self.assertEqual(
            [entry["name"] for entry in data["blueprints"]], ["zap", "ada"]
        )
        team = data["teams"][0]
        self.assertEqual(team["name"], "herdr-app")
        self.assertEqual(
            team["repos"],
            [os.path.realpath(os.path.join(self.fake_home, ".config", "herdr-app"))],
        )
        self.assertEqual(
            team["members"], [{"blueprint": "zap"}, {"blueprint": "ada"}]
        )
        self.assertEqual(team["reviewer"], "ada")
        self.assertEqual(team["max_sessions"], 10)
        self.assertEqual(data["max_sessions"], 10)
        self.assertEqual(data["max_sessions_total"], 10)
        self.assertEqual([row["name"] for row in data["agents"]], ["zap", "ada"])

        raw = self._read(self.roster)
        self.ok("roster", "--json")
        self.assertEqual(self._read(self.roster), raw)
        self.assertEqual(
            self.git_out(self.roster_dir, "rev-list", "--count", "HEAD"), "2"
        )
        self.assertEqual(
            self.git_out(self.roster_dir, "log", "-1", "--format=%s"),
            "chore(roster): Roster zu Team herdr-app migriert",
        )


class BlueprintTests(ConfigCase):
    def test_add_legt_eintrag_prompt_und_farbe_an(self):
        mark = self.mark()
        entry = self.config_call(
            config.add_blueprint, "mira", "recherche", None, '["pi"]', None,
            "mensch",
        )
        self.assertEqual(
            entry,
            {
                "name": "mira",
                "role": "recherche",
                "color": "c3",
                "prompt": "prompts/mira.md",
                "argv": ["pi"],
            },
        )
        data = self.roster_json()
        self.assertEqual(
            [row["name"] for row in data["blueprints"]], ["zap", "ada", "mira"]
        )
        text = self._read(self.prompt_path("mira"))
        self.assertIn("mira", text)
        self.assertIn("recherche", text)
        configs = self.events_since(mark, "config")
        self.assertEqual(len(configs), 1)
        self.assertIn("Blaupause mira angelegt", configs[0]["text"])

    def test_edit_erhaelt_zusatzfelder_und_zieht_rename_nach(self):
        self.ok("roster", "--json")
        data = self.roster_json()
        data["blueprints"][0]["note"] = "bleibt"
        self.write_raw_roster(data)

        text = self.config_call(
            config.edit_blueprint, "zap",
            role="bauleiter", argv_json='["claude", "--model", "opus"]',
            actor="mensch",
        )
        self.assertIn("Blaupause „zap“ geändert", text)
        fresh = self.roster_json()
        zap = fresh["blueprints"][0]
        self.assertEqual(zap["note"], "bleibt")
        self.assertEqual(zap["role"], "bauleiter")
        self.assertEqual(zap["argv"], ["claude", "--model", "opus"])

        self.config_call(
            config.edit_blueprint, "ada", rename="pruefer", actor="mensch"
        )
        fresh = self.roster_json()
        team = fresh["teams"][0]
        self.assertEqual(team["reviewer"], "pruefer")
        self.assertEqual(
            team["members"], [{"blueprint": "zap"}, {"blueprint": "pruefer"}]
        )
        self.assertEqual(fresh["reviewer"], "pruefer")
        self.assertEqual(
            [row["name"] for row in fresh["blueprints"]], ["zap", "pruefer"]
        )
        self.assertTrue(os.path.isfile(self.prompt_path("pruefer")))
        self.assertFalse(os.path.exists(self.prompt_path("ada")))

    def test_rename_mit_eigenem_promptpfad(self):
        self.ok("roster", "--json")
        data = self.roster_json()
        data["blueprints"][0]["prompt"] = "prompts/shared.md"
        self.write_raw_roster(data)
        text = self.config_call(
            config.edit_blueprint, "zap", rename="zoe", actor="mensch"
        )
        self.assertIn("Name zap → zoe", text)
        fresh = self.roster_json()
        self.assertEqual(
            [row["name"] for row in fresh["blueprints"]], ["zoe", "ada"]
        )
        self.assertEqual(fresh["blueprints"][0]["prompt"], "prompts/shared.md")

    def test_rm_verweigert_genutzte_und_entfernt_freie(self):
        self.ok("roster", "--json")
        before = self._read(self.roster)
        with self.assertRaises(FabError) as ctx:
            self.config_call(config.remove_blueprint, "zap", "mensch")
        self.assertIn(
            "Blaupause „zap“ wird im Team „herdr-app“ genutzt",
            str(ctx.exception),
        )
        self.assertEqual(self._read(self.roster), before)

        self.config_call(
            config.add_blueprint, "nina", "hilfe", None, '["true"]', None,
            "mensch",
        )
        rel = self.config_call(config.remove_blueprint, "nina", "mensch")
        self.assertEqual(rel, "prompts/nina.md")
        self.assertNotIn(
            "nina", [row["name"] for row in self.roster_json()["blueprints"]]
        )
        self.assertTrue(os.path.isfile(self.prompt_path("nina")))


class TeamTests(ConfigCase):
    def test_add_mit_repo_mitgliedern_pruefer_und_limit(self):
        repo = self.make_repo()
        entry = self.config_call(
            config.add_team, "zwei", [repo], '[{"blueprint": "zap"}]',
            orchestrator_argv_json='["omp"]', reviewer="zap",
            max_sessions=3, actor="mensch",
        )
        self.assertEqual(entry["name"], "zwei")
        self.assertEqual(entry["repos"], [os.path.realpath(repo)])
        self.assertEqual(entry["members"], [{"blueprint": "zap"}])
        self.assertEqual(entry["reviewer"], "zap")
        self.assertEqual(entry["max_sessions"], 3)
        self.assertEqual(
            entry["orchestrator"],
            {"argv": ["omp"], "prompt": "prompts/orchestrator-zwei.md"},
        )
        prompt = os.path.join(
            self.roster_dir, "prompts", "orchestrator-zwei.md"
        )
        self.assertTrue(os.path.isfile(prompt))
        self.assertEqual(
            self._read(prompt),
            self._read(os.path.join(self.roster_dir, "prompts", "orchestrator.md")),
        )
        data = self.roster_json()
        self.assertEqual(
            [row["name"] for row in data["teams"]], ["herdr-app", "zwei"]
        )
        self.assertEqual(data["teams"][0]["max_sessions"], 4)

        second = self.make_repo("zwei-repo")
        self.config_call(
            config.add_team, "drei", [second], '[{"blueprint": "ada"}]',
            orchestrator_argv_json='["true"]', reviewer="ada", actor="mensch",
        )
        self.assertEqual(
            [row["name"] for row in self.roster_json()["teams"]],
            ["herdr-app", "zwei", "drei"],
        )

    def test_add_weist_repo_pruefer_und_blueprint_zurueck(self):
        repo = self.make_repo()
        self.config_call(
            config.add_team, "zwei", [repo], '[{"blueprint": "zap"}]',
            orchestrator_argv_json='["true"]', reviewer="zap", actor="mensch",
        )
        before = self._read(self.roster)
        with self.assertRaises(FabError) as ctx:
            self.config_call(
                config.add_team, "drei", [repo], '[{"blueprint": "ada"}]',
                orchestrator_argv_json='["true"]', reviewer="ada",
                actor="mensch",
            )
        self.assertIn("gehört bereits zu Team zwei", str(ctx.exception))
        self.assertEqual(self._read(self.roster), before)

        other = self.make_repo("andere")
        with self.assertRaises(FabError) as ctx:
            self.config_call(
                config.add_team, "drei", [other], '[{"blueprint": "zap"}]',
                orchestrator_argv_json='["true"]', reviewer="ada",
                actor="mensch",
            )
        self.assertIn("Prüfer muss Mitglied des Teams sein", str(ctx.exception))
        self.assertEqual(self._read(self.roster), before)

        with self.assertRaises(FabError) as ctx:
            self.config_call(
                config.add_team, "drei", [other],
                '[{"blueprint": "gibtsnicht"}]',
                orchestrator_argv_json='["true"]', reviewer="gibtsnicht",
                actor="mensch",
            )
        self.assertIn("Unbekannte Blaupause", str(ctx.exception))
        self.assertEqual(self._read(self.roster), before)

    def test_edit_aendert_team_und_rm_entfernt_es(self):
        repo = self.make_repo()
        self.config_call(
            config.add_team, "zwei", [repo], '[{"blueprint": "zap"}]',
            orchestrator_argv_json='["true"]', reviewer="zap", actor="mensch",
        )
        other = self.make_repo("neu-repo")
        members = '[{"blueprint": "zap", "model": "klein", "max_cost": 7}]'
        text = self.config_call(
            config.edit_team, "zwei", repos=[other], members_json=members,
            reviewer="zap", max_sessions=5,
            orchestrator_argv_json='["claude"]',
            orchestrator_prompt="prompts/zwei.md", actor="mensch",
        )
        self.assertIn("Team zwei geändert", text)

        payload = json.loads(self.ok("roster", "--json").stdout)
        self.assertEqual(payload["team"], "herdr-app")
        row = payload["teams"][1]
        self.assertEqual(row["name"], "zwei")
        self.assertEqual(row["repos"], [os.path.realpath(other)])
        self.assertEqual(
            row["members"],
            [{"blueprint": "zap", "model": "klein", "max_cost": 7}],
        )
        self.assertEqual(row["reviewer"], "zap")
        self.assertEqual(row["max_sessions"], 5)
        self.assertEqual(
            row["orchestrator"],
            {"argv": ["claude"], "prompt": "prompts/zwei.md"},
        )
        self.assertIn("--model=klein", row["agents"][0]["argv"])

        self.config_call(config.remove_team, "zwei", "mensch")
        self.assertEqual(
            [entry["name"] for entry in self.roster_json()["teams"]],
            ["herdr-app"],
        )

    def test_rm_des_letzten_teams_bleibt_entfernt(self):
        self.ok("roster", "--json")
        self.ok("team", "rm", "herdr-app", "--from", "mensch")
        data = self.roster_json()
        self.assertEqual(data["teams"], [])
        self.assertEqual(data["agents"], [])
        self.assertEqual(data["reviewer"], "")
        raw = self._read(self.roster)
        payload = json.loads(self.ok("roster", "--json").stdout)
        self.assertIsNone(payload["team"])
        self.assertEqual(payload["agents"], [])
        self.assertEqual(self._read(self.roster), raw)

    def test_default_prompt_je_team_und_set_aendert_nur_ein_team(self):
        repo = self.make_repo()
        self.config_call(
            config.add_team, "zwei", [repo], '[{"blueprint": "zap"}]',
            orchestrator_argv_json='["true"]', reviewer="zap", actor="mensch",
        )
        herdr_prompt = self.prompt_path("orchestrator")
        zwei_prompt = os.path.join(
            self.roster_dir, "prompts", "orchestrator-zwei.md"
        )
        self.assertEqual(
            (herdr_prompt, zwei_prompt),
            (
                os.path.join(self.roster_dir, "prompts", "orchestrator.md"),
                os.path.join(self.roster_dir, "prompts", "orchestrator-zwei.md"),
            ),
        )
        herdr_before = self._read(herdr_prompt)
        self.assertEqual(self._read(zwei_prompt), herdr_before)

        self.ok(
            "prompt", "set", "orchestrator", "--team", "zwei",
            "--text", "Nur für zwei.\n", "--from", "mensch",
        )
        self.assertEqual(self._read(zwei_prompt), "Nur für zwei.\n")
        self.assertEqual(self._read(herdr_prompt), herdr_before)

    def test_rm_verweigert_offene_tickets_und_laufenden_orchestrator(self):
        repo = self.make_repo()
        self.config_call(
            config.add_team, "zwei", [repo], '[{"blueprint": "zap"}]',
            orchestrator_argv_json='["true"]', reviewer="zap", actor="mensch",
        )
        tid = self.new("Offene Arbeit", repo=repo)
        self.patch_ticket(tid, status="todo")
        before = self._read(self.roster)

        with self.assertRaises(FabError) as ctx:
            self.config_call(config.remove_team, "zwei", "mensch")
        text = str(ctx.exception)
        self.assertIn("Team „zwei“ lässt sich nicht löschen", text)
        self.assertIn(tid, text)
        self.assertIn("(todo)", text)
        self.assertEqual(self._read(self.roster), before)

        self.patch_ticket(tid, status="done")
        self.set_live({"fab-zwei-orchestrator": "t0"})
        with self.assertRaises(FabError) as ctx:
            self.config_call(config.remove_team, "zwei", "mensch")
        text = str(ctx.exception)
        self.assertIn("fab-zwei-orchestrator", text)
        self.assertIn("fab orchestrator stop zwei", text)
        self.assertEqual(self._read(self.roster), before)

        self.set_live({})
        self.config_call(config.remove_team, "zwei", "mensch")
        self.assertEqual(
            [entry["name"] for entry in self.roster_json()["teams"]],
            ["herdr-app"],
        )
        self.assertTrue(
            os.path.isfile(
                os.path.join(
                    self.roster_dir, "prompts", "orchestrator-zwei.md"
                )
            )
        )

    def test_uebersteuerungen_stehen_in_der_meldung(self):
        repo = self.make_repo()
        self.config_call(
            config.add_team, "zwei", [repo], '[{"blueprint": "zap"}]',
            orchestrator_argv_json='["true"]', reviewer="zap", actor="mensch",
        )
        text = self.config_call(
            config.edit_team, "zwei",
            members_json='[{"blueprint": "zap", "model": "klein", "max_cost": 7}]',
            actor="mensch",
        )
        self.assertIn("zap (modell klein, max-cost 7)", text)


class GlobalLimitTests(ConfigCase):
    def test_max_sessions_total_setzen(self):
        mark = self.mark()
        result = self.ok(
            "settings", "set", "max_sessions_total", "12", "--from", "mensch"
        )
        self.assertIn("max_sessions_total", result.stdout)
        self.assertEqual(self.roster_json()["max_sessions_total"], 12)
        payload = json.loads(self.ok("roster", "--json").stdout)
        self.assertEqual(payload["max_sessions_total"], 12)
        configs = self.events_since(mark, "config")
        self.assertEqual(len(configs), 1)
        self.assertTrue(configs[0]["text"].endswith("→ 12"))

    def test_ungueltige_werte_lassen_datei_unveraendert(self):
        self.ok("settings", "set", "max_sessions_total", "12",
                "--from", "mensch")
        before = self._read(self.roster)
        for value in ("0", "65", "viel"):
            result = self.cli(
                "settings", "set", "max_sessions_total", value,
                "--from", "mensch",
            )
            self.assertNotEqual(result.returncode, 0, value)
            self.assertIn("max_sessions_total", result.stderr, value)
            self.assertEqual(self._read(self.roster), before, value)


class LegacyCompatTests(ConfigCase):
    def test_nach_migration_bleiben_agents_und_grenzen(self):
        before = self.roster_json()
        self.ok("roster", "--json")
        agent_payload = json.loads(self.ok("agents", "--json").stdout)
        self.assertEqual(
            [row["name"] for row in agent_payload["agents"]], ["zap", "ada"]
        )
        self.assertEqual(
            [row["role"] for row in agent_payload["agents"]],
            ["umsetzer", "pruefer"],
        )
        self.assertEqual(agent_payload["max_sessions"], 4)
        self.assertEqual(agent_payload["reviewer"], "ada")

        roster_payload = json.loads(self.ok("roster", "--json").stdout)
        self.assertEqual(
            [row["argv"] for row in roster_payload["agents"]],
            [["true"], ["true"]],
        )
        self.assertEqual(roster_payload["max_sessions"], 4)
        self.assertEqual(roster_payload["reviewer"], "ada")
        self.assertEqual(
            roster_payload["orchestrator"],
            {"argv": ["true"], "prompt": "prompts/orchestrator.md"},
        )
        self.assertEqual(self.roster_json()["agents"], before["agents"])
