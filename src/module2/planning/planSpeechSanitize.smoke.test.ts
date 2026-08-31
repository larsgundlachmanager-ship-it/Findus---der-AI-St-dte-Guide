/**
 * Run: npx --yes tsx src/module2/planning/planSpeechSanitize.smoke.test.ts
 */

import {
  buildCompletePlanSpeech,
  humanizePlanTitle,
  sanitizePlanSpeech,
} from './planSpeechSanitize';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const dirty =
  'Ich baue den Masterplan. Prio 6 openWishesQueue choice_abc Datensatz Offener Wunsch fixedNodes.';
const clean = sanitizePlanSpeech(dirty);
assert(!/masterplan/i.test(clean), 'no masterplan');
assert(!/datensatz/i.test(clean), 'no datensatz');
assert(!/openWishesQueue/i.test(clean), 'no json key');
assert(!/choice_abc/i.test(clean), 'no choice id');
assert(!/prio\s*6/i.test(clean), 'no prio');
assert(!/offener wunsch/i.test(clean), 'no offener wunsch');

assert(humanizePlanTitle('✨ Prio 6 Hamburg erkunden') === 'Hamburg erkunden', 'title');

const speech = buildCompletePlanSpeech({
  destinationCity: 'Hamburg',
  fixedNodes: [],
  openWishesQueue: [
    {
      title: 'Anreise Hamburg',
      estimatedTime: '09:00',
      priority: 4,
      context: 'los',
    },
    {
      title: 'Mittagessen',
      estimatedTime: '12:30',
      priority: 5,
      context: 'essen',
    },
    {
      title: 'Hamburg erkunden',
      estimatedTime: '15:00',
      priority: 6,
      context: 'highlights',
    },
  ],
});
assert(/um 9 Uhr/i.test(speech), `time spoken: ${speech}`);
assert(/Mittagessen/i.test(speech), 'lunch in overview');
assert(/erkunden/i.test(speech), 'explore last-ish');
assert(!/prio/i.test(speech), 'overview has no prio');
assert(!/datensatz/i.test(speech), 'overview has no datensatz');
assert(/reihe nach/i.test(speech), 'then piece by piece');

const longSpeech = buildCompletePlanSpeech({
  destinationCity: 'Hamburg',
  fixedNodes: [],
  openWishesQueue: [
    { title: 'Bahn', estimatedTime: '09:00', priority: 4, context: 'los' },
    { title: 'Frühstück', estimatedTime: '10:00', priority: 4, context: 'ankunft' },
    { title: 'Elphi', estimatedTime: '11:00', priority: 5, context: 'elphi' },
    { title: 'Hafen', estimatedTime: '12:15', priority: 5, context: 'hafen' },
    { title: 'Essen', estimatedTime: '13:30', priority: 4, context: 'essen' },
    { title: 'Speicherstadt', estimatedTime: '15:00', priority: 5, context: 'speicher' },
    { title: 'Hamburg erkunden', estimatedTime: '16:30', priority: 6, context: 'highlights' },
  ],
});
assert(/Elphi/i.test(longSpeech), `elphi in overview: ${longSpeech}`);
assert(/Speicherstadt/i.test(longSpeech), `all named slots spoken: ${longSpeech}`);

console.log('planSpeechSanitize.smoke.test.ts ok');
