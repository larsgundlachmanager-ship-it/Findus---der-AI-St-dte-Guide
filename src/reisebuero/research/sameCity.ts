/**
 * Ein Ort für alles: Stay, Ziel, Clubs/Wünsche in derselben Stadt.
 * Stay↔Ziel darf etwas weiter sein (Insel/Metro). POIs kleben am Hotel.
 */

export const SAME_CITY_STAY_DEST_KM = 80;
/** Clubs, Padel, Sight — hart am Stay, nicht „irgendwo in der Region“. */
export const SAME_CITY_WISH_POI_KM = 35;

const OUTDOOR_WISH = new Set([
  'club',
  'activity',
  'padel',
  'tennis',
  'sand',
  'sea',
  'boat',
  'spikeball',
  'stadium',
  'tour',
  'sight',
]);

export function isOutdoorWishId(id: string | null | undefined): boolean {
  return OUTDOOR_WISH.has((id || '').toLowerCase());
}

export function kmBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export type SameCityPoi = {
  mustHaveId?: string | null;
  onProperty?: boolean;
  met?: boolean;
  lat?: number | null;
  lng?: number | null;
  distanceM?: number | null;
  name?: string | null;
  title?: string | null;
};

export function stayOrPlaceAnchor(opts: {
  stayLat?: number | null;
  stayLng?: number | null;
  placeLat?: number | null;
  placeLng?: number | null;
}): { lat: number; lng: number } | null {
  if (opts.stayLat != null && opts.stayLng != null) {
    return { lat: opts.stayLat, lng: opts.stayLng };
  }
  if (opts.placeLat != null && opts.placeLng != null) {
    return { lat: opts.placeLat, lng: opts.placeLng };
  }
  return null;
}

/** false = belegt zu weit weg. true = ok oder unbekannt (kein Hard-Fail). */
export function poiIsSameCity(
  poi: SameCityPoi,
  anchor: { lat: number; lng: number } | null,
  maxKm: number = SAME_CITY_WISH_POI_KM,
): boolean {
  if (poi.onProperty) return true;
  if (poi.lat != null && poi.lng != null && anchor) {
    return kmBetween({ lat: poi.lat, lng: poi.lng }, anchor) <= maxKm;
  }
  if (poi.distanceM != null) return poi.distanceM / 1000 <= maxKm;
  return true;
}

export function farOutdoorWishHits(
  pois: SameCityPoi[],
  anchor: { lat: number; lng: number } | null,
): Array<{ id: string; name: string; km: number | null }> {
  const out: Array<{ id: string; name: string; km: number | null }> = [];
  for (const p of pois) {
    if (!p.met || p.onProperty) continue;
    if (!isOutdoorWishId(p.mustHaveId)) continue;
    if (poiIsSameCity(p, anchor)) continue;
    let km: number | null = null;
    if (p.lat != null && p.lng != null && anchor) {
      km = Math.round(kmBetween({ lat: p.lat, lng: p.lng }, anchor));
    } else if (p.distanceM != null) {
      km = Math.round(p.distanceM / 1000);
    }
    out.push({
      id: p.mustHaveId || 'wish',
      name: (p.name || p.title || p.mustHaveId || 'POI').trim(),
      km,
    });
  }
  return out;
}
