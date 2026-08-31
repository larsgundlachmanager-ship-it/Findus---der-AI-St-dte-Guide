from pathlib import Path
import re
t = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6\ui.xml").read_text(encoding="utf-8", errors="ignore")
out = []
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    desc = re.search(r'content-desc="([^"]*)"', n)
    text = re.search(r'text="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    blob = ((desc.group(1) if desc else "") + " | " + (text.group(1) if text else "")).strip(" |")
    if not bounds:
        continue
    if any(k in blob.lower() for k in ("schlie", "karte schlie")):
        x1, y1, x2, y2 = map(int, bounds.groups())
        out.append(f"{(x1+x2)//2:4d},{(y1+y2)//2:4d}  {blob[:80]}")
Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6\close-bounds.txt").write_text("\n".join(out), encoding="utf-8")
print("\n".join(out))
