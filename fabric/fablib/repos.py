"""Repo-Dateien: `.fabric/verify.sh`, `.fabric/lessons.md` und `.fabric/project.md`."""
import os
import re
import stat
import subprocess

from . import events, git, index, store
from .errors import FabError

VERIFY_TIMEOUT = 600
TAIL_LINES = 40
VERIFY = "verify.sh"
LESSONS = "lessons.md"
PROJECT = "project.md"
FILES = {"verify": VERIFY, "lessons": LESSONS, "project": PROJECT}
KINDS = tuple(FILES)
LESSON_LIMIT = 8
EMPTY_LESSONS = "- noch keine bestätigten Lehren"
_LESSON_MARKER = re.compile(r"^(?:[-*+]|\d+\.)\s+")
PROJECT_TEMPLATE = """# Projekt-Steckbrief

## Zweck
Wofür ist das Projekt da, in zwei bis drei Sätzen.

## Nutzer
Wer benutzt es und wofür.

## Architektur
Die wichtigsten Bausteine und ihr Zusammenspiel, kurz.

## Wichtige Befehle
Bauen, testen, prüfen.

## Konventionen
Stil und Abläufe; verweist auf AGENTS.md, statt sie zu doppeln.

## Tabus
Was niemand anfassen oder ändern darf.

## Links
Issues, Doku, Vorschauen.
"""


def _checkout(path):
    """Git-Wurzel des Pfads; ein verlinkter Worktree wird auf den Haupt-Checkout abgebildet."""
    top = git.toplevel(path)
    if not top:
        return None
    top = os.path.realpath(top)
    result = git.git(["rev-parse", "--git-common-dir"], top)
    if result.returncode != 0:
        return top
    common = (result.stdout or "").strip()
    if not common:
        return top
    folder = common if os.path.isabs(common) else os.path.join(top, common)
    folder = os.path.realpath(folder)
    if os.path.basename(folder) != ".git":
        # Bare-Repo oder eigener Git-Ordner: kein separater Haupt-Checkout.
        return top
    candidate = os.path.dirname(folder)
    if os.path.isdir(candidate) and git.toplevel(candidate):
        return os.path.realpath(candidate)
    return top


def _root(raw):
    path = os.path.abspath(os.path.expanduser(raw or ""))
    if not os.path.isdir(path):
        raise FabError(f"Ordner gibt es nicht: {path}")
    top = _checkout(path)
    if not top:
        raise FabError(
            f"„{path}“ ist keine Git-Wurzel; .fabric/ gehört in den "
            f"Haupt-Checkout eines Repos"
        )
    return top


def _paths(top):
    folder = os.path.join(top, ".fabric")
    return os.path.join(folder, VERIFY), os.path.join(folder, LESSONS), folder


def _fabric_folder(top):
    """Das echte `.fabric`-Verzeichnis; ein Symlink wird abgelehnt."""
    folder = os.path.join(top, ".fabric")
    if os.path.lexists(folder):
        info = os.lstat(folder)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise FabError(
                f"{folder} ist kein echtes Verzeichnis; .fabric muss ein Ordner "
                f"im Repo sein (kein Symlink)"
            )
        return folder
    os.makedirs(folder, mode=0o755)
    os.chmod(folder, 0o755)
    return folder


def _read(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise FabError(f"{path} ist nicht lesbar: {exc}")


def _tail(output):
    lines = (output or "").strip().splitlines()
    return "\n".join(lines[-TAIL_LINES:])


def _run(top, script):
    """Führt das Prüfskript aus; Rückgabe (Exit-Code, letzte 40 Zeilen)."""
    try:
        result = subprocess.run(
            ["sh", script],
            cwd=top,
            capture_output=True,
            text=True,
            timeout=VERIFY_TIMEOUT,
        )
    except FileNotFoundError:
        raise FabError("sh ist nicht vorhanden")
    except subprocess.TimeoutExpired as exc:
        output = ""
        for part in (exc.stdout, exc.stderr):
            if isinstance(part, str):
                output += part
        output += f"\nTimeout nach {VERIFY_TIMEOUT} s"
        return 124, _tail(output)
    output = (result.stdout or "") + (result.stderr or "")
    return result.returncode, _tail(output)


def known(extra=()):
    """Bekannte Repos aus den Tickets und aus den übergebenen Ordnern."""
    tickets_by_root = {}
    for ticket in store.all_tickets():
        repo = ticket.get("repo")
        if not repo:
            continue
        top = _checkout(repo)
        if top:
            tickets_by_root.setdefault(top, []).append(ticket)
    for raw in extra or ():
        path = os.path.abspath(os.path.expanduser(raw))
        top = _checkout(path) if os.path.isdir(path) else None
        if top:
            tickets_by_root.setdefault(top, [])
    rows = []
    for top in sorted(tickets_by_root):
        script, lessons, folder = _paths(top)
        rows.append(
            {
                "path": top,
                "branch": git.branch(top),
                "open_tickets": sum(
                    1
                    for ticket in tickets_by_root[top]
                    if ticket.get("status") not in ("done", "dropped")
                ),
                "verify_exists": os.path.isfile(script),
                "lessons_exists": os.path.isfile(lessons),
                "project_exists": os.path.isfile(os.path.join(folder, PROJECT)),
            }
        )
    return rows


def show(raw):
    top = _root(raw)
    script, lessons, folder = _paths(top)
    project = os.path.join(folder, PROJECT)
    return {
        "path": top,
        "branch": git.branch(top),
        "verify": {"exists": os.path.isfile(script), "text": _read(script)},
        "lessons": {"exists": os.path.isfile(lessons), "text": _read(lessons)},
        "project": {"exists": os.path.isfile(project), "text": _read(project)},
        "project_template": PROJECT_TEMPLATE,
    }


def _repo_file(raw, name):
    """(Repo-Wurzel, Datei) eines vorhandenen Repos; sonst (None, None)."""
    if not raw:
        return None, None
    path = os.path.abspath(os.path.expanduser(str(raw)))
    if not os.path.isdir(path):
        return None, None
    try:
        top = _checkout(path)
    except (FabError, OSError):
        return None, None
    if not top:
        return None, None
    _script, _lessons, folder = _paths(top)
    return top, os.path.join(folder, name)


def _lessons_path(raw):
    """(Repo-Wurzel, lessons.md) eines vorhandenen Repos; sonst (None, None)."""
    return _repo_file(raw, LESSONS)


def project_path(raw):
    """(Repo-Wurzel, project.md) eines vorhandenen Repos; sonst (None, None)."""
    return _repo_file(raw, PROJECT)


def project_text(raw):
    """Steckbrief eines Repos; None, wenn Repo oder Datei fehlt."""
    _top, target = project_path(raw)
    if not target:
        return None
    try:
        return _read(target)
    except FabError:
        return None


def _lesson_lines(text):
    """Sätze aus einer lessons.md: ohne Leerzeilen/Überschriften und ohne Marker."""
    lines = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        line = _LESSON_MARKER.sub("", line).strip()
        if line:
            lines.append(line)
    return lines


def lessons(raw, limit=LESSON_LIMIT):
    """Bestätigte Lehren eines Repos, letzte `limit` in Dateireihenfolge."""
    _top, target = _lessons_path(raw)
    if not target:
        return []
    try:
        text = _read(target)
    except FabError:
        return []
    lines = _lesson_lines(text)
    return lines[-limit:] if limit else []


def lessons_text(raw, limit=LESSON_LIMIT):
    """Lehren als Prompt-Block; ohne Einträge ein Platzhalter."""
    lines = lessons(raw, limit=limit)
    if not lines:
        return EMPTY_LESSONS
    return "\n".join(f"- {line}" for line in lines)


def lessons_many(paths, limit=LESSON_LIMIT):
    """Lehren aller Repos, letzte `limit` insgesamt.

    Bei mehr als einem Repo mit Lehren wird jede Zeile mit
    `- <basename>: <satz>` gekennzeichnet, sonst bleibt der Satz nackt.
    Die Reihenfolge folgt bewusst der Team-Repo-Liste, nicht der Zeit: die
    Dateien tragen keine Zeitstempel je Zeile.
    """
    groups = []
    for raw in paths or ():
        top, _target = _lessons_path(raw)
        if not top:
            continue
        lines = lessons(raw, limit=limit)
        if lines:
            groups.append((os.path.basename(top), lines))
    if not groups:
        return []
    flattened = []
    for name, lines in groups:
        for line in lines:
            flattened.append(f"- {name}: {line}" if len(groups) > 1 else line)
    return flattened[-limit:]


def append_lesson(raw, sentence):
    """Eine bestätigte Lehre als `- <Satz>` atomar an lessons.md anhängen."""
    top = _root(raw)
    folder = _fabric_folder(top)
    target = os.path.join(folder, LESSONS)
    root = os.path.realpath(top)
    real = os.path.realpath(target)
    if os.path.commonpath([root, real]) != root:
        raise FabError(
            f"{target} zeigt nach {real} außerhalb von {root}; "
            f".fabric-Dateien bleiben im Repo"
        )
    text = _read(target) or ""
    if text and not text.endswith("\n"):
        text += "\n"
    text += f"- {sentence}\n"
    store.atomic_write(target, text, mode=0o644)
    return target


def set_file(raw, kind, text, actor):
    if kind not in KINDS:
        raise FabError(
            f"Unbekannte Repo-Datei „{kind}“; erlaubt: {', '.join(KINDS)}"
        )
    top = _root(raw)
    folder = _fabric_folder(top)
    target = os.path.join(folder, FILES[kind])
    root = os.path.realpath(top)
    real = os.path.realpath(target)
    if os.path.commonpath([root, real]) != root:
        raise FabError(
            f"{target} zeigt nach {real} außerhalb von {root}; "
            f".fabric-Dateien bleiben im Repo"
        )
    mode = 0o755 if kind == "verify" else 0o644
    store.atomic_write(target, text, mode=mode)
    rel = f".fabric/{os.path.basename(target)}"
    events.append("config", "", actor, "", f"{rel} in {top} gespeichert")
    index.rebuild()
    return target


def test(raw):
    top = _root(raw)
    script, _lessons, _folder = _paths(top)
    if not os.path.isfile(script):
        raise FabError(
            f"Prüfskript fehlt: {script}; lege es im UI unter Repos an oder mit "
            f'fab repo set "{top}" verify --text "…" --from mensch'
        )
    code, tail = _run(top, script)
    return {"exit": code, "tail": tail}
