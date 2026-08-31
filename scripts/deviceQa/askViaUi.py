#!/usr/bin/env python3
"""Live device QA — type + ESC + tap Fragen (visible when IME down)."""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.tmp\device-qa")


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, *args], capture_output=True)


def shot(name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = subprocess.check_output([ADB, "exec-out", "screencap", "-p"])
    (OUT / f"{name}.png").write_bytes(data)
    try:
        from PIL import Image

        im = Image.open(OUT / f"{name}.png")
        im.thumbnail((420, 900))
        im.save(OUT / f"{name}-sm.png")
    except Exception:
        pass
    print("shot", name)


def tap(x: int, y: int, wait: float = 0.4) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def ask(text: str, tag: str, wait_s: float = 25.0) -> None:
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(2.0)
    # dismiss any open modal with Abbrechen (left)
    tap(280, 1280, 0.5)
    tap(540, 2040, 1.6)  # mic short → modal
    shot(f"{tag}-01-modal")
    tap(540, 1050, 0.35)
    # clear: move to end and many deletes (best effort)
    for _ in range(80):
        adb("shell", "input", "keyevent", "67")  # DEL
    time.sleep(0.2)
    enc = text.replace(" ", "%s")
    adb("shell", "input", "text", enc)
    time.sleep(0.5)
    shot(f"{tag}-02-typed")
    # hide IME via keyboard chevron area (bottom-left of nav) — not BACK
    tap(80, 2300, 0.5)
    adb("shell", "input", "keyevent", "111")
    time.sleep(0.6)
    shot(f"{tag}-03-ime")
    # Fragen button when modal fully visible (from live screenshots ~860,1280)
    for y in (1260, 1300, 1220, 1340, 1180):
        tap(860, y, 0.35)
    time.sleep(1.0)
    shot(f"{tag}-04-submitted")
    time.sleep(wait_s)
    shot(f"{tag}-05-result")
    print("done", text)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("text", nargs="?", default="Bring mich zum naechsten Brotladen")
    p.add_argument("--tag", default="qa")
    p.add_argument("--wait", type=float, default=25.0)
    args = p.parse_args()
    ask(args.text, args.tag, args.wait)
    return 0


if __name__ == "__main__":
    sys.exit(main())
