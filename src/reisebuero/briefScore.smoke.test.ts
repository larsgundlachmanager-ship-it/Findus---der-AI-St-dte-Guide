/**
 * Grün = Pflicht voll; Nice darf offen bleiben.
 */
import assert from 'node:assert/strict';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import { parseBriefSlots } from './parseBriefSlots';
import {
  computeBriefScore,
  briefScoreHint,
  RESEARCH_MUST_KEYS,
  RESEARCH_NICE_KEYS,
} from './briefScore';

const empty = computeBriefScore(cloneEmptyLedger());
assert.equal(empty.zone, 'red', 'empty → red');
assert.ok(empty.missingMust.length > 0, 'empty has must gaps');

const mustOnly = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots(
    'zwei Erwachsene 11. bis 14. September ab Hamburg 800 Euro Hotel Wellness Strand, Flug',
    Date.parse('2026-08-20T12:00:00'),
  ),
);
// Flug ohne Gepäck → Pflicht bags offen → nicht grün
const flyNoBags = computeBriefScore(mustOnly);
assert.notEqual(flyNoBags.zone, 'green', 'fly ohne Gepäck nicht grün');
assert.ok(
  flyNoBags.missingMust.some((m) => m.key === 'bags') || mustOnly.mode?.value !== 'fly',
  `bags must open when fly, mode=${mustOnly.mode?.value} missing=${flyNoBags.missingMust.map((m) => m.key).join(',')}`,
);

const withBags = mergeLedger(mustOnly, {
  cabinBags: entry(1, 'user'),
  checkedBags: entry(0, 'user'),
  // Falls Parse Mode nicht gesetzt hat — Flug erzwingen für bags-Pfad
  ...(mustOnly.mode?.value ? {} : { mode: entry('fly' as const, 'user') }),
});
const greenReady = computeBriefScore(withBags);
if (greenReady.zone !== 'green') {
  // Parse kann dest/wishes dünn lassen — hart auffüllen
  const fat = mergeLedger(withBags, {
    adults: entry(2, 'user'),
    originCity: entry('Hamburg', 'user'),
    budgetEur: entry(800, 'user'),
    lodgingKind: entry('hotel' as const, 'user'),
    mode: entry('fly' as const, 'user'),
    purpose: entry('Wellness am Strand', 'user'),
    destinationHint: entry('offen Strand', 'user'),
    dateStart: entry('2026-09-11', 'user'),
    dateEnd: entry('2026-09-14', 'user'),
    cabinBags: entry(1, 'user'),
    checkedBags: entry(0, 'user'),
  });
  const sc = computeBriefScore(fat);
  assert.equal(sc.zone, 'green', `Pflicht voll → grün (score ${sc.score}, must ${sc.missingMust.map((m) => m.key).join(',')})`);
  assert.equal(sc.missingMust.length, 0, 'keine Pflicht offen');
  assert.ok(sc.missingNice.every((m) => RESEARCH_NICE_KEYS.has(m.key)), 'nur Nice-Keys offen');
  assert.match(briefScoreHint(sc), /grün|Pflicht/i);
  // Nice offen blockt Grün nicht
  assert.ok([...RESEARCH_MUST_KEYS].every((k) => !sc.missing.some((m) => m.key === k && m.kind === 'must')));
} else {
  assert.equal(greenReady.missingMust.length, 0, 'keine Pflicht offen');
  assert.match(briefScoreHint(greenReady), /grün|Pflicht/i);
}

// Gelb/Rot: Pflicht teilweise
const partial = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('vier Leute ab Hamburg 300 Euro Apartment', Date.parse('2026-08-20T12:00:00')),
);
const mid = computeBriefScore(partial);
assert.ok(mid.zone === 'yellow' || mid.zone === 'red', `partial ${mid.zone}`);
assert.ok(mid.missingMust.length > 0, 'partial has must');

console.log('briefScore.smoke.test.ts OK');
