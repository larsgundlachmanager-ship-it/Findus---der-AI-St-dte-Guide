# -*- coding: utf-8 -*-
from __future__ import annotations
import os, shutil, time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_fix")
    tmp.write_text(content, encoding="utf-8")
    for i in range(12):
        try:
            if path.exists():
                try:
                    if bak.exists():
                        bak.unlink()
                except OSError:
                    pass
                try:
                    path.replace(bak)
                except OSError:
                    shutil.copy2(path, bak)
                    path.unlink(missing_ok=True)
            os.replace(tmp, path)
            try:
                if bak.exists():
                    bak.unlink()
            except OSError:
                pass
            print(f"OK {path.name}")
            return
        except OSError as e:
            print(f"retry {e}")
            time.sleep(0.3)
    raise SystemExit("fail")


def patch(rel: str, old: str, new: str) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if old not in t:
        if new[:40] in t or "nav_live_tour_" in t and "liveIdx" in t and rel.endswith("futurePlanState.ts"):
            # check already fixed
            if "nav_live_tour_(\\d+)_" in t or "nav_live_tour_\\\\" in t:
                print(f"SKIP {rel}")
                return
        print(f"MISS {rel}")
        print(old[:120])
        return
    force_write(p, t.replace(old, new, 1))


patch(
    "src/module2/timeline/futurePlanState.ts",
    """    // Live-Tour: Reihenfolge aus ID (tour_live_N_…) schlägt Titel — Ausstieg vor Ziel.
    const liveIdx = (id: string | undefined) => {
      const m = /^tour_live_(\\d+)_/.exec(String(id || ''));
      if (m) return Number(m[1]);
      const leg = /^tour_live_leg_(\\d+)$/.exec(String(id || ''));
      if (leg) return Number(leg[1]) - 0.5;
      if (id === 'nav_live_active') return -1;
      if (id === 'nav_live_dest') return 999;
      return null;
    };""",
    """    // Live-Tour: Reihenfolge aus ID (nav_live_tour_N_…) schlägt Titel — Ausstieg vor Ziel.
    const liveIdx = (id: string | undefined) => {
      const m = /^nav_live_tour_(\\d+)_/.exec(String(id || ''));
      if (m) return Number(m[1]);
      const leg = /^nav_live_tour_leg_(\\d+)$/.exec(String(id || ''));
      if (leg) return Number(leg[1]) - 0.5;
      if (id === 'nav_live_active') return -1;
      if (id === 'nav_live_dest') return 999;
      return null;
    };""",
)

patch(
    "src/module2/timeline/gapFillTravel.ts",
    """        s.id === 'nav_live_active' ||
        s.id.startsWith('tour_live_'),""",
    """        s.id === 'nav_live_active' ||
        s.id.startsWith('nav_live_tour_'),""",
)

p = ROOT / "src/module2/timeline/gapFillTravel.ts"
t = p.read_text(encoding="utf-8")
marker = "} {\n  const store = useFuturePlanStore.getState();\n  const realStops = sortedRealStops();"
if "hasLiveJourneyOnPlan()) return;\n  const store = useFuturePlanStore" in t:
    print("SKIP apply early")
elif marker in t:
    force_write(
        p,
        t.replace(
            marker,
            "} {\n  if (hasLiveJourneyOnPlan()) return { legs: 0, speech: '' };\n  const store = useFuturePlanStore.getState();\n  const realStops = sortedRealStops();",
            1,
        ),
    )
else:
    print("MISS apply marker")
    # debug
    i = t.find("export function applyGapFillTravelLegs")
    print(repr(t[i : i + 280]))
