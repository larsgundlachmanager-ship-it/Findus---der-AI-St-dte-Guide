/**
 * Gelernte Orte überleben Pack-Replace: Overlay-Datei + SQLite-Insert.
 * IDs im 900M-Band, damit sie nicht mit Pack-IDs kollidieren.
 */

import * as FileSystem from 'expo-file-system';
import type { RemoteFact, RemotePoi } from '../services/supabase';
import { getAllPois, getDatabase, runExclusiveDbWrite } from './database';
import { useFinnusStore } from '../store/useFinnusStore';

const PATH = `${FileSystem.documentDirectory}findus-learned-pois.json`;

export const LEARNED_POI_ID_MIN = 900_000_000;
const LEARNED_POI_ID_SPAN = 8_000_000;
const LEARNED_FACT_ID_MIN = 910_000_000;

export type LearnedPoiRecord = {
  cityId: string;
  poi: RemotePoi;
  facts: RemoteFact[];
};

type OverlayFile = {
  byCity: Record<string, { pois: RemotePoi[]; facts: RemoteFact[] }>;
};

function empty(): OverlayFile {
  return { byCity: {} };
}

let cache: OverlayFile | null = null;

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function learnedPoiIdFor(cityId: string, name: string, lat: number, lng: number): number {
  const key = `${cityId}|${name.trim().toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
  return LEARNED_POI_ID_MIN + (fnv(key) % LEARNED_POI_ID_SPAN);
}

export function learnedFactIdFor(poiId: number, text: string): number {
  return LEARNED_FACT_ID_MIN + (fnv(`${poiId}|${text.slice(0, 80)}`) % LEARNED_POI_ID_SPAN);
}

export function isLearnedPoiId(id: number): boolean {
  return id >= LEARNED_POI_ID_MIN && id < LEARNED_FACT_ID_MIN;
}

async function loadOverlay(): Promise<OverlayFile> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) {
      cache = empty();
      return cache;
    }
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as OverlayFile;
    cache = {
      byCity:
        parsed?.byCity && typeof parsed.byCity === 'object' ? parsed.byCity : {},
    };
    return cache;
  } catch {
    cache = empty();
    return cache;
  }
}

async function saveOverlay(state: OverlayFile): Promise<void> {
  cache = state;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(state));
  } catch {
    /* soft */
  }
}

async function insertPoiRow(poi: RemotePoi, facts: RemoteFact[]): Promise<void> {
  const db = await getDatabase();
  await runExclusiveDbWrite(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO pois (
        id, name, lat, lng, radius_meters,
        spot_key, parent_poi_id, kind, category, tags_json,
        polygon_json, teaser_text, condition_rule, special_radius_m
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      poi.id,
      poi.name,
      poi.lat,
      poi.lng,
      poi.radius_meters,
      poi.spot_key ?? null,
      poi.parent_poi_id ?? null,
      poi.kind ?? 'area',
      poi.category ?? null,
      poi.tags_json ?? null,
      poi.polygon_json ?? null,
      poi.teaser_text ?? null,
      poi.condition_rule ?? 'always',
      poi.special_radius_m ?? null,
    );
    for (const fact of facts) {
      await db.runAsync(
        `INSERT OR REPLACE INTO facts (id, poi_id, fact_text) VALUES (?, ?, ?)`,
        fact.id,
        fact.poi_id,
        fact.fact_text,
      );
    }
  });
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'ort';
}

export async function upsertLearnedPoi(input: {
  cityId: string | null;
  name: string;
  lat: number;
  lng: number;
  category?: string | null;
  packRole?: 'story' | 'directory';
  tags?: string[] | null;
  factTexts: string[];
  teaserText?: string | null;
}): Promise<RemotePoi | null> {
  const name = input.name.trim();
  if (
    !name ||
    name.length < 2 ||
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lng)
  ) {
    return null;
  }
  const cityId = (input.cityId || 'unknown').trim().toLowerCase() || 'unknown';
  const packRole = input.packRole ?? 'directory';
  const poiId = learnedPoiIdFor(cityId, name, input.lat, input.lng);
  const overlay = await loadOverlay();
  const bucket = overlay.byCity[cityId] ?? { pois: [], facts: [] };
  const existing = bucket.pois.find((p) => p.id === poiId);
  let prevTags: string[] = [];
  try {
    prevTags = existing?.tags_json ? (JSON.parse(existing.tags_json) as string[]) : [];
  } catch {
    prevTags = [];
  }
  const tags = [
    ...new Set([
      ...prevTags.map(String),
      'learned',
      packRole,
      packRole === 'story' ? 'story' : 'directory',
      input.category || 'ort',
      ...(input.tags ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
    ]),
  ];
  const poi: RemotePoi = {
    id: poiId,
    name,
    lat: input.lat,
    lng: input.lng,
    radius_meters: packRole === 'story' ? 40 : 25,
    spot_key: `learned:${cityId}:${slug(name)}`,
    parent_poi_id: null,
    kind: 'area',
    category: input.category ?? 'ort',
    tags_json: JSON.stringify(tags),
    polygon_json: null,
    teaser_text: input.teaserText?.slice(0, 280) ?? existing?.teaser_text ?? null,
    condition_rule: 'always',
    special_radius_m: null,
  };
  const seen = new Set<string>();
  const facts: RemoteFact[] = [];
  for (const old of bucket.facts.filter((f) => f.poi_id === poiId)) {
    const key = String(old.fact_text || '').toLowerCase().slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    facts.push(old);
  }
  for (const raw of input.factTexts) {
    const text = raw.trim();
    if (text.length < 12) continue;
    const key = text.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      id: learnedFactIdFor(poiId, text),
      poi_id: poiId,
      fact_text: text.slice(0, 2000),
    });
  }

  bucket.pois = bucket.pois.filter((p) => p.id !== poiId);
  bucket.facts = bucket.facts.filter((f) => f.poi_id !== poiId);
  bucket.pois.push(poi);
  bucket.facts.push(...facts);
  overlay.byCity[cityId] = bucket;
  await saveOverlay(overlay);

  await insertPoiRow(poi, facts);
  try {
    const local = await getAllPois();
    useFinnusStore.getState().setPois(local);
  } catch {
    /* soft */
  }
  try {
    const { upsertMapPins } = await import('../services/homeMap/mapPinIndex');
    await upsertMapPins(cityId, [poi]);
  } catch {
    /* soft */
  }
  return poi;
}

/** Nach Pack-Install: gelernte Orte dieser Stadt wieder einspielen. */
export async function reapplyLearnedPoisForCity(cityId: string | null): Promise<number> {
  const id = (cityId || '').trim().toLowerCase();
  if (!id) return 0;
  const overlay = await loadOverlay();
  const bucket = overlay.byCity[id];
  if (!bucket?.pois?.length) return 0;
  for (const poi of bucket.pois) {
    const facts = (bucket.facts || []).filter((f) => f.poi_id === poi.id);
    try {
      await insertPoiRow(poi, facts);
    } catch {
      /* soft */
    }
  }
  try {
    const local = await getAllPois();
    useFinnusStore.getState().setPois(local);
  } catch {
    /* soft */
  }
  try {
    const { upsertMapPins } = await import('../services/homeMap/mapPinIndex');
    await upsertMapPins(id, bucket.pois);
  } catch {
    /* soft */
  }
  return bucket.pois.length;
}

export async function listLearnedPoisForCity(
  cityId: string | null,
): Promise<RemotePoi[]> {
  const id = (cityId || '').trim().toLowerCase();
  if (!id) return [];
  const overlay = await loadOverlay();
  return overlay.byCity[id]?.pois ?? [];
}
