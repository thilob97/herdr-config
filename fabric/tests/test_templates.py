"""Ticket-Vorlagen und Tickets aus GitHub-Issues (T-37)."""
import json
import os

from fabric.tests.support import FabricCase

STUB_GH = '''#!/usr/bin/env python3
"""gh-Stub: protokolliert Aufrufe und spielt Issues."""
import json
import os
import sys

args = sys.argv[1:]
log = os.environ.get("GH_LOG")
if log:
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(args) + "\\n")

if args[:2] == ["auth", "status"]:
    sys.exit(1 if os.environ.get("GH_AUTH_FAIL") else 0)

if args[:2] == ["issue", "view"]:
    number = int(args[2])
    state = os.environ.get("GH_ISSUE_STATE", "OPEN")
    print(json.dumps({
        "number": number,
        "title": os.environ.get("GH_ISSUE_TITLE", "Issue Titel"),
        "body": os.environ.get("GH_ISSUE_BODY", "Issue Body"),
        "url": f"https://github.com/test/repo/issues/{number}",
        "state": state,
    }))
    sys.exit(0)

if args[:2] == ["issue", "list"]:
    print(json.dumps([
        {"number": 12, "title": "Erster Fehler",
         "url": "https://github.com/test/repo/issues/12"},
        {"number": 13, "title": "Zweiter Fehler",
         "url": "https://github.com/test/repo/issues/13"},
    ]))
    sys.exit(0)

sys.exit(0)
'''


class TemplateTests(FabricCase):
    def setUp(self):
        super().setUp()
        stub = os.path.join(self.bin, "gh")
        self.write_file(stub, STUB_GH)
        os.chmod(stub, 0o755)

    def gh_env(self, **extra):
        env = {"GH_LOG": os.path.join(self.tmp, "gh.log")}
        env.update(extra)
        return env

    def github_repo(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.git_out(
            repo, "remote", "add", "origin", "https://github.com/test/repo.git"
        )
        return repo

    def template_text(self, name):
        from fabric.fablib import store

        with self.store_env():
            return store.template_get(name)

    def test_mitgelieferte_vorlagen_haben_abschnitte(self):
        from fabric.fablib import templates

        for name in ("bug", "feature", "refactor", "chore"):
            text = templates.DEFAULTS[name]
            self.assertTrue(text.endswith("\n"), name)
            for heading in ("## Ziel", "## Kontext", "## Abnahmekriterien", "## Grenzen"):
                self.assertIn(heading, text, name)
            self.assertIn("{satz}", text, name)
            self.assertIn("- [ ]", text, name)

    def test_template_list_zeigt_reihenfolge(self):
        rows = json.loads(self.ok("template", "list", "--json").stdout)
        names = [row["name"] for row in rows]
        self.assertEqual(names[:4], ["bug", "feature", "refactor", "chore"])
        by_name = {row["name"]: row for row in rows}
        self.assertEqual(by_name["bug"]["path"], "bug")
        self.assertGreater(by_name["bug"]["bytes"], 0)
        text = self.ok("template", "list").stdout
        self.assertIn("bug  ", text)
        self.assertIn(" B  ", text)

    def test_template_show_und_set_roundtrip(self):
        raw = self.ok("template", "show", "bug").stdout
        self.assertIn("## Ziel", raw)
        self.assertIn("{satz}", raw)

        text = "# Eigener Fehler\n\n## Ziel\n{satz}\n"
        self.ok("template", "set", "bug", "--text", text, "--from", "mensch")

        self.assertEqual(self.template_text("bug"), text)
        self.assertEqual(self.ok("template", "show", "bug").stdout, text)
        rows = json.loads(self.ok("template", "list", "--json").stdout)
        row = next(row for row in rows if row["name"] == "bug")
        self.assertEqual(row["path"], "bug")

        events = [row for row in self.events() if row["kind"] == "config"]
        self.assertTrue(any("Vorlage bug gespeichert" in row["text"] for row in events))

    def test_template_show_unbekannt_nennt_vorhandene(self):
        result = self.cli("template", "show", "gibtsnicht")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekannte Vorlage", result.stderr)
        self.assertIn("bug", result.stderr)

    def test_template_set_prueft_namen(self):
        result = self.cli(
            "template", "set", "Böse", "--text", "x", "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Ungültiger Vorlagename", result.stderr)

    def test_new_mit_vorlage_fuellt_satz_und_abschnitte(self):
        repo = self.github_repo()
        result = self.ok(
            "new", "Der Knopf klemmt", "--template", "bug", "--repo", repo
        )
        tid = result.stdout.strip()
        ticket = self.ticket(tid)
        self.assertEqual(ticket["title"], "Der Knopf klemmt")
        for heading in ("## Ziel", "## Kontext", "## Abnahmekriterien", "## Grenzen"):
            self.assertIn(heading, ticket["body"])
        self.assertIn("Der Knopf klemmt", ticket["body"])
        self.assertNotIn("{satz}", ticket["body"])
        self.assertIsNone(ticket["issue"])

    def test_new_mit_unbekannter_vorlage_bricht_ab(self):
        repo = self.github_repo()
        result = self.cli("new", "Etwas", "--template", "gibtsnicht", "--repo", repo)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekannte Vorlage", result.stderr)

    def test_new_issue_uebernimmt_titel_body_und_link(self):
        repo = self.github_repo()
        result = self.ok(
            "new",
            "--issue",
            "12",
            "--repo",
            repo,
            env=self.gh_env(GH_ISSUE_TITLE="Knopf defekt", GH_ISSUE_BODY="Schritte."),
        )
        tid = result.stdout.strip()
        ticket = self.ticket(tid)
        self.assertEqual(ticket["title"], "Knopf defekt")
        self.assertIn("Schritte.", ticket["body"])
        self.assertIn("https://github.com/test/repo/issues/12", ticket["body"])
        self.assertEqual(
            ticket["issue"],
            {
                "number": 12,
                "url": "https://github.com/test/repo/issues/12",
                "title": "Knopf defekt",
            },
        )
        created = [
            row
            for row in self.events()
            if row["kind"] == "created" and row["ticket"] == tid
        ]
        self.assertEqual(created[-1]["text"], "#12 Knopf defekt")

    def test_new_issue_geschlossen_bricht_ab(self):
        repo = self.github_repo()
        result = self.cli(
            "new", "--issue", "12", "--repo", repo,
            env=self.gh_env(GH_ISSUE_STATE="CLOSED"),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("geschlossen", result.stderr)

    def test_new_issue_ohne_gh_bricht_ab(self):
        repo = self.github_repo()
        os.unlink(os.path.join(self.bin, "gh"))
        result = self.cli("new", "--issue", "12", "--repo", repo)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gh", result.stderr)

    def test_new_issue_ohne_anmeldung_bricht_ab(self):
        repo = self.github_repo()
        result = self.cli(
            "new", "--issue", "12", "--repo", repo, env=self.gh_env(GH_AUTH_FAIL="1")
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht angemeldet", result.stderr)

    def test_new_issue_ohne_github_remote_bricht_ab(self):
        repo = self.make_repo()
        self.own_repo(repo)
        result = self.cli("new", "--issue", "12", "--repo", repo, env=self.gh_env())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("GitHub-Origin", result.stderr)

    def test_new_vorlage_und_issue_schliessen_sich_aus(self):
        repo = self.github_repo()
        result = self.cli(
            "new", "Etwas", "--template", "bug", "--issue", "12", "--repo", repo
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("schließen sich aus", result.stderr)

    def test_new_ohne_satz_und_issue_bricht_ab(self):
        repo = self.github_repo()
        result = self.cli("new", "--repo", repo)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--issue", result.stderr)

    def test_new_nimmt_satz_nach_strich(self):
        repo = self.github_repo()
        result = self.ok("new", "--", "-Wichtig", cwd=repo)
        tid = result.stdout.strip()
        self.assertEqual(self.ticket(tid)["title"], "-Wichtig")

    def test_issue_list_json_liest_stub(self):
        repo = self.github_repo()
        rows = json.loads(
            self.ok("issue", "list", "--repo", repo, "--json", env=self.gh_env()).stdout
        )
        self.assertEqual(rows[0]["number"], 12)
        self.assertEqual(rows[0]["title"], "Erster Fehler")
        self.assertEqual(
            rows[0]["url"], "https://github.com/test/repo/issues/12"
        )
        text = self.ok("issue", "list", "--repo", repo, env=self.gh_env()).stdout
        self.assertIn("#12 Erster Fehler", text)

    def test_issue_list_braucht_github_remote(self):
        repo = self.make_repo()
        result = self.cli("issue", "list", "--repo", repo, env=self.gh_env())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("GitHub-Origin", result.stderr)
