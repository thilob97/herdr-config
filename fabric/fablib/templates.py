"""Ticket-Vorlagen aus der Datenbank lesen, zeigen und speichern (T-37)."""
import re

from . import events, index, store
from .errors import FabError

NAME_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
DEFAULT_ORDER = ("bug", "feature", "refactor", "chore")
PLACEHOLDER = "{satz}"

# Untergrenze für eine frische Datenbank; bestehende Installationen migrieren
# ihre Dateien aus dem Rosterordner.
DEFAULTS = {
    "bug": (
        "# Fehlerbericht\n\n## Ziel\n{satz}\n\n## Kontext\n"
        "Was ist passiert, was war erwartet, wie lässt es sich wiederholen?\n\n"
        "## Abnahmekriterien\n- [ ] Der Fehler tritt nicht mehr auf\n"
        "- [ ] Ein Test deckt den Fall ab\n\n## Grenzen\n"
        "Nur den gemeldeten Fehler beheben, keine Umbauten.\n"
    ),
    "feature": (
        "# Neues Feature\n\n## Ziel\n{satz}\n\n## Kontext\n"
        "Wer braucht das, und warum ist es wertvoll?\n\n"
        "## Abnahmekriterien\n- [ ] Das Verhalten ist umgesetzt\n"
        "- [ ] Ein Test prüft das neue Verhalten\n\n## Grenzen\n"
        "So klein wie möglich umsetzen, keine Nebenbaustellen.\n"
    ),
    "refactor": (
        "# Umbau\n\n## Ziel\n{satz}\n\n## Kontext\n"
        "Was ist heute umständlich, und was soll danach einfacher sein?\n\n"
        "## Abnahmekriterien\n- [ ] Das Verhalten bleibt gleich\n"
        "- [ ] Die bestehenden Tests laufen weiter\n\n## Grenzen\n"
        "Kein neues Verhalten, nur die Struktur ändern.\n"
    ),
    "chore": (
        "# Aufräumen\n\n## Ziel\n{satz}\n\n## Kontext\n"
        "Welche Kleinigkeit soll weg oder aktuell gehalten werden?\n\n"
        "## Abnahmekriterien\n- [ ] Die Änderung ist erledigt\n"
        "- [ ] Nichts anderes verhält sich anders\n\n## Grenzen\n"
        "Nur diese Kleinigkeit, kein Umbau.\n"
    ),
}


def validate_name(name):
    value = (name or "").strip()
    if not NAME_RE.match(value):
        raise FabError(
            f"Ungültiger Vorlagename: „{name}“ "
            f"(erlaubt: Buchstabe, dann Buchstaben, Ziffern, _ und -)"
        )
    return value


def _sort_key(row):
    name = row["name"]
    if name in DEFAULT_ORDER:
        return (0, DEFAULT_ORDER.index(name), name)
    return (1, 0, name)


def entries():
    """Alle Vorlagen aus der DB in fester Reihenfolge."""
    rows = []
    for name in store.template_names():
        raw = store.template_get(name) or ""
        rows.append(
            {
                "name": name,
                "path": name,
                "bytes": len(raw.encode("utf-8")),
            }
        )
    return sorted(rows, key=_sort_key)


def show(name):
    """Rohtext der Vorlage; unbekannt → FabError mit vorhandenen Namen."""
    value = validate_name(name)
    stored = store.template_get(value)
    if stored is not None:
        return stored
    known = [row["name"] for row in entries()]
    if not known:
        raise FabError(f"Unbekannte Vorlage „{value}“; es gibt keine Vorlagen")
    raise FabError(
        f"Unbekannte Vorlage „{value}“; vorhanden: {', '.join(known)}"
    )


def save(name, text, actor):
    """Speichert die Vorlage in der DB. Rückgabe: (Name, Bytes)."""
    value = validate_name(name)
    store.template_set(value, text)
    size = len(text.encode("utf-8"))
    events.append("config", "", actor, "", f"Vorlage {value} gespeichert ({size} Bytes)")
    index.rebuild()
    return value, size


def render(text, sentence):
    """Setzt `{satz}` in der Vorlage ein."""
    return (text or "").replace(PLACEHOLDER, sentence or "")
