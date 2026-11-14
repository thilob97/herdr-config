#!/usr/bin/env bash
# Vorschau-Fenster für einen Worktree dieser Config, ohne die Live-Config
# (~/.config/herdr-app) oder Spaces, Tabs und Terminals des Menschen anzufassen.
#
#   docs/ui-preview.sh up          Test-Home bauen, eigenen Core starten, Fenster öffnen, Demo-Welt anlegen
#   docs/ui-preview.sh sync        Worktree-Änderungen ins Test-Home kopieren (Mods laden live neu)
#   docs/ui-preview.sh shot NAME   Screenshot nach $SHOTS/NAME.png (Standard /tmp/ui-audit)
#   docs/ui-preview.sh do CMD ...  herdr-app do im Test-Fenster (z. B. do mod.open --name inbox)
#   docs/ui-preview.sh status|ls   herdr-app status bzw. ls des Test-Fensters
#   docs/ui-preview.sh check MOD   herdr-app check auf den Mod im Test-Home
#   docs/ui-preview.sh down        Test-Fenster und Test-Cores beenden (Test-Home bleibt liegen)
#   docs/ui-preview.sh hc ARGS…    hc gegen den Test-Core (z. B. hc ls, hc read t2)
#   docs/ui-preview.sh hub ARGS…   bin/hub des Test-Homes gegen Test-Home und Test-Core
#   Nie HC_SESSION/HERDR_APP_HOME in die eigene Shell exportieren: spätere Aufrufe
#   träfen sonst still das Test-Fenster statt der echten Welt (oder umgekehrt).
#
# Isolation (Details in docs/ui-spec.md, Abschnitt "Testverfahren"):
# - HERDR_APP_HOME: ein Test-Home (~/.herdr/ui-preview/<worktree>), Kopie der Live-Config
#   ohne .git, Tickets und Laufzeitzustand; darüber die Dateien des Worktrees.
# - HC_SESSION: ein eigener herdr-core mit eigenen Spaces, Tabs und Terminals. Die des
#   Menschen erscheinen dort nicht. "demo-vm" ist ein zweiter lokaler Test-Core.
# - Agents sind Shell-Skripte (demo/agent.sh), die per OSC 7501 einen Status melden.
#   programs.json im Test-Home lenkt claude, pi, hermes und omp auf dieses Skript um:
#   Launcher, Quests und Orchestrator starten im Test-Fenster nie einen echten Agent.
# - Tickets, Teams und Kosten sind Demo-Daten auf einem Demo-Repo (demo/repo):
#   Mergen/PR im Test-Fenster treffen nie ein echtes Repo. Quests-Writeback: dry run.
# - Kein orchestra-daemon, keine Töne, keine Update-Abfrage.
# - Das Fenster startet mit `open -n -g` (eigene Instanz, ohne Fokus) knapp unter dem
#   unteren Bildschirmrand: verdeckte macOS-Fenster zeichnen nicht neu, ein sichtbarer
#   Streifen genügt. UI_PREVIEW_Y verschiebt es (Standard 1070, logische Pixel).
set -euo pipefail

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${HERDR_LIVE_HOME:-$HOME/.config/herdr-app}"
NAME="$(basename "$WT" | tr -c 'a-zA-Z0-9-' '-' | cut -c1-40 | sed 's/-*$//')"
T="${UI_PREVIEW_HOME:-$HOME/.herdr/ui-preview/$NAME}"
S="uiprev-$(printf %s "$NAME" | shasum | cut -c1-8)"
SHOTS="${SHOTS:-/tmp/ui-audit}"
Y="${UI_PREVIEW_Y:-1070}"

[ "$(cd "$T" 2>/dev/null && pwd -P)" != "$(cd "$LIVE" && pwd -P)" ] || { echo "Test-Home darf nicht die Live-Config sein" >&2; exit 1; }

app() { HC_SESSION="$S" HERDR_APP_HOME="$T" herdr-app "$@"; }
core() { HC_SESSION="$S" hc "$@"; }
# jqi [JQ-OPTIONEN…] FILTER FILE: eine JSON-Datei im Test-Home in place ändern.
jqi() { local file="${*: -1}"; jq "${@:1:$#-1}" "$file" > "$file.tmp" && mv "$file.tmp" "$file"; }
# Die Herdr-Instanz, die den Socket eines Homes hält (lsof -t <pfad> findet Unix-Sockets auf macOS nicht).
sock_pid() { lsof -U -F pn 2>/dev/null | awk -v s="$1/herdr-app.sock" '/^p/ { p = substr($0, 2) } /^n/ && substr($0, 2) == s { print p; exit }'; }
window_pid() { sock_pid "$T"; }

sync_worktree() {
  # Getrackte und neue (nicht ignorierte) Dateien des Worktrees; eigene Mods ganz ersetzen.
  (cd "$WT" && git ls-files -co --exclude-standard -z) | rsync -a --from0 --files-from=- "$WT/" "$T/"
  for d in $(cd "$WT" && git ls-files -co --exclude-standard mods | cut -d/ -f2 | sort -u); do
    rsync -a --delete --exclude 'gpui-kit.d.ts' --exclude 'herdr.d.ts' --exclude 'jsconfig.json' --exclude '*.error' \
      "$WT/mods/$d/" "$T/mods/$d/"
  done
  # Kein Orchestrator-Daemon (er startet Agents und setzt Budgets durch).
  jqi 'def strip: if type == "object" and .children then .children |= map(select(.id != "orchestra-daemon") | strip) else . end; strip' "$T/layouts/elric.json"
  jqi '.sounds.enabled = false' "$T/settings.json"
  # Bekannte Agents starten nur das Demo-Skript.
  jqi --arg a "$T/demo/agent.sh" '.programs as $p | .programs = ($p + (["claude","pi","hermes","omp"]
      | map({key: ., value: (($p[.] // {}) + {run: [$a, "working", ., "Demo-Agent"]})}) | from_entries))' "$T/programs.json"
}

build_home() {
  mkdir -p "$T" && chmod 700 "$T" && rm -f "$T/herdr-app.sock"
  rsync -a --delete --no-specials \
    --exclude '/.git' --exclude '/herdr-app.sock' --exclude '*.error' --exclude '/demo/' \
    --exclude '/windows.json' --exclude '/view.json' --exclude '/layouts/.state/' \
    --exclude '/data/quests/tickets/' --exclude '/data/quests/started.json' --exclude '/data/orchestra/' \
    "$LIVE/" "$T/"
  jqi --argjson y "$Y" '.state = "windowed" | .bounds = [0, $y, 1710, 1010]' "$T/window.json"
  [ ! -f "$T/data/quests/settings.json" ] || jqi '.dryRun = true' "$T/data/quests/settings.json"
  sync_worktree
}

# Demo-Welt: Fake-Agent, Demo-Repo mit Worktrees, Tickets, Team und Kosten.
write_demo() {
  local D="$T/demo"
  rm -rf "$D" "$T/data/quests/tickets" "$T/data/orchestra" && mkdir -p "$D/worktrees" "$T/data/quests/tickets" "$T/data/orchestra"
  cat > "$D/agent.sh" <<'EOF'
#!/bin/sh
# agent.sh STATE APP [TEXT]  (STATE: working|blocked|done|idle; blocked fragt nach)
state="$1"; app="$2"; text="${3:-}"
printf '\033]2;%s\007' "${text:-$app}"
clear
printf '%s\n\n  Demo-Agent (%s), Status %s.\n' "$text" "$app" "$state"
if [ "$state" = blocked ]; then
  printf '\033]7501;state=blocked:kind=permission:app=%s:msg=%s\033\\' "$app" "$(printf 'Darf ich die Datei überschreiben?' | base64)"
  printf '\n  ? Darf ich die Datei überschreiben? [j/n]\n'
else
  printf '\033]7501;state=%s:app=%s\033\\' "$state" "$app"
fi
while :; do sleep 3600; done
EOF
  chmod +x "$D/agent.sh"
  # Demo-Repo: main, ein Branch zum Review (mit Worktree) und einer in Arbeit.
  git -C "$D" init -q -b main repo
  git -C "$D/repo" -c user.name=demo -c user.email=demo@example.invalid commit -q --allow-empty -m "Start"
  printf '# Demo\n' > "$D/repo/README.md"
  git -C "$D/repo" add README.md && git -C "$D/repo" -c user.name=demo -c user.email=demo@example.invalid commit -q -m "README"
  for b in feat/demo-review feat/demo-doing; do
    git -C "$D/repo" worktree add -q -b "$b" "$D/worktrees/${b#feat/}"
    printf 'Änderung auf %s\n' "$b" > "$D/worktrees/${b#feat/}/CHANGE.md"
    git -C "$D/worktrees/${b#feat/}" add CHANGE.md
    git -C "$D/worktrees/${b#feat/}" -c user.name=demo -c user.email=demo@example.invalid commit -q -m "Demo: $b"
  done
  ticket() { # id status title branch terminal
    local wt=""; [ -z "$4" ] || wt="$D/worktrees/${4#feat/}"
    { printf -- '---\ntitle: %s\nstatus: %s\nrepo: %s\nlabels: demo\ndue: \n' "$3" "$2" "$D/repo"
      [ -z "$4" ] || printf 'agent: omp\nbranch: %s\nbase: main\nworktree: %s\n' "$4" "$wt"
      [ -z "$5" ] || printf 'terminal: %s\n' "$5"
      printf 'by: orchestrator\nupdated: 2026-01-01 12:00\n---\nDemo-Ticket für die UI-Vorschau.\n'
      [ "$2" != review ] || printf '\n## Zusammenfassung (Orchestrator)\nSidebar-Abstände vereinheitlicht, Checks grün, Screenshot unter /tmp/ui-audit.\n'
    } > "$T/data/quests/tickets/$1.md"
  }
  ticket demo-1 review "Sidebar: Abstände vereinheitlichen" feat/demo-review ""
  ticket demo-2 doing "Team-Panel: Pipeline-Ansicht" feat/demo-doing t1
  ticket demo-3 todo "Statusleiste: Utilities bündeln" "" ""
  ticket demo-4 done "Tab-Leiste: Starten entdoppeln" "" ""
  # Was der (abgeschaltete) Daemon sonst nach shared schreiben würde.
  jqi --arg d "$D" '
    ."orchestra.autostart" = false | .layout = "elric"
    | ."orchestra.budget" = {ticket: 3, team: 20} | ."orchestra.budgetExtra" = {}
    | ."orchestra.tickets" = [
        {id: "demo-1", title: "Sidebar: Abstände vereinheitlichen", status: "review", repo: ($d + "/repo"), labels: "demo", agent: "omp",
         branch: "feat/demo-review", base: "main", worktree: ($d + "/worktrees/demo-review"), by: "orchestrator", updated: "2026-01-01 12:03",
         summary: "Sidebar-Abstände vereinheitlicht, Checks grün, Screenshot unter /tmp/ui-audit."},
        {id: "demo-2", title: "Team-Panel: Pipeline-Ansicht", status: "doing", repo: ($d + "/repo"), labels: "demo", agent: "omp",
         branch: "feat/demo-doing", base: "main", worktree: ($d + "/worktrees/demo-doing"), terminal: "t1", by: "orchestrator", updated: "2026-01-01 12:02", summary: ""},
        {id: "demo-3", title: "Statusleiste: Utilities bündeln", status: "todo", repo: ($d + "/repo"), labels: "demo", by: "orchestrator", updated: "2026-01-01 12:01", summary: ""},
        {id: "demo-4", title: "Tab-Leiste: Starten entdoppeln", status: "done", repo: ($d + "/repo"), labels: "demo", by: "orchestrator", updated: "2026-01-01 12:00", summary: ""}]
    | ."orchestra.costs" = {tickets: {"demo-1": 1.84, "demo-2": 0.62}, perTerminal: {}, orchestrator: 0.41, teamCost: 2.87,
         ticketBudget: 3, teamBudget: 20, stopped: {}, at: 0}
    | ."orchestra.groups" = [{id: "demo-team", name: "UI-Umbau", members: ["t1", "t5"], watch: true, notified: false}]
    | ."attention.since" = {}' "$T/shared.json"
  jq '."orchestra.costs"' "$T/shared.json" > "$T/data/orchestra/costs.json"
}

wait_ready() {
  for _ in $(seq 1 60); do app status >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "Test-Fenster antwortet nicht" >&2; return 1
}

# Spaces und Agents im Test-Core (Adressen t1 … passen zu den Demo-Tickets und dem Team).
seed() {
  local A="$T/demo/agent.sh" j sp term
  j=$(app do space.new --folder "$T/demo/worktrees/demo-doing" --name "demo-app" --tab "Pipeline" --argv "[\"$A\",\"working\",\"omp\",\"TEAM: Pipeline-Ansicht\"]")
  sp=$(jq -r .space <<<"$j")
  app do tab.new --space "$sp" --name "Review" --argv "[\"$A\",\"blocked\",\"claude\",\"Review: Team-Panel\"]" >/dev/null
  app do tab.new --space "$sp" --name "Tests" --argv "[\"$A\",\"done\",\"pi\",\"Tests für quests\"]" >/dev/null
  app do tab.new --space "$sp" --name "shell" >/dev/null
  j=$(app do space.new --folder "$T/demo/worktrees/demo-review" --name "demo-review" --tab "Sidebar" --argv "[\"$A\",\"idle\",\"omp\",\"SIDEBAR: Abstände\"]")
  term=$(jq -r .terminal <<<"$j")
  core run --bg --json --name demo-sub --cwd "$T/demo/repo" --parent "$term" --no-notify -- "$A" working omp "Subagent: Suche" >/dev/null
  core run --bg --json --keep --no-parent --name orchestrator --cwd "$T/demo/repo" --label hub.role=orchestrator -- "$A" working omp "Orchestrator: verteilt Tickets" >/dev/null
  if core machine ls | grep -q '"demo-vm"'; then
    app do space.new --machine demo-vm --folder /tmp --name "agentic-vm" --tab "Remote" --argv "[\"$A\",\"idle\",\"omp\",\"ISSUE: Remote-Test\"]" >/dev/null || true
  fi
  app do space.select --index 1 >/dev/null
  app do tab.select --index 1 >/dev/null
}

case "${1:-}" in
  up)
    if app status >/dev/null 2>&1; then sync_worktree; echo "läuft schon; synchronisiert"; exit 0; fi
    build_home
    write_demo
    core server status >/dev/null
    core machine ls | grep -q '"demo-vm"' || core machine add --via "sh -c" --name demo-vm --session "$S-vm" >/dev/null
    # Eigene App-Instanz (-n) im Hintergrund (-g); überlebt die aufrufende Shell.
    bundle="$(cd "$(dirname "$(readlink -f "$(command -v herdr-app)")")/../.." && pwd)"
    open -n -g -a "$bundle" --env "HERDR_APP_HOME=$T" --env "HC_SESSION=$S" \
      --env "HERDR_RELEASES_URL=http://127.0.0.1:9/" --env "HERDR_TELEMETRY=0"
    wait_ready
    [ "$(core ls --json | jq '.terminals | length')" != 0 ] || seed
    echo "Test-Fenster (PID $(window_pid)): HERDR_APP_HOME=$T HC_SESSION=$S"
    ;;
  sync) sync_worktree; echo "synchronisiert: $WT -> $T" ;;
  shot) mkdir -p "$SHOTS"; app shot "$SHOTS/${2:?NAME}.png" ;;
  do) shift; app do "$@" ;;
  status) app status ;;
  ls) app ls ;;
  check) app check "$T/mods/${2:?MOD}" ;;
  hc) shift; core "$@" ;;
  # bin/hub nimmt ohne HERDR_APP_HOME die Live-Config: hier immer das Test-Home und den Test-Core.
  hub) shift; HERDR_APP_HOME="$T" HC_SESSION="$S" "$T/mods/orchestra/bin/hub" "$@" ;;
  down)
    # Nur die eigene Instanz beenden: PID über den Socket des Test-Homes, nie die des Menschen.
    pid="$(window_pid || true)"; live="$(sock_pid "$LIVE" || true)"
    if [ -n "$pid" ] && ! grep -qx "$pid" <<<"$live"; then
      kill "$pid"; for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    fi
    for s in "$S" "$S-vm"; do
      HC_SESSION="$s" hc server stop >/dev/null 2>&1 || true
      case "$s" in uiprev-?*) rm -rf "$HOME/.local/state/herdr-core/$s" ;; esac
    done
    echo "beendet ($S); Test-Home bleibt: $T"
    ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
