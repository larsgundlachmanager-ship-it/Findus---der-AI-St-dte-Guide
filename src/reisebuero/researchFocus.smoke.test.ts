/**
 * Fast-Scope researchFocus — Parse, Gaps, Score, Search-Flags.
 */
import assert from 'node:assert/strict';
import { parseBriefSlots } from './parseBriefSlots';
import { mergeLedger, cloneEmptyLedger, entry } from './slotLedger';
import {
  detectResearchFocus,
  effectiveResearchFocus,
  deriveInventoryMode,
  searchFlightLive,
  searchStayLive,
  searchActivityOnly,
} from './gapInventory';
import { bookingBriefGaps } from './completeness';
import { computeBriefScore } from './briefScore';
import { buildFlipchartNotes } from './flipchartNotes';

function led(text: string) {
  return mergeLedger(cloneEmptyLedger(), parseBriefSlots(text));
}

assert.equal(detectResearchFocus('Nur Flüge nach Prag dieses Wochenende'), 'flight');
assert.equal(detectResearchFocus('Nur Hotel in Lissabon, 3 Nächte'), 'stay');
assert.equal(detectResearchFocus('Nur Aktivitäten und Ausflüge in Rom'), 'activity');
assert.equal(
  detectResearchFocus(
    'Ich brauche einen Flieger vom 27. März bis zum 10. April. Such mir einen Flug von Hamburg nach Split raus.',
  ),
  'flight',
  'HAM→Split date window → flight focus',
);


{
  const a = led('Nur Flüge nach Prag, zu zweit, nächstes Wochenende, ab Hamburg');
  assert.equal(a.researchFocus?.value, 'flight', 'focus flight');
  assert.equal(effectiveResearchFocus(a), 'flight');
  assert.equal(deriveInventoryMode(a), 'gap_fill');
  assert.equal(searchFlightLive(a), true, 'flight live');
  assert.equal(searchStayLive(a), false, 'no stay live on flight focus');
  assert.ok(!a.bookedStay?.value, 'no silent bookedStay hack');
  const gaps = bookingBriefGaps(a).map((g) => g.key);
  assert.ok(!gaps.includes('lodging'), 'no lodging gap on flight focus');
  assert.ok(!gaps.includes('mode') || a.mode?.value === 'fly', 'mode not blocking lodging');
}

{
  const b = led('Nur Hotel in Lissabon, 2 Personen, Oktober');
  assert.equal(effectiveResearchFocus(b), 'stay');
  assert.equal(searchStayLive(b), true);
  assert.equal(searchFlightLive(b), false);
  const gaps = bookingBriefGaps(b).map((g) => g.key);
  assert.ok(!gaps.includes('bags'), 'no bags on stay focus');
}

{
  const c = led('Nur Ausflüge und Events in Barcelona, Wochenende, zu zweit');
  assert.equal(effectiveResearchFocus(c), 'activity');
  assert.equal(searchActivityOnly(c), true);
  assert.equal(searchStayLive(c), false);
  assert.equal(searchFlightLive(c), false);
}

{
  // Minimal brief + focus flight → score may be yellow/green without lodging/wishes
  const base = cloneEmptyLedger();
  const L = mergeLedger(base, {
    researchFocus: entry('flight', 'user', 'wish'),
    adults: entry(2, 'user', 'must'),
    dateStart: entry('2026-10-10', 'user', 'must'),
    originCity: entry('Hamburg', 'user', 'must'),
    destinationHint: entry('Split', 'user', 'wish'),
    mode: entry('fly', 'user', 'wish'),
    cabinBags: entry(1, 'user', 'wish'),
    checkedBags: entry(0, 'user', 'wish'),
    budgetVibe: entry('cheap', 'user', 'wish'),
  } as never);
  const score = computeBriefScore(L);
  assert.equal(score.missingMust.filter((m) => m.key === 'lodging').length, 0, 'lodging not must');
  assert.equal(score.missingMust.filter((m) => m.key === 'wishes').length, 0, 'wishes not must');
  assert.ok(score.zone === 'green' || score.zone === 'yellow', `zone ${score.zone}`);
  const notes = buildFlipchartNotes(L);
  assert.ok(
    notes.some((n) => /nur Flüge|Schnell: nur Flüge/i.test(n.label)),
    'flipchart scope sticker',
  );
}

console.log('researchFocus.smoke.test.ts: ok');
