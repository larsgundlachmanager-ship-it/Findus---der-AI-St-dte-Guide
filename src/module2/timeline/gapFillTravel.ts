/**
 * Gap-Fill: Nav-Legs zwischen FuturePlan-Stops mit Koordinaten.
 * Planungszeit: ÖPNV als EIN kollabierter Leg (Umstiege nur in der Notiz).
 * Live-Einzelschritte: erst bei Nav-Start (`startJourneyNavigation`).
 */

import { haversineMeters } from '../../db/database';
import { getPlanBikeMPerMin, getPlanWalkMPerMin } from '../../services/mobility/paceProfile';
import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from './futurePlanState';
import {
  buildNavLegNotes,
  haversineWalkMin,
  resolveTravelOrigin,
  roundUpMinutesTo5,
  scheduleRefineNavLegRoute,
} from './planTravelHelpers';

function speedMPerMin(transport: FuturePlanTransport): number {
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
}

function pickLegTransport(
  preferred: FuturePlanTransport,
  walkMin: number,
): FuturePlanTransport {
  if (preferred === 'taxi' || preferred === 'car') {
    return preferred;
  }
  if (preferred === 'bike') {
    // Rad aus Profil/Default — bei sehr langen Legs → ÖPNV
    const bikeMin = Math.max(3, Math.round(walkMin * 0.4));
    if (bikeMin > 45 || walkMin > 100) return 'transit';
    return 'bike';
  }
  if (preferred === 'transit') return 'transit';
  // Fußweg über 20 Min → ÖPNV (Produktregel)
  if ((preferred === 'walk' || preferred === 'unknown') && walkMin > 20) {
    return 'transit';
  }
  return preferred === 'unknown' ? 'walk' : preferred;
}

function travelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  transport: FuturePlanTransport,
): number {
  const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  return Math.max(3, Math.ceil(dist / speedMPerMin(transport)));
}

function sortedRealStops(): FuturePlanStop[] {
  return useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('wish_') &&
        s.choiceSide == null,
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
  const hasPrior = realStops.some(
    (s) =>
      s.id !== first.id &&
      s.plannedStartMs != null &&
      first.plannedStartMs != null &&
      s.plannedStartMs < first.plannedStartMs,
  );
  if (hasPrior) return;

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
  const navId = `nav_here_${first.id}`;
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
  });
}

/**
 * Sync-Fallback (Luftlinie/Pace) — EIN Leg pro Stop-Paar.
 */
export function applyGapFillTravelLegs(): {
  legs: number;
  speech: string;
} {
  const store = useFuturePlanStore.getState();
  const realStops = sortedRealStops();
  const legs: FuturePlanStop[] = [];
  const transport = store.plan.transportDefault;

  pushOriginToFirstStopLeg(realStops, legs, transport);

  for (let i = 0; i < realStops.length - 1; i++) {
    const a = realStops[i]!;
    const b = realStops[i + 1]!;
    if (
      a.lat == null ||
      a.lng == null ||
      b.lat == null ||
      b.lng == null
    ) {
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
        // Eng — aber nicht rot markieren (Konflikt-Engine / Button löst das)
        void leaveBy;
      }
    }

    const navId = `nav_${a.id}_${b.id}`;
    legs.push({
      id: navId,
      title:
        legTransport === 'transit'
          ? `ÖPNV nach ${b.title}`
          : `Fußweg nach ${b.title}`,
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
      emoji: legTransport === 'transit' ? '🚌' : '🚶',
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
      });
    }
  }

  const refreshed = useFuturePlanStore
    .getState()
    .plan.stops.filter((s) => s.kind !== 'nav_leg');
  useFuturePlanStore.getState().setPlan({
    ...useFuturePlanStore.getState().plan,
    stops: [...refreshed, ...legs],
  });

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
