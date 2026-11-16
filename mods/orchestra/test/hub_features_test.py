#!/usr/bin/env python3
"""Regression tests for `hub triage`, `hub preflight`, `hub stalls`/`hub nudge`,
`hub night` and `hub memory`.

    python3 mods/orchestra/test/hub_features_test.py

Every test builds a throwaway HOME with its own ticket store and git repositories;
`hc` is a stub on PATH: `run` reports a fake terminal (and logs its argv), `get`
reports live only with HC_LIVE=1, `send` logs to HC_SEND_LOG. No real Herdr window,
agent or GitHub is touched.
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

HC = """#!/bin/sh
case "$1" in
  ls) echo '{"terminals":[]}' ;;
  get)
    if [ "$HC_LIVE" = "1" ]; then echo '{"state":"live"}'; else echo '{}'; exit 1; fi ;;
  run)
    if [ -n "$HC_RUN_LOG" ]; then printf '%s\\n' "$*" >> "$HC_RUN_LOG"; fi
    echo '{"address":"t-demo"}' ;;
  send)
    if [ -n "$HC_SEND_LOG" ]; then printf '%s\\n' "$*" >> "$HC_SEND_LOG"; fi ;;
  exec)
    # `hc exec --on M --timeout N [--cwd P] [--env K=V] [--json] [-i] ARGV...`: the stub
    # logs the whole call and runs ARGV here, so a "remote" ticket stays a local test.
    shift
    if [ -n "$HC_EXEC_LOG" ]; then printf '%s\\n' "$*" >> "$HC_EXEC_LOG"; fi
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --on|--timeout|--cwd|--env) shift 2 ;;
        --json|-i|--stdin) shift ;;
        *) break ;;
      esac
    done
    exec "$@" ;;
  *) exit 0 ;;
esac
"""

APP = """#!/bin/sh
case "$1" in
  ls) echo '{"spaces":[]}' ;;
  *) exit 0 ;;
esac
"""


class HubFeaturesTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-features-")
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
        self.run_log = os.path.join(self.base, "hc-run.log")
        self.send_log = os.path.join(self.base, "hc-send.log")
        self.exec_log = os.path.join(self.base, "hc-exec.log")
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

    def verify_repo(self, name="repo", code=0, line="verify-ok"):
        path = self.repo(name)
        os.makedirs(os.path.join(path, ".herdr"))
        with open(os.path.join(path, ".herdr", "verify.sh"), "w", encoding="utf-8") as f:
            f.write(f"#!/bin/sh\necho {line}\nexit {code}\n")
        self.git("add", ".herdr/verify.sh", cwd=path)
        self.git("commit", "-q", "-m", "verify", cwd=path)
        return path

    def hub(self, *args, app=None, env=None):
        e = dict(os.environ)
        e.update(HOME=self.home, HERDR_APP_HOME=app or self.app,
                 PATH=self.bin + os.pathsep + e.get("PATH", ""),
                 HC_RUN_LOG=self.run_log, HC_SEND_LOG=self.send_log,
                 HC_EXEC_LOG=self.exec_log)
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

    def stalled(self, title, repo, status, minutes):
        tid = self.ticket(title, repo, status=status)
        r = self.hub("ticket", "set", tid, f"status_at={self.old(minutes)}")
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

    def lines_of(self, path):
        try:
            with open(path, encoding="utf-8") as f:
                return [line for line in f.read().splitlines() if line.strip()]
        except OSError:
            return []

    # ---- triage

    def test_triage_classifies_bug_feature_chore(self):
        repo = self.repo()
        bug = self.ticket("Absturz beim Start", repo, body="Die App zeigt einen Fehler und stürzt ab.\n")
        feat = self.ticket("Neue Suche", repo, body="Eine Suche über alle Boards.\n")
        chore = self.ticket("Docs aufräumen", repo, body="Doku und CI kürzen.\n")

        rows = {tid: json.loads(self.hub("triage", tid, "--json").stdout) for tid in (bug, feat, chore)}
        self.assertEqual(rows[bug]["type"], "bug")
        self.assertEqual(rows[bug]["priority"], "p1")
        self.assertEqual(rows[feat]["type"], "feature")
        self.assertEqual(rows[feat]["priority"], "p2")
        self.assertEqual(rows[chore]["type"], "chore")
        self.assertEqual(rows[feat]["size"], "S", "kurzer Text ist klein")

    def test_triage_preview_changes_nothing_and_apply_completes_spec(self):
        repo = self.repo()
        tid = self.ticket("Fehler: kaputt", repo, body="## Ziel\n\nBestehendes Ziel.\n")
        before = self.text_of(tid)

        r = self.hub("triage", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Nur Vorschlag", r.stdout)
        self.assertEqual(self.text_of(tid), before, "ohne --apply bleibt das Ticket unverändert")

        r = self.hub("triage", tid, "--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        text = self.text_of(tid)
        self.assertIn("type: bug", text)
        self.assertIn("size: S", text)
        self.assertIn("priority: p2", text)
        self.assertIn("labels: bug, size-s, p2", text)
        self.assertIn("triaged: ", text)
        self.assertEqual(text.count("## Ziel"), 1, "vorhandenes Ziel bleibt")
        self.assertIn("Bestehendes Ziel.", text)
        self.assertIn("## Abnahmekriterien", text)
        self.assertIn("## Grenzen", text)

    def test_dispatch_refuses_source_without_triage(self):
        repo = self.verify_repo()
        body = "## Abnahmekriterien\n\n- [ ] Die Tür schließt.\n"
        tid = self.ticket("Signal", repo, body=body, source="https://github.com/o/r/issues/1")

        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("triage", r.stderr)
        self.assertIn(f"hub triage {tid}", r.stderr)
        self.assertIn("status: todo", self.text_of(tid))

        self.assertEqual(self.hub("triage", tid, "--apply").returncode, 0)
        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("status: doing", self.text_of(tid))

    def test_dispatch_records_base_and_base_head(self):
        repo = self.verify_repo("basis")
        head = self.git("rev-parse", "HEAD", cwd=repo).stdout.strip()
        tid = self.criteria_ticket("Basis", repo)

        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = self.meta_of(tid)
        self.assertEqual(meta.get("base"), "main", "die Basis steht im Frontmatter")
        self.assertEqual(meta.get("base_head"), head, "der Basis-Commit beim Start steht im Frontmatter")
        self.assertEqual(meta.get("repo"), repo)

    def test_roster_sandbox_repo_starts_without_a_worktree(self):
        repo = self.verify_repo("sandbox")
        r = self.hub("agent", "add", "Neo", "--program", "omp", "--repo", repo, "--sandbox", "repo",
                        "--prompt", "Du baust.")
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = self.criteria_ticket("Ohne Worktree", repo)

        r = self.hub("dispatch", tid, "--agent", "Neo")
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = self.meta_of(tid)
        self.assertEqual(meta.get("repo"), repo)
        self.assertNotIn("branch", meta, "sandbox=repo arbeitet ohne Worktree-Branch")
        self.assertNotIn("worktree", meta, "sandbox=repo arbeitet ohne Worktree")

    def test_agent_max_cost_can_be_cleared(self):
        r = self.hub("agent", "add", "Neo", "--program", "omp", "--max-cost", "5")
        self.assertEqual(r.returncode, 0, r.stderr)
        row = json.loads(self.hub("agent", "show", "Neo", "--json").stdout)
        self.assertEqual(row["harness"]["max_cost"], 5)
        self.assertIn("max_cost", row["harness_keys"])
        self.assertIn("--max-cost=5", self.hub("agent", "command", "Neo").stdout)

        r = self.hub("agent", "edit", "Neo", "--max-cost", "")
        self.assertEqual(r.returncode, 0, f"leeres --max-cost entfernt das Limit: {r.stderr}")
        row = json.loads(self.hub("agent", "show", "Neo", "--json").stdout)
        self.assertEqual(row["harness"]["max_cost"], 0, "0 = unbegrenzt")
        self.assertNotIn("--max-cost", self.hub("agent", "command", "Neo").stdout)

    def test_agent_harness_keys_follow_the_program(self):
        self.assertEqual(self.hub("agent", "add", "Claude", "--program", "claude").returncode, 0)
        row = json.loads(self.hub("agent", "list", "--json").stdout)[0]
        self.assertEqual(row["harness_keys"], ["model", "approval_mode"])
        self.assertNotIn("max_cost", row["harness_keys"])

    # ---- preflight

    def test_preflight_green_and_red_record_the_section(self):
        green = self.verify_repo("green")
        ok_tid = self.ticket("Grün", green, base="main")
        r = self.hub("preflight", ok_tid, "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["preflight"], "pass")
        self.assertIn("verify-ok", out["tail"])
        text = self.text_of(ok_tid)
        self.assertIn("preflight: pass", text)
        self.assertIn("preflight_head: ", text)
        self.assertIn("## Preflight", text)
        self.assertIn("verify-ok", text)

        red = self.verify_repo("red", code=1, line="kaputt")
        bad_tid = self.ticket("Rot", red, base="main")
        r = self.hub("preflight", bad_tid, "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["preflight"], "fail")
        self.assertIn("kaputt", self.text_of(bad_tid))
        self.assertIn("preflight: fail", self.text_of(bad_tid))

    def test_preflight_uses_the_ticket_verify_field_as_fallback(self):
        repo = self.repo()  # no .herdr/verify.sh
        tid = self.ticket("Feld", repo, base="main", verify="echo field-ok")
        r = self.hub("preflight", tid, "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["preflight"], "pass")
        self.assertIn("field-ok", self.text_of(tid))

    def test_dispatch_refuses_red_preflight_with_output(self):
        repo = self.verify_repo("red2", code=1, line="kaputt")
        tid = self.criteria_ticket("Rot", repo, base="main")
        self.assertEqual(self.hub("preflight", tid).returncode, 0)

        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Preflight rot", r.stderr)
        self.assertIn("kaputt", r.stderr, "die Ausgabe steht in der Meldung")
        self.assertIn("status: todo", self.text_of(tid), "kein Start auf roter Basis")

    def test_dispatch_runs_missing_preflight(self):
        repo = self.verify_repo("auto")
        tid = self.criteria_ticket("Auto", repo, base="main")
        self.assertNotIn("preflight:", self.text_of(tid))

        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Preflight pass — gestartet", r.stdout)
        self.assertIn("preflight: pass", self.text_of(tid))
        self.assertIn("status: doing", self.text_of(tid))

    def test_remote_verify_and_preflight_use_a_long_timeout(self):
        repo = self.verify_repo("remote", line="remote-ok")
        tid = self.ticket("Fern", repo, base="main", machine="box")

        r = self.hub("preflight", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = self.hub("verify", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        runs = self.lines_of(self.exec_log)
        self.assertTrue(any("--timeout 600" in line for line in runs),
                        "verify/preflight geben hc exec mehr als die 60 s: " + repr(runs[:5]))
        meta = self.meta_of(tid)
        self.assertEqual(meta.get("preflight"), "pass")
        self.assertEqual(meta.get("checks"), "pass")

    def test_a_heading_in_the_output_does_not_end_the_sections(self):
        repo = self.repo("heads")
        os.makedirs(os.path.join(repo, ".herdr"))
        with open(os.path.join(repo, ".herdr", "verify.sh"), "w", encoding="utf-8") as f:
            f.write("#!/bin/sh\nprintf '## Kaputt\\nzeile\\n'\n")
        self.git("add", ".herdr/verify.sh", cwd=repo)
        self.git("commit", "-q", "-m", "verify", cwd=repo)
        tid = self.criteria_ticket("Kopf", repo)

        r = self.hub("verify", tid)
        self.assertEqual(r.returncode, 0, r.stderr)
        text = self.text_of(tid)
        self.assertEqual(text.count("## Prüfung"), 1, "die Ausgabe beendet den Abschnitt nicht")
        self.assertIn("\n ## Kaputt\n", text, "die Zeile steht entschärft im Ticket")
        g = json.loads(self.hub("gate", tid, "--json").stdout)
        self.assertEqual(g["tail"][-2:], ["## Kaputt", "zeile"], "der Leser sieht die ganze Ausgabe")

    # ---- stalls and nudge

    def old(self, minutes):
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(time.time() - minutes * 60))

    def test_stalls_groups_each_stage_and_ignores_fresh_tickets(self):
        repo = self.repo()
        doing = self.stalled("Alt in Arbeit", repo, "doing", 60)
        review = self.stalled("Alt in Prüfung", repo, "review", 180)
        todo = self.stalled("Alt geplant", repo, "todo", 2000)
        fresh = self.stalled("Frisch", repo, "doing", 5)

        rows = json.loads(self.hub("stalls", "--json").stdout)
        by_id = {r["id"]: r for r in rows}
        self.assertEqual(set(by_id), {doing, review, todo})
        self.assertEqual(by_id[doing]["stage"], "doing")
        self.assertEqual(by_id[review]["stage"], "review")
        self.assertEqual(by_id[todo]["stage"], "todo")
        self.assertNotIn(fresh, by_id, "unter der Schwelle bleibt still")
        self.assertEqual(by_id[doing]["nudge"], f"hub nudge {doing}")

        text = self.hub("stalls").stdout
        for label in ("In Arbeit", "Prüfung", "Geplant"):
            self.assertIn(label, text, "gruppiert nach Stufe")

    def test_nudge_comments_always_and_sends_only_to_a_live_agent(self):
        repo = self.repo()
        dead = self.ticket("Tot", repo, status="doing", terminal="t-dead")
        r = self.hub("nudge", dead)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("nur Kommentar", r.stdout)
        self.assertIn("Stand abgefragt", self.text_of(dead))
        self.assertEqual(self.lines_of(self.send_log), [], "kein lebender Agent, keine Nachricht")

        live = self.ticket("Lebt", repo, status="doing", terminal="t-live")
        r = self.hub("nudge", live, "--text", "Wie weit?", env={"HC_LIVE": "1"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("gesendet", r.stdout)
        self.assertIn("Stand abgefragt: Wie weit?", self.text_of(live))
        sent = self.lines_of(self.send_log)
        self.assertEqual(len(sent), 1)
        self.assertIn("t-live", sent[0])
        self.assertIn("Wie weit?", sent[0])

    # ---- night

    def test_night_dry_run_shows_order_without_changes(self):
        repo = self.verify_repo("dry")
        later = self.criteria_ticket("Alpha", repo)
        first = self.criteria_ticket("Beta", repo, priority="p1")

        r = self.hub("night", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Reihenfolge", r.stdout)
        self.assertLess(r.stdout.index(first), r.stdout.index(later), "p1 zuerst")
        for tid in (later, first):
            self.assertIn("status: todo", self.text_of(tid))
            self.assertNotIn("## Nachtschicht", self.text_of(tid))

    def test_night_max_respects_wip_and_records_the_reasons(self):
        repo = self.verify_repo("night")
        self.assertEqual(self.hub("wip", "arbeit=1").returncode, 0)
        alpha = self.criteria_ticket("Alpha", repo)
        beta = self.criteria_ticket("Beta", repo)
        without = self.ticket("Ohne Kriterien", repo, body="## Ziel\n\nEtwas.\n")

        r = self.hub("night", "--max", "2", "--for", "5", env={"HUB_NIGHT_STEP": "0"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"gestartet: {alpha}", r.stdout)
        self.assertNotIn(f"gestartet: {beta}", r.stdout, "WIP-Limit hält das zweite Ticket")
        self.assertIn("1 gestartet", r.stdout)
        self.assertIn("status: doing", self.text_of(alpha))
        self.assertIn("status: todo", self.text_of(beta))

        text = self.text_of(alpha)
        self.assertIn("## Nachtschicht", text)
        self.assertIn("1 gestartet", text)
        self.assertIn(f"übersprungen {beta}: WIP-Limit", text)
        self.assertIn(f"übersprungen {without}: kein Abnahmekriterium", text)

    # ---- memory

    def test_memory_add_list_and_line_cap(self):
        for i in range(65):
            r = self.hub("memory", "add", "--agent", "omp", "--ticket", "t1", f"Lektion {i}")
            self.assertEqual(r.returncode, 0, r.stderr)
        path = os.path.join(self.app, "agents", "memory", "omp.md")
        self.assertTrue(os.path.exists(path))
        lines = self.lines_of(path)
        self.assertEqual(len(lines), 60, "nie mehr als 60 Zeilen")
        self.assertNotIn("Lektion 0", "\n".join(lines), "die ältesten fallen raus")
        self.assertIn("Lektion 64", "\n".join(lines))
        self.assertRegex(lines[-1], r"^- \d{4}-\d{2}-\d{2} · t1 · Lektion 64$")

        r = self.hub("memory", "list", "--agent", "omp")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Lektion 64", r.stdout)
        listed = json.loads(self.hub("memory", "list", "--agent", "omp", "--json").stdout)
        self.assertEqual(len(listed), 60)

        repo = self.repo()
        r = self.hub("memory", "add", "--repo", repo, "Im Repo gelernt")
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(repo, ".herdr", "memory.md"), encoding="utf-8") as f:
            self.assertIn("Im Repo gelernt", f.read())

    def test_dispatch_appends_the_last_five_memory_entries(self):
        repo = self.verify_repo("memory")
        for i in range(1, 7):
            self.assertEqual(self.hub("memory", "add", "--agent", "omp", f"Lektion {i}").returncode, 0)
        tid = self.criteria_ticket("Mit Gedächtnis", repo, base="main")

        r = self.hub("dispatch", tid, "--no-worktree")
        self.assertEqual(r.returncode, 0, r.stderr)
        task = "\n".join(self.lines_of(self.run_log))
        self.assertIn("## Was du hier gelernt hast", task)
        for i in range(2, 7):
            self.assertIn(f"Lektion {i}", task)
        self.assertNotIn("Lektion 1", task, "nur die letzten fünf")

    def test_memory_clear(self):
        self.assertEqual(self.hub("memory", "add", "--agent", "omp", "etwas").returncode, 0)
        r = self.hub("memory", "clear", "--agent", "omp")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.lines_of(os.path.join(self.app, "agents", "memory", "omp.md")), [])


if __name__ == "__main__":
    unittest.main()
