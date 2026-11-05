#!/bin/sh
# Prints omp's newest readings for one provider (what omp's /usage shows) as one
# JSON array, newest first, and exits. omp keeps them in ~/.omp/agent/agent.db
# (table usage_history) while it runs; this only reads it (sqlite3 -readonly).
#
# Usage: omp-usage.sh <omp provider id, e.g. anthropic, openai-codex, opencode-go>
# Exit: 0 = printed, 127 = no reading of that provider in the last 7 days (left
# out of the bar), 1 = sqlite3 or the database missing.
# Override the database with HERDR_USAGE_OMP_DB.

provider=$1
case "$provider" in '' | *[!a-z0-9-]*) exit 1 ;; esac
db=${HERDR_USAGE_OMP_DB:-$HOME/.omp/agent/agent.db}
[ -f "$db" ] || exit 1
command -v sqlite3 >/dev/null 2>&1 || exit 1

out=$(sqlite3 -readonly -json "file:$db?mode=ro" "
SELECT account_key, label, window_label, used_fraction, status, resets_at, recorded_at
FROM usage_history
WHERE id IN (SELECT max(id) FROM usage_history WHERE provider = '$provider'
             GROUP BY account_key, label, window_label)
  AND recorded_at > (strftime('%s','now') - 7 * 86400) * 1000
ORDER BY recorded_at DESC") || exit 1
[ -n "$out" ] || exit 127
printf '%s\n' "$out" | tr -d '\n'
printf '\n'
