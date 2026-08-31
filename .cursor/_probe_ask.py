"""Probe: open tippfeld, type, hide keyboard, tap Fragen, wait for result."""
import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live10")


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True, text=True)


def dump(tag="probe"):
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    p = OUT / f"{tag}.xml"
    adb("pull", "/sdcard/Download/ui.xml", str(p))
    return p.read_text(encoding="utf-8", errors="ignore")


def nodes(xml):
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        cls = re.search(r'class="([^"]*)"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "cls": cls.group(1) if cls else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
            "b": (x1, y1, x2, y2),
        }


def tap(x, y, w=0.4):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(w)


# open mic
for cy in (1850, 1920, 1980, 2040):
    tap(540, cy, 0.2)
    time.sleep(1.6)
    xml = dump(f"mic-{cy}")
    if any(n["text"] == "Fragen" or n["desc"] == "Fragen" for n in nodes(xml)):
        print("opened at", cy)
        break
else:
    print("no tippfeld")
    raise SystemExit(1)

xml = dump("typed-pre")
edit = next(n for n in nodes(xml) if "EditText" in n["cls"])
tap(edit["cx"], edit["cy"], 0.3)
adb("shell", "input", "text", "Wie%sist%sdas%sWetter%sgerade%shier")
time.sleep(1.0)
# hide keyboard
adb("shell", "input", "keyevent", "4")
time.sleep(0.8)
xml = dump("typed-post")
fragen = next(n for n in nodes(xml) if n["text"] == "Fragen" or n["desc"] == "Fragen")
print("Fragen bounds", fragen["b"], "center", fragen["cx"], fragen["cy"])
tap(fragen["cx"], fragen["cy"], 1.5)
# also try ENTER
adb("shell", "input", "keyevent", "66")
time.sleep(20)
xml = dump("after-ask")
adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
adb("pull", "/sdcard/Download/findus-now.png", str(OUT / "probe-wetter.png"))
texts = [n["text"] for n in nodes(xml) if n["text"].strip()]
print("texts", texts[:40])
print("tippfeld", any("Frage an Yorro" in t for t in texts))
