/**
 * Ort-Verify: bei Zweifel („was ist das?“, falscher Spot) GPS ↔ Pack neu matchen.
 * Stadt-agnostisch — keine Hardcodes. Optional Nearby zur Absicherung.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';

const DOUBT_RE =
  /\b(was\s+ist\s+(das|hier)|welcher\s+ort|falsch(?:er)?\s+ort|stimmt\s+das|meintest\s+du|nicht\s+der\s+richtige|wo\s+bin\s+ich)\b/iu;

export function userDoubtsCurrentPlace(text: string): boolean {
  return DOUBT_RE.test((text || '').trim());
}

export type PlaceVerifyHit = {
  poi: Poi;
  distanceM: number;
  /** true wenn anderer Spot als der aktuelle Chat-Ort näher ist */
  differsFromCurrent: boolean;
  osmName?: string | null;
};

/**
 * Nächster Story-/Area-POI am GPS — zum Abgleich wenn User den Ort anzweifelt.
 */
export async function verifyNearestStoryPlace(opts: {
  lat: number;
  lng: number;
  currentPoiId?: number | null;
  maxM?: number;
}): Promise<PlaceVerifyHit | null> {
  const maxM = opts.maxM ?? 90;
  const pois = await getAllPois();
  let best: PlaceVerifyHit | null = null;
  for (const p of pois) {
    const kind = p.kind ?? 'legacy';
    if (kind === 'approach') continue;
    const d = haversineMeters(opts.lat, opts.lng, p.lat, p.lng);
    if (d > maxM) continue;
    if (!best || d < best.distanceM) {
      best = {
        poi: p,
        distanceM: Math.round(d),
        differsFromCurrent:
          opts.currentPoiId != null && p.id !== opts.currentPoiId,
      };
    }
  }

  let osmName: string | null = null;
  try {
    const { fetchNearbyPlaceLandmarks } = await import('./googleMapsNav');
    const near = await fetchNearbyPlaceLandmarks(opts.lat, opts.lng, 60);
    osmName = near.find((n) => n.name.trim().length >= 3)?.name ?? null;
  } catch {
    osmName = null;
  }
  if (best) best.osmName = osmName;
  return best;
}

/** Prompt-Hinweis für Synthese nach Verify. */
export function formatPlaceVerifyPromptBlock(hit: PlaceVerifyHit): string {
  const name = (hit.poi.name || '')
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .trim();
  return [
    'ORT-VERIFY (SSOT):',
    `Nächster Pack-Ort am GPS: „${name}“ (~${hit.distanceM} m).`,
    hit.osmName
      ? `OSM/Nearby-Gegenprobe: „${hit.osmName}“ — bei Widerspruch Pack vs. Nearby kurz ehrlich machen und korrigieren.`
      : 'Nearby ohne klaren Treffer — Pack-Match nutzen oder Unsicherheit nennen.',
    hit.differsFromCurrent
      ? 'Weicht vom bisher erzählten Ort ab — kurz korrigieren/bestätigen, dann erst weitererzählen. OSM/Web nur wenn Pack dünn.'
      : 'Stimmt mit aktuellem Ort überein — kurz bestätigen und fortsetzen.',
  ].join('\n');
}

