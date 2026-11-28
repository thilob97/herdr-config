"""Bild-Anhänge: Bytes in SQLite, Cache-Pfad, verlinken, anzeigen und Fehler."""
import os

from fabric.tests.support import FabricCase


class AttachTests(FabricCase):
    def _source(self, name, data=b"\x89PNG\r\n\x1a\n"):
        path = os.path.join(self.tmp, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    def _cache(self, tid, name):
        return os.path.join(self.home, "cache", "attachments", tid, name)

    def test_kopiert_verlinkt_body_und_show(self):
        tid = self.new("Mit Bild")
        source = self._source("bild.png", b"\x89PNG-eins")
        result = self.ok("attach", tid, source)
        reference = f"![bild.png](data/fabric/cache/attachments/{tid}/1-bild.png)"
        self.assertEqual(result.stdout.strip(), reference)
        target = self._cache(tid, "1-bild.png")
        self.assertTrue(os.path.isfile(target))
        with open(source, "rb") as handle:
            expected = handle.read()
        with open(target, "rb") as handle:
            self.assertEqual(handle.read(), expected)
        ticket = self.ticket(tid)
        self.assertIn(reference, ticket["body"])
        self.assertTrue(ticket["body"].endswith("\n"))
        self.assertEqual(len(ticket["attachments"]), 1)
        entry = ticket["attachments"][0]
        self.assertEqual(entry["name"], "bild.png")
        self.assertEqual(entry["cache_path"], reference.split("](")[1].rstrip(")"))
        self.assertIsInstance(entry["at"], int)
        self.assertEqual(entry["mime"], "image/png")
        show = self.ok("show", tid).stdout
        self.assertIn("## Anhänge", show)
        self.assertIn(reference, show)

    def test_no_edit_laesst_body_stehen_zeigt_aber_an(self):
        tid = self.new("Ohne Link")
        before = self.ticket(tid)["body"]
        source = self._source("ohne-link.png")
        result = self.ok("attach", tid, source, "--no-edit")
        reference = f"![ohne-link.png](data/fabric/cache/attachments/{tid}/1-ohne-link.png)"
        self.assertEqual(result.stdout.strip(), reference)
        self.assertEqual(self.ticket(tid)["body"], before)
        self.assertEqual(len(self.ticket(tid)["attachments"]), 1)
        show = self.ok("show", tid).stdout
        self.assertIn("## Anhänge", show)
        self.assertIn(reference, show)

    def test_lehnt_falsche_endung_und_fehlende_datei_ab(self):
        tid = self.new("Fehler")
        text_file = self._source("notiz.txt", b"kein bild")
        result = self.cli("attach", tid, text_file)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Fehler:", result.stderr)
        self.assertIn(".png", result.stderr)
        self.assertIn(".webp", result.stderr)
        result = self.cli("attach", tid, os.path.join(self.tmp, "fehlt.png"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("gibt es nicht", result.stderr)

    def test_unbekanntes_ticket_ist_ein_fehler(self):
        source = self._source("bild.png")
        result = self.cli("attach", "T-99", source)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Fehler:", result.stderr)
        self.assertIn("T-99", result.stderr)

    def test_name_wird_bereinigt_und_endung_klein(self):
        tid = self.new("Namen")
        source = self._source("Mein Foto.PNG")
        result = self.ok("attach", tid, source)
        reference = f"![mein-foto.png](data/fabric/cache/attachments/{tid}/1-mein-foto.png)"
        self.assertEqual(result.stdout.strip(), reference)
        self.assertTrue(os.path.isfile(self._cache(tid, "1-mein-foto.png")))

    def test_gleicher_inhalt_wird_wiederverwendet(self):
        tid = self.new("Gleich")
        source = self._source("gleich.png", b"immer-dasselbe")
        first = self.ok("attach", tid, source).stdout.strip()
        second = self.ok("attach", tid, source).stdout.strip()
        self.assertEqual(first, second)
        folder = os.path.join(self.home, "cache", "attachments", tid)
        self.assertEqual(os.listdir(folder), ["1-gleich.png"])
        self.assertEqual(len(self.ticket(tid)["attachments"]), 1)

    def test_anderer_inhalt_bekommt_nummer(self):
        tid = self.new("Anders")
        first_source = self._source(os.path.join("eins", "bild.png"), b"eins")
        second_source = self._source(os.path.join("zwei", "bild.png"), b"zwei")
        first = self.ok("attach", tid, first_source).stdout.strip()
        second = self.ok("attach", tid, second_source).stdout.strip()
        self.assertIn("1-bild.png", first)
        self.assertEqual(
            second,
            f"![bild-2.png](data/fabric/cache/attachments/{tid}/2-bild-2.png)",
        )
        folder = os.path.join(self.home, "cache", "attachments", tid)
        self.assertEqual(sorted(os.listdir(folder)), ["1-bild.png", "2-bild-2.png"])
        self.assertEqual(len(self.ticket(tid)["attachments"]), 2)

    def test_bytes_stehen_in_der_datenbank(self):
        tid = self.new("Blob")
        source = self._source("blob.png", b"\x89PNG-blob")
        self.ok("attach", tid, source)
        from fabric.fablib import store

        with self.store_env():
            rows = store.attachment_rows(tid)
        self.assertEqual(rows[0]["data"], b"\x89PNG-blob")
        self.assertEqual(rows[0]["mime"], "image/png")
