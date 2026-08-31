/**
 * Smoke: Phase-2 Ramble-Splitter (ohne RN-Import-Kette).
 */
import assert from 'node:assert/strict';
import { splitRambleIntents } from './splitRambleIntents';

const ramble = splitRambleIntents(
  'Also wir haben richtig Hunger und dann will ich noch die Altstadt sehen und irgendwann zurück zum Hotel',
);
assert.ok(ramble.length >= 2, `ramble should split, got ${ramble.length}`);

const short = splitRambleIntents('Wo essen?');
assert.equal(short.length, 0, 'short ask stays manager-only');

console.log('luebeckGluecksplan.smoke.test.ts OK');
