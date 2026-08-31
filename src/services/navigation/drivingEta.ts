/**
 * Auto-Fahrzeit — FOSSGIS routed-car (nicht Google Driving, nicht Fuß-OSRM).
 * Nur für Taxi/Uber-ETA, nie für Fuß-/Rad-Navigation.
 */

import { haversineMeters } from '../../db/database';
import { taxiDurationWithRushHour } from '../affiliate/partnerDeepPrefill';

const FOSSGIS_CAR_OSRM_BASE =
  'https://routing.openstreetmap.de/routed-car/route/v1/driving';

export type DrivingEta = {
  minutes: number;
  distanceM: number;
  routed: boolean;
};

function fallbackFromAir(distM: number, atMs?: number): DrivingEta {
  const base = Math.max(4, Math.round(distM / 450) + 3);
  return {
    minutes: taxiDurationWithRushHour(base, atMs ?? Date.now()),
    distanceM: Math.round(distM),
    routed: false,
  };
}

export async function estimateDrivingEta(opts: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  /** Geplanter Start — Berufsverkehr dort, nicht „jetzt nachts“. */
  atMs?: number;
  signal?: AbortSignal;
}): Promise<DrivingEta> {
  const air = haversineMeters(
    opts.fromLat,
    opts.fromLng,
    opts.toLat,
    opts.toLng,
  );
  const when = opts.atMs ?? Date.now();
  const ctrl = opts.signal ?? new AbortController();
  const timer =
    opts.signal != null
      ? null
      : setTimeout(() => (ctrl as AbortController).abort(), 7_000);
  try {
    const u = new URL(
      `${FOSSGIS_CAR_OSRM_BASE}/${opts.fromLng},${opts.fromLat};${opts.toLng},${opts.toLat}`,
    );
    u.searchParams.set('overview', 'false');
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return fallbackFromAir(air, when);
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{ duration?: number; distance?: number }>;
    };
    if (data.code !== 'Ok' || !data.routes?.[0]) return fallbackFromAir(air, when);
    const r = data.routes[0];
    const sec = typeof r.duration === 'number' ? r.duration : 0;
    const dist =
      typeof r.distance === 'number' && r.distance > 20 ? r.distance : air;
    if (!(sec > 0)) return fallbackFromAir(air, when);
    const baseMin = Math.max(1, Math.round(sec / 60));
    return {
      minutes: taxiDurationWithRushHour(baseMin, when),
      distanceM: Math.round(dist),
      routed: true,
    };
  } catch {
    return fallbackFromAir(air, when);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
