import re
from pathlib import Path

xml = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\warm_weekend4\hub.xml").read_text(
    encoding="utf-8", errors="ignore"
)
for n in re.findall(r"<node\b[^>]*>", xml):
    if not re.search(r"Neue Reise|planen|Schlie", n, re.I):
        continue
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    bounds = re.search(r'bounds="([^"]*)"', n)
    print(
        (text.group(1) if text else "")[:40],
        "|",
        (desc.group(1) if desc else "")[:50],
        "|",
        bounds.group(1) if bounds else "",
        "| click",
        'clickable="true"' in n,
    )
