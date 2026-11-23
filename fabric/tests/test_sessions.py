"""Beendete Agenten-Sessions: Ereignis, Sofort-Meldung, Dispatch, Anzeige."""
import unittest

from fabric.tests.support import FabricCase

MINUTE = 60 * 1000


class SessionEndTests(FabricCase):
    def now(self):
        from fabric.fablib import store

        with self.store_env():
            return store.now_ms()

    def doing_ticket(self, status="doing", started=None):
        result = self.ok(
            "new", "Testticket", "--repo", self.default_repo(), "--no-wake"
        )
        tid = result.stdout.strip().splitlines()[-1]
        name = f"fab-herdr-app-zap-{tid.lower()}"
        self.patch_ticket(
            tid,
            status=status,
            assignee="zap",
            worktree=self.tmp,
            sessions=[
                {
                    "agent": "zap",
                    "name": name,
                    "terminal": "t5",
                    "started_at": started if started is not None else self.now(),
                }
            ],
        )
        return tid, name

    def finished(
        self, name, address="t5", code=0, reason="exit", at=None, text=""
    ):
        self.set_terminals(
            [
                {
                    "address": address,
                    "name": name,
                    "state": "finished",
                    "exit_code": code,
                    "reason": reason,
                }
            ]
        )
        self.set_gets(
            {
                address: {
                    "state": "finished",
                    "exit_code": code,
                    "reason": reason,
                    "finished_ms": at if at is not None else self.now(),
                }
            }
        )
        self.set_reads({address: text})

    def ended_events(self, mark=0):
        return self.events_since(mark, "session_ended")

    def attention(self):
        return [
            row for row in self.index()["inbox"] if row["kind"] == "attention"
        ]

    # -- Erkennung

    def test_exit_null_beendet_session_und_schreibt_ereignis(self):
        tid, name = self.doing_ticket()
        self.finished(name, code=0, text="fertig\nletzte Zeile\n")
        mark = self.mark()

        result = self.ok("tick")

        self.assertIn(f"{tid}: Session {name} beendet", result.stdout)
        rows = self.ended_events(mark)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["ticket"], tid)
        self.assertEqual(rows[0]["target"], name)
        self.assertIn("Exit 0", rows[0]["reason"])
        self.assertIn("Ende ", rows[0]["reason"])
        self.assertIn("letzte Zeile", rows[0]["text"])

        attention = self.attention()
        self.assertEqual(len(attention), 1)
        self.assertIn("beendet:", attention[0]["text"])
        self.assertIn("Exit 0", attention[0]["text"])
        stall = self.ticket(tid)["stall"]
        self.assertEqual(stall["rule"], "doing")
        self.assertTrue(stall["attention"])
        self.assertIn("beendet:", stall["reason"])

        shown = self.ok("show", tid).stdout
        self.assertIn("## Beendete Sessions", shown)
        self.assertIn(name, shown)
        self.assertIn("Exit 0", shown)
        self.assertIn("letzte Zeile", shown)

    def test_absturz_mit_exitcode_und_grund(self):
        tid, name = self.doing_ticket()
        self.finished(name, code=129, reason="killed")
        mark = self.mark()

        self.ok("tick")

        rows = self.ended_events(mark)
        self.assertEqual(len(rows), 1)
        self.assertIn("Exit 129", rows[0]["reason"])
        self.assertIn("Grund killed", rows[0]["reason"])

    def test_fehlstart_session_nie_sichtbar(self):
        tid, name = self.doing_ticket()
        self.set_terminals([])
        mark = self.mark()

        result = self.ok("tick")

        self.assertIn("Fehlstart", result.stdout)
        rows = self.ended_events(mark)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["target"], name)
        self.assertIn("Fehlstart: Session nie sichtbar", rows[0]["reason"])
        self.assertEqual(self.hc_calls("get"), [])
        self.assertEqual(self.hc_calls("read"), [])
        self.assertIn("beendet:", self.attention()[0]["text"])

    def test_seen_live_dann_verschwunden_wird_als_beendet_gemeldet(self):
        tid, name = self.doing_ticket()
        self.set_terminals(
            [{"address": "t5", "name": name, "state": "live", "status": "working"}]
        )
        self.ok("tick")
        self.assertTrue(self.ticket(tid)["sessions"][0]["seen_live"])

        self.set_terminals([])
        mark = self.mark()
        self.clear_log()
        result = self.ok("tick")

        self.assertIn("beendet:", result.stdout)
        rows = self.ended_events(mark)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["target"], name)
        self.assertIn("Verschwunden ohne Abschlusszeile", rows[0]["reason"])
        self.assertNotIn("Fehlstart", rows[0]["reason"])
        self.assertIsInstance(self.ticket(tid)["sessions"][0].get("ended"), dict)
        attention = self.attention()
        self.assertEqual(len(attention), 1)
        self.assertIn("beendet:", attention[0]["text"])
        self.assertEqual(self.hc_calls("get"), [])
        self.assertEqual(self.hc_calls("read"), [])

        mark = self.mark()
        self.ok("tick")
        self.assertEqual(self.ended_events(mark), [])

    def test_zweiter_tick_schreibt_kein_zweites_ereignis(self):
        tid, name = self.doing_ticket()
        self.finished(name)
        self.ok("tick")
        mark = self.mark()

        self.ok("tick")

        self.assertEqual(self.ended_events(mark), [])

    def test_dry_run_schreibt_nichts(self):
        tid, name = self.doing_ticket()
        self.finished(name)
        mark = self.mark()

        result = self.ok("tick", "--dry-run")

        self.assertIn("geplant: session_ended", result.stdout)
        self.assertEqual(self.ended_events(mark), [])
        self.assertIsNone(self.ticket(tid)["sessions"][0].get("ended"))

    def test_letzte_zeilen_sind_begrenzt_und_genannt(self):
        tid, name = self.doing_ticket()
        text = "\n".join(f"zeile-{index:02d}" for index in range(40))
        self.finished(name, text=text)
        mark = self.mark()

        self.ok("tick")

        body = self.ended_events(mark)[0]["text"]
        self.assertNotIn("zeile-00", body)
        self.assertIn("zeile-39", body)
        self.assertIn("gekürzt: hc read", body)

    # -- Dispatch

    def test_dispatch_startet_bei_beendeter_session_neu(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Kurzer Titel")
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok(
            "edit", tid, "--repo", repo,
            "--body", "## Ziel\nEtwas.\n\n## Abnahmekriterien\n- [ ] es läuft\n",
            "--from", "mensch",
        )
        self.set_live({})
        self.ok("dispatch", tid, "--from", "mensch")
        name = self.ticket(tid)["sessions"][0]["name"]
        self.finished(name, address="t900", code=0)
        mark = self.mark()

        self.clear_log()
        result = self.ok("dispatch", tid, "--from", "mensch")

        self.assertIn("verteilt", result.stdout)
        self.assertNotIn("lief schon", result.stdout)
        self.assertEqual(len(self.hc_calls("run")), 1)
        rows = self.ended_events(mark)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["target"], name)
        ticket = self.ticket(tid)
        self.assertEqual(len(ticket["sessions"]), 1)
        self.assertNotIn("ended", ticket["sessions"][0])


class ClipTests(unittest.TestCase):
    def test_nennt_nur_zeilen_wenn_nur_zeilen_gekuerzt(self):
        from fabric.fablib.sessions import _clip

        text = "\n".join(f"z{index:02d}" for index in range(40))

        out = _clip(text)

        self.assertIn("letzte 20 Zeilen", out)
        self.assertNotIn("Zeichen", out)
        self.assertIn("z39", out)
        self.assertNotIn("z00", out)

    def test_nennt_nur_zeichen_wenn_nur_zeichen_gekuerzt(self):
        from fabric.fablib.sessions import _clip

        out = _clip("a" * 1500 + "\n" + "b" * 1500)

        self.assertIn("letzte 2000 Zeichen", out)
        self.assertNotIn("Zeilen", out)
        first = out.splitlines()[0]
        self.assertLess(len(first), 1500)
        self.assertEqual(len(first), 499)

    def test_nennt_zeilen_und_zeichen_wenn_beides_gekuerzt(self):
        from fabric.fablib.sessions import _clip

        text = "\n".join("x" * 120 for _ in range(30))

        out = _clip(text)

        self.assertIn("letzte 20 Zeilen", out)
        self.assertIn("letzte 2000 Zeichen", out)
