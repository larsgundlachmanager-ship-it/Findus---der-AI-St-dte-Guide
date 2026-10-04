from pathlib import Path
import re
import sys
import subprocess
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
SERIAL = "00143157P001105"
OUT = Path(r"c:/Users/larsf/Findus 2.0/.cursor/live7")


def adb(*args: str) -> str:
    r = subprocess.run(
        ["adb", "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return (r.stdout or "") + (r.stderr or "")


def dump(name: str) -> Path:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    dest = OUT / name
    adb("pull", "/sdcard/ui.xml", str(dest))
    return dest


def texts(path: Path):
    t = path.read_text(encoding="utf-8", errors="replace")
    print("bytes", len(t), path.name)
    keys = (
        "einstell",
        "profil",
        "stimme",
        "schlie",
        "timeline",
        "mikro",
        "maplibre",
        "reise",
        "ort",
        "kompass",
    )
    for m in re.finditer(r'(?:content-desc|text)="([^"]{3,120})"', t):
        s = m.group(1)
        low = s.lower()
        if any(k in low for k in keys):
            print("-", s[:120])
    mm = re.search(r'MapLibre[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
    mic = re.search(r'Mikrofon[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
    if mm and mic:
        map_b = int(mm.group(4))
        mic_t = int(mic.group(2))
        print(
            f"map_bottom={map_b} mic_top={mic_t} gap={mic_t-map_b} overlap={map_b>mic_t}"
        )


adb("shell", "input", "keyevent", "4")
time.sleep(0.8)
adb("logcat", "-c")
print("tap settings")
adb("shell", "input", "tap", "886", "2262")
time.sleep(1.5)
p = dump("nothing-after-settings2.xml")
texts(p)
print("--- logcat ---")
print(adb("logcat", "-d", "-t", "60", "ReactNativeJS:V")[-2000:])
