# -*- coding: utf-8 -*-
import subprocess
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7")

app_pid = subprocess.check_output(
    [ADB, "-s", SERIAL, "shell", "pidof", "-s", "de.findus.app"], text=True
).strip()
logs = subprocess.check_output(
    [ADB, "-s", SERIAL, "logcat", "-d", "-t", "8000", f"--pid={app_pid}"],
    text=True,
    errors="replace",
)
keys = (
    "ReactNativeJS",
    "FindusAlarm",
    "runConcierge",
    "early timer",
    "typedAsk",
    "handsFree",
    "concierge",
    "Error",
    "WARN",
    "warn",
)
out = []
for line in logs.splitlines():
    if any(k in line for k in keys):
        out.append(line)
(OUT / "timer-qa-log.txt").write_text("\n".join(out[-200:]), encoding="utf-8")
print("wrote", len(out), "lines, showing last 100:")
for line in out[-100:]:
    print(line.encode("ascii", "replace").decode("ascii"))

# UI texts to file
xml_path = OUT / "timer-qa.xml"
if xml_path.exists():
    import re

    xml = xml_path.read_text(encoding="utf-8", errors="ignore")
    texts = []
    for m in re.finditer(r'text="([^"]+)"', xml):
        t = m.group(1).replace("&#10;", " ").strip()
        if t and t not in texts and len(t) > 1:
            texts.append(t)
    (OUT / "timer-qa-texts.txt").write_text("\n".join(texts), encoding="utf-8")
    print("---- UI ----")
    for t in texts[:60]:
        print(t.encode("ascii", "replace").decode("ascii"))

try:
    from PIL import Image

    im = Image.open(OUT / "timer-qa.png")
    im.thumbnail((540, 960))
    im.save(OUT / "timer-qa-sm.png")
except Exception as e:
    print("png", e)
