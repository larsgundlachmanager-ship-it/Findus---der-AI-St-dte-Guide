import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cfg = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapTileConfig.ts'),
  'utf8',
);
assert(cfg.includes('resolveProtomapsStyleUrl'), 'hosted style url');
assert(cfg.includes('styles/v5/'), 'protomaps style v5');

const loader = readFileSync(
  join(process.cwd(), 'src/services/homeMap/yorroProtomapsBasemapStyle.ts'),
  'utf8',
);
assert(loader.includes('loadYorroProtomapsBasemapStyle'), 'async style load');
assert(loader.includes('recolorProtomapsStyleForYorro'), 'yorro recolor');
assert(loader.includes('HOME_MAP_ROAD_COLORS'), 'yorro road colors');

const view = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
assert(view.includes('loadYorroProtomapsBasemapStyle'), 'map loads hosted style');
assert(view.includes('vectorStyle'), 'style state');
assert(view.includes('mapBasemapStyle'), 'basemap style var');
assert(!view.includes('resolveHomeMapBasemapStyle'), 'no broken URL-only resolver');

console.log('mapTileConfig.smoke.test.ts OK');
