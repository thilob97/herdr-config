#!/usr/bin/env bash
# Die schnellen Prüfungen dieses Repos, vor jedem Commit und im Review:
#   (a) alle `mods/*/ui.js` sind byte-identisch mit `mods/orchestra/ui.js`,
#   (b) `mods/orchestra/bin/hub` lässt sich übersetzen,
#   (c) die Node-Tests von Dashboard und Graph laufen durch.
#
#   .herdr/verify.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
say() { printf '%s\n' "$*"; }
hash() { if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }

# (a) Eine Quelle (mods/orchestra/ui.js), elf Kopien. `bin/sync-ui` schreibt sie.
SRC="mods/orchestra/ui.js"
want="$(hash "$SRC")"
count=0
for f in mods/*/ui.js; do
  count=$((count + 1))
  got="$(hash "$f")"
  if [ "$got" != "$want" ]; then
    say "ui.js: $f weicht ab (${got:0:12} statt ${want:0:12}) — mods/orchestra/bin/sync-ui"
    fail=1
  fi
done
if [ "$count" -lt 12 ]; then
  say "ui.js: nur $count Kopien statt 12 — fehlt ein Mod?"
  fail=1
fi
if [ "$fail" = 0 ]; then say "ui.js: $count Kopien identisch (${want:0:12})"; fi

# (b) Der Hub der Fabrik bleibt übersetzbar.
python3 -m py_compile mods/orchestra/bin/hub
say "hub: py_compile grün"

# (c) Die schnellen Node-Tests (keine Fenster, kein Host).
node --test mods/dashboard/test/*.test.mjs mods/graph/test/*.test.mjs
say "verify: grün"
exit "$fail"
