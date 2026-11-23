"""Entscheidungslog: Vorschlag, Bestätigung, Verwerfen, Kontext und Prompt (T-60)."""
import os
import re
from datetime import date
from unittest import mock

from fabric.fablib import agents, context, repos
from fabric.tests.support import FabricCase


class DecisionCase(FabricCase):
    def file(self, repo):
        return os.path.join(repo, ".fabric", "decisions.md")

    def lines(self, repo):
        path = self.file(repo)
        if not os.path.isfile(path):
            return []
        return [line for line in self._read(path).splitlines() if line.strip()]

    def decide(self, *args, **kwargs):
        return self.cli("decide", *args, **kwargs)

    def propose(self, tid, text, reason=None, actor="orchestrator"):
        args = ["decide", tid, "--from", actor, text]
        if reason is not None:
            args += ["--reason", reason]
        return self.cli(*args)

    def load_prompt(self):
        path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "prompts",
            "orchestrator.md",
        )
        return self._read(path)


class ProposeConfirmTests(DecisionCase):
    def test_propose_legt_vorschlag_an_und_confirm_schreibt_eintrag(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Entscheidung", repo=repo)

        result = self.ok(
            "decide", tid, "--from", "orchestrator",
            "Wir nehmen SQLite.", "--reason", "Ein File, kein Dienst.",
        )
        self.assertIn("D1", result.stdout)
        ticket = self.ticket(tid)
        self.assertEqual(len(ticket["decision_proposals"]), 1)
        proposal = ticket["decision_proposals"][0]
        self.assertEqual(proposal["id"], "D1")
        self.assertEqual(proposal["text"], "Wir nehmen SQLite.")
        self.assertEqual(proposal["reason"], "Ein File, kein Dienst.")
        self.assertEqual(proposal["by"], "orchestrator")
        self.assertIsInstance(proposal["at"], int)
        self.assertFalse(os.path.exists(self.file(repo)))

        rows = [row for row in self.index()["inbox"] if row.get("kind") == "decision"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["ticket"], tid)
        self.assertEqual(rows[0]["proposal"], "D1")
        self.assertEqual(rows[0]["text"], "Wir nehmen SQLite.")
        self.assertEqual(rows[0]["reason"], "Ein File, kein Dienst.")

        self.ok("decide", "confirm", tid, "D1", "--from", "mensch")
        lines = self.lines(repo)
        self.assertEqual(len(lines), 1)
        entry = lines[0]
        self.assertTrue(
            re.match(rf"^- {date.today().isoformat()} · {re.escape(tid)}: ", entry),
            entry,
        )
        self.assertIn("Wir nehmen SQLite.", entry)
        self.assertIn("Begründung: Ein File, kein Dienst.", entry)
        self.assertEqual(self.ticket(tid)["decision_proposals"], [])
        self.assertEqual(
            [row for row in self.index()["inbox"] if row.get("kind") == "decision"],
            [],
        )
        events = [row for row in self.events() if row["kind"] == "decision"]
        self.assertEqual(events[-1]["text"], "bestätigt: Wir nehmen SQLite.")

    def test_confirm_committet_nur_die_entscheidung(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Entscheidung", repo=repo)
        before = self.git_out(repo, "rev-parse", "HEAD")
        self.ok("decide", tid, "--from", "orchestrator", "Bleibt so.")
        self.ok("decide", "confirm", tid, "D1", "--from", "mensch")

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
        self.assertEqual(lines[1:], [".fabric/decisions.md"])

    def test_mensch_schreibt_direkt_ohne_vorschlag(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Entscheidung", repo=repo)
        self.ok(
            "decide", tid, "--from", "mensch",
            "Wir bleiben bei Python.", "--reason", "Team kennt es.",
        )
        self.assertEqual(self.ticket(tid).get("decision_proposals") or [], [])
        lines = self.lines(repo)
        self.assertEqual(len(lines), 1)
        self.assertIn("Wir bleiben bei Python.", lines[0])
        self.assertIn("Begründung: Team kennt es.", lines[0])
        self.assertFalse(
            [row for row in self.index()["inbox"] if row.get("kind") == "decision"]
        )

    def test_reject_schreibt_nichts_und_doppeltes_bestaetigen_scheitert(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Entscheidung", repo=repo)
        self.ok("decide", tid, "--from", "orchestrator", "Nicht übernehmen.")
        self.ok("decide", "reject", tid, "D1", "--from", "mensch")
        self.assertEqual(self.ticket(tid)["decision_proposals"], [])
        self.assertFalse(os.path.exists(self.file(repo)))
        events = [row for row in self.events() if row["kind"] == "decision"]
        self.assertEqual(events[-1]["text"], "verworfen: Nicht übernehmen.")

        self.ok("decide", tid, "--from", "orchestrator", "Doch übernehmen.")
        self.ok("decide", "confirm", tid, "D1", "--from", "mensch")
        again = self.cli("decide", "confirm", tid, "D1", "--from", "mensch")
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("gibt es nicht", again.stderr)
        self.assertEqual(len(self.lines(repo)), 1)

    def test_vorschlag_ids_zaehlen_hoch(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Entscheidung", repo=repo)
        self.ok("decide", tid, "--from", "orchestrator", "Erste.")
        self.ok("decide", tid, "--from", "orchestrator", "Zweite.")
        self.assertEqual(
            [item["id"] for item in self.ticket(tid)["decision_proposals"]],
            ["D1", "D2"],
        )

    def test_mehrzeilige_entscheidung_und_begruendung_werden_abgelehnt(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Entscheidung", repo=repo)
        for args, needle in (
            (("decide", tid, "--from", "orchestrator", "zwei\nzeilen"), "Entscheidung"),
            (
                ("decide", tid, "--from", "orchestrator", "Satz", "--reason", "zwei\nzeilen"),
                "Begründung",
            ),
        ):
            result = self.cli(*args)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(needle, result.stderr)
        self.assertEqual(self.ticket(tid).get("decision_proposals") or [], [])
        self.assertFalse(os.path.exists(self.file(repo)))

    def test_propose_ohne_repo_bricht_ab(self):
        tid = self.new("Ohne Repo")
        self.patch_ticket(tid, repo=None)
        result = self.propose(tid, "Wir nehmen SQLite.")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("kein Repo", result.stderr)
        self.assertFalse(self.ticket(tid).get("decision_proposals"))

    def test_confirm_haengt_am_haupt_checkout_an(self):
        repo, tid, worktree = self.ready_ticket()
        self.patch_ticket(tid, repo=worktree)
        self.ok("decide", tid, "--from", "orchestrator", "Im Haupt-Checkout.")
        result = self.ok("decide", "confirm", tid, "D1", "--from", "mensch")
        self.assertIn("decisions.md", result.stdout)
        self.assertTrue(os.path.isfile(self.file(repo)))
        self.assertFalse(
            os.path.exists(os.path.join(worktree, ".fabric", "decisions.md"))
        )

    def test_list_zeigt_offene_vorschlaege_und_bestaetigte(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Entscheidung", repo=repo)
        self.ok("decide", tid, "--from", "orchestrator", "Offen.", "--reason", "Weil.")
        listing = self.ok("decide", "list").stdout
        self.assertIn(tid, listing)
        self.assertIn("D1", listing)
        self.assertIn("Offen.", listing)
        self.assertIn("Begründung: Weil.", listing)

        self.ok("decide", "confirm", tid, "D1", "--from", "mensch")
        self.assertEqual(self.ok("decide", "list").stdout.strip(),
                         "Keine offenen Entscheidungs-Vorschläge")
        confirmed = self.ok("decide", "list", "--repo", repo).stdout
        self.assertIn("Offen.", confirmed)
        self.assertIn("Begründung: Weil.", confirmed)


class ContextTests(DecisionCase):
    def prompter(self):
        self.write_file(
            os.path.join(self.roster_dir, "prompts", "preamble.md"),
            "{context}\n",
        )

    def start_context(self, tid):
        with mock.patch.dict(os.environ, self.env):
            roster = agents.load()
            start = agents.start_prompt(
                roster,
                self.ticket(tid),
                {"name": "zap", "role": "umsetzer", "prompt": "prompts/zap.md"},
            )
        return start.split("\n\nZap-Rolle:")[0]

    def test_kontext_enthaelt_nur_die_letzten_fuenf_bestaetigten(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Kontext", repo=repo)
        for number in range(1, 7):
            self.ok(
                "decide", tid, "--from", "mensch", f"Entscheidung {number}."
            )
        self.ok("decide", tid, "--from", "orchestrator", "VORSCHLAG-GEHEIM")

        self.prompter()
        text = self.start_context(tid)
        self.assertIn("## Entscheidungen", text)
        for number in range(2, 7):
            self.assertIn(f"Entscheidung {number}.", text)
        self.assertNotIn("Entscheidung 1.", text)
        self.assertNotIn("VORSCHLAG-GEHEIM", text)

        self.assertEqual(
            self.ok("context", tid).stdout.strip(),
            text.strip(),
        )

    def test_kuerzung_nennt_die_entscheidungsdatei(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Kontext", repo=repo)
        self.ok("decide", tid, "--from", "mensch", "L" * 500)
        self.ok("settings", "set", "context_limit", "140", "--from", "mensch")
        self.prompter()
        text = self.start_context(tid)
        self.assertLessEqual(len(text), 140)
        self.assertIn("[…] gekürzt, vollständig in", text)
        self.assertIn(
            os.path.join(repo, ".fabric", "decisions.md"), text
        )

    def test_team_kontext_nennt_bei_mehreren_repos_das_repo(self):
        first = self.make_repo("eins")
        second = self.make_repo("zwei")
        self.own_repo(first)
        self.own_repo(second)
        one = self.new("Eins", repo=first)
        two = self.new("Zwei", repo=second)
        self.ok("decide", one, "--from", "mensch", "Aus eins.")
        self.ok("decide", two, "--from", "mensch", "Aus zwei.")
        with mock.patch.dict(os.environ, self.env):
            roster = agents.load()
            text = context.for_team(roster, "herdr-app")
        self.assertIn("eins: ", text)
        self.assertIn("zwei: ", text)
        self.assertIn("Aus eins.", text)
        self.assertIn("Aus zwei.", text)


class OrchestratorPromptTests(DecisionCase):
    def test_prompt_verlangt_entscheidungen_als_vorschlag(self):
        text = self.load_prompt()
        self.assertIn("## Was der Mensch entscheidet", text)
        self.assertIn("fab decide", text)
        self.assertIn("--from orchestrator", text)
        self.assertIn("--reason", text)
        self.assertIn("fab decide confirm", text)
        self.assertIn(".fabric/decisions.md", text)

    def test_data_layer_liest_nur_bestaetigte_zeilen(self):
        repo = self.make_repo()
        path = self.file(repo)
        self.write_file(
            path,
            "# Entscheidungen\n\n- 2026-11-22 · T-1: Eins.\n- 2026-11-22 · T-2: Zwei.\n",
        )
        self.assertEqual(repos.decisions(repo), [
            "2026-11-22 · T-1: Eins.",
            "2026-11-22 · T-2: Zwei.",
        ])
        self.assertEqual(repos.decisions(repo, limit=1), ["2026-11-22 · T-2: Zwei."])
        self.assertEqual(
            repos.decisions_text(repo),
            "- 2026-11-22 · T-1: Eins.\n- 2026-11-22 · T-2: Zwei.",
        )
