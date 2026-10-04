#!/usr/bin/env python3
"""Uber live v2: ask → baggage via askServer (avoid STT dialog) → tap transfer → URL check."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))
os.environ.setdefault("FINDUS_QA_SERIAL", "ce12171cccf9c0810c")
from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = ROOT / ".cursor" / "live9" / "taxi_uber"


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", require_qa_serial(), *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def ask(t: str) -> None:
    req = urllib.request.Request(
        "http://127.0.0.1:8791/ask",
        data=t.encode(),
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=12) as r:
        print("ASK", t[:70], "→", r.read().decode()[:60], flush=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/data/local/tmp/ui.xml")
    return adb("shell", "cat", "/data/local/tmp/ui.xml").stdout or ""


def nodes(xml: str):
    for n in re.findall(r"<node\b[^>]*>", xml):
        t = re.search(r'text="([^"]*)"', n)
        d = re.search(r'content-desc="([^"]*)"', n)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        yield {
            "text": t.group(1) if t else "",
            "desc": d.group(1) if d else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def dismiss() -> None:
    xml = dump()
    for n in nodes(xml):
        blob = (n["text"] + " " + n["desc"]).lower()
        if not n["click"]:
            continue
        if blob.strip() in ("später", "spaeter", "✕", "x") or "karte schließen" in blob:
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(0.4)
            return


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print("state", (adb("get-state").stdout or "").strip(), flush=True)
    adb("reverse", "tcp:8791", "tcp:8791")
    dismiss()
    adb("logcat", "-c")
    ask("Flug morgen 18 Uhr von Hamburg nach Wien, bitte Taxi zum Flughafen vorbestellen")
    bag_sent = False
    for i in range(24):
        time.sleep(4)
        dismiss()
        xml = dump()
        if not xml:
            print("poll", i, "empty", flush=True)
            continue
        hits = [
            k
            for k in (
                "Handgepäck",
                "Aufgabegepäck",
                "Flughafen-Transfer",
                "Uber",
                "Taxi",
                "Wann fliegst",
            )
            if k in xml
        ]
        print("poll", i, hits, flush=True)
        if (not bag_sent) and ("Handgepäck" in hits or "Aufgabegepäck" in hits):
            ask("Nur Handgepaeck")
            bag_sent = True
            continue
        if any(k in hits for k in ("Flughafen-Transfer", "Uber", "Taxi")):
            for n in nodes(xml):
                blob = (n["text"] + " " + n["desc"]).lower()
                if n["click"] and (
                    "flughafen-transfer" in blob
                    or ("uber" in blob and "sprache" not in blob)
                ):
                    print("TAP", n["text"] or n["desc"], flush=True)
                    adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
                    time.sleep(3)
                    break
            break

    log = adb("logcat", "-d", "-v", "brief").stdout or ""
    (OUT / "v2-log.txt").write_text(log, encoding="utf-8", errors="replace")
    xml = dump()
    (OUT / "v2.xml").write_text(xml, encoding="utf-8")
    try:
        shot = subprocess.check_output(
            [ADB, "-s", require_qa_serial(), "exec-out", "screencap", "-p"]
        )
        (OUT / "v2.png").write_bytes(shot)
    except Exception as e:
        print("shot fail", e, flush=True)

    uber = re.findall(r"https?://[^\s\"'<>]*uber[^\s\"'<>]*", log, re.I)
    intents = [
        ln
        for ln in log.splitlines()
        if re.search(r"uber|pickup_time|go/reserve|OPEN_URL|book_uber", ln, re.I)
    ]
    print("UBER", uber[:5], flush=True)
    print("INTENTS", len(intents), flush=True)
    for ln in intents[:12]:
        print(ln[:200], flush=True)
    sched = any("pickup_time" in u or "/go/reserve" in u for u in uber) or any(
        "pickup_time" in ln or "/go/reserve" in ln for ln in intents
    )
    print("PASS_SCHEDULED", sched, "UBER_N", len(uber), flush=True)
    (OUT / "v2-report.json").write_text(
        json.dumps(
            {"uber": uber[:8], "scheduled": sched, "intents": intents[:12]},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return 0 if sched else 1


if __name__ == "__main__":
    raise SystemExit(main())
