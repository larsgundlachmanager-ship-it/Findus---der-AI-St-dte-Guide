/**
 * Danzig: Story-Tags bereinigen + data_version bumpen.
 * Echtes Story → pack_role story, Noise (Airbnb/Bahnhof-Duplikate) → directory.
 *   node .cursor/_fix_danzig_stories.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACK = join(process.cwd(), 'data/staedte/danzig.json');

function isNoiseStoryName(name) {
  const n = String(name || '');
  return (
    /apartment|mikrosuite|one-bedroom|ferienwohnung|airbnb|booking\.com|hostel\b|guest\s*house/i.test(
      n,
    ) ||
    /hauptbahnhof\s*\d+/i.test(n) ||
    /^gdansk$/i.test(n.trim()) ||
    /^danzig$/i.test(n.trim())
  );
}

function isRealStorySpot(spot) {
  const tags = new Set((spot.tags || []).map((t) => String(t).toLowerCase()));
  if (spot.pack_role === 'story') return true;
  if (!tags.has('story') && !tags.has('story_enriched')) return false;
  if (isNoiseStoryName(spot.name)) return false;
  return (
    tags.has('curated_keep') ||
    tags.has('wikipedia_enriched') ||
    tags.has('deep_research_merged') ||
    tags.has('must_have') ||
    tags.has('module1') ||
    tags.has('tier1') ||
    tags.has('tier2') ||
    Number(spot.place_tier) === 1 ||
    Number(spot.place_tier) === 2
  );
}

const pack = JSON.parse(readFileSync(PACK, 'utf8'));
let promoted = 0;
let demoted = 0;

for (const spot of pack.spots || []) {
  const tags = Array.isArray(spot.tags) ? spot.tags.map(String) : [];
  const lower = tags.map((t) => t.toLowerCase());
  const hasStory = lower.includes('story') || lower.includes('story_enriched');

  if (isRealStorySpot(spot)) {
    spot.pack_role = 'story';
    if (Number(spot.place_tier) === 4 || spot.place_tier == null) {
      spot.place_tier = 2;
    }
    const next = new Set(lower);
    next.add('story');
    next.delete('directory');
    next.delete('amenity_skip');
    next.delete('offline_lookup');
    next.delete('tier4');
    spot.tags = [...next];
    promoted++;
  } else if (hasStory || spot.pack_role === 'story') {
    // Falsch als Story markiert → Directory
    spot.pack_role = 'directory';
    if (spot.place_tier == null) spot.place_tier = 4;
    const next = new Set(lower);
    next.delete('story');
    next.delete('story_enriched');
    next.add('directory');
    next.add('tier4');
    next.add('offline_lookup');
    next.add('amenity_skip');
    spot.tags = [...next];
    demoted++;
  }
}

const prev = Number(pack.data_version) || 0;
pack.data_version = Math.max(prev + 1, 35);
pack.updated_at = new Date().toISOString();

writeFileSync(PACK, JSON.stringify(pack, null, 2) + '\n', 'utf8');
console.log(
  JSON.stringify(
    {
      promoted,
      demoted,
      data_version: pack.data_version,
      storyRole: (pack.spots || []).filter((s) => s.pack_role === 'story')
        .length,
    },
    null,
    2,
  ),
);
