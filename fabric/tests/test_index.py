"""Lesemodell: Struktur, Inbox-Arten, Grenzen von index.json."""
import json
import os
import time

from fabric.tests.support import FabricCase


class IndexTests(FabricCase):
    def test_struktur_und_ticket_eintraege(self):
        tid = self.new("Struktur")
        payload = self.index()
        self.assertEqual(payload["version"], 1)
        self.assertIsInstance(payload["generated_at"], int)
        entry = payload["tickets"][0]
        self.assertEqual(entry["id"], tid)
        self.assertEqual(entry["title"], "Struktur")
        self.assertEqual(entry["status"], "draft")
        for field in (
            "assignee", "repo", "branch", "updated_at", "comment_count", "waiting",
            "blocked_by", "checks", "verdict", "last_comment", "sessions",
        ):
            self.assertIn(field, entry)
        self.assertNotIn("body", entry)
        self.assertNotIn("comments", entry)
        self.assertEqual(entry["comment_count"], 1)
        self.assertEqual(entry["last_comment"]["mentions"], ["orchestrator"])
        self.assertEqual({row["name"] for row in payload["roster"]}, {"zap", "ada"})
        self.assertEqual(payload["events"][-1]["ticket"], tid)

    def test_inbox_question_aus_waiting(self):
        tid = self.new("Frage")
        self.ok("comment", tid, "--from", "zap", "@mensch bitte entscheiden")
        inbox = self.index()["inbox"]
        questions = [row for row in inbox if row["kind"] == "question"]
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]["ticket"], tid)
        self.assertEqual(questions[0]["from"], "zap")
        self.assertIn("bitte entscheiden", questions[0]["text"])
        self.assertIn("mensch", self.ticket(tid)["waiting"])

    def test_inbox_review(self):
        tid = self.new("Prüfung")
        self.patch_ticket(tid, status="review")
        self.ok("index")
        reviews = [row for row in self.index()["inbox"] if row["kind"] == "review"]
        self.assertEqual(len(reviews), 1)
        self.assertEqual(reviews[0]["ticket"], tid)

    def test_review_hat_genau_einen_inbox_eintrag(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree)
        self.passing_verify(worktree)
        self.ok("verify", tid)
        self.set_live({"fab-zap-t-1": "t7"})
        self.ok("verdict", tid, "pass", "--from", "ada", "gut")
        self.ok("handover", tid, "--from", "zap", "fertig")
        self.assertIn("mensch", self.ticket(tid)["waiting"])
        rows = [row for row in self.index()["inbox"] if row["ticket"] == tid]
        self.assertEqual([row["kind"] for row in rows], ["review"])

    def test_inbox_attention_pingpong_und_erloeschen(self):
        tid = self.new("Ping")
        now = int(time.time() * 1000)
        self.add_events(
            [
                {"at": now - 1000, "kind": "wake", "ticket": tid, "actor": "zap",
                 "target": "ada", "text": "geweckt"}
                for _ in range(9)
            ]
        )
        self.set_live({"fab-ada-t-1": "t1"})
        self.ok("comment", tid, "--from", "zap", "@ada nochmal")
        attention = [row for row in self.index()["inbox"] if row["kind"] == "attention"]
        self.assertEqual(len(attention), 1)
        self.assertEqual(attention[0]["from"], "fab")
        self.assertIn("Ping-Pong zwischen zap und ada", attention[0]["text"])
        # Eine neue Handlung im Ticket räumt den Hinweis ab.
        self.ok("comment", tid, "--from", "ada", "erledigt")
        attention = [row for row in self.index()["inbox"] if row["kind"] == "attention"]
        self.assertEqual(attention, [])

    def test_hoechstens_300_ereignisse_und_unter_1_mib(self):
        now = int(time.time() * 1000)
        self.add_events(
            [
                {"at": now + index, "kind": "comment", "ticket": "T-9",
                 "actor": "mensch", "target": "", "text": f"zeile {index}"}
                for index in range(305)
            ]
        )
        self.ok("index")
        payload = self.index()
        self.assertEqual(len(payload["events"]), 300)
        self.assertEqual(payload["events"][0]["text"], "zeile 5")
        self.assertEqual(payload["events"][-1]["text"], "zeile 304")
        size = os.path.getsize(os.path.join(self.home, "index.json"))
        self.assertLess(size, 1024 * 1024)

    def test_index_wird_nach_jeder_aenderung_geschrieben(self):
        tid = self.new("Folge")
        first = self.index()["generated_at"]
        self.assertGreaterEqual(first, 1)
        self.ok("comment", tid, "--from", "zap", "neu", "--no-wake")
        self.assertEqual(self.index()["tickets"][0]["comment_count"], 2)
