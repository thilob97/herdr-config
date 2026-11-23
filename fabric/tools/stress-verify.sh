#!/bin/sh
# Stressnachweis für `.fabric/verify.sh`: mehrere Runden mit je N gleichzeitigen
# Läufen in getrennten Worktrees. Jeder Lauf schreibt sein volles Log; die
# Zusammenfassung landet als TSV daneben. Exit 0 nur, wenn alle Läufe grün sind.
#
# Aufruf: sh fabric/tools/stress-verify.sh [-r RUNDEN] [-n LAUFE] [-d LOGDIR] [-k]
#   -r  Runden (Standard 5)
#   -n  gleichzeitige Läufe/Worktrees (Standard 4)
#   -d  Logverzeichnis (Standard: $TMPDIR/fab-stress-<Zeitstempel>)
#   -k  Worktrees nach dem Lauf behalten (zum Nachsehen)
set -eu

rounds=5
lanes=4
logdir=""
keep=0
while getopts "r:n:d:k" opt; do
    case "$opt" in
        r) rounds=$OPTARG ;;
        n) lanes=$OPTARG ;;
        d) logdir=$OPTARG ;;
        k) keep=1 ;;
        *) echo "unbekannte Option: -$OPTARG" >&2; exit 2 ;;
    esac
done
case "$rounds" in ''|*[!0-9]*|0) echo "Runden müssen > 0 sein" >&2; exit 2 ;; esac
case "$lanes" in ''|*[!0-9]*|0) echo "Läufe müssen > 0 sein" >&2; exit 2 ;; esac

repo=$(git rev-parse --show-toplevel)
base=$(git rev-parse HEAD)
if [ -z "$logdir" ]; then
    logdir="${TMPDIR:-/tmp}/fab-stress-$(date +%Y%m%d-%H%M%S)-$$"
fi
mkdir -p "$logdir"
logdir=$(cd "$logdir" && pwd)
worktrees="$logdir/worktrees"
mkdir -p "$worktrees"

cleanup() {
    if [ "$keep" -eq 0 ]; then
        lane=1
        while [ "$lane" -le "$lanes" ]; do
            git -C "$repo" worktree remove --force "$worktrees/lane-$lane" \
                >/dev/null 2>&1 || true
            lane=$((lane + 1))
        done
        git -C "$repo" worktree prune >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT INT TERM

lane=1
while [ "$lane" -le "$lanes" ]; do
    path="$worktrees/lane-$lane"
    git -C "$repo" worktree add --detach --quiet "$path" "$base"
    lane=$((lane + 1))
done

summary="$logdir/summary.tsv"
printf 'round\tlane\texit\tseconds\tlog\n' > "$summary"
failures=0

round=1
while [ "$round" -le "$rounds" ]; do
    pids=""
    lane=1
    while [ "$lane" -le "$lanes" ]; do
        log="$logdir/round-$round-lane-$lane.log"
        (
            start=$(date +%s)
            code=0
            sh "$worktrees/lane-$lane/.fabric/verify.sh" > "$log" 2>&1 || code=$?
            end=$(date +%s)
            printf '%s\t%s\t%s\t%s\t%s\n' \
                "$round" "$lane" "$code" "$((end - start))" "$log" >> "$summary"
            exit "$code"
        ) &
        pids="$pids $!"
        lane=$((lane + 1))
    done
    for pid in $pids; do
        wait "$pid" || failures=$((failures + 1))
    done
    printf 'Runde %s/%s fertig: %s\n' "$round" "$rounds" \
        "$(tail -n +2 "$summary" | awk -F '\t' -v r="$round" \
            '$1 == r { printf "%s%s", sep, $3; sep = "," }')"
    round=$((round + 1))
done

printf '\nBase %s, %s Runden × %s Läufe\n' "$base" "$rounds" "$lanes"
printf 'Runde\tExit-Codes\tSekunden\n'
awk -F '\t' 'NR > 1 {
    codes[$1] = codes[$1] (codes[$1] == "" ? "" : ",") $3
    seconds[$1] = seconds[$1] (seconds[$1] == "" ? "" : ",") $4
} END {
    for (r in codes) printf "%s\t%s\t%s\n", r, codes[r], seconds[r]
}' "$summary" | sort -n
printf 'Logs: %s\n' "$logdir"

if [ "$failures" -ne 0 ]; then
    echo "ROT: $failures Lauf/Läufe fehlgeschlagen" >&2
    exit 1
fi
echo "GRÜN: alle Läufe grün"
