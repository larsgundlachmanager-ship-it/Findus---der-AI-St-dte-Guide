/**
 * Auto-ÖPNV Gate: Luftlinie 1,4 / 3 km, Rad 10 / 15 km.
 */
import assert from 'node:assert/strict';
import {
  PLAN_AIR_BIKE_FORCE_TRANSIT_M,
  PLAN_AIR_BIKE_OFFER_TRANSIT_M,
  PLAN_AIR_FORCE_TRANSIT_M,
  PLAN_AIR_OFFER_TRANSIT_M,
  PLAN_AIRLINE_LONG_WALK_M,
  PLAN_SOFT_MODE_MAX_MIN,
  decideAirMobility,
  shouldAskTransitFromAirline,
} from '../../module2/planning/planMobilityPolicy';
import { tidyHaltName } from '../transit/haltName';

function tourIsTransitJourney(
  stops: Array<{ role?: string | null }> | null | undefined,
): boolean {
  return Boolean(
    stops?.some(
      (s) =>
        s.role === 'board' || s.role === 'alight' || s.role === 'transfer',
    ),
  );
}

function shouldOfferAutoTransit(opts: {
  offlineOnly?: boolean;
  transitRide?: boolean;
  tourStops?: Array<{ role?: string | null }> | null;
  walkMin: number;
}): boolean {
  if (opts.offlineOnly || opts.transitRide) return false;
  if (tourIsTransitJourney(opts.tourStops)) return false;
  return opts.walkMin > PLAN_SOFT_MODE_MAX_MIN;
}

assert.equal(PLAN_SOFT_MODE_MAX_MIN, 20);
assert.equal(PLAN_AIRLINE_LONG_WALK_M, PLAN_AIR_FORCE_TRANSIT_M);
assert.equal(PLAN_AIR_OFFER_TRANSIT_M, 1_400);
assert.equal(PLAN_AIR_FORCE_TRANSIT_M, 3_000);
assert.equal(PLAN_AIR_BIKE_OFFER_TRANSIT_M, 10_000);
assert.equal(PLAN_AIR_BIKE_FORCE_TRANSIT_M, 15_000);
assert.equal(
  shouldAskTransitFromAirline({ airMeters: 400, walkMPerMin: 70 }),
  false,
);
assert.equal(
  shouldAskTransitFromAirline({ airMeters: 1_500, walkMPerMin: 70 }),
  true,
);
assert.equal(
  shouldAskTransitFromAirline({ airMeters: 8_000, walkMPerMin: 200 }),
  true,
);

assert.equal(decideAirMobility({ airMeters: 400, walkMin: 6 }).kind, 'walk');
assert.equal(
  decideAirMobility({ airMeters: 1_600, walkMin: 22 }).kind,
  'ask_transit',
);
assert.equal(
  decideAirMobility({
    airMeters: 3_200,
    walkMin: 45,
    transitMin: 22,
    taxiPref: 'no',
  }).kind,
  'auto_transit',
);
assert.equal(
  decideAirMobility({
    airMeters: 3_200,
    walkMin: 45,
    transitMin: 22,
    taxiPref: 'no',
  }).includeTaxi,
  false,
);
assert.equal(
  decideAirMobility({
    airMeters: 3_200,
    walkMin: 45,
    transitMin: 22,
    taxiPref: 'love',
  }).includeTaxi,
  true,
);
assert.equal(
  decideAirMobility({
    airMeters: 8_000,
    walkMin: 20,
    bikeMin: 18,
    transitMin: 25,
    preferBike: true,
  }).kind,
  'bike',
);
assert.equal(
  decideAirMobility({
    airMeters: 16_000,
    walkMin: 40,
    bikeMin: 38,
    transitMin: 22,
    preferBike: true,
    taxiPref: 'no',
  }).kind,
  'auto_transit',
);

assert.equal(
  tidyHaltName(
    'Haltestelle Prisdorf, Pinnau, Kreis Pinneberg, Schleswig-Holstein, 25497, Deutschland',
  ),
  'Prisdorf',
);
assert.equal(
  tidyHaltName(
    'Jungfernstieg, Neustadt, Hamburg-Mitte, Hamburg, 20354, Deutschland',
  ),
  'Jungfernstieg',
);
assert.equal(
  tidyHaltName('Pinneberg, Thesdorfer Weg, Schleswig-Holstein, Deutschland'),
  'Pinneberg, Thesdorfer Weg',
);

assert.equal(
  shouldOfferAutoTransit({ walkMin: 212, tourStops: null }),
  true,
);
assert.equal(
  shouldOfferAutoTransit({
    walkMin: 212,
    tourStops: [{ role: 'walk' }, { role: 'dest' }],
  }),
  true,
);
assert.equal(
  shouldOfferAutoTransit({
    walkMin: 45,
    tourStops: [{ role: 'board' }, { role: 'alight' }],
  }),
  false,
);
assert.equal(
  shouldOfferAutoTransit({ walkMin: 15 }),
  false,
);
assert.equal(
  shouldOfferAutoTransit({ walkMin: 90, transitRide: true }),
  false,
);

console.log('autoTransitGate.smoke.test.ts OK');
