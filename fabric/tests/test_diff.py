"""`fab diff`: Dateien, Commits, Nachweise und Datei-Diff eines Tickets."""
import json
import os

from fabric.tests.support import FabricCase


class DiffTests(FabricCase):
    def changes(self):
        repo, tid, worktree = self.ready_ticket()
        self.commit_in(worktree, "aenderung.txt", "inhalt\n")
        self.commit_in(worktree, "zweite.txt", "eins\nzwei\n")
        self.commit_in(worktree, "README.md", "geändert\n")
        ticket = self.ticket(tid)
        return repo, tid, worktree, ticket

    def test_json_dateien_commits_und_head(self):
        repo, tid, worktree, ticket = self.changes()
        result = self.ok("diff", tid, "--json")
        data = json.loads(result.stdout)
        self.assertEqual(data["id"], tid)
        self.assertEqual(data["base"], "main")
        self.assertEqual(data["branch"], ticket["branch"])
        self.assertEqual(
            data["head"], self.git_out(worktree, "rev-parse", "HEAD")
        )
        self.assertEqual(len(data["head"]), 40)
        self.assertEqual(
            data["merge_base"],
            self.git_out(repo, "merge-base", "main", ticket["branch"]),
        )

        files = {item["path"]: item for item in data["files"]}
        self.assertEqual(files["aenderung.txt"]["added"], 1)
        self.assertEqual(files["aenderung.txt"]["deleted"], 0)
        self.assertFalse(files["aenderung.txt"]["binary"])
        self.assertEqual(files["zweite.txt"]["added"], 2)
        self.assertEqual(files["zweite.txt"]["deleted"], 0)
        self.assertEqual(files["README.md"]["added"], 1)
        self.assertEqual(files["README.md"]["deleted"], 1)
        self.assertFalse(files["README.md"]["binary"])

        self.assertEqual(len(data["commits"]), 3)
        self.assertEqual(
            [commit["subject"] for commit in data["commits"]],
            [
                "ändere README.md",
                "ändere zweite.txt",
                "ändere aenderung.txt",
            ],
        )
        for commit in data["commits"]:
            self.assertEqual(len(commit["hash"]), 40)
            self.assertTrue(commit["short"])
            self.assertEqual(commit["author"], "Test")
            self.assertTrue(commit["at"])

    def test_anhang_erscheint_als_nachweis(self):
        repo, tid, worktree, _ = self.changes()
        source = os.path.join(self.tmp, "bild.png")
        with open(source, "wb") as handle:
            handle.write(b"png-anhang")
        self.ok("attach", tid, source, "--no-edit")
        self.add_events(
            [
                {
                    "kind": "handover",
                    "ticket": tid,
                    "text": f"Siehe data/fabric/attachments/{tid}/bild.png",
                }
            ]
        )

        data = json.loads(self.ok("diff", tid, "--json").stdout)
        proofs = [item for item in data["proofs"] if item["kind"] == "attachment"]
        self.assertEqual(len(proofs), 1)
        self.assertEqual(
            sum(1 for item in data["proofs"] if item["path"] == proofs[0]["path"]),
            1,
            "derselbe Nachweis aus Anhang und Handover erscheint einmal",
        )
        proof = proofs[0]
        self.assertEqual(proof["name"], "bild.png")
        self.assertTrue(proof["image"])
        self.assertTrue(proof["exists"])
        self.assertTrue(os.path.isabs(proof["path"]))
        self.assertTrue(proof["path"].endswith(os.path.join("attachments", tid, "bild.png")))

    def test_handover_nennt_bild_und_datei(self):
        repo, tid, worktree, _ = self.changes()
        folder = os.path.join(worktree, "docs")
        os.makedirs(folder)
        with open(os.path.join(folder, "beweis.png"), "wb") as handle:
            handle.write(b"\x89PNG\r\n\x1a\nbeweis")
        with open(os.path.join(worktree, "neu.js"), "w", encoding="utf-8") as handle:
            handle.write("export const neu = true;\n")
        self.add_events(
            [
                {
                    "kind": "handover",
                    "ticket": tid,
                    "text": "Beweis: docs/beweis.png und mods/fabric/main.js, neu.js",
                }
            ]
        )

        data = json.loads(self.ok("diff", tid, "--json").stdout)
        proofs = {item["name"]: item for item in data["proofs"] if item["kind"] == "handover"}
        self.assertIn("beweis.png", proofs)
        self.assertIn("main.js", proofs)
        self.assertIn("neu.js", proofs)
        self.assertTrue(proofs["neu.js"]["exists"])
        image = proofs["beweis.png"]
        self.assertTrue(image["image"])
        self.assertTrue(image["exists"])
        self.assertTrue(os.path.isabs(image["path"]))
        self.assertTrue(image["path"].endswith(os.path.join("docs", "beweis.png")))
        self.assertEqual(image["path"], os.path.join(worktree, "docs", "beweis.png"))
        code = proofs["main.js"]
        self.assertFalse(code["image"])
        self.assertFalse(code["exists"])
        self.assertEqual(code["path"], "mods/fabric/main.js")

    def test_file_zeigt_nur_diese_datei(self):
        repo, tid, worktree, ticket = self.changes()
        plain = self.ok("diff", tid, "--file", "README.md")
        expected = self.git_out(
            repo,
            "diff",
            "--no-color",
            "--no-ext-diff",
            f"main...{ticket['branch']}",
            "--",
            "README.md",
        )
        self.assertEqual(plain.stdout, expected + "\n")
        self.assertIn("-start", plain.stdout)
        self.assertIn("+geändert", plain.stdout)

        packed = json.loads(self.ok("diff", tid, "--json", "--file", "README.md").stdout)
        self.assertEqual(packed["path"], "README.md")
        self.assertEqual(packed["diff"], expected + "\n")

    def test_ticket_ohne_basis_meldet_fehler(self):
        tid = self.new("Ohne Disposition")
        result = self.cli("diff", tid, "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Fehler:", result.stderr)

    def test_menschliche_ausgabe_nennt_abschnitte(self):
        repo, tid, worktree, _ = self.changes()
        output = self.ok("diff", tid).stdout
        self.assertIn(f"{tid}: ", output)
        self.assertIn("(HEAD ", output)
        self.assertIn("Dateien:", output)
        self.assertIn("Commits:", output)
        self.assertIn("Nachweise:", output)
        self.assertIn("+1 -1 README.md", output)
        self.assertIn("ändere README.md (Test)", output)
        self.assertIn("keine", output)
