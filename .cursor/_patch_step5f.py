# -*- coding: utf-8 -*-
from pathlib import Path
import os

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\timeline\timelineNavGestures.smoke.test.ts")
t = p.read_text(encoding="utf-8")

extra = r'''
assert(
  modal.includes('resolveOverlapsQuietly'),
  'quiet resolve vor Konflikt-Banner',
);
assert(
  modal.includes('hasOverlapConflict = showPlanningChrome && hasTimeOverlap()') ||
    /hasOverlapConflict\s*=\s*showPlanningChrome\s*&&\s*hasTimeOverlap\(\)/.test(
      modal,
    ),
  'Banner nur bei echtem hasTimeOverlap nach quiet resolve',
);
assert(
  /tripadvisor\|opentable\|quandoo/.test(modal) ||
    modal.includes('tripadvisor|opentable|quandoo'),
  'Place-Links härter aus Top-Chrome gefiltert',
);
assert(
  modal.includes('!node.groupId') &&
    modal.includes("Echte Journey-Gruppe: kein Spinner"),
  'kein stale ? für Journey-Gruppen',
);

const gapPolicy = read('src/module2/timeline/gapFillTravelPolicy.ts');
assert(gapPolicy.includes('navLegDestKey'), 'dest-key für ÖPNV-Dedupe');
assert(
  gapPolicy.includes('pruneStaleFallbackLegsForDest'),
  'stale Fallback-Prune',
);
assert(
  gapPolicy.includes('countTravelHeadsForDest'),
  'Travel-Heads-Zähler für Smoke',
);

const helpers = read('src/module2/timeline/planTravelHelpers.ts');
assert(
  helpers.includes('pruneStaleFallbackLegsForDest'),
  'refine pruned stale fallbacks after journey',
);
'''

if "quiet resolve vor Konflikt-Banner" in t:
    print("gestures smoke already extended")
else:
    if "console.log('timelineNavGestures.smoke.test.ts OK');" not in t:
        raise SystemExit("gestures end missing")
    t = t.replace(
        "console.log('timelineNavGestures.smoke.test.ts OK');\n",
        extra + "\nconsole.log('timelineNavGestures.smoke.test.ts OK');\n",
        1,
    )
    p.write_text(t, encoding="utf-8")
    print("gestures smoke extended")