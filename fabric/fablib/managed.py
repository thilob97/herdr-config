"""Pfade, die `fab` selbst schreibt und in eigenen Commits auf main legt.

Eine Definition für die Abnahme (`_sync_base` in `cli.py`) und den Autopilot
(`ensure_clean_main` in `autopilot.py`). Belegte Committer:

- `.fabric/` – `repos.py:482` (`chore(fabric)`), `fab map`, `fab knowledge`
- `fabric/roster.json` – `config.py:172`, `agents.py:56` (`chore(roster)`)
- `fabric/prompts/` – `prompts.py:137` (`chore(prompt)`)
- `fabric/templates/` – `templates.py:127` (`chore(template)`)
"""

FABRIC_DIR = ".fabric/"
ROSTER_FILE = "fabric/roster.json"
PROMPTS_DIR = "fabric/prompts/"
TEMPLATES_DIR = "fabric/templates/"

# Alles, was `fab accept` beim Rebase auf origin/<base> mitnimmt.
FAB_PATHS = (FABRIC_DIR, ROSTER_FILE, PROMPTS_DIR, TEMPLATES_DIR)
# Davon committet der Autopilot ungefragt nur Roster und Prompts.
CONFIG_PATHS = (ROSTER_FILE, PROMPTS_DIR)


def is_fab_path(path):
    """True, wenn `path` ein fab-verwalteter Pfad ist.

    Einträge mit `/` gelten für alles darunter, Dateien nur exakt.
    """
    for allowed in FAB_PATHS:
        if allowed.endswith("/"):
            if path.startswith(allowed):
                return True
        elif path == allowed:
            return True
    return False
