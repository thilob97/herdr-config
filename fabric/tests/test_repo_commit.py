"""T-63: `repo set` committet nur die geschriebene `.fabric`-Datei."""
import os

from fabric.tests.support import FabricCase

BODY = "## Ziel\nEtwas.\n\n## Abnahmekriterien\n- [ ] es läuft\n"


class RepoCommitTests(FabricCase):
    def set_repo_file(self, repo, kind, text):
        self.ok("repo", "set", repo, kind, "--text", text, "--from", "mensch")

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

    def assert_ein_commit_nur(self, repo, before, subject_praefix, datei):
        self.assertEqual(
            self.git_out(repo, "rev-list", "--count", f"{before}..HEAD"), "1"
        )
        subject, files = self.head_commit(repo)
        self.assertTrue(subject.startswith(subject_praefix), subject)
        self.assertEqual(files, [datei])

    def test_repo_set_verify_committet_nur_pruefskript(self):
        repo = self.make_repo()
        before = self.git_out(repo, "rev-parse", "HEAD")
        text = "#!/bin/sh\necho 'ok'\nexit 0\n"
        self.set_repo_file(repo, "verify", text)

        self.assert_ein_commit_nur(
            repo, before, "chore(fabric): ", ".fabric/verify.sh"
        )
        target = os.path.join(repo, ".fabric", "verify.sh")
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), text)
        self.assertEqual(
            self.git_out(repo, "ls-tree", "HEAD", ".fabric/verify.sh").split()[0],
            "100755",
        )

    def test_repo_set_lessons_committet_nur_lernnotizen(self):
        repo = self.make_repo()
        before = self.git_out(repo, "rev-parse", "HEAD")
        text = "# Lernnotizen\n- Erst prüfen.\n"
        self.set_repo_file(repo, "lessons", text)

        self.assert_ein_commit_nur(
            repo, before, "chore(fabric): ", ".fabric/lessons.md"
        )
        target = os.path.join(repo, ".fabric", "lessons.md")
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), text)

    def test_repo_set_project_committet_nur_steckbrief(self):
        repo = self.make_repo()
        before = self.git_out(repo, "rev-parse", "HEAD")
        text = "# Steckbrief\nZweck.\n"
        self.set_repo_file(repo, "project", text)

        self.assert_ein_commit_nur(
            repo, before, "chore(fabric): ", ".fabric/project.md"
        )
        target = os.path.join(repo, ".fabric", "project.md")
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), text)

    def test_fremde_aenderungen_bleiben_unberuehrt(self):
        repo = self.make_repo()
        readme = os.path.join(repo, "README.md")
        self.write_file(readme, "start\nfremd\n")
        fremd = os.path.join(repo, "fremd.txt")
        self.write_file(fremd, "gestagt\n")
        added = self.git(repo, "add", "fremd.txt")
        self.assertEqual(added.returncode, 0, added.stderr)
        notiz = os.path.join(repo, "notiz.txt")
        self.write_file(notiz, "offen\n")

        status_before = self.git_out(
            repo, "status", "--porcelain", "--untracked-files=all"
        )
        before = self.git_out(repo, "rev-parse", "HEAD")
        self.set_repo_file(repo, "project", "# Steckbrief\nZweck.\n")

        self.assert_ein_commit_nur(
            repo, before, "chore(fabric): ", ".fabric/project.md"
        )
        self.assertEqual(
            self.git_out(repo, "status", "--porcelain", "--untracked-files=all"),
            status_before,
        )
        self.assertEqual(
            self.git_out(repo, "diff", "--cached", "--name-only"), "fremd.txt"
        )
        self.assertTrue(os.path.isfile(notiz))
        self.assertIn(
            "README.md", self.git_out(repo, "diff", "--name-only").splitlines()
        )

    def test_auf_anderem_branch_wird_nur_geschrieben(self):
        repo = self.make_repo()
        self.git_out(repo, "checkout", "-q", "-b", "seitlich")
        before = self.git_out(repo, "rev-parse", "HEAD")
        self.set_repo_file(repo, "lessons", "- Eine Lehre.\n")

        target = os.path.join(repo, ".fabric", "lessons.md")
        self.assertTrue(os.path.isfile(target))
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "- Eine Lehre.\n")
        self.assertEqual(self.git_out(repo, "rev-parse", "HEAD"), before)
        status = self.git_out(
            repo, "status", "--porcelain", "--untracked-files=all"
        )
        self.assertIn(".fabric/lessons.md", status)

    def test_neuer_worktree_erbt_bestaetigte_lehre(self):
        repo, tid, _worktree = self.ready_ticket()
        self.ok(
            "lesson", "propose", tid, "Erst prüfen, dann mergen.", "--from", "ada"
        )
        self.ok("lesson", "confirm", tid, "L1", "--from", "mensch")

        other = self.new("Zweites", repo=repo)
        self.ok("assign", other, "zap", "--from", "mensch")
        self.ok("edit", other, "--repo", repo, "--from", "mensch")
        self.ok("edit", other, "--body", BODY, "--from", "mensch")
        self.ok("dispatch", other, "--from", "mensch")
        second = self.ticket(other)["worktree"]

        target = os.path.join(second, ".fabric", "lessons.md")
        self.assertTrue(os.path.isfile(target))
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "- Erst prüfen, dann mergen.\n")
