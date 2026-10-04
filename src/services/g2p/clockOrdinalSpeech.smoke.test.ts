/**
 * Uhrzeiten + Ordinalziffern für TTS.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/g2p/clockOrdinalSpeech.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clockHourToGermanWords,
  transformBareOrdinals,
  transformClockTimes,
  transformNumericRanges,
  transformOrdinalDates,
} from './germanNumberSpeech';

assert.equal(clockHourToGermanWords(1), 'ein');
assert.equal(clockHourToGermanWords(0), 'null');
assert.equal(clockHourToGermanWords(13), 'dreizehn');

assert.equal(
  transformClockTimes('Treffen um 01:19.'),
  'Treffen um ein Uhr neunzehn.',
);
assert.equal(transformClockTimes('Abfahrt 8:00 Uhr'), 'Abfahrt acht Uhr');
assert.equal(
  transformNumericRanges('13-18 Grad'),
  '13 bis 18 Grad',
);
assert.equal(
  transformNumericRanges('zwischen 13–18°'),
  'zwischen 13 bis 18°',
);
assert.equal(
  transformClockTimes('Film um 20:15'),
  'Film um zwanzig Uhr fünfzehn',
);
assert.equal(
  transformClockTimes('Wecker auf 7:35'),
  'Wecker auf sieben Uhr fünfunddreißig',
);
assert.equal(
  transformClockTimes('Aufstehen um 7 Uhr 35'),
  'Aufstehen um sieben Uhr fünfunddreißig',
);

assert.equal(
  transformBareOrdinals('Der 1. und der 2.'),
  'Der erster und der zweiter',
);
assert.equal(transformBareOrdinals('1. / 2.'), 'erster / zweiter');
assert.match(transformOrdinalDates('Am 1. Mai'), /erster Mai/i);

const voice = readFileSync(
  join(process.cwd(), 'src/services/AudioVoiceService.ts'),
  'utf8',
);
assert(
  voice.includes('germanNumberSpeech') &&
    voice.includes('transformClockTimes') &&
    voice.includes('transformBareOrdinals'),
  'TTS-Pfad muss Uhrzeiten/Ordinale expandieren',
);

console.log('clockOrdinalSpeech.smoke.test.ts OK');
