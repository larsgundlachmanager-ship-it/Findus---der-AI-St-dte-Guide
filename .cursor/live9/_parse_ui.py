import re
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\ideal-ayce-ui.xml")
t = p.read_text(encoding="utf-8", errors="ignore")
texts = re.findall(r'text="([^"]+)"', t)
texts = [x for x in texts if x.strip() and len(x) > 2]
Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\ideal-ayce-texts.txt").write_text(
    "\n".join(texts), encoding="utf-8"
)
print("\n".join(texts[:100]))
print("---", len(texts))
