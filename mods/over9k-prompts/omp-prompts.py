#!/usr/bin/env python3
# Your prompts in an omp session, for the Timeline panel (over9k-prompts):
#   omp-prompts.py <session.jsonl | --pid PID> [last]
# --pid: the omp process in a terminal; its session is the one omp records for that
# process's tty in ~/.omp/agent/terminal-sessions/<tty> (second line).
# last ("<path>\t<size>", what was read before): when that's still the file and its
# size, it prints {"same": true} and reads nothing.
# Prints what prompts.py prints for Claude Code: {prompts: [{at, done, text, also,
# reply, edits, cmds, tools, tokens}], oldest first, context, size, path}.
# A prompt is a message you typed (attribution "user"). One you sent while the agent
# was still working (its last reply asked for tools) stays in that turn, in also.
# reply: the agent's last text; edits: files from edit/write calls; cmds: bash calls;
# tools: every tool call; done: the turn's last entry; tokens: output tokens;
# context: the last reply's input, cached and not.
import json, os, re, subprocess, sys

SKIP = ("<system-reminder", "<system-notification", "<task-notification")
HEADER = re.compile(r"^\[([^\]#]+)#[0-9A-Fa-f]{4}\]", re.M)


def session_of(pid):
    try:
        tty = subprocess.run(["ps", "-o", "tty=", "-p", str(pid)], capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        return None
    if not tty or tty in ("?", "??"):
        return None
    tty = tty if tty.startswith("tty") else "tty" + tty
    try:
        with open(os.path.expanduser(f"~/.omp/agent/terminal-sessions/{tty}"), encoding="utf-8") as f:
            lines = f.read().splitlines()
        return lines[1] if len(lines) > 1 else None
    except OSError:
        return None


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def main():
    args = sys.argv[1:]
    if args[:1] == ["--pid"]:
        path, args = session_of(args[1]), args[2:]
    else:
        path, args = args[0], args[1:]
    if not path or not os.path.isfile(path):
        print('{"prompts": [], "context": 0, "size": 0, "path": null}')
        return
    size = os.path.getsize(path)
    if args and args[0] == f"{path}\t{size}":
        print('{"same": true}')
        return
    out, cur, context, busy = [], None, 0, False
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") != "message":
                continue
            m = e.get("message") or {}
            role, at = m.get("role"), e.get("timestamp")
            if role == "user":
                said = text_of(m.get("content")).strip()
                if m.get("attribution") != "user" or not said or said.startswith(SKIP):
                    continue
                if busy and cur is not None:
                    cur["also"].append({"at": at, "text": said})
                else:
                    cur = {"at": at, "done": None, "text": said, "also": [], "reply": "", "edits": [], "cmds": 0, "tools": 0, "tokens": 0}
                    out.append(cur)
                    busy = True
                continue
            if cur is None:
                continue
            if at:
                cur["done"] = at
            if role != "assistant":
                continue
            u = m.get("usage") or {}
            if u:
                context = (u.get("input") or 0) + (u.get("cacheRead") or 0) + (u.get("cacheWrite") or 0)
                cur["tokens"] += u.get("output") or 0
            busy = m.get("stopReason") == "toolUse"
            for b in m.get("content") or []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and b.get("text", "").strip():
                    cur["reply"] = b["text"].strip()
                elif b.get("type") == "toolCall":
                    cur["tools"] += 1
                    a = b.get("arguments") or {}
                    name = b.get("name")
                    files = []
                    if name == "edit":
                        files = HEADER.findall(a.get("input") or "")
                    elif name == "write" and a.get("path"):
                        files = [a["path"]]
                    elif name == "bash":
                        cur["cmds"] += 1
                    for p in files:
                        p = os.path.expanduser(p.strip())
                        if p not in cur["edits"]:
                            cur["edits"].append(p)
    json.dump({"prompts": out, "context": context, "size": size, "path": path}, sys.stdout)


main()
