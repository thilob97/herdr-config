"""Ereignislog `events.jsonl`: nur anhängen, eine JSON-Zeile je Ereignis."""
import json

from . import store

KINDS = frozenset(
    "created edited status assigned comment wake dispatch verify verdict handover "
    "accept reject drop orchestrator config tick".split()
)

# Weck-Ergebnisse, die einen Inbox-Eintrag `attention` erzeugen.
ATTENTION_TEXTS = (
    "unterdrückt: ping-pong",
    "unterdrückt: voll",
    "unterdrückt: start fehlgeschlagen",
)


def append(kind, ticket, actor="", target="", text="", reason=""):
    if kind not in KINDS:
        raise ValueError(f"unbekanntes Ereignis: {kind}")
    row = {
        "at": store.now_ms(),
        "kind": kind,
        "ticket": ticket or "",
        "actor": actor or "",
        "target": target or "",
        "text": text or "",
        "reason": reason or "",
    }
    store.ensure()
    with open(store.events_path(), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def read_all():
    try:
        handle = open(store.events_path(), encoding="utf-8")
    except FileNotFoundError:
        return []
    rows = []
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                # Eine halb geschriebene letzte Zeile überspringen.
                continue
            if isinstance(row, dict) and "kind" in row:
                rows.append(row)
    return rows


def tail(limit=300):
    return read_all()[-limit:]


DELIVERED = ("geweckt", "gestartet", "an orchestrator", "zweiter Versuch erfolgreich")


def count_wakes(ticket, target, since_ms):
    """Zählt nur wirklich zugestellte Weckungen, keine Unterdrückungen."""
    total = 0
    for row in read_all():
        if (
            row.get("kind") == "wake"
            and row.get("ticket") == ticket
            and row.get("target") == target
            and row.get("text") in DELIVERED
            and int(row.get("at") or 0) >= since_ms
        ):
            total += 1
    return total


def has_text(ticket, text):
    return any(
        row.get("kind") == "wake" and row.get("ticket") == ticket and row.get("text") == text
        for row in read_all()
    )
