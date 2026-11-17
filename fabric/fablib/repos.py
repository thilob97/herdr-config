"""Repo-Dateien: `.fabric/verify.sh` und `.fabric/lessons.md` (Abschnitt 3b)."""
import os
import stat
import subprocess

from . import events, git, index, store
from .errors import FabError

VERIFY_TIMEOUT = 600
TAIL_LINES = 40
VERIFY = "verify.sh"
LESSONS = "lessons.md"
KINDS = ("verify", "lessons")


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
        script, lessons, _folder = _paths(top)
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
            }
        )
    return rows


def show(raw):
    top = _root(raw)
    script, lessons, _folder = _paths(top)
    return {
        "path": top,
        "branch": git.branch(top),
        "verify": {"exists": os.path.isfile(script), "text": _read(script)},
        "lessons": {"exists": os.path.isfile(lessons), "text": _read(lessons)},
    }


def set_file(raw, kind, text, actor):
    if kind not in KINDS:
        raise FabError(
            f"Unbekannte Repo-Datei „{kind}“; erlaubt: {', '.join(KINDS)}"
        )
    top = _root(raw)
    folder = _fabric_folder(top)
    target = os.path.join(folder, VERIFY if kind == "verify" else LESSONS)
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
