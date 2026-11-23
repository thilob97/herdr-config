"""Repo-Dateien: `.fabric/verify.sh`, `.fabric/lessons.md`, `.fabric/decisions.md` und `.fabric/project.md`."""
import datetime
import os
import re
import shutil
import stat
import tempfile

from . import events, git, index, pipeline, store
from .errors import FabError

VERIFY = "verify.sh"
PIPELINE = os.path.join(".fabric", "pipeline.json")
TAIL_LINES = 40
LESSONS = "lessons.md"
DECISIONS = "decisions.md"
PROJECT = "project.md"
KNOWLEDGE = "knowledge"
KNOWLEDGE_MAX = 20 * 1024 * 1024
FILES = {"verify": VERIFY, "lessons": LESSONS, "project": PROJECT}
KINDS = tuple(FILES)
KIND_LABELS = {"verify": "Prüfskript", "lessons": "Lernnotizen", "project": "Steckbrief"}
LESSON_LIMIT = 8
EMPTY_LESSONS = "- noch keine bestätigten Lehren"
DECISION_LIMIT = 5
EMPTY_DECISIONS = "- noch keine bestätigten Entscheidungen"
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
    knowledge = os.path.join(folder, KNOWLEDGE)
    return {
        "path": top,
        "branch": git.branch(top),
        "verify": {"exists": os.path.isfile(script), "text": _read(script)},
        "lessons": {"exists": os.path.isfile(lessons), "text": _read(lessons)},
        "project": {"exists": os.path.isfile(project), "text": _read(project)},
        "project_template": PROJECT_TEMPLATE,
        "knowledge": {
            "exists": os.path.isdir(knowledge),
            "files": knowledge_files(top),
        },
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


def decision_path(raw):
    """(Repo-Wurzel, decisions.md) eines vorhandenen Repos; sonst (None, None)."""
    return _repo_file(raw, DECISIONS)


def decisions(raw, limit=DECISION_LIMIT):
    """Bestätigte Entscheidungen eines Repos, letzte `limit` in Dateireihenfolge."""
    _top, target = decision_path(raw)
    if not target:
        return []
    try:
        text = _read(target)
    except FabError:
        return []
    lines = _lesson_lines(text)
    return lines[-limit:] if limit else []


def decisions_text(raw, limit=DECISION_LIMIT):
    """Entscheidungen als Prompt-Block; ohne Einträge ein Platzhalter."""
    lines = decisions(raw, limit=limit)
    if not lines:
        return EMPTY_DECISIONS
    return "\n".join(f"- {line}" for line in lines)


def decisions_many(paths, limit=DECISION_LIMIT):
    """Entscheidungen aller Repos, letzte `limit` insgesamt.

    Bei mehr als einem Repo mit Entscheidungen wird jede Zeile mit
    `<basename>: <satz>` gekennzeichnet, sonst bleibt der Satz nackt.
    Die Reihenfolge folgt wie bei `lessons_many` der Team-Repo-Liste.
    """
    groups = []
    for raw in paths or ():
        top, _target = decision_path(raw)
        if not top:
            continue
        lines = decisions(raw, limit=limit)
        if lines:
            groups.append((os.path.basename(top), lines))
    if not groups:
        return []
    flattened = []
    for name, lines in groups:
        for line in lines:
            flattened.append(f"{name}: {line}" if len(groups) > 1 else line)
    return flattened[-limit:]


def decision_paths(paths):
    """Vorhandene decisions.md-Pfade der Repos, für den Kürzungs-Hinweis."""
    found = []
    for raw in paths or ():
        _top, target = decision_path(raw)
        if target and os.path.isfile(target):
            found.append(target)
    return found


def project_text(raw):
    """Steckbrief eines Repos; None, wenn Repo oder Datei fehlt."""
    _top, target = project_path(raw)
    if not target:
        return None
    try:
        return _read(target)
    except FabError:
        return None


def knowledge_path(raw):
    """(Repo-Wurzel, Wissensordner) eines vorhandenen Repos; sonst (None, None)."""
    return _repo_file(raw, KNOWLEDGE)


def _knowledge_kind(name):
    """Deutsche Typangabe aus der Endung; unbekannte Endungen bleiben „Datei“."""
    suffix = os.path.splitext(name)[1].lower()
    if suffix == ".pdf":
        return "PDF"
    if suffix in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
        return "Bild"
    if suffix in (".md", ".markdown", ".txt"):
        return "Notiz"
    return "Datei"


def knowledge_files(raw):
    """Reguläre Wissensdateien als `[{name, size, kind}]`, nach Name sortiert."""
    _top, folder = knowledge_path(raw)
    if not folder or not os.path.isdir(folder):
        return []
    try:
        names = os.listdir(folder)
    except OSError as exc:
        raise FabError(f"{folder} ist nicht lesbar: {exc}")
    rows = []
    for name in names:
        if name.startswith("."):
            continue
        path = os.path.join(folder, name)
        try:
            info = os.lstat(path)
        except OSError:
            continue
        if not stat.S_ISREG(info.st_mode):
            continue
        rows.append(
            {"name": name, "size": info.st_size, "kind": _knowledge_kind(name)}
        )
    return sorted(rows, key=lambda row: row["name"])


def _knowledge_name(name):
    """Zielnamen einer Wissensdatei prüfen; Rückgabe ohne Leerraum am Rand."""
    value = str(name or "").strip()
    if not value:
        raise FabError("Der Name der Wissensdatei darf nicht leer sein")
    if "/" in value or "\\" in value:
        raise FabError(
            f"Der Name „{value}“ darf keine Pfadtrenner enthalten; "
            f"Wissensdateien liegen flach in .fabric/{KNOWLEDGE}/"
        )
    if ".." in value:
        raise FabError(f"Der Name „{value}“ darf kein „..“ enthalten")
    if value.startswith("."):
        raise FabError(f"Der Name „{value}“ darf nicht mit einem Punkt beginnen")
    return value


def _knowledge_folder(top):
    """Wissensordner anlegen und prüfen, dass er real im Repo liegt."""
    folder = os.path.join(_fabric_folder(top), KNOWLEDGE)
    os.makedirs(folder, mode=0o755, exist_ok=True)
    root = os.path.realpath(top)
    real = os.path.realpath(folder)
    if os.path.commonpath([root, real]) != root:
        raise FabError(
            f"{folder} zeigt nach {real} außerhalb von {root}; "
            f"Wissensdateien bleiben im Repo"
        )
    return folder


def knowledge_add(raw, source, name=None, force=False, actor="mensch"):
    """Eine Datei binär und atomar in `.fabric/knowledge/` ablegen und committen."""
    top = _root(raw)
    source = os.path.abspath(os.path.expanduser(str(source)))
    if not os.path.isfile(source):
        raise FabError(f"Quelldatei gibt es nicht oder ist keine Datei: {source}")
    wanted = _knowledge_name(name or os.path.basename(source))
    size = os.path.getsize(source)
    if size > KNOWLEDGE_MAX:
        raise FabError(
            f"„{wanted}“ ist {size} Bytes groß; höchstens "
            f"{KNOWLEDGE_MAX} Bytes (20 MB) erlaubt"
        )
    folder = _knowledge_folder(top)
    target = os.path.join(folder, wanted)
    if os.path.lexists(target):
        if not force:
            raise FabError(f"„{wanted}“ existiert schon; --force überschreibt")
        if os.path.islink(target):
            os.unlink(target)
    fd, temporary = tempfile.mkstemp(dir=folder, prefix=".fab-", suffix=".tmp")
    os.close(fd)
    try:
        shutil.copyfile(source, temporary)
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    _commit(top, target, f"Wissensdatei {wanted} hinzugefügt")
    events.append("config", "", actor, "", f".fabric/{KNOWLEDGE}/{wanted} hinzugefügt")
    return target


def knowledge_note(raw, name, text, actor="mensch"):
    """Eine Wissensnotiz als `.md` schreiben und committen."""
    top = _root(raw)
    value = str(name or "").strip()
    stem = value[:-3] if value.lower().endswith(".md") else value
    stem = _knowledge_name(stem)
    filename = value if value.lower().endswith(".md") else f"{stem}.md"
    folder = _knowledge_folder(top)
    target = os.path.join(folder, filename)
    if os.path.lexists(target):
        raise FabError(f"„{filename}“ existiert schon")
    store.atomic_write(target, text or "", mode=0o644)
    _commit(top, target, f"Wissensnotiz {filename} angelegt")
    events.append("config", "", actor, "", f".fabric/{KNOWLEDGE}/{filename} angelegt")
    return target


def knowledge_remove(raw, name, actor="mensch"):
    """Eine Wissensdatei löschen und die Löschung committen."""
    top = _root(raw)
    wanted = _knowledge_name(name)
    _top, folder = knowledge_path(raw)
    target = os.path.join(folder, wanted)
    root = os.path.realpath(top)
    real = os.path.realpath(target)
    if os.path.commonpath([root, real]) != root:
        raise FabError(
            f"{target} zeigt nach {real} außerhalb von {root}; "
            f"Wissensdateien bleiben im Repo"
        )
    if not os.path.isfile(target):
        raise FabError(f"Wissensdatei fehlt: {target}")
    os.unlink(target)
    _commit(top, target, f"Wissensdatei {wanted} entfernt")
    events.append("config", "", actor, "", f".fabric/{KNOWLEDGE}/{wanted} entfernt")
    return target


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


def _commit(top, target, reason):
    """Eine `.fabric`-Datei in einem eigenen Commit festhalten; ohne Basisbranch kein Fehler."""
    return git.commit_paths(top, [target], f"chore(fabric): {reason}")


def append_lesson(raw, sentence, reason=None):
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
    _commit(top, target, reason or "Lehre bestätigt")
    return target


def append_decision(raw, ticket_id, sentence, reason=None, day=None):
    """Eine bestätigte Entscheidung atomar an decisions.md anhängen."""
    sentence = str(sentence or "").strip()
    if not sentence:
        raise FabError("Der Entscheidungssatz darf nicht leer sein")
    if "\n" in sentence or "\r" in sentence:
        raise FabError("Der Entscheidungssatz muss eine Zeile bleiben")
    reason = str(reason or "").strip()
    if "\n" in reason or "\r" in reason:
        raise FabError("Die Begründung muss eine Zeile bleiben")
    day = str(day).strip() if day else datetime.date.today().isoformat()
    if not day or "\n" in day or "\r" in day:
        raise FabError("Das Datum muss eine Zeile bleiben")
    top = _root(raw)
    folder = _fabric_folder(top)
    target = os.path.join(folder, DECISIONS)
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
    text += f"- {day} · {ticket_id}: {sentence}"
    if reason:
        text += f" · Begründung: {reason}"
    text += "\n"
    store.atomic_write(target, text, mode=0o644)
    _commit(top, target, f"Entscheidung aus {ticket_id} bestätigt")
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
    _commit(top, target, f"{KIND_LABELS[kind]} gespeichert")
    rel = f".fabric/{os.path.basename(target)}"
    events.append("config", "", actor, "", f"{rel} in {top} gespeichert")
    index.rebuild()
    return target


def test(raw):
    top = _root(raw)
    script, _lessons, _folder = _paths(top)
    steps_file = os.path.join(top, PIPELINE)
    if not os.path.isfile(script) and not os.path.isfile(steps_file):
        raise FabError(
            f"Prüfskript fehlt: {script}; lege es im UI unter Repos an oder mit "
            f'fab repo set "{top}" verify --text "…" --from mensch'
        )
    result = pipeline.run(top, "repo-test", repo=top, tail_lines=TAIL_LINES)
    return {
        "exit": result["code"],
        "tail": result["tail"],
        "run_id": result["run_id"],
    }
