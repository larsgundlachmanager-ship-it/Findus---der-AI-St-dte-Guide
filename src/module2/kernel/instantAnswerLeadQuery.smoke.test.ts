/**
 * Instant Answer-Lead Query (Hauptstadt & Peek-Struktur-Kandidaten).
 */
import assert from 'node:assert/strict';
import {
  looksLikeCapitalOrGeoFactQuery,
  looksLikeInstantAnswerLeadQuery,
} from './instantAnswerLeadQuery';

assert.equal(
  looksLikeCapitalOrGeoFactQuery('Was ist die Hauptstadt von Frankreich?'),
  true,
);
assert.equal(
  looksLikeCapitalOrGeoFactQuery('Hauptstadt von Japan'),
  true,
);
assert.equal(
  looksLikeCapitalOrGeoFactQuery('Wo essen wir heute?'),
  false,
);
assert.equal(
  looksLikeInstantAnswerLeadQuery('Was ist die Hauptstadt von Italien?'),
  true,
);
assert.equal(
  looksLikeInstantAnswerLeadQuery('Wie alt ist Mark Forster?'),
  true,
  'quick-lookup path must resolve (not require undefined module)',
);
assert.equal(
  looksLikeInstantAnswerLeadQuery('navigiere mich zum Bahnhof'),
  false,
);

console.log('instantAnswerLeadQuery.smoke.test.ts: ok');
