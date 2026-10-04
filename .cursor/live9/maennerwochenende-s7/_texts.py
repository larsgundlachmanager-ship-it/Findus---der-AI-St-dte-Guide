from pathlib import Path
import re
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
p = Path(sys.argv[1] if len(sys.argv) > 1 else r"c:\Users\larsf\Findus 2.0\.cursor\live9\maennerwochenende-s7\now.xml")
xml = p.read_text(encoding="utf-8", errors="ignore")
print("file", p, "len", len(xml))
for t in re.findall(r'text="([^"]*)"', xml):
    if t.strip():
        print("T:", t[:140])
for t in re.findall(r'content-desc="([^"]*)"', xml):
    if t.strip():
        print("D:", t[:140])
