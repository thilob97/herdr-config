"""CLI-Oberfläche: Hilfe, lesende Befehle, Fehlerbild, Orchestrator, Roster."""
import json
import os
import subprocess

from fabric.tests.support import FAB, FabricCase


class CliTests(FabricCase):
    def test_help_listet_alle_befehle(self):
        result = self.ok("--help")
        for command in (
            "new", "list", "show", "edit", "status", "assign", "link", "comment",
            "dispatch", "verify", "verdict", "handover", "accept", "reject", "drop",
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

    def test_assign_prueft_den_roster(self):
        tid = self.new("Zu")
        result = self.cli("assign", tid, "fremd", "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekannter Agent", result.stderr)
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
        self.assertIn("fab-orchestrator", runs[0])
        agents_md = os.path.join(
            self.fake_home, ".herdr", "fabric-orchestrator", "AGENTS.md"
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
        self.assertEqual(len(lines), 3)
        self.assertIn("@ada: geweckt", lines)
        self.assertIn("@unbekannt: unterdrückt: unbekannt", lines)
        self.assertIn("@zap: kein Wecken: du bist der Autor", lines)

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
