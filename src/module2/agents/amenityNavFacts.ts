/**
 * Fact-Lane: Supermarkt/Amenity per Pack + OSM (€0) — Auto-Nav bei 1 Treffer.
 */

import { haversineMeters, getAllPois } from '../../db/database';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import { searchOsmPlacesNearby } from '../../services/navigation/overpassService';
import type { Module2ActionButton } from '../types';
import type { AgentResult } from '../types';

export type AmenityKind =
  | 'aldi'
  | 'lidl'
  | 'supermarket'
  | 'bakery'
  | 'generic';

export function detectAmenityKind(text: string): AmenityKind | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\baldi\b/i.test(t) && !/\b(mango|spritz|angebot|prospekt)\b/i.test(t)) {
    return 'aldi';
  }
  if (/\blidl\b/i.test(t) && !/\b(angebot|prospekt)\b/i.test(t)) return 'lidl';
  if (
    /\b(b[äa]ckerei|b[äa]cker|baeckerei|baecker|bakery|br[öo]tchen)\b/i.test(t)
  ) {
    return 'bakery';
  }
  if (
    /\b(supermarkt|rewe|edeka|kaufland|netto|penny)\b/i.test(t) &&
    !/\b(angebot|prospekt|mango|spritz)\b/i.test(t)
  ) {
    return 'supermarket';
  }
  if (
    /\b(nächste[rn]?\s+)?(aldi|lidl)\b/i.test(t) ||
    /\bwo\s+(ist|gibt).{0,20}\b(aldi|lidl|supermarkt)\b/i.test(t)
  ) {
    if (/\baldi\b/i.test(t)) return 'aldi';
    if (/\blidl\b/i.test(t)) return 'lidl';
    return 'supermarket';
  }
  return null;
}

type Hit = {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  source: 'pack' | 'osm' | 'google';
};

function brandMatch(name: string, kind: AmenityKind): boolean {
  const n = name.toLowerCase();
  if (kind === 'aldi') return /\baldi\b/i.test(n);
  if (kind === 'lidl') return /\blidl\b/i.test(n);
  if (kind === 'bakery') {
    return /\b(b[äa]ck|baeck|bakery|brot|br[öo]tchen)\b/i.test(n);
  }
  return /\b(aldi|lidl|rewe|edeka|kaufland|netto|penny|supermarkt)\b/i.test(n);
}

/** Parkplatz-Lidl / Büro hinter dem echten Markt einsortieren */
function amenityRank(name: string, kind: AmenityKind): number {
  const n = name.toLowerCase();
  if (/parkplatz|parking|p\+\s*r|büro|buero|office|verwaltung|zentrale/i.test(n)) {
    return 5;
  }
  if (kind === 'lidl' || kind === 'aldi') {
    if (new RegExp(`\\b${kind}\\b`, 'i').test(n)) return 0;
    return 1;
  }
  if (kind === 'bakery') {
    if (/\b(bäckerei|baeckerei|backstube|bäcker|baecker)\b/i.test(n)) return 0;
    return 2;
  }
  return 0;
}

async function packHits(
  lat: number,
  lng: number,
  kind: AmenityKind,
  radiusM: number,
): Promise<Hit[]> {
  let pois: Awaited<ReturnType<typeof getAllPois>> = [];
  try {
    pois = await getAllPois();
  } catch {
    return [];
  }
  const out: Hit[] = [];
  for (const p of pois) {
    if (p.kind === 'approach') continue;
    const cat = (p.category || '').toLowerCase();
    const tags = parseTagsJson(p.tags_json).join(' ');
    const blob = `${p.name} ${cat} ${tags}`;
    if (kind === 'aldi' && !/\baldi\b/i.test(blob)) continue;
    if (kind === 'lidl' && !/\blidl\b/i.test(blob)) continue;
    if (
      kind === 'bakery' &&
      !/bakery|bäckerei|baeckerei|bäcker|baecker|brotladen/i.test(blob)
    ) {
      continue;
    }
    if (
      kind === 'supermarket' &&
      !/supermarket|supermarkt|aldi|lidl|rewe|edeka/i.test(blob)
    ) {
      continue;
    }
    const d = haversineMeters(lat, lng, p.lat, p.lng);
    if (d > radiusM) continue;
    out.push({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      distanceM: Math.round(d),
      source: 'pack',
    });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out.slice(0, 6);
}

function formatDist(m: number): string {
  if (m < 1000) return `${m} Meter`;
  return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1).replace('.', ',')} Kilometer`;
}

function wantsNearestAmenity(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(n[äa]chste[rn]?|naheste[rn]?|closest|nearest)\b/i.test(t) ||
    /\b(bring|fahr|führ|navigier|route)\b.{0,40}\b(zum|zur|nach)\b/i.test(t)
  );
}

export async function researchAmenityNav(opts: {
  userText: string;
  lat: number;
  lng: number;
  kind: AmenityKind;
  /** Explizite Nav („bring mich…“) → nächsten Treffer starten, nicht nachfragen */
  commitNearest?: boolean;
}): Promise<AgentResult> {
  const radiusM = 15_000;
  const commitNearest =
    opts.commitNearest === true || wantsNearestAmenity(opts.userText);
  const pack = await packHits(opts.lat, opts.lng, opts.kind, radiusM);
  let hits = pack;

  if (hits.length < 2) {
    try {
      const osmType =
        opts.kind === 'bakery'
          ? 'bakery'
          : opts.kind === 'aldi' ||
              opts.kind === 'lidl' ||
              opts.kind === 'supermarket'
            ? 'supermarket'
            : 'supermarket';
      const keyword =
        opts.kind === 'aldi'
          ? 'aldi'
          : opts.kind === 'lidl'
            ? 'lidl'
            : opts.kind === 'bakery'
              ? 'bäckerei'
              : null;
      const osm = await searchOsmPlacesNearby({
        lat: opts.lat,
        lng: opts.lng,
        placeType: osmType,
        radiusM,
        keyword,
      });
      for (const o of osm) {
        if (
          !brandMatch(o.name, opts.kind) &&
          opts.kind !== 'supermarket' &&
          opts.kind !== 'bakery'
        ) {
          continue;
        }
        if (hits.some((h) => haversineMeters(h.lat, h.lng, o.lat, o.lng) < 60)) {
          continue;
        }
        hits.push({
          name: o.name,
          lat: o.lat,
          lng: o.lng,
          distanceM: Math.round(o.distanceM),
          source: 'osm',
        });
      }
      hits.sort((a, b) => a.distanceM - b.distanceM);
    } catch {
      /* soft */
    }
  }

  // OSM oft langsam/leer → Google Places als Just-Do-It-Fallback
  if (
    hits.length === 0 ||
    (opts.kind === 'bakery' &&
      !hits.some((h) => brandMatch(h.name, 'bakery')))
  ) {
    try {
      const { searchPlacesByText } = await import(
        '../../services/navigation/googleMapsNav'
      );
      const q =
        opts.kind === 'aldi'
          ? 'Aldi'
          : opts.kind === 'lidl'
            ? 'Lidl'
            : opts.kind === 'bakery'
              ? 'Bäckerei'
              : 'Supermarkt';
      const places = await searchPlacesByText({
        query: q,
        lat: opts.lat,
        lng: opts.lng,
        radiusM,
      });
      for (const p of places) {
        if (
          !brandMatch(p.name, opts.kind) &&
          opts.kind !== 'supermarket' &&
          opts.kind !== 'bakery'
        ) {
          continue;
        }
        if (hits.some((h) => haversineMeters(h.lat, h.lng, p.lat, p.lng) < 60)) {
          continue;
        }
        hits.push({
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          distanceM: Math.round(p.distanceM),
          source: 'google',
        });
      }
      hits.sort((a, b) => a.distanceM - b.distanceM);
      if (__DEV__) {
        console.log(`[amenity] google fallback ${q} → ${hits.length} hits`);
      }
    } catch (err) {
      if (__DEV__) console.warn('[amenity] google fallback failed', err);
    }
  }

  hits.sort(
    (a, b) =>
      amenityRank(a.name, opts.kind) - amenityRank(b.name, opts.kind) ||
      a.distanceM - b.distanceM,
  );
  hits = hits.slice(0, 4);
  const label =
    opts.kind === 'aldi'
      ? 'Aldi'
      : opts.kind === 'lidl'
        ? 'Lidl'
        : opts.kind === 'bakery'
          ? 'Bäcker'
          : 'Supermarkt';

  if (!hits.length) {
    return {
      agent: 'knowledge',
      ok: true,
      draftText: `Ich finde gerade keinen ${label} in Laufweite per Offline-Karte. Sag mir einen Stadtteil oder wir versuchen es nochmal mit Live-Suche.`,
      bullets: [`Kein ${label} in ~${Math.round(radiusM / 1000)} km`],
      buttons: [],
      meta: { amenityNav: true, unique: false },
    };
  }

  const unique = hits.length === 1;
  const top = hits[0]!;
  const autoStart = unique || commitNearest;
  const buttons: Module2ActionButton[] = hits.slice(0, 2).map((h, i) => ({
    id: `amenity_nav_${i}`,
    label: shorten(
      i === 0 && autoStart
        ? `📍 ${h.name} · ${formatDist(h.distanceM)}`
        : `📍 ${h.name} · ${formatDist(h.distanceM)}`,
      28,
    ),
    payload: {
      kind: 'navigate',
      lat: h.lat,
      lng: h.lng,
      label: h.name,
    },
  }));

  let draft: string;
  if (autoStart) {
    const alt =
      hits.length > 1 && hits[1]
        ? ` Alternative: ${hits[1]!.name} in ${formatDist(hits[1]!.distanceM)} — Button falls du den willst.`
        : '';
    draft =
      `Nächster ${label}: ${top.name}, etwa ${formatDist(top.distanceM)}. ` +
      `Route startet.${alt}`;
  } else {
    const a = hits[0]!;
    const b = hits[1]!;
    draft =
      `${label}: ${a.name} liegt etwa ${formatDist(a.distanceM)} entfernt, ` +
      `${b.name} etwa ${formatDist(b.distanceM)}. Wohin soll’s gehen? Tippe die Route.`;
  }

  try {
    const { withFacingPrefix } = require('./facingSpeech') as {
      withFacingPrefix: (
        d: string,
        lat: number,
        lng: number,
        max?: number,
      ) => string;
    };
    if (top.distanceM < 250) {
      draft = withFacingPrefix(draft, top.lat, top.lng, 250);
    }
  } catch {
    /* soft */
  }

  return {
    agent: 'knowledge',
    ok: true,
    draftText: draft,
    bullets: hits.slice(0, 3).map((h) => `${h.name} · ${formatDist(h.distanceM)}`),
    buttons,
    meta: {
      amenityNav: true,
      unique: unique || autoStart,
      autoStartNav: autoStart,
      concrete_place: true,
      route_or_nav: true,
      venue_options: hits.length >= 2 && !autoStart,
      distanceM: top.distanceM,
      destName: top.name,
      destLat: top.lat,
      destLng: top.lng,
    },
  };
}

function shorten(s: string, max = 28): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}
