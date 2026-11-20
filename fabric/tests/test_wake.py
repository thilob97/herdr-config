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
        self.assertIn("fab-orchestrator", runs[0])
        self.assertIn("fab.role=orchestrator", runs[0])
        agents_md = os.path.join(
            self.fake_home, ".herdr", "fabric-orchestrator", "AGENTS.md"
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
        self.assertEqual(args[args.index("--name") + 1], "fab-zap-t-1")
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
