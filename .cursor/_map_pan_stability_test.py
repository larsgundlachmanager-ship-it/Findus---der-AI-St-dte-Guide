#!/usr/bin/env python3
"""Live 5-min map pan stability test via adb — detects GPS snap-back in logcat."""

from __future__ import annotations

import random
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
DURATION_SEC = 300
SWIPE_INTERVAL_SEC = (2.5, 5.5)
BOOT_WAIT_SEC = 18

SNAP_FAIL = re.compile(r"\[map-cam\] SNAP-BACK detected")
SNAP_WARN = re.compile(r"\[map-cam\] restore user view")


def run(cmd: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
    )


def adb(*args: str, timeout: int = 30) -> str:
    p = run([ADB, *args], timeout=timeout)
    if p.returncode != 0 and p.stderr.strip():
        print(p.stderr.strip(), file=sys.stderr)
    return p.stdout


def screen_size() -> tuple[int, int]:
    out = adb("shell", "wm", "size")
    m = re.search(r"Physical size:\s*(\d+)x(\d+)", out)
    if not m:
        return 1080, 2400
    return int(m.group(1)), int(m.group(2))


def launch_app() -> None:
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb(
        "shell",
        "monkey",
        "-p",
        PKG,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )


def random_swipe(w: int, h: int) -> None:
    cx, cy = w // 2, h // 2
    dx = random.randint(-w // 3, w // 3)
    dy = random.randint(-h // 4, h // 4)
    x1, y1 = cx - dx // 2, cy - dy // 2
    x2, y2 = cx + dx, cy + dy
    dur = random.randint(280, 520)
    adb("shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(dur))


def poll_logcat(since: float) -> list[str]:
    out = adb("logcat", "-d", "-t", "200", "ReactNativeJS:V", "*:S", timeout=15)
    hits: list[str] = []
    for line in out.splitlines():
        if "map-cam" not in line:
            continue
        hits.append(line.strip())
    return hits


def main() -> int:
    print(f"[pan-test] device check…")
    devices = adb("devices").strip().splitlines()
    if len(devices) < 2 or "device" not in devices[1]:
        print("[pan-test] FAIL: no adb device", file=sys.stderr)
        return 2

    w, h = screen_size()
    print(f"[pan-test] screen {w}x{h}")

    adb("logcat", "-c")
    launch_app()
    print(f"[pan-test] boot wait {BOOT_WAIT_SEC}s…")
    time.sleep(BOOT_WAIT_SEC)

    seen_snaps: list[str] = []
    seen_restores: list[str] = []
    start = datetime.now()
    end = start + timedelta(seconds=DURATION_SEC)
    swipe_n = 0

    print(f"[pan-test] panning until {end.strftime('%H:%M:%S')} ({DURATION_SEC}s)…")
    while datetime.now() < end:
        random_swipe(w, h)
        swipe_n += 1
        time.sleep(random.uniform(*SWIPE_INTERVAL_SEC))
        for line in poll_logcat(start.timestamp()):
            if SNAP_FAIL.search(line):
                if line not in seen_snaps:
                    seen_snaps.append(line)
                    print(f"[pan-test] SNAP HIT #{len(seen_snaps)}: {line}")
            elif SNAP_WARN.search(line):
                if line not in seen_restores:
                    seen_restores.append(line)
                    print(f"[pan-test] restore (blocked): {line}")

        elapsed = (datetime.now() - start).total_seconds()
        if int(elapsed) % 30 == 0 and int(elapsed) > 0:
            print(
                f"[pan-test] … {int(elapsed)}s elapsed, {swipe_n} swipes, snaps={len(seen_snaps)}, restores={len(seen_restores)}"
            )

    print(
        f"[pan-test] DONE: {swipe_n} swipes in {DURATION_SEC}s, snap={len(seen_snaps)}, restore={len(seen_restores)}"
    )
    if seen_snaps:
        print("[pan-test] FAIL — snap-back detected:")
        for s in seen_snaps:
            print(f"  {s}")
        return 1
    print("[pan-test] PASS — no snap-back in logcat for 5 minutes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
