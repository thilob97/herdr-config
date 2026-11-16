#!/usr/bin/env python3
"""Regression tests for sub-orchestrators: spawn, list, stop, scope and lanes.

    python3 mods/orchestra/test/hub_orchspawn_test.py

Every test builds a throwaway HOME with two spaces and their own folders.
`herdr-app ls` answers from $SPACES_FILE; `hc` is a stub on PATH: `get` reads
$HC_GET_FILE, `ls` $HC_LS_FILE, `run` logs its arguments and reports a terminal.
No real Herdr window or agent is touched.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "hub")

HC = """#!/usr/bin/env python3
import json, os, sys, time
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
def read(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return default
def append(path, line):
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\\n")
if cmd == "ls":
    print(json.dumps(read(os.environ.get("HC_LS_FILE", ""), {"terminals": []})))
elif cmd == "get":
    rows = read(os.environ.get("HC_GET_FILE", ""), {})
    info = rows.get(sys.argv[2]) if len(sys.argv) > 2 else None
    if info is None:
        print("{}")
        sys.exit(1)
    print(json.dumps(info))
elif cmd == "run":
    append(os.environ.get("HC_RUN_LOG"), " ".join(sys.argv[1:]))
    time.sleep(float(os.environ.get("HC_RUN_SLEEP") or 0))
    print(json.dumps({"address": os.environ.get("HC_RUN_ADDRESS", "t-new")}))
elif cmd == "kill":
    append(os.environ.get("HC_SEND_LOG"), "kill " + " ".join(sys.argv[2:]))
elif cmd == "send":
    append(os.environ.get("HC_SEND_LOG"), "send " + " ".join(sys.argv[2:]))
sys.exit(0)
"""

APP = """#!/bin/sh
if [ -n "$APP_CALL_LOG" ]; then echo "app $1" >> "$APP_CALL_LOG"; fi
case "$1" in
  ls) cat "$SPACES_FILE" ;;
  *) exit 0 ;;
esac
"""

SP_A, SP_B = "sp" + "a" * 32, "sp" + "b" * 32
ORCH_A, ORCH_B = "t-orch-a", "t-orch-b"
SUB_A = "t-sub-a"


class HubOrchSpawnTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-orchspawn-")
        self.addCleanup(shutil.rmtree, self.base, True)
        self.home = os.path.join(self.base, "home")
        self.app = os.path.join(self.base, "app")
        self.bin = os.path.join(self.base, "bin")
        self.repos = os.path.join(self.base, "repos")
        self.alpha = os.path.join(self.repos, "alpha")
        self.beta = os.path.join(self.repos, "beta")
        for d in (self.home, self.app, self.bin, self.alpha, self.beta):
            os.makedirs(d)
        for name, body in (("hc", HC), ("herdr-app", APP)):
            p = os.path.join(self.bin, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(body)
            os.chmod(p, 0o755)
        self.get_file = os.path.join(self.base, "hc-get.json")
        self.ls_file = os.path.join(self.base, "hc-ls.json")
        self.spaces_file = os.path.join(self.base, "spaces.json")
        self.run_log = os.path.join(self.base, "hc-run.log")
        self.send_log = os.path.join(self.base, "hc-send.log")
        self.write_json(self.get_file, {
            ORCH_A: self.orch_row(ORCH_A, SP_A),
            ORCH_B: self.orch_row(ORCH_B, SP_B),
        })
        self.write_json(self.ls_file, {"terminals": []})
        self.spaces([
            {"id": SP_A, "name": "Alpha", "folder": self.alpha, "machine": None,
             "tabs": [{"id": "tb-a", "terminals": [{"terminal": ORCH_A}]}]},
            {"id": SP_B, "name": "Beta", "folder": self.beta, "machine": None,
             "tabs": [{"id": "tb-b", "terminals": [{"terminal": ORCH_B}]}]},
        ])

    # ---- helpers

    def orch_row(self, address, space):
        return {"address": address, "name": "orchestrator", "state": "live",
                "labels": {"hub.role": "orchestrator", "hub.space": space, "herdr.space": space}}

    def write_json(self, path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def read_json(self, path, default=None):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return default

    def spaces(self, rows):
        self.write_json(self.spaces_file, {"spaces": rows})

    def terminal(self, address, **info):
        rows = self.read_json(self.get_file, {})
        rows[address] = {"address": address, **info}
        self.write_json(self.get_file, rows)

    def listed(self, *rows):
        self.write_json(self.ls_file, {"terminals": list(rows)})

    def seed_sub(self, address=SUB_A, parent=ORCH_A, space=SP_A, name="sub-orchestrator-alpha-1",
                 state="live"):
        row = {"address": address, "name": name, "state": state, "parent": parent,
               "labels": {"hub.role": "sub-orchestrator", "hub.space": space,
                          "herdr.space": space}}
        self.terminal(address, **{k: v for k, v in row.items() if k != "address"})
        self.listed(*self.read_json(self.ls_file, {"terminals": []})["terminals"], row)
        return row

    def env_for(self, who=None):
        env = {**os.environ, "HOME": self.home, "HERDR_APP_HOME": self.app,
               "PATH": self.bin + os.pathsep + os.environ.get("PATH", ""),
               "HC_GET_FILE": self.get_file, "HC_LS_FILE": self.ls_file,
               "SPACES_FILE": self.spaces_file, "HC_RUN_LOG": self.run_log,
               "HC_SEND_LOG": self.send_log}
        env.pop("HC_TERMINAL_ID", None)
        env.pop("HERDR_SPACE", None)
        if who:
            env["HC_TERMINAL_ID"] = who
        return env

    def hub(self, *args, who=ORCH_A, env=None):
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True,
                              env={**self.env_for(who), **(env or {})})

    def json_cmd(self, *args, who=ORCH_A):
        r = self.hub(*args, "--json", who=who)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def run_lines(self):
        try:
            with open(self.run_log, encoding="utf-8") as f:
                return [line for line in f.read().splitlines() if line.strip()]
        except OSError:
            return []

    def sent(self):
        try:
            with open(self.send_log, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    # ---- spawn

    def test_spawn_starts_two_children_of_the_calling_orchestrator(self):
        r = self.hub("orchestrator", "spawn", "--count", "2", "--name", "alpha", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["space"], SP_A)
        self.assertEqual(out["parent"], ORCH_A)
        self.assertEqual([c["name"] for c in out["children"]],
                         ["sub-orchestrator-alpha-1", "sub-orchestrator-alpha-2"])

        lines = self.run_lines()
        self.assertEqual(len(lines), 2, lines)
        for i, line in enumerate(lines, 1):
            self.assertIn("--parent " + ORCH_A, line, "Kind-Kette: der Aufrufer ist der Parent")
            self.assertNotIn("--no-parent", line)
            self.assertIn("--label hub.role=sub-orchestrator", line)
            self.assertIn("--label hub.space=" + SP_A, line)
            self.assertIn("--label herdr.space=" + SP_A, line)
            self.assertIn(f"--name sub-orchestrator-alpha-{i}", line)
            self.assertIn("--cwd " + os.path.join(self.home, ".herdr", "orchestrator"), line)
            self.assertIn("Du bist Sub-Orchestrator", line)
            self.assertIn("Starte keine eigenen Sub-Orchestratoren", line)
        self.assertTrue(os.path.exists(os.path.join(self.home, ".herdr", "orchestrator", "AGENTS.md")))

    def test_spawn_is_refused_outside_an_orchestrator_terminal(self):
        self.terminal("t-agent", name="Moxie", state="live",
                      labels={"hub.role": "agent", "hub.space": SP_A})
        r = self.hub("orchestrator", "spawn", "--count", "1", who="t-agent")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("nur aus dem Terminal eines Orchestrators", r.stderr)
        self.assertEqual(self.run_lines(), [], "kein Terminal wurde gestartet")

    def test_spawn_is_refused_from_a_sub_orchestrator(self):
        self.seed_sub()
        r = self.hub("orchestrator", "spawn", who=SUB_A)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("nur aus dem Terminal eines Orchestrators", r.stderr)
        self.assertEqual(self.run_lines(), [])

    def test_count_is_limited_to_three(self):
        r = self.hub("orchestrator", "spawn", "--count", "4", who=ORCH_A)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("1 bis 3", r.stderr)
        self.assertEqual(self.run_lines(), [])

    def test_live_subs_count_against_the_space_limit(self):
        self.seed_sub("t-sub-1", name="sub-orchestrator-alpha-1")
        self.seed_sub("t-sub-2", name="sub-orchestrator-alpha-2")
        r = self.hub("orchestrator", "spawn", "--count", "2", who=ORCH_A)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("nur noch Platz für 1", r.stderr)
        self.assertEqual(self.run_lines(), [])
        r = self.hub("orchestrator", "spawn", "--count", "1", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.run_lines()), 1)

    def test_parallel_spawns_start_exactly_one_batch(self):
        env = self.env_for(ORCH_A)
        env["HC_RUN_SLEEP"] = "1"
        procs = [subprocess.Popen(
            [sys.executable, HUB, "orchestrator", "spawn", "--count", "2", "--name", "p"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env) for _ in range(2)]
        results = [(p.communicate(timeout=60), p.returncode) for p in procs]
        codes = sorted(code for _, code in results)
        self.assertEqual(codes, [0, 1], [(out + err) for (out, err), _ in results])
        refused = next(err for (out, err), code in results if code != 0)
        self.assertIn("startet gerade schon ein Sub-Orchestrator", refused)
        self.assertEqual(len(self.run_lines()), 2, "genau ein Batch, keine Duplikate")

    # ---- stop

    def test_stop_ends_an_own_child(self):
        self.seed_sub()
        r = self.hub("orchestrator", "spawn", "--stop", SUB_A, who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["stopped"], SUB_A)
        self.assertIn("kill " + SUB_A, self.sent())

    def test_stop_refuses_a_foreign_child_or_a_non_sub(self):
        self.seed_sub("t-sub-b", parent=ORCH_B, space=SP_B, name="sub-orchestrator-beta-1")
        r = self.hub("orchestrator", "spawn", "--stop", "t-sub-b", who=ORCH_A)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("kein Kind dieses Orchestrators", r.stderr)
        self.assertNotIn("kill t-sub-b", self.sent())

        r = self.hub("orchestrator", "spawn", "--stop", ORCH_B, who=ORCH_A)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("kein Sub-Orchestrator", r.stderr)

    # ---- list, scope and lanes

    def test_list_indents_subs_under_their_parent_with_role_and_parent(self):
        self.seed_sub()
        self.seed_sub("t-sub-2", name="sub-orchestrator-alpha-2")
        rows = self.json_cmd("orchestrator", "list")["orchestrators"]
        alpha = [r for r in rows if r["space"] == SP_A]
        self.assertEqual([r["role"] for r in alpha], ["orchestrator", "sub-orchestrator", "sub-orchestrator"])
        self.assertEqual(alpha[0]["terminal"], ORCH_A)
        for child in alpha[1:]:
            self.assertEqual(child["parent"], ORCH_A)
            self.assertEqual(child["role"], "sub-orchestrator")

        text = self.hub("orchestrator", "list", who=ORCH_A).stdout.splitlines()
        sub_lines = [l for l in text if SUB_A in l or "t-sub-2" in l]
        self.assertEqual(len(sub_lines), 2, text)
        for line in sub_lines:
            self.assertTrue(line.startswith("  └ "), "eingerückt unter dem Eltern-Orchestrator: " + line)
        idx = next(i for i, l in enumerate(text) if ORCH_A in l)
        self.assertTrue(all(text.index(l) > idx for l in sub_lines))

    def test_sub_role_never_becomes_the_space_orchestrator(self):
        self.seed_sub()
        report = self.json_cmd("spaces")
        alpha = next(r for r in report["spaces"] if r["id"] == SP_A)
        self.assertEqual(alpha["orchestrator"], ORCH_A)

        r = self.hub("whoami", who=SUB_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        who = json.loads(r.stdout)
        self.assertEqual(who["space"], SP_A)
        self.assertEqual(who["orchestrator"], ORCH_A, "der Sub ist nicht sein eigener Orchestrator")

        # Even a sub named like an orchestrator does not win the is-orchestrator name path.
        self.seed_sub("t-sub-3", name="sub-orchestrator-fake")
        self.terminal("t-sub-3", name="sub-orchestrator-fake", state="live",
                      labels={"hub.role": "sub-orchestrator", "hub.space": SP_A})
        alpha = next(r for r in self.json_cmd("spaces")["spaces"] if r["id"] == SP_A)
        self.assertEqual(alpha["orchestrator"], ORCH_A)

    def test_timeline_has_a_sub_orchestrator_lane_under_the_parent(self):
        self.seed_sub()
        lanes = self.json_cmd("timeline", "--all")["lanes"]
        orch = next(l for l in lanes if l["kind"] == "orchestrator" and l["terminal"] == ORCH_A)
        sub = next(l for l in lanes if l["terminal"] == SUB_A)
        self.assertEqual(sub["kind"], "sub-orchestrator")
        self.assertNotEqual(sub["kind"], "orchestrator")
        self.assertEqual(sub["parent"], orch["id"], "die Lane hängt am Eltern-Orchestrator")
        self.assertEqual(sub["space"], SP_A)


if __name__ == "__main__":
    unittest.main()
