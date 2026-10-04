/**
 * Packlisten-Live-Durchgang Parser.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/packListWalk.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  looksLikePackWalkReply,
  looksLikePackWalkStart,
  matchWalkItem,
  missingSpeech,
  nextOpenIndex,
  packRemindSpeech,
  parsePackWalkTurn,
  type PackWalkItem,
} from './packListWalk';

assert.equal(looksLikePackWalkStart('Führ mich durch die Packliste'), true);
assert.equal(looksLikePackWalkReply('mach ich später'), true);
assert.equal(looksLikePackWalkReply('Was geht heute Abend?'), false);

assert.equal(parsePackWalkTurn('Geh wir die Packliste durch', { walking: false })?.type, 'start');
assert.equal(parsePackWalkTurn('mach ich später', { walking: false }), null);
assert.equal(parsePackWalkTurn('mach ich später', { walking: true })?.type, 'later');

const enough = parsePackWalkTurn('habe 3 Unterhosen, das langt auch', { walking: true });
assert.equal(enough?.type, 'enough');
if (enough?.type === 'enough') {
  assert.equal(enough.qty, 3);
  assert.match(enough.query || '', /unterhos/i);
}

const prio = parsePackWalkTurn(
  'Sonnenbrille ist wichtig, erinner mich dran',
  { walking: true },
);
assert.equal(prio?.type, 'priority');
if (prio?.type === 'priority') {
  assert.equal(prio.leadMin, 30);
  assert.match(prio.query || '', /sonnenbrille/i);
}

assert.equal(parsePackWalkTurn('was fehlt noch?', { walking: true })?.type, 'missing');

const items: PackWalkItem[] = [
  { id: '1', label: '8× Unterwäsche', done: false, qty: 8 },
  { id: '2', label: 'Sonnenbrille', done: false },
  { id: '3', label: 'Reisepass', done: true },
];
const hit = matchWalkItem(items, 'unterhosen', 0);
assert.equal(hit?.id, '1');
assert.equal(nextOpenIndex(items, 1), 1);

items[1]!.priority = 'high';
items[0]!.later = true;
const miss = missingSpeech(items);
assert.match(miss, /Sonnenbrille/);
assert.match(miss, /Unterwäsche|später/);

const speech = packRemindSpeech({
  itemLabel: 'Sonnenbrille',
  departLabel: 'deine Bahn',
  leadMin: 30,
});
assert.match(speech, /30 Minuten/);
assert.match(speech, /Bahn/);
assert.match(speech, /Sonnenbrille/);

console.log('packListWalk.smoke.test.ts OK');
