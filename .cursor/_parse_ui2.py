from pathlib import Path
import re
xml = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7\ui-n.xml").read_text(encoding="utf-8", errors="ignore")
nodes = []
for n in re.findall(r"<node [^>]+>", xml):
    if 'clickable="true"' not in n:
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    t = re.search(r'text="([^"]*)"', n)
    d = re.search(r'content-desc="([^"]*)"', n)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    label = (t.group(1) if t else "") or (d.group(1) if d else "")
    nodes.append((y1, x1, x2 - x1, y2 - y1, label))
nodes.sort()
out = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7\ui-clickables.txt")
lines = [f"clickable {len(nodes)}"] + [str(n) for n in nodes]
out.write_text("\n".join(lines), encoding="utf-8")
print("wrote", out, "count", len(nodes))
