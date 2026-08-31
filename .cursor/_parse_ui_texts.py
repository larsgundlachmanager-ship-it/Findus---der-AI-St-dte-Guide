import re
import pathlib
import sys

path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".cursor/live9/lisbon-retry-ui.xml")
t = path.read_text(encoding="utf-8", errors="ignore")
texts = [
    m.group(1)
    for m in re.finditer(r'text="([^"]{2,80})"', t)
    if m.group(1).strip()
]
print("texts", texts[:50])
