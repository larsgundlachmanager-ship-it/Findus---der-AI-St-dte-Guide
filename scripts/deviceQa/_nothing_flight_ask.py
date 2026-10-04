#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import time
from pathlib import Path
from urllib.parse import quote

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.tmp\device-qa")
Q = (
    "Ich brauche einen Flieger vom 27.3. bis zum 10.4. "
    "Such mir einen Flug von Hamburg nach Split raus."
)


def adb(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [ADB, "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        errors="ignore",
    )


def shot(name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    (OUT / f"{name}.png").write_bytes(data)
    print("shot", name, "bytes", len(data))


def main() -> None:
    # cold-ish start after install
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.0)
    adb(
        "shell",
        "monkey",
        "-p",
        PKG,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    time.sleep(8.0)
    shot("nothing-flight-00-home")
    url = "yorro://ask?q=" + quote(Q, safe="")
    adb(
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        url,
        "-n",
        f"{PKG}/.MainActivity",
    )
    print("deeplink", Q)
    time.sleep(4)
    shot("nothing-flight-v3-01-start")
    time.sleep(35)
    shot("nothing-flight-v3-02-result")
    time.sleep(20)
    shot("nothing-flight-v3-03-later")
    log = adb("logcat", "-d", "-t", "1200").stdout or ""
    keys = (
        "flight_advisor",
        "solo_flight",
        "cheapFlight",
        "wishPitch",
        "researchCheap",
        "OPEN_URL",
        "reisebuero",
        "pitch_module",
        "call1_soft",
    )
    hits = [ln for ln in log.splitlines() if any(k.lower() in ln.lower() for k in keys)]
    for ln in hits[-30:]:
        print("LOG", ln[:220])


if __name__ == "__main__":
    main()
