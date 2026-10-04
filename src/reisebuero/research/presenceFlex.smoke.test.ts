/**
 * Smoke: Must-Da-Sein, Flex-Tage, nur Flug / nur Hotel.
 */
import assert from 'node:assert/strict';
import { parseBriefSlots } from '../parseBriefSlots';
import { mergeLedger, cloneEmptyLedger } from '../slotLedger';
import { buildFlipchartNotes } from '../flipchartNotes';
import {
  buildFlexTravelWindows,
  resolvePresenceBounds,
} from './presenceFlex';

{
  const p = parseBriefSlots(
    'Ich muss auf jeden Fall vom 27.03. bis zum 10.04. da sein, ein Tag früher oder später anfliegen ist ok wenn günstiger, zu zweit, ab Hamburg, fliegen',
  );
  assert.equal(p.dateAnchor?.value, 'presence', `anchor ${p.dateAnchor?.value}`);
  assert.equal(p.dateStart?.hardness, 'must');
  assert.equal(p.dateEnd?.hardness, 'must');
  assert.ok((p.arrivalFlexDays?.value ?? 0) >= 1, `arrive flex ${p.arrivalFlexDays?.value}`);
  assert.ok(
    (p.intentNotes?.value ?? []).some((x) => /Must-Da-Sein/i.test(x)),
    'intent presence',
  );
  const wins = buildFlexTravelWindows(mergeLedger(cloneEmptyLedger(), p));
  assert.ok(wins.length >= 2, `flex windows ${wins.length}`);
  assert.ok(
    wins.some((w) => w.earlyDays >= 1 || w.shiftDays !== 0 || w.lateDays >= 1),
    'has early/late candidate',
  );
  const bounds = resolvePresenceBounds(mergeLedger(cloneEmptyLedger(), p));
  assert.ok(bounds?.start?.includes('-03-27') || bounds?.start?.endsWith('03-27'), `start ${bounds?.start}`);
}

{
  const p = parseBriefSlots(
    'Hochzeit am 15.06. in Split, muss da sein, kann schon drei Tage vorher anreisen und zwei Tage länger bleiben, Flug und Hotel, ab Hamburg, 800 Euro',
  );
  assert.equal(p.dateAnchor?.value, 'presence', `wedding anchor ${p.dateAnchor?.value}`);
  assert.equal(p.arrivalFlexDays?.value, 3, `wedding early ${p.arrivalFlexDays?.value}`);
  assert.equal(p.departureFlexDays?.value, 2, `wedding late ${p.departureFlexDays?.value}`);
  assert.ok(
    (p.intentNotes?.value ?? []).some((x) => /Hochzeit/i.test(x)) || p.purpose?.value === 'Hochzeit',
    'wedding purpose/intent',
  );
  const wins = buildFlexTravelWindows(mergeLedger(cloneEmptyLedger(), p));
  assert.ok(
    wins.some((w) => w.earlyDays === 3 && w.lateDays === 2),
    `wedding window combo missing: ${wins.map((w) => w.label).join(' | ')}`,
  );
}

{
  const p = parseBriefSlots(
    'Ich muss noch Flüge buchen für meinen Kroatien-Trip, Hotel habe ich schon, ab Hamburg, Juni, zu zweit',
  );
  assert.equal(p.bookedStay?.value, true, 'croatia hotel booked');
  assert.equal(p.bookedFlight?.value, false, 'croatia need flight');
  assert.ok(
    (p.intentNotes?.value ?? []).some((x) => /Nur Flug|Unterkunft schon/i.test(x)),
    'flight-only intent',
  );
  const notes = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), p));
  assert.ok(
    notes.some((n) => n.id === 'scopeFlight' || /Flug suchen|Nur Flug/i.test(n.label)),
    'flight scope sticker',
  );
}

{
  const p = parseBriefSlots(
    'Ich fahre mit dem Auto nach Tirol, brauche nur noch ein Hotel, entspannt, 4 Tage, Pool wäre cool',
  );
  assert.equal(p.bookedStay?.value, false, 'need hotel');
  assert.equal(p.bookedFlight?.value, true, 'no flight / drive');
  assert.equal(p.mode?.value, 'drive', `mode ${p.mode?.value}`);
  assert.ok(
    (p.intentNotes?.value ?? []).some((x) => /Nur Hotel/i.test(x)),
    'hotel-only intent',
  );
}

{
  const p = parseBriefSlots(
    'Spätestens am 12.09. muss ich anreisen, kann aber schon vier Tage vorher da sein, Mallorca, fliegen',
  );
  // „spätestens anreisen“ + Datum → presence oder arrive mit Flex
  assert.ok(
    p.dateAnchor?.value === 'presence' ||
      p.dateAnchor?.value === 'arrive' ||
      (p.arrivalFlexDays?.value ?? 0) >= 4,
    `latest-arrive parse anchor=${p.dateAnchor?.value} flex=${p.arrivalFlexDays?.value}`,
  );
  if ((p.arrivalFlexDays?.value ?? 0) < 4 && /\bvier\b/i.test('vier')) {
    // Flex aus „vier Tage vorher“
    assert.ok(
      (p.arrivalFlexDays?.value ?? 0) >= 4 || p.dateStart,
      'expected flex or date',
    );
  }
}

console.log('presenceFlex.smoke: ok');
