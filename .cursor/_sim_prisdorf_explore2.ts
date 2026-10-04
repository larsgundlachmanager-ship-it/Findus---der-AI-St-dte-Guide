import { readFileSync } from 'fs';
import { mapCityPackToRemote } from '../src/services/cityPack';

const pack = JSON.parse(readFileSync('data/staedte/prisdorf.json', 'utf8'));
const { pois } = mapCityPackToRemote(pack as any);
console.log('mapped pois', pois.length);

function parseTags(tags_json: string | null | undefined): string[] {
  if (!tags_json) return [];
  try {
    const j = JSON.parse(tags_json);
    if (Array.isArray(j)) return j.map((x) => String(x).toLowerCase());
  } catch {
    /* csv */
  }
  return String(tags_json)
    .toLowerCase()
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isPackStory(p: any): boolean {
  const tags = parseTags(p.tags_json);
  if (
    tags.includes('directory') ||
    tags.includes('tier4') ||
    tags.includes('offline_lookup') ||
    tags.includes('amenity_skip')
  )
    return false;
  return tags.includes('story') || tags.includes('story_enriched');
}

function isAreaLike(p: any): boolean {
  const k = p.kind ?? 'legacy';
  return k === 'area' || k === 'legacy' || !k;
}

const explore = pois.filter(
  (p) =>
    isAreaLike(p) &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    isPackStory(p),
);
console.log('explore-like', explore.length);

const byKind: Record<string, number> = {};
for (const p of explore) byKind[p.kind || 'null'] = (byKind[p.kind || 'null'] || 0) + 1;
console.log('kinds', byKind);

// pack_role story spots in source
const spots = pack.spots || [];
const storySpots = spots.filter((s: any) => {
  const tags = (s.tags || []).map((t: any) => String(t).toLowerCase());
  return (
    s.pack_role === 'story' ||
    tags.includes('story') ||
    tags.includes('story_enriched')
  );
});
console.log('source story spots', storySpots.length);

// How many mapped areas have story but not from story spots?
const storyIds = new Set(storySpots.map((s: any) => String(s.id)));
const extra = explore.filter((p) => {
  const key = String(p.spot_key || '');
  // spot_key like prisdorf_foo or prisdorf:foo
  const id = key.replace(/^prisdorf[_:]/, '');
  return !storyIds.has(id) && !storyIds.has(key);
});
console.log('explore not matching story spot id', extra.length);
console.log(
  'extra sample',
  extra.slice(0, 20).map((p) => ({
    name: p.name,
    key: p.spot_key,
    tags: p.tags_json,
  })),
);

const cov = pack._coverage || {};
console.log('coverage bbox', {
  latMin: cov.latMin,
  latMax: cov.latMax,
  lngMin: cov.lngMin,
  lngMax: cov.lngMax,
  polyN: Array.isArray(cov.polygon) ? cov.polygon.length : 0,
});
