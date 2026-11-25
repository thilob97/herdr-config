"""CLI-Oberfläche: Hilfe, lesende Befehle, Fehlerbild, Orchestrator, Roster."""
import json
import os
import subprocess
import unittest

from fabric.tests.support import FAB, FabricCase


class CliTests(FabricCase):
    def test_help_listet_alle_befehle(self):
        result = self.ok("--help")
        for command in (
            "new", "list", "show", "diff", "edit", "status", "assign", "link", "comment",
            "attach", "dispatch", "verify", "verdict", "handover", "accept",
            "reject", "drop",
            "wake", "orchestrator", "agents", "inbox", "index",
        ):
            self.assertIn(command, result.stdout)
        self.assertIn("Ticket aus einem Satz anlegen", result.stdout)
        self.assertIn("Abnahme", result.stdout)
        self.assertIn("Abhängigkeiten", result.stdout)

    def test_fab_laeuft_ueber_symlink(self):
        link = os.path.join(self.tmp, "fab-link")
        os.symlink(FAB, link)
        result = subprocess.run(
            [link, "--help"], env=self.env, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("BEFEHL", result.stdout)

    def test_new_speichert_repo_titel_und_kommentar(self):
        repo = self.make_repo()
        self.own_repo(repo)
        sentence = "Ein " + "sehr " * 30 + "langer Satz"
        result = self.ok("new", sentence, "--repo", repo)
        tid = result.stdout.strip()
        self.assertEqual(tid, "T-1")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["repo"], os.path.realpath(repo))
        self.assertLessEqual(len(ticket["title"]), 80)
        self.assertTrue(ticket["body"].startswith("## Auftrag\n"))
        self.assertEqual(ticket["status"], "draft")
        self.assertEqual(ticket["created_by"], "mensch")
        self.assertEqual(ticket["comments"][0]["author"], "mensch")
        self.assertIn("@orchestrator", ticket["comments"][0]["text"])

    def test_list_status_und_json(self):
        first = self.new("Erstes")
        second = self.new("Zweites")
        self.ok("status", first, "todo", "--from", "mensch")
        rows = json.loads(self.ok("list", "--json").stdout)
        self.assertEqual([row["id"] for row in rows], [first, second])
        self.assertEqual(rows[0]["status"], "todo")
        drafts = json.loads(self.ok("list", "--status", "draft", "--json").stdout)
        self.assertEqual([row["id"] for row in drafts], [second])
        self.assertIn(first, self.ok("list").stdout)
        result = self.cli("list", "--status", "quatsch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekannter Status", result.stderr)

    def test_show_json_und_text(self):
        tid = self.new("Zeigen")
        data = json.loads(self.ok("show", tid, "--json").stdout)
        self.assertEqual(data["id"], tid)
        self.assertIn("comments", data)
        self.assertIn("sessions", data)
        text = self.ok("show", tid).stdout
        self.assertIn(f"# {tid} Zeigen", text)
        self.assertIn("## Verlauf", text)

    def test_edit_body_file_und_fehler(self):
        tid = self.new("Bearbeiten")
        path = os.path.join(self.tmp, "body.md")
        self.write_file(path, "## Ziel\nneu\n")
        self.ok("edit", tid, "--body-file", path, "--from", "mensch")
        self.assertEqual(self.ticket(tid)["body"], "## Ziel\nneu\n")
        result = self.cli("edit", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Nichts zu ändern", result.stderr)
        result = self.cli(
            "edit", tid, "--body-file", os.path.join(self.tmp, "fehlt.md"), "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht lesbar", result.stderr)

    def test_status_done_ist_verboten(self):
        tid = self.new("Status")
        result = self.cli("status", tid, "done", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nur über fab accept", result.stderr)
        result = self.cli("status", tid, "quatsch", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekannter Status", result.stderr)

    def test_status_dropped_ist_verboten(self):
        tid = self.new("Verwerfen")
        result = self.cli("status", tid, "dropped", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"fab drop {tid}", result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "draft")
        self.assertEqual(
            [row for row in self.events() if row["kind"] == "status"], []
        )

    def test_assign_prueft_den_roster(self):
        tid = self.new("Zu")
        result = self.cli("assign", tid, "fremd", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gehört nicht zu Team herdr-app", result.stderr)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.assertEqual(self.ticket(tid)["assignee"], "zap")
        assigned = [row for row in self.events() if row["kind"] == "assigned"]
        self.assertEqual(assigned[-1]["target"], "zap")

    def test_link_ohne_zyklen(self):
        first = self.new("A")
        second = self.new("B")
        self.ok("link", first, "--blocked-by", second, "--from", "mensch")
        self.assertEqual(self.ticket(first)["blocked_by"], [second])
        result = self.cli("link", second, "--blocked-by", first, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Zyklus", result.stderr)
        self.assertEqual(self.ticket(second)["blocked_by"], [])
        result = self.cli("link", first, "--blocked-by", first, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("auf sich selbst", result.stderr)

    def test_fehler_sind_deutsch_und_brechen_ab(self):
        result = self.cli("show", "T-99")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(result.stderr.startswith("Fehler:"), result.stderr)
        self.assertIn("gibt es nicht", result.stderr)
        result = self.cli("show", "quatsch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Ungültige Ticket-ID", result.stderr)
        result = self.cli("comment", "T-1", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Fehler:", result.stderr)

    def test_orchestrator_start_status_stop(self):
        self.set_live({})
        self.assertIn("läuft nicht", self.ok("orchestrator", "status").stdout)
        self.clear_log()
        self.ok("orchestrator", "start")
        runs = self.hc_calls("run")
        self.assertEqual(len(runs), 1)
        self.assertIn("fab-herdr-app-orchestrator", runs[0])
        agents_md = os.path.join(
            self.fake_home, ".herdr", "fabric-orchestrator", "herdr-app", "AGENTS.md"
        )
        with open(agents_md, encoding="utf-8") as handle:
            self.assertIn("Orchestrator-Rolle", handle.read())
        self.set_live({"fab-orchestrator": "t0"})
        result = self.cli("orchestrator", "start")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("läuft schon", result.stderr)
        self.assertIn("läuft (t0)", self.ok("orchestrator", "status").stdout)
        self.clear_log()
        self.ok("orchestrator", "stop")
        self.assertTrue(self.hc_calls("kill"))

    def test_orchestrator_start_haengt_ihn_in_den_fabric_space(self):
        self.set_live({})
        self.clear_log()
        self.clear_herdr_log()
        self.ok("orchestrator", "start")
        args = self.hc_calls("run")[0]
        labels = {
            part.split("=", 1)[0]: part.split("=", 1)[1]
            for part in args if part.startswith("herdr.")
        }
        self.assertEqual(labels["herdr.space"], "sp-fabric")
        self.assertTrue(labels["herdr.tab"].startswith("tb"))
        renames = [call for call in self.herdr_calls("do")]
        self.assertEqual([call[1] for call in renames], ["tab.rename"])
        self.assertEqual(renames[0][renames[0].index("--id") + 1], labels["herdr.tab"])
        self.assertEqual(renames[0][renames[0].index("--name") + 1], "Orchestrator")

    def test_orchestrator_start_meldet_seitenleiste_im_ereignis(self):
        self.set_live({})
        self.clear_log()
        result = self.ok(
            "orchestrator", "start", env={"HERDR_APP_FAIL": "1"}
        )
        self.assertIn("Herdr-Seitenleiste", result.stdout)
        starts = [row for row in self.events() if row["kind"] == "orchestrator"]
        self.assertEqual(starts[-1]["text"].split(" (")[0], "gestartet")
        self.assertIn("Herdr-Seitenleiste", starts[-1]["text"])

    def test_agents_json_und_text(self):
        tid = self.new("Team")
        self.set_live({"fab-zap-t-1": "t5"})
        payload = json.loads(self.ok("agents", "--json").stdout)
        self.assertEqual(payload["max_sessions"], 4)
        self.assertEqual(payload["reviewer"], "ada")
        self.assertEqual([row["name"] for row in payload["agents"]], ["zap", "ada"])
        self.assertTrue(
            any(row["name"] == "fab-zap-t-1" for row in payload["sessions"])
        )
        text = self.ok("agents").stdout
        self.assertIn("zap", text)
        self.assertIn("fab-zap-t-1", text)

    def test_agents_zeigt_untätige_sessions(self):
        tid = self.new("Team")
        self.patch_ticket(
            tid,
            sessions=[
                {"agent": "zap", "name": "fab-zap-t-1", "terminal": "t5",
                 "started_at": 1}
            ],
        )
        self.set_terminals(
            [
                {"address": "t5", "name": "fab-zap-t-1", "state": "live",
                 "status": "idle"},
            ]
        )
        payload = json.loads(self.ok("agents", "--json").stdout)
        row = next(
            item for item in payload["sessions"] if item["name"] == "fab-zap-t-1"
        )
        self.assertEqual(row["status"], "idle")
        text = self.ok("agents").stdout
        self.assertIn("fab-zap-t-1 (t5, T-1, idle)", text)

    def test_agents_fuehrt_session_je_terminal_zusammen(self):
        tid = self.new("Team")
        self.patch_ticket(
            tid,
            sessions=[
                {"agent": "zap", "name": "fab-zap-t-1", "terminal": "t3",
                 "started_at": 1},
                {"agent": "zap", "name": "fab-zap-t-1", "terminal": "t4",
                 "started_at": 2},
            ],
        )
        self.set_live({"fab-zap-t-1": "t4"})
        text = self.ok("agents").stdout
        self.assertEqual(text.count("fab-zap-t-1"), 1)
        self.assertIn("t4", text)
        self.assertNotIn("t3", text)
        payload = json.loads(self.ok("agents", "--json").stdout)
        rows = [
            row for row in payload["sessions"] if row["name"] == "fab-zap-t-1"
        ]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["terminal"], "t4")
        zap = next(
            item for item in payload["agents"] if item["name"] == "zap"
        )
        self.assertEqual(
            [row["name"] for row in zap["running"]], ["fab-zap-t-1"]
        )

    def test_agents_zeigt_beendete_session_als_beendet(self):
        tid = self.new("Team")
        self.patch_ticket(
            tid,
            sessions=[
                {"agent": "zap", "name": "fab-zap-t-1", "terminal": "t6",
                 "started_at": 1},
            ],
        )
        self.set_live({})
        text = self.ok("agents").stdout
        self.assertIn("fab-zap-t-1", text)
        self.assertIn("· beendet", text)
        payload = json.loads(self.ok("agents", "--json").stdout)
        self.assertEqual(payload["sessions"], [])

    def test_inbox_json_und_index(self):
        tid = self.new("Inbox")
        self.ok("comment", tid, "--from", "zap", "@mensch bitte")
        rows = json.loads(self.ok("inbox", "--json").stdout)
        self.assertTrue(any(row["kind"] == "question" for row in rows))
        output = self.ok("index").stdout
        self.assertIn("index.json", output)
        self.assertTrue(os.path.isfile(os.path.join(self.home, "index.json")))

    def test_kommentar_gibt_zeile_pro_name(self):
        tid = self.new("Namen")
        self.set_live({"fab-ada-t-1": "t1"})
        result = self.ok(
            "comment", tid, "--from", "zap", "@ada @unbekannt @zap selbst"
        )
        lines = [line for line in result.stdout.splitlines() if line.startswith("@")]
        self.assertEqual(lines, ["@ada: geweckt", "@zap: kein Wecken: du bist der Autor"])

    def test_wake_von_hand_nutzt_die_regeln(self):
        tid = self.new("Hand")
        self.set_live({"fab-ada-t-1": "t1"})
        result = self.ok("wake", tid, "ada", "--from", "zap", "bitte prüfen")
        self.assertIn("geweckt", result.stdout)
        sends = self.hc_calls("send")
        self.assertEqual(sends[-1][1], "t1")
        self.assertIn("bitte prüfen", sends[-1][2])
        result = self.ok("wake", tid, "zap", "--from", "zap", "selbst")
        self.assertIn("kein Wecken", result.stdout)

    # -- T-17: Blaupausen und Teams

    def _blueprint_rows(self):
        return {
            row["name"]: row
            for row in json.loads(self.ok("blueprint", "list", "--json").stdout)
        }

    def _team_rows(self):
        return {
            row["name"]: row
            for row in json.loads(self.ok("team", "list", "--json").stdout)
        }

    def test_hilfe_nennt_blueprint_und_team(self):
        result = self.ok("--help")
        self.assertIn("blueprint", result.stdout)
        self.assertIn("team", result.stdout)

    def test_blueprint_anlegen_aendern_und_entfernen(self):
        prompt = os.path.join(self.roster_dir, "prompts", "neo.md")
        result = self.ok(
            "blueprint", "add", "neo",
            "--role", "umsetzer",
            "--color", "c3",
            "--argv-json", json.dumps(["omp", "--model", "m1"]),
            "--prompt-text", "Neue Rolle\n",
            "--from", "mensch",
        )
        self.assertIn("Blaupause „neo“ angelegt", result.stdout)
        self.assertIn("Rolle umsetzer", result.stdout)
        self.assertIn("Farbe c3", result.stdout)
        self.assertIn("Prompt prompts/neo.md", result.stdout)
        self.assertEqual(self._read(prompt), "Neue Rolle\n")
        rows = self._blueprint_rows()
        self.assertIn("neo", rows)
        self.assertEqual(rows["neo"]["role"], "umsetzer")
        self.assertEqual(rows["neo"]["color"], "c3")
        self.assertEqual(rows["neo"]["argv"], ["omp", "--model", "m1"])
        self.assertIn("neo", self.ok("blueprint", "list").stdout)

        result = self.ok(
            "blueprint", "edit", "neo",
            "--rename", "nova",
            "--role", "pruefer",
            "--argv-json", json.dumps(["true"]),
            "--from", "mensch",
        )
        self.assertIn("Blaupause", result.stdout)
        self.assertIn("geändert", result.stdout)
        self.assertIn("pruefer", result.stdout)
        self.assertIn("nova", result.stdout)
        rows = self._blueprint_rows()
        self.assertNotIn("neo", rows)
        self.assertEqual(rows["nova"]["role"], "pruefer")
        self.assertEqual(rows["nova"]["argv"], ["true"])
        self.assertTrue(os.path.isfile(
            os.path.join(self.roster_dir, "prompts", "nova.md")))
        self.assertFalse(os.path.exists(prompt))

        result = self.ok("blueprint", "rm", "nova", "--from", "mensch")
        self.assertIn(
            "Blaupause „nova“ entfernt; Prompt prompts/nova.md bleibt erhalten",
            result.stdout,
        )
        self.assertNotIn("nova", self._blueprint_rows())
        self.assertTrue(os.path.isfile(
            os.path.join(self.roster_dir, "prompts", "nova.md")))

        result = self.cli("blueprint", "rm", "zap", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("herdr-app", result.stderr)

    def test_team_anlegen_aendern_und_entfernen(self):
        repo = self.make_repo("zweit")
        members = json.dumps(
            [{"blueprint": "zap", "model": "m2", "max_cost": 5},
             {"blueprint": "ada"}]
        )
        result = self.ok(
            "team", "add", "zweit",
            "--repo", repo,
            "--members-json", members,
            "--reviewer", "ada",
            "--max-sessions", "3",
            "--orchestrator-argv-json", json.dumps(["true"]),
            "--from", "mensch",
        )
        self.assertIn("Team „zweit“ angelegt", result.stdout)
        self.assertIn("1 Repo(s)", result.stdout)
        self.assertIn("Mitglieder zap, ada", result.stdout)
        self.assertIn("Prüfer ada", result.stdout)
        self.assertIn("max_sessions 3", result.stdout)
        rows = self._team_rows()
        self.assertEqual(rows["zweit"]["repos"], [os.path.realpath(repo)])
        self.assertEqual(rows["zweit"]["reviewer"], "ada")
        self.assertEqual(rows["zweit"]["max_sessions"], 3)
        self.assertEqual(
            [member["blueprint"] for member in rows["zweit"]["members"]],
            ["zap", "ada"],
        )
        expanded = {item["name"]: item for item in rows["zweit"]["agents"]}
        self.assertIn("--model=m2", expanded["zap"]["argv"])
        self.assertIn("--max-cost=5", expanded["zap"]["argv"])
        text = self.ok("team", "list").stdout
        self.assertIn("zweit", text)
        self.assertIn("Prüfer ada", text)
        self.assertIn(os.path.realpath(repo), text)
        self.assertIn("Mitglieder zap, ada", text)
        self.assertIn("Übersteuerungen zap: model=m2, max-cost=5", text)

        result = self.cli(
            "team", "add", "kollision",
            "--repo", repo,
            "--members-json", json.dumps([{"blueprint": "zap"}]),
            "--reviewer", "zap",
            "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("zweit", result.stderr)

        other = self.make_repo("drittes")
        result = self.cli(
            "team", "add", "schlecht",
            "--repo", other,
            "--members-json", json.dumps([{"blueprint": "zap"}]),
            "--reviewer", "ada",
            "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Prüfer", result.stderr)

        result = self.ok(
            "team", "edit", "zweit",
            "--max-sessions", "5",
            "--members-json", json.dumps(
                [{"blueprint": "zap"}, {"blueprint": "ada"}]),
            "--from", "mensch",
        )
        self.assertIn("Team", result.stdout)
        self.assertIn("geändert", result.stdout)
        self.assertIn("max_sessions 3 → 5", result.stdout)
        rows = self._team_rows()
        self.assertEqual(rows["zweit"]["max_sessions"], 5)
        expanded = {item["name"]: item for item in rows["zweit"]["agents"]}
        self.assertEqual(expanded["zap"]["argv"], ["true"])

        result = self.ok("team", "rm", "zweit", "--from", "mensch")
        self.assertIn("Team „zweit“ entfernt", result.stdout)
        self.assertNotIn("zweit", self._team_rows())
        self.assertIn("herdr-app", self._team_rows())

        agents = json.loads(self.ok("agents", "--json").stdout)
        self.assertEqual(
            [item["name"] for item in agents["agents"]], ["zap", "ada"])
        roster = json.loads(self.ok("roster", "--json").stdout)
        self.assertEqual(roster["team"], "herdr-app")
        self.assertEqual(
            [item["name"] for item in roster["agents"]], ["zap", "ada"])

    def test_settings_set_max_sessions_total(self):
        result = self.ok(
            "settings", "set", "max_sessions_total", "12", "--from", "mensch")
        self.assertRegex(result.stdout, r"max_sessions_total: .* → 12")
        roster = json.loads(self.ok("roster", "--json").stdout)
        self.assertEqual(roster["max_sessions_total"], 12)

    # -- T-24: Mitglieder aller Teams

    def _two_team_roster(self):
        repo1 = os.path.realpath(self.make_repo("repo1"))
        repo2 = os.path.realpath(self.make_repo("repo2"))
        self.write_roster(
            blueprints=[
                {"name": "zap", "role": "umsetzer", "color": "c1",
                 "prompt": "prompts/zap.md", "argv": ["true"]},
                {"name": "ada", "role": "pruefer", "color": "c2",
                 "prompt": "prompts/ada.md", "argv": ["true"]},
                {"name": "bob", "role": "umsetzer", "color": "c3",
                 "prompt": "prompts/bob.md", "argv": ["true"]},
            ],
            teams=[
                {
                    "name": "herdr-app",
                    "repos": [repo1],
                    "members": [{"blueprint": "zap"}],
                    "orchestrator": {
                        "argv": ["true"], "prompt": "prompts/orchestrator.md",
                    },
                    "reviewer": "zap",
                    "max_sessions": 4,
                },
                {
                    "name": "zwei",
                    "repos": [repo2],
                    "members": [{"blueprint": "bob"}, {"blueprint": "ada"}],
                    "orchestrator": {
                        "argv": ["true"], "prompt": "prompts/orchestrator.md",
                    },
                    "reviewer": "ada",
                    "max_sessions": 4,
                },
            ],
        )
        return repo1, repo2

    def _two_team_ticket(self):
        _, repo2 = self._two_team_roster()
        return self.ok(
            "new", "Ticket im zweiten Team", "--repo", repo2, "--no-wake"
        ).stdout.strip()

    def test_assign_prueft_das_team_des_tickets(self):
        tid = self._two_team_ticket()
        self.ok("assign", tid, "bob", "--from", "mensch")
        self.assertEqual(self.ticket(tid)["assignee"], "bob")
        result = self.cli("assign", tid, "zap", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Team zwei", result.stderr)
        self.assertEqual(self.ticket(tid)["assignee"], "bob")

    def test_agents_json_und_text_nennen_alle_teams(self):
        self._two_team_ticket()
        rows = {
            row["name"]: row
            for row in json.loads(self.ok("agents", "--json").stdout)["agents"]
        }
        self.assertIn("bob", rows)
        self.assertEqual(rows["bob"]["teams"], ["zwei"])
        self.assertEqual(rows["zap"]["teams"], ["herdr-app"])
        text = self.ok("agents").stdout
        self.assertIn("Teams: zwei", text)

    def test_agents_running_bleibt_beim_eigenen_agenten(self):
        self._two_team_ticket()
        self.set_live({"fab-zap-t-1": "t5", "fab-zwei-bob-t-2": "t6"})
        rows = {
            row["name"]: row
            for row in json.loads(self.ok("agents", "--json").stdout)["agents"]
        }
        self.assertEqual(
            [session["name"] for session in rows["zap"]["running"]],
            ["fab-zap-t-1"],
        )
        self.assertEqual(
            [session["name"] for session in rows["bob"]["running"]],
            ["fab-zwei-bob-t-2"],
        )
        self.assertEqual(rows["ada"]["running"], [])

    def test_verdict_mit_altem_head_bucht_nicht_auf_neuen_head(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        old = self.git_out(worktree, "rev-parse", "HEAD")
        self.commit_in(worktree, "nachher.txt", "neu\n")
        result = self.cli(
            "verdict", tid, "pass", "--from", "ada", "--head", old, "alter Stand"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("neuer Commit", result.stderr)
        self.assertIn(old[:7], result.stderr)
        self.assertIsNone(self.ticket(tid)["verdict"])
        new = self.git_out(worktree, "rev-parse", "HEAD")
        self.ok("verdict", tid, "pass", "--from", "ada", "--head", new, "neuer Stand")
        self.assertEqual(self.ticket(tid)["verdict"]["head"], new)

    def test_accept_verweigert_urteil_auf_altem_head(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        old = self.git_out(worktree, "rev-parse", "HEAD")
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("handover", tid, "--from", "zap", "fertig")
        self.commit_in(worktree, "nachher.txt", "neu\n")
        result = self.cli("accept", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"Urteil gilt für HEAD {old[:7]}", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertEqual(ticket["verdict"]["head"], old)
        self.assertTrue(os.path.isdir(worktree))


class CommandCatalogTests(unittest.TestCase):
    def test_katalog_enthaelt_alle_oeffentlichen_befehle(self):
        from fabric.fablib import cli

        parser = cli.build_parser()
        sub = next(a for a in parser._actions if isinstance(a, cli.argparse._SubParsersAction))
        top = {name for name in sub.choices if not name.startswith("_")}
        catalog = cli.command_catalog(parser)
        self.assertEqual({entry["path"][0] for entry in catalog}, top)
        paths = {tuple(entry["path"]) for entry in catalog}
        self.assertIn(("team", "add"), paths)
        self.assertNotIn(("autopilot", "run"), paths, "interne Aktion fehlt")

    def test_jeder_befehl_parst_mit_der_argv_form_des_fensters(self):
        # Gleiche Form wie model.commandArgv im Fenster: Pfad, Optionen, `--`,
        # Positionsargumente. Jeder Befehl muss so parsbar sein.
        from fabric.fablib import cli

        parser = cli.build_parser()
        for entry in cli.command_catalog(parser):
            options, positionals, groups = [], [], set()
            for arg in entry["args"]:
                value = (arg["choices"] or ["1"])[0]
                needed = arg["required"] or (
                    arg["group_required"] and arg["group"] not in groups
                )
                if arg["group"] and needed:
                    groups.add(arg["group"])
                if arg["kind"] == "flag":
                    if needed:
                        options.append(arg["flag"])
                    continue
                if arg["kind"] == "option":
                    if needed:
                        options += [arg["flag"], value]
                elif arg["required"]:
                    positionals.append(value)
            argv = [*entry["path"], *options, *(["--", *positionals] if positionals else [])]
            with self.subTest(argv=argv):
                parser.parse_args(cli._normalize_argv(list(argv)))
