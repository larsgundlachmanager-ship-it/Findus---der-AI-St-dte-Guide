import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapLayerDebug.ts'),
  'utf8',
);
assert(src.includes('MAP_LAYER_DEBUG_STEPS'), 'steps defined');
assert(src.includes('isMapLayerGroupVisible'), 'group visibility');
assert(src.includes('mapLayerDebugAllows'), 'inject gates');
assert(src.includes('isMapLayerDebugExtractLocked'), 'extract lock');

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
assert(host.includes('MapLayerDebugHud'), 'HUD wired');
assert(host.includes('applyMapLayerDebugStepEffects'), 'step side effects');

const native = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
assert(native.includes('MapLayerGate'), 'layer gates in native');

console.log('mapLayerDebug.smoke.test.ts OK');
