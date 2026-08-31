from pathlib import Path
import re
import sys

p = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\larsf\Findus 2.0\.cursor\live7\ui.xml")
need = sys.argv[2:] or ["Hier bleiben", "Bleiben", "Witzhave", "Hamfelde", "Schlie", "TASK", "Fragen", "Steak", "vegan"]
t = p.read_text(encoding="utf-8", errors="ignore")
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    blob = ((text.group(1) if text else "") + " " + (desc.group(1) if desc else "")).strip()
    if not bounds or not blob:
        continue
    if any(k.lower() in blob.lower() for k in need):
        x1, y1, x2, y2 = map(int, bounds.groups())
        print(f"{(x1+x2)//2:4d},{(y1+y2)//2:4d}  {blob[:100]}")
