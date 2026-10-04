# -*- coding: utf-8 -*-
from pathlib import Path
import os, time, re

root = Path(r"c:\Users\larsf\Findus 2.0")
p = root / "src/module2/timeline/gapFillTravel.ts"
t = p.read_text(encoding="utf-8")

# Patch 1: after plannedJourneyGroupExists(navId) return; insert destAlreadyHasTravel
pat1 = r"(const navId = `nav_here_\$\{first\.id\}`;\n  if \(plannedJourneyGroupExists\(navId\)\) return;\n)"
if "destAlreadyHasTravel(first.id" in t:
    print("patch1 already applied")
else:
    repl1 = r"""\1  const planStopsNow = useFuturePlanStore.getState().plan.stops;
  if (destAlreadyHasTravel(first.id, planStopsNow)) return;
"""
    t2, n = re.subn(pat1, repl1, t, count=1)
    if n != 1:
        raise SystemExit(f"patch1 failed n={n}")
    t = t2
    # also switch useFuturePlanStore.getState()... to planStopsNow.some
    t = t.replace(
        """  if (
    useFuturePlanStore
      .getState()
      .plan.stops.some(
        (s) =>
          s.kind === 'nav_leg' &&
          (s.id === navId ||
            s.groupId === navId ||
            (/^ÖPNV (zu|nach) /i.test(s.title) &&
              cleanPlanDestTitle(s.title) ===
                cleanPlanDestTitle(first.title))),
      )
  ) {
    return;
  }
""",
        """  if (
    planStopsNow.some(
      (s) =>
        s.kind === 'nav_leg' &&
        (s.id === navId ||
          s.groupId === navId ||
          (/^ÖPNV (zu|nach) /i.test(s.title) &&
            cleanPlanDestTitle(s.title) ===
              cleanPlanDestTitle(first.title))),
    )
  ) {
    return;
  }
""",
        1,
    )
    print("patch1 applied")

# Patch 2: between stops
if "destAlreadyHasTravel(b.id" in t:
    print("patch2 already applied")
else:
    pat2 = r"(if \(/\^ziel\$/i\.test\(destTitle\)\) continue;\n)"
    repl2 = r"""\1    if (
      destAlreadyHasTravel(b.id, [
        ...useFuturePlanStore.getState().plan.stops,
        ...legs,
      ])
    ) {
      continue;
    }
"""
    t2, n = re.subn(pat2, repl2, t, count=1)
    if n != 1:
        raise SystemExit(f"patch2 failed n={n}")
    t = t2
    print("patch2 applied")

tmp = p.with_suffix(".ts.tmpwrite")
tmp.write_text(t, encoding="utf-8")
for i in range(10):
    try:
        os.replace(tmp, p)
        print("gapFillTravel write ok")
        break
    except Exception as e:
        print("retry", i, type(e).__name__, e)
        time.sleep(0.5)
else:
    raise SystemExit("could not replace gapFillTravel")