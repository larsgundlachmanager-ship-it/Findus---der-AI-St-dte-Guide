import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7")


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, "-s", S, *args], capture_output=True, text=True)


print("1) bring Yorro front")
adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
time.sleep(3)

print("2) clear log + ask 6:25 via UI script would be better; use deep link")
adb("logcat", "-c")
adb(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "yorro://ask?q=Stell%20einen%20Wecker%20um%206%3A25",
)
print("3) wait 40s with Yorro in foreground")
time.sleep(40)

print("4) dump Yorro UI")
adb("shell", "uiautomator", "dump", "/sdcard/Download/y625.xml")
adb("pull", "/sdcard/Download/y625.xml", str(OUT / "y625.xml"))
yx = (OUT / "y625.xml").read_text(encoding="utf-8", errors="ignore")
texts = [t for t in re.findall(r'text="([^"]+)"', yx) if t.strip()]
print("YORRO:", [t.encode("ascii", "replace").decode() for t in texts if re.search(r"6|Wecker|Uhr|Yo|Intern", t, re.I)][:25])

print("5) FindusAlarm logs")
logs = adb("logcat", "-d", "-t", "500")
for line in (logs.stdout or "").splitlines():
    if "FindusAlarm" in line or "alarmService" in line:
        print(line)

print("6) open Clock and check 06:25")
adb("shell", "am", "start", "-n", "com.google.android.deskclock/com.android.deskclock.DeskClock")
time.sleep(2)
for _ in range(5):
    adb("shell", "input", "swipe", "540", "900", "540", "1800", "280")
    time.sleep(0.25)
adb("shell", "uiautomator", "dump", "/sdcard/Download/c625.xml")
adb("pull", "/sdcard/Download/c625.xml", str(OUT / "c625.xml"))
cx = (OUT / "c625.xml").read_text(encoding="utf-8", errors="ignore")
print("HAS_625", "06:25" in cx)
print("TIMES", sorted(set(re.findall(r'content-desc="(0\d:\d\d)"', cx))))
