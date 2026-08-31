/**
 * Run: npx --yes tsx src/services/location/lastKnownMapGps.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/services/location/lastKnownMapGps.ts'),
  'utf8',
);

assert(src.includes('MAP_GPS_PUCK_MAX_AGE_MS = 90_000'), 'Puck nur live / 90 s');
assert(
  src.includes('MAP_GPS_CAMERA_MAX_AGE_MS = 72 * 60 * 60_000'),
  'Kamera / Ausschnitt max 72 h',
);
assert(src.includes('export function seedMapCameraGps'), 'Kamera-Seed SSOT');
assert(src.includes('export async function hydrateLastKnownMapGps'), 'Cold-Start hydrate');
assert(src.includes('@findus/last_map_gps_v1'), 'Persist-Key');

function parseLastMapGps(raw: unknown): {
  lat: number;
  lng: number;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { lat?: unknown; lng?: unknown };
  const lat = typeof o.lat === 'number' ? o.lat : Number(o.lat);
  const lng = typeof o.lng === 'number' ? o.lng : Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

assert(parseLastMapGps({ lat: 53.55, lng: 9.99 })?.lat === 53.55, 'parse gültig');
assert(parseLastMapGps({ lat: 200, lng: 0 }) == null, 'lat > 90 weg');

console.log('lastKnownMapGps.smoke.test.ts OK');
