/**
 * Cruise ship-fit smokes (ohne Netz).
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/research/cruiseShipFit.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { parseBriefSlots } from '../parseBriefSlots';
import { cloneEmptyLedger, mergeLedger, entry } from '../slotLedger';
import {
  extractCruiseShipName,
  looksLikeCruiseShipFitAsk,
  matchCruiseShips,
  matchCruiseShipsFromLedger,
  weaveCruiseShipFitRecommendAsk,
} from './cruiseShipFit';
import { buildCruiseQuickPitchFromText } from '../../module2/planning/cruiseQuickPitch';
import { buildCruiseSearchBrief } from './cruiseSearch';

assert.equal(extractCruiseShipName('Wir wollen Mein Schiff 3'), 'Mein Schiff 3');
assert.equal(extractCruiseShipName('lieber Mein Schiff 7 ab Kiel'), 'Mein Schiff 7');
assert.notEqual(
  extractCruiseShipName('Mein Schiff 3'),
  extractCruiseShipName('Mein Schiff 7'),
);

assert.equal(
  looksLikeCruiseShipFitAsk('Kreuzfahrt mit Pool und Wasserrutsche für Kinder'),
  true,
);
assert.equal(
  looksLikeCruiseShipFitAsk('AIDA Schiff mit Laufbahn und Sauna für Party'),
  true,
);
assert.equal(looksLikeCruiseShipFitAsk('Was kostet ein Hotel?'), false);

{
  const family = matchCruiseShips({
    wants: ['pool', 'water_slide', 'kids_club'],
    audiences: ['kids'],
    limit: 2,
  });
  assert.ok(family.fits.length >= 1, 'family fit');
  assert.ok(
    /aida|mein schiff/i.test(family.fits[0]!.ship.name),
    'named ship',
  );
  assert.ok(family.fits[0]!.matched.includes('water_slide') || family.fits[0]!.matched.includes('pool'));
}

{
  const seniors = matchCruiseShips({
    wants: ['seniors', 'quiet', 'spa'],
    audiences: ['seniors'],
    lineBias: 'mein_schiff',
    limit: 2,
  });
  assert.ok(seniors.fits.length >= 1);
  assert.equal(seniors.fits[0]!.ship.line, 'mein_schiff');
  assert.ok(/mein schiff/i.test(seniors.fits[0]!.ship.name));
}

{
  const party = matchCruiseShips({
    wants: ['party', 'pool'],
    audiences: ['party'],
    lineBias: 'aida',
    limit: 1,
  });
  assert.ok(party.fits[0]?.ship.line === 'aida');
}

{
  const patch = parseBriefSlots(
    'Kreuzfahrt mit Rutsche, Pool, Laufbahn — für Teens und Party',
  );
  assert.ok(patch.wishHaves?.value?.includes('water_slide') || patch.mustHaves?.value?.includes('water_slide'));
  assert.ok(
    [...(patch.wishHaves?.value ?? []), ...(patch.mustHaves?.value ?? [])].includes(
      'running_track',
    ) ||
      [...(patch.wishHaves?.value ?? []), ...(patch.mustHaves?.value ?? [])].includes('teens_club') ||
      [...(patch.wishHaves?.value ?? []), ...(patch.mustHaves?.value ?? [])].includes('party'),
  );
  const led = mergeLedger(cloneEmptyLedger(), patch);
  const fit = matchCruiseShipsFromLedger(led, {
    userText: 'Kreuzfahrt mit Rutsche, Pool, Laufbahn — für Teens und Party',
  });
  assert.ok(fit.fits.length >= 1, 'ledger fit');
}

{
  const pitch = buildCruiseQuickPitchFromText(
    'AIDA mit Pool und Rutsche für Kinder',
  );
  assert.ok(pitch, 'pitch');
  assert.ok(pitch!.shipNames && pitch!.shipNames.length >= 1, 'ship names');
  assert.match(pitch!.speech, /AIDA|Mein Schiff|passt/i);
}

{
  const rentner = buildCruiseQuickPitchFromText(
    'Mein Schiff ruhig für Rentner mit Sauna',
  );
  assert.ok(rentner);
  assert.ok(rentner!.shipNames?.some((n) => /Mein Schiff/i.test(n)));
}

{
  const named = mergeLedger(cloneEmptyLedger(), {
    tripShape: entry('cruise', 'user', 'must'),
    cruiseShipName: entry('Mein Schiff 3', 'user', 'must'),
  });
  const fit3 = matchCruiseShipsFromLedger(named, { userText: 'Mein Schiff 3' });
  assert.equal(fit3.fits[0]?.ship.name, 'Mein Schiff 3');
  assert.match(buildCruiseSearchBrief(named).query, /Mein Schiff 3/);
}

{
  const led = mergeLedger(cloneEmptyLedger(), {
    tripShape: entry('cruise', 'user', 'must'),
    wishHaves: entry(['pool', 'water_slide', 'kids_club'], 'user', 'wish'),
  });
  const fit = matchCruiseShipsFromLedger(led, {
    userText: 'Kreuzfahrt Pool Rutsche für Kinder',
  });
  const ask = weaveCruiseShipFitRecommendAsk(fit);
  assert.ok(ask);
  assert.match(ask!, /passen|AIDA|Mein Schiff/i);
  assert.match(ask!, /Welches|Schiff/i);
}

console.log('cruiseShipFit.smoke.test.ts OK');
