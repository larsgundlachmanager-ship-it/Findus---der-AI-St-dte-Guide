from pathlib import Path
import re

p = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7\diag-wake.txt")
raw = p.read_text(encoding="utf-8", errors="ignore")
keys = (
    "FindusAlarm",
    "alarmService",
    "nativeAlarmBridge",
    "just-do-it",
    "dateKey",
    "dismiss",
    "setNative",
    "typed ask",
    "Wecker",
    "prepareWake",
    "force wake",
    "pipeline",
    "ReferenceError",
    "TypeError",
    "ERROR",
    "Error:",
)
out = []
for ln in raw.splitlines():
    if "bluetooth" in ln.lower() or "ibs_handler" in ln.lower():
        continue
    if "APM_Audio" in ln or "wake_lock" in ln or "WLAN triggered" in ln:
        continue
    if any(k.lower() in ln.lower() for k in keys):
        out.append(ln)

Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7\diag-wake-clean.txt").write_text(
    "\n".join(out[-200:]), encoding="utf-8"
)
print("clean", len(out))
for ln in out[-80:]:
    print(ln[:220].encode("ascii", "replace").decode())
