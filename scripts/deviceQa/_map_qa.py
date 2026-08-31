#!/usr/bin/env python3
"""Interactive map QA taps on the live phone."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, text=True)


def tap(x: int, y: int, wait: float = 0.7) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def swipe(x1: int, y1: int, x2: int, y2: int, ms: int = 400) -> None:
    adb("shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(ms))
    time.sleep(0.6)


def shot(tag: str) -> None:
    dest = OUT / f"{tag}.png"
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    dest.write_bytes(data)
    try:
        from PIL import Image

        im = Image.open(dest)
        im.thumbnail((540, 960))
        im.save(OUT / f"{tag}-sm.png")
    except Exception:
        pass
    print("shot", dest)


def type_ascii(text: str) -> None:
    escaped = text.replace(" ", "%s").replace("'", "")
    adb("shell", "input", "text", escaped)
    time.sleep(0.4)


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "tap":
        tap(int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]) if len(sys.argv) > 4 else 0.7)
        return 0
    if cmd == "swipe":
        swipe(*map(int, sys.argv[2:7]))
        return 0
    if cmd == "shot":
        shot(sys.argv[2])
        return 0
    if cmd == "type":
        type_ascii(" ".join(sys.argv[2:]))
        return 0
    if cmd == "key":
        adb("shell", "input", "keyevent", sys.argv[2])
        return 0
    print("usage: tap x y [wait] | swipe x1 y1 x2 y2 ms | shot TAG | type TEXT | key CODE")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
