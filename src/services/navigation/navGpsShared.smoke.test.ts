/**
 * Nav GPS = shared locationService + gpsCadence (keine Doppel-Watch).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/navGpsShared.smoke.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const nav = readFileSync(
  join(process.cwd(), 'src/services/navigation/navigationService.ts'),
  'utf8',
);

assert(nav.includes('no duplicate watch'), 'prefer shared watch');
assert(nav.includes('startWatchingLocation'), 'wake locationService if idle');
assert(nav.includes('gpsIntervalMsWhileNavigating'), 'nav cadence SSOT');
assert(nav.includes('setGpsWatchInterval'), 'drive shared interval');
assert(
  !/timeInterval:\s*lastTransportMode === 'bicycle' \? 1000/.test(nav),
  'no hardcoded 1 Hz bike fallback',
);
assert(
  !/setGpsStreamProfile\('realtime-bike'\)/.test(nav),
  'no forced realtime-bike on every tick',
);

console.log('navGpsShared.smoke.test.ts OK');
