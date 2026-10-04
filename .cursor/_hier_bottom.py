from pathlib import Path
import re
import sys
import subprocess

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
SERIAL = "00143157P001105"
OUT = Path(r"c:/Users/larsf/Findus 2.0/.cursor/live7/nothing-hier.xml")

subprocess.run(
    ["adb", "-s", SERIAL, "shell", "uiautomator", "dump", "/sdcard/ui.xml"],
    check=False,
)
subprocess.run(
    ["adb", "-s", SERIAL, "pull", "/sdcard/ui.xml", str(OUT)], check=False
)
t = OUT.read_text(encoding="utf-8", errors="replace")
print("nodes near bottom (y2>=2000):")
for m in re.finditer(r"<node([^>]+)/?>", t):
    n = m.group(1)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    if y2 < 2000:
        continue
    cls = re.search(r'class="([^"]+)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    click = re.search(r'clickable="(true|false)"', n)
    print(
        f"{y1}-{y2} x={x1}-{x2} {cls.group(1) if cls else '?'} "
        f"click={click.group(1) if click else '?'} "
        f"{(desc.group(1) if desc else '')[:70]}"
    )

# full-height clickable nodes
print("\nfull/tall clickable:")
for m in re.finditer(r"<node([^>]+)/?>", t):
    n = m.group(1)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    click = re.search(r'clickable="true"', n)
    if not click:
        continue
    if (y2 - y1) < 800:
        continue
    desc = re.search(r'content-desc="([^"]*)"', n)
    cls = re.search(r'class="([^"]+)"', n)
    print(
        f"{y1}-{y2} {cls.group(1) if cls else '?'} {(desc.group(1) if desc else '')[:80]}"
    )
