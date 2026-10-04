# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\speech\floskelEngine.ts")
t = p.read_text(encoding="utf-8")
old = r"/\b(zug|bus|bahn|öpnv|oepnv|verbindung|verspät|öffentlichen?\s+verkehr)\b/u"
new = r"/\b(zug|bus|bahn|öpnv|oepnv|verbindung|verspät|verkehrsmittel|öffentlichen?\s+verkehr\w*)\b/u"
if old not in t:
    for line in t.splitlines():
        if "oepnv" in line and "verbindung" in line:
            print(repr(line))
    raise SystemExit("old not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("transit regex fixed")
