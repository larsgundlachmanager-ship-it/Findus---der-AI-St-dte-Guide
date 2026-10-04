import sys
import re
import subprocess
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
SERIAL = "00143157P001105"
OUT = Path(r"c:/Users/larsf/Findus 2.0/.cursor/live7/nothing-full.xml")
subprocess.run(
    ["adb", "-s", SERIAL, "shell", "uiautomator", "dump", "/sdcard/ui.xml"],
    check=False,
)
subprocess.run(
    ["adb", "-s", SERIAL, "pull", "/sdcard/ui.xml", str(OUT)], check=False
)
t = OUT.read_text(encoding="utf-8", errors="replace")
print("bytes", len(t), "nodes", t.count("<node"))
for m in re.finditer(r'(?:content-desc|text)="([^"]+)"', t):
    s = m.group(1)
    if any(
        k in s.lower()
        for k in (
            "standort",
            "erlaubnis",
            "stadt",
            "wechsel",
            "hinweis",
            "weiter",
            "erlauben",
            "ablehnen",
            "berechtigung",
            "yorro",
        )
    ):
        print("HIT", s[:120])
print("--- clickables ---")
for m in re.finditer(r"<node([^>]+)>", t):
    n = m.group(1)
    if 'clickable="true"' not in n:
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    d = re.search(r'content-desc="([^"]*)"', n)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    print(
        f"CLICK {y1}-{y2} {x2-x1}x{y2-y1} {(d.group(1) if d else '')[:70]}"
    )
