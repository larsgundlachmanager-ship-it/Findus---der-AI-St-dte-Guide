#!/usr/bin/env python3
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


def clock_has(hhmm: str) -> bool:
    adb("shell", "am", "start", "-n", "com.google.android.deskclock/com.android.deskclock.DeskClock")
    time.sleep(2)
    adb("shell", "input", "swipe", "540", "900", "540", "1800", "280")
    time.sleep(1)
    adb("shell", "uiautomator", "dump", "/sdcard/Download/clk.xml")
    adb("pull", "/sdcard/Download/clk.xml", str(OUT / "clk.xml"))
    return hhmm in (OUT / "clk.xml").read_text(encoding="utf-8", errors="ignore")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    # Seed old clock entry
    adb(
        "shell",
        "am start -a android.intent.action.SET_ALARM -c android.intent.category.DEFAULT "
        "--ei android.intent.extra.alarm.HOUR 6 --ei android.intent.extra.alarm.MINUTES 39 "
        "--ez android.intent.extra.alarm.SKIP_UI true "
        '--es android.intent.extra.alarm.MESSAGE "Yorro — Aufstehen" '
        "-n com.google.android.deskclock/com.android.deskclock.HandleSetApiCalls",
    )
    time.sleep(2)

    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(20)

    adb("logcat", "-c")
    # Put wake on timeline (same clock time)
    ask("Stell einen Wecker um 6:39")
    time.sleep(55)
    raw = adb("logcat", "-d", "-t", "3000").stdout or ""
    print("after sync FindusAlarm", sum(1 for ln in raw.splitlines() if "FindusAlarm" in ln))

    ask("Aktualisiere den Wecker auf 7:29")
    time.sleep(55)
    raw2 = adb("logcat", "-d", "-t", "5000").stdout or ""
    hits = [
        ln
        for ln in raw2.splitlines()
        if "FindusAlarm" in ln or "dismissClock" in ln or "nativeAlarmBridge" in ln
    ]
    (OUT / "logs-replace5.txt").write_text("\n".join(hits[-100:]), encoding="utf-8")
    print("--- replace logs ---")
    for ln in hits[-30:]:
        print(ln.encode("ascii", "replace").decode()[:200])

    # Bring Yorro? no — check clock
    has_639 = clock_has("06:39")
    has_729 = clock_has("07:29")
    print("HAS_639", has_639)
    print("HAS_729", has_729)
    ok = has_729 and not has_639
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
