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
  if (req.kind === 'hotel') {
    const amen = req.wishes
      .filter((w) => w.hardness === 'must' && (w.kind === 'amenity' || w.kind === 'vibe'))
      .map((w) => w.text)
      .join(' ');
    return `Hotel ${amen} ${city}`.replace(/\s+/g, ' ').trim();
  }
  if (req.kind === 'cinema') return `Kino ${city}`.trim();
  if (req.kind === 'bar') return `Bar Biergarten ${city}`.trim();
  if (req.kind === 'sight') {
    const wish = wishBlob(req);
    if (/strand|beach|baden|badestelle|freibad|priwall/.test(wish)) {
      return `Strand Beach Badestelle Freibad ${city}`.trim();
    }
    return `Sehenswürdigkeit Aussicht ${city}`.trim();
  }
  if (req.kind === 'food') {
    const wish = wishBlob(req);
    const dish = req.wishes.find((w) => w.kind === 'dish' && w.hardness === 'must');
    if (dish) {
      if (/eis|gelato|ice\s*cream|spaghetti/.test(dish.text.toLowerCase())) {
        return `Eisdiele Gelateria ${dish.text} ${city}`.trim();
      }
      return `${dish.text} Restaurant ${city}`.trim();
    }
    if (/spaghetti[- ]?eis|eisdiele|gelato|\beis\b/.test(wish)) {
      return `Eisdiele Gelateria Eis ${city}`.trim();
    }
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
  const amenityWish = wishBlob(req);
  if (/toilette|\bklo\b|\bwc\b|pinkeln|restroom/.test(amenityWish)) {
    return `Toilette WC Restroom ${city}`.trim();
  }
  if (/apotheke|pharmacy/.test(amenityWish)) {
    return `Apotheke pharmacy ${city}`.trim();
  }
  if (/geldautomat|\batm\b|bargeld/.test(amenityWish)) {
    return `Geldautomat ATM ${city}`.trim();
  }
  if (/parkplatz|parken|parkhaus|parking/.test(amenityWish)) {
    if (/kostenlos|gratis|frei(?:er|en)?\s+park/.test(amenityWish)) {
      return `kostenloser Parkplatz free parking ${city}`.trim();
    }
    return `Parkplatz Parken parking ${city}`.trim();
  }
  const base = `${req.title} ${req.context}`.replace(/\s+/g, ' ').trim();
  return `${base} ${city}`.trim().slice(0, 80);
}

/** Places-Hits: Tags nur aus echten Types — nie blind „food“ stempeln. */
function softTagsForPlacesHit(
  req: PitchRequest,
  name: string,
  types?: string[] | null,
): string[] {
  if (req.kind === 'hotel') return ['hotel'];
  const tags = new Set<string>();
  const typeBlob = (types ?? []).join(' ').toLowerCase();
  const n = name.toLowerCase();
  const foodishType =
    /restaurant|cafe|bakery|meal_takeaway|meal_delivery|bar|food|coffee|brunch/.test(
      typeBlob,
    ) ||
    /restaurant|café|cafe|bistro|bäck|baeck|bakery|imbiss|pizzeria|trattoria/.test(
      n,
    );
  if (req.kind === 'food' || req.kind === 'bar') {
    if (foodishType) {
      tags.add('food');
      tags.add(req.kind);
      if (/restaurant/.test(typeBlob) || /restaurant/.test(n)) {
        tags.add('restaurant');
      }
      if (/cafe|coffee/.test(typeBlob) || /café|cafe/.test(n)) tags.add('cafe');
      if (/bakery/.test(typeBlob) || /bäck|baeck|bakery/.test(n)) {
        tags.add('bakery');
      }
      if (/bar|pub/.test(typeBlob)) tags.add('bar');
    }
    // Landmarken-Types explizit markieren (Filter killt sie)
    if (
      /park|tourist_attraction|point_of_interest|bridge|route|church|museum/.test(
        typeBlob,
      ) &&
      !foodishType
    ) {
      tags.add('tourist_attraction');
      if (/park/.test(typeBlob)) tags.add('park');
    }
  }
  // Cuisine-Tags nur aus Name/Types — nie aus dem User-Wunsch stempeln
  // (sonst wird jedes Food-Hit „pizza“ und Strandbars überleben Hard-Match).
  if (/pizza|pizzeria/.test(n) || /\bpizza\b/.test(typeBlob)) {
    tags.add('pizza');
  }
  if (/sushi/.test(n) || /\bsushi\b/.test(typeBlob)) tags.add('sushi');
  if (/burger/.test(n) || /\bburger\b/.test(typeBlob)) tags.add('burger');
  if (
    /eisdiele|gelater|eiscafe|eiscafé|eiscafe|\beis\b|gelato/.test(n) ||
    /ice_cream/.test(typeBlob)
  ) {
    tags.add('eis');
    tags.add('eisdiele');
  }
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
    if (/museum|kirche|denkmal|aussicht|strand|beach|baden|freibad/.test(tags + name)) {
      softTags.push('sight');
    }
    const wishHit = req.wishes.some((w) => {
      const wt = w.text.toLowerCase().trim();
      // Nie den vollen Query-Blob matchen („essen“ in q → alle Pack-POIs)
      if (wt.length < 3) return false;
      if (/^(essen|food|restaurant|abend|mittag|heute|dort|hier)$/i.test(wt)) {
        return false;
      }
      return name.includes(wt) || tags.includes(wt);
    });
    if (req.kind === 'food' || req.kind === 'bar') {
      const gastro =
        softTags.includes('food') ||
        /restaurant|café|cafe|pizzeria|imbiss|trattoria|osteria|bistro|gastro/.test(
          tags + name,
        );
      if (!gastro) continue;
      if (
        /\b(brücke|bruecke|eisenbahn|bahnhof|haltestelle|parkplatz|denkmal)\b/.test(
          name,
        )
      ) {
        continue;
      }
    } else if (!wishHit && softTags.length === 0) {
      continue;
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
      forVisitMs: req.visitAtMs,
    });
    for (const h of hits ?? []) {
      if (!h?.name || h.lat == null || h.lng == null) continue;
      if (isWegweiserOrApproachName(h.name)) continue;
      const key = h.placeId || `${h.name}_${h.lat}_${h.lng}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = haversineMeters(req.anchor.lat, req.anchor.lng, h.lat, h.lng);
      if (d > 40_000) continue;
      if (d > bound + 1000 && req.searchMode !== 'city_best') continue;
      const types = Array.isArray(h.types) ? h.types : null;
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
        closedOnVisitDay:
          (h as { closedOnVisitDay?: boolean | null }).closedOnVisitDay ?? null,
        softTags: softTagsForPlacesHit(req, h.name, types),
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
  // Strand weit weg (Küste) → zusätzlich nähere Badestellen/Freibäder
  if (
    req.kind === 'sight' &&
    /strand|beach|baden|badestelle|freibad/.test(wishBlob(req))
  ) {
    try {
      const nearHits = await searchPlacesByText({
        query: `Freibad Badestelle Badesee ${req.cityHint || ''}`.trim(),
        lat: req.anchor.lat,
        lng: req.anchor.lng,
        radiusM: 12_000,
        enrich: true,
        forVisitMs: req.visitAtMs,
      });
      for (const h of nearHits ?? []) {
        if (!h?.name || h.lat == null || h.lng == null) continue;
        if (isWegweiserOrApproachName(h.name)) continue;
        const key = h.placeId || `${h.name}_${h.lat}_${h.lng}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = haversineMeters(req.anchor.lat, req.anchor.lng, h.lat, h.lng);
        const types = Array.isArray(h.types) ? h.types : null;
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
          closedOnVisitDay:
            (h as { closedOnVisitDay?: boolean | null }).closedOnVisitDay ??
            null,
          softTags: softTagsForPlacesHit(req, h.name, types),
          source: 'places',
          distFromAnchorM: d,
          websiteUrl:
            typeof (h as { websiteUri?: string | null }).websiteUri ===
            'string'
              ? String((h as { websiteUri: string }).websiteUri).trim() || null
              : null,
        });
        if (out.length >= 32) break;
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
  if (effective.kind === 'hotel') {
    try {
      const { stay22HotelCandidates } = await import('./stay22HotelCandidates');
      const live = await stay22HotelCandidates(effective);
      if (live.length >= 1) {
        return applyDetourScores(effective, live);
      }
    } catch {
      /* Stay22 leer → ehrliches Soft-Fail, keine Places-Namen ohne Preis */
    }
    return [];
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
