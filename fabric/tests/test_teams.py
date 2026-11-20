"""Blaupausen und Teams (Ticket T-17), ohne CLI."""
import copy
import json
import os
import unittest

from fabric.fablib import teams
from fabric.fablib.errors import FabError


def legacy_roster():
    return {
        "max_sessions": 6,
        "reviewer": "ada",
        "orchestrator": {
            "argv": ["omp", "--approval-mode=yolo"],
            "prompt": "prompts/orchestrator.md",
        },
        "agents": [
            {
                "name": "zap",
                "role": "umsetzer",
                "color": "c1",
                "prompt": "prompts/zap.md",
                "argv": ["omp", "--model=alt", "--max-cost=5"],
            },
            {
                "name": "ada",
                "role": "pruefer",
                "color": "c2",
                "prompt": "prompts/ada.md",
                "argv": ["claude", "--model", "opus"],
            },
        ],
        "custom": {"keep": True},
    }


def migrated_roster():
    data = legacy_roster()
    teams.migrate(data)
    return data


class CheckTests(unittest.TestCase):
    def test_check_name(self):
        self.assertEqual(teams.check_name(" zap "), "zap")
        for raw in ("", "   ", None, "Zap", "orchestrator", "a" * 17, "a b"):
            with self.assertRaises(FabError):
                teams.check_name(raw)
        with self.assertRaises(FabError) as ctx:
            teams.check_name("")
        self.assertEqual(str(ctx.exception), "Der Agentname ist leer")

    def test_check_color(self):
        self.assertEqual(teams.check_color("c1"), "c1")
        with self.assertRaises(FabError) as ctx:
            teams.check_color("c9")
        self.assertIn("Farbe „c9“ gibt es nicht", str(ctx.exception))

    def test_check_role(self):
        self.assertEqual(teams.check_role(" umsetzer "), "umsetzer")
        with self.assertRaises(FabError):
            teams.check_role("")

    def test_check_sessions(self):
        self.assertEqual(teams.check_sessions("3"), 3)
        self.assertEqual(teams.check_sessions(1), 1)
        self.assertEqual(teams.check_sessions(16), 16)
        for raw in (0, 17, "x", None, ""):
            with self.assertRaises(FabError):
                teams.check_sessions(raw)
        with self.assertRaises(FabError) as ctx:
            teams.check_sessions(17, "plätze")
        self.assertIn("plätze", str(ctx.exception))

    def test_check_total_sessions(self):
        self.assertEqual(teams.check_total_sessions("64"), 64)
        self.assertEqual(teams.check_total_sessions(1), 1)
        for raw in (0, 65, "viele", None):
            with self.assertRaises(FabError):
                teams.check_total_sessions(raw)
        with self.assertRaises(FabError) as ctx:
            teams.check_total_sessions(65)
        self.assertIn("max_sessions_total", str(ctx.exception))


class RepoTests(unittest.TestCase):
    def test_tilde_wird_zum_home(self):
        self.assertEqual(
            teams.normalize_repo("~/.config/herdr-app"),
            os.path.join(os.path.expanduser("~"), ".config", "herdr-app"),
        )

    def test_relativer_pfad_wird_absolut(self):
        path = teams.normalize_repo("repos/../repos/team")
        self.assertTrue(os.path.isabs(path))
        self.assertEqual(path, os.path.abspath("repos/team"))

    def test_leerer_pfad(self):
        for raw in ("", "   ", None):
            with self.assertRaises(FabError):
                teams.normalize_repo(raw)

    def test_repo_owner(self):
        data = migrated_roster()
        owner = teams.repo_owner(data, "~/.config/herdr-app")
        self.assertEqual(owner["name"], "herdr-app")
        self.assertIsNone(teams.repo_owner(data, "/tmp/fremd"))
        self.assertIsNone(
            teams.repo_owner(data, "~/.config/herdr-app", ignore="herdr-app")
        )


class ParseMembersTests(unittest.TestCase):
    def test_ohne_uebersteuerung(self):
        self.assertEqual(
            teams.parse_members(json.dumps([{"blueprint": "zap"}])),
            [{"blueprint": "zap"}],
        )

    def test_mit_uebersteuerung(self):
        self.assertEqual(
            teams.parse_members(
                json.dumps(
                    [{"blueprint": "ada", "model": "opus", "max_cost": "3"}]
                )
            ),
            [{"blueprint": "ada", "model": "opus", "max_cost": 3}],
        )

    def test_leere_liste(self):
        self.assertEqual(teams.parse_members("[]"), [])

    def test_duplikat(self):
        with self.assertRaises(FabError) as ctx:
            teams.parse_members(
                json.dumps([{"blueprint": "zap"}, {"blueprint": "zap"}])
            )
        self.assertIn("doppelt", str(ctx.exception))

    def test_unbekannter_schluessel(self):
        with self.assertRaises(FabError) as ctx:
            teams.parse_members(json.dumps([{"blueprint": "zap", "farbe": "c1"}]))
        self.assertIn("unbekannter Schlüssel", str(ctx.exception))

    def test_kaputtes_json(self):
        with self.assertRaises(FabError) as ctx:
            teams.parse_members("{kein json")
        self.assertIn("kein gültiges JSON", str(ctx.exception))

    def test_ungueltige_werte(self):
        for item in (
            {"blueprint": ""},
            {"blueprint": 3},
            {"blueprint": "zap", "model": ""},
            {"blueprint": "zap", "max_cost": -1},
            {"blueprint": "zap", "max_cost": "viel"},
            "zap",
        ):
            with self.assertRaises(FabError):
                teams.parse_members(json.dumps([item]))
        with self.assertRaises(FabError):
            teams.parse_members(json.dumps({"blueprint": "zap"}))


class ExpandArgvTests(unittest.TestCase):
    def test_ersetzt_kurzform_und_kosten(self):
        self.assertEqual(
            teams.expand_argv(
                ["omp", "--model=alt", "--max-cost=5"], model="neu", max_cost=2
            ),
            ["omp", "--model=neu", "--max-cost=2"],
        )

    def test_ersetzt_lange_form(self):
        self.assertEqual(
            teams.expand_argv(["claude", "--model", "opus"], model="sonnet"),
            ["claude", "--model", "sonnet"],
        )

    def test_haengt_an(self):
        self.assertEqual(
            teams.expand_argv(["omp"], model="x", max_cost=0),
            ["omp", "--model=x", "--max-cost=0"],
        )

    def test_keine_uebersteuerung(self):
        argv = ["omp", "--model=alt", "--max-cost=5"]
        self.assertEqual(teams.expand_argv(argv, None, ""), argv)
        self.assertEqual(teams.expand_argv(argv), argv)
        self.assertEqual(argv, ["omp", "--model=alt", "--max-cost=5"])


class MigrateTests(unittest.TestCase):
    def test_legacy_wird_migriert(self):
        data = legacy_roster()
        self.assertTrue(teams.migrate(data))
        self.assertTrue(teams.is_migrated(data))

        rows = {row["name"]: row for row in teams.blueprint_rows(data)}
        self.assertEqual(sorted(rows), ["ada", "zap"])
        self.assertEqual(rows["zap"]["role"], "umsetzer")
        self.assertEqual(rows["zap"]["color"], "c1")
        self.assertEqual(rows["zap"]["prompt"], "prompts/zap.md")
        self.assertEqual(rows["zap"]["argv"], ["omp", "--model=alt", "--max-cost=5"])

        entry = teams.first_team(data)
        self.assertEqual(entry["name"], "herdr-app")
        self.assertEqual(
            entry["repos"], [os.path.expanduser("~/.config/herdr-app")]
        )
        self.assertEqual(
            entry["members"], [{"blueprint": "zap"}, {"blueprint": "ada"}]
        )
        self.assertEqual(entry["reviewer"], "ada")
        self.assertEqual(entry["max_sessions"], 6)
        self.assertEqual(entry["orchestrator"]["argv"], ["omp", "--approval-mode=yolo"])
        self.assertEqual(
            entry["orchestrator"]["prompt"], "prompts/orchestrator.md"
        )
        self.assertEqual(data["max_sessions_total"], 6)

        # Legacy-Schlüssel und unbekannte Felder bleiben unverändert.
        self.assertEqual(data["max_sessions"], 6)
        self.assertEqual(data["reviewer"], "ada")
        self.assertEqual(data["agents"], legacy_roster()["agents"])
        self.assertEqual(
            data["orchestrator"], legacy_roster()["orchestrator"]
        )
        self.assertEqual(data["custom"], {"keep": True})

    def test_zweiter_aufruf_aendert_nichts(self):
        data = legacy_roster()
        self.assertTrue(teams.migrate(data))
        snapshot = copy.deepcopy(data)
        self.assertFalse(teams.migrate(data))
        self.assertEqual(data, snapshot)

    def test_vorhandene_teams_bleiben(self):
        data = legacy_roster()
        data["teams"] = [{"name": "eigen", "repos": ["/tmp/eigen"]}]
        snapshot = copy.deepcopy(data)
        self.assertFalse(teams.migrate(data))
        self.assertEqual(data, snapshot)

    def test_ohne_agents_und_blueprints(self):
        for data in ({}, {"foo": 1}, {"agents": "kaputt"}, []):
            self.assertFalse(teams.migrate(data))

    def test_vorhandene_blueprints_bleiben(self):
        data = legacy_roster()
        data["blueprints"] = [{"name": "zap", "role": "alt"}]
        self.assertTrue(teams.migrate(data))
        rows = {row["name"]: row for row in teams.blueprint_rows(data)}
        self.assertEqual(sorted(rows), ["ada", "zap"])
        self.assertEqual(rows["zap"]["role"], "alt")

    def test_pruefer_nur_wenn_mitglied(self):
        data = legacy_roster()
        data["reviewer"] = "gibtsnicht"
        self.assertTrue(teams.migrate(data))
        self.assertEqual(teams.first_team(data)["reviewer"], "")

    def test_defaults_ohne_max_sessions(self):
        data = {"agents": []}
        self.assertTrue(teams.migrate(data))
        entry = teams.first_team(data)
        self.assertEqual(entry["max_sessions"], teams.DEFAULT_MAX_SESSIONS)
        self.assertEqual(data["max_sessions_total"], teams.DEFAULT_MAX_SESSIONS)
        self.assertEqual(entry["orchestrator"]["prompt"], teams.DEFAULT_ORCHESTRATOR_PROMPT)


class ExpansionTests(unittest.TestCase):
    def test_erstes_team_und_uebersteuerungen(self):
        data = migrated_roster()
        entry = teams.first_team(data)
        entry["members"][0].update({"model": "neu", "max_cost": 2})
        data["max_sessions_total"] = 10
        result = teams.expansion(data)
        self.assertEqual(result["team"], "herdr-app")
        self.assertEqual(result["max_sessions"], 6)
        self.assertEqual(result["max_sessions_total"], 10)
        self.assertEqual(result["reviewer"], "ada")
        self.assertEqual(
            result["orchestrator"],
            {
                "argv": ["omp", "--approval-mode=yolo"],
                "prompt": "prompts/orchestrator.md",
            },
        )
        agents = {agent["name"]: agent for agent in result["agents"]}
        self.assertEqual(
            agents["zap"]["argv"], ["omp", "--model=neu", "--max-cost=2"]
        )
        self.assertEqual(agents["ada"]["argv"], ["claude", "--model", "opus"])
        self.assertEqual(agents["zap"]["role"], "umsetzer")
        self.assertEqual(agents["zap"]["color"], "c1")
        self.assertEqual(agents["zap"]["prompt"], "prompts/zap.md")

    def test_zweites_team_aendert_nichts(self):
        data = migrated_roster()
        data["teams"].append(
            {
                "name": "zwei",
                "repos": ["/tmp/zwei"],
                "orchestrator": {"argv": [], "prompt": "prompts/zwei.md"},
                "members": [{"blueprint": "ada", "model": "haiku"}],
                "reviewer": "ada",
                "max_sessions": 2,
            }
        )
        result = teams.expansion(data)
        self.assertEqual(result["team"], "herdr-app")
        self.assertEqual(result["max_sessions"], 6)
        self.assertEqual([a["name"] for a in result["agents"]], ["zap", "ada"])

    def test_legacy_fallback(self):
        result = teams.expansion(legacy_roster())
        self.assertIsNone(result["team"])
        self.assertEqual(result["max_sessions"], 6)
        self.assertEqual(result["max_sessions_total"], 6)
        self.assertEqual(result["reviewer"], "ada")
        self.assertEqual(
            result["orchestrator"],
            {
                "argv": ["omp", "--approval-mode=yolo"],
                "prompt": "prompts/orchestrator.md",
            },
        )
        self.assertEqual([a["name"] for a in result["agents"]], ["zap", "ada"])
        self.assertEqual(
            result["agents"][1]["argv"], ["claude", "--model", "opus"]
        )

    def test_legacy_defaults(self):
        result = teams.expansion({"agents": []})
        self.assertIsNone(result["team"])
        self.assertEqual(result["max_sessions"], 4)
        self.assertEqual(result["max_sessions_total"], 4)
        self.assertEqual(result["reviewer"], "")
        self.assertEqual(
            result["orchestrator"],
            {"argv": [], "prompt": "prompts/orchestrator.md"},
        )
        self.assertEqual(result["agents"], [])

    def test_summe_ohne_globalen_wert(self):
        data = migrated_roster()
        del data["max_sessions_total"]
        data["teams"].append({"name": "zwei", "max_sessions": 4})
        self.assertEqual(teams.expansion(data)["max_sessions_total"], 10)
        data["max_sessions_total"] = "kaputt"
        self.assertEqual(teams.expansion(data)["max_sessions_total"], 10)


class ValidateTeamTests(unittest.TestCase):
    def data(self):
        return {
            "blueprints": [
                {"name": "zap", "role": "umsetzer", "color": "c1"},
                {"name": "ada", "role": "pruefer", "color": "c2"},
            ],
            "teams": [
                {
                    "name": "alt",
                    "repos": ["/tmp/alt"],
                    "members": [{"blueprint": "zap"}],
                    "reviewer": "zap",
                    "max_sessions": 4,
                }
            ],
        }

    def test_gueltig(self):
        self.assertIsNone(
            teams.validate_team(
                self.data(),
                "neu",
                ["/tmp/neu"],
                [{"blueprint": "zap"}, {"blueprint": "ada"}],
                "ada",
                4,
            )
        )

    def test_ignoriert_eigenes_team(self):
        self.assertIsNone(
            teams.validate_team(
                self.data(),
                "alt",
                ["/tmp/alt"],
                [{"blueprint": "zap"}],
                "zap",
                4,
                ignore="alt",
            )
        )

    def test_repo_gehoert_anderem_team(self):
        with self.assertRaises(FabError) as ctx:
            teams.validate_team(
                self.data(), "neu", ["/tmp/alt"], [{"blueprint": "zap"}], "zap", 4
            )
        self.assertIn("gehört bereits zu Team alt", str(ctx.exception))

    def test_pruefer_kein_mitglied(self):
        with self.assertRaises(FabError) as ctx:
            teams.validate_team(
                self.data(), "neu", ["/tmp/neu"], [{"blueprint": "zap"}], "ada", 4
            )
        self.assertEqual(
            str(ctx.exception), "Prüfer muss Mitglied des Teams sein"
        )
        with self.assertRaises(FabError):
            teams.validate_team(
                self.data(), "neu", ["/tmp/neu"], [{"blueprint": "zap"}], "", 4
            )

    def test_unbekannte_blaupause(self):
        with self.assertRaises(FabError) as ctx:
            teams.validate_team(
                self.data(),
                "neu",
                ["/tmp/neu"],
                [{"blueprint": "gibtsnicht"}],
                "gibtsnicht",
                4,
            )
        self.assertIn("Unbekannte Blaupause: gibtsnicht", str(ctx.exception))

    def test_doppeltes_repo(self):
        with self.assertRaises(FabError) as ctx:
            teams.validate_team(
                self.data(),
                "neu",
                ["/tmp/a", "/tmp/a/"],
                [{"blueprint": "zap"}],
                "zap",
                4,
            )
        self.assertIn("doppelt", str(ctx.exception))

    def test_leere_repos(self):
        with self.assertRaises(FabError):
            teams.validate_team(
                self.data(), "neu", [], [{"blueprint": "zap"}], "zap", 4
            )

    def test_max_sessions_grenzen(self):
        for value in (0, 17):
            with self.assertRaises(FabError) as ctx:
                teams.validate_team(
                    self.data(),
                    "neu",
                    ["/tmp/neu"],
                    [{"blueprint": "zap"}],
                    "zap",
                    value,
                )
            self.assertIn("max_sessions", str(ctx.exception))

    def test_ungueltiger_name(self):
        with self.assertRaises(FabError):
            teams.validate_team(
                self.data(), "Neu", ["/tmp/neu"], [{"blueprint": "zap"}], "zap", 4
            )


class LookupTests(unittest.TestCase):
    def test_blueprint(self):
        data = migrated_roster()
        self.assertEqual(teams.blueprint(data, "zap")["name"], "zap")
        with self.assertRaises(FabError) as ctx:
            teams.blueprint(data, "fehlt")
        self.assertEqual(
            str(ctx.exception),
            "Unbekannte Blaupause: fehlt (vorhanden: zap, ada)",
        )

    def test_team(self):
        data = migrated_roster()
        self.assertEqual(teams.team(data, "herdr-app")["name"], "herdr-app")
        with self.assertRaises(FabError) as ctx:
            teams.team(data, "fehlt")
        self.assertEqual(
            str(ctx.exception),
            "Unbekanntes Team: fehlt (vorhanden: herdr-app)",
        )

    def test_first_team_und_migriert(self):
        self.assertIsNone(teams.first_team({"agents": []}))
        self.assertFalse(teams.is_migrated({"agents": []}))
        data = migrated_roster()
        self.assertEqual(teams.first_team(data)["name"], "herdr-app")
        self.assertTrue(teams.is_migrated(data))


class RowTests(unittest.TestCase):
    def test_blueprint_rows_mit_teams(self):
        data = migrated_roster()
        data["teams"].append(
            {
                "name": "zwei",
                "repos": ["/tmp/zwei"],
                "members": [{"blueprint": "zap"}],
                "reviewer": "zap",
                "max_sessions": 2,
            }
        )
        rows = {row["name"]: row for row in teams.blueprint_rows(data)}
        self.assertEqual(rows["zap"]["teams"], ["herdr-app", "zwei"])
        self.assertEqual(rows["ada"]["teams"], ["herdr-app"])
        self.assertEqual(
            set(rows["zap"]), {"name", "role", "color", "prompt", "argv", "teams"}
        )

    def test_team_rows(self):
        data = migrated_roster()
        rows = teams.team_rows(data)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["name"], "herdr-app")
        self.assertEqual(
            row["repos"], [os.path.expanduser("~/.config/herdr-app")]
        )
        self.assertEqual(row["reviewer"], "ada")
        self.assertEqual(row["max_sessions"], 6)
        self.assertEqual(
            row["orchestrator"],
            {
                "argv": ["omp", "--approval-mode=yolo"],
                "prompt": "prompts/orchestrator.md",
            },
        )
        self.assertEqual(
            row["members"], [{"blueprint": "zap"}, {"blueprint": "ada"}]
        )
        self.assertEqual([a["name"] for a in row["agents"]], ["zap", "ada"])


if __name__ == "__main__":
    unittest.main()
