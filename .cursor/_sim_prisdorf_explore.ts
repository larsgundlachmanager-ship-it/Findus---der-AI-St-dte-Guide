/**
 * Simulate how many explore POIs mapCityPackToRemote + isCityExploreMapPoi yield for Prisdorf.
 */
import { readFileSync } from 'fs';
import { mapCityPackToRemote } from '../src/services/cityPack';
import { isCityExploreMapPoi, isPackStoryMapPoi } from '../src/services/navigation/stampMapModul1';

const pack = JSON.parse(readFileSync('data/staedte/prisdorf.json', 'utf8'));
const mapped = mapCityPackToRemote(pack as any);
const pois = mapped.pois;
console.log('mapped pois', pois.length);

const storyTag = pois.filter((p) => {
  const t = (p.tags_json || '').toLowerCase();
  return t.includes('story');
});
console.log('tags contain story*', storyTag.length);

const explore = pois.filter((p) => isCityExploreMapPoi(p as any));
const packStory = pois.filter((p) => isPackStoryMapPoi(p as any));
console.log('isPackStoryMapPoi', packStory.length);
console.log('isCityExploreMapPoi', explore.length);

// kinds
const kinds: Record<string, number> = {};
for (const p of explore) {
  const k = p.kind || 'null';
  kinds[k] = (kinds[k] || 0) + 1;
}
console.log('explore kinds', kinds);

// sample names
console.log(
  'explore sample',
  explore.slice(0, 15).map((p) => ({ name: p.name, kind: p.kind, tags: p.tags_json })),
);

// how many story vs story_enriched only
let pure = 0,
  enrichedOnly = 0,
  both = 0;
for (const p of explore) {
  const t = (p.tags_json || '').toLowerCase();
  const hasS = t.includes('"story"') || /(^|,)story(,|$)/.test(t) || t.includes('story,') || t.includes(',story');
  // tags_json is often JSON array
  let tags: string[] = [];
  try {
    tags = JSON.parse(p.tags_json || '[]').map((x: any) => String(x).toLowerCase());
  } catch {
    tags = (p.tags_json || '').toLowerCase().split(/[,|]/);
  }
  const s = tags.includes('story');
  const e = tags.includes('story_enriched');
  if (s && e) both++;
  else if (s) pure++;
  else if (e) enrichedOnly++;
}
console.log({ pure, enrichedOnly, both });
