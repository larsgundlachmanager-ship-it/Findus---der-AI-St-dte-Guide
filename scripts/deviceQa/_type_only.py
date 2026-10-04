"""QA on devices without STT (e.g. Samsung S7): tippen only — never Mic-Hold / Speech.

Use askServer (:8791) or Tippfeld (short mic tap → type → Fragen).
Always dismiss „Spracherkennung nicht verfügbar“ with SPÄTER.
"""
from __future__ import annotations

import re
import subprocess
import time
import urllib.request
from typing import Callable

ASK_PORT = 8791


def ask_via_server(text: str, port: int = ASK_PORT, timeout: float = 12.0) -> str:
    """Preferred path — no Mic, no STT."""
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/ask",
        data=text.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return (r.read() or b"").decode("utf-8", errors="replace")


def dismiss_speech_alert(
    dump_fn: Callable[[], str],
    nodes_fn: Callable,
    tap_fn: Callable[[int, int], None],
    rounds: int = 4,
) -> bool:
    """Tap SPÄTER / dismiss on Spracherkennung alert. Returns True if dismissed."""
    dismissed = False
    for _ in range(rounds):
        xml = dump_fn()
        blob = xml.lower()
        if "spracherkennung" not in blob and "speech services" not in blob:
            return dismissed
        for n in nodes_fn(xml):
            if not n.get("click"):
                continue
            label = f"{n.get('text', '')} {n.get('desc', '')}".strip().lower()
            # Never open system settings from this dialog
            if "einstellungen öffnen" in label or "einstellungen oeffnen" in label:
                continue
            if label in ("später", "spaeter", "ok", "abbrechen") or "später" in label:
                tap_fn(n["cx"], n["cy"])
                time.sleep(0.5)
                dismissed = True
                break
        else:
            # back key as last resort
            break
    return dismissed


def ascii_for_adb(q: str) -> str:
    return (
        q.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
    )
