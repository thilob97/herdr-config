"""Git: Repo prüfen, Branch und Worktree anlegen, mergen, prüfen."""
import os
import subprocess

from . import store
from .errors import FabError

VERIFY_TIMEOUT = 600


def git(args, cwd, timeout=120):
    try:
        return subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError:
        raise FabError("git ist nicht installiert")
    except subprocess.TimeoutExpired:
        raise FabError(f"git {' '.join(args)} hat zu lange gedauert")


def toplevel(path):
    if not path or not os.path.isdir(path):
        return None
    result = git(["rev-parse", "--show-toplevel"], path)
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def head(path):
    result = git(["rev-parse", "HEAD"], path)
    return result.stdout.strip() if result.returncode == 0 else ""


def branch(path):
    result = git(["rev-parse", "--abbrev-ref", "HEAD"], path)
    return result.stdout.strip() if result.returncode == 0 else ""


def dirty(path):
    """Uncommittete Änderungen; unversionierte Dateien blockieren keinen Merge."""
    result = git(["status", "--porcelain", "--untracked-files=no"], path)
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def branch_exists(repo, name):
    return (
        git(["show-ref", "--verify", "--quiet", f"refs/heads/{name}"], repo).returncode
        == 0
    )


def pending_paths(path):
    """Uncommittete Dateien inklusive Umbenennungs- und Kopierquellen."""
    result = git(["status", "--porcelain", "-z", "--untracked-files=no"], path)
    if result.returncode != 0:
        return []
    fields = result.stdout.split("\0")
    paths = []
    index = 0
    while index < len(fields):
        entry = fields[index]
        index += 1
        if not entry:
            continue
        paths.append(entry[3:])
        if "R" in entry[:2] or "C" in entry[:2]:
            if index < len(fields) and fields[index]:
                paths.append(fields[index])
            index += 1
    return paths


def diff_paths(repo, base, branch_name):
    """Dateien, die der Branch gegenüber der Merge-Basis mit base ändert."""
    merged = git(["merge-base", base, branch_name], repo)
    basis = merged.stdout.strip()
    if merged.returncode != 0 or not basis:
        detail = (merged.stderr or merged.stdout).strip() or "unbekannter Fehler"
        raise FabError(
            f"Merge-Basis von {base} und {branch_name} ist nicht bestimmbar: {detail}"
        )
    result = git(["diff", "--name-only", "-z", basis, branch_name], repo)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Dateien von {branch_name} sind nicht lesbar: {detail}")
    return [name for name in result.stdout.split("\0") if name]


def base_branch(path):
    """Standard-Basisbranch des Repos: origin/HEAD, sonst main, sonst master."""
    top = toplevel(path)
    if not top:
        return ""
    result = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], top)
    name = result.stdout.strip()
    if name:
        name = name.split("/", 1)[-1]
        if name and branch_exists(top, name):
            return name
    if branch_exists(top, "main"):
        return "main"
    if branch_exists(top, "master"):
        return "master"
    return ""


def commit_paths(path, files, message):
    """Nur die genannten Dateien committen, wenn der Basisbranch ausgecheckt ist."""
    try:
        folder = path if os.path.isdir(path) else os.path.dirname(os.path.abspath(path))
        top = toplevel(folder)
        if not top:
            return False
        base = base_branch(top)
        if not base or branch(top) != base:
            return False
        rels = []
        root = os.path.realpath(top)
        for name in files:
            rel = os.path.relpath(os.path.realpath(name), root)
            if rel == ".." or rel.startswith(".." + os.sep):
                return False
            if rel not in rels:
                rels.append(rel)
        if git(["add", "--", *rels], top).returncode != 0:
            return False
        return git(["commit", "-m", message, "--", *rels], top).returncode == 0
    except (FabError, OSError):
        return False


def create_worktree(repo_top, folder, branch_name, start):
    """Worktree anlegen; ein schon passender Worktree wird weiterverwendet."""
    folder = os.path.abspath(os.path.expanduser(folder))
    if os.path.isdir(folder):
        if branch(folder) == branch_name:
            return folder
        if os.listdir(folder):
            raise FabError(f"Worktree-Pfad ist belegt: {folder}")
    os.makedirs(os.path.dirname(folder), exist_ok=True)
    if branch_exists(repo_top, branch_name):
        args = ["worktree", "add", folder, branch_name]
    else:
        args = ["worktree", "add", "-b", branch_name, folder, start]
    result = git(args, repo_top)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise FabError(f"Worktree {folder} konnte nicht angelegt werden: {detail}")
    return folder


def remove_worktree(repo_top, folder):
    if folder and os.path.isdir(folder):
        result = git(["worktree", "remove", "--force", folder], repo_top)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise FabError(f"Worktree {folder} konnte nicht entfernt werden: {detail}")
    git(["worktree", "prune"], repo_top)


def delete_branch(repo_top, branch_name):
    result = git(["branch", "-D", branch_name], repo_top)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise FabError(f"Branch {branch_name} konnte nicht gelöscht werden: {detail}")


def merge_no_ff(repo_top, branch_name, message):
    result = git(["merge", "--no-ff", "-m", message, branch_name], repo_top, timeout=600)
    if result.returncode != 0:
        files = [
            line
            for line in git(["diff", "--name-only", "--diff-filter=U"], repo_top).stdout.splitlines()
            if line.strip()
        ]
        git(["merge", "--abort"], repo_top)
        detail = (result.stderr or result.stdout).strip()
        if files:
            raise FabError(
                f"Merge von {branch_name} scheiterte an Konflikten in "
                f"{', '.join(files)}; der Merge wurde abgebrochen"
            )
        raise FabError(f"Merge von {branch_name} scheiterte: {detail}")
    return head(repo_top)


def run_verify(worktree):
    """`sh <worktree>/.fabric/verify.sh`, Timeout 600 s."""
    script = os.path.join(worktree, ".fabric", "verify.sh")
    if not os.path.isfile(script):
        raise FabError(
            f"Prüfskript fehlt: {script}. Der Agent legt .fabric/verify.sh an "
            f"und committet es."
        )
    try:
        result = subprocess.run(
            ["sh", script],
            cwd=worktree,
            capture_output=True,
            text=True,
            timeout=VERIFY_TIMEOUT,
        )
        code = result.returncode
        output = (result.stdout or "") + (result.stderr or "")
    except subprocess.TimeoutExpired as exc:
        code = 124
        output = ""
        if isinstance(exc.stdout, str):
            output += exc.stdout
        if isinstance(exc.stderr, str):
            output += exc.stderr
        output += f"\nTimeout nach {VERIFY_TIMEOUT} s"
    except FileNotFoundError:
        raise FabError("sh ist nicht vorhanden")
    tail = "\n".join(output.strip().splitlines()[-20:])
    return {
        "state": "pass" if code == 0 else "fail",
        "head": head(worktree),
        "at": store.now_ms(),
        "tail": tail,
        "code": code,
    }
