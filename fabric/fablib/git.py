"""Git: Repo prüfen, Branch und Worktree anlegen, mergen, prüfen."""
import json
import os
import re
import subprocess

from . import store
from .errors import FabError

# Die Testsuite dauert inzwischen über zehn Minuten; 600 s reichten nicht mehr.
VERIFY_TIMEOUT = 1200

GITHUB_URL = re.compile(
    r"^(?:https?://(?:[^@/]+@)?github\.com/|ssh://(?:[^@/]+@)?github\.com/"
    r"|(?:[^@/]+@)?github\.com:)",
    re.IGNORECASE,
)
GH_TIMEOUT = 60
PUSH_TIMEOUT = 600


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


def main_toplevel(path):
    """Haupt-Checkout eines (ggf. verlinkten) Worktrees; sonst `toplevel`."""
    top = toplevel(path)
    if not top:
        return None
    result = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], top)
    if result.returncode != 0:
        return top
    common = result.stdout.strip()
    if not common:
        return top
    main = os.path.dirname(common) if os.path.basename(common) == ".git" else common
    return main if os.path.isdir(main) and toplevel(main) else top


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


def merge_base(repo, base, branch_name):
    """Merge-Basis von base und branch_name; FabError, wenn unbestimmbar."""
    merged = git(["merge-base", base, branch_name], repo)
    basis = merged.stdout.strip()
    if merged.returncode != 0 or not basis:
        detail = (merged.stderr or merged.stdout).strip() or "unbekannter Fehler"
        raise FabError(
            f"Merge-Basis von {base} und {branch_name} ist nicht bestimmbar: {detail}"
        )
    return basis


def diff_paths(repo, base, branch_name):
    """Dateien, die der Branch gegenüber der Merge-Basis mit base ändert."""
    basis = merge_base(repo, base, branch_name)
    result = git(["diff", "--name-only", "-z", basis, branch_name], repo)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Dateien von {branch_name} sind nicht lesbar: {detail}")
    return [name for name in result.stdout.split("\0") if name]


def resolve_head(repo, branch_name, worktree=None):
    """Voller SHA der Branch-Spitze; bevorzugt den Worktree, sonst das Repo."""
    if worktree and os.path.isdir(worktree):
        sha = head(worktree)
        if sha:
            return sha
    result = git(["rev-parse", "--verify", branch_name], repo)
    sha = result.stdout.strip()
    if result.returncode != 0 or not sha:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Branch {branch_name} ist nicht auflösbar: {detail}")
    return sha


def diff_numstat(repo, base, branch_name):
    """Dateiänderungen als {path, added, deleted, binary} (drei Punkte, keine Renames)."""
    result = git(
        ["diff", "--numstat", "--no-renames", "-z", f"{base}...{branch_name}"], repo
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Änderungen von {branch_name} sind nicht lesbar: {detail}")
    files = []
    for entry in result.stdout.split("\0"):
        if not entry:
            continue
        added, deleted, path = entry.split("\t", 2)
        binary = added == "-" or deleted == "-"
        files.append(
            {
                "path": path,
                "added": 0 if binary else int(added),
                "deleted": 0 if binary else int(deleted),
                "binary": binary,
            }
        )
    return files


def diff_commits(repo, base, branch_name):
    """Commits auf dem Branch seit base, neueste zuerst."""
    result = git(
        [
            "log",
            "-z",
            "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s",
            f"{base}..{branch_name}",
        ],
        repo,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Commits von {branch_name} sind nicht lesbar: {detail}")
    commits = []
    for record in result.stdout.split("\0"):
        if not record.strip():
            continue
        fields = record.split("\x1f", 4)
        if len(fields) != 5:
            continue
        sha, short, author, at, subject = fields
        commits.append(
            {
                "hash": sha,
                "short": short,
                "subject": subject,
                "author": author,
                "at": at,
            }
        )
    return commits


def diff_text(repo, base, branch_name, path):
    """Farbfreier Diff einer Datei gegen die Merge-Basis."""
    result = git(
        ["diff", "--no-color", "--no-ext-diff", f"{base}...{branch_name}", "--", path],
        repo,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Diff für {path} ist nicht lesbar: {detail}")
    return result.stdout


def merge_state(repo_top, base, branch_name):
    """(tree, konfliktdateien) des Merge-Stands branch_name in base; schreibt nichts.

    Nutzt `git merge-tree --write-tree`; das ändert weder Worktree noch Refs.
    Bei Konflikten ist `tree` None; ohne Konflikte ist die Dateiliste leer.
    Scheitert die Prüfung selbst (z. B. unbekannte Basis), FabError.
    """
    result = git(
        ["merge-tree", "--write-tree", base, branch_name], repo_top, timeout=600
    )
    if result.returncode == 0:
        lines = result.stdout.splitlines()
        if not lines or not lines[0].strip():
            detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
            raise FabError(
                f"Merge-Prüfung von {branch_name} gegen {base} lieferte keinen "
                f"Tree: {detail}"
            )
        return lines[0].strip(), []
    paths = []
    for line in result.stdout.splitlines():
        meta, tab, path = line.partition("\t")
        if not tab or not path:
            continue
        fields = meta.split()
        if len(fields) != 3 or fields[2] not in ("1", "2", "3"):
            continue
        if path not in paths:
            paths.append(path)
    if paths:
        return None, paths
    detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
    raise FabError(
        f"Merge-Prüfung von {branch_name} gegen {base} ist fehlgeschlagen: {detail}"
    )


def merge_conflicts(repo_top, base, branch_name):
    """Konfliktdateien beim Mergen von branch_name in base; schreibt nichts."""
    _tree, paths = merge_state(repo_top, base, branch_name)
    return paths


def rev_parse(repo, ref):
    """Voller Commit-SHA einer Referenz; FabError, wenn sie nicht auflösbar ist."""
    result = git(["rev-parse", "--verify", f"{ref}^{{commit}}"], repo)
    sha = result.stdout.strip()
    if result.returncode != 0 or not sha:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"{ref} ist nicht auflösbar: {detail}")
    return sha


def tree_sha(repo, ref):
    """Tree-Hash einer Referenz; FabError, wenn sie nicht auflösbar ist."""
    result = git(["rev-parse", "--verify", f"{ref}^{{tree}}"], repo)
    sha = result.stdout.strip()
    if result.returncode != 0 or not sha:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Tree von {ref} ist nicht auflösbar: {detail}")
    return sha


def merge_commit(repo, tree, base, branch_name, message):
    """Synthetischer Merge-Commit für den Tree; bewegt keine Refs."""
    result = git(
        ["commit-tree", tree, "-p", base, "-p", branch_name, "-m", message], repo
    )
    sha = result.stdout.strip()
    if result.returncode != 0 or not sha:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Merge-Commit für {tree} konnte nicht erzeugt werden: {detail}")
    return sha


def create_detached_worktree(repo_top, folder, commit):
    """Worktree auf einem Commit ohne Branch; entfernt nichts Bestehendes."""
    folder = os.path.abspath(os.path.expanduser(folder))
    os.makedirs(os.path.dirname(folder), exist_ok=True)
    result = git(["worktree", "add", "--detach", folder, commit], repo_top)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise FabError(f"Worktree {folder} konnte nicht angelegt werden: {detail}")
    return folder


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


def reset_keep(repo_top, commit):
    result = git(["reset", "--keep", commit], repo_top, timeout=PUSH_TIMEOUT)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"git reset --keep {commit} ist fehlgeschlagen: {detail}")
    return head(repo_top)


def revert(repo, commit):
    parents = git(["rev-list", "--parents", "-n", "1", commit], repo)
    if parents.returncode != 0:
        detail = (parents.stderr or parents.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"git rev-list {commit} ist fehlgeschlagen: {detail}")
    fields = parents.stdout.split()
    if len(fields) >= 3:
        args = ["revert", "-m", "1", "--no-edit", commit]
    else:
        args = ["revert", "--no-edit", commit]
    result = git(args, repo, timeout=600)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"git revert {commit} ist fehlgeschlagen: {detail}")
    return head(repo)


def is_github_url(url):
    return bool(url and GITHUB_URL.match(url.strip()))


def github_remote(repo):
    """Origin-URL des Repos, wenn sie auf github.com zeigt; sonst None.

    `git remote get-url` wendet `url.<…>.insteadOf` an; für die Erkennung zählt
    die konfigurierte Herkunft, daher zuerst der rohe Config-Wert.
    """
    result = git(["config", "--get", "remote.origin.url"], repo)
    if result.returncode != 0:
        result = git(["remote", "get-url", "origin"], repo)
    if result.returncode != 0:
        return None
    url = result.stdout.strip()
    return url if is_github_url(url) else None


def _gh(repo, args, timeout=GH_TIMEOUT):
    try:
        return subprocess.run(
            ["gh", *args], cwd=repo, capture_output=True, text=True, timeout=timeout
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def gh_authenticated(repo):
    result = _gh(repo, ["auth", "status"])
    return result is not None and result.returncode == 0


def require_github_issues(repo):
    """Bricht ab, wenn `repo` keinen GitHub-Origin oder kein angemeldetes gh hat."""
    if not github_remote(repo):
        raise FabError(
            f"Kein GitHub-Origin in {repo}; GitHub-Issues brauchen einen "
            f"github.com-Remote (origin)"
        )
    result = _gh(repo, ["auth", "status"])
    if result is None:
        raise FabError(
            "gh ist nicht installiert; GitHub-Issues brauchen die GitHub-CLI"
        )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        detail = f" ({detail})" if detail else ""
        raise FabError(
            f"gh ist nicht angemeldet{detail}; bitte `gh auth login` ausführen"
        )


def _gh_json(repo, args, what):
    """JSON-Ausgabe eines gh-Aufrufs; gh-Fehler als deutsche FabError."""
    require_github_issues(repo)
    result = _gh(repo, args)
    if result is None:
        raise FabError("gh ist nicht installiert; GitHub-Issues brauchen die GitHub-CLI")
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"{what}: {detail}")
    try:
        return json.loads(result.stdout or "null")
    except ValueError:
        raise FabError(f"{what}: gh lieferte kein gültiges JSON")


def gh_issue_view(repo, number):
    """Ein Issue als Dict (number, title, body, url, state)."""
    payload = _gh_json(
        repo,
        ["issue", "view", str(number), "--json", "number,title,body,url,state"],
        f"Issue #{number} nicht lesbar",
    )
    if not isinstance(payload, dict):
        raise FabError(f"Issue #{number} nicht lesbar: gh lieferte kein Objekt")
    return payload


def gh_issue_list(repo):
    """Offene Issues des Repos als Liste von Dicts."""
    payload = _gh_json(
        repo,
        [
            "issue",
            "list",
            "--state",
            "open",
            "--json",
            "number,title,url",
            "--limit",
            "1000",
        ],
        "GitHub-Issues nicht lesbar",
    )
    if not isinstance(payload, list):
        raise FabError("GitHub-Issues nicht lesbar: gh lieferte keine Liste")
    return payload


def fetch(repo, remote="origin"):
    result = git(["fetch", remote], repo, timeout=PUSH_TIMEOUT)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"git fetch {remote} ist fehlgeschlagen: {detail}")


def remote_ref(repo, remote, branch_name):
    result = git(
        ["rev-parse", "--verify", f"refs/remotes/{remote}/{branch_name}"], repo
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def is_ancestor(repo, ancestor, descendant):
    return git(["merge-base", "--is-ancestor", ancestor, descendant], repo).returncode == 0


def push(repo, remote, branch_name):
    result = git(["push", remote, branch_name], repo, timeout=PUSH_TIMEOUT)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"git push {remote} {branch_name} ist fehlgeschlagen: {detail}")


def push_delete(repo, remote, branch_name):
    result = git(["push", remote, "--delete", branch_name], repo, timeout=PUSH_TIMEOUT)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        if "remote ref does not exist" in detail:
            return
        raise FabError(
            f"git push {remote} --delete {branch_name} ist fehlgeschlagen: {detail}"
        )


def merge_ff_only(repo, ref):
    result = git(["merge", "--ff-only", ref], repo, timeout=PUSH_TIMEOUT)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"Merge --ff-only {ref} ist fehlgeschlagen: {detail}")


def gh_pr_url(repo, branch_name):
    result = _gh(repo, ["pr", "view", branch_name, "--json", "url", "--jq", ".url"])
    if result is None or result.returncode != 0:
        return None
    return result.stdout.strip() or None


def gh_pr_state(repo, url):
    result = _gh(repo, ["pr", "view", url, "--json", "state", "--jq", ".state"])
    if result is None or result.returncode != 0:
        return ""
    return result.stdout.strip()


def gh_pr_create(repo, title, body, base, head):
    result = _gh(
        repo,
        ["pr", "create", "--title", title, "--body", body, "--base", base, "--head", head],
        timeout=PUSH_TIMEOUT,
    )
    if result is None or result.returncode != 0:
        url = gh_pr_url(repo, head)
        if url:
            return url
        detail = "gh ist nicht verfügbar"
        if result is not None:
            detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
        raise FabError(f"GitHub-PR konnte nicht angelegt werden: {detail}")
    match = re.search(r"https://\S+/pull/\d+", result.stdout)
    if match:
        return match.group(0)
    url = gh_pr_url(repo, head)
    if url:
        return url
    detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
    raise FabError(f"GitHub-PR angelegt, aber URL nicht erkannt: {detail}")


def gh_pr_merge(repo, url):
    result = _gh(repo, ["pr", "merge", url, "--merge"], timeout=PUSH_TIMEOUT)
    if result is not None and result.returncode == 0:
        return
    if gh_pr_state(repo, url) == "MERGED":
        return
    detail = "gh ist nicht verfügbar"
    if result is not None:
        detail = (result.stderr or result.stdout).strip() or "unbekannter Fehler"
    raise FabError(f"PR-Merge ist fehlgeschlagen: {detail}")


def run_verify(worktree):
    """`sh <worktree>/.fabric/verify.sh`, Timeout 1200 s."""
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
