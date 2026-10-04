#!/usr/bin/env python3
"""Short Uber live: ask with Handgepaeck included; wait Flughafen-Transfer; tap; check URL."""
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
Q = (
    "Flug morgen 18 Uhr von Hamburg nach Wien, nur Handgepaeck, "
    "bitte Taxi zum Flughafen vorbestellen"
)


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", require_qa_serial(), *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def dump() -> str:
    r = adb("shell", "uiautomator", "dump", "/data/local/tmp/ui.xml")
    if r.returncode != 0:
        return ""
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
        if n["click"] and blob.strip() in ("später", "✕", "x"):
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(0.5)
            return
        if n["click"] and "karte schließen" in blob:
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(0.5)
            return


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if "device" not in (adb("get-state").stdout or ""):
        print("DEVICE NOT READY", flush=True)
        return 3
    adb("reverse", "tcp:8791", "tcp:8791")
    dismiss()
    adb("logcat", "-c")
    req = urllib.request.Request(
        "http://127.0.0.1:8791/ask",
        data=Q.encode(),
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=12) as r:
        print("queued", r.read().decode()[:80], flush=True)

    found = False
    for i in range(22):
        time.sleep(5)
        dismiss()
        xml = dump()
        if not xml:
            print(f"poll[{i}] dump empty / offline?", flush=True)
            continue
        hits = [
            k
            for k in (
                "Flughafen-Transfer",
                "Uber",
                "Taxi",
                "Handgepäck",
                "Aufgabegepäck",
                "Wann fliegst",
            )
            if k in xml
        ]
        print(f"poll[{i}] {hits}", flush=True)
        if any(k in hits for k in ("Flughafen-Transfer", "Uber", "Taxi")):
            found = True
            # tap transfer
            for n in nodes(xml):
                blob = (n["text"] + " " + n["desc"]).lower()
                if not n["click"]:
                    continue
                if "flughafen-transfer" in blob or (
                    "uber" in blob and "spracherkennung" not in blob
                ):
                    print("TAP", n["text"] or n["desc"], flush=True)
                    adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
                    time.sleep(3)
                    break
            break

    xml = dump()
    (OUT / "short-flow.xml").write_text(xml or "", encoding="utf-8")
    try:
        shot = subprocess.check_output(
            [ADB, "-s", require_qa_serial(), "exec-out", "screencap", "-p"]
        )
        (OUT / "short-flow.png").write_bytes(shot)
    except Exception as e:
        print("shot fail", e, flush=True)

    log = adb("logcat", "-d", "-v", "brief").stdout or ""
    (OUT / "short-flow-log.txt").write_text(log, encoding="utf-8", errors="replace")
    uber = re.findall(r"https?://[^\s\"'<>]*uber[^\s\"'<>]*", log, re.I)
    intents = [
        ln
        for ln in log.splitlines()
        if re.search(r"uber|pickup_time|go/reserve|OPEN_URL", ln, re.I)
    ]
    scheduled = any("pickup_time" in u or "/go/reserve" in u for u in uber) or any(
        "pickup_time" in ln or "/go/reserve" in ln for ln in intents
    )
    report = {
        "found_chip": found,
        "scheduled_uber": scheduled,
        "uber_urls": uber[:8],
        "intent_hits": intents[:15],
    }
    (OUT / "short-flow-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(report, indent=2, ensure_ascii=False)[:2000], flush=True)
    print("PASS=", scheduled or found, flush=True)
    return 0 if scheduled or found else 1


if __name__ == "__main__":
    raise SystemExit(main())
