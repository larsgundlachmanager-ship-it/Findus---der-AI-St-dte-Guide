import re
import subprocess
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9")


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True, text=True)


adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
adb("pull", "/sdcard/Download/findus-now.png", str(OUT / "lisbon-boot.png"))
adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
adb("pull", "/sdcard/Download/ui.xml", str(OUT / "lisbon-boot.xml"))
t = (OUT / "lisbon-boot.xml").read_text(encoding="utf-8", errors="ignore")
print("nodes", t.count("<node"))
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    text_m = re.search(r'text="([^"]*)"', n)
    desc_m = re.search(r'content-desc="([^"]*)"', n)
    text = text_m.group(1) if text_m else ""
    desc = desc_m.group(1) if desc_m else ""
    blob = (text + " | " + desc).strip(" |")
    if not blob.strip():
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    click = 'clickable="true"' in n
    if click or any(
        k in blob.lower()
        for k in (
            "mikro",
            "fragen",
            "timeline",
            "orte",
            "einst",
            "yorro",
            "weiter",
            "erlauben",
            "schließen",
        )
    ):
        print(repr(blob[:100]), b.group(0) if b else "", "click" if click else "")
