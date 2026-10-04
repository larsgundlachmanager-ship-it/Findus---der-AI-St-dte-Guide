/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/g2p/romanNumerals.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  parseRomanNumeral,
  germanOrdinalAbsolute,
  expandRomanNumeralsForSpeech,
} from './romanNumeralsSpeech';

assert.equal(parseRomanNumeral('XIV'), 14);
assert.equal(parseRomanNumeral('II'), 2);
assert.equal(parseRomanNumeral('XL'), 40);
assert.equal(parseRomanNumeral('MIX'), 1009);
assert.equal(parseRomanNumeral('ABC'), null);

assert.equal(germanOrdinalAbsolute(14), 'Vierzehnte');
assert.equal(germanOrdinalAbsolute(1), 'Erste');
assert.equal(germanOrdinalAbsolute(2), 'Zweite');
assert.equal(germanOrdinalAbsolute(3), 'Dritte');
assert.equal(germanOrdinalAbsolute(20), 'Zwanzigste');

assert.equal(
  expandRomanNumeralsForSpeech('Papst Leo XIV. ist 70 Jahre alt.'),
  'Papst Leo der Vierzehnte ist 70 Jahre alt.',
);
assert.equal(
  expandRomanNumeralsForSpeech('Karl V. regierte lange.'),
  'Karl der Fünfte regierte lange.',
);
assert.equal(
  expandRomanNumeralsForSpeech('Elisabeth II. war Queen.'),
  'Elisabeth die Zweite war Queen.',
);
assert.ok(
  !/XIV/i.test(
    expandRomanNumeralsForSpeech('Papst Leo XIV ist der erste US-Papst.'),
  ),
);
assert.equal(expandRomanNumeralsForSpeech('nur XIV hier'), 'nur XIV hier');

console.log('romanNumerals.smoke.test.ts ok');
