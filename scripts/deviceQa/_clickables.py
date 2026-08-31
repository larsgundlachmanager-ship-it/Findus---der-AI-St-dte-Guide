from pathlib import Path
import re

t = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7\ui.xml").read_text(encoding="utf-8", errors="ignore")
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    if 'clickable="true"' not in n:
        continue
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if not bounds:
        continue
    x1, y1, x2, y2 = map(int, bounds.groups())
    cy = (y1 + y2) // 2
    if cy < 900:
        continue
    blob = ((text.group(1) if text else "") + " | " + (desc.group(1) if desc else "")).strip(" |")
    print(f"{(x1+x2)//2:4d},{cy:4d}  [{x1},{y1}][{x2},{y2}]  {blob[:90]}")
