# -*- coding: utf-8 -*-
from pathlib import Path
import os, time

root = Path(r"c:\Users\larsf\Findus 2.0")
p = root / "src/module2/timeline/gapFillTravelPolicy.ts"
t = p.read_text(encoding="utf-8")

old = """  return opts.stops.filter((s) => {
    if (isLive(s.id)) return true;
    if (s.groupId) {
      // Journey-Halte der behaltenen Gruppe bleiben
      if (opts.keepGroupId && s.groupId === opts.keepGroupId) return true;
      // Andere Gruppen zum selben Dest ebenfalls behalten (eine reicht; Merge cappt)
      return true;
    }
    if (s.kind !== 'nav_leg') return true;
    // Fallback-Einzeiler ohne groupId zum selben Dest → weg
    if (navLegDestKey(s.id, known) === dest) return false;
    if (/^ÖPNV (zu|nach) Ziel$/i.test(s.title.trim())) return false;
    return true;
  });
"""

new = """  return opts.stops.filter((s) => {
    if (isLive(s.id)) return true;
    if (s.groupId) {
      if (opts.keepGroupId && s.groupId === opts.keepGroupId) return true;
      // Andere Journey zum selben Dest → weg (max eine Gruppe)
      if (
        opts.keepGroupId &&
        navLegDestKey(s.groupId, known) === dest &&
        s.groupId !== opts.keepGroupId
      ) {
        return false;
      }
      return true;
    }
    if (s.kind !== 'nav_leg') return true;
    // Fallback-Einzeiler ohne groupId zum selben Dest → weg
    if (navLegDestKey(s.id, known) === dest) return false;
    if (/^ÖPNV (zu|nach) Ziel$/i.test(s.title.trim())) return false;
    return true;
  });
"""

if "Andere Journey zum selben Dest" in t:
    print("prune already updated")
elif old not in t:
    raise SystemExit("prune block missing")
else:
    t = t.replace(old, new, 1)
    tmp = p.with_suffix(".ts.tmpwrite")
    tmp.write_text(t, encoding="utf-8")
    os.replace(tmp, p)
    print("prune updated")

# --- extend smoke ---
smoke = root / "src/module2/timeline/gapFillTravel.smoke.test.ts"
st = smoke.read_text(encoding="utf-8")

if "countTravelHeadsForDest" in st and "nav_here_tour_1 + nav_wish" in st:
    print("smoke already extended")
else:
    # update imports
    old_imp = """import {
  countOepnvNachZielTitles,
  isGapFillRealStop,
  mergeGapFillPlanStops,
  shouldSkipTourInternalLeg,
} from './gapFillTravelPolicy';
"""
    new_imp = """import {
  countOepnvNachZielTitles,
  countTravelHeadsForDest,
  isGapFillRealStop,
  mergeGapFillPlanStops,
  navLegDestKey,
  pruneStaleFallbackLegsForDest,
  shouldSkipTourInternalLeg,
} from './gapFillTravelPolicy';
"""
    if old_imp not in st:
        raise SystemExit("smoke import missing")
    st = st.replace(old_imp, new_imp, 1)

    extra = r'''
// Dest-Key: nav_here_X und nav_FROM_X teilen Ziel X
assert.equal(
  navLegDestKey('nav_here_tour_1', ['wish_bf', 'tour_1']),
  'tour_1',
);
assert.equal(
  navLegDestKey('nav_wish_bf_tour_1', ['wish_bf', 'tour_1']),
  'tour_1',
);

// Ein Ziel → max ein Travel-Head (kein Ziel+Dammtor-Paar)
{
  const knownStops: FuturePlanStop[] = [
    breakfast,
    {
      id: 'tour_1',
      title: 'Dammtor',
      lat: 53.56,
      lng: 9.99,
      plannedStartMs: Date.parse('2026-09-05T11:30:00'),
      plannedEndMs: Date.parse('2026-09-05T11:40:00'),
      bufferMin: 0,
      transport: 'walk',
      kind: 'stop',
      status: 'planned',
    },
  ];
  const pairLegs = [
    fakeLeg('nav_here_tour_1', 'ÖPNV nach Ziel'),
    fakeLeg('nav_wish_bf_tour_1', 'ÖPNV nach Dammtor'),
  ];
  const mergedPair = mergeGapFillPlanStops({
    currentStops: knownStops,
    newLegs: pairLegs,
    isLiveNavLegId: () => false,
    plannedJourneyGroupExists: () => false,
  });
  assert.equal(
    countTravelHeadsForDest(mergedPair, 'tour_1'),
    1,
    'max one ÖPNV head per dest',
  );
}

// Stale Fallback weg wenn Journey-Gruppe existiert
{
  const groupLeg: FuturePlanStop = {
    ...fakeLeg('nav_wish_bf_tour_1_l0', 'S1 nach Dammtor'),
    groupId: 'nav_wish_bf_tour_1',
    groupLabel: 'ÖPNV nach Dammtor',
    routeEstimate: 'routed',
  };
  const withGroup = [
    breakfast,
    {
      id: 'tour_1',
      title: 'Dammtor',
      lat: 53.56,
      lng: 9.99,
      plannedStartMs: Date.parse('2026-09-05T11:30:00'),
      plannedEndMs: Date.parse('2026-09-05T11:40:00'),
      bufferMin: 0,
      transport: 'walk',
      kind: 'stop',
      status: 'planned',
    },
    fakeLeg('nav_here_tour_1', 'ÖPNV nach Ziel'),
    groupLeg,
  ];
  const existsG = (navId: string) =>
    withGroup.some((s) => s.groupId === navId && s.kind === 'nav_leg');
  const afterJourney = mergeGapFillPlanStops({
    currentStops: withGroup,
    newLegs: [fakeLeg('nav_here_tour_1', 'ÖPNV nach Ziel')],
    isLiveNavLegId: () => false,
    plannedJourneyGroupExists: existsG,
  });
  assert.equal(
    countOepnvNachZielTitles(afterJourney),
    0,
    'no stale ÖPNV nach Ziel beside journey',
  );
  const pruned = pruneStaleFallbackLegsForDest({
    stops: withGroup,
    destId: 'tour_1',
    keepGroupId: 'nav_wish_bf_tour_1',
  });
  assert.ok(
    !pruned.some((s) => s.id === 'nav_here_tour_1'),
    'prune drops fallback sibling',
  );
  assert.ok(
    pruned.some((s) => s.groupId === 'nav_wish_bf_tour_1'),
    'prune keeps real journey',
  );
}

'''
    if "max one ÖPNV head per dest" not in st:
        st = st.replace(
            "console.log('gapFillTravel.smoke.test.ts OK');\n",
            extra + "\nconsole.log('gapFillTravel.smoke.test.ts OK');\n",
            1,
        )
        tmp = smoke.with_suffix(".ts.tmpwrite")
        tmp.write_text(st, encoding="utf-8")
        os.replace(tmp, smoke)
        print("smoke extended")
    else:
        print("smoke extras present")