import assert from 'node:assert/strict';
import {
  buildLiveSubtitlePlan,
  subtitleAtProgress,
  subtitleFeedAdvance,
  subtitleUpToCharIndex,
} from './subtitleWholeWords';

const grow = subtitleFeedAdvance(['Hallo'], ['Hallo', 'Lars']);
assert.deepEqual(grow.pending, ['Lars']);
assert.equal(grow.reset, false);

const jitter = subtitleFeedAdvance(
  ['Hallo', 'Lars', 'heute'],
  ['Hallo', 'Lars'],
);
assert.deepEqual(jitter.pending, []);
assert.equal(jitter.reset, false);

const nextTurn = subtitleFeedAdvance(
  ['Hallo', 'Lars', 'heute', 'ist', 'schönes', 'Wetter', 'hier'],
  ['Ich'],
);
assert.deepEqual(nextTurn.pending, ['Ich']);
assert.equal(nextTurn.reset, true);

const fresh = subtitleFeedAdvance([], ['Klar,', 'machen', 'wir.']);
assert.deepEqual(fresh.pending, ['Klar,', 'machen', 'wir.']);
assert.equal(fresh.reset, false);

const plan = buildLiveSubtitlePlan('Im Hafengeburtstag weht Wind');
assert.equal(subtitleAtProgress(plan, 0, 2600), 'Im');
assert.equal(subtitleAtProgress(plan, 0.5, 2600), 'Im Hafengeburtstag');
assert.equal(subtitleAtProgress(plan, 1, 2600), 'Im Hafengeburtstag weht Wind');
assert.equal(subtitleUpToCharIndex('Hallo Lars heute', 0), 'Hallo');
assert.equal(subtitleUpToCharIndex('Hallo Lars heute', 6), 'Hallo Lars');

console.log('[ok] subtitleFeedAdvance grow/jitter/new-turn');
console.log('[ok] subtitleAtProgress char-weighted 1:1');
