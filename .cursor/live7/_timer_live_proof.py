# -*- coding: utf-8 -*-
"""Wait for boot, ask timer, capture logs/UI."""
import subprocess
import time
import urllib.request
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7")
PKG = "de.findus.app"


def adb(*args):
    return subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, text=True, errors="replace")


adb("reverse", "tcp:8791", "tcp:8791")
adb("shell", "am", "force-stop", PKG)
time.sleep(1)
adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
print("waiting for boot…")
time.sleep(25)
adb("logcat", "-c")

req = urllib.request.Request(
    "http://127.0.0.1:8791/ask",
    data=b"Timer 2 Minuten",
    method="POST",
    headers={"Content-Type": "text/plain"},
)
print("ask", urllib.request.urlopen(req, timeout=5).read())
time.sleep(18)

app_pid = adb("shell", "pidof", "-s", PKG).stdout.strip()
print("pid", app_pid)
logs = adb("logcat", "-d", "-t", "4000", f"--pid={app_pid}").stdout
hits = [
    ln
    for ln in logs.splitlines()
    if any(
        k in ln
        for k in (
            "timer",
            "Timer",
            "FindusAlarm",
            "setTimer",
            "devAsk",
            "duration missing",
            "early timer",
            "ReactNativeJS",
        )
    )
]
(OUT / "timer-qa3-log.txt").write_text("\n".join(hits[-120:]), encoding="utf-8")
print("log hits", len(hits))
for ln in hits[-40:]:
    print(ln.encode("ascii", "replace").decode("ascii"))

adb("shell", "screencap", "-p", "/sdcard/Download/timer-qa3.png")
adb("pull", "/sdcard/Download/timer-qa3.png", str(OUT / "timer-qa3.png"))
# dump UI with retries
for _ in range(3):
    r = adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    if r.returncode == 0:
        break
    time.sleep(2)
adb("pull", "/sdcard/Download/ui.xml", str(OUT / "timer-qa3.xml"))
xml = (OUT / "timer-qa3.xml").read_text(encoding="utf-8", errors="ignore")
import re

texts = []
for m in re.finditer(r'text="([^"]+)"', xml):
    t = m.group(1).replace("&#10;", " ").strip()
    if t and t not in texts and len(t) > 1:
        texts.append(t)
(OUT / "timer-qa3-texts.txt").write_text("\n".join(texts), encoding="utf-8")
print("UI:")
for t in texts[:40]:
    print(t.encode("ascii", "replace").decode("ascii"))
