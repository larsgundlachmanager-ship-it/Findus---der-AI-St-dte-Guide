from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r".cursor/_qa_prisdorf_v103")


def adb(*args: str) -> None:
    subprocess.run([ADB, "-s", SERIAL, *args], check=False)


def shot(name: str) -> None:
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    (OUT / name).write_bytes(data)
    print("shot", name, len(data))


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/yorro_ui.xml")
    adb("pull", "/sdcard/yorro_ui.xml", str(OUT / "x.xml"))
    return (OUT / "x.xml").read_text(encoding="utf-8", errors="replace")


# Force kill and reopen — clean map
adb("shell", "am", "force-stop", "de.findus.app")
time.sleep(1.5)
adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
time.sleep(12)
shot("70_clean_boot.png")
xml = dump()
texts = [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip()]
print("boot", texts[:20])
# If settings, tap Schließen by coords top-right
if any("Einstellung" in t or "Stadtauswahl" in t or "Speichern" in t for t in texts):
    print("settings open — tapping Schließen coords")
    adb("shell", "input", "tap", "980", "160")
    time.sleep(1.5)
    shot("71_after_close.png")
    xml = dump()
    texts = [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip()]
    print("after", texts[:20])

shot("72_final_map.png")
