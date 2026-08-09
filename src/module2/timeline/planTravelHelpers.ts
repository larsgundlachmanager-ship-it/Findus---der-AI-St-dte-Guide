/**
 * Lean travel helpers for timeline gap-fill / calendar UI (no planning engine).
 */

import { haversineMeters } from '../../db/database';
import { formatDistanceKmOrM } from '../../services/navigation/travelEta';
import { useGpsStore } from '../../store/useGpsStore';
import { PRISDORF_FALLBACK } from '../types';
import {
  useFuturePlanStore,
  type FuturePlanStop,
} from './futurePlanState';

export function roundUpMinutesTo5(min: number): number {
  if (!Number.isFinite(min) || min <= 0) return 0;
  return Math.ceil(min / 5) * 5;
}

export function roundDownTo5Min(ms: number): number {
  const step = 5 * 60_000;
  return Math.floor(ms / step) * step;
}

export function roundUpTo5Min(ms: number): number {
  const step = 5 * 60_000;
  return Math.ceil(ms / step) * step;
}

export function computeLeaveByMs(opts: {
  arriveAtMs: number;
  travelMin: number;
  arriveEarlyMin: number;
}): number {
  const travelRaw = Math.max(0, opts.travelMin);
  const travel =
    travelRaw <= 0 ? 0 : Math.max(3, roundUpMinutesTo5(travelRaw) || 5);
  const earlyRaw = Math.max(0, opts.arriveEarlyMin);
  const early = earlyRaw <= 0 ? 0 : roundUpMinutesTo5(earlyRaw);
  return roundDownTo5Min(opts.arriveAtMs - (travel + early) * 60_000);
}

export function arriveEarlyMinForStop(opts: {
  category?: string | null;
  title?: string;
  notes?: string;
}): number {
  const blob = `${opts.category ?? ''} ${opts.title ?? ''} ${opts.notes ?? ''}`.toLowerCase();
  if (/\b(flug|flieger|airport|flughafen|boarding)\b/.test(blob)) return 90;
  if (/\b(hauptbahnhof|hbf|central\s*station)\b/.test(blob)) return 10;
  if (/\b(bahnhof|zug|bahn|ice|re\b|rb\b|train\s*station|gleis)\b/.test(blob)) {
    return 5;
  }
  if (
    opts.category === 'shop' ||
    /\b(einkauf|supermarkt|drogerie|rossmann|\bdm\b|apotheke|shop|besorg|markt)\b/.test(
      blob,
    )
  ) {
    return 0;
  }
  if (
    /\b(café|cafe|bäcker|baecker|bakery|imbiss|kiosk|späti|spaeti|snack)\b/.test(
      blob,
    )
  ) {
    return 0;
  }
  if (
    opts.category === 'meal' ||
    /\b(restaurant|essen|dinner|mittag|frühstück|fruehstueck|brunch)\b/.test(blob)
  ) {
    return 0;
  }
  if (
    /\b(tennis|sport|training|golf|fitness)\b/.test(blob) ||
    opts.category === 'sport'
  ) {
    return 5;
  }
  if (/\b(theater|konzert|vorstellung|oper|kino)\b/.test(blob)) return 10;
  if (
    /\b(museum|galerie|ausstellung|schloss|burg)\b/.test(blob) ||
    opts.category === 'culture'
  ) {
    return 5;
  }
  if (
    opts.category === 'appointment' ||
    opts.category === 'work' ||
    /\b(meeting|treffen|besprechung|arbeit|termin)\b/.test(blob)
  ) {
    return 30;
  }
  if (opts.category === 'transit') return 5;
  return 0;
}

export function haversineWalkMin(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): { walkMin: number; distanceM: number } {
  const distanceM = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  const walkMin = Math.max(3, Math.round(distanceM / 80));
  return { walkMin, distanceM };
}

export function formatPlanTravelMin(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return '';
  const m = Math.round(mins);
  if (m < 60) return `${m} Minuten`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return h === 1 ? '1 Stunde' : `${h} Stunden`;
  const hLabel = h === 1 ? '1 Stunde' : `${h} Stunden`;
  return `${hLabel} ${rest} Minuten`;
}

function formatClockMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function buildNavLegNotes(opts: {
  transport: 'walk' | 'bike' | 'transit' | 'car' | 'taxi' | string;
  walkMin: number;
  distanceM: number | null;
  leaveMs: number | null;
  arriveMs: number | null;
  estimate: 'fallback' | 'routed';
}): string {
  const emoji =
    opts.transport === 'transit'
      ? '🚌'
      : opts.transport === 'bike'
        ? '🚲'
        : opts.transport === 'taxi'
          ? '🚕'
          : opts.transport === 'car'
            ? '🚗'
            : '🚶';
  const mode =
    opts.transport === 'transit'
      ? 'ÖPNV'
      : opts.transport === 'bike'
        ? 'Rad'
        : opts.transport === 'taxi'
          ? 'Taxi'
          : opts.transport === 'car'
            ? 'Auto'
            : 'zu Fuß';
  const dist =
    opts.distanceM != null && Number.isFinite(opts.distanceM)
      ? formatDistanceKmOrM(opts.distanceM)
      : null;
  const clockBit =
    opts.leaveMs != null && opts.arriveMs != null
      ? ` · ${formatClockMs(opts.leaveMs)} → ${formatClockMs(opts.arriveMs)}`
      : opts.leaveMs != null
        ? ` · Los ${formatClockMs(opts.leaveMs)}`
        : '';
  const est = opts.estimate === 'fallback' ? ' · Schätzung' : '';
  return dist
    ? `${emoji} ${mode} · ${dist} · ${formatPlanTravelMin(opts.walkMin)}${clockBit}${est}`
    : `${emoji} ${mode} · ${formatPlanTravelMin(opts.walkMin)}${clockBit}${est}`;
}

function isPrisdorfFallback(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - PRISDORF_FALLBACK.lat) < 0.0008 &&
    Math.abs(lng - PRISDORF_FALLBACK.lng) < 0.0008
  );
}

export function resolveUserGps(): { lat: number; lng: number; source: 'gps' } | null {
  const g = useGpsStore.getState();
  if (
    g.lat != null &&
    g.lng != null &&
    Number.isFinite(g.lat) &&
    Number.isFinite(g.lng) &&
    !isPrisdorfFallback(g.lat, g.lng)
  ) {
    return { lat: g.lat, lng: g.lng, source: 'gps' };
  }
  return null;
}

function committedPlanStops(): FuturePlanStop[] {
  return useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.kind === 'stop' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('wish_') &&
        s.lat != null &&
        s.lng != null &&
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lng),
    );
}

export type TravelOrigin = {
  lat: number;
  lng: number;
  source: 'gps' | 'plan' | 'hint' | 'hotel';
  title?: string;
};

/** Startpunkt für Wege zum nächsten Punkt (GPS / vorheriger Stop / Hotel). */
export function resolveTravelOrigin(opts?: {
  beforeMs?: number | null;
  userLat?: number;
  userLng?: number;
}): TravelOrigin | null {
  const now = Date.now();
  const before =
    opts?.beforeMs != null && Number.isFinite(opts.beforeMs)
      ? opts.beforeMs
      : null;
  const stops = committedPlanStops();

  const beforeDest = stops
    .filter((s) => {
      if (s.plannedStartMs == null) return false;
      if (before == null) return s.plannedStartMs <= now + 15 * 60_000;
      return s.plannedStartMs < before - 30_000;
    })
    .sort((a, b) => (b.plannedStartMs ?? 0) - (a.plannedStartMs ?? 0));

  const fromReached = beforeDest.find(
    (s) => (s.plannedStartMs ?? 0) <= now + 12 * 60_000,
  );
  if (fromReached?.lat != null && fromReached.lng != null) {
    return {
      lat: fromReached.lat,
      lng: fromReached.lng,
      source: 'plan',
      title: fromReached.title,
    };
  }

  const between = beforeDest.filter((s) => (s.plannedStartMs ?? 0) > now);
  if (between.length && between[0]!.lat != null && between[0]!.lng != null) {
    const prev = between[0]!;
    return {
      lat: prev.lat!,
      lng: prev.lng!,
      source: 'plan',
      title: prev.title,
    };
  }

  try {
    const { useUserMemoryStore } = require('../../store/useUserMemoryStore') as {
      useUserMemoryStore: {
        getState: () => {
          getConfirmedHotel: () =>
            | { lat?: number; lng?: number; name?: string }
            | undefined;
          getHotelCandidate: () =>
            | { lat?: number; lng?: number; name?: string }
            | undefined;
        };
      };
    };
    const mem = useUserMemoryStore.getState();
    const hotel = mem.getConfirmedHotel() ?? mem.getHotelCandidate();
    if (
      hotel &&
      typeof hotel.lat === 'number' &&
      typeof hotel.lng === 'number' &&
      Number.isFinite(hotel.lat) &&
      Number.isFinite(hotel.lng) &&
      !isPrisdorfFallback(hotel.lat, hotel.lng)
    ) {
      return {
        lat: hotel.lat,
        lng: hotel.lng,
        source: 'hotel',
        title: hotel.name?.trim() || 'Unterkunft',
      };
    }
  } catch {
    /* soft */
  }

  const gps = resolveUserGps();
  if (gps) return { ...gps, source: 'gps' };

  if (
    opts?.userLat != null &&
    opts?.userLng != null &&
    Number.isFinite(opts.userLat) &&
    Number.isFinite(opts.userLng) &&
    !isPrisdorfFallback(opts.userLat, opts.userLng)
  ) {
    return { lat: opts.userLat, lng: opts.userLng, source: 'hint' };
  }
  return null;
}

export function mapsGpsUrl(
  name: string,
  lat: number,
  lng: number,
  placeId?: string | null,
): string {
  const label = (name || '').trim() || 'Ziel';
  const id =
    placeId && !placeId.startsWith('text:') && !placeId.startsWith('new:')
      ? placeId.replace(/^places\//, '')
      : null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const dest = `${lat},${lng}`;
    if (id) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(label)}&destination_place_id=${encodeURIComponent(id)}`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  }
  if (id) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}&query_place_id=${encodeURIComponent(id)}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(label)}`;
}

/** Soft background refine — echte Route nachziehen, UI sofort mit Fallback. */
export function scheduleRefineNavLegRoute(opts: {
  navId: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  arriveAtMs?: number | null;
  prepBufferMin?: number;
  transport?: string;
}): void {
  void (async () => {
    try {
      const { estimateTravelEtaRouted } = await import(
        '../../services/navigation/travelEta'
      );
      const mode =
        opts.transport === 'bike'
          ? 'bicycling'
          : opts.transport === 'transit'
            ? 'walking'
            : 'walking';
      const eta = await Promise.race([
        estimateTravelEtaRouted({
          userLat: opts.from.lat,
          userLng: opts.from.lng,
          destLat: opts.to.lat,
          destLng: opts.to.lng,
          mode: mode === 'bicycling' ? 'bicycling' : 'walking',
        }),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]);
      if (!eta) return;
      const mins =
        opts.transport === 'bike'
          ? eta.bikeMinutes
          : eta.directWalkMinutes;
      const store = useFuturePlanStore.getState();
      const leg = store.plan.stops.find((s) => s.id === opts.navId);
      if (!leg) return;
      const leaveMs =
        opts.arriveAtMs != null
          ? opts.arriveAtMs -
            mins * 60_000 -
            (opts.prepBufferMin || 0) * 60_000
          : leg.plannedStartMs;
      store.upsertStop({
        ...leg,
        plannedStartMs: leaveMs,
        plannedEndMs:
          leaveMs != null ? leaveMs + mins * 60_000 : leg.plannedEndMs,
        notes: `${mins} Min (Route)`,
        routeEstimate: 'routed',
        status: 'planned',
      });
    } catch {
      /* soft */
    }
  })();
}

export function kickGapFillInBackground(): void {
  try {
    const { applyGapFillTravelLegs } = require('./gapFillTravel') as {
      applyGapFillTravelLegs: () => unknown;
    };
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
}
