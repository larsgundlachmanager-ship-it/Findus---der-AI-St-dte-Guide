/**
 * Effektive Trigger-Radien — Pack-Werte (12–18 m) sind zu klein für Fuß + GPS-Drift.
 * Stadt-agnostisch: must_have / Story bekommt einen Mindest-Radius.
 * Hauptorte mit Footprint: zusätzlich FOOTPRINT_TRIGGER_BUFFER_M (~15 m) in database.ts.
 */

export const APPROACH_STORY_MIN_M = 80;
/** Fallback ohne Footprint — mit OSM-Polygon gilt der 15-m-Puffer. */
export const AREA_STORY_MIN_M = 80;
/** Große Bauwerke (Kirche, Dom, Schloss): früherer Teaser / Fußweg-Trigger. */
export const LARGE_BUILDING_STORY_MIN_M = 120;

export function isStoryTriggerPoi(tagsJson: string | null | undefined): boolean {
  const t = (tagsJson || '').toLowerCase();
  if (/must_have|wahrzeichen|landmark|culture_story/.test(t)) return true;
  if (/"story"/.test(t) && !/"directory"/.test(t)) return true;
  return false;
}

export function isLargeBuildingPoi(poi: {
  name?: string | null;
  category?: string | null;
  tags_json?: string | null;
}): boolean {
  const blob = `${poi.name ?? ''} ${poi.category ?? ''} ${poi.tags_json ?? ''}`.toLowerCase();
  return /(kirche|dom\b|münster|muenster|kathedrale|cathedral|schloss|burg\b|basilika|kloster|rathaus|filmhaus|theater)/i.test(
    blob,
  );
}

/** Spot-Keys, deren Wegweiser schon gesprochen wurde — Geschwister-Approaches skippen. */
export function teasedApproachSpotKeys(
  pois: Array<{ id: number; kind?: string | null; spot_key?: string | null }>,
  spokenIds: Iterable<number> | undefined,
): Set<string> {
  const spoken =
    spokenIds instanceof Set ? spokenIds : new Set(spokenIds ?? []);
  const keys = new Set<string>();
  if (spoken.size === 0) return keys;
  for (const p of pois) {
    if ((p.kind ?? '') !== 'approach') continue;
    if (!spoken.has(p.id)) continue;
    const k = (p.spot_key || '').trim();
    if (k) keys.add(k);
  }
  return keys;
}

/** Radius in Metern inkl. Scale + Floor. Nur Story/must_have bekommt den Floor. */
export function effectiveTriggerRadiusM(
  poi: {
    radius_meters: number;
    kind?: string | null;
    tags_json?: string | null;
    name?: string | null;
    category?: string | null;
  },
  scale = 1,
): number {
  const base = Math.max(1, poi.radius_meters * (scale > 0 ? scale : 1));
  const kind = poi.kind ?? 'legacy';
  if (!isStoryTriggerPoi(poi.tags_json)) return base;
  const large = isLargeBuildingPoi(poi);
  if (kind === 'approach') {
    return Math.max(base, large ? LARGE_BUILDING_STORY_MIN_M : APPROACH_STORY_MIN_M);
  }
  if (kind === 'area' || kind === 'legacy') {
    return Math.max(base, large ? LARGE_BUILDING_STORY_MIN_M : AREA_STORY_MIN_M);
  }
  return base;
}

/**
 * Sort-Rang: Sub-Eingang → Hauptort → Wegweiser.
 * Gleicher Spot: Arrival schlägt den eigenen Teaser (User steht schon da).
 */
export function geoKindRank(
  poi: { kind?: string | null },
  via?: string,
): number {
  const k = poi.kind ?? 'legacy';
  if (k === 'sub') return 0;
  if (k === 'area' || k === 'legacy' || via === 'polygon') return 1;
  if (k === 'approach') return 2;
  return 3;
}
