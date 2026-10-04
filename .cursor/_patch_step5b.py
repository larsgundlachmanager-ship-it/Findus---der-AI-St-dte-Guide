# -*- coding: utf-8 -*-
from pathlib import Path
import os, time

root = Path(r"c:\Users\larsf\Findus 2.0")
p = root / "src/module2/timeline/planTravelHelpers.ts"
t = p.read_text(encoding="utf-8")

old = """        if (best) {
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

new = """        if (best) {
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

if "pruneStaleFallbackLegsForDest" in t and "destTitle," in t[t.find("replaceNavLegWithJourneyGroup"):t.find("replaceNavLegWithJourneyGroup")+800]:
    print("planTravelHelpers already patched")
elif old not in t:
    raise SystemExit("old refine block missing")
else:
    t = t.replace(old, new, 1)
    tmp = p.with_suffix(".ts.tmpwrite")
    tmp.write_text(t, encoding="utf-8")
    for i in range(10):
        try:
            os.replace(tmp, p)
            print("planTravelHelpers patched")
            break
        except Exception as e:
            print("retry", i, e)
            time.sleep(0.5)
    else:
        raise SystemExit("replace failed")