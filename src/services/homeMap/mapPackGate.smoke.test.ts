/**
 * Smoke: mapPackGate — Multi-Pack Viewport + Vector.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/mapPackGate.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapPackGate.ts'),
  'utf8',
);
assert(src.includes('coverageBounds'), 'Viewport-Coverage-Overlap');
assert(src.includes('coverageOverlapsView'), 'Pack-Box vs View');
assert(src.includes('Profil-Pack'), 'Boot-Race: Profil-Pack Fallback');
assert(src.includes('isYorroMapContentAllowed'), 'Gate export');

const welcome = readFileSync(
  join(process.cwd(), 'src/services/cityWelcomeService.ts'),
  'utf8',
);
assert(welcome.includes("'pack_remote'"), 'Remote-Pack-Open Modus');
assert(welcome.includes('isPhysicallyInCity'), 'GPS-in-Stadt Gate');
assert(welcome.includes('mode === \'pack_remote\''), 'kein Welcome-Record remote');

const policy = readFileSync(
  join(process.cwd(), 'src/services/concierge/findusResponsePolicy.ts'),
  'utf8',
);
assert(
  policy.includes('FINDUS_CITY_PACK_REMOTE_OPEN_BLOCK'),
  'Remote-Open Speech-Block',
);

const gps = readFileSync(
  join(process.cwd(), 'scripts/cityPack/gpsWegweiserLoop.mjs'),
  'utf8',
);
assert(gps.includes('with-offline-map'), 'Offline-Map opt-in');
assert(gps.includes('Protomaps'), 'Default skip Offline-Map');

const upload = readFileSync(
  join(process.cwd(), 'scripts/uploadCityPack.mjs'),
  'utf8',
);
assert(
  upload.includes('Offline-Basemap abgeschaltet') ||
    upload.includes('kein Offline-Extract'),
  'Upload skippt map.json',
);

console.log('mapPackGate.smoke.test.ts OK');
