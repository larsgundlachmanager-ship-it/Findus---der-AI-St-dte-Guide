/**
 * Call-1 Antwort-Einstieg (Peek) — Alter/Trivia darf sofort Lead sprechen;
 * generische Bridge bleibt Call-1-LLM. Run: npx tsx src/services/speech/answerLeadBridge.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  peekAnswerLeadBridge,
  peekAnswerLeadBridgeOrCommit,
} from './answerLeadBridge';

assert.match(
  peekAnswerLeadBridge('Was ist 5 plus 5?') || '',
  /5 plus 5 (ist|ergibt)/i,
  'arith lead helper',
);
assert.match(
  peekAnswerLeadBridge('Wie alt ist Thomas Müller?') || '',
  /Thomas Müller ist/i,
  'age lead helper',
);
assert.equal(
  peekAnswerLeadBridge('Wie alt ist der Papst?'),
  'Der Papst ist',
  'papst age lead',
);
assert.equal(
  peekAnswerLeadBridge('Wie alt ist der Past Leo der 14?'),
  'Der Papst Leo der 14 ist',
  'past→papst leo lead',
);
assert.equal(
  peekAnswerLeadBridge('Was geht heute Abend?'),
  'Klar, ich schau was heute so geht',
  'events cover peek sofort',
);
assert.match(
  peekAnswerLeadBridge('Wie wird das Wetter morgen?') || '',
  /Wetter/i,
  'wetter peek sofort',
);
assert.equal(
  peekAnswerLeadBridge(
    'Such mir guenstige Fluege von Hamburg nach Split vom 27.3.2026 bis 10.4.2026 raus.',
  ),
  'Klar, ich schau deinen Flug nach',
  'solo flight peek beats plan',
);
assert.match(
  peekAnswerLeadBridgeOrCommit('Was geht heute Abend?'),
  /schau was heute so geht/i,
  'events peek auch im Commit-Helper',
);

assert.match(
  peekAnswerLeadBridge('Weck mich um 7 Uhr') || '',
  /stell ich/i,
  'clock peek sofort',
);
assert.match(
  peekAnswerLeadBridge('Trag Tennis um 18 Uhr in die Timeline') || '',
  /trag ich ein/i,
  'plan peek sofort',
);
assert.equal(
  peekAnswerLeadBridgeOrCommit('Erzähl mal was Schönes'),
  'Alles klar',
  'generischer Peek-Commit, nie Stille',
);

const turn = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
assert.match(turn, /peekAnswerLeadBridge/, 'Alter-Trivia Peek-Lead verdrahtet');
assert.match(turn, /Bridge push|speakBridgeFromAnalysis|speakModuleWaitBridge/, 'Call1 Bridge path');
assert.equal(
  /Sofort Commit/.test(turn),
  false,
  'kein Sofort-Commit statt LLM',
);

const ctx = readFileSync(
  join(process.cwd(), 'src/services/speech/contextualBridge.ts'),
  'utf8',
);
assert.match(ctx, /MIT DER ANTWORT ANFANGEN/, 'prompt answer-start');
assert.equal(
  /return peekAnswerLeadBridgeOrCommit\(/.test(ctx),
  false,
  'kein Peek-Fallback bei LLM-Fail',
);

console.log('answerLeadBridge.smoke: ok');
