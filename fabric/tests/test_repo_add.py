"""`fab repo add`: Ordner anlegen oder aufnehmen und einem Team zuordnen."""
import json
import os
import unittest

from fabric.tests.support import FabricCase


class RepoAddTests(FabricCase):
    def setUp(self):
        super().setUp()
        self.team = "herdr-app"
        # Migration zu Teams/Blaupausen anstoßen, damit das Roster Teams hat.
        self.ok("roster", "--json")

    def roster_data(self):
        with open(self.roster, encoding="utf-8") as handle:
            return json.load(handle)

    def team_repos(self, name=None):
        name = name or self.team
        entry = next(
            item
            for item in self.roster_data()["teams"]
            if item["name"] == name
        )
        return [os.path.realpath(path) for path in entry.get("repos") or []]

    def test_new_legt_repo_mit_einem_commit_auf_main_an(self):
        path = os.path.join(self.tmp, "neues-repo")
        self.assertFalse(os.path.exists(path))
        result = self.ok(
            "repo", "add", path, "--team", self.team, "--new", "--json",
            "--from", "mensch",
        )
        data = json.loads(result.stdout)
        self.assertEqual(
            set(data), {"path", "team", "created", "initialized", "branch"}
        )
        self.assertEqual(data["path"], os.path.realpath(path))
        self.assertEqual(data["team"], self.team)
        self.assertTrue(data["created"])
        self.assertTrue(data["initialized"])
        self.assertEqual(data["branch"], "main")
        self.assertEqual(self.git_out(path, "rev-list", "--count", "HEAD"), "1")
        self.assertEqual(
            self.git_out(path, "log", "-1", "--pretty=%s"), "Initial commit"
        )
        self.assertEqual(
            self.git_out(path, "branch", "--show-current"), "main"
        )
        self.assertIn(os.path.realpath(path), self.team_repos())
        config_events = [
            event
            for event in self.events()
            if event["kind"] == "config" and "geändert" in event["text"]
        ]
        self.assertTrue(config_events)

    def test_new_auf_nicht_leerem_ordner_hat_keine_nebenwirkungen(self):
        path = os.path.join(self.tmp, "voll")
        os.makedirs(path)
        marker = os.path.join(path, "datei.txt")
        self.write_file(marker, "inhalt\n")
        before = self.team_repos()
        result = self.cli(
            "repo", "add", path, "--team", self.team, "--new",
            "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht leer", result.stderr)
        self.assertFalse(os.path.exists(os.path.join(path, ".git")))
        self.assertTrue(os.path.isfile(marker))
        self.assertEqual(self.team_repos(), before)

    def test_new_und_init_schliessen_sich_aus(self):
        path = os.path.join(self.tmp, "beides")
        result = self.cli(
            "repo", "add", path, "--team", self.team, "--new", "--init",
            "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht zusammen", result.stderr)
        self.assertFalse(os.path.exists(path))

    def test_vorhandenes_repo_wird_aufgenommen(self):
        repo = self.make_repo("vorhanden")
        result = self.ok(
            "repo", "add", repo, "--team", self.team, "--json",
            "--from", "mensch",
        )
        data = json.loads(result.stdout)
        self.assertFalse(data["created"])
        self.assertFalse(data["initialized"])
        self.assertEqual(data["branch"], "main")
        self.assertIn(os.path.realpath(repo), self.team_repos())
        self.assertEqual(self.git_out(repo, "rev-list", "--count", "HEAD"), "1")

    def test_ordner_ohne_git_ohne_init_wird_abgelehnt(self):
        path = os.path.join(self.tmp, "ohne-git")
        os.makedirs(path)
        before = self.team_repos()
        result = self.cli(
            "repo", "add", path, "--team", self.team, "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--init", result.stderr)
        self.assertFalse(os.path.exists(os.path.join(path, ".git")))
        self.assertEqual(self.team_repos(), before)

    def test_ordner_ohne_git_mit_init_wird_initialisiert(self):
        path = os.path.join(self.tmp, "mit-git")
        os.makedirs(path)
        result = self.ok(
            "repo", "add", path, "--team", self.team, "--init",
            "--from", "mensch",
        )
        self.assertIn("(initialisiert)", result.stdout)
        self.assertTrue(os.path.isdir(os.path.join(path, ".git")))
        self.assertEqual(self.git_out(path, "rev-list", "--count", "HEAD"), "1")
        self.assertEqual(
            self.git_out(path, "log", "-1", "--pretty=%s"), "Initial commit"
        )
        self.assertEqual(
            self.git_out(path, "branch", "--show-current"), "main"
        )
        self.assertIn(os.path.realpath(path), self.team_repos())

    def test_repo_ohne_commit_mit_init_bekommt_start_commit(self):
        path = os.path.join(self.tmp, "leeres-repo")
        os.makedirs(path)
        self.assertEqual(self.git(path, "init", "-q", "-b", "main").returncode, 0)
        result = self.cli(
            "repo", "add", path, "--team", self.team, "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--init", result.stderr)
        self.ok(
            "repo", "add", path, "--team", self.team, "--init",
            "--from", "mensch",
        )
        self.assertEqual(self.git_out(path, "rev-list", "--count", "HEAD"), "1")

    def test_unterordner_eines_repos_wird_abgelehnt(self):
        repo = self.make_repo("wurzel")
        sub = os.path.join(repo, "unter")
        os.makedirs(sub)
        before = self.team_repos()
        result = self.cli(
            "repo", "add", sub, "--team", self.team, "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("liegt im Repo", result.stderr)
        self.assertFalse(os.path.exists(os.path.join(sub, ".git")))
        self.assertEqual(self.team_repos(), before)

    def test_doppeltes_repo_wird_abgelehnt(self):
        repo = self.make_repo("doppelt")
        self.ok(
            "repo", "add", repo, "--team", self.team, "--from", "mensch"
        )
        result = self.cli(
            "repo", "add", repo, "--team", self.team, "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gehört schon zu Team", result.stderr)

    def test_unbekanntes_team_wird_vor_dem_anlegen_abgelehnt(self):
        path = os.path.join(self.tmp, "geheim")
        result = self.cli(
            "repo", "add", path, "--team", "gibtsnicht", "--new",
            "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekanntes Team", result.stderr)
        self.assertFalse(os.path.exists(path))


if __name__ == "__main__":
    unittest.main()
