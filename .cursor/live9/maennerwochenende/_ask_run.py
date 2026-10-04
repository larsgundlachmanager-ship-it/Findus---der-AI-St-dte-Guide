#!/usr/bin/env python3
"""Männerwochenende via Ask-Server → Reisebüro enqueue (nach Fix)."""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live9" / "maennerwochenende"
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

spec = importlib.util.spec_from_file_location(
    "mw", ROOT / "scripts" / "deviceQa" / "_maennerwochenende_live.py"
)
mw = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mw)


def ask(text: str) -> None:
    data = text.encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:8791/ask",
        data=data,
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        r.read()
    mw.log(f"asked: {text[:90]}")


def wait_brief_stickers(timeout=60) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        xml = mw.dump()
        b = mw.ui_blob(xml).lower()
        if "noch nichts angepinnt" not in b and (
            "brief" in b and ("%" in b) and "brief 0%" not in b
        ):
            return True
        if "muss" in b and ("personen" in b or "wochenende" in b or "budget" in b):
            return True
        time.sleep(2)
    return False


def main() -> int:
    mw.OUT.mkdir(parents=True, exist_ok=True)
    mw.ensure_reverse()
    # cold open Reisebüro
    r = subprocess.run(
        [sys.executable, str(OUT / "_cold_open.py")],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    mw.log((r.stdout or "")[-300:])
    xml = mw.dump()
    if "android.widget.EditText" not in xml and "antwort tippen" not in mw.ui_blob(xml).lower():
        # deep link open
        mw.adb(
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            "findus://reisebuero",
        )
        time.sleep(4)
        xml = mw.dump()
    mw.shot("ask-open")

    for i, chunk in enumerate(mw.BRIEF_CHUNKS, 1):
        ask(chunk)
        # poller ~900ms + briefing reply
        time.sleep(8 if i == 1 else 6)
        mw.shot(f"ask-chunk-{i}")
        mw.extract(f"ask-chunk-{i}", mw.dump())
        mw.log("sample: " + mw.ui_blob(mw.dump())[:240].replace("\n", " | "))

    if not wait_brief_stickers(45):
        mw.log("WARN stickers still thin — continue to search anyway")

    ask("Passt, Suche starten")
    time.sleep(5)
    # also tap button if visible
    mw.tap_suche_starten(90)

    xml, txt = mw.wait_results(600)
    scored = mw.score_results(txt, xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": mw.serial(),
        "open_path": "cold+ask-enqueue",
        "chunks": mw.BRIEF_CHUNKS,
        **scored,
    }
    mw.write_report(report)
    mw.log(f"VERDICT {report['verdict']} {report['score']}")
    mw.log(str(report.get("checks")))
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
