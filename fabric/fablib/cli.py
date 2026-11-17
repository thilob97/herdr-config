"""Kommandozeile `fab`: Befehle aus Abschnitt 3 des Vertrags."""
import argparse
import json
import os
import re
import sys
import unicodedata

from . import agents, events, git, hc, index, render, store, wake
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
    return git.toplevel(folder) or folder


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


def _add_comment(ticket, author, text):
    at = store.now_ms()
    found = wake.mentions(text)
    ticket["comments"].append(
        {
            "n": len(ticket["comments"]) + 1,
            "at": at,
            "author": author,
            "text": text,
            "mentions": found,
        }
    )
    ticket["waiting"] = [
        waiting for waiting in ticket["waiting"] if waiting.lower() != author.lower()
    ]
    events.append("comment", ticket["id"], author, "", text)
    return found


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
    repo = _abs_repo(args.repo) if args.repo else git.toplevel(os.getcwd())
    roster = agents.load(required=False)
    if roster is None:
        print(f"Warnung: Roster fehlt ({agents.roster_path()}); @orchestrator wird nicht geweckt",
              file=sys.stderr)
    title = sentence[:80]
    body = f"## Auftrag\n{sentence}"
    with store.locked():
        tid = store.next_id()
        ticket = store.blank_ticket(tid, title=title, body=body, repo=repo, created_by=author)
        store.save(ticket)
        events.append("created", tid, author, "", sentence)
        text = "@orchestrator bitte ausformulieren und verteilen"
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
    if args.json:
        print(json.dumps([index.entry(ticket) for ticket in tickets],
                         ensure_ascii=False, indent=2))
    else:
        for ticket in tickets:
            print(render.ticket_line(ticket))
    return 0


def cmd_show(args):
    ticket = store.load(args.id)
    if args.json:
        print(render.ticket_json(ticket))
    else:
        sys.stdout.write(render.ticket_text(ticket))
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
    with store.locked():
        ticket = store.load(args.id)
        old = ticket["status"]
        ticket["status"] = args.status
        if args.status in ("done", "dropped"):
            ticket["waiting"] = []
        events.append("status", ticket["id"], actor, "", f"{old} → {args.status}")
        store.save(ticket)
        index.rebuild()
    print(f"{ticket['id']}: {old} → {args.status}")
    return 0


def cmd_assign(args):
    actor = _require_actor(args)
    roster = agents.load()
    agents.agent(args.name, roster)
    with store.locked():
        ticket = store.load(args.id)
        ticket["assignee"] = args.name
        events.append("assigned", ticket["id"], actor, args.name, args.name)
        store.save(ticket)
        index.rebuild()
    print(f"{ticket['id']}: zuständig ist {args.name}")
    return 0


def cmd_link(args):
    actor = _require_actor(args)
    with store.locked():
        ticket = store.load(args.id)
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
        agents.agent(agent_name, roster)
        if not ticket.get("repo"):
            raise FabError(
                f"{ticket['id']} hat kein Repo; fab edit {ticket['id']} --repo PFAD --from {actor}"
            )
        top = git.toplevel(ticket["repo"])
        if not top:
            raise FabError(f"{ticket['id']}: {ticket['repo']} ist kein Git-Repository")
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
        terminal = hc.terminal_name(agent_name, ticket["id"])
        if terminal in live:
            results = wake.process(
                ticket, [agent_name], actor,
                f"Arbeite an {ticket['id']} weiter.",
                roster,
            )
            if ticket["status"] != "doing":
                ticket["status"] = "doing"
            events.append("dispatch", ticket["id"], actor, agent_name,
                          f"lief schon: {terminal}")
            store.save(ticket)
            index.rebuild()
            _print_wake_results(results)
            print(f"{ticket['id']}: {agent_name} läuft schon ({terminal}); geweckt statt gestartet")
            return 0
        limit = int(roster.get("max_sessions") or 4)
        if len(agents.running(live)) >= limit:
            raise FabError(
                f"Maximale Zahl laufender Agenten ({limit}) erreicht; "
                f"erst ein Ticket abschließen oder das Limit im Roster erhöhen"
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
            raise FabError(
                f"{ticket['id']}: Agent {agent_name} nicht gestartet ({detail}); "
                f"Branch {branch_name} und Worktree {folder} bleiben für einen neuen Versuch"
            )
        ticket["status"] = "doing"
        ticket["sessions"].append(
            {
                "agent": agent_name,
                "terminal": started["terminal"],
                "name": started["name"],
                "started_at": store.now_ms(),
            }
        )
        events.append("dispatch", ticket["id"], actor, agent_name,
                      f"{branch_name} · {folder}")
        store.save(ticket)
        index.rebuild()
    print(
        f"{ticket['id']} an {agent_name} verteilt: {branch_name} in {folder} "
        f"(Terminal {started['terminal']})"
    )
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
        if reasons:
            raise FabError(
                f"{ticket['id']}: Übergabe verweigert:\n- " + "\n- ".join(reasons)
            )
        ticket["status"] = "review"
        if "mensch" not in ticket["waiting"]:
            ticket["waiting"].append("mensch")
        _add_comment(ticket, actor, summary)
        events.append("handover", ticket["id"], actor, "", summary)
        store.save(ticket)
        index.rebuild()
    print(f"{ticket['id']}: an den Menschen übergeben (Status review)")
    return 0


def cmd_accept(args):
    with store.locked():
        ticket = store.load(args.id)
        if ticket["status"] != "review":
            raise FabError(
                f"{ticket['id']}: Abnahme nur im Status review (jetzt {ticket['status']}); "
                f"erst fab handover"
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
        changes = git.dirty(top)
        if changes:
            raise FabError(f"Haupt-Checkout {top} ist nicht sauber:\n{changes}")
        merged = git.merge_no_ff(
            top, branch_name, f"Merge {branch_name}: {ticket['title']}"
        )
        ended = _end_sessions(ticket)
        git.remove_worktree(top, worktree)
        git.delete_branch(top, branch_name)
        ticket["status"] = "done"
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
    with store.locked():
        ticket = store.load(args.id)
        results = wake.process(ticket, [args.name.lower()], actor, text, roster)
        store.save(ticket)
        index.rebuild()
    _print_wake_results(results)
    return 0


def cmd_orchestrator(args):
    roster = agents.load()
    with store.locked():
        if args.action == "start":
            if agents.orchestrator_live():
                raise FabError("Orchestrator läuft schon (fab-orchestrator)")
            agents.start_orchestrator(roster)
            events.append("orchestrator", "", "fab", "", "gestartet")
            index.rebuild()
            print("Orchestrator gestartet (fab-orchestrator)")
            return 0
        if args.action == "stop":
            if not agents.orchestrator_live():
                print("Orchestrator läuft nicht")
                return 0
            hc.kill(agents.ORCHESTRATOR)
            events.append("orchestrator", "", "fab", "", "beendet")
            index.rebuild()
            print("Orchestrator beendet")
            return 0
    live = hc.live()
    row = live.get(agents.ORCHESTRATOR)
    if row:
        print(f"Orchestrator läuft ({row.get('address') or agents.ORCHESTRATOR})")
    else:
        print("Orchestrator läuft nicht")
    return 0


def cmd_agents(args):
    roster = agents.load()
    live = hc.live()
    running = agents.running(live)
    sessions = []
    for ticket in store.all_tickets():
        for session in ticket.get("sessions") or []:
            name = session.get("name") or ""
            sessions.append(
                {
                    "ticket": ticket["id"],
                    "agent": session.get("agent"),
                    "name": name,
                    "terminal": session.get("terminal"),
                    "live": name in live,
                }
            )
    known = {session["name"] for session in sessions}
    for name, row in sorted(running.items()):
        if name not in known:
            sessions.append(
                {
                    "ticket": None,
                    "agent": None,
                    "name": name,
                    "terminal": row.get("address"),
                    "live": True,
                }
            )
    if args.json:
        payload = {
            "max_sessions": roster["max_sessions"],
            "reviewer": roster["reviewer"],
            "orchestrator": {
                "name": agents.ORCHESTRATOR,
                "live": agents.ORCHESTRATOR in live,
                "terminal": (live.get(agents.ORCHESTRATOR) or {}).get("address"),
            },
            "agents": [
                {
                    "name": item["name"],
                    "role": item["role"],
                    "color": item["color"],
                    "running": [s for s in sessions if s["name"] in running],
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
            if session["name"].startswith(f"fab-{item['name']}-")
        ]
        state = "läuft nicht"
        if mine:
            state = ", ".join(
                f"{session['name']} ({session['terminal']}, {session['ticket'] or '—'})"
                f"{'' if session['live'] else ' · beendet'}"
                for session in mine
            )
        print(f"{item['name']:<10} {item['role']:<10} {item['color']:<4} {state}")
    print(
        "Orchestrator: "
        + (
            f"läuft ({(live.get(agents.ORCHESTRATOR) or {}).get('address')})"
            if agents.ORCHESTRATOR in live
            else "läuft nicht"
        )
    )
    return 0


def cmd_inbox(args):
    with store.locked():
        payload = index.rebuild()
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
    item.add_argument("--from", dest="from_", metavar="NAME", default="mensch", help="Autor (Standard: mensch)")

    item = command("list", "Tickets auflisten", cmd_list)
    item.add_argument("--status", metavar="S", help="nur dieser Status")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("show", "Ein Ticket mit Verlauf zeigen", cmd_show)
    item.add_argument("id", metavar="ID", help="Ticket-ID, z. B. T-1")
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("edit", "Titel, Body, Repo oder Basis eines Tickets ändern", cmd_edit)
    item.add_argument("id", metavar="ID")
    item.add_argument("--title", metavar="T")
    body = item.add_mutually_exclusive_group()
    body.add_argument("--body", metavar="T")
    body.add_argument("--body-file", metavar="F")
    item.add_argument("--repo", metavar="PFAD")
    item.add_argument("--base", metavar="B")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True, help="wer ändert")

    item = command("status", "Status eines Tickets setzen (done nur über accept)", cmd_status)
    item.add_argument("id", metavar="ID")
    item.add_argument("status", metavar="STATUS", help="draft, todo, doing, review oder dropped")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("assign", "Zuständigen aus dem Roster setzen", cmd_assign)
    item.add_argument("id", metavar="ID")
    item.add_argument("name", metavar="NAME", help="Roster-Name")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("link", "Abhängigkeiten eintragen (ohne Zyklen)", cmd_link)
    item.add_argument("id", metavar="ID")
    item.add_argument("--blocked-by", nargs="+", metavar="ID", required=True,
                      help="ein oder mehrere Tickets")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)

    item = command("comment", "Kommentar schreiben; @name weckt", cmd_comment)
    item.add_argument("id", metavar="ID")
    item.add_argument("--from", dest="from_", metavar="NAME", required=True)
    item.add_argument("--no-wake", action="store_true", help="niemanden wecken")
    item.add_argument("text", metavar="TEXT")

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

    item = command("accept", "Abnahme durch den Menschen: mergen, aufräumen, done", cmd_accept)
    item.add_argument("id", metavar="ID")

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
    item.add_argument("text", metavar="TEXT", nargs="?", default=None)

    item = command("orchestrator", "Orchestrator-Terminal starten, beenden, prüfen", cmd_orchestrator)
    item.add_argument("action", metavar="AKTION", choices=("start", "stop", "status"))

    item = command("agents", "Roster und laufende Sessions zeigen", cmd_agents)
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    item = command("inbox", "Was auf den Menschen wartet", cmd_inbox)
    item.add_argument("--json", action="store_true", help="maschinenlesbare Ausgabe")

    command("index", "index.json neu erzeugen", cmd_index)
    return parser


def _normalize_argv(argv):
    """`fab wake ID NAME --from X "<text>"`: der optionale Text steht hinter Optionen,
    die argparse sonst nicht mehr mit dem optionalen Positional verbindet."""
    if not argv or argv[0] != "wake":
        return argv
    positionals, options, index = [argv[0]], [], 1
    while index < len(argv):
        token = argv[index]
        if token == "--from":
            options.extend(argv[index:index + 2])
            index += 2
            continue
        if token.startswith("--from=") or token in ("-h", "--help"):
            options.append(token)
            index += 1
            continue
        positionals.append(token)
        index += 1
    return [*positionals, *options]


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
