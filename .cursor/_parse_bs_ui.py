from pathlib import Path
import re

xml = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6w\bs-afterboot-ui.xml").read_text(
    encoding="utf-8", errors="ignore"
)
for n in re.findall(r"<node [^>]+>", xml):
    t = re.search(r'text="([^"]*)"', n)
    d = re.search(r'content-desc="([^"]*)"', n)
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    label = (t.group(1) if t else "") or (d.group(1) if d else "")
    if not label and "clickable=\"true\"" not in n:
        continue
    if b:
        print(f"{label!r:40} {b.group(0)} clickable={'true' in n and 'clickable=\"true\"' in n}")
