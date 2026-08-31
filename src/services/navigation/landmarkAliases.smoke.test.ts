/**
 * Smoke: Landmark-Alias A-Harmonie → Elphi.
 * Run: npx --yes tsx src/services/navigation/landmarkAliases.smoke.test.ts
 */

import { canonicalizeLandmarkQuery, foldCityKey } from './landmarkAliases';
import { composeGeocodeQuery } from './fuzzyCityResolve';
import * as fs from 'fs';
import * as path from 'path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const a = canonicalizeLandmarkQuery('zur A Harmonie');
assert(a.matchedLandmark, 'A Harmonie matched');
assert(a.preferredCityId === 'hamburg', 'prefer hamburg');
assert(/Elbphilharmonie/i.test(a.query), 'canon name');

assert(canonicalizeLandmarkQuery('Elphi').matchedLandmark, 'Elphi');
assert(!canonicalizeLandmarkQuery('zur A').matchedLandmark, 'bare A');

const fecht = canonicalizeLandmarkQuery('Lübecker Fühling-Club');
assert(fecht.matchedLandmark, 'Fühling-Club → Fechtclub');
assert(fecht.preferredCityId === 'luebeck', 'prefer luebeck');
assert(/Fechtclub/i.test(fecht.query), 'canon Fechtclub');
assert(canonicalizeLandmarkQuery('Marienkirche').matchedLandmark, 'Marienkirche');
assert(foldCityKey('Lübeck') === foldCityKey('luebeck'), 'Lübeck ≡ luebeck');
assert(foldCityKey('Lübeck') === 'luebeck', 'umlauts before NFD');
assert(!canonicalizeLandmarkQuery('Phoenix Hotel').matchedLandmark, 'bare Phoenix hotel');
assert(canonicalizeLandmarkQuery('Frauenkirche').preferredCityId === 'luebeck', 'Frauenkirche → Lübeck');

const holsten = canonicalizeLandmarkQuery('Holstentor');
assert(holsten.matchedLandmark, 'Holstentor matched');
assert(holsten.preferredCityId === 'luebeck', 'Holstentor → luebeck');

const phoenix = canonicalizeLandmarkQuery('Tennisclub Phoenix');
assert(canonicalizeLandmarkQuery('Tennisclub Phoenix').matchedLandmark, 'Phoenix matched');
assert(canonicalizeLandmarkQuery('Tennisclub Phönix').matchedLandmark, 'Phönix matched');
assert(phoenix.preferredCityId === 'luebeck', 'Phoenix → luebeck');

assert(
  composeGeocodeQuery('Tennisclub Phoenix Lübeck', 'Prisdorf') ===
    'Tennisclub Phoenix Lübeck',
  'do not append Prisdorf when Lübeck is in the query',
);
assert(
  composeGeocodeQuery('Rathaus', 'Lübeck') === 'Rathaus, Lübeck',
  'append city when query has none',
);

const repoPack = path.join(process.cwd(), 'data', 'staedte', 'hamburg.json');
if (fs.existsSync(repoPack)) {
  const raw = JSON.parse(fs.readFileSync(repoPack, 'utf8')) as {
    spots?: Array<{ name?: string }>;
  };
  const spot = (raw.spots || []).find((s) =>
    /elbphilharmonie/i.test(s.name || ''),
  );
  assert(spot, 'hamburg pack has Elbphilharmonie');
  console.log('elphi in pack:', spot!.name);
}

console.log('landmarkAliases.smoke.test.ts OK');
