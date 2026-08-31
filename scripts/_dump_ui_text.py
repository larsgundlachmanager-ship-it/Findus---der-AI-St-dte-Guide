import re
import pathlib

p = pathlib.Path(r"C:\Users\larsf\Findus 2.0\.cursor\phone-ui.xml")
t = p.read_text(encoding="utf-8", errors="ignore")
texts = re.findall(r'text="([^"]+)"', t)
seen = set()
out = []
for x in texts:
    x = x.strip()
    if not x or x in seen:
        continue
    seen.add(x)
    out.append(x)
print("\n".join(out[:100]), file=open(r"C:\Users\larsf\Findus 2.0\.cursor\phone-ui-text.txt", "w", encoding="utf-8"))
print("wrote", len(out), "texts")
