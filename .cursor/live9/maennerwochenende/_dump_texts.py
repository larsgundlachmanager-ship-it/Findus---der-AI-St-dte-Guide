from pathlib import Path
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
base = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\maennerwochenende")
names = sys.argv[1:] or ["boot-ui.xml", "settings-ui.xml", "ui.xml"]
for name in names:
    p = base / name
    if not p.exists():
        print(name, "MISSING")
        continue
    xml = p.read_text(encoding="utf-8", errors="ignore")
    texts = re.findall(r'text="([^"]*)"', xml)
    descs = re.findall(r'content-desc="([^"]*)"', xml)
    print("====", name, "====")
    for t in texts:
        if t.strip():
            print("T:", t[:160])
    for t in descs:
        if t.strip():
            print("D:", t[:160])
    print()
