from pathlib import Path
import re

t = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6\ui.xml").read_text(encoding="utf-8", errors="ignore")
out = []
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    blob = ((text.group(1) if text else "") + " | " + (desc.group(1) if desc else "")).strip(" |")
    if not bounds or not blob:
        continue
    x1, y1, x2, y2 = map(int, bounds.groups())
    if y1 < 280 or "schlie" in blob.lower() or "weiter" in blob.lower() or "sp" in blob.lower()[:8]:
        out.append(f"{(x1+x2)//2:4d},{(y1+y2)//2:4d}  {blob[:90]}")
Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6\ui-top.txt").write_text("\n".join(out[:60]), encoding="utf-8")
print("wrote", len(out))
