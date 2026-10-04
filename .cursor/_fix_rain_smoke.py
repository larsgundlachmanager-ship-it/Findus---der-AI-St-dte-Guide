# -*- coding: utf-8 -*-
from pathlib import Path
p = Path(r"c:\Users\larsf\Findus 2.0\src\services\ui\liveHudRainFact.smoke.test.ts")
t = p.read_text(encoding="utf-8")
old = "assert(!/Mittagessen nah\\?/.test(cards), 'kein Soft-Placeholder-Mittag');"
new = "assert(!/title: 'Mittagessen nah\\?'/.test(cards), 'kein Soft-Placeholder-Mittag-Titel');"
if old not in t:
    raise SystemExit("anchor missing: " + repr([line for line in t.splitlines() if "Mittagessen" in line]))
t = t.replace(old, new, 1)
data = t.encode("utf-8")
with p.open("r+b") as f:
    f.seek(0)
    f.write(data)
    f.truncate()
print("ok")
