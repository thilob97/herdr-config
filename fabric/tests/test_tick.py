"""Stillstands-Wächter `fab tick`: Regeln 1–6, Idempotenz, launchd."""
import json
import os
import plistlib
import subprocess
import sys
import types
from unittest import mock

from fabric.fablib import store, tick
from fabric.tests.support import FAB, FabricCase

MINUTE = 60 * 1000


class TickCase(FabricCase):
    def now(self):
        return store.now_ms()

    def ago(self, minutes):
        return self.now() - int(minutes * MINUTE)

    def standard_home(self):
        return os.path.join(self.fake_home, ".config", "herdr-app", "data", "fabric")

    def new_ticket(self, status="todo", assignee="zap", worktree=True, **fields):
        result = self.ok(
            "new", "Testticket", "--repo", self.default_repo(), "--no-wake"
        )
        tid = result.stdout.strip().splitlines()[-1]
        values = {
            "status": status,
            "assignee": assignee,
            "base": "main",
            "branch": f"fab/{tid}-test",
        }
        if worktree:
            folder = os.path.join(self.tmp, f"wt-{tid}")
            os.makedirs(folder, exist_ok=True)
            values["worktree"] = folder
        values.update(fields)
        self.patch_ticket(tid, **values)
        return tid

    def comment_at(self, tid, author, text, at):
        self.ok("comment", tid, "--from", author, "--no-wake", text)
        ticket = self.ticket(tid)
        ticket["comments"][-1]["at"] = at
        self.patch_ticket(tid, comments=ticket["comments"])
        return ticket["comments"][-1]

    def runs(self):
        return [" ".join(row) for row in self.hc_calls("run")]

    def last_session(self, tid):
        return self.ticket(tid)["sessions"][-1]["name"]

    def attention(self):
        return [
            row for row in self.index()["inbox"] if row["kind"] == "attention"
        ]

    def live_session(self, tid, agent="zap", address="t5"):
        name = f"fab-herdr-app-{agent}-{tid.lower()}"
        self.patch_ticket(
            tid,
            sessions=[{"agent": agent, "terminal": address, "name": name,
                       "started_at": self.now()}],
        )
        self.set_live({name: address})
        return name

    # -- Regel 1

    def test_regel1_doing_ohne_session_weckt_zustaendigen(self):
        tid = self.new_ticket(status="doing", assignee="zap")
        self.comment_at(tid, "zap", "erster Stand", self.ago(20))
        self.patch_ticket(tid, updated_at=self.ago(11))
        self.clear_log()
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Regel 1 (doing)", result.stdout)
        self.assertIn("@zap", result.stdout)
        self.assertIn("letzter Verlauf", result.stdout)
        self.assertEqual(len(self.runs()), 1)
        self.assertIn("fab-herdr-app-zap-", self.runs()[0])
        stall = self.ticket(tid)["stall"]
        self.assertEqual(stall["rule"], "doing")
        self.assertEqual(stall["agent"], "zap")
        self.assertEqual(stall["attempts"], 1)
        texts = [row["text"] for row in self.events_since(mark, "tick")]
        self.assertEqual(texts, ["gestartet"])

    def test_regel1_ohne_zustaendigen_oder_mit_mensch(self):
        tid = self.new_ticket(status="doing", assignee=None)
        self.patch_ticket(tid, updated_at=self.ago(30))
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertNotIn("stall", self.ticket(tid))

        tid = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(tid, updated_at=self.ago(30), waiting=["mensch"])
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertNotIn("stall", self.ticket(tid))

    def test_regel1_schwelle_aus_einstellungen(self):
        tid = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(tid, updated_at=self.ago(6))
        self.assertIn("Keine Aktion.", self.ok("tick").stdout)

        self.ok("settings", "set", "tick_doing_minutes", "5", "--from", "mensch")
        with open(self.roster, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["tick_doing_minutes"], 5)
        result = self.ok("tick")
        self.assertIn("Regel 1 (doing)", result.stdout)
        self.assertEqual(len(self.runs()), 1)

    def test_regel1_zu_frisch_ist_keine_aktion(self):
        tid = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(tid, updated_at=self.ago(2))
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertNotIn("stall", self.ticket(tid))
        self.assertEqual(self.runs(), [])

    def test_beendete_session_nach_entstoerung_sofort_gemeldet(self):
        tid = self.new_ticket(status="doing", assignee="zap")
        name = self.live_session(tid)
        self.set_terminals(
            [
                {"address": "t5", "name": name, "state": "finished",
                 "exit_code": 0, "reason": "exit"},
            ]
        )
        self.set_gets(
            {
                "t5": {"state": "finished", "exit_code": 0, "reason": "exit",
                       "finished_ms": self.now()},
            }
        )
        self.set_reads({"t5": "letzte Zeile\n"})
        self.ok("tick")
        self.assertTrue(self.ticket(tid)["stall"]["attention"])

        self.ok("comment", tid, "--from", "zap", "--no-wake", "kurz notiert")
        self.assertNotIn("stall", self.ticket(tid))

        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Regel 1 (doing)", result.stdout)
        self.assertIn("beendet:", result.stdout)
        self.assertIn(name, result.stdout)
        tick_rows = self.events_since(mark, "tick")
        self.assertEqual([row["text"] for row in tick_rows], ["attention"])
        attention = self.attention()
        self.assertEqual(len(attention), 1)
        self.assertIn("beendet:", attention[0]["text"])
        self.assertIn("Exit 0", attention[0]["text"])
        stall = self.ticket(tid)["stall"]
        self.assertEqual(stall["rule"], "doing")
        self.assertTrue(stall["attention"])
        self.assertEqual(self.runs(), [])

        self.ok("tick")
        self.assertEqual(len(self.events_since(mark, "tick")), 1)

    # -- Regel 2

    def test_regel2_unbeantwortete_erwaehnung_startet_agenten(self):
        tid = self.new_ticket(status="todo", assignee="zap")
        self.comment_at(tid, "mensch", "@zap bitte übernehmen", self.ago(6))
        self.clear_log()
        result = self.ok("tick")
        self.assertIn("Regel 2 (mention)", result.stdout)
        self.assertEqual(len(self.runs()), 1)
        self.assertIn("fab-herdr-app-zap-", self.runs()[0])
        stall = self.ticket(tid)["stall"]
        self.assertEqual(stall["rule"], "mention")
        self.assertEqual(stall["agent"], "zap")

    def test_regel2_antwortet_keine_aktion(self):
        tid = self.new_ticket(status="todo", assignee="zap")
        self.comment_at(tid, "mensch", "@zap bitte übernehmen", self.ago(9))
        self.comment_at(tid, "zap", "mache ich", self.ago(6))
        self.live_session(tid)
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertEqual(self.runs(), [])

    # -- Regel 3

    def test_regel3_prueferwunsch_startet_reviewer(self):
        tid = self.new_ticket(status="todo", assignee="zap")
        self.comment_at(tid, "zap", "@ada bitte prüfen", self.ago(7))
        self.clear_log()
        result = self.ok("tick")
        self.assertIn("Regel 3 (review)", result.stdout)
        self.assertEqual(len(self.runs()), 1)
        self.assertIn("fab-herdr-app-ada-", self.runs()[0])
        self.assertEqual(self.ticket(tid)["stall"]["agent"], "ada")

    def test_regel3_mit_urteil_keine_aktion(self):
        tid = self.new_ticket(status="todo", assignee="zap")
        self.comment_at(tid, "zap", "@ada bitte prüfen", self.ago(9))
        self.patch_ticket(
            tid,
            verdict={"state": "pass", "by": "ada", "head": "abc", "at": self.ago(4),
                     "summary": "gut"},
        )
        self.live_session(tid)
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertEqual(self.runs(), [])

    # -- Regel 4

    def test_regel4_todo_weckt_orchestrator(self):
        tid = self.new_ticket(status="todo")
        self.clear_log()
        result = self.ok("tick")
        self.assertIn("Regel 4 (todo)", result.stdout)
        runs = self.runs()
        self.assertEqual(len(runs), 1)
        self.assertIn("fab-herdr-app-orchestrator", runs[0])
        stall = self.ticket(tid)["stall"]
        self.assertEqual(stall["agent"], "orchestrator")
        self.assertFalse(stall["attention"])

    def test_regel4_voll_startet_nicht(self):
        tid = self.new_ticket(status="todo")
        self.set_live({
            f"fab-herdr-app-a-t{index}": f"t{index}" for index in range(8, 12)
        })
        self.clear_log()
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("unterdrückt: voll", result.stdout)
        self.assertEqual(self.runs(), [])
        self.assertNotIn("stall", self.ticket(tid))
        self.assertEqual(self.events_since(mark, "tick"), [])

    # -- Regel 5 und 6

    def blocked_pair(self, age=45):
        blocker = self.new_ticket(status="review")
        self.blocker_at = self.ago(age)
        self.patch_ticket(blocker, updated_at=self.blocker_at)
        tid = self.new_ticket(status="todo", blocked_by=[blocker])
        return blocker, tid

    def test_regel5_alter_blocker_ist_attention(self):
        blocker, tid = self.blocked_pair()
        self.clear_log()
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Regel 5 (blocked)", result.stdout)
        self.assertIn("attention", result.stdout)
        self.assertEqual(self.hc_calls("send"), [])
        self.assertEqual(self.runs(), [])
        stall = self.ticket(tid)["stall"]
        self.assertTrue(stall["attention"])
        self.assertEqual(stall["agent"], "zap")
        self.assertIn(blocker, stall["reason"])
        self.assertIn("review", stall["reason"])
        self.assertIn("45", stall["reason"])
        tick_rows = self.events_since(mark, "tick")
        self.assertEqual(len(tick_rows), 1)
        self.assertTrue(tick_rows[0]["reason"].startswith("Regel 5 (blocked):"))

        attention = [
            row for row in self.index()["inbox"] if row["kind"] == "attention"
        ]
        self.assertEqual(len(attention), 1)
        self.assertTrue(attention[0]["text"].startswith("stockt seit "))
        self.assertEqual(attention[0]["agent"], "zap")
        self.assertEqual(attention[0]["since"], self.blocker_at)
        self.assertIn("offene Blocker", attention[0]["text"])

    def test_junger_blocker_ist_keine_aktion(self):
        blocker = self.new_ticket(status="review")
        self.patch_ticket(blocker, updated_at=self.ago(5))
        tid = self.new_ticket(status="todo", blocked_by=[blocker])
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertNotIn("stall", self.ticket(tid))

    def test_junger_blocker_loest_alten_stillstand(self):
        blocker, tid = self.blocked_pair()
        self.patch_ticket(blocker, updated_at=self.ago(5))
        self.patch_ticket(
            tid,
            stall={
                "rule": "blocked",
                "since": self.ago(45),
                "attempts": 0,
                "last_attempt": 0,
                "attention": True,
                "reason": "offene Blocker: alt",
                "agent": "zap",
            },
        )
        result = self.ok("tick")
        self.assertIn("gelöst", result.stdout)
        self.assertNotIn("stall", self.ticket(tid))

    def test_regel5_verkettete_todos_sind_kein_falschalarm(self):
        first = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(first, updated_at=self.now())
        second = self.new_ticket(status="todo", blocked_by=[first])
        third = self.new_ticket(status="todo", blocked_by=[second])
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertNotIn("stall", self.ticket(second))
        self.assertNotIn("stall", self.ticket(third))
        self.assertEqual(self.events_since(mark, "tick"), [])
        self.ok("index")
        self.assertEqual(self.attention(), [])

    def test_regel5_stockendes_glied_erzeugt_genau_einen_eintrag(self):
        blocker = self.new_ticket(status="doing", assignee="zap")
        self.live_session(blocker)
        self.patch_ticket(blocker, updated_at=self.ago(45))
        tid = self.new_ticket(status="todo", blocked_by=[blocker])
        third = self.new_ticket(status="todo", blocked_by=[tid])
        result = self.ok("tick")
        self.assertIn("Regel 5 (blocked)", result.stdout)
        attention = self.attention()
        self.assertEqual([row["ticket"] for row in attention], [tid])
        self.assertIn(blocker, self.ticket(tid)["stall"]["reason"])
        self.assertNotIn("stall", self.ticket(third))

    def test_regel5_loest_bestehende_falschalarme(self):
        first = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(first, updated_at=self.now())
        second = self.new_ticket(status="todo", blocked_by=[first])
        third = self.new_ticket(status="todo", blocked_by=[second])
        for tid in (second, third):
            self.patch_ticket(
                tid,
                stall={
                    "rule": "blocked",
                    "since": self.ago(120),
                    "attempts": 0,
                    "last_attempt": 0,
                    "attention": True,
                    "reason": f"offene Blocker: {first} (todo) seit 120 Min.",
                    "agent": "zap",
                },
            )
        self.ok("index")
        self.assertEqual(len(self.attention()), 2)
        result = self.ok("tick")
        self.assertIn("gelöst", result.stdout)
        self.assertNotIn("stall", self.ticket(second))
        self.assertNotIn("stall", self.ticket(third))
        self.assertEqual(self.attention(), [])

    def test_regel5_draft_blocker_meldet_nach_schwelle(self):
        blocker = self.new_ticket(status="draft")
        self.patch_ticket(blocker, updated_at=self.ago(45))
        tid = self.new_ticket(status="todo", blocked_by=[blocker])
        result = self.ok("tick")
        self.assertIn("Regel 5 (blocked)", result.stdout)
        self.assertEqual([row["ticket"] for row in self.attention()], [tid])
        self.assertIn("draft", self.ticket(tid)["stall"]["reason"])

    def test_regel6_zweiter_versuch_ist_attention(self):
        tid = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(
            tid,
            updated_at=self.ago(40),
            stall={
                "rule": "doing",
                "since": self.ago(40),
                "attempts": 2,
                "last_attempt": self.ago(20),
                "attention": False,
                "reason": "keine Aktivität seit 40 Min.; letzter Verlauf: keine Kommentare",
                "agent": "zap",
            },
        )
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Regel 6 (doing)", result.stdout)
        self.assertIn("attention", result.stdout)
        self.assertEqual(self.runs(), [])
        stall = self.ticket(tid)["stall"]
        self.assertTrue(stall["attention"])
        self.assertEqual(stall["attempts"], 2)
        rows = self.events_since(mark, "tick")
        self.assertEqual([row["text"] for row in rows], ["attention"])
        attention = [
            row for row in self.index()["inbox"] if row["kind"] == "attention"
        ]
        self.assertEqual(len(attention), 1)
        self.assertEqual(attention[0]["agent"], "zap")

    def test_zweiter_fehlstart_sofort_attention(self):
        tid = self.new_ticket(status="todo")
        self.patch_ticket(
            tid,
            stall={
                "rule": "todo",
                "since": self.ago(10),
                "attempts": 1,
                "last_attempt": self.ago(6),
                "attention": False,
                "reason": "todo ohne Blocker und Session seit 10 Min.",
                "agent": "orchestrator",
            },
        )
        env = {"HC_RUN_FAIL": "1"}
        result = self.ok("tick", env=env)
        self.assertIn("attention", result.stdout)
        stall = self.ticket(tid)["stall"]
        self.assertEqual(stall["attempts"], 2)
        self.assertTrue(stall["attention"])
        self.assertIn("Start fehlgeschlagen", stall["reason"])

    def test_verschwundene_session_sofort_statt_zweitem_versuch(self):
        """Start, Session lebt, Session verschwindet: sofort attention."""
        tid = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(tid, updated_at=self.ago(11))
        result = self.ok("tick")
        self.assertIn("Regel 1 (doing)", result.stdout)
        self.assertEqual(self.ticket(tid)["stall"]["attempts"], 1)

        self.set_live({self.last_session(tid): "t9"})
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertEqual(self.ticket(tid)["stall"]["attempts"], 1)
        self.assertEqual(self.events_since(mark, "tick"), [])

        # Eine sichtbare, dann verschwundene Session gilt als beendet: die
        # Meldung kommt sofort statt eines zweiten Startversuchs.
        self.set_live({})
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Regel 1 (doing)", result.stdout)
        self.assertIn("beendet:", result.stdout)
        self.assertIn("Verschwunden ohne Abschlusszeile", result.stdout)
        self.assertEqual(self.ticket(tid)["stall"]["attempts"], 1)
        self.assertEqual(
            [row["text"] for row in self.events_since(mark, "tick")],
            ["attention"],
        )

        runs = len(self.runs())
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertEqual(len(self.runs()), runs)
        attention = self.attention()
        self.assertEqual(len(attention), 1)
        self.assertEqual(attention[0]["agent"], "zap")

    def test_regel6_ueberlebt_lebende_session_bei_erwaehnung(self):
        tid = self.new_ticket(status="todo", assignee="zap")
        self.comment_at(tid, "mensch", "@zap bitte übernehmen", self.ago(6))
        result = self.ok("tick")
        self.assertIn("Regel 2 (mention)", result.stdout)
        self.assertEqual(self.ticket(tid)["stall"]["attempts"], 1)

        self.set_live({self.last_session(tid): "t9"})
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertEqual(self.ticket(tid)["stall"]["attempts"], 1)
        self.assertEqual(self.events_since(mark, "tick"), [])

        self.set_live({})
        stall = dict(self.ticket(tid)["stall"])
        stall["last_attempt"] = self.ago(6)
        self.patch_ticket(tid, stall=stall)
        result = self.ok("tick")
        self.assertIn("gestartet", result.stdout)
        self.assertEqual(self.ticket(tid)["stall"]["attempts"], 2)

        self.set_live({})
        stall = dict(self.ticket(tid)["stall"])
        stall["last_attempt"] = self.ago(6)
        self.patch_ticket(tid, stall=stall)
        result = self.ok("tick")
        self.assertIn("attention", result.stdout)
        self.assertEqual(len(self.attention()), 1)

    def test_statuswechsel_loescht_stall(self):
        tid = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(
            tid,
            stall={
                "rule": "doing",
                "since": self.ago(40),
                "attempts": 2,
                "last_attempt": self.ago(20),
                "attention": True,
                "reason": "keine Aktivität seit 40 Min.",
                "agent": "zap",
            },
        )
        self.ok("status", tid, "review", "--from", "zap")
        self.assertNotIn("stall", self.ticket(tid))
        self.assertEqual(self.attention(), [])

    # -- Idempotenz und dry-run

    def test_zweiter_tick_aendert_nichts(self):
        tid = self.new_ticket(status="todo")
        self.ok("tick")
        ticket_before = self.ticket(tid)
        events_before = self.events()
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Keine Aktion.", result.stdout)
        self.assertEqual(self.ticket(tid), ticket_before)
        self.assertEqual(self.events_since(mark), [])
        self.assertEqual(len(events_before), self.mark())

    def test_dry_run_ohne_wirkung(self):
        tid = self.new_ticket(status="todo")
        ticket_before = self.ticket(tid)
        mark = self.mark()
        self.clear_log()
        result = self.ok("tick", "--dry-run")
        self.assertIn("geplant", result.stdout)
        self.assertIn("Regel 4 (todo)", result.stdout)
        self.assertEqual(self.runs(), [])
        self.assertEqual(self.hc_calls("send"), [])
        self.assertEqual(self.ticket(tid), ticket_before)
        self.assertEqual(self.events_since(mark), [])

    def test_dry_run_zeigt_unterdrueckung(self):
        self.new_ticket(status="todo")
        self.set_live({
            f"fab-herdr-app-a-t{index}": f"t{index}" for index in range(8, 12)
        })
        self.clear_log()
        mark = self.mark()
        result = self.ok("tick", "--dry-run")
        self.assertIn("unterdrückt: voll", result.stdout)
        self.assertNotIn("geplant", result.stdout)
        self.assertEqual(self.runs(), [])
        self.assertEqual(self.events_since(mark), [])

    # -- Ping-Pong und Nebenläufigkeit

    def test_pingpong_bremse_startet_nicht(self):
        tid = self.new_ticket(status="todo", assignee="zap")
        self.comment_at(tid, "mensch", "@zap bitte", self.ago(6))
        self.set_live({"fab-orchestrator": "t0"})
        now = self.now()
        self.add_events([
            {"at": now - 1000, "kind": "wake", "ticket": tid, "actor": "mensch",
             "target": "zap", "text": "geweckt"}
            for _ in range(9)
        ])
        self.clear_log()
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("ping-pong", result.stdout)
        self.assertEqual(self.runs(), [])
        self.assertEqual(self.events_since(mark, "tick"), [])
        self.assertNotIn("stall", self.ticket(tid))

    def test_parallele_ticks_wecken_genau_einmal(self):
        tid = self.new_ticket(status="todo")
        self.clear_log()
        env = dict(self.env)
        handles = [
            subprocess.Popen(
                [sys.executable, FAB, "tick"],
                cwd=self.tmp,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for _ in range(2)
        ]
        answers = [handle.communicate(timeout=60) for handle in handles]
        for handle in handles:
            self.assertEqual(handle.returncode, 0)
        output = "\n".join(answer[0] for answer in answers)
        actions = [
            line
            for line in output.splitlines()
            if "Regel" in line and "geplant" not in line
        ]
        self.assertEqual(len(actions), 1, output)
        self.assertEqual(len(self.runs()), 1)
        self.assertEqual(self.ticket(tid)["stall"]["attempts"], 1)

    # -- Auflösen, eingefrorene Status

    def test_kommentar_loest_stillstand(self):
        tid = self.new_ticket(status="doing", assignee="zap")
        self.patch_ticket(
            tid,
            updated_at=self.ago(40),
            stall={
                "rule": "doing",
                "since": self.ago(40),
                "attempts": 2,
                "last_attempt": self.ago(20),
                "attention": True,
                "reason": "keine Aktivität seit 40 Min.; letzter Verlauf: keine Kommentare",
                "agent": "zap",
            },
        )
        self.ok("index")
        self.ok("comment", tid, "--from", "zap", "--no-wake", "ich arbeite weiter")
        self.assertNotIn("stall", self.ticket(tid))
        self.ok("index")
        attention = [
            row for row in self.index()["inbox"] if row["kind"] == "attention"
        ]
        self.assertEqual(attention, [])

    def test_eingefrorene_status_bleiben_unangetastet(self):
        for status in ("draft", "review", "done", "dropped"):
            tid = self.new_ticket(status=status, assignee="zap")
            stall = {
                "rule": "doing",
                "since": self.ago(90),
                "attempts": 3,
                "last_attempt": self.ago(60),
                "attention": True,
                "reason": "alt",
                "agent": "zap",
            }
            self.patch_ticket(tid, updated_at=self.ago(90), stall=stall)
            mark = self.mark()
            result = self.ok("tick")
            self.assertIn("Keine Aktion.", result.stdout)
            self.assertEqual(self.ticket(tid)["stall"], stall)
            self.assertEqual(self.events_since(mark, "tick"), [])

    def test_tick_beendet_sessions_abgeschlossener_tickets(self):
        done = self.new_ticket(status="done")
        dropped = self.new_ticket(status="dropped")
        self.set_terminals(
            [
                {"address": "t1", "name": f"fab-herdr-app-ada-{done.lower()}",
                 "state": "live"},
                {"address": "t2", "name": "frei-name", "state": "live",
                 "labels": {"fab.ticket": dropped}},
                {"address": "t3", "name": "fab-herdr-app-ada-t-3",
                 "state": "live"},
            ]
        )
        dry = self.ok("tick", "--dry-run")
        self.assertIn(
            f"{done}: geplant: Session fab-herdr-app-ada-{done.lower()} beenden",
            dry.stdout,
        )
        self.assertIn(f"{dropped}: geplant: Session frei-name beenden", dry.stdout)
        self.assertEqual(self.hc_calls("kill"), [])

        self.clear_log()
        result = self.ok("tick")
        self.assertIn(
            f"{done}: Session fab-herdr-app-ada-{done.lower()} beendet",
            result.stdout,
        )
        self.assertIn(f"{dropped}: Session frei-name beendet", result.stdout)
        kills = [row[1] for row in self.hc_calls("kill")]
        self.assertEqual(
            sorted(kills),
            sorted([f"fab-herdr-app-ada-{done.lower()}", "frei-name"]),
        )
        self.assertNotIn("fab-herdr-app-ada-t-3", kills)

    # -- launchd

    def test_install_und_uninstall(self):
        guard = {"FAB_TICK_NO_LAUNCHCTL": "1", "FAB_HOME": ""}
        result = self.ok("tick", "--install", env=guard)
        plist = os.path.join(
            self.fake_home, "Library", "LaunchAgents", "de.herdr.fabric.tick.plist"
        )
        self.assertIn(plist, result.stdout)
        self.assertTrue(os.path.isfile(plist))
        with open(plist, "rb") as handle:
            data = plistlib.load(handle)
        self.assertEqual(data["Label"], "de.herdr.fabric.tick")
        self.assertEqual(data["StartInterval"], 60)
        self.assertFalse(data["RunAtLoad"])
        self.assertEqual(data["ProgramArguments"][1:], ["tick"])
        self.assertTrue(data["ProgramArguments"][0].endswith("/fabric/fab"))
        self.assertTrue(os.path.isabs(data["ProgramArguments"][0]))
        plist_env = data["EnvironmentVariables"]
        self.assertEqual(plist_env["FAB_HOME"], self.standard_home())
        self.assertEqual(plist_env["FAB_ROSTER"], self.roster)
        self.assertIn("PATH", plist_env)
        self.assertIn("Hinweis", result.stdout)

        result = self.ok("tick", "--uninstall", env=guard)
        self.assertIn(plist, result.stdout)
        self.assertFalse(os.path.exists(plist))
        self.assertIn("Hinweis", result.stdout)

    def test_install_ohne_launchd_ist_nur_hinweis(self):
        path = os.path.join(self.bin, "launchctl")
        self._write(path, "#!/bin/sh\necho 'nicht geladen' >&2\nexit 1\n")
        os.chmod(path, 0o755)
        result = self.ok(
            "tick", "--install",
            env={"FAB_TICK_NO_LAUNCHCTL": "1", "FAB_HOME": ""},
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("Hinweis", result.stdout)
        self.assertTrue(
            os.path.isfile(
                os.path.join(
                    self.fake_home, "Library", "LaunchAgents",
                    "de.herdr.fabric.tick.plist",
                )
            )
        )

    # -- automatische Einrichtung

    def test_autostart_enabled_worktree_ohne_freigabe(self):
        worktree = "/tmp/worktrees/x/fabric/fab"
        with mock.patch.dict(os.environ, {"FAB_TICK_AUTOSTART": ""}):
            with mock.patch.object(tick, "program_path", return_value=worktree):
                with mock.patch.object(
                    tick, "sys", types.SimpleNamespace(platform="darwin")
                ):
                    self.assertFalse(tick.autostart_enabled())

    def test_autostart_enabled_ausserhalb_macos(self):
        with mock.patch.dict(os.environ, {"FAB_TICK_AUTOSTART": "1"}):
            with mock.patch.object(
                tick, "sys", types.SimpleNamespace(platform="linux")
            ):
                self.assertFalse(tick.autostart_enabled())

    def test_autostart_enabled_worktree_mit_freigabe(self):
        worktree = "/tmp/worktrees/x/fabric/fab"
        with mock.patch.dict(os.environ, {"FAB_TICK_AUTOSTART": "1"}):
            with mock.patch.object(tick, "program_path", return_value=worktree):
                with mock.patch.object(
                    tick, "sys", types.SimpleNamespace(platform="darwin")
                ):
                    self.assertTrue(tick.autostart_enabled())

    def test_autostart_enabled_haupt_checkout_unter_macos(self):
        with mock.patch.dict(os.environ, {"FAB_TICK_AUTOSTART": ""}):
            with mock.patch.object(
                tick, "program_path", return_value="/opt/fabric/fab"
            ):
                with mock.patch.object(
                    tick, "sys", types.SimpleNamespace(platform="darwin")
                ):
                    self.assertTrue(tick.autostart_enabled())

    def test_autostart_enabled_abgeschaltet(self):
        with mock.patch.dict(os.environ, {"FAB_TICK_AUTOSTART": "0"}):
            with mock.patch.object(
                tick, "program_path", return_value="/opt/fabric/fab"
            ):
                with mock.patch.object(
                    tick, "sys", types.SimpleNamespace(platform="darwin")
                ):
                    self.assertFalse(tick.autostart_enabled())

    def test_install_mit_abweichendem_home_schreibt_nichts(self):
        agents = os.path.join(self.tmp, "LaunchAgents")
        log = self.launchctl_stub()
        result = self.cli(
            "tick", "--install",
            env={
                "FAB_HOME": self.home,
                "FAB_LAUNCH_AGENTS_DIR": agents,
                "LAUNCHCTL_LOG": log,
            },
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FAB_HOME", result.stdout)
        self.assertFalse(os.path.exists(agents))
        self.assertFalse(os.path.exists(log))

    def test_abweichendes_home_im_auftrag_wird_repariert(self):
        agents = os.path.join(self.tmp, "LaunchAgents")
        log = self.launchctl_stub()
        os.makedirs(agents, exist_ok=True)
        plist = os.path.join(agents, "de.herdr.fabric.tick.plist")
        with open(plist, "wb") as handle:
            plistlib.dump(
                {
                    "Label": "de.herdr.fabric.tick",
                    "EnvironmentVariables": {"FAB_HOME": "/tmp/woanders"},
                },
                handle,
            )
        self.ok(
            "version",
            env={
                "FAB_TICK_AUTOSTART": "1",
                "FAB_HOME": "",
                "FAB_LAUNCH_AGENTS_DIR": agents,
                "LAUNCHCTL_LOG": log,
            },
        )
        with open(plist, "rb") as handle:
            data = plistlib.load(handle)
        self.assertEqual(
            data["EnvironmentVariables"]["FAB_HOME"], self.standard_home()
        )
        with open(log, encoding="utf-8") as handle:
            calls = handle.read().splitlines()
        self.assertEqual(len(calls), 2)
        self.assertIn("bootout", calls[0])
        self.assertIn("bootstrap", calls[1])

    def launchctl_stub(self):
        """Stub protokolliert `launchctl`-Aufrufe, statt sie auszuführen."""
        log = os.path.join(self.tmp, "launchctl.log")
        path = os.path.join(self.bin, "launchctl")
        self._write(
            path,
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$LAUNCHCTL_LOG\"\nexit 0\n",
        )
        os.chmod(path, 0o755)
        return log

    def test_erster_aufruf_installiert_den_auftrag_genau_einmal(self):
        agents = os.path.join(self.tmp, "LaunchAgents")
        log = self.launchctl_stub()
        env = {
            "FAB_TICK_AUTOSTART": "1",
            "FAB_HOME": "",
            "FAB_LAUNCH_AGENTS_DIR": agents,
            "LAUNCHCTL_LOG": log,
        }
        self.ok("version", env=env)
        plist = os.path.join(agents, "de.herdr.fabric.tick.plist")
        self.assertTrue(os.path.isfile(plist))
        with open(plist, "rb") as handle:
            data = plistlib.load(handle)
        self.assertEqual(data["Label"], "de.herdr.fabric.tick")
        self.assertEqual(data["ProgramArguments"][1:], ["tick"])
        with open(log, encoding="utf-8") as handle:
            calls = handle.read().splitlines()
        self.assertEqual(len(calls), 1)
        self.assertIn("bootstrap", calls[0])

        with open(plist, encoding="utf-8") as handle:
            before = handle.read()
        self.ok("version", env=env)
        with open(plist, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), before)
        with open(log, encoding="utf-8") as handle:
            self.assertEqual(len(handle.read().splitlines()), 1)

    def test_abgeschalteter_autostart_schreibt_nichts(self):
        agents = os.path.join(self.tmp, "LaunchAgents")
        log = self.launchctl_stub()
        env = {
            "FAB_TICK_AUTOSTART": "0",
            "FAB_LAUNCH_AGENTS_DIR": agents,
            "LAUNCHCTL_LOG": log,
        }
        self.ok("version", env=env)
        self.assertFalse(os.path.exists(agents))
        self.assertFalse(os.path.exists(log))

    # -- Alarm bei ausbleibendem Tick

    def set_last_tick(self, at):
        with self.store_env():
            with store.locked():
                store.set_last_tick(at)

    def tick_alerts(self):
        return [
            row
            for row in self.index()["inbox"]
            if str(row.get("id") or "").startswith("attention:tick:")
        ]

    def test_tick_4_59_min_alt_ist_kein_alarm(self):
        now = 1800000000000
        self.set_last_tick(now - 4 * MINUTE - 59000)
        self.ok("index", env={"FAB_NOW": str(now)})
        self.assertEqual(self.tick_alerts(), [])
        self.assertFalse(self.index()["tick"]["stale"])

    def test_tick_5_01_min_alt_erzeugt_genau_einen_alarm(self):
        now = 1800000000000
        last = now - 5 * MINUTE - 1000
        self.set_last_tick(last)
        self.ok("index", env={"FAB_NOW": str(now)})
        alerts = self.tick_alerts()
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["kind"], "attention")
        self.assertEqual(alerts[0]["since"], last)
        self.assertIn("fab tick", alerts[0]["text"])

        self.ok("inbox", env={"FAB_NOW": str(now)})
        self.assertEqual(len(self.tick_alerts()), 1)

    def test_neuer_tick_loescht_den_alarm(self):
        now = 1800000000000
        self.set_last_tick(now - 6 * MINUTE)
        self.ok("index", env={"FAB_NOW": str(now)})
        self.assertEqual(len(self.tick_alerts()), 1)

        self.ok("tick", env={"FAB_NOW": str(now)})
        self.ok("index", env={"FAB_NOW": str(now)})
        self.assertEqual(self.tick_alerts(), [])
        self.assertFalse(self.index()["tick"]["stale"])
        self.assertEqual(self.meta("last_tick"), str(now))
