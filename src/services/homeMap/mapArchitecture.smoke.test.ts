/**
 * Run: npx -p tsx@4.19.2 --yes tsx src/services/homeMap/mapArchitecture.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const root = process.cwd();

assert(
  readFileSync(join(root, 'src/store/useMapExtractStore.ts'), 'utf8').includes(
    'useMapExtractStore',
  ),
  'extract store',
);
assert(
  readFileSync(join(root, 'src/store/useSensorStore.ts'), 'utf8').includes(
    'reportHeading',
  ),
  'sensor store',
);
assert(
  readFileSync(
    join(root, 'modules/findus-map-native/ios/FindusMapNativeModule.swift'),
    'utf8',
  ).includes('parseMapExtractFile'),
  'iOS native parse',
);
assert(
  readFileSync(
    join(root, 'src/services/homeMap/mapExtractLoader.ts'),
    'utf8',
  ).includes('loadExtractForViewport'),
  'viewport loader',
);
assert(
  readFileSync(
    join(root, 'src/components/homeMap/NativeHomeMapView.tsx'),
    'utf8',
  ).includes('pushPuckHeading'),
  'puck heading split',
);
assert(
  readFileSync(join(root, 'src/screens/HomeScreen.tsx'), 'utf8').includes(
    'chromeDim={mapChromeDim}',
  ),
  'chromeDim prop',
);

assert(
  readFileSync(
    join(root, 'src/components/homeMap/NativeHomeMapView.tsx'),
    'utf8',
  ).includes('regional-fallback'),
  'regional fallback layer',
);
assert(
  readFileSync(
    join(root, 'scripts/uploadRegionalMapTiles.mjs'),
    'utf8',
  ).includes('maps/${tier}/'),
  'regional upload script',
);

console.log('mapArchitecture.smoke.test.ts OK');
