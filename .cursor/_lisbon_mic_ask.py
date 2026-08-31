import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9")


def adb(*args):
    return subprocess.run([ADB, *args], capture_output=True, text=True)


def dump(tag):
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    dest = OUT / f"{tag}.xml"
    adb("pull", "/sdcard/Download/ui.xml", str(dest))
    return dest.read_text(encoding="utf-8", errors="ignore")


def has_fragen(xml):
    return 'text="Fragen"' in xml or 'content-desc="Fragen"' in xml


def shot(tag):
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


# Try several mic positions
for cy in (1850, 1920, 1980, 2040, 2100, 2150):
    adb("shell", "input", "tap", "540", str(cy))
    time.sleep(1.8)
    xml = dump(f"mictry-{cy}")
    ok = has_fragen(xml) or "EditText" in xml
    print(f"cy={cy} fragen={ok}")
    if ok:
        shot(f"mictry-{cy}")
        # type short flight ask
        for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
            if "EditText" in n:
                b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                if not b:
                    continue
                x1, y1, x2, y2 = map(int, b.groups())
                adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
                break
        time.sleep(0.4)
        q = "Flug Hamburg Lissabon 11. September"
        adb("shell", "input", "text", q.replace(" ", "%s"))
        time.sleep(0.8)
        xml = dump("mictry-typed")
        for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
            blob = ""
            t = re.search(r'text="([^"]*)"', n)
            d = re.search(r'content-desc="([^"]*)"', n)
            blob = ((t.group(1) if t else "") + " " + (d.group(1) if d else "")).lower()
            if "fragen" in blob and 'clickable="true"' in n:
                b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                if b:
                    x1, y1, x2, y2 = map(int, b.groups())
                    adb(
                        "shell",
                        "input",
                        "tap",
                        str((x1 + x2) // 2),
                        str((y1 + y2) // 2),
                    )
                    print("submitted")
                    break
        time.sleep(60)
        shot("lisbon-f6")
        dump("lisbon-f6")
        break
else:
    print("no mic modal found")
    shot("mic-fail")
