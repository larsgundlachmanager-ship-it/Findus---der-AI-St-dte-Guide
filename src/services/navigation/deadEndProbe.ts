/**
 * OSM-Heuristik: Sackgasse / noexit vor dem User in Laufrichtung.
 */

import { bearingDegrees, distanceMeters, shortestAngleDelta } from './bearing';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

const FETCH_MS = 5_500;
const LOOK_AHEAD_M = 55;
const CONE_DEG = 55;

type OsmEl = {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function elPoint(el: OsmEl): { lat: number; lng: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

async function overpass(ql: string): Promise<OsmEl[]> {
  let lastErr: unknown;
  for (const ep of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(ql)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      const data = (await res.json()) as { elements?: OsmEl[] };
      return data.elements ?? [];
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  if (__DEV__) console.warn('[deadEnd] overpass failed', lastErr);
  return [];
}

/**
 * true wenn in Blick-/Laufrichtung ein OSM-noexit / Sackgassen-Hinweis liegt.
 */
export async function probeDeadEndAhead(opts: {
  lat: number;
  lng: number;
  headingDeg?: number | null;
  radiusM?: number;
}): Promise<boolean> {
  const radius = opts.radiusM ?? LOOK_AHEAD_M;
  const ql = `
[out:json][timeout:5];
(
  node(around:${radius},${opts.lat},${opts.lng})["noexit"="yes"];
  way(around:${radius},${opts.lat},${opts.lng})["noexit"="yes"];
  node(around:${radius},${opts.lat},${opts.lng})["highway"="turning_circle"];
  node(around:${radius},${opts.lat},${opts.lng})["highway"="turning_loop"];
);
out center tags;
`.trim();

  const els = await overpass(ql);
  if (!els.length) return false;

  const heading =
    typeof opts.headingDeg === 'number' && Number.isFinite(opts.headingDeg)
      ? opts.headingDeg
      : null;

  for (const el of els) {
    const pt = elPoint(el);
    if (!pt) continue;
    const d = distanceMeters(opts.lat, opts.lng, pt.lat, pt.lng);
    if (d > radius) continue;
    if (heading == null) return true;
    const to = bearingDegrees(opts.lat, opts.lng, pt.lat, pt.lng);
    if (Math.abs(shortestAngleDelta(heading, to)) <= CONE_DEG) return true;
  }
  return false;
}
