/**
 * OSM Overpass — sichtbare Landmarken für TTS-Ansagen (Briefkasten, Ampel, …).
 * Street View nur als lazy Button (kein Prefetch).
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
  if (tags.amenity === 'post_box' || tags.amenity === 'mailbox') {
    return tags.colour || tags.color
      ? `${tags.colour || tags.color}er Briefkasten`
      : 'Briefkasten';
  }
  if (tags.highway === 'traffic_signals') return 'Ampel';
  if (tags.amenity === 'bench') return 'Bank';
  if (tags.amenity === 'waste_basket') return 'Mülleimer';
  if (tags.highway === 'crossing') return 'Fußgängerüberweg';
  if (tags.amenity === 'fountain') return 'Brunnen';
  if (tags.natural === 'tree' && tags.name) return `Baum „${tags.name}"`;
  if (tags.shop) return tags.name || `Laden (${tags.shop})`;
  if (tags.tourism === 'artwork' && tags.name) return tags.name;
  if (tags.name) return tags.name;
  return null;
}

/**
 * Nächste sichtbare Landmarke im Radius (für „lauf auf den roten Briefkasten zu“).
 */
export async function fetchOsmVisualLandmark(opts: {
  lat: number;
  lng: number;
  radiusM?: number;
  headingDeg?: number | null;
}): Promise<VisualLandmarkCue | null> {
  const radius = opts.radiusM ?? 45;
  const q = `
[out:json][timeout:6];
(
  node(around:${radius},${opts.lat},${opts.lng})["amenity"~"post_box|mailbox|bench|waste_basket|fountain"];
  node(around:${radius},${opts.lat},${opts.lng})["highway"~"traffic_signals|crossing"];
  node(around:${radius},${opts.lat},${opts.lng})["shop"];
  node(around:${radius},${opts.lat},${opts.lng})["tourism"="artwork"];
);
out body 12;
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
        tags?: Record<string, string>;
      }>;
    };
    const elems = data.elements ?? [];
    let best: VisualLandmarkCue | null = null;
    for (const el of elems) {
      if (el.lat == null || el.lon == null || !el.tags) continue;
      const label = labelForTags(el.tags);
      if (!label) continue;
      const d = haversine(opts.lat, opts.lng, el.lat, el.lon);
      if (d > radius) continue;
      const cue: VisualLandmarkCue = {
        labelDe: label,
        typ: el.tags.amenity || el.tags.highway || el.tags.shop || 'poi',
        distanceM: Math.round(d),
        lat: el.lat,
        lng: el.lon,
        ttsLine: `Orientier dich am ${label} — etwa ${Math.round(d)} Meter.`,
        streetViewButtonReady: false,
      };
      if (!best || cue.distanceM < best.distanceM) best = cue;
    }
    if (!best) return null;

    // Nur Metadata: gibt es Street View? Bild NICHT laden.
    try {
      const ok = await streetViewAvailable(best.lat, best.lng);
      best.streetViewButtonReady = !!ok;
    } catch {
      best.streetViewButtonReady = false;
    }
    return best;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
