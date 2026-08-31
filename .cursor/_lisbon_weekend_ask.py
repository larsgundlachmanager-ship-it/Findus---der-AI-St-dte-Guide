import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9")


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True, text=True)


def dump(tag: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    p = OUT / f"{tag}.xml"
    adb("pull", "/sdcard/Download/ui.xml", str(p))
    return p.read_text(encoding="utf-8", errors="ignore")


def shot(tag: str) -> None:
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


def nodes(xml: str):
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
        }


xml = dump("lisbon-f8-pre")
edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
fragen = next(
    (n for n in nodes(xml) if n["desc"] == "Fragen" or n["text"] == "Fragen"),
    None,
)
if not edit or not fragen:
    print("NO_MODAL", bool(edit), bool(fragen))
    shot("lisbon-f8-nomodal")
    raise SystemExit(1)

adb("shell", "input", "tap", str(edit["cx"]), str(edit["cy"]))
time.sleep(0.3)
# Clear field: select-all + delete
adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
for _ in range(80):
    adb("shell", "input", "keyevent", "KEYCODE_DEL")
time.sleep(0.2)

q = "Plane mir Wochenendurlaub nach Lissabon in zwei Wochen: Flug Hamburg Freitag 11 September hin Sonntag 13 September zurueck Hotel und Programm"
# Avoid '.' which truncates adb input text on some devices
adb("shell", "input", "text", q.replace(" ", "%s"))
time.sleep(0.8)
xml = dump("lisbon-f8-typed")
fragen = next(
    (n for n in nodes(xml) if n["desc"] == "Fragen" or n["text"] == "Fragen"),
    None,
)
if not fragen:
    print("NO_FRAGEN")
    raise SystemExit(1)
adb("shell", "input", "tap", str(fragen["cx"]), str(fragen["cy"]))
print("submitted", q[:90])
time.sleep(75)
shot("lisbon-f8")
xml = dump("lisbon-f8")
subprocess.run(
    [
        "python",
        str(Path(r"c:\Users\larsf\Findus 2.0\.cursor\extract_ui.py")),
        str(OUT / "lisbon-f8.xml"),
    ],
    check=False,
)
txt = (OUT / "lisbon-f8-text.txt").read_text(encoding="utf-8", errors="ignore")
print(txt[:1200])
