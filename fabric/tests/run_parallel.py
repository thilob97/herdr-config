#!/usr/bin/env python3
"""Paralleler Läufer für die Python-Tests: ein eigener Prozess je Testdatei.

Jeder Lauf bekommt ein eigenes ``HOME``, ``FAB_HOME`` und ``TMPDIR``, damit
Store, Sperre und Temp-Dateien der Testdateien nicht kollidieren. Der
Exit-Code ist 0 nur, wenn jede Datei grün war; sonst werden die betroffenen
Dateien mit ihrer vollständigen Ausgabe (inklusive Traceback) gezeigt.
Endet ein Arbeitsprozess durch ein Signal (etwa SIGTERM von außen) oder
scheitert ein Test an einem per Signal beendeten Unterprozess, wird die Datei
genau einmal in einem frischen Prozess wiederholt. Bleibt es beim Signal, gilt
sie als abgebrochen: ``Abbruch: Signal <n> in <Datei>`` und Exit-Code 3.

Aufruf ohne Dateien lädt alle ``fabric/tests/test_*.py``. Explizite Dateien
sind für Tests des Läufers selbst gedacht. Die Prozesszahl ist standardmäßig
die CPU-Zahl und lässt sich per ``--jobs`` oder ``FAB_TEST_JOBS`` setzen.
"""
import argparse
import concurrent.futures
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RAN_RE = re.compile(r"^Ran (\d+) tests? in ", re.MULTILINE)
# Ein unittest-Fehler, dessen Ursache ein per Signal beendeter Unterprozess
# ist: `assertEqual(r.returncode, 0)` zeigt `-15 != 0`, ein nicht geprüfter
# Rückgabewert erscheint als `returned non-zero exit status -15`.
SIGNAL_DEATH_RE = re.compile(
    r"-(\d+) != 0\b|returned non-zero exit status -(\d+)"
)
# Exit-Code, wenn mindestens eine Testdatei zweimal durch ein Signal endete.
ABORT_EXIT = 3


def discover():
    return sorted(
        os.path.join(HERE, name)
        for name in os.listdir(HERE)
        if name.startswith("test_") and name.endswith(".py")
    )


def default_jobs(env):
    raw = (env.get("FAB_TEST_JOBS") or "").strip()
    if raw:
        try:
            jobs = int(raw)
        except ValueError:
            raise SystemExit(f"FAB_TEST_JOBS ist keine Zahl: {raw!r}")
        if jobs < 1:
            raise SystemExit(f"FAB_TEST_JOBS muss mindestens 1 sein: {jobs}")
        return jobs
    return os.cpu_count() or 1


class Result:
    def __init__(self, path, code, output, seconds):
        self.path = path
        self.code = code
        self.output = output
        self.seconds = seconds
        match = RAN_RE.search(output)
        self.tests = int(match.group(1)) if match else 0

    @property
    def ok(self):
        return self.code == 0

    @property
    def signal(self):
        """Signalnummer, wenn der Arbeitsprozess durch ein Signal endete."""
        return -self.code if self.code < 0 else None

    @property
    def name(self):
        return os.path.basename(self.path)


def run_one(path, session, index):
    """Führt eine Testdatei in einem isolierten Arbeitsverzeichnis aus."""
    workdir = os.path.join(session, "t%d" % index)
    home = os.path.join(workdir, "home")
    data = os.path.join(workdir, "data")
    tmp = os.path.join(workdir, "tmp")
    for folder in (home, data, tmp):
        os.makedirs(folder, exist_ok=True)
    env = dict(os.environ)
    env.update(HOME=home, FAB_HOME=data, TMPDIR=tmp, TMP=tmp, TEMP=tmp)
    pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = ROOT if not pythonpath else ROOT + os.pathsep + pythonpath
    module = os.path.splitext(os.path.basename(path))[0]
    started = time.perf_counter()
    proc = subprocess.run(
        [sys.executable, "-m", "unittest", "-v", "-b", module],
        cwd=os.path.dirname(os.path.abspath(path)),
        env=env,
        capture_output=True,
        text=True,
    )
    seconds = time.perf_counter() - started
    return Result(path, proc.returncode, proc.stdout + proc.stderr, seconds)


def display(path):
    try:
        return os.path.relpath(path, ROOT)
    except ValueError:
        return path


def signal_of(result):
    """Signalnummer, wenn der Lauf an einem per Signal beendeten Prozess scheitert.

    Zwei Fälle zählen als Abbruch: Der Testdatei-Prozess selbst wurde beendet
    (negativer Rückgabewert), oder ein Test scheitert an einem Unterprozess,
    den ein Signal beendet hat (`-15 != 0` im Traceback). Alles andere bleibt
    ein gewöhnlicher roter Test.
    """
    if result.signal is not None:
        return result.signal
    if result.code > 0:
        match = SIGNAL_DEATH_RE.search(result.output or "")
        if match:
            return int(match.group(1) or match.group(2))
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "files", nargs="*", help="Testdateien; ohne Angabe alle test_*.py"
    )
    parser.add_argument(
        "--jobs",
        "-j",
        type=int,
        default=None,
        help="gleichzeitige Prozesse (Standard: CPU-Zahl oder FAB_TEST_JOBS)",
    )
    args = parser.parse_args(argv)

    files = args.files or discover()
    if not files:
        print("Keine Testdateien gefunden.", file=sys.stderr)
        return 1
    missing = [path for path in files if not os.path.isfile(path)]
    if missing:
        print("Testdatei fehlt: " + ", ".join(missing), file=sys.stderr)
        return 1
    jobs = args.jobs if args.jobs is not None else default_jobs(os.environ)
    if jobs < 1:
        parser.error("--jobs muss mindestens 1 sein")

    # Kurzer Wurzelpfad: Tests prüfen teils, ob der Kürzungshinweis mit
    # vollem Dateipfad in die Kontextgrenze passt.
    base = os.path.realpath("/tmp") if os.path.isdir("/tmp") else None
    session = tempfile.mkdtemp(prefix="fbpar-", dir=base)
    try:
        results = []
        first_signals = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
            futures = {
                pool.submit(run_one, path, session, index): path
                for index, path in enumerate(files)
            }
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                if result.signal is not None:
                    # Der Arbeitsprozess wurde von außen beendet: nicht als
                    # ROT zählen, sondern genau einmal wiederholen.
                    print(
                        "SIG %s (%d Tests, %.1fs, Signal %d%s, Wiederholung)"
                        % (
                            display(result.path),
                            result.tests,
                            result.seconds,
                            signal_number,
                            detail,
                        ),
                        flush=True,
                    )
                    first_signals.append((result.path, signal_number))
                    continue
                results.append(result)
                status = "ok" if result.ok else "ROT"
                print(
                    "%s %s (%d Tests, %.1fs)"
                    % (status, display(result.path), result.tests, result.seconds),
                    flush=True,
                )

        # Wiederholung in einem frischen Prozess; bleibt es beim Signal, gilt
        # die Datei als abgebrochen (Exit 3).
        aborted = []
        aborted_results = []
        if first_signals:
            first_signals.sort(key=lambda item: os.path.basename(item[0]))
            with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
                futures = {
                    pool.submit(
                        run_one, path, session, len(files) + offset
                    ): (path, signal_number)
                    for offset, (path, signal_number) in enumerate(first_signals)
                }
                for future in concurrent.futures.as_completed(futures):
                    result = future.result()
                    first_signal = futures[future][1]
                    signal_number = signal_of(result)
                    results.append(result)
                    if signal_number is not None:
                        aborted.append((signal_number, result.path))
                        aborted_results.append(result)
                        continue
                    if result.ok:
                        print(
                            "ok %s (%d Tests, %.1fs, Wiederholung nach Signal %d)"
                            % (
                                display(result.path),
                                result.tests,
                                result.seconds,
                                first_signal,
                            ),
                            flush=True,
                        )
                    else:
                        print(
                            "ROT %s (%d Tests, %.1fs)"
                            % (
                                display(result.path),
                                result.tests,
                                result.seconds,
                            ),
                            flush=True,
                        )
    finally:
        shutil.rmtree(session, ignore_errors=True)

    failed = [
        result
        for result in results
        if not result.ok and result not in aborted_results
    ]
    total = sum(result.tests for result in results)
    print()
    for result in sorted(failed, key=lambda item: item.name):
        print("=" * 70)
        print("FEHLER in %s (Exit %d)" % (display(result.path), result.code))
        print("=" * 70)
        print(result.output.rstrip())
        print()
    print(
        "%d Tests in %d Dateien, %d rot"
        % (total, len(files), len(failed))
    )
    for signal, path in sorted(aborted, key=lambda item: os.path.basename(item[1])):
        print("Abbruch: Signal %d in %s" % (signal, display(path)))
    if aborted:
        return ABORT_EXIT
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
