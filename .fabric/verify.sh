#!/bin/sh
# Gemeinsamer Nachweis für dieses Repo: CLI-Tests, Mod-Tests, Mod-Ladecheck.
set -eu
cd "$(dirname "$0")/.."
python3 -m unittest discover -s fabric/tests -t .
node --test mods/fabric/test/
herdr-app check mods/fabric
