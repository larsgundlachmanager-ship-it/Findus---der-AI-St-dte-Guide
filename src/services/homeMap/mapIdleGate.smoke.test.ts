import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
const loader = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapExtractLoader.ts'),
  'utf8',
);
const native = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
const fog = readFileSync(
  join(process.cwd(), 'src/services/homeMap/fogTrackEngine.ts'),
  'utf8',
);

assert(host.includes('waitMapIdle'), 'Host: Releases warten auf Map-Idle');
assert(host.includes('registerMapGestureProbe'), 'Host: Gesture-Lane registriert');
assert(
  host.includes('isMapExtractFrozen') && host.includes('injectCitiesRef'),
  'Host: Cities nach Freeze gated',
);
assert(
  loader.includes('isMapExtractFrozen') && loader.includes('!inSwitchRun'),
  'Loader: Freeze blockiert Same-City-Reload',
);
assert(
  native.includes('cityMapExtractToGeojsonAsync'),
  'Native: async GeoJSON für Full-Paint',
);
const geojson = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtractGeojson.ts'),
  'utf8',
);
assert(
  geojson.includes('polygonsFromRingsAsync'),
  'GeoJSON: Gebäude-Polygone gestückelt',
);
const clipSrc = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'),
  'utf8',
);
assert(
  clipSrc.includes('EXTRACT_BUILDING_CLIP_CHUNK'),
  'Clip: Gebäude-Chunk exportiert',
);
assert(
  !native.includes('regionDidChangeDebounceTime={16}'),
  'Native: Region-Debounce nicht mehr 16ms',
);
assert(fog.includes('isMapUserGesturing'), 'Fog: defer während Geste');
assert(
  fog.includes('FOG_BIKE_FULL_EVERY_MS') || fog.includes('GPS_FOG_MIN_BIKE_M'),
  'Fog: bike soft lane',
);
assert(fog.includes('runMapIdleWhenFree'), 'Fog Full-Merge nur mapIdle');
assert(fog.includes('FOG_WALK_FULL_EVERY_MS'), 'Fog walk tip + throttled full');
assert(fog.includes('fogShouldYield') || fog.includes('isVoiceLaneBusy'), 'Fog weicht Voice');
assert(fog.includes('navFogActive'), 'Fog: Nav erkennt Live-Nav');
assert(
  fog.includes('if (navFogActive()) return') || fog.includes('navFogActive()'),
  'Fog: während Nav kein Rebuild',
);
assert(fog.includes('pauseFogHotPath'), 'Fog: Mic pausiert Hot-Path');
assert(fog.includes('ensureNavFogCatchupWatch'), 'Fog: Catch-up nach Nav');
assert(fog.includes('commitFogSurface'), 'Fog: eine Fläche, kein Tip-Stapel');
assert(!fog.includes('base.slice'), 'Fog schneidet die Historie nicht ab');
assert(
  !native.includes('navFogOff'),
  'Native: Fog bleibt während Nav sichtbar',
);

assert(
  fog.includes('homeMapFogExploreIdleFrozen'),
  'Fog: Explore-Idle Freeze',
);
const pause = readFileSync(
  join(process.cwd(), 'src/services/ui/homeMapPause.ts'),
  'utf8',
);
assert(pause.includes('FOG_EXPLORE_IDLE_FREEZE_MS'), 'Pause: Idle-Freeze Fenster');
assert(pause.includes('noteHomeMapExploreActivity'), 'Pause: Explore-Activity');
assert(
  native.includes('noteHomeMapExploreActivity'),
  'Native: Gesture setzt Explore-Activity',
);

console.log('mapIdleGate.smoke.test.ts OK');
