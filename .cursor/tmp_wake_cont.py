import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7")
OUT.mkdir(parents=True, exist_ok=True)


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, "-s", S, *args], capture_output=True, text=True)


def dump(name: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    dest = OUT / name
    adb("pull", "/sdcard/Download/ui.xml", str(dest))
    return dest.read_text(encoding="utf-8", errors="ignore") if dest.exists() else ""


def clock_times(xml: str) -> list[str]:
    return sorted(set(re.findall(r'content-desc="(0\d:\d\d)"', xml)))


print("=== existing clock morning ===")
adb("shell", "am", "start", "-n", "com.google.android.deskclock/com.android.deskclock.DeskClock")
time.sleep(2)
adb("shell", "input", "tap", "200", "2280")
time.sleep(0.8)
for _ in range(6):
    adb("shell", "input", "swipe", "540", "900", "540", "1800", "280")
    time.sleep(0.25)
xml = dump("clock_check.xml")
print("TIMES", clock_times(xml))
print("HAS_757", "07:57" in xml)

# Fresh wake test 21:25 (tonight-ish unique) — use morning-ish 6:18 to spot easily
print("\n=== ask 6:18 via deep link after bring Yorro front ===")
adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
time.sleep(2.5)
