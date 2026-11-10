#!/usr/bin/env python3
# What the agent cards show under each omp agent, read from omp's own files.
#   omp-cards.py <percent-encoded JSON {"<terminal id>": "<terminal title>", ...}>
# Terminal ids are the ones on this machine (t1, not wsl/t1). Prints one JSON
# object keyed by terminal id, only for terminals whose session was found.
#
# Which session runs in a terminal:
#   tty   (Linux) the omp process whose HC_TERMINAL_ID is the terminal; omp records the
#         session of its tty in ~/.omp/agent/terminal-sessions/<pts-N> (second line).
#   title omp titles its terminal "π <state> <session title>" and keeps that title
#         in the first line of the session file: the newest top-level session whose
#         title ends the terminal's title. Used where there is no tty (Windows).
# From the session file (append-only JSON lines, read on from where the last run
# stopped; ~/.cache/herdr-agent-cards/omp keeps that place):
#   model     the last model_change, else the last reply's provider/model
#   thinking  the last thinking_level_change (thinkingLevel, configured)
#   context   the last reply's input + cacheRead + cacheWrite; unknown after a compaction
#             until the next reply. Window: the model's contextWindow in ~/.omp/agent/models.db
#   cost      usage.cost.total of every reply and model_usage entry in this file
#   subagents task tool calls/results, async-result notices and wait results (job states);
#             otherwise its own file (<session>/<id>.jsonl) says it started, a
#             session_exit at its end that it ended. Shown: those spawned since your
#             last prompt, and unfinished ones whose file moved in the last 30 minutes.
# Python 3, standard library only.
import glob, hashlib, json, os, re, sqlite3, sys, time
from urllib.parse import unquote

HOME = os.path.expanduser("~")
AGENT = os.path.join(HOME, ".omp", "agent")
CACHE = os.path.join(HOME, ".cache", "herdr-agent-cards", "omp")
STATE_VERSION = 2
RECENT = 30 * 60  # an unfinished subagent from an earlier turn counts while its file moved this recently


def tty_sessions(wanted):
    """terminal id -> session path, from omp processes' ttys (Linux /proc only)."""
    found = {}
    if not os.path.isdir("/proc/self/fd"):
        return found
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/comm") as f:
                if f.read().strip() != "omp":
                    continue
            with open(f"/proc/{pid}/environ", "rb") as f:
                env = f.read().split(b"\0")
            tty = os.readlink(f"/proc/{pid}/fd/0")
        except OSError:
            continue
        term = next((kv[15:].decode() for kv in env if kv.startswith(b"HC_TERMINAL_ID=")), None)
        if term not in wanted or not tty.startswith("/dev/"):
            continue
        try:
            with open(os.path.join(AGENT, "terminal-sessions", tty[5:].replace("/", "-")), encoding="utf-8") as f:
                lines = f.read().splitlines()
        except OSError:
            continue
        if len(lines) > 1 and os.path.isfile(lines[1]):
            found[term] = lines[1]
    return found


def first_title(path):
    try:
        with open(path, "rb") as f:
            line = f.readline(65536)
        e = json.loads(line)
    except (OSError, ValueError):
        return None
    t = e.get("title") if e.get("type") in ("title", "session") else None
    return t.strip() if isinstance(t, str) and t.strip() else None


def title_sessions(wanted, skip):
    """terminal id -> newest top-level session whose title ends the terminal's title."""
    todo = {k: (v or "").strip() for k, v in wanted.items() if k not in skip and (v or "").strip()}
    found = {}
    if not todo:
        return found
    files = []
    for p in glob.glob(os.path.join(AGENT, "sessions", "*", "*.jsonl")):
        try:
            files.append((os.path.getmtime(p), p))
        except OSError:
            pass
    files.sort(reverse=True)
    for _, p in files:
        t = first_title(p)
        if not t or len(t) < 4:
            continue
        for term, title in list(todo.items()):
            if title.endswith(t):
                found[term] = p
                del todo[term]
        if not todo:
            break
    return found


def fresh_state():
    return {"model": None, "reply_model": None, "provider": None, "thinking": None, "configured": None,
            "ctx": None, "cost": 0.0, "last_user": None, "subs": {}, "order": []}


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def describe(item):
    d = item.get("description")
    if isinstance(d, str) and d.strip():
        return d.strip()[:120]
    for line in (item.get("assignment") or item.get("task") or "").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and not line.lower().startswith("complete"):
            return line[:120]
    return ""


def sub(st, sid, ts, spawn, **kw):
    """A subagent's entry; spawn (re)starts it at the end of the list."""
    s = st["subs"].get(sid)
    if s is None or spawn:
        s = st["subs"][sid] = {"agent": None, "description": "", "status": None, "at": ts}
        if sid in st["order"]:
            st["order"].remove(sid)
        st["order"].append(sid)
    for k, v in kw.items():
        if v:
            s[k] = v
    return s


def jobs(st, items):
    """Background job states (async-result notices, wait results) for known subagents."""
    for j in items if isinstance(items, list) else []:
        if not isinstance(j, dict) or not j.get("status"):
            continue
        sid = next((k for k in (j.get("agentId"), j.get("id"), j.get("jobId")) if k in st["subs"]), None)
        if sid:
            st["subs"][sid]["status"] = j["status"]


def take(st, e):
    t = e.get("type")
    ts = e.get("timestamp")
    if t == "model_change" and isinstance(e.get("model"), str):
        st["model"] = e["model"]
    elif t == "thinking_level_change":
        st["thinking"] = e.get("thinkingLevel") or st["thinking"]
        st["configured"] = e.get("configured")
    elif t == "compaction":
        st["ctx"] = None
    elif t == "model_usage":
        st["cost"] += ((e.get("usage") or {}).get("cost") or {}).get("total") or 0
    elif t == "custom_message" and e.get("customType") == "async-result":
        jobs(st, (e.get("details") or {}).get("jobs"))
    elif t == "message":
        m = e.get("message") or {}
        role = m.get("role")
        if role == "user" and m.get("attribution") == "user" and not text_of(m.get("content")).lstrip().startswith("<system-"):
            st["last_user"] = ts
        elif role == "toolResult" and m.get("toolName") != "task":
            # wait (and the like) report background jobs' states.
            jobs(st, (m.get("details") or {}).get("jobs"))
        elif role == "assistant":
            u = m.get("usage") or {}
            st["cost"] += (u.get("cost") or {}).get("total") or 0
            used = (u.get("input") or 0) + (u.get("cacheRead") or 0) + (u.get("cacheWrite") or 0)
            if used > 0:
                st["ctx"] = used
                st["provider"], st["reply_model"] = m.get("provider"), m.get("model")
            for b in m.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "toolCall" and b.get("name") == "task":
                    a = b.get("arguments") or {}
                    names = []
                    for item in a.get("tasks") or []:
                        if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"]:
                            names.append(item["name"])
                            sub(st, item["name"], ts, True, agent=item.get("agent") or a.get("agent") or "task",
                                description=describe(item))
                    if b.get("id"):
                        st.setdefault("calls", {})[b["id"]] = names
        elif role == "toolResult" and m.get("toolName") == "task":
            d = m.get("details") or {}
            asked = st.get("calls", {}).pop(m.get("toolCallId"), [])
            got = set()
            for item in d.get("progress") or []:
                if item.get("id"):
                    sub(st, item["id"], ts, item["id"] not in asked, agent=item.get("agent"), description=describe(item))
                    got.add(item["id"])
            for item in d.get("results") or []:
                if item.get("id"):
                    failed = item.get("aborted") or item.get("error") or (item.get("exitCode") not in (0, None))
                    sub(st, item["id"], ts, item["id"] not in asked and item["id"] not in got, agent=item.get("agent"),
                        description=describe(item), status="failed" if failed else "completed")
                    got.add(item["id"])
            # Names omp didn't take as asked (a refused call, a renamed agent) never ran.
            for name in asked:
                if name not in got and st["subs"].get(name, {}).get("status") is None:
                    st["subs"].pop(name, None)
                    if name in st["order"]:
                        st["order"].remove(name)


def parse(path):
    """The session's state, read on from the cached place when the file only grew."""
    key = hashlib.sha1(path.encode("utf-8")).hexdigest()
    cache = os.path.join(CACHE, key + ".json")
    size = os.path.getsize(path)
    try:
        with open(cache, encoding="utf-8") as f:
            c = json.load(f)
        if c.get("v") != STATE_VERSION or c.get("path") != path or c["offset"] > size:
            raise ValueError
    except (OSError, ValueError, KeyError):
        c = None
    with open(path, "rb") as f:
        if c:
            # The bytes before the place must still be the ones read: else the file was rewritten.
            f.seek(max(0, c["offset"] - 64))
            if f.read(min(64, c["offset"])).hex() != c["tail"]:
                c = None
        if c and c["offset"] == size:
            return c["state"]
        st = c["state"] if c else fresh_state()
        offset = c["offset"] if c else 0
        f.seek(offset)
        data = f.read()
    end = data.rfind(b"\n") + 1  # only whole lines; a line being written waits for the next run
    for raw in data[:end].split(b"\n"):
        if not raw.strip():
            continue
        try:
            e = json.loads(raw)
        except ValueError:
            continue
        if isinstance(e, dict):
            take(st, e)
    offset += end
    with open(path, "rb") as f:
        f.seek(max(0, offset - 64))
        tail = f.read(min(64, offset)).hex()
    try:
        os.makedirs(CACHE, exist_ok=True)
        tmp = f"{cache}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"v": STATE_VERSION, "path": path, "offset": offset, "tail": tail, "state": st}, f)
        os.replace(tmp, cache)
    except OSError:
        pass
    return st


_windows = {}


def context_window(provider, model):
    if not provider or not model:
        return None
    if provider not in _windows:
        rows = {}
        try:
            db = sqlite3.connect("file:" + os.path.join(AGENT, "models.db").replace("\\", "/") + "?mode=ro", uri=True, timeout=1)
            try:
                for (models,) in db.execute("SELECT models FROM model_cache WHERE provider_id = ? OR provider_id LIKE ?",
                                            (provider, provider + ":%")):
                    for m in json.loads(models):
                        if isinstance(m, dict) and m.get("id") and m.get("contextWindow"):
                            rows[m["id"]] = m["contextWindow"]
            finally:
                db.close()
        except Exception:
            pass
        _windows[provider] = rows
    return _windows[provider].get(model)


def sub_file(session, sid):
    base = session[:-6] if session.endswith(".jsonl") else session
    p = os.path.join(base, sid + ".jsonl")
    if os.path.isfile(p):
        return p
    found = glob.glob(os.path.join(glob.escape(base), "*-" + glob.escape(sid) + ".jsonl"))
    return found[0] if found else None


def ended(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 8192))
            tail = f.read()
    except OSError:
        return False
    last = [l for l in tail.split(b"\n") if l.strip()]
    return bool(last) and b'"customType":"session_exit"' in last[-1]


def subagents(session, st):
    now = time.time()
    out = []
    for sid in st["order"]:
        s = st["subs"][sid]
        status = s.get("status")
        mtime = None
        if status not in ("completed", "failed", "cancelled", "aborted"):
            p = sub_file(session, sid)
            if p:
                try:
                    mtime = os.path.getmtime(p)
                except OSError:
                    mtime = None
                status = "completed" if ended(p) else "running"
            else:
                status = "pending"
        this_turn = st["last_user"] is None or (s.get("at") or "") >= st["last_user"]
        unfinished = status in ("running", "pending")
        if not this_turn and not (unfinished and mtime and now - mtime < RECENT):
            continue
        out.append({"id": sid, "agent": s.get("agent") or "task", "description": s.get("description") or "", "status": status})
    return out


def info(session, via):
    st = parse(session)
    provider = st["provider"]
    model = st["model"] or (f"{provider}/{st['reply_model']}" if provider and st["reply_model"] else None)
    if model and "/" in model:
        provider, short = model.split("/", 1)
    else:
        short = model
    window = context_window(st["provider"], st["reply_model"])
    ctx = st["ctx"]
    return {
        "via": via,
        "session": session,
        "model": short,
        "provider": provider,
        "thinking": st["thinking"],
        "configured": st["configured"],
        "context": ctx,
        "window": window,
        "percent": round(ctx * 100 / window) if ctx and window else None,
        "cost": round(st["cost"], 4) if st["cost"] > 0 else None,
        "subagents": subagents(session, st),
    }


def main():
    try:
        wanted = json.loads(unquote(sys.argv[1])) if len(sys.argv) > 1 else {}
    except Exception:
        wanted = {}
    if not isinstance(wanted, dict):
        wanted = {}
    wanted = {k: v for k, v in wanted.items() if isinstance(k, str) and re.fullmatch(r"[A-Za-z0-9_.-]+", k)}
    found = {k: (p, "tty") for k, p in tty_sessions(wanted).items()}
    found.update({k: (p, "title") for k, p in title_sessions(wanted, found).items()})
    out = {}
    for term, (path, via) in found.items():
        try:
            out[term] = info(path, via)
        except Exception:
            continue
    sys.stdout.write(json.dumps(out, separators=(",", ":")))


main()
