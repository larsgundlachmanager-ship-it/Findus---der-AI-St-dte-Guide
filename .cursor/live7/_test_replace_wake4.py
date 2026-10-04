#!/usr/bin/env python3
"""Minimal replace test with mid-point log checks; stay in Yorro."""
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


def alarm_logs(tag: str) -> None:
    raw = adb("logcat", "-d", "-t", "4000").stdout or ""
    hits = [
        ln
        for ln in raw.splitlines()
        if "FindusAlarm" in ln
        or "alarmService" in ln
        or "nativeAlarmBridge" in ln
        or "just-do-it after manager" in ln
    ]
    path = OUT / f"logs-{tag}.txt"
    path.write_text("\n".join(hits[-80:]), encoding="utf-8")
    print(tag, "log_hits", len(hits))
    for ln in hits[-12:]:
        print(" ", ln.encode("ascii", "replace").decode()[:180])


def clock_has(hhmm: str) -> bool:
    adb("shell", "am", "start", "-n", "com.google.android.deskclock/com.android.deskclock.DeskClock")
    time.sleep(2)
    adb("shell", "input", "swipe", "540", "900", "540", "1800", "280")
    time.sleep(1)
    adb("shell", "uiautomator", "dump", "/sdcard/Download/clk.xml")
    adb("pull", "/sdcard/Download/clk.xml", str(OUT / "clk.xml"))
    t = (OUT / "clk.xml").read_text(encoding="utf-8", errors="ignore")
    return hhmm in t


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(18)

    adb("logcat", "-c")
    ask("Stell einen Wecker um 6:38")
    time.sleep(50)
    alarm_logs("after638")

    ask("Aktualisiere den Wecker auf 7:28")
    time.sleep(50)
    alarm_logs("after728")

    has_638 = clock_has("06:38")
    has_728 = clock_has("07:28")
    print("HAS_638", has_638)
    print("HAS_728", has_728)
    ok = has_728 and not has_638
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
