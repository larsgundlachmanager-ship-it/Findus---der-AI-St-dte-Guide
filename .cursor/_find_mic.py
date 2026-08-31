import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live10")


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True, text=True)


def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    p = OUT / "micfind.xml"
    adb("pull", "/sdcard/Download/ui.xml", str(p))
    return p.read_text(encoding="utf-8", errors="ignore")


time.sleep(2)
t = dump()
print("size", len(t))
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    blob = ((text.group(1) if text else "") + " " + (desc.group(1) if desc else "")).lower()
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if "mikro" in blob or "mic" in blob or ("timeline" in blob and 'clickable="true"' in n):
        print(repr(blob[:90]), b.group(0) if b else "", 'clickable="true"' in n)

# Try long-press style short swipe on mic area (legacy)
for cy in range(1700, 2200, 40):
    adb("shell", "input", "swipe", "540", str(cy), "540", str(cy), "60")
    time.sleep(1.2)
    t = dump()
    if 'text="Fragen"' in t or 'content-desc="Fragen"' in t or "EditText" in t:
        print("OPEN via swipe cy", cy)
        adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
        adb("pull", "/sdcard/Download/findus-now.png", str(OUT / "mic-open.png"))
        break
else:
    print("still closed")
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / "mic-closed.png"))
