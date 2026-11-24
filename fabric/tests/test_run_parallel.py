"""Prüft den parallelen Testläufer an synthetischen Testdateien."""
import os
import subprocess
import sys
import tempfile
import unittest

RUNNER = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "run_parallel.py"
)

GREEN = '''"""Grüne Testdatei."""
import unittest


class Green(unittest.TestCase):
    def test_gruen(self):
        self.assertTrue(True)
'''

RED = '''"""Absichtlich rote Testdatei."""
import unittest


class Red(unittest.TestCase):
    def test_absichtlich_rot(self):
        self.fail("absichtlich rot")
'''

# Beim ersten Lauf setzt die Datei eine Markierung neben sich und beendet
# sich per SIGTERM; beim Wiederholungslauf ist sie grün.
SIGTERM_EINMAL = '''"""Einmal per SIGTERM beendet, in der Wiederholung grün."""
import os
import signal
import unittest


MARKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "signal.marker")


class EinmalSignal(unittest.TestCase):
    def test_nach_signal_gruen(self):
        if not os.path.exists(MARKER):
            with open(MARKER, "w", encoding="utf-8") as handle:
                handle.write("1")
            os.kill(os.getpid(), signal.SIGTERM)
        self.assertTrue(True)
'''

# Beendet sich bei jedem Lauf bereits beim Import des Moduls per SIGTERM.
SIGTERM_IMMER = '''"""Endet bei jedem Lauf per SIGTERM."""
import os
import signal

os.kill(os.getpid(), signal.SIGTERM)
'''


class RunParallelTests(unittest.TestCase):
    def write(self, folder, name, text):
        path = os.path.join(folder, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
        return path

    def run_runner(self, *files):
        return subprocess.run(
            [sys.executable, RUNNER, "--jobs", "2", *files],
            capture_output=True,
            text=True,
        )

    def test_rote_datei_liefert_exitcode_und_namen(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write(folder, "test_rot.py", RED)
            result = self.run_runner(path)
        self.assertNotEqual(result.returncode, 0)
        output = result.stdout + result.stderr
        self.assertIn("test_absichtlich_rot", output)
        self.assertIn("absichtlich rot", output)

    def test_nur_gruene_dateien_ergeben_null(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write(folder, "test_gruen.py", GREEN)
            result = self.run_runner(path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 Tests in 1 Dateien, 0 rot", result.stdout)

    def test_sigterm_wird_einmal_wiederholt(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write(folder, "test_sigterm.py", SIGTERM_EINMAL)
            result = self.run_runner(path)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = result.stdout + result.stderr
        self.assertIn("Wiederholung nach Signal 15", output)
        self.assertIn("0 rot", output)

    def test_dauerhaftes_signal_ist_abbruch(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write(folder, "test_sigterm_immer.py", SIGTERM_IMMER)
            result = self.run_runner(path)
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertIn("Abbruch: Signal 15 in", result.stdout)

    def test_rotes_ergebnis_bleibt_exit_1(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write(folder, "test_rot.py", RED)
            result = self.run_runner(path)
        self.assertEqual(result.returncode, 1, result.stderr)
        output = result.stdout + result.stderr
        self.assertNotIn("Abbruch: ", output)
