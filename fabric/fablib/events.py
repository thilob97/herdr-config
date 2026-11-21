"""Ereignislog: nur anhängen; die Ablage übernimmt `store` (SQLite)."""
from . import store

KINDS = frozenset(
    "created edited status assigned comment wake dispatch verify verdict handover "
    "accept reject drop orchestrator config tick pr".split()
)

# Weck-Ergebnisse, die einen Inbox-Eintrag `attention` erzeugen.
ATTENTION_TEXTS = (
    "unterdrückt: ping-pong",
    "unterdrückt: voll",
    "unterdrückt: start fehlgeschlagen",
)

DELIVERED = ("geweckt", "gestartet", "an orchestrator", "zweiter Versuch erfolgreich")


def append(kind, ticket, actor="", target="", text="", reason=""):
    if kind not in KINDS:
        raise ValueError(f"unbekanntes Ereignis: {kind}")
    return store.event_append(kind, ticket, actor, target, text, reason)


def read_all():
    return store.event_rows()


def tail(limit=300):
    return store.event_tail(limit)


def count_wakes(ticket, target, since_ms):
    """Zählt nur wirklich zugestellte Weckungen, keine Unterdrückungen."""
    return store.event_count_wakes(ticket, target, since_ms, DELIVERED)


def has_text(ticket, text):
    return store.event_has_text(ticket, text)
