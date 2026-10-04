#!/usr/bin/env python3
"""Quick dump: kill stuck QA taps, screenshot + UI texts."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\phase76_nothing")
OUT.mkdir(parents=True, exist_ok=True)


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def main() -> int:
    print("dir", sorted(p.name for p in OUT.glob("*"))[:40])
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    (OUT / "now.png").write_bytes(data)
    print("shot now.png", len(data))
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui_now.xml")
    adb("pull", "/sdcard/Download/ui_now.xml", str(OUT / "ui_now.xml"))
    xml = (OUT / "ui_now.xml").read_text(encoding="utf-8", errors="ignore")
    texts: list[str] = []
    for n in re.findall(r"<node\b[^>]*>", xml):
        t = re.search(r'\btext="([^"]*)"', n)
        d = re.search(r'\bcontent-desc="([^"]*)"', n)
        for x in (t.group(1) if t else "", d.group(1) if d else ""):
            x = x.replace("&#10;", " ").strip()
            if x and len(x) < 100:
                texts.append(x)
    # unique preserve order
    seen = set()
    uniq = []
    for t in texts:
        if t in seen:
            continue
        seen.add(t)
        uniq.append(t)
    print("TEXTS", len(uniq))
    for t in uniq[:80]:
        print("-", t)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
