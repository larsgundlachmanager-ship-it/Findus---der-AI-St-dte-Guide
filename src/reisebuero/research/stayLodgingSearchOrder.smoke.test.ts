/**
 * Smoke: stayLodgingSearchOrder widen rules.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stayLodgingSearchOrder } from './stayLodgingSearchOrder';

assert.deepEqual(
  stayLodgingSearchOrder({ preferred: 'apartment', fallback: 'hotel' }),
  ['apartment', 'hotel', 'any'],
  'apartment+hotel fallback',
);

assert.deepEqual(
  stayLodgingSearchOrder({ preferred: 'apartment' }),
  ['apartment', 'hotel', 'any'],
  'apartment widens to hotel then any',
);

assert.deepEqual(
  stayLodgingSearchOrder({ preferred: 'hotel', fallback: 'apartment' }),
  ['hotel', 'apartment', 'any'],
  'hotel+apartment fallback',
);

assert.deepEqual(
  stayLodgingSearchOrder({ preferred: 'any', researchPath: 'stay_first' }),
  ['apartment', 'hotel'],
  'any + stay_first',
);

assert.deepEqual(
  stayLodgingSearchOrder({ preferred: 'any', researchPath: 'flight_first' }),
  ['hotel', 'apartment'],
  'any + flight_first',
);

assert.deepEqual(
  stayLodgingSearchOrder({ preferred: 'apartment', preferAllInclusive: true }),
  ['hotel', 'apartment', 'any'],
  'AI = hotel first, apartment parallel',
);

// Funnel wires helper (source assert — no live Stay22)
const liveSrc = readFileSync(join(__dirname, 'liveStaySearch.ts'), 'utf8');
assert.match(
  liveSrc,
  /stayLodgingSearchOrder/,
  'liveStaySearch uses stayLodgingSearchOrder',
);

console.log('stayLodgingSearchOrder.smoke.test.ts ok');
