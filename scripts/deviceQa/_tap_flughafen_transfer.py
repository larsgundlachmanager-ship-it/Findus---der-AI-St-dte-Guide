#!/usr/bin/env python3
"""Tap Flughafen-Transfer / Uber chips; harvest intent URLs from logcat."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
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


def tap_match(*needles: str) -> bool:
    xml = dump()
    for n in nodes(xml):
        blob = (n["text"] + " " + n["desc"]).lower()
        if not n["click"]:
            continue
        if any(x.lower() in blob for x in needles):
            # avoid false: Einstellungen öffnen / app settings
            if "spracherkennung" in blob or "app-info" in blob:
                continue
            if "einstellungen öffnen" in blob:
                continue
            print("TAP", n["text"] or n["desc"], flush=True)
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(2.0)
            return True
    return False


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    # dismiss speech if present
    tap_match("SPÄTER")
    adb("logcat", "-c")
    ok = tap_match("Flughafen-Transfer", "Uber", "Taxi ·", "Fahrt mit Uber")
    if not ok:
        print("NO CHIP", flush=True)
        xml = dump()
        (OUT / "no-chip.xml").write_text(xml, encoding="utf-8")
        return 2
    time.sleep(3)
    # dump after tap (may be chrome/uber)
    xml = dump()
    (OUT / "after-transfer.xml").write_text(xml, encoding="utf-8")
    data = subprocess.check_output(
        [ADB, "-s", require_qa_serial(), "exec-out", "screencap", "-p"]
    )
    (OUT / "after-transfer.png").write_bytes(data)

    log = adb("logcat", "-d", "-v", "brief").stdout or ""
    (OUT / "after-transfer-log.txt").write_text(log, encoding="utf-8", errors="replace")
    urls = re.findall(
        r"https?://[^\s\"'<>]*(?:uber\.com|partner\.|flughafen)[^\s\"'<>]*",
        log,
        re.I,
    )
    # also ActivityManager start intents
    intents = [
        ln
        for ln in log.splitlines()
        if re.search(r"START.*uber|VIEW.*uber|pickup_time|go/reserve|OPEN_URL|book_uber", ln, re.I)
    ]
    print("--- URLS ---", flush=True)
    for u in urls[:15]:
        print(u[:240], flush=True)
    print("--- INTENTS ---", flush=True)
    for ln in intents[:20]:
        print(ln[:240], flush=True)

    # activity dumpsys
    act = adb("shell", "dumpsys", "activity", "activities").stdout or ""
    m = re.search(r"mResumedActivity:.*", act)
    print("RESUMED", m.group(0)[:200] if m else "?", flush=True)

    has = any("pickup_time" in u or "/go/reserve" in u for u in urls) or any(
        "pickup_time" in ln or "/go/reserve" in ln for ln in intents
    )
    print("PASS_SCHEDULED_UBER=", has, flush=True)
    # back to findus
    adb("shell", "input", "keyevent", "4")
    time.sleep(1)
    adb(
        "shell",
        "monkey",
        "-p",
        "de.findus.app",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    return 0 if has else 1


if __name__ == "__main__":
    raise SystemExit(main())
