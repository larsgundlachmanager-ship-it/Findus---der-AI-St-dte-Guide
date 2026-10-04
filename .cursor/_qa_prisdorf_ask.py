from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r".cursor/_qa_prisdorf_v103")
OUT.mkdir(parents=True, exist_ok=True)


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


def texts(xml: str) -> list[str]:
    return [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip()]


def say(msg: str) -> None:
    print(msg.encode("ascii", "replace").decode("ascii"))


def bounds_center(xml: str, needle: str) -> tuple[int, int] | None:
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


adb(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "yorro://ask?q=Navigiere%20zum%20Marktkauf%20in%20Prisdorf",
)
time.sleep(14)
shot("06_ask_marktkauf.png")
xml = dump("06_ui.xml")
say("ASK: " + " | ".join(texts(xml)[:50]))

# Wait a bit more for nav offer / blue fill
time.sleep(8)
shot("07_ask_later.png")
xml = dump("07_ui.xml")
say("LATER: " + " | ".join(texts(xml)[:50]))

# Try open Orte seek and search Marktkauf
pt = bounds_center(xml, "Orte")
if pt:
    adb("shell", "input", "tap", str(pt[0]), str(pt[1]))
    time.sleep(1.5)
shot("08_orte.png")
xml = dump("08_ui.xml")
say("ORTE: " + " | ".join(texts(xml)[:50]))

# Tap map area near Peiner Hag if visible — try several taps
for i, (x, y) in enumerate([(520, 980), (600, 1100), (450, 1200), (700, 1000)]):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(1.8)
    shot(f"09_tap_{i}.png")
    xml = dump(f"09_tap_{i}.xml")
    ts = texts(xml)
    say(f"TAP{i}: " + " | ".join(ts[:40]))
    joined = " ".join(ts).lower()
    if "marktkauf" in joined or "meyer" in joined or "frische" in joined or "navigation" in joined:
        say("HIT popup")
        # category check
        bad = [b for b in ("supermarket", "cafe", "route starten oder mehr") if b in joined]
        say("BAD: " + str(bad or "none"))
        h = bounds_center(xml, "ffnungszeiten") or bounds_center(xml, "Öffnungszeiten")
        if h:
            adb("shell", "input", "tap", str(h[0]), str(h[1]))
            time.sleep(5)
            shot("10_hours.png")
            xml = dump("10_ui.xml")
            say("HOURS: " + " | ".join(texts(xml)[:60]))
        break

say("DONE")
