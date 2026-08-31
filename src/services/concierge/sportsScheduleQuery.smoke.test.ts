/**
 * Genannter Spielplan — Struktur, keine Team-Liste.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/sportsScheduleQuery.smoke.test.ts
 */

import {
  looksLikeNamedScheduleQuery,
  isSportsScheduleQuery,
} from './sportsScheduleQuery';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  looksLikeNamedScheduleQuery(
    'Wann spielen die Hamburg Towers in der Ballsporthalle?',
  ),
  'towers schedule',
);
assert(
  looksLikeNamedScheduleQuery(
    'wann spielt eigentlich hier FC Bayern München wieder?',
  ),
  'bayern schedule structural',
);
assert(
  looksLikeNamedScheduleQuery('Wann spielen die Towers in der Badcathedrale?'),
  'stt venue still schedule',
);
assert(
  !looksLikeNamedScheduleQuery('Was geht heute Abend in Prisdorf?'),
  'nightlife not named schedule',
);
assert(!looksLikeNamedScheduleQuery('Wie alt ist der Papst?'), 'trivia no');
assert(
  isSportsScheduleQuery('Wann spielt Alba Berlin das nächste Heimspiel?'),
  'alias ok',
);

// Cover-Floskeln für genannte Termine (Library — Engine zieht RN und ist hier nicht nötig)
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lib = require('../../assets/data/floskelLibrary.json') as {
    categories: Record<string, { phrases: string[] }>;
  };
  const phrases = lib.categories.named_schedule?.phrases ?? [];
  assert(phrases.length >= 4, 'named_schedule floskel pool');
  assert(
    phrases.every((p) => !/gute\s+richtung|tolle\s+idee|sport-idee/i.test(p)),
    'no pitch-opener phrases in named_schedule',
  );
}

console.log('sportsScheduleQuery.smoke.test.ts OK');
