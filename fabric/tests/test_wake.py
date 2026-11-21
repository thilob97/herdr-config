"""Wecken: jede Regel aus Abschnitt 4 einzeln."""
import os
import time

from fabric.tests.support import FabricCase


class WakeTests(FabricCase):
    def worktree_ticket(self, title="Start", agent="zap"):
        tid = self.new(title)
        worktree = os.path.join(self.tmp, f"wt-{tid}")
        os.makedirs(worktree, exist_ok=True)
        self.patch_ticket(
            tid,
            worktree=worktree,
            branch=f"fab/{tid}-start",
            base="main",
            assignee=agent,
        )
        return tid, worktree

    def test_autor_weckt_sich_nicht(self):
        tid = self.new("Autor")
        self.clear_log()
        mark = self.mark()
        result = self.ok("comment", tid, "--from", "zap", "@zap selbst")
        self.assertIn("kein Wecken: du bist der Autor", result.stdout)
        self.assertEqual(self.hc_calls(), [])
        self.assertEqual(len(self.events_since(mark)), 1)
        self.assertEqual(self.wake_since(mark, tid), [])

    def test_no_wake_weckt_niemanden(self):
        tid = self.new("Stille")
        self.clear_log()
        mark = self.mark()
        result = self.ok(
            "comment", tid, "--from", "zap", "--no-wake", "@ada @orchestrator bitte"
        )
        self.assertEqual(result.stdout.count("kein Wecken (--no-wake)"), 2)
        self.assertEqual(self.hc_calls(), [])
        self.assertEqual(len(self.events_since(mark)), 1)
        self.assertEqual(self.wake_since(mark, tid), [])
        self.assertEqual(self.ticket(tid)["waiting"], [])

    def test_mensch_kommt_in_waiting(self):
        tid = self.new("Mensch")
        result = self.ok("comment", tid, "--from", "zap", "@mensch bitte entscheiden")
        self.assertIn("unterdrückt: mensch", result.stdout)
        self.assertIn("mensch", self.ticket(tid)["waiting"])
        self.assertEqual(self.wake_events(tid)[-1]["text"], "unterdrückt: mensch")
        self.assertTrue(any(row["kind"] == "question" for row in self.index()["inbox"]))
        # Der Wartende kommentiert: waiting wird geleert.
        self.ok("comment", tid, "--from", "mensch", "meine Antwort")
        self.assertNotIn("mensch", self.ticket(tid)["waiting"])

    def test_abgeschlossenes_ticket_weckt_nicht(self):
        tid = self.new("Fertig")
        self.patch_ticket(tid, status="done")
        self.clear_log()
        mark = self.mark()
        self.ok("comment", tid, "--from", "zap", "@ada @orchestrator")
        self.assertEqual(self.hc_calls(), [])
        texts = [row["text"] for row in self.wake_since(mark, tid)]
        self.assertEqual(texts, ["unterdrückt: abgeschlossen", "unterdrückt: abgeschlossen"])

    def test_pingpong_bremse_und_eine_orchestrator_nachricht(self):
        tid = self.new("Ping")
        self.set_live({"fab-ada-t-1": "t1", "fab-orchestrator": "t0"})
        now = int(time.time() * 1000)
        self.add_events(
            [
                {"at": now - 1000, "kind": "wake", "ticket": tid, "actor": "zap",
                 "target": "ada", "text": "geweckt"}
                for _ in range(9)
            ]
        )
        self.clear_log()
        result = self.ok("comment", tid, "--from", "zap", "@ada nochmal")
        self.assertIn("unterdrückt: ping-pong", result.stdout)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t0")
        self.assertEqual(self.wake_events(tid)[-1]["text"], "unterdrückt: ping-pong")
        attention = [row for row in self.index()["inbox"] if row["kind"] == "attention"]
        self.assertEqual(len(attention), 1)
        # Zweite Unterdrückung: keine weitere Orchestrator-Nachricht.
        self.clear_log()
        self.ok("comment", tid, "--from", "zap", "@ada wieder")
        self.assertEqual(self.hc_calls("send"), [])

    def test_orchestrator_laeuft(self):
        tid = self.new("Orch")
        self.set_live({"fab-orchestrator": "t0"})
        self.clear_log()
        result = self.ok("comment", tid, "--from", "zap", "@orchestrator bitte")
        self.assertIn("geweckt", result.stdout)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t0")
        self.assertIn("Ticket " + tid, sends[0][2])
        self.assertEqual(self.wake_events(tid)[-1]["text"], "geweckt")

    def test_orchestrator_wird_gestartet(self):
        tid = self.new("Orch-Start")
        self.set_live({})
        self.clear_log()
        result = self.ok("comment", tid, "--from", "zap", "@orchestrator")
        self.assertIn("gestartet", result.stdout)
        runs = self.hc_calls("run")
        self.assertEqual(len(runs), 1)
        self.assertIn("fab-herdr-app-orchestrator", runs[0])
        self.assertIn("fab.role=orchestrator", runs[0])
        self.assertIn("fab.team=herdr-app", runs[0])
        agents_md = os.path.join(
            self.fake_home, ".herdr", "fabric-orchestrator", "herdr-app", "AGENTS.md"
        )
        with open(agents_md, encoding="utf-8") as handle:
            self.assertIn("Orchestrator-Rolle", handle.read())
        self.assertEqual(self.wake_events(tid)[-1]["text"], "gestartet")

    def test_agent_wird_geweckt(self):
        tid = self.new("Weck")
        self.set_live({"fab-zap-t-1": "t5"})
        self.clear_log()
        result = self.ok("comment", tid, "--from", "mensch", "@zap weiter")
        self.assertIn("geweckt", result.stdout)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t5")
        self.assertIn("hat dich erwähnt", sends[0][2])
        self.assertIn("fab show " + tid, sends[0][2])
        self.assertIn("fab comment " + tid + " --from zap", sends[0][2])

    def test_agent_wird_im_worktree_gestartet(self):
        tid, worktree = self.worktree_ticket("Start")
        self.set_live({})
        self.clear_log()
        result = self.ok("comment", tid, "--from", "mensch", "@zap los")
        self.assertIn("gestartet", result.stdout)
        runs = self.hc_calls("run")
        self.assertEqual(len(runs), 1)
        args = runs[0]
        self.assertEqual(args[args.index("--name") + 1], "fab-herdr-app-zap-t-1")
        self.assertEqual(args[args.index("--cwd") + 1], worktree)
        self.assertIn("fab.agent=zap", args)
        self.assertIn("fab.ticket=" + tid, args)
        prompt = args[-1]
        self.assertIn(f"# Ticket {tid}: Start", prompt)
        self.assertIn("Zap-Rolle", prompt)
        self.assertIn(f"# {tid} Start", prompt)
        sessions = self.ticket(tid)["sessions"]
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["agent"], "zap")
        self.assertEqual(sessions[0]["terminal"], "t900")
        self.assertEqual(self.wake_events(tid)[-1]["text"], "gestartet")

    def test_agent_start_ohne_fenster_meldet_seitenleiste(self):
        tid, _worktree = self.worktree_ticket("Start")
        self.set_live({})
        self.clear_log()
        result = self.ok(
            "comment", tid, "--from", "mensch", "@zap los",
            env={"HERDR_APP_FAIL": "1"},
        )
        self.assertIn("gestartet", result.stdout)
        self.assertIn("Herdr-Seitenleiste", result.stdout)
        self.assertIn("kein Fenster", result.stdout)
        self.assertEqual(self.wake_events(tid)[-1]["text"], "gestartet")
        self.assertEqual(self.ticket(tid)["sessions"][0]["terminal"], "t900")

    def test_ohne_worktree_geht_an_den_orchestrator(self):
        tid = self.new("Ohne")
        self.set_live({"fab-orchestrator": "t0"})
        self.clear_log()
        result = self.ok("comment", tid, "--from", "zap", "@ada bitte")
        self.assertIn("an orchestrator", result.stdout)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t0")
        self.assertIn("keinen Worktree", sends[0][2])
        self.assertEqual(self.wake_events(tid)[-1]["text"], "an orchestrator")

    def test_unbekannter_name_wird_still_ignoriert(self):
        tid = self.new("Unbekannt")
        self.clear_log()
        mark = self.mark()
        result = self.ok("comment", tid, "--from", "zap", "@niemand hallo")
        self.assertEqual(result.stdout, "")
        self.assertEqual(self.hc_calls(), [])
        self.assertEqual(self.wake_since(mark), [])
        self.assertEqual(self.ticket(tid)["comments"][-1]["mentions"], [])

    def test_erklaertext_weckt_nicht(self):
        tid = self.new("Tipp")
        self.clear_log()
        mark = self.mark()
        result = self.ok(
            "comment", tid, "--from", "orchestrator",
            "Tipp: @name weckt, @a filtert",
        )
        self.assertEqual(result.stdout, "")
        self.assertEqual(self.hc_calls(), [])
        self.assertEqual(self.wake_since(mark), [])
        self.assertEqual(self.ticket(tid)["comments"][-1]["mentions"], [])

    def test_bekannte_namen_auch_gross_klein(self):
        tid = self.new("Namen")
        self.set_live(
            {"fab-ada-t-1": "t1", "fab-zap-t-1": "t5", "fab-orchestrator": "t0"}
        )
        self.clear_log()
        result = self.ok(
            "comment", tid, "--from", "mensch", "@ZAP @Ada @Orchestrator"
        )
        self.assertIn("@zap: geweckt", result.stdout)
        self.assertIn("@ada: geweckt", result.stdout)
        self.assertIn("@orchestrator: geweckt", result.stdout)
        self.assertEqual(len(self.hc_calls("send")), 3)
        self.assertEqual(
            self.ticket(tid)["comments"][-1]["mentions"],
            ["zap", "ada", "orchestrator"],
        )
        result = self.ok("comment", tid, "--from", "zap", "@MENSCH bitte")
        self.assertIn("@mensch: unterdrückt: mensch", result.stdout)
        self.assertIn("mensch", self.ticket(tid)["waiting"])

    def test_email_ist_keine_erwaehnung(self):
        tid = self.new("Mail")
        self.set_live({"fab-zap-t-1": "t5", "fab-ada-t-1": "t1"})
        self.clear_log()
        mark = self.mark()
        result = self.ok(
            "comment", tid, "--from", "mensch",
            "Mail an a@b.de, thilo@zap.de und a@ada.de",
        )
        self.assertEqual(result.stdout, "")
        self.assertEqual(self.hc_calls(), [])
        self.assertEqual(self.wake_since(mark), [])
        self.assertEqual(self.ticket(tid)["comments"][-1]["mentions"], [])

    def test_doppelte_erwaehnung_weckt_einmal(self):
        tid = self.new("Doppelt")
        self.set_live({"fab-ada-t-1": "t1"})
        self.clear_log()
        mark = self.mark()
        self.ok("comment", tid, "--from", "zap", "@ada und @ADA nochmal")
        self.assertEqual(len(self.hc_calls("send")), 1)
        self.assertEqual(len(self.wake_since(mark, tid)), 1)
        self.assertEqual(
            self.ticket(tid)["comments"][-1]["mentions"], ["ada"]
        )

    def test_voll_verhindert_start(self):
        self.write_roster(max_sessions=1)
        tid, _worktree = self.worktree_ticket("Voll")
        self.set_terminals(
            [
                {"address": "t9", "name": "fab-ada-t-9", "state": "live",
                 "status": "working"},
            ]
        )
        self.clear_log()
        result = self.ok("comment", tid, "--from", "mensch", "@zap los")
        self.assertIn("unterdrückt: voll", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertEqual(self.ticket(tid)["sessions"], [])
        attention = [row for row in self.index()["inbox"] if row["kind"] == "attention"]
        self.assertEqual(len(attention), 1)
        self.assertEqual(attention[0]["ticket"], tid)
        self.assertIn("voll", attention[0]["text"])
        self.assertIn("zap", attention[0]["text"])

    def test_untätige_session_blockiert_wecken_nicht(self):
        self.write_roster(max_sessions=1)
        tid, _worktree = self.worktree_ticket("Weck")
        self.set_terminals(
            [
                {"address": "t9", "name": "fab-ada-t-9", "state": "live",
                 "status": "idle"},
            ]
        )
        self.clear_log()
        result = self.ok("comment", tid, "--from", "mensch", "@zap los")
        self.assertIn("gestartet", result.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)
        self.assertEqual(self.wake_events(tid)[-1]["text"], "gestartet")

    def test_session_eines_abgeschlossenen_tickets_blockiert_wecken_nicht(self):
        self.write_roster(max_sessions=1)
        old = self.new("Alt")
        self.patch_ticket(
            old,
            status="done",
            sessions=[
                {"agent": "ada", "name": "fab-ada-t-9", "terminal": "t9",
                 "started_at": 1}
            ],
        )
        tid, _worktree = self.worktree_ticket("Weck")
        self.set_terminals(
            [
                {"address": "t9", "name": "fab-ada-t-9", "state": "live",
                 "status": "working"},
            ]
        )
        self.clear_log()
        result = self.ok("comment", tid, "--from", "mensch", "@zap los")
        self.assertIn("gestartet", result.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)
        self.assertEqual(self.wake_events(tid)[-1]["text"], "gestartet")

    def test_send_fallback_mit_force(self):
        tid = self.new("Force")
        self.set_live({"fab-ada-t-1": "t1"})
        marker = os.path.join(self.tmp, "send-failed")
        env = {"HC_SEND_FAIL_ONCE": marker}
        self.clear_log()
        result = self.ok("comment", tid, "--from", "zap", "@ada", env=env)
        self.assertIn("geweckt", result.stdout)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 2)
        self.assertNotIn("--force", sends[0])
        self.assertIn("--force", sends[1])

    def test_mensch_bei_merge_konflikt_weckt_zur_nacharbeit(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "vom branch\n")
        self.write_file(os.path.join(repo, "aenderung.txt"), "von main\n")
        self.git(repo, "add", "aenderung.txt")
        commit = self.git(repo, "commit", "-qm", "main ändert aenderung.txt")
        self.assertEqual(commit.returncode, 0, commit.stderr)
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        mark = self.mark()
        result = self.ok("comment", tid, "--from", "ada", "@mensch bitte abnehmen")
        self.assertIn("Merge-Konflikt mit main", result.stdout)
        ticket = self.ticket(tid)
        self.assertNotIn("mensch", ticket["waiting"])
        self.assertFalse(
            any(row["kind"] == "question" for row in self.index()["inbox"])
        )
        comment = ticket["comments"][-1]["text"]
        self.assertIn("@zap", comment)
        self.assertIn("aenderung.txt", comment)
        self.assertIn("einmergen", comment)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t7")
        wakes = self.wake_since(mark, tid)
        self.assertEqual([row["target"] for row in wakes], ["zap"])
        self.assertEqual(wakes[-1]["text"], "geweckt")

    def test_mensch_als_autor_loest_bei_konflikt_nacharbeit_aus(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "vom branch\n")
        self.write_file(os.path.join(repo, "aenderung.txt"), "von main\n")
        self.git(repo, "add", "aenderung.txt")
        commit = self.git(repo, "commit", "-qm", "main ändert aenderung.txt")
        self.assertEqual(commit.returncode, 0, commit.stderr)
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        mark = self.mark()
        result = self.ok("comment", tid, "--from", "mensch", "@mensch bitte ansehen")
        self.assertIn("Merge-Konflikt mit main", result.stdout)
        ticket = self.ticket(tid)
        self.assertNotIn("mensch", ticket["waiting"])
        self.assertFalse(
            any(row["kind"] == "question" for row in self.index()["inbox"])
        )
        comment = ticket["comments"][-1]["text"]
        self.assertIn("@zap", comment)
        self.assertIn("aenderung.txt", comment)
        self.assertIn("einmergen", comment)
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t7")
        wakes = self.wake_since(mark, tid)
        self.assertEqual([row["target"] for row in wakes], ["zap"])
        self.assertEqual(wakes[-1]["text"], "geweckt")
        # --no-wake unterdrückt den Konfliktpfad auch dann, wenn mensch Autor ist.
        count = len(self.ticket(tid)["comments"])
        self.clear_log()
        mark = self.mark()
        result = self.ok("comment", tid, "--from", "mensch", "--no-wake", "@mensch nochmal")
        self.assertNotIn("Merge-Konflikt", result.stdout)
        self.assertEqual(self.hc_calls("send"), [])
        self.assertEqual(len(self.ticket(tid)["comments"]), count + 1)
        self.assertEqual(self.wake_since(mark, tid), [])

    def test_mensch_ohne_konflikt_kommt_in_waiting(self):
        repo, tid, worktree = self.ready_ticket()
        result = self.ok("comment", tid, "--from", "zap", "@mensch bitte")
        self.assertIn("unterdrückt: mensch", result.stdout)
        self.assertIn("mensch", self.ticket(tid)["waiting"])
        self.assertTrue(
            any(row["kind"] == "question" for row in self.index()["inbox"])
        )

    # -- Fehlgeschlagener Agentenstart (T-27)

    FIRST_FAILED = "erster Versuch fehlgeschlagen"
    START_FAILED = "unterdrückt: start fehlgeschlagen"
    START_RETRY_EVENT = "zweiter Versuch erfolgreich"

    def fail_counter(self, count):
        path = os.path.join(self.tmp, "run-fails")
        self._write(path, str(count))
        return path

    def start_failures(self, tid, target=None):
        rows = [
            row
            for row in self.wake_events(tid)
            if row["text"] in (self.FIRST_FAILED, self.START_FAILED)
        ]
        if target:
            rows = [row for row in rows if row["target"] == target]
        return rows

    def attention(self):
        return [row for row in self.index()["inbox"] if row["kind"] == "attention"]

    def fab_comments(self, tid):
        return [row for row in self.ticket(tid)["comments"] if row["author"] == "fab"]

    def test_startfehler_nennt_grund(self):
        tid, _worktree = self.worktree_ticket("Startfehler")
        self.set_live({})
        self.clear_log()
        env = {"HC_RUN_FAIL": "1", "FAB_WAKE_RETRY_DELAY": "0"}
        result = self.ok("comment", tid, "--from", "mensch", "@zap los", env=env)
        self.assertIn("start fehlgeschlagen", result.stdout)
        self.assertIn("hc run:", result.stdout)
        self.assertNotIn("hc run: hc run:", result.stdout)
        # Den zweiten Versuch abwarten, damit kein Hintergrundprozess übrig bleibt.
        self.wait_for(lambda: len(self.start_failures(tid)) >= 2)
        first = self.start_failures(tid)[0]
        self.assertEqual(first["text"], self.FIRST_FAILED)
        self.assertIn("hc run:", first["reason"])
        self.assertNotIn("hc run: hc run:", first["reason"])
        self.assertTrue(
            any(
                "hc run:" in row["text"] and "Zweiter Versuch" in row["text"]
                for row in self.fab_comments(tid)
            )
        )
        self.assertFalse(
            any(
                "hc run: hc run:" in row["text"] for row in self.fab_comments(tid)
            )
        )

    def test_zweiter_versuch_gelingt_genau_einmal(self):
        tid, _worktree = self.worktree_ticket("Wiederholung")
        self.set_live({})
        self.clear_log()
        env = {
            "HC_RUN_FAIL_TIMES": self.fail_counter(1),
            "FAB_WAKE_RETRY_DELAY": "0",
        }
        self.ok("comment", tid, "--from", "mensch", "@zap los", env=env)
        self.assertEqual(self.attention(), [])
        self.wait_for(
            lambda: any(
                row["text"] == "zweiter Versuch erfolgreich"
                for row in self.wake_events(tid)
            )
            and bool(self.ticket(tid)["sessions"])
        )
        failures = self.start_failures(tid)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["text"], self.FIRST_FAILED)
        self.assertIn("hc run:", failures[0]["reason"])
        self.assertNotIn("hc run: hc run:", failures[0]["reason"])
        retry = [
            row
            for row in self.wake_events(tid)
            if row["text"] == "zweiter Versuch erfolgreich"
        ]
        self.assertEqual(len(retry), 1)
        self.assertEqual(retry[0]["target"], "zap")
        self.assertEqual(retry[0]["reason"], "gestartet")
        self.assertEqual(len(self.hc_calls("run")), 2)
        self.assertTrue(
            any(
                "zweiter Versuch erfolgreich" in row["text"]
                for row in self.fab_comments(tid)
            )
        )
        sessions = self.ticket(tid)["sessions"]
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["agent"], "zap")
        self.assertEqual(self.attention(), [])
        # Genau ein Versuch: auch später kommt kein dritter Start dazu.
        time.sleep(0.3)
        self.assertEqual(len(self.hc_calls("run")), 2)

    def test_kein_attention_waehrend_der_pause(self):
        tid, _worktree = self.worktree_ticket("Pause")
        self.set_live({})
        self.clear_log()
        env = {
            "HC_RUN_FAIL_TIMES": self.fail_counter(1),
            "FAB_WAKE_RETRY_DELAY": "2",
        }
        self.ok("comment", tid, "--from", "mensch", "@zap los", env=env)
        # Während der Pause: kein Inbox-Eintrag, keine Wiederholung gestartet.
        self.assertEqual(self.attention(), [])
        self.assertEqual(len(self.hc_calls("run")), 1)
        first = self.start_failures(tid)
        self.assertEqual([row["text"] for row in first], [self.FIRST_FAILED])
        self.assertIn("hc run:", first[0]["reason"])
        self.assertNotIn("hc run: hc run:", first[0]["reason"])
        self.wait_for(
            lambda: any(
                row["text"] == self.START_RETRY_EVENT
                for row in self.wake_events(tid)
            )
        )
        self.assertEqual(self.attention(), [])
        self.assertEqual(len(self.hc_calls("run")), 2)

    def test_zweiter_fehlschlag_legt_attention_an(self):
        tid, _worktree = self.worktree_ticket("Dauerfehler")
        self.set_live({})
        self.clear_log()
        env = {"HC_RUN_FAIL": "1", "FAB_WAKE_RETRY_DELAY": "0"}
        result = self.ok("comment", tid, "--from", "mensch", "@zap los", env=env)
        self.assertIn("start fehlgeschlagen", result.stdout)
        self.wait_for(
            lambda: len(self.start_failures(tid)) >= 2
            and any(
                "endgültig" in row["text"] for row in self.fab_comments(tid)
            )
        )
        failures = self.start_failures(tid)
        self.assertEqual(len(failures), 2)
        self.assertEqual(
            [row["text"] for row in failures],
            [self.FIRST_FAILED, self.START_FAILED],
        )
        for row in failures:
            self.assertIn("hc run:", row["reason"])
            self.assertNotIn("hc run: hc run:", row["reason"])
        self.assertEqual(len(self.hc_calls("run")), 2)
        attention = [row for row in self.attention() if row["ticket"] == tid]
        self.assertEqual(len(attention), 1)
        self.assertEqual(attention[0]["agent"], "zap")
        self.assertIn("hc run:", attention[0]["reason"])
        self.assertNotIn("hc run: hc run:", attention[0]["reason"])
        self.assertIn("Start fehlgeschlagen: zap", attention[0]["text"])
        self.assertIn("hc run:", attention[0]["text"])
        self.assertNotIn("hc run: hc run:", attention[0]["text"])
        self.assertTrue(
            any("endgültig" in row["text"] for row in self.fab_comments(tid))
        )

    def test_orchestrator_startfehler_legt_attention_an(self):
        tid = self.new("Orch-Fehler")
        self.set_live({})
        self.clear_log()
        env = {"HC_RUN_FAIL": "1", "FAB_WAKE_RETRY_DELAY": "0"}
        self.ok("comment", tid, "--from", "zap", "@orchestrator bitte", env=env)
        self.wait_for(
            lambda: len(self.start_failures(tid, "orchestrator")) >= 2
            and any(
                "endgültig" in row["text"] for row in self.fab_comments(tid)
            )
        )
        failures = self.start_failures(tid, "orchestrator")
        self.assertEqual(len(failures), 2)
        self.assertEqual(
            [row["text"] for row in failures],
            [self.FIRST_FAILED, self.START_FAILED],
        )
        for row in failures:
            self.assertIn("hc run:", row["reason"])
            self.assertNotIn("hc run: hc run:", row["reason"])
        self.assertEqual(len(self.hc_calls("run")), 2)
        attention = [row for row in self.attention() if row["ticket"] == tid]
        self.assertEqual(len(attention), 1)
        self.assertEqual(attention[0]["agent"], "orchestrator")
        self.assertIn("hc run:", attention[0]["reason"])
        self.assertNotIn("hc run: hc run:", attention[0]["reason"])
        self.assertIn("Start fehlgeschlagen: orchestrator", attention[0]["text"])

    def test_attention_verschwindet_nach_erneutem_start(self):
        tid = self.new("Wieder da")
        now = int(time.time() * 1000)
        self.add_events(
            [
                {
                    "at": now,
                    "kind": "wake",
                    "ticket": tid,
                    "actor": "mensch",
                    "target": "zap",
                    "text": "unterdrückt: start fehlgeschlagen",
                    "reason": "hc run: kaputt",
                }
            ]
        )
        self.ok("index")
        attention = [row for row in self.attention() if row["ticket"] == tid]
        self.assertEqual(len(attention), 1)
        self.assertEqual(attention[0]["agent"], "zap")
        self.assertIn("hc run: kaputt", attention[0]["reason"])
        self.assertIn("Start fehlgeschlagen: zap", attention[0]["text"])
        self.set_live({"fab-zap-t-1": "t5"})
        result = self.ok("wake", tid, "zap", "--from", "mensch", "wieder")
        self.assertIn("geweckt", result.stdout)
        attention = [row for row in self.attention() if row["ticket"] == tid]
        self.assertEqual(attention, [])
