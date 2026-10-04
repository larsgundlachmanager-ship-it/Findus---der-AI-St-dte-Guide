# -*- coding: utf-8 -*-
from pathlib import Path
import os, shutil, time

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\navRouteMapPayload.ts")
t = p.read_text(encoding="utf-8")
old = """    if (isFakeRouteLine(leg)) continue;
    keptAhead.push(leg);
    keptMeta.push(kind);"""
new = """    // Transit-Stationsketten oft geradlinig — nicht als Fake verwerfen.
    if (kind !== 'transit' && isFakeRouteLine(leg)) continue;
    keptAhead.push(leg);
    keptMeta.push(kind);"""
if "kind !== 'transit' && isFakeRouteLine(leg)" in t:
    print("SKIP")
elif old not in t:
    print("MISS")
else:
    tmp = p.with_suffix(".ts.tmpk")
    bak = p.with_suffix(".ts.bakk")
    tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
    for i in range(10):
        try:
            if bak.exists():
                bak.unlink()
            p.replace(bak)
            os.replace(tmp, p)
            if bak.exists():
                bak.unlink()
            print("OK")
            break
        except OSError as e:
            print("retry", e)
            time.sleep(0.3)
