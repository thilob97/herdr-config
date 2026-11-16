#!/usr/bin/env bash
# Die schnellen Prüfungen dieses Repos, vor jedem Commit und im Review:
#   (a) alle `mods/*/ui.js` sind byte-identisch mit `mods/orchestra/ui.js`,
#   (b) `mods/orchestra/bin/hub` lässt sich übersetzen,
#   (c) alle Node-Tests der Mods laufen durch (`mods/*/test/*.test.mjs`).
#
#   .herdr/verify.sh          nur die schnellen Prüfungen
#   .herdr/verify.sh --full   zusätzlich die Hub-Suiten (`mods/orchestra/test/hub_*_test.py`)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FULL=0
case "${1:-}" in
  "") ;;
  --full) FULL=1 ;;
  *) printf 'verify: unbekannte Option %s (erlaubt: --full)\n' "$1" >&2; exit 2 ;;
esac

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
if python3 -m py_compile mods/orchestra/bin/hub; then
  say "hub: py_compile grün"
else
  fail=1
fi

# (c) Die Node-Tests aller Mods (keine Fenster, kein Host). Auch die Orchestra-Regeln
# gehören dazu: sie liefen sonst nie in der Prüfung.
tests="$(ls mods/*/test/*.test.mjs 2>/dev/null || true)"
if [ -n "$tests" ]; then
  # shellcheck disable=SC2086
  node --test $tests || fail=1
else
  say "node: keine Tests gefunden (mods/*/test/*.test.mjs)"
  fail=1
fi

# (d) --full: auch die Hub-Suiten; sie bauen sich ihre Home-Verzeichnisse selbst.
if [ "$FULL" = 1 ]; then
  for f in mods/orchestra/test/hub_*_test.py; do
    [ -e "$f" ] || continue
    say "--- $f"
    python3 "$f" || fail=1
  done
fi

if [ "$fail" = 0 ]; then say "verify: grün"; else say "verify: rot"; fi
exit "$fail"
