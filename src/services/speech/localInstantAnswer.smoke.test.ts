/**
 * Instant Call-1 / Schnellfragen.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/speech/localInstantAnswer.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  tryLocalMathAnswer,
  isInstantFastAsk,
} from './localInstantAnswer';
import { peekAnswerLeadBridge } from './answerLeadBridge';

const arith = tryLocalMathAnswer('Was ist 5 plus 5?');
assert.ok(arith);
assert.match(arith!.lead, /^(5 plus 5 ist|Das Ergebnis ist)$/i);
assert.equal(arith!.speech, '10');

const chain = tryLocalMathAnswer('Was ist 5 plus 5 plus 5?');
assert.ok(chain, 'chain 5+5+5');
assert.equal(chain!.lead, 'Das Ergebnis ist', 'long chain lead');
assert.equal(chain!.speech, '15');

const mixed = tryLocalMathAnswer('Rechne 10 mal 3 minus 2');
assert.ok(mixed, '10*3-2');
assert.equal(mixed!.lead, 'Das Ergebnis ist');
assert.equal(mixed!.speech, '28', 'precedence * before -');

const many = tryLocalMathAnswer('Was ist 1 plus 2 plus 3 plus 4 plus 5?');
assert.ok(many);
assert.equal(many!.speech, '15');
assert.equal(many!.lead, 'Das Ergebnis ist');

const turnSrc = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
assert.match(turnSrc, /localArithEarly/, 'early local math before analyze');
assert.match(
  turnSrc,
  /Instant-Rechnung: Lead sofort/,
  'math skips LLM bridge wait',
);

assert.match(
  peekAnswerLeadBridge('Wie alt ist Manuel Neuer?') || '',
  /Manuel Neuer ist/i,
);
assert.match(
  peekAnswerLeadBridge('Was ist 5 Dollar in Euro?') || '',
  /5 Dollar in Euro sind/i,
);
assert.ok(isInstantFastAsk('Wie alt ist Thomas Müller?'));

const { scrubMetaPraiseBridge } = require('../../module2/chat/bridgeGlue') as {
  scrubMetaPraiseBridge: (o: {
    bridge: string;
    userText: string;
  }) => string | null;
};
const scrubbed = scrubMetaPraiseBridge({
  bridge: 'Das Alter von Manuel Neuer ist auf jeden Fall eine spannende Frage.',
  userText: 'Wie alt ist Manuel Neuer?',
});
assert.equal(scrubbed, null, 'Meta-Lob verwerfen — kein Code-Ersatz');

const turn = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
assert.match(turn, /tryLocalMathAnswer/, 'local arith wired');
assert.match(turn, /scrubMetaPraiseBridge/, 'meta scrub in speak');
assert.match(turn, /Call-1 Bridge 1:1|Call-1-LLM-Bridge/, 'Bridge = Call-1');
assert.doesNotMatch(turn, /Instant-Lead gehört Peek/, 'kein Peek-Skip');
const voice = readFileSync(
  join(process.cwd(), 'src/hooks/useVoiceInput.ts'),
  'utf8',
);
assert.doesNotMatch(voice, /Hab dich nicht verstanden/, 'empty mic silent');
assert.match(voice, /MIN_VOICE_MS = 700/, 'fast hold');

assert.equal(tryLocalMathAnswer('18 Uhr'), null, '18 Uhr ist keine Rechnung');
assert.equal(tryLocalMathAnswer('um 18 Uhr nach London'), null, 'Flugzeit keine Rechnung');
assert.equal(tryLocalMathAnswer('13-18 Grad'), null, 'Temperaturspanne keine Rechnung');
assert.equal(tryLocalMathAnswer('18:00'), null, 'Uhrzeit mit Doppelpunkt keine Rechnung');
assert.ok(tryLocalMathAnswer('Was ist 18 plus 3?'), 'echte Rechnung bleibt');

console.log('localInstantAnswer.smoke: ok');
