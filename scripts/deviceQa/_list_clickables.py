import re
from pathlib import Path
import sys

xml = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\larsf\Findus 2.0\.cursor\live7\ui.xml")
t = xml.read_text(encoding="utf-8", errors="ignore")
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    if 'clickable="true"' not in n:
        continue
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if not bounds:
        continue
    x1, y1, x2, y2 = map(int, bounds.groups())
    blob = ((text.group(1) if text else "") + " | " + (desc.group(1) if desc else "")).strip(" |")
    line = f"{(x1+x2)//2:4d},{(y1+y2)//2:4d}  {blob[:90]}"
    try:
        print(line)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"))
