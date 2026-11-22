"""Lernschleife: Vorschlag, Bestätigung, Verwerfen, Prompts und Wake-Auftrag."""
import os
from unittest import mock

from fabric.fablib import agents
from fabric.tests.support import FabricCase


class LessonTests(FabricCase):
    def review_ticket(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "wert\n")
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.ok("verdict", tid, "pass", "--from", "ada", "Sieht gut aus")
        self.ok("handover", tid, "--from", "zap", "Fertig")
        return repo, tid, worktree

    def test_propose_legt_vorschlag_und_inbox_eintrag_an(self):
        repo = self.make_repo()
        tid = self.new("Lehre", repo=repo)
        result = self.ok(
            "lesson", "propose", tid, "Prüfe zuerst die Tests.", "--from", "ada"
        )
        self.assertIn("L1", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(len(ticket["lesson_proposals"]), 1)
        proposal = ticket["lesson_proposals"][0]
        self.assertEqual(proposal["id"], "L1")
        self.assertEqual(proposal["text"], "Prüfe zuerst die Tests.")
        self.assertEqual(proposal["by"], "ada")
        self.assertIsInstance(proposal["at"], int)

        rows = [row for row in self.index()["inbox"] if row.get("kind") == "lesson"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["ticket"], tid)
        self.assertEqual(rows[0]["proposal"], "L1")
        self.assertEqual(rows[0]["from"], "ada")
        self.assertEqual(rows[0]["text"], "Prüfe zuerst die Tests.")
        self.assertEqual(
            os.path.realpath(rows[0]["repo"]), os.path.realpath(repo)
        )
        self.assertNotIn("body", rows[0])
        self.assertNotIn("comments", rows[0])

        rows = [row for row in self.events() if row["kind"] == "lesson"]
        self.assertEqual(rows[-1]["text"], "vorschlag: Prüfe zuerst die Tests.")

        # Die nächste ID zählt hoch.
        self.ok("lesson", "propose", tid, "Zweite Lehre.", "--from", "zap")
        self.assertEqual(
            [item["id"] for item in self.ticket(tid)["lesson_proposals"]],
            ["L1", "L2"],
        )

    def test_propose_verlangt_genau_einen_satz(self):
        repo = self.make_repo()
        tid = self.new("Lehre", repo=repo)
        result = self.cli(
            "lesson", "propose", tid, "zwei\nzeilen", "--from", "ada"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ein Satz", result.stderr)
        result = self.cli("lesson", "propose", tid, "   ", "--from", "ada")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ein Satz", result.stderr)
        self.assertEqual(self.ticket(tid).get("lesson_proposals") or [], [])

    def test_confirm_haengt_am_haupt_checkout_an(self):
        repo, tid, worktree = self.ready_ticket()
        self.patch_ticket(tid, repo=worktree)
        self.ok(
            "lesson", "propose", tid, "Erst prüfen, dann mergen.", "--from", "ada"
        )
        result = self.ok("lesson", "confirm", tid, "L1", "--from", "mensch")
        self.assertIn("lessons.md", result.stdout)

        target = os.path.join(repo, ".fabric", "lessons.md")
        self.assertTrue(os.path.isfile(target))
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "- Erst prüfen, dann mergen.\n")
        self.assertFalse(
            os.path.exists(os.path.join(worktree, ".fabric", "lessons.md"))
        )

        self.assertEqual(self.ticket(tid)["lesson_proposals"], [])
        rows = [row for row in self.index()["inbox"] if row.get("kind") == "lesson"]
        self.assertEqual(rows, [])
        events = [row for row in self.events() if row["kind"] == "lesson"]
        self.assertEqual(events[-1]["text"], "bestätigt: Erst prüfen, dann mergen.")

    def test_confirm_committet_nur_die_lehre(self):
        repo, tid, worktree = self.ready_ticket()
        self.patch_ticket(tid, repo=worktree)
        before = self.git_out(repo, "rev-parse", "HEAD")
        self.ok(
            "lesson", "propose", tid, "Erst prüfen, dann mergen.", "--from", "ada"
        )
        self.ok("lesson", "confirm", tid, "L1", "--from", "mensch")

        self.assertEqual(
            self.git_out(repo, "rev-list", "--count", f"{before}..HEAD"), "1"
        )
        lines = [
            line
            for line in self.git_out(
                repo, "show", "--name-only", "--format=%s", "HEAD"
            ).splitlines()
            if line.strip()
        ]
        self.assertIn(tid, lines[0])
        self.assertEqual(lines[1:], [".fabric/lessons.md"])

        target = os.path.join(repo, ".fabric", "lessons.md")
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "- Erst prüfen, dann mergen.\n")

    def test_confirm_auf_anderem_branch_schreibt_ohne_commit(self):
        repo = self.make_repo()
        self.git_out(repo, "checkout", "-q", "-b", "seitlich")
        tid = self.new("Lehre", repo=repo)
        before = self.git_out(repo, "rev-parse", "HEAD")
        self.ok("lesson", "propose", tid, "Seitlich schreiben.", "--from", "ada")
        self.ok("lesson", "confirm", tid, "L1", "--from", "mensch")

        target = os.path.join(repo, ".fabric", "lessons.md")
        self.assertTrue(os.path.isfile(target))
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "- Seitlich schreiben.\n")
        self.assertEqual(self.git_out(repo, "rev-parse", "HEAD"), before)
        status = self.git_out(
            repo, "status", "--porcelain", "--untracked-files=all"
        )
        self.assertIn(".fabric/lessons.md", status)
        self.assertIn("??", status)

    def test_discard_entfernt_ohne_lessons_datei(self):
        repo = self.make_repo()
        tid = self.new("Lehre", repo=repo)
        self.ok("lesson", "propose", tid, "Nicht übernehmen.", "--from", "ada")
        self.ok("lesson", "discard", tid, "L1", "--from", "mensch")

        self.assertEqual(self.ticket(tid)["lesson_proposals"], [])
        self.assertFalse(os.path.exists(os.path.join(repo, ".fabric", "lessons.md")))
        rows = [row for row in self.index()["inbox"] if row.get("kind") == "lesson"]
        self.assertEqual(rows, [])
        events = [row for row in self.events() if row["kind"] == "lesson"]
        self.assertEqual(events[-1]["text"], "verworfen: Nicht übernehmen.")

    def test_prompts_enthalten_die_letzten_acht_lehren(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.write_file(
            os.path.join(repo, ".fabric", "lessons.md"),
            "\n".join(f"- Lehre {number}" for number in range(1, 11)) + "\n",
        )
        tid = self.new("Prompt", repo=repo)
        self.write_file(
            os.path.join(self.roster_dir, "prompts", "preamble.md"),
            "# Ticket {id}\n\n## Lehren aus früheren Tickets\n\n{lessons}\n",
        )
        self.write_file(
            os.path.join(self.roster_dir, "prompts", "orchestrator.md"),
            "Rolle\n\n## Lehren aus früheren Tickets\n\n{lessons}\n",
        )

        with mock.patch.dict(os.environ, self.env):
            roster = agents.load()
            ticket = self.ticket(tid)
            start = agents.start_prompt(
                roster,
                ticket,
                {"name": "zap", "role": "umsetzer", "prompt": "prompts/zap.md"},
            )
            orchestrated = agents.orchestrator_prompt(roster, "herdr-app")

        for text in (start, orchestrated):
            lines = text.splitlines()
            self.assertIn("- Lehre 3", lines)
            self.assertIn("- Lehre 10", lines)
            self.assertNotIn("- Lehre 1", lines)
            self.assertNotIn("- Lehre 2", lines)

    def test_verdict_fail_weckt_orchestrator_mit_lehren_auftrag(self):
        repo, tid, worktree = self.ready_ticket()
        self.set_live({"fab-zap-t-1": "t7", "fab-orchestrator": "t0"})
        self.clear_log()
        self.ok("verdict", tid, "fail", "--from", "ada", "Tests fehlen")
        sends = self.hc_calls("send")
        self.assertEqual([row[1] for row in sends], ["t7", "t0"])
        self.assertIn("Urteil fail", sends[0][2])
        self.assertIn(f"fab lesson propose {tid}", sends[1][2])
        self.assertIn("Tests fehlen", sends[1][2])
        self.assertIn("imperativen Satz", sends[1][2])
        self.assertIn("Mensch bestätigt", sends[1][2])

    def test_verdict_fail_nach_kaltstart_sendet_lehren_auftrag(self):
        """Ohne laufenden Orchestrator geht der Auftrag nach dem Start nach."""
        repo, tid, worktree = self.ready_ticket()
        self.set_live({"fab-zap-t-1": "t7"})
        self.clear_log()
        self.ok("verdict", tid, "fail", "--from", "ada", "Tests fehlen")
        sends = self.hc_calls("send")
        self.assertEqual(sends[0][1], "t7")
        started = [row for row in sends if row[1] == "t900"]
        self.assertEqual(len(started), 1, sends)
        self.assertIn(f"fab lesson propose {tid}", started[0][2])
        self.assertIn("imperativen Satz", started[0][2])

    def test_orchestrator_prompt_verlangt_frisches_lesen(self):
        path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "prompts",
            "orchestrator.md",
        )
        text = self._read(path)
        self.assertIn("{lessons}", text)
        self.assertIn(".fabric/lessons.md", text)
        self.assertIn("erneut", text)

    def test_reject_weckt_orchestrator_mit_lehren_auftrag(self):
        repo, tid, worktree = self.review_ticket()
        self.set_live({"fab-zap-t-1": "t7", "fab-orchestrator": "t0"})
        self.clear_log()
        self.ok("reject", tid, "Bitte mehr Tests")
        sends = self.hc_calls("send")
        self.assertEqual([row[1] for row in sends], ["t7", "t0"])
        self.assertIn("Zurückweisung", sends[1][2])
        self.assertIn(f"fab lesson propose {tid}", sends[1][2])
        self.assertIn("Bitte mehr Tests", sends[1][2])
