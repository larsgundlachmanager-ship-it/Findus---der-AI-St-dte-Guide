#!/usr/bin/env python3
"""Tap Speisekarte / labeled button and capture."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9")
XML = OUT / "ui.xml"
EXTRACT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\extract_ui.py")


def adb(*args: str):
    return subprocess.run([ADB, *args], capture_output=True, text=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(XML))
    return XML.read_text(encoding="utf-8", errors="ignore")


def nodes(xml: str):
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def tap(x, y, w=0.5):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(w)


def main():
    needle = (sys.argv[1] if len(sys.argv) > 1 else "speisekarte").lower()
    tag = sys.argv[2] if len(sys.argv) > 2 else "p1-speisekarte"
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0

    xml = dump()
    # dismiss tip field / close first
    for n in nodes(xml):
        if not n["click"]:
            continue
        blob = (n["desc"] + " " + n["text"]).lower()
        if any(k in blob for k in ("tippfeld", "abbrechen")):
            print("dismiss", blob[:50])
            tap(n["cx"], n["cy"], 0.8)
            break

    xml = dump()
    hits = [
        n
        for n in nodes(xml)
        if n["click"] and needle in (n["desc"] + " " + n["text"]).lower()
    ]
    print("hits", len(hits), "for", needle)
    for h in hits[:6]:
        print(h["cx"], h["cy"], (h["desc"] or h["text"])[:70])
    if not hits:
        print("NO_HIT")
        return 2
    tap(hits[0]["cx"], hits[0]["cy"], wait)
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))
    xml = dump()
    (OUT / f"{tag}.xml").write_text(xml, encoding="utf-8")
    subprocess.run([sys.executable, str(EXTRACT), str(OUT / f"{tag}.xml")])
    print("CAPTURED", tag)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
