import re
import sys
from pathlib import Path

xml = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
# node attrs order varies — parse each node block roughly
nodes = re.findall(r"<node [^>]+>", xml)
print(f"nodes={len(nodes)}")
for n in nodes:
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    click = 'clickable="true"' in n
    t = (text.group(1) if text else "").strip()
    d = (desc.group(1) if desc else "").strip()
    if not bounds:
        continue
    a, b, c, e = bounds.groups()
    label = t or d
    if not label:
        continue
    if len(label) > 90:
        label = label[:87] + "..."
    mark = "TAP" if click else "   "
    safe = label.encode("ascii", "replace").decode("ascii")
    print(f"{mark} {safe!r} @ ({a},{b})-({c},{e})")
