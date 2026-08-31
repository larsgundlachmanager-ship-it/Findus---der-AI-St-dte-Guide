/**
 * Run: npx --yes tsx src/services/nearbyCitySlice.smoke.test.ts
 */

import {
  CITY_PICKER_NEARBY_LIMIT,
  sliceNearbyCities,
} from './nearbyCitySlice';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const pool = [
  { id: 'prisdorf' },
  { id: 'pinneberg' },
  { id: 'tornesch' },
  { id: 'hamburg' },
  { id: 'luebeck' },
  { id: 'laboe' },
  { id: 'kiel' },
  { id: 'hechingen' },
  { id: 'berlin' },
  { id: 'muenchen' },
];

const nearby = sliceNearbyCities(pool, { excludeId: 'prisdorf' });
assert(
  nearby.length === CITY_PICKER_NEARBY_LIMIT,
  `ohne Suche nur ${CITY_PICKER_NEARBY_LIMIT} nahe Orte, nicht den ganzen Katalog`,
);
assert(
  nearby.every((c) => c.id !== 'prisdorf'),
  'aktuelle Stadt nicht doppelt im Grid',
);
assert(nearby[0].id === 'pinneberg', 'nächster Ort zuerst');

const all = sliceNearbyCities(pool, { limit: 99 });
assert(all.length === pool.length, 'explizites Limit darf alle zeigen');

console.log('nearbyCitySlice.smoke.test.ts OK');
