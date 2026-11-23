#!/bin/sh
# Gemeinsamer Nachweis für dieses Repo: führt die Schritte aus .fabric/pipeline.json
# nacheinander per `sh -c` aus und bricht beim ersten Fehler ab.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
python3 - <<'PY'
import json
import subprocess
import sys

with open(".fabric/pipeline.json", encoding="utf-8") as fh:
    steps = json.load(fh).get("steps", [])

for step in steps:
    name = step.get("name")
    command = step.get("run")
    if not isinstance(name, str) or not name.strip() or not isinstance(command, str) or not command.strip():
        sys.exit("Ungültiger Schritt in .fabric/pipeline.json: %r" % (step,))
    print("==> %s" % name, flush=True)
    code = subprocess.run(["sh", "-c", command], cwd=".").returncode
    if code != 0:
        sys.exit(code)
PY
