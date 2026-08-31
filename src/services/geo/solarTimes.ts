/**
 * Sonnenuntergang lokal aus Lat/Lng (NOAA / suncalc-Gleichung).
 * Unabhängig vom Wetter-API-Cache.
 */

const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const RAD = Math.PI / 180;
const OBLIQUITY = 23.4397 * RAD;
const J0 = 0.0009;

function toJulian(ms: number): number {
  return ms / DAY_MS - 0.5 + J1970;
}

function fromJulian(j: number): number {
  return (j + 0.5 - J1970) * DAY_MS;
}

function toDays(ms: number): number {
  return toJulian(ms) - J2000;
}

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number): number {
  const C =
    RAD *
    (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + 102.9372 * RAD + Math.PI;
}

function declination(l: number): number {
  return Math.asin(Math.sin(l) * Math.sin(OBLIQUITY));
}

function julianCycle(d: number, lw: number): number {
  return Math.round(d - J0 - lw / (2 * Math.PI));
}

function approxTransit(Ht: number, lw: number, n: number): number {
  return J0 + (Ht + lw) / (2 * Math.PI) + n;
}

function solarTransitJ(ds: number, M: number, L: number): number {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}

function hourAngle(h: number, phi: number, dec: number): number {
  return Math.acos(
    (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) /
      (Math.cos(phi) * Math.cos(dec)),
  );
}

/**
 * Sonnenuntergang des lokalen Kalender-Tages (ms Unix).
 * null in Polar-Nacht / Polartag.
 */
export function computeSunsetMs(
  lat: number,
  lng: number,
  atMs: number,
): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(atMs)) {
    return null;
  }
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(atMs);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const h0 = -0.833 * RAD;
  const cosHa =
    (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) /
    (Math.cos(phi) * Math.cos(dec));
  if (cosHa <= -1 || cosHa >= 1) return null;
  const w = hourAngle(h0, phi, dec);
  const a = approxTransit(w, lw, n);
  const Jset = solarTransitJ(a, M, L);
  const ms = fromJulian(Jset);
  return Number.isFinite(ms) ? ms : null;
}

function sameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Sunset der lokalen Kalender-Nacht — kein Sprung auf morgen. */
export function isTodaysSunsetLive(
  nowMs: number,
  sunsetMs: number | null | undefined,
  gracePastMs = 8 * 60_000,
): boolean {
  if (sunsetMs == null || !Number.isFinite(sunsetMs)) return false;
  if (!sameLocalDay(nowMs, sunsetMs)) return false;
  return sunsetMs >= nowMs - gracePastMs;
}

/** Heutiger Sunset; wenn schon vorbei → morgen. */
export function computeNextSunsetMs(
  lat: number,
  lng: number,
  nowMs: number,
  gracePastMs = 20 * 60_000,
): number | null {
  const today = computeSunsetMs(lat, lng, nowMs);
  if (today != null && today >= nowMs - gracePastMs) return today;
  const tomorrow = computeSunsetMs(lat, lng, nowMs + 24 * 3600_000);
  return tomorrow;
}

/**
 * Wetter-Sunset wenn plausibel, sonst lokale Solar-Rechnung.
 */
export function resolveSunsetMs(
  nowMs: number,
  lat: number | null | undefined,
  lng: number | null | undefined,
  weatherSunsetMs?: number | null,
): number | null {
  const wx =
    typeof weatherSunsetMs === 'number' && Number.isFinite(weatherSunsetMs)
      ? weatherSunsetMs
      : null;
  const solar =
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
      ? computeNextSunsetMs(lat, lng, nowMs)
      : null;
  const wxLive = wx != null && wx >= nowMs - 20 * 60_000;
  if (wxLive && solar != null && Math.abs(wx - solar) < 90 * 60_000) {
    return wx;
  }
  if (solar != null) return solar;
  if (wxLive) return wx;
  return null;
}
