"""Prints one JSON object about omp on this machine, then exits.

  usage.py limits  -> {"providers": [...], "disabled": [...]}   (omp usage --json --redact)
  usage.py costs   -> {"today", "week", "month", "models": [...]} (omp's stats.db, USD)

Only plans, percentages, reset times, reasons and dollar sums leave this script:
no emails, account ids or tokens. Runs as a file here and as `python3 -c` on
other machines (agent-cards does the same).
"""
import datetime, json, os, pathlib, shutil, sqlite3, subprocess, sys


def omp(*args, timeout):
    exe = shutil.which("omp") or os.path.expanduser("~/.local/bin/omp")
    r = subprocess.run([exe, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if r.returncode != 0:
        lines = [l for l in (r.stderr or r.stdout).splitlines() if l.strip()]
        raise RuntimeError(f"omp {args[0]} endete mit Code {r.returncode}: {(lines or ['keine Ausgabe'])[-1][:160]}")
    return r.stdout


def limits():
    data = json.loads(omp("usage", "--json", "--redact", "--no-extensions", timeout=90))
    providers = []
    for rep in data.get("reports") or []:
        windows = []
        for l in rep.get("limits") or []:
            amount, window = l.get("amount") or {}, l.get("window") or {}
            frac = amount.get("usedFraction")
            if frac is None and amount.get("limit"):
                frac = (amount.get("used") or 0) / amount["limit"]
            windows.append({
                "label": l.get("label") or window.get("label") or l.get("id"),
                "window": window.get("label"),
                "pct": None if frac is None else round(frac * 100, 1),
                "resetsAt": window.get("resetsAt"),
                "status": l.get("status"),
            })
        providers.append({
            "provider": rep.get("provider"),
            "plan": (rep.get("metadata") or {}).get("plan"),
            "error": str(rep.get("error"))[:160] if rep.get("error") else None,
            "windows": windows,
        })
    # Konten, deren Limits omp nicht lesen kann: gedämpft mit Grund, nie als erfundene %.
    disabled = [{"provider": d.get("provider"), "reason": str(d.get("cause") or "deaktiviert")[:160]}
                for d in data.get("disabledCredentials") or []]
    for a in data.get("accountsWithoutUsage") or []:
        a = a if isinstance(a, dict) else {"provider": str(a)}
        disabled.append({"provider": a.get("provider"), "reason": str(a.get("reason") or "keine Usage-API")[:160]})
    return {"providers": providers, "disabled": disabled}


def costs():
    omp("stats", "--json", timeout=120)  # syncs new session entries into stats.db; its own JSON covers ~2 days only
    db = pathlib.Path(os.path.expanduser("~/.omp/stats.db"))
    if not db.exists():
        raise RuntimeError("keine ~/.omp/stats.db")
    con = sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)
    midnight = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    t = lambda days: int((midnight - datetime.timedelta(days=days)).timestamp() * 1000)
    rows = con.execute(
        "SELECT model, provider,"
        " SUM(CASE WHEN timestamp >= ? THEN cost_total ELSE 0 END),"
        " SUM(CASE WHEN timestamp >= ? THEN cost_total ELSE 0 END),"
        " SUM(cost_total)"
        " FROM messages WHERE timestamp >= ? GROUP BY model, provider",
        (t(0), t(6), t(29))).fetchall()
    models = [{"model": m, "provider": p, "today": round(d or 0, 2), "week": round(w or 0, 2), "month": round(mo or 0, 2)}
              for m, p, d, w, mo in rows if (mo or 0) > 0]
    models.sort(key=lambda m: (m["today"], m["week"], m["month"]), reverse=True)
    return {
        "today": round(sum(m["today"] for m in models), 2),
        "week": round(sum(m["week"] for m in models), 2),
        "month": round(sum(m["month"] for m in models), 2),
        "models": models[:5],
    }


try:
    out = {"limits": limits, "costs": costs}[sys.argv[1]]()
except Exception as e:
    sys.stderr.write(str(e)[:300])
    sys.exit(1)
sys.stdout.write(json.dumps(out, separators=(",", ":")))
