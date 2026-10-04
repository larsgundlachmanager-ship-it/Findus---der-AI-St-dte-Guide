from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
OUT = Path(r".cursor/_qa_prisdorf_v103")
OUT.mkdir(parents=True, exist_ok=True)


def adb(*args: str) -> str:
    r = subprocess.run(
        [ADB, "-s", SERIAL, *args], capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return (r.stdout or "") + (r.stderr or "")


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


def focus() -> str:
    out = adb("shell", "dumpsys", "window", "windows")
    for line in out.splitlines():
        if "mCurrentFocus" in line or "mFocusedApp" in line:
            return line.strip()
    return "?"


adb("shell", "am", "force-stop", "de.findus.app")
time.sleep(1)
adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
time.sleep(14)
say("FOCUS1: " + focus())
shot("40_boot.png")

# Wait for pack paints
time.sleep(8)
shot("41_after_wait.png")
xml = dump("41_ui.xml")
say("UI: " + " | ".join(texts(xml)[:30]))
say("FOCUS2: " + focus())

# Only continue if Yorro focused
if "de.findus.app" not in focus():
    adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
    time.sleep(5)

# Recenter tap (crosshair ~ top right)
adb("shell", "input", "tap", "930", "400")
time.sleep(1)

# Pan SE toward Peiner Hag — short swipes
for _ in range(6):
    if "de.findus.app" not in focus():
        say("LEFT_APP abort")
        break
    adb("shell", "input", "swipe", "280", "850", "720", "1350", "320")
    time.sleep(0.65)

shot("42_pan_se.png")
say("FOCUS3: " + focus())

# Tap commercial-looking zones
for i, (x, y) in enumerate([(520, 980), (600, 1100), (450, 1200), (700, 1000)]):
    if "de.findus.app" not in focus():
        break
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(2)
    shot(f"43_tap_{i}.png")
    xml = dump(f"43_tap_{i}.xml")
    ts = texts(xml)
    say(f"TAP{i}: " + " | ".join(ts[:35]))
    j = " ".join(ts).lower()
    if any(k in j for k in ("marktkauf", "meyer", "frische", "navigation", "ffnungszeiten", "supermarkt")):
        say("HIT")
        bad = [b for b in ("supermarket", " cafe", "route starten oder mehr") if b in j]
        say("BAD: " + str(bad or "none"))
        # hours
        for m in re.finditer(r"<node[^>]+>", xml):
            chunk = m.group(0)
            if "ffnungszeiten" not in chunk.lower():
                continue
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', chunk)
            if not b:
                continue
            x1, y1, x2, y2 = map(int, b.groups())
            adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
            time.sleep(6)
            shot("44_hours.png")
            xml = dump("44_ui.xml")
            say("HOURS: " + " | ".join(texts(xml)[:50]))
            break
        break

say("DONE focus=" + focus())
