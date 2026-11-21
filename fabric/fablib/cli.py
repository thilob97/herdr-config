"""Kommandozeile `fab`: Befehle aus Abschnitt 3 des Vertrags."""
import argparse
import json
import os
import re
import sys
import time
import unicodedata

from . import (
    agents,
    config,
    events,
    git,
    hc,
    index,
    preview,
    prompts,
    render,
    repos,
    store,
    teams,
    testpolicy,
    tick,
    wake,
)
from .errors import FabError, HcError


# ---------------------------------------------------------------- Hilfen

def _actor(args):
    value = getattr(args, "from_", None)
    return (value or "").strip()


def _require_actor(args):
    actor = _actor(args)
    if not actor:
        raise FabError("--from NAME fehlt: wer schreibt?")
    return actor


def _abs_repo(path):
    folder = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(folder):
        raise FabError(f"Repo-Pfad gibt es nicht: {folder}")
    return git.main_toplevel(folder) or folder


def _ticket_team(ticket, roster):
    """Team des Ticket-Repos; ohne Repo das Legacy-Team, ohne Team None."""
    repo = ticket.get("repo")
    if not repo:
        return teams.first_team(roster)
    return teams.team_for_repo(roster, repo)


def _slug(text, limit=50):
    value = (text or "").lower()
    for old, new in (
        ("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss"),
    ):
        value = value.replace(old, new)
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:limit].strip("-") or "ticket"


def _worktree_for(repo_top, branch_name):
    root = os.path.expanduser(os.path.join("~", ".herdr", "worktrees"))
    return os.path.join(root, os.path.basename(repo_top), branch_name.replace("/", "-"))


def _add_comment(ticket, author, text, roster=None):
    return wake.add_comment(ticket, author, text, roster)


def _has_criteria(body):
    match = re.search(
        r"(?ms)^##\s+Abnahmekriterien\s*$(.*?)(?=^##\s|\Z)", body or ""
    )
    if not match:
        return False
    for line in match.group(1).splitlines():
        stripped = line.strip()
        if stripped and stripped not in ("- [ ]", "- [x]", "- [X]"):
            return True
    return False


def _open_blockers(ticket):
    open_ids = []
    for blocker_id in ticket.get("blocked_by") or []:
        try:
            blocker = store.load(blocker_id)
        except FabError:
            open_ids.append(f"{blocker_id} (fehlt)")
            continue
        if blocker.get("status") not in ("done", "dropped"):
            open_ids.append(f"{blocker_id} ({blocker.get('status')})")
    return open_ids


def _open_children(ticket):
    """Offene Unter-Tickets einer ID als Liste von Ticket-Dicts."""
    return [
        child
        for child in store.children_of(store.all_tickets(), ticket["id"])
        if child.get("status") not in ("done", "dropped")
    ]


def _children_reason(children):
    return "offene Unter-Tickets: " + ", ".join(
        f"{child['id']} ({child.get('status')})" for child in children
    )


def _dispatch_locked(ticket, agent_name, actor, roster):
    """Startet oder weckt ein Ticket; der Aufrufer hält `store.locked()`.

    Gibt ein Ergebnis-Dict zurück und schreibt Ticket sowie Ereignis selbst.
    """
    if not ticket.get("repo"):
        raise FabError(
            f"{ticket['id']} hat kein Repo; fab edit {ticket['id']} --repo PFAD --from {actor}"
        )
    top = git.toplevel(ticket["repo"])
    if not top:
        raise FabError(f"{ticket['id']}: {ticket['repo']} ist kein Git-Repository")
    team_entry = agents.team_for_ticket(roster, ticket)
    team_name = str(team_entry.get("name") or "")
    agents.agent_in_team(roster, team_entry, agent_name)
    if not _has_criteria(ticket["body"]):
        raise FabError(
            f"{ticket['id']}: Abschnitt „## Abnahmekriterien“ fehlt oder ist leer"
        )
    blockers = _open_blockers(ticket)
    if blockers:
        raise FabError(
            f"{ticket['id']} ist blockiert durch {', '.join(blockers)}; "
            f"erst abschließen oder fab link ändern"
        )
    try:
        live = hc.live()
    except HcError as exc:
        raise FabError(f"Agenten nicht prüfbar: {exc}")
    terminal = hc.terminal_name(agent_name, ticket["id"], team_name)
    candidates = [terminal]
    if team_name == teams.legacy_team_name(roster):
        candidates.append(hc.terminal_name(agent_name, ticket["id"]))
    running_name = next((name for name in candidates if name in live), None)
    if running_name is not None:
        results = wake.process(
            ticket, [agent_name], actor,
            f"Arbeite an {ticket['id']} weiter.",
            roster,
        )
        if ticket["status"] != "doing":
            ticket["status"] = "doing"
        ticket.pop("stall", None)
        events.append("dispatch", ticket["id"], actor, agent_name,
                      f"lief schon: {running_name}")
        store.save(ticket)
        index.rebuild()
        return {
            "agent": agent_name,
            "terminal": running_name,
            "already": True,
            "wake": results,
        }
    if agents.at_limit(roster, live, team_entry):
        limit = teams.team_limit(team_entry)
        total = roster.get("max_sessions_total")
        raise FabError(
            f"{ticket['id']}: unterdrückt: voll — höchstens {limit} Sessions "
            f"je Team {team_name}, {total} gesamt"
        )
    base = git.branch(top)
    start = git.head(top)
    branch_name = f"fab/{ticket['id']}-{_slug(ticket['title'])}"
    folder = _worktree_for(top, branch_name)
    folder = git.create_worktree(top, folder, branch_name, start)
    ticket.update(
        base=base,
        branch=branch_name,
        worktree=folder,
        assignee=agent_name,
    )
    store.save(ticket)
    started = agents.start_agent(roster, ticket, agent_name)
    if started["result"] != "gestartet":
        events.append("dispatch", ticket["id"], actor, agent_name,
                      f"Start fehlgeschlagen: {started['result']}")
        store.save(ticket)
        index.rebuild()
        detail = started.get("error") or started["result"]
        raise store.PersistError(
            f"{ticket['id']}: Agent {agent_name} nicht gestartet ({detail}); "
            f"Branch {branch_name} und Worktree {folder} bleiben für einen neuen Versuch"
        )
    ticket["status"] = "doing"
    ticket.pop("stall", None)
    ticket["sessions"].append(
        {
            "agent": agent_name,
            "terminal": started["terminal"],
            "name": started["name"],
            "started_at": store.now_ms(),
        }
    )
    detail = f"{branch_name} · {folder}"
    warning = started.get("warning")
    if warning:
        detail += f" · {warning}"
    events.append("dispatch", ticket["id"], actor, agent_name, detail)
    store.save(ticket)
    index.rebuild()
    return {
        "agent": agent_name,
        "terminal": started["terminal"],
        "branch": branch_name,
        "folder": folder,
        "warning": warning,
        "already": False,
    }


def _autostart_note(ticket, reason):
    """Grund festhalten, warum ein startbereites Ticket nicht startet."""
    text = f"automatisch nicht gestartet: {reason}"
    events.append("dispatch", ticket["id"], "fab", ticket.get("assignee") or "", text)
    index.rebuild()
    print(f"{ticket['id']}: {text}", file=sys.stderr)


def _autostart(candidate_ids):
    """Startet Tickets, die durch den Wegfall einer Blockade startbereit sind.

    Ein Fehler beim Start bleibt beim Ticket; der Aufrufer (accept, link) gilt
    trotzdem als erfolgreich.
    """
    for candidate_id in dict.fromkeys(candidate_ids):
        with store.locked():
            try:
                ticket = store.load(candidate_id)
            except FabError:
                continue
            status = ticket.get("status")
            if status != "todo":
                if status == "draft":
                    _autostart_note(ticket, "Status draft")
                continue
            if not ticket.get("assignee"):
                _autostart_note(ticket, "kein Zuständiger")
                continue
            if not ticket.get("repo"):
                _autostart_note(ticket, "kein Repo")
                continue
            if not _has_criteria(ticket.get("body")):
                _autostart_note(ticket, "keine Abnahmekriterien")
                continue
            try:
                roster = agents.load()
                result = _dispatch_locked(
                    ticket, ticket["assignee"], "fab", roster
                )
            except Exception as exc:
                events.append(
                    "dispatch", ticket["id"], "fab",
                    ticket.get("assignee") or "",
                    f"automatisch nicht gestartet: {exc}",
                )
                store.save(ticket)
                index.rebuild()
                print(f"{ticket['id']}: automatisch nicht gestartet: {exc}",
                      file=sys.stderr)
                continue
            _print_wake_results(result.get("wake") or [])
            if result["already"]:
                print(
                    f"{ticket['id']}: {result['agent']} läuft schon "
                    f"({result['terminal']}); geweckt statt gestartet"
                )
            else:
                print(
                    f"{ticket['id']}: automatisch an {result['agent']} verteilt: "
                    f"{result['branch']} in {result['folder']} "
                    f"(Terminal {result['terminal']})"
                )
                if result.get("warning"):
                    print(f"{ticket['id']}: {result['warning']}")


def _unblocked_by(trigger_id):
    """IDs der Tickets, die den Trigger als Blocker nennen und jetzt frei sind."""
    found = []
    for ticket in store.all_tickets():
        if ticket["id"] == trigger_id:
            continue
        if trigger_id not in (ticket.get("blocked_by") or []):
            continue
        if _open_blockers(ticket):
            continue
        found.append(ticket["id"])
    return found


def _end_sessions(ticket):
    ended = []
    for session in ticket.get("sessions") or []:
        targets = [session.get("terminal"), session.get("name")]
        for target in dict.fromkeys(item for item in targets if item):
            if hc.kill(target):
                ended.append(target)
                break
    return ended


def _print_wake_results(results):
    for name, line in results:
        print(f"@{name}: {line}")


def _short(value):
    return (value or "—")[:7]


# ---------------------------------------------------------------- Befehle

def cmd_new(args):
    sentence = " ".join((args.sentence or "").split())
    if not sentence:
        raise FabError("Der Satz für das Ticket ist leer")
    author = _actor(args) or "mensch"
    roster = agents.load(required=False)
    title = sentence[:80]
    body = f"## Auftrag\n{sentence}"
    with store.locked():
        parent = None
        if args.parent:
            parent = store.load(args.parent)
            if parent.get("parent"):
                raise FabError(
                    f"{parent['id']} ist selbst ein Unter-Ticket; "
                    f"Unter-Tickets gehen nur eine Ebene tief"
                )
            if not parent.get("repo"):
                raise FabError(
                    f"{parent['id']} hat kein Repo; Unter-Tickets erben das Repo "
                    f"des Eltern-Tickets"
                )
            repo = _abs_repo(parent["repo"])
            if args.repo and _abs_repo(args.repo) != repo:
                raise FabError(
                    f"{parent['id']}: Unter-Tickets erben das Repo des Eltern-Tickets "
                    f"({repo}); --repo weglassen"
                )
            open_children = _open_children(parent)
            if len(open_children) >= store.MAX_CHILDREN:
                raise FabError(
                    f"{parent['id']}: höchstens {store.MAX_CHILDREN} offene "
                    f"Unter-Tickets; offen: "
                    + ", ".join(child["id"] for child in open_children)
                )
        else:
            if args.repo:
                repo = _abs_repo(args.repo)
            else:
                repo = git.main_toplevel(os.getcwd())
            if not repo:
                raise FabError(
                    "Repo fehlt: --repo PFAD angeben oder in einem Git-Checkout ausführen"
                )
        if roster is not None and teams.team_for_repo(roster, repo) is None:
            raise FabError(teams.no_team_message(repo))
        if roster is None and not args.no_wake:
            print(f"Warnung: Roster fehlt ({agents.roster_path()}); @orchestrator wird nicht geweckt",
                  file=sys.stderr)
        tid = store.next_id()
        ticket = store.blank_ticket(tid, title=title, body=body, repo=repo, created_by=author)
        if parent is not None:
            ticket["parent"] = parent["id"]
        store.save(ticket)
        events.append("created", tid, author, "", sentence)
        if not args.no_wake:
            text = "@orchestrator bitte ausformulieren und verteilen"
            if parent is not None:
                text += f" (Unter-Ticket von {parent['id']})"
            _add_comment(ticket, author, text)
            if roster is not None:
                wake.process(ticket, ["orchestrator"], author, text, roster)
        store.save(ticket)
        index.rebuild()
    print(tid)
    return 0


def cmd_list(args):
    tickets = store.all_tickets()
    if args.status:
        if args.status not in store.STATUSES:
            raise FabError(
                f"Unbekannter Status {args.status}; erlaubt: {', '.join(store.STATUSES)}"
            )
        tickets = [ticket for ticket in tickets if ticket["status"] == args.status]
    if args.team:
        roster = agents.load()
        teams.team(roster, args.team)
        tickets = [
            ticket
            for ticket in tickets
            if (_ticket_team(ticket, roster) or {}).get("name") == args.team
        ]
    if args.json:
        print(json.dumps([index.entry(ticket) for ticket in tickets],
                         ensure_ascii=False, indent=2))
    elif args.tree:
        print(render.ticket_tree(tickets))
    else:
        for ticket in tickets:
            print(render.ticket_line(ticket))
    return 0


def cmd_show(args):
    ticket = store.load(args.id)
    if args.json:
        print(render.ticket_json(ticket))
    else:
        children = store.children_of(store.all_tickets(), ticket["id"])
        sys.stdout.write(render.ticket_text(ticket, children=children))
    return 0


_URL_TEXT = re.compile(r"https?://\S+", re.IGNORECASE)
_PROOF_TOKEN = re.compile(
    r"[A-Za-z0-9_.@+\-]+(?:/[A-Za-z0-9_.@+\-]+)*/[A-Za-z0-9_.@+\-]+\.[A-Za-z0-9]+"
    r"|[A-Za-z0-9_.@+\-]+\.[A-Za-z0-9]{2,10}\b",
    re.IGNORECASE,
)


def _is_image(path):
    return os.path.splitext(path)[1].lower() in _ATTACHMENT_SUFFIXES


def _resolve_candidate(roots, path):
    """Ersten existierenden Treffer von path unter roots liefern, sonst None."""
    for root in roots:
        if not root:
            continue
        candidate = os.path.abspath(os.path.join(root, path))
        if os.path.exists(candidate):
            return candidate
    return None


def _proof_roots(ticket, order):
    known = {
        "home_parent": os.path.dirname(store.home()),
        "home": store.home(),
        "worktree": ticket.get("worktree"),
        "repo": ticket.get("repo"),
    }
    return [known[name] for name in order]


def _attachment_proofs(ticket):
    roots = _proof_roots(ticket, ("home_parent", "home", "worktree", "repo"))
    proofs = []
    for item in ticket.get("attachments") or []:
        path = item.get("path") or ""
        name = item.get("name") or os.path.basename(path)
        resolved = _resolve_candidate(roots, path)
        if resolved is None and name:
            stored = os.path.join(store.attachments_dir(ticket["id"]), name)
            if os.path.isfile(stored):
                resolved = os.path.abspath(stored)
        proofs.append(
            {
                "name": name,
                "path": resolved or path,
                "kind": "attachment",
                "image": True,
                "exists": resolved is not None,
            }
        )
    return proofs


def _handover_proofs(ticket):
    roots = _proof_roots(ticket, ("worktree", "repo", "home_parent", "home"))
    proofs = []
    seen = set()
    for row in events.read_all():
        if row.get("kind") != "handover" or row.get("ticket") != ticket["id"]:
            continue
        text = _URL_TEXT.sub(" ", row.get("text") or "")
        for match in _PROOF_TOKEN.finditer(text):
            path = match.group(0)
            resolved = _resolve_candidate(roots, path)
            shown = resolved or path
            key = os.path.abspath(shown) if resolved else shown
            if key in seen:
                continue
            seen.add(key)
            proofs.append(
                {
                    "name": os.path.basename(path),
                    "path": shown,
                    "kind": "handover",
                    "image": _is_image(path),
                    "exists": resolved is not None,
                }
            )
    return proofs


def _merge_proofs(proofs):
    """Gleiche Datei nur einmal: Anhang vor Handover, erster Treffer zählt."""
    seen = set()
    merged = []
    for proof in proofs:
        key = os.path.abspath(proof["path"])
        if key in seen:
            continue
        seen.add(key)
        merged.append(proof)
    return merged


def cmd_diff(args):
    ticket = store.load(args.id)
    tid = ticket["id"]
    repo = ticket.get("repo")
    base = ticket.get("base")
    branch_name = ticket.get("branch")
    if not repo or not base or not branch_name:
        raise FabError(
            f"{tid}: Repo, Basis oder Branch fehlt; fab dispatch legt sie an"
        )
    sha = git.resolve_head(repo, branch_name, ticket.get("worktree"))
    if args.file:
        text = git.diff_text(repo, base, branch_name, args.file)
        if args.json:
            print(json.dumps({"path": args.file, "diff": text}, ensure_ascii=False))
        else:
            sys.stdout.write(text)
        return 0
    files = git.diff_numstat(repo, base, branch_name)
    commits = git.diff_commits(repo, base, branch_name)
    proofs = _merge_proofs(_attachment_proofs(ticket) + _handover_proofs(ticket))
    if args.json:
        payload = {
            "id": tid,
            "base": base,
            "branch": branch_name,
            "head": sha,
            "merge_base": git.merge_base(repo, base, branch_name),
            "files": files,
            "commits": commits,
            "proofs": proofs,
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    print(f"{tid}: {branch_name} → {base} (HEAD {sha[:7]})")
    print("Dateien:")
    if files:
        for item in files:
            if item["binary"]:
                print(f"binär {item['path']}")
            else:
                print(f"+{item['added']} -{item['deleted']} {item['path']}")
    else:
        print("keine")
    print("Commits:")
    if commits:
        for commit in commits:
            print(f"{commit['short']} {commit['subject']} ({commit['author']})")
    else:
        print("keine")
    print("Nachweise:")
    if proofs:
        for proof in proofs:
            print(f"{proof['name']} {proof['path']}")
    else:
        print("keine")
    return 0


def cmd_edit(args):
    actor = _require_actor(args)
    body_text = args.body
    if args.body_file is not None:
        try:
            with open(os.path.expanduser(args.body_file), encoding="utf-8") as handle:
                body_text = handle.read()
        except OSError as exc:
            raise FabError(f"Body-Datei nicht lesbar: {args.body_file}: {exc}")
    with store.locked():
        ticket = store.load(args.id)
        changed = []
        if args.title is not None:
            ticket["title"] = args.title
            changed.append("Titel")
        if body_text is not None:
            ticket["body"] = body_text
            changed.append("Body")
        if args.repo is not None:
            ticket["repo"] = _abs_repo(args.repo)
            changed.append("Repo")
        if args.base is not None:
            ticket["base"] = args.base or None
            changed.append("Basis")
        if not changed:
            raise FabError(
                "Nichts zu ändern: nutze --title, --body, --body-file, --repo oder --base"
            )
        events.append("edited", ticket["id"], actor, "", ", ".join(changed))
        store.save(ticket)
        index.rebuild()
    print(f"{ticket['id']}: geändert ({', '.join(changed)})")
    return 0


def cmd_status(args):
    actor = _require_actor(args)
    if args.status not in store.STATUSES:
        raise FabError(
            f"Unbekannter Status {args.status}; erlaubt: {', '.join(store.STATUSES)}"
        )
    if args.status == "done":
        raise FabError(f"{args.id}: „done“ gibt es nur über fab accept")
    if args.status == "dropped":
        raise FabError(
            f"{args.id}: „dropped“ gibt es nur über fab drop {args.id} mit einem Grund"
        )
    with store.locked():
        ticket = store.load(args.id)
        old = ticket["status"]
        ticket["status"] = args.status
        if old != args.status:
            ticket.pop("stall", None)
        events.append("status", ticket["id"], actor, "", f"{old} → {args.status}")
        store.save(ticket)
        index.rebuild()
    print(f"{ticket['id']}: {old} → {args.status}")
    return 0


def cmd_assign(args):
    actor = _require_actor(args)
    roster = agents.load()
    with store.locked():
        ticket = store.load(args.id)
        team_entry = agents.team_for_ticket(roster, ticket)
        agents.agent_in_team(roster, team_entry, args.name)
        ticket["assignee"] = args.name
        events.append("assigned", ticket["id"], actor, args.name, args.name)
        store.save(ticket)
        index.rebuild()
    print(f"{ticket['id']}: zuständig ist {args.name}")
    return 0


def cmd_link(args):
    actor = _require_actor(args)
    autostart = []
    with store.locked():
        ticket = store.load(args.id)
        if args.remove:
            removals = [store.normalize_id(raw) for raw in args.remove]
            remaining = [
                item for item in ticket["blocked_by"] if item not in removals
            ]
            if remaining == ticket["blocked_by"]:
                raise FabError(
                    f"{ticket['id']}: nichts zu entfernen; blockiert durch "
                    f"{', '.join(ticket['blocked_by']) or 'nichts'}"
                )
            ticket["blocked_by"] = remaining
            events.append(
                "config",
                ticket["id"],
                actor,
                "",
                f"nicht mehr blockiert durch {', '.join(removals)}",
            )
            store.save(ticket)
            index.rebuild()
            print(
                f"{ticket['id']}: blockiert durch {', '.join(remaining) or 'nichts'}"
            )
            if not _open_blockers(ticket):
                autostart.append(ticket["id"])
        else:
            additions = [store.normalize_id(raw) for raw in args.blocked_by]
            if ticket["id"] in additions:
                raise FabError("Ein Ticket kann nicht auf sich selbst warten")
            for blocker_id in additions:
                store.load(blocker_id)
            graph = {item["id"]: list(item["blocked_by"]) for item in store.all_tickets()}
            merged = list(dict.fromkeys(list(ticket["blocked_by"]) + additions))
            graph[ticket["id"]] = merged
            for blocker_id in merged:
                seen, stack = set(), [blocker_id]
                while stack:
                    current = stack.pop()
                    if current == ticket["id"]:
                        raise FabError(
                            f"Zyklus: {ticket['id']} → {blocker_id} → … → {ticket['id']}"
                        )
                    if current in seen:
                        continue
                    seen.add(current)
                    stack.extend(graph.get(current, []))
            ticket["blocked_by"] = merged
            events.append("edited", ticket["id"], actor, "", "blockiert durch " + ", ".join(merged))
            store.save(ticket)
            index.rebuild()
            print(f"{ticket['id']}: blockiert durch {', '.join(merged)}")
            return 0
    _autostart(autostart)
    return 0


def cmd_comment(args):
    actor = _require_actor(args)
    text = args.text or ""
    if not text.strip():
        raise FabError("Der Kommentar ist leer")
    roster = agents.load()
    with store.locked():
        ticket = store.load(args.id)
        found = _add_comment(ticket, actor, text)
        results = wake.process(
            ticket, found, actor, text, roster, no_wake=args.no_wake
        )
        store.save(ticket)
        index.rebuild()
    _print_wake_results(results)
    return 0


_ATTACHMENT_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp")


def _attachment_name(source):
    suffix = os.path.splitext(source)[1].lower()
    if suffix not in _ATTACHMENT_SUFFIXES:
        raise FabError(
            "Nur Bilder als Anhang: erlaubt sind "
            + ", ".join(_ATTACHMENT_SUFFIXES)
        )
    stem = os.path.splitext(os.path.basename(source))[0]
    slug = _slug(stem, 60)
    # _slug fällt bei leerem Rumpf auf „ticket“ zurück; Anhänge heißen dann „bild“.
    if slug == "ticket" and stem.strip().lower() != "ticket":
        slug = "bild"
    return f"{slug}{suffix}"


def _attach_image(ticket_id, source, actor, edit_body):
    ticket = store.load(ticket_id)
    tid = ticket["id"]
    wanted = _attachment_name(source)
    with store.locked():
        name, path = store.attachment_add(source, tid, wanted)
        ticket = store.load(tid)
        reference = f"![{name}]({path})"
        events.append("edited", tid, actor, "", f"Anhang {name}")
        if edit_body:
            body = (ticket.get("body") or "").rstrip()
            if reference not in body:
                body = f"{body}\n\n{reference}\n" if body else f"{reference}\n"
                ticket["body"] = body
        store.save(ticket)
        index.rebuild()
    return reference


def cmd_attach(args):
    actor = _actor(args) or "mensch"
    source = os.path.expanduser(args.datei)
    if not os.path.isfile(source):
        raise FabError(f"Datei gibt es nicht: {source}")
    if not os.access(source, os.R_OK):
        raise FabError(f"Datei ist nicht lesbar: {source}")
    reference = _attach_image(args.id, source, actor, not args.no_edit)
    print(reference)
    return 0


def cmd_preview(args):
    ticket = store.load(args.id)
    tid = ticket["id"]
    if args.action == "start":
        state = preview.start(ticket)
        print(
            f"{tid}: Vorschau läuft in {state['home']} "
            f"(PID {state['pid']}, Core {state['session']})"
        )
    elif args.action == "shot":
        png = preview.shot(ticket)
        actor = _actor(args) or ticket.get("assignee") or "mensch"
        reference = _attach_image(tid, png, actor, True)
        print(png)
        print(reference)
    else:
        preview.stop(tid)
        print(f"{tid}: Vorschau beendet, {preview.root(tid)} entfernt")
    return 0


def cmd_dispatch(args):
    actor = _require_actor(args)
    roster = agents.load()
    with store.locked():
        ticket = store.load(args.id)
        agent_name = args.agent or ticket.get("assignee")
        if not agent_name:
            raise FabError(
                f"{ticket['id']}: kein Agent; nutze --agent NAME oder fab assign {ticket['id']} NAME"
            )
        result = _dispatch_locked(ticket, agent_name, actor, roster)
    _print_wake_results(result.get("wake") or [])
    if result["already"]:
        print(
            f"{ticket['id']}: {agent_name} läuft schon "
            f"({result['terminal']}); geweckt statt gestartet"
        )
        return 0
    print(
        f"{ticket['id']} an {agent_name} verteilt: {result['branch']} in "
        f"{result['folder']} (Terminal {result['terminal']})"
    )
    if result.get("warning"):
        print(f"{ticket['id']}: {result['warning']}")
    return 0


def cmd_verify(args):
    ticket = store.load(args.id)
    worktree = ticket.get("worktree")
    if not worktree or not os.path.isdir(worktree):
        raise FabError(
            f"{ticket['id']}: Worktree fehlt ({worktree or 'kein Pfad'}); fab dispatch legt ihn an"
        )
    actor = _actor(args) or ticket.get("assignee") or ""
    result = git.run_verify(worktree)
    with store.locked():
        fresh = store.load(args.id)
        fresh["checks"] = {
            "state": result["state"],
            "head": result["head"],
            "at": result["at"],
            "tail": result["tail"],
        }
        events.append("verify", fresh["id"], actor, "", result["state"])
        store.save(fresh)
        index.rebuild()
    print(
        f"{fresh['id']}: checks {result['state']} auf HEAD {_short(result['head'])} "
        f"(Exit {result['code']})"
    )
    if result["tail"]:
        print(result["tail"])
    return 0 if result["state"] == "pass" else 1


def cmd_verdict(args):
    actor = _require_actor(args)
    summary = (args.summary or "").strip()
    if not summary:
        raise FabError("Die Zusammenfassung des Urteils ist leer")
    roster = agents.load()
    with store.locked():
        ticket = store.load(args.id)
        worktree = ticket.get("worktree")
        if not worktree:
            raise FabError(f"{ticket['id']}: ohne Worktree gibt es keinen HEAD für das Urteil")
        head = git.head(worktree)
        if not head:
            raise FabError(f"{ticket['id']}: HEAD des Worktrees {worktree} ist nicht lesbar")
        ticket["verdict"] = {
            "state": args.state,
            "by": actor,
            "head": head,
            "at": store.now_ms(),
            "summary": summary,
        }
        events.append("verdict", ticket["id"], actor, "", f"{args.state}: {summary}")
        results = []
        assignee = ticket.get("assignee")
        if args.state == "fail":
            ticket["status"] = "doing"
            ticket.pop("stall", None)
            ticket["waiting"] = [
                waiting
                for waiting in ticket["waiting"]
                if waiting.lower() != "mensch"
            ]
            _add_comment(ticket, actor, summary)
            if assignee:
                reviewer = roster.get("reviewer") or ""
                tail = (
                    f"Lies `fab show {ticket['id']}`, behebe die Befunde, dann "
                    f"`fab verify {ticket['id']} --from {assignee}`"
                    + (f" und @{reviewer} erneut erwähnen." if reviewer else ".")
                )
                results = wake.process(
                    ticket,
                    [assignee],
                    actor,
                    summary,
                    roster,
                    message_for=lambda name: (
                        f"Ticket {ticket['id']} „{ticket['title']}“: Urteil fail von "
                        f"{actor}: „{summary[:300]}“. {tail}"
                    ),
                )
        elif assignee:
            results = wake.process(
                ticket,
                [assignee],
                actor,
                summary,
                roster,
                message_for=lambda name: (
                    f"Ticket {ticket['id']} „{ticket['title']}“: Urteil pass auf "
                    f"HEAD {_short(head)} (von {actor}). Wenn deine Checks auf diesem "
                    f"HEAD grün sind, übergib mit "
                    f"`fab handover {ticket['id']} --from {name} \"…\"`."
                ),
            )
        store.save(ticket)
        index.rebuild()
    _print_wake_results(results)
    print(f"{ticket['id']}: Urteil {args.state} auf HEAD {_short(head)}")
    return 0


def cmd_handover(args):
    actor = _require_actor(args)
    summary = (args.summary or "").strip()
    if not summary:
        raise FabError("Die Zusammenfassung der Übergabe ist leer")
    with store.locked():
        ticket = store.load(args.id)
        worktree = ticket.get("worktree")
        if not worktree or not os.path.isdir(worktree):
            raise FabError(f"{ticket['id']}: Worktree fehlt ({worktree or 'kein Pfad'})")
        head = git.head(worktree)
        reasons = []
        if not head:
            reasons.append(f"HEAD des Worktrees {worktree} ist nicht lesbar")
        checks = ticket.get("checks")
        if not checks:
            reasons.append("keine Checks: fab verify fehlt")
        else:
            if checks.get("state") != "pass":
                reasons.append(f"Checks stehen auf {checks.get('state')}")
            if head and checks.get("head") != head:
                reasons.append(
                    f"Checks gelten für HEAD {_short(checks.get('head'))}, "
                    f"Worktree-HEAD ist {_short(head)}"
                )
        verdict = ticket.get("verdict")
        if not verdict:
            reasons.append("kein Urteil: fab verdict fehlt")
        else:
            if verdict.get("state") != "pass":
                reasons.append(f"Urteil steht auf {verdict.get('state')}")
            if head and verdict.get("head") != head:
                reasons.append(
                    f"Urteil gilt für HEAD {_short(verdict.get('head'))}, "
                    f"Worktree-HEAD ist {_short(head)}"
                )
        children = _open_children(ticket)
        if children:
            reasons.append(_children_reason(children))
        if (
            not reasons
            and ticket.get("repo")
            and ticket.get("base")
            and ticket.get("branch")
        ):
            try:
                changed = git.diff_paths(
                    ticket["repo"], ticket["base"], ticket["branch"]
                )
                policy = testpolicy.load(ticket["repo"])
                logic, tests = testpolicy.classify(policy, changed)
                if logic and not tests:
                    reasons.append(
                        "Logik ohne Test:\n  - "
                        + "\n  - ".join(logic)
                        + "\nTestmuster: "
                        + ", ".join(policy.tests)
                        + f" (Quelle: {policy.source})"
                    )
            except FabError as exc:
                reasons.append(str(exc))
        files = None
        if not reasons and ticket.get("base") and ticket.get("branch") and ticket.get("repo"):
            try:
                files = git.merge_conflicts(
                    ticket["repo"], ticket["base"], ticket["branch"]
                )
            except FabError as exc:
                reasons.append(str(exc))
        if not reasons and files:
            base = ticket["base"]
            reasons.append(
                f"Merge-Konflikt mit {base}:\n  - " + "\n  - ".join(files)
            )
        if reasons:
            if files:
                roster = agents.load()
                text = wake.conflict_text(ticket, ticket["base"], files)
                wake.add_comment(ticket, actor, text, roster)
                results = []
                assignee = ticket.get("assignee")
                if assignee:
                    results = wake.process(
                        ticket, [assignee], actor, text, roster,
                        message_for=lambda name: wake.conflict_wake_text(
                            ticket, ticket["base"], files
                        ),
                    )
                store.save(ticket)
                index.rebuild()
                _print_wake_results(results)
            raise store.PersistError(
                f"{ticket['id']}: Übergabe verweigert:\n- " + "\n- ".join(reasons)
            )
        ticket["status"] = "review"
        ticket.pop("stall", None)
        if "mensch" not in ticket["waiting"]:
            ticket["waiting"].append("mensch")
        _add_comment(ticket, actor, summary)
        events.append("handover", ticket["id"], actor, "", summary)
        store.save(ticket)
        index.rebuild()
    print(f"{ticket['id']}: an den Menschen übergeben (Status review)")
    return 0


def _pr_body(ticket, branch_name):
    handovers = [
        row
        for row in events.read_all()
        if row.get("ticket") == ticket["id"] and row.get("kind") == "handover"
    ]
    summary = (handovers[-1].get("text") or "").strip() if handovers else ""
    if not summary:
        summary = f"Ticket {ticket['id']}: {ticket['title']}"
    checks = ticket.get("checks") or {}
    verdict = ticket.get("verdict") or {}
    return "\n".join(
        [
            summary,
            "",
            "## Checks",
            f"- {checks.get('state') or '—'} (HEAD {_short(checks.get('head'))})",
            "",
            "## Urteil",
            f"- {verdict.get('state') or '—'} von {verdict.get('by') or '—'}: "
            f"{(verdict.get('summary') or '').strip() or '—'} "
            f"(HEAD {_short(verdict.get('head'))})",
            "",
            f"Ticket: {ticket['id']} (fab show {ticket['id']})",
            f"Branch: {branch_name} → {ticket['base']}",
        ]
    )


def _pr_failure(ticket, reason, url):
    reason = reason.strip()
    prefix = "PR-Merge ist fehlgeschlagen: "
    if reason.startswith(prefix):
        reason = reason[len(prefix):]
    text = f"PR-Merge fehlgeschlagen: {reason} — PR: {url}"
    ticket["pr"] = {"url": url, "state": "open"}
    _add_comment(ticket, "mensch", text)
    events.append("pr", ticket["id"], "mensch", "", text)
    store.save(ticket)
    index.rebuild()


def _accept_check_failed(ticket, report):
    output = report.get("output") or ""
    waiting = list(ticket.get("waiting") or [])
    had_stall = "stall" in ticket
    stall = ticket.get("stall")
    _add_comment(ticket, "mensch", "herdr-app check rot — Merge zurückgesetzt:\n" + output)
    ticket["waiting"] = waiting
    if had_stall:
        ticket["stall"] = stall
    else:
        ticket.pop("stall", None)
    target = ticket.get("assignee") or "orchestrator"
    events.append(
        "wake",
        ticket["id"],
        "mensch",
        target,
        "rücksetzen: check rot",
        reason=output if len(output) <= 1500 else output[:1500] + "…",
    )


def cmd_accept(args):
    with store.locked():
        ticket = store.load(args.id)
        if ticket["status"] != "review":
            raise FabError(
                f"{ticket['id']}: Abnahme nur im Status review (jetzt {ticket['status']}); "
                f"erst fab handover"
            )
        children = _open_children(ticket)
        if children:
            raise FabError(
                f"{ticket['id']}: Abnahme verweigert: {_children_reason(children)}"
            )
        repo = ticket.get("repo")
        branch_name = ticket.get("branch")
        worktree = ticket.get("worktree")
        for field, value in (("repo", repo), ("branch", branch_name), ("worktree", worktree)):
            if not value:
                raise FabError(f"{ticket['id']}: Feld {field} fehlt; Merge nicht möglich")
        top = git.toplevel(repo)
        if not top:
            raise FabError(f"{ticket['id']}: {repo} ist kein Git-Repository")
        here = git.branch(top)
        if here != ticket["base"]:
            raise FabError(
                f"Haupt-Checkout {top} steht auf {here}, nicht auf {ticket['base']}; "
                f"bitte auf {ticket['base']} wechseln"
            )
        if git.dirty(top):
            overlap = sorted(
                set(git.pending_paths(top))
                & set(git.diff_paths(top, ticket["base"], branch_name))
            )
            if overlap:
                raise FabError(
                    f"Haupt-Checkout {top} ist nicht sauber: uncommittete Änderungen "
                    f"an Dateien, die {branch_name} ändert:\n- " + "\n- ".join(overlap)
                )
        pr_ready = bool(git.github_remote(top)) and git.gh_authenticated(top)
        failure = None
        if args.pr_only and not pr_ready:
            raise FabError(
                f"{ticket['id']}: --pr-only braucht einen GitHub-Remote (origin) und "
                f"eine gh-Anmeldung (gh auth status)"
            )
        if not pr_ready:
            before = git.head(top)
            merged = git.merge_no_ff(
                top, branch_name, f"Merge {branch_name}: {ticket['title']}"
            )
            report = preview.check_mods(top)
            if not report["ok"]:
                git.reset_keep(top, before)
                _accept_check_failed(ticket, report)
                store.save(ticket)
                index.rebuild()
                raise store.PersistError(
                    f"{ticket['id']}: herdr-app check rot; "
                    f"Merge auf {_short(before)} zurückgesetzt"
                )
            ended = _end_sessions(ticket)
            git.remove_worktree(top, worktree)
            git.delete_branch(top, branch_name)
            ticket["status"] = "done"
            ticket.pop("stall", None)
            ticket["waiting"] = []
            events.append(
                "accept", ticket["id"], "mensch", "",
                f"{branch_name} → {ticket['base']} @ {_short(merged)}",
            )
            store.save(ticket)
            index.rebuild()
            print(
                f"{ticket['id']}: angenommen, {branch_name} in {ticket.get('base')} gemergt "
                f"({_short(merged)}); Worktree und Branch entfernt"
                + (f"; {len(ended)} Session(s) beendet" if ended else "")
            )
        else:
            base = ticket["base"]
            local_base = git.head(top)
            git.fetch(top)
            remote_base = git.remote_ref(top, "origin", base)
            if remote_base and not git.is_ancestor(top, remote_base, base):
                raise FabError(
                    f"{ticket['id']}: {base} ist nicht fast-forward-fähig zu "
                    f"origin/{base}; nichts gepusht."
                )
            if not remote_base or remote_base != local_base:
                git.push(top, "origin", base)
            git.push(top, "origin", branch_name)
            url = git.gh_pr_url(repo, branch_name) or git.gh_pr_create(
                repo,
                f"{ticket['id']}: {ticket['title']}",
                _pr_body(ticket, branch_name),
                base,
                branch_name,
            )
            ticket["pr"] = {"url": url, "state": "open"}
            _add_comment(ticket, "mensch", f"PR geöffnet: {url}")
            events.append("pr", ticket["id"], "mensch", "", f"PR geöffnet: {url}")
            store.save(ticket)
            index.rebuild()
            if args.pr_only:
                print(f"{ticket['id']}: PR geöffnet: {url}")
                return 0
            try:
                git.gh_pr_merge(repo, url)
                git.fetch(top)
                git.merge_ff_only(top, f"origin/{base}")
                merged = git.head(top)
                report = preview.check_mods(top)
                if not report["ok"]:
                    git.revert(top, merged)
                    git.push(top, "origin", base)
                    _accept_check_failed(ticket, report)
                    store.save(ticket)
                    index.rebuild()
                    raise store.PersistError(
                        f"{ticket['id']}: herdr-app check rot; Merge "
                        f"{_short(merged)} als Revert nach origin/{base} gepusht"
                    )
                git.push_delete(top, "origin", branch_name)
                ended = _end_sessions(ticket)
                git.remove_worktree(top, worktree)
                git.delete_branch(top, branch_name)
                ticket["status"] = "done"
                ticket.pop("stall", None)
                ticket["waiting"] = []
                ticket["pr"] = {"url": url, "state": "merged"}
                _add_comment(ticket, "mensch", f"PR gemergt: {url}")
                events.append(
                    "accept", ticket["id"], "mensch", "",
                    f"{branch_name} → {base} via PR {url} @ {_short(merged)}",
                )
                store.save(ticket)
                index.rebuild()
                print(
                    f"{ticket['id']}: angenommen, {branch_name} über PR {url} in {base} "
                    f"gemergt ({_short(merged)}); Worktree und Branch entfernt"
                    + (f"; {len(ended)} Session(s) beendet" if ended else "")
                )
            except store.PersistError:
                raise
            except FabError as exc:
                _pr_failure(ticket, str(exc), url)
                failure = exc
    if failure is not None:
        raise failure
    _autostart(_unblocked_by(ticket["id"]))
    return 0


def cmd_reject(args):
    feedback = (args.feedback or "").strip()
    if not feedback:
        raise FabError("Das Feedback ist leer")
    roster = agents.load()
    with store.locked():
        ticket = store.load(args.id)
        if ticket["status"] != "review":
            raise FabError(
                f"{ticket['id']}: Zurückweisen nur im Status review (jetzt {ticket['status']})"
            )
        ticket["status"] = "doing"
        ticket.pop("stall", None)
        _add_comment(ticket, "mensch", feedback)
        assignee = ticket.get("assignee")
        results = []
        if assignee:
            results = wake.process(
                ticket,
                [assignee],
                "mensch",
                feedback,
                roster,
                message_for=lambda name: (
                    f"Ticket {ticket['id']} „{ticket['title']}“: Zurückgewiesen von mensch: "
                    f"„{feedback[:300]}“. Lies `fab show {ticket['id']}`, arbeite weiter, "
                    f"dann `fab verify {ticket['id']}` und erneut `fab handover`."
                ),
            )
        events.append("reject", ticket["id"], "mensch", "", feedback)
        store.save(ticket)
        index.rebuild()
    _print_wake_results(results)
    print(f"{ticket['id']}: zurückgewiesen, Status doing")
    return 0


def cmd_drop(args):
    actor = _require_actor(args)
    reason = (args.reason or "").strip()
    if not reason:
        raise FabError("Der Grund ist leer")
    with store.locked():
        ticket = store.load(args.id)
        if ticket["status"] == "done":
            raise FabError(f"{ticket['id']} ist fertig und kann nicht verworfen werden")
        ticket["status"] = "dropped"
        ticket.pop("stall", None)
        ticket["waiting"] = []
        _add_comment(ticket, actor, reason)
        ended = _end_sessions(ticket)
        events.append("drop", ticket["id"], actor, "", reason)
        store.save(ticket)
        index.rebuild()
    print(
        f"{ticket['id']}: verworfen"
        + (f"; {len(ended)} Session(s) beendet" if ended else "")
        + "; der Worktree bleibt"
    )
    return 0


def cmd_wake(args):
    actor = _require_actor(args)
    roster = agents.load()
    text = (args.text or "").strip() or "manuell geweckt"
    attempt = 2 if args.retry else 1
    if args.retry:
        time.sleep(wake.retry_delay())
    with store.locked():
        ticket = store.load(args.id)
        results = wake.process(
            ticket, [args.name.lower()], actor, text, roster,
            attempt=attempt, direct=args.retry,
        )
        if any(
            line.split(" (")[0] in ("geweckt", "gestartet", "an orchestrator")
            for _name, line in results
        ):
            ticket.pop("stall", None)
        store.save(ticket)
        index.rebuild()
    _print_wake_results(results)
    return 0


def cmd_tick(args):
    if args.install or args.uninstall:
        if args.dry_run:
            raise FabError("--dry-run gilt nur für den Prüflauf, nicht für launchd")
        if args.install:
            path, ok, detail = tick.install()
            print(f"launchd-Auftrag installiert: {path}")
            if "/worktrees/" in tick.program_path():
                print(
                    "Hinweis: der Auftrag zeigt auf einen Worktree; für den "
                    "Dauerbetrieb aus dem Haupt-Checkout installieren."
                )
            if not ok:
                print(f"Hinweis: launchctl bootstrap: {detail}")
        else:
            path, ok, detail = tick.uninstall()
            print(f"launchd-Auftrag entfernt: {path}")
            if not ok:
                print(f"Hinweis: launchctl bootout: {detail}")
        return 0
    roster = agents.load(required=False)
    with store.locked():
        result = tick.run(roster, dry=args.dry_run)
        if result.changed:
            index.rebuild()
    for line in result:
        print(line)
    if not result:
        print("Keine Aktion.")
    return 0


def _resolve_team(roster, raw):
    if raw:
        return teams.team(roster, raw)
    repo = git.main_toplevel(os.getcwd())
    entry = teams.team_for_repo(roster, repo) if repo else None
    entry = entry or teams.first_team(roster)
    if not entry:
        raise FabError("Kein Team im Roster; fab team add …")
    return entry


def _orchestrator_state(roster, team_entry):
    """Zustand des Team-Orchestrators; funktioniert auch ohne laufendes Terminal."""
    team_name = str(team_entry.get("name") or "")
    targets = agents.orchestrator_targets(roster, team_name)
    row = None
    actual = targets[0]
    try:
        rows = hc.ls()
    except HcError:
        rows = []
    for item in rows:
        if item.get("name") in targets and item.get("state") == "live":
            row = item
            actual = item.get("name")
    started = None
    if row is not None:
        for event in reversed(events.read_all()):
            text = event.get("text") or ""
            target = event.get("target") or ""
            if event.get("kind") == "orchestrator" and target in ("", team_name) and (
                text in ("gestartet", "neu gestartet")
                or text.startswith(("gestartet (", "neu gestartet ("))
            ):
                started = event.get("at")
                break
    return {
        "team": team_name,
        "live": row is not None,
        "name": actual,
        "terminal": (row or {}).get("address"),
        "status": (row or {}).get("status"),
        "started_at": started,
    }


def cmd_orchestrator(args):
    roster = agents.load()
    team_entry = _resolve_team(roster, args.team)
    team_name = str(team_entry.get("name") or "")
    targets = agents.orchestrator_targets(roster, team_name)
    if args.action == "status":
        state = _orchestrator_state(roster, team_entry)
        if args.json:
            print(json.dumps(state, ensure_ascii=False, indent=2))
        elif state["live"]:
            print(
                f"Orchestrator {team_name} läuft ({state['terminal']}) · "
                f"{state['status'] or 'ohne Status'}"
            )
        else:
            print(f"Orchestrator {team_name} läuft nicht")
        return 0
    if args.action == "restart":
        actor = _require_actor(args)
        with store.locked():
            try:
                live = hc.live()
            except HcError:
                live = {}
            for target in targets:
                if target in live and not hc.kill(target):
                    raise FabError(
                        f"Orchestrator {team_name} ließ sich nicht beenden "
                        f"(hc kill {target})"
                    )
            started = agents.start_orchestrator(roster, team_name)
            warning = started.get("warning")
            text = "neu gestartet"
            if warning:
                text += f" ({warning})"
            events.append("orchestrator", "", actor, team_name, text)
            events.append("config", "", actor, "", f"Orchestrator {team_name} neu gestartet")
            index.rebuild()
        print(f"Orchestrator {team_name} neu gestartet ({started['name']})")
        if warning:
            print(warning)
        return 0
    with store.locked():
        if args.action == "start":
            live_name, _row = agents.live_orchestrator(roster, team_name)
            if live_name:
                raise FabError(f"Orchestrator läuft schon ({live_name})")
            started = agents.start_orchestrator(roster, team_name)
            warning = started.get("warning")
            text = "gestartet"
            if warning:
                text += f" ({warning})"
            events.append("orchestrator", "", "fab", team_name, text)
            index.rebuild()
            print(f"Orchestrator {team_name} gestartet ({started['name']})")
            if warning:
                print(warning)
            return 0
        if args.action == "stop":
            live_name, _row = agents.live_orchestrator(roster, team_name)
            if not live_name:
                print(f"Orchestrator {team_name} läuft nicht")
                return 0
            hc.kill(live_name)
            events.append("orchestrator", "", "fab", team_name, "beendet")
            index.rebuild()
            print(f"Orchestrator {team_name} beendet")
            return 0
    return 0


def cmd_agents(args):
    roster = agents.load()
    live = hc.live()
    running = agents.running(live)
    sessions = []
    for ticket in store.all_tickets():
        merged = {}
        for session in ticket.get("sessions") or []:
            key = session.get("name") or session.get("terminal")
            if not key:
                continue
            previous = merged.get(key)
            if (
                previous is None
                or (session.get("started_at") or 0)
                >= (previous.get("started_at") or 0)
            ):
                merged[key] = session
        for session in merged.values():
            name = session.get("name") or ""
            sessions.append(
                {
                    "ticket": ticket["id"],
                    "agent": session.get("agent"),
                    "name": name,
                    "terminal": session.get("terminal"),
                    "live": name in live,
                    "status": agents.status(live.get(name)),
                }
            )
    known = {session["name"] for session in sessions}
    for name, row in sorted(running.items()):
        if name not in known:
            labels = row.get("labels") if isinstance(row.get("labels"), dict) else {}
            agent_name = labels.get("fab.agent")
            if not agent_name:
                for item in roster["agents"]:
                    if (name.startswith(f"fab-{item['name']}-")
                            or f"-{item['name']}-" in name):
                        agent_name = item["name"]
                        break
            sessions.append(
                {
                    "ticket": None,
                    "agent": agent_name,
                    "name": name,
                    "terminal": row.get("address"),
                    "live": True,
                    "status": agents.status(row),
                }
            )
    running_by_agent = {}
    for item in roster["agents"]:
        name = item["name"]
        seen = set()
        rows = running_by_agent.setdefault(name, [])
        for session in sessions:
            if session["agent"] != name or session["name"] not in running:
                continue
            if session["name"] in seen:
                continue
            seen.add(session["name"])
            rows.append(session)
    if args.json:
        first = teams.first_team(roster)
        state = _orchestrator_state(roster, first) if first else {
            "team": None, "live": False, "name": None, "terminal": None,
        }
        payload = {
            "max_sessions": roster["max_sessions"],
            "reviewer": roster["reviewer"],
            "orchestrator": {
                "name": state["name"],
                "team": state["team"],
                "live": state["live"],
                "terminal": state["terminal"],
            },
            "agents": [
                {
                    "name": item["name"],
                    "role": item["role"],
                    "color": item["color"],
                    "teams": list(item.get("teams") or []),
                    "running": running_by_agent[item["name"]],
                }
                for item in roster["agents"]
            ],
            "sessions": [session for session in sessions if session["live"]],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    print(
        f"Roster: {roster['path']} · höchstens {roster['max_sessions']} Sessions · "
        f"Prüferin {roster['reviewer'] or '—'}"
    )
    for item in roster["agents"]:
        mine = [
            session
            for session in sessions
            if session["agent"] == item["name"]
        ]
        state = "läuft nicht"
        if mine:
            state = ", ".join(
                f"{session['name']} ({session['terminal']}, "
                f"{session['ticket'] or '—'}"
                + (
                    f", {session['status'] or 'ohne Status'})"
                    if session["live"]
                    else ") · beendet"
                )
                for session in mine
            )
        teams_text = ", ".join(item.get("teams") or []) or "—"
        print(
            f"{item['name']:<10} {item['role']:<10} {item['color']:<4} {state}"
            f" · Teams: {teams_text}"
        )
    first = teams.first_team(roster)
    state = _orchestrator_state(roster, first) if first else {"live": False, "terminal": None}
    print(
        "Orchestrator: "
        + (
            f"läuft ({state['terminal']})"
            if state["live"]
            else "läuft nicht"
        )
    )
    return 0


def cmd_inbox(args):
    with store.locked():
        payload = index.rebuild()
    if args.team:
        roster = agents.load()
        teams.team(roster, args.team)
        tickets = {ticket["id"]: ticket for ticket in store.all_tickets()}

        def keep(item):
            ticket = tickets.get(item.get("ticket"))
            if ticket is None:
                return False
            entry = _ticket_team(ticket, roster)
            return entry is not None and entry.get("name") == args.team

        payload = dict(payload)
        payload["inbox"] = [item for item in payload["inbox"] if keep(item)]
    if args.json:
        print(json.dumps(payload["inbox"], ensure_ascii=False, indent=2))
    elif not payload["inbox"]:
        print("Inbox ist leer")
    else:
        for item in payload["inbox"]:
            print(render.inbox_line(item))
    return 0


def cmd_index(args):
    with store.locked():
        payload = index.rebuild()
    print(
        f"{store.index_path()}: {len(payload['tickets'])} Tickets, "
        f"{len(payload['inbox'])} Inbox-Einträge, {len(payload['events'])} Ereignisse"
    )
    return 0


_MIGRATE_LABELS = (
    ("tickets", "Tickets"),
    ("comments", "Kommentare"),
    ("sessions", "Sessions"),
    ("events", "Ereignisse"),
    ("attachments", "Anhänge"),
    ("counter", "Zähler"),
)


def _migrate_text(report):
    status = report.get("status")
    if status == "empty":
        return "Keine Altdaten: nichts zu migrieren."
    if status == "already":
        return f"Datenbank ist aktuell: {report.get('db')}"
    if status == "failed":
        return (
            f"Migration fehlgeschlagen: {report.get('error') or 'unbekannter Fehler'}; "
            f"Altdaten bleiben unverändert unter {report.get('legacy')}"
        )
    old = report.get("old") or {}
    new = report.get("new") or {}
    lines = [f"Datenbank: {report.get('db')}"]
    lines.append(f"Altdaten nach {report.get('legacy')} verschoben:")
    lines.extend(f"  - {path}" for path in report.get("moved") or [])
    lines.append("Übernommen:")
    for key, label in _MIGRATE_LABELS:
        lines.append(f"  {label}: {old.get(key, 0)} → {new.get(key, 0)}")
    if report.get("skipped_events"):
        lines.append(f"  Übersprungene Ereignisse: {report['skipped_events']}")
    return "\n".join(lines)


def cmd_migrate(args):
    report = store.migrate()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(_migrate_text(report))
    return 1 if report.get("status") == "failed" else 0


def cmd_backup(args):
    path = store.backup()
    if not path:
        raise FabError(
            "Keine Datenbank vorhanden; vorher `fab migrate` ausführen"
        )
    files = store.backup_files()
    if args.json:
        print(
            json.dumps(
                {"path": path, "retained": len(files), "backups": files},
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"{path} · {len(files)} Sicherungen aufbewahrt")
    return 0


# ---------------------------------------------------------------- Pflege (3b)

def cmd_roster(args):
    payload = config.payload()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    print(
        f"Roster: {payload['path']} · höchstens {payload['max_sessions']} Sessions · "
        f"Prüfer {payload['reviewer'] or '—'}"
    )
    for item in payload["agents"]:
        sessions = ", ".join(
            f"{row['name']} ({row['terminal']}, {row['status'] or 'ohne Status'})"
            for row in item["sessions"]
        ) or "läuft nicht"
        program = item["program"] or "—"
        if item["model"]:
            program = f"{program} ({item['model']})"
        print(
            f"{item['name']:<10} {item['role']:<10} {item['color']:<4} "
            f"{program:<28} offen {item['open_tickets']} · {sessions}"
        )
    argv = payload["orchestrator"]["argv"]
    print("Orchestrator: " + (" ".join(argv) if argv else "kein Programm"))
    return 0


def cmd_agent(args):
    actor = _require_actor(args)
    with store.locked():
        if args.action == "add":
            entry = config.add(
                args.name,
                args.role,
                args.color,
                args.argv_json,
                args.prompt_text,
                actor,
            )
            print(
                f"Agent „{entry['name']}“ angelegt: Rolle {entry['role']}, "
                f"Farbe {entry['color']}, Prompt {entry['prompt']}"
            )
            return 0
        if args.action == "edit":
            print(
                config.edit(
                    args.name,
                    rename=args.rename,
                    role=args.role,
                    color=args.color,
                    argv_json=args.argv_json,
                    prompt_text=args.prompt_text,
                    actor=actor,
                )
            )
            return 0
        rel = config.remove(args.name, actor)
    print(f"Agent „{args.name}“ entfernt; Prompt {rel} bleibt erhalten")
    return 0


def cmd_blueprint(args):
    if args.action == "list":
        payload = config.payload()
        rows = payload["blueprints"]
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return 0
        for row in rows:
            program, model, _flags = agents.split_argv(row["argv"])
            teams = ", ".join(row["teams"]) or "—"
            print(
                f"{row['name']}  {row['role']}  {row['color']}  "
                f"{program or '—'} ({model or '—'})  Teams: {teams}"
            )
        return 0
    actor = _require_actor(args)
    with store.locked():
        if args.action == "add":
            entry = config.add_blueprint(
                args.name,
                args.role,
                args.color,
                args.argv_json,
                args.prompt_text,
                actor,
            )
            print(
                f"Blaupause „{entry['name']}“ angelegt: Rolle {entry['role']}, "
                f"Farbe {entry['color']}, Prompt {entry['prompt']}"
            )
            return 0
        if args.action == "edit":
            print(
                config.edit_blueprint(
                    args.name,
                    rename=args.rename,
                    role=args.role,
                    color=args.color,
                    argv_json=args.argv_json,
                    prompt_text=args.prompt_text,
                    actor=actor,
                )
            )
            return 0
        rel = config.remove_blueprint(args.name, actor)
    print(f"Blaupause „{args.name}“ entfernt; Prompt {rel} bleibt erhalten")
    return 0


def cmd_team(args):
    if args.action == "list":
        payload = config.payload()
        rows = payload["teams"]
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return 0
        for row in rows:
            repos = ", ".join(row["repos"]) or "—"
            members = ", ".join(
                str(member.get("blueprint") or "")
                for member in row["members"]
                if isinstance(member, dict)
            ) or "—"
            overrides = []
            for member in row["members"]:
                if not isinstance(member, dict):
                    continue
                marks = []
                if member.get("model"):
                    marks.append(f"model={member['model']}")
                if member.get("max_cost") is not None:
                    marks.append(f"max-cost={member['max_cost']}")
                if marks:
                    overrides.append(
                        f"{member.get('blueprint')}: {', '.join(marks)}"
                    )
            line = (
                f"{row['name']}  Prüfer {row['reviewer'] or '—'} · "
                f"{row['max_sessions']} Sessions · {repos} · Mitglieder {members}"
            )
            if overrides:
                line += " · Übersteuerungen " + "; ".join(overrides)
            print(line)
        return 0
    actor = _require_actor(args)
    with store.locked():
        if args.action == "add":
            entry = config.add_team(
                args.name,
                args.repo,
                args.members_json,
                orchestrator_argv_json=args.orchestrator_argv_json,
                orchestrator_prompt=args.orchestrator_prompt,
                reviewer=args.reviewer,
                max_sessions=args.max_sessions,
                actor=actor,
            )
            members = ", ".join(
                str(member.get("blueprint") or "")
                for member in entry.get("members") or []
                if isinstance(member, dict)
            )
            print(
                f"Team „{entry['name']}“ angelegt: {len(entry.get('repos') or [])} "
                f"Repo(s), Mitglieder {members}, Prüfer {entry.get('reviewer')}, "
                f"max_sessions {entry.get('max_sessions')}"
            )
            return 0
        if args.action == "edit":
            print(
                config.edit_team(
                    args.name,
                    rename=args.rename,
                    repos=args.repo,
                    members_json=args.members_json,
                    orchestrator_argv_json=args.orchestrator_argv_json,
                    orchestrator_prompt=args.orchestrator_prompt,
                    reviewer=args.reviewer,
                    max_sessions=args.max_sessions,
                    actor=actor,
                )
            )
            return 0
        config.remove_team(args.name, actor)
    print(f"Team „{args.name}“ entfernt")
    return 0


def cmd_settings(args):
    actor = _require_actor(args)
    with store.locked():
        text = config.set_setting(args.key, args.value, actor, team=args.team)
    print(text)
    return 0


def cmd_prompt(args):
    roster = agents.load()
    if args.action == "list":
        rows = prompts.entries(roster)
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return 0
        for row in rows:
            marks = ", ".join("{" + name + "}" for name in row["placeholders"]) or "—"
            print(f"{row['kind']:<12} {row['name']:<12} {row['bytes']:>7} B  {row['path']}")
            print(f"    Platzhalter: {marks}")
        return 0
    if args.action == "show":
        sys.stdout.write(prompts.show(roster, args.name, args.team))
        return 0
    actor = _require_actor(args)
    with store.locked():
        path, size, unknown = prompts.save(
            roster, args.name, args.text, actor, args.team
        )
    if unknown:
        known = ", ".join("{" + name + "}" for name in prompts.KNOWN)
        print(
            f"Warnung: unbekannte Platzhalter in „{args.name}“: "
            + ", ".join("{" + name + "}" for name in unknown)
            + f"; bekannt sind: {known}",
            file=sys.stderr,
        )
    print(f"Prompt „{args.name}“ gespeichert ({size} Bytes): {path}")
    return 0


def cmd_repos(args):
    rows = repos.known(args.add or ())
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0
    if not rows:
        print("Keine bekannten Repos")
        return 0
    for row in rows:
        marks = []
        if row["verify_exists"]:
            marks.append("Prüfskript")
        if row["lessons_exists"]:
            marks.append("Lernnotizen")
        print(
            f"{row['path']} · {row['branch'] or '—'} · "
            f"offen {row['open_tickets']} · "
            f"{', '.join(marks) if marks else 'keine .fabric-Dateien'}"
        )
    return 0


def cmd_repo(args):
    if args.action == "show":
        data = repos.show(args.path)
        if args.json:
            print(json.dumps(data, ensure_ascii=False, indent=2))
            return 0
        print(f"{data['path']} · {data['branch'] or '—'}")
        for key, label in (("verify", "Prüfskript"), ("lessons", "Lernnotizen")):
            state = "vorhanden" if data[key]["exists"] else "fehlt"
            print(f"{label}: {state}")
        return 0
    if args.action == "test":
        result = repos.test(args.path)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        print(f"Prüfskript: Exit {result['exit']}")
        if result["tail"]:
            print(result["tail"])
        return 0
    actor = _require_actor(args)
    with store.locked():
        target = repos.set_file(args.path, args.kind, args.text, actor)
    print(f"{target} gespeichert")
    return 0


def _git_value(*args):
    result = git.git(list(args), agents.FABRIC_DIR)
    return result.stdout.strip() if result.returncode == 0 else ""


def cmd_version(args):
    try:
        head = _git_value("rev-parse", "--short", "HEAD")
        date = _git_value("log", "-1", "--format=%cs")
    except FabError:
        head, date = "", ""
    print(f"fab {date or 'unbekannt'} · {head or 'ohne Git'}")
    return 0


# ---------------------------------------------------------------- Parser

_TRANSLATIONS = (
    (r"the following arguments are required: (.+)", r"fehlende Argumente: \1"),
    (r"unrecognized arguments: (.+)", r"unbekannte Argumente: \1"),
    (r"expected one argument", "erwartet einen Wert"),
    (r"expected at least one argument", "erwartet mindestens einen Wert"),
    (r"invalid choice: (.+?) \(choose from (.+)\)", r"ungültige Auswahl: \1 (erlaubt: \2)"),
    (r"argument (.+?): ", r"Argument \1: "),
)


class GermanParser(argparse.ArgumentParser):
    def error(self, message):
        text = message
        for pattern, replacement in _TRANSLATIONS:
            text = re.sub(pattern, replacement, text)
        self.print_usage(sys.stderr)
        print(f"Fehler: {text}", file=sys.stderr)
        raise SystemExit(2)


def build_parser():
    parser = GermanParser(
        prog="fab",
        description="Tickets, Agenten und Wecken für die Agentic Software Fabric.",
    )
    sub = parser.add_subparsers(dest="command", metavar="BEFEHL", required=True)

    def command(name, help_text, function):
        item = sub.add_parser(name, help=help_text, description=help_text)
        item.set_defaults(func=function)
        return item

    item = command("new", "Ticket aus einem Satz anlegen und den Orchestrator wecken", cmd_new)
    item.add_argument("sentence", metavar="SATZ", help="der Auftrag in einem Satz")
    item.add_argument("--repo", metavar="PFAD", help="Checkout, Standard: Git-Wurzel des aktuellen Ordners")
    item.add_argument("--parent", metavar="ID", help="Eltern-Ticket; das Unter-Ticket erbt dessen Repo")
    item.add_argument("--from", dest="from_", metavar="NAME", default="mensch", help="Autor (Standard: mensch)")
    item.add_argument("--no-wake", action="store_true",
                      help="nur den Entwurf anlegen, ohne @orchestrator-Kommentar")

    item = command("list", "Tickets auflisten", cmd_list)
    item.add_argument("--status", metavar="S", help="nur dieser Status")
    item.add_argument("--team", metavar="NAME", help="nur Tickets dieses Teams")
    item.add_argument("--tree", action="store_true",
                      help="Unter-Tickets unter ihrem Eltern-Ticket einrücken")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("show", "Ein Ticket mit Verlauf zeigen", cmd_show)
    item.add_argument("id", metavar="ID", help="Ticket-ID, z. B. T-1")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("diff", "Änderungen des Tickets gegenüber der Basis zeigen", cmd_diff)
    item.add_argument("id", metavar="ID", help="Ticket-ID, z. B. T-1")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    item.add_argument("--file", metavar="PFAD", help="nur diese Datei zeigen")

    item = command("edit", "Titel, Body, Repo oder Basis eines Tickets ändern", cmd_edit)
    item.add_argument("id", metavar="ID")
    item.add_argument("--title", metavar="T")
    body = item.add_mutually_exclusive_group()
    body.add_argument("--body", metavar="T")
    body.add_argument("--body-file", metavar="F")
    item.add_argument("--repo", metavar="PFAD")
    item.add_argument("--base", metavar="B")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True, help="wer ändert")

    item = command(
        "status",
        "Status eines Tickets setzen (done über accept, dropped über drop)",
        cmd_status,
    )
    item.add_argument("id", metavar="ID")
    item.add_argument("status", metavar="STATUS", help="draft, todo, doing oder review")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("assign", "Zuständigen aus dem Roster setzen", cmd_assign)
    item.add_argument("id", metavar="ID")
    item.add_argument("name", metavar="NAME", help="Roster-Name")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("link", "Abhängigkeiten eintragen oder entfernen", cmd_link)
    item.add_argument("id", metavar="ID")
    direction = item.add_mutually_exclusive_group(required=True)
    direction.add_argument("--blocked-by", nargs="+", metavar="ID",
                           help="ein oder mehrere Tickets")
    direction.add_argument("--remove", nargs="+", metavar="ID",
                           help="Abhängigkeiten entfernen")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("comment", "Kommentar schreiben; @name weckt", cmd_comment)
    item.add_argument("id", metavar="ID")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)
    item.add_argument("--no-wake", action="store_true", help="niemanden wecken")
    item.add_argument("text", metavar="TEXT")

    item = command("attach", "Bild als Anhang an ein Ticket hängen", cmd_attach)
    item.add_argument("id", metavar="ID")
    item.add_argument("datei", metavar="DATEI",
                      help="Bilddatei (.png, .jpg, .jpeg, .gif, .webp)")
    item.add_argument("--no-edit", action="store_true", help="Body nicht ergänzen")
    item.add_argument("--from", dest="from_", metavar="NAME", default="mensch",
                      help="Autor (Standard: mensch)")

    item = command(
        "preview",
        "Vorschau-Instanz je Worktree: eigenes Home, eigener Core, Screenshot",
        cmd_preview,
    )
    preview_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    start = preview_sub.add_parser("start", help="Vorschau starten",
                                   description="Vorschau starten")
    start.add_argument("id", metavar="ID")
    shot = preview_sub.add_parser("shot", help="Screenshot der Vorschau anhängen",
                                  description="Screenshot der Vorschau anhängen")
    shot.add_argument("id", metavar="ID")
    shot.add_argument("--from", dest="from_", metavar="NAME",
                      help="Autor (Standard: Zuständiger oder mensch)")
    stop = preview_sub.add_parser("stop", help="Vorschau beenden und entfernen",
                                  description="Vorschau beenden und entfernen")
    stop.add_argument("id", metavar="ID")

    item = command("dispatch", "Branch und Worktree anlegen und den Agenten starten", cmd_dispatch)
    item.add_argument("id", metavar="ID")
    item.add_argument("--agent", metavar="NAME", help="Roster-Name, Standard: Zuständiger")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("verify", "Prüfskript im Worktree ausführen und checks setzen", cmd_verify)
    item.add_argument("id", metavar="ID")
    item.add_argument("--from", dest="from_", metavar="NAME",
                      help="Akteur des Ereignisses, Standard: Zuständiger")

    item = command("verdict", "Urteil des Prüfers auf den HEAD schreiben", cmd_verdict)
    item.add_argument("id", metavar="ID")
    item.add_argument("state", metavar="URTEIL", choices=("pass", "fail"))
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)
    item.add_argument("summary", metavar="ZUSAMMENFASSUNG")

    item = command("handover", "An den Menschen übergeben (Gates: checks und Urteil)", cmd_handover)
    item.add_argument("id", metavar="ID")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)
    item.add_argument("summary", metavar="ZUSAMMENFASSUNG")

    item = command("accept", "Abnahme durch den Menschen: per PR oder lokal mergen, aufräumen, done", cmd_accept)
    item.add_argument("id", metavar="ID")
    item.add_argument("--pr-only", action="store_true",
                      help="nur GitHub-PR öffnen, nicht mergen (Status bleibt review)")

    item = command("reject", "Als Mensch zurückweisen mit Feedback", cmd_reject)
    item.add_argument("id", metavar="ID")
    item.add_argument("feedback", metavar="FEEDBACK")

    item = command("drop", "Ticket verwerfen; Sessions beenden, Worktree bleibt", cmd_drop)
    item.add_argument("id", metavar="ID")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)
    item.add_argument("reason", metavar="GRUND")

    item = command("wake", "Wecken von Hand, gleiche Regeln wie bei Erwähnungen", cmd_wake)
    item.add_argument("id", metavar="ID")
    item.add_argument("name", metavar="NAME")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)
    item.add_argument("--retry", action="store_true", help=argparse.SUPPRESS)
    item.add_argument("text", metavar="TEXT", nargs="?", default=None)

    item = command("orchestrator", "Team-Orchestrator starten, beenden, prüfen", cmd_orchestrator)
    item.add_argument("action", metavar="AKTION", choices=("start", "stop", "status", "restart"))
    item.add_argument("team", metavar="TEAM", nargs="?",
                      help="Team; Standard: Team des aktuellen Checkouts, sonst das erste")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe bei status")
    item.add_argument("--from", dest="from_", metavar="NAME",
                      help="wer neu startet (Pflicht bei restart)")

    item = command("agents", "Roster und laufende Sessions zeigen", cmd_agents)
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("inbox", "Was auf den Menschen wartet", cmd_inbox)
    item.add_argument("--team", metavar="NAME", help="nur Inbox-Einträge dieses Teams")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("roster", "Kompletten Roster mit abgeleiteten Feldern zeigen", cmd_roster)
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("agent", "Agenten anlegen, ändern und entfernen", cmd_agent)
    agent_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    add = agent_sub.add_parser("add", help="Agent anlegen", description="Agent anlegen")
    add.add_argument("name", metavar="NAME")
    add.add_argument("--role", metavar="R", required=True, help="Rolle, z. B. recherche")
    add.add_argument("--color", metavar="cN", help="c1–c6, sonst die nächste freie")
    add.add_argument("--argv-json", metavar="JSON", required=True,
                     help='Startbefehl als JSON-Liste, z. B. ["omp"]')
    add.add_argument("--prompt-text", metavar="T", help="Rollenprompt; sonst kurze Vorlage")
    add.add_argument("--from", dest="from_", metavar="NAME", required=True)

    edit = agent_sub.add_parser("edit", help="Agent ändern", description="Agent ändern")
    edit.add_argument("name", metavar="NAME")
    edit.add_argument("--rename", metavar="NEU", help="neuer Name (nur wenn frei)")
    edit.add_argument("--role", metavar="R")
    edit.add_argument("--color", metavar="cN")
    edit.add_argument("--argv-json", metavar="JSON")
    edit.add_argument("--prompt-text", metavar="T")
    edit.add_argument("--from", dest="from_", metavar="NAME", required=True)

    remove = agent_sub.add_parser("rm", help="Agent entfernen", description="Agent entfernen")
    remove.add_argument("name", metavar="NAME")
    remove.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("blueprint", "Blaupausen anlegen, ändern und entfernen", cmd_blueprint)
    blueprint_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    listing = blueprint_sub.add_parser("list", help="Blaupausen auflisten",
                                       description="Blaupausen auflisten")
    listing.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    add = blueprint_sub.add_parser("add", help="Blaupause anlegen",
                                   description="Blaupause anlegen")
    add.add_argument("name", metavar="NAME")
    add.add_argument("--role", metavar="R", required=True, help="Rolle, z. B. recherche")
    add.add_argument("--color", metavar="cN", help="c1–c6, sonst die nächste freie")
    add.add_argument("--argv-json", metavar="JSON", required=True,
                     help='Startbefehl als JSON-Liste, z. B. ["omp"]')
    add.add_argument("--prompt-text", metavar="T", help="Rollenprompt; sonst kurze Vorlage")
    add.add_argument("--from", dest="from_", metavar="NAME", required=True)

    edit = blueprint_sub.add_parser("edit", help="Blaupause ändern",
                                    description="Blaupause ändern")
    edit.add_argument("name", metavar="NAME")
    edit.add_argument("--rename", metavar="NEU", help="neuer Name (nur wenn frei)")
    edit.add_argument("--role", metavar="R")
    edit.add_argument("--color", metavar="cN")
    edit.add_argument("--argv-json", metavar="JSON")
    edit.add_argument("--prompt-text", metavar="T")
    edit.add_argument("--from", dest="from_", metavar="NAME", required=True)

    remove = blueprint_sub.add_parser("rm", help="Blaupause entfernen",
                                      description="Blaupause entfernen")
    remove.add_argument("name", metavar="NAME")
    remove.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("team", "Teams anlegen, ändern und entfernen", cmd_team)
    team_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    listing = team_sub.add_parser("list", help="Teams auflisten",
                                  description="Teams auflisten")
    listing.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    add = team_sub.add_parser("add", help="Team anlegen", description="Team anlegen")
    add.add_argument("name", metavar="NAME")
    add.add_argument("--repo", metavar="PFAD", nargs="+", action="extend",
                     required=True, help="Checkout-Pfade, mindestens einer")
    add.add_argument("--members-json", metavar="JSON", required=True,
                     help='Mitglieder als JSON, z. B. [{"blueprint": "zap"}]')
    add.add_argument("--reviewer", metavar="NAME", required=True, help="Prüfer im Team")
    add.add_argument("--max-sessions", metavar="N")
    add.add_argument("--orchestrator-argv-json", metavar="JSON")
    add.add_argument("--orchestrator-prompt", metavar="PFAD")
    add.add_argument("--from", dest="from_", metavar="NAME", required=True)

    edit = team_sub.add_parser("edit", help="Team ändern", description="Team ändern")
    edit.add_argument("name", metavar="NAME")
    edit.add_argument("--rename", metavar="NEU", help="neuer Name (nur wenn frei)")
    edit.add_argument("--repo", metavar="PFAD", nargs="+", action="extend",
                      help="neue Repo-Liste")
    edit.add_argument("--members-json", metavar="JSON")
    edit.add_argument("--reviewer", metavar="NAME")
    edit.add_argument("--max-sessions", metavar="N")
    edit.add_argument("--orchestrator-argv-json", metavar="JSON")
    edit.add_argument("--orchestrator-prompt", metavar="PFAD")
    edit.add_argument("--from", dest="from_", metavar="NAME", required=True)

    remove = team_sub.add_parser("rm", help="Team entfernen", description="Team entfernen")
    remove.add_argument("name", metavar="NAME")
    remove.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("tick", "Stillstand prüfen, wecken oder melden", cmd_tick)
    item.add_argument("--dry-run", action="store_true",
                      help="nur zeigen, nichts schreiben und niemanden wecken")
    launchd = item.add_mutually_exclusive_group()
    launchd.add_argument("--install", action="store_true",
                         help="launchd-Auftrag (alle 60 s) installieren")
    launchd.add_argument("--uninstall", action="store_true",
                         help="launchd-Auftrag entfernen")

    item = command("settings", "Einstellungen des Rosters setzen", cmd_settings)
    settings_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    set_item = settings_sub.add_parser("set", help="Einstellung setzen",
                                       description="Einstellung setzen")
    set_item.add_argument("key", metavar="SCHLÜSSEL",
                          help="max_sessions, reviewer, orchestrator_argv, "
                               "max_sessions_total, tick_*_minutes oder "
                               "orchestrator_dispatches/orchestrator_idle_minutes")
    set_item.add_argument("value", metavar="WERT")
    set_item.add_argument("--team", metavar="NAME",
                          help="Team für orchestrator_dispatches/idle_minutes")
    set_item.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("prompt", "Prompts auflisten, zeigen und speichern", cmd_prompt)
    prompt_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    listing = prompt_sub.add_parser("list", help="Prompts auflisten",
                                    description="Prompts auflisten")
    listing.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    show_item = prompt_sub.add_parser("show", help="Prompt roh ausgeben",
                                      description="Prompt roh ausgeben")
    show_item.add_argument("name", metavar="NAME",
                           help="orchestrator, preamble oder Agentenname")
    show_item.add_argument("--team", metavar="NAME",
                           help="Team für den Orchestrator-Prompt")
    set_prompt = prompt_sub.add_parser("set", help="Prompt speichern",
                                       description="Prompt speichern")
    set_prompt.add_argument("name", metavar="NAME")
    set_prompt.add_argument("--text", metavar="T", required=True)
    set_prompt.add_argument("--team", metavar="NAME",
                            help="Team für den Orchestrator-Prompt")
    set_prompt.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("repos", "Bekannte Repos zeigen", cmd_repos)
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    item.add_argument("--add", nargs="+", metavar="PFAD",
                      help="weitere Ordner, die Git-Wurzeln sind")

    item = command("repo", "Repo-Dateien zeigen, schreiben und testen", cmd_repo)
    repo_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    show_repo = repo_sub.add_parser("show", help="Repo-Dateien zeigen",
                                    description="Repo-Dateien zeigen")
    show_repo.add_argument("path", metavar="PFAD")
    show_repo.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    set_repo = repo_sub.add_parser("set", help="Repo-Datei schreiben",
                                   description="Repo-Datei schreiben")
    set_repo.add_argument("path", metavar="PFAD")
    set_repo.add_argument("kind", metavar="DATEI", choices=("verify", "lessons"))
    set_repo.add_argument("--text", metavar="T", required=True)
    set_repo.add_argument("--from", dest="from_", metavar="NAME", required=True)
    test_repo = repo_sub.add_parser("test", help="Prüfskript ausführen",
                                    description="Prüfskript ausführen")
    test_repo.add_argument("path", metavar="PFAD")
    test_repo.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    command("version", "Version und Git-HEAD des Fabric-Codes", cmd_version)
    command("index", "index.json neu erzeugen", cmd_index)
    item = command("migrate", "Altdaten in die SQLite-Datenbank übernehmen", cmd_migrate)
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    item = command("backup", "Datenbank nach data/fabric/backups sichern", cmd_backup)
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    return parser


def _normalize_argv(argv):
    """`fab wake ID NAME --from X "<text>"`: der optionale Text steht hinter Optionen,
    die argparse sonst nicht mehr mit dem optionalen Positional verbindet.

    Optionen kommen nach vorn, die Positionals danach, ein `--` mit allem
    Folgenden bleibt am Ende stehen. Nur so nimmt argparse einen Text mit
    führendem `-` (`-- "-wichtig"`, `-- "---"`) als Positional an: stünde der
    Text vor `--from`, verbrauchte ihn `nargs="?"` schon vor dem `--` und der
    Rest landete in „unbekannte Argumente“.
    """
    if not argv or argv[0] != "wake":
        return argv
    body, tail = list(argv[1:]), []
    if "--" in body:
        cut = body.index("--")
        body, tail = body[:cut], body[cut:]
    positionals, options, index = [], [], 0
    while index < len(body):
        token = body[index]
        if token == "--from":
            options.extend(body[index:index + 2])
            index += 2
            continue
        if token.startswith("--from=") or token in ("-h", "--help", "--retry"):
            options.append(token)
            index += 1
            continue
        positionals.append(token)
        index += 1
    return ["wake", *options, *positionals, *tail]


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(_normalize_argv(list(argv)))
    try:
        return args.func(args) or 0
    except (FabError, HcError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Abgebrochen.", file=sys.stderr)
        return 130
