"""Prisdorf Map-Perfect QA on Nothing: pan to Marktkauf, tap, check popup."""
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


def shot(name: str) -> Path:
    p = OUT / name
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    p.write_bytes(data)
    return p


def dump_ui(name: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/yorro_ui.xml")
    adb("pull", "/sdcard/yorro_ui.xml", str(OUT / name))
    return (OUT / name).read_text(encoding="utf-8", errors="replace")


def texts(xml: str) -> list[str]:
    return [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip()]


def say(*parts: object) -> None:
    line = " ".join(str(p) for p in parts)
    print(line.encode("ascii", "replace").decode("ascii"))


def bounds(xml: str, label: str) -> tuple[int, int] | None:
    # Find node containing label, return center
    for m in re.finditer(r'<node[^>]+>', xml):
        chunk = m.group(0)
        if label.lower() not in chunk.lower():
            continue
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', chunk)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        return (x1 + x2) // 2, (y1 + y2) // 2
    return None


def tap(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def main() -> None:
    # Mock GPS near Marktkauf Peiner Hag
    adb(
        "shell",
        "am",
        "startservice",
        "-a",
        "com.android.intent.action.SET_MOCK_LOCATION",
    )
    # Prefer app: provider may need developer mock - try geo fix via appsettings
    adb("emu", "geo", "fix", "9.7732", "53.6721")  # may fail on physical
    # Physical device: app-level deep link / camera recenter after manual — use pinch+pan

    time.sleep(2)
    shot("02_before_pan.png")
    xml = dump_ui("02_ui.xml")
    say("TEXTS:", " | ".join(texts(xml)[:40]))

    # Swipe map toward Peiner Hag / Marktkauf (south-east of Heisterhoop area)
    # Screen ~1080x2400; map center swipe left+up repeatedly
    for _ in range(4):
        adb("shell", "input", "swipe", "700", "1400", "350", "900", "350")
        time.sleep(0.6)
    # Zoom in
    for _ in range(2):
        adb("shell", "input", "swipe", "540", "1200", "540", "900", "200")
        time.sleep(0.4)

    time.sleep(1.5)
    shot("03_after_pan.png")
    xml = dump_ui("03_ui.xml")
    say("AFTER PAN:", " | ".join(texts(xml)[:40]))

    # Tap likely Marktkauf building area (center-ish of map after pan)
    tap(540, 1100)
    time.sleep(2)
    shot("04_tap1.png")
    xml = dump_ui("04_ui.xml")
    ts = texts(xml)
    say("TAP1:", " | ".join(ts[:50]))

    # If popup has Öffnungszeiten, tap it
    pt = bounds(xml, "Öffnungszeiten")
    if pt:
        tap(*pt)
        time.sleep(4)
        shot("05_hours.png")
        xml = dump_ui("05_ui.xml")
        say("HOURS:", " | ".join(texts(xml)[:60]))
    else:
        # try second tap nearby
        tap(480, 1050)
        time.sleep(2)
        shot("04b_tap2.png")
        xml = dump_ui("04b_ui.xml")
        say("TAP2:", " | ".join(texts(xml)[:50]))
        pt = bounds(xml, "Öffnungszeiten")
        if pt:
            tap(*pt)
            time.sleep(4)
            shot("05_hours.png")
            xml = dump_ui("05_ui.xml")
            say("HOURS:", " | ".join(texts(xml)[:60]))

    # Check for yellow rubrics / bad bullets
    joined = " ".join(texts(xml)).lower()
    flags = []
    for bad in ("supermarket", " cafe", "route starten oder mehr", "über die buttons"):
        if bad in joined:
            flags.append(bad)
    say("BAD_FLAGS:", flags or "none")
    say("DONE")


if __name__ == "__main__":
    main()
