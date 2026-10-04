/**
 * Smoke: Viewport-Pack-Limit (1 sticky GPS + 2 Browse dynamisch).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/mapPinIndex.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapPinIndex.ts'),
  'utf8',
);

assert(
  src.includes('MAP_VIEWPORT_PACK_CITY_LIMIT = 3'),
  'max 3 Packs gleichzeitig im Viewport',
);
assert(src.includes('MAP_STICKY_PACK_SLOTS = 1'), '1 GPS-Stadt sticky');
assert(src.includes('MAP_BROWSE_PACK_SLOTS = 2'), '2 Browse-Städte dynamisch');
assert(src.includes("startsWith('soft_')"), 'soft active kein Paint-Slot');
assert(src.includes('stickyCityId'), 'stickyCityId API');
assert(src.includes('retainWarmPinIndexes'), 'ältere Browse-Packs aus RAM');
assert(src.includes('MAP_PIN_INDEX_WARM_LIMIT = 3'), 'Warm-Limit klein (RAM)');
assert(src.includes('allowFullPackRebuild'), 'Full-Pack-Rebuild opt-in');
assert(src.includes('schedulePinIndexRebuildWhenIdle'), 'Rebuild hinter mapIdle');
assert(src.includes('canParseFullPackNow'), 'Full-Pack nie auf Mic/Polish');
assert(
  src.includes('allowFullPackRebuild: true'),
  'warmNearby darf Full-Rebuild (Idle)',
);

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
assert(
  host.includes('maxCities: MAP_VIEWPORT_PACK_CITY_LIMIT'),
  'HomeMap nutzt 3-Stadt-Limit',
);
assert(host.includes('stickyCityId'), 'HomeMap setzt GPS-Sticky');
assert(
  host.includes('overlappingDownloadedPackIds'),
  'schon geladene Packs im Viewport triggern Paint',
);
assert(
  host.includes('lastOverlappingPackSigRef'),
  'Overlap-Sig für Idle-Refresh',
);
assert(
  host.includes('forcePaintPlacesNow'),
  'Browse-ensure forciert Places-Paint',
);
assert(src.includes('pins.v3.json'), 'Pin-Index v3 (liked = harte M1-Signale)');
assert(
  src.includes('map_story_fill') && src.includes('historical_core'),
  'liked ohne nacktes story-Tag',
);
assert(!src.includes('tier2'), 'tier2 allein kein liked-Fill');

console.log('mapPinIndex.smoke.test.ts OK');
