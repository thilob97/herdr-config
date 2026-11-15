#!/usr/bin/env python3
"""Regression tests for the hub bug batch: agent name vs. start command, `--since`
clamping, the compact review refusal, `spec` on closed tickets and `verify`'s message.

    python3 mods/orchestra/test/hub_bugs_test.py

Every test builds a throwaway HOME with its own ticket store and git repositories.
`hc` is a stub on PATH: `run` reports a fake terminal, `get`/`ls` answer from
$HC_GET_FILE/$HC_LS_FILE. No real Herdr window, agent or GitHub is touched.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "hub")

HC = """#!/usr/bin/env python3
import json, os, sys
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "ls":
    path = os.environ.get("HC_LS_FILE")
    if path and os.path.exists(path):
        sys.stdout.write(open(path, encoding="utf-8").read())
    else:
        print('{"terminals":[]}')
elif cmd == "get":
    path = os.environ.get("HC_GET_FILE")
    rows = json.load(open(path, encoding="utf-8")) if path and os.path.exists(path) else {}
    info = rows.get(sys.argv[2]) if len(sys.argv) > 2 else None
    if info is None:
        print("{}")
        sys.exit(1)
    print(json.dumps(info))
elif cmd == "run":
    log = os.environ.get("HC_RUN_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(" ".join(sys.argv[1:]) + "\\n")
    print('{"address":"t-new"}')
elif cmd == "send":
    log = os.environ.get("HC_SEND_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(" ".join(sys.argv[1:]) + "\\n")
sys.exit(0)
"""

APP = """#!/bin/sh
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  *) exit 0 ;;
esac
"""


class HubBugsTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-bugs-")
        self.addCleanup(shutil.rmtree, self.base, True)
        self.home = os.path.join(self.base, "home")
        self.app = os.path.join(self.base, "app")
        self.bin = os.path.join(self.base, "bin")
        self.repos = os.path.join(self.base, "repos")
        for d in (self.home, self.app, self.bin, self.repos):
            os.makedirs(d)
        for name, body in (("hc", HC), ("herdr-app", APP)):
            p = os.path.join(self.bin, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)
            os.chmod(p, 0o755)
        self.get_file = os.path.join(self.base, "hc-get.json")
        self.ls_file = os.path.join(self.base, "hc-ls.json")
        self.run_log = os.path.join(self.base, "hc-run.log")
        self.git_env = {**os.environ, "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.test",
                        "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.test"}
        self.write_json(self.get_file, {})
        self.write_json(self.ls_file, {"terminals": []})

    # ---- helpers

    def write_json(self, path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return data

    def git(self, *args, cwd):
        return subprocess.run(["git", *args], cwd=cwd, env=self.git_env,
                              capture_output=True, text=True, check=True)

    def repo(self, name="repo"):
        path = os.path.join(self.repos, name)
        os.makedirs(path)
        self.git("init", "-q", "-b", "main", cwd=path)
        with open(os.path.join(path, "f.txt"), "w", encoding="utf-8") as f:
            f.write(name + "\n")
        self.git("add", "f.txt", cwd=path)
        self.git("commit", "-q", "-m", "start", cwd=path)
        return path

    def hub(self, *args, env=None):
        e = dict(os.environ)
        e.update(HOME=self.home, HERDR_APP_HOME=self.app,
                 PATH=self.bin + os.pathsep + e.get("PATH", ""),
                 HC_GET_FILE=self.get_file, HC_LS_FILE=self.ls_file,
                 HC_RUN_LOG=self.run_log, HUB_NIGHT_STEP="0")
        e.update(env or {})
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True, env=e)

    def ticket(self, title, repo, body="", status="todo", **fields):
        r = self.hub("ticket", "new", "--title", title, "--repo", repo, "--body", body)
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = r.stdout.strip()
        pairs = [f"status={status}"] + [f"{k}={v}" for k, v in fields.items()]
        r = self.hub("ticket", "set", tid, *pairs)
        self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def criteria_ticket(self, title, repo, **fields):
        return self.ticket(title, repo, body="## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n", **fields)

    def text_of(self, tid):
        with open(os.path.join(self.app, "data", "quests", "tickets", tid + ".md"), encoding="utf-8") as f:
            return f.read()

    def meta_of(self, tid):
        m = re.match(r"^---\n(.*?)\n---\n", self.text_of(tid), re.S)
        return dict(line.split(": ", 1) for line in (m.group(1) if m else "").splitlines() if ": " in line)

    def at(self, ms):
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000))

    def events(self):
        path = os.path.join(self.app, "data", "orchestra", "events.jsonl")
        if not os.path.exists(path):
            return []
        with open(path, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    def tickets_dir(self):
        return os.path.join(self.app, "data", "quests", "tickets")

    def terminal(self, address, **info):
        try:
            with open(self.get_file, encoding="utf-8") as f:
                rows = json.load(f)
        except (OSError, ValueError):
            rows = {}
        rows[address] = info
        self.write_json(self.get_file, rows)

    def orchestrator(self, address="t-orch", **info):
        now = int(time.time() * 1000)
        self.terminal(address, labels={"hub.role": "orchestrator"}, state="live", name="orchestrator",
                      created_ms=now - 17 * 3600_000, **info)
        self.write_json(self.ls_file, {"terminals": [{"address": address,
                                                      "labels": {"hub.role": "orchestrator"}}]})
        return address

    def timeline(self, *args):
        r = self.hub("timeline", "--json", *args)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    # ---- 1: dispatch writes the display name, the command gets its own field

    def test_dispatch_writes_agent_name_and_agent_cmd(self):
        repo = self.repo()
        tid = self.criteria_ticket("Start", repo)
        r = self.hub("dispatch", tid, "--no-worktree", "--agent", "true")
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = self.meta_of(tid)
        self.assertEqual(meta["agent"], "true")
        self.assertEqual(meta["agent_cmd"], "true")

    def test_dispatch_with_a_command_keeps_it_in_agent_cmd(self):
        repo = self.repo()
        tid = self.criteria_ticket("Kommando", repo)
        r = self.hub("dispatch", tid, "--no-worktree", "--agent", "omp --model=opencode-go/x")
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = self.meta_of(tid)
        self.assertEqual(meta["agent"], "omp")
        self.assertEqual(meta["agent_cmd"], "omp --model=opencode-go/x")

    # ---- 2: old tickets with the command in `agent` read as the program

    def test_legacy_agent_command_reads_as_the_program(self):
        repo = self.repo()
        tid = self.ticket("Alt", repo, agent="omp --model=opencode-go/x --approval-mode=yolo")
        listed = self.hub("ticket", "list").stdout.splitlines()
        line = next(x for x in listed if x.startswith(tid))
        self.assertIn(" omp ", line)
        self.assertNotIn("--model", line)
        shown = self.hub("ticket", "show", tid).stdout
        self.assertIn("agent: omp\n", shown)
        self.assertNotIn("agent: omp --model", shown)

    # ---- 3: --since cuts the lanes at the window, drops subagents outside it

    def test_since_clamps_every_lane_and_filters_subagents(self):
        repo = self.repo()
        now = int(time.time() * 1000)
        orch = self.orchestrator()
        tid = self.criteria_ticket("Läuft", repo, status="doing", terminal="t-a",
                                   status_log=f"doing@{self.at(now - 16 * 3600_000)}")
        self.terminal("t-a", name="Moxie", state="live", created_ms=now - 2 * 3600_000,
                      parent=orch, status={"state": "working"})
        path = os.path.join(self.app, "data", "agent-cards", "subagents.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"id": "s-old", "title": "Alt", "started": now - 3 * 3600_000,
                                "ended": now - 3 * 3600_000, "terminal": "t-a"}) + "\n")
            f.write(json.dumps({"id": "s-new", "title": "Neu", "started": now - 30 * 60_000,
                                "ended": None, "terminal": "t-a"}) + "\n")

        report = self.timeline("--since", "1h")
        floor = report["since"]
        self.assertTrue(report["lanes"])
        for lane in report["lanes"]:
            self.assertGreaterEqual(lane["start"], floor, f"{lane['label']} beginnt vor dem Fenster")
            self.assertLessEqual(lane["start"], lane["end"])
        lane = next(l for l in report["lanes"] if l["terminal"] == "t-a")
        self.assertEqual([s["id"] for s in lane["subagents"]], ["s-new"])
        self.assertGreaterEqual(lane["subagents"][0]["started"], floor)
        self.assertTrue(all(e["at"] >= floor for e in report["events"]))
        orch_lane = next(l for l in report["lanes"] if l["kind"] == "orchestrator")
        self.assertEqual(orch_lane["start"], floor, "die Orchestrator-Lane beginnt am Fenster")

    # ---- 4: review refuses compactly, one line per missing point

    def test_review_refusal_is_short_and_names_each_gap_once(self):
        repo = self.repo()
        head = self.git("rev-parse", "HEAD", cwd=repo).stdout.strip()
        tid = self.criteria_ticket("Übergabe", repo, status="doing",
                                   checks="pass", checks_head=head, review="fail")
        r = self.hub("review", tid, "--summary", "Fertig.")
        self.assertNotEqual(r.returncode, 0)
        lines = r.stderr.splitlines()
        self.assertLessEqual(len(lines), 4, r.stderr)
        self.assertTrue(lines[0].startswith(f"hub: {tid}: Verweigert: "), lines[0])
        details = [x for x in lines[1:] if x.startswith("  ")]
        self.assertEqual(len(details), 3, r.stderr)
        self.assertEqual(len({x.split(":", 1)[0] for x in details}), 3, "jeder Punkt genau einmal")
        self.assertIn(f"hub review-start {tid}", r.stderr)
        self.assertIn(f"hub review {tid} --evidence PATH", r.stderr)
        self.assertIn("Abnahme im Verlauf", r.stderr)
        self.assertNotIn("Definition of Done", r.stderr)
        self.assertNotIn("status: review", self.text_of(tid), "das Ticket bleibt in Arbeit")

    # ---- 5: spec refuses closed tickets unless --force

    def test_spec_refuses_done_and_review_without_force(self):
        repo = self.repo()
        for status in ("done", "review"):
            with self.subTest(status=status):
                tid = self.ticket("Geschlossen", repo, body="## Ziel\n\nEtwas.\n", status=status)
                before = self.text_of(tid)
                r = self.hub("spec", tid)
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("--force", r.stderr)
                self.assertIn(status, r.stderr)
                self.assertEqual(self.text_of(tid), before, "ohne --force bleibt das Ticket unverändert")
                forced = self.hub("spec", tid, "--force")
                self.assertEqual(forced.returncode, 0, forced.stderr)
                self.assertIn("## Abnahmekriterien", self.text_of(tid))

    # ---- 6: verify names the missing repo in German, git's text stays in the log

    def test_verify_reports_a_missing_repository_without_git_noise(self):
        folder = os.path.join(self.base, "kein-repo")
        os.makedirs(folder)
        tid = self.ticket("Kein Repo", folder)
        r = self.hub("verify", tid)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("kein Git-Repository", r.stderr)
        self.assertNotIn("fatal:", r.stderr)
        text = self.text_of(tid)
        self.assertIn("## Prüfung", text, "die Prüfung zeichnet den Fehlschlag auf")
        self.assertIn("fatal:", text, "die technische Zeile steht im Log, nicht in der Meldung")
        self.assertIn("checks: fail", text)


    # ---- 7: `ticket set status` only accepts the five known stages

    def test_unknown_status_is_refused_with_the_allowed_values(self):
        repo = self.repo()
        tid = self.ticket("Status", repo)
        before = self.text_of(tid)
        r = self.hub("ticket", "set", tid, "status=weird")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("weird", r.stderr)
        for state in ("todo", "doing", "review", "done", "blocked"):
            self.assertIn(state, r.stderr)
        self.assertEqual(self.text_of(tid), before, "die Datei bleibt unverändert")
        self.assertIn(tid, self.hub("status").stdout, "das Ticket bleibt sichtbar")

    def test_every_allowed_status_is_written(self):
        repo = self.repo()
        tid = self.ticket("Alle", repo)
        for state in ("doing", "review", "blocked", "done", "todo"):
            r = self.hub("ticket", "set", tid, f"status={state}")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(self.meta_of(tid)["status"], state)

    # ---- 8: memory entries stay one short line and the file stays capped

    def test_memory_add_shortens_the_text_and_caps_the_file(self):
        repo = self.repo()
        tid = self.ticket("Gedächtnis", repo)
        r = self.hub("memory", "add", "--agent", "Ada", "--ticket", tid, "x" * 5000)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("gekürzt", r.stdout)
        path = os.path.join(self.app, "agents", "memory", "ada.md")
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
        self.assertEqual(len(lines), 1)
        entry = lines[0].rsplit(" · ", 1)[1]
        self.assertEqual(len(entry), 240, "der Text endet nach 240 Zeichen")
        self.assertTrue(entry.endswith("…"))
        self.assertLessEqual(len(lines[0].encode("utf-8")), 60 + 240 + 10,
                             "eine Zeile bleibt eine Zeile")

        # 65 old entries fall back to the newest 60.
        with open(path, "w", encoding="utf-8") as f:
            for i in range(65):
                f.write(f"- 2026-01-01 · - · alt {i}\n")
        r = self.hub("memory", "add", "--agent", "Ada", "kurz")
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(path, encoding="utf-8") as f:
            self.assertEqual(len(f.read().splitlines()), 60)

    # ---- 9: a comment event belongs to its author's lane, not the ticket's agent

    def test_comment_event_uses_the_orchestrator_terminal_only_for_that_role(self):
        repo = self.repo()
        self.orchestrator("t-orch")
        tid = self.criteria_ticket("Kommentar", repo, terminal="t-agent")
        self.terminal("t-agent", name="Moxie", state="live", labels={"hub.role": "agent"})
        r = self.hub("ticket", "comment", tid, "--from", "orchestrator", "Ich schaue nach.",
                     env={"HC_TERMINAL_ID": "t-orch"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.events()[-1]["terminal"], "t-orch")

        r = self.hub("ticket", "comment", tid, "--from", "Moxie", "Bin dran.")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.events()[-1]["terminal"], "", "der Agent hat kein Orchestrator-Terminal")

        r = self.hub("nudge", tid, "--text", "Stand?", env={"HC_TERMINAL_ID": "t-orch"})
        self.assertEqual(r.returncode, 0, r.stderr)
        nudge = next(e for e in reversed(self.events()) if e["kind"] == "nudge")
        self.assertEqual(nudge["terminal"], "t-orch", "auch die Nachfrage ist eine Orchestrator-Aktion")

    # ---- 10: `hub status` skips a file without frontmatter instead of dying

    def test_status_skips_a_broken_file_and_reports_it_once(self):
        repo = self.repo()
        tid = self.criteria_ticket("Gut", repo)
        os.makedirs(self.tickets_dir(), exist_ok=True)
        with open(os.path.join(self.tickets_dir(), "kaputt.md"), "w", encoding="utf-8") as f:
            f.write("kein frontmatter…\n")
        r = self.hub("status")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(tid, r.stdout, "das gesunde Ticket bleibt sichtbar")
        notices = [line for line in r.stderr.splitlines() if "übersprungen" in line]
        self.assertEqual(len(notices), 1, r.stderr)
        self.assertIn("1 ungültige Datei(en): kaputt", notices[0])
        self.assertNotIn("Traceback", r.stderr)

        listed = self.hub("ticket", "list")
        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertIn(tid, listed.stdout)

        shown = self.hub("ticket", "show", "kaputt")
        self.assertNotEqual(shown.returncode, 0)
        self.assertIn("Frontmatter", shown.stderr)
        self.assertNotIn("Traceback", shown.stderr)

        j = self.hub("status", "--json")
        self.assertEqual(j.returncode, 0, j.stderr)
        data = json.loads(j.stdout)
        bad = [row for row in data["tickets"] if row.get("invalid")]
        self.assertEqual([row["id"] for row in bad], ["kaputt"])
        self.assertIn(tid, [row["id"] for row in data["tickets"] if not row.get("invalid")])


    # ---- 11: `memory --repo` names an existing, writable directory, never a traceback

    def test_memory_add_on_a_missing_repo_reports_it_like_lesson(self):
        r = self.hub("memory", "add", "--repo", "/nope", "kurz")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stderr.strip(), "hub: kein Repo: /nope")
        self.assertNotIn("Traceback", r.stderr)

    def test_memory_add_on_a_read_only_repo_is_refused(self):
        if os.geteuid() == 0:
            self.skipTest("root darf in jedes Verzeichnis schreiben")
        folder = os.path.join(self.base, "read-only")
        os.makedirs(folder)
        os.chmod(folder, 0o555)
        self.addCleanup(os.chmod, folder, 0o755)
        r = self.hub("memory", "add", "--repo", folder, "kurz")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stderr.strip(), f"hub: kein Repo: {folder} (nicht schreibbar)")
        self.assertNotIn("Traceback", r.stderr)

    def test_memory_add_writes_into_a_writable_repo(self):
        repo = self.repo()
        r = self.hub("memory", "add", "--repo", repo, "kurz")
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(repo, ".herdr", "memory.md"), encoding="utf-8") as f:
            self.assertIn("· kurz", f.read())

    # ---- 12: `ticket new --title` cannot be blank

    def test_a_blank_title_creates_no_ticket(self):
        repo = self.repo()
        for title in ("", "   ", "\t"):
            with self.subTest(title=title):
                r = self.hub("ticket", "new", "--title", title, "--repo", repo)
                self.assertEqual(r.returncode, 1)
                self.assertIn("--title darf nicht leer sein", r.stderr)
                self.assertNotIn("Traceback", r.stderr)
        path = self.tickets_dir()
        self.assertEqual(os.listdir(path) if os.path.isdir(path) else [], [])

    # ---- 13: `status` shows only foreign owners; own, empty and `mensch` follow the spec

    def test_status_owner_column_hides_own_and_shows_foreign(self):
        repo = self.repo()
        self.orchestrator("t2c")
        own = self.ticket("Eigen", repo)
        foreign = self.ticket("Fremd", repo)
        self.assertEqual(self.hub("ticket", "set", foreign, "owner=t40").returncode, 0)
        empty = self.ticket("Leer", repo)
        self.assertEqual(self.hub("ticket", "set", empty, "owner=").returncode, 0)
        human = self.ticket("Mensch", repo)
        self.assertEqual(self.hub("ticket", "set", human, "owner=mensch").returncode, 0)
        r = self.hub("status", "--all", env={"HC_TERMINAL_ID": "t2c"})
        self.assertEqual(r.returncode, 0, r.stderr)
        who = {line.split()[0]: line.split()[2] for line in r.stdout.splitlines()
               if line.split() and line.split()[0] in (own, foreign, empty, human)}
        self.assertEqual(who[own], "–", "das eigene Ticket nennt keinen Besitzer")
        self.assertEqual(who[foreign], "t40", "ein fremder Orchestrator bleibt sichtbar")
        self.assertEqual(who[empty], "–")
        self.assertEqual(who[human], "mensch")

    # ---- 14: a base that is neither a branch nor a commit warns, but is still stored

    def test_an_unknown_base_warns_but_is_stored(self):
        repo = self.repo()
        tid = self.ticket("Basis", repo)
        head = self.git("rev-parse", "HEAD", cwd=repo).stdout.strip()

        r = self.hub("ticket", "set", tid, "base=unbekannt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stderr.strip(), "Basis 'unbekannt' ist im Repo nicht bekannt")
        self.assertEqual(self.meta_of(tid)["base"], "unbekannt", "der Wert wird trotzdem gesetzt")

        r = self.hub("ticket", "set", tid, "base=main")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stderr, "")

        r = self.hub("ticket", "set", tid, f"base={head}")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stderr, "", "ein Commit ist eine gültige Basis")

        r = self.hub("ticket", "set", tid, "base=")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stderr, "", "eine leere Basis räumt nur ab")


if __name__ == "__main__":
    unittest.main()
