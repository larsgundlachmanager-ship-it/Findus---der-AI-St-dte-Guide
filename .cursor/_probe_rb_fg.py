#!/usr/bin/env python3
"""Quick: bring Findus RB to foreground and dump texts."""
import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\gap_inventory")


def adb(*a):
    return subprocess.run([ADB, "-s", S, *a], capture_output=True, text=True, encoding="utf-8", errors="replace")


OUT.mkdir(parents=True, exist_ok=True)
adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
adb("shell", "am", "force-stop", PKG)
time.sleep(0.8)
adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
time.sleep(3.5)
adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "findus://reisebuero", PKG)
time.sleep(3.0)
adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
adb("pull", "/sdcard/Download/ui.xml", str(OUT / "probe.xml"))
xml = (OUT / "probe.xml").read_text(encoding="utf-8", errors="ignore")
texts = []
for n in re.findall(r"<node\b[^>]*>", xml):
    t = re.search(r'\btext="([^"]*)"', n)
    d = re.search(r'\bcontent-desc="([^"]*)"', n)
    for s in ((t.group(1) if t else ""), (d.group(1) if d else "")):
        s = (s or "").strip()
        if s and len(s) < 90:
            texts.append(s)
print("\n".join(texts[:80]))
print("--- count", len(texts))
