/**
 * Autonomes Pack-Wachstum: User fragt nach einem Ort, der nicht im Datensatz ist.
 */

import { getAllPois } from '../../db/database';
import { extractNamedDestinationLabel } from '../concierge/canonicalDestination';
import {
  findNearbyPackPoi,
  getUnsyncedPoiDrafts,
  researchAndDraftPoi,
  type PoiDraft,
} from './poiDiscoveryResearch';
import { shouldGrowPackFromUtterance } from './packGrowthPolicy';

export { shouldGrowPackFromUtterance } from './packGrowthPolicy';

let lastGrowKey = '';
let lastGrowAtMs = 0;
let growInFlight: Promise<PoiDraft | null> | null = null;

async function findPackPoiByName(
  name: string,
): Promise<{ id: number; name: string } | null> {
  const q = name
    .toLowerCase()
    .replace(/^(restaurant|café|cafe|museum|kirche)\s+/i, '')
    .trim();
  if (q.length < 3) return null;
  try {
    const pois = await getAllPois();
    for (const p of pois) {
      if (p.kind === 'approach') continue;
      const n = p.name.toLowerCase();
      if (n === q || n.includes(q) || q.includes(n)) {
        return { id: p.id, name: p.name };
      }
    }
  } catch {
    /* soft */
  }
  return null;
}

/**
 * User fragt nach einem Ort, der nicht im Pack ist → Recherche + lokaler Datensatz.
 */
export async function maybeGrowPackFromUserTurn(opts: {
  userText: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<PoiDraft | null> {
  if (!shouldGrowPackFromUtterance(opts.userText)) return null;
  const lat = opts.lat;
  const lng = opts.lng;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }

  const hint = extractNamedDestinationLabel(opts.userText);
  if (hint) {
    const named = await findPackPoiByName(hint);
    if (named) return null;
  } else {
    const near = await findNearbyPackPoi(lat, lng, 90);
    if (near) return null;
  }

  const key = `${hint || 'here'}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
  const now = Date.now();
  if (key === lastGrowKey && now - lastGrowAtMs < 20 * 60_000) {
    try {
      const drafts = await getUnsyncedPoiDrafts();
      return (
        drafts.find(
          (d) => Math.abs(d.lat - lat) < 0.0008 && Math.abs(d.lng - lng) < 0.0008,
        ) ?? null
      );
    } catch {
      return null;
    }
  }
  if (growInFlight) return growInFlight;

  growInFlight = (async () => {
    lastGrowKey = key;
    lastGrowAtMs = now;
    return researchAndDraftPoi({
      lat,
      lng,
      userText: opts.userText,
      hintName: hint,
    });
  })().finally(() => {
    growInFlight = null;
  });
  return growInFlight;
}
