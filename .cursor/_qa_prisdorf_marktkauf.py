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


# End active route if Beenden visible
xml = dump("11_pre.xml")
b = center(xml, "Beenden")
if b:
    adb("shell", "input", "tap", str(b[0]), str(b[1]))
    time.sleep(1.5)
# Close timeline if open — tap Orte
o = center(xml, "Orte") or (270, 2280)
adb("shell", "input", "tap", str(o[0]), str(o[1]))
time.sleep(1)

# Ask specifically Marktkauf Peiner Hag
adb(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "yorro://ask?q=Zeig%20Marktkauf%20Meyers%20Frischecenter%20Peiner%20Hag%20auf%20der%20Karte",
)
time.sleep(16)
shot("12_marktkauf_ask.png")
xml = dump("12_ui.xml")
say("ASK: " + " | ".join(texts(xml)[:55]))

# If Navigation button — don't start; look for popup with Marktkauf
joined = " ".join(texts(xml)).lower()
say("HAS_MARKTKAUF: " + str("marktkauf" in joined or "meyer" in joined or "frische" in joined))
bad = [x for x in ("supermarket", " cafe", "route starten oder mehr") if x in joined]
say("BAD_RUBRIC: " + str(bad or "none"))

# Hours button
h = center(xml, "ffnungszeiten")
if h:
    adb("shell", "input", "tap", str(h[0]), str(h[1]))
    time.sleep(6)
    shot("13_hours.png")
    xml = dump("13_ui.xml")
    say("HOURS: " + " | ".join(texts(xml)[:60]))
else:
    # Tap likely building center a few times after map moves
    for i, (x, y) in enumerate([(540, 1000), (500, 1150), (580, 1080)]):
        adb("shell", "input", "tap", str(x), str(y))
        time.sleep(2)
        shot(f"14_maptap_{i}.png")
        xml = dump(f"14_maptap_{i}.xml")
        ts = texts(xml)
        say(f"MAPTAP{i}: " + " | ".join(ts[:45]))
        j = " ".join(ts).lower()
        if "marktkauf" in j or "meyer" in j or "frische" in j:
            say("POPUP_HIT")
            bad = [x for x in ("supermarket", " cafe", "route starten oder mehr") if x in j]
            say("BAD: " + str(bad or "none"))
            h = center(xml, "ffnungszeiten")
            if h:
                adb("shell", "input", "tap", str(h[0]), str(h[1]))
                time.sleep(6)
                shot("13_hours.png")
                xml = dump("13_ui.xml")
                say("HOURS: " + " | ".join(texts(xml)[:60]))
            break

say("DONE")
