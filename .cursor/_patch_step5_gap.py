# -*- coding: utf-8 -*-
from pathlib import Path

root = Path(r"c:\Users\larsf\Findus 2.0")

# --- gapFillTravel.ts ---
p = root / "src/module2/timeline/gapFillTravel.ts"
t = p.read_text(encoding="utf-8")

old2 = """  const navId = `nav_here_${first.id}`;
  if (plannedJourneyGroupExists(navId)) return;
  if (
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
"""

new2 = """  const navId = `nav_here_${first.id}`;
  if (plannedJourneyGroupExists(navId)) return;
  const planStopsNow = useFuturePlanStore.getState().plan.stops;
  if (destAlreadyHasTravel(first.id, planStopsNow)) return;
  if (
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
"""

if old2 not in t:
    raise SystemExit("pushOrigin block missing")
t = t.replace(old2, new2, 1)

old3 = """    const navId = `nav_${a.id}_${b.id}`;
    if (plannedJourneyGroupExists(navId)) continue;
    const destTitle = cleanPlanDestTitle(b.title);
    if (!destTitle) continue;
    if (/^ziel$/i.test(destTitle)) continue;
    const title =
"""

new3 = """    const navId = `nav_${a.id}_${b.id}`;
    if (plannedJourneyGroupExists(navId)) continue;
    const destTitle = cleanPlanDestTitle(b.title);
    if (!destTitle) continue;
    if (/^ziel$/i.test(destTitle)) continue;
    if (
      destAlreadyHasTravel(b.id, [
        ...useFuturePlanStore.getState().plan.stops,
        ...legs,
      ])
    ) {
      continue;
    }
    const title =
"""

if old3 not in t:
    raise SystemExit("between-stops block missing")
t = t.replace(old3, new3, 1)
p.write_text(t, encoding="utf-8")
print("gapFillTravel.ts patched")

# --- planTravelHelpers.ts ---
p2 = root / "src/module2/timeline/planTravelHelpers.ts"
t2 = p2.read_text(encoding="utf-8")

old_r = """        if (best) {
          try {
            const { replaceNavLegWithJourneyGroup } = await import(
              './plannedJourneyGroup'
            );
            if (
              replaceNavLegWithJourneyGroup({
                navId: opts.navId,
                itinerary: best,
              })
            ) {
              return;
            }
          } catch {
            /* eine Zeile mit Detailtext */
          }
"""

new_r = """        if (best) {
          try {
            const { replaceNavLegWithJourneyGroup, cleanPlanDestTitle } =
              await import('./plannedJourneyGroup');
            const {
              navLegDestKey,
              knownGapFillStopIds,
              pruneStaleFallbackLegsForDest,
            } = await import('./gapFillTravelPolicy');
            const storePre = useFuturePlanStore.getState();
            const placeholder = storePre.plan.stops.find(
              (s) => s.id === opts.navId,
            );
            const known = knownGapFillStopIds(storePre.plan.stops);
            const destId = navLegDestKey(opts.navId, known);
            const destStop = destId
              ? storePre.plan.stops.find((s) => s.id === destId)
              : null;
            const destTitle =
              cleanPlanDestTitle(destStop?.title || '') ||
              cleanPlanDestTitle(placeholder?.title || '') ||
              null;
            if (
              replaceNavLegWithJourneyGroup({
                navId: opts.navId,
                destTitle,
                itinerary: best,
              })
            ) {
              if (destId) {
                const pruned = pruneStaleFallbackLegsForDest({
                  stops: useFuturePlanStore.getState().plan.stops,
                  destId,
                  keepGroupId: opts.navId,
                  isLiveNavLegId: (id) => {
                    try {
                      const {
                        isLiveNavLegId,
                      } = require('./syncLiveNavToPlan') as {
                        isLiveNavLegId: (x: string) => boolean;
                      };
                      return isLiveNavLegId(id);
                    } catch {
                      return false;
                    }
                  },
                });
                useFuturePlanStore.getState().setPlan({
                  ...useFuturePlanStore.getState().plan,
                  stops: pruned,
                  updatedAtMs: Date.now(),
                });
              }
              try {
                const {
                  usePlanCalendarUiStore,
                } = require('./planCalendarUiStore') as {
                  usePlanCalendarUiStore: {
                    getState: () => {
                      markRouteComputing: (id: string, on: boolean) => void;
                    };
                  };
                };
                usePlanCalendarUiStore
                  .getState()
                  .markRouteComputing(opts.navId, false);
              } catch {
                /* soft */
              }
              return;
            }
          } catch {
            /* eine Zeile mit Detailtext */
          }
"""

if old_r not in t2:
    raise SystemExit("scheduleRefine replace block missing")
t2 = t2.replace(old_r, new_r, 1)
p2.write_text(t2, encoding="utf-8")
print("planTravelHelpers.ts patched")
