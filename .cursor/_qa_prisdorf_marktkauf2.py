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


# Close any overlays
for _ in range(3):
    xml = dump("close_ui.xml")
    c = center(xml, "Schlie") or center(xml, "Speichern")
    if c and "Einstellung" in " ".join(texts(xml)):
        # prefer Schließen
        c2 = center(xml, "Schlie")
        if c2:
            adb("shell", "input", "tap", str(c2[0]), str(c2[1]))
            time.sleep(1)
            continue
    # back
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.8)

time.sleep(1)
shot("15_clean.png")

adb(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "yorro://ask?q=Zum%20Marktkauf%20in%20Prisdorf",
)
time.sleep(18)
shot("16_zum_marktkauf.png")
xml = dump("16_ui.xml")
ts = texts(xml)
say("ASK: " + " | ".join(ts[:60]))
j = " ".join(ts).lower()
say(
    "FLAGS marktkauf/meyer/frische/supermarket/cafe/route starten: "
    + str(
        {
            "marktkauf": "marktkauf" in j,
            "meyer": "meyer" in j,
            "frische": "frische" in j,
            "supermarket": "supermarket" in j,
            "cafe": re.search(r"\bcafe\b", j) is not None,
            "route_meta": "route starten oder mehr" in j,
        }
    )
)

h = center(xml, "ffnungszeiten")
if h:
    adb("shell", "input", "tap", str(h[0]), str(h[1]))
    time.sleep(7)
    shot("17_hours.png")
    xml = dump("17_ui.xml")
    say("HOURS: " + " | ".join(texts(xml)[:70]))

# Screenshot map after ask for purple check
time.sleep(2)
shot("18_map_after.png")
say("DONE")
