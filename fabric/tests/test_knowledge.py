"""T-107: Wissensordner `.fabric/knowledge/` im Repo."""
import json
import os

from fabric.tests.support import FabricCase


class KnowledgeTests(FabricCase):
    def head_commit(self, repo):
        """(Betreff, Dateiliste) des HEAD-Commits."""
        lines = [
            line
            for line in self.git_out(
                repo, "show", "--name-only", "--format=%s", "HEAD"
            ).splitlines()
            if line.strip()
        ]
        return lines[0], lines[1:]

    def count(self, repo):
        return int(self.git_out(repo, "rev-list", "--count", "HEAD"))

    def source(self, name="x.pdf", content=b"%PDF-1.4\nHallo\n"):
        path = os.path.join(self.tmp, "quellen", name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(content)
        return path

    def target(self, repo, name):
        return os.path.join(repo, ".fabric", "knowledge", name)

    def test_add_kopiert_binaer_und_committet_genau_die_datei(self):
        repo = self.make_repo()
        content = b"%PDF-1.4\nNi\xc3\x9f\n\x00\x01\x02"
        source = self.source(content=content)
        before = self.count(repo)

        result = self.ok("knowledge", "add", repo, source, "--from", "mensch")
        target = self.target(repo, "x.pdf")
        self.assertIn(target, result.stdout)
        with open(target, "rb") as handle:
            self.assertEqual(handle.read(), content)
        self.assertEqual(self.count(repo), before + 1)
        subject, files = self.head_commit(repo)
        self.assertEqual(subject, "chore(fabric): Wissensdatei x.pdf hinzugefügt")
        self.assertEqual(files, [".fabric/knowledge/x.pdf"])

    def test_list_zeigt_name_groesse_und_typ_in_text_und_json(self):
        repo = self.make_repo()
        source = self.source(content=b"1234567890")
        self.ok("knowledge", "add", repo, source, "--from", "mensch")
        self.ok(
            "knowledge", "note", repo, "notiz", "--text", "Kurz.\n",
            "--from", "mensch",
        )

        text = self.ok("knowledge", "list", repo).stdout
        self.assertIn("x.pdf · 10 · PDF", text)
        self.assertIn("notiz.md · 6 · Notiz", text)
        rows = json.loads(self.ok("knowledge", "list", repo, "--json").stdout)
        self.assertEqual(
            rows,
            [
                {"name": "notiz.md", "size": 6, "kind": "Notiz"},
                {"name": "x.pdf", "size": 10, "kind": "PDF"},
            ],
        )

    def test_note_legt_md_an_und_committet(self):
        repo = self.make_repo()
        before = self.count(repo)
        result = self.ok(
            "knowledge", "note", repo, "handbuch", "--text", "Inhalt der Notiz.\n",
            "--from", "mensch",
        )
        target = self.target(repo, "handbuch.md")
        self.assertIn(target, result.stdout)
        self.assertEqual(self._read(target), "Inhalt der Notiz.\n")
        self.assertEqual(self.count(repo), before + 1)
        subject, files = self.head_commit(repo)
        self.assertEqual(subject, "chore(fabric): Wissensnotiz handbuch.md angelegt")
        self.assertEqual(files, [".fabric/knowledge/handbuch.md"])

    def test_rm_loescht_und_committet(self):
        repo = self.make_repo()
        source = self.source()
        self.ok("knowledge", "add", repo, source, "--from", "mensch")
        before = self.count(repo)

        result = self.ok("knowledge", "rm", repo, "x.pdf", "--from", "mensch")
        self.assertIn("x.pdf", result.stdout)
        self.assertFalse(os.path.exists(self.target(repo, "x.pdf")))
        self.assertEqual(self.count(repo), before + 1)
        subject, files = self.head_commit(repo)
        self.assertEqual(subject, "chore(fabric): Wissensdatei x.pdf entfernt")
        self.assertEqual(files, [".fabric/knowledge/x.pdf"])
        self.assertIn(
            "D\t.fabric/knowledge/x.pdf",
            self.git_out(repo, "show", "--name-status", "--format=", "HEAD"),
        )

    def test_namen_mit_schraegstrich_punktpunkt_und_fuehrendem_punkt_werden_abgelehnt(self):
        repo = self.make_repo()
        source = self.source()
        before = self.count(repo)
        for name in ("a/b.pdf", "a..pdf", ".geheim"):
            result = self.cli(
                "knowledge", "add", repo, source, "--name", name,
                "--from", "mensch",
            )
            self.assertNotEqual(result.returncode, 0, name)
            self.assertIn("Name", result.stderr, name)
            self.assertFalse(os.path.lexists(self.target(repo, name)), name)
        self.assertEqual(self.count(repo), before)

    def test_zu_grosse_datei_wird_abgelehnt(self):
        repo = self.make_repo()
        source = self.source("gross.bin", content=b"")
        with open(source, "wb") as handle:
            handle.truncate(20 * 1024 * 1024 + 1)
        before = self.count(repo)
        result = self.cli(
            "knowledge", "add", repo, source, "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("20 MB", result.stderr)
        self.assertFalse(os.path.lexists(self.target(repo, "gross.bin")))
        self.assertEqual(self.count(repo), before)

    def test_vorhandener_name_ohne_force_bleibt_unveraendert_und_force_ueberschreibt(self):
        repo = self.make_repo()
        first = self.source(content=b"eins\n")
        self.ok("knowledge", "add", repo, first, "--from", "mensch")
        before = self.count(repo)
        second = self.source("neu.pdf", content=b"zwei\n")
        target = self.target(repo, "x.pdf")

        result = self.cli(
            "knowledge", "add", repo, second, "--name", "x.pdf",
            "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("existiert schon; --force überschreibt", result.stderr)
        with open(target, "rb") as handle:
            self.assertEqual(handle.read(), b"eins\n")
        self.assertEqual(self.count(repo), before)

        self.ok(
            "knowledge", "add", repo, second, "--name", "x.pdf", "--force",
            "--from", "mensch",
        )
        with open(target, "rb") as handle:
            self.assertEqual(handle.read(), b"zwei\n")
        self.assertEqual(self.count(repo), before + 1)
        subject, files = self.head_commit(repo)
        self.assertEqual(subject, "chore(fabric): Wissensdatei x.pdf hinzugefügt")
        self.assertEqual(files, [".fabric/knowledge/x.pdf"])

    def test_name_setzt_den_zielnamen(self):
        repo = self.make_repo()
        source = self.source("original.bin", content=b"inhalt")
        self.ok(
            "knowledge", "add", repo, source, "--name", "ziel.dat",
            "--from", "mensch",
        )
        self.assertTrue(os.path.isfile(self.target(repo, "ziel.dat")))
        self.assertFalse(os.path.exists(self.target(repo, "original.bin")))
