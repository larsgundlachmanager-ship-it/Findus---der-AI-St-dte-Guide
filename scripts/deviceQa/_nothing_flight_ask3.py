#!/usr/bin/env python3
"""Clear sticky nav/journey, flight ask, dump UI texts + shots on Nothing."""
from __future__ import annotations

import json
import re
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


def adb(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True)


def shot(name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    (OUT / f"{name}.png").write_bytes(data)
    print("shot", name)


def dump_texts(name: str) -> list[str]:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    raw = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "cat", "/sdcard/ui.xml"])
    (OUT / f"{name}.xml").write_bytes(raw)
    texts = re.findall(r'text="([^"]{2,})"', raw.decode("utf-8", "ignore"))
    (OUT / f"{name}-texts.txt").write_text("\n".join(texts), encoding="utf-8")
    interesting = [
        t
        for t in texts
        if re.search(
            r"flug|split|hamburg|fahrt|öpnv|opnv|klar|preis|€|euro|erinner|kiwi|ticket|abflug",
            t,
            re.I,
        )
    ]
    print("interesting:", [t.encode("ascii", "replace").decode("ascii") for t in interesting[:20]])
    return texts


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
    print("ask", text[:80])


def queue_ask(text: str) -> None:
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
    # Hard: App kill → sticky Nav/Tour weg, dann frisch starten
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.5)
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
    ask_deeplink("Navigation stoppen")
    time.sleep(3)
    shot("nothing-flight-v5-00-clear")
    dump_texts("nothing-flight-v5-00")
    time.sleep(1)
    queue_ask(Q)
    ask_deeplink(Q)
    time.sleep(8)
    shot("nothing-flight-v6-01")
    dump_texts("nothing-flight-v6-01")
    time.sleep(25)
    shot("nothing-flight-v6-02")
    dump_texts("nothing-flight-v6-02")
    time.sleep(30)
    shot("nothing-flight-v6-03")
    dump_texts("nothing-flight-v6-03")
    interesting = dump_texts("nothing-flight-v6-03")
    joined = "\n".join(interesting).lower()
    ok = ("kiwi" in joined) or ("aviasales" in joined) or ("preis" in joined) or ("vergleich" in joined)
    print("BUTTONS_OK" if ok else "BUTTONS_MISSING", flush=True)


if __name__ == "__main__":
    main()
