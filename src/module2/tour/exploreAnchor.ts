/**
 * Stadt erkunden: Anker auf Pack-Highlights, nicht Tennisplatz-GPS.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import { wantsCityExplore } from './parentBrief';
import type { TourRequest } from './types';

export { wantsCityExplore } from './parentBrief';

const SIGHT_RE =
  /kirche|museum|denkmal|schloss|rathaus|markt|hafen|altstadt|turm|dom|kloster|speicher|holsten|wahrzeichen|highlight|must_have|must-have/;

export async function resolveTourExploreAnchor(
  req: TourRequest,
): Promise<{ lat: number; lng: number; radiusM: number }> {
  const gps = req.anchor;
  const defaultRadius = req.radiusM ?? 3000;
  let namedCity: string | null = null;
  try {
    const { extractCityFromText } = require('../context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    namedCity =
      extractCityFromText(req.context) || extractCityFromText(req.title);
  } catch {
    namedCity = null;
  }
  if (namedCity && !/\bhier\b/i.test(namedCity)) {
    try {
      const { geocodePlaceName } = await import(
        '../../services/navigation/googleMapsNav'
      );
      const geo = await geocodePlaceName(namedCity, { cityHint: namedCity });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        return {
          lat: geo.lat,
          lng: geo.lng,
          radiusM: Math.max(defaultRadius, 8000),
        };
      }
    } catch {
      /* pack-centroid fallback */
    }
  }
  if (!wantsCityExplore(req.context) && !wantsCityExplore(req.title)) {
    return { lat: gps.lat, lng: gps.lng, radiusM: defaultRadius };
  }
  try {
    const pois = await getAllPois();
    const sights = pois.filter((p) => {
      if (p.kind === 'approach' || p.kind === 'sub') return false;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
      const blob = `${p.name} ${p.category ?? ''} ${parseTagsJson(p.tags_json).join(' ')}`.toLowerCase();
      if (/hotel|restaurant|café|cafe|parkplatz|tennis|schule|supermarkt/.test(blob)) {
        return false;
      }
      return SIGHT_RE.test(blob) || /must_have|highlight|wahrzeichen/.test(blob);
    });
    if (sights.length < 3) {
      return { lat: gps.lat, lng: gps.lng, radiusM: Math.max(defaultRadius, 8000) };
    }
    const lat = sights.reduce((s, p) => s + p.lat, 0) / sights.length;
    const lng = sights.reduce((s, p) => s + p.lng, 0) / sights.length;
    const span = Math.max(
      ...sights.map((p) => haversineMeters(lat, lng, p.lat, p.lng)),
    );
    const fromGps = haversineMeters(gps.lat, gps.lng, lat, lng);
    if (fromGps < 1200) {
      return { lat: gps.lat, lng: gps.lng, radiusM: Math.max(defaultRadius, 6000) };
    }
    return {
      lat,
      lng,
      radiusM: Math.max(defaultRadius, Math.min(12_000, Math.round(span + 1500))),
    };
  } catch {
    return { lat: gps.lat, lng: gps.lng, radiusM: Math.max(defaultRadius, 8000) };
  }
}
