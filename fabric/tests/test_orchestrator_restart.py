"""Neustart des Team-Orchestrators: Zähler, Leerlauf, Sperre (T-31)."""
import json
import time

from fabric.tests.support import FabricCase

MINUTE = 60 * 1000
ORCHESTRATOR = "fab-herdr-app-orchestrator"


class OrchestratorRestartCase(FabricCase):
    def now(self):
        return int(time.time() * 1000)

    def ticket_id(self):
        return self.ok(
            "new", "Testticket", "--repo", self.default_repo(), "--no-wake"
        ).stdout.strip().splitlines()[-1]

    def set_orchestrator(self, status="done", address="t0"):
        self.set_terminals(
            [{"address": address, "name": ORCHESTRATOR, "state": "live",
              "status": status}]
        )

    def dispatch_events(self, tid, count, at=None):
        at = self.now() if at is None else at
        self.add_events(
            [
                {"at": at, "kind": "dispatch", "ticket": tid,
                 "actor": "orchestrator", "target": "zap",
                 "text": f"fab/{tid}-test · /tmp/wt"}
                for _ in range(count)
            ]
        )

    def roster_json(self):
        with open(self.roster, encoding="utf-8") as handle:
            return json.load(handle)

    def calls(self):
        return [row[0] for row in self.hc_calls()]

    # -- Zähler

    def test_zaehler_startet_beim_wecken_neu(self):
        tid = self.ticket_id()
        self.set_orchestrator()
        self.dispatch_events(tid, 5)
        self.clear_log()
        mark = self.mark()
        result = self.ok("comment", tid, "--from", "zap", "@orchestrator bitte")
        self.assertIn("gestartet", result.stdout)
        calls = self.calls()
        self.assertIn("kill", calls)
        self.assertIn("run", calls)
        self.assertLess(calls.index("kill"), calls.index("run"))
        self.assertEqual(len(self.hc_calls("run")), 1)
        # Die Weckernachricht geht an die neue Session, nicht an das alte Terminal.
        sends = self.hc_calls("send")
        self.assertEqual(sends[0][1], "t900")
        restarts = self.events_since(mark, "orchestrator")
        self.assertEqual(len(restarts), 1)
        self.assertEqual(restarts[0]["text"], "neu gestartet")
        self.assertIn("Zähler", restarts[0]["reason"])

    def test_zaehler_unter_schwelle_weckt_normal(self):
        tid = self.ticket_id()
        self.set_orchestrator()
        self.dispatch_events(tid, 4)
        self.clear_log()
        result = self.ok("comment", tid, "--from", "zap", "@orchestrator bitte")
        self.assertIn("geweckt", result.stdout)
        self.assertEqual(self.hc_calls("kill"), [])
        self.assertEqual(self.hc_calls("run"), [])
        self.assertEqual(self.hc_calls("send")[0][1], "t0")

    def test_einstellung_dispatches_je_team(self):
        self.ok(
            "settings", "set", "orchestrator_dispatches", "2", "--from", "mensch"
        )
        team = self.roster_json()["teams"][0]
        self.assertEqual(team["orchestrator"]["dispatches"], 2)

        tid = self.ticket_id()
        self.set_orchestrator()
        self.dispatch_events(tid, 2)
        self.clear_log()
        result = self.ok("comment", tid, "--from", "zap", "@orchestrator bitte")
        self.assertIn("gestartet", result.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)

        self.ok(
            "settings", "set", "orchestrator_dispatches", "1",
            "--team", "herdr-app", "--from", "mensch",
        )
        self.assertEqual(
            self.roster_json()["teams"][0]["orchestrator"]["dispatches"], 1
        )
        result = self.cli(
            "settings", "set", "orchestrator_dispatches", "1",
            "--team", "fehlt", "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        result = self.cli(
            "settings", "set", "max_sessions", "3",
            "--team", "herdr-app", "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--team", result.stderr)
        result = self.cli(
            "settings", "set", "orchestrator_dispatches", "101",
            "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)

    def test_zaehler_null_schaltet_ab(self):
        self.ok(
            "settings", "set", "orchestrator_dispatches", "0", "--from", "mensch"
        )
        tid = self.ticket_id()
        self.set_orchestrator()
        self.dispatch_events(tid, 5)
        self.clear_log()
        result = self.ok("comment", tid, "--from", "zap", "@orchestrator bitte")
        self.assertIn("geweckt", result.stdout)
        self.assertEqual(self.hc_calls("kill"), [])

    # -- Leerlauf

    def test_leerlauf_startet_tick_neu(self):
        tid = self.ticket_id()
        self.set_orchestrator()
        self.add_events(
            [{"at": self.now() - 31 * MINUTE, "kind": "comment", "ticket": tid,
              "actor": "orchestrator", "target": "", "text": "Stand"}]
        )
        self.clear_log()
        mark = self.mark()
        result = self.ok("tick")
        self.assertIn("Orchestrator neu gestartet", result.stdout)
        self.assertEqual(self.calls().count("run"), 1)
        restarts = self.events_since(mark, "orchestrator")
        self.assertEqual(len(restarts), 1)
        self.assertIn("Leerlauf", restarts[0]["reason"])

    def test_leerlauf_schwelle_aus_einstellungen(self):
        self.ok(
            "settings", "set", "orchestrator_idle_minutes", "10",
            "--from", "mensch",
        )
        self.assertEqual(
            self.roster_json()["teams"][0]["orchestrator"]["idle_minutes"], 10
        )
        tid = self.ticket_id()
        self.set_orchestrator()
        self.add_events(
            [{"at": self.now() - 9 * MINUTE, "kind": "comment", "ticket": tid,
              "actor": "orchestrator", "target": "", "text": "Stand"}]
        )
        self.assertIn("Keine Aktion.", self.ok("tick").stdout)

        self.clear_events()
        self.add_events(
            [{"at": self.now() - 11 * MINUTE, "kind": "comment", "ticket": tid,
              "actor": "orchestrator", "target": "", "text": "Stand"}]
        )
        result = self.ok("tick")
        self.assertIn("Orchestrator neu gestartet", result.stdout)

    def test_wartendes_ticket_sperrt_leerlauf(self):
        tid = self.ticket_id()
        self.ok(
            "comment", tid, "--from", "mensch", "--no-wake",
            "@orchestrator bitte ausformulieren",
        )
        self.set_orchestrator()
        self.add_events(
            [{"at": self.now() - 31 * MINUTE, "kind": "comment", "ticket": tid,
              "actor": "orchestrator", "target": "", "text": "Stand"}]
        )
        self.clear_log()
        result = self.ok("tick")
        self.assertIn("Orchestrator bleibt", result.stdout)
        self.assertIn(tid, result.stdout)
        self.assertEqual(self.hc_calls("kill"), [])
        self.assertEqual(self.hc_calls("run"), [])

    def test_beschaeftigter_orchestrator_wird_nicht_gestartet(self):
        tid = self.ticket_id()
        self.set_orchestrator(status="working")
        self.add_events(
            [{"at": self.now() - 60 * MINUTE, "kind": "comment", "ticket": tid,
              "actor": "orchestrator", "target": "", "text": "Stand"}]
        )
        self.clear_log()
        self.assertIn("Keine Aktion.", self.ok("tick").stdout)
        self.assertEqual(self.hc_calls("kill"), [])

    def test_frische_ausgabe_verhindert_neustart(self):
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_gets({"t0": {"status_ms": self.now(), "created_ms": 1}})
        self.add_events(
            [{"at": self.now() - 31 * MINUTE, "kind": "comment", "ticket": tid,
              "actor": "orchestrator", "target": "", "text": "Stand"}]
        )
        self.clear_log()
        self.assertIn("Keine Aktion.", self.ok("tick").stdout)
        self.assertEqual(self.hc_calls("kill"), [])
