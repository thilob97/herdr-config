"""SQLite-Ablage: WAL, Transaktionen, Migration, Nebenläufigkeit, Lesemodelle.

Die Tests sprechen entweder über die CLI (Subprozess, echtes flock) oder
in-process über `store` mit gepatchtem `FAB_HOME`.
"""
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from unittest import mock

from fabric.fablib import events, store
from fabric.tests.support import FAB, FabricCase

TICKETS = (
    "tickets", "comments", "sessions", "events", "counter", "attachments",
    "read_models", "autopilot_log", "config", "prompts", "templates",
)


class SqliteTests(FabricCase):
    # -- Hilfen

    def _env(self):
        return mock.patch.dict(
            os.environ, {"FAB_HOME": self.home, "HOME": self.fake_home}
        )

    def _storage(self):
        with self._env():
            return store.storage_info()

    def _patch(self, tid, **fields):
        """In-process ändern und speichern: DB bleibt die Quelle."""
        with self._env():
            with store.locked():
                ticket = store.load(tid)
                ticket.update(fields)
                store.save(ticket)
            return store.load(tid)

    def _db_ticket(self, tid):
        with self._env():
            return store.load(tid)

    def _write_legacy_fixture(self):
        self._drop_db()
        first = {
            "id": "T-1",
            "title": "Altes Ticket",
            "status": "todo",
            "body": "Auftrag",
            "created_at": 1000,
            "updated_at": 2000,
            "eigenes_feld": {"bleibt": True},
            "waiting": ["mensch"],
            "comments": [
                {"at": 1100, "author": "zap", "text": "erster",
                 "mentions": ["ada"]},
                {"at": 1200, "author": "ada", "text": "zweiter",
                 "mentions": []},
            ],
            "sessions": [
                {"agent": "zap", "name": "fab-zap-t-1", "terminal": "t1",
                 "started_at": 1500},
            ],
            "attachments": [
                {"name": "bild.png", "path": "attachments/T-1/bild.png",
                 "at": 1600},
            ],
        }
        second = {
            "id": "T-2",
            "title": "Zweites Ticket",
            "status": "done",
            "comments": [],
        }
        self._write(
            os.path.join(self.home, "tickets", "T-1.json"),
            json.dumps(first, ensure_ascii=False, indent=2),
        )
        self._write(
            os.path.join(self.home, "tickets", "T-2.json"),
            json.dumps(second, ensure_ascii=False, indent=2),
        )
        self._write(os.path.join(self.home, "counter"), "3\n")
        rows = [
            {"at": 10, "kind": "created", "ticket": "T-1", "actor": "mensch",
             "target": "", "text": "angelegt", "reason": ""},
            {"at": 20, "kind": "comment", "ticket": "T-1", "actor": "zap",
             "target": "", "text": "kommentiert", "reason": ""},
        ]
        self._write(
            os.path.join(self.home, "events.jsonl"),
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        )
        attachment = os.path.join(
            self.home, "attachments", "T-1", "bild.png")
        os.makedirs(os.path.dirname(attachment), exist_ok=True)
        with open(attachment, "wb") as handle:
            handle.write(b"\x89PNG\r\n\x1a\nlegacy")

    def _legacy_entries(self):
        folder = os.path.join(self.home, "legacy")
        if not os.path.isdir(folder):
            return []
        return sorted(os.listdir(folder))

    def _drop_db(self):
        """DB entfernen, damit die Altdateien-Migration im Test wieder greift."""
        with self._env():
            store._close_conn()
            store._bootstrapped.discard(self.home)
            store._fallback.discard(self.home)
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(os.path.join(self.home, "fabric.db" + suffix))
            except FileNotFoundError:
                pass

    def _newest_legacy_files(self):
        folder = os.path.join(self.home, "legacy")
        names = sorted(
            name for name in os.listdir(folder) if name.startswith("files-")
        )
        self.assertTrue(names, "kein legacy/files-* nach der Migration")
        return os.path.join(folder, names[-1])

    def _legacy_files_entries(self):
        newest = self._newest_legacy_files()
        return sorted(os.listdir(newest))

    # 1

    def test_wal_und_tabellen(self):
        tid = self.new("X")
        self.assertEqual(tid, "T-1")
        info = self._storage()
        self.assertEqual(info["journal_mode"], "wal")
        for name in TICKETS:
            self.assertIn(name, info["tables"])
        self.assertEqual(info["counts"]["tickets"], 1)
        self.assertEqual(info["counts"]["counter"], 2)

    # 2

    def test_abgebrochener_schreibvorgang(self):
        with self._env():
            with self.assertRaises(RuntimeError):
                with store.locked():
                    tid = store.next_id()
                    ticket = store.blank_ticket(tid, title="Abbruch")
                    store.save(ticket)
                    store.event_append("created", tid, "test", "", "x")
                    raise RuntimeError("Abbruch")
            with store.locked():
                self.assertEqual(store.all_tickets(), [])
                self.assertEqual(store.event_rows(), [])
                self.assertEqual(store.next_id(), "T-1")
                self.assertIsNone(
                    store.read_model(store.ticket_model_key("T-1")))

    # 3

    def test_migration_vollstaendig_und_wiederholbar(self):
        self._write_legacy_fixture()
        result = self.ok("migrate", "--json")
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "migrated")
        for key in ("tickets", "comments", "sessions", "events",
                    "attachments", "counter"):
            self.assertEqual(report["old"][key], report["new"][key], key)
        self.assertEqual(report["old"]["tickets"], 2)
        self.assertEqual(report["old"]["comments"], 2)
        self.assertEqual(report["old"]["sessions"], 1)
        self.assertEqual(report["old"]["attachments"], 1)
        self.assertEqual(report["old"]["events"], 2)
        self.assertEqual(report["old"]["counter"], 3)

        legacy = self._newest_legacy_files()
        self.assertTrue(os.path.exists(os.path.join(legacy, "tickets", "T-1.json")))
        self.assertTrue(os.path.exists(os.path.join(legacy, "counter")))
        self.assertTrue(os.path.exists(os.path.join(legacy, "events.jsonl")))
        self.assertTrue(os.path.exists(
            os.path.join(legacy, "attachments", "T-1", "bild.png")))
        # Keine Altdateien mehr im Datenordner, keine Ticketdateien am alten Ort.
        self.assertFalse(os.path.exists(os.path.join(self.home, "index.json")))
        self.assertFalse(os.path.exists(
            os.path.join(self.home, "tickets", "T-1.json")))

        with self._env():
            index_model = store.read_model_json("index")
            ticket_model = store.read_model_json(
                store.ticket_model_key("T-1"))
            self.assertEqual(
                [row["id"] for row in index_model["tickets"]], ["T-1", "T-2"])
            self.assertEqual(ticket_model["title"], "Altes Ticket")
            attachment = store.attachment_models("T-1")[0]
            self.assertEqual(attachment["name"], "bild.png")
            self.assertEqual(
                attachment["cache_path"],
                "data/fabric/cache/attachments/T-1/1-bild.png")
            rows = store.attachment_rows("T-1")
            self.assertEqual(rows[0]["data"], b"\x89PNG\r\n\x1a\nlegacy")
        self.assertTrue(os.path.isfile(os.path.join(
            self.home, "cache", "attachments", "T-1", "1-bild.png")))

        shown = json.loads(self.ok("show", "T-1", "--json").stdout)
        self.assertEqual([row["text"] for row in shown["comments"]],
                         ["erster", "zweiter"])
        self.assertEqual(shown["comments"][0]["mentions"], ["ada"])
        self.assertEqual(len(shown["sessions"]), 1)
        self.assertEqual(shown["sessions"][0]["name"], "fab-zap-t-1")
        self.assertEqual(shown["eigenes_feld"], {"bleibt": True})

        entries = self._legacy_entries()
        second = json.loads(self.ok("migrate", "--json").stdout)
        self.assertEqual(second["status"], "already")
        for key in ("tickets", "comments", "sessions", "events",
                    "attachments", "counter"):
            self.assertEqual(second["new"][key], report["new"][key], key)
        self.assertEqual(second["new"]["events"], 2)
        self.assertEqual(self._legacy_entries(), entries)

    # 4

    def test_automatischer_erstlauf(self):
        self._write_legacy_fixture()
        result = self.ok("list")
        self.assertIn("T-1", result.stdout)
        self.assertTrue(os.path.exists(os.path.join(self.home, "fabric.db")))
        self.assertEqual(len(self._legacy_entries()), 1)
        self.assertEqual(self._legacy_files_entries(), [
            "attachments", "counter", "events.jsonl", "tickets",
        ])
        self.assertFalse(os.path.exists(os.path.join(self.home, "counter")))
        self.assertFalse(os.path.exists(os.path.join(self.home, "events.jsonl")))
        self.assertFalse(os.path.exists(os.path.join(self.home, "tickets")))

    # 5

    def test_migration_fehler_bleibt_auf_altdateien(self):
        self._drop_db()
        valid = {"id": "T-1", "title": "Gut", "status": "todo", "comments": []}
        self._write(
            os.path.join(self.home, "tickets", "T-1.json"),
            json.dumps(valid, ensure_ascii=False),
        )
        self._write(os.path.join(self.home, "tickets", "T-2.json"), "{kaputt")
        self._write(os.path.join(self.home, "counter"), "3\n")

        result = self.cli("list")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Fabric-Datenbank", result.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.home, "fabric.db")))
        self.assertEqual(self._legacy_entries(), [])
        self.assertTrue(os.path.exists(
            os.path.join(self.home, "tickets", "T-1.json")))
        self.assertTrue(os.path.exists(
            os.path.join(self.home, "tickets", "T-2.json")))

        fixed = {"id": "T-2", "title": "Repariert", "status": "todo",
                 "comments": []}
        self._write(
            os.path.join(self.home, "tickets", "T-2.json"),
            json.dumps(fixed, ensure_ascii=False),
        )
        report = json.loads(self.ok("migrate", "--json").stdout)
        self.assertEqual(report["status"], "migrated")
        self.assertEqual(report["new"]["tickets"], 2)
        self.assertTrue(os.path.exists(os.path.join(self.home, "fabric.db")))
        self.assertEqual(len(self._legacy_entries()), 1)
        shown = json.loads(self.ok("show", "T-2", "--json").stdout)
        self.assertEqual(shown["title"], "Repariert")

    # 6

    def test_zwei_schreiber_verlieren_keine_aenderung(self):
        tid = self.new("Nebenläufig")
        procs = []
        for author, text in (("zap", "erster Schreiber"), ("ada", "zweiter Schreiber")):
            procs.append(subprocess.Popen(
                [sys.executable, FAB, "comment", tid, "--from", author,
                 "--no-wake", text],
                cwd=self.tmp,
                env=self.env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            ))
        for proc in procs:
            out, err = proc.communicate(timeout=120)
            self.assertEqual(proc.returncode, 0, err)

        ticket = self._db_ticket(tid)
        texts = [row["text"] for row in ticket["comments"]]
        self.assertIn("erster Schreiber", texts)
        self.assertIn("zweiter Schreiber", texts)
        self.assertEqual(len(ticket["comments"]), 3)
        self.assertEqual(self.index_entry(tid)["comment_count"], 3)

    def index_entry(self, tid):
        payload = self.index()
        return next(row for row in payload["tickets"] if row["id"] == tid)

    # 7

    def test_backup_rotation_und_taeglich(self):
        tid = self.new("Sicherung")
        payload = json.loads(self.ok("backup", "--json").stdout)
        self.assertEqual(payload["retained"], 1)
        self.assertTrue(payload["path"].endswith(".db"))
        self.assertEqual(len(store_backup_files(self.home)), 1)

        with self._env():
            for _ in range(16):
                store.backup()
            self.assertEqual(len(store.backup_files()), 14)

            # Tagesmarke zurücksetzen; meta_set kann selbst sichern.
            store.meta_set("last_backup_day", "2000-01-01")
            store.prune_backups(keep=3)
            before = set(store.backup_files())
            self.assertEqual(len(before), 3)

        self.ok("comment", tid, "--from", "zap", "--no-wake", "weiter")

        with self._env():
            after = set(store.backup_files())
            self.assertEqual(store.meta_get("last_backup_day"), self.today())
        self.assertGreater(len(after), len(before))
        self.assertLessEqual(len(after), 14)
        self.assertTrue(after - before)

        # Eingefrorene Uhr: viele Sicherungen im selben Stempel, Prune behält
        # die neuesten (numerische Reihenfolge, nicht lexikalisch).
        with self._env():
            store.prune_backups(keep=0)
            self.assertEqual(store.backup_files(), [])
            with mock.patch.dict(os.environ, {"FAB_NOW": "1700000000000"}):
                for _ in range(12):
                    store.backup()
                stamp = datetime.fromtimestamp(
                    1700000000000 / 1000).strftime("%Y%m%d-%H%M%S-%f")
                expected = [f"fabric-{stamp}.db"] + [
                    f"fabric-{stamp}-{suffix}.db" for suffix in range(2, 13)
                ]
                ordered = [os.path.basename(path) for path in store.backup_files()]
                self.assertEqual(len(ordered), 12)
                self.assertEqual(ordered, expected)
                store.prune_backups(keep=5)
                remaining = [os.path.basename(path) for path in store.backup_files()]
                self.assertEqual(remaining, expected[-5:])

    def test_sicherung_integritaet_und_zaehlergleich(self):
        tid = self.new("Sicherungsinhalt")
        for index in range(3):
            self.ok("comment", tid, "--from", "zap", "--no-wake",
                    f"notiz {index}")
        payload = json.loads(self.ok("backup", "--json").stdout)
        with self._env():
            source = store.db_path()

        def snapshot(path):
            conn = sqlite3.connect(path)
            try:
                integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
                counts = {
                    name: conn.execute(
                        f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                    for name in ("tickets", "comments", "sessions", "events")
                }
            finally:
                conn.close()
            return integrity, counts

        self.assertEqual(snapshot(payload["path"])[0], "ok")
        self.assertEqual(snapshot(source), snapshot(payload["path"]))

    def test_kommentar_rohdaten_und_nummern(self):
        tid = self.new("Rohdaten")
        with self._env():
            with store.locked():
                ticket = store.load(tid)
                ticket["comments"] = [
                    {"n": 1, "at": 100, "author": "zap", "text": "eins",
                     "mentions": [], "edited_at": 150},
                    {"n": 3, "at": 300, "author": "ada", "text": "drei",
                     "mentions": ["zap"], "extra": {"felder": [1, 2]}},
                ]
                store.save(ticket)
            loaded = store.load(tid)
        self.assertEqual([item["n"] for item in loaded["comments"]], [1, 3])
        self.assertEqual(loaded["comments"][0]["edited_at"], 150)
        self.assertEqual(loaded["comments"][1]["extra"], {"felder": [1, 2]})
        self.assertEqual(loaded["comments"][1]["mentions"], ["zap"])

        self.ok("comment", tid, "--from", "zap", "--no-wake", "vier")
        numbered = self.ticket(tid)
        self.assertEqual([item["n"] for item in numbered["comments"]],
                         [1, 3, 4])

    def test_kommentar_nummern_randfaelle(self):
        tid = self.new("Nummern")
        with self._env():
            with store.locked():
                ticket = store.load(tid)
                ticket["comments"] = [
                    {"n": -2, "text": "ungueltig"},
                    {"n": True, "text": "bool"},
                    {"n": 1, "text": "eins"},
                    {"n": 1, "text": "doppelt"},
                ]
                store.save(ticket)
            loaded = store.load(tid)
        self.assertEqual([item["n"] for item in loaded["comments"]],
                         [1, 2, 3, 4])
        self.assertEqual([item["text"] for item in loaded["comments"]],
                         ["ungueltig", "bool", "eins", "doppelt"])

    def test_altdatenbank_bekommt_kommentar_rohdaten(self):
        """Alte DB ohne comments.data: Spalte nachziehen, NULL-Fallback lesen."""
        self._drop_db()
        tid = "T-1"
        path = os.path.join(self.home, "fabric.db")
        conn = sqlite3.connect(path)
        try:
            for statement in store._SCHEMA:
                if "CREATE TABLE IF NOT EXISTS comments" in statement:
                    statement = statement.replace("        data TEXT,\n", "")
                conn.execute(statement)
            conn.execute(
                "INSERT INTO tickets(id,number,data,title,status) "
                "VALUES (?,?,?,?,?)",
                (tid, 1, json.dumps({"id": tid, "title": "Alt",
                                     "status": "todo", "comments": []}),
                 "Alt", "todo"),
            )
            conn.execute(
                "INSERT INTO comments(ticket,n,at,author,text,mentions) "
                "VALUES (?,?,?,?,?,?)",
                (tid, 1, 100, "zap", "alt eins", '["ada"]'),
            )
            conn.execute(
                "INSERT INTO comments(ticket,n,at,author,text,mentions) "
                "VALUES (?,?,?,?,?,?)",
                (tid, 3, 300, "ada", "alt drei", "[]"),
            )
            conn.execute("INSERT INTO counter(id,value) VALUES (1,2)")
            conn.execute(
                "INSERT INTO meta(key,value) VALUES ('last_backup_day',?)",
                (self.today(),),
            )
            conn.commit()
            columns = [row[1] for row in conn.execute(
                "PRAGMA table_info(comments)")]
        finally:
            conn.close()
        self.assertNotIn("data", columns)

        with self._env():
            loaded = store.load(tid)
        self.assertEqual([item["n"] for item in loaded["comments"]], [1, 3])
        self.assertEqual(loaded["comments"][0]["mentions"], ["ada"])
        self.assertEqual(loaded["comments"][1]["text"], "alt drei")

        # Die Alt-DB hat kein Roster; ohne Repo-Dateien kommt es nur aus der DB.
        self.write_roster()
        self.ok("comment", tid, "--from", "zap", "--no-wake", "neu")
        numbered = self._db_ticket(tid)
        self.assertEqual([item["n"] for item in numbered["comments"]],
                         [1, 3, 4])

        conn = sqlite3.connect(path)
        try:
            columns = [row[1] for row in conn.execute(
                "PRAGMA table_info(comments)")]
            raw = [row[0] for row in conn.execute(
                "SELECT data FROM comments ORDER BY n")]
        finally:
            conn.close()
        self.assertIn("data", columns)
        self.assertTrue(all(value for value in raw), raw)

    @staticmethod
    def today():
        from datetime import datetime

        return datetime.fromtimestamp(store.now_ms() / 1000).date().isoformat()

    def test_altdatenbank_bekommt_pipeline_grund(self):
        """Alte DB ohne pipeline_runs.reason: Spalte nachziehen, Läufe bleiben."""
        self._drop_db()
        path = os.path.join(self.home, "fabric.db")
        conn = sqlite3.connect(path)
        try:
            for statement in store._SCHEMA:
                if "CREATE TABLE IF NOT EXISTS pipeline_runs" in statement:
                    statement = statement.replace(
                        "        duration_ms INTEGER,\n        reason TEXT\n",
                        "        duration_ms INTEGER\n",
                    )
                conn.execute(statement)
            conn.execute("PRAGMA user_version=2")
            conn.execute(
                "INSERT INTO pipeline_runs(ticket,trigger,state,started_at,"
                "duration_ms) VALUES ('T-9','verify','pass',1,2)"
            )
            conn.commit()
            columns = [row[1] for row in conn.execute(
                "PRAGMA table_info(pipeline_runs)")]
        finally:
            conn.close()
        self.assertNotIn("reason", columns)

        with self._env():
            store._close_conn()
            runs = store.pipeline_run_list()
            columns = [row[1] for row in store._connect().execute(
                "PRAGMA table_info(pipeline_runs)")]

        self.assertEqual(
            [(run["ticket"], run["state"], run["reason"]) for run in runs],
            [("T-9", "pass", "")],
        )
        self.assertIn("reason", columns)

    # 8

    def test_sql_abfragen(self):
        ids = [self.new(f"Frage {index}") for index in range(1, 6)]
        self._patch(ids[0], status="draft")
        self._patch(ids[1], status="todo")
        self._patch(ids[2], status="doing")
        self._patch(ids[3], status="review")
        self._patch(ids[4], status="done")
        # Wartende und Stillstände
        self._patch(ids[0], waiting=["mensch"])
        self._patch(ids[1], stall={"rule": "doing", "attention": True,
                                   "since": 1000, "reason": "haengt"})
        self._patch(ids[2], waiting=["mensch"],
                    stall={"rule": "doing", "attention": True,
                           "since": 2000, "reason": "haengt"})
        self._patch(ids[3], waiting=["mensch"],
                    stall={"rule": "review", "attention": True,
                           "since": 3000, "reason": "haengt"})
        self._patch(ids[4], stall={"rule": "doing", "attention": True,
                                   "since": 4000, "reason": "haengt"})

        with self._env():
            # Offen = alles außer done/dropped; der Tick muss auch review
            # und Entwürfe sehen.
            self.assertEqual([t["id"] for t in store.open_tickets()],
                             ids[:4])
            self.assertEqual([t["id"] for t in store.review_tickets()],
                             [ids[3]])
            self.assertEqual([t["id"] for t in store.question_tickets()],
                             [ids[0], ids[2]])
            self.assertEqual([t["id"] for t in store.stalled_tickets()],
                             [ids[1], ids[2]])

            for index, (tid, target, text, at) in enumerate([
                (ids[0], "zap", "geweckt", 1000),
                (ids[0], "zap", "geweckt", 2000),
                (ids[0], "ada", "geweckt", 3000),
                (ids[1], "zap", "geweckt", 4000),
            ]):
                store.event_append("wake", tid, "test", target, text, at=at)
            store.event_append("comment", ids[0], "test", "zap", "geweckt",
                               at=5000)

            self.assertEqual(
                store.event_count_wakes(ids[0], "zap", 1500, ["geweckt"]), 1)
            self.assertEqual(
                store.event_count_wakes(ids[0], "zap", 0, ["geweckt"]), 2)
            self.assertEqual(
                store.event_count_wakes(ids[0], "ada", 0, ["geweckt"]), 1)
            self.assertEqual(
                store.event_count_wakes(ids[0], "zap", 0, ["gestartet"]), 0)
            self.assertTrue(store.event_has_text(ids[1], "geweckt"))
            self.assertFalse(store.event_has_text(ids[2], "geweckt"))

            # Jüngstes Ereignis je Ticket entscheidet über attention.
            store.event_append("wake", ids[0], "test", "zap",
                               "unterdrückt: voll", at=6000)
            store.event_append("wake", ids[0], "test", "zap", "geweckt",
                               at=6100)
            store.event_append("wake", ids[1], "test", "zap", "geweckt",
                               at=6200)
            store.event_append("wake", ids[1], "test", "zap",
                               "unterdrückt: ping-pong", at=6300)
            store.event_append("wake", ids[2], "test", "zap",
                               "unterdrückt: start fehlgeschlagen", at=6400)
            rows = store.attention_event_rows(events.ATTENTION_TEXTS)
        self.assertEqual(sorted(row["ticket"] for row in rows),
                         sorted([ids[1], ids[2]]))

    # 9

    def test_lesemodelle_aus_der_db(self):
        tid = self.new("Lesemodell")
        self.ok("comment", tid, "--from", "zap", "--no-wake", "aus der DB")

        entry = self.index_entry(tid)
        self.assertEqual(entry["comment_count"], 2)
        self.assertEqual(entry["last_comment"]["text"], "aus der DB")
        model = self.ticket(tid)
        self.assertEqual(model["comments"][-1]["text"], "aus der DB")

        self._patch(tid, title="Neuer Titel")
        self.ok("index")
        self.assertEqual(self.index_entry(tid)["title"], "Neuer Titel")
        self.assertEqual(self.ticket(tid)["title"], "Neuer Titel")

    # 10

    def test_lesemodelle_und_rev_beim_speichern(self):
        tid = self.new("Rev")
        with self._env():
            self.assertIsNotNone(store.read_model("index"))
            self.assertIsNotNone(store.read_model(store.ticket_model_key(tid)))
            before = store.rev()
            with store.locked():
                ticket = store.load(tid)
                ticket["title"] = "Frisch"
                store.save(ticket)
            self.assertGreater(store.rev(), before)
            self.assertEqual(
                store.read_model_json(store.ticket_model_key(tid))["title"],
                "Frisch")
            before = store.rev()

        self.ok("index")
        with self._env():
            self.assertGreater(store.rev(), before)
            self.assertEqual(
                store.read_model_json("index")["tickets"][0]["title"], "Frisch")

    def test_meta_rev_zaehlt_autopilot_und_waechter(self):
        with self._env():
            mutations = (
                lambda: store.meta_set(store.AUTOPILOT_KEY, "{}"),
                lambda: store.meta_set(store.AUTOPILOT_PAUSE_KEY, "pause"),
                lambda: store.set_tick_off(),
                lambda: store.clear_tick_off(),
                lambda: store.autopilot_log_append("zeile"),
            )
            for mutate in mutations:
                before = store.rev()
                mutate()
                self.assertGreater(store.rev(), before)

    def test_tick_off_ist_eine_db_marke(self):
        home = os.path.join(
            self.fake_home, ".config", "herdr-app", "data", "fabric")
        guard = {"FAB_TICK_NO_LAUNCHCTL": "1", "FAB_HOME": home}
        self.ok("tick", "--uninstall", env=guard)
        self.assertFalse(os.path.exists(os.path.join(home, "tick-off")))
        with mock.patch.dict(
                os.environ, {"FAB_HOME": home, "HOME": self.fake_home}):
            self.assertTrue(store.tick_disabled())
            self.assertIsNotNone(store.meta_get(store.TICK_OFF_KEY))

        self.ok("tick", "--install", env=guard)
        with mock.patch.dict(
                os.environ, {"FAB_HOME": home, "HOME": self.fake_home}):
            self.assertFalse(store.tick_disabled())

    def test_autopilot_log_haelt_die_neuesten_2000(self):
        with self._env():
            store.autopilot_log_clear()
            for index in range(2005):
                store.autopilot_log_append(f"zeile {index}")
            rows = store.autopilot_log_rows()
        self.assertEqual(len(rows), 2000)
        self.assertEqual(rows[0]["line"], "zeile 5")
        self.assertEqual(rows[-1]["line"], "zeile 2004")

    def test_migration_importiert_autopilot_und_marken(self):
        self._drop_db()
        self._write(
            os.path.join(self.home, "autopilot.json"),
            json.dumps({"state": "paused", "reason": "grund", "end": ""}),
        )
        self._write(
            os.path.join(self.home, "autopilot.log"), "alt eins\nalt zwei\n")
        self._write(os.path.join(self.home, "autopilot-pause"), "pausiert")
        self._write(os.path.join(self.home, "tick-off"), "")

        report = json.loads(self.ok("migrate", "--json").stdout)
        self.assertEqual(report["status"], "migrated")
        for name in ("autopilot.json", "autopilot.log", "autopilot-pause",
                     "tick-off"):
            self.assertIn(name, report["moved"])
            self.assertFalse(os.path.exists(os.path.join(self.home, name)))

        with self._env():
            state = json.loads(store.meta_get(store.AUTOPILOT_KEY))
            self.assertEqual(state["state"], "paused")
            self.assertEqual(
                [row["line"] for row in store.autopilot_log_rows()],
                ["alt eins", "alt zwei"],
            )
            self.assertTrue(store.tick_disabled())
            self.assertEqual(
                store.meta_get(store.AUTOPILOT_PAUSE_KEY), "pausiert")

        self.assertIn("Wächter aus", self.ok("tick").stdout)

        second = json.loads(self.ok("migrate", "--json").stdout)
        self.assertEqual(second["status"], "already")
        with self._env():
            self.assertEqual(
                [row["line"] for row in store.autopilot_log_rows()],
                ["alt eins", "alt zwei"],
            )

    def test_anhang_als_blob_mit_cache_pfad(self):
        tid = self.new("Anhang")
        payload = b"\x89PNG\r\n\x1a\nanhang"
        source = os.path.join(self.tmp, "bild.png")
        with open(source, "wb") as handle:
            handle.write(payload)

        with self._env():
            name, rel = store.attachment_add(source, tid, "bild.png")
            self.assertEqual(name, "bild.png")
            self.assertEqual(
                rel, "data/fabric/cache/attachments/T-1/1-bild.png")
            rows = store.attachment_rows(tid)
            self.assertEqual(rows[0]["data"], payload)
            self.assertEqual(rows[0]["mime"], "image/png")
            models = store.attachment_models(tid)
            self.assertEqual(models[0]["cache_path"], rel)
            self.assertEqual(models[0]["path"], rel)

        self.assertTrue(os.path.isfile(os.path.join(
            self.home, "cache", "attachments", "T-1", "1-bild.png")))
        self.assertFalse(os.path.exists(os.path.join(self.home, "attachments")))
        entry = self.ticket(tid)["attachments"][0]
        self.assertEqual(entry["path"], rel)
        self.assertEqual(entry["cache_path"], rel)

    # 11

    def test_kein_direktzugriff_ausser_store(self):
        fablib = os.path.join(os.path.dirname(FAB), "fablib")
        sources = {}
        for name in sorted(os.listdir(fablib)):
            if not name.endswith(".py") or name == "store.py":
                continue
            with open(os.path.join(fablib, name), encoding="utf-8") as handle:
                sources[name] = handle.read()

        for name, text in sources.items():
            self.assertNotRegex(
                text, r"(?m)^\s*(?:import\s+sqlite3|from\s+sqlite3\b)",
                f"{name} importiert sqlite3 direkt")
            self.assertNotIn("events.jsonl", text,
                             f"{name} greift direkt auf das Ereignislog zu")
            self.assertNotIn("counter_path", text,
                             f"{name} greift direkt auf den Zähler zu")

        # `index.json` ist reine Migrationserinnerung in store.py; kein Modul
        # nennt oder schreibt den alten Dateipfad sonst.
        for name, text in sources.items():
            self.assertNotIn(
                "index.json", text,
                f"{name} nennt index.json außerhalb der Migration")
        with open(os.path.join(fablib, "store.py"), encoding="utf-8") as handle:
            store_text = handle.read()
        for line in store_text.splitlines():
            if "index.json" not in line:
                continue
            writes = ("open(" in line or "atomic_write" in line
                      or "write_text" in line)
            self.assertFalse(writes, f"store.py schreibt index.json: {line}")

        # Ticketdateien only über `store` lesen.
        for name, text in sources.items():
            for line in text.splitlines():
                if "open(" not in line:
                    continue
                self.assertNotRegex(
                    line, r"[\"']tickets[\"']",
                    f"{name} öffnet Ticketdateien direkt: {line}")


def store_backup_files(home):
    folder = os.path.join(home, "backups")
    if not os.path.isdir(folder):
        return []
    return [
        os.path.join(folder, name)
        for name in os.listdir(folder)
        if name.startswith("fabric-") and name.endswith(".db")
    ]
