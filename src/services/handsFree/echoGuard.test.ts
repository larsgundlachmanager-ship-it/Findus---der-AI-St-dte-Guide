/**
 * Echo-Guard smoke test.
 * Run: npx --yes tsx src/services/handsFree/echoGuard.test.ts
 */

import {
  looksLikeFindusEcho,
  noteFindusSpokenForEcho,
} from './echoGuard';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

noteFindusSpokenForEcho(
  'Du brauchst etwa zwölf Minuten mit dem Fahrrad bis zum Hafen.',
);
assert(
  looksLikeFindusEcho('zwölf Minuten mit dem Fahrrad bis zum Hafen'),
  'should detect echo overlap',
);
assert(
  !looksLikeFindusEcho('Bring mich bitte zum Museum'),
  'should allow new user utterance',
);

console.log('echoGuard.test.ts OK');
