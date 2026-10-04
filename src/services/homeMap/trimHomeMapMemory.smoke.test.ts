/**
 * Run: npx -p tsx@4.19.2 --yes tsx src/services/homeMap/trimHomeMapMemory.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const trim = readFileSync(
  join(process.cwd(), 'src/services/homeMap/trimHomeMapMemory.ts'),
  'utf8',
);
const pins = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapPinIndex.ts'),
  'utf8',
);
const extract = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'),
  'utf8',
);
const fog = readFileSync(join(process.cwd(), 'src/store/useFogStore.ts'), 'utf8');
const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);

assert(trim.includes('trimMapPinIndexesToKeep'), 'pin trim');
assert(trim.includes('clearCityMapExtractMem'), 'extract clear');
assert(trim.includes('trimExplored'), 'fog trim');
assert(pins.includes('MAP_PIN_INDEX_WARM_LIMIT = 3'), 'warm limit 3');
assert(pins.includes('listWarmMapPinCityIds'), 'list warm ids');
assert(extract.includes('displayMemByCity.clear()'), 'extract mem fully cleared');
assert(fog.includes('trimExplored'), 'fog store trim');
assert(host.includes('trimHomeMapMemory'), 'background calls trim');

console.log('trimHomeMapMemory.smoke.test.ts OK');
