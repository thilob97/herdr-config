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

# App-Konfiguration, die Herdr selbst schreibt (Settings, Tasten, Layouts).
SETTINGS_FILE = "settings.json"
KEYS_FILE = "keys.json"
LAYOUTS_DIR = "layouts/"
APP_PATHS = (SETTINGS_FILE, KEYS_FILE, LAYOUTS_DIR)

# Alles, was `fab accept` beim Rebase auf origin/<base> mitnimmt.
FAB_PATHS = (FABRIC_DIR, ROSTER_FILE, PROMPTS_DIR, TEMPLATES_DIR, *APP_PATHS)
# Davon committet der Autopilot ungefragt Roster, Prompts und App-Konfiguration.
CONFIG_PATHS = (ROSTER_FILE, PROMPTS_DIR, *APP_PATHS)


def _matches(path, allowed):
    """Präfixlogik: Einträge mit `/` gelten für alles darunter, Dateien exakt."""
    for entry in allowed:
        if entry.endswith("/"):
            if path.startswith(entry):
                return True
        elif path == entry:
            return True
    return False


def is_fab_path(path):
    """True, wenn `path` ein fab-verwalteter Pfad ist."""
    return _matches(path, FAB_PATHS)


def is_config_path(path):
    """True, wenn der Autopilot `path` ungefragt committen darf."""
    return _matches(path, CONFIG_PATHS)
