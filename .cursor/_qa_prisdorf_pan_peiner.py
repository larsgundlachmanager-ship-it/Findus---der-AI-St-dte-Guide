from __future__ import annotations

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


# Hard reset UI
adb("shell", "am", "force-stop", "de.findus.app")
time.sleep(1)
adb(
    "shell",
    "monkey",
    "-p",
    "de.findus.app",
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
)
time.sleep(12)
shot("20_boot.png")

# Dismiss any first-run by back
for _ in range(2):
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.5)

# Recenter
adb("shell", "input", "tap", "980", "420")
time.sleep(1.5)

# Pan toward Peiner Hag (SE of Heisterhoop): swipe NW so map moves SE
for _ in range(5):
    adb("shell", "input", "swipe", "300", "800", "750", "1400", "280")
    time.sleep(0.55)

# Zoom in
for _ in range(3):
    # pinch-ish: double swipe toward center via multi not available; use double-tap zoom
    adb("shell", "input", "tap", "540", "1100")
    time.sleep(0.15)
    adb("shell", "input", "tap", "540", "1100")
    time.sleep(0.7)

shot("21_peiner_area.png")

# More pan SE
for _ in range(3):
    adb("shell", "input", "swipe", "350", "900", "700", "1300", "300")
    time.sleep(0.5)
shot("22_peiner_area2.png")

# Tap large commercial building candidates
for i, (x, y) in enumerate(
    [(540, 1000), (480, 950), (600, 1050), (520, 1150), (650, 980), (420, 1100)]
):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(2.2)
    shot(f"23_tap_{i}.png")

print("DONE")
