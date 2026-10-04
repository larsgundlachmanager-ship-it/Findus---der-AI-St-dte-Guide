# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]


def write_atomic(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp_patch")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


def patch(path: str, old: str, new: str, label: str) -> None:
    p = ROOT / path
    t = p.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"FAIL {label}: old block not found in {path}")
    write_atomic(p, t.replace(old, new, 1))
    print(f"ok {label}")


patch(
    "src/services/homeMap/homeMapNavStart.ts",
    """  } finally {
    try {
      const now = useFinnusStore.getState();
      if (!now.navActive) now.setNavRouteLoading(false);
    } catch {
      /* soft */
    }
  }
}

/**
 * Sofort starten. Bei laufender Navigation: `replaceRoute` / `addStop`.
 */
export async function startHomeMapNavigation(""",
    """  } finally {
    try {
      const now = useFinnusStore.getState();
      // Loading nie kleben lassen — sonst wirkt Tap „Navigation“ tot.
      if (!now.navActive) now.setNavRouteLoading(false);
      now.setIsGenerating(false);
    } catch {
      /* soft */
    }
  }
}

/**
 * Sofort starten. Bei laufender Navigation: `replaceRoute` / `addStop`.
 */
export async function startHomeMapNavigation(""",
    "navStart finally commit",
)

patch(
    "src/services/homeMap/homeMapNavStart.ts",
    """    // Kurz: sofort Fuß. Live-Guard nach Route-Ready nur falls OSRM doch länger ist.
    const skipMobilityAsk = false;
    return commitImmediateNav(dest, 'foot', { skipMobilityAsk });
  } catch {
    if (navLooksStarted()) {
      notifyNavRouteGeometryChanged();
      return { ok: true, mode: 'walk' };
    }
    return { ok: false, reason: 'nav_failed' };
  } finally {
    if (opts?.addStop) {
      try {
        const now = useFinnusStore.getState();
        if (!now.navActive) now.setNavRouteLoading(false);
        now.setIsGenerating(false);
      } catch {
        /* soft */
      }
    }
  }
}""",
    """    // Karten-Button „Navigation“ = explizite Wahl — kein zweites Mobility-Ask.
    return commitImmediateNav(dest, 'foot', { skipMobilityAsk: true });
  } catch {
    if (navLooksStarted()) {
      notifyNavRouteGeometryChanged();
      return { ok: true, mode: 'walk' };
    }
    return { ok: false, reason: 'nav_failed' };
  } finally {
    try {
      const now = useFinnusStore.getState();
      if (!now.navActive) now.setNavRouteLoading(false);
      now.setIsGenerating(false);
    } catch {
      /* soft */
    }
  }
}""",
    "navStart skipMobility",
)

patch(
    "src/components/homeMap/HomeMapPlacePopup.tsx",
    """            const res = await startHomeMapNavigation(
              target,
              getCachedUserProfile(),
              {
                replaceRoute: mode === 'replace',
                addStop: mode === 'add',
              },
            );
            if (
              !res.ok &&
              !useFinnusStore.getState().navActive &&
              !useFinnusStore.getState().navRouteLoading
            ) {
              speakFail(res.reason);
            }
          } catch {
            speakFail('nav_failed');
          } finally {
            clearThinkingUi();
            setTimeout(() => {
              busyRef.current = false;
              setBusy(false);
            }, 400);
          }""",
    """            const res = await startHomeMapNavigation(
              target,
              getCachedUserProfile(),
              {
                replaceRoute: mode === 'replace',
                addStop: mode === 'add',
              },
            );
            if (!res.ok && !useFinnusStore.getState().navActive) {
              speakFail(res.reason);
            }
          } catch {
            speakFail('nav_failed');
          } finally {
            try {
              const st = useFinnusStore.getState();
              if (!st.navActive) st.setNavRouteLoading(false);
              st.setIsGenerating(false);
            } catch {
              /* soft */
            }
            clearThinkingUi();
            setTimeout(() => {
              busyRef.current = false;
              setBusy(false);
            }, 400);
          }""",
    "popup speakFail",
)

patch(
    "src/module2/timeline/syncLiveNavToPlan.ts",
    """function replaceLiveNavRows(dayKey: string, next: FuturePlanStop[]): void {
  const store = useFuturePlanStore.getState();
  store.ensureDay(dayKey);
  const liveIds = new Set(next.map((s) => s.id));
  const plan = store.getPlanForDay(dayKey);
  for (const s of [...plan.stops]) {
    if (isLiveNavLegId(s.id) && !liveIds.has(s.id)) {
      store.removeStop(s.id);
      continue;
    }
    // Geplante Duplikat-Beine derselben Fahrt entfernen (live_*_l0…),
    // sobald der Live-Spiegel die nummerierte Timeline schreibt.
    if (
      next.some((r) => r.groupId === 'live_journey') &&
      s.groupId === 'live_journey' &&
      !isLiveNavLegId(s.id) &&
      /^live_journey_l\\d+$/i.test(s.id)
    ) {
      store.removeStop(s.id);
    }
  }
  for (const row of next) {
    const prev = plan.stops.find((s) => s.id === row.id);
    const urls = mergePlaceActionUrls(row, prev);
    store.upsertStopOnDay(dayKey, { ...row, ...urls });
  }
}""",
    """function replaceLiveNavRows(dayKey: string, next: FuturePlanStop[]): void {
  const store = useFuturePlanStore.getState();
  store.ensureDay(dayKey);
  const liveIds = new Set(next.map((s) => s.id));
  const plan = store.getPlanForDay(dayKey);
  const nextOwnsLive = next.some((r) => r.groupId === 'live_journey');
  for (const s of [...plan.stops]) {
    if (isLiveNavLegId(s.id) && !liveIds.has(s.id)) {
      store.removeStop(s.id);
      continue;
    }
    // Live-Spiegel besitzt die Gruppe: alle alten live_journey-Zeilen weg
    // (auch _l* / _h* aus addJourneyToTimeline) — sonst Doppel-RB71 / Doppel-zu-Fuß.
    if (
      nextOwnsLive &&
      s.groupId === 'live_journey' &&
      !liveIds.has(s.id)
    ) {
      store.removeStop(s.id);
    }
  }
  for (const row of next) {
    const prev = plan.stops.find((s) => s.id === row.id);
    const urls = mergePlaceActionUrls(row, prev);
    store.upsertStopOnDay(dayKey, { ...row, ...urls });
  }
}""",
    "replaceLiveNavRows",
)

print("batch A done")
