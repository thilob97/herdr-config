"""Fabrics: mehrere Teams-Gruppen im einen Roster (CLI)."""
import json
import os

from fabric.tests.support import FabricCase

BLUEPRINTS = [
    {"name": "zap", "role": "umsetzer", "color": "c1",
     "prompt": "prompts/zap.md", "argv": ["true"]},
    {"name": "ada", "role": "pruefer", "color": "c2",
     "prompt": "prompts/ada.md", "argv": ["true"]},
]


def team(name, repos, fabric):
    return {
        "name": name,
        "fabric": fabric,
        "repos": repos,
        "orchestrator": {"argv": ["true"], "prompt": "prompts/orchestrator.md"},
        "members": [{"blueprint": "zap"}, {"blueprint": "ada"}],
        "reviewer": "ada",
        "max_sessions": 4,
    }


class FabricCaseBase(FabricCase):
    def write_fabrics(self, teams, fabrics=None):
        self.write_roster(
            blueprints=[dict(entry) for entry in BLUEPRINTS],
            teams=teams,
            fabrics=fabrics or [
                {"name": "standard", "note": ""},
                {"name": "privat", "note": "Privat"},
            ],
            max_sessions_total=8,
        )

    def fabric_rows(self):
        return json.loads(self.ok("fabric", "list", "--json").stdout)

    def team_rows(self):
        return {
            row["name"]: row
            for row in json.loads(self.ok("team", "list", "--json").stdout)
        }

    def roster_file(self):
        from fabric.fablib import store

        with self.store_env():
            return json.loads(store.config_get(store.ROSTER_CONFIG_KEY) or "{}")


class LegacyTests(FabricCaseBase):
    def test_legacy_roster_hat_standard_ohne_fabrics_zu_schreiben(self):
        rows = self.fabric_rows()
        self.assertEqual([row["name"] for row in rows], ["standard"])
        self.assertTrue(rows[0]["default"])
        self.assertEqual(rows[0]["teams"], ["herdr-app"])
        self.assertEqual(rows[0]["open_tickets"], 0)
        self.assertEqual(
            rows[0]["repos"],
            [os.path.realpath(os.path.join(self.fake_home, ".config", "herdr-app"))],
        )
        self.assertNotIn("fabrics", self.roster_file())
        # Teams tragen das Fabric schon im Lesemodell.
        self.assertEqual(self.team_rows()["herdr-app"]["fabric"], "standard")
        payload = json.loads(self.ok("roster", "--json").stdout)
        self.assertEqual(payload["fabrics"][0]["name"], "standard")
        self.assertEqual(payload["teams"][0]["fabric"], "standard")

    def test_team_add_und_edit_mit_fabric(self):
        result = self.ok("fabric", "add", "privat", "--note", "Privat",
                         "--from", "mensch")
        self.assertIn("Fabric „privat“ angelegt", result.stdout)
        self.assertIn("Privat", result.stdout)
        repo = self.make_repo("zweit")
        result = self.ok(
            "team", "add", "zweit",
            "--repo", repo,
            "--members-json", json.dumps([{"blueprint": "zap"}]),
            "--reviewer", "zap",
            "--fabric", "privat",
            "--from", "mensch",
        )
        self.assertIn("Team „zweit“ angelegt", result.stdout)
        self.assertEqual(self.team_rows()["zweit"]["fabric"], "privat")
        self.assertEqual(
            [row["name"] for row in self.fabric_rows()], ["standard", "privat"])
        self.assertEqual(
            {row["name"]: row["teams"] for row in self.fabric_rows()},
            {"standard": ["herdr-app"], "privat": ["zweit"]},
        )

        result = self.cli("team", "edit", "zweit", "--fabric", "gibtsnicht",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekanntes Fabric: gibtsnicht", result.stderr)
        self.assertIn("standard, privat", result.stderr)

        # --fabric allein hängt das Team um.
        result = self.ok("team", "edit", "zweit", "--fabric", "standard",
                         "--from", "mensch")
        self.assertIn("Fabric privat → standard", result.stdout)
        self.assertEqual(self.team_rows()["zweit"]["fabric"], "standard")

        result = self.cli("team", "add", "dritt", "--repo", self.make_repo("dritt"),
                          "--members-json", json.dumps([{"blueprint": "zap"}]),
                          "--reviewer", "zap", "--fabric", "gibtsnicht",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekanntes Fabric", result.stderr)


class FabricCommandTests(FabricCaseBase):
    def setUp(self):
        super().setUp()
        web = os.path.realpath(self.make_repo("web"))
        api = os.path.realpath(self.make_repo("api"))
        self.write_fabrics([
            team("web", [web], "standard"),
            team("api", [api], "privat"),
        ])

    def test_list_reihenfolge_und_felder(self):
        rows = self.fabric_rows()
        self.assertEqual([row["name"] for row in rows], ["standard", "privat"])
        self.assertEqual(rows[0], {
            "name": "standard",
            "note": "",
            "default": True,
            "teams": ["web"],
            "repos": [os.path.realpath(os.path.join(self.tmp, "web"))],
            "open_tickets": 0,
        })
        self.assertEqual(rows[1]["teams"], ["api"])
        self.assertFalse(rows[1]["default"])
        self.assertEqual(rows[1]["note"], "Privat")

    def test_add_doppelt_und_ungueltig(self):
        result = self.cli("fabric", "add", "standard", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gibt es schon", result.stderr)
        result = self.cli("fabric", "add", "Privat2", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ungültig", result.stderr)
        self.assertNotEqual(
            self.cli("fabric", "add", "neu").returncode, 0)

    def test_edit_rename_note_und_rm(self):
        result = self.ok("fabric", "edit", "privat", "--rename", "private",
                         "--note", "Neu", "--from", "mensch")
        self.assertIn("Name privat → private", result.stdout)
        self.assertIn("Notiz Privat → Neu", result.stdout)
        rows = {row["name"]: row for row in self.fabric_rows()}
        self.assertEqual(rows["private"]["note"], "Neu")
        self.assertEqual(self.team_rows()["api"]["fabric"], "private")

        result = self.cli("fabric", "edit", "standard", "--rename", "default",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("lässt sich nicht umbenennen", result.stderr)

        result = self.cli("fabric", "rm", "private", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Fabric private hat noch Teams: api – erst umhängen",
                      result.stderr)

        result = self.cli("fabric", "rm", "standard", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("lässt sich nicht entfernen", result.stderr)

        self.ok("team", "edit", "api", "--fabric", "standard", "--from", "mensch")
        result = self.ok("fabric", "rm", "private", "--from", "mensch")
        self.assertIn("Fabric „private“ entfernt", result.stdout)
        self.assertEqual([row["name"] for row in self.fabric_rows()], ["standard"])

    def test_unbekanntes_fabric_im_team_edit(self):
        result = self.cli("team", "edit", "web", "--fabric", "weg",
                          "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("vorhanden: standard, privat", result.stderr)


class IndexAndReportTests(FabricCaseBase):
    def setUp(self):
        super().setUp()
        repo = self.default_repo()
        self.write_fabrics([team("herdr-app", [repo], "privat")])

    def test_index_traegt_fabric_und_fabrics(self):
        tid = self.new("Fabric-Ticket")
        # `fab index` schreibt in die DB; lesen über das Lesemodell.
        self.ok("index")
        data = self.index()
        entry = next(row for row in data["tickets"] if row["id"] == tid)
        self.assertEqual(entry["fabric"], "privat")
        self.assertEqual(entry["team"], "herdr-app")
        self.assertEqual(data["fabrics"], ["standard", "privat"])

    def test_report_filtert_nach_fabric(self):
        self.new("Fabric-Ticket")
        data = json.loads(self.ok("report", "--days", "7", "--fabric", "privat",
                                  "--json").stdout)
        self.assertEqual(data["fabric"], "privat")
        self.assertIsNone(data["team"])
        self.assertEqual(data["overview"]["tickets"], 1)
        self.assertEqual([row["name"] for row in data["teams"]], ["herdr-app"])
        self.assertEqual(data["teams"][0]["fabric"], "privat")

        data = json.loads(self.ok("report", "--days", "7", "--fabric", "standard",
                                  "--json").stdout)
        self.assertEqual(data["overview"]["tickets"], 0)
        self.assertEqual(data["teams"], [])

        result = self.cli("report", "--fabric", "gibtsnicht", "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekanntes Fabric", result.stderr)

        result = self.cli("report", "--team", "herdr-app", "--fabric", "privat",
                          "--json")
        self.assertNotEqual(result.returncode, 0)
