import subprocess
import time
import sys
from pathlib import Path
import re

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
SERIAL = "00143157P001105"
OUT = Path(r"c:/Users/larsf/Findus 2.0/.cursor/live7")


def adb(*args):
    r = subprocess.run(
        ["adb", "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return (r.stdout or "") + (r.stderr or "")


print("foreground app")
adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
time.sleep(2)
print(adb("shell", "dumpsys", "window", "windows")[-500:])

# long-press settings (sometimes Pressable needs pressIn duration)
print("long tap settings")
adb("shell", "input", "swipe", "886", "2262", "886", "2262", "400")
time.sleep(2)

adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
adb("pull", "/sdcard/ui.xml", str(OUT / "nothing-longtap.xml"))
t = (OUT / "nothing-longtap.xml").read_text(encoding="utf-8", errors="replace")
print("bytes", len(t))
hits = []
for m in re.finditer(r'(?:content-desc|text)="([^"]{3,80})"', t):
    s = m.group(1)
    if any(k in s.lower() for k in ("profil", "stimme", "schlie", "reise", "allgemein", "charakter")):
        hits.append(s)
print("overlay hits", hits[:20] or "none")

# try compass
print("tap compass")
adb("shell", "input", "tap", "860", "328")
time.sleep(1)
adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
adb("pull", "/sdcard/ui.xml", str(OUT / "nothing-compass.xml"))
t2 = (OUT / "nothing-compass.xml").read_text(encoding="utf-8", errors="replace")
print("bearing/norden changed?", "Blickrichtung" in t2 or "Norden oben" in t2)
# explore line still there
print("explore", "erkundet" in t2)
