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

function wishBlob(req: PitchRequest): string {
  return `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`.toLowerCase();
}

/** Approach/Teaser-POIs nie als Auswahl-Option pitchen. */
export function isWegweiserOrApproachName(
  name: string,
  tags?: string | null,
): boolean {
  const blob = `${name} ${tags ?? ''}`.toLowerCase();
  return (
    /\bwegweiser\b/.test(blob) ||
    /\bapproach\b/.test(blob) ||
    /\bteaser\b/.test(blob) ||
    /\bearly[_\s-]?teaser\b/.test(blob) ||
    /[·•|]\s*wegweiser\s*$/i.test(name.trim())
  );
}

function queryFor(req: PitchRequest): string {
  const city = (req.cityHint || '').trim() || 'in der Nähe';
  if (req.kind === 'hotel') return `Hotel ${city}`.trim();
  if (req.kind === 'cinema') return `Kino ${city}`.trim();
  if (req.kind === 'bar') return `Bar Biergarten ${city}`.trim();
  if (req.kind === 'sight') {
    return `Sehenswürdigkeit Aussicht ${city}`.trim();
  }
  if (req.kind === 'food') {
    const wish = wishBlob(req);
    if (/pizza/.test(wish)) return `Pizza Restaurant ${city}`.trim();
    if (/sushi/.test(wish)) return `Sushi Restaurant ${city}`.trim();
    if (/burger/.test(wish)) return `Burger Restaurant ${city}`.trim();
    if (/frühstück|fruehstueck|breakfast/.test(wish)) {
      return `Frühstück Café Brunch ${city}`.trim();
    }
    if (
      /snack|snacks|döner|doener|kebab|imbiss|spät|spaet/.test(wish) ||
      (req.searchMode === 'here_now' && new Date(req.visitAtMs).getHours() >= 20)
    ) {
      return `Imbiss Döner Spätkauf open now ${city}`.trim();
    }
    return `Restaurant ${city}`.trim();
  }
  const base = `${req.title} ${req.context}`.replace(/\s+/g, ' ').trim();
  return `${base} ${city}`.trim().slice(0, 80);
}

/** Places-Hits zum Food-Pitch: Cuisine-Tags aus Query, damit Filter/Rank nicht alles killt. */
function softTagsForPlacesHit(req: PitchRequest, name: string): string[] {
  if (req.kind === 'hotel') return ['hotel'];
  if (req.kind !== 'food' && req.kind !== 'bar') return [];
  const tags = new Set<string>(['food', req.kind, 'restaurant']);
  const wish = wishBlob(req);
  const n = name.toLowerCase();
  if (/pizza/.test(wish) || /pizza|pizzeria/.test(n)) tags.add('pizza');
  if (/sushi/.test(wish) || /sushi/.test(n)) tags.add('sushi');
  if (/burger/.test(wish) || /burger/.test(n)) tags.add('burger');
  return [...tags];
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
    if (isWegweiserOrApproachName(p.name, p.tags_json)) continue;
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
  // Ein Places-Call (max Radius) statt 4 sequentieller Ringe — Distanz filter lokal
  const radiusM =
    req.searchMode === 'city_best'
      ? Math.max(bound, 15_000)
      : req.searchMode === 'here_now'
        ? Math.max(bound, HERE_NOW_RINGS_M[HERE_NOW_RINGS_M.length - 1] ?? bound)
        : Math.max(bound, 2_500);
  const seen = new Set<string>();
  const out: PitchCandidate[] = [];
  const q = queryFor(req);
  try {
    const hits = await searchPlacesByText({
      query: q,
      lat: req.anchor.lat,
      lng: req.anchor.lng,
      radiusM,
      enrich: true,
    });
    for (const h of hits ?? []) {
      if (!h?.name || h.lat == null || h.lng == null) continue;
      if (isWegweiserOrApproachName(h.name)) continue;
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
        softTags: softTagsForPlacesHit(req, h.name),
        source: 'places',
        distFromAnchorM: d,
        websiteUrl:
          typeof (h as { websiteUri?: string | null }).websiteUri === 'string'
            ? String((h as { websiteUri: string }).websiteUri).trim() || null
            : null,
      });
      if (out.length >= 24) break;
    }
  } catch {
    /* soft */
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
  // Named city → Anker auf Stadtzentrum (nicht GPS), sonst Hotels in Priestewitz
  let effective = req;
  if (
    req.searchMode === 'city_best' &&
    req.cityHint &&
    !/\bhier\b/i.test(req.cityHint)
  ) {
    try {
      const { geocodePlaceName } = await import(
        '../../services/navigation/googleMapsNav'
      );
      const geo = await geocodePlaceName(req.cityHint, {
        cityHint: req.cityHint,
      });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        effective = {
          ...req,
          anchor: { lat: geo.lat, lng: geo.lng },
        };
      }
    } catch {
      /* soft — GPS-Anker bleibt */
    }
  }
  const [pack, places] = await Promise.all([
    packCandidatesAsync(effective),
    placesCandidates(effective),
  ]);
  const merged: PitchCandidate[] = [];
  const seen = new Set<string>();
  for (const c of [...pack, ...places]) {
    const key = (c.placeId || c.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return applyDetourScores(effective, merged);
}

export function kindHint(kind: PitchKind): string {
  return kind;
}
