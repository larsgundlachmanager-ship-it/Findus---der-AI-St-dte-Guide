/**
 * OSM Overpass — sichtbare Verkehrs-Landmarken an der Kreuzung.
 * Einfach: nur Ampel / Brücke / Tunnel / Treppe, ≤5 m.
 */

import { streetViewAvailable } from './googleMapsNav';

export type VisualLandmarkCue = {
  labelDe: string;
  typ: string;
  distanceM: number;
  lat: number;
  lng: number;
  /** TTS-Satz */
  ttsLine: string;
  /** Button vorbereiten, Bild erst bei Tap laden */
  streetViewButtonReady: boolean;
};

/** Default: nur Elemente direkt an der Kreuzung. */
export const OSM_VISUAL_LANDMARK_RADIUS_M = 5;

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const FETCH_MS = 8_000;

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function labelForTags(tags: Record<string, string>): string | null {
  if (tags.highway === 'traffic_signals') return 'Ampel';
  if (tags.highway === 'steps' || tags.stairs === 'yes') return 'Treppe';
  if (tags.tunnel === 'yes' || tags.man_made === 'tunnel') {
    return tags.name || 'Tunnel';
  }

  const bridgeVal = (tags.bridge || '').toLowerCase();
  const isBridge =
    tags.man_made === 'bridge' ||
    bridgeVal === 'yes' ||
    bridgeVal === 'boardwalk' ||
    bridgeVal === 'cantilever' ||
    bridgeVal === 'movable' ||
    bridgeVal === 'covered';
  if (isBridge) {
    if (tags.name) return tags.name;
    const hw = (tags.highway || '').toLowerCase();
    if (
      hw === 'footway' ||
      hw === 'path' ||
      hw === 'pedestrian' ||
      hw === 'steps' ||
      hw === 'cycleway' ||
      tags.foot === 'designated' ||
      tags.foot === 'yes'
    ) {
      return 'Fußgängerbrücke';
    }
    return 'Brücke';
  }
  // Keine Briefkästen, Läden, Kirchen, Shops — nur Verkehrs-Anker.
  return null;
}

/**
 * Nächste Verkehrs-Landmarke im Radius (Ampel/Brücke/Tunnel/Treppe).
 */
export async function fetchOsmVisualLandmark(opts: {
  lat: number;
  lng: number;
  radiusM?: number;
  headingDeg?: number | null;
}): Promise<VisualLandmarkCue | null> {
  const radius = opts.radiusM ?? OSM_VISUAL_LANDMARK_RADIUS_M;
  const q = `
[out:json][timeout:6];
(
  node(around:${radius},${opts.lat},${opts.lng})["highway"="traffic_signals"];
  node(around:${radius},${opts.lat},${opts.lng})["highway"="steps"];
  way(around:${radius},${opts.lat},${opts.lng})["highway"="steps"];
  way(around:${radius},${opts.lat},${opts.lng})["bridge"];
  way(around:${radius},${opts.lat},${opts.lng})["man_made"="bridge"];
  way(around:${radius},${opts.lat},${opts.lng})["tunnel"="yes"];
  way(around:${radius},${opts.lat},${opts.lng})["man_made"="tunnel"];
  way(around:${radius},${opts.lat},${opts.lng})["highway"~"footway|path|pedestrian|steps"]["bridge"];
);
out center body 16;
`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      elements?: Array<{
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };
    const elems = data.elements ?? [];
    let best: VisualLandmarkCue | null = null;
    for (const el of elems) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null || !el.tags) continue;
      const label = labelForTags(el.tags);
      if (!label) continue;
      const d = haversine(opts.lat, opts.lng, lat, lon);
      if (d > radius) continue;
      const feminine =
        label === 'Fußgängerbrücke' ||
        label === 'Brücke' ||
        /brücke$/i.test(label) ||
        label === 'Ampel' ||
        label === 'Treppe';
      const cue: VisualLandmarkCue = {
        labelDe: label,
        typ:
          el.tags.amenity ||
          el.tags.highway ||
          el.tags.man_made ||
          el.tags.tunnel ||
          'poi',
        distanceM: Math.round(d),
        lat,
        lng: lon,
        ttsLine: feminine
          ? `Orientier dich an der ${label}.`
          : `Orientier dich am ${label}.`,
        streetViewButtonReady: false,
      };
      const prefer =
        label === 'Ampel'
          ? -14
          : label === 'Fußgängerbrücke' || /brücke$/i.test(label)
            ? -12
            : label === 'Tunnel' || label === 'Treppe'
              ? -10
              : 0;
      const score = cue.distanceM + prefer;
      const bestScore =
        best == null
          ? Number.POSITIVE_INFINITY
          : best.distanceM +
            (best.labelDe === 'Ampel'
              ? -14
              : best.labelDe === 'Fußgängerbrücke' ||
                  /brücke$/i.test(best.labelDe)
                ? -8
                : 0);
      if (!best || score < bestScore) best = cue;
    }
    if (best) {
      best.streetViewButtonReady = await streetViewAvailable(
        best.lat,
        best.lng,
      ).catch(() => false);
    }
    return best;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
