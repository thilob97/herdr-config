#!/bin/sh
# Gemeinsamer Nachweis für dieses Repo: CLI-Tests, Mod-Tests, Mod-Ladecheck.
set -eu
cd "$(dirname "$0")/.."
python3 -m unittest discover -s fabric/tests -t .
node --test mods/fabric/test/
node --test mods/fabric-sidebar/test/
node --test mods/agents-filtered/test/
herdr-app check mods/fabric
herdr-app check mods/fabric-sidebar
herdr-app check mods/agents-filtered
