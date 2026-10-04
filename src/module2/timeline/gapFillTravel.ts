/**
 * Gap-Fill: Nav-Legs zwischen FuturePlan-Stops mit Koordinaten.
 * ÖPNV wird wie Live-Nav als aufklappbare Bein-Gruppe gelegt (zu Fuß → Bahn → Fuß).
 */

import { haversineMeters } from '../../db/database';
import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from './futurePlanState';
import { isLiveNavLegId } from './syncLiveNavToPlan';
import {
  buildNavLegNotes,
  haversineWalkMin,
  resolveTravelOrigin,
  roundUpMinutesTo5,
  scheduleRefineNavLegRoute,
} from './planTravelHelpers';
import { cleanPlanDestTitle, isPlanPromptLeak, plannedJourneyGroupExists } from './plannedJourneyGroup';
import {
  destAlreadyHasTravel,
  isGapFillRealStop,
  mergeGapFillPlanStops,
  shouldSkipTourInternalLeg,
} from './gapFillTravelPolicy';

export {
  isGapFillRealStop,
  mergeGapFillPlanStops,
  shouldSkipTourInternalLeg,
  countOepnvNachZielTitles,
  countTravelHeadsForDest,
  navLegDestKey,
  pruneStaleFallbackLegsForDest,
  destAlreadyHasTravel,
} from './gapFillTravelPolicy';

function speedMPerMin(transport: FuturePlanTransport): number {
  try {
    const {
      getPlanBikeMPerMin,
      getPlanWalkMPerMin,
    } = require('../../services/mobility/paceProfile') as {
      getPlanBikeMPerMin: () => number;
      getPlanWalkMPerMin: () => number;
    };
    switch (transport) {
      case 'bike':
        return getPlanBikeMPerMin();
      case 'transit':
        return 220;
      case 'car':
      case 'taxi':
        return 500;
      case 'flight':
        return 12_000;
      default:
        return getPlanWalkMPerMin();
    }
  } catch {
    switch (transport) {
      case 'bike':
        return 216;
      case 'transit':
        return 220;
      case 'car':
      case 'taxi':
        return 500;
      case 'flight':
        return 12_000;
      default:
        return 58;
    }
  }
}

function preferBikeNow(): boolean {
  try {
    const {
      resolveActiveTravelMode,
      travelModeNavPrefs,
    } = require('../../services/navigation/travelModeContext') as {
      resolveActiveTravelMode: () => { mode: string };
      travelModeNavPrefs: (m: string) => { preferBike?: boolean };
    };
    const active = resolveActiveTravelMode();
    if (active.mode === 'bike') return true;
    return travelModeNavPrefs(active.mode).preferBike === true;
  } catch {
    return false;
  }
}

function pickLegTransport(
  preferred: FuturePlanTransport,
  walkMin: number,
): FuturePlanTransport {
  const bikeMin = Math.max(3, Math.round(walkMin * 0.4));
  const transitMin = Math.max(8, Math.round(walkMin * 0.55));
  try {
    const { pickPlanMobilityMode } = require('../planning/planMobilityPolicy') as {
      pickPlanMobilityMode: (o: {
        walkMin: number;
        bikeMin: number;
        transitMin: number;
        preferBike: boolean;
        preferred: FuturePlanTransport;
        forceTaxiOrCar: boolean;
      }) => FuturePlanTransport;
    };
    return pickPlanMobilityMode({
      walkMin,
      bikeMin,
      transitMin,
      preferBike: preferBikeNow() || preferred === 'bike',
      preferred,
      forceTaxiOrCar: preferred === 'taxi' || preferred === 'car',
    });
  } catch {
    return preferred === 'bike' ? 'bike' : walkMin >= 25 ? 'transit' : 'walk';
  }
}

function travelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  transport: FuturePlanTransport,
): number {
  const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  return Math.max(3, Math.ceil(dist / speedMPerMin(transport)));
}

function hasLiveJourneyOnPlan(): boolean {
  try {
    const plan = useFuturePlanStore.getState().plan;
    return plan.stops.some(
      (s) =>
        s.groupId === 'live_journey' ||
        s.id === 'nav_live_active' ||
        s.id.startsWith('nav_live_tour_'),
    );
  } catch {
    return false;
  }
}

function sortedRealStops(): FuturePlanStop[] {
  return useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) => isGapFillRealStop(s) && !isLiveNavLegId(s.id),
    )
    .slice()
    .sort((a, b) => {
      const aT = a.plannedStartMs ?? Number.MAX_SAFE_INTEGER;
      const bT = b.plannedStartMs ?? Number.MAX_SAFE_INTEGER;
      return aT - bT;
    });
}

function pushOriginToFirstStopLeg(
  realStops: FuturePlanStop[],
  legs: FuturePlanStop[],
  transport: FuturePlanTransport,
): void {
  const now = Date.now();
  const first = realStops.find(
    (s) =>
      s.lat != null &&
      s.lng != null &&
      (s.plannedStartMs == null || s.plannedStartMs >= now - 5 * 60_000),
  );
  if (!first?.lat || !first.lng) return;
  if (isPlanPromptLeak(first.title) || !cleanPlanDestTitle(first.title)) return;

  const hasPriorWithCoords = realStops.some(
    (s) =>
      s.id !== first.id &&
      s.lat != null &&
      s.lng != null &&
      s.plannedStartMs != null &&
      first.plannedStartMs != null &&
      s.plannedStartMs < first.plannedStartMs,
  );
  if (hasPriorWithCoords) return;

  const navId = `nav_here_${first.id}`;
  if (plannedJourneyGroupExists(navId)) return;
  const planStopsNow = useFuturePlanStore.getState().plan.stops;
  if (hasLiveJourneyOnPlan()) return;
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

  const origin = resolveTravelOrigin({
    beforeMs: first.plannedStartMs ?? null,
  });
  if (!origin) return;

  const hv = haversineWalkMin(
    { lat: origin.lat, lng: origin.lng },
    { lat: first.lat, lng: first.lng },
  );
  const walkMin = roundUpMinutesTo5(hv.walkMin);
  const legTransport = pickLegTransport(transport, walkMin);
  const mins = Math.max(
    3,
    legTransport === 'walk'
      ? walkMin
      : travelMinutes(
          { lat: origin.lat, lng: origin.lng },
          { lat: first.lat, lng: first.lng },
          legTransport,
        ),
  );
  const leaveMs =
    first.plannedStartMs != null
      ? first.plannedStartMs - mins * 60_000 - (first.bufferMin || 0) * 60_000
      : now + 5 * 60_000;
  const arriveMs = leaveMs + mins * 60_000;
  legs.push({
    id: navId,
    title:
      legTransport === 'transit'
        ? `ÖPNV zu ${first.title}`
        : `Los zu ${first.title}`,
    lat: first.lat,
    lng: first.lng,
    plannedStartMs: leaveMs,
    plannedEndMs: arriveMs,
    bufferMin: 0,
    transport: legTransport,
    kind: 'nav_leg',
    status: 'pending_change',
    notes: buildNavLegNotes({
      transport: legTransport,
      walkMin: mins,
      distanceM: hv.distanceM,
      leaveMs,
      arriveMs,
      estimate: 'fallback',
    }),
    emoji: legTransport === 'transit' ? '🚌' : '🚶',
    routeEstimate: 'fallback',
  });
  scheduleRefineNavLegRoute({
    navId,
    from: { lat: origin.lat, lng: origin.lng },
    to: { lat: first.lat, lng: first.lng },
    arriveAtMs: first.plannedStartMs ?? null,
    prepBufferMin: first.bufferMin || 0,
    transport: legTransport,
    force: true,
  });
}

/**
 * Sync-Fallback (Luftlinie/Pace) — EIN Leg pro Stop-Paar.
 * Re-Run: stale Fallback „~ unterwegs“ weg, Journey-Gruppen bleiben, keine Doppel-ÖPNV.
 */
export function applyGapFillTravelLegs(opts?: {
  preferredTransport?: FuturePlanTransport | null;
  /** Nach Quiet-Shift einmal ohne Quiet-Reentry neu bauen. */
  skipQuietResolve?: boolean;
}): {
  legs: number;
  speech: string;
} {
  if (hasLiveJourneyOnPlan()) return { legs: 0, speech: '' };
  const store = useFuturePlanStore.getState();
  const realStops = sortedRealStops();
  const legs: FuturePlanStop[] = [];
  const transport =
    opts?.preferredTransport ?? store.plan.transportDefault;

  pushOriginToFirstStopLeg(realStops, legs, transport);

  for (let i = 0; i < realStops.length - 1; i++) {
    const a = realStops[i]!;
    const b = realStops[i + 1]!;
    if (a.id.startsWith('ft:') || b.id.startsWith('ft:')) continue;
    if (shouldSkipTourInternalLeg(a, b)) continue;
    if (
      a.lat == null ||
      a.lng == null ||
      b.lat == null ||
      b.lng == null
    ) {
      continue;
    }
    if (haversineMeters(a.lat, a.lng, b.lat, b.lng) < 120) {
      continue;
    }
    const hv = haversineWalkMin(
      { lat: a.lat, lng: a.lng },
      { lat: b.lat, lng: b.lng },
    );
    const walkMin = roundUpMinutesTo5(hv.walkMin);
    const legTransport = pickLegTransport(transport, walkMin);
    const mins = Math.max(
      3,
      legTransport === 'walk'
        ? walkMin
        : travelMinutes(
            { lat: a.lat, lng: a.lng },
            { lat: b.lat, lng: b.lng },
            legTransport,
          ),
    );
    const startMs =
      a.plannedEndMs ??
      (a.plannedStartMs != null ? a.plannedStartMs + 45 * 60_000 : null);
    const endMs = startMs != null ? startMs + mins * 60_000 : null;

    if (b.plannedStartMs != null && endMs != null) {
      const leaveBy =
        b.plannedStartMs - mins * 60_000 - (b.bufferMin || 0) * 60_000;
      if (startMs != null && leaveBy < startMs) {
        void leaveBy;
      }
    }

    const navId = `nav_${a.id}_${b.id}`;
    if (plannedJourneyGroupExists(navId)) continue;
    const destTitle = cleanPlanDestTitle(b.title);
    if (!destTitle || isPlanPromptLeak(b.title)) continue;
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
      legTransport === 'transit'
        ? `ÖPNV nach ${destTitle}`
        : legTransport === 'bike'
          ? `Rad nach ${destTitle}`
          : legTransport === 'taxi' || legTransport === 'car'
            ? `Fahrt nach ${destTitle}`
            : `Fußweg nach ${destTitle}`;
    const emoji =
      legTransport === 'transit'
        ? '🚌'
        : legTransport === 'bike'
          ? '🚲'
          : legTransport === 'taxi'
            ? '🚕'
            : legTransport === 'car'
              ? '🚗'
              : '🚶';
    legs.push({
      id: navId,
      title,
      lat: b.lat,
      lng: b.lng,
      plannedStartMs: startMs,
      plannedEndMs: endMs,
      bufferMin: 0,
      transport: legTransport,
      kind: 'nav_leg',
      status: 'planned',
      notes: buildNavLegNotes({
        transport: legTransport,
        walkMin: mins,
        distanceM: hv.distanceM,
        leaveMs: startMs,
        arriveMs: endMs,
        estimate: 'fallback',
      }),
      emoji,
      routeEstimate: 'fallback',
    });

    if (b.plannedStartMs == null && endMs != null) {
      store.upsertStop({
        ...b,
        plannedStartMs: endMs,
        status: b.status === 'conflict' ? 'conflict' : 'pending_change',
      });
    }

    if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
      scheduleRefineNavLegRoute({
        navId,
        from: { lat: a.lat, lng: a.lng },
        to: { lat: b.lat, lng: b.lng },
        arriveAtMs: b.plannedStartMs ?? null,
        prepBufferMin: b.bufferMin || 0,
        transport: legTransport,
        force: true,
      });
    }
  }

  const current = useFuturePlanStore.getState().plan;
  const merged = mergeGapFillPlanStops({
    currentStops: current.stops,
    newLegs: legs,
    isLiveNavLegId,
    plannedJourneyGroupExists,
  });
  useFuturePlanStore.getState().setPlan({
    ...current,
    stops: merged,
  });

  // Soft-Overlaps nach Legs still lösen — einmal, dann Legs ggf. neu
  if (!opts?.skipQuietResolve) {
    try {
      const snap = useFuturePlanStore
        .getState()
        .plan.stops.map((s) => `${s.id}:${s.plannedStartMs ?? ''}`)
        .join('|');
      const { resolveOverlapsQuietly } = require('../planning/planConflictResolve') as {
        resolveOverlapsQuietly: (o?: { speakIfStuck?: boolean }) => boolean;
      };
      resolveOverlapsQuietly({ speakIfStuck: false });
      const snap2 = useFuturePlanStore
        .getState()
        .plan.stops.map((s) => `${s.id}:${s.plannedStartMs ?? ''}`)
        .join('|');
      if (snap !== snap2) {
        return applyGapFillTravelLegs({
          ...opts,
          skipQuietResolve: true,
        });
      }
    } catch {
      /* soft — circular/RN */
    }
  }

  const speech =
    legs.length > 0
      ? `Wege gesetzt: ${legs.length} Strecken.`
      : 'Gap-Filler wartet auf Koordinaten der Stops.';

  return { legs: legs.length, speech };
}

/** Async alias — UI-only uses sync haversine gap-fill. */
export async function applyGapFillTravelLegsAsync(): Promise<{
  legs: number;
  speech: string;
}> {
  return applyGapFillTravelLegs();
}
