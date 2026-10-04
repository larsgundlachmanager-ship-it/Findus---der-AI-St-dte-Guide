import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Avoid RN imports — reimplement minimal gates matching stampMapModul1 + cityPack collectTags
const pack = JSON.parse(readFileSync('data/staedte/prisdorf.json', 'utf8'));

function collectTags(spot) {
  const tags = new Set();
  for (const t of spot.tags ?? []) tags.add(String(t).toLowerCase());
  if (spot.category) tags.add(String(spot.category).toLowerCase());
  if (spot.pack_role) tags.add(String(spot.pack_role).toLowerCase());
  if (spot.place_tier != null) tags.add(`tier${spot.place_tier}`);
  const isStory =
    spot.pack_role === 'story' ||
    tags.has('story') ||
    tags.has('story_enriched');
  if (isStory) {
    tags.delete('directory');
    tags.delete('tier4');
    tags.delete('offline_lookup');
    tags.delete('amenity_skip');
    tags.add('story');
  } else if (
    spot.pack_role === 'directory' ||
    Number(spot.place_tier) === 4
  ) {
    tags.add('directory');
    tags.add('tier4');
    tags.add('offline_lookup');
    tags.add('amenity_skip');
  }
  return [...tags];
}

function isPackStory(tags) {
  if (
    tags.includes('directory') ||
    tags.includes('tier4') ||
    tags.includes('offline_lookup') ||
    tags.includes('amenity_skip')
  ) {
    return false;
  }
  return tags.includes('story') || tags.includes('story_enriched');
}

let explore = 0;
let storyRole = 0;
const names = [];
for (const s of pack.spots || []) {
  if (s.pack_role === 'story') storyRole++;
  const tags = collectTags(s);
  if (isPackStory(tags)) {
    explore++;
    names.push(s.name);
  }
}

const danzig = JSON.parse(readFileSync('data/staedte/danzig.json', 'utf8'));
let dExplore = 0;
for (const s of danzig.spots || []) {
  const tags = collectTags(s);
  if (isPackStory(tags)) dExplore++;
}

console.log(
  JSON.stringify(
    {
      prisdorf: { storyRole, exploreAfterCollect: explore, names: names.length },
      danzigExplore: dExplore,
    },
    null,
    2,
  ),
);
