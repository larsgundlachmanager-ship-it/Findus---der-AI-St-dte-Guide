/**
 * Run: npx tsx src/module2/pipeline/preserveFlightBookActions.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  isLockedFlightBookAction,
  mergePreserveFlightBookActions,
} from './preserveFlightBookActions';

const kiwi = {
  type: 'OPEN_URL' as const,
  label: 'Kiwi',
  payload: { url: 'https://www.kiwi.com/deep/search/abc' },
};

assert.equal(isLockedFlightBookAction(kiwi), true);

const stolen = [
  { type: 'SHOW_MORE' as const, label: 'Mehr', payload: { textPrompt: 'x' } },
];

const merged = mergePreserveFlightBookActions([kiwi], stolen, {
  userText: 'günstige Flüge nach Split',
});
assert.ok(merged.some((a) => isLockedFlightBookAction(a)), 'kiwi preserved');

console.log('preserveFlightBookActions.smoke.test.ts: ok');
