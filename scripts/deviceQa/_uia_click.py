#!/usr/bin/env python3
"""Tap the first clickable whose text/desc contains the query (case-insensitive)."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
XML = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7\ui.xml")


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, text=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(XML))
    return XML.read_text(encoding="utf-8", errors="ignore")


def main() -> int:
    q = " ".join(sys.argv[1:]).lower().strip()
    if not q:
        print("need query")
        return 2
    t = dump()
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
        if 'clickable="true"' not in n:
            continue
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        blob = ((text.group(1) if text else "") + " " + (desc.group(1) if desc else "")).lower()
        if q not in blob or not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        print(f"tap {cx},{cy}  {blob[:80]}")
        adb("shell", "input", "tap", str(cx), str(cy))
        return 0
    print("not found", q)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
