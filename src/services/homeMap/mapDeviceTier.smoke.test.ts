import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tierSrc = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapDeviceTier.ts'),
  'utf8',
);
assert(tierSrc.includes('mapExtractCapsForRadius'), 'tier caps helper');
assert(tierSrc.includes("'low'"), 'low tier');

const extractSrc = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'),
  'utf8',
);
assert(extractSrc.includes('mapExtractCapsForRadius'), 'extract uses tier caps');
assert(extractSrc.includes('noteMapDataWarm'), 'prefetch marks warm');

const cacheSrc = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapDataCache.ts'),
  'utf8',
);
assert(cacheSrc.includes('noteMapDataPainted'), 'paint tracker');

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
assert(host.includes('mapExtractPaint'), 'Extract-Paint deferred während Geste');
assert(host.includes('placeFilters={mapFilters}'), 'filter prop to native');
assert(host.includes('noteMapDataPainted'), 'host tracks paint');
assert(!host.includes('[mapFilters, amenityIcons]'), 'no filter geojson rebuild');

const native = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
assert(native.includes('HOME_MAP_WORLD_MAX_ZOOM'), 'world LOD cap');
assert(!native.includes('id="extract-roads-labels"'), 'kein altes extract-roads-labels');
assert(native.includes('id="extract-road-names"'), 'Straßennamen über der Route');
assert(native.includes('mapPlaceVisibilityFilter'), 'layer filter SSOT');

console.log('mapDeviceTier.smoke.test.ts OK');
