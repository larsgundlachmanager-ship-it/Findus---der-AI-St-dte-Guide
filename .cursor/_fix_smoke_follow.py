# -*- coding: utf-8 -*-
from pathlib import Path
import os

p = Path(r"c:\Users\larsf\Findus 2.0\src\components\homeMap\nativeHomeMap.smoke.test.ts")
t = p.read_text(encoding="utf-8")
old = "assert(view.includes('followFight'), 'Follow-Kampf → sofort Unlock');"
new = """assert(
  view.includes('followPosFight') || view.includes(\"noteUserGesture('position')\"),
  'Follow-Kampf → Standort-Unlock (Pan getrennt von Heading)',
);"""
if old not in t:
    raise SystemExit("assert not found")
tmp = p.with_suffix(".ts.tmpwrite")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
os.replace(tmp, p)
print("ok")
