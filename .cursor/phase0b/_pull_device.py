"""Pull Phase0B device artifacts after live ask."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\phase0b")
OUT.mkdir(exist_ok=True)


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, *args], capture_output=True, text=True, errors="ignore")


adb("pull", "/sdcard/Download/ui.xml", str(OUT / "aut_quiet_desk_outlet-device.xml"))
adb("pull", "/sdcard/Download/findus-now.png", str(OUT / "aut_quiet_desk_outlet-device.png"))

for src_name, dst_name in (
    ("phone-ask.png", "aut_quiet_desk_outlet-phone-ask.png"),
    ("phone-live.png", "aut_quiet_desk_outlet-phone-live.png"),
    ("phone-phase0b.png", "aut_quiet_desk_outlet-phone-phase0b.png"),
    ("phone-ask-sm.png", "aut_quiet_desk_outlet-phone-ask-sm.png"),
):
    src = Path(r"c:\Users\larsf\Findus 2.0\.cursor") / src_name
    if src.exists():
        shutil.copy(src, OUT / dst_name)

xml_path = OUT / "aut_quiet_desk_outlet-device.xml"
xml = xml_path.read_text(encoding="utf-8", errors="ignore") if xml_path.exists() else ""
texts = [t for t in re.findall(r'text="([^"]+)"', xml) if t.strip()]
(OUT / "aut_quiet_desk_outlet-device-texts.txt").write_text(
    "\n".join(texts[:120]), encoding="utf-8"
)
print("texts", len(texts))
(OUT / "aut_quiet_desk_outlet-device-texts.txt").write_text(
    "\n".join(texts[:120]), encoding="utf-8"
)
for t in texts[:45]:
    safe = t[:140].encode("ascii", "backslashreplace").decode("ascii")
    print("-", safe)

r = adb("logcat", "-d", "-t", "600")
keys = ("call1", "Steckdose", "Wifi", "Ruhig", "pitch", "Bridge", "ReactNativeJS", "wifi")
lines = [
    ln
    for ln in (r.stdout or "").splitlines()
    if any(k.lower() in ln.lower() for k in keys)
]
(OUT / "aut_quiet_desk_outlet-logcat.txt").write_text(
    "\n".join(lines[-100:]), encoding="utf-8"
)
print("logcat hits", len(lines))
for ln in lines[-20:]:
    print(ln[:220].encode("ascii", "backslashreplace").decode("ascii"))
