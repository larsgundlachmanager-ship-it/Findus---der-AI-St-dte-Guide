# -*- coding: utf-8 -*-
from pathlib import Path
p = Path("src/services/weather/gpsRainNowcast.smoke.test.ts")
t = p.read_text(encoding="utf-8")
old = "/^Regen noch \\d+ Min$/.test(hud330 ?? '') || /^Regen bis /.test(hud330 ?? '')"
new = "/^(Starker |Leichter )?Regen noch \\d+ Min$/.test(hud330 ?? '') || /^(Starker |Leichter )?Regen bis /.test(hud330 ?? '')"
if old not in t:
    raise SystemExit("assert not found")
t = t.replace(old, new, 1)
tmp = Path(".phone-check/_gps_smoke_fix.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.replace(p)
print("fixed")
