import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
XML = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\ui.xml")


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True, text=True)


def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(XML))
    return XML.read_text(encoding="utf-8", errors="ignore")


xml = dump()
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
    if 'clickable="true"' not in n:
        continue
    t = re.search(r'text="([^"]*)"', n)
    d = re.search(r'content-desc="([^"]*)"', n)
    blob = ((t.group(1) if t else "") + " " + (d.group(1) if d else "")).lower()
    if any(k in blob for k in ("schließen", "schliessen", "schlie")):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
            print("closed", blob[:50])
            time.sleep(0.8)
            break
else:
    print("no close btn")
