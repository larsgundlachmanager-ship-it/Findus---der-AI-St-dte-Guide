/**
 * Smoke: Hard-Pins — Los-Datum / Budget / Personen dürfen nicht wegrutschen.
 */
import assert from 'node:assert/strict';
import { parseBriefSlots } from '../parseBriefSlots';
import { cloneEmptyLedger, mergeLedger, entry } from '../slotLedger';
import {
  isDateHardPinned,
  resolvePinnedTravelWindow,
  pinnedAdults,
  budgetBreachEur,
  filterSlotsToHardPin,
  allowedCheckinKeys,
} from './hardPins';

{
  const p = parseBriefSlots('wollen am 16.10. los, zu viert, 400 Euro pro Person, fliegen ab Hamburg');
  const led = mergeLedger(cloneEmptyLedger(), p);
  assert.ok(led.dateStart?.value?.endsWith('-10-16'), `start ${led.dateStart?.value}`);
  assert.equal(isDateHardPinned(led), true, '16.10. los is hard pinned');
  assert.equal(pinnedAdults(led), 4, `adults ${pinnedAdults(led)}`);
  assert.equal(led.budgetEur?.value, 400, `budget ${led.budgetEur?.value}`);

  const base = {
    checkin: led.dateStart!.value,
    checkout: '2026-10-18',
  };
  const drifted = resolvePinnedTravelWindow(led, base, [
    {
      id: 'cheap',
      checkin: '2026-10-09',
      checkout: '2026-10-11',
      label: 'Deal Freitag',
      totalEur: 199,
      flightEur: 99,
      stayEur: 100,
      transferEur: null,
      dealHit: true,
    },
    {
      id: 'exact',
      checkin: '2026-10-16',
      checkout: '2026-10-18',
      label: 'Fix',
      totalEur: 320,
      flightEur: 120,
      stayEur: 200,
      transferEur: null,
      dealHit: false,
    },
  ]);
  assert.equal(drifted.checkin, '2026-10-16', `no drift got ${drifted.checkin}`);
  assert.equal(drifted.fromCombo, false, 'uses ledger base not cheap combo');

  const allowed = allowedCheckinKeys(led);
  assert.ok(allowed?.has('2026-10-16'), 'allowed contains pin');
  assert.ok(!allowed?.has('2026-10-09'), 'cheap friday not allowed');

  const filtered = filterSlotsToHardPin(led, [
    { checkin: '2026-10-09' },
    { checkin: '2026-10-16' },
  ]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.checkin, '2026-10-16');
}

{
  const led = mergeLedger(cloneEmptyLedger(), {
    dateStart: entry('2026-10-16', 'user', 'must'),
    dateFlex: entry('exact', 'user', 'must'),
    dateAnchor: entry('arrive', 'user', 'must'),
    adults: entry(4, 'user', 'must'),
    budgetEur: entry(400, 'user', 'must'),
    budgetScope: entry('per_person', 'user'),
  });
  assert.equal(budgetBreachEur(led, { buyInEur: 390, totalEur: 1560 }), 0);
  assert.ok((budgetBreachEur(led, { buyInEur: 520, totalEur: 2080 }) ?? 0) > 0, 'over budget');
}

{
  // Offenes Monat — darf kalendern
  const p = parseBriefSlots('irgendwann im Oktober irgendwo hin, zu zweit, 300 Euro');
  const led = mergeLedger(cloneEmptyLedger(), p);
  assert.equal(isDateHardPinned(led), false, 'open october not hard pinned');
}

{
  // Explizit flex ±1 → Pin bleibt, aber 15. und 17. erlaubt
  const led = mergeLedger(cloneEmptyLedger(), {
    dateStart: entry('2026-10-16', 'user', 'must'),
    dateEnd: entry('2026-10-20', 'user', 'must'),
    dateFlex: entry('exact', 'user'),
    dateAnchor: entry('span', 'user'),
    arrivalFlexDays: entry(1, 'user', 'wish'),
    departureFlexDays: entry(1, 'user', 'wish'),
  });
  assert.equal(isDateHardPinned(led), true);
  const allowed = allowedCheckinKeys(led)!;
  assert.ok(allowed.has('2026-10-16'));
  assert.ok(allowed.has('2026-10-15'), 'flex -1 allowed');
  assert.ok(!allowed.has('2026-10-09'), 'random friday still blocked');
}

console.log('hardPins.smoke: ok');
