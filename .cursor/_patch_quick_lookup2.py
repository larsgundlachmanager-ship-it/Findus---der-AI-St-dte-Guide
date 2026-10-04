# -*- coding: utf-8 -*-
from pathlib import Path

src = Path("src/services/concierge/celestialSkyQuery.ts")
t = src.read_text(encoding="utf-8")
marker = "was\\s+bedeutet|"
extra = (
    "was\\s+bedeutet|"
    "was\\s+ist\\s+(?:die\\s+)?hauptstadt|"
    "hauptstadt\\s+(?:von|von\\s+der|von\\s+dem)|"
)
if "hauptstadt" in t[t.find("QUICK_LOOKUP_RE") : t.find("QUICK_LOOKUP_RE") + 600]:
    print("already ok")
    raise SystemExit(0)
if marker not in t:
    raise SystemExit("marker missing")
t = t.replace(marker, extra, 1)
t = t.replace(
    "Trivia-Maße/Identität/Bedeutung.",
    "Trivia-Maße/Identität/Bedeutung/Hauptstadt.",
    1,
)
tmp = Path(".cursor/_celestialSkyQuery_patched.ts")
tmp.write_text(t, encoding="utf-8")
print("tmp ok", tmp.stat().st_size)
