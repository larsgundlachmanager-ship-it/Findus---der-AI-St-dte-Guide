/**
 * P5: package/messe handoff beats solo flight.
 * Run: npx tsx src/reisebuero/handoffPackage.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { isFindusReisebueroHandoff } from './handoff';
import { shouldAskTransferBlocker } from './funnelBlockerAsk';
import { cloneEmptyLedger, mergeLedger } from './slotLedger';
import { parseBriefSlots } from './parseBriefSlots';
import { wireReisebueroTaxiPrefill } from './research/taxiPrefillWire';
import type { ReiseOption } from './types';

assert.equal(
  isFindusReisebueroHandoff('Flug und Hotel nach Barcelona für fünf Tage'),
  true,
  'stay+days package',
);
assert.equal(
  isFindusReisebueroHandoff('Zur Buchmesse nach Frankfurt, Flug und Hotel, vier Tage'),
  true,
  'messe package',
);
assert.equal(
  isFindusReisebueroHandoff(
    'Such mir guenstige Fluege von Hamburg nach Split vom 27.3.2026 bis 10.4.2026 raus.',
  ),
  false,
  'solo AB still flight',
);

{
  const led = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('Wochenende Barcelona mit Flug, Hotel zwei Nächte'),
  );
  assert.equal(shouldAskTransferBlocker(led), true, 'transfer blocker for package');
}

{
  const opt: ReiseOption = {
    id: 'x',
    title: 'Frankfurt Messe',
    placeName: 'Frankfurt',
    matchScore: 80,
    pricePerPerson: 400,
    gaps: [],
    facts: [],
    decisionNotes: [],
    lat: 50.1,
    lng: 8.68,
    transferBookUrl: 'https://www.google.com/maps/dir/?api=1&destination=50,8',
    transports: [
      {
        id: 'f1',
        kind: 'flight',
        label: 'Hin',
        departAt: '2026-09-18T13:40:00',
        arriveAt: '2026-09-18T15:20:00',
        priceEur: 90,
        bookUrl: 'https://example.com/fly',
        better: true,
        departDateKey: '2026-09-18',
      },
    ],
  };
  const led = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Taxi vom Flughafen, Messe Frankfurt'));
  led.transferPref = { value: 'taxi', source: 'user', hardness: 'soft' };
  const wired = wireReisebueroTaxiPrefill(opt, led);
  assert.ok(wired.transferBookUrl, 'taxi wire keeps or upgrades url');
  // Affiliate optional: wenn Travelpayouts da → neuer Link; sonst Maps bleibt
  if (wired.transferBookUrl !== opt.transferBookUrl) {
    assert.match(
      wired.transferBookUrl || '',
      /uber|welcome|gettransfer|kiwi|tpx|travelpayouts/i,
    );
  }
}

console.log('handoffPackage.smoke.test.ts: ok');
