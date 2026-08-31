from pathlib import Path
import re

t = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7\ui.xml").read_text(encoding="utf-8", errors="ignore")
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    click = 'clickable="true"' in n
    blob = ((text.group(1) if text else "") + " | " + (desc.group(1) if desc else "")).strip(" |")
    if not bounds:
        continue
    if "bleiben" in blob.lower() or "wahlen" in blob.lower() or "wählen" in blob.lower() or "Schließen" in blob:
        x1, y1, x2, y2 = map(int, bounds.groups())
        print(f"{(x1+x2)//2:4d},{(y1+y2)//2:4d}  click={click}  [{x1},{y1}][{x2},{y2}]  {blob[:120]}")
