"""Autopilot: nimmt Tickets ab und hält den Betrieb ohne Menschen am Laufen.

- Nimmt Tickets in Prüfung ab, wenn Checks und Urteil `pass` auf dem aktuellen
  Worktree-HEAD sind.
- Prüft main nach jedem Merge mit `.fabric/verify.sh`; bei Rot wird der Merge
  höchstens einmal wiederholt. Ein Abbruch wird nicht revertiert; ein Revert
  landet nur als Merge-Commit ohne fremde lokale Commits auf origin/main. Danach
  folgen Pausemarke und Alarm; die Abnahme wird angehalten.
- Leitet Rückfragen an den Orchestrator einmal je Ticket weiter.
- Weckt bei Stillstand den Zuständigen (höchstens dreimal), danach den
  Orchestrator; stößt das Verteilen höchstens alle 30 Minuten an.

Status, Log und Pausemarke liegen unter `store.home()`.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import time

from . import git, hc, managed, pipeline, store
from .errors import FabError, HcError

TERMINAL = "autopilot"
FABRIC_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
FAB = os.path.join(FABRIC_DIR, "fab")
INTERVAL = 120
STALL_MIN = 20
DISPATCH_MIN = 30 * 60
NUDGE_LOCK = 30 * 60
ERROR_MARKERS = ("FAIL", "ERROR", "Traceback", "not ok", "failing tests")
SPEC_SECTION = re.compile(r"^test at \S+:\d+:\d+$")  # node --test, spec-Reporter
STACK_FRAME = re.compile(r"^at .*:\d+:\d+\)?\s*\{?$")
QUOTE_MAX_LINES = 20     # Obergrenze für das Zitat
QUOTE_MAX_CHARS = 1200
TAIL_CHARS = 600
SKIP_ALARM_ROUNDS = 3      # so viele Runden mit übersprungenen Abnahmen bis zum Alarm
SKIP_META_KEY = "autopilot_skip"
DECIDE = ("@orchestrator Autopilot heute: Der Mensch ist den ganzen Tag nicht da. "
          "Triff die offene Entscheidung selbst – die vorsichtigste, umkehrbare Option –, "
          "begründe sie hier im Ticket und mach weiter. Warten nur bei Löschen außerhalb "
          "von Worktrees, Geld, Zugangsdaten oder Push.")

_paused = False
_forwarded = set()
_nudges = {}  # ticket -> (anzahl, letzte_zeit)
_conflict_sent = {}  # ticket -> HEAD, für den ein Konflikt gemeldet wurde
_last_dispatch_nudge = 0.0
_last_action = ""
_end = None
_end_text = ""
_round_active = False
_round_paths = []
_round_repo = ""


# ---------------------------------------------------------------- Pfade


def state_path():
    return os.path.join(store.home(), "autopilot.json")


def log_path():
    return os.path.join(store.home(), "autopilot.log")


def pause_path():
    return os.path.join(store.home(), "autopilot-pause")


# ---------------------------------------------------------------- Zeit


def now():
    """Jetzt aus der zentralen Uhr; `FAB_NOW` friert sie ein (Tests)."""
    return datetime.datetime.fromtimestamp(store.now_ms() / 1000)


def epoch():
    return store.now_ms() / 1000.0


def parse_until(value, at=None):
    """`HH:MM` als nächste lokale Zeit, `""`/`done` als None.

    Ist die Uhrzeit heute schon vorbei (oder genau jetzt), gilt morgen.
    """
    text = str(value or "").strip().lower()
    if text in ("", "done"):
        return None
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", text)
    if not match:
        raise FabError(f"Ungültige Endzeit: {value!r} (erwartet HH:MM oder done)")
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        raise FabError(f"Ungültige Endzeit: {value!r} (erwartet HH:MM oder done)")
    base = at or now()
    target = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= base:
        target += datetime.timedelta(days=1)
    return target


def _end_text_for(end):
    return end.strftime("%Y-%m-%dT%H:%M") if end else ""


# ---------------------------------------------------------------- Statusdatei


def write_state(state, reason="", end="", last_action=None):
    """Statusdatei atomar schreiben; unbekannte Leserfelder bleiben unberührt."""
    previous = read_state()
    updated_at = int(epoch() * 1000)
    if state == "paused":
        if previous.get("state") == "paused" and previous.get("paused_since"):
            paused_since = previous["paused_since"]
        else:
            paused_since = updated_at
    else:
        paused_since = ""
    data = {
        "state": state,
        "reason": reason or "",
        "end": end or "",
        "updated_at": updated_at,
        "paused_since": paused_since,
        "last_action": _last_action if last_action is None else last_action,
        "log": log_path(),
        "pid": os.getpid(),
    }
    folder = store.home()
    os.makedirs(folder, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=folder, prefix=".autopilot-", suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False)
        os.replace(tmp, state_path())
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return data


def read_state():
    """Statusdatei als Dict; fehlt sie oder ist sie kaputt, ein leeres Dict."""
    try:
        with open(state_path(), encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def log(msg):
    """Zeile ins Log schreiben und `last_action` fortschreiben."""
    global _last_action
    line = f"{now():%H:%M:%S} {msg}"
    _last_action = line[:200]
    folder = store.home()
    os.makedirs(folder, exist_ok=True)
    with open(log_path(), "a", encoding="utf-8") as stream:
        stream.write(line + "\n")
    return line


def _pause(reason=""):
    try:
        os.makedirs(store.home(), exist_ok=True)
        with open(pause_path(), "w", encoding="utf-8") as stream:
            stream.write(reason or "")
    except OSError:
        pass


def _clear_pause():
    try:
        os.unlink(pause_path())
    except OSError:
        pass


def reset():
    """Laufzeitgedächtnis leeren (Tests und frischer Lauf)."""
    global _paused, _last_dispatch_nudge, _last_action, _end, _end_text
    global _round_active, _round_paths, _round_repo
    _paused = False
    _forwarded.clear()
    _nudges.clear()
    _conflict_sent.clear()
    _last_dispatch_nudge = 0.0
    _last_action = ""
    _end = None
    _end_text = ""
    _round_active = False
    _round_paths = []
    _round_repo = ""


# ---------------------------------------------------------------- Befehle


def _run(*args, cwd=None, timeout=900):
    """Externen Befehl ausführen; (Exit, stdout, stderr) getrennt."""
    try:
        result = subprocess.run(
            [str(arg) for arg in args],
            cwd=cwd or os.getcwd(),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        out, err = _stream_text(exc.stdout), _stream_text(exc.stderr)
        return 124, out, err + f"\nTimeout nach {timeout}s"
    except OSError as exc:
        return 1, "", str(exc)
    return result.returncode, result.stdout or "", result.stderr or ""


def _stream_text(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value or ""


def _sh(*args, cwd=None, timeout=900):
    """Externen Befehl ausführen; (Exit, kombinierte Ausgabe) wie im alten Skript."""
    code, out, err = _run(*args, cwd=cwd, timeout=timeout)
    return code, (out + err).strip()


def fab_json(*args):
    """`fab … --json`; ohne brauchbare Antwort None."""
    code, out = _sh("fab", *args, "--json")
    if code != 0 or not out:
        return None
    try:
        data = json.loads(out)
    except ValueError:
        return None
    return data


def ticket_ids():
    code, out = _sh("fab", "list")
    if code != 0:
        return []
    return [line.split()[0] for line in out.splitlines() if line.startswith("T-")]


def live_sessions():
    """Laufende Fab-Terminals aus `hc ls --json`."""
    try:
        rows = hc.ls()
    except HcError:
        return []
    return [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("name", "")).startswith("fab-")
        and row.get("state") == "live"
    ]


def sessions_for(tid, live):
    suffix = "-" + tid.lower()
    return [row for row in live if str(row.get("name", "")).endswith(suffix)]


def head(path):
    """HEAD eines Worktrees über die Git-Hilfen."""
    return git.head(path) if path else ""


def same(a, b):
    return bool(a) and bool(b) and (a.startswith(b) or b.startswith(a))


def _repo_root(cwd=None):
    """Haupt-Checkout des Repos; ohne Git-Wurzel der Ordner selbst."""
    folder = os.path.abspath(cwd or os.getcwd())
    return git.main_toplevel(folder) or folder


def begin_round():
    """Eine Autopilot-Runde beginnen: Beobachtungen dieser Runde sammeln."""
    global _round_active, _round_paths, _round_repo
    _round_active = True
    _round_paths = []
    _round_repo = ""


def end_round():
    """Runde abschließen; nichtleere Beobachtung zählt genau einen Skip."""
    global _round_active, _round_paths, _round_repo
    paths = _round_paths
    repo = _round_repo
    _round_active = False
    _round_paths = []
    _round_repo = ""
    if paths:
        _record_skip(paths, repo)
    return skip_state()["count"]


def skip_state():
    """Übersprungene Runden: `count`, `paths`, `since`, `notified`, `repo`."""
    raw = store.meta_get(SKIP_META_KEY)
    data = {}
    if raw:
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            parsed = {}
        if isinstance(parsed, dict):
            data = parsed
    try:
        count = int(data.get("count") or 0)
    except (TypeError, ValueError):
        count = 0
    paths = data.get("paths")
    if not isinstance(paths, list):
        paths = []
    paths = [str(item) for item in paths if isinstance(item, str)]
    try:
        since = int(data.get("since") or 0)
    except (TypeError, ValueError):
        since = 0
    repo = data.get("repo")
    return {
        "count": count,
        "paths": paths,
        "since": since,
        "notified": bool(data.get("notified")),
        "repo": repo if isinstance(repo, str) else "",
    }


def _save_skip(count, paths, since, notified, repo):
    store.meta_set(SKIP_META_KEY, json.dumps({
        "count": int(count),
        "paths": list(paths),
        "since": int(since),
        "notified": bool(notified),
        "repo": str(repo or ""),
    }))


def _clear_skip():
    """Skip-Zustand löschen; nach einem Alarm auch das Lesemodell erneuern."""
    global _round_paths, _round_repo
    _round_paths = []
    _round_repo = ""
    state = skip_state()
    if not state["count"] and not state["paths"]:
        return
    store.meta_set(SKIP_META_KEY, "")
    if state["count"] >= SKIP_ALARM_ROUNDS:
        _rebuild_index()


def _record_skip(paths, repo=""):
    """Einen Skip zählen; ab `SKIP_ALARM_ROUNDS` einmalig alarmieren."""
    previous = skip_state()
    count = previous["count"] + 1
    since = previous["since"] or int(epoch() * 1000)
    notified = previous["notified"]
    if count >= SKIP_ALARM_ROUNDS and not notified:
        notified = True
        _save_skip(count, paths, since, notified, repo)
        _rebuild_index()
        text = (
            f"Autopilot: main ist seit {count} Runden nicht sauber "
            f"(blockierend: {', '.join(paths)})."
        )
        log(f"Alarm: main nicht sauber, Orchestrator geweckt: {paths}")
        _wake_orchestrator(text)
    else:
        _save_skip(count, paths, since, notified, repo)
    log(f"main nicht sauber, Abnahme übersprungen ({count}): {paths}")


def refresh_skip():
    """Alarm aufheben, sobald main ohne wartendes review-Ticket sauber ist."""
    state = skip_state()
    if not state["count"]:
        return False
    repo = state["repo"]
    if not repo or not os.path.isdir(repo):
        return False
    if git.pending_paths(repo):
        return False
    _clear_skip()
    return True


def _wake_orchestrator(text):
    """Orchestrator einmalig wecken; ein Fehler darf die Abnahme nicht kippen."""
    try:
        from . import agents, wake

        roster = agents.load(required=False)
        if roster:
            wake.notify_orchestrator(roster, text)
    except (FabError, HcError) as exc:
        log(f"Orchestrator-Weckung fehlgeschlagen: {exc}")


def ensure_clean_main(repo=None):
    """main darf nur App-Konfiguration als Änderung tragen.

    Reine Konfigurationsänderungen werden committet. Alles andere blockiert die
    Abnahme; innerhalb einer Runde zählt das einmal, sonst sofort, und nach
    `SKIP_ALARM_ROUNDS` Runden löst genau ein Alarm samt Weckung aus.
    """
    global _round_repo
    repo = repo or _repo_root()
    dirty = git.pending_paths(repo)
    if not dirty:
        _clear_skip()
        return True
    if all(managed.is_config_path(path) for path in dirty):
        git.git(["add", "--", *dirty], repo)
        commit = git.git(
            ["commit", "-m", "chore: UI-Konfiguration (Autopilot)"], repo
        )
        log(f"Konfiguration committet: {dirty}")
        if commit.returncode == 0:
            _clear_skip()
            return True
        return False
    if _round_active:
        _round_repo = _round_repo or repo
        for path in dirty:
            if path not in _round_paths:
                _round_paths.append(path)
        paths = list(_round_paths)
    else:
        _record_skip(dirty, repo)
        paths = dirty
    log(
        f"main nicht sauber, Abnahme übersprungen "
        f"({skip_state()['count']}): {paths}"
    )
    return False


def _block_end(lines, start):
    """Ende eines Fehlerblocks: Leerzeile, Trenner oder Ende des YAML-Blocks.

    Die Strichzeile direkt unter `FAIL:`/`ERROR:` gehört zum Kopf, nicht zum
    Blockende. In einem YAML-Block (`---`) beenden Leerzeilen den Block nicht;
    dort gilt nur `...`.
    """
    yaml = False
    for index in range(start + 1, len(lines)):
        stripped = lines[index].strip()
        if stripped == "...":
            return index + 1
        if stripped == "---":
            yaml = True
            continue
        if not stripped and not yaml:
            return index
        if index > start + 1 and re.fullmatch(r"(?:={4,}|-{4,})", stripped):
            return index
    return len(lines)


def _is_stack_line(line):
    """Nur echte Stack-Zeilen auslassen, nicht Meldungen, die mit `at ` beginnen.

    Ein Stack-Rahmen trägt ein Ziel `Datei:Zeile:Spalte` (mit oder ohne
    Klammer) oder ist tiefer eingerückt als die Meldung. Eine Meldungszeile wie
    `  at least one value differs` erfüllt beides nicht.
    """
    stripped = line.strip()
    if not stripped.startswith("at "):
        return False
    if STACK_FRAME.match(stripped):
        return True
    indent = len(line) - len(line.lstrip())
    return indent >= 4


def _spec_section(lines, start):
    """Node-spec: Detailblock ab `test at …` bis zum nächsten Detailblock.

    Stack-Zeilen (`at …`) und das angehängte Fehlerobjekt (`{ … }`) tragen
    nichts zur Fehlerart bei, verbrauchen aber den Zeilendeckel und verdrängen
    dadurch weitere Fehler. Beide werden ausgelassen.
    """
    end = start + 1
    while end < len(lines) and not SPEC_SECTION.match(lines[end].strip()):
        end += 1
    section = []
    object_depth = 0
    for line in lines[start:end]:
        stripped = line.strip()
        if object_depth:
            object_depth += stripped.count("{") - stripped.count("}")
            continue
        if _is_stack_line(line):
            if stripped.endswith("{"):
                object_depth = 1 + stripped.count("{") - stripped.count("}")
            continue
        section.append(line)
    while section and not section[-1].strip():
        section.pop()
    return section, end


def _first_errors(text):
    """Alle Fehlerblöcke eines Stroms: Trefferzeile plus Kontext, begrenzt."""
    lines = (text or "").splitlines()
    spec = any("failing tests" in line for line in lines)
    blocks = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if spec and SPEC_SECTION.match(line.strip()):
            section, index = _spec_section(lines, index)
            blocks.append(section)
            continue
        if not any(marker in line for marker in ERROR_MARKERS):
            index += 1
            continue
        if "failing tests" in line:
            # Kopf des spec-Reporters; die Details stehen in den Blöcken darunter.
            index += 1
            continue
        end = _block_end(lines, index)
        blocks.append(lines[index:end])
        index = end if end > index else index + 1
    if not blocks:
        return ""
    flat = [line for block in blocks for line in block]
    notes = []
    if len(flat) > QUOTE_MAX_LINES:
        kept = flat[:QUOTE_MAX_LINES - 1]
        notes.append(f"{len(flat) - len(kept)} weitere Zeilen")
    else:
        kept = flat
    body = "\n".join(kept)
    suffix = f"\n… ({', '.join(notes)})" if notes else ""
    if len(body + suffix) > QUOTE_MAX_CHARS:
        notes.append("Zeichen gekürzt")
        suffix = f"\n… ({', '.join(notes)})"
        body = body[:max(0, QUOTE_MAX_CHARS - len(suffix))].rstrip()
    return body + suffix


def _error_quote(stdout, stderr):
    """Kommentarabschnitt: erste Fehlerzeilen je Strom, sonst Ende mit Hinweis."""
    sections = []
    for label, text in (("stdout", stdout), ("stderr", stderr)):
        block = _first_errors(text)
        if block:
            sections.append(f"{label}:\n{block}")
    if sections:
        return "Fehlerzeilen:\n" + "\n".join(sections)
    combined = "\n".join(part for part in (stdout, stderr) if part and part.strip())
    return (
        "Ende der Ausgabe (keine Fehlerzeile erkannt):\n" + combined[-TAIL_CHARS:]
    )


def _attach_output(tid, stdout, stderr):
    """Vollständige Ausgabe als zwei Anhänge ablegen; liefert ihre Pfade."""
    stamp = now().strftime("%Y%m%d-%H%M%S")
    paths = []
    with tempfile.TemporaryDirectory(prefix="fab-verify-") as folder:
        for stream, text in (("stdout", stdout), ("stderr", stderr)):
            source = os.path.join(folder, f"{stream}.log")
            with open(source, "w", encoding="utf-8") as handle:
                handle.write(text or "")
            _name, relative = store.attachment_add(
                source, tid, f"main-verify-{stamp}-{stream}.log", dedupe=False
            )
            paths.append(relative)
    return paths


def _rebuild_index():
    """Lesemodell nach einer main-Prüfung neu schreiben; Fehler bleiben im Log."""
    try:
        from . import index

        with store.locked():
            index.rebuild()
    except Exception as exc:  # noqa: BLE001 - Anzeige darf die Abnahme nicht kippen
        log(f"Index nach main-Prüfung fehlgeschlagen: {exc}")


def _revert_main(repo):
    """Merge-Commit an HEAD zurücknehmen und nach origin/main pushen.

    Die Basisreferenz wird hier genau einmal bestimmt: origin/main nach einem
    Fetch. Erlaubt ist nur der Merge-Commit von `fab accept`, also HEAD als
    Merge ohne fremde Commits über origin/main (0 Commits: der PR-Weg hat den
    Merge schon gepusht; 1 Commit: der lokale Weg hat ihn noch nicht gepusht).
    Liefert den Pausengrund; "" nur, wenn der Revert auf origin/main liegt.
    Scheitert der Push, wird der lokale Revert wieder verworfen.
    """
    base = "main"
    try:
        git.fetch(repo)
    except FabError as exc:
        return f"origin/{base} nicht erreichbar: {exc}"
    remote = git.remote_ref(repo, "origin", base)
    if not remote:
        return f"origin/{base} fehlt"
    local = git.head(repo)
    if not local:
        return "HEAD ist nicht lesbar"
    ahead = git.git(
        ["rev-list", "--first-parent", "--count", f"{remote}..{local}"], repo
    )
    try:
        count = int(ahead.stdout.strip() or "0") if ahead.returncode == 0 else -1
    except ValueError:
        count = -1
    if count not in (0, 1):
        return (
            f"{count} lokale Commits über origin/{base} – fremde lokale Commits, "
            "kein Revert"
        )
    parents = git.git(["rev-list", "--parents", "-n", "1", local], repo)
    if parents.returncode != 0 or len(parents.stdout.split()) < 3:
        return "HEAD ist kein Merge-Commit aus fab accept – kein Revert"
    try:
        reverted = git.revert(repo, local)
    except FabError as exc:
        git.git(["revert", "--abort"], repo)
        return f"Revert von {local[:7]} fehlgeschlagen – kein Push: {exc}"
    try:
        git.push(repo, "origin", base)
    except FabError as exc:
        try:
            git.reset_keep(repo, local)
        except FabError as reset_exc:
            return (
                f"Push nach origin/{base} fehlgeschlagen ({exc}); lokaler Revert "
                f"{reverted[:7]} blieb stehen: {reset_exc}"
            )
        return (
            f"Push nach origin/{base} fehlgeschlagen ({exc}); Revert lokal "
            "verworfen"
        )
    log(f"Revert {reverted[:7]} nach origin/{base} gepusht")
    return ""


def check_main(repo=None):
    """main nach einem Merge prüfen, bei zweimal Rot den Merge zurücknehmen.

    Rückgabe `(grün, stdout, stderr, run_id, grund)`. `grund` ist "" bei Grün
    und sonst der Pausengrund: ein Abbruch (Grund beginnt mit `Abbruch:`) wird
    nicht revertiert; ein gewöhnliches Rot nur, wenn HEAD ein Merge-Commit von
    `fab accept` ohne fremde lokale Commits ist, und der Revert wird nach
    origin/main gepusht. Ein fehlgeschlagener Revert ändert nichts an der
    Entscheidung: der Aufrufer pausiert die Abnahmen in jedem Fall.
    """
    repo = repo or _repo_root()
    result = pipeline.run(repo, "main", repo=repo, timeout=900)
    if result["state"] == "pass":
        return True, result["stdout"], result["stderr"], result["run_id"], ""
    # Ein Rot kann ein wackliger Test sein: einmal wiederholen.
    log("main rot, zweite Prüfung")
    time.sleep(60)
    result = pipeline.run(repo, "main", repo=repo, timeout=900)
    if result["state"] == "pass":
        log("main beim zweiten Lauf grün (wackliger Test?)")
        return True, result["stdout"], result["stderr"], result["run_id"], ""
    reason = str(result.get("reason") or "")
    if reason.startswith(pipeline.ABORT_PREFIX):
        return (
            False, result["stdout"], result["stderr"], result["run_id"],
            f"main rot durch Abbruch, kein Revert ({reason})",
        )
    return (
        False, result["stdout"], result["stderr"], result["run_id"],
        _revert_main(repo),
    )


def start(until="done", cwd=None):
    """Autopilot-Terminal starten; ein zweiter Start bricht mit Meldung ab."""
    value = until or "done"
    end = parse_until(value)
    folder = os.path.abspath(cwd or os.getcwd())
    repo = git.main_toplevel(folder)
    if not repo:
        raise FabError(
            f"{folder} ist kein Git-Repository; fab autopilot start im Checkout "
            "des Repos ausführen (z. B. cd ~/.config/herdr-app)"
        )
    if TERMINAL in hc.live():
        raise FabError("Autopilot läuft schon (Terminal autopilot)")
    answer = hc.run(
        name=TERMINAL,
        cwd=repo,
        argv=[sys.executable, FAB, "autopilot", "run", "--until", value],
        prompt=None,
        labels={"fab.role": "autopilot"},
    )
    log(f"Autopilot gestartet in {repo}, Ende {value}")
    paused = os.path.exists(pause_path())
    write_state(
        "paused" if paused else "running",
        "main nach Merge rot – Abnahmen pausiert" if paused else "",
        end=_end_text_for(end),
    )
    return {"started": True, "repo": repo, "answer": answer}


def stop():
    """Terminal beenden, Status `stopped` schreiben, Pausemarke entfernen."""
    try:
        hc.kill(TERMINAL)
    except HcError as exc:
        log(f"stop: {exc}")
    _clear_pause()
    previous = read_state()
    log("Autopilot gestoppt")
    state = write_state(
        "stopped",
        "gestoppt",
        end=previous.get("end") or "",
        last_action=_last_action,
    )
    return state


def resume():
    """Pausemarke entfernen; nur `paused` wird wieder `running`.

    Ein `stopped` ohne laufende Schleife bleibt `stopped`: die Lampe aus T-65
    darf nicht „an“ zeigen, nur weil die Marke weg ist.

    Rückgabe: `"resumed"`, `"not-paused"` (Marke weg, Status unverändert) oder
    `"no-state"` (keine Statusdatei).
    """
    _clear_pause()
    global _paused
    _paused = False
    previous = read_state()
    if not previous:
        return "no-state"
    if previous.get("state") != "paused":
        return "not-paused"
    log("Autopilot fortgesetzt")
    write_state(
        "running",
        "",
        end=previous.get("end") or "",
        last_action=_last_action,
    )
    return "resumed"


def status():
    """Statusdatei unverändert, wie sie T-65 liest."""
    return read_state()


def is_live():
    """Läuft das Terminal `autopilot` gerade?"""
    try:
        return TERMINAL in hc.live()
    except HcError:
        return False


# ---------------------------------------------------------------- Schleife


def try_accept(ticket):
    """Ticket abnehmen, wenn Prüfung und Urteil auf demselben HEAD passen.

    Ein bereits begonnenes `fab accept` (Schritte oder gemergter PR) wird
    fortgesetzt, ohne das HEAD-/Urteil-Gate erneut zu verlangen; die
    Abnahme selbst prüft ihre Vorbedingungen.
    """
    global _paused
    tid = ticket["id"]
    checks = ticket.get("checks") or {}
    verdict = ticket.get("verdict") or {}
    repo = _repo_root(ticket.get("repo") or os.getcwd())
    accept = ticket.get("accept") or {}
    steps = accept.get("steps") or {}
    pr = ticket.get("pr") or {}
    resuming = bool(steps) or pr.get("state") == "merged"
    current = head(ticket.get("worktree") or "")
    no_change = False
    if not resuming:
        no_change = bool(ticket.get("no_change"))
        if no_change and ticket.get("base") and ticket.get("branch"):
            try:
                if not git.branch_exists(repo, ticket["branch"]):
                    no_change = False
                else:
                    ref = git.base_ref(repo, ticket["base"])
                    no_change = (
                        git.commit_count(repo, ref, ticket["branch"]) == 0
                    )
            except FabError as exc:
                log(f"accept {tid}: Commit-Zahl nicht bestimmbar: {exc}")
                no_change = False
        if not no_change and not (
            checks.get("state") == "pass"
            and verdict.get("state") == "pass"
            and same(checks.get("head", ""), current)
            and same(verdict.get("head", ""), current)
        ):
            return False
    if _paused or (not no_change and not ensure_clean_main(repo)):
        return False
    if _conflict_sent.get(tid) == current:
        return False
    # Kein Gesamtlimit um `fab accept` (T-142): Es schlösse die Wartezeit des
    # Merge-Stand-Laufs auf einen Prüfplatz ein. Die eigentliche Prüfung ist
    # je Schritt begrenzt (`pipeline.DEFAULT_TIMEOUT`), das Warten über
    # `verifyslots.wait_timeout()`, git/gh über `git.PUSH_TIMEOUT`.
    code, out = _sh("fab", "accept", tid, timeout=None)
    log(f"accept {tid}: exit {code}: {out[-300:]}")
    if code != 0:
        lowered = out.lower()
        if "not mergeable" in out or "Konflikt" in out or "conflict" in lowered:
            _conflict_sent[tid] = current
            agent = ticket.get("assignee") or "orchestrator"
            _sh(
                "fab", "comment", tid, "--from", "mensch", "--",
                f"@{agent} Autopilot: Die Abnahme scheitert an einem Merge-Konflikt mit main. "
                "Bitte main in deinen Branch mergen (git fetch origin && git merge origin/main), "
                f"Konflikte auflösen, fab verify {tid} --from {agent}, danach die Prüferin erneut "
                "bitten und übergeben.",
            )
            log(f"Konflikt {tid}: an {agent} übergeben")
        return False
    if no_change:
        log(f"accept {tid}: ohne Änderung, main unverändert")
        return True
    ok, out, err, run_id, note = check_main(repo)
    if ok:
        _rebuild_index()
        log(f"main nach {tid} grün")
        return True
    # Der Schutzschritt hängt nicht am Erfolg des Reverts.
    reason = note or "main nach Merge rot; Revert nach origin/main gepusht"
    _paused = True
    _pause(reason)
    write_state("paused", reason, end=_end_text)
    _rebuild_index()
    try:
        paths = _attach_output(tid, out, err)
    except (FabError, OSError) as exc:
        log(f"Anhänge {tid} fehlgeschlagen: {exc}")
        paths = []
    message = [
        f"@orchestrator Autopilot: {reason}. Weitere Abnahmen sind pausiert; "
        "bitte die Ursache prüfen und danach `fab autopilot resume` ausführen."
    ]
    if paths:
        message.append("Anhänge: " + ", ".join(paths))
    message.append(_error_quote(out, err))
    message.append(f"Lauf: #{run_id} (fab run show {run_id})")
    _sh(
        "fab", "comment", tid, "--from", "mensch", "--",
        "\n".join(message),
    )
    log(f"ROT nach {tid}: {reason}; Abnahmen pausiert")
    return False


def forward_question(ticket):
    """Offene Mensch-Frage genau einmal an den Orchestrator weiterleiten."""
    tid = ticket["id"]
    if (
        "mensch" in (ticket.get("waiting") or [])
        and ticket.get("status") != "review"
        and tid not in _forwarded
    ):
        _forwarded.add(tid)
        code, out = _sh("fab", "comment", tid, "--from", "mensch", "--", DECIDE)
        log(f"Rückfrage {tid} an Orchestrator: {out[-120:]}")
        return True
    return False


def last_event_age_min(tid):
    """Minuten seit dem letzten Ereignis des Tickets; 0 ohne Ereignis.

    Die Ereignisse liegen seit der SQLite-Ablage nicht mehr zwingend als
    Datei vor; deshalb über die Store-Schnittstelle lesen.
    """
    try:
        rows = store.event_rows_for_ticket(tid)
    except (FabError, OSError):
        return 0
    last = rows[-1].get("at") if rows else 0
    try:
        last = int(last or 0)
    except (TypeError, ValueError):
        last = 0
    return (epoch() * 1000 - last) / 60000 if last else 0


def nudge(ticket, live):
    """Zuständigen bei Stillstand wecken, nach dreimal den Orchestrator."""
    tid = ticket["id"]
    if ticket.get("status") != "doing" or "mensch" in (ticket.get("waiting") or []):
        return False
    if any(
        row.get("status") in ("working", "blocked")
        for row in sessions_for(tid, live)
    ):
        return False
    if last_event_age_min(tid) < STALL_MIN:
        return False
    count, at = _nudges.get(tid, (0, 0))
    if epoch() - at < NUDGE_LOCK:
        return False
    target = ticket.get("assignee") if count < 3 else "orchestrator"
    if not target:
        return False
    code, out = _sh(
        "fab", "wake", tid, target, "--from", "mensch", "--",
        "Autopilot: Hier bewegt sich seit über 20 Minuten nichts. Lies fab show und "
        "mach weiter oder sag im Ticket, was fehlt.",
    )
    _nudges[tid] = (count + 1, epoch())
    log(f"Stillstand {tid}: {target} geweckt ({count + 1}): {out[-120:]}")
    return True


def nudge_dispatch(tickets, live):
    """Offene todo-Tickets ohne Blocker zum Verteilen anstoßen."""
    global _last_dispatch_nudge
    if epoch() - _last_dispatch_nudge < DISPATCH_MIN:
        return False
    if any(
        hc.is_orchestrator(row.get("name"))
        and row.get("status") in ("working", "blocked")
        for row in live
    ):
        return False
    open_ids = {
        ticket["id"] for ticket in tickets
        if ticket.get("status") not in ("done", "dropped")
    }
    ready = [
        ticket for ticket in tickets
        if ticket.get("status") == "todo"
        and not any(blocker in open_ids for blocker in (ticket.get("blocked_by") or []))
    ]
    if not ready:
        return False
    tid = ready[0]["id"]
    code, out = _sh(
        "fab", "comment", tid, "--from", "mensch", "--",
        "@orchestrator Autopilot: Es gibt geplante Tickets ohne offene Blocker. Bitte "
        "nach deiner Überlappungsregel das nächste verteilen.",
    )
    _last_dispatch_nudge = epoch()
    log(f"Verteilen angestoßen über {tid}: {out[-120:]}")
    return True


def _finished(tickets):
    """Nur noch Entwürfe ohne Zuständigen? Dann ist nichts mehr zu tun."""
    non_drafts = [ticket for ticket in tickets if ticket.get("status") != "draft"]
    assigned_drafts = [
        ticket for ticket in tickets
        if ticket.get("status") == "draft" and ticket.get("assignee")
    ]
    return not non_drafts and not assigned_drafts


def _beat():
    write_state(
        "paused" if _paused else "running",
        "main nach Merge rot – Abnahmen pausiert" if _paused else "",
        end=_end_text,
    )


def once():
    """Ein Durchlauf; False, wenn nichts mehr offen ist."""
    refresh_skip()
    begin_round()
    try:
        live = live_sessions()
        tickets = []
        for tid in ticket_ids():
            ticket = fab_json("show", tid)
            if not ticket or ticket.get("status") in ("done", "dropped"):
                continue
            tickets.append(ticket)
            if ticket.get("status") == "review":
                try_accept(ticket)
            forward_question(ticket)
            nudge(ticket, live)
        nudge_dispatch(tickets, live)
        if _finished(tickets):
            log("Nichts mehr offen – Autopilot fertig")
            write_state("stopped", "nichts mehr offen", end=_end_text)
            return False
        return True
    finally:
        end_round()


def run(until="done"):
    """Hauptschleife bis zur Endzeit oder bis nichts mehr offen ist."""
    global _paused, _end, _end_text
    _end = parse_until(until)
    _end_text = _end_text_for(_end)
    _paused = os.path.exists(pause_path())
    log(f"Autopilot gestartet, Ende {_end_text or 'offen'}")
    while _end is None or now() < _end:
        # `fab autopilot resume` läuft in einem anderen Prozess: die Marke ist
        # die Wahrheit, nicht das Gedächtnis dieser Schleife.
        _paused = os.path.exists(pause_path())
        try:
            if not once():
                return 0
        except Exception as exc:  # weiterlaufen, aber festhalten
            log(f"Fehler: {exc!r}")
        _beat()
        time.sleep(INTERVAL)
    log("Autopilot beendet (Zeit)")
    write_state("stopped", "Endzeit erreicht", end=_end_text)
    return 0
