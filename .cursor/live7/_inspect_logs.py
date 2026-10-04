import subprocess
from pathlib import Path

ADB = [
    r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe",
    "-s",
    "00143157P001105",
]
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")
r = subprocess.run(ADB + ["logcat", "-d", "-t", "8000"], capture_output=True, text=True, errors="ignore")
raw = r.stdout or ""
keys = (
    "FindusAlarm",
    "alarmService",
    "nativeAlarmBridge",
    "dismissClock",
    "dateKey",
    "just-do-it",
    "ReactNativeJS",
)
hits = []
for ln in raw.splitlines():
    if any(k.lower() in ln.lower() for k in keys):
        if "bluetooth" in ln.lower() or "ibs_handler" in ln.lower():
            continue
        hits.append(ln)
(OUT / "replace-debug.txt").write_text("\n".join(hits[-200:]), encoding="utf-8")
print("hits", len(hits))
for ln in hits[-40:]:
    print(ln.encode("ascii", "replace").decode())
