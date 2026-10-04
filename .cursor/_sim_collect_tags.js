const pack = require('../data/staedte/prisdorf.json');

function collectTags(spot) {
  const tags = new Set();
  for (const t of spot.tags ?? []) tags.add(String(t).toLowerCase());
  for (const t of spot.facts?.tags ?? []) tags.add(String(t).toLowerCase());
  if (spot.category) tags.add(spot.category.toLowerCase());
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
  } else if (spot.pack_role === 'directory' || Number(spot.place_tier) === 4) {
    tags.add('directory');
    tags.add('tier4');
    tags.add('offline_lookup');
    tags.add('amenity_skip');
  }
  return [...tags];
}

const triggers = pack.trigger_points || [];
const byId = new Map(triggers.map((t) => [t.id, t]));
let explore = 0;
const names = [];
for (const spot of pack.spots || []) {
  const tp = byId.get(spot.id);
  const lat = spot.lat ?? tp?.lat;
  const lng = spot.lng ?? tp?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const tags = collectTags(spot);
  if (tags.includes('directory') || tags.includes('tier4')) continue;
  if (!tags.includes('story') && !tags.includes('story_enriched')) continue;
  explore++;
  names.push(spot.name);
}
console.log('explore from spots', explore);
console.log(names.join('\n'));

// orphan triggers as area?
let orphan = 0;
const used = new Set((pack.spots || []).map((s) => s.id));
for (const tp of triggers) {
  if (used.has(tp.id)) continue;
  if (!Number.isFinite(tp.lat)) continue;
  if (tp.trigger_kind === 'approach' || tp.trigger_kind === 'sub') continue;
  orphan++;
}
console.log('orphan area triggers', orphan);
