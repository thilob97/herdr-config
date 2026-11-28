"""Neustart des Team-Orchestrators: Zähler, Leerlauf, Sperre (T-31)."""
import json

from fabric.fablib import store
from fabric.tests.support import FabricCase

MINUTE = 60 * 1000
ORCHESTRATOR = "fab-herdr-app-orchestrator"
TEAM = "herdr-app"


class OrchestratorRestartCase(FabricCase):
    def now(self):
        return store.now_ms()

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
        from fabric.fablib import store

        with self.store_env():
            return json.loads(store.config_get(store.ROSTER_CONFIG_KEY) or "{}")

    def calls(self):
        return [row[0] for row in self.hc_calls()]

    def set_last_tick(self, at):
        with self.store_env():
            with store.locked():
                store.set_last_tick(at)

    def orchestrator_comment(self, tid, at, text="Stand"):
        """Ein fab-Aufruf des Orchestrators zu einem festen Zeitpunkt."""
        self.add_events(
            [{"at": at, "kind": "comment", "ticket": tid,
              "actor": "orchestrator", "target": "", "text": text}]
        )

    def start_state(self):
        raw = self.meta(f"orchestrator_start:{TEAM}")
        return json.loads(raw) if raw else None

    def assert_no_attention(self, now):
        result = self.ok("inbox", env={"FAB_NOW": str(now)})
        self.assertNotIn("Start ohne Antwort", result.stdout)

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

    # -- Start ohne Antwort und Schlafzeit (T-126)

    def test_schlafluecke_startet_nicht_neu_und_zaehlt_neu(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        # Der Orchestrator war während der Schlafzeit aktiv: Die Lücke
        # zwischen letztem Tick und Aktivität ist kein Leerlauf.
        self.set_last_tick(now - 3 * 60 * MINUTE)
        self.orchestrator_comment(tid, now - 2 * 60 * MINUTE)
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertIn("Schlafzeit", result.stdout)
        self.assertNotIn("neu gestartet", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])

        # Der nächste Lauf zählt ab dem Reset neu: kein alter Leerlauf.
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(now + MINUTE)})
        self.assertNotIn("neu gestartet", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])

    def test_ohne_schlafluecke_leerlauf_startet_weiter(self):
        """Bestehendes Verhalten: Aktivität vor dem letzten Tick bleibt Leerlauf."""
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertIn("Orchestrator neu gestartet", result.stdout)
        self.assertNotIn("Schlafzeit", result.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)
        # Der Neustart merkt sich seinen ersten Versuch für die Turn-Prüfung.
        state = self.start_state()
        self.assertEqual(state["attempt"], 1)
        self.assertEqual(state["state"], "pending")

    def test_zweiter_versuch_nach_frist_genau_einmal(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.clear_log()
        first = self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertIn("Orchestrator neu gestartet", first.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)
        state = self.start_state()
        self.assertEqual(state["attempt"], 1)
        self.assertEqual(state["state"], "pending")

        # Vor der Frist bleibt der zweite Start aus.
        self.clear_log()
        early = self.ok("tick", env={"FAB_NOW": str(now + 4 * MINUTE)})
        self.assertNotIn("neu gestartet", early.stdout)
        self.assertEqual(self.hc_calls("run"), [])

        # Nach der Frist genau ein zweiter Versuch, noch kein Alarm.
        self.clear_log()
        mark = self.mark()
        late = self.ok("tick", env={"FAB_NOW": str(now + 6 * MINUTE)})
        self.assertIn("Orchestrator neu gestartet", late.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)
        restarts = self.events_since(mark, "orchestrator")
        self.assertEqual(len(restarts), 1)
        self.assertIn("zweiter Versuch", restarts[0]["reason"])
        state = self.start_state()
        self.assertEqual(state["attempt"], 2)
        self.assertEqual(state["state"], "pending")
        self.assert_no_attention(now + 6 * MINUTE)

    def test_schlafluecke_nach_neustart_verlaengert_startfrist(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertEqual(len(self.hc_calls("run")), 1)
        self.assertEqual(self.start_state()["at"], now)

        # Schläft der Rechner direkt nach dem Neustart, beginnt die Frist
        # beim Aufwachen neu: kein zweiter Versuch, keine Meldung.
        wake = now + 60 * MINUTE
        self.set_last_tick(now)
        self.clear_log()
        mark = self.mark()
        result = self.ok("tick", env={"FAB_NOW": str(wake)})
        self.assertIn("Startfrist beginnt neu", result.stdout)
        self.assertNotIn("neu gestartet", result.stdout)
        self.assertNotIn("Start ohne Antwort", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        state = self.start_state()
        self.assertEqual(state["state"], "pending")
        self.assertEqual(state["attempt"], 1)
        self.assertEqual(state["at"], wake)
        self.assertEqual(self.events_since(mark, "orchestrator"), [])
        self.assert_no_attention(wake)

    def test_nach_schlafluecke_greift_zweiter_versuch_wieder(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        wake = now + 60 * MINUTE
        self.set_last_tick(now)
        self.ok("tick", env={"FAB_NOW": str(wake)})

        # Ohne neue Schlaflücke greift ab dem Aufwachen wieder der bisherige
        # zweite Versuch nach abgelaufener Frist.
        self.clear_log()
        mark = self.mark()
        late = self.ok("tick", env={"FAB_NOW": str(wake + 6 * MINUTE)})
        self.assertIn("Orchestrator neu gestartet", late.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)
        restarts = self.events_since(mark, "orchestrator")
        self.assertEqual(len(restarts), 1)
        self.assertIn("zweiter Versuch", restarts[0]["reason"])
        state = self.start_state()
        self.assertEqual(state["state"], "pending")
        self.assertEqual(state["attempt"], 2)
        self.assert_no_attention(wake + 6 * MINUTE)

    def test_zweiter_versuch_ohne_antwort_meldet_attention(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.ok("tick", env={"FAB_NOW": str(now + 6 * MINUTE)})
        self.assertEqual(len(self.hc_calls("run")), 2)

        # Zwei Versuche ohne Turn: einmal melden, nicht erneut starten.
        self.clear_log()
        mark = self.mark()
        failed = self.ok("tick", env={"FAB_NOW": str(now + 12 * MINUTE)})
        self.assertIn("Start ohne Antwort", failed.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        state = self.start_state()
        self.assertEqual(state["state"], "failed")
        self.assertIn("failed_at", state)
        reported = self.events_since(mark, "orchestrator")
        self.assertEqual(len(reported), 1)
        self.assertEqual(reported[0]["text"], "Start ohne Antwort")
        self.assertIn("zwei Startversuche", reported[0]["reason"])

        inbox = self.ok("inbox", env={"FAB_NOW": str(now + 12 * MINUTE)})
        self.assertIn("Start ohne Antwort", inbox.stdout)
        status = self.ok(
            "orchestrator", "status", env={"FAB_NOW": str(now + 12 * MINUTE)}
        )
        self.assertIn("Start ohne Antwort", status.stdout)
        self.assertNotIn("idle", status.stdout)

        self.clear_log()
        later = self.ok("tick", env={"FAB_NOW": str(now + 60 * MINUTE)})
        self.assertNotIn("neu gestartet", later.stdout)
        self.assertEqual(self.hc_calls("run"), [])

    def test_antwort_vor_schlafluecke_geht_nicht_verloren(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertEqual(self.start_state()["state"], "pending")
        # Leerlauf abschalten: Der Folgetick darf nur den Startzustand prüfen.
        self.ok(
            "settings", "set", "orchestrator_idle_minutes", "0",
            "--from", "mensch",
        )
        # Antwort kurz nach dem Start, dann Schlaf vor dem nächsten Tick.
        self.orchestrator_comment(tid, now + 2 * MINUTE)
        self.set_last_tick(now + MINUTE)
        wake = now + 60 * MINUTE
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(wake)})
        self.assertIn("antwortet wieder", result.stdout)
        self.assertNotIn("Startfrist beginnt neu", result.stdout)
        self.assertFalse(self.start_state())
        self.assertEqual(self.hc_calls("run"), [])

        # Auch der Folgetick startet nicht neu: Die Antwort bleibt gültig.
        self.clear_log()
        later = self.ok("tick", env={"FAB_NOW": str(wake + 6 * MINUTE)})
        self.assertNotIn("zweiter Versuch", later.stdout)
        self.assertNotIn("Start ohne Antwort", later.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertFalse(self.start_state())
        self.assert_no_attention(wake + 6 * MINUTE)

    def test_antwort_vor_schlafluecke_setzt_leerlauf_zurueck(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertEqual(self.start_state()["state"], "pending")
        # Antwort kurz nach dem Start, dann Schlaf vor dem nächsten Tick.
        self.orchestrator_comment(tid, now + 2 * MINUTE)
        self.set_last_tick(now + MINUTE)
        wake = now + 60 * MINUTE
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(wake)})
        self.assertIn("antwortet wieder", result.stdout)
        self.assertFalse(self.start_state())
        self.assertEqual(self.hc_calls("run"), [])
        # Die Leerlauf-Basis ist der Aufwachzeitpunkt, nicht die alte Antwort.
        self.assertEqual(
            int(self.meta(f"orchestrator_idle_reset:{TEAM}")), wake
        )

        # Der Folgetick zählt erst ab dem Aufwachen: kein Leerlauf-Neustart.
        self.clear_log()
        mark = self.mark()
        later = self.ok("tick", env={"FAB_NOW": str(wake + 5 * MINUTE)})
        self.assertNotIn("Leerlauf", later.stdout)
        self.assertNotIn("neu gestartet", later.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertEqual(self.events_since(mark, "orchestrator"), [])
        self.assert_no_attention(wake + 5 * MINUTE)

    def test_antwort_nach_neustart_verhindert_zweiten_start(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertEqual(len(self.hc_calls("run")), 1)
        self.assertEqual(self.start_state()["state"], "pending")
        # Ein Orchestrator-Ereignis nach dem Start beantwortet den Prompt.
        self.orchestrator_comment(tid, now + 2 * MINUTE)
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(now + 6 * MINUTE)})
        self.assertNotIn("neu gestartet", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertFalse(self.start_state())
        self.assert_no_attention(now + 6 * MINUTE)

    def test_arbeitsstatus_nach_neustart_gilt_als_antwort(self):
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator(status="done")
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertEqual(len(self.hc_calls("run")), 1)
        self.assertEqual(self.start_state()["state"], "pending")
        # Ein Arbeitsstatus der Session zählt ebenfalls als Antwort.
        self.set_terminals(
            [{"address": "t0", "name": ORCHESTRATOR, "state": "live",
              "status": "working"}]
        )
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(now + 6 * MINUTE)})
        self.assertNotIn("neu gestartet", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertFalse(self.start_state())
        self.assert_no_attention(now + 6 * MINUTE)

    # -- Lesedurchlauf ohne Ereignis (T-141)

    def test_lesedurchlauf_ohne_ereignis_gilt_als_antwort(self):
        """Ein fertiger Lesedurchlauf (`done`) ohne fab-Ereignis beantwortet den Start."""
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertEqual(len(self.hc_calls("run")), 1)
        self.assertEqual(self.start_state()["terminal"], "t900")

        # Der Lauf liest nur und schreibt kein Ereignis; sein Terminal meldet
        # danach `done`.
        self.set_terminals(
            [{"address": "t900", "name": ORCHESTRATOR, "state": "live",
              "status": "done"}]
        )
        self.set_gets(
            {"t900": {"turn": 1, "status_ms": now + MINUTE, "created_ms": now}}
        )
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(now + 6 * MINUTE)})
        self.assertIn("antwortet wieder", result.stdout)
        self.assertNotIn("neu gestartet", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertFalse(self.start_state())
        self.assert_no_attention(now + 6 * MINUTE)

    def test_start_ohne_bearbeitung_bleibt_retry_und_fail(self):
        """Startauftrag zugestellt, nie bearbeitet (`idle`, turn 1): keine Antwort."""
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertEqual(self.start_state()["terminal"], "t900")
        # Fall vom 24.11.: ohne Netz lief der Startauftrag nie; hc zählt die
        # Zustellung schon als Turn, der Status bleibt `idle`.
        self.set_terminals(
            [{"address": "t900", "name": ORCHESTRATOR, "state": "live",
              "status": "idle"}]
        )
        self.set_gets(
            {"t900": {"turn": 1, "status": "idle", "status_ms": now,
                      "created_ms": now}}
        )

        self.clear_log()
        retry = self.ok("tick", env={"FAB_NOW": str(now + 6 * MINUTE)})
        self.assertIn("zweiter Versuch", retry.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)

        self.clear_log()
        failed = self.ok("tick", env={"FAB_NOW": str(now + 12 * MINUTE)})
        self.assertIn("Start ohne Antwort", failed.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertEqual(self.start_state()["state"], "failed")

    def test_done_des_alten_terminals_zaehlt_nicht(self):
        """`done` des alten Terminals liegt vor dem Start und zählt nicht."""
        now = self.now()
        tid = self.ticket_id()
        self.set_orchestrator()
        self.set_last_tick(now - MINUTE)
        self.orchestrator_comment(tid, now - 31 * MINUTE)
        self.ok("tick", env={"FAB_NOW": str(now)})
        self.assertEqual(self.start_state()["terminal"], "t900")
        # `hc ls` zeigt noch das alte Terminal t0 mit `done`; das für diesen
        # Versuch gestartete Terminal hat nichts bearbeitet.
        self.set_gets(
            {"t0": {"turn": 5, "status": "done", "status_ms": now + MINUTE,
                    "created_ms": 1},
             "t900": {"turn": 1, "status": "idle"}}
        )
        self.clear_log()
        result = self.ok("tick", env={"FAB_NOW": str(now + 6 * MINUTE)})
        self.assertIn("zweiter Versuch", result.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)
