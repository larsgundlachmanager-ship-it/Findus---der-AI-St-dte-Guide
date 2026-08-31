import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live10")


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True, text=True)


def has_fragen():
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(OUT / "t.xml"))
    t = (OUT / "t.xml").read_text(encoding="utf-8", errors="ignore")
    return 'text="Fragen"' in t or "EditText" in t


# Ensure app foreground
adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
time.sleep(3)

# Visual mic is above bottom nav (~2194). Try tap grid.
coords = []
for cy in (1950, 2000, 2050, 2080, 2100, 2120, 2140):
    for cx in (500, 540, 580):
        coords.append((cx, cy))

for cx, cy in coords:
    adb("shell", "input", "tap", str(cx), str(cy))
    time.sleep(1.8)
    if has_fragen():
        print(f"OPEN tap {cx},{cy}")
        adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
        adb("pull", "/sdcard/Download/findus-now.png", str(OUT / "mic-open2.png"))
        break
    # dismiss accidental
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.4)
else:
    print("NO OPEN")
