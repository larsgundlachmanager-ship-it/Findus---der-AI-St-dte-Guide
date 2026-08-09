/**
 * Fact-Lane: Supermarkt/Amenity per Pack + OSM (€0) — Auto-Nav bei 1 Treffer.
 */

import { haversineMeters, getAllPois } from '../../db/database';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import { searchOsmPlacesNearby } from '../../services/navigation/overpassService';
import type { Module2ActionButton } from '../types';
import type { AgentResult } from '../types';

export type AmenityKind = 'aldi' | 'lidl' | 'supermarket' | 'generic';

export function detectAmenityKind(text: string): AmenityKind | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\baldi\b/i.test(t) && !/\b(mango|spritz|angebot|prospekt)\b/i.test(t)) {
    return 'aldi';
  }
  if (/\blidl\b/i.test(t) && !/\b(angebot|prospekt)\b/i.test(t)) return 'lidl';
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
  source: 'pack' | 'osm';
};

function brandMatch(name: string, kind: AmenityKind): boolean {
  const n = name.toLowerCase();
  if (kind === 'aldi') return /\baldi\b/i.test(n);
  if (kind === 'lidl') return /\blidl\b/i.test(n);
  return /\b(aldi|lidl|rewe|edeka|kaufland|netto|penny|supermarkt)\b/i.test(n);
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

export async function researchAmenityNav(opts: {
  userText: string;
  lat: number;
  lng: number;
  kind: AmenityKind;
}): Promise<AgentResult> {
  const radiusM = 8_000;
  const pack = await packHits(opts.lat, opts.lng, opts.kind, radiusM);
  let hits = pack;

  if (hits.length < 2) {
    try {
      const osmType =
        opts.kind === 'aldi' || opts.kind === 'lidl' || opts.kind === 'supermarket'
          ? 'supermarket'
          : 'supermarket';
      const keyword =
        opts.kind === 'aldi' ? 'aldi' : opts.kind === 'lidl' ? 'lidl' : null;
      const osm = await searchOsmPlacesNearby({
        lat: opts.lat,
        lng: opts.lng,
        placeType: osmType,
        radiusM,
        keyword,
      });
      for (const o of osm) {
        if (!brandMatch(o.name, opts.kind) && opts.kind !== 'supermarket') {
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

  hits = hits.slice(0, 4);
  const label =
    opts.kind === 'aldi'
      ? 'Aldi'
      : opts.kind === 'lidl'
        ? 'Lidl'
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
  const buttons: Module2ActionButton[] = hits.slice(0, 2).map((h, i) => ({
    id: `amenity_nav_${i}`,
    label: shorten(`📍 ${h.name}`),
    payload: {
      kind: 'navigate',
      lat: h.lat,
      lng: h.lng,
      label: h.name,
    },
  }));

  let draft: string;
  if (unique) {
    draft =
      `Hier gibt’s nur einen ${label} in der Nähe: ${top.name}, etwa ${formatDist(top.distanceM)}. ` +
      `Ich führ dich hin — Route startet.`;
  } else {
    const a = hits[0]!;
    const b = hits[1]!;
    draft =
      `${label}: ${a.name} liegt etwa ${formatDist(a.distanceM)} entfernt, ` +
      `${b.name} etwa ${formatDist(b.distanceM)}. Wohin soll’s gehen? Tippe die Route.`;
  }

  return {
    agent: 'knowledge',
    ok: true,
    draftText: draft,
    bullets: hits.slice(0, 3).map((h) => `${h.name} · ${formatDist(h.distanceM)}`),
    buttons,
    meta: {
      amenityNav: true,
      unique,
      autoStartNav: unique,
      concrete_place: true,
      route_or_nav: true,
      venue_options: hits.length >= 2,
      distanceM: top.distanceM,
      destName: top.name,
      destLat: top.lat,
      destLng: top.lng,
    },
  };
}

function shorten(s: string): string {
  const t = s.trim();
  if (t.length <= 20) return t;
  return `${t.slice(0, 18)}…`;
}
