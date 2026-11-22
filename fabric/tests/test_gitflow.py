"""Prüfen, Urteil, Übergabe-Gate, Abnahme, Zurückweisen, Verwerfen."""
import glob
import json
import os
import tempfile

from fabric.tests.support import FabricCase


class GitflowTests(FabricCase):
    def review_ticket(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        return repo, tid, worktree

    def test_verify_schreibt_checks_auf_head(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        head = self.git_out(worktree, "rev-parse", "HEAD")
        result = self.ok("verify", tid)
        self.assertIn("checks pass", result.stdout)
        self.assertIn("prüfung ok", result.stdout)
        checks = self.ticket(tid)["checks"]
        self.assertEqual(checks["state"], "pass")
        self.assertEqual(checks["head"], head)
        self.assertIn("prüfung ok", checks["tail"])
        self.assertIn("zweite zeile", checks["tail"])
        self.assertEqual([row["kind"] for row in self.events()][-1], "verify")

    def test_verify_ohne_skript(self):
        repo, tid, worktree = self.ready_ticket()
        result = self.cli("verify", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(os.path.join(worktree, ".fabric", "verify.sh"), result.stderr)
        self.assertIsNone(self.ticket(tid)["checks"])

    def test_verify_meldet_fehlschlag(self):
        repo, tid, worktree = self.ready_ticket()
        path = os.path.join(worktree, ".fabric", "verify.sh")
        self.write_file(path, "#!/bin/sh\necho 'test rot'\nexit 3\n")
        result = self.cli("verify", tid)
        self.assertEqual(result.returncode, 1)
        checks = self.ticket(tid)["checks"]
        self.assertEqual(checks["state"], "fail")
        self.assertIn("test rot", checks["tail"])

    def test_verify_schreibt_den_aufrufer_als_akteur(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid, "--from", "ada")
        rows = [row for row in self.events() if row["kind"] == "verify"]
        self.assertEqual(rows[-1]["actor"], "ada")
        self.ok("verify", tid)
        rows = [row for row in self.events() if row["kind"] == "verify"]
        self.assertEqual(rows[-1]["actor"], "zap")

    def test_verdict_pass_weckt_den_zustaendigen(self):
        repo, tid, worktree = self.ready_ticket()
        head = self.git_out(worktree, "rev-parse", "HEAD")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("verdict", tid, "pass", "--from", "ada", "Alles geprüft")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["verdict"]["state"], "pass")
        self.assertEqual(ticket["verdict"]["head"], head)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t7")
        self.assertIn(f"Urteil pass auf HEAD {head[:7]}", sends[0][2])
        self.assertIn(f"fab handover {tid} --from zap", sends[0][2])
        self.assertEqual(self.wake_events(tid)[-1]["text"], "geweckt")

    def test_urteil_weckt_nicht_wenn_pruefer_zustaendiger_ist(self):
        repo, tid, worktree = self.ready_ticket()
        self.ok("assign", tid, "ada", "--from", "mensch")
        self.set_live({"fab-ada-t-1": "t1"})
        self.clear_log()
        mark = self.mark()
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("verdict", tid, "fail", "--from", "ada", "doch nicht")
        sends = self.hc_calls("send")
        # Der Zuständige weckt sich nicht selbst; der Orchestrator soll die Lehre
        # vorschlagen und wird deshalb zusätzlich geweckt (kalt gestartet: t900).
        self.assertEqual([row[1] for row in sends], ["t900"])
        self.assertIn("fab lesson propose", sends[0][2])
        wakes = self.wake_since(mark, tid)
        self.assertEqual([row["target"] for row in wakes], ["orchestrator"])
        self.assertIn(wakes[-1]["text"], ("gestartet", "geweckt"))

    def test_verdict_fail_weckt_den_zustaendigen(self):
        repo, tid, worktree = self.ready_ticket()
        head = self.git_out(worktree, "rev-parse", "HEAD")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("verdict", tid, "fail", "--from", "ada", "Bitte Tests ergänzen")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["verdict"]["state"], "fail")
        self.assertEqual(ticket["verdict"]["by"], "ada")
        self.assertEqual(ticket["verdict"]["head"], head)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(ticket["comments"][-1]["author"], "ada")
        self.assertIn("Bitte Tests ergänzen", ticket["comments"][-1]["text"])
        sends = self.hc_calls("send")
        self.assertEqual([row[1] for row in sends], ["t7", "t900"])
        self.assertIn("Urteil fail", sends[0][2])
        self.assertIn("fab lesson propose", sends[1][2])
        wakes = self.wake_events(tid)
        self.assertEqual(wakes[-1]["target"], "orchestrator")
        self.assertIn(wakes[-1]["text"], ("gestartet", "geweckt"))

    def test_verdict_fail_raeumt_mensch_aus_waiting(self):
        repo, tid, worktree = self.review_ticket()
        self.assertIn("mensch", self.ticket(tid)["waiting"])
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        self.ok("verdict", tid, "fail", "--from", "ada", "Doku fehlt.")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("mensch", ticket["waiting"])
        rows = json.loads(self.ok("inbox", "--json").stdout)
        self.assertFalse(
            [row for row in rows if row.get("ticket") == tid], rows
        )
        sends = self.hc_calls("send")
        self.assertEqual([row[1] for row in sends], ["t7", "t900"])
        self.assertEqual(sends[0][1], "t7")

    def test_handover_gate_zaehlt_nur_aktuellen_head(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.commit_in(worktree, "nachher.txt")
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Checks gelten für HEAD", result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "doing")
        # Auf dem aktuellen HEAD prüfen, dann geht die Übergabe durch.
        self.ok("verify", tid)
        result = self.ok("handover", tid, "--from", "zap", "fertig")
        self.assertIn("review", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertIn("mensch", ticket["waiting"])
        self.assertEqual(ticket["comments"][-1]["author"], "zap")
        self.assertEqual([row["kind"] for row in self.events()][-1], "handover")

    def test_handover_gate_zaehlt_urteil_nicht_bei_neuem_head(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.commit_in(worktree, "nachher.txt")
        self.ok("verify", tid)
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Urteil gilt für HEAD", result.stderr)
        self.assertNotIn("Checks", result.stderr)
        self.assertEqual(self.ticket(tid)["status"], "doing")

    def test_handover_ohne_urteil(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("kein Urteil", result.stderr)

    def test_handover_mit_rotem_urteil(self):
        repo, tid, worktree = self.ready_ticket()
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "fail", "--from", "ada", "nicht gut")
        result = self.cli("handover", tid, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Urteil steht auf fail", result.stderr)

    def merge_worktrees(self, tid):
        return glob.glob(
            os.path.join(tempfile.gettempdir(), f"fab-merge-{tid}-*")
        )

    def test_handover_verweigert_roten_merge_stand(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.write_file(
            os.path.join(worktree, ".fabric", "verify.sh"),
            "#!/bin/sh\ntest ! -f main-rot.txt\n",
        )
        self.git_out(worktree, "add", ".fabric/verify.sh")
        self.git_out(worktree, "commit", "-qm", "Prüfskript")
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.write_file(os.path.join(repo, "main-rot.txt"), "rot\n")
        self.git_out(repo, "add", "main-rot.txt")
        self.git_out(repo, "commit", "-qm", "main macht den Merge rot")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()

        result = self.cli("handover", tid, "--from", "zap", "fertig")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Stand mit main ist rot", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("merge", ticket)
        self.assertNotIn("mensch", ticket["waiting"])
        self.assertEqual(self.merge_worktrees(tid), [])

    def test_handover_raeumt_merge_worktree_bei_abbruch(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree, commit=False)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")

        result = self.cli("handover", tid, "--from", "zap", "fertig")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Stand mit main konnte nicht geprüft werden", result.stderr)
        self.assertNotIn("merge", self.ticket(tid))
        self.assertEqual(self.merge_worktrees(tid), [])

    def test_accept_verweigert_neuen_merge_tree_und_weckt_prueferin(self):
        repo, tid, worktree = self.review_ticket()
        old_tree = self.ticket(tid)["merge"]["tree"]
        self.write_file(os.path.join(repo, "fremd.txt"), "fremd\n")
        self.git_out(repo, "add", "fremd.txt")
        self.git_out(repo, "commit", "-qm", "main läuft weiter")
        self.set_live({"fab-ada-t-1": "t1"})
        self.clear_log()
        mark = self.mark()

        result = self.cli("accept", tid)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Stand", result.stderr)
        self.assertIn("nicht abgenommen", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("mensch", ticket["waiting"])
        self.assertIsNone(ticket.get("verdict"))
        self.assertNotEqual(ticket["merge"]["tree"], old_tree)
        self.assertEqual(ticket["merge"]["state"], "pass")
        self.assertEqual(
            [row["target"] for row in self.wake_since(mark, tid)], ["ada"]
        )
        self.assertEqual([row[1] for row in self.hc_calls("send")], ["t1"])
        self.assertFalse(os.path.isfile(os.path.join(repo, "aenderung.txt")))
        self.assertEqual(self.merge_worktrees(tid), [])
        # Ohne neues Urteil darf die Übergabe nicht wieder durchgehen.
        again = self.cli("handover", tid, "--from", "zap", "nochmal")
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("kein Urteil", again.stderr)

    def test_accept_weckt_bei_rotem_neuen_merge_stand_zustaendigen(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.write_file(
            os.path.join(worktree, ".fabric", "verify.sh"),
            "#!/bin/sh\ntest ! -f main-rot.txt\n",
        )
        self.git_out(worktree, "add", ".fabric/verify.sh")
        self.git_out(worktree, "commit", "-qm", "Prüfskript")
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("handover", tid, "--from", "zap", "fertig")
        self.write_file(os.path.join(repo, "main-rot.txt"), "rot\n")
        self.git_out(repo, "add", "main-rot.txt")
        self.git_out(repo, "commit", "-qm", "main macht den Merge rot")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        mark = self.mark()

        result = self.cli("accept", tid)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ist rot", result.stderr)
        self.assertIn("nicht abgenommen", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertIsNone(ticket.get("verdict"))
        self.assertNotIn("mensch", ticket["waiting"])
        self.assertEqual(ticket["merge"]["state"], "fail")
        self.assertEqual(
            [row["target"] for row in self.wake_since(mark, tid)], ["zap"]
        )
        self.assertEqual([row[1] for row in self.hc_calls("send")], ["t7"])
        self.assertFalse(os.path.isfile(os.path.join(repo, "aenderung.txt")))
        self.assertEqual(self.merge_worktrees(tid), [])

    def test_accept_weckt_bei_neuem_merge_konflikt_zustaendigen(self):
        repo, tid, worktree = self.review_ticket()
        self.write_file(os.path.join(repo, "aenderung.txt"), "von main\n")
        self.git_out(repo, "add", "aenderung.txt")
        self.git_out(repo, "commit", "-qm", "main ändert dieselbe Datei")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        mark = self.mark()

        result = self.cli("accept", tid)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Konflikt", result.stderr)
        self.assertIn("nicht abgenommen", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertIsNone(ticket.get("verdict"))
        self.assertNotIn("merge", ticket)
        self.assertNotIn("mensch", ticket["waiting"])
        self.assertEqual(
            [row["target"] for row in self.wake_since(mark, tid)], ["zap"]
        )
        self.assertEqual([row[1] for row in self.hc_calls("send")], ["t7"])
        with open(os.path.join(repo, "aenderung.txt")) as handle:
            self.assertEqual(handle.read(), "von main\n")
        self.assertEqual(
            self.git_out(repo, "log", "--merges", "--oneline"), ""
        )

    def test_accept_nimmt_bei_gleichem_merge_tree_ab(self):
        repo, tid, worktree = self.review_ticket()
        recorded = self.ticket(tid)["merge"]["tree"]
        self.git_out(repo, "commit", "--allow-empty", "-qm", "main ohne Tree-Änderung")

        result = self.ok("accept", tid)

        self.assertIn("angenommen", result.stdout)
        self.assertEqual(self.ticket(tid)["status"], "done")
        self.assertEqual(
            self.git_out(repo, "rev-parse", "main^{tree}"), recorded
        )

    def test_accept_mergt_und_raeumt_auf(self):
        repo, tid, worktree = self.review_ticket()
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("accept", tid)
        self.assertIn("angenommen", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "done")
        self.assertEqual(ticket["waiting"], [])
        self.assertIn(
            "Merge fab/T-1-kurzer-titel",
            self.git_out(repo, "log", "--merges", "--oneline", "-n", "1"),
        )
        self.assertTrue(os.path.isfile(os.path.join(repo, "aenderung.txt")))
        self.assertEqual(self.git_out(repo, "branch", "--list", "fab/T-1-kurzer-titel"), "")
        self.assertFalse(os.path.exists(worktree))
        kills = self.hc_calls("kill")
        self.assertTrue(any("t900" in call for call in kills), kills)
        self.assertEqual([row["kind"] for row in self.events()][-1], "accept")

    def test_accept_beendet_sessions_auch_ohne_eintrag(self):
        repo, tid, worktree = self.review_ticket()
        self.set_terminals(
            [
                {"address": "t7", "name": "fab-herdr-app-ada-t-1",
                 "state": "live"},
                {"address": "t8", "name": "frei-name", "state": "live",
                 "labels": {"fab.ticket": tid}},
                {"address": "t9", "name": "fab-herdr-app-orchestrator",
                 "state": "live"},
                {"address": "t5", "name": "fab-herdr-app-ada-t-2",
                 "state": "live"},
            ]
        )
        self.clear_log()
        result = self.ok("accept", tid)
        self.assertIn("angenommen", result.stdout)
        kills = [row[1] for row in self.hc_calls("kill")]
        self.assertIn("fab-herdr-app-ada-t-1", kills)
        self.assertIn("frei-name", kills)
        self.assertNotIn("fab-herdr-app-orchestrator", kills)
        self.assertNotIn("fab-herdr-app-ada-t-2", kills)
        self.assertEqual(self.ticket(tid)["status"], "done")

    def test_accept_mergt_trotz_fremder_lokaler_aenderung(self):
        repo, tid, worktree = self.review_ticket()
        self.write_file(os.path.join(repo, "README.md"), "lokal\n")
        result = self.ok("accept", tid)
        self.assertIn("angenommen", result.stdout)
        with open(os.path.join(repo, "README.md")) as handle:
            self.assertEqual(handle.read(), "lokal\n")
        self.assertIn("README.md", self.git_out(repo, "status", "--porcelain"))
        self.assertEqual(self.ticket(tid)["status"], "done")
        self.assertTrue(os.path.isfile(os.path.join(repo, "aenderung.txt")))

    def test_accept_bricht_bei_ueberschneidung_ab(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "README.md", "vom branch\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("handover", tid, "--from", "zap", "fertig")
        self.write_file(os.path.join(repo, "README.md"), "lokal\n")
        result = self.cli("accept", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("README.md", result.stderr)
        self.assertIn("nicht sauber", result.stderr)
        self.assertTrue(os.path.isdir(worktree))
        self.assertEqual(self.ticket(tid)["status"], "review")
        with open(os.path.join(repo, "README.md")) as handle:
            self.assertEqual(handle.read(), "lokal\n")

    def test_accept_verweigert_falschen_branch(self):
        repo, tid, worktree = self.review_ticket()
        self.git(repo, "checkout", "-q", "-b", "andere")
        result = self.cli("accept", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("steht auf andere", result.stderr)

    def test_accept_nur_im_status_review(self):
        repo, tid, worktree = self.ready_ticket()
        result = self.cli("accept", tid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nur im Status review", result.stderr)

    def test_accept_rot_setzt_merge_zurueck(self):
        repo, tid, worktree = self.review_ticket()
        self.write_file(
            os.path.join(worktree, "mods", "demo", "main.js"), "export default {}\n"
        )
        self.write_file(os.path.join(worktree, "mods", "demo", "mod.json"), "{}\n")
        self.write_file(
            os.path.join(worktree, "mods", "demo", "test", "demo.test.mjs"),
            "// Test für die Logik\n",
        )
        self.git_out(worktree, "add", "mods")
        commit = self.git(worktree, "commit", "-qm", "mods")
        self.assertEqual(commit.returncode, 0, commit.stderr)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Nachtrag geprüft")
        self.ok("handover", tid, "--from", "zap", "Nachtrag")
        main_before = self.git_out(repo, "rev-parse", "main")

        result = self.cli("accept", tid, env={"HERDR_APP_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)

        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "review")
        self.assertEqual(self.git_out(repo, "rev-parse", "main"), main_before)
        self.assertFalse(os.path.isfile(os.path.join(repo, "aenderung.txt")))
        self.assertTrue(os.path.isdir(worktree))
        self.assertTrue(
            self.git_out(repo, "branch", "--list", "fab/T-1-kurzer-titel")
        )
        self.assertFalse(
            [row for row in self.events() if row["kind"] == "accept"]
        )

        rows = json.loads(self.ok("inbox", "--json").stdout)
        attention = [
            row
            for row in rows
            if row.get("kind") == "attention" and row.get("ticket") == tid
        ]
        self.assertEqual(len(attention), 1, rows)
        self.assertTrue(attention[0]["text"].startswith("Merge zurückgesetzt:"))
        self.assertIn("kein Fenster", attention[0]["text"])

    def test_reject_weckt_den_zustaendigen(self):
        repo, tid, worktree = self.review_ticket()
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        result = self.ok("reject", tid, "Bitte mehr Tests")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(ticket["comments"][-1]["author"], "mensch")
        self.assertIn("Bitte mehr Tests", ticket["comments"][-1]["text"])
        sends = self.hc_calls("send")
        self.assertEqual([row[1] for row in sends], ["t7", "t900"])
        self.assertEqual(sends[0][1], "t7")
        self.assertIn("fab lesson propose", sends[1][2])
        wakes = self.wake_events(tid)
        self.assertEqual(wakes[-1]["target"], "orchestrator")
        self.assertIn(wakes[-1]["text"], ("gestartet", "geweckt"))
        self.assertEqual([row["kind"] for row in self.events()][-1], "reject")

    def test_drop_beendet_sessions_und_behaelt_worktree(self):
        repo, tid, worktree = self.ready_ticket()
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        self.ok("drop", tid, "--from", "mensch", "nicht mehr nötig")
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "dropped")
        self.assertTrue(os.path.isdir(worktree))
        self.assertTrue(self.ticket(tid)["comments"])
        self.assertTrue(self.hc_calls("kill"))
        self.assertEqual([row["kind"] for row in self.events()][-1], "drop")

    def test_drop_beendet_sessions_auch_ohne_eintrag(self):
        repo, tid, worktree = self.ready_ticket()
        self.set_terminals(
            [
                {"address": "t7", "name": "fab-herdr-app-ada-t-1",
                 "state": "live"},
                {"address": "t8", "name": "frei-name", "state": "live",
                 "labels": {"fab.ticket": tid}},
            ]
        )
        self.clear_log()
        self.ok("drop", tid, "--from", "mensch", "nicht mehr nötig")
        kills = [row[1] for row in self.hc_calls("kill")]
        self.assertIn("fab-herdr-app-ada-t-1", kills)
        self.assertIn("frei-name", kills)

    def konflikt_ticket(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "vom branch\n")
        self.write_file(os.path.join(repo, "aenderung.txt"), "von main\n")
        self.git(repo, "add", "aenderung.txt")
        commit = self.git(repo, "commit", "-qm", "main ändert aenderung.txt")
        self.assertEqual(commit.returncode, 0, commit.stderr)
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        return repo, tid, worktree

    def test_handover_verweigert_merge_konflikt(self):
        repo, tid, worktree = self.konflikt_ticket()
        status_before = self.git_out(repo, "status", "--porcelain", "--untracked-files=no")
        main_before = self.git_out(repo, "rev-parse", "main")
        branch_before = self.git_out(repo, "rev-parse", "fab/T-1-kurzer-titel")
        result = self.cli("handover", tid, "--from", "zap", "Fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Konflikt mit main", result.stderr)
        self.assertIn("aenderung.txt", result.stderr)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertNotIn("mensch", ticket["waiting"])
        comment = ticket["comments"][-1]["text"]
        self.assertIn("aenderung.txt", comment)
        self.assertIn("einmergen", comment)
        self.assertEqual(
            self.git_out(repo, "status", "--porcelain", "--untracked-files=no"),
            status_before,
        )
        self.assertEqual(self.git_out(repo, "rev-parse", "main"), main_before)
        self.assertEqual(
            self.git_out(repo, "rev-parse", "fab/T-1-kurzer-titel"), branch_before
        )

    def test_handover_konflikt_weckt_den_zustaendigen(self):
        repo, tid, worktree = self.konflikt_ticket()
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        mark = self.mark()
        result = self.cli("handover", tid, "--from", "ada", "Fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Merge-Konflikt mit main", result.stderr)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t7")
        self.assertIn("Merge-Konflikt mit main", sends[0][2])
        self.assertIn("aenderung.txt", sends[0][2])
        wakes = self.wake_since(mark, tid)
        self.assertEqual([row["target"] for row in wakes], ["zap"])
        self.assertEqual(wakes[-1]["text"], "geweckt")
