"""Unter-Tickets: Anlage, Grenzen, Darstellung, Sperren bei Übergabe und Abnahme."""
import json
import os

from fabric.tests.support import FabricCase


class SubTicketTests(FabricCase):
    def parent_ticket(self):
        repo = self.make_repo()
        self.own_repo(repo)
        result = self.ok("new", "Eltern", "--repo", repo, "--from", "mensch")
        return repo, result.stdout.strip()

    def child(self, parent, title="Kind", author="zap"):
        result = self.ok("new", title, "--parent", parent, "--from", author)
        return result.stdout.strip()

    def test_kind_erbt_repo_und_weckt_orchestrator(self):
        repo, parent = self.parent_ticket()
        child = self.child(parent)
        ticket = self.ticket(child)
        self.assertEqual(ticket["status"], "draft")
        self.assertEqual(ticket["parent"], parent)
        self.assertEqual(ticket["repo"], os.path.realpath(repo))
        self.assertEqual(ticket["created_by"], "zap")
        self.assertIn("@orchestrator", ticket["comments"][-1]["text"])
        self.assertIn(parent, ticket["comments"][-1]["text"])
        wakes = self.wake_events(child)
        self.assertEqual(len(wakes), 1)
        self.assertEqual(wakes[0]["target"], "orchestrator")
        self.assertIn(wakes[0]["text"], ("geweckt", "gestartet"))
        rows = json.loads(self.ok("list", "--team", "herdr-app", "--json").stdout)
        by_id = {row["id"]: row for row in rows}
        self.assertIn(child, by_id)
        self.assertEqual(by_id[child]["parent"], parent)

    def test_grenzen(self):
        repo, parent = self.parent_ticket()
        children = [self.child(parent, f"Kind {number}") for number in range(3)]
        result = self.cli("new", "Viertes", "--parent", parent, "--from", "zap")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("höchstens 3", result.stderr)
        for child in children:
            self.assertIn(child, result.stderr)
        self.ok("drop", children[0], "--from", "mensch", "reicht")
        self.child(parent, "Viertes")
        result = self.cli("new", "Enkel", "--parent", children[1], "--from", "zap")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("eine Ebene", result.stderr)
        other = self.make_repo("anderes")
        self.own_repo(other)
        result = self.cli(
            "new", "Falsches Repo", "--parent", parent, "--repo", other, "--from", "zap"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("erben das Repo", result.stderr)

    def test_darstellung(self):
        repo, parent = self.parent_ticket()
        child = self.child(parent)
        text = self.ok("show", parent).stdout
        self.assertIn(child, text)
        self.assertIn("draft", text)
        self.assertIn("Unter-Tickets (0/1 erledigt)", text)
        child_text = self.ok("show", child).stdout
        self.assertIn(f"Eltern-Ticket: {parent}", child_text)
        tree = self.ok("list", "--tree").stdout
        lines = tree.splitlines()
        parent_line = next(line for line in lines if line.strip().startswith(parent))
        child_line = next(line for line in lines if line.strip().startswith(child))
        self.assertFalse(parent_line.startswith(" "))
        self.assertTrue(child_line.startswith("  " + child))

    def test_handover_und_accept_verweigern_bei_offenen_kindern(self):
        repo, parent, worktree = self.ready_ticket()
        child = self.child(parent)
        self.commit_in(worktree)
        self.passing_verify(worktree)
        self.ok("verify", parent)
        self.ok("verdict", parent, "pass", "--from", "ada", "gut")
        result = self.cli("handover", parent, "--from", "zap", "fertig")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unter-Ticket", result.stderr)
        self.assertIn(child, result.stderr)
        self.assertEqual(self.ticket(parent)["status"], "doing")
        self.ok("drop", child, "--from", "mensch", "erledigt")
        result = self.ok("handover", parent, "--from", "zap", "fertig")
        self.assertIn("review", result.stdout)
        self.assertEqual(self.ticket(parent)["status"], "review")

        late = self.child(parent, "Nachzügler")
        result = self.cli("accept", parent)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Abnahme verweigert", result.stderr)
        self.assertIn(late, result.stderr)
        self.ok("drop", late, "--from", "mensch", "erledigt")
        result = self.ok("accept", parent)
        self.assertIn("angenommen", result.stdout)
        self.assertEqual(self.ticket(parent)["status"], "done")
