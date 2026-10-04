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
  null,
  'generic → null',
);
assert.match(
  peekAnswerLeadBridgeOrCommit('Was geht heute Abend?'),
  /Kurz nachgeschaut/i,
  'commit helper existiert (nicht für TTS-Beat-1)',
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
