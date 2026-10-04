/**
 * Instant fact format — Space + Alter-Bullets.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/chat/instantFactFormat.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureLetterDigitSpaces,
  joinAnswerLeadContinuation,
  normalizeTriviaFactBullets,
} from './instantFactFormat';

assert.equal(ensureLetterDigitSpaces('ist40 Jahre'), 'ist 40 Jahre');
assert.equal(ensureLetterDigitSpaces('ergibt10'), 'ergibt 10');
assert.equal(
  joinAnswerLeadContinuation('Manuel Neuer ist', '40 Jahre alt.'),
  'Manuel Neuer ist 40 Jahre alt.',
);
assert.equal(
  joinAnswerLeadContinuation('5 plus 5 ergibt', '10'),
  '5 plus 5 ergibt 10',
);

const ageBullets = normalizeTriviaFactBullets({
  userText: 'Wie alt ist Manuel Neuer?',
  speech: '40 Jahre alt.',
  bullets: [
    '40 Jahre alt (geboren am 27. März 1986)',
    '40 Jahre',
  ],
});
assert.deepEqual(ageBullets, [
  '40 Jahre alt',
  'geboren am: 27. März 1986',
]);

assert.deepEqual(
  normalizeTriviaFactBullets({
    userText: 'Wie alt ist der Past Leo der 14?',
    speech: '70 Jahre alt.',
    bullets: [
      '70 Jahre alt',
      'geboren am 14. September 1955 in Chicago',
      'Erster US-amerikanischer Papst',
    ],
  }),
  [
    '70 Jahre alt',
    'geboren am: 14. September 1955 in Chicago',
    'Erster US-amerikanischer Papst',
  ],
);

const mathBullets = normalizeTriviaFactBullets({
  userText: 'Was ist 5 plus 5?',
  speech: '10',
  bullets: ['5 plus 5 = 10'],
});
assert.deepEqual(mathBullets, ['Ergebnis: 10']);

const areaBullets = normalizeTriviaFactBullets({
  userText: 'Wie groß ist die Alster?',
  speech: 'Die Außenalster hat rund 1,6 km².',
  bullets: [],
});
assert.deepEqual(areaBullets, ['Außenalster: 1,6 km²']);

assert.deepEqual(
  normalizeTriviaFactBullets({
    userText: 'Wie groß ist die Alster?',
    speech: 'Die Alster misst etwa 1,6 km².',
    bullets: [],
  }),
  ['1,6 km²'],
);

assert.deepEqual(
  normalizeTriviaFactBullets({
    userText: 'Wie groß ist die Alster?',
    speech:
      'Die Außenalster hat rund 1,6 km², die Binnenalster etwa 18 Hektar.',
    bullets: [],
  }),
  ['Außenalster: 1,6 km²', 'Binnenalster: 18 ha'],
);

const tennisBullets = normalizeTriviaFactBullets({
  userText: 'Wie groß ist ein Tennisplatz?',
  speech:
    'Ein Tennisplatz misst im Doppelfeld 23,77 mal 10,97 Meter, im Einzelfeld 23,77 mal 8,23 Meter.',
  bullets: ['Größe eines Tennisplatzes'],
});
assert.equal(tennisBullets[0], 'Doppelfeld: 23,77×10,97 m');
assert.equal(tennisBullets[1], 'Einzelfeld: 23,77×8,23 m');
assert.ok(!tennisBullets.some((b) => /größe eines tennisplatz/i.test(b)));

const avs = readFileSync(
  join(process.cwd(), 'src/services/AudioVoiceService.ts'),
  'utf8',
);
assert.match(avs, /Call-1 Lead \+ Call-2 Zahl/, 'display letter-digit space');

const turn = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
assert.match(turn, /localArithEarly|Sofort Commit/, 'Beat-1 / early local math');
assert.match(turn, /tryLocalMathAnswer/, 'local math');
assert.match(turn, /Aktivität ohne Pack-Treffer|needsResearch: 'deep'/, 'm1 web');

console.log('instantFactFormat.smoke: ok');
