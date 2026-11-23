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
