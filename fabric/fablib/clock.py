"""Zentrale Uhr: echte Zeit oder mit `FAB_NOW` eingefrorene Zeit.

`FAB_NOW` nimmt Millisekunden seit der Epoche oder eine ISO-Zeit. Eine
ISO-Zeit ohne Zone gilt lokal; mit `Z` oder Offset gilt die angegebene Zone.
Ohne `FAB_NOW` bleibt die echte Uhr maßgeblich.
"""
import os
import time
from datetime import datetime

from .errors import FabError


def now_ms():
    raw = (os.environ.get("FAB_NOW") or "").strip()
    if not raw:
        return int(time.time() * 1000)
    return _parse(raw)


def _parse(raw):
    if raw.lstrip("+-").isdigit():
        return int(raw)
    value = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise FabError(
            f"FAB_NOW ist keine ISO-Zeit und keine Millisekunden: {raw!r}"
        )
    return int(parsed.timestamp() * 1000)
