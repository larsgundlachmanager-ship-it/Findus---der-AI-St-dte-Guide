#!/usr/bin/env python3
"""ADB seeds 6:36, app syncs + replace to 7:27, assert old gone."""
from __future__ import annotations

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

    # Seed old alarm in Google Clock (like previously set by Yorro)
    adb(
        "shell",
        "am start -a android.intent.action.SET_ALARM "
        "-c android.intent.category.DEFAULT "
        "--ei android.intent.extra.alarm.HOUR 6 "
        "--ei android.intent.extra.alarm.MINUTES 36 "
        "--ez android.intent.extra.alarm.SKIP_UI true "
        '--es android.intent.extra.alarm.MESSAGE "Yorro — Aufstehen" '
        "-n com.google.android.deskclock/com.android.deskclock.HandleSetApiCalls",
    )
    time.sleep(2)

    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(16)

    # Sync timeline to 6:36 so replace finds existing
    adb("logcat", "-c")
    ask("Stell einen Wecker um 6:36")
    time.sleep(40)
    pre = dump_clock("pre636")
    print("pre HAS_636", "06:36" in pre)

    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(3)
    ask("Aktualisiere den Wecker auf 7:27")
    time.sleep(50)

    post = dump_clock("post727")
    has_636 = "06:36" in post
    has_727 = "07:27" in post
    print("post HAS_636", has_636)
    print("post HAS_727", has_727)

    logs = adb("logcat", "-d", "-t", "6000").stdout or ""
    hits = [ln for ln in logs.splitlines() if "FindusAlarm" in ln]
    (OUT / "replace-findusalarm.txt").write_text("\n".join(hits[-120:]), encoding="utf-8")
    for ln in hits:
        if any(k in ln for k in ("dismiss", "06:36", "07:27", "cancelAlarm", "setAlarmClock", "setAlarm ")):
            print(ln.encode("ascii", "replace").decode())

    ok = has_727 and not has_636
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
