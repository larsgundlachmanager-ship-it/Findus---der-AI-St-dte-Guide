import type { RemoteFact, RemotePoi } from './supabase';

type CitySpot = {
  id?: string;
  name: string;
  district?: string;
  bullets?: string[];
};

type DeepDataEntry =
  | { text: string; tags?: string[] }
  | [string, string[]?]
  | string;

type CityTriggerPoint = {
  id: string;
  name?: string;
  lat: number;
  lng: number;
  radius_m?: number;
  general_info?: string;
  deep_data_pool?: DeepDataEntry[];
};

export type CityPack = {
  city_id: string;
  name?: string;
  data_version?: number;
  symbol?: string;
  lat?: number;
  lng?: number;
  district_division?: string[];
  spots: CitySpot[];
  trigger_points: CityTriggerPoint[];
};

const BULLET_PREFIX = /^[➔➤►]\s*/u;

function cleanFactText(text: string): string {
  return text.replace(BULLET_PREFIX, '').trim();
}

function normalizeDeepEntry(
  entry: DeepDataEntry,
): { text: string; tags: string[] } | null {
  if (typeof entry === 'string') {
    const text = cleanFactText(entry);
    return text ? { text, tags: [] } : null;
  }
  if (Array.isArray(entry)) {
    const text = cleanFactText(String(entry[0] ?? ''));
    if (!text) return null;
    const tags = Array.isArray(entry[1])
      ? entry[1].map(String).filter(Boolean)
      : [];
    return { text, tags };
  }
  const text = cleanFactText(entry.text ?? '');
  if (!text) return null;
  return { text, tags: (entry.tags ?? []).map(String).filter(Boolean) };
}

/**
 * Mappt ein Stadt-JSON aus dem Storage-Bucket `staedte` auf
 * typisierte POI-/Fakten-Zeilen für SQLite + Recherche.
 *
 * Prefix-Konvention (vom Prompt ausgewertet):
 * - [Kurzfakt]  – bullets
 * - [Erzählung] – general_info
 * - [Thema:tag] – deep_data_pool
 * - [Detail]    – deep_data ohne Tag
 *
 * Matching: Spot.id → Trigger.id, sonst Spot.name → Trigger.name
 * (manche Packs wie Pinneberg haben Spots ohne id).
 */
export function mapCityPackToRemote(
  pack: CityPack,
): { pois: RemotePoi[]; facts: RemoteFact[] } {
  const triggers = pack.trigger_points ?? [];
  const triggerById = new Map(triggers.map((tp) => [tp.id, tp]));
  const triggersByName = new Map<string, CityTriggerPoint[]>();
  for (const tp of triggers) {
    const key = (tp.name ?? '').trim().toLowerCase();
    if (!key) continue;
    const list = triggersByName.get(key) ?? [];
    list.push(tp);
    triggersByName.set(key, list);
  }

  const pois: RemotePoi[] = [];
  const facts: RemoteFact[] = [];
  let factId = 1;
  const usedTriggerIds = new Set<string>();

  const resolveTrigger = (spot: CitySpot): CityTriggerPoint | undefined => {
    if (spot.id && triggerById.has(spot.id)) {
      return triggerById.get(spot.id);
    }
    const byName = triggersByName.get(spot.name.trim().toLowerCase());
    // Primärer Trigger: größter Radius / erster mit Koordinaten
    return byName?.find(
      (t) => typeof t.lat === 'number' && typeof t.lng === 'number',
    );
  };

  const pushFactsForSpot = (
    poiId: number,
    spot: CitySpot,
    trigger: CityTriggerPoint,
    relatedTriggers: CityTriggerPoint[],
  ) => {
    const seen = new Set<string>();
    const pushFact = (prefixed: string) => {
      const key = prefixed.toLowerCase();
      if (!prefixed || seen.has(key)) return;
      seen.add(key);
      facts.push({ id: factId++, poi_id: poiId, fact_text: prefixed });
    };

    for (const bullet of spot.bullets ?? []) {
      const text = cleanFactText(bullet);
      if (text) pushFact(`[Kurzfakt] ${text}`);
    }

    for (const tp of relatedTriggers.length > 0 ? relatedTriggers : [trigger]) {
      const general = cleanFactText(tp.general_info ?? '');
      if (general) pushFact(`[Erzählung] ${general}`);

      for (const raw of tp.deep_data_pool ?? []) {
        const entry = normalizeDeepEntry(raw);
        if (!entry) continue;
        if (entry.tags.length === 0) {
          pushFact(`[Detail] ${entry.text}`);
          continue;
        }
        for (const tag of entry.tags) {
          pushFact(`[Thema:${tag}] ${entry.text}`);
        }
      }
    }
  };

  (pack.spots ?? []).forEach((spot, index) => {
    const trigger = resolveTrigger(spot);
    if (
      !trigger ||
      typeof trigger.lat !== 'number' ||
      typeof trigger.lng !== 'number'
    ) {
      console.warn(
        `[cityPack] Spot ohne Trigger-Koordinaten übersprungen: ${spot.id || spot.name}`,
      );
      return;
    }

    const related =
      triggersByName.get(spot.name.trim().toLowerCase()) ?? [trigger];
    for (const tp of related) usedTriggerIds.add(tp.id);

    const poiId = index + 1;
    pois.push({
      id: poiId,
      name: spot.name,
      lat: trigger.lat,
      lng: trigger.lng,
      radius_meters: trigger.radius_m ?? 80,
    });

    pushFactsForSpot(poiId, spot, trigger, related);
  });

  // Trigger ohne Spot (nur GPS) als eigene Orte anlegen
  let extraPoi = pois.length;
  const leftoverByName = new Map<string, CityTriggerPoint[]>();
  for (const tp of triggers) {
    if (usedTriggerIds.has(tp.id)) continue;
    if (typeof tp.lat !== 'number' || typeof tp.lng !== 'number') continue;
    const key = (tp.name ?? tp.id).trim().toLowerCase();
    const list = leftoverByName.get(key) ?? [];
    list.push(tp);
    leftoverByName.set(key, list);
  }

  for (const [, group] of leftoverByName) {
    const primary = group[0];
    extraPoi += 1;
    pois.push({
      id: extraPoi,
      name: primary.name ?? primary.id,
      lat: primary.lat,
      lng: primary.lng,
      radius_meters: primary.radius_m ?? 80,
    });
    pushFactsForSpot(
      extraPoi,
      { id: primary.id, name: primary.name ?? primary.id, bullets: [] },
      primary,
      group,
    );
  }

  return { pois, facts };
}
