#!/bin/sh
# Engster Nachweis für Änderungen an der Fabric: reine Modell-Tests und Mod-Ladecheck.
set -eu
cd "$(dirname "$0")/.."
node --test mods/fabric/test/
herdr-app check mods/fabric
