"""Kommandozeile `fab`: Befehle aus Abschnitt 3 des Vertrags."""
import argparse
import json
import os
import re
import sys
import tempfile
import time
import unicodedata

from . import (
    agents,
    autopilot,
    config,
    context,
    costs,
    events,
    flows,
    git,
    hc,
    index,
    pipeline,
    preview,
    prompts,
    render,
    repos,
    sessions,
    store,
    teams,
    templates,
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


def _dispatch(ticket, rev, agent_name, actor, roster):
    """Startet oder weckt ein Ticket ohne langen Store-Lock.

    Gibt ein Ergebnis-Dict zurück und schreibt Ticket sowie Ereignis über
    `_commit`. Der Aufrufer hält keine Sperre und sammelt Ereignisse in
    `store.deferred_events()`.
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
    # Beendete Sessions zuerst festhalten: „läuft schon“ gilt nur für eine
    # lebende Session, sonst startet der Lauf unten neu.
    sessions.report([ticket], live)
    terminal = hc.terminal_name(agent_name, ticket["id"], team_name)
    candidates = [terminal]
    if team_name == teams.legacy_team_name(roster):
        candidates.append(hc.terminal_name(agent_name, ticket["id"]))
    running_name = next((name for name in candidates if name in live), None)
    if running_name is not None:
        agents.remember_session(
            ticket, agent_name, running_name, live[running_name].get("address")
        )
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
        rev = _commit(ticket, rev)
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
    rev = _commit(ticket, rev)
    started = agents.start_agent(roster, ticket, agent_name)
    if started["result"] != "gestartet":
        events.append("dispatch", ticket["id"], actor, agent_name,
                      f"Start fehlgeschlagen: {started['result']}")
        rev = _commit(ticket, rev)
        detail = started.get("error") or started["result"]
        raise store.PersistError(
            f"{ticket['id']}: Agent {agent_name} nicht gestartet ({detail}); "
            f"Branch {branch_name} und Worktree {folder} bleiben für einen neuen Versuch"
        )
    ticket["status"] = "doing"
    ticket.pop("stall", None)
    agents.remember_session(
        ticket, agent_name, started["name"], started["terminal"]
    )
    detail = f"{branch_name} · {folder}"
    warning = started.get("warning")
    if warning:
        detail += f" · {warning}"
    events.append("dispatch", ticket["id"], actor, agent_name, detail)
    rev = _commit(ticket, rev)
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
    print(f"{ticket['id']}: {text}", file=sys.stderr)


def _autostart(candidate_ids):
    """Startet Tickets, die durch den Wegfall einer Blockade startbereit sind.

    Ein Fehler beim Start bleibt beim Ticket; der Aufrufer (accept, link) gilt
    trotzdem als erfolgreich.
    """
    roster = agents.load()
    for candidate_id in dict.fromkeys(candidate_ids):
        try:
            ticket = store.load(candidate_id)
        except FabError:
            continue
        rev = _new_rev(ticket)
        try:
            with store.deferred_events():
                status = ticket.get("status")
                if status != "todo":
                    if status == "draft":
                        _autostart_note(ticket, "Status draft")
                        rev = _commit(ticket, rev)
                    continue
                if not ticket.get("assignee"):
                    _autostart_note(ticket, "kein Zuständiger")
                    rev = _commit(ticket, rev)
                    continue
                if not ticket.get("repo"):
                    _autostart_note(ticket, "kein Repo")
                    rev = _commit(ticket, rev)
                    continue
                if not _has_criteria(ticket.get("body")):
                    _autostart_note(ticket, "keine Abnahmekriterien")
                    rev = _commit(ticket, rev)
                    continue
                result = _dispatch(
                    ticket, rev, ticket["assignee"], "fab", roster
                )
        except Exception as exc:
            with store.locked():
                fresh = store.load(candidate_id)
                events.append(
                    "dispatch", fresh["id"], "fab",
                    fresh.get("assignee") or "",
                    f"automatisch nicht gestartet: {exc}",
                )
                store.save(fresh)
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
    """Alle Sessions des Tickets beenden, auch ohne Eintrag unter `## Sessions`.

    Zuerst die vermerkten Terminaladressen und -namen. Danach kommen lebende
    Terminals hinzu, deren `fab.ticket`-Label oder Name
    (`fab-<team>-<agent>-t-<n>`) zum Ticket gehört.
    """
    ended = []
    try:
        live = hc.live()
    except HcError:
        live = {}
    done = set()
    for session in ticket.get("sessions") or []:
        name = (session or {}).get("name")
        for target in dict.fromkeys(
            item for item in ((session or {}).get("terminal"), name) if item
        ):
            if hc.kill(target):
                ended.append(target)
                break
        # Ein toter Eintrag wird nicht noch einmal über den Namen versucht.
        if name:
            done.add(name)
    for name in agents.ticket_terminals(ticket, live):
        if name in done:
            continue
        if hc.kill(name):
            ended.append(name)
    if ticket.get("sessions"):
        ticket["cost"] = costs.collect(ticket)
    return ended


def _print_wake_results(results):
    for name, line in results:
        print(f"@{name}: {line}")


def _new_rev(ticket):
    return store.revision(ticket)


def _conflict(ticket_id, fresh=None):
    stamp = (fresh or {}).get("updated_at")
    return store.PersistError(
        f"{ticket_id}: Ticket wurde während der Arbeit geändert"
        + (f" (updated_at {stamp})" if stamp else "")
        + "; nichts eingetragen"
    )


def _commit(ticket, rev):
    with store.locked():
        fresh = store.load(ticket["id"])
        if store.revision(fresh) != rev:
            raise _conflict(ticket["id"], fresh)
        store.save(ticket)
        store.flush_deferred_events()
        index.rebuild()
        # Der Schlüsselraum nach dem Laden (Defaults) ist maßgeblich: nur so
        # passt die zurückgegebene Revision zu einem späteren Vergleich.
        return store.revision(store.load(ticket["id"]))


def _check_unchanged(ticket, rev):
    with store.locked():
        fresh = store.load(ticket["id"])
        if store.revision(fresh) != rev:
            raise _conflict(ticket["id"], fresh)


def _run_after_commit(ticket, rev, action):
    """Wecken erst nach dem erfolgreichen Commit ausführen.

    Ein CAS-Konflikt hat dann bereits abgebrochen; niemand wird geweckt,
    obwohl nichts eingetragen wurde (Hinweis aus T-94). Kommentare und
    Ereignisse aus dem Wecken werden in einem zweiten Commit nachgezogen.
    """
    if action is None:
        return rev
    action()
    return _commit(ticket, rev)


def _short(value):
    return (value or "—")[:7]


def _lesson_wake_text(ticket, kind, actor, summary):
    """Wecktext an den Orchestrator: eine Lehre vorschlagen lassen."""
    return (
        f"Ticket {ticket['id']} „{ticket['title']}“: {kind} von {actor}: "
        f"„{(summary or '')[:300]}“. Formuliere daraus eine Lehre als einen "
        f"imperativen Satz und schlage sie mit "
        f'`fab lesson propose {ticket["id"]} "…"` vor; der Mensch bestätigt sie im Fenster.'
    )


# ---------------------------------------------------------------- Befehle

def _issue_ticket_body(issue):
    """Ticket-Body aus einem GitHub-Issue: Text und Link."""
    text = (issue.get("body") or "").strip()
    url = (issue.get("url") or "").strip()
    parts = [part for part in (text, f"Issue: {url}" if url else "") if part]
    return "\n\n".join(parts)


def cmd_new(args):
    sentence = " ".join((args.sentence or "").split())
    template_name = (args.template or "").strip()
    issue_number = args.issue
    if template_name and issue_number is not None:
        raise FabError("--template und --issue schließen sich aus")
    if not sentence and issue_number is None:
        raise FabError(
            "Der Satz für das Ticket ist leer; Satz angeben oder --issue N"
        )
    author = _actor(args) or "mensch"
    roster = agents.load(required=False)
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

        issue = None
        title = sentence[:80]
        body = f"## Auftrag\n{sentence}"
        if issue_number is not None:
            git.require_github_issues(repo)
            found = git.gh_issue_view(repo, issue_number)
            state = str(found.get("state") or "").strip()
            if state.upper() != "OPEN":
                raise FabError(
                    f"Issue #{issue_number} ist geschlossen "
                    f"(Status {state or '—'}); Tickets entstehen nur aus offenen Issues"
                )
            number = int(found.get("number") or issue_number)
            issue = {
                "number": number,
                "url": str(found.get("url") or ""),
                "title": str(found.get("title") or ""),
            }
            title = issue["title"]
            body = _issue_ticket_body(found)
        elif template_name:
            body = templates.render(templates.show(template_name), sentence)
            title = sentence[:80]

        tid = store.next_id()
        ticket = store.blank_ticket(tid, title=title, body=body, repo=repo, created_by=author)
        ticket["issue"] = issue
        if parent is not None:
            ticket["parent"] = parent["id"]
        store.save(ticket)
        created_text = sentence or f"#{issue['number']} {issue['title']}"
        events.append("created", tid, author, "", created_text)
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


def _reviewer(roster=None):
    roster = roster if roster is not None else agents.load(required=False)
    return str((roster or {}).get("reviewer") or "ada")


def cmd_show(args):
    ticket = store.load(args.id)
    roster = agents.load(required=False)
    cost = costs.collect(ticket)
    rows = store.event_rows_for(ticket["id"])
    waits = costs.waits(ticket, rows, _reviewer(roster))
    if args.json:
        data = dict(ticket)
        data["cost"] = cost
        data["waits"] = waits
        print(render.ticket_json(data))
    else:
        children = store.children_of(store.all_tickets(), ticket["id"])
        sys.stdout.write(
            render.ticket_text(
                ticket, children=children, cost=cost, waits=waits, events=rows
            )
        )
    return 0


def cmd_stats(args):
    roster = agents.load(required=False)
    if args.team:
        if not roster:
            raise FabError("Kein Team im Roster; fab team add …")
        teams.team(roster, args.team)
    payload = costs.stats(
        store.all_tickets(), roster, team=args.team, today=args.today
    )
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    print(f"{'Team':<16}{'Summe':>10}{'Heute':>10}{'Tickets':>9}")
    for row in payload["teams"]:
        print(
            f"{row['name'] or '—':<16}"
            f"{costs.format_cost(row['total']):>10}"
            f"{costs.format_cost(row['today']):>10}"
            f"{row['tickets']:>9}"
        )
    count = sum(row["tickets"] for row in payload["teams"])
    total = sum(row["total"] for row in payload["teams"])
    today = sum(row["today"] for row in payload["teams"])
    print(
        f"{'Gesamt':<16}"
        f"{costs.format_cost(total):>10}"
        f"{costs.format_cost(today):>10}"
        f"{count:>9}"
    )
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


def _max_cost(raw):
    """Kostenlimit aus Text; leer löscht, Komma gilt als Dezimaltrenner."""
    text = str(raw).strip().replace(",", ".")
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        raise FabError(f"Ungültiges Kostenlimit: {raw!r}")
    if not 0 <= value < float("inf"):
        raise FabError(f"Kostenlimit muss eine Zahl ab 0 sein: {raw!r}")
    return value


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
        if args.max_cost is not None:
            ticket["max_cost"] = _max_cost(args.max_cost)
            changed.append("Kostenlimit")
        if not changed:
            raise FabError(
                "Nichts zu ändern: nutze --title, --body, --body-file, --repo, "
                "--base oder --max-cost"
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
        state = preview.start(ticket, page=getattr(args, "page", "board") or "board")
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
    ticket = store.load(args.id)
    rev = _new_rev(ticket)
    agent_name = args.agent or ticket.get("assignee")
    if not agent_name:
        raise FabError(
            f"{ticket['id']}: kein Agent; nutze --agent NAME oder fab assign {ticket['id']} NAME"
        )
    with store.deferred_events():
        result = _dispatch(ticket, rev, agent_name, actor, roster)
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
    result = git.run_verify(
        worktree,
        trigger="verify",
        ticket=args.id,
        repo=ticket.get("repo") or "",
    )
    with store.locked():
        fresh = store.load(args.id)
        fresh["checks"] = {
            "state": result["state"],
            "head": result["head"],
            "at": store.now_ms(),
            "tail": result["tail"],
            "run_id": result["run_id"],
        }
        events.append("verify", fresh["id"], actor, "", result["state"])
        store.save(fresh)
        index.rebuild()
    print(
        f"{fresh['id']}: checks {result['state']} auf HEAD {_short(result['head'])} "
        f"(Exit {result['code']}) · Lauf #{result['run_id']}"
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
        if args.head:
            resolved = git.git(
                ["rev-parse", "--verify", "--quiet", f"{args.head}^{{commit}}"], worktree
            )
            given = resolved.stdout.strip() if resolved.returncode == 0 else ""
            if not given:
                raise FabError(
                    f"{ticket['id']}: --head {args.head} ist kein Commit im Worktree "
                    f"{worktree}"
                )
            if given != head:
                raise FabError(
                    f"{ticket['id']}: --head {_short(given)} passt nicht zum "
                    f"Worktree-HEAD {_short(head)}; es kam ein neuer Commit seit dem "
                    f"Prüfbeginn. Prüfe den neuen HEAD oder buche das Urteil auf "
                    f"{_short(given)}."
                )
            head = given
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
            reviewer = roster.get("reviewer") or ""
            if assignee:
                tail = (
                    f"Lies `fab show {ticket['id']}`, behebe die Befunde, dann "
                    f"`fab verify {ticket['id']} --from {assignee}`"
                    + (f" und @{reviewer} erneut erwähnen." if reviewer else ".")
                )
            else:
                tail = ""

            def message_for(name):
                if name == "orchestrator":
                    return _lesson_wake_text(ticket, "Urteil fail", actor, summary)
                return (
                    f"Ticket {ticket['id']} „{ticket['title']}“: Urteil fail von "
                    f"{actor}: „{summary[:300]}“. {tail}"
                )

            targets = [assignee, "orchestrator"] if assignee else ["orchestrator"]
            results = wake.process(
                ticket,
                targets,
                actor,
                summary,
                roster,
                message_for=message_for,
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


def _verify_merge_state(ticket, ref, tree, head):
    """Checks auf dem Merge-Stand in einem temporären Worktree; räumt immer auf."""
    repo = ticket["repo"]
    commit = git.merge_commit(
        repo, tree, ref, head, f"fab: Merge-Stand {ticket['id']} prüfen"
    )
    folder = os.path.join(
        tempfile.gettempdir(),
        f"fab-merge-{ticket['id']}-{os.getpid()}-{time.time_ns()}",
    )
    try:
        git.create_detached_worktree(repo, folder, commit)
        return git.run_verify(folder)
    finally:
        git.remove_worktree(repo, folder)


def _merge_record(ticket, ref, tree, head, report):
    repo = ticket["repo"]
    return {
        "tree": tree,
        "base": git.rev_parse(repo, ref),
        "base_ref": ref,
        "remote_base": git.remote_ref(repo, "origin", ticket["base"]) or "",
        "branch": head,
        "state": report["state"],
        "at": store.now_ms(),
        "tail": report["tail"],
    }


def _merge_red_text(ticket, base, ref, head, tree, report):
    assignee = ticket.get("assignee") or "zuständig"
    detail = report["tail"] or "keine Ausgabe"
    return (
        f"@{assignee} Der Merge-Stand von {ticket['branch']} mit {base} "
        f"({ref} @ {_short(head)}, Tree {_short(tree)}) "
        f"ist rot, obwohl der Branch selbst grün ist:\n{detail}\n"
        f"Bitte den Branch auf den aktuellen Stand von {base} bringen, "
        f"`fab verify {ticket['id']}` und erneut `fab handover {ticket['id']}`."
    )


def _ticket_reviewer(ticket, roster):
    team = _ticket_team(ticket, roster) or {}
    name = str(team.get("reviewer") or (roster or {}).get("reviewer") or "").strip()
    return name


def _accept_merge_changed(ticket, roster, repo, ref, head):
    """Merge-Stand neu prüfen, weil er vom abgelegten Tree abweicht.

    Liefert (merge, text, wecken) nach Aktualisierung von `ticket`. Konflikte
    und rote Checks wecken den Zuständigen, grüne Checks die Prüferin für ein
    neues Urteil. `wecken` führt der Aufrufer erst nach dem erfolgreichen Commit
    aus, damit ein CAS-Konflikt niemanden weckt.
    """
    base = ticket["base"]
    tree, files = git.merge_state(repo, ref, ticket["branch"])
    ticket["status"] = "doing"
    ticket.pop("stall", None)
    ticket["waiting"] = [
        waiting for waiting in ticket.get("waiting") or []
        if waiting.lower() != "mensch"
    ]
    # Das alte Urteil gilt nur für den alten Merge-Stand; ohne neues Urteil
    # blockiert `fab handover` wieder.
    ticket.pop("verdict", None)
    if files:
        ticket.pop("merge", None)
        text = wake.conflict_text(ticket, base, files)
        text += "\nDas bisherige Urteil wird verworfen."
        wake.add_comment(ticket, "mensch", text, roster)
        assignee = ticket.get("assignee")
        wecken = None
        if assignee:
            wecken = lambda: wake.process(
                ticket, [assignee], "mensch", text, roster,
                message_for=lambda name: wake.conflict_wake_text(ticket, base, files),
            )
        return None, text, wecken
    report = _verify_merge_state(ticket, ref, tree, head)
    merge = _merge_record(ticket, ref, tree, head, report)
    ticket["merge"] = merge
    if report["state"] != "pass":
        assignee = ticket.get("assignee")
        text = _merge_red_text(ticket, base, ref, head, tree, report)
        text += "\nDas bisherige Urteil wird verworfen."
        wake.add_comment(ticket, "mensch", text, roster)
        wecken = None
        if assignee:
            wecken = lambda: wake.process(
                ticket, [assignee], "mensch", text, roster,
                message_for=lambda name: (
                    f"Ticket {ticket['id']} „{ticket['title']}“: Der Merge-Stand mit "
                    f"{base} ist rot (Tree {_short(tree)}). {report['tail'][:300]} "
                    f"Bitte den Branch aktualisieren, `fab verify {ticket['id']}` und "
                    f"erneut `fab handover {ticket['id']}`."
                ),
            )
        return merge, text, wecken
    reviewer = _ticket_reviewer(ticket, roster)
    text = (
        f"Merge-Stand mit {base} hat sich geändert: Tree {_short(tree)} "
        f"({ref} @ {_short(head)}) wurde neu geprüft und ist grün. Das bisherige "
        f"Urteil wird verworfen"
        + (f". @{reviewer} bitte auf diesem Stand neu bewerten." if reviewer else ".")
    )
    wake.add_comment(ticket, "mensch", text, roster)
    wecken = None
    if reviewer:
        wecken = lambda: wake.process(
            ticket, [reviewer], "mensch", text, roster,
            message_for=lambda name: (
                f"Ticket {ticket['id']} „{ticket['title']}“: Der Merge-Stand mit {base} "
                f"hat sich nach dem Urteil geändert (neuer Tree {_short(tree)}, "
                f"Branch-HEAD {_short(head)}). Checks darauf sind grün. Bitte lies "
                f"`fab show {ticket['id']}`, prüfe den neuen Stand und gib mit "
                f"`fab verdict {ticket['id']} pass --from {name}` ein neues Urteil ab."
            ),
        )
    return merge, text, wecken


def cmd_handover(args):
    actor = _require_actor(args)
    summary = (args.summary or "").strip()
    if not summary:
        raise FabError("Die Zusammenfassung der Übergabe ist leer")
    ticket = store.load(args.id)
    rev = _new_rev(ticket)
    with store.deferred_events():
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
        merge = None
        merge_note = ""
        if not reasons and ticket.get("base") and ticket.get("branch") and ticket.get("repo"):
            repo = ticket["repo"]
            base = ticket["base"]
            try:
                ref = base
                tree, files = git.merge_state(repo, ref, ticket["branch"])
            except FabError as exc:
                reasons.append(str(exc))
            else:
                if files:
                    reasons.append(
                        f"Merge-Konflikt mit {base}:\n  - " + "\n  - ".join(files)
                    )
                elif tree:
                    try:
                        report = _verify_merge_state(ticket, ref, tree, head)
                    except FabError as exc:
                        reasons.append(
                            f"Merge-Stand mit {base} konnte nicht geprüft werden: {exc}"
                        )
                    else:
                        if report["state"] != "pass":
                            reasons.append(
                                f"Merge-Stand mit {base} ist rot "
                                f"(Tree {_short(tree)}):\n"
                                + (report["tail"] or "keine Ausgabe")
                            )
                            merge_note = _merge_red_text(
                                ticket, base, ref, head, tree, report
                            )
                        else:
                            merge = _merge_record(
                                ticket, ref, tree, head, report
                            )
        if reasons:
            roster = agents.load()
            results = []
            if files:
                text = wake.conflict_text(ticket, ticket["base"], files)
                wake.add_comment(ticket, actor, text, roster)
                assignee = ticket.get("assignee")
                # Erst der Commit: bei einem CAS-Konflikt wird niemand geweckt.
                rev = _commit(ticket, rev)
                if assignee:
                    results = wake.process(
                        ticket, [assignee], actor, text, roster,
                        message_for=lambda name: wake.conflict_wake_text(
                            ticket, ticket["base"], files
                        ),
                    )
                    rev = _commit(ticket, rev)
                _print_wake_results(results)
            elif merge_note:
                wake.add_comment(ticket, actor, merge_note, roster)
                assignee = ticket.get("assignee")
                # Erst der Commit: bei einem CAS-Konflikt wird niemand geweckt.
                rev = _commit(ticket, rev)
                if assignee:
                    results = wake.process(
                        ticket, [assignee], actor, merge_note, roster,
                        message_for=lambda name: (
                            f"Ticket {ticket['id']} „{ticket['title']}“: Der "
                            f"Merge-Stand mit {ticket['base']} ist rot, obwohl der "
                            f"Branch grün ist. Bitte den Branch aktualisieren, "
                            f"`fab verify {ticket['id']}` und erneut "
                            f"`fab handover {ticket['id']}`."
                        ),
                    )
                    rev = _commit(ticket, rev)
                _print_wake_results(results)
            else:
                _check_unchanged(ticket, rev)
            ticket.pop("merge", None)
            raise store.PersistError(
                f"{ticket['id']}: Übergabe verweigert:\n- " + "\n- ".join(reasons)
            )
        if merge:
            ticket["merge"] = merge
        else:
            ticket.pop("merge", None)
        ticket["status"] = "review"
        ticket.pop("stall", None)
        if "mensch" not in ticket["waiting"]:
            ticket["waiting"].append("mensch")
        _add_comment(ticket, actor, summary)
        events.append("handover", ticket["id"], actor, "", summary)
        rev = _commit(ticket, rev)
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
    lines = [
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
    issue = ticket.get("issue") or {}
    number = issue.get("number") if isinstance(issue, dict) else None
    if number:
        lines.extend(["", f"Closes #{number}"])
    return "\n".join(lines)


def _pr_failure(ticket, reason, url):
    reason = reason.strip()
    prefix = "PR-Merge ist fehlgeschlagen: "
    if reason.startswith(prefix):
        reason = reason[len(prefix):]
    text = f"PR-Merge fehlgeschlagen: {reason} — PR: {url}"
    ticket["pr"] = {"url": url, "state": "open"}
    _add_comment(ticket, "mensch", text)
    events.append("pr", ticket["id"], "mensch", "", text)


def _pr_cleanup_failure(ticket, reason, url):
    text = (
        f"PR gemergt, Aufräumen unvollständig: {reason.strip()} — PR: {url}; "
        f"fab accept erneut ausführen"
    )
    ticket["pr"] = {**(ticket.get("pr") or {}), "url": url, "state": "merged"}
    _add_comment(ticket, "mensch", text)
    events.append("pr", ticket["id"], "mensch", "", text)


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


_HINT_RE = re.compile(r"^\s*hinweis\b", re.IGNORECASE)


def _reviewer_hints(ticket, roster):
    """Nicht blockierende `hinweis`-Kommentare der Prüferin, in Ticketreihenfolge."""
    team = _ticket_team(ticket, roster)
    reviewer = str(
        (team or {}).get("reviewer") or (roster or {}).get("reviewer") or ""
    ).strip().lower()
    if not reviewer:
        return []
    hints = []
    for comment in ticket.get("comments") or []:
        comment = comment or {}
        if str(comment.get("author") or "").lower() != reviewer:
            continue
        text = str(comment.get("text") or "")
        if _HINT_RE.match(text):
            hints.append(text.strip())
    return hints


def _wake_review_hints(ticket, roster):
    """Weckt den Orchestrator mit den Prüfer-Hinweisen des abgenommenen Tickets."""
    hints = _reviewer_hints(ticket, roster)
    if not hints:
        return []
    listed = "\n".join(f"- {hint}" for hint in hints)

    def message_for(_name):
        return (
            f"Ticket {ticket['id']} „{ticket['title']}“ wurde angenommen und hat "
            f"{len(hints)} nicht blockierende Prüfer-Hinweis(e):\n{listed}\n"
            f"Lege dafür genau ein Backlog-Ticket an (Status todo, nicht dispatchen), "
            f"verweise auf {ticket['id']} und trage die neue ID dort als Kommentar ein "
            f"(Abschnitt „Prüfer-Hinweise nach Abnahme“ im Orchestrator-Prompt)."
        )

    return wake.process(
        ticket, ["orchestrator"], "fab", listed, roster, message_for=message_for,
        allow_closed=True,
    )


def _wake_hints_after_commit(ticket, rev, roster):
    """Prüfer-Hinweise erst nach dem erfolgreichen Commit wecken.

    So unterbleibt das Wecken bei einem CAS-Konflikt, obwohl nichts eingetragen
    wurde. Die Ereignisse und Kommentare des Weckens zieht ein zweiter Commit
    nach.
    """
    if not _reviewer_hints(ticket, roster):
        return [], rev
    hint_wakes = _wake_review_hints(ticket, roster)
    return hint_wakes, _commit(ticket, rev)


def _mark_pr_merged(ticket, url, merged):
    ticket["pr"] = {"url": url, "state": "merged", "commit": merged}
    _add_comment(ticket, "mensch", f"PR gemergt: {url}")
    events.append("pr", ticket["id"], "mensch", "", f"PR gemergt: {url}")


def _finish_pr_accept(ticket, top, branch_name, base, merged, url):
    git.push_delete(top, "origin", branch_name)
    ended = _end_sessions(ticket)
    git.remove_worktree(top, ticket.get("worktree"))
    if git.branch_exists(top, branch_name):
        git.delete_branch(top, branch_name)
    ticket["status"] = "done"
    ticket.pop("stall", None)
    ticket["waiting"] = []
    events.append(
        "accept", ticket["id"], "mensch", "",
        f"{branch_name} → {base} via PR {url} @ {_short(merged)}",
    )
    return ended


def cmd_accept(args):
    roster = agents.load()
    ticket = store.load(args.id)
    rev = _new_rev(ticket)
    with store.deferred_events():
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
        pr = ticket.get("pr") or {}
        pr_merged = pr.get("state") == "merged"
        if not pr_merged:
            review_worktree = ticket.get("worktree")
            review_head = git.head(review_worktree) if review_worktree else ""
            verdict = ticket.get("verdict") or {}
            if not review_head:
                raise FabError(
                    f"{ticket['id']}: HEAD des Worktrees {review_worktree or '—'} ist "
                    f"nicht lesbar; Urteil nicht prüfbar"
                )
            if verdict.get("head") != review_head:
                raise FabError(
                    f"{ticket['id']}: Urteil gilt für HEAD {_short(verdict.get('head'))}, "
                    f"Worktree-HEAD ist {_short(review_head)}; bitte erneut prüfen"
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
        failure = None
        if pr_merged:
            merged = (ticket.get("pr") or {}).get("commit") or git.head(top)
            url = ticket["pr"]["url"]
            try:
                ended = _finish_pr_accept(
                    ticket, top, branch_name, ticket["base"], merged, url,
                )
            except store.PersistError:
                raise
            except FabError as exc:
                _pr_cleanup_failure(ticket, str(exc), url)
                rev = _commit(ticket, rev)
                failure = exc
            else:
                rev = _commit(ticket, rev)
                hint_wakes, rev = _wake_hints_after_commit(ticket, rev, roster)
                print(
                    f"{ticket['id']}: angenommen, {branch_name} über PR {url} in "
                    f"{ticket['base']} gemergt ({_short(merged)}); Worktree und "
                    f"Branch entfernt"
                    + (f"; {len(ended)} Session(s) beendet" if ended else "")
                )
                _print_wake_results(hint_wakes)
        else:
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
            if args.pr_only and not pr_ready:
                raise FabError(
                    f"{ticket['id']}: --pr-only braucht einen GitHub-Remote (origin) und "
                    f"eine gh-Anmeldung (gh auth status)"
                )
            if not pr_ready:
                before = git.head(top)
                expected = (ticket.get("merge") or {}).get("tree")
                base_ref = ticket["base"]
                tree, conflict_files = git.merge_state(top, base_ref, branch_name)
                if conflict_files or not expected or tree != expected:
                    merge, text, wecken = _accept_merge_changed(
                        ticket, roster, top, base_ref, review_head
                    )
                    rev = _commit(ticket, rev)
                    _run_after_commit(ticket, rev, wecken)
                    raise store.PersistError(
                        f"{ticket['id']}: Merge-Stand mit {base_ref} weicht vom "
                        f"geprüften Tree {_short(expected)} ab (jetzt "
                        f"{_short(tree)}); nicht abgenommen. {text}"
                    )
                merged = git.merge_no_ff(
                    top, branch_name, f"Merge {branch_name}: {ticket['title']}"
                )
                if git.tree_sha(top, ticket["base"]) != expected:
                    git.reset_keep(top, before)
                    raise store.PersistError(
                        f"{ticket['id']}: der gemergte Tree auf {ticket['base']} "
                        f"weicht vom geprüften merge_tree {_short(expected)} ab; "
                        f"Merge auf {_short(before)} zurückgesetzt"
                    )
                report = preview.check_mods(top)
                if not report["ok"]:
                    git.reset_keep(top, before)
                    _accept_check_failed(ticket, report)
                    rev = _commit(ticket, rev)
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
                rev = _commit(ticket, rev)
                hint_wakes, rev = _wake_hints_after_commit(ticket, rev, roster)
                print(
                    f"{ticket['id']}: angenommen, {branch_name} in {ticket.get('base')} gemergt "
                    f"({_short(merged)}); Worktree und Branch entfernt"
                    + (f"; {len(ended)} Session(s) beendet" if ended else "")
                )
                _print_wake_results(hint_wakes)
                issue = ticket.get("issue") or {}
                if isinstance(issue, dict) and issue.get("number"):
                    print(
                        f"Issue #{issue['number']} bleibt offen: "
                        f"kein PR-Merge ohne GitHub-Remote/gh"
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
                expected = (ticket.get("merge") or {}).get("tree")
                # Geprüft wird wie bei handover gegen die lokale Basis. Sie wird
                # gleich nach origin gepusht; origin darf nur hinter ihr liegen.
                ref = base
                tree, conflict_files = git.merge_state(top, ref, branch_name)
                if conflict_files or not expected or tree != expected:
                    merge, text, wecken = _accept_merge_changed(
                        ticket, roster, top, ref, review_head
                    )
                    rev = _commit(ticket, rev)
                    _run_after_commit(ticket, rev, wecken)
                    raise store.PersistError(
                        f"{ticket['id']}: Merge-Stand mit {ref} weicht vom geprüften "
                        f"Tree {_short(expected)} ab (jetzt {_short(tree)}); nichts "
                        f"gepusht, nicht abgenommen. {text}"
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
                rev = _commit(ticket, rev)
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
                        rev = _commit(ticket, rev)
                        raise store.PersistError(
                            f"{ticket['id']}: herdr-app check rot; Merge "
                            f"{_short(merged)} als Revert nach origin/{base} gepusht"
                        )
                    _mark_pr_merged(ticket, url, merged)
                    ended = _finish_pr_accept(
                        ticket, top, branch_name, base, merged, url
                    )
                    rev = _commit(ticket, rev)
                    hint_wakes, rev = _wake_hints_after_commit(ticket, rev, roster)
                    print(
                        f"{ticket['id']}: angenommen, {branch_name} über PR {url} in {base} "
                        f"gemergt ({_short(merged)}); Worktree und Branch entfernt"
                        + (f"; {len(ended)} Session(s) beendet" if ended else "")
                    )
                    _print_wake_results(hint_wakes)
                except store.PersistError:
                    raise
                except FabError as exc:
                    if (ticket.get("pr") or {}).get("state") == "merged":
                        _pr_cleanup_failure(ticket, str(exc), url)
                    else:
                        _pr_failure(ticket, str(exc), url)
                    rev = _commit(ticket, rev)
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

        def message_for(name):
            if name == "orchestrator":
                return _lesson_wake_text(ticket, "Zurückweisung", "mensch", feedback)
            return (
                f"Ticket {ticket['id']} „{ticket['title']}“: Zurückgewiesen von mensch: "
                f"„{feedback[:300]}“. Lies `fab show {ticket['id']}`, arbeite weiter, "
                f"dann `fab verify {ticket['id']}` und erneut `fab handover`."
            )

        targets = [assignee, "orchestrator"] if assignee else ["orchestrator"]
        results = wake.process(
            ticket,
            targets,
            "mensch",
            feedback,
            roster,
            message_for=message_for,
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
            if path is None:
                print(f"Hinweis: {detail}")
                return 1
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
            store.meta_set(TICK_ALARM_SHOWN, "")
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
    payload = index.build()
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
            if row.get("brief"):
                line += f" · Brief {len(row['brief'])} Zeichen"
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
            brief = args.brief
            if args.brief_file:
                try:
                    with open(args.brief_file, encoding="utf-8") as handle:
                        brief = handle.read()
                except OSError as exc:
                    raise FabError(
                        f"Brief-Datei {args.brief_file} ist nicht lesbar: {exc}"
                    )
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
                    brief=brief,
                    actor=actor,
                )
            )
            return 0
        config.remove_team(args.name, actor)
    print(f"Team „{args.name}“ entfernt")
    return 0


def cmd_flow(args):
    if args.action == "list":
        rows = flows.definitions()
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return 0
        if not rows:
            print("Keine Workflows.")
            return 0
        for row in rows:
            print(
                f"{row['name']}  {len(row.get('nodes') or [])} Knoten · "
                f"{len(row.get('edges') or [])} Kanten · "
                f"geändert {render.fmt_ms(row.get('updated_at'))}"
            )
        return 0
    if args.action == "runs":
        rows = flows.runs(args.workflow)
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return 0
        if not rows:
            print("Keine Läufe.")
            return 0
        for row in rows:
            line = (
                f"{row['id']:>3}  {row['workflow']:<20} {row['status']:<9} "
                f"{row.get('current') or '—':<12} {row.get('reason') or ''}"
            )
            print(line.rstrip())
        return 0
    actor = _actor(args) or "mensch"
    if args.action == "add":
        definition = flows.add_file(args.datei, actor)
        print(
            f"Workflow „{definition['name']}“ gespeichert: "
            f"{len(definition.get('nodes') or [])} Knoten, "
            f"{len(definition.get('edges') or [])} Kanten"
        )
        return 0
    if args.action == "edit":
        definition = flows.edit(args.name, args.datei, actor)
        print(
            f"Workflow „{definition['name']}“ gespeichert: "
            f"{len(definition.get('nodes') or [])} Knoten, "
            f"{len(definition.get('edges') or [])} Kanten"
        )
        return 0
    if args.action == "rm":
        flows.remove(args.name, actor)
        print(f"Workflow „{args.name}“ entfernt")
        return 0
    if args.action == "run":
        result = flows.start(args.name, actor, dry=args.dry)
        for line in result["lines"]:
            print(line)
        return 0
    if args.action == "pause":
        row = flows.pause(args.run, actor)
        print(f"Lauf {row['id']} pausiert")
        return 0
    if args.action == "resume":
        row = flows.resume(args.run, actor)
        print(f"Lauf {row['id']} fortgesetzt")
        return 0
    if args.action == "cancel":
        row = flows.cancel(args.run, actor)
        print(f"Lauf {row['id']} abgebrochen")
        return 0
    raise FabError(f"unbekannte Aktion: {args.action}")


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


def cmd_template(args):
    if args.action == "list":
        rows = templates.entries()
        if args.json:
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return 0
        for row in rows:
            print(f"{row['name']}  {row['bytes']} B  {row['path']}")
        return 0
    if args.action == "show":
        sys.stdout.write(templates.show(args.name))
        return 0
    actor = _require_actor(args)
    with store.locked():
        path, size = templates.save(args.name, args.text, actor)
    print(f"Vorlage „{args.name}“ gespeichert ({size} Bytes): {path}")
    return 0


def cmd_issue(args):
    repo = _abs_repo(args.repo) if args.repo else git.main_toplevel(os.getcwd())
    if not repo:
        raise FabError(
            "Repo fehlt: --repo PFAD angeben oder in einem Git-Checkout ausführen"
        )
    rows = git.gh_issue_list(repo)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0
    for row in rows:
        print(f"#{row.get('number')} {row.get('title') or ''}".rstrip())
    return 0


def _lesson_proposal(ticket, proposal):
    wanted = str(proposal or "").strip().upper()
    for item in ticket.get("lesson_proposals") or []:
        if isinstance(item, dict) and str(item.get("id") or "").upper() == wanted:
            return item
    raise FabError(
        f"{ticket['id']}: Lehren-Vorschlag {proposal or '—'} gibt es nicht"
    )


def cmd_lesson(args):
    actor = _require_actor(args)
    if args.action == "propose":
        sentence = (args.value or "").strip()
        if not sentence or "\n" in sentence or "\r" in sentence:
            raise FabError(
                "Eine Lehre ist ein Satz: kein leerer Text und kein Zeilenumbruch"
            )
        with store.locked():
            ticket = store.load(args.id)
            if not ticket.get("repo"):
                raise FabError(
                    f"{ticket['id']} hat kein Repo; eine Lehre gehört in einen Checkout"
                )
            proposals = ticket.get("lesson_proposals")
            if not isinstance(proposals, list):
                proposals = []
            numbers = []
            for item in proposals:
                if not isinstance(item, dict):
                    continue
                match = re.fullmatch(r"L(\d+)", str(item.get("id") or ""))
                if match:
                    numbers.append(int(match.group(1)))
            proposal_id = f"L{max(numbers, default=0) + 1}"
            proposals.append(
                {
                    "id": proposal_id,
                    "text": sentence,
                    "at": store.now_ms(),
                    "by": actor,
                }
            )
            ticket["lesson_proposals"] = proposals
            events.append(
                "lesson", ticket["id"], actor, "", f"vorschlag: {sentence}"
            )
            store.save(ticket)
            index.rebuild()
        print(f"{args.id}: Lehren-Vorschlag {proposal_id} angelegt: {sentence}")
        return 0

    with store.locked():
        ticket = store.load(args.id)
        proposal = _lesson_proposal(ticket, args.value)
        sentence = str(proposal.get("text") or "")
        if args.action == "confirm" and not ticket.get("repo"):
            raise FabError(
                f"{ticket['id']} hat kein Repo; eine Lehre gehört in einen Checkout"
            )
        ticket["lesson_proposals"] = [
            item
            for item in ticket.get("lesson_proposals") or []
            if isinstance(item, dict)
            and str(item.get("id") or "") != str(proposal.get("id") or "")
        ]
        target = ""
        if args.action == "confirm":
            target = repos.append_lesson(
                ticket["repo"], sentence, f"Lehre aus {ticket['id']} bestätigt"
            )
            events.append(
                "lesson", ticket["id"], actor, "", f"bestätigt: {sentence}"
            )
        else:
            events.append(
                "lesson", ticket["id"], actor, "", f"verworfen: {sentence}"
            )
        store.save(ticket)
        index.rebuild()
    if args.action == "confirm":
        print(f"{args.id}: Lehre bestätigt in {target}: {sentence}")
    else:
        print(f"{args.id}: Lehren-Vorschlag {proposal.get('id')} verworfen")
    return 0


def _decision_proposal(ticket, proposal):
    wanted = str(proposal or "").strip().upper()
    for item in ticket.get("decision_proposals") or []:
        if isinstance(item, dict) and str(item.get("id") or "").upper() == wanted:
            return item
    raise FabError(
        f"{ticket['id']}: Entscheidungen-Vorschlag {proposal or '—'} gibt es nicht"
    )


def _decide_list(args):
    if args.repo is not None:
        path = _abs_repo(args.repo or os.getcwd())
        lines = repos.decisions(path)
        if not lines:
            print(f"Keine bestätigten Entscheidungen in {path}")
            return 0
        for line in lines:
            print(f"- {line}")
        return 0

    rows = []
    for ticket in store.all_tickets():
        for proposal in ticket.get("decision_proposals") or []:
            if not isinstance(proposal, dict):
                continue
            ticket_match = re.fullmatch(r"T-(\d+)", str(ticket.get("id") or ""))
            proposal_match = re.fullmatch(
                r"D(\d+)", str(proposal.get("id") or "")
            )
            rows.append(
                (
                    int(ticket_match.group(1)) if ticket_match else 0,
                    int(proposal_match.group(1)) if proposal_match else 0,
                    ticket,
                    proposal,
                )
            )
    if not rows:
        print("Keine offenen Entscheidungs-Vorschläge")
        return 0
    rows.sort(key=lambda row: (row[0], row[1]))
    for _, _, ticket, proposal in rows:
        line = (
            f"{ticket['id']} {proposal.get('id')} · "
            f"{proposal.get('by') or 'fab'} · {proposal.get('text') or ''}"
        )
        if proposal.get("reason"):
            line += f" · Begründung: {proposal.get('reason')}"
        print(line)
    return 0


def cmd_decide(args):
    if args.action == "list":
        return _decide_list(args)
    actor = _require_actor(args)
    if args.action == "propose":
        sentence = (args.value or "").strip()
        if not sentence or "\n" in sentence or "\r" in sentence:
            raise FabError(
                "Eine Entscheidung ist ein Satz: kein leerer Text und kein Zeilenumbruch"
            )
        raw_reason = args.reason or ""
        reason = raw_reason.strip()
        if "\n" in raw_reason or "\r" in raw_reason:
            raise FabError(
                "Eine Begründung ist ein Satz: kein leerer Text und kein Zeilenumbruch"
            )
        if actor == "mensch":
            ticket = store.load(args.id)
            if not ticket.get("repo"):
                raise FabError(
                    f"{ticket['id']} hat kein Repo; eine Entscheidung gehört in einen Checkout"
                )
            target = repos.append_decision(
                ticket["repo"], ticket["id"], sentence, reason or None
            )
            events.append(
                "decision", ticket["id"], actor, "", f"bestätigt: {sentence}"
            )
            print(f"{args.id}: Entscheidung bestätigt in {target}: {sentence}")
            return 0

        with store.locked():
            ticket = store.load(args.id)
            if not ticket.get("repo"):
                raise FabError(
                    f"{ticket['id']} hat kein Repo; eine Entscheidung gehört in einen Checkout"
                )
            proposals = ticket.get("decision_proposals")
            if not isinstance(proposals, list):
                proposals = []
            numbers = []
            for item in proposals:
                if not isinstance(item, dict):
                    continue
                match = re.fullmatch(r"D(\d+)", str(item.get("id") or ""))
                if match:
                    numbers.append(int(match.group(1)))
            proposal_id = f"D{max(numbers, default=0) + 1}"
            proposals.append(
                {
                    "id": proposal_id,
                    "text": sentence,
                    "reason": reason,
                    "at": store.now_ms(),
                    "by": actor,
                }
            )
            ticket["decision_proposals"] = proposals
            events.append(
                "decision", ticket["id"], actor, "", f"vorschlag: {sentence}"
            )
            store.save(ticket)
            index.rebuild()
        print(f"{args.id}: Entscheidungs-Vorschlag {proposal_id} angelegt: {sentence}")
        return 0

    with store.locked():
        ticket = store.load(args.id)
        proposal = _decision_proposal(ticket, args.proposal)
        text = str(proposal.get("text") or "")
        if args.action == "confirm" and not ticket.get("repo"):
            raise FabError(
                f"{ticket['id']} hat kein Repo; eine Entscheidung gehört in einen Checkout"
            )
        ticket["decision_proposals"] = [
            item
            for item in ticket.get("decision_proposals") or []
            if isinstance(item, dict)
            and str(item.get("id") or "") != str(proposal.get("id") or "")
        ]
        target = ""
        if args.action == "confirm":
            target = repos.append_decision(
                ticket["repo"],
                ticket["id"],
                text,
                proposal.get("reason") or None,
            )
            events.append(
                "decision", ticket["id"], actor, "", f"bestätigt: {text}"
            )
        else:
            events.append(
                "decision", ticket["id"], actor, "", f"verworfen: {text}"
            )
        store.save(ticket)
        index.rebuild()
    if args.action == "confirm":
        print(f"{args.id}: Entscheidung bestätigt in {target}: {text}")
    else:
        print(f"{args.id}: Entscheidungs-Vorschlag {proposal.get('id')} verworfen")
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
        if row["project_exists"]:
            marks.append("Steckbrief")
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
        for key, label in (
            ("verify", "Prüfskript"),
            ("lessons", "Lernnotizen"),
            ("project", "Steckbrief"),
        ):
            state = "vorhanden" if data[key]["exists"] else "fehlt"
            print(f"{label}: {state}")
        if not data["project"]["exists"]:
            print("Vorlage für den Steckbrief:")
            print(data["project_template"].rstrip())
        return 0
    if args.action == "test":
        result = repos.test(args.path)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        print(f"Prüfskript: Exit {result['exit']}")
        if result.get("run_id"):
            print(f"Lauf #{result['run_id']}")
        if result["tail"]:
            print(result["tail"])
        return 0
    actor = _require_actor(args)
    with store.locked():
        target = repos.set_file(args.path, args.kind, args.text, actor)
    print(f"{target} gespeichert")
    return 0


def _run_number(raw):
    text = str(raw).strip()
    if text.startswith("#"):
        text = text[1:]
    if not text.isdigit():
        raise FabError(f"Ungültige Laufnummer {raw!r}; Beispiel: 12 oder #12")
    return int(text)


def _run_line(row):
    return (
        f"Lauf #{row['id']} · {row['trigger']} · {row['state']} · "
        f"{row['ticket'] or '—'} · {(row['head'] or '—')[:8]} · "
        f"{row['duration_ms']} ms"
    )


def cmd_runs(args):
    rows = store.pipeline_run_list(args.ticket)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0
    if not rows:
        print("Keine Läufe.")
        return 0
    for row in rows:
        print(
            f"#{row['id']} · {row['trigger']} · {row['state']} · "
            f"{row['ticket'] or '—'} · {(row['head'] or '—')[:8]} · "
            f"{row['duration_ms']} ms"
        )
    return 0


def cmd_run(args):
    if args.action == "rerun":
        old = _run_number(args.run)
        result = pipeline.rerun(old)
        print(
            f"Lauf #{old} → #{result['run_id']}: {result['state']} "
            f"(Exit {result['code']})"
        )
        return 0 if result["state"] == "pass" else 1
    run_id = _run_number(args.run)
    run = store.pipeline_run_load(run_id)
    if run is None:
        raise FabError(f"Pipeline-Lauf {run_id} existiert nicht")
    steps = store.pipeline_steps(run_id)
    if args.step:
        filtered = [step for step in steps if step["name"] == args.step]
        if not filtered:
            names = ", ".join(step["name"] for step in steps) or "—"
            raise FabError(f"Unbekannter Schritt {args.step!r}; vorhanden: {names}")
        steps = filtered
    if args.json:
        print(json.dumps({"run": run, "steps": steps}, ensure_ascii=False, indent=2))
        return 0
    print(_run_line(run))
    for step in steps:
        print(
            f"[{step['position'] + 1}] {step['name']} · {step['state']} · "
            f"Exit {step['exit_code']} · {step['duration_ms']} ms"
        )
        if (step["stdout"] or "").strip():
            print(step["stdout"].rstrip())
        if (step["stderr"] or "").strip():
            print(step["stderr"].rstrip())
    return 0


def cmd_context(args):
    if args.id and args.team:
        raise FabError("Bitte ID oder --team NAME, nicht beides")
    if not args.id and not args.team:
        raise FabError("Fehlt: ID oder --team NAME")
    roster = agents.load()
    if args.id:
        ticket = store.load(args.id)
        report = context.for_ticket(roster, ticket, report=True)
    else:
        report = context.for_team(roster, args.team, report=True)
    text = report["text"]
    if args.json:
        print(
            json.dumps(
                {
                    "text": text,
                    "chars": len(text),
                    "limit": context.limit(roster),
                    "clipped": report["clipped"],
                    "scope": "ticket" if args.id else "team",
                    "id": args.id or None,
                    "team": args.team or None,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    if text:
        sys.stdout.write(text + "\n")
    return 0


def _git_value(*args):
    result = git.git(list(args), agents.FABRIC_DIR)
    return result.stdout.strip() if result.returncode == 0 else ""


def cmd_autopilot(args):
    action = args.action
    if action == "start":
        result = autopilot.start(args.until)
        print(f"Autopilot gestartet in {result['repo']} (bis {args.until})")
        return 0
    if action == "stop":
        autopilot.stop()
        print("Autopilot gestoppt")
        return 0
    if action == "resume":
        outcome = autopilot.resume()
        if outcome == "resumed":
            print("Autopilot fortgesetzt")
        elif outcome == "not-paused":
            print("Autopilot: nichts pausiert, Status bleibt")
        else:
            print("Autopilot: kein Status, nichts fortgesetzt")
        return 0
    if action == "run":
        return autopilot.run(args.until)
    state = autopilot.status()
    if args.json:
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return 0
    if not state.get("state"):
        print("Autopilot: kein Status (nicht gestartet)")
        return 0
    live = "läuft" if autopilot.is_live() else "nicht aktiv"
    reason = f" · {state['reason']}" if state.get("reason") else ""
    print(
        f"Autopilot: {state['state']}{reason} · "
        f"Ende {state.get('end') or 'offen'} · {live}"
    )
    if state.get("last_action"):
        print(f"Zuletzt: {state['last_action']}")
    return 0


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

    item = command("new", "Ticket aus einem Satz anlegen, optional aus Vorlage oder GitHub-Issue, und den Orchestrator wecken", cmd_new)
    item.add_argument("sentence", metavar="SATZ", nargs="?",
                      help="der Auftrag in einem Satz; entfällt mit --issue")
    item.add_argument("--repo", metavar="PFAD", help="Checkout, Standard: Git-Wurzel des aktuellen Ordners")
    item.add_argument("--parent", metavar="ID", help="Eltern-Ticket; das Unter-Ticket erbt dessen Repo")
    item.add_argument("--template", metavar="NAME", help="Vorlage aus fabric/templates, z. B. bug")
    item.add_argument("--issue", metavar="N", type=int,
                      help="offenes GitHub-Issue als Titel und Body übernehmen")
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

    item = command("stats", "Kosten je Team und Ticket zeigen", cmd_stats)
    item.add_argument("--team", metavar="NAME", help="nur dieses Team")
    item.add_argument("--today", action="store_true",
                      help="Heute-Kosten statt Gesamtkosten betonen")
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
    item.add_argument("--max-cost", metavar="USD",
                      help="Kostenlimit je Ticket; leer löscht es")
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
    start.add_argument("--page",
                       choices=("board", "ticket", "settings", "workflows",
                                "repos", "team", "context"),
                       default="board", help="Startseite im Fenster")
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
    item.add_argument(
        "--head", metavar="SHA",
        help="geprüfter Commit; bricht ab, wenn der Worktree-HEAD davon abweicht",
    )
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
    brief = edit.add_mutually_exclusive_group()
    brief.add_argument("--brief", metavar="TEXT",
                       help="Team-Brief (leer entfernt ihn)")
    brief.add_argument("--brief-file", metavar="PFAD",
                       help="Team-Brief aus Datei lesen")
    edit.add_argument("--from", dest="from_", metavar="NAME", required=True)

    remove = team_sub.add_parser("rm", help="Team entfernen", description="Team entfernen")
    remove.add_argument("name", metavar="NAME")
    remove.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("flow", "Workflows als JSON-Graph verwalten und ausführen", cmd_flow)
    flow_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    listing = flow_sub.add_parser("list", help="Workflows auflisten",
                                  description="Workflows auflisten")
    listing.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    add = flow_sub.add_parser("add", help="Workflow aus Datei anlegen",
                              description="Workflow aus Datei anlegen")
    add.add_argument("datei", metavar="DATEI", help="JSON-Datei mit der Definition")
    add.add_argument("--from", dest="from_", metavar="NAME", default="mensch",
                     help="Autor (Standard: mensch)")
    edit = flow_sub.add_parser("edit", help="Workflow aus Datei ersetzen",
                               description="Workflow aus Datei ersetzen")
    edit.add_argument("name", metavar="NAME")
    edit.add_argument("datei", metavar="DATEI", help="JSON-Datei mit der Definition")
    edit.add_argument("--from", dest="from_", metavar="NAME", default="mensch",
                      help="Autor (Standard: mensch)")
    remove = flow_sub.add_parser("rm", help="Workflow entfernen",
                                 description="Workflow entfernen")
    remove.add_argument("name", metavar="NAME")
    remove.add_argument("--from", dest="from_", metavar="NAME", default="mensch",
                        help="Autor (Standard: mensch)")
    run_item = flow_sub.add_parser("run", help="Workflow starten",
                                   description="Workflow starten")
    run_item.add_argument("name", metavar="NAME")
    run_item.add_argument("--dry", action="store_true",
                          help="nur zeigen, nichts anlegen")
    run_item.add_argument("--from", dest="from_", metavar="NAME", default="mensch",
                          help="Autor (Standard: mensch)")
    runs_item = flow_sub.add_parser("runs", help="Läufe auflisten",
                                    description="Läufe auflisten")
    runs_item.add_argument("--workflow", metavar="NAME",
                           help="nur Läufe dieses Workflows")
    runs_item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    pause_item = flow_sub.add_parser("pause", help="Lauf pausieren",
                                     description="Lauf pausieren")
    pause_item.add_argument("run", metavar="LAUF")
    pause_item.add_argument("--from", dest="from_", metavar="NAME", default="mensch",
                            help="Autor (Standard: mensch)")
    resume_item = flow_sub.add_parser("resume", help="Pausierten Lauf fortsetzen",
                                      description="Pausierten Lauf fortsetzen")
    resume_item.add_argument("run", metavar="LAUF")
    resume_item.add_argument("--from", dest="from_", metavar="NAME", default="mensch",
                             help="Autor (Standard: mensch)")
    cancel_item = flow_sub.add_parser("cancel", help="Lauf abbrechen",
                                      description="Lauf abbrechen")
    cancel_item.add_argument("run", metavar="LAUF")
    cancel_item.add_argument("--from", dest="from_", metavar="NAME", default="mensch",
                             help="Autor (Standard: mensch)")

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
                               "max_sessions_total, context_limit, "
                               "tick_*_minutes oder "
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

    item = command("template", "Ticket-Vorlagen auflisten, zeigen und speichern", cmd_template)
    template_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    listing = template_sub.add_parser("list", help="Vorlagen auflisten",
                                      description="Vorlagen auflisten")
    listing.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    show_item = template_sub.add_parser("show", help="Vorlage roh ausgeben",
                                        description="Vorlage roh ausgeben")
    show_item.add_argument("name", metavar="NAME", help="z. B. bug, feature, refactor, chore")
    set_template = template_sub.add_parser("set", help="Vorlage speichern",
                                           description="Vorlage speichern")
    set_template.add_argument("name", metavar="NAME")
    set_template.add_argument("--text", metavar="T", required=True)
    set_template.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("issue", "GitHub-Issues des Repos auflisten", cmd_issue)
    issue_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    listing = issue_sub.add_parser("list", help="offene Issues auflisten",
                                   description="offene Issues auflisten")
    listing.add_argument("--repo", metavar="PFAD",
                         help="Checkout, Standard: Git-Wurzel des aktuellen Ordners")
    listing.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

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
    set_repo.add_argument("kind", metavar="DATEI",
                          choices=("verify", "lessons", "project"))
    set_repo.add_argument("--text", metavar="T", required=True)
    set_repo.add_argument("--from", dest="from_", metavar="NAME", required=True)
    test_repo = repo_sub.add_parser("test", help="Prüfskript ausführen",
                                    description="Prüfskript ausführen")
    test_repo.add_argument("path", metavar="PFAD")
    test_repo.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("runs", "Pipeline-Läufe auflisten", cmd_runs)
    item.add_argument("--ticket", metavar="ID", help="nur Läufe dieses Tickets")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("run", "Gespeicherte Pipeline-Läufe zeigen und wiederholen",
                   cmd_run)
    run_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    show_run = run_sub.add_parser("show", help="Lauf mit Schritten zeigen",
                                  description="Lauf mit Schritten zeigen")
    show_run.add_argument("run", metavar="LAUF", help="Laufnummer, z. B. 12 oder #12")
    show_run.add_argument("--step", metavar="NAME", help="nur diesen Schritt zeigen")
    show_run.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    rerun_run = run_sub.add_parser("rerun", help="Lauf wiederholen",
                                   description="Lauf wiederholen")
    rerun_run.add_argument("run", metavar="LAUF", help="Laufnummer, z. B. 12 oder #12")

    item = command("context", "Prompt-Kontext aus Steckbrief und Team-Brief zeigen",
                   cmd_context)
    item.add_argument("id", metavar="ID", nargs="?",
                      help="Ticket-ID; zeigt den Kontext dieses Tickets")
    item.add_argument("--team", metavar="NAME",
                      help="Kontext eines ganzen Teams")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("lesson", "Lehren vorschlagen, bestätigen und verwerfen", cmd_lesson)
    lesson_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    propose_lesson = lesson_sub.add_parser(
        "propose", help="Lehre vorschlagen", description="Lehre vorschlagen"
    )
    propose_lesson.add_argument("id", metavar="ID")
    propose_lesson.add_argument("value", metavar="SATZ")
    propose_lesson.add_argument("--from", dest="from_", metavar="NAME", required=True)
    confirm_lesson = lesson_sub.add_parser(
        "confirm", help="Lehre bestätigen", description="Lehre bestätigen"
    )
    confirm_lesson.add_argument("id", metavar="ID")
    confirm_lesson.add_argument("value", metavar="VORSCHLAG")
    confirm_lesson.add_argument("--from", dest="from_", metavar="NAME", required=True)
    discard_lesson = lesson_sub.add_parser(
        "discard", help="Lehre verwerfen", description="Lehre verwerfen"
    )
    discard_lesson.add_argument("id", metavar="ID")
    discard_lesson.add_argument("value", metavar="VORSCHLAG")
    discard_lesson.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command(
        "decide", "Entscheidungen vorschlagen, bestätigen, verwerfen und anzeigen",
        cmd_decide,
    )
    decide_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    propose_decide = decide_sub.add_parser(
        "propose", help="Entscheidung vorschlagen",
        description="Entscheidung vorschlagen",
    )
    propose_decide.add_argument("id", metavar="ID")
    propose_decide.add_argument("value", metavar="ENTSCHEIDUNG")
    propose_decide.add_argument("--from", dest="from_", metavar="NAME", required=True)
    propose_decide.add_argument("--reason", metavar="TEXT")
    confirm_decide = decide_sub.add_parser(
        "confirm", help="Entscheidung bestätigen",
        description="Entscheidung bestätigen",
    )
    confirm_decide.add_argument("id", metavar="ID")
    confirm_decide.add_argument("proposal", metavar="VORSCHLAG")
    confirm_decide.add_argument("--from", dest="from_", metavar="NAME", required=True)
    reject_decide = decide_sub.add_parser(
        "reject", help="Entscheidung verwerfen",
        description="Entscheidung verwerfen",
    )
    reject_decide.add_argument("id", metavar="ID")
    reject_decide.add_argument("proposal", metavar="VORSCHLAG")
    reject_decide.add_argument("--from", dest="from_", metavar="NAME", required=True)
    list_decide = decide_sub.add_parser(
        "list", help="Entscheidungen anzeigen",
        description="Entscheidungen anzeigen",
    )
    list_decide.add_argument(
        "--repo", nargs="?", const="", metavar="PFAD",
        help="bestätigte Entscheidungen dieses Checkouts, Standard: aktueller Ordner",
    )

    item = command(
        "autopilot",
        "Autopilot: nimmt Tickets ab, prüft main und hält den Betrieb am Laufen",
        cmd_autopilot,
    )
    auto_sub = item.add_subparsers(dest="action", metavar="AKTION", required=True)
    auto_start = auto_sub.add_parser(
        "start", help="Autopilot im Terminal autopilot starten",
        description="Autopilot im Terminal autopilot starten",
    )
    auto_start.add_argument(
        "--until", metavar="HH:MM|done", default="done",
        help="Endzeit als HH:MM oder done (Standard: done)",
    )
    auto_sub.add_parser("stop", help="Autopilot beenden", description="Autopilot beenden")
    auto_status = auto_sub.add_parser(
        "status", help="Status des Autopiloten zeigen",
        description="Status des Autopiloten zeigen",
    )
    auto_status.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")
    auto_sub.add_parser(
        "resume", help="Pausemarke entfernen und weiterlaufen",
        description="Pausemarke entfernen und weiterlaufen",
    )
    auto_run = auto_sub.add_parser(
        "run", help="Autopilot-Schleife (intern)", description="Autopilot-Schleife (intern)",
    )
    auto_run.add_argument(
        "--until", metavar="HH:MM|done", default="done", help=argparse.SUPPRESS,
    )
    # Die interne Schleife bleibt wählbar, wird aber nicht als Aktion beworben.
    auto_sub._choices_actions = [
        action for action in auto_sub._choices_actions if action.dest != "run"
    ]
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
    if not argv:
        return argv
    if argv[0] == "decide":
        actions = ("propose", "confirm", "reject", "list", "-h", "--help")
        if len(argv) > 1 and argv[1] in actions:
            return argv
        return ["decide", "propose", *argv[1:]]
    if argv[0] != "wake":
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


TICK_ALARM_SHOWN = "tick_alarm_shown"


def _ensure_tick_agent():
    """Fehlenden launchd-Auftrag beim ersten `fab`-Aufruf anlegen.

    Der Auftrag ist Beiwerk: ein Schreib- oder launchctl-Fehler darf den
    eigentlichen Befehl nicht aufhalten.
    """
    try:
        tick.ensure_installed()
    except Exception:
        pass


def _publish_tick_alarm(args):
    """`index.json` neu schreiben, wenn der Wächter-Alarm kippt.

    Nur der Übergang kostet einen Schreibvorgang; solange derselbe Ausfall
    anhält, bleibt der bereits veröffentlichte Eintrag stehen. `--dry-run`
    schreibt nichts, und `fab migrate` entscheidet allein über die Migration.
    """
    if getattr(args, "dry_run", False):
        return
    if getattr(args, "func", None) is cmd_migrate:
        return
    try:
        state = store.tick_alarm()
        want = str(state["last_tick"]) if state["stale"] else ""
        if (store.meta_get(TICK_ALARM_SHOWN) or "") == want:
            return
        with store.locked(timeout=0.5):
            state = store.tick_alarm()
            want = str(state["last_tick"]) if state["stale"] else ""
            if (store.meta_get(TICK_ALARM_SHOWN) or "") == want:
                return
            store.meta_set(TICK_ALARM_SHOWN, want)
            index.rebuild()
    except Exception:
        pass


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(_normalize_argv(list(argv)))
    if not (getattr(args, "install", False) or getattr(args, "uninstall", False)):
        _ensure_tick_agent()
    _publish_tick_alarm(args)
    try:
        return args.func(args) or 0
    except (FabError, HcError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Abgebrochen.", file=sys.stderr)
        return 130
