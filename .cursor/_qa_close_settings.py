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


def dump(name: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/yorro_ui.xml")
    adb("pull", "/sdcard/yorro_ui.xml", str(OUT / name))
    return (OUT / name).read_text(encoding="utf-8", errors="replace")


def center(xml: str, needle: str) -> tuple[int, int] | None:
    for m in re.finditer(r"<node[^>]+>", xml):
        chunk = m.group(0)
        if needle.lower() not in chunk.lower():
            continue
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', chunk)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        return (x1 + x2) // 2, (y1 + y2) // 2
    return None


# Close settings if open
for _ in range(4):
    xml = dump("close.xml")
    c = center(xml, "Schlie")
    if c:
        adb("shell", "input", "tap", str(c[0]), str(c[1]))
        time.sleep(1.2)
        continue
    break

time.sleep(1)
shot("60_map.png")
xml = dump("60_ui.xml")
print("texts", [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip()][:25])
