"""Dispatch: Vorbedingungen, Branch und Worktree, Start statt Wecken."""
import os

from fabric.tests.support import FabricCase

BODY = "## Ziel\nEtwas.\n\n## Abnahmekriterien\n- [ ] es läuft\n"


class DispatchTests(FabricCase):
    def label(self, args, key):
        prefix = key + "="
        return next(part[len(prefix):] for part in args if part.startswith(prefix))

    def prepared_ticket(self, repo, title="Kurzer Titel"):
        self.own_repo(repo)
        tid = self.new(title)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("edit", tid, "--repo", repo, "--body", BODY, "--from", "mensch")
        return tid

    def test_dispatch_verlangt_repo(self):
        tid = self.new("Ohne Repo")
        self.patch_ticket(tid, repo=None)
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("kein Agent", result.stderr)
        self.ok("assign", tid, "zap", "--from", "mensch")
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("kein Repo", result.stderr)

    def test_dispatch_verlangt_abnahmekriterien(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Ohne Kriterien")
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("edit", tid, "--repo", repo, "--body", "## Ziel\nNur ein Ziel.\n",
                "--from", "mensch")
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Abnahmekriterien", result.stderr)
        self.assertIsNone(self.ticket(tid)["worktree"])

    def test_dispatch_verlangt_freie_blocker(self):
        repo = self.make_repo()
        first = self.prepared_ticket(repo, "Erstes")
        second = self.new("Zweites")
        self.ok("assign", second, "zap", "--from", "mensch")
        self.ok("edit", second, "--repo", repo, "--body", BODY, "--from", "mensch")
        self.ok("link", second, "--blocked-by", first, "--from", "mensch")
        result = self.cli("dispatch", second, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"blockiert durch {first}", result.stderr)

    def test_dispatch_legt_branch_und_worktree_an(self):
        repo = self.make_repo()
        base_head = self.git_out(repo, "rev-parse", "HEAD")
        tid = self.prepared_ticket(repo)
        self.set_live({})
        self.clear_log()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("verteilt", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(ticket["assignee"], "zap")
        self.assertEqual(ticket["base"], "main")
        self.assertEqual(ticket["branch"], "fab/T-1-kurzer-titel")
        expected = os.path.join(
            self.fake_home, ".herdr", "worktrees", "repo", "fab-T-1-kurzer-titel"
        )
        self.assertEqual(ticket["worktree"], expected)
        self.assertTrue(os.path.isdir(expected))
        self.assertEqual(
            self.git_out(expected, "rev-parse", "--abbrev-ref", "HEAD"),
            "fab/T-1-kurzer-titel",
        )
        self.assertEqual(self.git_out(expected, "rev-parse", "HEAD"), base_head)
        self.assertEqual(len(ticket["sessions"]), 1)
        self.assertEqual(ticket["sessions"][0]["terminal"], "t900")
        runs = self.hc_calls("run")
        self.assertEqual(len(runs), 1)
        args = runs[0]
        self.assertEqual(args[args.index("--name") + 1], "fab-herdr-app-zap-t-1")
        self.assertEqual(args[args.index("--cwd") + 1], expected)
        self.assertIn("fab.agent=zap", args)
        self.assertIn(f"fab.ticket={tid}", args)
        self.assertIn("--no-parent", args)
        self.assertIn("--outlive-parent", args)
        dispatched = [row for row in self.events() if row["kind"] == "dispatch"]
        self.assertEqual(len(dispatched), 1)
        self.assertEqual(dispatched[0]["target"], "zap")

    def test_dispatch_gibt_dem_agenten_einen_tab_im_fabric_space(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.set_live({})
        self.clear_log()
        self.clear_herdr_log()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertNotIn("Seitenleiste", result.stdout)
        args = self.hc_calls("run")[0]
        self.assertEqual(self.label(args, "herdr.space"), "sp-fabric")
        tab = self.label(args, "herdr.tab")
        self.assertTrue(tab.startswith("tb"))
        renames = [
            call for call in self.herdr_calls("do")
            if call[1:2] == ["tab.rename"]
        ]
        self.assertEqual(len(renames), 1)
        self.assertEqual(renames[0][renames[0].index("--id") + 1], tab)
        self.assertEqual(renames[0][renames[0].index("--name") + 1], tid)
        # Kein Fokuswechsel: nur lesen und benennen, nichts anlegen oder zeigen.
        self.assertEqual(
            {call[1] for call in self.herdr_calls("do")},
            {"tab.rename"},
        )
        self.assertFalse(any("--focus" in call for call in self.herdr_calls()))

    def test_erster_agent_legt_den_fabric_space_an(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.set_live({})
        self.set_spaces([])
        self.clear_log()
        self.clear_herdr_log()
        self.ok("dispatch", tid, "--from", "mensch")
        args = self.hc_calls("run")[0]
        space = self.label(args, "herdr.space")
        self.assertTrue(space.startswith("sp"))
        tab = self.label(args, "herdr.tab")
        renames = {
            call[1]: call for call in self.herdr_calls("do")
        }
        self.assertEqual(renames["space.rename"][-1], "Fabric")
        self.assertEqual(
            renames["space.rename"][renames["space.rename"].index("--id") + 1],
            space,
        )
        self.assertEqual(renames["tab.rename"][-1], tid)
        self.assertEqual(
            renames["tab.rename"][renames["tab.rename"].index("--id") + 1], tab
        )
        self.assertEqual(self.meta("herdr_space"), space)

    def test_dispatch_ohne_herdr_fenster_startet_agenten_trotzdem(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.set_live({})
        self.clear_log()
        result = self.ok(
            "dispatch", tid, "--from", "mensch", env={"HERDR_APP_FAIL": "1"}
        )
        self.assertIn("verteilt", result.stdout)
        self.assertIn("Herdr-Seitenleiste", result.stdout)
        self.assertIn("kein Fenster", result.stdout)
        args = self.hc_calls("run")[0]
        self.assertIn("fab.agent=zap", args)
        self.assertFalse(any(part.startswith("herdr.") for part in args))
        self.assertEqual(self.ticket(tid)["sessions"][0]["terminal"], "t900")
        dispatched = [row for row in self.events() if row["kind"] == "dispatch"]
        self.assertIn("Herdr-Seitenleiste", dispatched[-1]["text"])

    def test_laufender_agent_wird_geweckt_statt_gestartet(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.ok("dispatch", tid, "--from", "mensch")
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        self.clear_herdr_log()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("läuft schon", result.stdout)
        self.assertEqual(self.hc_calls("run"), [])
        self.assertEqual(self.herdr_calls(), [])
        sends = self.hc_calls("send")
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0][1], "t7")

    def test_max_sessions_verhindert_dispatch(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.set_live(
            {
                "fab-ada-t-1": "t1",
                "fab-ada-t-2": "t2",
                "fab-ada-t-3": "t3",
                "fab-ada-t-4": "t4",
            }
        )
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unterdrückt: voll", result.stderr)
        self.assertIsNone(self.ticket(tid)["worktree"])

    def test_max_sessions_ignoriert_untätige_sessions(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.write_roster(max_sessions=2)
        self.set_terminals(
            [
                {"address": "t1", "name": "fab-ada-t-1", "state": "live",
                 "status": "working"},
                {"address": "t2", "name": "fab-ada-t-2", "state": "live",
                 "status": "idle"},
            ]
        )
        self.clear_log()
        self.ok("dispatch", tid, "--from", "mensch")
        self.assertEqual(len(self.hc_calls("run")), 1)
        self.assertEqual(self.ticket(tid)["status"], "doing")

    def test_max_sessions_ignoriert_sessions_abgeschlossener_tickets(self):
        repo = self.make_repo()
        old = self.new("Alt")
        self.patch_ticket(
            old,
            status="done",
            sessions=[
                {"agent": "ada", "name": "fab-ada-t-1", "terminal": "t1",
                 "started_at": 1}
            ],
        )
        tid = self.prepared_ticket(repo)
        self.write_roster(max_sessions=1)
        self.set_terminals(
            [
                {"address": "t1", "name": "fab-ada-t-1", "state": "live",
                 "status": "working"},
            ]
        )
        self.clear_log()
        self.ok("dispatch", tid, "--from", "mensch")
        self.assertEqual(len(self.hc_calls("run")), 1)
        self.assertEqual(self.ticket(tid)["status"], "doing")

    def test_max_sessions_wartende_sessions_sind_aktiv(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        self.write_roster(max_sessions=2)
        self.set_terminals(
            [
                {"address": "t1", "name": "fab-ada-t-1", "state": "live",
                 "status": "working"},
                {"address": "t2", "name": "fab-ada-t-2", "state": "live",
                 "status": "blocked"},
            ]
        )
        result = self.cli("dispatch", tid, "--from", "mensch")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unterdrückt: voll", result.stderr)
        self.assertIsNone(self.ticket(tid)["worktree"])

    def test_dispatch_meldet_startfehler_und_behaelt_worktree(self):
        repo = self.make_repo()
        tid = self.prepared_ticket(repo)
        result = self.cli("dispatch", tid, "--from", "mensch", env={"HC_RUN_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht gestartet", result.stderr)
        ticket = self.ticket(tid)
        self.assertTrue(os.path.isdir(ticket["worktree"]))
        self.assertEqual(ticket["status"], "draft")
        self.assertEqual(ticket["sessions"], [])
        # Ein zweiter Versuch benutzt Worktree und Branch weiter.
        self.ok("dispatch", tid, "--from", "mensch")
        self.assertEqual(self.ticket(tid)["status"], "doing")
        self.assertEqual(len(self.ticket(tid)["sessions"]), 1)


class AutostartTests(FabricCase):
    """Nach accept oder dem letzten link --remove startet fab frei gewordene Tickets."""

    def ready(self, repo, title, blockers=(), status="todo", body=BODY):
        tid = self.new(title)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("edit", tid, "--repo", repo, "--body", body, "--from", "mensch")
        if status:
            self.ok("status", tid, status, "--from", "mensch")
        if blockers:
            self.ok("link", tid, "--blocked-by", *blockers, "--from", "mensch")
        return tid

    def review_ticket(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        return repo, tid

    def test_accept_startet_das_entblockte_ticket(self):
        repo, blocker = self.review_ticket()
        follow = self.ready(repo, "Danach", blockers=[blocker])
        self.clear_log()
        result = self.ok("accept", blocker)
        self.assertIn(follow, result.stdout)
        self.assertIn("automatisch", result.stdout)
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "doing")
        self.assertEqual(ticket["branch"], f"fab/{follow}-danach")
        self.assertTrue(os.path.isdir(ticket["worktree"]))
        self.assertEqual(len(ticket["sessions"]), 1)
        dispatched = [
            row for row in self.events()
            if row["kind"] == "dispatch" and row["ticket"] == follow
        ]
        self.assertEqual(dispatched[-1]["target"], "zap")

    def test_weiterer_offener_blocker_verhindert_den_start(self):
        repo, blocker = self.review_ticket()
        other = self.new("Noch offen")
        follow = self.ready(repo, "Danach", blockers=[blocker, other])
        result = self.ok("accept", blocker)
        self.assertNotIn("Danach", result.stdout)
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "todo")
        self.assertIsNone(ticket["worktree"])
        self.assertFalse([
            row for row in self.events()
            if row["kind"] == "dispatch" and row["ticket"] == follow
        ])

    def test_draft_und_unvollstaendige_tickets_bleiben_liegen(self):
        repo, blocker = self.review_ticket()
        draft = self.ready(repo, "Entwurf", blockers=[blocker], status="draft")
        no_agent = self.new("Ohne Agent")
        self.ok("edit", no_agent, "--repo", repo, "--body", BODY, "--from", "mensch")
        self.ok("status", no_agent, "todo", "--from", "mensch")
        self.ok("link", no_agent, "--blocked-by", blocker, "--from", "mensch")
        no_repo = self.new("Ohne Repo")
        self.ok("assign", no_repo, "zap", "--from", "mensch")
        self.ok("edit", no_repo, "--body", BODY, "--from", "mensch")
        self.ok("status", no_repo, "todo", "--from", "mensch")
        self.ok("link", no_repo, "--blocked-by", blocker, "--from", "mensch")
        self.patch_ticket(no_repo, repo=None)
        no_criteria = self.new("Ohne Kriterien")
        self.ok("assign", no_criteria, "zap", "--from", "mensch")
        self.ok("edit", no_criteria, "--repo", repo,
                "--body", "## Ziel\nNur ein Ziel.\n", "--from", "mensch")
        self.ok("status", no_criteria, "todo", "--from", "mensch")
        self.ok("link", no_criteria, "--blocked-by", blocker, "--from", "mensch")
        mark = self.mark()
        self.ok("accept", blocker)
        expected = {
            draft: "draft",
            no_agent: "todo",
            no_repo: "todo",
            no_criteria: "todo",
        }
        for tid, status in expected.items():
            self.assertEqual(self.ticket(tid)["status"], status)
            self.assertIsNone(self.ticket(tid)["worktree"])
        notes = {
            row["ticket"]: row["text"]
            for row in self.events_since(mark, "dispatch")
        }
        self.assertIn("Status draft", notes[draft])
        self.assertIn("kein Zuständiger", notes[no_agent])
        self.assertIn("kein Repo", notes[no_repo])
        self.assertIn("keine Abnahmekriterien", notes[no_criteria])

    def test_voller_platz_bricht_die_abnahme_nicht_ab(self):
        repo, blocker = self.review_ticket()
        follow = self.ready(repo, "Danach", blockers=[blocker])
        self.write_roster(max_sessions=1)
        self.set_terminals([
            {"address": "t1", "name": "fab-ada-t-1", "state": "live",
             "status": "working"},
        ])
        mark = self.mark()
        result = self.ok("accept", blocker)
        self.assertIn("angenommen", result.stdout)
        self.assertIn("unterdrückt: voll", result.stderr)
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "todo")
        self.assertIsNone(ticket["worktree"])
        notes = [
            row["text"] for row in self.events_since(mark, "dispatch")
            if row["ticket"] == follow
        ]
        self.assertTrue(any("unterdrückt: voll" in text for text in notes))

    def test_startfehler_bricht_die_abnahme_nicht_ab(self):
        repo, blocker = self.review_ticket()
        follow = self.ready(repo, "Danach", blockers=[blocker])
        mark = self.mark()
        result = self.ok("accept", blocker, env={"HC_RUN_FAIL": "1"})
        self.assertIn("angenommen", result.stdout)
        self.assertIn("nicht gestartet", result.stderr)
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "todo")
        self.assertTrue(os.path.isdir(ticket["worktree"]))
        notes = [
            row["text"] for row in self.events_since(mark, "dispatch")
            if row["ticket"] == follow
        ]
        self.assertTrue(any("nicht gestartet" in text for text in notes))

    def test_link_remove_startet_nach_der_letzten_blockade(self):
        repo = self.default_repo()
        blocker = self.new("Blocker")
        follow = self.ready(repo, "Frei", blockers=[blocker])
        self.ok("link", follow, "--remove", blocker, "--from", "mensch")
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "doing")
        self.assertTrue(os.path.isdir(ticket["worktree"]))

    def test_link_remove_startet_trotz_erledigtem_blocker_im_blocked_by(self):
        repo, blocker = self.review_ticket()
        other = self.new("Noch offen")
        follow = self.ready(repo, "Frei", blockers=[blocker, other])
        self.ok("accept", blocker)
        self.assertEqual(self.ticket(follow)["status"], "todo")
        self.assertIsNone(self.ticket(follow)["worktree"])
        self.ok("link", follow, "--remove", other, "--from", "mensch")
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "doing")
        self.assertTrue(os.path.isdir(ticket["worktree"]))

    def test_link_remove_mit_weiterem_blocker_startet_nicht(self):
        repo = self.default_repo()
        first = self.new("Erster")
        second = self.new("Zweiter")
        follow = self.ready(repo, "Frei", blockers=[first, second])
        self.ok("link", follow, "--remove", first, "--from", "mensch")
        ticket = self.ticket(follow)
        self.assertEqual(ticket["status"], "todo")
        self.assertIsNone(ticket["worktree"])
