"""Claude-Vertrauen: nur ein Schlüssel, atomar, Fehler blockieren den Start nicht."""
import json
import os
import stat

from fabric.tests.support import FabricCase

BODY = "## Ziel\nEtwas.\n\n## Abnahmekriterien\n- [ ] es läuft\n"
CLAUDE = ["claude", "--model", "opus"]


class ClaudeTrustTests(FabricCase):
    def claude_roster(self, **overrides):
        self.write_roster(
            agents=[
                {"name": "zap", "role": "umsetzer", "color": "c1",
                 "prompt": "prompts/zap.md", "argv": list(CLAUDE)},
                {"name": "ada", "role": "pruefer", "color": "c2",
                 "prompt": "prompts/ada.md", "argv": ["true"]},
            ],
            **overrides,
        )

    def prepare(self, title="Claude"):
        repo = self.make_repo()
        tid = self.new(title)
        self.ok("assign", tid, "zap", "--from", "mensch")
        self.ok("edit", tid, "--repo", repo, "--from", "mensch")
        self.ok("edit", tid, "--body", BODY, "--from", "mensch")
        return tid

    def config(self):
        with open(self.claude_json, encoding="utf-8") as handle:
            return json.load(handle)

    def test_worktree_wird_vertraut_und_fremde_felder_bleiben(self):
        self._write(
            self.claude_json,
            json.dumps(
                {
                    "numStartups": 7,
                    "oauthAccount": {"accessToken": "geheim"},
                    "projects": {
                        "/andere": {"hasTrustDialogAccepted": False, "lastCost": 3},
                    },
                },
                indent=2,
            ),
        )
        os.chmod(self.claude_json, 0o600)
        self.claude_roster()
        tid = self.prepare()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertEqual(result.stderr, "")
        worktree = os.path.realpath(self.ticket(tid)["worktree"])
        data = self.config()
        self.assertIs(data["projects"][worktree]["hasTrustDialogAccepted"], True)
        self.assertEqual(data["numStartups"], 7)
        self.assertEqual(data["oauthAccount"], {"accessToken": "geheim"})
        self.assertEqual(
            data["projects"]["/andere"],
            {"hasTrustDialogAccepted": False, "lastCost": 3},
        )
        self.assertEqual(stat.S_IMODE(os.stat(self.claude_json).st_mode), 0o600)

    def test_orchestrator_ordner_wird_vertraut(self):
        self._write(self.claude_json, json.dumps({"projects": {}}))
        os.chmod(self.claude_json, 0o600)
        self.write_roster(
            orchestrator={"argv": list(CLAUDE), "prompt": "prompts/orchestrator.md"}
        )
        self.ok("orchestrator", "start")
        folder = os.path.realpath(
            os.path.join(self.fake_home, ".herdr", "fabric-orchestrator")
        )
        self.assertIs(
            self.config()["projects"][folder]["hasTrustDialogAccepted"], True
        )

    def test_kaputtes_json_bleibt_und_warnt(self):
        broken = '{"projects": {'
        self._write(self.claude_json, broken)
        os.chmod(self.claude_json, 0o644)
        self.claude_roster()
        tid = self.prepare()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("kein gültiges JSON", result.stderr)
        self.assertEqual(self._read(self.claude_json), broken)
        self.assertEqual(stat.S_IMODE(os.stat(self.claude_json).st_mode), 0o644)
        self.assertEqual(self.ticket(tid)["status"], "doing")

    def test_fehlende_datei_warnt_und_startet(self):
        self.assertFalse(os.path.exists(self.claude_json))
        self.claude_roster()
        tid = self.prepare()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertIn("fehlt", result.stderr)
        self.assertFalse(os.path.exists(self.claude_json))
        self.assertEqual(self.ticket(tid)["status"], "doing")

    def test_nicht_claude_agent_fasst_die_datei_nicht_an(self):
        broken = '{"projects": {'
        self._write(self.claude_json, broken)
        os.chmod(self.claude_json, 0o644)
        tid = self.prepare()
        result = self.ok("dispatch", tid, "--from", "mensch")
        self.assertEqual(result.stderr, "")
        self.assertEqual(self._read(self.claude_json), broken)
        self.assertEqual(stat.S_IMODE(os.stat(self.claude_json).st_mode), 0o644)
