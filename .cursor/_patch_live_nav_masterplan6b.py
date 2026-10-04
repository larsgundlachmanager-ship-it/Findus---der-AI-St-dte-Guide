# -*- coding: utf-8 -*-
"""Live-Nav masterplan part2: stale, heading, puck, entgegen, timeline."""
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_ln6b")
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
            print(f"OK {path.relative_to(ROOT)}")
            return
        except OSError as e:
            print(f"  retry {i+1} {path.name}: {e}")
            time.sleep(0.35)
    raise SystemExit(f"FAILED {path}")


def patch(rel: str, old: str, new: str, *, already: str | None = None) -> None:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if already and already in t and old not in t:
        print(f"SKIP {rel} (already)")
        return
    if old not in t:
        print(f"MISS {rel}")
        print("--- expected snippet start ---")
        print(old[:240])
        print("---")
        return
    force_write(path, t.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Fix silly seedPts condition from part1
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/multiStopTour.ts",
    """  if (ok) {
    const seedPts =
      ride && Array.isArray(stop.stations) && stop.stations.length >= 2
        ? stop.stations
        : Array.isArray(stop.path) && stop.path.length >= 3
          ? stop.path
          : null;
    if (seedPts && (ride || !ride)) {
      try {
        const { seedActiveNavRoute } = require('./navigationService') as {
          seedActiveNavRoute: (o: {
            waypoints: Array<{
              lat: number;
              lng: number;
              maneuver: null;
              roadName: null;
              landmark: null;
              cue: null;
              instruction: null;
            }>;
          }) => boolean;
        };
        seedActiveNavRoute({
          waypoints: seedPts.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            maneuver: null,
            roadName: null,
            landmark: null,
            cue: null,
            instruction: null,
          })),
        });
      } catch {
        /* soft */
      }
    }
  }""",
    """  if (ok) {
    const seedPts = ride
      ? Array.isArray(stop.stations) && stop.stations.length >= 2
        ? stop.stations
        : Array.isArray(stop.path) && stop.path.length >= 3
          ? stop.path
          : null
      : Array.isArray(stop.path) && stop.path.length >= 3
        ? stop.path
        : null;
    if (seedPts) {
      try {
        const { seedActiveNavRoute } = require('./navigationService') as {
          seedActiveNavRoute: (o: {
            waypoints: Array<{
              lat: number;
              lng: number;
              maneuver: null;
              roadName: null;
              landmark: null;
              cue: null;
              instruction: null;
            }>;
          }) => boolean;
        };
        seedActiveNavRoute({
          waypoints: seedPts.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            maneuver: null,
            roadName: null,
            landmark: null,
            cue: null,
            instruction: null,
          })),
        });
      } catch {
        /* soft */
      }
    }
  }""",
    already="const seedPts = ride",
)

# ---------------------------------------------------------------------------
# 1.5 + 1.8 — progress catch-up + entgegen Fahrtrichtung in multiStopTour
# ---------------------------------------------------------------------------
patch(
    "src/services/navigation/multiStopTour.ts",
    """async function applyTourStopRuntime(stop: TourStop): Promise<void> {
  try {
    const { setActiveNavStations } = await import('./navigationService');
    if (stop.stations?.length) {
      setActiveNavStations(stop.stations);
    } else if (stop.role === 'walk' || stop.role === 'dest') {
      setActiveNavStations(null);
    }
  } catch {
    /* soft */
  }
  const cue = stop.speakOnStart?.trim();
  if (!cue) return;
  if (stop.role === 'alight') return;
  try {
    const { wasTransitGuideSpoken, noteTransitGuideSpoken } = await import(
      './transitGuideCoach'
    );
    if (stop.role === 'dest' && wasTransitGuideSpoken('lastwalk')) return;
    if (stop.role === 'transfer' && wasTransitGuideSpoken('transfer')) return;
    if (stop.role === 'dest') noteTransitGuideSpoken('lastwalk');
    if (stop.role === 'transfer') noteTransitGuideSpoken('transfer');
    const { speakAssistantText } = await import('../ttsService');
    setTimeout(() => {
      void speakAssistantText(cue).catch(() => {});
    }, 900);
  } catch {
    /* soft */
  }
}""",
    """function againstTravelCue(prev: TourStop | null, next: TourStop): string | null {
  if (!prev || prev.role !== 'alight') return null;
  if (next.role !== 'dest' && next.role !== 'walk' && next.role !== 'transfer') {
    return null;
  }
  try {
    const { bearingDegrees, shortestAngleDelta } = require('./bearing') as {
      bearingDegrees: (a: number, b: number, c: number, d: number) => number;
      shortestAngleDelta: (a: number, b: number) => number;
    };
    const chain =
      (Array.isArray(prev.stations) && prev.stations.length >= 2
        ? prev.stations
        : Array.isArray(prev.path) && prev.path.length >= 2
          ? prev.path
          : null) ?? null;
    if (!chain || chain.length < 2) return null;
    const a = chain[chain.length - 2]!;
    const b = chain[chain.length - 1]!;
    const vehicle = bearingDegrees(a.lat, a.lng, b.lat, b.lng);
    const foot = bearingDegrees(prev.lat, prev.lng, next.lat, next.lng);
    if (Math.abs(shortestAngleDelta(vehicle, foot)) < 120) return null;
    return 'entgegen der Fahrtrichtung';
  } catch {
    return null;
  }
}

async function applyTourStopRuntime(stop: TourStop): Promise<void> {
  try {
    const { setActiveNavStations } = await import('./navigationService');
    if (stop.stations?.length) {
      setActiveNavStations(stop.stations);
    } else if (stop.role === 'walk' || stop.role === 'dest') {
      setActiveNavStations(null);
    }
  } catch {
    /* soft */
  }
  let cue = stop.speakOnStart?.trim() || '';
  if (stop.role === 'alight') return;
  // Nach Ausstieg: optional „entgegen der Fahrtrichtung“ für den Fußweg.
  try {
    const tour = useFinnusStore.getState().multiStopTour;
    const idx = tour?.currentIndex ?? -1;
    const prev =
      tour && idx > 0 ? tour.stops[idx - 1] ?? null : null;
    const against = againstTravelCue(prev, stop);
    if (against) {
      cue = cue
        ? `${cue.replace(/\\.?\\s*$/, '')} — ${against}.`
        : `Fußweg ${against}.`;
    }
  } catch {
    /* soft */
  }
  if (!cue) return;
  try {
    const { wasTransitGuideSpoken, noteTransitGuideSpoken } = await import(
      './transitGuideCoach'
    );
    if (stop.role === 'dest' && wasTransitGuideSpoken('lastwalk')) return;
    if (stop.role === 'transfer' && wasTransitGuideSpoken('transfer')) return;
    if (stop.role === 'dest') noteTransitGuideSpoken('lastwalk');
    if (stop.role === 'transfer') noteTransitGuideSpoken('transfer');
    const { speakAssistantText } = await import('../ttsService');
    setTimeout(() => {
      void speakAssistantText(cue).catch(() => {});
    }, 900);
  } catch {
    /* soft */
  }
}""",
    already="againstTravelCue",
)

# Progress catch-up + clear timeline on tour end
patch(
    "src/services/navigation/multiStopTour.ts",
    """export async function advanceMultiStopTour(): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour) return false;

  const stops = tour.stops.map((s, i) =>
    i === tour.currentIndex ? { ...s, done: true } : s,
  );
  const nextIndex = tour.currentIndex + 1;
  if (nextIndex >= stops.length) {
    store.setMultiStopTour({
      ...tour,
      stops,
      currentIndex: nextIndex,
    });
    setTimeout(() => {
      const cur = useFinnusStore.getState().multiStopTour;
      if (cur && cur.currentIndex >= cur.stops.length) {
        useFinnusStore.getState().setMultiStopTour(null);
      }
    }, 8_000);
    void stopSpeaking().catch(() => {});
    return false;
  }""",
    """/**
 * GPS schon an/ hinter einem späteren Halt → Tour vorziehen + Journey refresh.
 * Verhindert stale Prisdorf-Verbindung wenn User schon weiter ist.
 */
export async function maybeCatchUpTourProgress(opts?: {
  lat?: number | null;
  lng?: number | null;
}): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour?.stops?.length) return false;
  const lat =
    opts?.lat ?? store.lastGpsLat ?? null;
  const lng =
    opts?.lng ?? store.lastGpsLng ?? null;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  const idx = tour.currentIndex;
  if (idx < 0 || idx >= tour.stops.length) return false;
  const cur = tour.stops[idx]!;
  if (cur.done) return false;

  // Nächsten noch offenen Stop finden, der GPS-nah ist (User schon weiter).
  let best = -1;
  let bestD = 95;
  for (let i = idx + 1; i < tour.stops.length; i += 1) {
    const s = tour.stops[i]!;
    if (s.done) continue;
    const d = haversineMeters(lat, lng, s.lat, s.lng);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // Oder: am aktuellen Halt vorbei Richtung Folgestopp (distNext << distCur).
  if (best < 0 && idx + 1 < tour.stops.length) {
    const next = tour.stops[idx + 1]!;
    const dCur = haversineMeters(lat, lng, cur.lat, cur.lng);
    const dNext = haversineMeters(lat, lng, next.lat, next.lng);
    if (dCur > 160 && dNext + 80 < dCur && dNext < 220) {
      best = idx + 1;
    }
  }
  if (best <= idx) return false;

  const stops = tour.stops.map((s, i) =>
    i < best ? { ...s, done: true } : s,
  );
  const nextTour = {
    ...tour,
    stops,
    currentIndex: best,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex: best,
    }),
  };
  store.setMultiStopTour(nextTour);
  mirrorTourToLiveTimeline();
  // Stale Verbindung: Leave-by / Transfer neu anfragen.
  try {
    const { requestJourneyRefresh } = require('./journeyLeaveBy') as {
      requestJourneyRefresh?: (reason?: string) => void;
    };
    requestJourneyRefresh?.('progress_past_stop');
  } catch {
    /* soft */
  }
  return navigateToTourStop(stops[best]!);
}

export async function advanceMultiStopTour(): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour) return false;

  const stops = tour.stops.map((s, i) =>
    i === tour.currentIndex ? { ...s, done: true } : s,
  );
  const nextIndex = tour.currentIndex + 1;
  if (nextIndex >= stops.length) {
    store.setMultiStopTour({
      ...tour,
      stops,
      currentIndex: nextIndex,
    });
    // Sofort Live-ÖPNV aus Timeline — kein Doppel-ÖPNV nach „Tour fertig“.
    try {
      const { clearLiveNavFromPlan } = require('../../module2/timeline/syncLiveNavToPlan') as {
        clearLiveNavFromPlan: (o?: { abandon?: boolean }) => void;
      };
      clearLiveNavFromPlan({ abandon: true });
    } catch {
      /* soft */
    }
    setTimeout(() => {
      const cur = useFinnusStore.getState().multiStopTour;
      if (cur && cur.currentIndex >= cur.stops.length) {
        useFinnusStore.getState().setMultiStopTour(null);
      }
    }, 8_000);
    void stopSpeaking().catch(() => {});
    return false;
  }""",
    already="maybeCatchUpTourProgress",
)

# Wire catch-up from journeyLeaveBy tick
patch(
    "src/services/navigation/journeyLeaveBy.ts",
    """  // Mitten in der Fahrt: kein Fuß-Pacing zum ersten Einstieg (wäre falsch „verpasst“).
  if (isMidRideTransit()) {
    void pollDelay();
    return;
  }""",
    """  // GPS schon weiter als Tour-Index → vorziehen + Verbindung refresh (stale Prisdorf).
  try {
    const { maybeCatchUpTourProgress } = require('./multiStopTour') as {
      maybeCatchUpTourProgress: (o?: {
        lat?: number | null;
        lng?: number | null;
      }) => Promise<boolean>;
    };
    void maybeCatchUpTourProgress({
      lat: origin.lat,
      lng: origin.lng,
    });
  } catch {
    /* soft */
  }
  // Mitten in der Fahrt: kein Fuß-Pacing zum ersten Einstieg (wäre falsch „verpasst“).
  if (isMidRideTransit()) {
    void pollDelay();
    return;
  }""",
    already="maybeCatchUpTourProgress",
)

# Export requestJourneyRefresh stub if missing — add lightweight hook
patch(
    "src/services/navigation/journeyLeaveBy.ts",
    """export function shouldDeferJourneyNav(leaveInMin: number): boolean {
  return leaveInMin > START_NAV_SLACK_MIN;
}""",
    """export function shouldDeferJourneyNav(leaveInMin: number): boolean {
  return leaveInMin > START_NAV_SLACK_MIN;
}

/** Tour ist GPS-seitig weiter — Leave-by/Transfer früher neu abfragen. */
export function requestJourneyRefresh(reason?: string): void {
  if (!watchAlive) return;
  lastMissedSwapMs = 0;
  lastCatchUpSpeakMs = 0;
  lastPaceHint = null;
  lastTransferHint = null;
  if (__DEV__) {
    console.log('[journeyLeaveBy] refresh', reason || 'manual');
  }
  void pollDelay();
  try {
    const tour = useFinnusStore.getState().multiStopTour;
    const idx = tour?.currentIndex ?? 0;
    const cur = tour?.stops?.[idx];
    if (cur?.role === 'alight' || cur?.role === 'transfer') {
      void pollTransferWhileRiding(Date.now());
    }
  } catch {
    /* soft */
  }
}""",
    already="export function requestJourneyRefresh",
)

print("part2a done")
