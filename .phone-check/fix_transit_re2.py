# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\speech\floskelEngine.ts")
t = p.read_text(encoding="utf-8")
# replace whatever transit line we have now
import re
pat = re.compile(
    r"  if \(/\\b\(zug\|bus\|bahn\|öpnv\|oepnv\|verbindung\|verspät[^\n]+\)\\b/u\.test\(t\)\) \{\n    return 'transit';\n  \}"
)
m = pat.search(t)
if not m:
    for line in t.splitlines():
        if "oepnv" in line:
            print("LINE", repr(line))
    raise SystemExit("not found")
new = (
    "  if (/\\b(zug|bus|bahn|öpnv|oepnv|verbindung|verspät|verkehrsmitteln?)\\b/u.test(t) ||\n"
    "    /\\böffentlichen?\\s+verkehr/u.test(t)) {\n"
    "    return 'transit';\n"
    "  }"
)
t2 = t[: m.start()] + new + t[m.end() :]
p.write_text(t2, encoding="utf-8")
print("fixed", m.group(0)[:80])
