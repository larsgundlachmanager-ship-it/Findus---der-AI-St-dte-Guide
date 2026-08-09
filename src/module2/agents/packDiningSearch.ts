/**
 * Pack-first Gastro — Offline-Katalog (SQLite POIs) vor Places API.
 * Tags/Name/Kategorie matchen Küche & Mahlzeit; Google nur bei echter Lücke.
 */

import { getAllPois, getFactsForPoi, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { parseTagsJson } from '../../services/geo/triggerPolicy';

export type PackDiningHit = {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  rating: number | null;
  ratingCount: number | null;
  websiteUri: string | null;
  phoneNumber: string | null;
  placeId: string;
  openNow: boolean;
  opensAtMin: number | null;
  closesAtMin: number | null;
  types: string[];
  /** true = aus Stadt-Pack, keine Places-Rechnung */
  fromPack: true;
};

const FOOD_CATEGORIES = new Set([
  'restaurant',
  'cafe',
  'café',
  'bakery',
  'bäckerei',
  'baeckerei',
  'imbiss',
  'gastro',
  'kulinarik',
  'food',
  'bar',
  'pub',
]);

const FOOD_TAG_HINTS =
  /\b(restaurant|cafe|café|bakery|bäckerei|baeckerei|imbiss|gastro|kulinarik|essen|food|gasthof|bistro|pizzeria|trattoria|meal_takeaway|directory|offline_lookup)\b/i;

/** Küche / Intent → Match-Tokens gegen Name+Tags+Facts */
const CUISINE_TOKENS: Array<{ re: RegExp; tokens: string[] }> = [
  { re: /\bburger\b/i, tokens: ['burger', 'hamburger', 'american'] },
  { re: /\bpizza\b/i, tokens: ['pizza', 'pizzeria', 'italien'] },
  { re: /\bsushi\b/i, tokens: ['sushi', 'japan', 'asia'] },
  { re: /\b(döner|doener|kebab)\b/i, tokens: ['döner', 'doener', 'kebab', 'türk'] },
  {
    re: /\b(fisch|pannfisch|fischbrötchen|seafood)\b/i,
    tokens: ['fisch', 'seafood', 'meer', 'nordsee', 'pannfisch'],
  },
  {
    re: /\b(italien|pasta|nudeln|trattoria|mediterran)\b/i,
    tokens: ['italien', 'pasta', 'pizza', 'mediterran', 'südländ', 'suedlaend'],
  },
  { re: /\b(steak|grill|fleisch)\b/i, tokens: ['steak', 'grill', 'fleisch'] },
  { re: /\bvegan\b/i, tokens: ['vegan', 'vegetar'] },
  { re: /\b(indisch|curry)\b/i, tokens: ['indisch', 'curry', 'india'] },
  { re: /\b(chinesisch|asia|thai|vietnam)\b/i, tokens: ['asia', 'china', 'thai', 'vietnam'] },
  { re: /\b(frühstück|fruehstueck|breakfast|brunch)\b/i, tokens: ['frühstück', 'breakfast', 'brunch', 'cafe', 'bäck'] },
  { re: /\b(kaffee|café|cafe|coffee)\b/i, tokens: ['cafe', 'café', 'kaffee', 'coffee'] },
  { re: /\b(bäckerei|baeckerei|bäcker|bakery)\b/i, tokens: ['bäck', 'baeck', 'bakery', 'brot'] },
  { re: /\b(hafen|waterfront|aussicht|sunset|sonnenuntergang)\b/i, tokens: ['hafen', 'aussicht', 'ufer', 'see', 'strand'] },
];

function isFoodPoi(p: Poi): boolean {
  if (p.kind === 'approach' || p.kind === 'sub') return false;
  const cat = (p.category || '').toLowerCase();
  if (FOOD_CATEGORIES.has(cat)) return true;
  const tags = parseTagsJson(p.tags_json);
  if (tags.some((t) => FOOD_CATEGORIES.has(t.toLowerCase()) || FOOD_TAG_HINTS.test(t))) {
    return true;
  }
  return FOOD_TAG_HINTS.test(`${p.name} ${cat} ${tags.join(' ')}`);
}

function typesForPoi(p: Poi): string[] {
  const cat = (p.category || '').toLowerCase();
  const tags = parseTagsJson(p.tags_json).map((t) => t.toLowerCase());
  const out = new Set<string>();
  if (cat) out.add(cat);
  for (const t of tags) {
    if (FOOD_CATEGORIES.has(t) || /restaurant|cafe|bakery|food|gastro/.test(t)) {
      out.add(t === 'café' ? 'cafe' : t);
    }
  }
  if (!out.size) out.add('restaurant');
  return [...out];
}

function extractPhone(blob: string): string | null {
  const m = blob.match(
    /(?:Tel\.?|Telefon|:)?\s*(\+?\d[\d\s\/\-]{6,16}\d)/i,
  );
  const raw = m?.[1]?.replace(/[^\d+]/g, '') ?? '';
  return raw.length >= 6 ? raw : null;
}

/**
 * Pack-Gastro innerhalb radiusM. Bei Küche-Intent: Token-Match in Name/Tags/Facts.
 */
export async function searchPackDining(opts: {
  lat: number;
  lng: number;
  radiusM: number;
  query: string;
  /** Mindest-Treffer bevor Caller Places skippt */
  minResults?: number;
}): Promise<PackDiningHit[]> {
  const minResults = Math.max(1, opts.minResults ?? 2);
  let pois: Poi[] = [];
  try {
    pois = await getAllPois();
  } catch {
    return [];
  }
  if (!pois.length) return [];

  const cuisine = CUISINE_TOKENS.filter((c) => c.re.test(opts.query));
  const cuisineTokens = cuisine.flatMap((c) => c.tokens);
  const wantsCuisine = cuisineTokens.length > 0;

  type Ranked = { poi: Poi; distanceM: number; score: number; blob: string };
  const ranked: Ranked[] = [];

  for (const poi of pois) {
    if (!isFoodPoi(poi)) continue;
    if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) continue;
    if (Math.abs(poi.lat) < 0.01 && Math.abs(poi.lng) < 0.01) continue;
    const distanceM = Math.round(
      haversineMeters(opts.lat, opts.lng, poi.lat, poi.lng),
    );
    if (distanceM > opts.radiusM + 80) continue;

    const tags = parseTagsJson(poi.tags_json).join(' ');
    const blob = `${poi.name} ${poi.category ?? ''} ${tags} ${poi.teaser_text ?? ''}`.toLowerCase();
    let score = 40;
    score += Math.max(0, 30 - Math.floor(distanceM / 500));

    if (wantsCuisine) {
      let hit = 0;
      for (const tok of cuisineTokens) {
        if (blob.includes(tok.toLowerCase())) hit += 1;
      }
      if (hit === 0) {
        // Facts nachladen nur für Küche-Miss — teuer, daher skip wenn Name klar irrelevant
        continue;
      }
      score += hit * 18;
    }

    // Frühstück/Café-Bias
    if (/\b(frühstück|fruehstueck|kaffee|café|cafe)\b/i.test(opts.query)) {
      if (/cafe|café|bäck|baeck|bakery|frühstück/.test(blob)) score += 12;
    }
    if (/\b(abendessen|dinner|restaurant)\b/i.test(opts.query)) {
      if (/restaurant|gasthof|bistro|imbiss/.test(blob)) score += 8;
    }

    ranked.push({ poi, distanceM, score, blob });
  }

  ranked.sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);

  // Bei Küche ohne Name-Hit: Facts der nächsten Food-POIs scannen (max 24)
  if (wantsCuisine && ranked.length < minResults) {
    const nearFood = pois
      .filter(isFoodPoi)
      .map((poi) => ({
        poi,
        distanceM: Math.round(
          haversineMeters(opts.lat, opts.lng, poi.lat, poi.lng),
        ),
      }))
      .filter((x) => x.distanceM <= opts.radiusM + 80)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 24);

    for (const { poi, distanceM } of nearFood) {
      if (ranked.some((r) => r.poi.id === poi.id)) continue;
      let factBlob = '';
      try {
        const facts = await getFactsForPoi(poi.id);
        factBlob = facts
          .slice(0, 8)
          .map((f) => f.fact_text || '')
          .join(' ')
          .toLowerCase();
      } catch {
        continue;
      }
      const tags = parseTagsJson(poi.tags_json).join(' ');
      const blob =
        `${poi.name} ${poi.category ?? ''} ${tags} ${factBlob}`.toLowerCase();
      let hit = 0;
      for (const tok of cuisineTokens) {
        if (blob.includes(tok.toLowerCase())) hit += 1;
      }
      if (hit === 0) continue;
      ranked.push({
        poi,
        distanceM,
        score: 35 + hit * 18 + Math.max(0, 20 - Math.floor(distanceM / 500)),
        blob,
      });
    }
    ranked.sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);
  }

  const top = ranked.slice(0, 12);
  const out: PackDiningHit[] = [];

  for (const row of top) {
    let phone: string | null = null;
    let factBlob = row.blob;
    try {
      const facts = await getFactsForPoi(row.poi.id);
      const texts = facts.slice(0, 6).map((f) => f.fact_text || '');
      factBlob = `${row.blob} ${texts.join(' ')}`;
      phone = extractPhone(factBlob);
    } catch {
      /* soft */
    }
    out.push({
      name: row.poi.name.trim(),
      lat: row.poi.lat,
      lng: row.poi.lng,
      distanceM: row.distanceM,
      rating: null,
      ratingCount: null,
      websiteUri: null,
      phoneNumber: phone,
      placeId: `pack:${row.poi.spot_key || row.poi.id}`,
      // Pack-Hours oft unbekannt — nicht als geschlossen blocken (€0-Pfad)
      openNow: true,
      opensAtMin: null,
      closesAtMin: null,
      types: typesForPoi(row.poi),
      fromPack: true,
    });
  }

  if (__DEV__ && out.length) {
    console.log(
      `[pack-dining] ${out.length} hits ≤${opts.radiusM}m` +
        (wantsCuisine ? ` cuisine=${cuisineTokens.slice(0, 4).join(',')}` : ''),
    );
  }
  return out;
}
