import re
from pathlib import Path
t = Path(r".cursor/_qa_prisdorf_v103/01_ui.xml").read_text(encoding="utf-8")
texts = re.findall(r'text="([^"]+)"', t)
print("\n".join(x for x in texts if x.strip())[:80])
