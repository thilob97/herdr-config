"""Projektkarte: `.fabric/map.md` deterministisch aus Git und Dateisystem.

Die Karte nennt die getrackte Struktur, Modulordner, Einstiegspunkte und
Testbefehle. Sie enthält keine Zeitstempel und keinen absoluten Repo-Pfad;
gleicher Stand ergibt gleichen Inhalt. Geschrieben und committet wird nur,
wenn sich der Inhalt ändert.
"""
import json
import os

from . import events, git, repos, store

MAP = "map.md"
MAP_PATH = ".fabric/map.md"
MARKERS = ("mod.json", "package.json", "pyproject.toml", "__init__.py")
TITLE = "# Projektkarte"
SECTIONS = ("Struktur", "Module", "Einstiegspunkte", "Testbefehle")
EMPTY = "- keine gefunden"


def path(raw):
    """(Repo-Wurzel, absolute Karte) eines vorhandenen Repos; sonst (None, None)."""
    return repos._repo_file(raw, MAP)


def exists(raw):
    """Ist die Projektkarte im Repo vorhanden?"""
    _top, target = path(raw)
    return bool(target) and os.path.isfile(target)


def _tracked(top):
    """Getrackte `(Modus, Pfad)`-Paare aus `git ls-files -s`, ohne die Karte selbst."""
    result = git.git(["ls-files", "-z", "-s"], top)
    if result.returncode != 0:
        return []
    rows = []
    for entry in (result.stdout or "").split("\0"):
        if not entry:
            continue
        meta, _sep, name = entry.partition("\t")
        if not name or name == MAP_PATH:
            continue
        mode = meta.split(" ", 1)[0]
        rows.append((mode, name))
    return sorted(rows, key=lambda row: row[1])


def _structure(rows):
    """Baum bis Tiefe 2; Verzeichnisse zählen ihre direkt enthaltenen Dateien."""
    files = [name for _mode, name in rows]
    counts = {}
    dirs = set()
    root_files = []
    for name in files:
        parts = name.split("/")
        if len(parts) == 1:
            root_files.append(name)
            continue
        parent = "/".join(parts[:-1])
        counts[parent] = counts.get(parent, 0) + 1
        for depth in range(1, len(parts)):
            dirs.add("/".join(parts[:depth]))
    lines = [f"- `{name}`" for name in root_files]
    by_parent = {}
    for folder in dirs:
        parent = folder.rsplit("/", 1)[0] if "/" in folder else ""
        by_parent.setdefault(parent, []).append(folder)

    def walk(parent, indent):
        for folder in sorted(by_parent.get(parent, [])):
            count = counts.get(folder, 0)
            label = "Datei" if count == 1 else "Dateien"
            lines.append(f"{'  ' * indent}- `{folder}/` — {count} {label}")
            if indent < 1:
                walk(folder, indent + 1)

    walk("", 0)
    return lines or [EMPTY]


def _modules(rows):
    """Verzeichnisse mit getrackten Modulmarkern, feste Marker-Reihenfolge."""
    seen = {}
    for _mode, name in rows:
        base = name.rsplit("/", 1)[-1]
        if base not in MARKERS:
            continue
        folder = name.rsplit("/", 1)[0] if "/" in name else "."
        seen.setdefault(folder, set()).add(base)
    if not seen:
        return [EMPTY]
    lines = []
    for folder in sorted(seen):
        present = [marker for marker in MARKERS if marker in seen[folder]]
        label = "./" if folder == "." else f"{folder}/"
        lines.append(f"- `{label}` — {', '.join(present)}")
    return lines


def _join(base, value):
    """Wert einer package.json relativ zu ihrem Verzeichnis, mit `/`-Trennern."""
    value = str(value).strip()
    if not value:
        return None
    if os.path.isabs(value):
        return value
    if value.startswith("./"):
        value = value[2:]
    joined = value if base == "." else f"{base}/{value}"
    return os.path.normpath(joined).replace(os.sep, "/")


def _package_entries(top, folder):
    """Einstiegspunkte einer getrackten package.json als Textteile."""
    name = "package.json" if folder == "." else f"{folder}/package.json"
    try:
        with open(os.path.join(top, *name.split("/")), encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    parts = []
    binary = data.get("bin")
    if isinstance(binary, str):
        target = _join(folder, binary)
        if target:
            parts.append(f"bin: {target}")
    elif isinstance(binary, dict):
        for key in sorted(binary):
            value = binary[key]
            if not isinstance(value, str):
                continue
            target = _join(folder, value)
            if target:
                parts.append(f"bin.{key}: {target}")
    main = data.get("main")
    if isinstance(main, str):
        target = _join(folder, main)
        if target:
            parts.append(f"main: {target}")
    return name, parts


def _entrypoints(top, rows):
    """Ausführbare getrackte Dateien und package.json-Einstiegspunkte."""
    lines = [
        f"- `{name}` (ausführbar)" for mode, name in rows if mode == "100755"
    ]
    packages = []
    for _mode, name in rows:
        if name.rsplit("/", 1)[-1] != "package.json":
            continue
        folder = name.rsplit("/", 1)[0] if "/" in name else "."
        entry = _package_entries(top, folder)
        if entry and entry[1]:
            packages.append(entry)
    for name, parts in sorted(packages):
        lines.append(f"- `{name}` — {', '.join(parts)}")
    return lines or [EMPTY]


def _commands(top):
    """Testbefehle aus pipeline.json, sonst der verify.sh-Fallback."""
    pipeline = os.path.join(top, ".fabric", "pipeline.json")
    commands = []
    try:
        with open(pipeline, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        data = None
    steps = data.get("steps") if isinstance(data, dict) else None
    if isinstance(steps, list):
        for step in steps:
            run = step.get("run") if isinstance(step, dict) else None
            if isinstance(run, str) and run.strip():
                commands.append(run.strip())
    if not commands and os.path.isfile(os.path.join(top, ".fabric", "verify.sh")):
        commands.append("sh .fabric/verify.sh")
    return [f"- `{command}`" for command in commands] or [EMPTY]


def render(top):
    """Deterministischer Inhalt der Projektkarte; endet mit genau einem Umbruch."""
    rows = _tracked(top)
    blocks = [
        TITLE,
        f"## {SECTIONS[0]}\n\n" + "\n".join(_structure(rows)),
        f"## {SECTIONS[1]}\n\n" + "\n".join(_modules(rows)),
        f"## {SECTIONS[2]}\n\n" + "\n".join(_entrypoints(top, rows)),
        f"## {SECTIONS[3]}\n\n" + "\n".join(_commands(top)),
    ]
    return "\n\n".join(blocks) + "\n"


def build(raw, actor="fab"):
    """Karte erzeugen, nur bei Änderung atomar schreiben und committen."""
    top = repos._root(raw)
    target = os.path.join(top, ".fabric", MAP)
    text = render(top)
    try:
        with open(target, encoding="utf-8") as handle:
            current = handle.read()
    except OSError:
        current = None
    if current == text:
        return {"path": target, "changed": False, "committed": False, "text": text}
    store.atomic_write(target, text, mode=0o644)
    committed = repos._commit(top, target, "Projektkarte erneuert")
    events.append("config", "", actor, "", ".fabric/map.md erneuert")
    return {"path": target, "changed": True, "committed": committed, "text": text}
