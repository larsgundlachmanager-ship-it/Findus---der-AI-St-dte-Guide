/**
 * Smoke: Mic-Reopen nach Rückfrage nutzt Live-Chat (Endpointing),
 * kein Locked-Hands-Free-Fallback.
 * Run: npx --yes tsx src/services/handsFree/scheduleMicAfterAsk.smoke.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cancelScheduledMicAfterAsk,
  scheduleMicAfterDirectAsk,
  abortListenSessionForUiChoice,
} from './scheduleMicAfterAsk';

cancelScheduledMicAfterAsk();
scheduleMicAfterDirectAsk({ ignoreGenerating: true });
cancelScheduledMicAfterAsk();

assert.equal(typeof scheduleMicAfterDirectAsk, 'function');
assert.equal(typeof cancelScheduledMicAfterAsk, 'function');
assert.equal(typeof abortListenSessionForUiChoice, 'function');

const src = readFileSync(
  join(__dirname, 'scheduleMicAfterAsk.ts'),
  'utf8',
);
assert.ok(
  !/requestHandsFreeListen/.test(src),
  'direct_ask must not fall back to locked hands-free',
);
assert.ok(
  /startLiveChatSession\('direct_ask'\)/.test(src),
  'must start live chat with endpointing',
);

void abortListenSessionForUiChoice('smoke').then(() => {
  console.log('scheduleMicAfterAsk.smoke.test.ts OK');
});
