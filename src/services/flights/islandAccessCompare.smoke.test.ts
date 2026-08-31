/**
 * Sprint 4 — Wangerooge Fähre vs. Flug + Flug→Taxi Detect.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/flights/islandAccessCompare.smoke.test.ts
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  const {
    detectIslandAccessIntent,
    wantsIslandAccessCompare,
    isWangeroogeIslandAccessQuery,
    buildIslandAccessComparePayload,
    prepareIslandAccessFollowUp,
    ISLAND_FLIGHT_TARIFF_AB,
  } = require('./islandAccessCompare') as typeof import('./islandAccessCompare');

  const { wantsFlightTaxiAccess } = require('./flightTripIntent') as typeof import('./flightTripIntent');

  assert(isWangeroogeIslandAccessQuery('Wie komme ich nach Wangerooge?'), 'island query');
  assert(!isWangeroogeIslandAccessQuery('Wetter in Hamburg?'), 'not island');

  assert(detectIslandAccessIntent('Wie komme ich nach Wangerooge?') === 'compare', 'wie komme');
  assert(detectIslandAccessIntent('Fähre oder Flug nach Wangerooge?') === 'compare', 'oder');
  assert(
    detectIslandAccessIntent('Was ist günstiger nach Wangerooge — Fähre oder Flieger?') ===
      'compare',
    'guenstiger',
  );
  assert(detectIslandAccessIntent('Inselflieger nach Wangerooge buchen') === 'flight', 'flight');
  assert(detectIslandAccessIntent('Fähre Wangerooge Tickets') === 'ferry', 'ferry');
  assert(wantsIslandAccessCompare('Anreise Wangerooge'), 'anreise compare');

  const payload = buildIslandAccessComparePayload('Wie komme ich nach Wangerooge?');
  assert(
    payload.speech.includes('Fähre') || payload.speech.includes('Inselflieger'),
    'speech modes',
  );
  assert(payload.speech.includes('erfinde keinen Fährpreis'), 'no fake ferry price');
  assert(
    payload.speech.includes(String(ISLAND_FLIGHT_TARIFF_AB.basicAdultFromEur)),
    'flight ab tariff',
  );
  assert(
    payload.quickActions.some((a) => /Fähr/i.test(a.label)),
    'ferry button',
  );
  assert(
    payload.quickActions.some((a) => /Inselflieger|Flug/i.test(a.label)),
    'flight button',
  );

  const ferryOnly = await prepareIslandAccessFollowUp('Fähre nach Wangerooge');
  assert(Boolean(ferryOnly?.speech), 'ferry speech');
  assert(
    Boolean(ferryOnly!.quickActions.some((a) => /Fähr/i.test(a.label))),
    'ferry qa',
  );

  assert(
    wantsFlightTaxiAccess('Morgen Flug nach Wien, bitte mit Taxi zum Flughafen'),
    'flight+taxi',
  );
  assert(wantsFlightTaxiAccess('Zum Flughafen mit dem Taxi'), 'airport taxi');
  assert(!wantsFlightTaxiAccess('Taxi nach Altona'), 'no bare taxi');
  assert(!wantsFlightTaxiAccess('Flug nach Wien morgen'), 'flight only');

  console.log('islandAccessCompare.smoke OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
