#!/usr/bin/env python3
"""Regression tests for one factory per Herdr space: ticket keys, views, WIP, orchestrators.

    python3 mods/orchestra/test/hub_space_test.py

Every test builds a throwaway HOME with two spaces and their own git folders.
`herdr-app ls` answers from $SPACES_FILE; `hc` is a stub on PATH: `get` reads
$HC_GET_FILE, `ls` $HC_LS_FILE, `run` logs its arguments and reports a terminal.
No real Herdr window, agent or GitHub is touched.
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
import json, os, sys
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
calls = os.environ.get("HC_CALL_LOG")
if calls:
    with open(calls, "a", encoding="utf-8") as f:
        f.write("hc " + cmd + "\\n")
def read(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return default
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
    log = os.environ.get("HC_RUN_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(" ".join(sys.argv[1:]) + "\\n")
    print(json.dumps({"address": os.environ.get("HC_RUN_ADDRESS", "t-new")}))
elif cmd in ("send", "kill", "wait", "label"):
    log = os.environ.get("HC_SEND_LOG")
    if log and cmd == "send":
        with open(log, "a", encoding="utf-8") as f:
            f.write(" ".join(sys.argv[1:]) + "\\n")
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


class HubSpaceTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="hub-space-")
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
        self.call_log = os.path.join(self.base, "calls.log")
        self.terminals({
            ORCH_A: {"address": ORCH_A, "name": "orchestrator", "state": "live",
                     "labels": {"hub.role": "orchestrator", "hub.space": SP_A, "herdr.space": SP_A}},
            ORCH_B: {"address": ORCH_B, "name": "orchestrator", "state": "live",
                     "labels": {"hub.role": "orchestrator", "hub.space": SP_B, "herdr.space": SP_B}},
        })
        self.write_json(self.ls_file, {"terminals": []})
        self.spaces([
            {"id": SP_A, "name": "Alpha", "folder": self.alpha, "machine": None,
             "tabs": [{"id": "tb-a", "terminals": [{"terminal": ORCH_A}]}]},
            {"id": SP_B, "name": "Beta", "folder": self.beta, "machine": None,
             "tabs": [{"id": "tb-b", "terminals": [{"terminal": ORCH_B}]}]},
        ])

    # ---- helpers

    def write_json(self, path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def read_json(self, path, default=None):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return default

    def terminals(self, rows):
        self.write_json(self.get_file, rows)

    def terminal(self, address, **info):
        rows = self.read_json(self.get_file, {})
        rows[address] = {"address": address, **info}
        self.terminals(rows)

    def spaces(self, rows):
        self.write_json(self.spaces_file, {"spaces": rows})

    def env_for(self, who=None):
        env = {**os.environ, "HOME": self.home, "HERDR_APP_HOME": self.app,
               "PATH": self.bin + os.pathsep + os.environ.get("PATH", ""),
               "HC_GET_FILE": self.get_file, "HC_LS_FILE": self.ls_file,
               "SPACES_FILE": self.spaces_file, "HC_RUN_LOG": self.run_log,
               "HC_SEND_LOG": self.send_log, "HC_CALL_LOG": self.call_log,
               "APP_CALL_LOG": self.call_log}
        env.pop("HC_TERMINAL_ID", None)
        env.pop("HERDR_SPACE", None)
        if who:
            env["HC_TERMINAL_ID"] = who
        return env

    def hub(self, *args, who=ORCH_A, env=None):
        return subprocess.run([sys.executable, HUB, *args], capture_output=True, text=True,
                              env={**self.env_for(who), **(env or {})})

    def ticket(self, title, repo, who=ORCH_A, status=None, body="", **extra):
        args = ["ticket", "new", "--title", title, "--repo", repo, "--body", body]
        for k, v in extra.items():
            args += [f"--{k.replace('_', '-')}", v]
        r = self.hub(*args, who=who)
        self.assertEqual(r.returncode, 0, r.stderr)
        tid = r.stdout.strip()
        if status:
            r = self.hub("ticket", "set", tid, f"status={status}", who=who)
            self.assertEqual(r.returncode, 0, r.stderr)
        return tid

    def fields(self, tid):
        path = os.path.join(self.app, "data", "quests", "tickets", tid + ".md")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        meta = {}
        for line in text.split("---\n", 2)[1].splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        return meta, text

    def strip_space(self, tid, agent_space=""):
        """Make the ticket look like one from before the space model.

        Old dispatches wrote their throwaway agent space into `space` with no
        `space_name`; `agent_space` names it when the test keeps that value."""
        path = os.path.join(self.app, "data", "quests", "tickets", tid + ".md")
        with open(path, encoding="utf-8") as f:
            parts = f.read().split("---\n")
        front = [line for line in parts[1].splitlines()
                 if not line.startswith("space:") and not line.startswith("space_name:")]
        if agent_space:
            front.append(f"space: {agent_space}")
        with open(path, "w", encoding="utf-8") as f:
            f.write("---\n" + "\n".join(front) + "\n---\n" + "---\n".join(parts[2:]))

    def events(self):
        path = os.path.join(self.app, "data", "orchestra", "events.jsonl")
        try:
            with open(path, encoding="utf-8") as f:
                return [json.loads(line) for line in f.read().splitlines() if line.strip()]
        except OSError:
            return []

    def json_cmd(self, *args, who=ORCH_A):
        r = self.hub(*args, "--json", who=who)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    # ---- the ticket's space

    def test_ticket_new_takes_the_space_and_can_override_it(self):
        a = self.ticket("In Alpha", self.alpha, who=ORCH_A)
        meta, _ = self.fields(a)
        self.assertEqual(meta["space"], SP_A)
        self.assertEqual(meta["space_name"], "Alpha")
        self.assertEqual(meta["owner"], ORCH_A)

        b = self.ticket("Fremd angelegt", self.beta, who=ORCH_A, space="Beta")
        meta, _ = self.fields(b)
        self.assertEqual(meta["space"], SP_B, "--space <Name> überschreibt den eigenen Space")
        self.assertEqual(meta["space_name"], "Beta")

        who = json.loads(self.hub("whoami").stdout)
        self.assertEqual(who["space"], SP_A)
        self.assertEqual(who["space_name"], "Alpha")
        self.assertEqual(who["orchestrator"], ORCH_A)

    def test_status_separates_spaces_and_all_shows_both(self):
        a = self.ticket("Alpha-Ticket", self.alpha)
        b = self.ticket("Beta-Ticket", self.beta, who=ORCH_B)

        own = self.hub("status", who=ORCH_A)
        self.assertEqual(own.returncode, 0, own.stderr)
        self.assertIn(a, own.stdout)
        self.assertNotIn(b, own.stdout)
        self.assertEqual(self.hub("status", who=ORCH_B).stdout.count(b), 1)

        by_name = self.hub("status", "--space", "Beta", who=ORCH_A)
        self.assertIn(b, by_name.stdout)
        self.assertNotIn(a, by_name.stdout)

        every = self.hub("status", "--all", who=ORCH_A)
        self.assertIn(a, every.stdout)
        self.assertIn(b, every.stdout)

        rows = self.json_cmd("status", "--all")["tickets"]
        by_id = {r["id"]: r for r in rows}
        self.assertEqual(by_id[a]["space"], SP_A)
        self.assertEqual(by_id[a]["space_name"], "Alpha")
        self.assertEqual(by_id[b]["space"], SP_B)
        self.assertEqual(self.json_cmd("status")["space"], SP_A)

    def test_timeline_separates_lanes_and_events(self):
        now = int(time.time() * 1000)
        a = self.ticket("Alpha", self.alpha, status="doing")
        b = self.ticket("Beta", self.beta, status="doing", who=ORCH_B)
        self.hub("ticket", "set", a, "terminal=t-agent-a", who=ORCH_A)
        self.hub("ticket", "set", b, "terminal=t-agent-b", who=ORCH_B)
        self.terminal("t-agent-a", name="Alpha-Agent", state="live", created_ms=now - 600_000,
                      labels={"herdr.space": "sp" + "1" * 32, "hub.ticket": a})
        self.terminal("t-agent-b", name="Beta-Agent", state="live", created_ms=now - 600_000,
                      labels={"herdr.space": "sp" + "2" * 32, "hub.ticket": b})
        self.hub("nudge", a, "--text", "Stand?", who=ORCH_A)

        report = self.json_cmd("timeline")
        self.assertEqual(report["space"], SP_A)
        self.assertEqual({l["terminal"] for l in report["lanes"]},
                         {ORCH_A, "t-agent-a"}, "nur die eigene Fabrik")
        self.assertEqual({e["ticket"] for e in report["events"]}, {a})
        self.assertTrue(all(l["space"] == SP_A for l in report["lanes"]))
        self.assertTrue(all(e["space"] == SP_A for e in report["events"]))

        everything = self.json_cmd("timeline", "--all")
        self.assertEqual({l["terminal"] for l in everything["lanes"]},
                         {ORCH_A, ORCH_B, "t-agent-a", "t-agent-b"})
        self.assertEqual({e["ticket"] for e in everything["events"]}, {a, b})
        spaces = {l["space"] for l in everything["lanes"]}
        self.assertEqual(spaces, {SP_A, SP_B})

        one = self.json_cmd("timeline", "--ticket", b)
        self.assertEqual({l["ticket"] for l in one["lanes"]}, {b})

    def test_events_carry_the_space(self):
        a = self.ticket("Ereignis", self.alpha, status="doing")
        self.hub("ticket", "set", a, "terminal=t-agent-a", who=ORCH_A)
        self.terminal("t-agent-a", name="Agent", state="live", labels={"herdr.space": "sp" + "1" * 32})
        r = self.hub("nudge", a, "--text", "Stand?", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        rows = self.events()
        self.assertTrue(rows)
        self.assertEqual(rows[-1]["space"], SP_A)
        self.assertEqual(rows[-1]["space_name"], "Alpha")

    # ---- WIP

    def test_wip_counts_and_writes_per_space(self):
        self.ticket("Alpha läuft", self.alpha, status="doing")
        self.ticket("Beta läuft", self.beta, status="doing", who=ORCH_B)

        own = self.hub("wip", who=ORCH_A)
        self.assertIn("arbeit 1/3", own.stdout, "nur der eigene Space zählt")
        everything = self.hub("wip", "--all", who=ORCH_A)
        self.assertIn("arbeit 2/3", everything.stdout)

        r = self.hub("wip", "--mine", "arbeit=1", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        data = self.read_json(os.path.join(self.app, "data", "orchestra", "wip.json"))
        self.assertEqual(data["mine"][SP_A], {"arbeit": 1}, "neu je Space")
        self.assertEqual(self.hub("wip", who=ORCH_A).stdout.count("1/1"), 1)
        self.assertIn("1/3", self.hub("wip", who=ORCH_B).stdout, "Beta bleibt beim Standard")

        payload = self.json_cmd("wip")
        self.assertEqual(payload["space"], SP_A)
        self.assertEqual(payload["space_name"], "Alpha")
        self.assertEqual(payload["arbeit"], 1)

        # An old per-terminal entry is still read.
        self.write_json(os.path.join(self.app, "data", "orchestra", "wip.json"),
                        {"arbeit": 3, "pruefung": 2, "mine": {ORCH_B: {"pruefung": 1}}})
        self.assertIn("pruefung 0/1", self.hub("wip", who=ORCH_B).stdout)

    def test_stalls_are_per_space(self):
        a = self.ticket("Alpha hängt", self.alpha, status="doing")
        b = self.ticket("Beta hängt", self.beta, status="doing", who=ORCH_B)
        for tid, who in ((a, ORCH_A), (b, ORCH_B)):
            r = self.hub("ticket", "set", tid, "status_at=2020-01-01 00:00", who=who)
            self.assertEqual(r.returncode, 0, r.stderr)

        own = self.json_cmd("stalls")
        self.assertEqual([r["id"] for r in own], [a])
        self.assertEqual(own[0]["space"], SP_A)
        self.assertEqual([r["id"] for r in self.json_cmd("stalls", "--all")], [a, b])

    # ---- restart and migration

    def test_a_restarted_orchestrator_keeps_its_tickets(self):
        a = self.ticket("Bleibt", self.alpha, status="doing")
        meta, _ = self.fields(a)
        self.assertEqual(meta["owner"], ORCH_A)

        new = "t-orch-a2"
        self.terminal(ORCH_A, name="orchestrator", state="finished",
                      labels={"hub.role": "orchestrator", "hub.space": SP_A, "herdr.space": SP_A})
        self.terminal(new, name="orchestrator", state="live",
                      labels={"hub.role": "orchestrator", "hub.space": SP_A, "herdr.space": SP_A})
        self.spaces([{"id": SP_A, "name": "Alpha", "folder": self.alpha, "machine": None,
                      "tabs": [{"id": "tb-a", "terminals": [{"terminal": new}]}]},
                     {"id": SP_B, "name": "Beta", "folder": self.beta, "machine": None,
                      "tabs": [{"id": "tb-b", "terminals": [{"terminal": ORCH_B}]}]}])

        r = self.hub("status", who=new)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(a, r.stdout, "der Space hält die Tickets, nicht der Terminal")
        self.assertIn("arbeit 1/3", self.hub("wip", who=new).stdout)
        who = json.loads(self.hub("whoami", who=new).stdout)
        self.assertEqual(who["orchestrator"], new)
        self.assertEqual(who["space"], SP_A)
        self.assertEqual(who["tickets"], 1)
        self.assertEqual(self.fields(a)[0]["owner"], ORCH_A, "owner bleibt der alte Terminal")

    def test_an_old_ticket_counts_to_the_space_holding_its_repo(self):
        a = self.ticket("Alt", self.alpha, who=ORCH_A)
        self.strip_space(a)
        old_agent_space = "sp" + "9" * 32
        b = self.ticket("Alt mit Agent-Space", self.beta, who=ORCH_B)
        self.strip_space(b, old_agent_space)
        outside = os.path.join(self.repos, "nirgends")
        os.makedirs(outside)
        loose = self.ticket("Ohne Ordner", outside, who=ORCH_A)
        self.strip_space(loose)

        self.assertEqual(self.fields(b)[0]["space"], old_agent_space, "der alte Agent-Space steht noch drin")

        def visible(who):
            return {r["id"] for r in json.loads(self.hub("status", "--json", who=who).stdout)["tickets"]}

        self.assertIn(b, visible(ORCH_B),
                      "der alte Agent-Space zählt nicht als Workspace; das Repo entscheidet")
        self.assertNotIn(b, visible(ORCH_A))
        self.assertIn(a, visible(ORCH_A), "per Repo zugeordnet")
        self.assertNotIn(a, visible(ORCH_B), "nicht im fremden Space")
        self.assertIn(a, {e["ticket"] for e in self.json_cmd("timeline")["events"]},
                      "die Timeline ordnet es genauso zu")
        self.assertNotIn(loose, visible(ORCH_A), "ohne Workspace ist keine Projekt-Fabrik")
        self.assertNotIn(loose, visible(ORCH_B))
        self.assertIn(loose, {r["id"] for r in self.json_cmd("status", "--all")["tickets"]},
                      "nur mit --all sichtbar")
        self.assertEqual({r["id"] for r in self.json_cmd("status", "--space", "")["tickets"]}, {loose})
        self.assertEqual({r["id"] for r in self.json_cmd("status", "--space", "none")["tickets"]}, {loose})
        status = self.hub("status", who=ORCH_A)
        self.assertIn("Tickets ohne Workspace", status.stdout, "Fußzeile nennt die Gruppe")
        self.assertIn("--adopt --to", status.stdout)

        dry = self.hub("spaces", "--adopt", who=ORCH_A)
        self.assertEqual(dry.returncode, 0, dry.stderr)
        self.assertIn("Alpha", dry.stdout)
        self.assertIn("ohne Workspace", dry.stdout)
        self.assertNotIn("space:", self.fields(a)[1].split("---")[1], "Dry-Run schreibt nichts")

        target = self.hub("spaces", "--adopt", "--to", "Beta", who=ORCH_A)
        self.assertEqual(target.returncode, 0, target.stderr)
        self.assertRegex(target.stdout, rf"{loose}\s+→ Beta", "--to nimmt die Unzuordenbaren")
        self.assertNotIn("space", self.fields(loose)[0], "--to zeigt nur, schreibt ohne --yes nicht")
        self.assertNotEqual(self.hub("spaces", "--to", "Beta", who=ORCH_A).returncode, 0,
                            "--to ohne --adopt ist ein Fehler")

        r = self.hub("spaces", "--adopt", "--yes", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        meta, _ = self.fields(a)
        self.assertEqual(meta["space"], SP_A)
        self.assertEqual(meta["space_name"], "Alpha")
        old = self.fields(b)[0]
        self.assertEqual((old["space"], old["space_name"]), (SP_B, "Beta"))
        self.assertEqual(old["agent_space"], old_agent_space, "der alte Agent-Space bleibt erhalten")
        self.assertNotIn("space", self.fields(loose)[0], "ohne --to bleibt Unzuordenbares liegen")

        r = self.hub("spaces", "--adopt", "--to", "Beta", "--yes", who=ORCH_A)
        self.assertEqual(r.returncode, 0, r.stderr)
        loose_meta = self.fields(loose)[0]
        self.assertEqual((loose_meta["space"], loose_meta["space_name"]), (SP_B, "Beta"))
        self.assertIn(loose, {r["id"] for r in self.json_cmd("status", who=ORCH_B)["tickets"]})
        self.assertNotIn("Tickets ohne Workspace", self.hub("status", who=ORCH_A).stdout)

    def test_spaces_lists_identity_counts_and_cost(self):
        a = self.ticket("A offen", self.alpha)
        b = self.ticket("A läuft", self.alpha, status="doing")
        c = self.ticket("B prüfen", self.beta, status="review", who=ORCH_B)
        path = os.path.join(self.app, "data", "orchestra", "costs.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.write_json(path, {"tickets": {a: 1.5, b: 0.5, c: 2.0}})

        report = self.json_cmd("spaces")
        rows = {r["id"]: r for r in report["spaces"]}
        self.assertEqual(rows[SP_A]["name"], "Alpha")
        self.assertEqual(rows[SP_A]["folder"], self.alpha)
        self.assertEqual(rows[SP_A]["orchestrator"], ORCH_A)
        self.assertTrue(rows[SP_A]["live"])
        self.assertEqual(rows[SP_A]["open"], {"todo": 1, "doing": 1, "review": 0})
        self.assertEqual(rows[SP_A]["cost"], 2.0)
        self.assertEqual(rows[SP_A]["cost_open"], 2.0)
        self.assertEqual(rows[SP_B]["open"], {"todo": 0, "doing": 0, "review": 1})
        self.assertEqual(rows[SP_B]["cost"], 2.0)
        # review is not done: it counts as open, like the budget line of `hub status`.
        self.assertEqual(rows[SP_B]["cost_open"], 2.0)
        self.assertEqual(report["space"], SP_A)

    def test_spaces_cost_open_leaves_done_tickets_out(self):
        done = self.ticket("A erledigt", self.alpha, status="done")
        doing = self.ticket("A läuft", self.alpha, status="doing")
        path = os.path.join(self.app, "data", "orchestra", "costs.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.write_json(path, {"tickets": {done: 5.0, doing: 2.0}})

        rows = {r["id"]: r for r in self.json_cmd("spaces")["spaces"]}
        self.assertEqual(rows[SP_A]["cost_open"], 2.0,
                         "cost_open zählt nur Tickets, die nicht done sind")
        self.assertEqual(rows[SP_A]["cost"], 7.0, "cost bleibt die Summe aller Tickets")

        table = self.hub("spaces", who=ORCH_A).stdout.splitlines()
        self.assertIn("offen", table[0])
        self.assertIn("gesamt", table[0])
        alpha = next(l for l in table if SP_A in l)
        self.assertTrue(alpha.rstrip().endswith(f"{2.0:>7.2f} {7.0:>7.2f}"),
                        "die Tabelle zeigt offen und gesamt: " + alpha)

    def test_spaces_and_orchestrator_list_share_one_detection(self):
        # `hc ls` carries no labels and a second orchestrator may carry a space suffix;
        # both views must still name it and count it as live.
        self.terminal(ORCH_B, name="orchestrator-beta", state="live",
                      labels={"hub.role": "orchestrator", "hub.space": SP_B, "herdr.space": SP_B})
        self.write_json(self.ls_file, {"terminals": [
            {"address": ORCH_A, "name": "orchestrator", "state": "live"},
            {"address": ORCH_B, "name": "orchestrator-beta", "state": "live"},
            {"address": "t-agent", "name": "agent", "state": "live"},
        ]})
        rows = {r["id"]: r for r in self.json_cmd("spaces")["spaces"]}
        self.assertEqual(rows[SP_A]["orchestrator"], ORCH_A)
        self.assertTrue(rows[SP_A]["live"])
        self.assertEqual(rows[SP_B]["orchestrator"], ORCH_B,
                         "ein Orchestrator mit Space-Suffix wird gefunden")
        self.assertTrue(rows[SP_B]["live"])
        listing = {r["space"]: r for r in self.json_cmd("orchestrator", "list")["orchestrators"]}
        self.assertEqual(listing[SP_A]["terminal"], ORCH_A)
        self.assertEqual(listing[SP_B]["terminal"], ORCH_B)
        self.assertTrue(listing[SP_B]["live"])

    def test_agent_spaces_are_hidden_unless_requested(self):
        own = self.ticket("Eigenes Ticket", self.alpha)
        agent_space = "sp" + "c" * 32
        self.hub("ticket", "set", own, f"agent_space={agent_space}")
        self.terminal("t-agent", name="workspace-fabrik", state="live",
                      labels={"herdr.space": agent_space, "hub.ticket": own})
        self.spaces([
            {"id": SP_A, "name": "Alpha", "folder": self.alpha, "machine": None,
             "tabs": [{"id": "tb-a", "terminals": [{"terminal": ORCH_A}, {"terminal": "t-agent"}]}]},
            {"id": agent_space, "name": "feat-agent", "folder": self.alpha + "-worktree", "machine": None,
             "tabs": [{"id": "tb-g", "terminals": [{"terminal": "t-agent"}]}]},
            {"id": SP_B, "name": "Beta", "folder": self.beta, "machine": None,
             "tabs": [{"id": "tb-b", "terminals": [{"terminal": ORCH_B}]}]},
        ])
        rows = {r["id"]: r for r in self.json_cmd("spaces")["spaces"]}
        self.assertNotIn(agent_space, rows, "der Agent-Space ist kein Workspace")
        self.assertEqual(rows[SP_A]["kind"], "workspace")
        self.assertEqual(rows[SP_B]["kind"], "workspace",
                         "ein Space ohne Tickets und ohne Orchestrator bleibt Workspace")
        with_agents = {r["id"]: r for r in self.json_cmd("spaces", "--agents")["spaces"]}
        self.assertEqual(with_agents[agent_space]["kind"], "agent")
        self.assertEqual(with_agents[agent_space]["workspace"], SP_A,
                         "--agents nennt den Workspace des Tickets")

    def test_a_team_agent_ticket_inherits_its_own_workspace(self):
        parent = self.ticket("Eltern", self.alpha)
        agent_space = "sp" + "d" * 32
        self.terminal("t-team", name="team", state="live",
                      labels={"herdr.space": agent_space, "hub.ticket": parent})
        r = self.hub("ticket", "new", "--title", "Kind", "--repo", self.alpha,
                     who="t-team", env={"HERDR_SPACE": agent_space})
        self.assertEqual(r.returncode, 0, r.stderr)
        meta, _ = self.fields(r.stdout.strip())
        self.assertEqual(meta["space"], SP_A,
                         "der Agent-Space des Terminals erbt nicht in das neue Ticket")

    def test_a_team_agent_on_an_old_ticket_takes_its_repo_space(self):
        # An old ticket stores only the agent's throwaway space (no `space_name`).
        # `hub ticket new` from its agent terminal must follow the repo folder rule,
        # not HERDR_SPACE: that space is the worktree's, not the factory's.
        parent = self.ticket("Alt-Eltern", self.beta, who=ORCH_B)
        old = "sp" + "e" * 32
        self.strip_space(parent, old)
        self.terminal("t-old-team", name="team", state="live",
                      labels={"herdr.space": old, "hub.ticket": parent})
        r = self.hub("ticket", "new", "--title", "Kind", "--repo", self.beta,
                     who="t-old-team", env={"HERDR_SPACE": old})
        self.assertEqual(r.returncode, 0, r.stderr)
        meta, _ = self.fields(r.stdout.strip())
        self.assertEqual((meta["space"], meta["space_name"]), (SP_B, "Beta"),
                         "der alte Agent-Space erbt nicht; das Repo des Tickets entscheidet")

    # ---- the "ohne Workspace" group (`--space ""`)

    def test_timeline_none_shows_only_the_group_without_a_workspace(self):
        a = self.ticket("Alpha", self.alpha, status="doing")
        self.hub("ticket", "set", a, "terminal=t-agent-a", who=ORCH_A)
        self.terminal("t-agent-a", name="Alpha-Agent", state="live",
                      labels={"herdr.space": "sp" + "1" * 32, "hub.ticket": a})
        outside = os.path.join(self.repos, "nirgends")
        os.makedirs(outside)
        loose = self.ticket("Ohne Ordner", outside, who=ORCH_A, status="doing")
        self.strip_space(loose)  # an old ticket: no workspace, its repo is in no folder
        self.hub("ticket", "set", loose, "terminal=t-loose", who=ORCH_A)

        group = self.json_cmd("timeline", "--space", "")
        self.assertEqual(group["space"], "")
        self.assertEqual({l["ticket"] for l in group["lanes"]}, {loose},
                         "die Lanes fremder Spaces gehören nicht in die Gruppe")
        self.assertEqual({e["ticket"] for e in group["events"]}, {loose})
        self.assertTrue(all(e["space"] == "" for e in group["events"]),
                        "nur Events ohne Workspace")

        alpha = self.json_cmd("timeline", "--space", "Alpha")
        self.assertEqual({l["terminal"] for l in alpha["lanes"]}, {ORCH_A, "t-agent-a"})
        self.assertEqual({e["ticket"] for e in alpha["events"]}, {a},
                         "die Gruppe erscheint nicht in der Projekt-Fabrik")
        self.assertTrue(all(l["space"] == SP_A for l in alpha["lanes"]))

        own = self.json_cmd("timeline")
        self.assertEqual({e["ticket"] for e in own["events"]}, {a},
                         "ohne --space bleibt die eigene Fabrik der Standard")

    def test_none_is_the_group_without_a_workspace_in_wip_status_stats(self):
        self.ticket("Alpha läuft", self.alpha, status="doing")
        outside = os.path.join(self.repos, "nirgends")
        os.makedirs(outside)
        loose = self.ticket("Ohne Ordner", outside, who=ORCH_A, status="doing")
        self.strip_space(loose)
        self.hub("wip", "--mine", "arbeit=1", who=ORCH_A)  # an override for Alpha only

        wip = self.json_cmd("wip", "--space", "")
        self.assertEqual((wip["space"], wip["space_name"]), ("", ""))
        self.assertEqual(wip["arbeit"], 3, "die Limits der Gruppe sind die Datei-Standards")
        text = self.hub("wip", "--space", "", who=ORCH_A).stdout
        self.assertIn("ohne Workspace", text)
        self.assertNotIn("Alpha", text)
        self.assertIn("arbeit 1/3", text, "nur das Ticket ohne Workspace zählt")

        status = self.json_cmd("status", "--space", "")
        self.assertEqual((status["space"], status["space_name"]), ("", ""))
        self.assertEqual({r["id"] for r in status["tickets"]}, {loose})

        stats = self.json_cmd("stats", "--space", "")
        self.assertEqual((stats["space"], stats["space_name"]), ("", ""))
        self.assertEqual({r["id"] for r in stats["tickets"]}, {loose})

        own = self.json_cmd("wip")
        self.assertEqual((own["space"], own["space_name"]), (SP_A, "Alpha"),
                         "ohne --space bleibt die eigene Fabrik der Standard")
        self.assertEqual(own["arbeit"], 1, "der Override des eigenen Space gilt hier")

    def test_old_agent_space_events_land_in_the_tickets_workspace(self):
        # events.jsonl: an old dispatch logged the throwaway agent space; the ticket
        # has long been assigned to its repo's factory. The entry must follow the
        # ticket, or it appears in no lane and no space view.
        a = self.ticket("Alt", self.alpha, status="doing")
        old = "sp" + "9" * 32
        self.strip_space(a, old)
        self.hub("ticket", "set", a, f"agent_space={old}", who=ORCH_A)
        path = os.path.join(self.app, "data", "orchestra", "events.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": int(time.time() * 1000), "kind": "comment", "ticket": a,
                                "agent": "agent", "terminal": "t-old", "text": "alt",
                                "space": old, "space_name": ""}) + "\n")

        report = self.json_cmd("timeline")
        self.assertIn(a, {e["ticket"] for e in report["events"]},
                      "der Kommentar liegt in der Sicht des Workspace")
        self.assertTrue(all(e["space"] == SP_A for e in report["events"] if e["ticket"] == a),
                        "der alte Agent-Space wird auf den Ticket-Space zurückgeführt")
        lane = next((l for l in report["lanes"] if l["terminal"] == "t-old"), None)
        self.assertIsNotNone(lane, "die Lane der Alt-Agent-Space erscheint")
        self.assertEqual((lane["space"], lane["space_name"]), (SP_A, "Alpha"))
        self.assertEqual({l["space"] for l in report["lanes"]}, {SP_A})

        group = self.json_cmd("timeline", "--space", "")
        self.assertNotIn("t-old", {l["terminal"] for l in group["lanes"]})
        self.assertNotIn(a, {e["ticket"] for e in group["events"]})

    def test_wip_all_json_carries_no_space_fields(self):
        payload = self.json_cmd("wip", "--all")
        self.assertTrue(payload["all"])
        self.assertNotIn("space", payload, "globale Zahlen tragen keinen Space")
        self.assertNotIn("space_name", payload)

    # ---- orchestrator per space

    def test_orchestrator_start_refuses_a_second_and_restart_replaces_it(self):
        r = self.hub("orchestrator", "start", "--space", SP_A)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(ORCH_A, r.stderr)
        self.assertIn("--restart", r.stderr)
        self.assertFalse(os.path.exists(self.run_log), "nichts gestartet")

        r = self.hub("orchestrator", "start", "--space", "Alpha", "--agent", "claude", "--restart")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["space"], SP_A)
        self.assertEqual(out["terminal"], "t-new")
        self.assertEqual(out["agent"], "claude")
        self.assertTrue(out["cwd"].endswith(".herdr/orchestrator"))
        with open(self.run_log, encoding="utf-8") as f:
            log = f.read()
        self.assertIn("hub.role=orchestrator", log)
        self.assertIn(f"hub.space={SP_A}", log)
        self.assertIn(f"herdr.space={SP_A}", log)
        self.assertIn("Alpha", log)
        self.assertIn(SP_A, log)
        self.assertIn(self.alpha, log, "der Start-Prompt nennt den Ordner")

        # hc puts the new terminal into the space (its herdr.space label); the stub has
        # to say so before the listing can see it.
        self.terminal("t-new", name="orchestrator", state="live",
                      labels={"hub.role": "orchestrator", "hub.space": SP_A, "herdr.space": SP_A})
        self.spaces([{"id": SP_A, "name": "Alpha", "folder": self.alpha, "machine": None,
                      "tabs": [{"id": "tb-a", "terminals": [{"terminal": "t-new"}]}]},
                     {"id": SP_B, "name": "Beta", "folder": self.beta, "machine": None,
                      "tabs": [{"id": "tb-b", "terminals": [{"terminal": ORCH_B}]}]}])
        listing = self.json_cmd("orchestrator", "list")
        rows = {r["space"]: r for r in listing["orchestrators"]}
        self.assertEqual(rows[SP_A]["terminal"], "t-new")
        self.assertTrue(rows[SP_A]["live"])
        self.assertEqual(rows[SP_B]["terminal"], ORCH_B)


    def test_timeline_reads_the_terminal_snapshot_once_for_fifty_tickets(self):
        now = int(time.time() * 1000)
        tdir = os.path.join(self.app, "data", "quests", "tickets")
        os.makedirs(tdir, exist_ok=True)
        rows = {ORCH_A: {"address": ORCH_A, "name": "orchestrator", "state": "live",
                         "created_ms": now - 3_600_000, "foreground": {"name": "omp"},
                         "labels": {"hub.role": "orchestrator", "hub.space": SP_A, "herdr.space": SP_A}}}
        for i in range(50):
            tid = f"perf-{i}"
            with open(os.path.join(tdir, tid + ".md"), "w", encoding="utf-8") as f:
                f.write("---\n"
                        f"title: Perf {i}\nstatus: doing\nrepo: {self.alpha}\n"
                        f"space: {SP_A}\nspace_name: Alpha\nmachine: \nterminal: t-{i}\n"
                        "created: 2026-11-15 10:00\n"
                        "status_log: todo@2026-11-15 10:00|doing@2026-11-15 10:05\n"
                        "---\n")
            rows[f"t-{i}"] = {"address": f"t-{i}", "name": f"Agent {i}", "state": "live",
                              "created_ms": now - 900_000, "parent": ORCH_A}
        self.write_json(self.ls_file, {"terminals": list(rows.values())})

        with open(self.call_log, "w", encoding="utf-8"):
            pass
        report = self.json_cmd("timeline", who=ORCH_A)
        with open(self.call_log, encoding="utf-8") as f:
            calls = [line.strip() for line in f if line.strip()]
        self.assertLessEqual(len(calls), 5, f"zu viele Subprozesse für 50 Tickets: {calls}")
        self.assertEqual(len([l for l in report["lanes"] if l["kind"] == "agent"]), 50)
        self.assertEqual({l["space"] for l in report["lanes"]}, {SP_A})
        self.assertTrue(all(l["label"] == f"Agent {int(l['terminal'][2:])}" for l in report["lanes"]
                            if l["kind"] == "agent"))


if __name__ == "__main__":
    unittest.main()
