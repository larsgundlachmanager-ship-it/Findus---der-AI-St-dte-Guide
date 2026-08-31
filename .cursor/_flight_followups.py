#!/usr/bin/env python3
"""Flight ask + airport follow-ups live on device."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))
from _marathon_ask import ask, dismiss, dump, extract, shot, tap_label  # noqa: E402

OUT = ROOT / ".cursor" / "live9" / "flight-fu"
OUT.mkdir(parents=True, exist_ok=True)

# Patch marathon OUT? It writes to live9/*. Use tags with prefix.


def run() -> None:
    dismiss()
    time.sleep(0.5)

    steps = [
        (
            "ff-flight",
            "Flug von Hamburg nach Wien morgen Abend",
            55.0,
        ),
        (
            "ff-airport",
            "Wie komme ich zum Flughafen",
            40.0,
        ),
        (
            "ff-leaveby",
            "Wann muss ich von zu Hause los",
            40.0,
        ),
        (
            "ff-mode",
            "Mit der S-Bahn oder besser Taxi",
            35.0,
        ),
    ]

    results = []
    for tag, q, wait in steps:
        print("===", tag, q)
        txt = ask(tag, q, wait)
        # copy captures into flight-fu folder
        for suf in (".png", ".xml", "-text.txt"):
            src = ROOT / ".cursor" / "live9" / f"{tag}{suf}"
            if src.exists():
                (OUT / src.name).write_bytes(src.read_bytes())
        low = (txt or "").lower()
        hit = {
            "flug": any(k in low for k in ("flug", "ham", "vie", "wien", "abflug", "leave")),
            "airport": any(
                k in low
                for k in (
                    "flughafen",
                    "ham",
                    "s-bahn",
                    "sbahn",
                    "taxi",
                    "leave",
                    "los",
                    "uhr",
                    "route",
                )
            ),
            "raw_len": len(txt or ""),
            "preview": (txt or "").replace("\n", " | ")[:280],
        }
        results.append((tag, hit))
        print("preview:", hit["preview"][:200])
        time.sleep(1.5)

    print("\n=== SUMMARY ===")
    for tag, hit in results:
        print(tag, "len=", hit["raw_len"], "flugish=", hit["flug"], "airportish=", hit["airport"])
        print(" ", hit["preview"][:160])


if __name__ == "__main__":
    run()
