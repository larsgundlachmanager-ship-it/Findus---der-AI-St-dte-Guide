# -*- coding: utf-8 -*-
from pathlib import Path
t = Path(r"src/services/ui/proactiveHudEngine.ts").read_text(encoding="utf-8")
i = t.find("const line = getWeatherHudLine()")
Path(r".phone-check/_dump_proactive.txt").write_text(t[i : i + 1200], encoding="utf-8")
print("dumped", i)
# also check for special dashes
print("has em dash", "—" in t[i:i+1200])
print("has Schirm dabei", "Schirm dabei" in t)
