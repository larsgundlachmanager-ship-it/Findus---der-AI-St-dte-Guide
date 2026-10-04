# -*- coding: utf-8 -*-
from pathlib import Path
import os

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\navRouteMapPayload.smoke.test.ts")
t = p.read_text(encoding="utf-8")
needle = "assert(view.includes('navChipWrap'), 'Chips unter Pin-Spitze');"
insert = """assert(view.includes('navChipWrap'), 'Chips unter Pin-Spitze');
assert(view.includes('navChipBody'), 'Chip Text-Body');
assert(view.includes(\"alignSelf: 'center'\"), 'Chip hugt Inhalt (kein Breit-Balken)');
assert(view.includes(\"flexDirection: 'row'\"), 'Chip: Titel + Close in einer Reihe');"""
if "Chip hugt Inhalt" in t:
    print("already")
elif needle not in t:
    raise SystemExit("missing")
else:
    tmp = p.with_suffix(".ts.tmpwrite")
    tmp.write_text(t.replace(needle, insert, 1), encoding="utf-8")
    os.replace(tmp, p)
    print("ok")
