"""Tests für `fab map`: Projektkarte aus Git und Dateisystem."""
import os

from fabric.tests.support import FabricCase


class MapTest(FabricCase):
    def _repo(self):
        repo = self.make_repo()
        os.makedirs(os.path.join(repo, "modul"))
        self.write_file(os.path.join(repo, "modul", "mod.json"), '{"name": "modul"}\n')
        script = os.path.join(repo, "werkzeug.sh")
        self.write_file(script, "#!/bin/sh\necho ok\n")
        os.chmod(script, 0o755)
        self.write_file(
            os.path.join(repo, ".fabric", "pipeline.json"),
            '{"steps": [{"name": "unit", "run": "python3 -m unittest"}]}\n',
        )
        self.write_file(os.path.join(repo, "geheim.txt"), "nicht getrackt\n")
        self.git_out(repo, "add", "modul/mod.json", "werkzeug.sh",
                     ".fabric/pipeline.json")
        self.git_out(repo, "commit", "-qm", "inhalt")
        return repo

    def test_map_schreibt_und_committet_genau_die_karte(self):
        repo = self._repo()
        result = self.ok("map", repo, "--from", "orchestrator")
        self.assertIn("geschrieben", result.stdout)
        text = self._read(os.path.join(repo, ".fabric", "map.md"))
        for heading in (
            "# Projektkarte",
            "## Struktur",
            "## Module",
            "## Einstiegspunkte",
            "## Testbefehle",
        ):
            self.assertIn(heading, text)
        self.assertIn("modul/", text)
        self.assertIn("mod.json", text)
        self.assertIn("`werkzeug.sh` (ausführbar)", text)
        self.assertIn("python3 -m unittest", text)
        self.assertNotIn("geheim.txt", text)
        self.assertEqual(
            self.git_out(repo, "show", "--name-only", "--format=", "HEAD"),
            ".fabric/map.md",
        )

    def test_zweiter_lauf_bleibt_unveraendert(self):
        repo = self._repo()
        self.ok("map", repo)
        head = self.git_out(repo, "rev-parse", "HEAD")
        count = self.git_out(repo, "rev-list", "--count", "HEAD")
        result = self.ok("map", repo)
        self.assertIn("unverändert", result.stdout)
        self.assertEqual(self.git_out(repo, "rev-parse", "HEAD"), head)
        self.assertEqual(self.git_out(repo, "rev-list", "--count", "HEAD"), count)

    def test_verify_sh_ist_der_fallback(self):
        repo = self.make_repo("fallback")
        self.write_file(os.path.join(repo, ".fabric", "verify.sh"),
                        "#!/bin/sh\nexit 0\n")
        self.git_out(repo, "add", ".fabric/verify.sh")
        self.git_out(repo, "commit", "-qm", "pruefskript")
        self.ok("map", repo)
        text = self._read(os.path.join(repo, ".fabric", "map.md"))
        self.assertIn("sh .fabric/verify.sh", text)

    def test_fabric_symlink_wird_abgelehnt(self):
        repo = self.make_repo("symlink")
        outside = os.path.join(self.tmp, "aussen")
        os.makedirs(outside)
        os.symlink(outside, os.path.join(repo, ".fabric"))
        result = self.cli("map", repo)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".fabric", result.stderr)
        self.assertFalse(os.path.exists(os.path.join(outside, "map.md")))
