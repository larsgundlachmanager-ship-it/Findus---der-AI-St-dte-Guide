/**
 * Kandidaten-Pool: Pack first, dann Places (Ringe / Stadt).
 */

import { getAllPois, haversineMeters } from '../../db/database';
import { searchPlacesByText } from '../../services/navigation/googleMapsNav';
import {
  HERE_NOW_RINGS_M,
  hereNowPrio,
  scoreDetourLandmark,
  scoreDetourOnRoute,
} from './detourHeuristic';
import type {
  PitchCandidate,
  PitchKind,
  PitchRequest,
  PitchSearchMode,
} from './types';

function mapsUrlFor(
  name: string,
  lat: number,
  lng: number,
  placeId?: string | null,
): string {
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      name,
    )}&query_place_id=${encodeURIComponent(placeId)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${name} @${lat},${lng}`,
  )}`;
}

function queryFor(req: PitchRequest): string {
  const city = (req.cityHint || '').trim();
  const base = `${req.title} ${req.context}`.replace(/\s+/g, ' ').trim();
  if (req.kind === 'hotel') return `${base} ${city} hotel`.trim();
  if (req.kind === 'cinema') return `${base} ${city} kino cinema`.trim();
  if (req.kind === 'bar') return `${base} ${city} bar biergarten`.trim();
  if (req.kind === 'sight') {
    return `${base} ${city} sehenswürdigkeit aussicht — kein Restaurant`.trim();
  }
  return `${base} ${city}`.trim();
}

function boundForMode(mode: PitchSearchMode): number {
  if (mode === 'city_best') return 25_000;
  if (mode === 'here_now') return HERE_NOW_RINGS_M[HERE_NOW_RINGS_M.length - 1]!;
  if (mode === 'landmark') return 4_000;
  return 3_500;
}

async function packCandidatesAsync(req: PitchRequest): Promise<PitchCandidate[]> {
  const pois = (await getAllPois()) as Array<{
    id?: number;
    name?: string;
    lat?: number;
    lng?: number;
    tags_json?: string | null;
    general_info?: string | null;
  }>;
  const bound = boundForMode(req.searchMode);
  const q = `${req.title} ${req.context}`.toLowerCase();
  const out: PitchCandidate[] = [];
  for (const p of pois) {
    if (p.lat == null || p.lng == null || !p.name?.trim()) continue;
    const d = haversineMeters(req.anchor.lat, req.anchor.lng, p.lat, p.lng);
    if (req.searchMode !== 'city_best' && d > bound + 800) continue;
    const tags = `${p.tags_json ?? ''} ${p.general_info ?? ''}`.toLowerCase();
    const name = p.name.toLowerCase();
    const softTags: string[] = [];
    if (/restaurant|café|cafe|imbiss|gastro/.test(tags + name)) {
      softTags.push('food');
    }
    if (/hotel|pension/.test(tags + name)) softTags.push('hotel');
    if (/museum|kirche|denkmal|aussicht/.test(tags + name)) softTags.push('sight');
    const wishHit = req.wishes.some((w) => {
      const wt = w.text.toLowerCase();
      return name.includes(wt) || tags.includes(wt) || q.includes(wt);
    });
    if (!wishHit && softTags.length === 0 && req.kind === 'food') {
      if (!/restaurant|café|cafe|pizzeria|imbiss/.test(tags + name)) continue;
    }
    out.push({
      name: p.name.trim(),
      lat: p.lat,
      lng: p.lng,
      placeId: null,
      rating: null,
      mapsUrl: mapsUrlFor(p.name, p.lat, p.lng),
      softTags,
      source: 'pack',
      distFromAnchorM: d,
    });
  }
  return out.slice(0, 40);
}

async function placesCandidates(
  req: PitchRequest,
): Promise<PitchCandidate[]> {
  const bound = boundForMode(req.searchMode);
  const rings =
    req.searchMode === 'city_best'
      ? [3000, 8000, 15000, bound]
      : req.searchMode === 'here_now'
        ? [...HERE_NOW_RINGS_M]
        : [800, 1500, 2500, bound];
  const seen = new Set<string>();
  const out: PitchCandidate[] = [];
  const q = queryFor(req);
  for (const radius of rings) {
    if (out.length >= 24) break;
    try {
      const hits = await searchPlacesByText({
        query: q,
        lat: req.anchor.lat,
        lng: req.anchor.lng,
        radiusM: radius,
        enrich: true,
      });
      for (const h of hits ?? []) {
        if (!h?.name || h.lat == null || h.lng == null) continue;
        const key = h.placeId || `${h.name}_${h.lat}_${h.lng}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = haversineMeters(req.anchor.lat, req.anchor.lng, h.lat, h.lng);
        if (d > bound + 1000 && req.searchMode !== 'city_best') continue;
        out.push({
          name: h.name,
          lat: h.lat,
          lng: h.lng,
          placeId: h.placeId ?? null,
          rating: typeof h.rating === 'number' ? h.rating : null,
          ratingCount:
            typeof h.ratingCount === 'number' ? h.ratingCount : null,
          address: null,
          mapsUrl: mapsUrlFor(h.name, h.lat, h.lng, h.placeId),
          openNow: h.openNow ?? null,
          opensAtMin: h.opensAtMin ?? null,
          closesAtMin: h.closesAtMin ?? null,
          softTags: [],
          source: 'places',
          distFromAnchorM: d,
        });
      }
    } catch {
      /* soft */
    }
  }
  return out;
}

function applyDetourScores(
  req: PitchRequest,
  list: PitchCandidate[],
): PitchCandidate[] {
  return list.map((c) => {
    if (
      (req.searchMode === 'on_route' || req.searchMode === 'between_stops') &&
      req.route
    ) {
      const s = scoreDetourOnRoute(c, req.route);
      return {
        ...c,
        detourPrio: s.prio,
        detourMinApprox: s.extraMin,
        sideM: s.sideM,
      };
    }
    if (req.searchMode === 'landmark' && req.landmark) {
      const s = scoreDetourLandmark(c, req.landmark);
      return {
        ...c,
        detourPrio: s.prio,
        detourMinApprox: s.extraMin,
        sideM: s.sideM,
      };
    }
    const d = c.distFromAnchorM ?? 0;
    return {
      ...c,
      detourPrio: hereNowPrio(d),
      detourMinApprox: d / 80,
      sideM: d,
    };
  });
}

export async function collectCandidates(
  req: PitchRequest,
): Promise<PitchCandidate[]> {
  const pack = await packCandidatesAsync(req);
  const places = await placesCandidates(req);
  const merged: PitchCandidate[] = [];
  const seen = new Set<string>();
  for (const c of [...pack, ...places]) {
    const key = (c.placeId || c.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return applyDetourScores(req, merged);
}

export function kindHint(kind: PitchKind): string {
  return kind;
}
