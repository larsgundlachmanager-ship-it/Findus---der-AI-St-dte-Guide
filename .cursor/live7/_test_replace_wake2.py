#!/usr/bin/env python3
"""Set 6:34, then force-replace to 7:26 via voice wording; assert Clock."""
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
    adb(
        "shell",
        "am start -a android.intent.action.VIEW "
        f"-d '{url}' -n {PKG}/.MainActivity",
    )
    print("ask", text)


def dump_clock(name: str) -> str:
    adb("shell", "am", "start", "-n", "com.google.android.deskclock/com.android.deskclock.DeskClock")
    time.sleep(2)
    adb("shell", "input", "swipe", "540", "900", "540", "1800", "280")
    time.sleep(1)
    remote = f"/sdcard/Download/{name}.xml"
    local = OUT / f"{name}.xml"
    adb("shell", "uiautomator", "dump", remote)
    adb("pull", remote, str(local))
    return local.read_text(encoding="utf-8", errors="ignore")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(16)

    adb("logcat", "-c")
    ask("Stell einen Wecker um 6:34")
    time.sleep(45)
    c1 = dump_clock("pre634")
    print("pre HAS_634", "06:34" in c1)

    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(3)
    ask("Aktualisiere den Wecker auf 7:26")
    time.sleep(50)

    c2 = dump_clock("post726")
    has_634 = "06:34" in c2
    has_726 = "07:26" in c2
    print("post HAS_634", has_634)
    print("post HAS_726", has_726)

    logs = adb("logcat", "-d", "-t", "5000").stdout or ""
    hits = [ln for ln in logs.splitlines() if "FindusAlarm" in ln]
    (OUT / "replace-findusalarm.txt").write_text("\n".join(hits[-100:]), encoding="utf-8")
    for ln in hits:
        if any(k in ln for k in ("dismiss", "06:34", "07:26", "cancelAlarm", "setAlarm")):
            print(ln.encode("ascii", "replace").decode())

    ok = has_726 and not has_634
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
