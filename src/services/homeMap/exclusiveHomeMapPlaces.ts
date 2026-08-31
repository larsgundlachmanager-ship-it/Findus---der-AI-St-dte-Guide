/**
 * Ein Standort = eine Statusfarbe (Einstellungen):
 * grün besucht · blau geplant · lila Auslösen · rot Story ohne Trigger.
 * Gebäude = Fläche ohne Punkt. Punkt nur ohne Gebäude.
 */

import { pointInPolygon } from '../geo/polygon';

/** Gleich MODUL1_MAP_COLORS — nicht stampMapModul1 importieren (RN-Kette). */
const GREEN = '#5FA88A';
const BLUE = '#3B7DD8';
const PURPLE = '#7A4FBF';
const RED = '#C45B5B';
const DARK_RED = '#8B3A3A';

export type ExclusiveMapPlace = {
  id: number;
  lat: number;
  lng: number;
  color: string;
  ring: Array<[number, number]> | null;
  keepDot?: boolean;
  amenityDot?: boolean;
  icon?: string;
  pointOnly?: boolean;
};

function metersBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = (aLat - bLat) * 111_320;
  const dLng = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export function statusColorRank(color: string): number {
  const c = String(color || '').toUpperCase();
  if (c === GREEN) return 4;
  if (c === BLUE) return 3;
  if (c === PURPLE) return 2;
  if (c === RED || c === DARK_RED) return 1;
  return 1;
}

export function winningStatusColor(a: string, b: string): string {
  return statusColorRank(a) >= statusColorRank(b) ? a : b;
}

function ringOf(p: ExclusiveMapPlace): Array<[number, number]> | null {
  return p.ring && p.ring.length >= 3 ? p.ring : null;
}

export function isBuildingFillPlace(p: ExclusiveMapPlace): boolean {
  // Echter Umriss = Fläche — auch wenn Host amenityDot falsch gesetzt hat.
  return ringOf(p) != null;
}

function pointInRing(
  lat: number,
  lng: number,
  ring: Array<[number, number]>,
): boolean {
  return pointInPolygon(
    lat,
    lng,
    ring.map(([la, ln]) => ({ latitude: la, longitude: ln })),
  );
}

function centroid(ring: Array<[number, number]>): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  for (const [la, ln] of ring) {
    lat += la;
    lng += ln;
  }
  const n = ring.length;
  return { lat: lat / n, lng: lng / n };
}

function buildingsOverlap(a: ExclusiveMapPlace, b: ExclusiveMapPlace): boolean {
  const ra = ringOf(a);
  const rb = ringOf(b);
  if (!ra || !rb) return metersBetween(a.lat, a.lng, b.lat, b.lng) < 14;
  if (pointInRing(a.lat, a.lng, rb) || pointInRing(b.lat, b.lng, ra)) return true;
  const ca = centroid(ra);
  const cb = centroid(rb);
  return (
    pointInRing(ca.lat, ca.lng, rb) ||
    pointInRing(cb.lat, cb.lng, ra) ||
    metersBetween(ca.lat, ca.lng, cb.lat, cb.lng) < 12
  );
}

function mergePair<T extends ExclusiveMapPlace>(keep: T, drop: T): T {
  const color = winningStatusColor(keep.color, drop.color);
  const keepIsFill = isBuildingFillPlace(keep);
  const dropIsFill = isBuildingFillPlace(drop);
  if (keepIsFill) {
    return {
      ...keep,
      color,
      keepDot: false,
      pointOnly: false,
      // Fläche statt Icon-Punkt
      icon: undefined,
    };
  }
  if (dropIsFill) {
    return {
      ...drop,
      color,
      keepDot: false,
      pointOnly: false,
      icon: undefined,
    };
  }
  // Icon vom Verlierer nur mitnehmen wenn praktisch dieselbe Position —
  // sonst wandert z. B. rail auf den Nachbar-Punkt.
  const sameSpot = metersBetween(keep.lat, keep.lng, drop.lat, drop.lng) < 4;
  const icon = sameSpot ? keep.icon || drop.icon : keep.icon;
  return {
    ...keep,
    color,
    icon,
    keepDot: true,
    pointOnly: true,
    ring: null,
  };
}

/** Überlappende Orte → ein Marker, eine Farbe. Fläche schlägt Punkt. */
export function exclusiveHomeMapPlaces<T extends ExclusiveMapPlace>(
  places: T[],
): T[] {
  if (places.length < 2) return places;
  const work = places.slice();
  const used = new Array(work.length).fill(false);
  const out: T[] = [];

  for (let i = 0; i < work.length; i++) {
    if (used[i]) continue;
    let acc = work[i];
    used[i] = true;
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < work.length; j++) {
        if (used[j]) continue;
        const other = work[j];
        const accFill = isBuildingFillPlace(acc);
        const otherFill = isBuildingFillPlace(other);
        let hit = false;
        if (accFill && otherFill) {
          hit = buildingsOverlap(acc, other);
        } else if (accFill) {
          const ring = ringOf(acc);
          hit = ring
            ? pointInRing(other.lat, other.lng, ring)
            : metersBetween(acc.lat, acc.lng, other.lat, other.lng) < 12;
        } else if (otherFill) {
          const ring = ringOf(other);
          hit = ring
            ? pointInRing(acc.lat, acc.lng, ring)
            : metersBetween(acc.lat, acc.lng, other.lat, other.lng) < 12;
        } else {
          // Zwei Punkte: unterschiedliche Icons nie verschmelzen
          // (sonst landet das Bahn-Icon auf dem Nachbar-POI).
          // Gleiche Transit-Icons (Doppel-Bahnhof) in ~90 m → einer.
          const bothTransit =
            (acc.icon === 'rail' || acc.icon === 'bus') &&
            other.icon === acc.icon;
          if (
            acc.icon &&
            other.icon &&
            acc.icon !== other.icon &&
            metersBetween(acc.lat, acc.lng, other.lat, other.lng) > 2
          ) {
            hit = false;
          } else if (bothTransit) {
            hit = metersBetween(acc.lat, acc.lng, other.lat, other.lng) < 90;
          } else {
            hit = metersBetween(acc.lat, acc.lng, other.lat, other.lng) < 12;
          }
        }
        if (!hit) continue;
        const accRank = statusColorRank(acc.color);
        const otherRank = statusColorRank(other.color);
        const keepFirst =
          accRank > otherRank ||
          (accRank === otherRank && isBuildingFillPlace(acc));
        acc = keepFirst ? mergePair(acc, other) : mergePair(other, acc);
        used[j] = true;
        grew = true;
      }
    }
    out.push(acc);
  }
  return out;
}
