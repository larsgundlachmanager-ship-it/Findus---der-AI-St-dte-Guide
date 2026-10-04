# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\ui\liveHudMealSuggestions.ts")
text = p.read_text(encoding="utf-8")
old = """      const primary = items[0]!;
      const title = 'Hunger?';
      const metaParts = [primary.name];
      if (primary.cuisine && primary.cuisine !== 'Küche vor Ort') {
        metaParts.push(primary.cuisine);
      }
      metaParts.push(
        primary.walkMin <= 1
          ? '1 Min zu Fuß'
          : `${primary.walkMin} Min zu Fuß`,
      );"""
new = """      const primary = items[0]!;
      const title =
        slot === 'bakery'
          ? `🥐 ${primary.name}`
          : `🍽 ${primary.name}`;
      const metaParts: string[] = [slotLabel(slot)];
      if (primary.cuisine && primary.cuisine !== 'Küche vor Ort') {
        metaParts.push(primary.cuisine);
      }
      metaParts.push(
        primary.walkMin <= 1
          ? '1 Min zu Fuß'
          : `${primary.walkMin} Min zu Fuß`,
      );"""
if old not in text:
    raise SystemExit('meal title block missing')
text = text.replace(old, new, 1)
data = text.encode('utf-8')
with p.open('r+b') as f:
    f.seek(0)
    f.write(data)
    f.truncate()
print('meal title ok')
