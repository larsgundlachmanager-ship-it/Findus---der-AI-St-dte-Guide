# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\speech\floskelEngine.ts")
t = p.read_text(encoding="utf-8")
old = r"/\b(vegetar|vegan|allerg|gluten|laktos|ohne\s+fleisch|kein\s+fleisch)\b/u"
new = r"/\b(vegetar\w*|vegan\w*|allerg\w*|gluten\w*|laktos\w*|ohne\s+fleisch|kein\s+fleisch)\b/u"
if old not in t:
    for line in t.splitlines():
        if "vegetar" in line:
            print(repr(line))
    raise SystemExit("not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("food_allergy fixed")
