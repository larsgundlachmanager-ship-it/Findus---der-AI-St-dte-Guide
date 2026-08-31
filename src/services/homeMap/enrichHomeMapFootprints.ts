/**
 * Fehlende / Kasten-Footprints für Homescreen-Orte aus OSM nachziehen.
 * Cache in AsyncStorage (osmBuildingFootprint) + optional SQLite polygon_json.
 */

import type { Poi } from '../../db/types';
import { serializePolygon } from '../geo/polygon';
import {
  fetchOsmFootprintsForPois,
  packNeedsOsmFootprint,
  type OsmFootprintRing,
} from '../navigation/osmBuildingFootprint';
import { isHomePresenceMapPoi } from './homeMapPlaceTone';
import { isMapShelterBuildingPoi, isStreetPointAmenity } from './homeMapPlaceType';
import type { UserProfile } from '../../types/userProfile';

export type FootprintRingByPoiId = Map<number, OsmFootprintRing>;

/**
 * Story-/Karten-Orte ohne echten OSM-Umriss → Overpass einmal, Ergebnis gecacht.
 */
export async function enrichHomeMapFootprints(
  pois: Poi[],
  profile?: UserProfile | null,
  opts?: { nearLat?: number; nearLng?: number; maxM?: number },
): Promise<FootprintRingByPoiId> {
  const nearLat = opts?.nearLat;
  const nearLng = opts?.nearLng;
  const maxM = opts?.maxM ?? 1_200;
  const candidates = pois.filter((p) => {
    if (!isHomePresenceMapPoi(p, profile)) return false;
    const kind = p.kind ?? 'legacy';
    if (kind === 'approach') return false;
    if (kind === 'sub' && !isMapShelterBuildingPoi(p)) return false;
    // Nur echte Punkt-Amenities überspringen — Story-Museen/Hotels bekommen OSM-Umriss.
    if (isStreetPointAmenity(p) && !isMapShelterBuildingPoi(p)) return false;
    if (
      typeof nearLat === 'number' &&
      typeof nearLng === 'number' &&
      Number.isFinite(nearLat) &&
      Number.isFinite(nearLng)
    ) {
      const dLat = (p.lat - nearLat) * 111_320;
      const dLng =
        (p.lng - nearLng) * 111_320 * Math.cos((nearLat * Math.PI) / 180);
      if (Math.hypot(dLat, dLng) > maxM) return false;
    }
    return packNeedsOsmFootprint(p);
  });

  if (!candidates.length) {
    return new Map();
  }

  const fetched = await fetchOsmFootprintsForPois(
    candidates.map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      polygon_json: p.polygon_json,
      tags_json: p.tags_json,
    })),
  );

  // Persistenz in SQLite — Geofence + nächster App-Start
  if (fetched.size > 0) {
    try {
      const { updatePoiPolygonJson } = await import('../../db/database');
      const { useFinnusStore } = await import('../../store/useFinnusStore');
      const nextPois = [...useFinnusStore.getState().pois];
      let changed = false;
      for (const [id, ring] of fetched) {
        if (ring.length < 3) continue;
        const geo = ring.map(([latitude, longitude]) => ({
          latitude,
          longitude,
        }));
        const json = serializePolygon(geo);
        await updatePoiPolygonJson(id, json);
        const idx = nextPois.findIndex((p) => p.id === id);
        if (idx >= 0) {
          nextPois[idx] = { ...nextPois[idx]!, polygon_json: json };
          changed = true;
        }
      }
      if (changed) useFinnusStore.getState().setPois(nextPois);
    } catch {
      /* offline / db — Cache reicht für die Karte */
    }
  }

  return fetched;
}

/** Alle Karten-POIs einer Stadt beim Pack-Install anreichern (fire-and-forget). */
export async function enrichFootprintsAfterPackInstall(
  pois: Poi[],
): Promise<void> {
  await enrichHomeMapFootprints(pois, null);
}
