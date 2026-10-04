#!/usr/bin/env python3
"""E2E: set wake A, ask B, tap Aktualisieren, assert Clock has B not A."""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path
from urllib.parse import quote

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")


def adb(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [ADB, "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        errors="ignore",
    )


def ask(text: str) -> None:
    url = "yorro://ask?q=" + quote(text, safe="")
    cmd = (
        "am start -a android.intent.action.VIEW "
        f"-d '{url}' -n {PKG}/.MainActivity"
    )
    adb("shell", cmd)
    print("ask", text)


def dump(name: str) -> str:
    remote = f"/sdcard/Download/{name}.xml"
    local = OUT / f"{name}.xml"
    adb("shell", "uiautomator", "dump", remote)
    adb("pull", remote, str(local))
    return local.read_text(encoding="utf-8", errors="ignore")


def tap_label(xml: str, label: str) -> bool:
    for n in re.findall(r"<node [^/]*?/>", xml):
        if label not in n:
            continue
        m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not m:
            continue
        x = (int(m.group(1)) + int(m.group(3))) // 2
        y = (int(m.group(2)) + int(m.group(4))) // 2
        print("tap", label, x, y)
        adb("shell", "input", "tap", str(x), str(y))
        return True
    return False


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(16)

    adb("logcat", "-c")
    ask("Stell einen Wecker um 6:32")
    time.sleep(45)

    ask("Stell einen Wecker um 7:25")
    time.sleep(28)
    xml = dump("choice725")
    if not tap_label(xml, "Aktualisieren"):
        texts = re.findall(r'text="([^"]+)"', xml)
        print("NO_AKTUALISIEREN_BTN", [t for t in texts if t.strip()][:40])
        return 2
    time.sleep(14)

    adb("shell", "am", "start", "-n", "com.google.android.deskclock/com.android.deskclock.DeskClock")
    time.sleep(2)
    adb("shell", "input", "swipe", "540", "900", "540", "1800", "280")
    time.sleep(1)
    clock = dump("c725")
    has_632 = "06:32" in clock
    has_725 = "07:25" in clock
    print("HAS_632", has_632)
    print("HAS_725", has_725)

    logs = adb("logcat", "-d", "-t", "4000").stdout or ""
    for ln in logs.splitlines():
        if "FindusAlarm" not in ln:
            continue
        low = ln.lower()
        if any(k in low for k in ("dismiss", "06:32", "07:25", "handleapi", "setalarm", "cancel")):
            print(ln)

    ok = has_725 and not has_632
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
