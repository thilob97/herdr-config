"""Projekt-Steckbrief, Team-Brief und ihr Einbau in die Prompts (T-59)."""
import json
import os
import stat
from unittest import mock

from fabric.fablib import agents, context
from fabric.tests.support import FabricCase


class ContextCase(FabricCase):
    def project(self, repo, text="# Steckbrief\n\nZweck: Testprojekt.\n"):
        self.ok("repo", "set", repo, "project", "--text", text,
                "--from", "mensch")
        return text

    def brief(self, text="Ziele: Kontext zeigen.\n", team="herdr-app"):
        path = os.path.join(self.tmp, "brief.md")
        self.write_file(path, text)
        self.ok("team", "edit", team, "--brief-file", path, "--from", "mensch")
        return text

    def set_limit(self, value):
        self.ok("settings", "set", "context_limit", str(value), "--from", "mensch")

    def load_roster(self):
        with mock.patch.dict(os.environ, self.env):
            return agents.load()

    def prompter(self):
        """Preamble mit nacktem {context}; so bleibt der Kontext messbar."""
        self.write_file(
            os.path.join(self.roster_dir, "prompts", "preamble.md"),
            "{context}\n",
        )

    def start_context(self, tid):
        roster = self.load_roster()
        start = agents.start_prompt(
            roster,
            self.ticket(tid),
            {"name": "zap", "role": "umsetzer", "prompt": "prompts/zap.md"},
        )
        return roster, start.split("\n\nZap-Rolle:")[0]


class RepoProjectTests(ContextCase):
    def test_repo_set_project_und_show_meldet_steckbrief(self):
        repo = self.make_repo()
        data = json.loads(self.ok("repo", "show", repo, "--json").stdout)
        self.assertEqual(data["project"], {"exists": False, "text": None})
        self.assertIn("## Zweck", data["project_template"])
        shown = self.ok("repo", "show", repo).stdout
        self.assertIn("Steckbrief: fehlt", shown)
        self.assertIn("Vorlage für den Steckbrief", shown)

        self.project(repo, "# Steckbrief\n\nZweck: Testprojekt.\n")
        target = os.path.join(repo, ".fabric", "project.md")
        self.assertEqual(
            stat.S_IMODE(os.stat(target).st_mode), 0o644
        )
        self.assertEqual(
            self._read(target), "# Steckbrief\n\nZweck: Testprojekt.\n"
        )
        shown = json.loads(self.ok("repo", "show", repo, "--json").stdout)
        self.assertTrue(shown["project"]["exists"])
        self.assertEqual(shown["project"]["text"], "# Steckbrief\n\nZweck: Testprojekt.\n")
        text = self.ok("repo", "show", repo).stdout
        self.assertIn("Steckbrief: vorhanden", text)
        self.assertNotIn("Vorlage für den Steckbrief", text)
        self.assertIn("Steckbrief", self.ok("repos", "--add", repo).stdout)


class TeamBriefTests(ContextCase):
    def test_brief_aus_datei_list_json_und_unbekanntes_team(self):
        repo = self.make_repo()
        self.own_repo(repo)
        text = self.brief("Ziele: Test.\nPrioritäten: klein.\n")
        rows = json.loads(self.ok("team", "list", "--json").stdout)
        entry = [row for row in rows if row["name"] == "herdr-app"][0]
        self.assertEqual(entry["brief"], text.strip())
        self.assertIn("Brief", self.ok("team", "list").stdout)

        result = self.cli(
            "team", "edit", "gibtsnicht", "--brief", "x", "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekanntes Team", result.stderr)

        result = self.cli(
            "team", "edit", "herdr-app", "--brief-file",
            os.path.join(self.tmp, "fehlt.md"), "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht lesbar", result.stderr)


class PromptContextTests(ContextCase):
    def test_prompts_enthalten_steckbrief_und_brief(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.project(repo, "# Steckbrief\n\nZweck: Testprojekt.\n")
        self.brief("Ziele: Kontext zeigen.\n")
        tid = self.new("Kontext", repo=repo)
        self.prompter()
        self.write_file(
            os.path.join(self.roster_dir, "prompts", "orchestrator.md"),
            "Rolle\n\n## Projekt und Team\n\n{context}\n",
        )
        roster = self.load_roster()
        start = agents.start_prompt(
            roster,
            self.ticket(tid),
            {"name": "zap", "role": "umsetzer", "prompt": "prompts/zap.md"},
        )
        orchestrated = agents.orchestrator_prompt(roster, "herdr-app")
        for text in (start, orchestrated):
            self.assertIn("## Projekt-Steckbrief", text)
            self.assertIn("Zweck: Testprojekt.", text)
            self.assertIn("## Team-Brief", text)
            self.assertIn("Ziele: Kontext zeigen.", text)
            self.assertNotIn("{context}", text)

    def test_ohne_steckbrief_und_brief_leerer_kontext(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Leer", repo=repo)
        self.prompter()
        _roster, text = self.start_context(tid)
        self.assertEqual(text, "")
        self.assertEqual(self.ok("context", tid).stdout, "")
        self.assertEqual(self.ok("context", "--team", "herdr-app").stdout, "")

    def test_obergrenze_kuerzt_sichtbar_und_grenzfall_gleich_lang(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.project(repo, "# Steckbrief\n\n" + "Zeile mit Inhalt.\n" * 40)
        tid = self.new("Grenze", repo=repo)
        self.prompter()
        _roster, full = self.start_context(tid)
        self.assertIn("Zeile mit Inhalt.", full)
        self.assertNotIn("gekürzt", full)
        length = len(full)

        self.set_limit(length)
        _roster, exact = self.start_context(tid)
        self.assertEqual(exact, full)
        self.assertNotIn("gekürzt", exact)

        self.set_limit(length - 1)
        _roster, clipped = self.start_context(tid)
        self.assertLessEqual(len(clipped), length - 1)
        self.assertNotEqual(clipped, full)
        self.assertIn("[…] gekürzt, vollständig in", clipped)
        self.assertIn(
            os.path.join(repo, ".fabric", "project.md"), clipped
        )
        self.assertTrue(full.startswith(clipped.split("\n\n[…]")[0]))


class ContextCommandTests(ContextCase):
    def test_fab_context_gibt_genau_den_prompt_teil(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.project(repo, "# Steckbrief\n\nZweck: Anzeige.\n")
        self.brief("Ziele: Anzeige.\n")
        tid = self.new("Anzeige", repo=repo)
        roster = self.load_roster()
        ticket = self.ticket(tid)
        expected = context.for_ticket(roster, ticket)
        self.assertEqual(self.ok("context", tid).stdout, expected + "\n")
        team_expected = context.for_team(roster, "herdr-app")
        self.assertEqual(
            self.ok("context", "--team", "herdr-app").stdout,
            team_expected + "\n",
        )
        result = self.cli("context")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ID oder --team", result.stderr)
