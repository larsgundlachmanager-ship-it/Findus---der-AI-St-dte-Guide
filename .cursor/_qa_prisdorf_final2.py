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
        [ADB, "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
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


def is_yorro(xml: str) -> bool:
    blob = " ".join(texts(xml)).lower()
    return "timeline" in blob and "orte" in blob and "einst" in blob


# Ensure app
adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
time.sleep(6)
xml = dump("50_ui.xml")
say("START: " + " | ".join(texts(xml)[:25]))
shot("50_start.png")
if not is_yorro(xml):
    adb("shell", "am", "force-stop", "de.findus.app")
    time.sleep(1)
    adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
    time.sleep(10)
    xml = dump("50b_ui.xml")
    shot("50b_start.png")
    say("RESTART: " + " | ".join(texts(xml)[:25]))

# Recenter
adb("shell", "input", "tap", "930", "400")
time.sleep(1.2)

# Pan SE
for n in range(7):
    adb("shell", "input", "swipe", "260", "820", "760", "1380", "300")
    time.sleep(0.55)
shot("51_pan.png")
xml = dump("51_ui.xml")
say("PAN: " + " | ".join(texts(xml)[:20]) + f" yorro={is_yorro(xml)}")

# Zoom via double-tap
adb("shell", "input", "tap", "540", "1100")
time.sleep(0.12)
adb("shell", "input", "tap", "540", "1100")
time.sleep(1)
shot("52_zoom.png")

hits = []
for i, (x, y) in enumerate(
    [(540, 1000), (620, 1080), (460, 1150), (700, 980), (500, 900), (580, 1200)]
):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(2.0)
    shot(f"53_tap_{i}.png")
    xml = dump(f"53_tap_{i}.xml")
    ts = texts(xml)
    say(f"TAP{i}: " + " | ".join(ts[:40]))
    if not is_yorro(xml):
        say("LEFT_APP")
        adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
        time.sleep(4)
        continue
    j = " ".join(ts).lower()
    if any(
        k in j
        for k in (
            "marktkauf",
            "meyer",
            "frische",
            "navigation",
            "ffnungszeiten",
            "supermarkt",
            "speisekarte",
            "bäcker",
            "backer",
            "spielplatz",
        )
    ):
        hits.append(i)
        bad = [b for b in ("supermarket", " cafe", "route starten oder mehr") if b in j]
        say(f"HIT bad={bad or 'none'}")
        # hours if present
        for m in re.finditer(r"<node[^>]+>", xml):
            chunk = m.group(0)
            if "ffnungszeiten" not in chunk.lower():
                continue
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', chunk)
            if not b:
                continue
            x1, y1, x2, y2 = map(int, b.groups())
            adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
            time.sleep(7)
            shot(f"54_hours_{i}.png")
            xml = dump(f"54_hours_{i}.xml")
            say("HOURS: " + " | ".join(texts(xml)[:55]))
            break
        # close popup if X / outside — tap top weather to dismiss? skip
        if len(hits) >= 2:
            break

say(f"DONE hits={hits}")
