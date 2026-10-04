#!/usr/bin/env python3
"""Continue flight baggage chip → poll Taxi/Uber → Timeline."""
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


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", require_qa_serial(), *args],
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


def tap_label(*labs: str) -> bool:
    xml = dump()
    for n in nodes(xml):
        blob = (n["text"] + " " + n["desc"]).lower()
        if any(l.lower() in blob for l in labs) and n["click"]:
            print("TAP", n["text"] or n["desc"], n["cx"], n["cy"], flush=True)
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(1.2)
            return True
    return False


def texts_of(xml: str) -> list[str]:
    out: list[str] = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            if s and len(s) > 1 and s not in out:
                out.append(s)
    return out


def shot(name: str) -> None:
    data = subprocess.check_output(
        [ADB, "-s", require_qa_serial(), "exec-out", "screencap", "-p"]
    )
    (OUT / name).write_bytes(data)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    tap_label("SPÄTER", "später")
    if not tap_label("Handgepäck", "Handgepaeck"):
        tap_label("Aufgabegepäck", "Aufgabegepaeck")
    time.sleep(3)

    for i in range(24):
        xml = dump()
        hits = [k for k in ("Uber", "Taxi", "Flughafen", "Los ") if k in xml]
        texts = texts_of(xml)
        print(f"poll[{i}] hits={hits} sample={texts[:10]}", flush=True)
        if "Uber" in hits or "Taxi" in hits:
            tap_label("Uber", "Taxi ·", "Taxi")
            time.sleep(2)
            break
        if any("gepäck" in t.lower() for t in texts):
            tap_label("Handgepäck")
        time.sleep(4)

    xml = dump()
    (OUT / "after-bag.xml").write_text(xml, encoding="utf-8")
    shot("after-bag.png")
    texts = texts_of(xml)
    (OUT / "after-bag-texts.txt").write_text("\n".join(texts), encoding="utf-8")
    print("--- FINAL ---", flush=True)
    print("\n".join(texts[:50]), flush=True)

    log = adb("logcat", "-d", "-v", "brief", "*:I").stdout or ""
    urls = re.findall(r"https?://(?:m\.)?uber\.com/[^\s\"'<>]+", log, re.I)
    print("UBER_COUNT", len(urls), flush=True)
    for u in urls[:8]:
        print(
            "reserve",
            "/go/reserve" in u,
            "pickup",
            "pickup_time" in u,
            u[:200],
            flush=True,
        )

    tap_label("Timeline")
    time.sleep(2)
    # dismiss speech dialog if it blocks
    tap_label("SPÄTER")
    time.sleep(1)
    xml = dump()
    (OUT / "timeline2.xml").write_text(xml, encoding="utf-8")
    t2 = texts_of(xml)
    (OUT / "timeline2-texts.txt").write_text("\n".join(t2), encoding="utf-8")
    shot("timeline2.png")
    print("--- TIMELINE ---", flush=True)
    print("\n".join(t2[:40]), flush=True)
    ok = bool(urls) or any(re.search(r"Uber|Taxi", t, re.I) for t in texts + t2)
    print("PASS=", ok, flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
