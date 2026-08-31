/**
 * Kompass-Kalibrierung pro Stadt: einmal Acht, dann halten.
 * Magnet darf danach nicht langsam wieder wegdriften.
 */

export const COMPASS_CITY_LOCK_KEY = 'findus.compass.cityLock.v1';

export type CityCompassLock = {
  cityId: string;
  calibratedAtMs: number;
  /** GPS-Nachzug nach der Acht (Grad). 0 direkt nach Kalibrierung. */
  biasDeg: number;
};

export type CityCompassLockBag = Record<string, CityCompassLock>;

export function normalizeCityLockId(cityId: string | null | undefined): string | null {
  const id = (cityId ?? '').trim().toLowerCase();
  return id.length ? id : null;
}

export function lockForCity(
  bag: CityCompassLockBag,
  cityId: string | null | undefined,
): CityCompassLock | null {
  const id = normalizeCityLockId(cityId);
  if (!id) return null;
  const row = bag[id];
  if (!row || typeof row.calibratedAtMs !== 'number') return null;
  return row;
}

export function upsertCityLock(
  bag: CityCompassLockBag,
  cityId: string,
  nowMs: number,
  biasDeg = 0,
): CityCompassLockBag {
  const id = normalizeCityLockId(cityId);
  if (!id) return bag;
  const prev = bag[id];
  const next: CityCompassLock = {
    cityId: id,
    calibratedAtMs: nowMs,
    biasDeg: Number.isFinite(biasDeg)
      ? biasDeg
      : typeof prev?.biasDeg === 'number'
        ? prev.biasDeg
        : 0,
  };
  return { ...bag, [id]: next };
}

export function patchCityLockBias(
  bag: CityCompassLockBag,
  cityId: string,
  biasDeg: number,
): CityCompassLockBag {
  const id = normalizeCityLockId(cityId);
  if (!id) return bag;
  const prev = bag[id];
  if (!prev) return bag;
  if (!Number.isFinite(biasDeg)) return bag;
  return { ...bag, [id]: { ...prev, biasDeg } };
}

/** Stadt hat eine Acht — Hinweis-Button bleibt aus, bis neu kalibriert wird. */
export function cityCompassIsHeld(lock: CityCompassLock | null | undefined): boolean {
  return !!lock && lock.calibratedAtMs > 0;
}

/**
 * GPS-Kurs darf den Lock nur anschubsen, nie umdrehen.
 * null = Sample verwerfen.
 */
export function gpsNudgeTowardCourse(
  headingDeg: number,
  courseDeg: number,
  t = 0.32,
  maxErrDeg = 48,
): number | null {
  if (!Number.isFinite(headingDeg) || !Number.isFinite(courseDeg)) return null;
  let err = ((courseDeg - headingDeg + 540) % 360) - 180;
  if (err <= -180) err += 360;
  if (Math.abs(err) > maxErrDeg) return null;
  const a = Math.max(0, Math.min(1, t));
  return ((headingDeg + a * err) % 360 + 360) % 360;
}
