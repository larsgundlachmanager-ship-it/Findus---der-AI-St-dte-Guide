import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7")


def adb(*args: str) -> None:
    subprocess.run([ADB, "-s", S, *args], capture_output=True, text=True)


adb("shell", "am", "start", "-n", "com.google.android.deskclock/com.android.deskclock.DeskClock")
time.sleep(2.2)
adb("shell", "input", "tap", "200", "2280")
time.sleep(1.0)
for _ in range(7):
    adb("shell", "input", "swipe", "540", "900", "540", "1800", "280")
    time.sleep(0.28)

adb("shell", "uiautomator", "dump", "/sdcard/Download/clock618.xml")
dest = OUT / "clock618.xml"
adb("pull", "/sdcard/Download/clock618.xml", str(dest))
xml = dest.read_text(encoding="utf-8", errors="ignore") if dest.exists() else ""
print("size", len(xml))
times = sorted(set(re.findall(r'content-desc="(0\d:\d\d)"', xml)))
print("TIMES", times)
print("HAS_618", "06:18" in xml)
print("HAS_757", "07:57" in xml)
for m in re.findall(r'content-desc="([^"]+)"', xml):
    if any(x in m for x in ("06:18", "07:57", "Yorro", "Findus")):
        print("HIT", m.encode("ascii", "replace").decode())
