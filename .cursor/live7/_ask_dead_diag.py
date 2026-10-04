# -*- coding: utf-8 -*-
import subprocess
import time
import urllib.request
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7")


def adb(*a):
    return subprocess.run(
        [ADB, "-s", SERIAL, *a], capture_output=True, text=True, errors="replace"
    )


adb("reverse", "tcp:8791", "tcp:8791")
adb("logcat", "-c")
req = urllib.request.Request(
    "http://127.0.0.1:8791/ask",
    data="Wie spaet ist es jetzt".encode("utf-8"),
    method="POST",
    headers={"Content-Type": "text/plain; charset=utf-8"},
)
print("ask", urllib.request.urlopen(req, timeout=5).read())
time.sleep(22)
pid = adb("shell", "pidof", "-s", "de.findus.app").stdout.strip()
print("pid", pid)
logs = adb("logcat", "-d", "-t", "2500", f"--pid={pid}").stdout
keys = (
    "ReactNativeJS",
    "got ask",
    "module2",
    "Gemini",
    "submit",
    "stt",
    "Error",
    "pipeline",
    "timer",
    "bridge",
    "voice",
    "hallo",
    "spaet",
    "Uhr",
)
lines = [ln for ln in logs.splitlines() if any(k in ln for k in keys)]
(OUT / "ask-dead-log.txt").write_text("\n".join(lines[-150:]), encoding="utf-8")
print("hits", len(lines))
for ln in lines[-50:]:
    print(ln.encode("ascii", "replace").decode("ascii"))
