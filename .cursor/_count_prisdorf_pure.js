const pack = require('../data/staedte/prisdorf.json');
const spots = pack.spots || [];
const triggers = pack.trigger_points || [];
const byId = new Map(triggers.map((t) => [t.id, t]));

function tagsOf(s) {
  return (s.tags || []).map((x) => String(x).toLowerCase());
}
function isStory(s) {
  const t = tagsOf(s);
  return s.pack_role === 'story' || t.includes('story') || t.includes('story_enriched');
}
function hasGps(s) {
  const tp = byId.get(s.id);
  const lat = s.lat ?? tp?.lat;
  const lng = s.lng ?? tp?.lng;
  return Number.isFinite(lat) && Number.isFinite(lng);
}

const stories = spots.filter(isStory);
console.log({
  data_version: pack.data_version,
  spots: spots.length,
  stories: stories.length,
  storiesWithGps: stories.filter(hasGps).length,
  directory: spots.filter((s) => tagsOf(s).includes('directory') || s.pack_role === 'directory').length,
});

// Also: how many trigger points look like area stories?
const storyIds = new Set(stories.map((s) => s.id));
const tpForStories = triggers.filter((t) => storyIds.has(t.id));
console.log('trigger rows for story ids', tpForStories.length, 'with gps', tpForStories.filter((t) => Number.isFinite(t.lat)).length);

// names of stories without gps
const noGps = stories.filter((s) => !hasGps(s)).map((s) => s.name);
console.log('stories without gps', noGps.length, noGps.slice(0, 10));
