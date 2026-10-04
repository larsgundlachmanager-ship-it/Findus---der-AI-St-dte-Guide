import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const prompt = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapPackPrompt.ts'),
  'utf8',
);
assert(prompt.includes('promptCityPackDownloadIfNeeded'), 'prompt fn');
assert(prompt.includes('presentCityPackSwitchCard'), 'switch card');
assert(prompt.includes('PROMPT_COOLDOWN_MS'), 'cooldown');
assert(prompt.includes('cityEnter'), 'cityEnter gate');
assert(prompt.includes('if (!input.cityEnter) return false'), 'no pan popup');
assert(prompt.includes('ensureBrowsePackAtViewport'), 'browse feeder ensure');
assert(
  prompt.includes('ensureBrowsePacksOverlappingViewport'),
  'viewport-overlap browse ensure',
);
assert(prompt.includes('ensureBrowseCityPackOnDevice'), 'disk-only browse pack');
assert(prompt.includes('MAP_BROWSE_PACK_SLOTS'), 'browse slot budget');
assert(prompt.includes('newlyFetched'), 'track fresh browse downloads');
assert(
  prompt.includes('isCityPackCachedOnDevice'),
  'disk-cached pack skips network even if localPackIds stale',
);
assert(
  prompt.includes('isStickyGps'),
  'sticky GPS city still downloads pack when profile differs',
);
assert(
  !/if \(cityId === opts\.profile \|\| cityId === opts\.sticky\) return null/.test(
    prompt,
  ),
  'must not skip sticky GPS city pack ensure',
);

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
assert(host.includes('promptCityPackDownloadIfNeeded'), 'host wired');
assert(host.includes('maybePromptPackAt'), 'host helper');
assert(host.includes('maybePromptPackAt(lat, lng, true)'), 'city-enter prompt');
assert(host.includes('maybeEnsureBrowsePackAt'), 'browse ensure wired');
assert(
  host.includes('ensureBrowsePacksOverlappingViewport'),
  'browse ensure uses viewport overlap',
);
assert(host.includes('placesPaintPendingRef'), 'pending places paint after gesture');
assert(
  host.includes('neighborMergeRetryTimer'),
  'neighbor merge retry after gesture',
);
assert(host.includes('yorroContentAt'), 'viewport gate helper');
assert(
  host.includes('HOME_MAP_PLACES_GESTURE_QUIET_MS'),
  'places inject after short gesture quiet',
);
assert(host.includes('HOME_MAP_PLACES_REINJECT_MIN_M'), 'places reinject distance');
assert(host.includes('warmNearbyPinIndexes'), 'warm neighbor pins from disk');
assert(host.includes('placesFastDotsRef.current = true'), 'two-phase fast dots');
assert(
  host.includes('if (isVectorBasemapEnabled()) return') &&
    host
      .slice(host.indexOf('Display-Extract'))
      .includes('if (isVectorBasemapEnabled()) return'),
  'skip display extract in vector',
);

const catalog = readFileSync(
  join(process.cwd(), 'src/services/cityCatalogService.ts'),
  'utf8',
);
assert(
  catalog.includes('ensureBrowseCityPackOnDevice'),
  'browse pack without SQLite switch',
);
assert(
  catalog.includes('Browse-Pack bereit (ohne Aktiv-Switch)'),
  'browse never activates city',
);
assert(
  !catalog
    .slice(catalog.indexOf('ensureBrowseCityPackOnDevice'))
    .slice(0, 1200)
    .includes('replacePoisAndFacts'),
  'browse path must not replace SQLite',
);

const pins = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapPinIndex.ts'),
  'utf8',
);
assert(
  pins.includes('loadCityPackLocalOnly'),
  'pin rebuild from disk only',
);
assert(
  pins.includes('schedulePinIndexRebuildWhenIdle'),
  'pin rebuild deferred to idle',
);
assert(
  pins.includes('allowFullPackRebuild'),
  'hot path load is slim-only by default',
);
assert(
  !pins
    .slice(pins.indexOf('rebuildPinIndexFromCachedPack'))
    .slice(0, 500)
    .includes('loadCityPackCachedOrRemote'),
  'pin rebuild must not hit remote',
);

console.log('mapPackPrompt.smoke.test.ts OK');
