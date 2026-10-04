#!/usr/bin/env python3
"""Cancel sticky nav, then flight ask via deeplink + askServer on Nothing."""
from __future__ import annotations

import subprocess
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.tmp\device-qa")
Q = (
    "Such mir guenstige Fluege von Hamburg nach Split "
    "vom 27.3.2026 bis 10.4.2026 raus."
)


def adb(*args: str) -> None:
    subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True)


def shot(name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    (OUT / f"{name}.png").write_bytes(data)
    print("shot", name)


def ask_deeplink(text: str) -> None:
    url = "yorro://ask?q=" + quote(text, safe="")
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
    print("ask", text)


def queue_ask(text: str) -> None:
    body = ('{"q":' + repr(text).replace("'", '"') + "}").encode("utf-8")
    # proper json
    import json

    data = json.dumps({"q": text}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:8791/ask",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            print("queued", r.read().decode())
    except Exception as e:
        print("queue fail", e)


def main() -> None:
    adb("reverse", "tcp:8791", "tcp:8791")
    # cancel nav first
    ask_deeplink("Navigation stoppen")
    time.sleep(4)
    shot("nothing-flight-v4-00-stopnav")
    # flight ask
    queue_ask(Q)
    ask_deeplink(Q)
    time.sleep(5)
    shot("nothing-flight-v4-01")
    time.sleep(30)
    shot("nothing-flight-v4-02")
    time.sleep(25)
    shot("nothing-flight-v4-03")


if __name__ == "__main__":
    main()
