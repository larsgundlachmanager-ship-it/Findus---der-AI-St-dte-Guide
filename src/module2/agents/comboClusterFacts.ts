/**
 * Combo-Cluster Fact-Lane: z. B. gratis Parken × Pizza Takeaway × Förde/Aussicht.
 *
 * Schicht 1: Stadt-Pack (lokal, 0 €, auch ohne Netz)
 * Schicht 2: OSM Overpass (Netz, meist 0 €)
 * Schicht 3: Google Places Text (Netz, kostenpflichtig) — nur wenn 1+2 dünn
 *
 * „Offline“ = Pack ohne Netz. Mit Netz = Pack + OSM + ggf. Places — dieselbe Logik.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import { searchOsmPlacesNearby } from '../../services/navigation/overpassService';
import { searchPlacesByText } from '../../services/navigation/googleMapsNav';
import type { AgentResult, Module2ActionButton } from '../types';

type SpotSource = 'pack' | 'osm' | 'places';

type Spot = {
  name: string;
  lat: number;
  lng: number;
  role: 'parking' | 'food' | 'view';
  distanceM: number;
  source: SpotSource;
};

function scoreBlob(blob: string, role: Spot['role']): number {
  const b = blob.toLowerCase();
  if (role === 'parking') {
    if (/parkhaus|tiefgarage/.test(b)) return 4;
    if (/parkplatz|parken|parking/.test(b)) return 8;
    if (/kostenlos|gratis|free/.test(b)) return 12;
    return 0;
  }
  if (role === 'food') {
    if (/pizza|pizzeria|takeaway|imbiss/.test(b)) return 10;
    if (/restaurant|gastro/.test(b)) return 3;
    return 0;
  }
  // view
  if (/förde|foerde|strand|ufer|hafen|promenade|aussicht|sonnenuntergang/.test(b))
    return 10;
  if (/see|meer|küste|kueste/.test(b)) return 6;
  return 0;
}

async function packRole(
  lat: number,
  lng: number,
  role: Spot['role'],
  radiusM: number,
): Promise<Spot[]> {
  let pois: Awaited<ReturnType<typeof getAllPois>> = [];
  try {
    pois = await getAllPois();
  } catch {
    return [];
  }
  const out: Spot[] = [];
  for (const p of pois) {
    if (p.kind === 'approach') continue;
    const blob = `${p.name} ${p.category ?? ''} ${parseTagsJson(p.tags_json).join(' ')}`;
    const s = scoreBlob(blob, role);
    if (s < 4) continue;
    const d = haversineMeters(lat, lng, p.lat, p.lng);
    if (d > radiusM) continue;
    out.push({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      role,
      distanceM: Math.round(d),
      source: 'pack',
    });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out.slice(0, 8);
}

async function osmRole(
  lat: number,
  lng: number,
  role: Spot['role'],
  radiusM: number,
): Promise<Spot[]> {
  try {
    if (role === 'parking') {
      const hits = await searchOsmPlacesNearby({
        lat,
        lng,
        placeType: 'parking',
        radiusM,
      });
      return hits.slice(0, 6).map((h) => ({
        name: h.name,
        lat: h.lat,
        lng: h.lng,
        role,
        distanceM: Math.round(h.distanceM),
        source: 'osm' as const,
      }));
    }
    if (role === 'food') {
      const hits = await searchOsmPlacesNearby({
        lat,
        lng,
        placeType: 'restaurant',
        radiusM,
        keyword: 'pizza',
      });
      return hits.slice(0, 6).map((h) => ({
        name: h.name,
        lat: h.lat,
        lng: h.lng,
        role,
        distanceM: Math.round(h.distanceM),
        source: 'osm' as const,
      }));
    }
    if (role === 'view') {
      const hits = await searchOsmPlacesNearby({
        lat,
        lng,
        placeType: 'tourist_attraction',
        radiusM: Math.min(radiusM, 8_000),
        keyword: 'strand',
      });
      return hits.slice(0, 6).map((h) => ({
        name: h.name,
        lat: h.lat,
        lng: h.lng,
        role,
        distanceM: Math.round(h.distanceM),
        source: 'osm' as const,
      }));
    }
  } catch {
    /* soft */
  }
  return [];
}

async function placesRole(
  lat: number,
  lng: number,
  role: Spot['role'],
  radiusM: number,
  cityHint: string | null,
): Promise<Spot[]> {
  const q =
    role === 'parking'
      ? `kostenlos parken ${cityHint ?? ''}`.trim()
      : role === 'food'
        ? `Pizza Takeaway ${cityHint ?? ''}`.trim()
        : `Förde Aussicht Strand ${cityHint ?? ''}`.trim();
  try {
    const hits = await searchPlacesByText({
      query: q,
      lat,
      lng,
      radiusM: Math.min(radiusM, 15_000),
    });
    return hits.slice(0, 6).map((h) => ({
      name: h.name,
      lat: h.lat,
      lng: h.lng,
      role,
      distanceM: Math.round(
        Number.isFinite(h.lat)
          ? haversineMeters(lat, lng, h.lat, h.lng)
          : radiusM,
      ),
      source: 'places' as const,
    }));
  } catch {
    return [];
  }
}

function clusterScore(
  park: Spot,
  food: Spot,
  view: Spot | null,
): number {
  const pf = haversineMeters(park.lat, park.lng, food.lat, food.lng);
  const pv = view
    ? haversineMeters(park.lat, park.lng, view.lat, view.lng)
    : 900;
  const fv = view
    ? haversineMeters(food.lat, food.lng, view.lat, view.lng)
    : 900;
  return pf + pv * 0.7 + fv * 0.7 + park.distanceM * 0.15;
}

export function isComboClusterQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  const park = /\b(parken|parkplatz|parkticket|kostenlos\s+parken|gratis\s+parken)\b/iu.test(
    t,
  );
  const food = /\b(pizza|takeaway|imbiss|essen\s+mitnehmen)\b/iu.test(t);
  const view =
    /\b(förde|foerde|sonnenuntergang|aussicht|strand|elbe|ufer)\b/iu.test(t);
  return park && food && view;
}

export async function researchComboCluster(opts: {
  userText: string;
  lat: number;
  lng: number;
  cityHint?: string | null;
}): Promise<AgentResult> {
  const radiusM = 12_000;
  const city =
    opts.cityHint ||
    opts.userText.match(
      /\b(?:in|nach|bei)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})/u,
    )?.[1] ||
    null;

  let parks = await packRole(opts.lat, opts.lng, 'parking', radiusM);
  let foods = await packRole(opts.lat, opts.lng, 'food', radiusM);
  let views = await packRole(opts.lat, opts.lng, 'view', radiusM);
  const sourcesUsed = new Set<SpotSource>(['pack']);

  // OSM (Netz, günstig) — immer versuchen wenn Pack dünn
  if (parks.length < 3) {
    parks = [...parks, ...(await osmRole(opts.lat, opts.lng, 'parking', radiusM))];
    sourcesUsed.add('osm');
  }
  if (foods.length < 3) {
    foods = [...foods, ...(await osmRole(opts.lat, opts.lng, 'food', radiusM))];
    sourcesUsed.add('osm');
  }
  if (views.length < 2) {
    views = [...views, ...(await osmRole(opts.lat, opts.lng, 'view', radiusM))];
    sourcesUsed.add('osm');
  }

  // Google Places nur als Lückenfüller (teurer)
  if (parks.length < 2 || foods.length < 2 || views.length < 1) {
    sourcesUsed.add('places');
    if (parks.length < 2) {
      parks = [
        ...parks,
        ...(await placesRole(opts.lat, opts.lng, 'parking', radiusM, city)),
      ];
    }
    if (foods.length < 2) {
      foods = [
        ...foods,
        ...(await placesRole(opts.lat, opts.lng, 'food', radiusM, city)),
      ];
    }
    if (views.length < 1) {
      views = [
        ...views,
        ...(await placesRole(opts.lat, opts.lng, 'view', radiusM, city)),
      ];
    }
  }

  parks = dedupe(parks).slice(0, 6);
  foods = dedupe(foods).slice(0, 6);
  views = dedupe(views).slice(0, 6);

  type Cluster = { park: Spot; food: Spot; view: Spot | null; score: number };
  const clusters: Cluster[] = [];
  for (const park of parks) {
    for (const food of foods) {
      const nearFood =
        haversineMeters(park.lat, park.lng, food.lat, food.lng) < 2_500;
      if (!nearFood) continue;
      let bestView: Spot | null = null;
      let bestPv = Infinity;
      for (const v of views) {
        const d = haversineMeters(park.lat, park.lng, v.lat, v.lng);
        if (d < bestPv && d < 3_500) {
          bestPv = d;
          bestView = v;
        }
      }
      clusters.push({
        park,
        food,
        view: bestView,
        score: clusterScore(park, food, bestView),
      });
    }
  }
  clusters.sort((a, b) => a.score - b.score);
  const top = clusters.slice(0, 2);

  if (!top.length) {
    return {
      agent: 'knowledge',
      ok: true,
      draftText:
        'Für Parken + Pizza + Aussicht finde ich noch keine saubere Dreierkombination (Pack/OSM/Places). Nenn mir den Stadtteil genauer — dann cluster ich neu.',
      bullets: ['Kombi noch dünn befüllt'],
      buttons: [],
      meta: {
        comboCluster: true,
        sources: [...sourcesUsed],
      },
    };
  }

  const c0 = top[0]!;
  const viewBit = c0.view
    ? `Aussicht/Förde-Nähe: ${c0.view.name}`
    : 'Aussichtspunkt in der Nähe noch dünn belegt — Förde-Ufer als Ziel mitdenken';
  const alt = top[1];
  let draft =
    `Beste Kombi: parke bei ${c0.park.name}, hol Pizza bei ${c0.food.name}` +
    (c0.view ? `, dann rüber zu ${c0.view.name}` : '') +
    `. Kurze Wege zwischen den dreien.`;
  if (alt) {
    draft += ` Alternative: ${alt.park.name} + ${alt.food.name}.`;
  }
  draft += ` ${viewBit}.`;

  const buttons: Module2ActionButton[] = [
    {
      id: 'combo_park',
      label: shorten(`🅿️ ${c0.park.name}`),
      payload: {
        kind: 'navigate',
        lat: c0.park.lat,
        lng: c0.park.lng,
        label: c0.park.name,
      },
    },
    {
      id: 'combo_food',
      label: shorten(`🍕 ${c0.food.name}`),
      payload: {
        kind: 'navigate',
        lat: c0.food.lat,
        lng: c0.food.lng,
        label: c0.food.name,
      },
    },
  ];
  if (c0.view) {
    buttons.push({
      id: 'combo_view',
      label: shorten(`🌅 ${c0.view.name}`),
      payload: {
        kind: 'navigate',
        lat: c0.view.lat,
        lng: c0.view.lng,
        label: c0.view.name,
      },
    });
  }

  return {
    agent: 'knowledge',
    ok: true,
    draftText: draft,
    bullets: [
      `Parken: ${c0.park.name}`,
      `Pizza: ${c0.food.name}`,
      c0.view ? `Aussicht: ${c0.view.name}` : 'Aussicht: Förde-Nähe prüfen',
    ],
    buttons: buttons.slice(0, 4),
    meta: {
      comboCluster: true,
      concrete_place: true,
      venue_options: true,
      hard_match_evidence: true,
      sources: [...sourcesUsed],
    },
  };
}

function dedupe(spots: Spot[]): Spot[] {
  const out: Spot[] = [];
  for (const s of spots) {
    if (out.some((x) => haversineMeters(x.lat, x.lng, s.lat, s.lng) < 80)) {
      continue;
    }
    out.push(s);
  }
  return out;
}

function shorten(s: string): string {
  const t = s.trim();
  if (t.length <= 20) return t;
  return `${t.slice(0, 18)}…`;
}
