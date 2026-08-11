/**
 * Kandidaten-Pool: Pack-POIs, Stempel raus, Area/Theme soft.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import { hasVisitedSpot } from '../../runtime/triggerEngine';
import { useFinnusStore } from '../../store/useFinnusStore';
import type { TourCandidate, TourRequest } from './types';

function cleanName(name: string): string {
  return name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
}

function visitedPoiIds(): Set<number> {
  const ids = new Set<number>();
  try {
    for (const v of useFinnusStore.getState().visitedHistory ?? []) {
      if (typeof v.poiId === 'number') ids.add(v.poiId);
    }
  } catch {
    /* soft */
  }
  return ids;
}

function matchesArea(c: TourCandidate, hint: string | null): boolean {
  if (!hint) return true;
  const blob = `${c.name} ${c.category} ${c.tags.join(' ')}`.toLowerCase();
  return blob.includes(hint.toLowerCase()) || hint.split(/\s+/).some((w) => blob.includes(w));
}

export async function collectTourCandidates(
  req: TourRequest,
): Promise<TourCandidate[]> {
  const radius = req.radiusM ?? 3000;
  let pois: Awaited<ReturnType<typeof getAllPois>> = [];
  try {
    pois = await getAllPois();
  } catch {
    pois = [];
  }

  const visitedIds = req.visitedExclude ? visitedPoiIds() : new Set<number>();
  const out: TourCandidate[] = [];

  for (const p of pois) {
    if (p.kind === 'approach' || p.kind === 'sub') continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const d = haversineMeters(req.anchor.lat, req.anchor.lng, p.lat, p.lng);
    if (d > radius) continue;
    if (req.visitedExclude) {
      if (visitedIds.has(p.id)) continue;
      if (p.spot_key && hasVisitedSpot(p.spot_key)) continue;
    }
    const tags = parseTagsJson(p.tags_json);
    const cat = (p.category || '').toLowerCase();
    const name = cleanName(p.name);
    const blob = `${name} ${cat} ${tags.join(' ')}`.toLowerCase();
    if (
      /hotel|restaurant|café|cafe|supermarket|tankstelle|toilet|spielplatz|kindergarten|büro|buero/i.test(
        blob,
      )
    ) {
      continue;
    }
    const cand: TourCandidate = {
      poiId: p.id,
      name,
      lat: p.lat,
      lng: p.lng,
      category: cat || 'sight',
      tags,
      distanceM: Math.round(d),
      score: 1,
      priority: 'soft',
      source: 'pack',
      spotKey: p.spot_key ?? null,
    };
    if (!matchesArea(cand, req.areaHint ?? null)) continue;
    out.push(cand);
  }

  return out;
}
