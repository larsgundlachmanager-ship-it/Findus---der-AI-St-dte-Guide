#!/usr/bin/env python3
"""Visual map snap-back detector via adb screencap (works on release builds)."""

from __future__ import annotations

import random
import struct
import subprocess
import sys
import time
import zlib
from datetime import datetime, timedelta

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
DURATION_SEC = 300


def adb(*args: str, timeout: int = 60) -> bytes:
    p = subprocess.run(
        [ADB, *args],
        capture_output=True,
        timeout=timeout,
    )
    if p.returncode != 0:
        err = p.stderr.decode("utf-8", errors="replace").strip()
        if err:
            print(err, file=sys.stderr)
    return p.stdout


def screen_size() -> tuple[int, int]:
    out = adb("shell", "wm", "size").decode("utf-8", errors="replace")
    import re

    m = re.search(r"Physical size:\s*(\d+)x(\d+)", out)
    if not m:
        return 1080, 2400
    return int(m.group(1)), int(m.group(2))


def screencap_png() -> bytes:
    raw = adb("exec-out", "screencap", "-p", timeout=90)
    return raw


def png_crc(chunk_type: bytes, data: bytes) -> int:
    return zlib.crc32(chunk_type + data) & 0xFFFFFFFF


def crop_map_center(png: bytes, w: int, h: int) -> bytes:
    """Crop central 55% where map tiles change most on pan."""
    import re

    m = re.search(br"IHDR(.{13})", png)
    if not m:
        return png
    iw, ih = struct.unpack(">II", m.group(1)[0:8])
    x0 = int(iw * 0.22)
    y0 = int(ih * 0.18)
    x1 = int(iw * 0.78)
    y1 = int(ih * 0.72)
    # Minimal PNG re-encode via PIL if available
    try:
        from io import BytesIO

        from PIL import Image

        im = Image.open(BytesIO(png)).convert("RGB")
        box = (x0, y0, x1, y1)
        out = BytesIO()
        im.crop(box).resize((160, 160)).save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return png


def img_diff_ratio(a: bytes, b: bytes) -> float:
    try:
        from io import BytesIO

        from PIL import Image
        import numpy as np

        ia = np.asarray(Image.open(BytesIO(a)).convert("RGB"), dtype=np.int16)
        ib = np.asarray(Image.open(BytesIO(b)).convert("RGB"), dtype=np.int16)
        if ia.shape != ib.shape:
            ib_img = Image.open(BytesIO(b)).convert("RGB").resize((ia.shape[1], ia.shape[0]))
            ib = np.asarray(ib_img, dtype=np.int16)
        mad = np.abs(ia - ib).mean()
        return float(mad) / 255.0
    except Exception:
        return 0.0 if a == b else 1.0


def launch_and_focus_map(w: int, h: int) -> None:
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
    time.sleep(14)
    # Boot-Jump abwarten, dann Karte kurz bewegen damit Baseline nicht GPS-only ist
    for _ in range(3):
        swipe(w, h)
        time.sleep(0.5)
    time.sleep(2.0)
    # Modals/Sheets wegtippen
    for _ in range(3):
        adb("shell", "input", "tap", str(w // 2), str(int(h * 0.12)))
        time.sleep(0.4)
    adb("shell", "input", "keyevent", "4")  # BACK
    time.sleep(0.8)


def swipe(w: int, h: int) -> None:
    cx, cy = w // 2, int(h * 0.52)
    # Große Swipes — Karte muss sichtbar wandern
    dirs = [
        (0, int(h * 0.22)),
        (0, -int(h * 0.22)),
        (int(w * 0.28), 0),
        (-int(w * 0.28), 0),
    ]
    dx, dy = random.choice(dirs)
    x1, y1 = cx - dx // 3, cy - dy // 3
    x2, y2 = cx + dx, cy + dy
    dur = random.randint(350, 650)
    adb("shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(dur))


def main() -> int:
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("[visual-pan] PIL missing — pip install pillow", file=sys.stderr)
        return 2

    w, h = screen_size()
    print(f"[visual-pan] {w}x{h}, {DURATION_SEC}s test")

    launch_and_focus_map(w, h)

    snaps: list[str] = []
    start = datetime.now()
    end = start + timedelta(seconds=DURATION_SEC)
    n = 0

    while datetime.now() < end:
        baseline = crop_map_center(screencap_png(), w, h)
        for _ in range(random.randint(2, 4)):
            swipe(w, h)
            time.sleep(0.35)
        time.sleep(1.2)
        panned = crop_map_center(screencap_png(), w, h)
        pan_diff = img_diff_ratio(baseline, panned)
        if pan_diff < 0.025:
            continue  # pan didn't move map enough
        time.sleep(7.0)
        after = crop_map_center(screencap_png(), w, h)
        revert_to_base = img_diff_ratio(baseline, after)
        stay_panned = img_diff_ratio(panned, after)
        n += 1
        if revert_to_base < 0.045 and stay_panned > 0.05 and pan_diff > 0.04:
            msg = (
                f"cycle={n} SNAP-BACK visual revert={revert_to_base:.3f} "
                f"pan={pan_diff:.3f} stay={stay_panned:.3f}"
            )
            snaps.append(msg)
            print(f"[visual-pan] FAIL {msg}")
        elif n % 8 == 0:
            elapsed = int((datetime.now() - start).total_seconds())
            print(f"[visual-pan] … {elapsed}s cycle={n} snaps={len(snaps)}")

    print(f"[visual-pan] DONE cycles={n} snaps={len(snaps)}")
    if n < 5:
        print("[visual-pan] FAIL — too few valid pan cycles (map not interactive?)", file=sys.stderr)
        return 2
    if snaps:
        for s in snaps:
            print(f"  {s}")
        return 1
    print("[visual-pan] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
