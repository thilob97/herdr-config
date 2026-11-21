"""Workflows: Definition, Engine, CLI `fab flow`, Auslöser über `fab tick`."""
import json
import os
import time
from unittest import mock

from fabric.fablib import flows, store
from fabric.tests.support import FabricCase

MINUTE = 60 * 1000


class FlowCase(FabricCase):
    # -- Fixtures

    def path(self, data, name="workflow.json"):
        target = os.path.join(self.tmp, name)
        self._write(target, json.dumps(data, ensure_ascii=False, indent=2))
        return target

    def add(self, data, name="workflow.json"):
        self.ok("flow", "add", self.path(data, name))
        return data["name"]

    def base(self, name="beispiel", **overrides):
        data = {
            "name": name,
            "repo": self.default_repo(),
            "limits": {},
            "nodes": [
                {"id": "start", "type": "trigger", "trigger": "manual"},
                {"id": "a", "type": "agent", "agent": "zap", "title": "Prüfe",
                 "prompt": "Bitte prüfen"},
                {"id": "b", "type": "condition", "expr": "{{a.status}} == done"},
                {"id": "ende", "type": "end"},
                {"id": "ende_fail", "type": "end"},
            ],
            "edges": [
                {"from": "start", "to": "a"},
                {"from": "a", "to": "b"},
                {"from": "b", "to": "ende", "when": "pass"},
                {"from": "b", "to": "ende_fail", "when": "fail"},
            ],
        }
        data.update(overrides)
        return data

    def done(self, tid, status="done"):
        with self.store_env():
            with store.locked():
                ticket = store.load(tid)
                ticket["status"] = status
                store.save(ticket)

    def tickets(self):
        with self.store_env():
            return store.all_tickets()

    def runs(self):
        return json.loads(self.ok("flow", "runs", "--json").stdout)

    def flow_ticket(self, workflow="beispiel"):
        for ticket in self.tickets():
            flow = ticket.get("flow")
            if isinstance(flow, dict) and flow.get("workflow") == workflow:
                return ticket
        return None

    # -- add/list/edit/rm

    def test_add_list_edit_rm(self):
        self.add(self.base())
        listed = self.ok("flow", "list").stdout
        self.assertIn("beispiel", listed)
        self.assertIn("5 Knoten", listed)

        edited = self.base()
        edited["nodes"] = [
            {"id": "start", "type": "trigger", "trigger": "manual"},
            {"id": "ende", "type": "end"},
        ]
        edited["edges"] = [{"from": "start", "to": "ende"}]
        self.ok("flow", "edit", "beispiel", self.path(edited, "edit.json"))
        listed = self.ok("flow", "list", "--json").stdout
        rows = json.loads(listed)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "beispiel")
        self.assertEqual(len(rows[0]["nodes"]), 2)

        self.ok("flow", "rm", "beispiel")
        self.assertIn("Keine Workflows.", self.ok("flow", "list").stdout)

    def test_edit_unknown_name_fails(self):
        result = self.cli(
            "flow", "edit", "gibtsnicht", self.path(self.base())
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gibt es nicht", result.stderr)
        self.assertEqual(self.ok("flow", "list").stdout.strip(), "Keine Workflows.")

    # -- Ungültige Definitionen

    def assert_rejected(self, data, message):
        result = self.cli("flow", "add", self.path(data))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)

    def test_cycle_without_loop_limit_rejected(self):
        data = self.base()
        data["nodes"].append({"id": "schleife", "type": "action",
                              "action": "notify", "text": "x"})
        data["edges"] = [
            {"from": "start", "to": "a"},
            {"from": "a", "to": "schleife"},
            {"from": "schleife", "to": "a"},
        ]
        self.assert_rejected(data, "Zyklus ohne Schleifenlimit")

    def test_edge_to_unknown_node_rejected(self):
        data = self.base()
        data["edges"].append({"from": "a", "to": "gibtsnicht"})
        self.assert_rejected(data, "unbekannten Knoten gibtsnicht")

    def test_missing_trigger_rejected(self):
        data = self.base()
        data["nodes"] = [node for node in data["nodes"] if node["type"] != "trigger"]
        data["edges"] = [
            {"from": "a", "to": "b"},
            {"from": "b", "to": "ende", "when": "pass"},
        ]
        self.assert_rejected(data, "Auslöser fehlt")

    def test_missing_end_rejected(self):
        data = self.base()
        data["nodes"] = [node for node in data["nodes"] if node["type"] != "end"]
        data["edges"] = [
            {"from": "start", "to": "a"},
            {"from": "a", "to": "b"},
        ]
        self.assert_rejected(data, "Ende fehlt")

    # -- Lauf: Agent → Bedingung → Ende

    def test_run_agent_condition_end(self):
        self.add(self.base())
        result = self.ok("flow", "run", "beispiel")
        self.assertIn("Lauf 1", result.stdout)
        self.assertIn("wartet auf Ticket T-1", result.stdout)

        ticket = self.ticket("T-1")
        self.assertEqual(ticket["title"], "Prüfe")
        self.assertEqual(ticket["body"], "Bitte prüfen")
        self.assertEqual(ticket["status"], "todo")
        self.assertEqual(ticket["assignee"], "zap")

        shown = self.ok("show", "T-1").stdout
        self.assertIn("gehört zu Workflow beispiel, Lauf 1, Schritt a", shown)

        self.done("T-1")
        ticked = self.ok("tick").stdout
        self.assertIn("Lauf 1: done", ticked)

        rows = self.runs()
        self.assertEqual(rows[0]["status"], "done")
        self.assertEqual(rows[0]["current"], "ende")

        with self.store_env():
            steps = [(step["node"], step["status"])
                     for step in store.flow_steps(1)]
        self.assertIn(("b", "pass"), steps)
        self.assertIn(("ende", "done"), steps)
        self.assertNotIn(("ende_fail", "done"), steps)

        kinds = [
            row for row in self.events()
            if row["kind"] == "flow" and row["target"] in ("a", "b", "ende")
        ]
        self.assertEqual({"a", "b", "ende"}, {row["target"] for row in kinds})

    def test_condition_fail_branch(self):
        data = self.base()
        for node in data["nodes"]:
            if node["id"] == "b":
                node["expr"] = "{{a.status}} == dropped"
        self.add(data)
        self.ok("flow", "run", "beispiel")
        self.done("T-1")
        self.ok("tick")

        run = self.runs()[0]
        self.assertEqual(run["status"], "done")
        self.assertEqual(run["current"], "ende_fail")
        with self.store_env():
            steps = [(step["node"], step["status"])
                     for step in store.flow_steps(1)]
        self.assertIn(("b", "fail"), steps)
        self.assertIn(("ende_fail", "done"), steps)
        self.assertNotIn(("ende", "done"), steps)

    # -- Platzhalter aus dem Vorgänger

    def test_placeholders_from_predecessor(self):
        data = self.base()
        data["nodes"] = [
            {"id": "start", "type": "trigger", "trigger": "manual"},
            {"id": "a", "type": "agent", "agent": "zap", "title": "A",
             "prompt": "A-Prompt"},
            {"id": "b", "type": "agent", "agent": "ada", "title": "B",
             "prompt": "Vorher: {{a.zusammenfassung}}"},
            {"id": "ende", "type": "end"},
        ]
        data["edges"] = [
            {"from": "start", "to": "a"},
            {"from": "a", "to": "b"},
            {"from": "b", "to": "ende"},
        ]
        self.add(data)
        self.ok("flow", "run", "beispiel")

        self.add_events([
            {"kind": "handover", "ticket": "T-1", "actor": "zap",
             "text": "Antwort aus A"},
        ])
        self.done("T-1")
        self.ok("tick")

        second = self.ticket("T-2")
        self.assertIn("Antwort aus A", second["body"])
        self.assertNotIn("{{a.zusammenfassung}}", second["body"])

        self.done("T-2")
        self.ok("tick")
        self.assertEqual(self.runs()[0]["status"], "done")

    # -- Neustart: tick setzt den offenen Schritt fort

    def test_run_survives_process_restart(self):
        self.add(self.base())
        self.ok("flow", "run", "beispiel")
        self.assertEqual(self.runs()[0]["status"], "running")

        self.done("T-1")
        # Jeder CLI-Aufruf ist ein neuer Prozess: die Engine liest den Lauf neu.
        self.ok("tick")
        self.assertEqual(self.runs()[0]["status"], "done")

    # -- pause/cancel/runs

    def test_runs_json_include_steps_and_outputs(self):
        self.add(self.base())
        self.ok("flow", "run", "beispiel")
        self.done("T-1")
        self.ok("tick")
        self.ok("flow", "run", "beispiel")

        rows = self.runs()
        self.assertEqual([row["status"] for row in rows], ["done", "running"])
        for row in rows:
            steps = row["steps"]
            self.assertIsInstance(steps, list)
            self.assertTrue(steps)
            positions = [step["position"] for step in steps]
            self.assertEqual(positions, sorted(positions))
            for step in steps:
                self.assertIsInstance(step["node"], str)
                self.assertIsInstance(step["kind"], str)
                self.assertIsInstance(step["status"], str)
                self.assertIsInstance(step["data"], dict)
            self.assertIsInstance(row["outputs"], dict)

        finished = rows[0]
        self.assertEqual(finished["outputs"]["a"]["status"], "done")
        history = [(step["node"], step["status"]) for step in finished["steps"]]
        self.assertIn(("b", "pass"), history)
        self.assertIn(("ende", "done"), history)

    def test_pause_and_cancel(self):
        self.add(self.base())
        self.ok("flow", "run", "beispiel")
        paused = self.ok("flow", "pause", "1")
        self.assertIn("pausiert", paused.stdout)
        self.assertEqual(self.runs()[0]["status"], "paused")

        self.done("T-1")
        self.ok("tick")
        self.assertEqual(self.runs()[0]["status"], "paused")

        cancelled = self.ok("flow", "cancel", "1")
        self.assertIn("abgebrochen", cancelled.stdout)
        self.assertEqual(self.runs()[0]["status"], "cancelled")

        # Zweiter Lauf: offenes Ticket wird beim Abbruch informiert.
        self.ok("flow", "run", "beispiel")
        cancelled = self.ok("flow", "cancel", "2")
        self.assertIn("abgebrochen", cancelled.stdout)
        self.assertEqual(self.runs()[1]["status"], "cancelled")
        ticket = self.ticket("T-2")
        self.assertTrue(
            any("abgebrochen" in str(item.get("text") or "")
                for item in ticket["comments"])
        )

    def test_resume_after_manual_pause(self):
        self.add(self.base())
        self.ok("flow", "run", "beispiel")
        self.ok("flow", "pause", "1")
        self.assertEqual(self.runs()[0]["status"], "paused")

        self.done("T-1")
        resumed = self.ok("flow", "resume", "1")
        self.assertIn("fortgesetzt", resumed.stdout)
        run = self.runs()[0]
        self.assertEqual(run["status"], "done")
        self.assertEqual(run["current"], "ende")

    def test_approval_inbox_and_resume(self):
        data = self.base()
        data["nodes"] = [
            {"id": "start", "type": "trigger", "trigger": "manual"},
            {"id": "ok", "type": "approval", "text": "Bitte freigeben"},
            {"id": "ende", "type": "end"},
        ]
        data["edges"] = [
            {"from": "start", "to": "ok"},
            {"from": "ok", "to": "ende"},
        ]
        self.add(data)
        self.ok("flow", "run", "beispiel")
        self.assertEqual(self.runs()[0]["status"], "paused")

        inbox = json.loads(self.ok("inbox", "--json").stdout)
        approvals = [item for item in inbox if item["kind"] == "approval"]
        self.assertTrue(any("Bitte freigeben" in item["text"] for item in approvals))

        self.ok("flow", "resume", "1")
        self.assertEqual(self.runs()[0]["status"], "done")

        inbox = json.loads(self.ok("inbox", "--json").stdout)
        self.assertFalse([item for item in inbox if item["kind"] == "approval"])

    def test_action_placeholders_are_shell_quoted(self):
        marker = os.path.join(self.tmp, "pwned")
        data = self.base()
        data["nodes"] = [
            {"id": "start", "type": "trigger", "trigger": "manual"},
            {"id": "a", "type": "agent", "agent": "zap", "title": "A",
             "prompt": "A"},
            {"id": "b", "type": "action", "action": "shell",
             "command": "true {{a.zusammenfassung}}"},
            {"id": "ende", "type": "end"},
        ]
        data["edges"] = [
            {"from": "start", "to": "a"},
            {"from": "a", "to": "b"},
            {"from": "b", "to": "ende"},
        ]
        self.add(data)
        self.ok("flow", "run", "beispiel")
        self.add_events([{
            "kind": "handover", "ticket": "T-1", "actor": "zap",
            "text": f"x; touch {marker}",
        }])
        self.done("T-1")
        self.ok("tick")

        self.assertFalse(os.path.exists(marker))
        self.assertEqual(self.runs()[0]["status"], "done")

    # -- Zeitlimit

    def test_time_limit_ends_run_with_reason(self):
        data = self.base()
        data["limits"] = {"max_minutes": 1}
        self.add(data)
        now = 1_700_000_000_000
        with self.store_env():
            with store.locked():
                result = flows.start("beispiel", now=now)
                run_id = result["run"]
                flows.tick(now=now + 2 * MINUTE)
                run = store.flow_run_load(run_id)
                ticket = store.load("T-1")
        self.assertEqual(run["status"], "failed")
        self.assertIn("Zeitlimit überschritten", run["reason"])
        self.assertTrue(
            any("Zeitlimit überschritten" in str(item.get("text") or "")
                for item in ticket["comments"])
        )

    def test_cost_limit_ends_run_with_reason(self):
        data = self.base()
        data["limits"] = {"max_cost": 1}
        self.add(data)
        now = 1_700_000_000_000
        with self.store_env():
            with store.locked():
                result = flows.start("beispiel", now=now)
                run_id = result["run"]
                with mock.patch(
                    "fabric.fablib.costs.collect",
                    return_value={"total": 5.0},
                ):
                    flows.tick(now=now)
                run = store.flow_run_load(run_id)
                ticket = store.load("T-1")
        self.assertEqual(run["status"], "failed")
        self.assertIn("Kostenlimit überschritten", run["reason"])
        self.assertTrue(
            any("Kostenlimit überschritten" in str(item.get("text") or "")
                for item in ticket["comments"])
        )

    # -- Schleifenlimit

    def test_loop_limit_stops_edge(self):
        data = self.base()
        data["nodes"] = [
            {"id": "start", "type": "trigger", "trigger": "manual"},
            {"id": "a", "type": "action", "action": "notify", "text": "x"},
            {"id": "ende", "type": "end"},
        ]
        data["edges"] = [
            {"from": "start", "to": "a"},
            {"from": "a", "to": "a", "max_loops": 1},
            {"from": "a", "to": "ende"},
        ]
        self.add(data)
        self.ok("flow", "run", "beispiel")
        run = self.runs()[0]
        self.assertEqual(run["status"], "failed")
        self.assertIn("Schleifenlimit der Kante a->a", run["reason"])

    # -- Selbstauslösung

    def test_self_trigger_refused(self):
        data = self.base()
        data["nodes"] = [
            {"id": "start", "type": "trigger", "trigger": "ticket_done"},
            {"id": "a", "type": "agent", "agent": "zap", "title": "WF-Ticket",
             "prompt": "Folgearbeit"},
            {"id": "ende", "type": "end"},
        ]
        data["edges"] = [
            {"from": "start", "to": "a"},
            {"from": "a", "to": "ende"},
        ]
        self.add(data)

        external = self.new("extern")
        self.done(external)
        self.ok("tick")
        self.assertEqual(len(self.runs()), 1)

        own = self.flow_ticket()
        self.assertIsNotNone(own)
        self.done(own["id"])
        result = self.ok("tick")
        self.assertIn("Selbstauslösung", result.stdout)
        self.assertEqual(len(self.runs()), 1)

    # -- Ping-Pong zweier ticket_done-Workflows

    def test_ticket_done_ping_pong_refused(self):
        def data_for(name):
            data = self.base(name)
            data["nodes"] = [
                {"id": "start", "type": "trigger", "trigger": "ticket_done"},
                {"id": "a", "type": "agent", "agent": "zap", "title": name,
                 "prompt": "Folgearbeit"},
                {"id": "ende", "type": "end"},
            ]
            data["edges"] = [
                {"from": "start", "to": "a"},
                {"from": "a", "to": "ende"},
            ]
            return data

        self.add(data_for("wf-a"), "a.json")
        external = self.new("extern")
        self.done(external)
        self.ok("tick")
        self.assertEqual(len(self.runs()), 1)

        self.add(data_for("wf-b"), "b.json")
        first = self.flow_ticket("wf-a")
        self.done(first["id"])
        self.ok("tick")
        self.assertEqual(len(self.runs()), 2)

        second = self.flow_ticket("wf-b")
        self.assertEqual(second["flow"]["chain"], ["wf-a", "wf-b"])
        self.done(second["id"])
        result = self.ok("tick")
        self.assertIn("Ping-Pong", result.stdout)
        rows = self.runs()
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[-1]["status"], "failed")
        self.assertIn("Ping-Pong", rows[-1]["reason"])
        self.assertIn("wf-a", rows[-1]["reason"])

        events = [
            row for row in self.events()
            if row["kind"] == "flow" and "Ping-Pong" in row["text"]
        ]
        self.assertTrue(events)

    # -- Probelauf

    def test_dry_run_has_no_side_effects(self):
        marker = os.path.join(self.tmp, "marker")
        data = self.base()
        data["nodes"] = [
            {"id": "start", "type": "trigger", "trigger": "manual"},
            {"id": "a", "type": "agent", "agent": "zap", "title": "A",
             "prompt": "x"},
            {"id": "b", "type": "action", "action": "shell",
             "command": f"touch {marker}"},
            {"id": "ende", "type": "end"},
        ]
        data["edges"] = [
            {"from": "start", "to": "a"},
            {"from": "a", "to": "b"},
            {"from": "b", "to": "ende"},
        ]
        self.add(data)
        before = len(self.tickets())
        result = self.ok("flow", "run", "beispiel", "--dry")
        self.assertIn("→", result.stdout)
        self.assertIn("kein Ticket, kein Befehl", result.stdout)
        self.assertEqual(len(self.tickets()), before)
        self.assertFalse(os.path.exists(marker))
        self.assertEqual(self.runs(), [])

    # -- Auslöser über tick

    def test_cron_trigger_starts_runs_at_fixed_time(self):
        data = self.base()
        data["nodes"][0] = {"id": "start", "type": "trigger",
                            "trigger": "cron", "every_minutes": 60}
        self.add(data)
        now = 1_700_000_000_000
        with self.store_env():
            with store.locked():
                flows.tick(now=now)
                self.assertEqual(len(store.flow_run_list()), 1)
                flows.tick(now=now + 59 * MINUTE)
                self.assertEqual(len(store.flow_run_list()), 1)
                flows.tick(now=now + 61 * MINUTE)
                self.assertEqual(len(store.flow_run_list()), 2)

    def test_ticket_done_trigger_starts_run(self):
        data = self.base()
        data["nodes"][0] = {"id": "start", "type": "trigger",
                            "trigger": "ticket_done"}
        self.add(data)
        external = self.new("extern")
        self.done(external)
        self.ok("tick")
        rows = self.runs()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["workflow"], "beispiel")
        self.assertIsNotNone(self.flow_ticket())
