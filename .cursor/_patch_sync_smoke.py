# -*- coding: utf-8 -*-
from __future__ import annotations
import os, shutil, time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
p = ROOT / "src/module2/timeline/syncLiveNavToPlan.smoke.test.ts"
t = p.read_text(encoding="utf-8")
if "maybeCatchUpTourProgress" in t:
    print("SKIP sync smoke")
else:
    old = """  assert(
    /path:\\s*null/.test(tourSrc) && tourSrc.includes('skipUpcomingTourStop'),
    'Skip löscht stale Stop-Pfade',
  );
}

console.log('liveTourSchedule.smoke.test.ts OK');"""
    new = """  assert(
    /path:\\s*null/.test(tourSrc) && tourSrc.includes('skipUpcomingTourStop'),
    'Skip löscht stale Stop-Pfade',
  );
  assert(tourSrc.includes('maybeCatchUpTourProgress'), 'stale progress catch-up');
  assert(tourSrc.includes('entgegen der Fahrtrichtung'), 'Fuß entgegen Fahrtrichtung');
  assert(tourSrc.includes('clearLiveNavFromPlan'), 'Tour-Ende räumt Live-ÖPNV');
}

console.log('syncLiveNavToPlan.smoke.test.ts OK');"""
    if old not in t:
        print("MISS")
        print(repr(t[-400:]))
    else:
        tmp = p.with_suffix(".ts.tmpfix")
        bak = p.with_suffix(".ts.bak")
        tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
        for i in range(10):
            try:
                if bak.exists():
                    bak.unlink()
                p.replace(bak)
                os.replace(tmp, p)
                if bak.exists():
                    bak.unlink()
                print("OK sync smoke")
                break
            except OSError as e:
                print("retry", e)
                time.sleep(0.3)
