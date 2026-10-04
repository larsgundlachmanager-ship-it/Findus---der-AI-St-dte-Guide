from pathlib import Path
import re

p = Path(r"c:/Users/larsf/Findus 2.0/.cursor/live7/nothing-touch.xml")
t = p.read_text(encoding="utf-8", errors="replace")
nodes = re.findall(r"<node[^>]+>", t)
print("nodes", len(nodes))
keys = ("mic", "mikro", "einstell", "timeline", "orte", "kompass", "kalibr", "live", "maplibre", "map", "norden", "standort")
for n in nodes:
    low = n.lower()
    if any(k in low for k in keys):
        print(n[:400])
        print("---")

for n in nodes:
    m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if not m:
        continue
    x1, y1, x2, y2 = map(int, m.groups())
    if (x2 - x1) > 900 and (y2 - y1) > 1500:
        desc = re.search(r'content-desc="([^"]*)"', n)
        cls = re.search(r'class="([^"]*)"', n)
        print(
            "FULL",
            cls.group(1) if cls else "?",
            desc.group(1) if desc else "",
            f"{x1},{y1}-{x2},{y2}",
        )
