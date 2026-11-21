"""Routing nach Team: Wecken, neue Terminals, Ablehnung, Limits und Filter."""
import json
import os

from fabric.fablib import hc
from fabric.tests.support import FabricCase

BODY = "## Ziel\nEtwas.\n\n## Abnahmekriterien\n- [ ] es läuft\n"


class RoutingTests(FabricCase):
    def add_team(self, name="zweit", members=None, reviewer="zap", limit=2):
        repo = self.make_repo(name)
        self.ok(
            "team", "add", name,
            "--repo", repo,
            "--members-json", json.dumps(members or [{"blueprint": "zap"}]),
            "--reviewer", reviewer,
            "--max-sessions", str(limit),
            "--orchestrator-argv-json", json.dumps(["true"]),
            "--from", "mensch",
        )
        return repo

    def new_in(self, repo, sentence="Zweit", body=BODY):
        tid = self.ok("new", sentence, "--repo", repo).stdout.strip().splitlines()[-1]
        self.ok("edit", tid, "--body", body, "--from", "mensch")
        return tid

    def test_orchestrator_wird_nach_team_geroutet(self):
        repo = self.add_team()
        tid = self.new_in(repo)
        self.set_live({
            "fab-herdr-app-orchestrator": "th",
            "fab-zweit-orchestrator": "tz",
        })
        self.clear_log()
        result = self.ok("comment", tid, "--from", "mensch", "@orchestrator bitte")
        self.assertIn("geweckt", result.stdout)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "tz")

    def test_ticket_anderen_teams_weckt_dieses_terminal_nicht(self):
        self.add_team()
        tid = self.new("Herdr")
        self.set_live({
            "fab-herdr-app-orchestrator": "th",
            "fab-zweit-orchestrator": "tz",
        })
        self.clear_log()
        self.ok("comment", tid, "--from", "mensch", "@orchestrator bitte")
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "th")

    def test_fremder_orchestrator_wird_nicht_geweckt_sondern_gestartet(self):
        self.add_team()
        tid = self.new("Herdr")
        self.set_live({"fab-zweit-orchestrator": "tz"})
        self.clear_log()
        result = self.ok("comment", tid, "--from", "mensch", "@orchestrator bitte")
        self.assertIn("gestartet", result.stdout)
        # Der fremde tz wird nicht geweckt; der frisch gestartete eigene
        # Orchestrator bekommt den Wecktext nachgesendet.
        sends = self.hc_calls("send")
        self.assertEqual([row[1] for row in sends], ["t900"])
        self.assertIn(f"fab comment {tid} --from orchestrator", sends[0][2])
        runs = self.hc_calls("run")
        self.assertEqual(len(runs), 1)
        self.assertIn("fab-herdr-app-orchestrator", runs[0])

    def test_fab_new_lehnt_repo_ohne_team_ab(self):
        repo = self.make_repo("fremd")
        result = self.cli("new", "Ohne Team", "--repo", repo)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gehört keinem Team", result.stderr)
        self.assertIn("fab team edit", result.stderr)

    def test_dispatch_nutzt_teamname_und_uebersteuerungen(self):
        repo = self.add_team(members=[
            {"blueprint": "zap", "model": "m2", "max_cost": 7},
            {"blueprint": "ada"},
        ], reviewer="ada")
        tid = self.new_in(repo)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.clear_log()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("verteilt", result.stdout)
        args = self.hc_calls("run")[0]
        self.assertEqual(args[args.index("--name") + 1], "fab-zweit-zap-t-1")
        self.assertIn("fab.team=zweit", args)
        self.assertIn("--model=m2", args)
        self.assertIn("--max-cost=7", args)
        self.assertEqual(self.ticket(tid)["sessions"][0]["name"],
                         "fab-zweit-zap-t-1")

    def test_dispatch_lehnt_agent_ausserhalb_des_teams_ab(self):
        repo = self.add_team()
        tid = self.new_in(repo)
        # `assign` prüft die Mitgliedschaft selbst; hier geht es um das
        # zweite Gate in `dispatch`.
        result = self.cli("dispatch", tid, "--agent", "ada", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gehört nicht zu Team zweit", result.stderr)
        self.assertIsNone(self.ticket(tid)["worktree"])

    def test_team_limit_unterdrueckt_start(self):
        repo = self.add_team(limit=2)
        tid = self.new_in(repo)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.set_terminals([
            {"address": "t8", "name": "fab-zweit-zap-t-8", "state": "live",
             "status": "working"},
            {"address": "t9", "name": "fab-zweit-zap-t-9", "state": "live",
             "status": "blocked"},
        ])
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unterdrückt: voll", result.stderr)
        self.assertIsNone(self.ticket(tid)["worktree"])

    def test_globales_limit_unterdrueckt_start(self):
        repo = self.add_team(limit=4)
        tid = self.new_in(repo)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("settings", "set", "max_sessions_total", "1", "--from", "mensch")
        self.set_terminals([
            {"address": "t9", "name": "fab-herdr-app-ada-t-9", "state": "live",
             "status": "working"},
        ])
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unterdrückt: voll", result.stderr)
        self.assertIsNone(self.ticket(tid)["worktree"])

    def test_orchestrator_befehle_wirken_nur_auf_das_team(self):
        self.add_team()
        self.set_live({
            "fab-herdr-app-orchestrator": "th",
            "fab-zweit-orchestrator": "tz",
        })
        self.clear_log()
        result = self.ok("orchestrator", "stop", "zweit")
        self.assertIn("zweit beendet", result.stdout)
        self.assertEqual(
            [call[1] for call in self.hc_calls("kill")], ["fab-zweit-orchestrator"]
        )
        self.assertIn(
            "läuft (th)", self.ok("orchestrator", "status", "herdr-app").stdout
        )
        self.set_live({"fab-herdr-app-orchestrator": "th"})
        self.assertIn(
            "läuft nicht", self.ok("orchestrator", "status", "zweit").stdout
        )
        self.clear_log()
        result = self.ok("orchestrator", "start", "zweit")
        self.assertIn("fab-zweit-orchestrator", result.stdout)
        runs = self.hc_calls("run")
        self.assertEqual(len(runs), 1)
        self.assertIn("fab-zweit-orchestrator", runs[0])
        self.assertNotIn("fab-herdr-app-orchestrator", runs[0])

    def test_list_und_inbox_filtern_nach_team(self):
        repo = self.add_team()
        zweit = self.new_in(repo)
        herdr = self.new("Herdr")
        for tid in (zweit, herdr):
            self.ok("status", tid, "review", "--from", "mensch")
        rows = json.loads(self.ok("list", "--team", "zweit", "--json").stdout)
        self.assertEqual([row["id"] for row in rows], [zweit])
        everything = json.loads(self.ok("list", "--json").stdout)
        self.assertEqual({row["id"] for row in everything}, {zweit, herdr})

        inbox = json.loads(self.ok("inbox", "--team", "zweit", "--json").stdout)
        self.assertEqual([item["ticket"] for item in inbox], [zweit])
        self.assertEqual(
            {item["ticket"] for item in json.loads(self.ok("inbox", "--json").stdout)},
            {zweit, herdr},
        )

    def test_alte_agenten_terminale_werden_weiter_geweckt(self):
        tid = self.new("Alt")
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("edit", tid, "--body", BODY, "--from", "mensch")
        self.set_live({})
        self.ok("dispatch", tid, "--from", "mensch")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("läuft schon (fab-zap-t-1)", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertEqual(self.hc_calls("send")[0][1], "t7")

    def test_lange_namen_kollidieren_nicht_und_behalten_die_ticket_id(self):
        team = "plattform-backen"
        agent = "reviewer-zweite"
        first = hc.terminal_name(agent, "T-1", team)
        second = hc.terminal_name(agent, "T-12", team)
        self.assertNotEqual(first, second)
        self.assertTrue(first.endswith("-t-1"), first)
        self.assertTrue(second.endswith("-t-12"), second)
        for name in (first, second):
            self.assertLessEqual(len(name), hc.NAME_LIMIT)
            self.assertRegex(name, r"^[a-z0-9-]+$")

    def test_langer_orchestratorname_behaelt_den_suffix(self):
        first = hc.orchestrator_name("abcdefghijklmnop")
        second = hc.orchestrator_name("abcdefghijklmno2")
        self.assertLessEqual(len(first), hc.NAME_LIMIT)
        self.assertTrue(first.endswith("-orchestrator"), first)
        self.assertTrue(hc.is_orchestrator(first))
        self.assertNotEqual(first, second)
