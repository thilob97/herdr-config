#!/usr/bin/env python3
"""Regression tests for `hub wip`, `hub spec` and the Definition of Done.

    python3 mods/orchestra/test/hub_wip_test.py

Every test builds a throwaway HOME with its own ticket store; `hc` is a stub on PATH
that reports a fake terminal on `run`, so no real Herdr window, agent or GitHub is
touched. The repos are throwaway git repositories under the temp root.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "hub")

HC = """#!/bin/sh
case "$1" in
  ls) echo '{"terminals":[]}' ;;
  get) echo '{}'; exit 1 ;;
  run) echo '{"address":"t-demo"}' ;;
  *) exit 0 ;;
esac
"""

APP = """#!/bin/sh
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  *) exit 0 ;;
esac
"""


class HubWipTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-wip-")
        self.addCleanup(shutil.rmtree, self.base, True)
        self.home = os.path.join(self.base, "home")
        self.app = os.path.join(self.base, "app")
        self.app_b = os.path.join(self.base, "app-b")
        self.bin = os.path.join(self.base, "bin")
        self.repos = os.path.join(self.base, "repos")
        for d in (self.home, self.app, self.app_b, self.bin, self.repos):
            os.makedirs(d)
        for name, body in (("hc", HC), ("herdr-app", APP)):
            p = os.path.join(self.bin, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)
            os.chmod(p, 0o755)
        self.git_env = {**os.environ, "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.test",
                        "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.test"}

    # ---- helpers

    def git(self, *args, cwd):
        return subprocess.run(["git", *args], cwd=cwd, env=self.git_env, capture_output=True, text=True, check=True)

    def repo(self, name="repo"):
        path = os.path.join(self.repos, name)
        os.makedirs(path)
        self.git("init", "-q", "-b", "main", cwd=path)
        with open(os.path.join(path, "f.txt"), "w", encoding="utf-8") as f:
            f.write(name + "\n")
        self.git("add", "f.txt", cwd=path)
        self.git("commit", "-q", "-m", "start", cwd=path)
        return path

    def hub(self, *args, app=None):
        env = dict(os.environ)
        env.update(HOME=self.home, HERDR_APP_HOME=app or self.app,
                   PATH=self.bin + os.pathsep + env.get("PATH", ""))
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True, env=env)

    def ticket(self, title, repo, body="", status="todo", app=None, **fields):
        args = ["ticket", "new", "--title", title, "--repo", repo, "--body", body]
        r = self.hub(*args, app=app)
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = r.stdout.strip()
        pairs = [f"status={status}"] + [f"{k}={v}" for k, v in fields.items()]
        r = self.hub("ticket", "set", tid, *pairs, app=app)
        self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def criteria_ticket(self, title, repo, app=None, **fields):
        return self.ticket(title, repo, body="## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n",
                           app=app, **fields)

    def text_of(self, tid, app=None):
        with open(os.path.join(app or self.app, "data", "quests", "tickets", tid + ".md"), encoding="utf-8") as f:
            return f.read()

    # ---- hub wip

    def test_wip_defaults_set_and_file(self):
        r = self.hub("wip", "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"arbeit": 3, "pruefung": 2}, "Standard 3/2")

        r = self.hub("wip", "arbeit=4", "pruefung=0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(self.hub("wip", "--json").stdout), {"arbeit": 4, "pruefung": 0})
        with open(os.path.join(self.app, "data", "orchestra", "wip.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"arbeit": 4, "pruefung": 0}, "gespeichert in data/orchestra/wip.json")

    def test_wip_rejects_invalid_values_and_keeps_the_stored_ones(self):
        self.assertEqual(self.hub("wip", "arbeit=4").returncode, 0)
        for bad in (["arbeit=abc"], ["arbeit=-1"], ["arbeit=100"], ["foo=2"], ["arbeit"]):
            r = self.hub("wip", *bad)
            self.assertNotEqual(r.returncode, 0, f"{bad} muss abgelehnt werden")
            self.assertIn("hub:", r.stderr)
        self.assertEqual(json.loads(self.hub("wip", "--json").stdout)["arbeit"], 4, "ungültige Werte ändern nichts")

    def test_wip_counts_only_this_homes_tickets(self):
        repo = self.repo()
        for i in range(3):
            self.ticket(f"Doing {i}", repo, status="doing")
        self.ticket("Prüfung", repo, status="review")
        self.ticket("Fremd", repo, status="doing", app=self.app_b)
        r = self.hub("wip")
        self.assertIn("arbeit 3/3", r.stdout)
        self.assertIn("pruefung 1/2", r.stdout)

    # ---- dispatch: WIP limit

    def test_dispatch_refuses_at_limit_and_names_the_running_tickets(self):
        repo = self.repo()
        running = [self.ticket(f"Läuft {i}", repo, status="doing") for i in range(3)]
        fresh = self.criteria_ticket("Neu", repo)

        r = self.hub("dispatch", fresh, "--no-worktree")
        self.assertNotEqual(r.returncode, 0, "bei 3/3 startet nichts")
        for tid in running:
            self.assertIn(tid, r.stderr, "die laufenden Tickets stehen in der Meldung")
        self.assertIn("WIP-Limit", r.stderr)
        self.assertIn("hub wip", r.stderr)
        self.assertIn("status: todo", self.hub("ticket", "show", fresh).stdout, "der Start bleibt verweigert")

        r = self.hub("wip", "arbeit=4")
        self.assertEqual(r.returncode, 0, r.stderr)
        r = self.hub("dispatch", fresh, "--no-worktree")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("status: doing", self.hub("ticket", "show", fresh).stdout)

    def test_dispatch_force_needs_reason_and_writes_it_to_the_history(self):
        repo = self.repo()
        self.assertEqual(self.hub("wip", "arbeit=1").returncode, 0)
        self.ticket("Läuft", repo, status="doing")
        fresh = self.criteria_ticket("Neu", repo)

        r = self.hub("dispatch", fresh, "--no-worktree", "--force")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--reason", r.stderr)
        self.assertNotIn("Start-Gate überfahren", self.text_of(fresh), "ohne Grund kein Kommentar")

        r = self.hub("dispatch", fresh, "--no-worktree", "--force", "--reason", "Notfall am Freitag")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Notfall am Freitag", self.text_of(fresh))
        self.assertIn("Start-Gate überfahren", self.text_of(fresh))

    # ---- hub spec and the spec gate

    def test_spec_adds_only_missing_sections_and_leaves_existing_ones(self):
        repo = self.repo()
        body = "## Ziel\n\nBestehendes Ziel.\n\n## Aufgaben\n\n- etwas tun\n"
        tid = self.ticket("Spec", repo, body=body)

        r = self.hub("spec", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("ergänzt Abnahmekriterien, Grenzen", r.stdout)
        text = self.text_of(tid)
        self.assertEqual(text.count("## Ziel"), 1)
        self.assertIn("Bestehendes Ziel.", text, "vorhandene Abschnitte bleiben unberührt")
        self.assertIn("## Abnahmekriterien", text)
        self.assertIn("## Grenzen", text)
        self.assertLess(text.index("## Aufgaben"), text.index("## Abnahmekriterien"))
        self.assertIn("- [ ] <", text, "die Vorlage ist ein Platzhalter, kein Kriterium")

        again = self.hub("spec", tid)
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("alle Abschnitte vorhanden", again.stdout)

    def test_dispatch_refuses_without_criteria_and_names_hub_spec(self):
        repo = self.repo()
        tid = self.ticket("Ohne", repo, body="## Ziel\n\nEtwas.\n\n## Grenzen\n\n- nichts\n")
        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(f"hub spec {tid}", r.stderr)

        self.assertEqual(self.hub("spec", tid).returncode, 0)
        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertNotEqual(r.returncode, 0, "der Platzhalter zählt nicht als Abnahmekriterium")
        self.assertIn(f"hub spec {tid}", r.stderr)

        with open(os.path.join(self.app, "data", "quests", "tickets", tid + ".md"), encoding="utf-8") as f:
            text = f.read().replace("- [ ] <was von außen prüfbar ist>", "- [ ] Der Start verweigert.")
        with open(os.path.join(self.app, "data", "quests", "tickets", tid + ".md"), "w", encoding="utf-8") as f:
            f.write(text)
        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertEqual(r.returncode, 0, r.stderr)

    # ---- Definition of Done in gate and review

    def review_ticket(self, repo, wt, head):
        body = "## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n"
        tid = self.ticket("DoD", repo, body=body, status="doing", worktree=wt,
                          checks="pass", checks_head=head, review="pass", review_head=head)
        return tid

    def test_review_refuses_missing_evidence_and_gate_lists_the_dod(self):
        repo = self.repo()
        wt = os.path.join(self.base, "wt")
        self.git("worktree", "add", "-q", "-b", "feat/dod", wt, cwd=repo)
        head = self.git("rev-parse", "HEAD", cwd=wt).stdout.strip()
        tid = self.review_ticket(repo, wt, head)
        self.assertEqual(self.hub("ticket", "comment", tid, "--from", "bob",
                                  "Fertig. Checks grün, kein Push.").returncode, 0)

        g = json.loads(self.hub("gate", tid, "--json").stdout)
        dod = {x["key"]: x for x in g["dod"]}
        self.assertEqual(set(dod), {"kriterien", "verify", "pruefung", "ci", "nachweise", "abschluss"})
        self.assertTrue(dod["kriterien"]["ok"])
        self.assertTrue(dod["verify"]["ok"])
        self.assertTrue(dod["pruefung"]["ok"])
        self.assertTrue(dod["ci"]["ok"], "ohne PR ist CI nicht nötig")
        self.assertTrue(dod["abschluss"]["ok"])
        self.assertFalse(dod["nachweise"]["ok"])
        self.assertIn("--evidence", dod["nachweise"]["why"])
        self.assertFalse(g["dod_ok"])

        r = self.hub("review", tid, "--summary", "Fertig.")
        self.assertNotEqual(r.returncode, 0, "ohne Nachweise kein review")
        self.assertIn("Verweigert:", r.stderr)
        self.assertIn("Nachweise", r.stderr)
        self.assertNotIn("status: review", self.text_of(tid), "das Ticket bleibt in Arbeit")

        r = self.hub("review", tid, "--summary", "Fertig.", "--evidence", "/tmp/beleg.png")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("status: review", self.text_of(tid))
        g = json.loads(self.hub("gate", tid, "--json").stdout)
        self.assertTrue(g["dod_ok"], "nach dem Nachweis ist die DoD erfüllt")

    def test_review_refuses_without_closing_report_or_criteria(self):
        repo = self.repo()
        wt = os.path.join(self.base, "wt")
        self.git("worktree", "add", "-q", "-b", "feat/dod2", wt, cwd=repo)
        head = self.git("rev-parse", "HEAD", cwd=wt).stdout.strip()
        tid = self.ticket("Ohne Abschluss", repo, body="## Ziel\n\nEtwas.\n", status="doing", worktree=wt,
                          checks="pass", checks_head=head, review="pass", review_head=head,
                          evidence="/tmp/beleg.png")

        r = self.hub("review", tid, "--summary", "Fertig.")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Abnahmekriterien", r.stderr)
        self.assertIn("Abnahme im Verlauf", r.stderr)


if __name__ == "__main__":
    unittest.main()
