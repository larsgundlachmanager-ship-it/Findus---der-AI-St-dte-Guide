# -*- coding: utf-8 -*-
import re
import subprocess
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7")

app_pid = subprocess.check_output(
    [ADB, "-s", SERIAL, "shell", "pidof", "-s", "de.findus.app"], text=True
).strip()
print("appPid=", app_pid)

logs = subprocess.check_output(
    [ADB, "-s", SERIAL, "logcat", "-d", "-t", "5000", f"--pid={app_pid}"],
    text=True,
    errors="replace",
)
hits = []
for line in logs.splitlines():
    low = line.lower()
    if any(
        k in low
        for k in (
            "timer",
            "findusalarm",
            "settimer",
            "early timer",
            "justdoit",
            "nav_route",
            "dauer",
            "läuft",
            "laeuft",
            "typedask",
            "devask",
            "gemini",
        )
    ):
        hits.append(line)
print("---- LOG HITS ----")
for h in hits[-80:]:
    print(h)

subprocess.run(
    [ADB, "-s", SERIAL, "shell", "uiautomator", "dump", "/sdcard/Download/ui.xml"],
    check=False,
)
subprocess.run(
    [ADB, "-s", SERIAL, "pull", "/sdcard/Download/ui.xml", str(OUT / "timer-qa.xml")],
    check=False,
)
xml = (OUT / "timer-qa.xml").read_text(encoding="utf-8", errors="ignore")
texts = []
for m in re.finditer(r'text="([^"]+)"', xml):
    t = m.group(1).replace("&#10;", " ").strip()
    if t and t not in texts and len(t) > 1:
        texts.append(t)
print("---- UI TEXTS ----")
print("\n".join(texts[:100]))

png = OUT / "timer-qa.png"
if png.exists():
    try:
        from PIL import Image

        im = Image.open(png)
        im.thumbnail((540, 960))
        im.save(OUT / "timer-qa-sm.png")
        print("shot ok", im.size)
    except Exception as e:
        print("shot err", e)
