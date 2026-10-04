import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Use compiled path via dynamic import of ts — fallback: reimplement collectTags + coords
const pack = JSON.parse(readFileSync('data/staedte/danzig.json', 'utf8'));

function collectTags(spot) {
  const tags = new Set();
  for (const t of spot.tags ?? []) tags.add(String(t).toLowerCase());
  for (const t of spot.facts?.tags ?? []) tags.add(String(t).toLowerCase());
  if (spot.category) tags.add(String(spot.category).toLowerCase());
  if (spot.pack_role) tags.add(String(spot.pack_role).toLowerCase());
  if (spot.place_tier != null) tags.add(`tier${spot.place_tier}`);
  const isStory = spot.pack_role === 'story' || tags.has('story');
  if (isStory && spot.pack_role !== 'directory') {
    tags.delete('directory');
    tags.delete('tier4');
    tags.delete('offline_lookup');
    tags.delete('amenity_skip');
    tags.add('story');
  } else if (spot.pack_role === 'directory' || Number(spot.place_tier) === 4) {
    tags.add('directory');
    tags.add('tier4');
    tags.add('offline_lookup');
    tags.add('amenity_skip');
  }
  return [...tags];
}

function isNoiseStoryName(name) {
  const n = String(name || '').toLowerCase();
  return (
    /apartment|mikrosuite|one-bedroom|ferienwohnung|airbnb|booking\.com/i.test(
      n,
    ) ||
    /hauptbahnhof\s*\d+/i.test(n) ||
    /^gdansk$/i.test(n.trim())
  );
}

const spots = pack.spots || [];
let roleStory = 0;
let tagStoryDir = 0;
let mapOk = 0;
let noise = 0;
for (const s of spots) {
  const tags = collectTags(s);
  const hasStory = tags.includes('story');
  if (s.pack_role === 'story') roleStory++;
  if (hasStory && tags.includes('directory')) tagStoryDir++;
  if (hasStory && !tags.includes('directory')) {
    if (isNoiseStoryName(s.name)) noise++;
    else mapOk++;
  }
}

console.log(
  JSON.stringify(
    {
      data_version: pack.data_version,
      updated_at: pack.updated_at,
      spots: spots.length,
      roleStory,
      tagStoryDirBlocked: tagStoryDir,
      mapOkApprox: mapOk,
      noiseKeptAsStory: noise,
      coveragePts: pack._coverage?.polygon?.length,
    },
    null,
    2,
  ),
);
