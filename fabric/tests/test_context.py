"""Projekt-Steckbrief, Team-Brief und ihr Einbau in die Prompts (T-59)."""
import json
import os
import stat
from unittest import mock

from fabric.fablib import agents, context
from fabric.tests.support import FabricCase


class ContextCase(FabricCase):
    def project(self, repo, text="# Steckbrief\n\nZweck: Testprojekt.\n"):
        self.ok("repo", "set", repo, "project", "--text", text,
                "--from", "mensch")
        return text

    def brief(self, text="Ziele: Kontext zeigen.\n", team="herdr-app"):
        path = os.path.join(self.tmp, "brief.md")
        self.write_file(path, text)
        self.ok("team", "edit", team, "--brief-file", path, "--from", "mensch")
        return text

    def set_limit(self, value):
        self.ok("settings", "set", "context_limit", str(value), "--from", "mensch")

    def load_roster(self):
        with mock.patch.dict(os.environ, self.env):
            return agents.load()

    def prompter(self):
        """Preamble mit nacktem {context}; so bleibt der Kontext messbar."""
        self.write_file(
            os.path.join(self.roster_dir, "prompts", "preamble.md"),
            "{context}\n",
        )

    def start_context(self, tid):
        roster = self.load_roster()
        start = agents.start_prompt(
            roster,
            self.ticket(tid),
            {"name": "zap", "role": "umsetzer", "prompt": "prompts/zap.md"},
        )
        return roster, start.split("\n\nZap-Rolle:")[0]


class RepoProjectTests(ContextCase):
    def test_repo_set_project_und_show_meldet_steckbrief(self):
        repo = self.make_repo()
        data = json.loads(self.ok("repo", "show", repo, "--json").stdout)
        self.assertEqual(data["project"], {"exists": False, "text": None})
        self.assertIn("## Zweck", data["project_template"])
        shown = self.ok("repo", "show", repo).stdout
        self.assertIn("Steckbrief: fehlt", shown)
        self.assertIn("Vorlage für den Steckbrief", shown)

        self.project(repo, "# Steckbrief\n\nZweck: Testprojekt.\n")
        target = os.path.join(repo, ".fabric", "project.md")
        self.assertEqual(
            stat.S_IMODE(os.stat(target).st_mode), 0o644
        )
        self.assertEqual(
            self._read(target), "# Steckbrief\n\nZweck: Testprojekt.\n"
        )
        shown = json.loads(self.ok("repo", "show", repo, "--json").stdout)
        self.assertTrue(shown["project"]["exists"])
        self.assertEqual(shown["project"]["text"], "# Steckbrief\n\nZweck: Testprojekt.\n")
        text = self.ok("repo", "show", repo).stdout
        self.assertIn("Steckbrief: vorhanden", text)
        self.assertNotIn("Vorlage für den Steckbrief", text)
        self.assertIn("Steckbrief", self.ok("repos", "--add", repo).stdout)


class TeamBriefTests(ContextCase):
    def test_brief_aus_datei_list_json_und_unbekanntes_team(self):
        repo = self.make_repo()
        self.own_repo(repo)
        text = self.brief("Ziele: Test.\nPrioritäten: klein.\n")
        rows = json.loads(self.ok("team", "list", "--json").stdout)
        entry = [row for row in rows if row["name"] == "herdr-app"][0]
        self.assertEqual(entry["brief"], text.strip())
        self.assertIn("Brief", self.ok("team", "list").stdout)

        result = self.cli(
            "team", "edit", "gibtsnicht", "--brief", "x", "--from", "mensch"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unbekanntes Team", result.stderr)

        result = self.cli(
            "team", "edit", "herdr-app", "--brief-file",
            os.path.join(self.tmp, "fehlt.md"), "--from", "mensch",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("nicht lesbar", result.stderr)


class PromptContextTests(ContextCase):
    def _fremdes_repo(self):
        owned = self.make_repo("eigen")
        self.own_repo(owned)
        self.brief("GEHEIM: fremder Brief.\n")
        foreign = self.make_repo("fremd")
        self.project(foreign, "# Steckbrief\n\nZweck: fremd.\n")
        roster = {
            "path": self.roster,
            "context_limit": 6000,
            "teams": [{"name": "herdr-app", "repos": [owned]}],
        }
        return foreign, roster

    def test_kuerzung_nennt_auch_die_team_konfiguration_bei_mehreren_quellen(self):
        first = self.make_repo("eins")
        second = self.make_repo("zwei")
        self.project(first, "# Steckbrief\n\nZweck: eins.\n")
        self.project(second, "# Steckbrief\n\nZweck: zwei.\n")
        text = context.build_paths(
            [first, second], "B" * 2000, 800, "/r/roster.json"
        )
        self.assertIn("[…] gekürzt, vollständig in", text)
        # Nur der Brief ist zu lang; die Steckbriefe stehen vollständig da.
        self.assertIn("/r/roster.json", text)
        for repo in (first, second):
            self.assertNotIn(os.path.join(repo, ".fabric", "project.md"), text)
        self.assertIn("Zweck: eins.", text)
        self.assertIn("Zweck: zwei.", text)

    def test_langer_steckbrief_laesst_die_neueste_entscheidung_stehen(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Kontext", repo=repo)
        for number in range(1, 6):
            self.ok(
                "decide", tid, "--from", "mensch",
                f"Entscheidung {number}.",
            )
        project = "# Steckbrief\n\n" + "S" * 5886
        self.assertEqual(len(project), 5900)
        self.project(repo, project)
        text = context.build_paths([repo], "", 6000)
        self.assertLessEqual(len(text), 6000)
        self.assertIn("Entscheidung 5.", text)
        self.assertIn("[…] gekürzt, vollständig in", text)
        self.assertIn(
            os.path.join(repo, ".fabric", "project.md"), text
        )
        self.assertNotIn(
            os.path.join(repo, ".fabric", "decisions.md"), text
        )

    def test_beide_quellen_zu_gross_nennt_steckbrief_und_entscheidungen(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Kontext", repo=repo)
        for number in range(1, 6):
            self.ok(
                "decide", tid, "--from", "mensch",
                f"Entscheidung {number}. " + "E" * 1200,
            )
        self.project(repo, "# Steckbrief\n\n" + "S" * 5986)
        text = context.build_paths([repo], "", 6000)
        self.assertLessEqual(len(text), 6000)
        self.assertIn(
            os.path.join(repo, ".fabric", "project.md"), text
        )
        self.assertIn(
            os.path.join(repo, ".fabric", "decisions.md"), text
        )

    def test_rest_unter_hinweislaenge_ueberschreitet_die_grenze_nicht(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Kontext", repo=repo)
        self.ok("decide", tid, "--from", "mensch", "Kurze Entscheidung.")
        self.project(repo, "# S" + "S" * 100)
        base = context.build_paths([repo], "", 100000)
        maximum = len(base) + 8
        text = context.build_paths([repo], "B" * 500, maximum)
        self.assertLessEqual(len(text), maximum)
        self.assertEqual(text, base)

    def test_brief_verdraengt_die_entscheidungen_nicht(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Kontext", repo=repo)
        self.ok(
            "decide", tid, "--from", "mensch",
            "Entscheidung bleibt. " + "E" * 4000 + " ENDE",
        )
        self.project(repo, "# S" + "S" * 100)
        text = context.build_paths([repo], "B" * 3000, 6000)
        self.assertLessEqual(len(text), 6000)
        self.assertIn("ENDE", text)
        self.assertIn("[…] gekürzt", text)

    def test_gekuerzte_entscheidungen_behalten_die_neueste(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Kontext", repo=repo)
        for number in range(1, 6):
            self.ok(
                "decide", tid, "--from", "mensch",
                f"Entscheidung {number}. " + "E" * 1500 + f" ENDE{number}",
            )
        text = context.build_paths([repo], "", 6000)
        self.assertLessEqual(len(text), 6000)
        self.assertIn("ENDE5", text)
        self.assertIn(
            os.path.join(repo, ".fabric", "decisions.md"), text
        )

    def test_kleine_obergrenze_kuerzt_nur_den_hinweis_hinten(self):
        text = context.clip("x" * 100, 40, "/sehr/langer/pfad/zum/projekt.md")
        self.assertLessEqual(len(text), 40)
        self.assertIn("[…] gekürzt", text)

    def test_obergrenze_unter_hinweislänge_schneidet_den_hinweis_nicht(self):
        source = "/sehr/langer/pfad/zum/projekt.md"
        for maximum in range(1, context.MIN_LIMIT):
            text = context.clip("x" * 100, maximum, source)
            self.assertTrue(text.endswith(context.SHORT_HINT), text)
        self.assertEqual(
            context.clip("x" * 100, context.MIN_LIMIT, source),
            context.SHORT_HINT,
        )
        self.assertEqual(context.clip("x" * 100, 0, source), "")

    def test_settings_lehnt_limit_unter_hinweislänge_ab(self):
        for value in (1, context.MIN_LIMIT // 2, context.MIN_LIMIT - 1):
            result = self.cli(
                "settings", "set", "context_limit", str(value),
                "--from", "mensch",
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("context_limit", result.stderr)
            self.assertIn("0 (aus)", result.stderr)
            self.assertIn(str(context.MIN_LIMIT), result.stderr)
        self.ok("settings", "set", "context_limit", "0", "--from", "mensch")
        self.assertEqual(self.load_roster()["context_limit"], 0)
        self.ok(
            "settings", "set", "context_limit", str(context.MIN_LIMIT),
            "--from", "mensch",
        )
        self.assertEqual(self.load_roster()["context_limit"], context.MIN_LIMIT)

    def test_repo_ohne_team_hat_steckbrief_ohne_fremden_brief(self):
        foreign, roster = self._fremdes_repo()
        text = context.for_ticket(roster, {"repo": foreign})
        self.assertIn("Zweck: fremd.", text)
        self.assertNotIn("GEHEIM", text)
        self.assertNotIn(context.BRIEF_TITLE, text)

    def test_for_entry_ohne_team_nimmt_steckbrief_mit(self):
        foreign, roster = self._fremdes_repo()
        legacy = context.for_entry(roster, None, [foreign])
        self.assertIn("Zweck: fremd.", legacy)
        self.assertNotIn("GEHEIM", legacy)
        self.assertNotIn(context.BRIEF_TITLE, legacy)

    def test_prompts_enthalten_steckbrief_und_brief(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.project(repo, "# Steckbrief\n\nZweck: Testprojekt.\n")
        self.brief("Ziele: Kontext zeigen.\n")
        tid = self.new("Kontext", repo=repo)
        self.prompter()
        self.write_file(
            os.path.join(self.roster_dir, "prompts", "orchestrator.md"),
            "Rolle\n\n## Projekt und Team\n\n{context}\n",
        )
        roster = self.load_roster()
        start = agents.start_prompt(
            roster,
            self.ticket(tid),
            {"name": "zap", "role": "umsetzer", "prompt": "prompts/zap.md"},
        )
        orchestrated = agents.orchestrator_prompt(roster, "herdr-app")
        for text in (start, orchestrated):
            self.assertIn("## Projekt-Steckbrief", text)
            self.assertIn("Zweck: Testprojekt.", text)
            self.assertIn("## Team-Brief", text)
            self.assertIn("Ziele: Kontext zeigen.", text)
            self.assertNotIn("{context}", text)

    def test_ohne_steckbrief_und_brief_leerer_kontext(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Leer", repo=repo)
        self.prompter()
        _roster, text = self.start_context(tid)
        self.assertEqual(text, "")
        self.assertEqual(self.ok("context", tid).stdout, "")
        self.assertEqual(self.ok("context", "--team", "herdr-app").stdout, "")

    def test_obergrenze_kuerzt_sichtbar_und_grenzfall_gleich_lang(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.project(repo, "# Steckbrief\n\n" + "Zeile mit Inhalt.\n" * 40)
        tid = self.new("Grenze", repo=repo)
        self.prompter()
        _roster, full = self.start_context(tid)
        self.assertIn("Zeile mit Inhalt.", full)
        self.assertNotIn("gekürzt", full)
        length = len(full)

        self.set_limit(length)
        _roster, exact = self.start_context(tid)
        self.assertEqual(exact, full)
        self.assertNotIn("gekürzt", exact)

        self.set_limit(length - 1)
        _roster, clipped = self.start_context(tid)
        self.assertLessEqual(len(clipped), length - 1)
        self.assertNotEqual(clipped, full)
        self.assertIn("[…] gekürzt, vollständig in", clipped)
        self.assertIn(
            os.path.join(repo, ".fabric", "project.md"), clipped
        )
        self.assertTrue(full.startswith(clipped.split("\n\n[…]")[0]))


class ContextCommandTests(ContextCase):
    def test_fab_context_gibt_genau_den_prompt_teil(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.project(repo, "# Steckbrief\n\nZweck: Anzeige.\n")
        self.brief("Ziele: Anzeige.\n")
        tid = self.new("Anzeige", repo=repo)
        roster = self.load_roster()
        ticket = self.ticket(tid)
        expected = context.for_ticket(roster, ticket)
        self.assertEqual(self.ok("context", tid).stdout, expected + "\n")
        team_expected = context.for_team(roster, "herdr-app")
        self.assertEqual(
            self.ok("context", "--team", "herdr-app").stdout,
            team_expected + "\n",
        )
        result = self.cli("context")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ID oder --team", result.stderr)

    def test_fab_context_json_mit_steckbrief_brief_und_obergrenze(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.project(repo, "# Steckbrief\n\nZweck: Anzeige.\n")
        self.brief("Ziele: Anzeige.\n")
        self.set_limit(1234)
        tid = self.new("Anzeige", repo=repo)

        data = json.loads(self.ok("context", tid, "--json").stdout)
        self.assertIn("Zweck: Anzeige.", data["text"])
        self.assertIn("Ziele: Anzeige.", data["text"])
        self.assertEqual(data["chars"], len(data["text"]))
        self.assertEqual(data["limit"], 1234)
        self.assertFalse(data["clipped"])
        self.assertEqual(data["scope"], "ticket")
        self.assertEqual(data["id"], tid)
        self.assertIsNone(data["team"])

        team = json.loads(
            self.ok("context", "--team", "herdr-app", "--json").stdout
        )
        self.assertEqual(team["scope"], "team")
        self.assertEqual(team["team"], "herdr-app")
        self.assertIsNone(team["id"])
        self.assertIn("Zweck: Anzeige.", team["text"])
        self.assertIn("Ziele: Anzeige.", team["text"])
        self.assertEqual(team["chars"], len(team["text"]))
        self.assertEqual(team["limit"], 1234)
        self.assertFalse(team["clipped"])

    def test_fab_context_json_leer(self):
        repo = self.make_repo()
        self.own_repo(repo)
        tid = self.new("Leer", repo=repo)
        data = json.loads(self.ok("context", tid, "--json").stdout)
        self.assertEqual(data["text"], "")
        self.assertEqual(data["chars"], 0)
        self.assertIsInstance(data["limit"], int)
        self.assertGreaterEqual(data["limit"], 0)
        self.assertEqual(data["scope"], "ticket")
        self.assertEqual(data["id"], tid)

        team = json.loads(
            self.ok("context", "--team", "herdr-app", "--json").stdout
        )
        self.assertEqual(team["text"], "")
        self.assertEqual(team["chars"], 0)
        self.assertEqual(team["scope"], "team")
        self.assertEqual(team["team"], "herdr-app")
        self.assertFalse(team["clipped"])

    def test_fab_context_json_kuerzung_kommt_aus_clip_nicht_aus_dem_wort(self):
        repo = self.make_repo()
        self.own_repo(repo)
        self.project(repo, "# Steckbrief\n\n" + "Zeile mit Inhalt.\n" * 80)
        self.set_limit(200)
        tid = self.new("Grenze", repo=repo)
        data = json.loads(self.ok("context", tid, "--json").stdout)
        self.assertTrue(data["clipped"])
        self.assertLessEqual(data["chars"], 200)
        self.assertEqual(data["chars"], len(data["text"]))
        self.assertIn("gekürzt", data["text"])

        self.project(repo, "# Steckbrief\n\nBudget wurde gekürzt.\n")
        self.set_limit(6000)
        plain = json.loads(self.ok("context", tid, "--json").stdout)
        self.assertFalse(plain["clipped"])
        self.assertIn("Budget wurde gekürzt.", plain["text"])


class KnowledgeContextTests(FabricCase):
    def knowledge(self, repo, names=("handbuch.md", "skizze.pdf")):
        folder = os.path.join(repo, ".fabric", "knowledge")
        os.makedirs(folder, exist_ok=True)
        for name in names:
            self.write_file(os.path.join(folder, name), "GEHEIMER INHALT\n")
        return folder

    def test_wissensabschnitt_nennt_pfad_und_dateinamen_ohne_inhalt(self):
        repo = self.make_repo()
        folder = self.knowledge(repo)
        text = context.build_paths([repo], "", 6000)
        self.assertIn("## Wissensordner", text)
        self.assertIn(folder, text)
        self.assertIn("- handbuch.md", text)
        self.assertIn("- skizze.pdf", text)
        self.assertNotIn("GEHEIMER INHALT", text)

    def test_ohne_und_mit_leerem_ordner_kein_abschnitt(self):
        repo = self.make_repo()
        self.assertNotIn("Wissensordner", context.build_paths([repo], "", 6000))
        os.makedirs(os.path.join(repo, ".fabric", "knowledge"))
        self.assertNotIn("Wissensordner", context.build_paths([repo], "", 6000))
        self.assertEqual(context.build_paths([repo], "", 6000), "")

    def test_vier_quellen_kuerzen_nur_den_brief(self):
        repo = self.make_repo()
        os.makedirs(os.path.join(repo, ".fabric"), exist_ok=True)
        self.write_file(
            os.path.join(repo, ".fabric", "project.md"),
            "# Steckbrief\n\n" + "S" * 100 + "\n",
        )
        self.write_file(
            os.path.join(repo, ".fabric", "decisions.md"), "- Kurz.\n"
        )
        folder = self.knowledge(repo)
        text = context.build_paths([repo], "B" * 5000, 1000, "/r/roster.json")
        self.assertLessEqual(len(text), 1000)
        for part in (
            "## Projekt-Steckbrief",
            "## Entscheidungen",
            "## Wissensordner",
            "## Team-Brief",
        ):
            self.assertIn(part, text)
        self.assertIn(folder, text)
        lines = [
            line
            for line in text.splitlines()
            if "[…] gekürzt, vollständig in" in line
        ]
        self.assertEqual(len(lines), 1, lines)
        self.assertIn("/r/roster.json", lines[0])

    def test_gekuerzter_wissensblock_behaelt_den_ordnerpfad(self):
        repo = self.make_repo()
        names = tuple(f"notiz-{number:02d}.md" for number in range(40))
        folder = self.knowledge(repo, names)
        real = os.path.realpath(folder)
        full = context.build_paths([repo], "", 100000)
        self.assertIn("notiz-39.md", full)

        prefix = f"## {context.WISSEN_TITLE}\n\n{real}"
        marker = "\n\n" + context.HINT.format(source=real)
        maximum = len(marker) + len(prefix) + 20
        text = context.build_paths([repo], "", maximum)
        self.assertLessEqual(len(text), maximum)
        self.assertIn(prefix, text)
        self.assertIn("[…] gekürzt", text)
        self.assertNotIn("notiz-39.md", text)

    def test_lange_dateiliste_verdraengt_steckbrief_und_brief_nicht(self):
        repo = self.make_repo()
        folder = self.knowledge(
            repo, tuple(f"notiz-{number:02d}.md" for number in range(60))
        )
        real = os.path.realpath(folder)
        self.write_file(
            os.path.join(repo, ".fabric", "project.md"),
            "# Steckbrief\n\n" + "S" * 1487,
        )
        self.write_file(
            os.path.join(repo, ".fabric", "decisions.md"),
            "".join(f"- Entscheidung {number}.\n" for number in range(1, 6)),
        )

        text = context.build_paths([repo], "B" * 3000, 1500, "/r/roster.json")
        self.assertLessEqual(len(text), 1500)
        self.assertIn(f"## {context.PROJECT_TITLE}", text)
        self.assertIn(real, text)
        self.assertIn(f"## {context.BRIEF_TITLE}", text)

        hint = context.HINT.format(source="")
        hints = [line for line in text.splitlines() if hint in line]
        self.assertTrue(hints, text)
        self.assertEqual(
            len([line for line in hints if "project.md" in line]), 1, hints
        )
        self.assertEqual(
            len([line for line in hints if real in line]), 1, hints
        )
        self.assertTrue(
            [line for line in hints if "/r/roster.json" in line], hints
        )
        self.assertFalse(
            [line for line in hints if "decisions.md" in line], hints
        )


class MapContextTests(FabricCase):
    def project_map(self, repo, text="# Projektkarte\n\n## Ziel\nKarte.\n"):
        path = os.path.join(repo, ".fabric", "map.md")
        self.write_file(path, text)
        return path

    def test_ohne_karte_kein_abschnitt(self):
        repo = self.make_repo()
        text = context.build_paths([repo], "", 6000)
        self.assertNotIn(context.MAP_TITLE, text)
        self.assertEqual(text, "")

    def test_karte_nennt_absoluten_pfad_ohne_inhalt(self):
        repo = self.make_repo()
        secret = "GEHEIMER KARTENINHALT 4711"
        target = self.project_map(repo, f"# Karte\n\n{secret}\n")
        text = context.build_paths([repo], "", 6000)
        self.assertIn(f"## {context.MAP_TITLE}", text)
        self.assertIn(os.path.realpath(target), text)
        self.assertNotIn(secret, text)

    def test_fuenf_quellen_kuerzen_nur_den_brief(self):
        repo = self.make_repo()
        project = os.path.join(repo, ".fabric", "project.md")
        decisions = os.path.join(repo, ".fabric", "decisions.md")
        self.write_file(project, "# Steckbrief\n\nZweck: Testprojekt.\n")
        self.write_file(decisions, "- Kurz.\n")
        folder = os.path.join(repo, ".fabric", "knowledge")
        os.makedirs(folder, exist_ok=True)
        for name in ("handbuch.md", "skizze.pdf"):
            self.write_file(os.path.join(folder, name), "GEHEIMER INHALT\n")
        target = self.project_map(repo)
        text = context.build_paths([repo], "B" * 5000, 1200, "/r/roster.json")
        self.assertLessEqual(len(text), 1200)
        for part in (
            "## Projekt-Steckbrief",
            "## Entscheidungen",
            "## Wissensordner",
            "## Projektkarte",
            "## Team-Brief",
        ):
            self.assertIn(part, text)
        sources = (
            os.path.realpath(project),
            os.path.realpath(decisions),
            os.path.realpath(folder),
            os.path.realpath(target),
        )
        # Steckbrief und Entscheidungen stehen vollständig da; Wissensordner
        # und Karte nennen ihren absoluten Pfad.
        self.assertIn("Zweck: Testprojekt.", text)
        self.assertIn("- Kurz.", text)
        self.assertIn(sources[2], text)
        self.assertIn(sources[3], text)

        hint = context.HINT.format(source="")
        hints = [
            line for line in text.splitlines() if hint in line
        ]
        self.assertEqual(len(hints), 1, hints)
        self.assertIn("/r/roster.json", hints[0])
        for path in sources:
            self.assertNotIn(path, hints[0])

    def test_mehrere_gekuerzte_quellen_nennen_nur_ihre_pfade(self):
        repo = self.make_repo()
        project = os.path.join(repo, ".fabric", "project.md")
        decisions = os.path.join(repo, ".fabric", "decisions.md")
        self.write_file(project, "# Steckbrief\n\n" + "S" * 4000)
        self.write_file(decisions, "- Kurz.\n")
        folder = os.path.join(repo, ".fabric", "knowledge")
        os.makedirs(folder, exist_ok=True)
        for number in range(40):
            self.write_file(
                os.path.join(folder, f"notiz-{number:02d}.md"), "INHALT\n"
            )
        target = self.project_map(repo)
        maximum = 2400
        text = context.build_paths(
            [repo], "B" * 4000, maximum, "/r/roster.json"
        )
        self.assertLessEqual(len(text), maximum)
        project_path = os.path.realpath(project)
        decision_path = os.path.realpath(decisions)
        real_folder = os.path.realpath(folder)
        real_map = os.path.realpath(target)
        for part in (
            "## Projekt-Steckbrief",
            "## Projektkarte",
            "## Team-Brief",
        ):
            self.assertIn(part, text)
        self.assertIn(real_map, text)
        self.assertIn("- Kurz.", text)

        hint = context.HINT.format(source="")
        hints = [
            line for line in text.splitlines() if hint in line
        ]
        self.assertTrue(hints, text)
        self.assertEqual(len(hints), 3, hints)
        self.assertEqual(
            len([line for line in hints if project_path in line]), 1, hints
        )
        self.assertEqual(
            len([line for line in hints if real_folder in line]), 1, hints
        )
        self.assertTrue(
            [line for line in hints if "/r/roster.json" in line], hints
        )
        self.assertFalse(
            [line for line in hints if decision_path in line], hints
        )
        self.assertFalse(
            [line for line in hints if real_map in line], hints
        )

    def test_gekuerzter_steckbrief_nennt_nicht_den_vollen_brief(self):
        repo = self.make_repo()
        project = os.path.join(repo, ".fabric", "project.md")
        decisions = os.path.join(repo, ".fabric", "decisions.md")
        self.write_file(project, "# Steckbrief\n\n" + "S" * 8000)
        self.write_file(decisions, "- Kurz.\n")
        folder = os.path.join(repo, ".fabric", "knowledge")
        os.makedirs(folder, exist_ok=True)
        for name in ("handbuch.md", "skizze.pdf"):
            self.write_file(os.path.join(folder, name), "INHALT\n")
        target = self.project_map(repo)
        brief = "Kurzer Brief.\n"
        text = context.build_paths([repo], brief, 2000, "/r/roster.json")
        self.assertLessEqual(len(text), 2000)
        self.assertIn("## Team-Brief", text)
        self.assertIn(brief.strip(), text)
        self.assertIn(os.path.realpath(target), text)
        # Der Steckbrief ist zu lang, der Brief passt vollständig hinein:
        # Der Hinweis nennt nur den Steckbrief, nicht die Roster-Quelle.
        hint = context.HINT.format(source="")
        hints = [line for line in text.splitlines() if hint in line]
        self.assertTrue(hints, text)
        self.assertEqual(
            len([line for line in hints if os.path.realpath(project) in line]),
            1,
            hints,
        )
        self.assertFalse(
            [line for line in hints if "/r/roster.json" in line], hints
        )

    def test_ohne_zeiger_nennt_gekuerzter_steckbrief_den_entfallenen_brief(self):
        repo = self.make_repo()
        project = os.path.join(repo, ".fabric", "project.md")
        self.write_file(project, "# Steckbrief\n\n" + "S" * 8000)
        # Kein Wissensordner, keine Karte: der Zweig kürzt den Steckbrief
        # und lässt den Brief vollständig entfallen.
        text = context.build_paths(
            [repo], "B" * 500, 1000, "/r/roster.json"
        )
        self.assertLessEqual(len(text), 1000)
        self.assertIn("## Projekt-Steckbrief", text)
        self.assertNotIn("## Team-Brief", text)
        hint = context.HINT.format(source="")
        hints = [line for line in text.splitlines() if hint in line]
        self.assertEqual(len(hints), 1, hints)
        self.assertIn(os.path.realpath(project), hints[0])
        self.assertIn("/r/roster.json", hints[0])
